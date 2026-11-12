/**
 * La megaciudad del nexo, en 3D: la plataforma flota sobre una ciudad de verdad que llega al
 * horizonte. Los edificios, el suelo y el horizonte están en NexoSkyline.tsx; aquí, lo que se
 * mueve (coches voladores en sus carriles, por debajo de la plataforma y de las islas y a lo lejos
 * por las avenidas, entre las megatorres; y los coches de las calles de abajo), el casco bajo la
 * plataforma, con sus anillos de luz, y lo que comparte con la ciudad de alrededor de cada
 * distrito (DistrictSkyline.tsx): los coches de luz y el reloj.
 *
 * Decorado del cliente (no son datos del mundo: no se visita ni se construye) y pensado para la
 * Quest: pocos draw calls, todo instanciado, sin texturas en la ciudad (ventanas, calles y luces
 * salen del shader) y sin trabajo por frame en la CPU (los coches se mueven en el shader con el
 * reloj). Los coches voladores de cerca son el modelo de los distritos (life_car), simplificado al
 * cargar según `FEATURES.flyerTris`. Cuánta ciudad se dibuja lo dice `FEATURES.nexoCity`. De día y
 * de noche. El aire (reloj, ambiente y bruma) es el de city-air.ts.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { MeshoptSimplifier } from "meshoptimizer";
import { CHUNK_SIZE } from "@xenxo/protocol";
import { SEED_ASSETS } from "../../../realtime/src/seed-assets";
import { assetUrl } from "../config";
import type { Ambience, Features } from "./graphics";
import { AIR_GLSL, OUT_GLSL, air, NEON, rng, setAir, tickAir, type AirLook } from "./city-air";
import { SkipOnError } from "./Entities";
import { lightweight, paintedLights } from "./materials";
import { GROUND, NexoSkyline, PITCH, ROAD, SUPER } from "./NexoSkyline";

export { NEON, rng };

const C = CHUNK_SIZE / 2;

const shared = air;
const HAZE = AIR_GLSL;
const OUT = OUT_GLSL;

/* ------------------------------------------------------------------ */
/* Tráfico: coches voladores y coches de la calle                       */
/* ------------------------------------------------------------------ */

export interface Car {
  /** Círculo: (cx, cz, radio, y). Recta: (x0, z0, y, largo). */
  a: [number, number, number, number];
  /** Círculo: (vel. angular, fase, 0, 0). Recta: (vel., fase, ángulo, 1). */
  b: [number, number, number, number];
  glow: string;
}

/** Coches voladores de cerca: anillos bajo la plataforma y las islas, alrededor, y autopistas aéreas rectas. */
function flyers(density: number): Car[] {
  const r = rng(77);
  const out: Car[] = [];
  const ring = (radius: number, y: number, n: number, speed: number) => {
    const count = Math.max(2, Math.round(n * density));
    const omega = speed / radius;
    for (let i = 0; i < count; i++) {
      const glow = NEON[Math.floor(r() * NEON.length)]!;
      out.push({ a: [C, C, radius + (r() - 0.5) * 1.6, y + (r() - 0.5) * 1.2], b: [omega, (i / count) * Math.PI * 2 + r() * 0.2, 0, 0], glow });
    }
  };
  // Justo bajo la plataforma (entre ella y las islas) y, más hondo, bajo las islas.
  ring(28, -6.5, 10, 16);
  ring(32, -9, 10, -14);
  ring(56, -21, 14, 20);
  ring(82, -27, 16, -22);
  ring(120, -36, 18, 24);
  ring(170, -24, 16, -26);
  // Alrededor, entre el paseo de fuera y las primeras megatorres.
  ring(190, 22, 14, 28);
  ring(220, 46, 12, -30);
  // Autopistas aéreas rectas que cruzan por debajo, en los dos sentidos.
  for (const [ang, off, y] of [[0.3, 60, -40], [1.9, -40, -46], [3.6, 90, -33], [5.0, -110, -50]] as const) {
    straight(out, r, ang, off, y, 12 * density, 26);
    straight(out, r, ang + Math.PI, -off - 6, y + 3, 12 * density, 24);
  }
  return out;
}

/**
 * El tráfico de las avenidas, a lo lejos: coches de luz entre las megatorres, a varias alturas y
 * en los dos sentidos. Por las avenidas (cada 120 m), que son los pasillos que dejan las torres.
 */
function avenueCars(density: number): Car[] {
  const r = rng(79);
  const out: Car[] = [];
  const levels = [-58, -28, 34, 78, 128, 190];
  for (let k = -6; k <= 6; k++) {
    // Lejos del nexo (de cerca se ve que son solo luces): de la tercera avenida hacia fuera.
    if (Math.abs(k) < 3) continue;
    const reach = 1320;
    const n = 10 * density;
    for (let axis = 0; axis < 2; axis++) {
      const angle = axis * (Math.PI / 2);
      const y1 = levels[Math.floor(r() * 6)]! + r() * 8;
      const y2 = levels[Math.floor(r() * 6)]! + r() * 8;
      straight(out, r, angle, k * SUPER + 5, y1, n, 46 + r() * 22, undefined, reach * 2);
      straight(out, r, angle + Math.PI, -k * SUPER + 5, y2, n, 46 + r() * 22, undefined, reach * 2);
    }
  }
  return out;
}

/** Coches de la calle, por las avenidas de abajo (solo se ven sus luces). */
function streetCars(density: number): Car[] {
  const r = rng(78);
  const out: Car[] = [];
  for (let k = -3; k <= 3; k++) {
    const off = k * PITCH * 2;
    straight(out, r, 0, off + 3, GROUND + 0.5, 10 * density, 14, "#ffd27a");
    straight(out, r, Math.PI, -off + 3, GROUND + 0.5, 10 * density, 14, "#ff3b3b");
    straight(out, r, Math.PI / 2, -off - 3, GROUND + 0.5, 10 * density, 14, "#ffd27a");
    straight(out, r, -Math.PI / 2, off - 3, GROUND + 0.5, 10 * density, 14, "#ff3b3b");
  }
  return out;
}

/** Una recta de `len` m centrada en el nexo: en los extremos los coches aparecen y se van entre la bruma. */
function straight(out: Car[], r: () => number, angle: number, offset: number, y: number, n: number, speed: number, glow?: string, len = 470) {
  const count = Math.max(2, Math.round(n));
  const dx = Math.cos(angle), dz = Math.sin(angle);
  const x0 = C - dx * len / 2 - dz * offset, z0 = C - dz * len / 2 + dx * offset;
  for (let i = 0; i < count; i++) {
    out.push({ a: [x0, z0, y, len], b: [speed, (i / count) * len + r() * 8, angle, 1], glow: glow ?? NEON[Math.floor(r() * NEON.length)]! });
  }
}

const CAR_VS = /* glsl */ `
  uniform float uTime; uniform float uNight; uniform float uNexo;
  attribute vec4 aA; attribute vec4 aB; attribute vec3 aGlow;
  varying vec3 vL; varying vec3 vW; varying vec3 vGlow; varying float vFade;
  void main() {
    vec3 pos; vec2 dir;
    vFade = 1.0;
    if (aB.w < 0.5) {
      float a = aB.y + uTime * aB.x;
      pos = vec3(aA.x + cos(a) * aA.z, aA.w, aA.y + sin(a) * aA.z);
      dir = vec2(-sin(a), cos(a)) * sign(aB.x);
    } else {
      float t = mod(aB.y + uTime * aB.x, aA.w);
      dir = vec2(cos(aB.z), sin(aB.z));
      pos = vec3(aA.x + dir.x * t, aA.z, aA.y + dir.y * t);
      vFade = smoothstep(0.0, 40.0, t) * smoothstep(aA.w, aA.w - 40.0, t);
    }
    // De lejos crecen un poco: que se sigan viendo como puntos de luz (en el nexo, de día, menos:
    // son coches entre torres, no luces).
    float s = clamp(distance(pos, cameraPosition) / 80.0, 1.0, mix(2.4, mix(1.5, 2.0, uNight), uNexo));
    vec3 lp = position * vec3(1.4, 0.7, 3.6) * s;
    vec3 w = vec3(lp.x * dir.y + lp.z * dir.x, lp.y, -lp.x * dir.x + lp.z * dir.y) + pos;
    vL = position; vW = w; vGlow = aGlow;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;

const CAR_FS = /* glsl */ `
  varying vec3 vL; varying vec3 vW; varying vec3 vGlow; varying float vFade;
  ${HAZE}
  void main() {
    vec3 body = mix(mix(vec3(0.5, 0.55, 0.62), vec3(0.2, 0.22, 0.26), uNexo), vec3(0.03, 0.035, 0.05), uNight);
    vec3 col = body;
    if (vL.z > 0.42) col = vec3(1.0, 0.95, 0.85) * mix(1.0, 1.6, uNight);
    else if (vL.z < -0.42) col = vec3(1.0, 0.12, 0.15) * mix(0.9, 1.5, uNight);
    else if (vL.y < -0.42) col = vGlow * mix(0.7, 1.4, uNight);
    else if (abs(vL.y) < 0.08) col = vGlow * mix(0.5, 1.1, uNight);
    gl_FragColor = vec4(mix(airTone(vW), haze(col, vW), vFade), 1.0);
    ${OUT}
  }`;

function Traffic({ density, features, ambience }: { density: number; features: Features; ambience: Ambience }) {
  const lights = useMemo(() => [...streetCars(density), ...avenueCars(density)], [density]);
  const air = useMemo(() => flyers(density), [density]);
  return (
    <>
      <CarsMesh list={lights} />
      <Suspense fallback={null}>
        <SkipOnError>
          <Flyers list={air} features={features} ambience={ambience} />
        </SkipOnError>
      </Suspense>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Coches voladores: el modelo de los distritos, movido en el shader    */
/* ------------------------------------------------------------------ */

/** La misma ruta que los coches de luz (círculo o recta), con su giro y su balanceo. */
const FLYER_HEAD = /* glsl */ `
  uniform float uTime;
  attribute vec4 aA; attribute vec4 aB;
  varying vec3 vFlyW; varying float vFade;
  void flyer(out vec3 pos, out vec2 dir, out float roll) {
    vFade = 1.0;
    if (aB.w < 0.5) {
      float a = aB.y + uTime * aB.x;
      pos = vec3(aA.x + cos(a) * aA.z, aA.w, aA.y + sin(a) * aA.z);
      dir = vec2(-sin(a), cos(a)) * sign(aB.x);
      // Se inclina hacia dentro de la curva.
      roll = -0.14 * sign(aB.x);
    } else {
      float t = mod(aB.y + uTime * aB.x, aA.w);
      dir = vec2(cos(aB.z), sin(aB.z));
      pos = vec3(aA.x + dir.x * t, aA.z, aA.y + dir.y * t);
      vFade = smoothstep(0.0, 40.0, t) * smoothstep(aA.w, aA.w - 40.0, t);
      roll = 0.0;
    }
    pos.y += sin(uTime * 0.8 + aB.y * 7.0) * 0.25;
  }
  // El frente del modelo mira a +Z: primero el balanceo (sobre su eje) y luego hacia donde va.
  vec3 turn(vec3 p, vec2 dir, float roll) {
    float c = cos(roll), s = sin(roll);
    p = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
    return vec3(p.x * dir.y + p.z * dir.x, p.y, -p.x * dir.x + p.z * dir.y);
  }
`;

/** Lo que sustituye al mapeo de tonos de three en el coche: el mismo mapeo y, con él, su aire. */
const FLYER_AIR = /* glsl */ `
  {
    vec3 c = gl_FragColor.rgb;
    #ifdef TONE_MAPPING
      c = toneMapping(c);
    #else
      if (xenxoLinearOut()) c = xenxoAces(c);
    #endif
    c = mix(airTone(vFlyW), airShown(c, vFlyW), vFade);
    #ifndef TONE_MAPPING
      c = xenxoShown(c);
    #endif
    gl_FragColor.rgb = c;
  }
`;

/** Baja el modelo a `tris` triángulos (una vez al cargar; la textura sigue igual). */
async function simplified(geo: THREE.BufferGeometry, tris: number): Promise<THREE.BufferGeometry> {
  const index = geo.index;
  if (!index || index.count / 3 <= tris) return geo;
  await MeshoptSimplifier.ready;
  const pos = geo.getAttribute("position");
  const p = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) p.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3);
  const [out] = MeshoptSimplifier.simplify(new Uint32Array(index.array), p, 3, tris * 3, 0.08);
  const g = geo.clone();
  g.setIndex(new THREE.BufferAttribute(out, 1));
  return g;
}

function Flyers({ list, features, ambience }: { list: Car[]; features: Features; ambience: Ambience }) {
  const entry = SEED_ASSETS.life_car!;
  const last = entry.lods.length - 1;
  // El nivel ligero basta si se va a simplificar por debajo de él.
  const lod = entry.lods[features.flyerTris >= entry.lods[last]!.tris ? 0 : last]!;
  const gltf = useGLTF(assetUrl(lod.hash), false, true);
  const src = useMemo(() => {
    let found: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
    });
    return found as THREE.Mesh | null;
  }, [gltf]);
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    void simplified(src.geometry, features.flyerTris)
      .then((g) => alive && setGeo(g))
      .catch(() => alive && setGeo(src.geometry));
    return () => {
      alive = false;
    };
  }, [src, features.flyerTris]);

  const material = useMemo(() => {
    if (!src) return null;
    const base = src.material as THREE.Material;
    const lit = paintedLights(features.pbr ? base : lightweight(base), ambience);
    const m = lit.clone() as THREE.MeshStandardMaterial;
    // Su bruma es la de la ciudad (la de la escena no sabe de direcciones ni de alturas).
    m.fog = false;
    const prev = lit.onBeforeCompile;
    const prevKey = lit.customProgramCacheKey.bind(lit);
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(lit, shader, renderer);
      Object.assign(shader.uniforms, shared);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${FLYER_HEAD}`)
        .replace(
          "#include <beginnormal_vertex>",
          "#include <beginnormal_vertex>\nvec3 fPos; vec2 fDir; float fRoll; flyer(fPos, fDir, fRoll);\nobjectNormal = turn(objectNormal, fDir, fRoll);",
        )
        .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = turn(transformed, fDir, fRoll) + fPos;\nvFlyW = transformed;");
      // Su aire va donde el mapeo de tonos (antes de pasar al espacio de color de salida: después,
      // el color ya no es lineal y la mezcla con el tono del aire saldría más oscura).
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vFlyW; varying float vFade;\n${HAZE}`)
        .replace("#include <tonemapping_fragment>", FLYER_AIR);
    };
    m.customProgramCacheKey = () => `nexo-flyer|${prevKey()}`;
    return m;
  }, [src, features.pbr, ambience]);

  const mesh = useMemo(() => {
    if (!geo || !material) return null;
    const g = new THREE.InstancedBufferGeometry().copy(geo as THREE.InstancedBufferGeometry);
    const a = new Float32Array(list.length * 4);
    const b = new Float32Array(list.length * 4);
    list.forEach((c, i) => {
      a.set(c.a, i * 4);
      b.set(c.b, i * 4);
    });
    g.setAttribute("aA", new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute("aB", new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = list.length;
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false;
    return m;
  }, [geo, material, list]);
  useEffect(() => () => mesh?.geometry.dispose(), [mesh]);
  useEffect(() => () => material?.dispose(), [material]);
  return mesh ? <primitive object={mesh} /> : null;
}

/** Coches (voladores o de calle) movidos en el shader; un draw call. */
export function CarsMesh({ list }: { list: Car[] }) {
  const mesh = useMemo(() => {
    const geo = new THREE.InstancedBufferGeometry();
    const box = new THREE.BoxGeometry(1, 1, 1);
    geo.index = box.index;
    geo.setAttribute("position", box.getAttribute("position"));
    geo.setAttribute("normal", box.getAttribute("normal"));
    const a = new Float32Array(list.length * 4);
    const b = new Float32Array(list.length * 4);
    const g = new Float32Array(list.length * 3);
    const col = new THREE.Color();
    list.forEach((c, i) => {
      a.set(c.a, i * 4);
      b.set(c.b, i * 4);
      col.set(c.glow);
      g.set([col.r, col.g, col.b], i * 3);
    });
    geo.setAttribute("aA", new THREE.InstancedBufferAttribute(a, 4));
    geo.setAttribute("aB", new THREE.InstancedBufferAttribute(b, 4));
    geo.setAttribute("aGlow", new THREE.InstancedBufferAttribute(g, 3));
    geo.instanceCount = list.length;
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: shared, vertexShader: CAR_VS, fragmentShader: CAR_FS }));
    m.frustumCulled = false;
    return m;
  }, [list]);
  useEffect(() => () => disposeMesh(mesh), [mesh]);
  return <primitive object={mesh} />;
}

/* ------------------------------------------------------------------ */
/* Casco bajo la plataforma: la plataforma flota sobre algo             */
/* ------------------------------------------------------------------ */

const HULL_FS = /* glsl */ `
  uniform float uTime;
  varying vec3 vW; varying vec3 vN;
  ${HAZE}
  void main() {
    vec3 n = normalize(vN);
    float a = atan(vW.z - ${C.toFixed(1)}, vW.x - ${C.toFixed(1)});
    // Paneles: costuras verticales y anillos de luz que bajan despacio.
    float seam = step(0.96, fract(a * 48.0 / 6.2831));
    float ringY = fract((-vW.y + uTime * 0.6) / 7.0);
    float ring = smoothstep(0.0, 0.04, ringY) * smoothstep(0.1, 0.06, ringY);
    float tip = smoothstep(-26.0, -36.0, vW.y);
    float sun = 0.55 + 0.45 * max(dot(n, normalize(vec3(0.45, 0.8, 0.3))), 0.0);
    vec3 day = vec3(0.48, 0.52, 0.58) * sun * (1.0 - 0.35 * seam);
    vec3 night = vec3(0.03, 0.035, 0.055) * (1.0 - 0.5 * seam);
    vec3 col = mix(day, night, uNight);
    col += vec3(0.21, 0.85, 1.0) * ring * mix(0.5, 1.2, uNight);
    col += mix(vec3(0.64, 0.42, 1.0), vec3(0.21, 0.85, 1.0), tip) * tip * mix(0.6, 1.6, uNight);
    gl_FragColor = vec4(haze(col, vW), 1.0);
    ${OUT}
  }`;

function Hull() {
  const mesh = useMemo(() => {
    const profile = [
      [0.01, -40],
      [2.2, -35],
      [4.5, -28],
      [8, -20],
      [12.5, -12],
      [18, -6],
      [22.5, -2.2],
      [23.9, -0.62],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const geo = new THREE.LatheGeometry(profile, 48);
    geo.translate(C, 0, C);
    const m = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: shared,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `varying vec3 vW; varying vec3 vN; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: HULL_FS,
      }),
    );
    m.frustumCulled = false;
    return m;
  }, []);
  useEffect(() => () => disposeMesh(mesh), [mesh]);
  return <primitive object={mesh} />;
}

function disposeMesh(m: THREE.Mesh | THREE.InstancedMesh) {
  m.geometry.dispose();
  (m.material as THREE.Material).dispose();
}

/**
 * Reloj y ambiente de la ciudad: lo único que cambia por frame (un número, sin objetos nuevos).
 * `nexo`: el aire de la megaciudad (city-air.ts); `sky`: la foto del cielo de día, cuando llega;
 * `post`: se pinta con post-proceso; `look`: lo que el lugar le pide a su aire.
 */
export function CityClock({ ambience, nexo = false, sky = null, post = false, look }: { ambience: Ambience; nexo?: boolean; sky?: THREE.Texture | null; post?: boolean; look?: AirLook }) {
  // Antes de que se dibuje nada con él (en un efecto corriente podría colarse una imagen con el
  // aire del lugar anterior).
  useLayoutEffect(() => setAir(nexo, ambience, sky, post, look), [ambience, nexo, sky, post, look]);
  useFrame((_, dt) => tickAir(dt));
  return null;
}

/** `sky`: la foto del cielo de día (World.tsx), para que el cristal la refleje y el aire tome su horizonte. */
export function NexoCity({ ambience, density, features, sky }: { ambience: Ambience; density: number; features: Features; sky: THREE.Texture | null }) {
  if (density <= 0) return null;
  return (
    <>
      <CityClock ambience={ambience} nexo sky={sky} />
      <NexoSkyline density={density} rich={features.post} />
      <Traffic density={density} features={features} ambience={ambience} />
      <Hull />
    </>
  );
}
