/**
 * Fondo del nexo: una megaciudad cyberpunk alrededor y por debajo de la plataforma flotante
 * (torres con ventanas, franjas de neón y carteles holográficos) y, en el cielo, un planeta con
 * anillos y su luna. Decorado del cliente, no datos del mundo: no se visita ni se construye.
 *
 * Pocas llamadas de dibujo (todo instanciado) y nada de luces: apto para Quest. El número de
 * torres sale del nivel gráfico (FEATURES.skyline).
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CHUNK_SIZE } from "@xenxo/protocol";
import type { Ambience } from "./graphics";

/** Generador pseudoaleatorio con semilla: la misma ciudad para todos. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ventanas de neón (de noche) dibujadas en un canvas: nada se descarga. */
function windowsTexture(day: boolean) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = day ? "#ffffff" : "#000000";
  g.fillRect(0, 0, 64, 256);
  const r = rng(day ? 31 : 13);
  const night = ["#7fd3ff", "#ff7ad9", "#ffd27a", "#9b8cff"];
  for (let y = 3; y < 252; y += 6) {
    for (let x = 3; x < 61; x += 6) {
      const on = r();
      if (day) {
        g.fillStyle = on < 0.5 ? "#33405a" : "#55617d";
        g.fillRect(x, y, 4, 3);
      } else if (on < 0.32) {
        g.fillStyle = night[Math.floor(r() * night.length)]!;
        g.fillRect(x, y, 4, 3);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** Degradado vertical para los carteles holográficos (más intenso abajo). */
function holoTexture() {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0.15)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 64);
  for (let y = 0; y < 64; y += 4) {
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, y, 8, 1);
  }
  return new THREE.CanvasTexture(c);
}

const NEON = ["#38d9ff", "#ff4fd8", "#9b5cff", "#4fa3ff", "#ffd54f", "#6dff8a"];
const MAX_TOWERS = 220;
const CENTER = CHUNK_SIZE / 2;

/* ------------------------------------------------------------------ */
/* Megaciudad                                                           */
/* ------------------------------------------------------------------ */

function City({ count, night }: { count: number; night: boolean }) {
  const towers = useRef<THREE.InstancedMesh>(null);
  const strips = useRef<THREE.InstancedMesh>(null);
  const holos = useRef<THREE.InstancedMesh>(null);
  const nightTex = useMemo(() => windowsTexture(false), []);
  const dayTex = useMemo(() => windowsTexture(true), []);
  const holoTex = useMemo(holoTexture, []);

  // Una sola vez: dónde va cada torre, sus franjas y sus carteles (misma semilla para todos).
  const layout = useMemo(() => {
    const r = rng(4242);
    const list: { x: number; z: number; w: number; d: number; top: number; rot: number }[] = [];
    for (let i = 0; i < MAX_TOWERS; i++) {
      const a = r() * Math.PI * 2;
      // Cerca hay hueco (las islas de los distritos); la ciudad empieza más allá.
      const dist = 108 + Math.pow(r(), 0.8) * 120;
      const w = 7 + r() * 12;
      const x = CENTER + Math.cos(a) * dist, z = CENTER + Math.sin(a) * dist;
      list.push({
        x,
        z,
        w,
        d: w * (0.6 + r() * 0.7),
        // Unas asoman por encima de la plataforma y otras se quedan por debajo: flotamos entre ellas.
        top: -40 + Math.pow(r(), 1.6) * 115,
        // Cada torre da una cara al nexo (la ciudad se ordena alrededor).
        rot: Math.atan2(CENTER - x, CENTER - z),
      });
    }
    return list;
  }, []);

  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    const r = rng(77);
    const BASE = -160;
    const t = towers.current, s = strips.current, h = holos.current;
    if (!t || !s || !h) return;
    let si = 0, hi = 0;
    for (let i = 0; i < MAX_TOWERS; i++) {
      const q = layout[i]!;
      const height = q.top - BASE;
      o.position.set(q.x, BASE + height / 2, q.z);
      o.rotation.set(0, q.rot, 0);
      o.scale.set(q.w, height, q.d);
      o.updateMatrix();
      t.setMatrixAt(i, o.matrix);
      t.setColorAt(i, col.setHSL(0.62 + r() * 0.12, 0.25, 0.55 + r() * 0.2));
      // Franjas de neón verticales en una esquina, y un anillo cerca de lo alto.
      const c = NEON[Math.floor(r() * NEON.length)]!;
      const cs = Math.cos(q.rot), sn = Math.sin(q.rot);
      if (r() < 0.5) {
        const len = Math.min(height, 12 + r() * 26);
        const ex = (q.w / 2) * cs + (q.d / 2) * sn, ez = -(q.w / 2) * sn + (q.d / 2) * cs;
        o.position.set(q.x + ex, q.top - len / 2 - 1, q.z + ez);
        o.rotation.set(0, q.rot, 0);
        o.scale.set(0.3, len, 0.3);
        o.updateMatrix();
        s.setMatrixAt(si, o.matrix);
        s.setColorAt(si++, col.set(c));
      }
      if (r() < 0.55) {
        o.position.set(q.x, q.top - 2 - r() * 10, q.z);
        o.scale.set(q.w + 0.3, 0.45, q.d + 0.3);
        o.updateMatrix();
        s.setMatrixAt(si, o.matrix);
        s.setColorAt(si++, col.set(NEON[Math.floor(r() * NEON.length)]!));
      }
      // Algunos carteles holográficos en la cara que mira al nexo.
      if (r() < 0.22 && hi < 48) {
        const face = q.rot;
        const bw = Math.min(q.w * 0.8, 5 + r() * 7), bh = 8 + r() * 12;
        o.position.set(q.x + Math.sin(face) * (q.d / 2 + 0.3), q.top - bh / 2 - 3 - r() * 15, q.z + Math.cos(face) * (q.d / 2 + 0.3));
        o.rotation.set(0, face, 0);
        o.scale.set(bw, bh, 1);
        o.updateMatrix();
        h.setMatrixAt(hi, o.matrix);
        h.setColorAt(hi++, col.set(NEON[Math.floor(r() * NEON.length)]!));
      }
    }
    s.count = si;
    h.count = hi;
    for (const m of [t, s, h]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [layout]);

  useLayoutEffect(() => {
    if (towers.current) towers.current.count = Math.min(count, MAX_TOWERS);
  }, [count]);

  return (
    <>
      <instancedMesh ref={towers} args={[undefined, undefined, MAX_TOWERS]} frustumCulled={false}>
        <boxGeometry />
        <meshLambertMaterial
          key={night ? "n" : "d"}
          color={night ? "#1a1f36" : "#c9d2e6"}
          map={night ? null : dayTex}
          emissive="#ffffff"
          emissiveMap={nightTex}
          emissiveIntensity={night ? 1.3 : 0}
        />
      </instancedMesh>
      <instancedMesh ref={strips} args={[undefined, undefined, MAX_TOWERS * 2]} frustumCulled={false}>
        <boxGeometry />
        <meshBasicMaterial toneMapped={false} transparent opacity={night ? 1 : 0.55} />
      </instancedMesh>
      <instancedMesh ref={holos} args={[undefined, undefined, 48]} frustumCulled={false}>
        <planeGeometry />
        <meshBasicMaterial map={holoTex} transparent opacity={night ? 0.75 : 0.35} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </instancedMesh>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Espacio: planeta con anillos y luna                                  */
/* ------------------------------------------------------------------ */

const planetMaterial = () =>
  new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    uniforms: { day: { value: 0 }, time: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vP; varying vec3 vView;
      void main() {
        vN = normalize(normalMatrix * normal);
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float day; uniform float time;
      varying vec3 vN; varying vec3 vP; varying vec3 vView;
      void main() {
        float lat = normalize(vP).y;
        // Bandas de gas violetas y cian, con un remolino que se mueve despacio.
        float b = sin(lat * 18.0 + sin(lat * 7.0 + time * 0.03) * 1.5);
        vec3 c = mix(vec3(0.22, 0.10, 0.42), vec3(0.15, 0.55, 0.75), 0.5 + 0.5 * b);
        c = mix(c, vec3(0.9, 0.35, 0.7), smoothstep(0.85, 1.0, b) * 0.4);
        // Luz de un sol lejano y borde de atmósfera.
        float lit = clamp(dot(vN, normalize(vec3(-0.6, 0.4, 0.7))), 0.0, 1.0);
        float rim = pow(1.0 - clamp(dot(vN, vView), 0.0, 1.0), 3.0);
        vec3 col = c * (0.25 + 0.9 * lit) + vec3(0.4, 0.8, 1.0) * rim * 0.9;
        gl_FragColor = vec4(col, mix(1.0, 0.55, day));
      }`,
  });

const ringMaterial = () =>
  new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { day: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float day; varying vec3 vP;
      void main() {
        float r = length(vP.xy);
        float t = (r - 95.0) / 60.0;
        float bands = 0.55 + 0.45 * sin(t * 60.0) * sin(t * 13.0 + 1.0);
        float a = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.85, t) * bands;
        vec3 c = mix(vec3(0.75, 0.6, 1.0), vec3(0.4, 0.9, 1.0), t);
        gl_FragColor = vec4(c, a * mix(0.75, 0.35, day));
      }`,
  });

function Space({ night }: { night: boolean }) {
  const planet = useMemo(planetMaterial, []);
  const ring = useMemo(ringMaterial, []);
  useLayoutEffect(() => {
    planet.uniforms.day!.value = night ? 0 : 1;
    ring.uniforms.day!.value = night ? 0 : 1;
  }, [night, planet, ring]);
  useFrame((_, dt) => {
    planet.uniforms.time!.value += dt;
  });
  // Lejos (dentro de la esfera del cielo, a 300 m) y sin niebla.
  return (
    <group position={[CENTER - 150, 95, CENTER - 210]} rotation={[0.35, 0.6, 0.25]}>
      <mesh material={planet} renderOrder={-1}>
        <sphereGeometry args={[62, 48, 32]} />
      </mesh>
      <mesh material={ring} rotation={[Math.PI / 2 - 0.25, 0, 0]} renderOrder={0}>
        <ringGeometry args={[95, 155, 96, 1]} />
      </mesh>
      <mesh position={[190, -40, 60]}>
        <sphereGeometry args={[11, 24, 16]} />
        <meshBasicMaterial color={night ? "#b9c4e6" : "#f2f4fa"} fog={false} transparent opacity={night ? 1 : 0.7} />
      </mesh>
    </group>
  );
}

export function NexoBackdrop({ count, ambience }: { count: number; ambience: Ambience }) {
  const night = ambience === "night";
  return (
    <>
      <City count={count} night={night} />
      <Space night={night} />
    </>
  );
}
