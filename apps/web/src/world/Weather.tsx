/**
 * Tiempo de los distritos: lluvia y charcos (de momento, Distrito Cero).
 *
 * - **Cuándo llueve** sale del reloj (`rainLevel`), igual para todo el mundo y sin servidor: de
 *   noche casi siempre, de día a ratos.
 * - **Lluvia**: líneas que caen en el shader dentro de una caja que sigue a la cámara (un solo
 *   draw call, nada por frame en la CPU salvo dos uniformes). Cuántas, lo dice `FEATURES.rain`;
 *   en las gafas, ninguna.
 * - **Charcos**: manchas oscuras con el brillo de los neones y ondas cuando llueve, instanciadas y
 *   pintadas en el shader (sin reflejos de verdad): baratas, en todos los niveles.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import districts from "../../../realtime/src/districts.json";
import { ambient } from "./ambient-audio";
import { ceilingHeight } from "./collision";
import { playerPos } from "./Player";
import type { Ambience } from "./graphics";

type City = { x0: number; z0: number; block: number; street: number };
const CITY = (districts as unknown as { city: City }).city;
const BY_CHUNK = new Map((districts.districts as { id: string; chunk: string }[]).map((d) => [d.chunk, d.id]));

/** ¿Hay techo encima del jugador (dentro de un edificio, bajo la pasarela)? Se mira 4 veces por segundo. */
const shelter = { under: false };
function checkShelter() {
  shelter.under = ceilingHeight(playerPos.x, playerPos.z, 0.1, playerPos.y + 1.9) < playerPos.y + 40;
}

/** Lugares donde llueve. */
const RAINY = new Set(["cero"]);

/** Altura de los charcos: por encima de las capas del suelo (0,072 m) y de los charcos de luz (0,09). */
const PUDDLE_Y = 0.105;
/** Caja de la lluvia alrededor de la cámara (m). */
const BOX = new THREE.Vector3(46, 26, 46);
const RAIN_NIGHT = new THREE.Color("#a9c4e8");
const RAIN_DAY = new THREE.Color("#d9e2ee");

/**
 * Cuánto llueve ahora (0–1). Ciclo de 20 min: de noche llueve 14 min con fuerza; de día, 8 min y
 * más flojo. Entradas y salidas suaves (un minuto).
 */
export function rainLevel(now: number, ambience: Ambience): number {
  const cycle = 20 * 60_000;
  const t = (now % cycle) / 60_000; // minutos dentro del ciclo
  const len = ambience === "night" ? 14 : 8;
  const peak = ambience === "night" ? 1 : 0.55;
  if (t >= len) return 0;
  const ramp = Math.min(1, t, len - t);
  return peak * ramp;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Charcos: en las calles de dentro de la ciudad y en la plaza (lejos de la peana de la torre). */
function puddlesFor(id: string): { x: number; z: number; sx: number; sz: number; rot: number }[] {
  const r = rng(id.length * 104729 + 17);
  const out: { x: number; z: number; sx: number; sz: number; rot: number }[] = [];
  const { x0, z0, block, street } = CITY;
  const span0 = z0 + 3, span1 = z0 + 3 * block + 2 * street - 3;
  const centers = [x0 + block + street / 2, x0 + 2 * block + 1.5 * street];
  for (const c of centers) {
    for (let s = span0; s < span1; s += 8 + r() * 6) {
      const off = (r() - 0.5) * (street - 4);
      const sx = 1.2 + r() * 2.2, sz = 0.8 + r() * 1.4, rot = r() * Math.PI;
      out.push({ x: c + off, z: s, sx, sz, rot }); // calle norte-sur
      out.push({ x: s + 2.5, z: c - off, sx: sz * 1.3, sz: sx * 0.8, rot: rot + 1 }); // calle este-oeste
    }
  }
  const px0 = x0 + block + street, px1 = px0 + block;
  for (let k = 0; k < 10; k++) {
    const x = px0 + 1.5 + r() * (block - 3), z = px0 + 1.5 + r() * (px1 - px0 - 3);
    if (Math.hypot(x - 32, z - 32) < 8.5) continue;
    out.push({ x, z, sx: 1 + r() * 1.6, sz: 0.7 + r() * 1.2, rot: r() * Math.PI });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Charcos                                                              */
/* ------------------------------------------------------------------ */

const puddleGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

function puddleMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uRain: { value: 0 },
        uNight: { value: 1 },
      },
    ]),
    vertexShader: /* glsl */ `
      attribute float aSeed;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vSeed;
      #include <fog_pars_vertex>
      void main() {
        vUv = position.xz;
        vSeed = aSeed;
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uRain;
      uniform float uNight;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vSeed;
      #include <fog_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float a = atan(vUv.y, vUv.x);
        float r = length(vUv) * (1.0 + 0.13 * sin(3.0 * a + vSeed * 6.28) + 0.07 * sin(7.0 * a + vSeed * 3.1));
        float edge = smoothstep(1.0, 0.72, r);
        if (edge <= 0.0) discard;
        // Reflejo fingido: el cielo y franjas de neón que se mueven con la vista (no hay reflejos de verdad).
        vec3 sky = mix(vec3(0.42, 0.5, 0.6), vec3(0.03, 0.05, 0.1), uNight);
        vec3 base = mix(vec3(0.16, 0.18, 0.22), vec3(0.01, 0.015, 0.03), uNight);
        vec3 toCam = normalize(cameraPosition - vWorld);
        float band = vWorld.x * 0.31 + vWorld.z * 0.23 + toCam.x * 2.0 + toCam.z * 1.4;
        float cyan = pow(0.5 + 0.5 * sin(band + vSeed * 5.0), 16.0);
        float mag = pow(0.5 + 0.5 * sin(band * 1.7 + 2.0 + vSeed * 3.0), 20.0);
        vec3 neon = (vec3(0.21, 0.85, 1.0) * cyan + vec3(1.0, 0.31, 0.85) * mag) * mix(0.1, 0.4, uNight);
        float fres = pow(1.0 - clamp(toCam.y, 0.0, 1.0), 2.0);
        vec3 col = base + sky * (0.25 + 0.6 * fres) + neon;
        // Ondas: tres gotas por charco que van cayendo en sitios distintos.
        float rip = 0.0;
        for (int k = 0; k < 3; k++) {
          float fk = float(k);
          float ph = uTime * (0.9 + 0.2 * fk) + vSeed * 7.0 + fk * 0.33;
          float id = floor(ph);
          float f = fract(ph);
          vec2 c = vec2(hash(vec2(id, vSeed + fk)), hash(vec2(vSeed - fk, id))) * 1.1 - 0.55;
          float d = length(vUv - c);
          rip += exp(-pow((d - f * 0.55) * 28.0, 2.0)) * (1.0 - f);
        }
        col += vec3(0.6, 0.75, 0.9) * rip * uRain * 0.35;
        gl_FragColor = vec4(col, edge * mix(0.7, 0.85, uNight));
        #include <fog_fragment>
      }
    `,
  });
}

function Puddles({ id, ambience }: { id: string; ambience: Ambience }) {
  const list = useMemo(() => puddlesFor(id), [id]);
  const mat = useMemo(() => puddleMaterial(), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(puddleGeo, mat, list.length);
    const seeds = new Float32Array(list.length);
    const o = new THREE.Object3D();
    list.forEach((q, n) => {
      o.position.set(q.x, PUDDLE_Y, q.z);
      o.rotation.set(0, q.rot, 0);
      o.scale.set(q.sx, 1, q.sz);
      o.updateMatrix();
      m.setMatrixAt(n, o.matrix);
      seeds[n] = (n * 0.618) % 1;
    });
    m.geometry = puddleGeo.clone();
    m.geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    m.frustumCulled = false;
    m.renderOrder = 1;
    return m;
  }, [list, mat]);
  useEffect(() => () => mesh.geometry.dispose(), [mesh]);
  useFrame((state) => {
    mat.uniforms.uTime!.value = state.clock.elapsedTime;
    mat.uniforms.uRain!.value = rainLevel(Date.now(), ambience);
    mat.uniforms.uNight!.value = ambience === "night" ? 1 : 0;
  });
  return <primitive object={mesh} />;
}

/* ------------------------------------------------------------------ */
/* Lluvia                                                               */
/* ------------------------------------------------------------------ */

function rainGeometry(count: number) {
  const g = new THREE.BufferGeometry();
  const seed = new Float32Array(count * 2 * 4);
  const end = new Float32Array(count * 2);
  const r = rng(count);
  for (let n = 0; n < count; n++) {
    const s = [r(), r(), r(), r()];
    for (let v = 0; v < 2; v++) {
      seed.set(s, (n * 2 + v) * 4);
      end[n * 2 + v] = v;
    }
  }
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
  g.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
  return g;
}

function rainMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: BOX },
      uRain: { value: 0 },
      uColor: { value: RAIN_NIGHT.clone() },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      attribute float aEnd;
      uniform float uTime;
      uniform vec3 uCam;
      uniform vec3 uBox;
      uniform float uRain;
      varying float vA;
      void main() {
        // Cuántas caen depende de cuánto llueve: las que sobran se quedan sin tamaño.
        float on = step(aSeed.w, uRain);
        vec3 p = aSeed.xyz * uBox;
        p.y -= uTime * (15.0 + aSeed.w * 5.0);
        p.x -= uTime * 1.2;
        vec3 origin = uCam - uBox * vec3(0.5, 0.35, 0.5);
        p = origin + mod(p - origin, uBox);
        p.y = max(p.y, 0.0);
        p += vec3(0.05, 0.75, 0.0) * aEnd * on;
        vA = (0.18 + 0.22 * aEnd) * on;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() { gl_FragColor = vec4(uColor, vA); }
    `,
  });
}

function Rain({ count, ambience }: { count: number; ambience: Ambience }) {
  const geo = useMemo(() => rainGeometry(count), [count]);
  const mat = useMemo(() => rainMaterial(), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((state) => {
    mat.uniforms.uTime!.value = state.clock.elapsedTime;
    (mat.uniforms.uCam!.value as THREE.Vector3).copy(state.camera.position);
    // Bajo techo no llueve (las gotas atravesarían el edificio).
    mat.uniforms.uRain!.value = shelter.under ? 0 : rainLevel(Date.now(), ambience);
    (mat.uniforms.uColor!.value as THREE.Color).copy(ambience === "night" ? RAIN_NIGHT : RAIN_DAY);
  });
  return <lineSegments geometry={geo} material={mat} frustumCulled={false} renderOrder={3} />;
}

/* ------------------------------------------------------------------ */

export function Weather({ chunk, rain, ambience }: { chunk: string; rain: number; ambience: Ambience }) {
  const id = BY_CHUNK.get(chunk);
  const rainy = !!id && RAINY.has(id);
  // El sonido de la lluvia: unas veces por segundo (no por frame).
  const amb = useRef(ambience);
  amb.current = ambience;
  useEffect(() => {
    if (!rainy) {
      ambient.setRain(0);
      return;
    }
    const tick = () => {
      checkShelter();
      // Dentro, la lluvia se oye amortiguada.
      ambient.setRain(rainLevel(Date.now(), amb.current) * (shelter.under ? 0.35 : 1));
    };
    tick();
    const t = setInterval(tick, 250);
    return () => {
      clearInterval(t);
      ambient.setRain(0);
    };
  }, [rainy]);
  if (!rainy || !id) return null;
  return (
    <>
      <Puddles id={id} ambience={ambience} />
      {rain > 0 && <Rain count={rain} ambience={ambience} />}
    </>
  );
}
