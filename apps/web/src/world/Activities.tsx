/**
 * Actividades en el mundo: avisa al servidor al llegar a un objeto de una búsqueda o a un punto de
 * una carrera, dibuja los puntos de carrera (aro en el suelo y columna de luz) y los marcadores.
 * El servidor decide todo (cercanía, orden, tiempo); aquí solo se avisa y se enseña.
 *
 * Rendimiento: un bucle por frame sin objetos nuevos (listas precalculadas al cambiar el mundo),
 * materiales y geometrías compartidos, y los marcadores se piden solo de cerca y cada 30 s.
 */
import { memo, Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { CheckpointV1, CollectibleV1, ScoreboardV1, TransformV1, type Entity } from "@xenxo/protocol";
import { t } from "../i18n";
import { accountToken } from "../net/account";
import { activity, formatRaceTime, sendActivity, useActivity } from "../net/activity-store";
import { useWorldVersion, world } from "../net/world-store";
import { SIGN_FONT_URL, FONT_URL } from "./font";
import { playerPos } from "./Player";

interface Zone {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
  kind: "collect" | "checkpoint";
  role?: "start" | "cp" | "finish";
  race?: string;
  order?: number;
}

const COLORS = { start: "#33ddff", cp: "#ffd54f", finish: "#ff4fd8" } as const;
const ringGeo = new THREE.RingGeometry(0.92, 1, 48);
ringGeo.rotateX(-Math.PI / 2);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
const MATS = new Map<string, THREE.MeshBasicMaterial>();
function glow(color: string, opacity: number) {
  const key = `${color}:${opacity}`;
  let m = MATS.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    MATS.set(key, m);
  }
  return m;
}

function zonesOf(list: Entity[]): Zone[] {
  const out: Zone[] = [];
  for (const e of list) {
    const tr = TransformV1.safeParse(e.components["transform@1"]);
    if (!tr.success) continue;
    const [ox, oz] = world.offsetOf(e.chunk_id);
    const [x, y, z] = tr.data.p;
    const col = CollectibleV1.safeParse(e.components["collectible@1"]);
    if (col.success) out.push({ id: e.entity_id, x: x + ox, y, z: z + oz, r: col.data.radius, kind: "collect" });
    const cp = CheckpointV1.safeParse(e.components["checkpoint@1"]);
    if (cp.success) out.push({ id: e.entity_id, x: x + ox, y, z: z + oz, r: cp.data.radius, kind: "checkpoint", role: cp.data.role, race: cp.data.race, order: cp.data.order });
  }
  return out;
}

/**
 * Avisa al servidor al entrar en un círculo y, mientras sigas dentro, cada segundo (la pose que el
 * servidor tiene puede llegar un poco tarde, sobre todo tras un salto o un viaje). En la salida de
 * una carrera eso hace que el reloj empiece de verdad al salir del círculo.
 */
function Sensor({ zones }: { zones: Zone[] }) {
  const inside = useRef(new Map<string, number>());
  const guestWarned = useRef(false);
  useEffect(() => {
    inside.current.clear();
  }, [zones]);
  useFrame(() => {
    if (world.status !== "open" || zones.length === 0) return;
    const signed = !!accountToken();
    const now = performance.now();
    for (const zn of zones) {
      const dx = playerPos.x - zn.x, dz = playerPos.z - zn.z;
      const isIn = dx * dx + dz * dz <= zn.r * zn.r && Math.abs(playerPos.y - zn.y) <= 4 + zn.r;
      if (!isIn) {
        inside.current.delete(zn.id);
        continue;
      }
      const last = inside.current.get(zn.id);
      if (last !== undefined && now - last < 1000) continue;
      inside.current.set(zn.id, now);
      if (zn.kind === "collect" && activity.collected.has(zn.id)) continue;
      if (!signed) {
        if (!guestWarned.current) {
          guestWarned.current = true;
          activity.notice({ kind: "guest", at: now });
        }
        continue;
      }
      sendActivity(zn.kind === "collect" ? "COLLECT" : "CHECKPOINT", zn.id);
    }
  });
  return null;
}

/** Aro en el suelo y columna de luz de un punto de carrera; el que toca, más brillante. */
const CheckpointMark = memo(function CheckpointMark({ zone, hot }: { zone: Zone; hot: boolean }) {
  const color = COLORS[zone.role ?? "cp"];
  const tall = zone.role === "cp" ? 2.5 : 4.5;
  return (
    <group position={[zone.x, zone.y + 0.03, zone.z]}>
      <mesh geometry={ringGeo} material={glow(color, hot ? 0.95 : 0.45)} scale={[zone.r, 1, zone.r]} />
      <mesh geometry={beamGeo} material={glow(color, hot ? 0.1 : 0.04)} scale={[zone.r * 0.98, tall, zone.r * 0.98]} position={[0, tall / 2, 0]} />
    </group>
  );
});

function Checkpoints({ zones }: { zones: Zone[] }) {
  const a = useActivity();
  const run = a.race;
  const cps = zones.filter((z) => z.kind === "checkpoint");
  // Durante una carrera se resalta el punto que toca (o la meta); sin carrera, las salidas.
  const hot = (z: Zone) => {
    if (!run) return z.role === "start";
    if (z.race !== run.race) return false;
    if (run.next > run.total) return z.role === "finish";
    return z.role === "cp" && z.order === cpOrder(cps, run.race, run.next);
  };
  return (
    <>
      {cps.map((z) => (
        <CheckpointMark key={z.id} zone={z} hot={hot(z)} />
      ))}
    </>
  );
}

/** El `order` del n-ésimo punto `cp` (por orden) de una carrera. */
function cpOrder(cps: Zone[], race: string, n: number): number | undefined {
  return cps
    .filter((z) => z.race === race && z.role === "cp")
    .map((z) => z.order ?? 0)
    .sort((a, b) => a - b)
    .at(n - 1);
}

/* --- Marcadores --- */

const PANEL_MAT = new THREE.MeshBasicMaterial({ color: "#0b0f18", transparent: true, opacity: 0.86 });
const panelGeo = new THREE.PlaneGeometry(1, 1);

function Scoreboard({ entity }: { entity: Entity }) {
  const a = useActivity();
  const tr = TransformV1.safeParse(entity.components["transform@1"]);
  const sb = ScoreboardV1.safeParse(entity.components["scoreboard@1"]);
  const last = useRef(0);
  const pos = useMemo(() => {
    if (!tr.success) return null;
    const [ox, oz] = world.offsetOf(entity.chunk_id);
    return new THREE.Vector3(tr.data.p[0] + ox, tr.data.p[1], tr.data.p[2] + oz);
  }, [entity, tr.success]); // eslint-disable-line react-hooks/exhaustive-deps
  // Se pide de cerca (40 m) y como mucho cada 30 s.
  useFrame(() => {
    if (!pos || world.status !== "open") return;
    const now = performance.now();
    if (now - last.current < 30_000) return;
    if (pos.distanceToSquared(playerPos) > 40 * 40) return;
    last.current = now;
    sendActivity("SCORES_GET", entity.entity_id);
  });
  if (!tr.success || !sb.success || !pos) return null;
  const [w, h] = sb.data.size;
  const rows = a.scores.get(entity.entity_id) ?? [];
  const line = h / 13;
  const value = (v: number, ts: number) => (sb.data.kind === "race" ? formatRaceTime(v) : new Date(ts).toLocaleDateString());
  return (
    <group position={pos} quaternion={tr.data.r}>
      <mesh geometry={panelGeo} material={PANEL_MAT} scale={[w, h, 1]} />
      <Text font={SIGN_FONT_URL} fontSize={line * 1.4} color="#33ddff" anchorX="center" anchorY="top" position={[0, h / 2 - line * 0.6, 0.01]}>
        {sb.data.kind === "race" ? t("activity.boardRace") : t("activity.boardHunt")}
      </Text>
      <Text font={FONT_URL} fontSize={line * 0.8} color="#e8edf7" anchorX="left" anchorY="top" lineHeight={1.35} position={[-w / 2 + line, h / 2 - line * 2.6, 0.01]} maxWidth={w - 2 * line}>
        {rows.length ? rows.map((r, i) => `${i + 1}. ${r.name}${r.player_no !== undefined ? ` #${r.player_no}` : ""} — ${value(r.value, r.ts)}`).join("\n") : t("activity.boardEmpty")}
      </Text>
    </group>
  );
}

export function Activities() {
  useWorldVersion();
  const list = [...world.entities.values()];
  const key = list.length + ":" + world.getVersion();
  const zones = useMemo(() => zonesOf(list.filter((e) => e.components["collectible@1"] || e.components["checkpoint@1"])), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const boards = list.filter((e) => e.components["scoreboard@1"]);
  return (
    <>
      <Sensor zones={zones} />
      <Checkpoints zones={zones} />
      <Suspense fallback={null}>
        {boards.map((e) => (
          <Scoreboard key={`${e.entity_id}:${e.rev}`} entity={e} />
        ))}
      </Suspense>
    </>
  );
}
