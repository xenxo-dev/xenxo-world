import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { XR, createXRStore, useXR } from "@react-three/xr";
import { CHUNK_SIZE, PLACES } from "@xenxo/protocol";
import { usePlace, usePlaceTheme, world } from "../net/world-store";
import { Avatars } from "./Avatars";
import { Entities, SkipOnError } from "./Entities";
import { ENV_SIZE, graphics, useGraphics, type Ambience, type Features } from "./graphics";
import { FpsWatch, LOADED_MS } from "./perf";
import { attachDesktopInput, input } from "./input";
import { PhotoTaker } from "./Photo";
import { Recorder } from "./cine/Recorder";
import { FRAME_PX, useCine } from "./cine/state";
import { useCovered } from "./cover";
import { self } from "./self";
import { setMaxAnisotropy, tickMaterials } from "./materials";
import { dropPass, passDue, requestPass, runPass, setDirectTone, setWarmRenderer, tickWarm, UPLOAD_BUDGET_MS, warmBusy, warmHold, warmPasses, warmSettled, type WarmRenderer } from "./warm";
import { Player } from "./Player";
import { Portals } from "./Portals";
import { PhotoSky, Sky, SKY } from "./Sky";
import { patchFog } from "./display";
import { Skyline } from "./Skyline";
import { NexoBackdrop } from "./NexoBackdrop";
import { PANO_TONES } from "./nexo-tones";
import { NexoCity } from "./NexoCity";
import { DistrictSkyline } from "./DistrictSkyline";
import { Citizens, Traffic } from "./CityLife";
import { Residents, SlidingDoors } from "./Interiors";
import { Weather } from "./Weather";
import { ambient } from "./ambient-audio";
import districtsLayout from "../../../realtime/src/districts.json";

const DISTRICT_IDS = new Map((districtsLayout.districts as { id: string; chunk: string }[]).map((d) => [d.chunk, d.id]));
import { Activities } from "./Activities";
import { PeopleFx } from "./people/PeopleFx";
import { ShotFx } from "./people/ShotFx";
import { LootChests } from "./LootChests";
import { VRTeleport } from "./xr/VRTeleport";
import skyDay from "./sky-day.json";
import { splashActive, splashDone, splashProgress } from "../splash";

/**
 * Una sola tienda XR para toda la app. Activa foveation para ganar rendimiento en Quest. Los modelos
 * de los mandos y de las manos se sirven desde xenxo (tools/xr/fetch-profiles.mjs), nunca de un CDN:
 * un mando que no esté en la lista usa el genérico.
 */
export const xrStore = createXRStore({
  foveation: 1,
  emulate: false,
  baseAssetPath: new URL("/xr/profiles/", location.origin).href,
  defaultControllerProfileId: "generic-trigger-squeeze-thumbstick",
});

// La bruma, igual con y sin post-proceso: antes de que se compile ningún material.
patchFog();

/**
 * Los efectos de pantalla completa solo se descargan en equipos que los usan. Y en esos, cuanto
 * antes: hasta que llegan no se dibuja nada (`Hold`), y se piden ya, no al montar la escena.
 */
const loadEffects = () => import("./Effects");
const Effects = lazy(loadEffects);
if (graphics.features.post) void loadEffects().catch(() => {});

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
  // La plaza de día con sombras del sol (escritorio, niveles altos): más sol y menos luz de
  // ambiente. Con la de `day`, más la foto de los reflejos, el ambiente daba casi el doble de luz
  // que el sol y las sombras apenas se veían (un 10 % más oscuras que el suelo al sol).
  daySun: {
    fill: 0,
    hemi: ["#e8f0ff", "#9c8a6a", 0.7],
    sun: { color: "#fff1dc", intensity: 2.9, offset: SUN_DIR },
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
      {/* Que da sombra se dice al crearla (no después, en un efecto): va dentro de cada shader, y lo
          que se compilara antes de saberlo no valdría (world/warm.ts). */}
      <directionalLight
        ref={sun}
        castShadow={features.shadows > 0}
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
    // Da la vuelta entera: que el borde izquierdo siga en el derecho (la esfera de PhotoSky).
    t.wrapS = THREE.RepeatWrapping;
    return t;
  });
  return dayTexture;
}

/**
 * El mapa de entorno del cielo, del tamaño de todos (`ENV_SIZE`): la foto pasa primero a un cubo de
 * ese tamaño. (Directamente saldría del doble, y al llegar se recompilarían todos los materiales.)
 */
function skyEnvironment(gl: THREE.WebGLRenderer, tex: THREE.Texture): THREE.Texture {
  const cube = new THREE.WebGLCubeRenderTarget(ENV_SIZE);
  cube.fromEquirectangularTexture(gl, tex);
  const pmrem = new THREE.PMREMGenerator(gl);
  const out = pmrem.fromCubemap(cube.texture).texture;
  pmrem.dispose();
  cube.dispose();
  return out;
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
      made = skyEnvironment(gl, tex);
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

/** Lo más que la foto de los reflejos espera a que el lugar esté entero (s). */
const PHOTO_WAIT_S = 8;

/**
 * Entorno para los materiales con brillo:
 *  - Siempre: un estudio neutro generado en la GPU (sin descargar HDRI).
 *  - Alta/Ultra: una «sonda» que fotografía la propia plaza (neones incluidos)
 *    al cargar y cuando cambia el mundo, para que el suelo mojado y el metal la reflejen.
 *
 * Hay entorno desde el primer momento y todos miden lo mismo (`ENV_SIZE`): que lo haya y su tamaño
 * van dentro de cada shader, y un cambio los recompilaría todos (world/warm.ts). La foto se hace con
 * el lugar entero (modelos en la escena y compilados), no a medio llegar; la primera, con la pantalla
 * de carga aún puesta.
 */
function Environment({ ambience, profile, probe, sky }: { ambience: Ambience; profile: LightProfile; probe: boolean; sky: THREE.Texture | null }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const base = sky ?? null;
  const room = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const tex = pmrem.fromScene(new RoomEnvironment(), 0.04, 0.1, 100, { size: ENV_SIZE }).texture;
    pmrem.dispose();
    return tex;
  }, [gl]);
  useEffect(() => () => room.dispose(), [room]);

  const cube = useMemo(() => {
    if (!probe) return null;
    const rt = new THREE.WebGLCubeRenderTarget(ENV_SIZE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const cam = new THREE.CubeCamera(0.5, 320, rt);
    cam.position.set(CENTER.x, 2.2, CENTER.z + 4);
    return { rt, cam };
  }, [probe]);
  useEffect(() => () => cube?.rt.dispose(), [cube]);

  // Pide una foto nueva de la plaza cuando cambian sus entidades o el ambiente.
  const dirty = useRef(true);
  const lastVersion = useRef(-1);
  const wait = useRef(1.2);
  const age = useRef(0);
  /** La foto que se enseña es de esta sonda (si no, el entorno es el de base). */
  const shot = useRef<object | null>(null);
  const hold = useRef<(() => void) | null>(null);
  // El entorno de base, ya al montar (antes de que se compile nada) y mientras no haya foto.
  useLayoutEffect(() => {
    if (!cube || shot.current !== cube) scene.environment = base ?? room;
  }, [scene, base, room, cube]);
  useEffect(() => {
    dirty.current = true;
    wait.current = 0.8;
    age.current = 0;
    // La pantalla de carga espera a la primera foto: son seis vistas de toda la escena en una imagen.
    if (cube && splashActive()) hold.current ??= warmHold();
    return () => {
      hold.current?.();
      hold.current = null;
    };
  }, [ambience, cube, sky]);

  useFrame((_, dt) => {
    scene.environmentIntensity = cube ? (ambience === "night" ? 0.55 : profile === "daySun" ? 0.6 : 1) : LIGHTING[profile].env;
    if (!cube) {
      shot.current = null;
      scene.environment = base ?? room;
      return;
    }
    // La foto de los reflejos se rehace cuando cambia el lugar (sus entidades), no cada vez que entra
    // o sale alguien: son seis vistas más de toda la escena.
    const v = world.getEntitiesVersion();
    if (v !== lastVersion.current) {
      lastVersion.current = v;
      dirty.current = true;
      age.current = 0;
      wait.current = Math.max(wait.current, 1);
    }
    if (!dirty.current) return;
    wait.current -= dt;
    age.current += dt;
    if (wait.current > 0) return;
    // Con el lugar entero: sus modelos en la escena y todo compilado (si no, la foto saldría sin
    // ellos, o esperando a cada shader). Tiene su plazo.
    if (!(world.walkable && warmSettled()) && age.current < PHOTO_WAIT_S) return;
    dirty.current = false;
    // La foto se hace con el entorno base (cielo o estudio), no con la propia foto.
    scene.environment = base ?? room;
    cube.cam.update(gl, scene);
    cube.rt.texture.needsPMREMUpdate = true;
    scene.environment = cube.rt.texture;
    shot.current = cube;
    hold.current?.();
    hold.current = null;
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* Entrada, VR y rendimiento                                            */
/* ------------------------------------------------------------------ */

/** Lo que se dedica a subir texturas en cada imagen mientras está la pantalla de carga (ms). */
const SPLASH_UPLOAD_MS = 24;

/** Reloj de los materiales animados (agua), anisotropía máxima de la GPU y subida de texturas. */
function MaterialClock() {
  const gl = useThree((s) => s.gl);
  useEffect(() => setMaxAnisotropy(gl.capabilities.getMaxAnisotropy()), [gl]);
  // Las texturas recién cargadas suben a la gráfica aquí, de una en una (world/warm.ts).
  useEffect(() => {
    setWarmRenderer(gl as unknown as WarmRenderer);
    return () => setWarmRenderer(null);
  }, [gl]);
  useFrame((s) => {
    tickMaterials(s.clock.elapsedTime);
    // Con la pantalla de carga puesta nadie nota una imagen larga: suben más deprisa.
    tickWarm(undefined, splashActive() ? SPLASH_UPLOAD_MS : UPLOAD_BUDGET_MS);
  });
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

/**
 * ¿Se está descargando algo (modelos, texturas)? Se cuenta en el gestor de cargas de Three.js, por
 * el que pasan todos los cargadores.
 */
const loading = { pending: 0, last: -1e9, hooked: false };
function hookLoading() {
  if (loading.hooked) return;
  loading.hooked = true;
  const m = THREE.DefaultLoadingManager;
  const start = m.itemStart, end = m.itemEnd;
  m.itemStart = function (this: THREE.LoadingManager, url: string) {
    loading.pending++;
    start.call(this, url);
  };
  // Acabe bien o mal, cada carga termina aquí.
  m.itemEnd = function (this: THREE.LoadingManager, url: string) {
    loading.pending = Math.max(0, loading.pending - 1);
    loading.last = performance.now();
    end.call(this, url);
  };
}

/**
 * Si el equipo no aguanta el nivel, un escalón menos (solo en automático: graphics.decline). Lo que
 * cuenta como «no aguanta» está en perf.ts; aquí, cuándo no hay que medir: al cambiar de lugar, de
 * nivel o de ambiente, mientras se descarga algo y con la pestaña escondida.
 */
function FpsGuard() {
  const watch = useMemo(() => new FpsWatch(), []);
  const seen = useRef({ place: "", tier: "", ambience: "" });
  useEffect(() => {
    hookLoading();
    const hidden = () => watch.rest(performance.now(), LOADED_MS);
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [watch]);
  useFrame(() => {
    const now = performance.now();
    const k = seen.current;
    const place = world.chunkId, tier = graphics.tier, ambience = graphics.ambience;
    if (place !== k.place || tier !== k.tier || ambience !== k.ambience) {
      k.place = place;
      k.tier = tier;
      k.ambience = ambience;
      watch.rest(now);
    }
    // «Cargando» es también lo que aún se prepara para verse (shaders compilando, texturas subiendo).
    const busy = splashActive() || loading.pending > 0 || now - loading.last < LOADED_MS || warmBusy();
    if (watch.frame(now, busy)) graphics.decline();
  });
  return null;
}

/** Lo que se espera sin novedades (descargas, cambios del lugar) antes del repaso: lo que tarda en montarse lo recién llegado (ms). */
const PASS_CALM_MS = 300;

/**
 * El repaso general (world/warm.ts): al llegar a un lugar, y al cambiar de nivel o de ambiente,
 * cuando todo ha acabado de llegar (su foto, sus descargas y sus modelos, ya preparados) se compila
 * lo que quede en la escena sin compilar, se vea o no. Hasta entonces el lugar no está preparado.
 */
function WarmPass({ post }: { post: boolean }) {
  const seen = useRef({ place: "", tier: "", ambience: "", post: false, version: -1, changed: 0 });
  useEffect(() => {
    hookLoading();
    return dropPass;
  }, []);
  useFrame(({ gl, scene, camera }) => {
    if (gl.xr.isPresenting) return;
    const now = performance.now();
    const k = seen.current;
    const place = world.chunkId, tier = graphics.tier, ambience = graphics.ambience, version = world.getEntitiesVersion();
    if (place !== k.place || tier !== k.tier || ambience !== k.ambience || post !== k.post) {
      k.place = place;
      k.tier = tier;
      k.ambience = ambience;
      k.post = post;
      requestPass();
    }
    // Cada cambio del lugar (su foto al llegar, sobre todo) trae cosas que montar: se espera a que pasen.
    if (version !== k.version) {
      k.version = version;
      k.changed = now;
    }
    if (!passDue(now) || !world.walkable || !placeMounted.current || loading.pending > 0 || now - loading.last < PASS_CALM_MS || now - k.changed < PASS_CALM_MS) return;
    runPass(gl as unknown as WarmRenderer, scene, camera, post);
  });
  return null;
}

/**
 * Mientras esté montado no se dibuja nada (el lienzo se queda como estaba). Sin dibujar tampoco se
 * ponen al día las matrices del mundo (lo hace el renderizador): se hace aquí, para quien las lea.
 */
function Hold() {
  useFrame(({ scene, camera }) => {
    scene.updateMatrixWorld();
    if (camera.parent === null) camera.updateMatrixWorld();
  }, 1);
  return null;
}

/** Lo más que se espera sin dibujar al post-proceso (ms): si su módulo no llega, se dibuja sin él. */
const EFFECTS_WAIT_MS = 6000;

/**
 * Con post-proceso, hasta que llega su módulo (se descarga aparte): sin esto, esas primeras imágenes
 * se pintaban directamente en el lienzo, que es otra variante de cada shader, y todo lo que se veía
 * se compilaba dos veces (esperando: en Windows, ~0,3 s cada material con luces).
 */
function HoldForEffects() {
  const [hold, setHold] = useState(true);
  useEffect(() => {
    const done = warmHold();
    const id = setTimeout(() => {
      done();
      setHold(false);
    }, EFFECTS_WAIT_MS);
    return () => {
      clearTimeout(id);
      done();
    };
  }, []);
  return hold ? <Hold /> : null;
}

/**
 * Con la pantalla de carga puesta no se dibuja hasta que el lugar está preparado (su foto, sus
 * modelos y el repaso general: world/warm.ts). Nadie ve esas imágenes, y dibujarlas es compilar cada
 * shader esperando, uno tras otro y con la página congelada (y, antes de la foto del lugar, para unas
 * luces que no son las suyas); sin dibujar, la gráfica los compila todos a la vez y nadie espera. La
 * pantalla de carga tiene su plazo (splash.ts): pase lo que pase, al quitarse se dibuja. Mientras
 * dura no se monta el post-proceso (dibuja por su cuenta).
 */
function useSplashHold(): boolean {
  const gl = useThree((s) => s.gl);
  // Solo donde la gráfica compila aparte (KHR_parallel_shader_compile). Sin eso no hay nada que
  // ganar: no dibujar sería dejar para el final lo que se iba compilando mientras llegaban las descargas.
  const [hold, setHold] = useState(() => splashActive() && gl.extensions.has("KHR_parallel_shader_compile"));
  useFrame(() => {
    if (hold && (!splashActive() || gl.xr.isPresenting || (world.walkable && warmPasses() > 0))) setHold(false);
  });
  return hold;
}

/**
 * ¿Está montado lo del lugar (entidades, portales, actividades)? Va dentro de su `Suspense`: mientras
 * algo de ahí espera (la fuente de los carteles, que no pasa por el gestor de cargas), React no monta
 * nada de lo demás, y un repaso general hecho entonces repasaría una escena vacía.
 */
const placeMounted = { current: false };
function PlaceMounted() {
  useLayoutEffect(() => {
    placeMounted.current = true;
    return () => {
      placeMounted.current = false;
    };
  }, []);
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

/**
 * Solo en desarrollo: cuánto dibuja cada frame (llamadas de dibujo y triángulos, sumando las pasadas
 * del post-proceso), para medir el rendimiento desde las pruebas (`globalThis.__xenxoStats`).
 */
function DevStats() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    gl.info.autoReset = false;
    const stats = { calls: 0, triangles: 0, frames: 0, scene, camera: null as THREE.Camera | null };
    (globalThis as { __xenxoStats?: typeof stats }).__xenxoStats = stats;
    return () => void (gl.info.autoReset = true);
  }, [gl, scene]);
  useFrame(({ camera }) => {
    const s = (globalThis as { __xenxoStats?: { calls: number; triangles: number; frames: number; camera: THREE.Camera | null } }).__xenxoStats;
    if (s) {
      s.calls = gl.info.render.calls;
      s.triangles = gl.info.render.triangles;
      s.frames++;
      s.camera = camera;
    }
    gl.info.reset();
  }, -1000);
  return null;
}

/**
 * Quita la pantalla de carga cuando el mundo ya se ve: ha llegado la foto del lugar, no queda
 * nada descargándose (modelos, texturas), lo descargado está preparado (sus shaders compilados y sus
 * texturas subidas: world/warm.ts) y se han dibujado unos cuantos frames seguidos. Mientras, la barra
 * sigue las descargas. Lo que se prepara tiene su plazo, y aquí otro por si acaso (`WARM_WAIT_MS`):
 * la pantalla de carga no se queda puesta por esto.
 */
const SPLASH_FRAMES = 8;
const WARM_WAIT_MS = 8000;
function SplashWatcher() {
  const pending = useRef(0);
  const calm = useRef(0);
  const warmSince = useRef(-1);
  useEffect(() => {
    if (!splashActive()) return;
    splashProgress(0.5);
    const m = THREE.DefaultLoadingManager;
    const prev = { onStart: m.onStart, onProgress: m.onProgress, onLoad: m.onLoad, onError: m.onError };
    const track = (loaded: number, total: number) => {
      pending.current = Math.max(0, total - loaded);
      if (total > 0) splashProgress(0.5 + 0.45 * (loaded / total));
    };
    m.onStart = (_url, loaded, total) => track(loaded, total);
    m.onProgress = (_url, loaded, total) => track(loaded, total);
    m.onLoad = () => {
      pending.current = 0;
    };
    m.onError = () => {};
    return () => {
      Object.assign(m, prev);
    };
  }, []);
  useFrame(() => {
    if (!splashActive()) return;
    const loaded = world.snapshots > 0 && pending.current === 0;
    // Con todo descargado, se espera a que esté preparado (hasta `WARM_WAIT_MS`).
    const now = performance.now();
    if (!loaded || !warmBusy()) warmSince.current = -1;
    else if (warmSince.current < 0) warmSince.current = now;
    const settled = loaded && (warmSince.current < 0 || now - warmSince.current > WARM_WAIT_MS);
    calm.current = settled ? calm.current + 1 : 0;
    if (calm.current >= SPLASH_FRAMES) splashDone();
  });
  return null;
}

function Scene({ active }: { active: boolean }) {
  const g = useGraphics();
  const f = g.features;
  const place = usePlace();
  const inPlaza = place === PLACES.plaza;
  const inNexo = place === PLACES.nexo;
  // Todos los lugares siguen el ambiente elegido (día, noche o la hora): cada distrito tiene su
  // versión de día y de noche. Los distritos usan la luz abierta del nexo.
  const ambience: Ambience = g.ambience;
  const profile: LightProfile = inPlaza ? (ambience === "day" && f.shadows > 0 ? "daySun" : ambience) : ambience === "day" ? "nexoDay" : "nexo";
  // Sombras del sol solo en la plaza (hecha para ellas): en los distritos, de 256 m y con torres de
  // 60 m, el mapa de sombras no da para tanto y el suelo parpadea al andar (acné de sombra).
  const lightFeatures = useMemo(() => (inPlaza ? f : { ...f, shadows: 0 as const }), [inPlaza, f]);
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
  // Con post-proceso la foto del cielo va en su esfera (PhotoSky): como fondo de la escena, el mapeo
  // de tonos del final la apagaba. Sin él (gafas, móviles), el fondo de siempre.
  const skyDome = f.post && !g.inXR;
  const holding = useSplashHold();
  return (
    <>
      <XRWatcher />
      <SplashWatcher />
      {holding && <Hold />}
      <WarmPass post={f.post && !g.inXR} />
      {import.meta.env.DEV && <DevStats />}
      <FpsGuard />
      {daySky && !skyDome ? <primitive key="sky" attach="background" object={daySky.tex} /> : <color key="color" attach="background" args={[sky.fog]} />}
      {daySky && skyDome && <PhotoSky map={daySky.tex} />}
      <fog attach="fog" args={[sky.fog, ambience === "night" ? 45 : 70, ambience === "night" ? 230 : 260]} />
      {!skyReady && <Sky ambience={ambience} top={inNexo ? PANO_TONES[ambience].top : undefined} pano={inNexo} />}
      {inPlaza && <Skyline count={f.skyline} ambience={ambience} pbr={f.pbr} />}
      {inNexo && <NexoBackdrop ambience={ambience} hd={f.textures >= 1024} />}
      {inNexo && <NexoCity ambience={ambience} density={f.nexoCity} features={f} />}
      {!inNexo && !inPlaza && <DistrictSkyline chunk={place} density={f.nexoCity} ambience={ambience} />}
      {!inNexo && !inPlaza && (
        <Suspense fallback={null}>
          {/* Decorado: si un modelo no carga, se queda sin él (nunca tumba la escena). */}
          <SkipOnError>
            <Citizens chunk={place} count={f.pedestrians} />
          </SkipOnError>
          <SkipOnError>
            <Traffic chunk={place} count={f.traffic} features={f} ambience={ambience} />
          </SkipOnError>
          <SkipOnError>
            <Residents chunk={place} count={f.residents} />
          </SkipOnError>
          <SlidingDoors chunk={place} ambience={ambience} bloom={f.bloom} />
          <SkipOnError>
            <Weather chunk={place} rain={f.rain} ambience={ambience} />
          </SkipOnError>
        </Suspense>
      )}
      <Lighting profile={profile} features={lightFeatures} />
      {/* La sonda de reflejos es de la plaza: en los distritos se rehacía al cargar lo cercano al andar y los reflejos del suelo parpadeaban. */}
      <Environment ambience={ambience} profile={profile} probe={inPlaza && f.probe} sky={dayEnv} />
      {/* Los textos cargan su fuente de forma asíncrona: que nunca bloqueen la escena ni el panel. */}
      <Suspense fallback={null}>
        <Entities features={f} ambience={ambience} />
        <Portals features={f} active={active} />
        {!inNexo && <Activities />}
        {!inNexo && <LootChests />}
        <Avatars />
        <PlaceMounted />
      </Suspense>
      <Player active={active} />
      {!inNexo && <PeopleFx />}
      {!inNexo && !inPlaza && <ShotFx />}
      {g.inXR && <VRTeleport />}
      <InputBinder active={active} />
      <PhotoTaker />
      <Recorder fps={f.clipFps} />
      <MaterialClock />
      {f.post && !g.inXR && !holding && (
        <Suspense fallback={<HoldForEffects />}>
          <Effects features={f} ambience={ambience} />
        </Suspense>
      )}
    </>
  );
}

/** El tamaño de la ventana (para encajar el encuadre del modo cine). */
function useWindowSize(): [number, number] {
  const [size, setSize] = useState<[number, number]>([window.innerWidth, window.innerHeight]);
  useEffect(() => {
    const on = () => setSize([window.innerWidth, window.innerHeight]);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return size;
}

export function World({ active, paused = false }: { active: boolean; paused?: boolean }) {
  const g = useGraphics();
  const covered = useCovered();
  const f = g.features;
  // Modo cine con encuadre (9:16, 16:9, 1:1): el canvas toma esa forma, centrado, y se dibuja a
  // tamaño de vídeo (1080p) se vea al tamaño que se vea: así lo que se graba ya es el vídeo.
  const c = useCine();
  const [vw, vh] = useWindowSize();
  const px = c.on && c.frame !== "free" && active && !g.inXR ? FRAME_PX[c.frame] : null;
  // El alto, en píxeles enteros de pantalla; el ancho, el que le toca (puede llevar decimales). El
  // pellizco de más es para que, al redondear hacia abajo, el canvas mida justo 1080 × 1920 (o lo que sea).
  const high = px ? Math.floor(px[1] * Math.min(vw / px[0], vh / px[1])) : 0;
  const box = px ? { width: (high * px[0]) / px[1] + 0.02, height: high } : null;
  // El MSAA del canvas no se puede cambiar en caliente (habría que recrearlo: adiós a lo que hay en
  // la GPU y, en VR, a la sesión). Por eso lo decide el equipo y no el nivel: graphics.canvasAA.
  const aa = g.canvasAA;

  return (
    <Canvas
      key={aa ? "aa" : "plain"}
      className={box ? "!absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 touch-none" : "!absolute inset-0 touch-none"}
      style={box ?? undefined}
      dpr={box && px ? px[1] / box.height + 1e-4 : f.dpr}
      // Sombras PCF (las «suaves» de antes ya no existen en Three.js: pedirlas era un aviso por frame).
      shadows="percentage"
      gl={{ antialias: aa, powerPreference: "high-performance" }}
      // Con un juego abierto encima, o tapado entero por el configurador de fundas, el mundo no se
      // dibuja (la GPU es para lo que se ve).
      frameloop={paused || covered ? "never" : "always"}
      camera={{ fov: 70, near: 0.1, far: 400, position: [32, 14, 66] }}
      // El mapeo de tonos de pintar en el lienzo, antes de que el post-proceso lo quite (world/warm.ts).
      onCreated={({ gl }) => setDirectTone(gl.toneMapping)}
    >
      <XR store={xrStore}>
        <Scene active={active} />
      </XR>
    </Canvas>
  );
}
