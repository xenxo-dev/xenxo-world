import { Component, memo, Suspense, useMemo, type ReactNode } from "react";
import { Billboard, Text, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { CHUNK_SIZE, LabelV1, labelText, LightV1, MeshV1, PrimitiveV1, TransformV1, type Entity } from "@xenxo/protocol";
import { assetUrl } from "../config";
import { useLang } from "../i18n";
import { useWorldVersion, world } from "../net/world-store";
import { FONT_URL } from "./font";
import type { Ambience, Features } from "./graphics";

/** Origen global de un chunk "c_<x>_<z>". */
function chunkOrigin(chunkId: string): [number, number] {
  const [, x = "0", z = "0"] = chunkId.split("_");
  return [Number(x) * CHUNK_SIZE, Number(z) * CHUNK_SIZE];
}

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

/** Modelo glTF por hash. useGLTF cachea por URL; cada entidad clona la escena compartiendo geometría y materiales. */
function MeshAsset({ hash, shadows }: { hash: string; shadows: boolean }) {
  const gltf = useGLTF(assetUrl(hash), false, true);
  const scene = useMemo(() => {
    const c = gltf.scene.clone(true);
    c.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = shadows;
        o.receiveShadow = shadows;
      }
    });
    return c;
  }, [gltf, shadows]);
  return <primitive object={scene} />;
}

/** Brillo de los emisivos: por encima de 1 para que el bloom los haga resplandecer, sobre todo de noche. */
function glow(ambience: Ambience, bloom: boolean) {
  if (!bloom) return 1;
  return ambience === "night" ? 4 : 1.15;
}

/** Luces de la escala de protocolo (0–10) a candelas de Three.js. */
const CANDELA_PER_UNIT = 4;

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
  // Equipos potentes: el LOD más detallado (el primero). Ligeros (Quest, móvil): el último.
  const lod = mesh.success ? (features.lod === "detailed" ? mesh.data.lods[0] : mesh.data.lods[mesh.data.lods.length - 1]) : undefined;
  const shadows = features.shadows > 0;
  const showLight = light.success && features.pointLights && (light.data.when === "always" || ambience === "night");

  return (
    <group position={[p[0] + ox, p[1], p[2] + oz]} quaternion={r} scale={s}>
      {prim.success && <Primitive {...prim.data} pbr={features.pbr} glow={glow(ambience, features.bloom)} shadows={shadows} />}
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
            <MeshAsset hash={lod.hash} shadows={shadows} />
          </Suspense>
        </SkipOnError>
      )}
      {label.success &&
        (label.data.billboard ? (
          // Si la entidad tiene geometría, el cartel flota justo encima de ella.
          <Billboard position={[0, prim.success ? prim.data.size[1] / 2 + label.data.size : 0, 0]}>
            <Label text={labelText(label.data, lang)} size={label.data.size} />
          </Billboard>
        ) : (
          <Label text={labelText(label.data, lang)} size={label.data.size} />
        ))}
    </group>
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

function Primitive(props: PrimitiveV1Type & { pbr: boolean; glow: number; shadows: boolean }) {
  const { shape, size, emissive, shadows } = props;
  const material = <Material {...props} />;
  const cast = shadows && !emissive;
  const receive = shadows && !emissive;
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

function Label({ text, size }: { text: string; size: number }) {
  // Cada texto en su propio Suspense: mientras carga la fuente, la geometría ya se ve.
  return (
    <Suspense fallback={null}>
      <LabelText text={text} size={size} />
    </Suspense>
  );
}

function LabelText({ text, size }: { text: string; size: number }) {
  return (
    <Text font={FONT_URL} fontSize={size} color="#f6f1e7" anchorX="center" anchorY="middle" outlineWidth={size * 0.04} outlineColor="#2a211c">
      {text}
    </Text>
  );
}

export function Entities({ features, ambience }: { features: Features; ambience: Ambience }) {
  useWorldVersion();
  const lang = useLang();
  return (
    <>
      {[...world.entities.values()].map((e) => (
        <EntityView key={`${e.entity_id}:${e.rev}`} entity={e} lang={lang} features={features} ambience={ambience} />
      ))}
    </>
  );
}
