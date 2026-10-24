import { Suspense, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { XR, createXRStore } from "@react-three/xr";
import { Entities } from "./Entities";
import { Avatars } from "./Avatars";
import { Player } from "./Player";
import { attachDesktopInput, input } from "./input";

/** Una sola tienda XR para toda la app. Activa foveation para ganar rendimiento en Quest. */
export const xrStore = createXRStore({ foveation: 1, emulate: false });

function InputBinder({ active }: { active: boolean }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => attachDesktopInput(gl.domElement), [gl]);
  useEffect(() => {
    input.enabled = active;
    if (!active) {
      input.move.x = 0;
      input.move.y = 0;
    }
  }, [active]);
  return null;
}

export function World({ active, quality }: { active: boolean; quality: "low" | "high" }) {
  return (
    <Canvas
      className="!absolute inset-0 touch-none"
      dpr={quality === "high" ? [1, 2] : [0.75, 1]}
      gl={{ antialias: quality === "high", powerPreference: "high-performance" }}
      camera={{ fov: 70, near: 0.1, far: 400, position: [32, 14, 66] }}
    >
      <XR store={xrStore}>
        <color attach="background" args={["#0b0d1f"]} />
        <fog attach="fog" args={["#0b0d1f", 45, 140]} />
        {/* Iluminación barata: ambiente + una direccional, sin sombras. */}
        <hemisphereLight args={["#b9baff", "#2a2f63", 1.8]} />
        <directionalLight position={[20, 40, 10]} intensity={1.6} />
        {/* Los textos cargan su fuente de forma asíncrona: que nunca bloqueen la escena ni el panel. */}
        <Suspense fallback={null}>
          <Entities />
          <Avatars />
        </Suspense>
        <Player active={active} />
        <InputBinder active={active} />
      </XR>
    </Canvas>
  );
}
