import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { XR, createXRStore, useXR } from "@react-three/xr";
import { CHUNK_SIZE, PLACES } from "@xenxo/protocol";
import { usePlace, usePlaceTheme, world } from "../net/world-store";
import { Avatars } from "./Avatars";
import { Entities } from "./Entities";
import { graphics, useGraphics, type Ambience, type Features } from "./graphics";
import { attachDesktopInput, input } from "./input";
import { PhotoTaker } from "./Photo";
import { self } from "./self";
import { setMaxAnisotropy, tickMaterials } from "./materials";
import { Player } from "./Player";
import { Portals } from "./Portals";
import { Sky, SKY } from "./Sky";
import { Skyline } from "./Skyline";
import { NexoBackdrop } from "./NexoBackdrop";
import { NexoCity } from "./NexoCity";
import { DistrictSkyline } from "./DistrictSkyline";
import { Pedestrians, Traffic } from "./CityLife";
import { ambient } from "./ambient-audio";
import districtsLayout from "../../../realtime/src/districts.json";

const DISTRICT_IDS = new Map((districtsLayout.districts as { id: string; chunk: string }[]).map((d) => [d.chunk, d.id]));
import { Activities } from "./Activities";
import skyDay from "./sky-day.json";

/** Una sola tienda XR para toda la app. Activa foveation para ganar rendimiento en Quest. */
export const xrStore = createXRStore({ foveation: 1, emulate: false });

/** Los efectos de pantalla completa solo se descargan en equipos que los usan. */
const Effects = lazy(() => import("./Effects"));

const CENTER = new THREE.Vector3(CHUNK_SIZE / 2, 0, CHUNK_SIZE / 2);

/* ------------------------------------------------------------------ */
/* Luz                                                                  */
/* ------------------------------------------------------------------ */

/** El sol de día está donde lo tiene el cielo (HDRI): las sombras cuadran con las nubes. */
const SUN_DIR = (() => {
  const theta = (skyDay.sunU - 0.5) * Math.PI * 2;
  const elev = (skyDay.sunElevationDeg * Math.PI) / 180;
  const d = 48;
  return [Math.cos(theta) * Math.cos(elev) * d, Math.sin(elev) * d, Math.sin(theta) * Math.cos(elev) * d] as const;
})();

const LIGHTING = {
  day: {
    fill: 0,
    hemi: ["#e8f0ff", "#9c8a6a", 1.25],
    sun: { color: "#fff1dc", intensity: 2.3, offset: SUN_DIR },
    env: 0.55,
  },
  night: {
    fill: 0.55,
    hemi: ["#3a4a9a", "#1a1410", 0.3],
    sun: { color: "#9fb4ff", intensity: 0.3, offset: [22, 40, -12] },
    // Sin sonda, el entorno es un estudio blanco (RoomEnvironment): de noche casi nada,
    // o la plaza se ve gris y lavada en VR y móvil.
    env: 0.025,
  },
  // El nexo de día: cielo claro sobre la megaciudad, luz suave para que no se pierdan los neones.
  nexoDay: {
    fill: 0.25,
    hemi: ["#e6eeff", "#7a7488", 1.2],
    sun: { color: "#fff4e6", intensity: 1.7, offset: SUN_DIR },
    env: 0.45,
  },
  // El nexo de noche (y los distritos, siempre): una luz fría de ambiente para que se lea el suelo.
  nexo: {
    fill: 0.85,
    hemi: ["#7fa6e6", "#1a2333", 1.1],
    sun: { color: "#9fd8ff", intensity: 0.35, offset: [22, 40, -12] },
    env: 0.05,
  },
} as const;
type LightProfile = keyof typeof LIGHTING;

/**
 * Relleno de los personajes: una direccional que sale de la cámara hacia el jugador, casi
 * horizontal. Ilumina la cara que vemos de cada avatar (los oscuros dejan de ser una silueta
 * negra) y apenas toca el suelo, que mira hacia arriba. Sin objetos nuevos por frame.
 */
function AvatarFill({ intensity }: { intensity: number }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    scene.add(l.target);
    return () => {
      scene.remove(l.target);
    };
  }, [scene]);
  useFrame(({ camera }) => {
    const l = light.current;
    if (!l) return;
    l.position.set(camera.position.x, camera.position.y + 0.6, camera.position.z);
    l.target.position.set(self.x, self.y + 1.1, self.z);
  });
  return <directionalLight ref={light} intensity={intensity} color="#d6e6ff" />;
}

function Lighting({ profile, features }: { profile: LightProfile; features: Features }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const scene = useThree((s) => s.scene);
  const L = LIGHTING[profile];

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
      {features.avatarFill && L.fill > 0 && <AvatarFill intensity={L.fill} />}
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
/* Cielo real de día (HDRI de Poly Haven, CC0, servido desde xenxo)     */
/* ------------------------------------------------------------------ */

let dayTexture: Promise<THREE.Texture> | null = null;
function loadDaySky() {
  dayTexture ??= new THREE.TextureLoader().loadAsync("/sky/day.webp").then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  return dayTexture;
}

/** Cielo de nubes de día: la textura (para el fondo) y su mapa de entorno. null mientras carga. */
function useDaySky(enabled: boolean) {
  const gl = useThree((s) => s.gl);
  const [sky, setSky] = useState<{ tex: THREE.Texture; env: THREE.Texture } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let made: THREE.Texture | null = null;
    void loadDaySky().then((tex) => {
      if (!alive) return;
      const pmrem = new THREE.PMREMGenerator(gl);
      made = pmrem.fromEquirectangular(tex).texture;
      pmrem.dispose();
      setSky({ tex, env: made });
    });
    return () => {
      alive = false;
      made?.dispose();
      setSky(null);
    };
  }, [enabled, gl]);
  return enabled ? sky : null;
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
function Environment({ ambience, profile, probe, sky }: { ambience: Ambience; profile: LightProfile; probe: Features["probe"]; sky: THREE.Texture | null }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const base = sky ?? null;
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
  }, [ambience, cube, sky]);

  useFrame((_, dt) => {
    scene.environmentIntensity = cube ? (ambience === "night" ? 0.55 : 1) : LIGHTING[profile].env;
    if (!cube) {
      scene.environment = base ?? room;
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
    // La foto se hace con el entorno base (cielo o estudio), no con la propia foto.
    scene.environment = base ?? room;
    cube.cam.update(gl, scene);
    cube.rt.texture.needsPMREMUpdate = true;
    scene.environment = cube.rt.texture;
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* Entrada, VR y rendimiento                                            */
/* ------------------------------------------------------------------ */

/** Reloj de los materiales animados (agua) y anisotropía máxima de la GPU. */
function MaterialClock() {
  const gl = useThree((s) => s.gl);
  useEffect(() => setMaxAnisotropy(gl.capabilities.getMaxAnisotropy()), [gl]);
  useFrame((s) => tickMaterials(s.clock.elapsedTime));
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

/** En VR: nivel ligero y sin efectos mientras dura la sesión. */
function XRWatcher() {
  const session = useXR((s) => s.session);
  useEffect(() => graphics.setXR(!!session), [session]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Escena                                                               */
/* ------------------------------------------------------------------ */

function Scene({ active }: { active: boolean }) {
  const g = useGraphics();
  const f = g.features;
  const place = usePlace();
  const inPlaza = place === PLACES.plaza;
  const inNexo = place === PLACES.nexo;
  // Todos los lugares siguen el ambiente elegido (día, noche o la hora): cada distrito tiene su
  // versión de día y de noche. Los distritos usan la luz abierta del nexo.
  const ambience: Ambience = g.ambience;
  const profile: LightProfile = inPlaza ? ambience : ambience === "day" ? "nexoDay" : "nexo";
  // Sonido ambiente del lugar (sintetizado: ambient-audio.ts).
  const hint = usePlaceTheme();
  const soundTheme = inPlaza ? "plaza" : inNexo ? "nexo" : (DISTRICT_IDS.get(place) ?? hint?.id ?? "community");
  useEffect(() => ambient.setPlace(soundTheme, ambience), [soundTheme, ambience]);
  const sky = SKY[ambience];
  // El cielo de nubes (HDRI) es de la plaza; el nexo lleva su panorámica.
  const realSky = ambience === "day" && f.pbr && !inNexo;
  const daySky = useDaySky(realSky);
  const dayEnv = daySky?.env ?? null;
  const skyReady = !!daySky;
  return (
    <>
      <XRWatcher />
      <PerformanceMonitor bounds={(hz) => (hz > 90 ? [60, 100] : [45, 58])} flipflops={3} onDecline={() => graphics.decline()} />
      {daySky ? <primitive key="sky" attach="background" object={daySky.tex} /> : <color key="color" attach="background" args={[sky.fog]} />}
      <fog attach="fog" args={[sky.fog, ambience === "night" ? 45 : 70, ambience === "night" ? 230 : 260]} />
      {!skyReady && <Sky ambience={ambience} />}
      {inPlaza && <Skyline count={f.skyline} ambience={ambience} pbr={f.pbr} />}
      {inNexo && <NexoBackdrop ambience={ambience} hd={f.textures >= 1024} />}
      {inNexo && <NexoCity ambience={ambience} density={f.nexoCity} />}
      {!inNexo && !inPlaza && <DistrictSkyline chunk={place} density={f.nexoCity} ambience={ambience} />}
      {!inNexo && !inPlaza && (
        <Suspense fallback={null}>
          <Pedestrians chunk={place} count={f.pedestrians} />
          <Traffic chunk={place} count={f.traffic} features={f} ambience={ambience} />
        </Suspense>
      )}
      <Lighting profile={profile} features={f} />
      <Environment ambience={ambience} profile={profile} probe={f.probe} sky={dayEnv} />
      {/* Los textos cargan su fuente de forma asíncrona: que nunca bloqueen la escena ni el panel. */}
      <Suspense fallback={null}>
        <Entities features={f} ambience={ambience} />
        <Portals features={f} active={active} />
        {!inNexo && <Activities />}
        <Avatars />
      </Suspense>
      <Player active={active} />
      <InputBinder active={active} />
      <PhotoTaker />
      <MaterialClock />
      {f.post && !g.inXR && (
        <Suspense fallback={null}>
          <Effects features={f} ambience={ambience} />
        </Suspense>
      )}
    </>
  );
}

export function World({ active, paused = false }: { active: boolean; paused?: boolean }) {
  const g = useGraphics();
  const f = g.features;

  return (
    <Canvas
      // El MSAA del canvas no se puede cambiar en caliente: si cambia, se recrea.
      key={f.antialias ? "aa" : "post"}
      className="!absolute inset-0 touch-none"
      dpr={f.dpr}
      shadows
      gl={{ antialias: f.antialias, powerPreference: "high-performance" }}
      // Con un juego abierto encima, el mundo no se dibuja (la GPU es para el juego).
      frameloop={paused ? "never" : "always"}
      camera={{ fov: 70, near: 0.1, far: 400, position: [32, 14, 66] }}
    >
      <XR store={xrStore}>
        <Scene active={active} />
      </XR>
    </Canvas>
  );
}
