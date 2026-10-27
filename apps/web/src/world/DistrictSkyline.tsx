/**
 * La ciudad alrededor de cada distrito: lo que se ve más allá de sus calles y parcelas, con el
 * carácter del distrito (rascacielos de neón en Arcade, torres de vóxeles en Píxel, casas encaladas
 * en Ágora, naves y chimeneas en Taller, mesetas y antenas en Frontera, megatorres en Distrito Cero
 * y torres de caravanas apiladas en Vertical). Decorado del cliente (no se visita ni se construye),
 * con las mismas piezas que la ciudad del nexo: un draw call para los edificios y otro para los
 * coches voladores, sin texturas y sin trabajo por frame en la CPU. Densidad: `FEATURES.nexoCity`.
 */
import { useMemo } from "react";
import { CHUNK_SIZE } from "@xenxo/protocol";
import districts from "../../../realtime/src/districts.json";
import { usePlaceTheme } from "../net/world-store";
import { CarsMesh, CityBoxes, CityClock, CityGround, NEON, rng, type Box, type Car } from "./NexoCity";

const C = CHUNK_SIZE / 2;
/** Margen alrededor del chunk caminable: ahí no se pone nada. */
const KEEP = 10;
const REACH = 300;
/** Lo que mide el distrito (districts.json): la ciudad de alrededor empieza fuera. */
const [B0, B1] = districts.bounds as unknown as [number, number];

type Rand = () => number;
type Theme = (x: number, z: number, r: Rand, color: string, far: number) => Box[];

const pick = <T,>(r: Rand, a: T[]) => a[Math.floor(r() * a.length)]!;
const box = (x: number, y0: number, z: number, w: number, h: number, d: number, tint: string, kind: 0 | 1 | 2 = 0): Box => ({ x, y0, z, w, h, d, tint, kind });

/** Torre con franja de neón arriba y, a veces, un anuncio y una baliza. */
function tower(x: number, z: number, r: Rand, w: number, h: number, tint: string, neon: string, ads = 0.4): Box[] {
  const out = [box(x, 0, z, w, h, w * (0.8 + r() * 0.4), tint), box(x, h - 1.6, z, w + 0.3, 0.7, w * (0.8 + r() * 0.4) + 0.3, neon, 1)];
  if (r() < ads) out.push(box(x + (w / 2 + 0.15) * (r() < 0.5 ? -1 : 1), h * (0.35 + r() * 0.3), z, 0.25, 6 + r() * 8, w * 0.5, pick(r, NEON), 1));
  if (r() < 0.4) out.push(box(x, h, z, 0.6, 1.2, 0.6, "#ff3b3b", 2));
  return out;
}

const THEMES: Record<string, { pitch: number; fill: number; build: Theme; cars: number }> = {
  // Juegos 3D: rascacielos de cristal azulado con neones del distrito y del magenta del arcade.
  arcade: {
    pitch: 26,
    fill: 0.8,
    cars: 1,
    build: (x, z, r, color, far) => tower(x, z, r, 10 + r() * 10, 24 + r() * (40 + far * 60), pick(r, ["#4f6b85", "#5f7d99", "#3f5a73"]), r() < 0.6 ? color : "#ff4fd8", 0.6),
  },
  // Juegos 2D: torres de vóxeles, escalonadas y de colores, con píxeles encendidos.
  pixel: {
    pitch: 22,
    fill: 0.75,
    cars: 0.4,
    build: (x, z, r, color, far) => {
      const out: Box[] = [];
      const tint = pick(r, ["#ff4fd8", "#4fa3ff", "#ffd54f", "#6dff8a", "#ff7a45", "#a26bff"]);
      let w = 8 + r() * 8;
      let y = 0;
      const steps = 2 + Math.floor(r() * (3 + far * 3));
      for (let k = 0; k < steps; k++) {
        const h = 6 + r() * 10;
        out.push(box(x, y, z, w, h, w, tint));
        out.push(box(x, y + h - 0.6, z, w + 0.2, 0.6, w + 0.2, color, 1));
        y += h;
        w *= 0.72;
      }
      return out;
    },
  },
  // Quedadas: casas encaladas bajas con alguna torre de campanario y luz cálida.
  agora: {
    pitch: 16,
    fill: 0.85,
    cars: 0,
    build: (x, z, r, color, far) => {
      const out: Box[] = [box(x, 0, z, 8 + r() * 6, 5 + r() * 8 + far * 6, 8 + r() * 6, pick(r, ["#efe6d6", "#f4efe6", "#ead2ad", "#e9c690"]))];
      if (r() < 0.12) {
        const h = 16 + r() * 12;
        out.push(box(x + 3, 0, z + 3, 3.2, h, 3.2, "#efe6d6"), box(x + 3, h, z + 3, 2.2, 2.5, 2.2, "#c8693f"));
      }
      if (r() < 0.25) out.push(box(x, 3 + r() * 3, z - 4.2, 3, 0.4, 0.2, color, 1));
      return out;
    },
  },
  // Herramientas: naves industriales, chimeneas con baliza y grúas, en acero y naranja de seguridad.
  taller: {
    pitch: 30,
    fill: 0.8,
    cars: 0.3,
    build: (x, z, r, color, far) => {
      const steel = pick(r, ["#6a7584", "#7d8794", "#59616e", "#8a8f99"]);
      const w = 16 + r() * 10, d = 10 + r() * 8, h = 7 + r() * 6 + far * 6;
      const out: Box[] = [box(x, 0, z, w, h, d, steel), box(x, h - 0.9, z, w + 0.2, 0.5, d + 0.2, "#ff8a2c", 1)];
      if (r() < 0.45) {
        const ch = 22 + r() * (20 + far * 25);
        out.push(box(x + w / 2 - 2, 0, z, 2, ch, 2, "#9aa3ae"), box(x + w / 2 - 2, ch - 3, z, 2.2, 0.8, 2.2, "#ff3b3b", 1), box(x + w / 2 - 2, ch, z, 0.6, 1, 0.6, "#ff3b3b", 2));
      }
      if (r() < 0.15) {
        const ch = 30 + r() * 15;
        out.push(box(x - w / 2, 0, z - d / 2, 1.4, ch, 1.4, "#ffd54f"), box(x - w / 2 + 9, ch - 1.4, z - d / 2, 20, 1.2, 1.2, "#ffd54f"), box(x - w / 2 + 18, ch - 1.4, z - d / 2, 0.6, 0.6, 0.6, color, 2));
      }
      return out;
    },
  },
  // Experimentos: mesetas de roca, módulos de un puesto avanzado y antenas.
  frontera: {
    pitch: 34,
    fill: 0.55,
    cars: 0.2,
    build: (x, z, r, color, far) => {
      if (r() < 0.55) {
        const w = 18 + r() * 24, h = 8 + r() * (12 + far * 30);
        return [box(x, 0, z, w, h, w * (0.6 + r() * 0.6), pick(r, ["#8a6f55", "#9b7d5e", "#7a6352"])), box(x, h, z, w * 0.7, h * 0.25, w * 0.5, "#a88a6a")];
      }
      const out: Box[] = [box(x, 0, z, 9, 4, 9, "#c8cfdc"), box(x + 6, 0, z, 5, 3, 5, "#b8c2d6"), box(x, 4, z, 9.2, 0.3, 9.2, color, 1)];
      const ah = 18 + r() * 25;
      out.push(box(x - 6, 0, z, 0.5, ah, 0.5, "#c8cfdc"), box(x - 6, ah, z, 0.8, 1, 0.8, "#ff3b3b", 2));
      return out;
    },
  },
  // La ciudad de Xen: megatorres apretadas, anuncios por todas partes y tráfico aéreo.
  cero: {
    pitch: 22,
    fill: 0.92,
    cars: 1.6,
    build: (x, z, r, color, far) => {
      const h = 30 + Math.pow(r(), 1.3) * (60 + far * 110);
      const out = tower(x, z, r, 9 + r() * 9, h, pick(r, ["#2a2f45", "#33384f", "#252a3c", "#3b3f58"]), r() < 0.5 ? color : pick(r, NEON), 0.85);
      if (r() < 0.5) out.push(box(x, h * (0.3 + r() * 0.3), z, 10 + r() * 6, 0.5, 10 + r() * 6, pick(r, NEON), 1));
      return out;
    },
  },
  // Torres de caravanas apiladas sobre andamios: cada caravana, su ventana encendida.
  vertical: {
    pitch: 20,
    fill: 0.8,
    cars: 0.3,
    build: (x, z, r, color, far) => {
      const out: Box[] = [];
      const levels = 4 + Math.floor(r() * (5 + far * 9));
      const lh = 3.1;
      for (let k = 0; k < levels; k++) {
        const y = k * lh;
        const n = 2 + Math.floor(r() * 2);
        for (let i = 0; i < n; i++) {
          if (r() < 0.12) continue; // hueco
          const along = r() < 0.5;
          const dx = (i - (n - 1) / 2) * 3.4 + (r() - 0.5) * 0.8;
          const dz = (r() - 0.5) * 1.6;
          const tint = pick(r, ["#b9b2a4", "#c8bfae", "#a6a39a", "#d9c6a8", "#8f9aa3", "#c0a080", "#b07d5e"]);
          out.push(along ? box(x + dx, y + 0.25, z + dz, 2.6, 2.5, 7, tint) : box(x + dz, y + 0.25, z + dx, 7, 2.5, 2.6, tint));
          if (r() < 0.25) out.push(box(x + dx, y + 1.2, z + dz - (along ? 3.55 : 1.35), 1.2, 0.5, 0.1, r() < 0.5 ? color : "#ffd27a", 1));
        }
        // Andamio: cuatro postes por planta y una plataforma.
        for (const [px, pz] of [[-5.5, -4], [5.5, -4], [-5.5, 4], [5.5, 4]] as const) out.push(box(x + px, y, z + pz, 0.25, lh, 0.25, "#4a4f5c"));
        out.push(box(x, y, z, 11.5, 0.2, 8.5, "#3a3f4a"));
      }
      if (r() < 0.5) out.push(box(x, levels * lh, z, 0.5, 1, 0.5, "#ff3b3b", 2));
      return out;
    },
  },
};

function skylineBoxes(id: string, color: string, density: number): Box[] {
  const theme = THEMES[id];
  if (!theme) return [];
  const r = rng(id.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const out: Box[] = [];
  const P = theme.pitch * 1.4;
  for (let gx = C - REACH; gx <= C + REACH; gx += P) {
    for (let gz = C - REACH; gz <= C + REACH; gz += P) {
      const x = gx + (r() - 0.5) * P * 0.4;
      const z = gz + (r() - 0.5) * P * 0.4;
      const inside = x > B0 - KEEP - P / 2 && x < B1 + KEEP + P / 2 && z > B0 - KEEP - P / 2 && z < B1 + KEEP + P / 2;
      const dist = Math.hypot(x - C, z - C);
      if (inside || dist > REACH) continue;
      // Lejos, menos edificios (la bruma se los come y la Quest lo agradece).
      if (r() > theme.fill * density * (dist > 230 ? 0.55 : 1)) continue;
      const far = Math.min(1, Math.max(0, (dist - 150) / 130));
      out.push(...theme.build(x, z, r, color, far));
    }
  }
  return out;
}

function skylineCars(id: string, color: string, density: number): Car[] {
  const amount = (THEMES[id]?.cars ?? 0) * density;
  if (amount <= 0) return [];
  const r = rng(99);
  const out: Car[] = [];
  const ring = (radius: number, y: number, n: number, speed: number) => {
    const count = Math.max(1, Math.round(n * amount));
    for (let i = 0; i < count; i++) {
      out.push({ a: [C, C, radius + (r() - 0.5) * 2, y + (r() - 0.5) * 2], b: [speed / radius, (i / count) * Math.PI * 2 + r() * 0.3, 0, 0], glow: r() < 0.5 ? color : pick(r, NEON) });
    }
  };
  // Por fuera del distrito (mide 256 m) y por encima de sus torres.
  ring(185, 70, 12, 22);
  ring(225, 82, 14, -26);
  ring(265, 96, 14, 30);
  return out;
}

const BY_CHUNK = new Map((districts.districts as { id: string; chunk: string; color: string }[]).map((d) => [d.chunk, d]));

export function DistrictSkyline({ chunk, density }: { chunk: string; density: number }) {
  // Los del sistema, por su chunk; los de la comunidad, por la pista de WELCOME (su tema y su color).
  const hint = usePlaceTheme();
  const d = BY_CHUNK.get(chunk) ?? (hint && THEMES[hint.id] ? { id: hint.id, chunk, color: hint.color } : undefined);
  const id = d?.id, color = d?.color;
  const boxes = useMemo(() => (id && color ? skylineBoxes(id, color, density) : []), [id, color, density]);
  const cars = useMemo(() => (id && color ? skylineCars(id, color, density) : []), [id, color, density]);
  if (!d || density <= 0) return null;
  return (
    <>
      <CityClock ambience="night" />
      {/* Un poco por debajo del suelo del distrito: dentro no se ve; fuera, las calles de la ciudad. */}
      <CityGround y={-0.12} size={REACH * 2.4} />
      {boxes.length > 0 && <CityBoxes boxes={boxes} />}
      {cars.length > 0 && <CarsMesh list={cars} />}
    </>
  );
}
