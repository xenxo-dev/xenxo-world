import { Component, memo, Suspense, useMemo, type ReactNode } from "react";
import { Billboard, Text, useGLTF } from "@react-three/drei";
import { CHUNK_SIZE, LabelV1, labelText, MeshV1, PrimitiveV1, TransformV1, type Entity } from "@xenxo/protocol";
import { assetUrl } from "../config";
import { useLang } from "../i18n";
import { useWorldVersion, world } from "../net/world-store";
import { applyEnvironment } from "./environment";
import { FONT_URL } from "./font";

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
function MeshAsset({ hash }: { hash: string }) {
  const gltf = useGLTF(assetUrl(hash), false, true);
  const scene = useMemo(() => {
    const c = gltf.scene.clone(true);
    applyEnvironment(c);
    return c;
  }, [gltf]);
  return <primitive object={scene} />;
}

const EntityView = memo(function EntityView({ entity, lang, quality }: { entity: Entity; lang: string; quality: "low" | "high" }) {
  const t = TransformV1.safeParse(entity.components["transform@1"]);
  if (!t.success) return null;
  const [ox, oz] = chunkOrigin(entity.chunk_id);
  const { p, r, s } = t.data;
  const prim = PrimitiveV1.safeParse(entity.components["primitive@1"]);
  const label = LabelV1.safeParse(entity.components["label@1"]);
  const mesh = MeshV1.safeParse(entity.components["mesh@1"]);
  // Calidad alta: el LOD más detallado (el primero). Ahorro (Quest, móvil): el más ligero (el último).
  const lod = mesh.success ? (quality === "high" ? mesh.data.lods[0] : mesh.data.lods[mesh.data.lods.length - 1]) : undefined;

  return (
    <group position={[p[0] + ox, p[1], p[2] + oz]} quaternion={r} scale={s}>
      {prim.success && <Primitive {...prim.data} />}
      {lod && (
        <SkipOnError>
          <Suspense fallback={null}>
            <MeshAsset hash={lod.hash} />
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

function Primitive({ shape, size, color, emissive }: PrimitiveV1Type) {
  // Materiales baratos para Quest: Basic para emisivos, Lambert para el resto. Sin sombras ni post-proceso.
  const material = emissive ? <meshBasicMaterial color={color} /> : <meshLambertMaterial color={color} />;
  switch (shape) {
    case "box":
      return <mesh>{material}<boxGeometry args={size} /></mesh>;
    case "sphere":
      return <mesh>{material}<sphereGeometry args={size[0] < 1 ? [size[0] / 2, 10, 8] : [size[0] / 2, 20, 14]} /></mesh>;
    case "cylinder":
      return <mesh>{material}<cylinderGeometry args={[size[0] / 2, size[0] / 2, size[1], size[0] < 2 ? 12 : 40]} /></mesh>;
    case "plane":
      return (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
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

export function Entities({ quality }: { quality: "low" | "high" }) {
  useWorldVersion();
  const lang = useLang();
  return (
    <>
      {[...world.entities.values()].map((e) => (
        <EntityView key={`${e.entity_id}:${e.rev}`} entity={e} lang={lang} quality={quality} />
      ))}
    </>
  );
}
