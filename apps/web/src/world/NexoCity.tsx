/**
 * La megaciudad del nexo, en 3D: la plataforma flota sobre una ciudad de verdad. Abajo, manzanas
 * de torres con sus calles y su tráfico; entre medias, coches voladores en sus carriles (por debajo
 * de la plataforma y de las islas, y a lo lejos entre los rascacielos); y alrededor, megatorres que
 * suben por encima del horizonte. Debajo de la plataforma, su casco con anillos de luz.
 *
 * Decorado del cliente (no son datos del mundo: no se visita ni se construye) y pensado para la
 * Quest: cuatro draw calls en total, todo instanciado, sin texturas (ventanas, calles y luces salen
 * del shader) y sin trabajo por frame en la CPU (los coches se mueven en el shader con el reloj).
 * Cuánta ciudad se dibuja lo dice `FEATURES.nexoCity`. De día y de noche con el mismo mundo.
 */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CHUNK_SIZE } from "@xenxo/protocol";
import type { Ambience } from "./graphics";
import { SKY } from "./Sky";

const C = CHUNK_SIZE / 2;
/** Suelo de la ciudad de abajo (la plataforma está en y = 0). */
const GROUND = -110;
/** Paso de la cuadrícula de calles y ancho de la calzada (m). */
const PITCH = 40;
const ROAD = 12;
/** Hasta dónde llega la ciudad desde el centro (la cámara ve hasta 400 m). */
const EXTENT = 300;

/* ------------------------------------------------------------------ */
/* Uniformes compartidos (un reloj y el ambiente para todo)            */
/* ------------------------------------------------------------------ */

const shared = {
  uTime: { value: 0 },
  uNight: { value: 1 },
  uHaze: { value: new THREE.Color(SKY.night.fog) },
  uDensity: { value: 0.0042 },
};

/** Generador con semilla: la misma ciudad para todos. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HAZE = /* glsl */ `
  uniform vec3 uHaze; uniform float uDensity; uniform float uNight;
  vec3 haze(vec3 col, vec3 w) {
    float h = 1.0 - exp(-distance(w, cameraPosition) * uDensity);
    // Bruma del abismo: lo más hondo se pierde en ella.
    float mist = smoothstep(-55.0, -125.0, w.y) * mix(0.28, 0.65, uNight);
    return mix(col, uHaze, clamp(max(h, mist), 0.0, 1.0));
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const OUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/* ------------------------------------------------------------------ */
/* Edificios: torres de la ciudad de abajo y megatorres                 */
/* ------------------------------------------------------------------ */

/** kind: 0 = torre con ventanas, 1 = panel de neón (anuncio sin letras), 2 = baliza que parpadea. */
export interface Box {
  x: number;
  y0: number;
  z: number;
  w: number;
  h: number;
  d: number;
  tint: string;
  kind: 0 | 1 | 2;
}

const FACADE_DAY = ["#5f7d99", "#7b93a8", "#4f6b85", "#8fa5b5", "#6a8597", "#a3b2bd", "#3f5a73", "#8a8f99"];
export const NEON = ["#36d9ff", "#ff4fd8", "#a26bff", "#ff4f8b", "#4fa3ff", "#6dffd8"];

function cityBoxes(density: number): Box[] {
  const r = rng(4242);
  const out: Box[] = [];
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]!;
  const n = Math.ceil(EXTENT / PITCH);
  // Manzanas: de una a tres torres por manzana, más altas lejos del centro (se ven desde arriba).
  for (let i = -n; i < n; i++) {
    for (let j = -n; j < n; j++) {
      const bx = C + i * PITCH + ROAD / 2;
      const bz = C + j * PITCH + ROAD / 2;
      const block = PITCH - ROAD;
      const dist = Math.hypot(bx + block / 2 - C, bz + block / 2 - C);
      if (dist > EXTENT) continue;
      if (r() > density) continue;
      if (r() < 0.08) continue; // alguna plaza vacía
      const towers = 1 + Math.floor(r() * 3);
      for (let k = 0; k < towers; k++) {
        const w = 7 + r() * (block / towers - 8);
        const d = 8 + r() * (block - 10);
        const x = bx + (block / towers) * k + w / 2 + 0.6;
        const z = bz + d / 2 + r() * (block - d - 1);
        const far = Math.min(1, dist / 220);
        // Por debajo del aire de los coches voladores (y > −50): no se cruzan con ellos ni con las islas.
        const h = 18 + r() * (25 + far * 25);
        const top = Math.min(GROUND + h, -52 - r() * 8);
        out.push({ x, y0: GROUND, z, w, h: top - GROUND, d, tint: pick(FACADE_DAY), kind: 0 });
        // Anuncios de neón en una cara y balizas en las azoteas.
        if (r() < 0.35) {
          const ph = 6 + r() * 10;
          const py = GROUND + (top - GROUND) * (0.45 + r() * 0.4) - ph / 2;
          const side = r() < 0.5 ? -1 : 1;
          out.push({ x: x + side * (w / 2 + 0.15), y0: py, z, w: 0.25, h: ph, d: Math.min(d * 0.6, 6), tint: pick(NEON), kind: 1 });
        }
        if (r() < 0.3) out.push({ x, y0: top, z, w: 0.6, h: 1.2, d: 0.6, tint: "#ff3b3b", kind: 2 });
      }
    }
  }
  // Megatorres: nacen abajo y suben por encima del horizonte, alrededor (detrás de las islas).
  const megas = Math.round(34 * density);
  for (let m = 0; m < megas; m++) {
    const a = (m / megas) * Math.PI * 2 + r() * 0.12;
    // Fuera de los carriles de los coches (el más lejano va a 220 m).
    const dist = 252 + r() * 38;
    const x = C + Math.cos(a) * dist;
    const z = C + Math.sin(a) * dist;
    const w = 14 + r() * 14;
    const d = 14 + r() * 14;
    const top = 25 + Math.pow(r(), 1.4) * 140;
    const tint = pick(FACADE_DAY);
    const neon = pick(NEON);
    const mid = GROUND + (top - GROUND) * (0.62 + r() * 0.15);
    out.push({ x, y0: GROUND, z, w, h: mid - GROUND, d, tint, kind: 0 });
    // Retranqueo arriba, con su franja de luz, y una aguja con baliza.
    out.push({ x, y0: mid, z, w: w * 0.7, h: top - mid, d: d * 0.7, tint, kind: 0 });
    out.push({ x, y0: mid - 1.2, z, w: w + 0.4, h: 1.2, d: d + 0.4, tint: neon, kind: 1 });
    out.push({ x, y0: top - 2, z, w: w * 0.72, h: 0.8, d: d * 0.72, tint: neon, kind: 1 });
    if (r() < 0.6) {
      const sh = 10 + r() * 25;
      out.push({ x, y0: top, z, w: 1.2, h: sh, d: 1.2, tint: "#c8d2de", kind: 0 });
      out.push({ x, y0: top + sh, z, w: 0.9, h: 1.4, d: 0.9, tint: "#ff3b3b", kind: 2 });
    }
    if (r() < 0.7) {
      const ph = 18 + r() * 22;
      out.push({ x: x + (w / 2 + 0.2) * (r() < 0.5 ? -1 : 1), y0: mid - 8 - ph, z, w: 0.3, h: ph, d: d * 0.55, tint: neon, kind: 1 });
    }
  }
  return out;
}

const BUILDING_VS = /* glsl */ `
  attribute vec3 aTint;
  attribute vec2 aInfo;
  varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying vec2 vInfo;
  void main() {
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normal;
    vTint = aTint;
    vInfo = aInfo;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const BUILDING_FS = /* glsl */ `
  uniform float uTime;
  varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying vec2 vInfo;
  ${HAZE}
  void main() {
    vec3 n = normalize(vN);
    float kind = vInfo.y;
    float sun = 0.58 + 0.42 * max(dot(n, normalize(vec3(0.45, 0.8, 0.3))), 0.0);
    vec3 col;
    if (kind > 1.5) {
      float blink = step(0.55, fract(uTime * 0.6 + vInfo.x));
      col = vTint * mix(0.8, 0.6 + 2.2 * blink, uNight);
    } else if (kind > 0.5) {
      float v = fract(vW.y * 0.06 - uTime * 0.12 + vInfo.x);
      col = vTint * mix(0.75, 1.25, uNight) * (0.8 + 0.2 * sin(v * 6.2831));
    } else if (n.y > 0.5) {
      col = mix(vTint * 0.55 * sun, vec3(0.025, 0.028, 0.045), uNight);
    } else {
      // Ventanas: una rejilla por planta en la cara que toca; de lejos, su media (sin parpadeos).
      vec2 uv = abs(n.x) > 0.5 ? vec2(vW.z, vW.y) : vec2(vW.x, vW.y);
      vec2 cell = uv / vec2(3.2, 3.6);
      vec2 id = floor(cell);
      vec2 f = fract(cell);
      float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.2, f.y) * step(f.y, 0.82);
      float fw = max(fwidth(cell.x), fwidth(cell.y));
      float detail = 1.0 - smoothstep(0.2, 0.65, fw);
      float lit = step(hash(id + vInfo.x * 37.0 + n.xz * 13.0), 0.3);
      vec3 warm = mix(vec3(1.0, 0.72, 0.4), vec3(0.5, 0.8, 1.0), step(0.72, hash(id * 1.7 + vInfo.x)));
      float sky = clamp((vW.y - ${GROUND.toFixed(1)}) / 260.0, 0.0, 1.0);
      vec3 glass = mix(vec3(0.08, 0.13, 0.22), vec3(0.36, 0.5, 0.66), sky);
      vec3 day = mix(vTint * sun, glass * sun, mix(0.55, win, detail));
      vec3 night = mix(vTint * 0.045 + vec3(0.015, 0.016, 0.03), warm * 1.05, mix(0.3 * 0.54, win * lit, detail));
      col = mix(day, night, uNight);
    }
    gl_FragColor = vec4(haze(col, vW), 1.0);
    ${OUT}
  }`;

function Buildings({ density }: { density: number }) {
  const boxes = useMemo(() => cityBoxes(density), [density]);
  return <CityBoxes boxes={boxes} />;
}

/** Cajas de la ciudad en un solo draw call (también las usa el horizonte de los distritos). */
export function CityBoxes({ boxes }: { boxes: Box[] }) {
  const mesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const tint = new Float32Array(boxes.length * 3);
    const info = new Float32Array(boxes.length * 2);
    const col = new THREE.Color();
    const m = new THREE.InstancedMesh(
      geo,
      new THREE.ShaderMaterial({ uniforms: shared, vertexShader: BUILDING_VS, fragmentShader: BUILDING_FS }),
      boxes.length,
    );
    const o = new THREE.Object3D();
    boxes.forEach((b, i) => {
      o.position.set(b.x, b.y0, b.z);
      o.scale.set(b.w, Math.max(0.1, b.h), b.d);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      col.set(b.tint);
      tint.set([col.r, col.g, col.b], i * 3);
      info.set([(i * 0.61803) % 1, b.kind], i * 2);
    });
    geo.setAttribute("aTint", new THREE.InstancedBufferAttribute(tint, 3));
    geo.setAttribute("aInfo", new THREE.InstancedBufferAttribute(info, 2));
    m.frustumCulled = false;
    return m;
  }, [boxes]);
  useEffect(() => () => disposeMesh(mesh), [mesh]);
  return <primitive object={mesh} />;
}

/* ------------------------------------------------------------------ */
/* Suelo: calles con sus líneas y farolas, manzanas                     */
/* ------------------------------------------------------------------ */

const GROUND_FS = /* glsl */ `
  varying vec3 vW;
  ${HAZE}
  void main() {
    vec2 g = mod(vW.xz - vec2(${(C - ROAD / 2).toFixed(1)}), ${PITCH.toFixed(1)});
    // Calzada: los primeros ${ROAD} m de cada paso, en X o en Z.
    float rx = step(g.x, ${ROAD.toFixed(1)});
    float rz = step(g.y, ${ROAD.toFixed(1)});
    float road = max(rx, rz);
    // Línea central discontinua y luz de las farolas en los bordes.
    float cx = rx * (1.0 - rz) * step(abs(g.x - ${(ROAD / 2).toFixed(1)}), 0.18) * step(0.5, fract(vW.z / 6.0));
    float cz = rz * (1.0 - rx) * step(abs(g.y - ${(ROAD / 2).toFixed(1)}), 0.18) * step(0.5, fract(vW.x / 6.0));
    float line = max(cx, cz);
    vec2 lp = vec2(min(g.x, ${ROAD.toFixed(1)} - g.x), min(g.y, ${ROAD.toFixed(1)} - g.y));
    float lampX = rx * smoothstep(2.2, 0.0, length(vec2(lp.x, mod(vW.z, 14.0) - 7.0)));
    float lampZ = rz * smoothstep(2.2, 0.0, length(vec2(lp.y, mod(vW.x, 14.0) - 7.0)));
    float lamp = max(lampX, lampZ);
    // De día, manzanas con algo de verde (parques y patios) y calzada oscura.
    float park = step(0.72, hash(floor((vW.xz - vec2(${(C - ROAD / 2).toFixed(1)})) / ${PITCH.toFixed(1)})));
    vec3 block = mix(vec3(0.3, 0.33, 0.37), vec3(0.2, 0.34, 0.22), park);
    vec3 day = mix(block, vec3(0.1, 0.11, 0.13), road) + line * vec3(0.5, 0.45, 0.2);
    vec3 night = mix(vec3(0.02, 0.022, 0.035), vec3(0.035, 0.03, 0.05), road) + line * vec3(0.5, 0.4, 0.15) + lamp * vec3(1.0, 0.62, 0.28) * 0.9;
    gl_FragColor = vec4(haze(mix(day, night, uNight), vW), 1.0);
    ${OUT}
  }`;

function Ground() {
  return <CityGround y={GROUND} size={EXTENT * 2.2} />;
}

/** Suelo de calles con farolas (también el de alrededor de los distritos). */
export function CityGround({ y, size }: { y: number; size: number }) {
  const mesh = useMemo(() => {
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    geo.translate(C, y, C);
    const m = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: shared,
        vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: GROUND_FS,
      }),
    );
    m.frustumCulled = false;
    return m;
  }, [y, size]);
  useEffect(() => () => disposeMesh(mesh), [mesh]);
  return <primitive object={mesh} />;
}

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

function cars(density: number): Car[] {
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
  // A lo lejos, entre las megatorres.
  ring(190, 22, 14, 28);
  ring(220, 46, 12, -30);
  // Autopistas aéreas rectas que cruzan la ciudad, en los dos sentidos.
  const line = (angle: number, offset: number, y: number, n: number, speed: number, glow?: string) => {
    const count = Math.max(2, Math.round(n * density));
    // Acaban antes de las megatorres; en los extremos aparecen y se van entre la bruma.
    const len = 470;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const x0 = C - dx * len / 2 - dz * offset, z0 = C - dz * len / 2 + dx * offset;
    for (let i = 0; i < count; i++) {
      out.push({ a: [x0, z0, y, len], b: [speed, (i / count) * len + r() * 8, angle, 1], glow: glow ?? NEON[Math.floor(r() * NEON.length)]! });
    }
  };
  for (const [ang, off, y] of [[0.3, 60, -40], [1.9, -40, -46], [3.6, 90, -33], [5.0, -110, -50]] as const) {
    line(ang, off, y, 12, 26);
    line(ang + Math.PI, -off - 6, y + 3, 12, 24);
  }
  // Coches de la calle, por las avenidas de abajo (solo se ven sus luces).
  for (let k = -3; k <= 3; k++) {
    const off = k * PITCH * 2;
    line(0, off + 3, GROUND + 0.5, 10, 14, "#ffd27a");
    line(Math.PI, -off + 3, GROUND + 0.5, 10, 14, "#ff3b3b");
    line(Math.PI / 2, -off - 3, GROUND + 0.5, 10, 14, "#ffd27a");
    line(-Math.PI / 2, off - 3, GROUND + 0.5, 10, 14, "#ff3b3b");
  }
  return out;
}

const CAR_VS = /* glsl */ `
  uniform float uTime;
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
    // De lejos crecen un poco: que se sigan viendo como puntos de luz.
    float s = clamp(distance(pos, cameraPosition) / 80.0, 1.0, 2.4);
    vec3 lp = position * vec3(1.4, 0.7, 3.6) * s;
    vec3 w = vec3(lp.x * dir.y + lp.z * dir.x, lp.y, -lp.x * dir.x + lp.z * dir.y) + pos;
    vL = position; vW = w; vGlow = aGlow;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;

const CAR_FS = /* glsl */ `
  varying vec3 vL; varying vec3 vW; varying vec3 vGlow; varying float vFade;
  ${HAZE}
  void main() {
    vec3 body = mix(vec3(0.5, 0.55, 0.62), vec3(0.03, 0.035, 0.05), uNight);
    vec3 col = body;
    if (vL.z > 0.42) col = vec3(1.0, 0.95, 0.85) * mix(1.0, 1.6, uNight);
    else if (vL.z < -0.42) col = vec3(1.0, 0.12, 0.15) * mix(0.9, 1.5, uNight);
    else if (vL.y < -0.42) col = vGlow * mix(0.7, 1.4, uNight);
    else if (abs(vL.y) < 0.08) col = vGlow * mix(0.5, 1.1, uNight);
    gl_FragColor = vec4(mix(uHaze, haze(col, vW), vFade), 1.0);
    ${OUT}
  }`;

function Traffic({ density }: { density: number }) {
  const list = useMemo(() => cars(density), [density]);
  return <CarsMesh list={list} />;
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

/* ------------------------------------------------------------------ */
/* Abismo: por debajo del horizonte, más allá de la ciudad, solo bruma  */
/* ------------------------------------------------------------------ */

const ABYSS_FS = /* glsl */ `
  uniform vec3 uHaze;
  varying vec3 vDir;
  void main() {
    // Por encima del horizonte, transparente (cielo y panorámica); por debajo, la bruma.
    float a = smoothstep(0.02, -0.06, normalize(vDir).y);
    gl_FragColor = vec4(uHaze, a);
    ${OUT}
  }`;

function Abyss() {
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(360, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: shared,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: ABYSS_FS,
      }),
    );
    m.frustumCulled = false;
    // Antes que la panorámica (−1) y que todo lo demás.
    m.renderOrder = -2;
    return m;
  }, []);
  useFrame(({ camera }) => mesh.position.copy(camera.position));
  useEffect(() => () => disposeMesh(mesh), [mesh]);
  return <primitive object={mesh} />;
}

function disposeMesh(m: THREE.Mesh | THREE.InstancedMesh) {
  m.geometry.dispose();
  (m.material as THREE.Material).dispose();
}

/** Reloj y ambiente: lo único que cambia por frame (dos números, sin objetos nuevos). */
export function CityClock({ ambience }: { ambience: Ambience }) {
  useEffect(() => {
    const night = ambience === "night";
    shared.uNight.value = night ? 1 : 0;
    // De día, la bruma azulada del horizonte de la panorámica (más clara y menos densa que la de noche).
    shared.uHaze.value.set(night ? SKY.night.fog : "#bcd0e2");
    shared.uDensity.value = night ? 0.0042 : 0.0017;
  }, [ambience]);
  useFrame((_, dt) => {
    // Con un tope: al volver de otra pestaña los coches no dan un salto enorme.
    shared.uTime.value = (shared.uTime.value + Math.min(dt, 0.1)) % 3600;
  });
  return null;
}

export function NexoCity({ ambience, density }: { ambience: Ambience; density: number }) {
  if (density <= 0) return null;
  return (
    <>
      <CityClock ambience={ambience} />
      <Abyss />
      <Ground />
      <Buildings density={density} />
      <Traffic density={density} />
      <Hull />
    </>
  );
}
