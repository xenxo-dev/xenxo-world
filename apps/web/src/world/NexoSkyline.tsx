/**
 * La megaciudad del nexo, en 3D hasta el horizonte. La plataforma flota a 110 m sobre sus calles:
 * debajo, las manzanas con sus azoteas, sus calles y sus sombras; alrededor, megatorres de cristal
 * que suben muy por encima (cuerpos escalonados, losas, torres gemelas, obeliscos, agujas, cilindros
 * con miradores; con pasarelas entre unas y otras, hilos de luz y pantallas sin letras), cada vez
 * más perdidas en la bruma, y al fondo de cada avenida principal un hito que se reconoce de lejos:
 * la Aguja al norte (hacia la plaza), las Gemelas al este, la Pirámide al sur y el Faro al oeste.
 *
 * Decorado del cliente (no son datos del mundo: no se visita ni se construye; sin colisión) y hecho
 * para la Quest: dos llamadas de dibujo para todos los edificios (cajas y cilindros instanciados,
 * de cerca a lejos, para que lo de detrás no se pinte), una para sus sombras (de día), una para el
 * suelo y otra para el horizonte.
 * Sin texturas propias: fachadas, ventanas, azoteas, calles y luces salen del shader; lo único que
 * se lee es la foto del cielo de día, que el cristal refleja. De día y de noche. La ciudad es la
 * misma en todos los niveles (todos ven la misma silueta); `FEATURES.nexoCity` solo decide cuánto
 * relleno hay entre las megatorres lejanas (y, en NexoCity.tsx, cuánto tráfico).
 *
 * Los colores son «como se ven» (display.ts) y el aire es el de city-air.ts: cada torre se pierde en
 * el color que tiene el cielo detrás de ella.
 */
import { useEffect, useLayoutEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CHUNK_SIZE } from "@xenxo/protocol";
import { AIR_GLSL, air, rng } from "./city-air";

const C = CHUNK_SIZE / 2;
/** Suelo de la ciudad (la plataforma está en y = 0). */
export const GROUND = -110;
/** Paso de la cuadrícula de calles y ancho de la calzada (m). */
export const PITCH = 40;
export const ROAD = 12;
/** Una megatorre cada tres manzanas; entre ellas, las avenidas (una pasa por el centro del nexo). */
export const SUPER = PITCH * 3;
/** Hasta dónde llega la ciudad de las calles, con sus edificios uno a uno. */
export const LOW_R = 330;
/** Las megatorres: desde fuera de los carriles de los coches voladores hasta perderse en la bruma. */
const MEGA_R0 = 290;
const MEGA_R1 = 1740;
/** Hasta dónde ve la cámara en el nexo (en el resto del mundo, 400 m). */
export const NEXO_FAR = 2600;

/* ------------------------------------------------------------------ */
/* Las piezas                                                           */
/* ------------------------------------------------------------------ */

/** kind: 0 = cuerpo con fachada, 1 = baliza que parpadea, 2 = metal (agujas, antenas, discos). */
interface Part {
  x: number;
  /** Base. */
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  yaw?: number;
  /** Cuánto mide arriba respecto a abajo (1 = recto). */
  taper?: number;
  kind?: 0 | 1 | 2;
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

type Rand = () => number;
const pick = <T,>(r: Rand, a: readonly T[]) => a[Math.floor(r() * a.length)]!;

/** Cristales: plata azulada, azul, verde agua, bronce, humo, acero y lavanda. */
const GLASS = [0xc4dcf2, 0x92c4f0, 0x86d8e0, 0xe6cfa2, 0x9aa8d8, 0xd6e4f0, 0x74b2e6, 0xb2bcf0, 0xa8d4f2, 0x9cd0e8] as const;
/** Edificios de las calles: además de cristal, piedra clara, hormigón y ladrillo. */
const STREET = [0xc3d6e8, 0x9cc0e0, 0xd8d2c4, 0xb9b4aa, 0x8d9db3, 0xd3dade, 0xc9a78c, 0xe4e0d6, 0x7daace, 0xa7adb5] as const;
/** Neones (los de xenxo), con más cian, magenta y violeta que el resto. */
const GLOW = [0x36d9ff, 0x36d9ff, 0xff4fd8, 0xff4fd8, 0xa26bff, 0xa26bff, 0x4fa3ff, 0x6dffd8, 0xff4f8b] as const;
const RED = 0xff3b3b;

/** Ruido suave con semilla (para que las torres altas vayan en grupos, como en una ciudad). */
function valueNoise(seed: number) {
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
function spire(out: Part[], x: number, y: number, z: number, w: number, h: number, base: Pick<Part, "tint" | "glow" | "seed">) {
  out.push({ ...base, x, y: y - 1, z, w, h: h + 1, d: w, taper: 0.18, kind: 2 });
  out.push({ ...base, x, y: y + h, z, w: 1.5, h: 1.5, d: 1.5, kind: 1, tint: RED });
}

/** Dos o tres agujas finas de distinta altura en una azotea de `w` × `d` (sin baliza). */
function spikes(out: Part[], r: Rand, x: number, y: number, z: number, w: number, d: number, H: number, base: Pick<Part, "tint" | "glow" | "seed">) {
  const n = 2 + Math.floor(r() * 2);
  for (let k = 0; k < n; k++) {
    const t = 1.6 + r() * 1.4;
    out.push({ ...base, x: x + (r() - 0.5) * w * 0.7, y: y - 1, z: z + (r() - 0.5) * d * 0.7, w: t, h: H * (0.04 + r() * 0.09) + 1, d: t, taper: 0.2, kind: 2 });
  }
}

/**
 * Una megatorre: `F` es lo que ocupa en planta y `H` su altura (sin la aguja). Cada forma, con sus
 * cuerpos metidos un poco unos en otros (nunca dos caras en el mismo plano: a kilómetro y medio el
 * búfer de profundidad no las distinguiría).
 */
function megatower(out: Part[], r: Rand, x: number, z: number, H: number, F: number, form: number, base: Pick<Part, "tint" | "glow" | "seed">) {
  const y0 = GROUND;
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

/** Los cuatro hitos, al fondo de las avenidas principales. Cada uno, en su sitio a mano. */
function landmarks(out: Part[]): { x: number; z: number; clear: number }[] {
  // La Aguja (norte, hacia la plaza): un obelisco de casi un kilómetro, con el cian de xenxo.
  {
    const base = { tint: 0xc3d6e8, glow: 0x36d9ff, seed: 0.137 };
    const x = C, z = C - 1260;
    out.push({ ...base, x, y: GROUND, z, w: 150, h: 300, d: 150, taper: 0.7 });
    out.push({ ...base, x, y: GROUND + 296, z, w: 94, h: 414, d: 94, taper: 0.52 });
    out.push({ ...base, x, y: GROUND + 706, z, w: 42, h: 234, d: 42, taper: 0.3 });
    spire(out, x, GROUND + 940, z, 8, 150, base);
  }
  // Las Gemelas (este): dos losas unidas por tres pasarelas, con el magenta.
  {
    const base = { tint: 0x9cc0e0, glow: 0xff4fd8, seed: 0.412 };
    const x = C + 1150, z = C;
    out.push({ ...base, x, y: GROUND, z: z - 62, w: 96, h: 720, d: 70, taper: 0.86 });
    out.push({ ...base, x, y: GROUND, z: z + 62, w: 96, h: 650, d: 70, taper: 0.86 });
    for (const [by, bw] of [[250, 46], [430, 38], [585, 30]] as const) out.push({ ...base, x, y: GROUND + by, z, w: bw, h: 16, d: 64 });
    spire(out, x, GROUND + 720, z - 62, 6, 90, base);
    spire(out, x, GROUND + 650, z + 62, 6, 70, base);
  }
  // La Pirámide (sur): una arcología ancha y escalonada, con el violeta.
  {
    const base = { tint: 0xaebbdc, glow: 0xa26bff, seed: 0.731 };
    const x = C, z = C + 980;
    out.push({ ...base, x, y: GROUND, z, w: 430, h: 190, d: 430, taper: 0.66 });
    out.push({ ...base, x, y: GROUND + 186, z, w: 268, h: 150, d: 268, taper: 0.6 });
    out.push({ ...base, x, y: GROUND + 332, z, w: 150, h: 110, d: 150, taper: 0.42 });
    spire(out, x, GROUND + 442, z, 8, 110, base);
  }
  // El Faro (oeste): un fuste redondo con dos grandes miradores, con el verde agua.
  {
    const base = { tint: 0x8fd2d0, glow: 0x6dffd8, seed: 0.586 };
    const x = C - 1180, z = C;
    out.push({ ...base, x, y: GROUND, z, w: 92, h: 560, d: 92, round: true, taper: 0.62 });
    out.push({ ...base, x, y: GROUND + 470, z, w: 230, h: 26, d: 230, round: true, taper: 0.8 });
    out.push({ ...base, x, y: GROUND + 556, z, w: 48, h: 190, d: 48, round: true, taper: 0.7 });
    out.push({ ...base, x, y: GROUND + 660, z, w: 150, h: 18, d: 150, round: true, taper: 0.78 });
    spire(out, x, GROUND + 746, z, 7, 130, base);
  }
  return [
    { x: C, z: C - 1260, clear: 150 },
    { x: C + 1150, z: C, clear: 150 },
    { x: C, z: C + 980, clear: 300 },
    { x: C - 1180, z: C, clear: 170 },
  ];
}

/** La ciudad entera, de cerca a lejos. */
function megacity(density: number): Part[] {
  const out: Part[] = [];
  const marks = landmarks(out);
  const noise = valueNoise(911);
  /** Manzanas (de 40 m) ocupadas por una megatorre: ahí no van edificios de calle. */
  const taken = new Set<string>();
  /** Megatorres de un solo fuste, por celda: dónde están y hasta qué altura son macizas (para las pasarelas). */
  const solid = new Map<string, { x: number; z: number; top: number }>();

  // Megatorres: las mismas para todos (su sorteo no depende del nivel).
  const n = Math.ceil(MEGA_R1 / SUPER);
  for (let i = -n; i < n; i++) {
    for (let j = -n; j < n; j++) {
      const cx = C + (i + 0.5) * SUPER, cz = C + (j + 0.5) * SUPER;
      const dist = Math.hypot(cx - C, cz - C);
      if (dist < MEGA_R0 || dist > MEGA_R1) continue;
      if (marks.some((m) => Math.hypot(cx - m.x, cz - m.z) < m.clear + 50)) continue;
      const r = rng((Math.imul(i + 97, 73856093) ^ Math.imul(j + 131, 19349663)) >>> 0);
      // Las que dan a las cuatro avenidas principales, casi siempre: son las paredes del cañón.
      const canyon = (i === 0 || i === -1 || j === 0 || j === -1) && dist < 1000;
      const fill = canyon ? 0.9 : 0.74 - 0.26 * Math.min(1, (dist - MEGA_R0) / 1300);
      const there = r() < fill;
      const cluster = noise((cx - C) / 430 + 7.3, (cz - C) / 430 + 1.9);
      let H = 115 + 400 * Math.pow(cluster, 1.5) * (0.7 + r() * 0.6);
      // Las de la primera fila, más bajas: enmarcan sin tapar el cielo.
      if (dist < 440) H = Math.min(H, 235 + r() * 80);
      const F = Math.min(80, 36 + H * 0.075 + r() * 14);
      const x = cx + (r() - 0.5) * 16, z = cz + (r() - 0.5) * 16;
      const form = [0, 0, 0, 1, 1, 2, 3, 3, 4, 5, 6, 6][Math.floor(r() * 12)]!;
      const base = { tint: pick(r, GLASS), glow: pick(r, GLOW), seed: 0.02 + r() * 0.96 };
      if (there) {
        megatower(out, r, x, z, H, F, form === 6 && dist < 440 ? 3 : form, base);
        // Muchas, sobre un zócalo más ancho que ellas.
        if (r() < 0.55) out.push({ ...base, x, y: GROUND, z, w: F * 1.16 + 5, h: 13 + r() * 15, d: F * 1.16 + 5 });
        if (form !== 2 && form !== 6) solid.set(`${i},${j}`, { x, z, top: GROUND + H * 0.5 });
        const reach = F > 44 ? 1 : 0;
        for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) taken.add(`${3 * i + 1 + a},${3 * j + 1 + b}`);
      }
      // Relleno entre megatorres (lejos de las calles que se ven una a una): edificios medianos en
      // las manzanas de alrededor. Cuántos, según el nivel.
      if (dist > LOW_R + 70) {
        const want = density * (dist > 1100 ? 1.7 : 4.4) + r();
        const spots = [[-1, -1], [1, 1], [-1, 1], [1, -1], [0, -1], [0, 1], [-1, 0], [1, 0]] as const;
        // Cada uno en su manzana (nunca dos en la misma: sus caras casi coincidirían).
        const first = Math.floor(r() * 8);
        for (let k = 0; k < Math.min(8, Math.floor(want)); k++) {
          const s = spots[(first + k) % 8]!;
          const fh = 34 + Math.pow(r(), 2.2) * 110;
          const fw = 22 + r() * 8;
          out.push({ tint: pick(r, STREET), glow: pick(r, GLOW), seed: 0.02 + r() * 0.96, x: cx + s[0] * PITCH + (r() - 0.5) * 4, y: GROUND, z: cz + s[1] * PITCH + (r() - 0.5) * 4, w: fw, h: fh, d: 22 + r() * 8 });
        }
      }
    }
  }

  // Pasarelas entre megatorres vecinas, donde las dos son altas: tubos de cristal sobre las
  // avenidas, a alturas por las que no pasa el tráfico. Nunca sobre las cuatro avenidas principales
  // (sus vistas llegan limpias hasta el hito del fondo).
  const rb = rng(515);
  for (const [key, a] of solid) {
    const [i, j] = key.split(",").map(Number) as [number, number];
    for (const [di, dj] of [[1, 0], [0, 1]] as const) {
      const b = solid.get(`${i + di},${j + dj}`);
      const roll = rb(), level = [55, 105, 160, 225][Math.floor(rb() * 4)]!, seed = 0.02 + rb() * 0.96, glow = pick(rb, GLOW);
      if (!b || roll > 0.22 || (di === 1 && i === -1) || (dj === 1 && j === -1)) continue;
      if (level + 8 > Math.min(a.top, b.top)) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      out.push({ tint: 0x9cc0e0, glow, seed, x: (a.x + b.x) / 2, y: level - 4, z: (a.z + b.z) / 2, w: Math.hypot(dx, dz), h: 8, d: 7, yaw: Math.atan2(-dz, dx) });
    }
  }

  // La ciudad de las calles, bajo la plataforma y alrededor: de una a tres torres por manzana.
  const r = rng(4242);
  const m = Math.ceil(LOW_R / PITCH);
  for (let i = -m; i < m; i++) {
    for (let j = -m; j < m; j++) {
      const bx = C + i * PITCH + ROAD / 2, bz = C + j * PITCH + ROAD / 2;
      const block = PITCH - ROAD;
      const dist = Math.hypot(bx + block / 2 - C, bz + block / 2 - C);
      // Los mismos sorteos haya o no edificio. La ciudad de las calles es la misma en todos los
      // niveles: son unos cientos de cajas, y con menos se ve a medio hacer.
      const a = r(), towers = 1 + Math.floor(r() * 3);
      const rr = rng((Math.imul(i + 211, 83492791) ^ Math.imul(j + 157, 2971215073)) >>> 0);
      if (dist > LOW_R || taken.has(`${i},${j}`)) continue;
      const far = Math.min(1, dist / 240);
      // Alguna manzana, sin torres: un bloque bajo (un mercado, una estación), sin solares vacíos.
      if (a < 0.14) {
        out.push({ tint: pick(rr, STREET), glow: pick(rr, GLOW), seed: 0.02 + rr() * 0.96, x: bx + block / 2, y: GROUND, z: bz + block / 2, w: block - 3, h: 6 + rr() * 10, d: block - 3, shadow: true });
        continue;
      }
      for (let k = 0; k < towers; k++) {
        const w = 7 + rr() * (block / towers - 8);
        const d = 8 + rr() * (block - 10);
        const x = bx + (block / towers) * k + w / 2 + 0.6;
        const z = bz + d / 2 + rr() * (block - d - 1);
        // Por debajo del aire de los coches voladores (y > −50): no se cruzan con ellos ni con las islas.
        const h = Math.min(18 + rr() * (26 + far * 26), 58 - rr() * 8);
        const base = { tint: pick(rr, STREET), glow: pick(rr, GLOW), seed: 0.02 + rr() * 0.96 };
        out.push({ ...base, x, y: GROUND, z, w, h, d, shadow: true });
        // Algunas, con un cuerpo más estrecho encima; y balizas en las azoteas.
        if (h > 30 && rr() < 0.3 && w > 9 && d > 9) out.push({ ...base, x, y: GROUND + h - 2, z, w: w * 0.62, h: Math.min(10, 58 - h) + 2, d: d * 0.62 });
        else if (rr() < 0.22) out.push({ ...base, x, y: GROUND + h, z, w: 0.9, h: 0.9, d: 0.9, kind: 1, tint: RED });
      }
    }
  }
  // De cerca a lejos: lo de delante se pinta antes y tapa lo de detrás (menos píxeles que sombrear).
  out.sort((p, q) => Math.hypot(p.x - C, p.z - C) - Math.hypot(q.x - C, q.z - C));
  return out;
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
  uniform float uNight; uniform sampler2D uRing;
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
    float seed = aInfo.x, drum = aInfo.w;
    vec3 p = position;
    if (aInfo.y > 0.5 && aInfo.y < 1.5) {
      // Balizas: de lejos crecen, para seguir viéndose como un punto de luz.
      float s = clamp(distance(origin.xyz, cameraPosition) / 320.0, 1.0, mix(1.5, 4.5, uNight));
      p = vec3(p.x * s, (p.y - 0.5) * s + 0.5, p.z * s);
    }
    // Se afila hacia arriba; las caras se echan hacia atrás lo que toca.
    p.xz *= mix(1.0, aInfo.z, position.y);
    vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vec3 nl = normal;
    if (abs(nl.y) < 0.5) nl.y = (1.0 - aInfo.z) * 0.5 / size.y * mix(abs(nl.x) * size.x + abs(nl.z) * size.z, size.x, drum);
    mat3 turn = mat3(instanceMatrix[0].xyz / size.x, instanceMatrix[1].xyz / size.y, instanceMatrix[2].xyz / size.z);
    vW = w.xyz;
    vN = turn * normalize(nl);
    vNl = normal;
    vP = p * size;
    vTint = aTint; vGlow = aGlow; vInfo = aInfo;

    // Megatorre: un cuerpo alto, o uno que empieza muy por encima de la calle (los de arriba).
    float first = step(origin.y, ${(GROUND + 2).toFixed(1)});
    float big = step(64.0, max(size.y, origin.y - (${GROUND.toFixed(1)})));
    vSize = vec4(size, big);
    float s1 = h11(seed * 917.0 + 1.0), s2 = h11(seed * 373.0 + 4.0), s3 = h11(seed * 131.0 + 9.0), s4 = h11(seed * 577.0 + 2.0);
    // Cuatro fachadas: muro cortina (bandas), lamas verticales, ventanas en un muro y monolito de
    // vidrio. Las megatorres, casi todas de vidrio; las de muro, con ventanas corridas y no sueltas.
    float style = floor(s1 * 4.0);
    if (big > 0.5 && style == 2.0 && s4 > 0.25) style = s4 > 0.62 ? 0.0 : 3.0;
    float wall = style == 2.0 ? 1.0 : 0.0;
    vec2 pitch = style < 0.5 ? vec2(1.6, 4.0) : style < 1.5 ? vec2(1.25, 4.0) : style < 2.5 ? vec2(3.2, 3.7) : vec2(2.4, 4.2);
    vec2 frame = style < 0.5 ? vec2(0.07, 0.25) : style < 1.5 ? vec2(0.22, 0.1) : style < 2.5 ? vec2(0.34, 0.36) : vec2(0.04, 0.075);
    if (wall > 0.5 && big > 0.5) { pitch = vec2(2.2, 4.0); frame = vec2(0.09, 0.44); }
    vGrid = vec4(pitch, frame);
    // Pantalla (sin letras) en una cara de algunas megatorres, en su primer cuerpo.
    float sk = h11(seed * 433.0 + 8.0);
    vA = vec4(s2, s3, s4, big * first * (1.0 - drum) * (sk > 0.82 ? 2.0 : sk > 0.64 ? 1.0 : 0.0));
    // Luces: lamas que suben por la fachada, filos de neón en los cantos de los fustes (cuerpos
    // altos que arrancan de la calle), la coronación de cada cuerpo y un hilo bajo cada cinturón.
    float fk = h11(seed * 151.0 + 4.0);
    vB = vec4(
      big * (1.0 - drum) * (fk < 0.58 ? 0.0 : fk < 0.84 ? 1.0 : 2.0),
      step(150.0, size.y) * first * (1.0 - drum) * step(0.7, h11(seed * 719.0 + 3.0)),
      step(mix(0.88, 0.35, big), h11(seed * 277.0 + 6.0)),
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
      vec3 horizon = texture2D(uRing, vec2(u, 0.5)).rgb;
      vec3 sky = mix(horizon, uZenith, pow(y, 0.6));
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
      vec3 horizon = vTone;
      vec3 sky = mix(horizon, uZenith, y * (1.7 - 0.7 * y));
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

  void main() {
    vec3 n = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    float seed = vInfo.x, kind = vInfo.y, big = vSize.w;
    bool isRound = vInfo.w > 0.5;
    float above = vW.y - (${GROUND.toFixed(1)});
    // Entre torres llega menos cielo: más oscuro cuanto más abajo.
    float ao = mix(0.5, 1.0, smoothstep(0.0, 170.0, above));
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 col = vec3(0.0);
    vec3 glow = vec3(0.0);

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
        vec3 street = vec3(0.1, 0.066, 0.045) * lowS * lowS;
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
    col = mix(col, fog.rgb, fog.a);
    gl_FragColor = vec4(xenxoShown(col), 1.0);
    // Con post-proceso, lo que da luz pasa de 1: el resplandor (bloom) lo recoge.
    if (xenxoLinearOut()) gl_FragColor.rgb += glow * (1.0 - fog.a);
    #include <colorspace_fragment>
  }`;

function Buildings({ parts, rich }: { parts: Part[]; rich: boolean }) {
  const meshes = useMemo(() => {
    const material = new THREE.ShaderMaterial({ uniforms: air, defines: rich ? { RICH: "" } : {}, vertexShader: BUILDING_VS, fragmentShader: BUILDING_FS });
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
        info.set([p.seed, p.kind ?? 0, p.taper ?? 1, p.round ? 1 : 0], i * 4);
      });
      geo.setAttribute("aTint", new THREE.InstancedBufferAttribute(tint, 3));
      geo.setAttribute("aGlow", new THREE.InstancedBufferAttribute(glow, 3));
      geo.setAttribute("aInfo", new THREE.InstancedBufferAttribute(info, 4));
      m.frustumCulled = false;
      return m;
    };
    return { material, list: [build(box, parts.filter((p) => !p.round)), build(drum, parts.filter((p) => p.round))] };
  }, [parts, rich]);
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
 * El color del suelo en un punto (sin su aire): lo usan el suelo y las sombras que caen en él. De
 * lejos las calles se funden en su media, y lo que ya no se distingue ni se calcula (el suelo ocupa
 * media pantalla al mirar hacia abajo: cada cuenta de más se paga en todos esos píxeles).
 */
const GROUND_GLSL = /* glsl */ `
  ${AIR_GLSL}
  ${NOISE_GLSL}
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
  }`;

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
  uniform vec3 uSunDir;
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    w.xz -= uSunDir.xz * ((w.y - (${GROUND.toFixed(1)})) / uSunDir.y);
    w.y = ${(GROUND + 0.25).toFixed(2)};
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/** Las sombras de los edificios de las calles, de día (las megatorres no la dan: no se vería entera). */
function Shadows({ parts }: { parts: Part[] }) {
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


function Ground() {
  const mesh = useMemo(() => {
    const geo = new THREE.PlaneGeometry(NEXO_FAR * 2, NEXO_FAR * 2);
    geo.rotateX(-Math.PI / 2);
    geo.translate(C, GROUND, C);
    const m = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: air,
        vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: GROUND_FS,
      }),
    );
    m.frustumCulled = false;
    // Después de los edificios: casi todo el suelo queda tapado por ellos.
    m.renderOrder = 1;
    return m;
  }, []);
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
    float reach = (cameraPosition.y - uMistFloor) / max(-d.y, 0.04);
    vec3 tone = mix(ringTone(cameraPosition + d), airTone(cameraPosition + d * reach), smoothstep(0.0, 0.045, -d.y));
    float a = 1.0 - smoothstep(-0.015, 0.085, d.y);
    gl_FragColor = vec4(xenxoShown(tone), a * a);
    #include <colorspace_fragment>
  }`;

function Horizon() {
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(
      // Solo la parte de la esfera donde hay algo que pintar: de unos grados sobre el horizonte
      // hacia abajo (el resto sería cielo sombreado dos veces para nada).
      new THREE.SphereGeometry(NEXO_FAR * 0.94, 48, 12, 0, Math.PI * 2, Math.PI / 2 - 0.11, Math.PI / 2 + 0.11),
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
  }, []);
  useEffect(() => () => dispose(mesh), [mesh]);
  return <primitive object={mesh} />;
}

function dispose(m: THREE.Mesh | THREE.InstancedMesh) {
  m.geometry.dispose();
  (m.material as THREE.Material).dispose();
}

/**
 * En el nexo se ve hasta el horizonte: la cámara alcanza `NEXO_FAR` mientras se está en él (en el
 * resto del mundo, lo de siempre).
 */
function FarView() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useLayoutEffect(() => {
    const before = camera.far;
    camera.far = NEXO_FAR;
    camera.updateProjectionMatrix();
    return () => {
      camera.far = before;
      camera.updateProjectionMatrix();
    };
  }, [camera]);
  return null;
}

/** `rich`: el cristal con todos sus reflejos (escritorio; ver BUILDING_FS). */
export function NexoSkyline({ density, rich }: { density: number; rich: boolean }) {
  const parts = useMemo(() => megacity(density), [density]);
  return (
    <>
      <FarView />
      <Horizon />
      <Buildings parts={parts} rich={rich} />
      <Shadows parts={parts} />
      <Ground />
    </>
  );
}
