/**
 * La ciudad alrededor de cada distrito: lo que se ve más allá de sus calles y parcelas, hasta el
 * horizonte y con el carácter del distrito: rascacielos de cristal y neón en Arcade, megatorres
 * oscuras con pantallas en Distrito Cero, torres de vóxeles sobre un tablero en Píxel, naves,
 * chimeneas, grúas y torres de refrigeración en Taller, las Pilas de caravanas hasta perderse de
 * vista en Vertical, un pueblo encalado entre colinas y campos en Ágora, y mesetas, antenas y un
 * puesto avanzado en el desierto en Frontera.
 *
 * Con las mismas piezas que la megaciudad del nexo (city-kit.tsx): todo instanciado en dos
 * llamadas de dibujo, su suelo, el horizonte y los coches de luz por las avenidas; sin texturas y
 * sin trabajo por frame en la CPU. Su aire es el de city-air.ts (cada torre se pierde en el color
 * que tiene el cielo detrás) y es el mismo que la bruma de dentro del distrito (`districtFog`).
 * Decorado del cliente: no se visita ni se construye, y no tiene colisión. Cuánto relleno hay a lo
 * lejos y cuánto tráfico: `FEATURES.nexoCity` (lo de cerca es igual en todos los niveles).
 *
 * Las calles siguen la cuadrícula de dentro: una cada 40 m y una avenida cada 120, y las de los
 * ejes son la continuación de las avenidas del distrito; al fondo de cada una hay un hito que se
 * reconoce de lejos. Lo primero, tras la ronda que rodea al distrito, está a unos 40 m de donde
 * se puede andar. Nunca dos caras en el mismo plano (a un kilómetro el búfer de profundidad no las
 * separa).
 */
import { useMemo } from "react";
import { CHUNK_SIZE } from "@xenxo/protocol";
import districts from "../../../realtime/src/districts.json";
import { usePlaceTheme } from "../net/world-store";
import { DISTRICT_VIEW, NEON, rng, type AirLook } from "./city-air";
import { CityBuildings, CityGround, CityHorizon, FarView, GLASS, megatower, PITCH, pick, RED, ROAD, STREET, SUPER, valueNoise, type GroundLook, type Part, type Rand } from "./city-kit";
import { CarsMesh, CityClock, type Car } from "./NexoCity";
import type { Ambience } from "./graphics";
import type * as THREE from "three";

const C = CHUNK_SIZE / 2;
/** El suelo de la ciudad: un poco por debajo del del distrito (dentro no se ve). */
const FLOOR: number = DISTRICT_VIEW.floor;
const BLOCK = PITCH - ROAD;
/** Se pinta después de lo de dentro del distrito: casi todo queda tapado y no se sombrea. */
const ORDER = 2;
/** Hasta dónde hay edificios (más allá, el aire ya no deja ver nada). */
const REACH = 1260;
/** A cuánto del centro está el hito del fondo de cada avenida de los ejes (siete avenidas más allá). */
const MARK = SUPER * 7;

type Base = Pick<Part, "tint" | "glow" | "seed">;
const seedOf = (r: Rand) => 0.02 + r() * 0.96;
/** Hasta dónde llega lo que se dibuja pieza a pieza: en el nivel ligero (gafas y móviles), menos. */
const nearBy = (density: number, r: number) => (density < 0.75 ? r * 0.8 : r);

/**
 * Qué anillo de manzanas es: el distrito (256 m) pisa del 0 al 3 en cada eje; el 3 es su ronda, que
 * se queda sin edificios, y la ciudad empieza en el 4.
 */
const ringOf = (i: number) => (i >= 0 ? i : -i - 1);
const outside = (i: number, j: number) => Math.max(ringOf(i), ringOf(j)) >= 4;

interface Block {
  i: number;
  j: number;
  /** Su esquina y su centro. */
  x0: number;
  z0: number;
  cx: number;
  cz: number;
  /** A cuánto está del centro del distrito. */
  dist: number;
  r: Rand;
}

/** Las manzanas (de 28 m, entre calles) de fuera del distrito, hasta `reach` m. Cada una, con su azar. */
function eachBlock(reach: number, salt: number, fn: (b: Block) => void) {
  const m = Math.ceil(reach / PITCH);
  for (let i = -m; i < m; i++) {
    for (let j = -m; j < m; j++) {
      const x0 = C + i * PITCH + ROAD / 2, z0 = C + j * PITCH + ROAD / 2;
      const cx = x0 + BLOCK / 2, cz = z0 + BLOCK / 2;
      const dist = Math.hypot(cx - C, cz - C);
      if (!outside(i, j) || dist > reach) continue;
      fn({ i, j, x0, z0, cx, cz, dist, r: rng((Math.imul(i + 211, 83492791) ^ Math.imul(j + 157, 2971215073) ^ salt) >>> 0) });
    }
  }
}

interface Super extends Block {
  /** De las primeras que rodean al distrito. */
  first: boolean;
  /** Da a una de las dos avenidas de los ejes. */
  canyon: boolean;
}

/**
 * Las supermanzanas (tres manzanas de lado, entre avenidas) cuya manzana central queda fuera del
 * distrito, sin las que ocupa un hito (`marks`).
 */
function eachSuper(reach: number, salt: number, marks: readonly Mark[], fn: (s: Super) => void) {
  const n = Math.ceil(reach / SUPER);
  for (let i = -n; i < n; i++) {
    for (let j = -n; j < n; j++) {
      const cx = C + (i + 0.5) * SUPER, cz = C + (j + 0.5) * SUPER;
      const dist = Math.hypot(cx - C, cz - C);
      if (!outside(3 * i + 1, 3 * j + 1) || dist > reach) continue;
      if (marks.some((m) => Math.hypot(cx - m.x, cz - m.z) < m.clear + 50)) continue;
      const first = Math.max(ringOf(3 * i + 1), ringOf(3 * j + 1)) === 4;
      const r = rng((Math.imul(i + 97, 73856093) ^ Math.imul(j + 131, 19349663) ^ salt) >>> 0);
      fn({ i, j, x0: cx - SUPER / 2, z0: cz - SUPER / 2, cx, cz, dist, r, first, canyon: i === 0 || i === -1 || j === 0 || j === -1 });
    }
  }
}

interface Mark {
  x: number;
  z: number;
  /** Lo que ocupa: nada más se pone a menos de esto. */
  clear: number;
}
/** Los cuatro fondos de avenida: norte, este, sur y oeste. */
const ENDS = [
  { x: C, z: C - MARK },
  { x: C + MARK, z: C },
  { x: C, z: C + MARK },
  { x: C - MARK, z: C },
] as const;

interface Theme {
  /** Su aire y la luz de sus calles. */
  look?: AirLook;
  ground: GroundLook;
  /** Cuánto tráfico por las avenidas, a lo lejos. */
  cars: number;
  build: (color: number, density: number) => Part[];
}

/* ------------------------------------------------------------------ */
/* Una ciudad de torres (Arcade, Distrito Cero)                          */
/* ------------------------------------------------------------------ */

interface CityOpt {
  seed: number;
  /** Cristales de las megatorres y revestimientos de los edificios de las calles. */
  glass: readonly number[];
  street: readonly number[];
  glows: readonly number[];
  /** Edificios de las calles: altura mínima, lo que se sortea y lo que crecen al alejarse; y hasta dónde llegan. */
  low: readonly [number, number, number];
  lowR: number;
  /** Cuántos llevan un luminoso en la fachada (de 0 a 1). */
  signs: number;
  /** Megatorres: altura de base, lo que añaden los grupos de torres altas, la de la primera fila, cuántas hay y sus formas. */
  mega: { base: number; gain: number; first: number; fill: number; forms: readonly number[] };
  /** Los cuatro hitos: altura y forma de cada uno (norte, este, sur, oeste). */
  ends: readonly (readonly [number, number])[];
}

/** Un luminoso en una fachada del edificio (de `w` × `h` × `d`, en x, z): una banda vertical, sin letras. */
function facadeSign(out: Part[], r: Rand, x: number, z: number, w: number, h: number, d: number, glows: readonly number[]) {
  const onX = r() < 0.5, side = r() < 0.5 ? -1 : 1;
  const face = onX ? d : w;
  const sw = Math.min(face - 2, 2.6 + r() * 3.4), sh = h * (0.28 + r() * 0.3);
  if (sw < 2 || sh < 6) return;
  const off = (r() - 0.5) * (face - sw - 1.5);
  const y = FLOOR + h * (0.22 + r() * 0.3);
  const base = { tint: pick(r, glows), glow: pick(r, glows), seed: seedOf(r), kind: 4 as const };
  if (onX) out.push({ ...base, x: x + side * (w / 2 + 0.3), y, z: z + off, w: 0.5, h: sh, d: sw });
  else out.push({ ...base, x: x + off, y, z: z + side * (d / 2 + 0.3), w: sw, h: sh, d: 0.5 });
}

function towerCity(out: Part[], o: CityOpt, density: number) {
  const noise = valueNoise(o.seed);
  const taken = new Set<string>();
  // Los hitos, al fondo de las avenidas de los ejes.
  const marks: Mark[] = ENDS.map((e, k) => {
    const r = rng(o.seed * 7 + k);
    const [H, form] = o.ends[k]!;
    const base = { tint: pick(r, o.glass), glow: o.glows[0]!, seed: seedOf(r) };
    megatower(out, r, e.x, e.z, H, 104, form, base, FLOOR);
    out.push({ ...base, x: e.x, y: FLOOR, z: e.z, w: 150, h: 34, d: 150, taper: 0.86 });
    return { ...e, clear: 110 };
  });
  eachSuper(REACH, o.seed, marks, ({ i, j, cx, cz, dist, r, first, canyon }) => {
    const fill = canyon ? 0.92 : o.mega.fill - 0.26 * Math.min(1, dist / 1300);
    const there = r() < fill;
    const cluster = noise((cx - C) / 430 + 7.3, (cz - C) / 430 + 1.9);
    let H = o.mega.base + o.mega.gain * Math.pow(cluster, 1.5) * (0.7 + r() * 0.6);
    // Las de la primera fila, esbeltas y más bajas: enmarcan el distrito sin echarse encima.
    if (first) H = o.mega.first * (0.62 + r() * 0.38);
    else if (dist < 420) H = Math.min(H, o.mega.first * 1.9 + r() * 60);
    const F = first ? 24 + r() * 4 : Math.min(80, 36 + H * 0.075 + r() * 14);
    const x = cx + (first ? 0 : (r() - 0.5) * 16), z = cz + (first ? 0 : (r() - 0.5) * 16);
    const form = pick(r, o.mega.forms);
    const base = { tint: pick(r, o.glass), glow: pick(r, o.glows), seed: seedOf(r) };
    if (there) {
      megatower(out, r, x, z, H, F, (form === 6 && dist < 420) || (first && form === 2) ? 3 : form, base, FLOOR);
      if (!first && r() < 0.55) out.push({ ...base, x, y: FLOOR, z, w: F * 1.16 + 5, h: 13 + r() * 15, d: F * 1.16 + 5 });
      const reach = F > 44 ? 1 : 0;
      for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) taken.add(`${3 * i + 1 + a},${3 * j + 1 + b}`);
    }
    // Relleno entre megatorres, lejos de las calles que se ven una a una. Cuánto, según el nivel.
    if (dist > o.lowR + 70) {
      const want = density * (dist > 900 ? 1.7 : 4.4) + r();
      const spots = [[-1, -1], [1, 1], [-1, 1], [1, -1], [0, -1], [0, 1], [-1, 0], [1, 0]] as const;
      const start = Math.floor(r() * 8);
      for (let k = 0; k < Math.min(8, Math.floor(want)); k++) {
        const s = spots[(start + k) % 8]!;
        out.push({ tint: pick(r, o.street), glow: pick(r, o.glows), seed: seedOf(r), x: cx + s[0] * PITCH + (r() - 0.5) * 4, y: FLOOR, z: cz + s[1] * PITCH + (r() - 0.5) * 4, w: 22 + r() * 8, h: 34 + Math.pow(r(), 2.2) * 110, d: 22 + r() * 8 });
      }
    }
  });
  // La ciudad de las calles, alrededor del distrito: de una a tres torres por manzana. De cerca,
  // muro cortina, lamas o vidrio (las ventanas sueltas, a esa distancia, quedan toscas).
  eachBlock(o.lowR, o.seed, ({ i, j, x0, z0, cx, cz, dist, r }) => {
    if (taken.has(`${i},${j}`)) return;
    const far = Math.min(1, Math.max(0, (dist - 170) / 260));
    const towers = 1 + Math.floor(r() * 3);
    if (r() < 0.12) {
      out.push({ tint: pick(r, o.street), glow: pick(r, o.glows), seed: seedOf(r), x: cx, y: FLOOR, z: cz, w: BLOCK - 3, h: 7 + r() * 10, d: BLOCK - 3, face: 0 });
      return;
    }
    for (let k = 0; k < towers; k++) {
      const w = 7 + r() * (BLOCK / towers - 8);
      const d = 8 + r() * (BLOCK - 10);
      const x = x0 + (BLOCK / towers) * k + w / 2 + 0.6;
      const z = z0 + d / 2 + r() * (BLOCK - d - 1);
      const h = o.low[0] + Math.pow(r(), 1.4) * (o.low[1] + far * o.low[2]);
      const base: Part = { tint: pick(r, o.street), glow: pick(r, o.glows), seed: seedOf(r), x, y: FLOOR, z, w, h, d };
      if (dist < 300) base.face = pick(r, [0, 0, 1, 3] as const);
      out.push(base);
      if (h > 30 && r() < 0.3 && w > 9 && d > 9) out.push({ ...base, y: FLOOR + h - 2, w: w * 0.62, h: 6 + r() * 10, d: d * 0.62 });
      else if (r() < 0.22) out.push({ ...base, face: undefined, y: FLOOR + h, w: 0.9, h: 0.9, d: 0.9, kind: 1, tint: RED });
      if (r() < o.signs) facadeSign(out, r, x, z, w, h, d, o.glows);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Píxel: torres de vóxeles                                              */
/* ------------------------------------------------------------------ */

/** Colores de bloque (los del distrito, más algún blanco y algún turquesa). */
const VOXEL = [0xff4fd8, 0x4fa3ff, 0xffd54f, 0x6dff8a, 0xff7a45, 0xa26bff, 0x36d9ff, 0xf2f2f6, 0xff5d6c, 0x48d6b0] as const;

/** Figuras de píxeles (sin imitar a ninguna de nadie): corazón, estrella, gema, rayo, corona y moneda. */
const SPRITES: readonly (readonly [number, readonly string[]])[] = [
  [0xff4f6d, [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."]],
  [0xffd54f, ["...#...", "...#...", "#######", ".#####.", "..###..", ".##.##.", ".#...#."]],
  [0x36d9ff, [".#####.", "#######", ".#####.", "..###..", "...#..."]],
  [0xfff06a, ["..##.", ".##..", "####.", "..##.", ".##..", "##...", "#...."]],
  [0xffb02e, ["#.#.#.#", "#.#.#.#", "#######", "#######"]],
  [0xffd54f, [".####.", "######", "######", "######", "######", ".####."]],
];

/** Una figura de píxeles de pie en (x, y, z), mirando al distrito: un luminoso liso por cada tramo de cada fila. */
function sprite(out: Part[], r: Rand, x: number, y: number, z: number, px: number) {
  const [color, rows] = pick(r, SPRITES);
  const yaw = Math.atan2(C - x, C - z);
  const cols = rows[0]!.length;
  const seed = seedOf(r);
  rows.forEach((row, k) => {
    let a = 0;
    while (a < cols) {
      if (row[a] !== "#") {
        a++;
        continue;
      }
      let b = a;
      while (b < cols && row[b] === "#") b++;
      const lx = ((a + b) / 2 - cols / 2) * px;
      out.push({ kind: 4, tint: color, glow: color, seed, x: x + lx * Math.cos(yaw), y: y + (rows.length - 1 - k) * px, z: z - lx * Math.sin(yaw), w: (b - a) * px, h: px, d: px * 0.7, yaw });
      a = b;
    }
  });
}

/**
 * Una torre de vóxeles: cuerpos apilados que se van metiendo de cubo en cubo (de `S` m), con alguna
 * figura encima. Devuelve hasta dónde llega.
 */
function voxelTower(out: Part[], r: Rand, x: number, z: number, cells: number, H: number, S: number, base: Base, figure: number): number {
  let w = cells * S, d = Math.max(2, cells - Math.floor(r() * 2)) * S;
  let y = FLOOR;
  while (y - FLOOR < H && w >= S && d >= S) {
    const h = Math.min(S * (2 + Math.floor(r() * 5)), H - (y - FLOOR) + S);
    out.push({ ...base, kind: 5, x, y, z, w, h, d });
    y += h;
    // Unas veces se mete por los cuatro lados; otras, solo por dos.
    const k = r();
    if (k < 0.6) {
      w -= 2 * S;
      d -= 2 * S;
    } else if (k < 0.8) w -= 2 * S;
    else d -= 2 * S;
  }
  if (r() < figure) sprite(out, r, x, y + S * 0.4, z, S * (H > 120 ? 1.5 : 0.75));
  else if (r() < 0.3) out.push({ ...base, kind: 1, tint: RED, x, y, z, w: 1.2, h: 1.2, d: 1.2 });
  return y;
}

function voxelCity(out: Part[], color: number, density: number) {
  const noise = valueNoise(424);
  const taken = new Set<string>();
  // Los hitos: cuatro zigurats de cubos enormes, cada uno con su figura.
  const marks: Mark[] = ENDS.map((e, k) => {
    const r = rng(4240 + k);
    const tint = [0xff4fd8, 0x4fa3ff, 0x6dff8a, 0xffd54f][k]!;
    let w = 176, y = FLOOR;
    for (let t = 0; t < 6 && w >= 32; t++) {
      const h = 48 + (t % 2) * 16;
      out.push({ kind: 5, tint, glow: color, seed: seedOf(r), x: e.x, y, z: e.z, w, h, d: w });
      y += h;
      w -= 32;
    }
    sprite(out, r, e.x, y + 10, e.z, 14);
    return { ...e, clear: 130 };
  });
  eachSuper(REACH, 424, marks, ({ i, j, cx, cz, dist, r, first }) => {
    const cluster = noise((cx - C) / 430 + 3.1, (cz - C) / 430 + 8.4);
    const there = r() < 0.7 - 0.2 * Math.min(1, dist / 1300);
    let H = 70 + 330 * Math.pow(cluster, 1.5) * (0.7 + r() * 0.6);
    if (first) H = 60 + r() * 50;
    else if (dist < 420) H = Math.min(H, 190);
    const base = { tint: pick(r, VOXEL), glow: r() < 0.5 ? color : pick(r, VOXEL), seed: seedOf(r) };
    if (there) {
      // Las grandes, de cubos de 8 m (cuerpos de más de 64 m: el shader lo sabe por su altura).
      const S = first ? 4 : 8;
      const cells = first ? 5 + Math.floor(r() * 2) : 5 + Math.floor(r() * 4);
      voxelTower(out, r, cx, cz, cells, H, S, base, 0.3);
      const reach = cells * S > 44 ? 1 : 0;
      for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) taken.add(`${3 * i + 1 + a},${3 * j + 1 + b}`);
    }
    if (dist > 500) {
      const want = density * (dist > 900 ? 1.5 : 3.6) + r();
      const spots = [[-1, -1], [1, 1], [-1, 1], [1, -1], [0, -1], [0, 1], [-1, 0], [1, 0]] as const;
      const start = Math.floor(r() * 8);
      for (let k = 0; k < Math.min(8, Math.floor(want)); k++) {
        const s = spots[(start + k) % 8]!;
        const h = 4 * Math.round((24 + Math.pow(r(), 2) * 90) / 4);
        out.push({ kind: 5, tint: pick(r, VOXEL), glow: color, seed: seedOf(r), x: cx + s[0] * PITCH, y: FLOOR, z: cz + s[1] * PITCH, w: 4 * (4 + Math.floor(r() * 3)), h, d: 4 * (4 + Math.floor(r() * 3)) });
      }
    }
  });
  eachBlock(430, 424, ({ i, j, x0, z0, cx, cz, dist, r }) => {
    if (taken.has(`${i},${j}`)) return;
    const far = Math.min(1, Math.max(0, (dist - 170) / 260));
    // Alguna manzana, libre (el tablero); las demás, con una torre grande o dos menores.
    const k = r();
    if (k < 0.14) return;
    const base = () => ({ tint: pick(r, VOXEL), glow: r() < 0.5 ? color : pick(r, VOXEL), seed: seedOf(r) });
    if (k < 0.6) voxelTower(out, r, cx, cz, 4 + Math.floor(r() * 3), 20 + Math.pow(r(), 1.3) * (36 + far * 60), 4, base(), 0.22);
    else {
      voxelTower(out, r, x0 + 6, z0 + 8 + r() * 12, 3, 16 + r() * (24 + far * 40), 4, base(), 0.12);
      voxelTower(out, r, x0 + 22, z0 + 8 + r() * 12, 3, 12 + r() * (30 + far * 40), 4, base(), 0.12);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Taller: un polígono industrial                                        */
/* ------------------------------------------------------------------ */

const STEEL = [0x6f7a88, 0x808a96, 0x5d6672, 0x8f949c, 0x7a8478, 0x8c7f70, 0x66707e] as const;
const CONCRETE = [0xb9b6ad, 0xa9a8a2, 0xc4bfb2] as const;
const SAFETY = 0xe8b020;
const SODIUM = 0xffa040;

/** Una nave de chapa con su cubierta a dos aguas. */
function shed(out: Part[], r: Rand, x: number, z: number, w: number, d: number, h: number, turn = false) {
  const tint = pick(r, STEEL), seed = seedOf(r);
  const yaw = turn ? Math.PI / 2 : 0;
  out.push({ kind: 9, tint, glow: SODIUM, seed, x, y: FLOOR, z, w, h, d, yaw });
  out.push({ kind: 3, tint: 0x565d68, glow: SODIUM, seed, x, y: FLOOR + h - 0.1, z, w: w + 0.9, h: 1.6 + w * 0.07, d: d + 0.9, taper: -0.03, yaw });
}

/** Una chimenea con sus bandas rojas y blancas y su baliza. */
function chimney(out: Part[], r: Rand, x: number, z: number, h: number, dia: number) {
  out.push({ kind: 7, round: true, tint: pick(r, CONCRETE), glow: 0xd8402c, seed: seedOf(r), x, y: FLOOR, z, w: dia, h, d: dia, taper: 0.55 });
  out.push({ kind: 1, tint: RED, glow: RED, seed: seedOf(r), x, y: FLOOR + h, z, w: 1.4, h: 1.4, d: 1.4 });
}

/** Un depósito con su techo cónico. */
function tank(out: Part[], r: Rand, x: number, z: number, dia: number, h: number) {
  const tint = pick(r, [0xd8dadc, 0xc9ccd0, 0xb8c4b4, 0xd6cfc0] as const), seed = seedOf(r);
  out.push({ kind: 3, round: true, tint, glow: SODIUM, seed, x, y: FLOOR, z, w: dia, h, d: dia });
  out.push({ kind: 3, round: true, tint, glow: SODIUM, seed, x, y: FLOOR + h - 0.05, z, w: dia * 0.98, h: dia * 0.13, d: dia * 0.98, taper: 0.08 });
}

/** Una grúa torre: mástil, pluma con su contrapeso, cabina y baliza. */
function crane(out: Part[], r: Rand, x: number, z: number, H: number, L: number) {
  const yaw = r() * Math.PI * 2, seed = seedOf(r);
  const dx = Math.cos(yaw), dz = -Math.sin(yaw);
  const base = { kind: 3 as const, tint: SAFETY, glow: SAFETY, seed };
  out.push({ ...base, x, y: FLOOR, z, w: 1.7, h: H, d: 1.7 });
  out.push({ ...base, x: x + dx * L * 0.28, y: FLOOR + H - 2.2, z: z + dz * L * 0.28, w: L, h: 1.4, d: 1.4, yaw });
  out.push({ ...base, tint: 0x7a7f88, x: x - dx * L * 0.2, y: FLOOR + H - 4.6, z: z - dz * L * 0.2, w: 4.5, h: 2.6, d: 2.6, yaw });
  out.push({ ...base, tint: 0xe9e4d4, x: x + dx * 2.2, y: FLOOR + H - 4.4, z: z + dz * 2.2, w: 2.4, h: 2.3, d: 2, yaw });
  out.push({ ...base, x, y: FLOOR + H - 0.6, z, w: 1.1, h: 6, d: 1.1, taper: 0.3 });
  out.push({ kind: 1, tint: RED, glow: RED, seed, x, y: FLOOR + H + 5.4, z, w: 1.2, h: 1.2, d: 1.2 });
}

/** Una torre de refrigeración: se estrecha y, arriba, vuelve a abrirse. */
function coolingTower(out: Part[], r: Rand, x: number, z: number, D: number, H: number) {
  const tint = pick(r, CONCRETE), seed = seedOf(r);
  out.push({ kind: 3, round: true, tint, glow: SODIUM, seed, x, y: FLOOR, z, w: D, h: H * 0.72, d: D, taper: 0.6 });
  out.push({ kind: 3, round: true, tint, glow: SODIUM, seed, x, y: FLOOR + H * 0.72 - 0.4, z, w: D * 0.6, h: H * 0.28 + 0.4, d: D * 0.6, taper: 1.16 });
}

/** Columnas de destilación con sus plataformas y una antorcha encendida. */
function refinery(out: Part[], r: Rand, x: number, z: number, scale: number) {
  const n = 3 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const dia = (3.5 + r() * 3.5) * scale, h = (26 + r() * 46) * scale;
    const px = x + (k - (n - 1) / 2) * 7.5 * scale, pz = z + (r() - 0.5) * 9 * scale;
    out.push({ kind: 2, round: true, tint: 0xc9ccd0, glow: SODIUM, seed: seedOf(r), x: px, y: FLOOR, z: pz, w: dia, h, d: dia });
    out.push({ kind: 2, round: true, tint: 0x8a8f99, glow: SODIUM, seed: seedOf(r), x: px, y: FLOOR + h * (0.45 + r() * 0.3), z: pz, w: dia * 1.5, h: 0.8 * scale, d: dia * 1.5 });
  }
  const fh = (58 + r() * 30) * scale;
  const fx = x + (n / 2 + 1) * 7.5 * scale;
  out.push({ kind: 2, tint: 0x8a8f99, glow: SODIUM, seed: seedOf(r), x: fx, y: FLOOR, z, w: 1.2 * scale, h: fh, d: 1.2 * scale, taper: 0.5 });
  out.push({ kind: 4, tint: 0xff8a2c, glow: 0xff8a2c, seed: seedOf(r), x: fx, y: FLOOR + fh, z, w: 2.2 * scale, h: 5 * scale, d: 2.2 * scale, taper: 0.2 });
}

/** Una grúa pórtico con su carro, sobre un patio de contenedores (bloques de colores). */
function gantry(out: Part[], r: Rand, x: number, z: number, span: number, H: number, turn: boolean) {
  const yaw = turn ? Math.PI / 2 : 0, seed = seedOf(r);
  const dx = turn ? 0 : 1, dz = turn ? -1 : 0;
  const tint = pick(r, [SAFETY, 0xd8402c, 0x3f7fc8] as const);
  const base = { kind: 3 as const, tint, glow: SODIUM, seed };
  for (const s of [-1, 1]) for (const t of [-1, 1]) out.push({ ...base, x: x + dx * s * span * 0.5 - dz * t * H * 0.09, y: FLOOR, z: z + dz * s * span * 0.5 + dx * t * H * 0.09, w: H * 0.035, h: H, d: H * 0.035, yaw });
  out.push({ ...base, x, y: FLOOR + H - H * 0.07, z, w: span * 1.25, h: H * 0.06, d: H * 0.22, yaw });
  out.push({ ...base, tint: 0x4a4f58, x: x + dx * span * 0.2, y: FLOOR + H - H * 0.2, z: z + dz * span * 0.2, w: H * 0.12, h: H * 0.09, d: H * 0.16, yaw });
  out.push({ kind: 1, tint: RED, glow: RED, seed, x, y: FLOOR + H, z, w: 1.4, h: 1.4, d: 1.4 });
  const cols = [0xc8553a, 0x3f6fa8, 0x4f8a5c, 0xd9a431, 0x8d949c, 0xa8402e] as const;
  for (let k = 0; k < 5; k++) {
    const cw = 12.2, ch = 2.6 * (1 + Math.floor(r() * 4));
    out.push({ kind: 3, tint: pick(r, cols), glow: SODIUM, seed: seedOf(r), x: x + dx * (k - 2) * span * 0.16 + dz * 0, y: FLOOR, z: z + dz * (k - 2) * span * 0.16, w: turn ? 7.4 : cw, h: ch, d: turn ? cw : 7.4 });
  }
}

function industry(out: Part[], density: number) {
  const taken = new Set<string>();
  // Los hitos: cuatro torres de refrigeración al norte, una gran grúa pórtico al este, la chimenea
  // más alta al sur y una refinería al oeste.
  const marks: Mark[] = ENDS.map((e, k) => {
    const r = rng(7100 + k);
    if (k === 0) for (const [ax, az] of [[-70, -40], [70, -40], [-70, 60], [70, 60]] as const) coolingTower(out, r, e.x + ax, e.z + az, 104, 190 + r() * 30);
    else if (k === 1) gantry(out, r, e.x, e.z, 150, 210, true);
    else if (k === 2) {
      chimney(out, r, e.x, e.z, 330, 26);
      shed(out, r, e.x - 62, e.z + 10, 76, 110, 34);
      shed(out, r, e.x + 62, e.z + 10, 76, 110, 30);
    } else {
      refinery(out, r, e.x, e.z - 30, 3.4);
      refinery(out, r, e.x + 10, e.z + 44, 2.8);
    }
    return { ...e, clear: 130 };
  });
  eachSuper(REACH, 71, marks, ({ i, j, cx, cz, dist, r, first }) => {
    const there = r() < 0.72 - 0.25 * Math.min(1, dist / 1300);
    const big = first ? 0.55 : 1 + Math.min(1, dist / 800) * 0.5;
    if (there) {
      const k = r();
      if (k < 0.3) {
        coolingTower(out, r, cx - 28 * big, cz, 46 * big, (74 + r() * 30) * big);
        if (!first) coolingTower(out, r, cx + 28 * big, cz + (r() - 0.5) * 20, 46 * big, (70 + r() * 30) * big);
      } else if (k < 0.5) {
        chimney(out, r, cx + 20 * big, cz - 16 * big, (110 + r() * 80) * big, 9 * big);
        shed(out, r, cx - 6 * big, cz + 6 * big, 44 * big, 60 * big, 20 * big);
      } else if (k < 0.68) gantry(out, r, cx, cz, 62 * big, 70 * big, r() < 0.5);
      else if (k < 0.84) refinery(out, r, cx - 10 * big, cz, 1.5 * big);
      else {
        shed(out, r, cx, cz - 16 * big, 70 * big, 34 * big, 22 * big, true);
        shed(out, r, cx, cz + 22 * big, 70 * big, 30 * big, 18 * big, true);
      }
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) taken.add(`${3 * i + 1 + a},${3 * j + 1 + b}`);
    }
    // Relleno a lo lejos: naves y depósitos sueltos. Cuántos, según el nivel.
    if (dist > 500) {
      const want = density * (dist > 900 ? 1.4 : 3.2) + r();
      const spots = [[-1, -1], [1, 1], [-1, 1], [1, -1], [0, -1], [0, 1], [-1, 0], [1, 0]] as const;
      const start = Math.floor(r() * 8);
      for (let k = 0; k < Math.min(8, Math.floor(want)); k++) {
        const s = spots[(start + k) % 8]!;
        const x = cx + s[0] * PITCH, z = cz + s[1] * PITCH;
        if (r() < 0.6) out.push({ kind: 9, tint: pick(r, STEEL), glow: SODIUM, seed: seedOf(r), x, y: FLOOR, z, w: 24 + r() * 4, h: 9 + r() * 14, d: 20 + r() * 8 });
        else if (r() < 0.6) out.push({ kind: 3, round: true, tint: 0xd0d2d4, glow: SODIUM, seed: seedOf(r), x, y: FLOOR, z, w: 18 + r() * 8, h: 10 + r() * 12, d: 18 + r() * 8 });
        else chimney(out, r, x, z, 50 + r() * 70, 5 + r() * 2);
      }
    }
  });
  eachBlock(nearBy(density, 440), 71, ({ i, j, x0, z0, cx, cz, r }) => {
    if (taken.has(`${i},${j}`)) return;
    const k = r();
    if (k < 0.34) {
      // Una nave, a veces con su anexo y su chimenea.
      const turn = r() < 0.5;
      shed(out, r, cx - 3, cz, 18 + r() * 4, 22 + r() * 4, 8 + r() * 5, turn);
      if (r() < 0.45) chimney(out, r, x0 + BLOCK - 3.5, z0 + 4 + r() * 20, 30 + r() * 38, 3 + r() * 1.4);
    } else if (k < 0.54) {
      const dia = 9 + r() * 3, h = 8 + r() * 7;
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) if (r() < 0.85) tank(out, r, cx + a * 6.8, cz + b * 6.8, dia, h * (0.8 + r() * 0.4));
    } else if (k < 0.68) {
      // Silos en fila con su galería encima.
      const n = 3 + Math.floor(r() * 2), h = 18 + r() * 8;
      for (let s = 0; s < n; s++) out.push({ kind: 3, round: true, tint: 0xcfd1d4, glow: SODIUM, seed: seedOf(r), x: cx + (s - (n - 1) / 2) * 6.4, y: FLOOR, z: cz - 4, w: 6, h, d: 6 });
      out.push({ kind: 9, tint: pick(r, STEEL), glow: SODIUM, seed: seedOf(r), x: cx, y: FLOOR + h - 0.3, z: cz - 4, w: n * 6.4, h: 3.2, d: 3.4 });
      shed(out, r, cx, cz + 8, 20, 9, 6 + r() * 3, true);
    } else if (k < 0.8) {
      shed(out, r, cx + 4, cz + 3, 16, 18, 7 + r() * 3);
      crane(out, r, x0 + 5, z0 + 5, 34 + r() * 26, 26 + r() * 10);
    } else if (k < 0.9) refinery(out, r, cx - 6, cz, 0.62);
    // El resto, patios vacíos (los pinta el suelo).
  });
}

/* ------------------------------------------------------------------ */
/* Vertical: las Pilas, hasta el horizonte                               */
/* ------------------------------------------------------------------ */

const CARAVAN = [0xb9b2a4, 0xc8bfae, 0xa6a39a, 0xd9c6a8, 0x8f9aa3, 0xc0a080, 0xb07d5e, 0x7f9488, 0xd8d4c8] as const;
/** Lo que mide un piso de una pila (el alto de una caravana y su hueco). */
const FLOOR_H = 2.9;

/**
 * Una pila de cerca, con sus caravanas una a una: una por piso, cada una girada un cuarto de vuelta
 * respecto a la de debajo y arrimada a un lado de su andamio, y una plataforma cada dos pisos.
 */
function pila(out: Part[], r: Rand, x: number, z: number, floors: number, color: number) {
  const top = floors * FLOOR_H;
  const seed = seedOf(r);
  for (const [px, pz] of [[-5.6, -4.1], [5.6, -4.1], [-5.6, 4.1], [5.6, 4.1]] as const) out.push({ kind: 2, tint: 0x596070, glow: color, seed, x: x + px, y: FLOOR, z: z + pz, w: 0.36, h: top + 0.9, d: 0.36 });
  const phase = Math.floor(r() * 4);
  for (let k = 0; k < floors; k++) {
    const y = FLOOR + k * FLOOR_H;
    if (k % 2 === 0 && k > 0) out.push({ kind: 3, tint: 0x3a3f4a, glow: color, seed, x, y: y - 0.2, z, w: 11.4, h: 0.2, d: 8.4 });
    if (r() < 0.07) continue;
    const o = (k + phase) % 4;
    const along = o % 2 === 0;
    const side = o < 2 ? -1 : 1;
    const base = { kind: 6 as const, tint: pick(r, CARAVAN), glow: r() < 0.3 ? color : 0x6f7f8a, seed: seedOf(r), y: y + 0.03, h: 2.5 };
    if (along) out.push({ ...base, x: x + (r() - 0.5) * 3, z: z + side * 2.6, w: 7, d: 2.6 });
    else out.push({ ...base, x: x + side * 3.9, z: z + (r() - 0.5) * 1.2, w: 2.6, d: 7 });
  }
  if (r() < 0.6) out.push({ kind: 1, tint: RED, glow: RED, seed, x: x + 5.6, y: FLOOR + top + 0.9, z: z + 4.1, w: 0.9, h: 0.9, d: 0.9 });
}

function pilas(out: Part[], color: number, density: number) {
  const noise = valueNoise(611);
  const far = (x: number, z: number, floors: number, r: Rand): Part => ({ kind: 10, tint: pick(r, CARAVAN), glow: color, seed: seedOf(r), x, y: FLOOR, z, w: 11.5, h: floors * FLOOR_H, d: 8.5 });
  /** Un grupo de pilas arrimadas, de alturas distintas, alrededor de un núcleo de acero con su baliza. */
  const cluster = (r: Rand, x: number, z: number, nx: number, nz: number, floors: number) => {
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      if (r() < 0.12) continue;
      out.push(far(x + (a - (nx - 1) / 2) * 12.6, z + (b - (nz - 1) / 2) * 9.6, Math.round(floors * (0.55 + r() * 0.45)), r));
    }
    const h = floors * FLOOR_H * 1.04;
    out.push({ kind: 2, tint: 0x596070, glow: color, seed: seedOf(r), x, y: FLOOR, z, w: 1.6, h: h + 8, d: 1.6, taper: 0.5 });
    out.push({ kind: 1, tint: RED, glow: RED, seed: seedOf(r), x, y: FLOOR + h + 8, z, w: 1.5, h: 1.5, d: 1.5 });
  };
  // Los hitos: cuatro pilas gigantes, de noventa a ciento veinte pisos.
  const marks: Mark[] = ENDS.map((e, k) => {
    const r = rng(6110 + k);
    cluster(r, e.x, e.z, 7, 8, 96 + k * 8);
    return { ...e, clear: 90 };
  });
  const taken = new Set<string>();
  eachSuper(REACH, 611, marks, ({ i, j, cx, cz, dist, r, first }) => {
    if (first) return;
    const k = noise((cx - C) / 430 + 5.2, (cz - C) / 430 + 2.6);
    if (r() > 0.62 - 0.2 * Math.min(1, dist / 1300)) return;
    // Los grandes montones: de treinta a noventa pisos, según el grupo.
    const floors = Math.round(26 + 70 * Math.pow(k, 1.4) * (0.7 + r() * 0.6));
    cluster(r, cx + (r() - 0.5) * 14, cz + (r() - 0.5) * 14, 3 + Math.floor(r() * 2), 3 + Math.floor(r() * 2), dist < 420 ? Math.min(floors, 44) : floors);
    taken.add(`${3 * i + 1},${3 * j + 1}`);
  });
  eachBlock(REACH, 611, ({ i, j, x0, z0, cx, cz, dist, r }) => {
    if (taken.has(`${i},${j}`)) return;
    const grow = Math.min(1, Math.max(0, (dist - 170) / 500));
    if (dist < nearBy(density, 300)) {
      // De cerca, una a una: dos por manzana (alguna, una sola).
      const one = r() < 0.25;
      const floors = () => 7 + Math.floor(r() * (7 + grow * 10));
      if (one) pila(out, r, cx, cz, floors(), color);
      else {
        pila(out, r, x0 + 7, z0 + 5.5 + r() * 3, floors(), color);
        pila(out, r, x0 + 21, z0 + 19.5 - r() * 3, floors(), color);
      }
      return;
    }
    // Más lejos, cada pila es una sola pieza (su fachada la pinta el shader). Cuántas, según el nivel.
    const fill = dist < 620 ? 1 : density * (dist > 950 ? 0.45 : 0.75);
    for (const [ax, az, main] of [[7, 6, true], [21, 20, true], [21, 6, false], [7, 20, false]] as const) {
      if (r() > fill * (main ? 0.85 : 0.4)) continue;
      out.push(far(x0 + ax, z0 + az, 8 + Math.floor(r() * (8 + grow * 22)), r));
    }
  });
}

/* ------------------------------------------------------------------ */
/* Ágora: un pueblo encalado entre colinas                               */
/* ------------------------------------------------------------------ */

const LIME = [0xf2ece0, 0xf6f1e8, 0xeadfc8, 0xe9cf9e, 0xf0e2c4, 0xe2c9a4] as const;
const SHUTTER = [0x3f7f5a, 0x3a6ea5, 0x8a4a2a, 0x55707a] as const;
const TILE = [0xc8693f, 0xb85c38, 0xd17a4a, 0xa9553a] as const;
const CYPRESS = 0x24452c;

/** Una casa: su cuerpo encalado y, casi siempre, su tejado de teja a dos aguas. */
function house(out: Part[], r: Rand, x: number, z: number, w: number, d: number, floors: number, roof = true) {
  const seed = seedOf(r);
  const yaw = r() < 0.5 ? Math.PI / 2 : 0;
  const h = floors * 3;
  out.push({ kind: 6, tint: pick(r, LIME), glow: pick(r, SHUTTER), seed, x, y: FLOOR, z, w, h, d, yaw });
  if (roof && r() < 0.72) out.push({ kind: 3, tint: pick(r, TILE), glow: 0, seed, x, y: FLOOR + h - 0.1, z, w: w + 0.8, h: 1.3 + w * 0.13, d: d + 0.8, taper: -0.03, yaw });
}

function cypress(out: Part[], r: Rand, x: number, z: number, y = FLOOR) {
  const h = 7 + r() * 6;
  out.push({ kind: 3, round: true, tint: CYPRESS, glow: 0, seed: seedOf(r), x, y, z, w: 1.7 + h * 0.06, h, d: 1.7 + h * 0.06, taper: 0.1 });
}

/** Un campanario: fuste, cuerpo de campanas y chapitel. */
function belfry(out: Part[], r: Rand, x: number, z: number, h: number, y = FLOOR) {
  const seed = seedOf(r), tint = pick(r, LIME);
  out.push({ kind: 3, tint, glow: 0, seed, x, y, z, w: 4.4, h, d: 4.4 });
  out.push({ kind: 6, tint, glow: 0x8a4a2a, seed, x, y: y + h - 0.1, z, w: 3.6, h: 3.4, d: 3.6 });
  out.push({ kind: 3, tint: pick(r, TILE), glow: 0, seed, x, y: y + h + 3.2, z, w: 4.2, h: 4, d: 4.2, taper: 0.06 });
}

/** Una colina de dos cuerpos con un caserío arriba. Devuelve la altura de su cima. */
function hill(out: Part[], r: Rand, x: number, z: number, D: number, H: number, village: number): number {
  const seed = seedOf(r);
  const base = { kind: 8 as const, round: true, tint: pick(r, [0x8d8658, 0x7f7c50, 0x968a5c] as const), glow: pick(r, [0x6e8a45, 0x7a8e4a, 0x8a9050] as const), seed };
  out.push({ ...base, x, y: FLOOR, z, w: D, h: H * 0.6, d: D * (0.8 + r() * 0.3), taper: 0.68 });
  const ox = (r() - 0.5) * D * 0.14, oz = (r() - 0.5) * D * 0.14;
  out.push({ ...base, x: x + ox, y: FLOOR + H * 0.6 - 1, z: z + oz, w: D * 0.52, h: H * 0.4 + 1, d: D * 0.46, taper: 0.6 });
  const top = FLOOR + H;
  for (let k = 0; k < village; k++) {
    const a = r() * Math.PI * 2, rad = r() * D * 0.11;
    const hx = x + ox + Math.cos(a) * rad, hz = z + oz + Math.sin(a) * rad;
    out.push({ kind: 6, tint: pick(r, LIME), glow: pick(r, SHUTTER), seed: seedOf(r), x: hx, y: top - 0.6, z: hz, w: 7 + r() * 5, h: 5 + r() * 6, d: 7 + r() * 5 });
  }
  if (village > 3) belfry(out, r, x + ox, z + oz, 16 + r() * 8, top - 0.6);
  return top;
}

/** Un templo de columnas sobre su basamento, en lo alto. */
function temple(out: Part[], r: Rand, x: number, y: number, z: number, turn: boolean) {
  const marble = 0xece5d4, seed = seedOf(r);
  const yaw = turn ? Math.PI / 2 : 0;
  const along = (a: number, b: number): [number, number] => (turn ? [x + b, z - a] : [x + a, z + b]);
  out.push({ kind: 3, tint: marble, glow: 0, seed, x, y, z, w: 84, h: 5, d: 40, yaw });
  for (let k = 0; k < 9; k++) {
    for (const s of [-1, 1]) {
      const [px, pz] = along((k - 4) * 9, s * 15);
      out.push({ kind: 3, round: true, tint: marble, glow: 0, seed, x: px, y: y + 4.9, z: pz, w: 3.4, h: 22, d: 3.4, taper: 0.86 });
    }
  }
  out.push({ kind: 3, tint: marble, glow: 0, seed, x, y: y + 26.8, z, w: 80, h: 4, d: 37, yaw });
  out.push({ kind: 3, tint: 0xdcd2ba, glow: 0, seed, x, y: y + 30.7, z, w: 37.5, h: 9, d: 80.5, taper: -0.02, yaw: yaw + Math.PI / 2 });
  out.push({ kind: 6, tint: 0xe2d9c4, glow: 0x8a4a2a, seed, x, y: y + 4.9, z, w: 52, h: 22, d: 20, yaw });
}

function town(out: Part[], density: number) {
  // Los hitos: cuatro cerros altos, con un templo en el del norte y pueblos con campanario en los demás.
  const marks: Mark[] = ENDS.map((e, k) => {
    const r = rng(3300 + k);
    const top = hill(out, r, e.x, e.z, 330, 120 + k * 12, k === 0 ? 0 : 12);
    if (k === 0) temple(out, r, e.x, top - 1, e.z, false);
    return { ...e, clear: 170 };
  });
  const noise = valueNoise(33);
  const taken = new Set<string>();
  eachSuper(REACH, 33, marks, ({ i, j, cx, cz, dist, r, first }) => {
    if (first || dist < 420) return;
    const k = noise((cx - C) / 380 + 1.7, (cz - C) / 380 + 6.2);
    // Las colinas van en sierras (donde el ruido es alto); entre ellas, campo abierto.
    if (k > 0.52 && r() < 0.8) {
      const D = 170 + r() * 170;
      hill(out, r, cx + (r() - 0.5) * 40, cz + (r() - 0.5) * 40, D, 34 + (k - 0.5) * 260 * (0.7 + r() * 0.6), r() < 0.45 ? 5 + Math.floor(r() * 6) : 0);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) taken.add(`${3 * i + 1 + a},${3 * j + 1 + b}`);
    } else if (r() < 0.5 * density) {
      // Un cortijo entre los campos, con su hilera de cipreses.
      const x = cx + (r() - 0.5) * 50, z = cz + (r() - 0.5) * 50;
      house(out, r, x, z, 14 + r() * 6, 9 + r() * 4, 2);
      house(out, r, x + 12, z + 9, 8, 7, 1);
      for (let c = 0; c < 6; c++) cypress(out, r, x - 14 + c * 4.6, z - 10);
    }
  });
  // El pueblo, alrededor del distrito: manzanas de casas con patio, alguna plaza con su campanario
  // y cipreses.
  const edge = nearBy(density, 470);
  eachBlock(edge, 33, ({ i, j, x0, z0, cx, cz, dist, r }) => {
    if (taken.has(`${i},${j}`)) return;
    // Hacia fuera el pueblo se va deshaciendo en casas sueltas.
    const fill = 1 - Math.max(0, (dist - (edge - 140)) / 160);
    if (r() > fill) return;
    if (r() < 0.07) {
      belfry(out, r, cx, cz, 18 + r() * 9);
      house(out, r, cx - 8.5, cz + 2, 9, 14, 2 + Math.floor(r() * 2));
      for (let c = 0; c < 3; c++) cypress(out, r, cx + 8 + (r() - 0.5) * 3, z0 + 5 + c * 7);
      return;
    }
    // Una malla de tres por tres huecos; se llenan casi todos, cada uno con su casa.
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const k = r();
        const x = x0 + 4.8 + a * 9.2, z = z0 + 4.8 + b * 9.2;
        if (a === 1 && b === 1) {
          // El patio: a veces, un ciprés.
          if (k < 0.4) cypress(out, r, x, z);
          continue;
        }
        if (k > fill * 0.86) continue;
        house(out, r, x, z, 6.4 + r() * 2.2, 6.4 + r() * 2.2, 1 + Math.floor(r() * (dist < 260 ? 3.4 : 2.2)));
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Frontera: mesetas, antenas y un puesto avanzado                       */
/* ------------------------------------------------------------------ */

const ROCK = [0x9b6b4a, 0x8a5f45, 0xa87552, 0x7d5a48, 0xb07f5a] as const;
const SAND = 0xb89468;
const HULL = [0xdfe3ea, 0xcfd6e0, 0xe8e6de] as const;

/** Una meseta: de uno a tres cuerpos de roca, cada uno más estrecho. Devuelve su altura. */
function mesa(out: Part[], r: Rand, x: number, z: number, W: number, H: number): number {
  const seed = seedOf(r), tint = pick(r, ROCK);
  const round = r() < 0.35;
  const tiers = 1 + Math.floor(r() * 2.6);
  let w = W, d = W * (0.6 + r() * 0.5), y = FLOOR;
  for (let t = 0; t < tiers; t++) {
    const h = (H / tiers) * (t === 0 ? 1.2 : 0.8);
    out.push({ kind: 8, round, tint, glow: SAND, seed, x: x + (t ? (r() - 0.5) * w * 0.12 : 0), y: y - (t ? 1.5 : 0), z: z + (t ? (r() - 0.5) * d * 0.12 : 0), w, h: h + (t ? 1.5 : 0), d, taper: 0.78 + r() * 0.12, yaw: round ? 0 : r() * Math.PI });
    y += h;
    w *= 0.5 + r() * 0.22;
    d *= 0.5 + r() * 0.22;
  }
  return y;
}

/** Una antena de plato sobre su pedestal. */
function dish(out: Part[], r: Rand, x: number, z: number, dia: number, y = FLOOR) {
  const seed = seedOf(r);
  out.push({ kind: 2, round: true, tint: 0xc9ccd0, glow: 0x6dffd8, seed, x, y, z, w: dia * 0.16, h: dia * 0.55, d: dia * 0.16, taper: 0.7 });
  out.push({ kind: 3, round: true, tint: 0xe6e8ec, glow: 0, seed, x, y: y + dia * 0.52, z, w: dia * 0.34, h: dia * 0.26, d: dia * 0.34, taper: 2.9 });
  out.push({ kind: 2, tint: 0x8a8f99, glow: 0, seed, x, y: y + dia * 0.74, z, w: 0.5 + dia * 0.01, h: dia * 0.3, d: 0.5 + dia * 0.01, taper: 0.4 });
}

/** Un puesto: cúpula de hábitat, módulos, mástil con baliza, placas solares y, a veces, un plato. */
function outpost(out: Part[], r: Rand, x: number, z: number, color: number) {
  const hull = () => ({ tint: pick(r, HULL), glow: color, seed: seedOf(r) });
  const dia = 9 + r() * 4;
  out.push({ ...hull(), kind: 6, round: true, x, y: FLOOR, z, w: dia, h: 3.6, d: dia, taper: 0.86 });
  out.push({ ...hull(), kind: 3, round: true, x, y: FLOOR + 3.5, z, w: dia * 0.86, h: 2.2, d: dia * 0.86, taper: 0.3 });
  const n = 1 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const turn = r() < 0.5;
    const ox = (r() < 0.5 ? -1 : 1) * (dia / 2 + 4 + r() * 2);
    out.push({ ...hull(), kind: 6, x: turn ? x + (r() - 0.5) * 6 : x + ox, y: FLOOR, z: turn ? z + ox : z + (r() - 0.5) * 6, w: turn ? 3.4 : 8.5, h: 3.1, d: turn ? 8.5 : 3.4 });
  }
  const mh = 18 + r() * 22;
  out.push({ kind: 2, tint: 0xb9c0cc, glow: color, seed: seedOf(r), x: x + 5, y: FLOOR, z: z - 6, w: 0.7, h: mh, d: 0.7, taper: 0.3 });
  out.push({ kind: 1, tint: RED, glow: RED, seed: seedOf(r), x: x + 5, y: FLOOR + mh, z: z - 6, w: 0.9, h: 0.9, d: 0.9 });
  for (let k = 0; k < 4; k++) out.push({ kind: 3, tint: 0x1b2a55, glow: 0, seed: seedOf(r), x: x - 9 + (k % 2) * 7.6, y: FLOOR + 1.3, z: z + 7 + Math.floor(k / 2) * 3.8, w: 7, h: 0.22, d: 3.2 });
  if (r() < 0.4) dish(out, r, x + 9, z + 8, 7 + r() * 3);
}

function frontier(out: Part[], color: number, density: number) {
  // Los hitos: un cohete en su torre de lanzamiento al norte, un campo de grandes antenas al este
  // y dos mesetas enormes al sur y al oeste.
  const marks: Mark[] = ENDS.map((e, k) => {
    const r = rng(8800 + k);
    if (k === 0) {
      const seed = seedOf(r);
      out.push({ kind: 3, tint: 0x8a8f99, glow: 0, seed, x: e.x, y: FLOOR, z: e.z, w: 120, h: 9, d: 120, taper: 0.9 });
      out.push({ kind: 2, tint: 0x9aa0aa, glow: color, seed, x: e.x - 22, y: FLOOR + 8, z: e.z, w: 15, h: 150, d: 15, taper: 0.8 });
      out.push({ kind: 3, round: true, tint: 0xe9ebee, glow: 0, seed, x: e.x + 4, y: FLOOR + 8.5, z: e.z, w: 17, h: 104, d: 17 });
      out.push({ kind: 3, round: true, tint: 0xd8402c, glow: 0, seed, x: e.x + 4, y: FLOOR + 112, z: e.z, w: 17, h: 26, d: 17, taper: 0.06 });
      for (const s of [-1, 1]) out.push({ kind: 3, round: true, tint: 0xd9dbe0, glow: 0, seed, x: e.x + 4, y: FLOOR + 8.5, z: e.z + s * 12.6, w: 8, h: 58, d: 8, taper: 0.9 });
      for (const y of [60, 110]) out.push({ kind: 2, tint: 0x9aa0aa, glow: color, seed, x: e.x - 9, y: FLOOR + y, z: e.z, w: 18, h: 3, d: 5 });
      out.push({ kind: 1, tint: RED, glow: RED, seed, x: e.x - 22, y: FLOOR + 158, z: e.z, w: 1.8, h: 1.8, d: 1.8 });
    } else if (k === 1) {
      for (const [ax, az] of [[0, 0], [-80, -70], [70, -80], [-70, 80], [80, 70]] as const) dish(out, r, e.x + ax, e.z + az, 62);
    } else mesa(out, r, e.x, e.z, 330, 190 + k * 20);
    return { ...e, clear: 170 };
  });
  const noise = valueNoise(88);
  const taken = new Set<string>();
  eachSuper(REACH, 88, marks, ({ i, j, cx, cz, dist, r, first }) => {
    if (first) return;
    const k = noise((cx - C) / 400 + 9.1, (cz - C) / 400 + 4.4);
    // Las mesetas van en grupos; lejos, más altas. Y alguna aguja de roca suelta.
    if (k > 0.44 && r() < 0.78) {
      const W = 60 + r() * 90 + (dist > 700 ? 60 : 0);
      mesa(out, r, cx + (r() - 0.5) * 30, cz + (r() - 0.5) * 30, W, (28 + (k - 0.4) * 230 * (0.6 + r() * 0.8)) * (dist < 420 ? 0.6 : 1));
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) taken.add(`${3 * i + 1 + a},${3 * j + 1 + b}`);
    } else if (r() < 0.35 * density) {
      const n = 1 + Math.floor(r() * 3);
      for (let s = 0; s < n; s++) {
        const dia = 7 + r() * 9;
        out.push({ kind: 8, round: true, tint: pick(r, ROCK), glow: SAND, seed: seedOf(r), x: cx + (r() - 0.5) * 70, y: FLOOR, z: cz + (r() - 0.5) * 70, w: dia, h: 16 + r() * 44, d: dia, taper: 0.5 + r() * 0.3 });
      }
    }
  });
  // La cordillera del fondo: cierra el horizonte.
  const rr = rng(889);
  for (let a = 0; a < 30; a++) {
    const ang = (a / 30) * Math.PI * 2 + rr() * 0.12, rad = 1040 + rr() * 150;
    const x = C + Math.cos(ang) * rad, z = C + Math.sin(ang) * rad;
    if (marks.some((m) => Math.hypot(x - m.x, z - m.z) < 260)) continue;
    out.push({ kind: 8, tint: pick(rr, ROCK), glow: SAND, seed: seedOf(rr), x, y: FLOOR, z, w: 300 + rr() * 220, h: 150 + rr() * 230, d: 260 + rr() * 200, taper: 0.3 + rr() * 0.2, yaw: rr() * Math.PI });
  }
  // El puesto avanzado, alrededor del distrito: módulos en casi la mitad de las manzanas, y rocas.
  eachBlock(420, 88, ({ i, j, cx, cz, dist, r }) => {
    if (taken.has(`${i},${j}`)) return;
    const k = r();
    const near = dist < 300 ? 0.5 : 0.22;
    if (k < near) outpost(out, r, cx, cz, color);
    else if (k < near + 0.16) {
      const n = 1 + Math.floor(r() * 3);
      for (let s = 0; s < n; s++) out.push({ kind: 8, tint: pick(r, ROCK), glow: SAND, seed: seedOf(r), x: cx + (r() - 0.5) * 16, y: FLOOR, z: cz + (r() - 0.5) * 16, w: 6 + r() * 9, h: 3 + r() * 9, d: 6 + r() * 9, taper: 0.55 + r() * 0.3, yaw: r() * Math.PI });
    }
  });
}

/* ------------------------------------------------------------------ */
/* Los temas                                                             */
/* ------------------------------------------------------------------ */

const THEMES: Record<string, Theme> = {
  // Juegos 3D: rascacielos de cristal azul con los neones del distrito y el magenta del arcade.
  arcade: {
    look: { street: [0.05, 0.07, 0.12], neon: 0.4, screens: 0.15 },
    ground: { style: 0, lamp: "vec3(0.8, 0.88, 1.0)", far: ["vec3(0.17, 0.175, 0.19)", "vec3(0.11, 0.12, 0.15)"] },
    cars: 1,
    build: (color, density) => {
      const out: Part[] = [];
      towerCity(out, {
        seed: 311,
        glass: GLASS,
        street: STREET,
        glows: [color, color, color, 0xff4fd8, 0xff4fd8, 0x36d9ff, 0xffd54f],
        low: [20, 38, 46],
        lowR: 430,
        signs: 0.4,
        mega: { base: 120, gain: 390, first: 150, fill: 0.76, forms: [0, 0, 0, 1, 1, 2, 3, 4, 4, 5, 6] },
        ends: [[640, 3], [560, 2], [600, 0], [680, 6]],
      }, density);
      return out;
    },
  },
  // La ciudad de Xen: megatorres oscuras y apretadas, pantallas por todas partes y tráfico aéreo.
  cero: {
    look: { thick: 1.35, street: [0.07, 0.045, 0.12], neon: 0.5, screens: 0.3 },
    ground: {
      style: 0,
      lamp: "vec3(0.55, 0.78, 1.0)",
      far: ["vec3(0.12, 0.125, 0.14)", "vec3(0.085, 0.11, 0.15)"],
      blocks: ["vec3(0.11, 0.115, 0.13)", "vec3(0.16, 0.16, 0.175)"],
      parks: 0,
      walk: "vec3(0.2, 0.2, 0.22)",
      trees: false,
    },
    cars: 1.6,
    build: (color, density) => {
      const out: Part[] = [];
      towerCity(out, {
        seed: 977,
        glass: [0x565c78, 0x4a5270, 0x6a6488, 0x3f4a66, 0x5c6c8c, 0x70608c, 0x485878],
        street: [0x4a4f63, 0x3d4256, 0x5a566c, 0x343a4e, 0x55607a, 0x6a6474, 0x40485c],
        glows: [color, color, color, 0xff4fd8, 0x36d9ff, 0x36d9ff, 0xff4f8b, 0x6dffd8],
        low: [26, 50, 60],
        lowR: 430,
        signs: 0.65,
        mega: { base: 170, gain: 460, first: 190, fill: 0.9, forms: [0, 0, 0, 1, 3, 3, 3, 6, 6, 2, 5] },
        ends: [[720, 6], [640, 3], [690, 0], [660, 3]],
      }, density);
      return out;
    },
  },
  // Juegos 2D: torres de vóxeles de colores sobre un tablero, con figuras de píxeles en lo alto.
  pixel: {
    look: { street: [0.09, 0.045, 0.1] },
    ground: { style: 1, lamp: "vec3(1.0, 0.31, 0.85)", far: ["vec3(0.23, 0.42, 0.18)", "vec3(0.045, 0.024, 0.065)"] },
    cars: 0.5,
    build: (color, density) => {
      const out: Part[] = [];
      voxelCity(out, color, density);
      return out;
    },
  },
  // Quedadas: un pueblo de casas encaladas y tejados de teja, con campanarios y cipreses, entre
  // colinas y campos.
  agora: {
    look: { thick: 0.9, street: [0.12, 0.085, 0.05] },
    ground: { style: 4, lamp: "vec3(1.0, 0.7, 0.4)", far: ["vec3(0.36, 0.38, 0.2)", "vec3(0.012, 0.015, 0.014)"] },
    cars: 0,
    build: (_color, density) => {
      const out: Part[] = [];
      town(out, density);
      return out;
    },
  },
  // Herramientas: naves, depósitos, silos, chimeneas con baliza, grúas y torres de refrigeración.
  taller: {
    look: { thick: 1.15, street: [0.13, 0.075, 0.03] },
    ground: { style: 2, lamp: "vec3(1.0, 0.56, 0.2)", far: ["vec3(0.2, 0.2, 0.2)", "vec3(0.14, 0.088, 0.052)"] },
    cars: 0.3,
    build: (_color, density) => {
      const out: Part[] = [];
      industry(out, density);
      return out;
    },
  },
  // Experimentos: un puesto avanzado en el desierto, entre mesetas, con antenas y un cohete.
  frontera: {
    look: { thick: 0.8, street: [0.03, 0.036, 0.06] },
    ground: { style: 5, lamp: "vec3(0.6, 0.8, 1.0)", far: ["vec3(0.5, 0.4, 0.27)", "vec3(0.018, 0.02, 0.036)"] },
    cars: 0.15,
    build: (color, density) => {
      const out: Part[] = [];
      frontier(out, color, density);
      return out;
    },
  },
  // Las Pilas hasta el horizonte: caravanas apiladas en andamios de acero, cada vez más altas.
  vertical: {
    look: { thick: 1.1, street: [0.11, 0.07, 0.04] },
    ground: { style: 3, lamps: 0.6, far: ["vec3(0.22, 0.2, 0.17)", "vec3(0.09, 0.063, 0.048)"] },
    cars: 0.3,
    build: (color, density) => {
      const out: Part[] = [];
      pilas(out, color, density);
      return out;
    },
  },
};

/* ------------------------------------------------------------------ */
/* Tráfico: coches de luz por las avenidas, por encima del distrito      */
/* ------------------------------------------------------------------ */

function skylineCars(id: string, color: string, density: number): Car[] {
  const amount = (THEMES[id]?.cars ?? 0) * density;
  if (amount <= 0) return [];
  const r = rng(99);
  const out: Car[] = [];
  const levels = [72, 96, 128, 176, 236];
  const len = REACH * 2;
  const lane = (angle: number, offset: number, y: number, speed: number) => {
    const count = Math.max(2, Math.round(7 * amount));
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const x0 = C - (dx * len) / 2 - dz * offset, z0 = C - (dz * len) / 2 + dx * offset;
    for (let i = 0; i < count; i++) out.push({ a: [x0, z0, y, len], b: [speed, (i / count) * len + r() * 30, angle, 1], glow: r() < 0.5 ? color : NEON[Math.floor(r() * NEON.length)]! });
  };
  // Por las avenidas (cada 120 m): son los pasillos que dejan las torres. Las de los ejes pasan
  // por encima del distrito, más altas que todo lo que hay en él.
  for (let k = -5; k <= 5; k++) {
    for (let axis = 0; axis < 2; axis++) {
      const angle = axis * (Math.PI / 2);
      lane(angle, k * SUPER + 5, levels[Math.floor(r() * levels.length)]! + r() * 8, 40 + r() * 22);
      lane(angle + Math.PI, -k * SUPER + 5, levels[Math.floor(r() * levels.length)]! + r() * 8, 40 + r() * 22);
    }
  }
  return out;
}

const BY_CHUNK = new Map((districts.districts as { id: string; chunk: string; color: string }[]).map((d) => [d.chunk, d]));

/** Qué distrito es (los del sistema, por su chunk; los de la comunidad, por la pista de WELCOME: su tema y su color). */
function useDistrict(chunk: string) {
  const hint = usePlaceTheme();
  return BY_CHUNK.get(chunk) ?? (hint && THEMES[hint.id] ? { id: hint.id, chunk, color: hint.color } : undefined);
}

/** El aire de alrededor de un distrito (para la bruma de dentro, que es la misma: World.tsx). */
export function useSkylineLook(chunk: string): AirLook | undefined {
  const d = useDistrict(chunk);
  return d ? THEMES[d.id]?.look : undefined;
}

/**
 * `sky`: la foto del cielo de día, cuando llega (el cristal la refleja y el aire toma su horizonte).
 * `rich`: el cristal con todos sus reflejos (escritorio). `post`: se pinta con post-proceso.
 */
export function DistrictSkyline({ chunk, density, ambience, sky, rich, post }: { chunk: string; density: number; ambience: Ambience; sky: THREE.Texture | null; rich: boolean; post: boolean }) {
  const d = useDistrict(chunk);
  const id = d?.id, color = d?.color;
  const theme = id ? THEMES[id] : undefined;
  const parts = useMemo(() => {
    if (!theme || !color) return [];
    const out = theme.build(parseInt(color.slice(1), 16), density);
    // De cerca a lejos: lo de delante se pinta antes y tapa lo de detrás.
    out.sort((p, q) => Math.hypot(p.x - C, p.z - C) - Math.hypot(q.x - C, q.z - C));
    return out;
  }, [theme, color, density]);
  const cars = useMemo(() => (id && color ? skylineCars(id, color, density) : []), [id, color, density]);
  if (!theme || density <= 0) return null;
  return (
    <>
      <CityClock ambience={ambience} sky={sky} post={post} look={theme.look} />
      <FarView far={DISTRICT_VIEW.far} />
      <CityHorizon far={DISTRICT_VIEW.far} />
      <CityBuildings parts={parts} rich={rich} order={ORDER} themed />
      <CityGround far={DISTRICT_VIEW.far} y={FLOOR} order={ORDER} look={theme.ground} />
      {cars.length > 0 && <CarsMesh list={cars} />}
    </>
  );
}
