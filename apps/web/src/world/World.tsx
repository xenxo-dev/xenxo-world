import { Suspense, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { PMREMGenerator } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { XR, createXRStore } from "@react-three/xr";
import { Entities } from "./Entities";
import { Avatars } from "./Avatars";
import { setEnvironment } from "./environment";
import { Player } from "./Player";
import { HORIZON, Sky } from "./Sky";
import { attachDesktopInput, input } from "./input";

/** Una sola tienda XR para toda la app. Activa foveation para ganar rendimiento en Quest. */
export const xrStore = createXRStore({ foveation: 1, emulate: false });

/**
 * Iluminación de entorno para los modelos glTF con materiales PBR (metal, rugosidad).
 * Se genera una vez en la GPU, sin descargar HDRI. Los materiales Lambert de la plaza no la usan.
 */
function EnvironmentLight() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    setEnvironment(env);
    return () => {
      setEnvironment(null);
      env.dispose();
      pmrem.dispose();
    };
  }, [gl]);
  return null;
}

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
        <color attach="background" args={[HORIZON]} />
        <fog attach="fog" args={[HORIZON, 60, 220]} />
        <Sky />
        <EnvironmentLight />
        {/* Atardecer cálido y barato: ambiente + una direccional baja desde el oeste, sin sombras. */}
        <hemisphereLight args={["#ffe9cc", "#9c7a55", 1.5]} />
        <directionalLight position={[-30, 22, 18]} intensity={1.7} color="#ffd6a8" />
        {/* Los textos cargan su fuente de forma asíncrona: que nunca bloqueen la escena ni el panel. */}
        <Suspense fallback={null}>
          <Entities quality={quality} />
          <Avatars />
        </Suspense>
        <Player active={active} />
        <InputBinder active={active} />
      </XR>
    </Canvas>
  );
}
