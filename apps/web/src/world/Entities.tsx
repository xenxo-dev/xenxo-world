import { Component, memo, Suspense, useMemo, type ReactNode } from "react";
import { Billboard, Text, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { HologramV1, LabelV1, labelText, LightV1, MeshV1, PrimitiveV1, TransformV1, type Entity } from "@xenxo/protocol";
import { assetUrl } from "../config";
import { useLang } from "../i18n";
import { useWorldVersion, world } from "../net/world-store";
import { FONT_URL, NEON_FONT_URL } from "./font";
import type { Ambience, Features } from "./graphics";
import { useFrame } from "@react-three/fiber";
import { haloMaterial, hologramMaterial, lightweight, libraryMaterial, parseLibraryName, tickHolograms } from "./materials";

/** Origen de un chunk respecto al lugar actual (que se dibuja en 0..CHUNK_SIZE). */
const chunkOrigin = (chunkId: string) => world.offsetOf(chunkId);

/**
 * Traduce componentes del protocolo a Three.js. Este archivo es el "adaptador de
 * render": un cliente nativo tendría su propia versión y el mundo no cambiaría.
 * Lo que no reconoce, no lo dibuja (compatibilidad hacia delante).
 */
/** Si un modelo no carga (borrado, red), la entidad simplemente no lo dibuja; el resto del mundo sigue. */
class SkipOnError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn("[xenxo] modelo no disponible", e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Modelo glTF por hash. useGLTF cachea por URL; cada entidad clona la escena compartiendo geometría.
 * Los materiales "xenxo:<biblioteca>" se visten con la biblioteca (texturas reales según el nivel)
 * y se comparten entre todas las copias del mismo modelo.
 */
const materialCache = new Map<string, THREE.Material>();

type Holo = { color: string; opacity: number } | null;

/** El mismo objeto para el mismo holograma (así no se rehacen las escenas en cada render). */
const holos = new Map<string, { color: string; opacity: number }>();
function holoOf(color: string, opacity: number) {
  const k = `${color}|${opacity}`;
  let h = holos.get(k);
  if (!h) holos.set(k, (h = { color, opacity }));
  return h;
}

function MeshAsset({ hash, features, ambience, holo }: { hash: string; features: Features; ambience: Ambience; holo: Holo }) {
  const gltf = useGLTF(assetUrl(hash), false, true);
  const shadows = features.shadows > 0;
  const scene = useMemo(() => {
    const c = gltf.scene.clone(true);
    // Holograma: toda la geometría con el mismo material de luz, sin halos ni sombras.
    if (holo) {
      const m = hologramMaterial(holo.color, holo.opacity);
      c.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = m;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = 3;
      });
      return c;
    }
    const tierKey = `${features.textures}|${features.normalMaps}|${features.pbr}|${features.bloom}|${ambience}`;
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: THREE.Material) => {
        const key = `${hash}|${m.uuid}|${tierKey}`;
        let out = materialCache.get(key);
        if (!out) {
          const ref = parseLibraryName(m.name);
          const ao = (m as THREE.MeshStandardMaterial).aoMap ?? null;
          out = ref ? libraryMaterial(ref, features, ambience, ao) : features.pbr ? m : lightweight(m);
          materialCache.set(key, out);
        }
        return out;
      };
      const original = mesh.material;
      mesh.material = Array.isArray(original) ? original.map(swap) : swap(original);
      // Sin bloom (VR, móvil, equipos modestos): el neón lleva su propio halo.
      if (!features.bloom && !Array.isArray(original)) {
        const ref = parseLibraryName(original.name);
        if (ref?.lib === "neon") {
          const halo = new THREE.Mesh(mesh.geometry, haloMaterial(ref.tint, ambience));
          halo.renderOrder = 2;
          halo.frustumCulled = mesh.frustumCulled;
          mesh.add(halo);
        }
      }
      const emits = !Array.isArray(mesh.material) && (mesh.material as THREE.MeshBasicMaterial).isMeshBasicMaterial;
      mesh.castShadow = shadows && !emits;
      mesh.receiveShadow = shadows;
    });
    return c;
  }, [gltf, hash, shadows, features, ambience, holo]);
  return <primitive object={scene} />;
}

/** Brillo de los emisivos: por encima de 1 para que el bloom los haga resplandecer, sobre todo de noche. */
function glow(ambience: Ambience, bloom: boolean) {
  if (!bloom) return 1;
  return ambience === "night" ? 4 : 1.15;
}

/** Luces de la escala de protocolo (0–10) a candelas de Three.js. */
const CANDELA_PER_UNIT = 4;

/* ------------------------------------------------------------------ */
/* Charcos de luz (VR, móvil y niveles sin luces puntuales)             */
/* ------------------------------------------------------------------ */

let poolTexture: THREE.CanvasTexture | null = null;
function poolGradient() {
  if (poolTexture) return poolTexture;
  const n = 128;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.14)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  poolTexture = new THREE.CanvasTexture(c);
  return poolTexture;
}
const poolGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const poolMaterials = new Map<string, THREE.MeshBasicMaterial>();
function poolMaterial(color: string, strength: number) {
  const key = `${color}|${strength.toFixed(2)}`;
  let m = poolMaterials.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(strength),
      map: poolGradient(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    poolMaterials.set(key, m);
  }
  return m;
}
/** Altura del suelo de la plaza; las luces más altas (balizas) no pintan charco. */
const POOL_FLOOR_Y = 0.02;
const POOL_MAX_HEIGHT = 8;

const EntityView = memo(function EntityView({
  entity,
  lang,
  features,
  ambience,
}: {
  entity: Entity;
  lang: string;
  features: Features;
  ambience: Ambience;
}) {
  const t = TransformV1.safeParse(entity.components["transform@1"]);
  if (!t.success) return null;
  const [ox, oz] = chunkOrigin(entity.chunk_id);
  const { p, r, s } = t.data;
  const prim = PrimitiveV1.safeParse(entity.components["primitive@1"]);
  const label = LabelV1.safeParse(entity.components["label@1"]);
  const mesh = MeshV1.safeParse(entity.components["mesh@1"]);
  const light = LightV1.safeParse(entity.components["light@1"]);
  const hologram = HologramV1.safeParse(entity.components["hologram@1"]);
  // Equipos potentes: el LOD más detallado (el primero). Ligeros (Quest, móvil): el último.
  const lod = mesh.success ? (features.lod === "detailed" ? mesh.data.lods[0] : mesh.data.lods[mesh.data.lods.length - 1]) : undefined;
  const shadows = features.shadows > 0;
  const lit = light.success && (light.data.when === "always" || ambience === "night");
  const showLight = lit && features.pointLights;
  const showPool = lit && features.lightPools && p[1] - POOL_FLOOR_Y < POOL_MAX_HEIGHT;
  const holo = hologram.success ? holoOf(hologram.data.color ?? "#4fe3ff", hologram.data.opacity) : null;

  return (
    <>
    {showPool && light.success && (
      <mesh
        geometry={poolGeometry}
        material={poolMaterial(light.data.color, Math.min(1, 0.25 + light.data.intensity * 0.35))}
        position={[p[0] + ox, POOL_FLOOR_Y, p[2] + oz]}
        scale={[Math.min(light.data.range, 7) * 1.5, 1, Math.min(light.data.range, 7) * 1.5]}
        renderOrder={1}
      />
    )}
    <group position={[p[0] + ox, p[1], p[2] + oz]} quaternion={r} scale={s}>
      {prim.success && <Primitive {...prim.data} pbr={features.pbr} glow={glow(ambience, features.bloom)} shadows={shadows} holo={holo} />}
      {showLight && (
        <pointLight
          color={light.data.color}
          intensity={light.data.intensity * CANDELA_PER_UNIT}
          distance={light.data.range}
          decay={2}
        />
      )}
      {lod && (
        <SkipOnError>
          <Suspense fallback={null}>
            <MeshAsset hash={lod.hash} features={features} ambience={ambience} holo={holo} />
          </Suspense>
        </SkipOnError>
      )}
      {label.success &&
        (label.data.billboard ? (
          // Si la entidad tiene geometría, el cartel flota justo encima de ella.
          <Billboard position={[0, prim.success ? prim.data.size[1] / 2 + label.data.size : 0, 0]}>
            <Label text={labelText(label.data, lang)} size={label.data.size} width={label.data.width} />
          </Billboard>
        ) : label.data.style === "neon" ? (
          <Suspense fallback={null}>
            <NeonLabel text={labelText(label.data, lang)} size={label.data.size} color={label.data.color ?? "#4fa3ff"} ambience={ambience} bloom={features.bloom} />
          </Suspense>
        ) : (
          // Carteles fijos (los de las fachadas): de noche brillan como un rótulo luminoso.
          <Label text={labelText(label.data, lang)} size={label.data.size} width={label.data.width} glow={ambience === "night" && features.bloom ? 2.4 : 1} />
        ))}
    </group>
    </>
  );
});

/** Rugosidad y metal de cada acabado (solo en equipos con materiales PBR). */
const FINISH = {
  matte: { roughness: 0.9, metalness: 0 },
  glossy: { roughness: 0.22, metalness: 0 },
  metal: { roughness: 0.32, metalness: 0.85 },
  glass: { roughness: 0.04, metalness: 0 },
} as const;

function Material({ color, emissive, finish, pbr, glow }: PrimitiveV1Type & { pbr: boolean; glow: number }) {
  const hdr = useMemo(() => new THREE.Color(color).multiplyScalar(glow), [color, glow]);
  if (emissive) {
    // Sin tono: el color puede pasar de 1 y el bloom lo hace resplandecer.
    return <meshBasicMaterial color={hdr} toneMapped={glow <= 1} />;
  }
  const glass = finish === "glass";
  if (!pbr) {
    // Quest y móviles: Lambert, sin brillos. El cristal, solo algo transparente.
    return <meshLambertMaterial color={color} transparent={glass} opacity={glass ? 0.8 : 1} />;
  }
  const f = FINISH[finish];
  return (
    <meshStandardMaterial
      color={color}
      roughness={f.roughness}
      metalness={f.metalness}
      transparent={glass}
      opacity={glass ? 0.72 : 1}
    />
  );
}

function Primitive(props: PrimitiveV1Type & { pbr: boolean; glow: number; shadows: boolean; holo: Holo }) {
  const { shape, size, emissive, shadows, holo } = props;
  const material = holo ? <primitive object={hologramMaterial(holo.color, holo.opacity)} attach="material" /> : <Material {...props} />;
  const cast = shadows && !emissive && !holo;
  const receive = shadows && !emissive && !holo;
  switch (shape) {
    case "box":
      return <mesh castShadow={cast} receiveShadow={receive}>{material}<boxGeometry args={size} /></mesh>;
    case "sphere":
      return <mesh castShadow={cast} receiveShadow={receive}>{material}<sphereGeometry args={size[0] < 1 ? [size[0] / 2, 10, 8] : [size[0] / 2, 20, 14]} /></mesh>;
    case "cylinder":
      return <mesh castShadow={cast} receiveShadow={receive}>{material}<cylinderGeometry args={[size[0] / 2, size[0] / 2, size[1], size[0] < 2 ? 12 : 40]} /></mesh>;
    case "plane":
      return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow={receive}>
          {material}
          <planeGeometry args={[size[0], size[2]]} />
        </mesh>
      );
  }
}

type PrimitiveV1Type = ReturnType<typeof PrimitiveV1.parse>;

function Label({ text, size, glow = 1, width }: { text: string; size: number; glow?: number; width?: number }) {
  // Cada texto en su propio Suspense: mientras carga la fuente, la geometría ya se ve.
  return (
    <Suspense fallback={null}>
      <LabelText text={text} size={size} glow={glow} width={width} />
    </Suspense>
  );
}

const LABEL_COLOR = new THREE.Color("#f6f1e7");

function LabelText({ text, size, glow, width }: { text: string; size: number; glow: number; width?: number }) {
  const color = useMemo(() => LABEL_COLOR.clone().multiplyScalar(glow), [glow]);
  return (
    <Text
      font={FONT_URL}
      fontSize={size}
      color={color}
      material-toneMapped={glow <= 1}
      anchorX="center"
      anchorY="middle"
      maxWidth={width}
      textAlign="center"
      lineHeight={1.25}
      outlineWidth={size * 0.04}
      outlineColor="#2a211c"
    >
      {text}
    </Text>
  );
}

const WHITE = new THREE.Color("#ffffff");

/**
 * Rótulo de neón: letras de tubo (Tilt Neon) del color del barrio.
 *  - De día, tubo de cristal apagado: color pálido con un filo oscuro para leerse sobre la fachada.
 *  - De noche con bloom (PC): núcleo casi blanco por encima de 1 y el bloom pone el resplandor.
 *  - De noche sin bloom (VR, móvil): el resplandor lo hace un contorno difuminado del mismo color.
 */
function NeonLabel({ text, size, color, ambience, bloom }: { text: string; size: number; color: string; ambience: Ambience; bloom: boolean }) {
  const night = ambience === "night";
  const base = useMemo(() => new THREE.Color(color), [color]);
  const fill = useMemo(() => {
    if (!night) return base.clone().lerp(WHITE, 0.45);
    const c = base.clone().lerp(WHITE, bloom ? 0.5 : 0.35);
    return bloom ? c.multiplyScalar(3.2) : c;
  }, [base, night, bloom]);
  const glowOutline = night && !bloom;
  return (
    <Text
      font={NEON_FONT_URL}
      fontSize={size}
      color={fill}
      material-toneMapped={!(night && bloom)}
      anchorX="center"
      anchorY="middle"
      letterSpacing={0.02}
      outlineWidth={glowOutline ? size * 0.09 : size * 0.025}
      outlineBlur={glowOutline ? size * 0.32 : night ? 0 : size * 0.04}
      outlineColor={glowOutline ? base : night ? base : "#151830"}
      outlineOpacity={glowOutline ? 0.9 : night ? 0.6 : 0.85}
    >
      {text}
    </Text>
  );
}

/** Avanza el reloj de los hologramas (uno para todos). */
function HologramClock() {
  useFrame((state) => tickHolograms(state.clock.elapsedTime));
  return null;
}

export function Entities({ features, ambience }: { features: Features; ambience: Ambience }) {
  useWorldVersion();
  const lang = useLang();
  return (
    <>
      <HologramClock />
      {[...world.entities.values()].map((e) => (
        <EntityView key={`${e.entity_id}:${e.rev}`} entity={e} lang={lang} features={features} ambience={ambience} />
      ))}
    </>
  );
}
