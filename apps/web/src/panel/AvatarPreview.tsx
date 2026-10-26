/**
 * Vista previa del personaje en el panel: el mismo cargador y las mismas animaciones que en el
 * mundo, en un escenario pequeño con su anillo de luz. Se carga aparte (Three.js) y solo se
 * monta mientras se ve la sección Cuenta.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { loadAvatar, type LoadedAvatar } from "../world/avatar-model";
import { advance, createMotion, type Motion } from "../world/motion";

export type PreviewPose = "idle" | "walk" | "dance" | "wave";

function Model({ url, motion, onState }: { url: string; motion: Motion; onState: (s: "loading" | "ready" | "error") => void }) {
  const [avatar, setAvatar] = useState<LoadedAvatar | null>(null);
  useEffect(() => {
    let alive = true;
    let loaded: LoadedAvatar | null = null;
    onState("loading");
    loadAvatar(url)
      .then((a) => {
        if (!alive) return a.dispose();
        loaded = a;
        setAvatar(a);
        onState("ready");
      })
      .catch(() => alive && onState("error"));
    return () => {
      alive = false;
      setAvatar(null);
      loaded?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1);
    advance(motion, d);
    avatar?.update(d, motion);
  });
  return avatar ? <primitive object={avatar.object} /> : null;
}

/** Anillo de luz bajo los pies (geometría aditiva, sin luces extra). */
function Stage({ color }: { color: string }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.002}>
        <ringGeometry args={[0.62, 0.66, 64]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.62, 64]} />
        <meshBasicMaterial color="#0b1220" transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

export default function AvatarPreview({
  url,
  pose,
  color = "#3ee6ff",
  onState,
}: {
  url: string;
  pose: PreviewPose;
  color?: string;
  onState: (s: "loading" | "ready" | "error") => void;
}) {
  const motion = useRef<Motion>(createMotion()).current;
  // Andar en el sitio: la animación de paso sin desplazarse.
  motion.speed = pose === "walk" ? 1.25 : 0;
  motion.emote = pose === "dance" ? "dance" : pose === "wave" ? "wave" : null;

  return (
    <Canvas
      dpr={[1, 1.5]}
      // Los avatares miran a -Z: la cámara se pone delante, con sitio para cabeza y pies.
      camera={{ position: [0, 1.05, -3.9], fov: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      onCreated={({ camera }) => camera.lookAt(0, 0.9, 0)}
    >
      <hemisphereLight args={["#cfe8ff", "#1a1030", 1.1]} />
      <directionalLight position={[-2, 3, -2.5]} intensity={1.6} />
      <directionalLight position={[2.5, 1.5, 2]} intensity={1.4} color={color} />
      <Suspense fallback={null}>
        <Model url={url} motion={motion} onState={onState} />
      </Suspense>
      <Stage color={color} />
      <OrbitControls
        target={[0, 0.9, 0]}
        enablePan={false}
        enableZoom={false}
        minPolarAngle={Math.PI / 2.6}
        maxPolarAngle={Math.PI / 1.9}
        autoRotate
        autoRotateSpeed={0.6}
      />
    </Canvas>
  );
}
