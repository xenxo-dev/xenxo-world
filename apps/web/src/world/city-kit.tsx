/**
 * Las piezas de las ciudades de decorado: con ellas se hacen la megaciudad del nexo
 * (NexoSkyline.tsx) y la ciudad de alrededor de cada distrito (DistrictSkyline.tsx).
 *
 * Una ciudad es una lista de piezas (`Part`: cajas y cilindros, rectos o afilados, cada una con su
 * tinte, su neón y la semilla de su edificio) que se dibujan instanciadas, de cerca a lejos, con un
 * solo material: dos llamadas de dibujo para todos los edificios. Sin texturas propias: fachadas,
 * ventanas, azoteas, calles y luces salen del shader; lo único que se lee es la foto del cielo de
 * día, que el cristal refleja. Con ellas van su suelo (calles con farolas hasta el horizonte), las
 * sombras de los edificios (de día), el horizonte (donde acaba el suelo, el aire) y hasta dónde ve
 * la cámara.
 *
 * Decorado del cliente (no son datos del mundo: no se visita ni se construye; sin colisión) y hecho
 * para la Quest. Los colores son «como se ven» (display.ts) y el aire es el de city-air.ts: cada
 * torre se pierde en el color que tiene el cielo detrás de ella.
 */
import { useEffect, useLayoutEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CHUNK_SIZE } from "@xenxo/protocol";
import { AIR_GLSL, air } from "./city-air";

const C = CHUNK_SIZE / 2;
/** Paso de la cuadrícula de calles y ancho de la calzada (m). */
export const PITCH = 40;
export const ROAD = 12;
/** Una avenida cada tres manzanas (una pasa por el centro del lugar). */
export const SUPER = PITCH * 3;

/* ------------------------------------------------------------------ */
/* Las piezas                                                           */
/* ------------------------------------------------------------------ */

/**
 * kind: 0 = cuerpo con fachada, 1 = baliza que parpadea, 2 = metal (agujas, antenas, discos). Y, para
 * las ciudades con tema (alrededor de los distritos; cada una compila solo los que usa, `KINDS`):
 * 3 = mate (pintura, chapa lisa, teja, copas de árbol), 4 = luminoso sin letras (`glow` = su segundo
 * color; igual que `tint`, liso), 5 = vóxeles, 6 = casa o módulo (muro pintado con ventanas; `glow` =
 * sus contraventanas), 7 = chimenea (bandas de `glow` arriba), 8 = roca a estratos (`glow` = lo de
 * encima), 9 = nave de chapa (`glow` = su luz) y 10 = pila de caravanas vista de lejos.
 */
export interface Part {
  x: number;
  /** Base. */
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  yaw?: number;
  /** Cuánto mide arriba respecto a abajo (1 = recto). Negativo: a dos aguas (solo estrecha a lo ancho). */
  taper?: number;
  /** Su fachada, si no es la que le toque: 0 muro cortina, 1 lamas, 2 ventanas en un muro, 3 monolito de vidrio. */
  face?: 0 | 1 | 2 | 3;
  kind?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  round?: boolean;
  /** Tinte del cristal o del revestimiento. */
  tint: number;
  /** Su neón: cantos, coronas y pantallas. */
  glow: number;
  /** El mismo para todas las piezas de un edificio: su fachada. */
  seed: number;
  /** Da sombra en el suelo (los edificios de las calles, que se ven desde arriba). */
  shadow?: boolean;
}

export type Rand = () => number;
export const pick = <T,>(r: Rand, a: readonly T[]) => a[Math.floor(r() * a.length)]!;

/** Cristales: plata azulada, azul, verde agua, bronce, humo, acero y lavanda. */
export const GLASS = [0xc4dcf2, 0x92c4f0, 0x86d8e0, 0xe6cfa2, 0x9aa8d8, 0xd6e4f0, 0x74b2e6, 0xb2bcf0, 0xa8d4f2, 0x9cd0e8] as const;
/** Edificios de las calles: además de cristal, piedra clara, hormigón y ladrillo. */
export const STREET = [0xc3d6e8, 0x9cc0e0, 0xd8d2c4, 0xb9b4aa, 0x8d9db3, 0xd3dade, 0xc9a78c, 0xe4e0d6, 0x7daace, 0xa7adb5] as const;
/** Neones (los de xenxo), con más cian, magenta y violeta que el resto. */
export const GLOW = [0x36d9ff, 0x36d9ff, 0xff4fd8, 0xff4fd8, 0xa26bff, 0xa26bff, 0x4fa3ff, 0x6dffd8, 0xff4f8b] as const;
export const RED = 0xff3b3b;

/** Ruido suave con semilla (para que las torres altas vayan en grupos, como en una ciudad). */
export function valueNoise(seed: number) {
  const h = (i: number, j: number) => {
    let n = (Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ seed) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, z: number) => {
    const i = Math.floor(x), j = Math.floor(z);
    const fx = x - i, fz = z - j;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
}

/** Aguja con su baliza. */
export function spire(out: Part[], x: number, y: number, z: number, w: number, h: number, base: Pick<Part, "tint" | "glow" | "seed">) {
  out.push({ ...base, x, y: y - 1, z, w, h: h + 1, d: w, taper: 0.18, kind: 2 });
  out.push({ ...base, x, y: y + h, z, w: 1.5, h: 1.5, d: 1.5, kind: 1, tint: RED });
}

/** Dos o tres agujas finas de distinta altura en una azotea de `w` × `d` (sin baliza). */
export function spikes(out: Part[], r: Rand, x: number, y: number, z: number, w: number, d: number, H: number, base: Pick<Part, "tint" | "glow" | "seed">) {
  const n = 2 + Math.floor(r() * 2);
  for (let k = 0; k < n; k++) {
    const t = 1.6 + r() * 1.4;
    out.push({ ...base, x: x + (r() - 0.5) * w * 0.7, y: y - 1, z: z + (r() - 0.5) * d * 0.7, w: t, h: H * (0.04 + r() * 0.09) + 1, d: t, taper: 0.2, kind: 2 });
  }
}

/**
 * Una megatorre: `F` es lo que ocupa en planta, `H` su altura (sin la aguja) e `y0` su suelo. Cada forma, con sus
 * cuerpos metidos un poco unos en otros (nunca dos caras en el mismo plano: a kilómetro y medio el
 * búfer de profundidad no las distinguiría).
 */
export function megatower(out: Part[], r: Rand, x: number, z: number, H: number, F: number, form: number, base: Pick<Part, "tint" | "glow" | "seed">, y0: number) {
  // Alguna, girada un octavo de vuelta (más estrecha: de esquina a esquina mide lo que las demás de lado).
  const yaw = r() < 0.12 ? Math.PI / 4 : 0;
  if (yaw) F *= 0.72;
  if (form === 0) {
    // Escalonada: de dos a cuatro cuerpos, cada uno más estrecho, y a veces rematada en punta.
    const tiers = 2 + Math.floor(r() * 3);
    const shares = [[0.62, 0.38], [0.5, 0.3, 0.2], [0.42, 0.26, 0.18, 0.14]][tiers - 2]!;
    let w = F, d = F * (0.72 + r() * 0.28), y = y0;
    for (let i = 0; i < tiers; i++) {
      const h = H * shares[i]!;
      const last = i === tiers - 1;
      const taper = last && r() < 0.55 ? 0.3 + r() * 0.35 : 1;
      out.push({ ...base, x, y: y - (i ? 3 : 0), z, w, h: h + (i ? 3 : 0), d, yaw, taper });
      y += h;
      if (last) {
        if (r() < 0.65) spire(out, x, y, z, Math.max(2.4, Math.min(w, d) * taper * 0.3), H * (0.07 + r() * 0.13), base);
        else out.push({ ...base, x, y, z, w: 1.5, h: 1.5, d: 1.5, kind: 1, tint: RED });
        if (taper === 1 && r() < 0.5) spikes(out, r, x, y, z, w, d, H, base);
      }
      const k = 0.6 + r() * 0.17;
      w *= k;
      d *= k;
    }
  } else if (form === 1) {
    // Losa: un cuerpo delgado, su coronación y una aleta que lo sobrepasa.
    const along = r() < 0.5;
    const w = F, d = F * (0.36 + r() * 0.24);
    const turn = yaw + (along ? 0 : Math.PI / 2);
    out.push({ ...base, x, y: y0, z, w, h: H * 0.93, d, yaw: turn, taper: 0.94 + r() * 0.06 });
    out.push({ ...base, x, y: y0 + H * 0.93 - 3, z, w: w * 0.8, h: H * 0.07 + 3, d: d * 0.72, yaw: turn });
    const off = (d / 2) * 0.55;
    const fx = x + Math.sin(turn) * off, fz = z + Math.cos(turn) * off;
    const fh = H * (0.62 + r() * 0.1);
    out.push({ ...base, x: fx, y: y0 + H * 0.5, z: fz, w: w * 0.07 + 1.5, h: fh, d: d * 0.12 + 1, yaw: turn, taper: 0.35, kind: 2 });
    out.push({ ...base, x: fx, y: y0 + H * 0.5 + fh, z: fz, w: 1.5, h: 1.5, d: 1.5, kind: 1, tint: RED });
  } else if (form === 2) {
    // Gemelas: dos torres unidas por pasarelas de cristal.
    const along = r() < 0.5;
    const w = F * 0.4, d = F * (0.5 + r() * 0.2), gap = F * 0.24;
    const off = (w + gap) / 2;
    const ax = along ? 1 : 0, az = along ? 0 : 1;
    const h2 = H * (0.78 + r() * 0.16);
    const tw = along ? w : d, td = along ? d : w;
    out.push({ ...base, x: x - ax * off, y: y0, z: z - az * off, w: tw, h: H, d: td, taper: 0.9 + r() * 0.1 });
    out.push({ ...base, x: x + ax * off, y: y0, z: z + az * off, w: tw, h: h2, d: td, taper: 0.9 + r() * 0.1 });
    const bridges = 1 + Math.floor(r() * 3);
    for (let k = 0; k < bridges; k++) {
      const by = y0 + h2 * (0.32 + (k / bridges) * 0.5 + r() * 0.08);
      const bl = gap + w * 0.5;
      out.push({ ...base, x, y: by, z, w: along ? bl : d * 0.42, h: 9, d: along ? d * 0.42 : bl });
    }
    spire(out, x - ax * off, y0 + H, z - az * off, 3, H * 0.1, base);
    out.push({ ...base, x: x + ax * off, y: y0 + h2, z: z + az * off, w: 1.5, h: 1.5, d: 1.5, kind: 1, tint: RED });
  } else if (form === 3) {
    // Obelisco: un solo cuerpo que se afila, con su punta.
    const w = F * 0.92;
    const taper = 0.28 + r() * 0.2;
    out.push({ ...base, x, y: y0, z, w, h: H, d: w * (0.85 + r() * 0.15), yaw, taper });
    spire(out, x, y0 + H, z, Math.max(2.4, w * taper * 0.4), H * (0.1 + r() * 0.1), base);
  } else if (form === 6) {
    // Aguja: un fuste esbelto, más alto que las demás, que se afila hasta su punta, con dos
    // agujas menores a los lados.
    const w = F * 0.5, top = Math.min(H * 1.4, 700);
    const taper = 0.24 + r() * 0.14;
    out.push({ ...base, x, y: y0, z, w, h: top, d: w, yaw, taper });
    spire(out, x, y0 + top, z, Math.max(2.2, w * taper * 0.45), top * (0.12 + r() * 0.1), base);
    for (const side of [-1, 1]) {
      const sh = top * (0.45 + r() * 0.25), sw = w * 0.42;
      const off = w * 0.5 + sw * 0.2;
      out.push({ ...base, x: x + side * off * Math.cos(yaw), y: y0, z: z - side * off * Math.sin(yaw), w: sw, h: sh, d: sw, yaw, taper: 0.3 });
    }
  } else if (form === 4) {
    // Cilindro con un tambor más estrecho arriba y un mirador que sobresale.
    const dia = F * 0.82;
    const h1 = H * (0.7 + r() * 0.1);
    out.push({ ...base, x, y: y0, z, w: dia, h: h1, d: dia, round: true, taper: 0.93 });
    out.push({ ...base, x, y: y0 + h1 - 4, z, w: dia * 1.22, h: 9, d: dia * 1.22, round: true, taper: 0.86 });
    out.push({ ...base, x, y: y0 + h1 + 2, z, w: dia * 0.62, h: H - h1 - 2, d: dia * 0.62, round: true, taper: 0.8 });
    spire(out, x, y0 + H, z, 3, H * (0.1 + r() * 0.12), base);
  } else {
    // Tambores apilados, cada vez más estrechos, con un disco entre uno y otro.
    const n = 3 + Math.floor(r() * 2);
    let dia = F * 0.86, y = y0;
    for (let i = 0; i < n; i++) {
      const h = (H / n) * (i === 0 ? 1.25 : 0.92);
      out.push({ ...base, x, y: y - (i ? 3 : 0), z, w: dia, h: h + (i ? 3 : 0), d: dia, round: true });
      y += h;
      if (i < n - 1) out.push({ ...base, x, y: y - 2.5, z, w: dia * 1.14, h: 5, d: dia * 1.14, round: true, kind: 2 });
      dia *= 0.76;
    }
    spire(out, x, y, z, 2.8, H * 0.12, base);
  }
}

/* ------------------------------------------------------------------ */
/* Edificios                                                            */
/* ------------------------------------------------------------------ */

/** Lo común de los shaders de la megaciudad: azar sin senos (va bien también lejos del origen). */
const NOISE_GLSL = /* glsl */ `
  float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
`;

/**
 * Lo que es de cada edificio (su fachada, sus luces, su azotea) se sortea una vez, en el vértice, y
 * viaja sin interpolar: así no se repite el sorteo en cada píxel (lo caro son los píxeles: una
 * megatorre cercana ocupa media pantalla) y, además, sale igual en todos (interpolado, un número
 * baila en el último decimal y un sorteo hecho con él cambia de un píxel al de al lado). También
 * aquí, el tono del aire hacia el edificio (`vTone`).
 */
const BUILDING_VS = /* glsl */ `
  uniform float uNight; uniform float uFloor; uniform sampler2D uRing; uniform float uNeon; uniform float uScreen;
  attribute vec3 aTint; attribute vec3 aGlow; attribute vec4 aInfo;
  varying vec3 vW; varying vec3 vN; varying vec3 vP; varying vec3 vNl; varying vec3 vTone;
  // vSize: tamaño (xyz) y si es megatorre (w). vGrid: paso (xy) y marco (zw) de la fachada.
  // vA: tres sorteos y la pantalla (0 no, 1 panel, 2 holograma). vB: lamas de luz (0, 1 una, 2 dos),
  // filos de neón, coronación e hilo de los cinturones. vC: muro, azotea (tipo y tono) y helipuerto.
  flat varying vec4 vSize; flat varying vec3 vTint; flat varying vec3 vGlow; flat varying vec4 vInfo;
  flat varying vec4 vGrid; flat varying vec4 vA; flat varying vec4 vB; flat varying vec4 vC; flat varying vec3 vLamp;
  ${NOISE_GLSL}
  void main() {
    vec3 size = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    // La parte entera de la semilla, si la hay, dice la fachada (1 + cuál); sin ella, la que le toque.
    float force = floor(aInfo.x);
    float seed = aInfo.x - force, drum = aInfo.w;
    // Un afilado negativo es a dos aguas: solo estrecha a lo ancho (un tejado, una nave).
    float tp = abs(aInfo.z), gable = step(aInfo.z, 0.0);
    vec3 p = position;
    if (aInfo.y > 0.5 && aInfo.y < 1.5) {
      // Balizas: de lejos crecen, para seguir viéndose como un punto de luz.
      float s = clamp(distance(origin.xyz, cameraPosition) / 320.0, 1.0, mix(1.5, 4.5, uNight));
      p = vec3(p.x * s, (p.y - 0.5) * s + 0.5, p.z * s);
    }
    // Se afila hacia arriba; las caras se echan hacia atrás lo que toca.
    p.xz *= mix(vec2(mix(1.0, tp, position.y)), vec2(mix(1.0, tp, position.y), 1.0), gable);
    vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vec3 nl = normal;
    if (abs(nl.y) < 0.5) nl.y = (1.0 - tp) * 0.5 / size.y * mix(mix(abs(nl.x) * size.x + abs(nl.z) * size.z, size.x, drum), abs(nl.x) * size.x, gable);
    mat3 turn = mat3(instanceMatrix[0].xyz / size.x, instanceMatrix[1].xyz / size.y, instanceMatrix[2].xyz / size.z);
    vW = w.xyz;
    vN = turn * normalize(nl);
    vNl = normal;
    vP = p * size;
    vTint = aTint; vGlow = aGlow; vInfo = vec4(seed, aInfo.y, tp, aInfo.w);

    // Megatorre: un cuerpo alto, o uno que empieza muy por encima de la calle (los de arriba).
    float first = step(origin.y, uFloor + 2.0);
    float big = step(64.0, max(size.y, origin.y - uFloor));
    vSize = vec4(size, big);
    float s1 = h11(seed * 917.0 + 1.0), s2 = h11(seed * 373.0 + 4.0), s3 = h11(seed * 131.0 + 9.0), s4 = h11(seed * 577.0 + 2.0);
    // Cuatro fachadas: muro cortina (bandas), lamas verticales, ventanas en un muro y monolito de
    // vidrio. Las megatorres, casi todas de vidrio; las de muro, con ventanas corridas y no sueltas.
    float style = floor(s1 * 4.0);
    if (big > 0.5 && style == 2.0 && s4 > 0.25) style = s4 > 0.62 ? 0.0 : 3.0;
    if (force > 0.5) style = force - 1.0;
    float wall = style == 2.0 ? 1.0 : 0.0;
    vec2 pitch = style < 0.5 ? vec2(1.6, 4.0) : style < 1.5 ? vec2(1.25, 4.0) : style < 2.5 ? vec2(3.2, 3.7) : vec2(2.4, 4.2);
    vec2 frame = style < 0.5 ? vec2(0.07, 0.25) : style < 1.5 ? vec2(0.22, 0.1) : style < 2.5 ? vec2(0.34, 0.36) : vec2(0.04, 0.075);
    if (wall > 0.5 && big > 0.5) { pitch = vec2(2.2, 4.0); frame = vec2(0.09, 0.44); }
    vGrid = vec4(pitch, frame);
    // Pantalla (sin letras) en una cara de algunas megatorres, en su primer cuerpo.
    float sk = h11(seed * 433.0 + 8.0) + uScreen;
    vA = vec4(s2, s3, s4, big * first * (1.0 - drum) * (sk > 0.82 ? 2.0 : sk > 0.64 ? 1.0 : 0.0));
    // Luces: lamas que suben por la fachada, filos de neón en los cantos de los fustes (cuerpos
    // altos que arrancan de la calle), la coronación de cada cuerpo y un hilo bajo cada cinturón.
    float fk = h11(seed * 151.0 + 4.0);
    vB = vec4(
      big * (1.0 - drum) * (fk < 0.58 ? 0.0 : fk < 0.84 ? 1.0 : 2.0),
      step(150.0, size.y) * first * (1.0 - drum) * step(0.7, h11(seed * 719.0 + 3.0)),
      step(mix(0.88, 0.35, big) - uNeon, h11(seed * 277.0 + 6.0)),
      big * step(0.64, h11(seed * 89.0 + 1.0)));
    vC = vec4(wall, h11(seed * 233.0 + 5.0), 0.85 + 0.3 * h11(seed * 331.0 + 2.0), step(0.5, h11(seed * 71.0)));
    // La luz de cada torre: las de las calles, blanca cálida o fría; las megatorres, además, de
    // cian, rosa, ámbar o violeta (cada una, la suya).
    float lk = h11(seed * 613.0 + 5.0) * mix(0.62, 1.0, big);
    vLamp = lk < 0.36 ? vec3(1.0, 0.8, 0.56) : lk < 0.62 ? vec3(0.78, 0.9, 1.0) : lk < 0.76 ? vec3(0.34, 0.86, 1.0) : lk < 0.88 ? vec3(1.0, 0.44, 0.84) : lk < 0.95 ? vec3(1.0, 0.64, 0.24) : vec3(0.68, 0.52, 1.0);
    vec2 d = w.xz - cameraPosition.xz;
    vTone = texture2D(uRing, vec2(atan(d.y, d.x) * 0.15915494 + 0.5, 0.5)).rgb;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/**
 * `RICH` (escritorio): el cristal refleja la foto del cielo y la silueta de las torres de
 * alrededor, cada paño un poco a su aire, con destellos del sol, y las ventanas encendidas se
 * agrupan de lejos sin saltos. Sin él (gafas, móviles, nivel ligero) el mismo edificio con menos
 * cuentas por píxel: refleja un cielo liso y las ventanas se agrupan con un tramado.
 */
const BUILDING_FS = /* glsl */ `
  uniform float uTime; uniform sampler2D uSky; uniform float uSkyOn; uniform vec3 uSunDir; uniform vec3 uZenith;
  uniform float uMirror; uniform float uGlowK; uniform float uDeep; uniform vec3 uStreet;
  varying vec3 vW; varying vec3 vN; varying vec3 vP; varying vec3 vNl; varying vec3 vTone;
  flat varying vec4 vSize; flat varying vec3 vTint; flat varying vec3 vGlow; flat varying vec4 vInfo;
  flat varying vec4 vGrid; flat varying vec4 vA; flat varying vec4 vB; flat varying vec4 vC; flat varying vec3 vLamp;
  ${AIR_GLSL}
  ${NOISE_GLSL}
  const vec3 SKY_AMB = vec3(0.36, 0.41, 0.50);
  const vec3 SUN_COL = vec3(0.76, 0.70, 0.60);

  // Lo que refleja una fachada hacia R: el cielo y, por abajo, la ciudad.
  vec3 envAt(vec3 R, float seed) {
    float y = max(R.y, 0.0);
    #ifdef RICH
      float az = atan(R.z, R.x);
      float u = az * 0.15915494 + 0.5;
      vec3 horizon = texture2D(uRing, vec2(u, 0.5)).rgb * uMirror;
      vec3 sky = mix(horizon, uZenith, uGlowK > 0.0 ? 1.0 - exp(-y * uGlowK) : pow(y, 0.6));
      if (uSkyOn > 0.5) sky = textureLod(uSky, vec2(u, asin(min(y, 1.0)) * 0.31830989 + 0.5), 1.5).rgb;
      // La silueta de las torres de alrededor, distinta en cada edificio: unas cerca (altas y más
      // oscuras) y otras lejos (bajas y ya del color del aire).
      float b1 = h11(floor(az * 5.0 + seed * 31.0) + 3.0), b2 = h11(floor(az * 13.0 + seed * 17.0) + 7.0);
      float top1 = mix(-0.08, 0.34, b1 * b1), top2 = mix(0.02, 0.2, b2);
      float near = 1.0 - smoothstep(top1 - 0.01, top1 + 0.01, R.y);
      float far = 1.0 - smoothstep(top2 - 0.01, top2 + 0.01, R.y);
      float shade = mix(0.8, 0.42 + 0.2 * b1, near);
      float city = max(near, far);
    #else
      vec3 horizon = vTone * uMirror;
      vec3 sky = mix(horizon, uZenith, uGlowK > 0.0 ? 1.0 - exp(-y * uGlowK) : y * (1.7 - 0.7 * y));
      float shade = 0.66;
      float city = 1.0 - smoothstep(0.05, 0.08, R.y);
    #endif
    // Lo de abajo es ciudad: de día, vidrio azul sobre vidrio azul (más hondo cuanto más abajo se
    // mira); de noche, la niebla con su resplandor.
    vec3 mistC = mix(horizon, uMistTone, 0.7);
    vec3 day = mix(mistC * vec3(0.84, 0.92, 1.04), vec3(0.2, 0.36, 0.66), smoothstep(0.1, -0.45, R.y)) * shade;
    vec3 cityCol = mix(day, mistC * (0.45 + 0.5 * shade) + uUnder, uNight);
    return mix(sky, cityCol, city);
  }

  #ifdef THEMED
    // La luz de lo que no es cristal (pintura, chapa, roca, teja): de día, sol y cielo; de noche,
    // apenas la del cielo y la de las calles, que sube desde abajo.
    vec3 matte(vec3 alb, vec3 n, float ao, float ndl, float above) {
      if (uNight > 0.5) {
        float low = 1.0 - smoothstep(0.0, 70.0, above);
        return alb * (vec3(0.02, 0.023, 0.042) + uStreet * (0.3 + 0.7 * low * low) * (1.0 - 0.8 * max(n.y, 0.0)));
      }
      return alb * (SKY_AMB * ao + SUN_COL * ndl);
    }

    // Lo que tiene tema (ver Part.kind). u: metros a lo ancho de la cara.
    void themed(float kind, float seed, vec3 n, vec3 V, float ao, float ndl, float above, bool isRound, out vec3 col, out vec3 glow) {
      bool top = vNl.y > 0.5, under = vNl.y < -0.5, xFace = abs(vNl.x) > 0.5;
      float u = isRound ? atan(vP.z, vP.x) * vSize.x * 0.5 : (xFace ? vP.z : vP.x);
      float wd = isRound ? vSize.x * 3.14159 : (xFace ? vSize.z : vSize.x);
      float mu = fwidth(u), my = fwidth(vP.y);
      col = matte(vTint * (0.95 + 0.1 * h12(floor(vec2(u, vP.y) / 5.0) + seed * 23.0)), n, ao, ndl, above);
      glow = vec3(0.0);
      if (kind > 3.5 && kind < 4.5) {
        // Un luminoso, sin letras: liso, a franjas que suben o de píxeles que cambian despacio.
        vec2 q = vec2(u, vP.y);
        float t = uTime * 0.35 + seed * 20.0;
        float plain = step(dot(abs(vTint - vGlow), vec3(1.0)), 0.02);
        float mode = plain > 0.5 ? 0.0 : 1.0 + floor(h11(seed * 53.0 + 2.0) * 2.0);
        vec3 a = vTint;
        float v = 1.0;
        if (mode > 1.5) {
          vec2 c = floor(q / 1.5);
          v = 0.3 + 0.7 * step(0.4, h12(c + floor(t * 0.5 + h12(c * 1.3) * 3.0) * 7.0));
          a = mix(vTint, vGlow, step(0.6, h12(c * 1.7 + 3.0)));
          // De lejos, su media (sin parpadeos).
          float far = smoothstep(0.5, 1.4, max(mu, my));
          v = mix(v, 0.72, far);
          a = mix(a, mix(vTint, vGlow, 0.4), far);
        } else if (mode > 0.5) {
          v = 0.62 + 0.38 * sin(q.y * 1.1 - t * 3.0);
          a = mix(vTint, vGlow, 0.5 + 0.5 * sin(q.y * 0.35 + t));
        }
        float face = (top || under) ? 0.0 : 1.0;
        float inside = plain > 0.5 ? 1.0 : step(abs(u), wd * 0.5 - 0.25) * step(0.25, vP.y) * step(vP.y, vSize.y - 0.25) * face;
        vec3 sc = a * v;
        col = mix(vec3(0.03, 0.032, 0.04), sc * mix(0.85, 1.3, uNight), inside);
        glow = sc * inside * 0.7 * uNight;
      }
      #ifdef K_VOXEL
      if (kind > 4.5 && kind < 5.5) {
        // Vóxeles: cubos de 4 m (de 8 en las torres grandes), cada uno con su tono, y algunos de
        // cristal, que de noche se encienden.
        float S = vSize.w > 0.5 ? 8.0 : 4.0;
        vec3 g = vec3(vP.x + vSize.x * 0.5, vP.y, vP.z + vSize.z * 0.5) / S;
        vec2 c = (top || under) ? g.xz : (xFace ? g.zy : g.xy);
        vec2 ci = floor(c), cf = fract(c);
        float fc = max(fwidth(c.x), fwidth(c.y));
        float detail = 1.0 - smoothstep(0.3, 0.8, fc);
        float side = (xFace ? 13.0 : 0.0) + (top ? 29.0 : 0.0);
        float h = h12(ci + seed * 57.0 + side);
        vec3 alb = vTint * mix(0.93, 0.74 + 0.38 * h, detail);
        float edge = min(min(cf.x, 1.0 - cf.x), min(cf.y, 1.0 - cf.y));
        alb *= 1.0 - 0.3 * (1.0 - smoothstep(0.03, 0.03 + fc, edge)) * (1.0 - smoothstep(0.06, 0.25, fc));
        float lit = (top || under) ? 0.0 : mix(0.14, step(0.86, h12(ci * 1.3 + seed * 91.0 + side)), detail);
        vec3 lamp = mix(vGlow, vec3(1.0, 0.92, 0.7), 0.35);
        col = matte(alb, n, ao, ndl, above);
        if (uNight > 0.5) {
          float pane = mix(1.0, step(0.14, edge), detail);
          col = mix(col, lamp * 0.95, lit * pane);
          glow = lamp * lit * pane * 0.5;
        } else {
          col = mix(col, envAt(reflect(-V, n), seed) * 0.82, lit * 0.7);
        }
      }
      #endif
      #ifdef K_HOUSE
      if (kind > 5.5 && kind < 6.5) {
        // Una casa o un módulo: muro pintado, con sus ventanas (las plantas y los vanos, enteros).
        if (top) {
          col = matte(mix(vTint * 0.8, vec3(0.4, 0.39, 0.37), 0.3), n, ao, ndl, above);
        } else if (!under) {
          float nb = max(1.0, floor(wd / 3.2 + 0.5)), nf = max(1.0, floor(vSize.y / 3.0 + 0.5));
          vec2 cell = vec2((u / wd + 0.5) * nb, vP.y / vSize.y * nf);
          vec2 f = fract(cell), id = floor(cell);
          float detail = 1.0 - smoothstep(0.25, 0.7, max(fwidth(cell.x), fwidth(cell.y)));
          float side = xFace ? 7.0 : 0.0;
          float has = step(0.22, h12(id + seed * 31.0 + side));
          float win = mix(0.13, step(0.3, f.x) * step(f.x, 0.7) * step(0.3, f.y) * step(f.y, 0.8) * has, detail);
          vec3 wall = vTint * (0.9 + 0.14 * h12(floor(vec2(u, vP.y) / 6.0) + seed * 3.0)) * mix(0.8, 1.0, smoothstep(0.2, 0.8, vP.y));
          vec3 wallC = matte(wall, n, ao, ndl, above);
          float pr = h12(id * 1.7 + seed * 57.0 + side);
          if (uNight > 0.5) {
            float on = mix(0.4, step(pr, 0.4), detail);
            vec3 lamp = mix(vec3(1.0, 0.7, 0.38), vec3(1.0, 0.86, 0.62), fract(pr * 7.0));
            col = mix(wallC, mix(vec3(0.01, 0.012, 0.02), lamp * 0.95, on), win);
            glow = lamp * on * win * 0.4;
          } else {
            // Unas, con la contraventana echada; las demás, el cristal en sombra.
            vec3 winC = mix(vec3(0.07, 0.09, 0.12), vGlow * 0.55 * (SKY_AMB + SUN_COL * ndl), step(0.55, pr) * detail);
            col = mix(wallC, winC, win);
          }
        }
      }
      #endif
      #ifdef K_STACK
      if (kind > 6.5 && kind < 7.5) {
        // Una chimenea: hormigón o ladrillo, con sus bandas de aviso arriba.
        float hh = vP.y / vSize.y;
        float bands = step(0.7, hh) * step(0.5, fract(hh * 9.0)) * (top ? 0.0 : 1.0);
        vec3 alb = mix(vTint * (0.9 + 0.12 * h11(floor(vP.y / 4.0) + seed * 5.0)), vGlow, bands);
        col = matte(alb, n, ao, ndl, above);
        if (uNight > 0.5) col += vGlow * bands * 0.05;
      }
      #endif
      #ifdef K_ROCK
      if (kind > 7.5 && kind < 8.5) {
        // Roca: estratos y grietas; encima, arena o hierba.
        float fine = 1.0 - smoothstep(1.0, 3.0, fwidth(vW.y));
        float st = mix(0.5, h11(floor(vW.y / 4.0) + seed * 19.0), fine);
        float big2 = h11(floor(vW.y / 19.0) + seed * 7.0);
        float crack = mix(0.5, h12(floor(vec2(u / 7.0, vW.y / 23.0)) + seed * 7.0), fine);
        vec3 alb = vTint * (0.72 + 0.2 * st + 0.2 * big2) * (0.92 + 0.14 * crack);
        if (top) alb = mix(alb, vGlow, 0.8) * (0.9 + 0.2 * h12(floor(vP.xz / 9.0) + seed));
        col = matte(alb, n, ao, ndl, above);
      }
      #endif
      #ifdef K_SHED
      if (kind > 8.5 && kind < 9.5) {
        // Una nave de chapa: zócalo de hormigón, portón, y una franja de ventanas bajo el alero.
        float lamp = step(h11(seed * 71.0 + 3.0), 0.7);
        if (top) {
          // Lucernarios en filas.
          float sky = step(0.8, fract(vP.z / 6.0)) * step(abs(vP.x), vSize.x * 0.32) * (1.0 - smoothstep(0.6, 1.8, fwidth(vP.z)));
          col = matte(vTint * 0.72, n, ao, ndl, above);
          col = mix(col, uNight > 0.5 ? vGlow * 0.5 * lamp : vec3(0.3, 0.38, 0.46), sky * 0.8);
          glow = vGlow * sky * lamp * 0.2 * uNight;
        } else if (!under) {
          float rib = mix(0.95, 0.9 + 0.1 * step(0.5, fract(u / 0.8)), 1.0 - smoothstep(0.15, 0.5, mu));
          vec3 alb = mix(vTint * rib, vec3(0.42, 0.42, 0.4), step(vP.y, 1.1));
          float band = step(vSize.y * 0.72, vP.y) * step(vP.y, vSize.y * 0.87) * mix(0.88, step(0.12, fract(u / 2.4)), 1.0 - smoothstep(0.4, 1.2, mu));
          float du = abs(u - (h11(seed * 37.0 + (xFace ? 1.0 : 5.0)) - 0.5) * wd * 0.5);
          float door = step(du, 2.6) * step(vP.y, min(5.2, vSize.y * 0.6));
          col = matte(alb, n, ao, ndl, above);
          if (uNight > 0.5) {
            col = mix(col, vGlow * 0.9 * lamp + vec3(0.012, 0.014, 0.02), band);
            col = mix(col, vGlow * 0.55 * step(h11(seed * 13.0 + (xFace ? 2.0 : 9.0)), 0.35) + vec3(0.02), door);
            // La luz de los focos del alero, que baña la pared.
            float wash = lamp * smoothstep(vSize.y * 0.7, vSize.y * 0.2, vP.y) * step(vP.y, vSize.y * 0.7);
            col += vGlow * alb * 0.16 * wash;
            glow = vGlow * band * lamp * 0.4;
          } else {
            col = mix(col, vec3(0.1, 0.14, 0.2) + envAt(reflect(-V, n), seed) * 0.25, band);
            col = mix(col, matte(vTint * 0.55, n, ao, ndl, above), door);
          }
        }
      }
      #endif
      #ifdef K_PILA
      if (kind > 9.5 && kind < 10.5) {
        // Una pila de caravanas, de lejos: una por piso, girada un cuarto respecto a la de debajo,
        // dentro de su andamio. De muy lejos, su media.
        const float FH = 2.9;
        float fl = floor(vP.y / FH), fy = fract(vP.y / FH);
        float detail = 1.0 - smoothstep(0.12, 0.34, max(my, mu) / FH);
        float turn = mod(fl + floor(seed * 4.0), 2.0);
        float along = xFace ? turn : 1.0 - turn;
        float hw = mix(1.3, 3.5, along);
        float off = (h11(fl * 3.1 + seed * 11.0) - 0.5) * max(wd - 2.0 * hw - 1.0, 0.0);
        float du = abs(u - off);
        float body = step(du, hw) * step(0.08, fy) * step(fy, 0.93);
        float ch = h11(fl * 7.7 + seed * 5.0);
        vec3 pal = ch < 0.3 ? vec3(0.72, 0.69, 0.62) : ch < 0.52 ? vec3(0.55, 0.6, 0.63) : ch < 0.72 ? vec3(0.66, 0.42, 0.3) : ch < 0.88 ? vec3(0.42, 0.5, 0.46) : vTint;
        float win = body * step(abs(du - hw * 0.45), hw * 0.24) * step(0.42, fy) * step(fy, 0.74);
        float steel = max(step(wd * 0.5 - 0.3, abs(u)), step(fy, 0.07) * step(mod(fl, 2.0), 0.5));
        float on = step(h11(fl * 5.3 + seed * 17.0 + (xFace ? 3.0 : 0.0)), 0.45);
        vec3 lampC = mix(vec3(1.0, 0.74, 0.42), vGlow, step(0.8, h11(fl * 9.1 + seed * 3.0)));
        if (top) {
          col = matte(vec3(0.3, 0.3, 0.31), n, ao, ndl, above);
        } else if (uNight > 0.5) {
          vec3 near = mix(vec3(0.006, 0.007, 0.012), matte(pal, n, ao, ndl, above), body);
          near = mix(near, matte(vec3(0.2, 0.21, 0.23), n, ao, ndl, above), steel * (1.0 - body));
          near = mix(near, lampC * 0.95, win * on);
          vec3 mean = matte(vec3(0.3, 0.3, 0.3), n, ao, ndl, above) * 0.6 + lampC * 0.035;
          col = mix(mean, near, detail);
          glow = lampC * win * on * detail * 0.4;
        } else {
          vec3 shade = SKY_AMB * ao * 0.35;
          vec3 near = mix(vec3(0.1, 0.105, 0.12) * shade * 2.0, matte(pal, n, ao, ndl, above), body);
          near = mix(near, matte(vec3(0.3, 0.31, 0.33), n, ao, ndl, above), steel * (1.0 - body));
          near = mix(near, vec3(0.06, 0.08, 0.11), win);
          vec3 mean = matte(vec3(0.5, 0.49, 0.46), n, ao, ndl, above) * 0.74;
          col = mix(mean, near, detail);
        }
      }
      #endif
    }
  #endif

  void main() {
    vec3 n = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    float seed = vInfo.x, kind = vInfo.y, big = vSize.w;
    bool isRound = vInfo.w > 0.5;
    float above = vW.y - uFloor;
    // Entre torres llega menos cielo: más oscuro cuanto más abajo.
    float ao = mix(0.5, 1.0, smoothstep(0.0, uDeep, above));
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 col = vec3(0.0);
    vec3 glow = vec3(0.0);

    #ifdef THEMED
    if (kind > 2.5) {
      themed(kind, seed, n, V, ao, ndl, above, isRound, col, glow);
    } else
    #endif
    if (kind > 1.5) {
      // Metal: agujas, antenas y discos.
      vec3 alb = mix(vec3(0.5, 0.52, 0.56), vTint, 0.3);
      vec3 env = envAt(reflect(-V, n), seed);
      if (uNight > 0.5) col = alb * (vec3(0.02, 0.024, 0.045) + uUnder * 0.7 * (1.0 - smoothstep(0.0, 260.0, above))) + env * 0.12;
      else col = alb * (SKY_AMB * ao + SUN_COL * ndl) * 0.85 + env * 0.14;
      // El canto de los discos, encendido.
      float rim = vInfo.w * step(vSize.y * 0.3, vP.y) * step(vP.y, vSize.y * 0.7);
      col = mix(col, vGlow * mix(0.55, 1.5, uNight), rim);
      glow = vGlow * rim * uNight;
    } else if (kind > 0.5) {
      // Baliza.
      float blink = step(0.5, fract(uTime * 0.55 + seed * 7.0));
      col = mix(vTint * 0.35 + 0.05, vTint * (0.12 + 1.5 * blink), uNight);
      glow = vTint * blink * uNight * 1.4;
    } else if (vNl.y > 0.5) {
      // Azotea: lámina clara, gravilla, tela asfáltica, cubierta verde o placas solares; con su
      // peto, sus máquinas y, en las grandes, un helipuerto.
      float taper = vInfo.z;
      vec2 rp = vP.xz;
      float edge = isRound ? vSize.x * 0.5 * taper - length(rp) : min(vSize.x * 0.5 * taper - abs(rp.x), vSize.z * 0.5 * taper - abs(rp.y));
      float rs = vC.y;
      vec3 alb = rs < 0.2 ? vec3(0.4, 0.41, 0.42) : rs < 0.44 ? vec3(0.2, 0.2, 0.21) : rs < 0.62 ? vec3(0.13, 0.135, 0.15) : rs < 0.8 ? vec3(0.11, 0.21, 0.1) : vec3(0.06, 0.09, 0.18);
      alb *= vC.z;
      float mpx = max(fwidth(rp.x), fwidth(rp.y));
      float fine = 1.0 - smoothstep(0.5, 1.6, mpx);
      vec2 cu = rp / 5.0, cf = fract(cu);
      float unit = step(0.7, h12(floor(cu) + seed * 110.0)) * step(0.18, cf.x) * step(cf.x, 0.82) * step(0.24, cf.y) * step(cf.y, 0.76) * step(2.6, edge);
      // Placas solares: filas.
      float rows = step(0.8, rs) * step(0.25, fract(rp.x / 2.4)) * step(1.6, edge) * fine;
      alb = mix(alb, vec3(0.05, 0.08, 0.2), rows * 0.7);
      alb = mix(alb, vec3(0.3, 0.31, 0.33), unit * fine);
      float pad = step(26.0, min(vSize.x, vSize.z) * taper) * vC.w;
      float ringD = abs(length(rp) - 7.0);
      alb = mix(alb, vec3(0.62, 0.6, 0.3), pad * (1.0 - smoothstep(0.25, 0.5, ringD)) * fine);
      alb = mix(alb, vec3(0.52, 0.53, 0.55), 1.0 - smoothstep(0.5, 0.9, edge));
      if (uNight > 0.5) {
        col = alb * (vec3(0.022, 0.026, 0.05) + uUnder * 0.25);
        // Algún lucernario encendido y el aro de luces del helipuerto.
        col += vec3(1.0, 0.8, 0.5) * 0.5 * unit * step(0.5, h12(floor(cu) * 1.7 + seed * 7.0)) * fine;
        float ringL = pad * (1.0 - smoothstep(0.2, 0.45, ringD)) * fine;
        col += vGlow * 0.9 * ringL;
        glow = vGlow * ringL * 0.6;
      } else {
        col = alb * (SKY_AMB * mix(0.75, 1.0, ao) + SUN_COL * max(n.y * uSunDir.y, 0.0) * 1.15) * (1.0 - 0.3 * unit * fine);
      }
    } else if (vNl.y < -0.5) {
      col = vec3(0.012, 0.014, 0.02);
    } else {
      // Fachada. Coordenadas en metros: a lo ancho de la cara y la altura del mundo (las plantas
      // cuadran entre los cuerpos de una misma torre).
      bool xFace = abs(vNl.x) > 0.5;
      float u = isRound ? atan(vP.z, vP.x) * vSize.x * 0.5 : (xFace ? vP.z : vP.x);
      float halfW = isRound ? 1.0e5 : (xFace ? vSize.z : vSize.x) * 0.5 * mix(1.0, vInfo.z, vP.y / vSize.y);
      float s2 = vA.x, s3 = vA.y;
      bool wall = vC.x > 0.5;
      vec2 frame = vGrid.zw;
      vec2 cell = vec2(u, vW.y) / vGrid.xy;
      vec2 fw = fwidth(cell);
      // Celdas por píxel: de lejos, cada cosa se queda en su media (sin parpadeos).
      float px = max(fw.x, fw.y);
      float detail = 1.0 - smoothstep(0.22, 0.55, px);
      vec2 f = fract(cell), id = floor(cell);
      vec2 e = min(fw, vec2(0.5));
      float wx = smoothstep(frame.x * 0.5 - e.x, frame.x * 0.5 + e.x, min(f.x, 1.0 - f.x));
      float wy = smoothstep(frame.y - e.y, frame.y + e.y, f.y) * smoothstep(0.0, e.y * 2.0, 1.0 - f.y);
      float win = mix((1.0 - frame.x) * (1.0 - frame.y), wx * wy, detail);
      float pr = h12(id + seed * 57.0);

      // El vidrio es un espejo del cielo: más cuanto más de canto se mira.
      vec3 np = n;
      #ifdef RICH
        // Cada paño, un poco a su aire.
        vec3 tU = normalize(vec3(-n.z, 0.0, n.x));
        np = normalize(n + (tU * (pr - 0.5) + vec3(0.0, h12(id.yx * 1.3 + seed * 91.0) - 0.5, 0.0)) * 0.018 * detail);
      #endif
      vec3 R = reflect(-V, np);
      float gz = 1.0 - max(dot(n, V), 0.0);
      gz *= gz;
      float F0 = mix(0.5, 0.82, s3);
      float F = F0 + (1.0 - F0) * gz * gz;
      vec3 env = envAt(R, seed);
      // Paños grandes de vidrio algo distintos: se ven también de lejos, cuando las ventanas ya no.
      vec3 tint = vTint * (0.9 + 0.12 * h12(floor(vec2(u / 21.0, vW.y / 46.0)) + seed * 17.0));
      vec3 clad = wall ? mix(vec3(0.5, 0.49, 0.47), vTint, 0.5) * mix(1.0, 0.42, big) : vTint * 0.22;

      // Luces de la torre, finas: de lejos se dibujan de un píxel, y con menos luz (la misma, más
      // repartida).
      float mu = fw.x * vGrid.x, my = fw.y * vGrid.y;
      float lw = max(0.32, mu * 1.2), cw = max(0.6, my * 1.2);
      float dimU = 0.32 / lw, dimY = 0.6 / cw;
      float trim = isRound ? 0.0 : smoothstep(halfW - lw - mu, halfW - lw, abs(u));
      float crown = step(vSize.y - 1.4 - cw, vP.y) * step(vP.y, vSize.y - 1.4);
      float fu = vB.x < 0.5 ? 1.0e5 : vB.x < 1.5 ? abs(u) : abs(abs(u) - halfW * 0.4);
      float fins = (1.0 - smoothstep(lw * 0.5, lw * 0.5 + mu, fu)) * dimU;
      // Cinturones técnicos de las megatorres: una planta ciega cada cincuenta metros, y bajo ella,
      // en algunas, un hilo de luz.
      float bf = fract(vW.y / 52.0 + s2) * 52.0;
      float belt = big * (1.0 - smoothstep(2.3, 2.3 + my, bf));
      float beltL = vB.w * step(2.4, bf) * step(bf, 2.4 + cw) * dimY;
      float lights = clamp(max(max(trim * vB.y * dimU, crown * vB.z * dimY), max(fins, beltL)), 0.0, 1.0);

      float scr = 0.0; vec3 sc = vec3(0.0);
      if (vA.w > 0.5) {
        float face = s2 > 0.5 ? step(0.5, vNl.x) : step(0.5, vNl.z);
        float sw = halfW * 0.74, sh = clamp(vSize.y * 0.22, 26.0, 78.0);
        vec2 q = vec2(u / sw, (vP.y - vSize.y * mix(0.36, 0.58, s3)) / sh);
        scr = face * step(abs(q.x), 1.0) * step(0.0, q.y) * step(q.y, 1.0);
        float t = uTime * 0.35 + seed * 20.0;
        float bezel = step(abs(q.x), 0.96) * step(0.025, q.y) * step(q.y, 0.975);
        vec3 tone2 = mix(vGlow.gbr, vec3(1.0, 0.35, 0.85), 0.5);
        if (vA.w > 1.5) {
          // Un holograma: un astro con sus ondas, que late despacio.
          vec2 c = vec2(q.x * sw, (q.y - 0.5) * sh) / min(sw, sh * 0.5);
          float r = length(c);
          float waves = 0.5 + 0.5 * sin(r * 11.0 - t * 2.2);
          vec3 a = mix(vGlow, tone2, 0.5 + 0.5 * sin(t * 0.6 + c.y * 1.5));
          sc = (a * (0.16 + 0.75 * waves * exp(-r * 1.3)) + vec3(1.0, 0.95, 1.0) * exp(-r * r * 9.0) * 0.9) * bezel;
        } else {
          // Un panel de luces: barras que suben y bajan despacio y una franja que lo recorre.
          float bx = (q.x * 0.5 + 0.5) * 9.0, bi = floor(bx);
          float bh = 0.25 + 0.6 * (0.5 + 0.5 * sin(t * (0.7 + h11(bi + seed * 9.0)) + bi * 1.9));
          float bar = step(q.y, bh) * step(0.12, fract(bx)) * step(fract(q.y * 14.0), 0.72);
          float sweep = (q.y - fract(t * 0.11)) * 9.0;
          sc = (mix(vGlow, tone2, q.y) * 0.1 + mix(vGlow, tone2, bi / 9.0) * bar * 0.95 + vGlow * exp(-sweep * sweep) * 0.4) * bezel;
        }
      }

      if (uNight > 0.5) {
        // De noche la torre es oscura: un espejo del cielo y del resplandor, la luz cálida de las
        // calles que le sube por abajo y sus ventanas.
        float lowS = 1.0 - smoothstep(0.0, 110.0, above);
        vec3 street = uStreet * lowS * lowS;
        vec3 glass = mix(vTint * 0.008, env * tint, F) + street * 0.25;
        vec3 frameC = clad * (vec3(0.016, 0.02, 0.038) + street);
        // Ventanas encendidas: por plantas (alguna entera, muchas a oscuras) y por ventanas. De lejos
        // se agrupan (a lo ancho y a lo alto por separado: una cara vista de canto se agrupa antes a
        // lo ancho) en vez de fundirse en un gris: la torre sigue punteada de luces y no parpadea.
        // Cada vez que se agrupan hay más bloques encendidos y dan menos luz: la misma en total.
        float occ = mix(0.1, 0.4, s2);
        vec2 lod = max(vec2(0.0), log2(fw * 2.6));
        float many = 1.0 + 0.45 * (lod.x + lod.y);
        #ifdef RICH
          // Entre un tamaño de bloque y el siguiente, las dos cosas a la vez (sin saltos).
          vec2 l0 = floor(lod), lf = lod - l0;
          vec2 k0 = exp2(l0);
          float lit = 0.0;
          for (int i = 0; i < 4; i++) {
            vec2 o = vec2(float(i - (i / 2) * 2), float(i / 2));
            vec2 ic = floor(cell / (k0 * (1.0 + o)));
            vec2 lv = l0 + o;
            float fl = h11(ic.y * 7.31 + seed * 113.0 + lv.y * 3.7);
            // Por plantas, y dentro de cada una por tramos: nunca una raya de lado a lado.
            float run = h12(vec2(floor(ic.x * k0.x * (1.0 + o.x) / 9.0), ic.y) + seed * 71.0 + lv);
            float on = step(h12(ic + seed * 37.0 + lv * 13.0), occ * many * mix(0.3, 1.9, step(0.74, fl) * step(0.35, run)));
            lit += on * mix(1.0 - lf.x, lf.x, o.x) * mix(1.0 - lf.y, lf.y, o.y);
          }
        #else
          // Un solo tamaño de bloque por píxel, elegido con un tramado entre los dos que tocan.
          vec2 lv = floor(lod + fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))));
          vec2 ic = floor(cell / exp2(lv));
          float fl = h11(ic.y * 7.31 + seed * 113.0 + lv.y * 3.7);
          float lit = step(h12(ic + seed * 37.0 + lv * 13.0), occ * many * mix(0.3, 1.9, step(0.74, fl)));
        #endif
        vec3 wcol = mix(vLamp, vec3(1.0, 0.9, 0.76), pr * 0.5);
        vec3 emit = wcol * lit * (0.95 / many) * mix(0.8, mix(0.45, 1.0, fract(pr * 7.3)) * mix(0.6, 1.1, f.y), detail);
        col = mix(frameC, glass + emit, win);
        glow = emit * win * 0.5;
        col = mix(col, vec3(0.008, 0.01, 0.018), belt * 0.9);
        glow *= 1.0 - belt;
        col = mix(col, sc * 1.25, scr);
        glow = mix(glow, sc * 0.7, scr);
        col = mix(col, vGlow * 1.3, lights);
        glow += vGlow * lights;
      } else {
        // Además de reflejar, el vidrio al sol coge algo de su luz (polvo, serigrafías).
        vec3 glass = mix(vTint * 0.03, env * tint, F) + vTint * SUN_COL * ndl * 0.11;
        #ifdef RICH
          // Los destellos del sol en los paños que lo devuelven hacia quien mira.
          float sd = max(dot(R, uSunDir), 0.0);
          vec3 spark = vec3(1.0, 0.95, 0.86) * (pow(sd, 900.0) * 5.0 + pow(sd, 48.0) * 0.2);
          glass += spark;
          glow = spark * win * 0.5;
        #endif
        // Persianas echadas y alguna luz encendida.
        glass = mix(glass, vec3(0.5, 0.5, 0.47) * (0.35 + 0.65 * ndl), step(mix(0.82, 0.93, big), fract(pr * 13.7)) * detail * 0.4);
        glass += vLamp * 0.08 * step(pr, 0.08) * detail;
        vec3 frameC = clad * (SKY_AMB * ao + SUN_COL * ndl);
        // En las megatorres el vidrio es casi continuo: sus juntas apenas se marcan.
        if (!wall) frameC = mix(frameC, env * tint, F * mix(0.35, 0.72, big));
        col = mix(frameC, glass * mix(0.66, 1.0, ao), win);
        col = mix(col, vec3(0.07, 0.075, 0.09) * (0.6 + 0.6 * ndl), belt * 0.85);
        col = mix(col, sc * 0.85 + env * 0.1, scr);
        // De día, los remates son metal claro (en los cantos, solo de cerca) y las luces, hilos claros.
        vec3 metal = vec3(0.62, 0.64, 0.68) * (SKY_AMB + SUN_COL * ndl);
        col = mix(col, metal, max(trim * 0.3 * detail, crown * 0.45 * dimY));
        col = mix(col, mix(vGlow, vec3(1.0), 0.55), lights * 0.72);
        glow += vGlow * lights * 0.2;
      }
    }

    vec4 fog = airWith(vW, vTone);
    col = airMix(col, fog);
    gl_FragColor = vec4(xenxoShown(col), 1.0);
    // Con post-proceso, lo que da luz pasa de 1: el resplandor (bloom) lo recoge.
    if (xenxoLinearOut()) gl_FragColor.rgb += glow * (1.0 - fog.a);
    #include <colorspace_fragment>
  }`;

/** Lo que el shader de los edificios compila para cada tipo de pieza con tema (`Part.kind`). */
const KINDS: Record<number, string> = { 5: "K_VOXEL", 6: "K_HOUSE", 7: "K_STACK", 8: "K_ROCK", 9: "K_SHED", 10: "K_PILA" };

/**
 * Los edificios de una ciudad. `rich`: el cristal con todos sus reflejos (escritorio; ver
 * BUILDING_FS). `order`: cuándo se pintan (alrededor de un distrito, después de lo de dentro: casi
 * todo queda tapado y no se sombrea). `themed`: con las piezas con tema (`Part.kind` de 3 en adelante).
 */
export function CityBuildings({ parts, rich, order = 0, themed = false }: { parts: Part[]; rich: boolean; order?: number; themed?: boolean }) {
  const meshes = useMemo(() => {
    // Cada ciudad compila solo lo que usa (la del nexo, nada de esto: `themed`).
    const defines: Record<string, string> = rich ? { RICH: "" } : {};
    if (themed) {
      defines.THEMED = "";
      for (const p of parts) if (p.kind !== undefined && KINDS[p.kind]) defines[KINDS[p.kind]!] = "";
    }
    const material = new THREE.ShaderMaterial({ uniforms: air, defines, vertexShader: BUILDING_VS, fragmentShader: BUILDING_FS });
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const drum = new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1);
    drum.translate(0, 0.5, 0);
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    const build = (geo: THREE.BufferGeometry, list: Part[]) => {
      const tint = new Float32Array(list.length * 3);
      const glow = new Float32Array(list.length * 3);
      const info = new Float32Array(list.length * 4);
      const m = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((p, i) => {
        o.position.set(p.x, p.y, p.z);
        o.rotation.set(0, p.yaw ?? 0, 0);
        o.scale.set(p.w, Math.max(0.1, p.h), p.d);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        col.setHex(p.tint, THREE.SRGBColorSpace);
        tint.set([col.r, col.g, col.b], i * 3);
        col.setHex(p.glow, THREE.SRGBColorSpace);
        glow.set([col.r, col.g, col.b], i * 3);
        info.set([p.seed + (p.face === undefined ? 0 : 1 + p.face), p.kind ?? 0, p.taper ?? 1, p.round ? 1 : 0], i * 4);
      });
      geo.setAttribute("aTint", new THREE.InstancedBufferAttribute(tint, 3));
      geo.setAttribute("aGlow", new THREE.InstancedBufferAttribute(glow, 3));
      geo.setAttribute("aInfo", new THREE.InstancedBufferAttribute(info, 4));
      m.frustumCulled = false;
      m.renderOrder = order;
      return m;
    };
    return { material, list: [build(box, parts.filter((p) => !p.round)), build(drum, parts.filter((p) => p.round))] };
  }, [parts, rich, order, themed]);
  useEffect(
    () => () => {
      for (const m of meshes.list) m.geometry.dispose();
      meshes.material.dispose();
    },
    [meshes],
  );
  return (
    <>
      {meshes.list.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Suelo: avenidas, calles con sus farolas y manzanas, hasta el horizonte */
/* ------------------------------------------------------------------ */

/**
 * El suelo de alrededor de un distrito (`DISTRICT`). Lo primero, su ronda: hasta la primera calle de
 * la ciudad sigue el suelo de losas oscuras de dentro, y solo la cruzan las dos avenidas de los
 * ejes, que salen del distrito. Después, según el tema (`G_STYLE`): 0 = calles de ciudad, 1 = el
 * tablero de Píxel, 2 = patios de fábrica, 3 = solares de tierra, 4 = pueblo y campos, 5 = desierto.
 * Los colores de cada uno llegan como constantes (`G_LAMP`, `G_FAR_D`, `G_FAR_N`).
 */
const APRON = 154;
const DISTRICT_GROUND_GLSL = /* glsl */ `
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  vec3 groundAt(vec3 vW) {
    const vec3 lampC = G_LAMP;
    vec2 q = vW.xz - vec2(${C.toFixed(1)});
    vec2 fq = fwidth(q);
    float mpx = max(fq.x, fq.y);
    float fine = 1.0 - smoothstep(0.7, 2.4, mpx);
    vec2 e = min(fq, vec2(8.0));
    float m = max(abs(q.x), abs(q.y));
    bool night = uNight > 0.5;
    if (m < ${APRON.toFixed(1)}) {
      vec2 ax = 1.0 - smoothstep(vec2(${(ROAD / 2).toFixed(1)}) - e, vec2(${(ROAD / 2).toFixed(1)}) + e, abs(q));
      vec3 col = night ? vec3(0.004, 0.006, 0.012) : vec3(0.034, 0.045, 0.076);
      // Las juntas de las losas (cada 2 m), de cerca.
      vec2 t = abs(fract(q / 2.0) - 0.5);
      col *= 1.0 + 0.45 * fine * step(0.47, max(t.x, t.y));
      col = mix(col, night ? vec3(0.006, 0.007, 0.012) : vec3(0.03, 0.036, 0.055), max(ax.x, ax.y) * 0.6);
      // Las dos líneas de borde de cada avenida.
      vec2 ed = 1.0 - smoothstep(vec2(0.1), vec2(0.1) + e * 0.6, abs(abs(q) - 5.6));
      float line = max(ed.x * step(abs(q.x), 6.5), ed.y * step(abs(q.y), 6.5)) * (1.0 - smoothstep(1.5, 6.0, mpx));
      return col + line * (night ? vec3(0.42, 0.44, 0.48) : vec3(0.5, 0.52, 0.55));
    }
    float grid = 1.0 - smoothstep(5.0, 15.0, mpx);
    vec3 far = night ? G_FAR_N : G_FAR_D;
    if (grid < 0.004) return far;
    // La cuadrícula de calles: distancia al eje de la más cercana (cada ${PITCH} m) y su manzana.
    vec2 a = abs(mod(q + ${(PITCH / 2).toFixed(1)}, ${PITCH.toFixed(1)}) - ${(PITCH / 2).toFixed(1)});
    vec2 rd = 1.0 - smoothstep(vec2(${(ROAD / 2).toFixed(1)}) - e, vec2(${(ROAD / 2).toFixed(1)}) + e, a);
    float road = max(rd.x, rd.y);
    vec2 bid = floor((q + ${(PITCH / 2).toFixed(1)}) / ${PITCH.toFixed(1)});
    float bh = h12(bid + 40.0);
    // Las avenidas (cada ${SUPER} m).
    vec2 av = abs(mod(q + ${(SUPER / 2).toFixed(1)}, ${SUPER.toFixed(1)}) - ${(SUPER / 2).toFixed(1)});
    float avenue = max(1.0 - smoothstep(7.0, 10.0, av.x), 1.0 - smoothstep(7.0, 10.0, av.y));
    // Farolas a los dos lados de la calzada: de cerca, sus charcos; de lejos, la calle encendida.
    float lamps = road * (0.2 + 0.16 * avenue);
    if (night && fine > 0.004) {
      float px = rd.x * smoothstep(3.0, 0.0, length(vec2(a.x - ${(ROAD / 2 - 0.8).toFixed(1)}, mod(vW.z, 16.0) - 8.0)));
      float pz = rd.y * smoothstep(3.0, 0.0, length(vec2(a.y - ${(ROAD / 2 - 0.8).toFixed(1)}, mod(vW.x, 16.0) - 8.0)));
      lamps = mix(lamps, max(px, pz) * 0.9 + road * 0.06, fine);
    }
    float lx = rd.x * (1.0 - rd.y) * step(a.x, 0.2) * step(0.5, fract(vW.z / 6.0));
    float lz = rd.y * (1.0 - rd.x) * step(a.y, 0.2) * step(0.5, fract(vW.x / 6.0));
    float line = max(lx, lz) * fine;
    vec3 col;
    #if G_STYLE == 1
      // El tablero: casillas de 8 m de hierba, caminos de arena por donde irían las calles y alguna
      // manzana de agua. De noche, el tablero a oscuras con sus juntas de neón, hasta el horizonte.
      vec2 tc = floor(q / 8.0), tf = abs(fract(q / 8.0) - 0.5);
      float chk = mod(tc.x + tc.y, 2.0);
      float water = step(0.86, bh) * (1.0 - road);
      // La junta entre casillas: de lejos se dibuja de un píxel, con menos luz (la misma, más repartida).
      float seam = smoothstep(0.48 - mpx / 8.0, 0.48, max(tf.x, tf.y));
      float sm = clamp(0.3 / max(mpx, 0.3), 0.0, 1.0);
      if (night) {
        vec3 tile = mix(vec3(0.012, 0.012, 0.03), vec3(0.02, 0.016, 0.045), chk);
        tile = mix(tile, vec3(0.03, 0.022, 0.05), road);
        tile = mix(tile, vec3(0.006, 0.02, 0.05), water);
        vec3 neon = mix(lampC, vec3(0.2, 0.75, 1.0), max(water, step(0.5, h12(tc * 0.37))));
        col = tile + neon * seam * sm * 0.9;
      } else {
        vec3 grass = mix(vec3(0.17, 0.4, 0.13), vec3(0.22, 0.47, 0.17), chk) * (0.9 + 0.2 * h12(tc + 3.0));
        vec2 pc = floor(q / 4.0);
        vec3 path = mix(vec3(0.62, 0.55, 0.38), vec3(0.7, 0.63, 0.45), mod(pc.x + pc.y, 2.0));
        vec3 sea = mix(vec3(0.1, 0.36, 0.66), vec3(0.14, 0.44, 0.76), chk);
        col = mix(mix(grass, sea, water), path, road) * (1.0 - 0.22 * seam * sm);
      }
    #elif G_STYLE == 4
      // El pueblo y, más allá, los campos: calles de piedra clara, patios de tierra y huertos con
      // sus árboles en fila; lejos, una colcha de sembrados y caminos por donde irían las avenidas.
      float town = 1.0 - smoothstep(430.0, 520.0, length(q));
      vec2 fid = floor(q / vec2(90.0, 70.0) + vec2(vnoise(q / 260.0), vnoise(q.yx / 240.0)) * 1.6);
      float fh = h12(fid + 11.0);
      vec3 field = fh < 0.3 ? vec3(0.56, 0.5, 0.27) : fh < 0.6 ? vec3(0.2, 0.36, 0.14) : fh < 0.82 ? vec3(0.3, 0.34, 0.18) : vec3(0.4, 0.31, 0.21);
      field *= 0.9 + 0.16 * step(0.5, fract((q.x + q.y * (fh - 0.5) * 2.0) / 3.0)) * fine;
      float track = max(1.0 - smoothstep(2.0, 3.5, av.x), 1.0 - smoothstep(2.0, 3.5, av.y));
      field = mix(field, vec3(0.6, 0.53, 0.4), track);
      float grove = step(0.55, bh);
      vec2 tq = mod(q, 7.0) - 3.5;
      float tree = grove * (1.0 - smoothstep(1.6, 2.3, length(tq))) * step(0.25, h12(floor(q / 7.0))) * (1.0 - road) * (1.0 - smoothstep(1.5, 4.0, mpx));
      vec3 yard = mix(vec3(0.5, 0.41, 0.29), vec3(0.3, 0.37, 0.17), grove);
      yard = mix(yard, vec3(0.1, 0.2, 0.07), tree);
      vec3 stone = vec3(0.5, 0.47, 0.41) * (0.92 + 0.12 * h12(floor(q / 1.5)) * fine);
      vec3 day = mix(field, mix(yard, stone, road), town);
      if (night) {
        col = day * vec3(0.03, 0.036, 0.06) + lampC * lamps * 0.75 * town;
      } else col = day;
    #elif G_STYLE == 5
      // Desierto: arena a manchas, roca que asoma y las rodadas de los caminos (por las avenidas).
      float n1 = vnoise(q / 140.0), n2 = vnoise(q / 23.0 + 7.0);
      vec3 sand = mix(vec3(0.5, 0.39, 0.26), vec3(0.62, 0.5, 0.33), n2) * (0.86 + 0.28 * n1);
      sand = mix(sand, vec3(0.33, 0.25, 0.19), smoothstep(0.62, 0.74, n1));
      sand *= 0.96 + 0.08 * sin((q.x + n2 * 14.0) * 1.3) * fine;
      float ring = 1.0 - smoothstep(4.0, 6.5, abs(m - 160.0));
      float track = max(max(1.0 - smoothstep(2.5, 4.5, av.x), 1.0 - smoothstep(2.5, 4.5, av.y)), ring);
      float ruts = max(1.0 - smoothstep(0.3, 0.7, abs(min(av.x, av.y) - 1.4)), 0.0) * fine;
      sand = mix(sand, vec3(0.56, 0.47, 0.35), track * 0.7) * (1.0 - 0.18 * ruts * track);
      if (night) {
        // Balizas a lo largo de los caminos.
        float along = av.x < av.y ? q.y : q.x;
        float dot2 = track * smoothstep(2.2, 0.0, length(vec2(min(av.x, av.y) - 4.2, mod(along, 24.0) - 12.0))) * fine;
        col = sand * vec3(0.035, 0.042, 0.075) + lampC * (dot2 * 0.8 + track * 0.012);
      } else col = sand;
    #else
      // Calles: asfalto, aceras y manzanas (plazas y parques en la ciudad; losas de hormigón y
      // viales con franjas amarillas en las fábricas; tierra y grava en los solares).
      vec2 side = 1.0 - smoothstep(vec2(${(ROAD / 2 + 2.6).toFixed(1)}), vec2(${(ROAD / 2 + 3.2).toFixed(1)}), a);
      float walk = max(side.x, side.y) * (1.0 - road) * fine;
      float tree = 0.0, zebra = 0.0;
      #if G_STYLE == 0
        if (fine > 0.004) {
          vec2 tq = vec2(a.x - ${(ROAD / 2 + 1.5).toFixed(1)}, mod(vW.z, 8.0) - 4.0), tr = vec2(a.y - ${(ROAD / 2 + 1.5).toFixed(1)}, mod(vW.x, 8.0) - 4.0);
          tree = max((1.0 - smoothstep(1.3, 1.9, length(tq))) * step(0.35, h12(floor(vW.zz / 8.0) + bid)), (1.0 - smoothstep(1.3, 1.9, length(tr))) * step(0.35, h12(floor(vW.xx / 8.0) + bid + 9.0))) * (1.0 - road) * fine * G_TREES;
          float zx = rd.x * (1.0 - rd.y) * step(abs(a.y - ${(ROAD / 2 + 1.6).toFixed(1)}), 1.1) * step(0.5, fract(vW.x / 1.2));
          float zz = rd.y * (1.0 - rd.x) * step(abs(a.x - ${(ROAD / 2 + 1.6).toFixed(1)}), 1.1) * step(0.5, fract(vW.z / 1.2));
          zebra = max(zx, zz) * fine;
        }
        vec3 block = mix(G_BLOCK_A, G_BLOCK_B, bh);
        block = mix(block, G_PARK, step(G_PARK_AT, bh));
        block = mix(block, G_WALK, walk * 0.8);
        block = mix(block, vec3(0.07, 0.18, 0.06), tree);
        vec3 asphalt = vec3(0.085, 0.09, 0.105);
        vec3 glowB = vec3(0.1, 0.16, 0.2) * step(0.86, bh) * 0.35;
      #elif G_STYLE == 2
        vec2 sl = abs(fract(q / 6.0) - 0.5);
        vec3 block = mix(vec3(0.3, 0.3, 0.29), vec3(0.23, 0.235, 0.24), bh) * (1.0 - 0.14 * fine * step(0.47, max(sl.x, sl.y)));
        // Algunas, de asfalto, con el borde a franjas amarillas y negras.
        float dark = step(0.62, bh);
        float border = dark * step(min(a.x, a.y), ${(ROAD / 2 + 1.6).toFixed(1)}) * (1.0 - road) * fine;
        block = mix(block, vec3(0.1, 0.1, 0.105), dark);
        block = mix(block, mix(vec3(0.75, 0.6, 0.1), vec3(0.06), step(0.5, fract((q.x + q.y) / 1.6))), border);
        vec3 asphalt = vec3(0.1, 0.1, 0.108);
        // De noche, algún patio con sus focos.
        vec3 glowB = lampC * smoothstep(15.0, 2.0, length(a - vec2(${(PITCH / 2).toFixed(1)}))) * step(bh, 0.4) * 0.12;
      #else
        float dn = vnoise(q / 9.0);
        vec3 block = mix(vec3(0.27, 0.23, 0.18), vec3(0.2, 0.19, 0.17), bh) * (0.85 + 0.3 * dn);
        block = mix(block, vec3(0.36, 0.35, 0.33), step(0.66, vnoise(q / 4.0 + 20.0)) * 0.5 * fine);
        vec3 asphalt = vec3(0.13, 0.13, 0.135) * (0.9 + 0.2 * dn);
        walk = 0.0;
        // De noche, alguna hoguera o una ristra de bombillas en un solar.
        vec3 glowB = vec3(1.0, 0.6, 0.25) * smoothstep(9.0, 1.0, length(a - vec2(${(PITCH / 2).toFixed(1)}) + (vec2(h12(bid), h12(bid + 5.0)) - 0.5) * 12.0)) * step(0.7, bh) * 0.3;
      #endif
      if (night) {
        vec3 base = mix(block * vec3(0.06, 0.068, 0.11), asphalt * vec3(0.38, 0.33, 0.48), road);
        base = mix(base, vec3(0.012, 0.03, 0.016), tree * 0.8);
        col = base + glowB * (1.0 - road) + lampC * lamps * G_LAMPS + (line + zebra * 0.5) * vec3(0.4, 0.32, 0.12);
      } else {
        col = mix(block, asphalt, road) + line * vec3(0.5, 0.45, 0.2) + zebra * vec3(0.4);
      }
    #endif
    return mix(far, col, grid);
  }`;

/**
 * El color del suelo en un punto (sin su aire): lo usan el suelo y las sombras que caen en él. De
 * lejos las calles se funden en su media, y lo que ya no se distingue ni se calcula (el suelo ocupa
 * media pantalla al mirar hacia abajo: cada cuenta de más se paga en todos esos píxeles).
 */
const GROUND_GLSL = /* glsl */ `
  ${AIR_GLSL}
  ${NOISE_GLSL}
  #ifdef DISTRICT
  ${DISTRICT_GROUND_GLSL}
  #else
  vec3 groundAt(vec3 vW) {
    const vec3 lampC = vec3(1.0, 0.62, 0.3);
    vec2 q = vW.xz - vec2(${C.toFixed(1)});
    vec2 fq = fwidth(q);
    // Metros por píxel.
    float mpx = max(fq.x, fq.y);
    float grid = 1.0 - smoothstep(5.0, 15.0, mpx);
    vec3 far = uNight > 0.5 ? vec3(0.03, 0.026, 0.04) + lampC * 0.11 : vec3(0.17, 0.175, 0.19);
    if (grid < 0.004) return far;
    float fine = 1.0 - smoothstep(0.7, 2.4, mpx);
    vec2 e = min(fq, vec2(8.0));
    // Distancia al eje de la calle más cercana (cada ${PITCH} m).
    vec2 a = abs(mod(q + ${(PITCH / 2).toFixed(1)}, ${PITCH.toFixed(1)}) - ${(PITCH / 2).toFixed(1)});
    vec2 rd = 1.0 - smoothstep(vec2(${(ROAD / 2).toFixed(1)}) - e, vec2(${(ROAD / 2).toFixed(1)}) + e, a);
    float road = max(rd.x, rd.y);
    vec2 bid = floor((q + ${(PITCH / 2).toFixed(1)}) / ${PITCH.toFixed(1)});
    float bh = h12(bid + 40.0);
    // Lo que solo se ve de cerca: la línea central, las aceras (los tres metros de manzana junto a
    // la calzada) con un árbol cada ocho metros, y los pasos de cebra de las bocacalles.
    float line = 0.0, walk = 0.0, tree = 0.0, zebra = 0.0;
    if (fine > 0.004) {
      float lx = rd.x * (1.0 - rd.y) * step(a.x, 0.2) * step(0.5, fract(vW.z / 6.0));
      float lz = rd.y * (1.0 - rd.x) * step(a.y, 0.2) * step(0.5, fract(vW.x / 6.0));
      line = max(lx, lz) * fine;
      vec2 side = 1.0 - smoothstep(vec2(${(ROAD / 2 + 2.6).toFixed(1)}), vec2(${(ROAD / 2 + 3.2).toFixed(1)}), a);
      walk = max(side.x, side.y) * (1.0 - road) * fine;
      vec2 tq = vec2(a.x - ${(ROAD / 2 + 1.5).toFixed(1)}, mod(vW.z, 8.0) - 4.0), tr = vec2(a.y - ${(ROAD / 2 + 1.5).toFixed(1)}, mod(vW.x, 8.0) - 4.0);
      tree = max((1.0 - smoothstep(1.3, 1.9, length(tq))) * step(0.35, h12(floor(vW.zz / 8.0) + bid)), (1.0 - smoothstep(1.3, 1.9, length(tr))) * step(0.35, h12(floor(vW.xx / 8.0) + bid + 9.0))) * (1.0 - road) * fine;
      float zx = rd.x * (1.0 - rd.y) * step(abs(a.y - ${(ROAD / 2 + 1.6).toFixed(1)}), 1.1) * step(0.5, fract(vW.x / 1.2));
      float zz = rd.y * (1.0 - rd.x) * step(abs(a.x - ${(ROAD / 2 + 1.6).toFixed(1)}), 1.1) * step(0.5, fract(vW.z / 1.2));
      zebra = max(zx, zz) * fine;
    }
    vec3 col;
    if (uNight > 0.5) {
      // Farolas a los dos lados de la calzada: de cerca, sus charcos; de lejos, la calle encendida
      // (las avenidas, cada ${SUPER} m, algo más).
      vec2 av = abs(mod(q + ${(SUPER / 2).toFixed(1)}, ${SUPER.toFixed(1)}) - ${(SUPER / 2).toFixed(1)});
      float avenue = max(1.0 - smoothstep(7.0, 10.0, av.x), 1.0 - smoothstep(7.0, 10.0, av.y));
      float lamps = road * (0.2 + 0.16 * avenue);
      if (fine > 0.004) {
        float px = rd.x * smoothstep(3.0, 0.0, length(vec2(a.x - ${(ROAD / 2 - 0.8).toFixed(1)}, mod(vW.z, 16.0) - 8.0)));
        float pz = rd.y * smoothstep(3.0, 0.0, length(vec2(a.y - ${(ROAD / 2 - 0.8).toFixed(1)}, mod(vW.x, 16.0) - 8.0)));
        lamps = mix(lamps, max(px, pz) * 0.9 + road * 0.06, fine);
      }
      vec3 base = mix(vec3(0.018, 0.02, 0.036), vec3(0.034, 0.03, 0.05), road);
      // Algún patio o plaza con luz.
      base += vec3(0.1, 0.16, 0.2) * step(0.86, bh) * (1.0 - road) * 0.35;
      base = mix(base, vec3(0.012, 0.03, 0.016), tree * 0.8);
      col = base + lampC * lamps + (line + zebra * 0.5) * vec3(0.4, 0.32, 0.12);
    } else {
      // Al sol: patios y plazas claros, algún parque, aceras, y el asfalto. (La sombra de cada
      // edificio va aparte, encima.)
      vec3 block = mix(vec3(0.24, 0.245, 0.26), vec3(0.34, 0.33, 0.31), bh);
      block = mix(block, vec3(0.13, 0.27, 0.11), step(0.8, bh));
      block = mix(block, vec3(0.42, 0.42, 0.41), walk * 0.8);
      block = mix(block, vec3(0.07, 0.18, 0.06), tree);
      col = mix(block, vec3(0.085, 0.09, 0.105), road) + line * vec3(0.5, 0.45, 0.2) + zebra * vec3(0.4);
    }
    return mix(far, col, grid);
  }
  #endif`;

const GROUND_FS = /* glsl */ `
  varying vec3 vW;
  ${GROUND_GLSL}
  void main() {
    vec3 col = groundAt(vW);
    #ifdef SHADOW
      // A la sombra: menos luz, y la que queda es la del cielo (más azul).
      col *= vec3(0.36, 0.42, 0.55);
    #endif
    gl_FragColor = vec4(xenxoShown(airShown(col, vW)), 1.0);
    #include <colorspace_fragment>
  }`;

/**
 * La sombra de un edificio en el suelo: su misma caja, con lo de arriba llevado al suelo en la
 * dirección del sol. Queda plana, un palmo por encima del suelo, y se pinta como el suelo pero a
 * la sombra (sin transparencias: donde se pisan dos sombras no se oscurece el doble).
 */
const SHADOW_VS = /* glsl */ `
  uniform vec3 uSunDir; uniform float uFloor;
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    w.xz -= uSunDir.xz * ((w.y - uFloor) / uSunDir.y);
    w.y = uFloor + 0.25;
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/** Las sombras de los edificios de las calles, de día (las megatorres no la dan: no se vería entera). */
export function CityShadows({ parts }: { parts: Part[] }) {
  const mesh = useMemo(() => {
    const list = parts.filter((p) => p.shadow);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const m = new THREE.InstancedMesh(
      geo,
      new THREE.ShaderMaterial({ uniforms: air, defines: { SHADOW: "" }, side: THREE.DoubleSide, vertexShader: SHADOW_VS, fragmentShader: GROUND_FS }),
      list.length,
    );
    const o = new THREE.Object3D();
    list.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(0, p.yaw ?? 0, 0);
      o.scale.set(p.w, p.h, p.d);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.frustumCulled = false;
    return m;
  }, [parts]);
  useFrame(() => {
    mesh.visible = air.uNight.value < 0.5;
  });
  useEffect(() => () => dispose(mesh), [mesh]);
  return <primitive object={mesh} />;
}


/** El suelo de alrededor de un distrito: su estilo (ver DISTRICT_GROUND_GLSL) y sus colores, en GLSL. */
export interface GroundLook {
  style: 0 | 1 | 2 | 3 | 4 | 5;
  /** La luz de las farolas (o de las juntas, o de las balizas) y cuánta. */
  lamp?: string;
  lamps?: number;
  /** Lo que se ve de lejos, cuando las calles ya no se distinguen: de día y de noche. */
  far: readonly [string, string];
  /** Calles de ciudad (estilo 0): las manzanas, sus parques (y cuántas lo son: de 0 a 1), las aceras y si hay árboles. */
  blocks?: readonly [string, string];
  park?: string;
  parks?: number;
  walk?: string;
  trees?: boolean;
}

/**
 * El suelo, hasta donde ve la cámara (`far`), a la altura `y`. `order`: como en los edificios (va
 * después de ellos). `look`: el de alrededor de un distrito (sin él, las calles del nexo).
 */
export function CityGround({ far, y, order = 0, look }: { far: number; y: number; order?: number; look?: GroundLook }) {
  const mesh = useMemo(() => {
    const geo = new THREE.PlaneGeometry(far * 2, far * 2);
    geo.rotateX(-Math.PI / 2);
    geo.translate(C, y, C);
    const defines: Record<string, string> = {};
    if (look) {
      Object.assign(defines, {
        DISTRICT: "",
        G_STYLE: String(look.style),
        G_LAMP: look.lamp ?? "vec3(1.0, 0.62, 0.3)",
        G_LAMPS: (look.lamps ?? 1).toFixed(2),
        G_FAR_D: look.far[0],
        G_FAR_N: look.far[1],
        G_BLOCK_A: look.blocks?.[0] ?? "vec3(0.24, 0.245, 0.26)",
        G_BLOCK_B: look.blocks?.[1] ?? "vec3(0.34, 0.33, 0.31)",
        G_PARK: look.park ?? "vec3(0.13, 0.27, 0.11)",
        G_PARK_AT: (1 - (look.parks ?? 0.2)).toFixed(2),
        G_WALK: look.walk ?? "vec3(0.42, 0.42, 0.41)",
        G_TREES: look.trees === false ? "0.0" : "1.0",
      });
    }
    const m = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: air,
        defines,
        vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: GROUND_FS,
      }),
    );
    m.frustumCulled = false;
    // Después de los edificios: casi todo el suelo queda tapado por ellos.
    m.renderOrder = order + 1;
    return m;
  }, [far, y, order, look]);
  useEffect(() => () => dispose(mesh), [mesh]);
  return <primitive object={mesh} />;
}

/* ------------------------------------------------------------------ */
/* Horizonte: donde acaba el suelo, el aire                             */
/* ------------------------------------------------------------------ */

const HORIZON_FS = /* glsl */ `
  varying vec3 vDir;
  ${AIR_GLSL}
  void main() {
    // Por debajo del horizonte, el aire que habría hasta el suelo si no se acabara (más allá del
    // suelo no hay nada): así continúa lo que se ve en su borde. Por encima se va aclarando en
    // unos grados y deja ver el cielo.
    vec3 d = normalize(vDir);
    float reach = (cameraPosition.y - uFloor) / max(-d.y, 0.04);
    vec3 tone = mix(ringTone(cameraPosition + d), airTone(cameraPosition + d * reach), smoothstep(0.0, 0.045, -d.y));
    float a = 1.0 - smoothstep(-0.015, 0.085, d.y);
    gl_FragColor = vec4(xenxoShown(tone), a * a);
    #include <colorspace_fragment>
  }`;

export function CityHorizon({ far }: { far: number }) {
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(
      // Solo la parte de la esfera donde hay algo que pintar: de unos grados sobre el horizonte
      // hacia abajo (el resto sería cielo sombreado dos veces para nada).
      new THREE.SphereGeometry(far * 0.94, 48, 12, 0, Math.PI * 2, Math.PI / 2 - 0.11, Math.PI / 2 + 0.11),
      new THREE.ShaderMaterial({
        uniforms: air,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        // Centrada en quien mira: solo el giro de la vista.
        vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); }`,
        fragmentShader: HORIZON_FS,
      }),
    );
    m.frustumCulled = false;
    // Lo primero de lo transparente: detrás de todo lo demás.
    m.renderOrder = -3;
    return m;
  }, [far]);
  useEffect(() => () => dispose(mesh), [mesh]);
  return <primitive object={mesh} />;
}

function dispose(m: THREE.Mesh | THREE.InstancedMesh) {
  m.geometry.dispose();
  (m.material as THREE.Material).dispose();
}

/**
 * Donde hay una ciudad de decorado se ve hasta el horizonte: la cámara alcanza `far` mientras está
 * montada (en el resto del mundo, lo de siempre).
 */
export function FarView({ far }: { far: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useLayoutEffect(() => {
    const before = camera.far;
    camera.far = far;
    camera.updateProjectionMatrix();
    return () => {
      camera.far = before;
      camera.updateProjectionMatrix();
    };
  }, [camera, far]);
  return null;
}
