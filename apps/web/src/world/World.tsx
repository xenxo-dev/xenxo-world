import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { XR, createXRStore, useXR } from "@react-three/xr";
import { CHUNK_SIZE } from "@xenxo/protocol";
import { world } from "../net/world-store";
import { Avatars } from "./Avatars";
import { Entities } from "./Entities";
import { graphics, useGraphics, type Ambience, type Features } from "./graphics";
import { attachDesktopInput, input } from "./input";
import { Player } from "./Player";
import { Sky, SKY } from "./Sky";
import { Skyline } from "./Skyline";

/** Una sola tienda XR para toda la app. Activa foveation para ganar rendimiento en Quest. */
export const xrStore = createXRStore({ foveation: 1, emulate: false });

/** Los efectos de pantalla completa solo se descargan en equipos que los usan. */
const Effects = lazy(() => import("./Effects"));

const CENTER = new THREE.Vector3(CHUNK_SIZE / 2, 0, CHUNK_SIZE / 2);

/* ------------------------------------------------------------------ */
/* Luz                                                                  */
/* ------------------------------------------------------------------ */

const LIGHTING = {
  day: {
    hemi: ["#ffe9cc", "#9c7a55", 1.5],
    sun: { color: "#ffd6a8", intensity: 1.9, offset: [-30, 24, 18] },
    env: 0.55,
  },
  night: {
    hemi: ["#3a4a9a", "#1a1410", 0.3],
    sun: { color: "#9fb4ff", intensity: 0.3, offset: [22, 40, -12] },
    env: 0.12,
  },
} as const;

function Lighting({ ambience, features }: { ambience: Ambience; features: Features }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const scene = useThree((s) => s.scene);
  const L = LIGHTING[ambience];

  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    light.target.position.copy(CENTER);
    scene.add(light.target);
    return () => {
      scene.remove(light.target);
    };
  }, [scene]);

  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    light.castShadow = features.shadows > 0;
    if (features.shadows) {
      light.shadow.mapSize.set(features.shadows, features.shadows);
      const cam = light.shadow.camera;
      cam.left = cam.bottom = -36;
      cam.right = cam.top = 36;
      cam.near = 1;
      cam.far = 140;
      cam.updateProjectionMatrix();
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.04;
      light.shadow.map?.dispose();
      light.shadow.map = null;
    }
  }, [features.shadows]);

  return (
    <>
      <hemisphereLight args={[L.hemi[0], L.hemi[1], L.hemi[2]]} />
      <directionalLight
        ref={sun}
        position={[CENTER.x + L.sun.offset[0], L.sun.offset[1], CENTER.z + L.sun.offset[2]]}
        intensity={L.sun.intensity}
        color={L.sun.color}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Reflejos                                                             */
/* ------------------------------------------------------------------ */

/**
 * Entorno para los materiales con brillo:
 *  - Siempre: un estudio neutro generado en la GPU (sin descargar HDRI).
 *  - Alta/Ultra: una «sonda» que fotografía la propia plaza (neones incluidos)
 *    al cargar y cuando cambia el mundo, para que el suelo mojado y el metal la reflejen.
 */
function Environment({ ambience, probe }: { ambience: Ambience; probe: Features["probe"] }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const room = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return tex;
  }, [gl]);
  useEffect(() => () => room.dispose(), [room]);

  const cube = useMemo(() => {
    if (!probe) return null;
    const rt = new THREE.WebGLCubeRenderTarget(probe, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const cam = new THREE.CubeCamera(0.5, 320, rt);
    cam.position.set(CENTER.x, 2.2, CENTER.z + 4);
    return { rt, cam };
  }, [probe]);
  useEffect(() => () => cube?.rt.dispose(), [cube]);

  // Pide una foto nueva de la plaza cuando cambian sus entidades o el ambiente.
  const dirty = useRef(true);
  const lastVersion = useRef(-1);
  const wait = useRef(1.2);
  useEffect(() => {
    dirty.current = true;
    wait.current = 0.8;
  }, [ambience, cube]);

  useFrame((_, dt) => {
    scene.environmentIntensity = cube ? (ambience === "night" ? 0.55 : 1) : LIGHTING[ambience].env;
    if (!cube) {
      scene.environment = room;
      return;
    }
    const v = world.getVersion();
    if (v !== lastVersion.current) {
      lastVersion.current = v;
      dirty.current = true;
      wait.current = Math.max(wait.current, 1);
    }
    if (!dirty.current) return;
    wait.current -= dt;
    if (wait.current > 0) return;
    dirty.current = false;
    // La foto se hace sin entorno, para que no se refleje a sí misma.
    scene.environment = room;
    cube.cam.update(gl, scene);
    cube.rt.texture.needsPMREMUpdate = true;
    scene.environment = cube.rt.texture;
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* Entrada, VR y rendimiento                                            */
/* ------------------------------------------------------------------ */

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

/** En VR: nivel ligero y sin efectos mientras dura la sesión. */
function XRWatcher() {
  const session = useXR((s) => s.session);
  useEffect(() => graphics.setXR(!!session), [session]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Escena                                                               */
/* ------------------------------------------------------------------ */

export function World({ active }: { active: boolean }) {
  const g = useGraphics();
  const f = g.features;
  const ambience = g.ambience;
  const sky = SKY[ambience];

  return (
    <Canvas
      // El MSAA del canvas no se puede cambiar en caliente: si cambia, se recrea.
      key={f.antialias ? "aa" : "post"}
      className="!absolute inset-0 touch-none"
      dpr={f.dpr}
      shadows
      gl={{ antialias: f.antialias, powerPreference: "high-performance" }}
      camera={{ fov: 70, near: 0.1, far: 400, position: [32, 14, 66] }}
    >
      <XR store={xrStore}>
        <XRWatcher />
        <PerformanceMonitor bounds={(hz) => (hz > 90 ? [60, 100] : [45, 58])} flipflops={3} onDecline={() => graphics.decline()} />
        <color attach="background" args={[sky.fog]} />
        <fog attach="fog" args={[sky.fog, ambience === "night" ? 45 : 60, ambience === "night" ? 230 : 230]} />
        <Sky ambience={ambience} />
        <Skyline count={f.skyline} ambience={ambience} pbr={f.pbr} />
        <Lighting ambience={ambience} features={f} />
        <Environment ambience={ambience} probe={f.probe} />
        {/* Los textos cargan su fuente de forma asíncrona: que nunca bloqueen la escena ni el panel. */}
        <Suspense fallback={null}>
          <Entities features={f} ambience={ambience} />
          <Avatars />
        </Suspense>
        <Player active={active} />
        <InputBinder active={active} />
        {f.post && !g.inXR && (
          <Suspense fallback={null}>
            <Effects features={f} ambience={ambience} />
          </Suspense>
        )}
      </XR>
    </Canvas>
  );
}
