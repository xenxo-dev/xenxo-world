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
import { useMemo } from "react";
import { CHUNK_SIZE } from "@xenxo/protocol";
import { NEXO_VIEW, rng } from "./city-air";
import { CityBuildings, CityGround, CityHorizon, CityShadows, FarView, GLASS, GLOW, megatower, PITCH, pick, RED, ROAD, spire, STREET, SUPER, valueNoise, type Part } from "./city-kit";

const C = CHUNK_SIZE / 2;
/** Suelo de la ciudad (la plataforma está en y = 0). */
export const GROUND = NEXO_VIEW.floor;
// La cuadrícula de calles (40 m, con 12 de calzada) y una megatorre cada tres manzanas: entre
// ellas, las avenidas (una pasa por el centro del nexo).
export { PITCH, ROAD, SUPER };
/** Hasta dónde llega la ciudad de las calles, con sus edificios uno a uno. */
export const LOW_R = 330;
/** Las megatorres: desde fuera de los carriles de los coches voladores hasta perderse en la bruma. */
const MEGA_R0 = 290;
const MEGA_R1 = 1740;
/** Hasta dónde ve la cámara en el nexo (en el resto del mundo, 400 m). */
export const NEXO_FAR = NEXO_VIEW.far;

/* ------------------------------------------------------------------ */
/* La ciudad                                                            */
/* ------------------------------------------------------------------ */

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
        megatower(out, r, x, z, H, F, form === 6 && dist < 440 ? 3 : form, base, GROUND);
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

/** `rich`: el cristal con todos sus reflejos (escritorio; ver city-kit.tsx). */
export function NexoSkyline({ density, rich }: { density: number; rich: boolean }) {
  const parts = useMemo(() => megacity(density), [density]);
  return (
    <>
      <FarView far={NEXO_FAR} />
      <CityHorizon far={NEXO_FAR} />
      <CityBuildings parts={parts} rich={rich} />
      <CityShadows parts={parts} />
      <CityGround far={NEXO_FAR} y={GROUND} />
    </>
  );
}
