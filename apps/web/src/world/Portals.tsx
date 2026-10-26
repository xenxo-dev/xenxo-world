/**
 * Portales (portal@1): la portada en la pantalla del marco o, sin portada, un velo de luz.
 * Y el sensor: si el jugador entra en la franja de delante del portal, viaja (a otro chunk)
 * o se abre la ficha del proyecto (nunca un enlace sin que la persona pulse).
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import * as THREE from "three";
import { labelText, PORTAL_ZONE_DEPTH, PortalV1, TransformV1, type Entity } from "@xenxo/protocol";
import { assetUrl } from "../config";
import { getLang } from "../i18n";
import { travel } from "../net/session";
import { useWorldVersion, world } from "../net/world-store";
import type { Features } from "./graphics";
import { playerPos } from "./Player";
import { categoryColor, portalHud } from "./portals-state";


/* ------------------------------------------------------------------ */
/* Portadas                                                             */
/* ------------------------------------------------------------------ */

const covers = new Map<string, Promise<THREE.Texture>>();

/** Descarga la portada (por la caché del servidor) y la reduce al ancho del nivel gráfico. */
function loadCover(hash: string, width: number): Promise<THREE.Texture> {
  const key = `${hash}|${width}`;
  let p = covers.get(key);
  if (!p) {
    p = fetch(assetUrl(hash))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`portada ${r.status}`))))
      .then((b) => createImageBitmap(b, { resizeWidth: width, resizeQuality: "high", imageOrientation: "flipY" }))
      .then((bitmap) => {
        const t = new THREE.Texture(bitmap);
        t.flipY = false;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        t.needsUpdate = true;
        return t;
      });
    p.catch(() => covers.delete(key));
    covers.set(key, p);
  }
  return p;
}

function useCover(hash: string | undefined, width: number) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!hash) return;
    let alive = true;
    loadCover(hash, width)
      .then((t) => alive && setTex(t))
      .catch(() => alive && setTex(null));
    return () => {
      alive = false;
    };
  }, [hash, width]);
  return hash ? tex : null;
}

/* ------------------------------------------------------------------ */
/* Velo de luz (portales sin portada, como el arco de la plaza)         */
/* ------------------------------------------------------------------ */

let veilTexture: THREE.CanvasTexture | null = null;
function veilGradient() {
  if (veilTexture) return veilTexture;
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.18)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  veilTexture = new THREE.CanvasTexture(c);
  return veilTexture;
}
const veilMaterials = new Map<string, THREE.MeshBasicMaterial>();
function veilMaterial(color: string) {
  let m = veilMaterials.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      map: veilGradient(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    veilMaterials.set(color, m);
  }
  return m;
}
const unitPlane = new THREE.PlaneGeometry(1, 1);

/* ------------------------------------------------------------------ */
/* Vista de un portal                                                   */
/* ------------------------------------------------------------------ */

const PortalView = memo(function PortalView({ entity, coverWidth }: { entity: Entity; coverWidth: number }) {
  const t = TransformV1.safeParse(entity.components["transform@1"]);
  const portal = PortalV1.safeParse(entity.components["portal@1"]);
  const tex = useCover(portal.success ? portal.data.cover : undefined, coverWidth);
  const coverMat = useMemo(() => (tex ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : null), [tex]);
  useEffect(() => () => coverMat?.dispose(), [coverMat]);
  if (!t.success || !portal.success) return null;
  const [ox, oz] = world.offsetOf(entity.chunk_id);
  const { p, r } = t.data;
  const [w, h] = portal.data.size;
  return (
    <group position={[p[0] + ox, p[1], p[2] + oz]} quaternion={r}>
      {coverMat ? (
        <mesh geometry={unitPlane} material={coverMat} position={[0, 0, 0.02]} scale={[w, h, 1]} />
      ) : (
        <mesh geometry={unitPlane} material={veilMaterial(categoryColor(portal.data.category))} scale={[w, h, 1]} renderOrder={2} />
      )}
    </group>
  );
});

/* ------------------------------------------------------------------ */
/* Sensor: entrar en un portal                                          */
/* ------------------------------------------------------------------ */

interface Zone {
  id: string;
  x: number;
  z: number;
  c: number;
  s: number;
  hw: number;
  portal: PortalV1Type;
}
type PortalV1Type = ReturnType<typeof PortalV1.parse>;

function zonesOf(list: Entity[]): Zone[] {
  const out: Zone[] = [];
  for (const e of list) {
    const t = TransformV1.safeParse(e.components["transform@1"]);
    const portal = PortalV1.safeParse(e.components["portal@1"]);
    if (!t.success || !portal.success) continue;
    const [ox, oz] = world.offsetOf(e.chunk_id);
    const [qx, qy, qz, qw] = t.data.r;
    const yaw = Math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qy * qy + qx * qx));
    out.push({ id: e.entity_id, x: t.data.p[0] + ox, z: t.data.p[2] + oz, c: Math.cos(yaw), s: Math.sin(yaw), hw: portal.data.size[0] / 2, portal: portal.data });
  }
  return out;
}

function inZone(z: Zone, x: number, pz: number) {
  const dx = x - z.x;
  const dz = pz - z.z;
  const lx = dx * z.c - dz * z.s;
  const lz = dx * z.s + dz * z.c;
  return Math.abs(lx) < z.hw && lz > -0.3 && lz < PORTAL_ZONE_DEPTH;
}

function PortalSensor({ portals, active }: { portals: Entity[]; active: boolean }) {
  const inXR = useXR((s) => s.session != null);
  const xrSession = useXR((s) => s.session);
  const zones = useMemo(() => zonesOf(portals), [portals]);
  // Al cargar un lugar, los portales en los que ya estás no se disparan hasta que sales.
  // Dos conjuntos que se alternan: nada de objetos nuevos por frame.
  const sets = useRef({ before: new Set<string>(), now: new Set<string>(), primed: false });
  useEffect(() => {
    sets.current.primed = false;
  }, [zones]);

  useFrame(() => {
    if (!active && !inXR) return;
    if (world.status !== "open") return;
    const st = sets.current;
    const now = st.now;
    now.clear();
    for (const z of zones) if (inZone(z, playerPos.x, playerPos.z)) now.add(z.id);
    if (st.primed) {
      for (const z of zones) {
        const was = st.before.has(z.id);
        const is = now.has(z.id);
        if (is && !was) {
          // En las gafas, un proyecto se abre fuera de la VR: se sale y aparece su ficha.
          if (inXR && z.portal.to.kind === "project") void xrSession?.end().catch(() => {});
          enter(z);
        }
        if (!is && was && z.portal.to.kind === "project") portalHud.close(z.portal.to.project_id);
      }
    }
    st.primed = true;
    st.now = st.before;
    st.before = now;
  });
  return null;
}

function enter(z: Zone) {
  const to = z.portal.to;
  const title = z.portal.title ? labelText({ text: z.portal.title, i18n: z.portal.i18n }, getLang()) : "";
  if (to.kind === "chunk") {
    portalHud.travel(title);
    travel(to.chunk_id, to.spawn ?? [32, 0, 40], to.yaw ?? 0);
    return;
  }
  portalHud.open({ projectId: to.project_id, title, cover: z.portal.cover ?? null, category: z.portal.category ?? null });
}

/* ------------------------------------------------------------------ */

export function Portals({ features, active }: { features: Features; active: boolean }) {
  useWorldVersion();
  const portals = useMemo(
    () => [...world.entities.values()].filter((e) => e.components["portal@1"] !== undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world.getVersion()],
  );
  // Quest y móviles: portadas a 640 px (menos memoria de vídeo); escritorio, 1280.
  const coverWidth = features.lod === "detailed" ? 1280 : 640;
  return (
    <>
      {portals.map((e) => (
        <PortalView key={`${e.entity_id}:${e.rev}`} entity={e} coverWidth={coverWidth} />
      ))}
      <PortalSensor portals={portals} active={active} />
    </>
  );
}
