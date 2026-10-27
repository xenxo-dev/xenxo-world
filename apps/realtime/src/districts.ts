import { PLACES, type Components } from "@xenxo/protocol";
import districtsLayout from "./districts.json";
import { at, FRAME, r3, yaw, type Seeded, type Slot, type V3 } from "./places";
import { PORTAL_ZONE_DEPTH } from "@xenxo/protocol";
import { SEED_ASSETS } from "./seed-assets";
import legacyV1 from "./districts-v1-parcels.json";
import legacyV2 from "./districts-v2-parcels.json";
import cities from "./district-cities.json";
import activities from "./district-activities.json";

/** Actividades del sistema de un distrito (district-activities.json). */
interface DistrictActivities {
  hunts?: { id: string; piece: string; radius: number; items: { p: V3; note?: Record<string, string> }[] }[];
  boards?: { kind: "race" | "hunt"; id: string; p: V3; yaw: number; size: [number, number]; title?: { es: string; en: string } }[];
  props?: { piece: string; p: V3; yaw: number; half: V3 }[];
  labels?: { text: { es: string; en: string }; p: V3; yaw: number; size: number }[];
}

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
export const PARCEL_LAYOUT_VERSION = "3";

export interface District {
  id: string;
  chunk: string;
  category: string;
  color: string;
  emblem: string;
  name: { es: string; en: string };
  desc: { es: string; en: string };
  /** Próximamente: su isla está en el nexo con la puerta cerrada; solo entra moderación y no se publica en él. */
  soon?: boolean;
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
/**
 * Hasta dónde llega un distrito (mín. y máx. en X y en Z, metros del chunk). Puede ser más grande
 * que su chunk: entonces WELCOME lo dice en `walk` y las poses se reparten por cercanía.
 */
export const DISTRICT_BOUNDS = L.bounds as [number, number];

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

  /* --- Actividades del sistema (district-activities.json): búsquedas y sus marcadores --- */
  const acts = (activities as unknown as Record<string, DistrictActivities | undefined>)[d.id];
  for (const h of acts?.hunts ?? []) {
    const piece = SEED_ASSETS[h.piece];
    if (!piece) throw new Error(`falta el modelo de la forja: ${h.piece}`);
    const plods = piece.lods.map((l) => ({ hash: l.hash, media: "model/gltf-binary" as const, tris: l.tris }));
    h.items.forEach((it, n) =>
      out.push({
        id: `${d.id}_${h.id}_${n + 1}`,
        components: {
          "transform@1": { p: it.p, r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
          "mesh@1": { lods: plods },
          "collectible@1": { set: h.id, radius: h.radius, ...(it.note ? { note: it.note } : {}) },
        } as Components,
      }),
    );
  }
  for (const b of acts?.boards ?? []) {
    out.push({
      id: `${d.id}_board_${b.id}`,
      components: {
        "transform@1": { p: b.p, r: yaw(b.yaw), s: [1, 1, 1], parent: null },
        "scoreboard@1": { kind: b.kind, id: b.id, size: b.size },
      } as Components,
    });
    if (b.title) label(`${d.id}_board_${b.id}_title`, [b.p[0], r3(b.p[1] + b.size[1] / 2 + 0.7), b.p[2]], yaw(b.yaw), b.title.en, b.title, 0.55);
  }

  /* --- Atrezo modelado (los modelos generados de seed-assets), con su caja --- */
  (acts?.props ?? []).forEach((pr, n) => {
    const piece = SEED_ASSETS[pr.piece];
    if (!piece) throw new Error(`falta el modelo: ${pr.piece}`);
    const plods = piece.lods.map((l) => ({ hash: l.hash, media: "model/gltf-binary" as const, tris: l.tris }));
    out.push({
      id: `${d.id}_prop_${n + 1}`,
      components: {
        "transform@1": { p: pr.p, r: yaw(pr.yaw), s: [1, 1, 1], parent: null },
        "mesh@1": { lods: plods },
      } as Components,
    });
    // La caja va aparte, centrada en su altura (el modelo está apoyado en el suelo). Sin caja (0):
    // la colisión ya la pone la ciudad (la peana de la escultura de Xen).
    if (pr.half[1] > 0) solid(`${d.id}_prop_${n + 1}_box`, [pr.p[0], r3(pr.p[1] + pr.half[1]), pr.p[2]], pr.half);
  });
  (acts?.labels ?? []).forEach((lb, n) => label(`${d.id}_sign_${n + 1}`, lb.p, yaw(lb.yaw), lb.text.en, lb.text, lb.size));

  /* --- Nombre del distrito en luz, en el suelo de la avenida del sur, al llegar --- */
  label(`${d.id}_floor_name`, [32, 0.03, 140], FLAT, d.name.en.toLowerCase(), { es: d.name.es.toLowerCase(), en: d.name.en.toLowerCase() }, 1.5);

  /* --- Número de cada parcela, en el borde que da a su calle --- */
  PARCELS.forEach((q, i) => {
    const [x, , z] = at(q.x, q.z, q.facing, 0, 0, 4.2);
    label(`${d.id}_parcel_${q.id}`, [x, 0.03, z], multiply(yaw(q.facing), FLAT), q.id, undefined, 0.6);
    void i;
  });

  /* --- Luces: la plaza del centro y las esquinas de la calle en anillo --- */
  const [a, b] = L.roads.ring1 as [number, number];
  const m1 = (a + b) / 2, m2 = 64 - m1; // esquinas del anillo 1
  const lights: [number, number][] = [[32, 32], [m1, m1], [m2, m1], [m1, m2], [m2, m2], [32, 140]];
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
/* Migración de disposiciones anteriores de las parcelas                */
/* ------------------------------------------------------------------ */
/*
 * v1: avenida y 4 filas de 10 × 10 m (A1–D4). v2: ciudad pequeña en el centro y 16 parcelas de
 * 10 × 10 m en anillo (A1–A6, B1–B3, C1–C3, D1–D4). v3: distrito de 256 m con 64 parcelas de
 * 15 × 15 m (N, S, E, W). Cada chunk guarda en su `meta` la versión que tiene (sin nada = v1).
 */

/** Parcelas de la v1 y la v2 (siempre de 10 × 10 m), para encontrar lo que había en cada una. */
export const PARCELS_V1: Parcel[] = legacyV1;
export const PARCELS_V2: Parcel[] = legacyV2;

/** De la v1 a la v2: B4 y C4 desaparecieron y su proyecto pasó a A5 y A6. */
const V1_TO_V2: Record<string, string> = { B4: "A5", C4: "A6" };
/** De la v2 a la v3: cada lado a su lado y lo de junto a la puerta, junto a la avenida del sur. */
const V2_TO_V3: Record<string, string> = {
  A1: "N1", A2: "N2", A3: "N3", A4: "N4", A5: "N5", A6: "N6",
  B1: "W1", B2: "W2", B3: "W3", C1: "E1", C2: "E2", C3: "E3",
  D1: "S2", D2: "S3", D3: "S4", D4: "S5",
};

/** Id de hoy de una parcela de una versión anterior. */
export function currentParcelId(oldId: string, from: 1 | 2): string {
  const v2 = from === 1 ? V1_TO_V2[oldId] ?? oldId : oldId;
  return V2_TO_V3[v2] ?? v2;
}

/** Renombres que el Directory aplica a los proyectos (en orden: v1→v2 y luego v2→v3). */
export const RENAMED_PARCELS: [string, string][] = [...Object.entries(V1_TO_V2), ...Object.entries(V2_TO_V3)];

const OLD_HALF = 5 + 0.5; // las parcelas de la v1 y la v2 medían 10 m (más medio metro de margen)

function oldParcelAt(list: Parcel[], x: number, z: number): Parcel | null {
  return list.find((q) => Math.abs(x - q.x) <= OLD_HALF && Math.abs(z - q.z) <= OLD_HALF) ?? null;
}

/** Parcela de hoy a la que va un slot (índice) de una versión anterior, o -1. */
export function migrateSlot(slot: number, from: 1 | 2): number {
  const old = (from === 1 ? PARCELS_V1 : PARCELS_V2)[slot];
  return old ? parcelIndex(currentParcelId(old.id, from)) : -1;
}

/**
 * Lleva una pieza de su parcela de una versión anterior a la misma parcela hoy: la gira lo que haya
 * girado la parcela (alrededor de su centro) y la traslada. null si la pieza no estaba en una parcela.
 */
export function migrateParcelPose(p: V3, r: [number, number, number, number], from: 1 | 2): { p: V3; r: [number, number, number, number] } | null {
  const old = oldParcelAt(from === 1 ? PARCELS_V1 : PARCELS_V2, p[0], p[2]);
  if (!old) return null;
  const now = PARCELS[parcelIndex(currentParcelId(old.id, from))];
  if (!now) return null;
  const delta = now.facing - old.facing;
  const np = at(now.x, now.z, delta, p[0] - old.x, p[1], p[2] - old.z);
  return { p: np, r: multiply(yaw(delta), r) };
}
