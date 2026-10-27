import { PLACES, type Components } from "@xenxo/protocol";
import districtsLayout from "./districts.json";
import { at, FRAME, r3, yaw, type Seeded, type Slot, type V3 } from "./places";
import { PORTAL_ZONE_DEPTH } from "@xenxo/protocol";
import { SEED_ASSETS } from "./seed-assets";
import legacyV1 from "./districts-v1-parcels.json";
import cities from "./district-cities.json";

/**
 * Distritos: chunks temáticos alrededor de la plaza, cada uno con 16 parcelas de 10×10 m.
 * Quien publica un proyecto elige distrito y parcela libre; su portal (portada, monumento y
 * rótulo) va al fondo de la parcela, mirando a su calle. En la fase 2, la parcela será también
 * el terreno donde su dueño (o su agente) puede construir.
 *
 * La disposición sale de districts.json (la misma que usan la forja y la web). Desde la v2, en el
 * centro va la ciudad del distrito (forjada en tools/forge/city.py, con sus colisiones en
 * district-cities.json) y las parcelas la rodean; `migrateParcelPose` lleva lo de la v1 a su sitio.
 */
export const DISTRICT_SEED_VERSION = 2;

/** Versión de la disposición de las parcelas (la guarda cada chunk de distrito en su `meta`). */
export const PARCEL_LAYOUT_VERSION = "2";

export interface District {
  id: string;
  chunk: string;
  category: string;
  color: string;
  emblem: string;
  name: { es: string; en: string };
  desc: { es: string; en: string };
}

export interface Parcel {
  id: string;
  /** Centro de la parcela. */
  x: number;
  z: number;
  /** Hacia dónde mira (su calle), en grados. */
  facing: number;
}

const L = districtsLayout;
export const DISTRICTS: District[] = L.districts;
export const PARCELS: Parcel[] = L.parcels;
export const DISTRICT_SPAWN: V3 = L.spawn as V3;

export function districtById(id: unknown): District | null {
  return DISTRICTS.find((d) => d.id === id) ?? null;
}
export function districtByChunk(chunk: string): District | null {
  return DISTRICTS.find((d) => d.chunk === chunk) ?? null;
}
export function parcelIndex(id: unknown): number {
  return PARCELS.findIndex((p) => p.id === id);
}

/** Rectángulo de una parcela en el chunk (metros): donde puede construir su agente. */
export function parcelRect(i: number) {
  const q = PARCELS[i]!;
  const hw = L.parcel.w / 2, hd = L.parcel.d / 2;
  // Las parcelas miran a norte o sur (0/180): el ancho va en X y el fondo en Z.
  return { x0: q.x - hw, z0: q.z - hd, x1: q.x + hw, z1: q.z + hd };
}

/** Base del marco del portal de una parcela: al fondo, mirando a la calle. */
export function parcelSlot(i: number): Slot {
  const q = PARCELS[i]!;
  const [x, , z] = at(q.x, q.z, q.facing, 0, 0, -L.parcel.frame_back);
  return { index: i, x, z, facing: q.facing };
}

/**
 * Dónde aparecer para ver una parcela: en su calle, delante, mirando a su portal. No dentro de la
 * parcela: ahí puede haber cosas construidas.
 */
export function parcelSpawn(i: number): { p: V3; yaw: number } {
  const q = PARCELS[i]!;
  const p = at(q.x, q.z, q.facing, 0, 0, L.parcel.d / 2 + PARCEL_STREET_STEP);
  // El giro del protocolo (0 = norte) que mira hacia el portal es el mismo `facing` de la parcela.
  return { p, yaw: q.facing };
}

/** Metros que se aparece fuera de la parcela, ya en la calle. */
export const PARCEL_STREET_STEP = 1.6;

/**
 * Lo que una parcela guarda para su portal (no se construye ahí): el marco, la peana y la franja
 * que abre la ficha, hasta 3,6 m de alto. En coordenadas del chunk.
 */
export function parcelReserved(i: number) {
  const s = parcelSlot(i);
  const q = PARCELS[i]!;
  const hw = FRAME.w / 2 + 0.5;
  // Del borde del fondo de la parcela hasta un poco más allá de la franja del portal.
  const a = at(s.x, s.z, s.facing, -hw, 0, PORTAL_ZONE_DEPTH + 0.2);
  const b = at(q.x, q.z, q.facing, hw, 0, -L.parcel.d / 2);
  const bx = at(s.x, s.z, s.facing, hw, 0, 0);
  const xs = [a[0], b[0], bx[0]], zs = [a[2], b[2]];
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y1: 3.6 };
}

export function districtSeed(d: District, toNexo: { p: V3; yaw: number }): Seeded[] {
  const out: Seeded[] = [];
  const ground = SEED_ASSETS[`district_${d.id}`];
  if (!ground) throw new Error(`falta el modelo de la forja: district_${d.id}`);
  const lods = ground.lods.map((l) => ({ hash: l.hash, media: "model/gltf-binary" as const, tris: l.tris }));
  out.push({ id: `${d.id}_ground`, components: { "transform@1": { p: [32, 0, 32], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null }, "mesh@1": { lods } } });

  const solid = (id: string, p: V3, half: V3) =>
    out.push({
      id,
      components: {
        "transform@1": { p, r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
        "collider@1": { shape: "box", half_extents: half, trigger: false },
      },
    });
  const label = (id: string, p: V3, r: [number, number, number, number], text: string, i18n: Record<string, string> | undefined, size: number) =>
    out.push({
      id,
      components: {
        "transform@1": { p, r, s: [1, 1, 1], parent: null },
        "label@1": { text, ...(i18n ? { i18n } : {}), billboard: false, size, style: "neon", color: d.color },
      },
    });
  const FLAT: [number, number, number, number] = [-0.707107, 0, 0, 0.707107];

  /* --- Puerta de vuelta al nexo, al sur --- */
  const g = L.gate;
  const half = g.span / 2;
  for (const sx of [-1, 1]) solid(`${d.id}_gate_${sx < 0 ? "w" : "e"}`, [r3(32 + sx * (half + 0.45)), 3.1, g.z], [0.45, 3.1, 0.45]);
  label(`${d.id}_gate_label`, [32, 6.6, r3(g.z - 0.52)], yaw(180), d.name.en.toUpperCase(), { es: d.name.es.toUpperCase(), en: d.name.en.toUpperCase() }, 0.7);
  out.push({
    id: `${d.id}_gate_portal`,
    components: {
      "transform@1": { p: [32, 2.9, g.z], r: yaw(180), s: [1, 1, 1], parent: null },
      "portal@1": {
        to: { kind: "chunk", chunk_id: PLACES.nexo, spawn: toNexo.p, yaw: toNexo.yaw },
        size: [g.span, 5.8],
        title: "Nexus",
        i18n: { es: "Nexo", en: "Nexus" },
        category: "district",
      },
    } as Components,
  });

  /* --- La ciudad del centro: un modelo y las cajas de sus edificios --- */
  const city = SEED_ASSETS[`district_city_${d.id}`];
  if (city) {
    const clods = city.lods.map((l) => ({ hash: l.hash, media: "model/gltf-binary" as const, tris: l.tris }));
    out.push({ id: `${d.id}_city`, components: { "transform@1": { p: [32, 0, 32], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null }, "mesh@1": { lods: clods } } });
  }
  const boxes = (cities.cities as Record<string, number[][]>)[d.id] ?? [];
  boxes.forEach(([x, y, z, hx, hy, hz], n) => solid(`${d.id}_city_${n}`, [x!, y!, z!], [hx!, hy!, hz!]));

  /* --- Nombre del distrito en luz, en el suelo de la calle del sur, al llegar --- */
  label(`${d.id}_floor_name`, [32, 0.03, 52], FLAT, d.name.en.toLowerCase(), { es: d.name.es.toLowerCase(), en: d.name.en.toLowerCase() }, 1.5);

  /* --- Número de cada parcela, en el borde que da a su calle --- */
  PARCELS.forEach((q, i) => {
    const [x, , z] = at(q.x, q.z, q.facing, 0, 0, 4.2);
    label(`${d.id}_parcel_${q.id}`, [x, 0.03, z], multiply(yaw(q.facing), FLAT), q.id, undefined, 0.6);
    void i;
  });

  /* --- Luces: la plaza del centro y las esquinas de la calle en anillo --- */
  const [r0, r1, r2, r3_] = L.ring as [number, number, number, number];
  const lights: [number, number][] = [[32, 32], [(r0 + r1) / 2, (r0 + r1) / 2], [(r2 + r3_) / 2, (r0 + r1) / 2], [(r0 + r1) / 2, (r2 + r3_) / 2], [(r2 + r3_) / 2, (r2 + r3_) / 2]];
  for (const [lx, lz] of lights) {
    out.push({
      id: `${d.id}_light_${lx}_${lz}`,
      components: {
        "transform@1": { p: [lx, 3, lz], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
        "light@1": { type: "point", color: d.color, intensity: 2, range: 12, when: "always" },
      },
    });
  }
  return out;
}

/** Producto de cuaterniones [x, y, z, w]: primero b, luego a. */
function multiply(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return [
    r(aw * bx + ax * bw + ay * bz - az * by),
    r(aw * by - ax * bz + ay * bw + az * bx),
    r(aw * bz + ax * by - ay * bx + az * bw),
    r(aw * bw - ax * bx - ay * by - az * bz),
  ];
}

/* ------------------------------------------------------------------ */
/* Migración de la disposición v1 (avenida y 4 filas) a la v2 (ciudad)  */
/* ------------------------------------------------------------------ */

/** Parcelas de la v1 (para encontrar lo que había en cada una). */
export const PARCELS_V1: Parcel[] = legacyV1;

/** Ids de la v1 que ya no existen en la v2: su proyecto pasa a la parcela nueva del norte. */
export const RENAMED_PARCELS: Record<string, string> = { B4: "A5", C4: "A6" };

export function parcelIdV2(oldId: string): string {
  return RENAMED_PARCELS[oldId] ?? oldId;
}

/** Parcela de la v1 que contiene un punto (con medio metro de margen), o null. */
export function parcelV1At(x: number, z: number): Parcel | null {
  const hw = L.parcel.w / 2 + 0.5, hd = L.parcel.d / 2 + 0.5;
  return PARCELS_V1.find((q) => Math.abs(x - q.x) <= hw && Math.abs(z - q.z) <= hd) ?? null;
}

/**
 * Lleva una pieza de su parcela v1 a la misma parcela en la v2: la gira lo que haya girado la
 * parcela (alrededor de su centro) y la traslada. Devuelve null si la pieza no estaba en una parcela.
 */
export function migrateParcelPose(p: V3, r: [number, number, number, number]): { p: V3; r: [number, number, number, number] } | null {
  const old = parcelV1At(p[0], p[2]);
  if (!old) return null;
  const i = parcelIndex(parcelIdV2(old.id));
  const now = PARCELS[i];
  if (!now) return null;
  const delta = now.facing - old.facing;
  const np = at(now.x, now.z, delta, p[0] - old.x, p[1], p[2] - old.z);
  return { p: np, r: multiply(yaw(delta), r) };
}
