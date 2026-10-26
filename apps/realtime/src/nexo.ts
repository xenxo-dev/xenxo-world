import { PLACES, type Components } from "@xenxo/protocol";
import nexoLayout from "./nexo-layout.json";
import plazaLayout from "./plaza-layout.json";
import { SEED_ASSETS } from "./seed-assets";
import { SEED_COVERS } from "./seed-covers";

/**
 * El nexo: la entrada al mundo. Un anillo de portales mirando al centro; cada uno lleva
 * a un distrito (la plaza) o a la ficha de un proyecto de la comunidad, con su portada en
 * la pantalla y su monumento en la peana de delante.
 *
 * La disposición sale de nexo-layout.json (la misma que usa la forja). Sube NEXO_SEED_VERSION
 * si cambias el significado de algo; los cambios de contenido se detectan solos por la huella.
 */
export const NEXO_SEED_VERSION = 1;

type V3 = [number, number, number];
type Q = [number, number, number, number];
export type Seeded = { id: string; components: Components };

const L = nexoLayout;
const P = L.portals;
const [CX, CZ] = L.center as [number, number];

function yaw(deg: number): Q {
  const h = (deg * Math.PI) / 360;
  return [0, r6(Math.sin(h)), 0, r6(Math.cos(h))];
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Punto local (x, y, z) de algo girado `deg` y situado en (px, pz) → chunk. */
function at(px: number, pz: number, deg: number, x: number, y: number, z: number): V3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [r3(px + x * c + z * s), r3(y), r3(pz - x * s + z * c)];
}

export interface Slot {
  index: number;
  x: number;
  z: number;
  /** Grados: el +Z local del portal mira al centro. */
  facing: number;
}

/** Huecos de portal, en anillo; el 0 está al norte y siguen en el sentido de las agujas del reloj. */
export const NEXO_SLOTS: Slot[] = Array.from({ length: P.count }, (_, i) => {
  const phi = (360 * i) / P.count;
  const a = (phi * Math.PI) / 180;
  return { index: i, x: r3(CX + P.ring * Math.sin(a)), z: r3(CZ - P.ring * Math.cos(a)), facing: phi === 0 ? 0 : -phi };
});

/** Huecos libres para proyectos (todos menos los de los distritos). */
export const PROJECT_SLOTS = NEXO_SLOTS.filter((s) => s.index !== L.plaza_slot);

export const NEXO_SPAWN: V3 = [L.spawn[0]!, 0, L.spawn[1]!];

const CATEGORY_COLORS = L.colors as Record<string, string>;
export function categoryColor(category: string | undefined): string {
  return CATEGORY_COLORS[category ?? "other"] ?? CATEGORY_COLORS.other!;
}

/** Corta un título largo para el rótulo (la ficha enseña el completo). */
function short(text: string, max = 26): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Las entidades de un portal ocupado: el propio portal (con su portada), la banda de color de
 * su categoría, el monumento sobre la peana y el rótulo encima del marco.
 */
export function portalEntities(
  slot: Slot,
  ids: { portal: string; band: string; monument: string; label: string },
  spec: {
    portal: NonNullable<Components["portal@1"]>;
    title: string;
    i18n?: Record<string, string>;
    monument?: { lods: { hash: string; tris: number }[]; bounds: { min: number[]; max: number[] } | null } | undefined;
  },
): Seeded[] {
  const { x, z, facing } = slot;
  const out: Seeded[] = [];
  const color = categoryColor(spec.portal.category);
  out.push({
    id: ids.portal,
    components: {
      "transform@1": { p: at(x, z, facing, 0, P.bottom + P.h / 2, 0), r: yaw(facing), s: [1, 1, 1], parent: null },
      "portal@1": spec.portal,
    },
  });
  out.push({
    id: ids.band,
    components: {
      "transform@1": { p: at(x, z, facing, 0, P.bottom - 0.2, 0.1), r: yaw(facing), s: [1, 1, 1], parent: null },
      "primitive@1": { shape: "box", size: [P.w, 0.05, 0.04], color, emissive: true, finish: "matte" },
    },
  });
  if (spec.monument) {
    // Cabe en un cubo de 1,6 m sobre la peana, centrado y mirando al centro del nexo.
    const b = spec.monument.bounds;
    const dims = b ? [b.max[0]! - b.min[0]!, b.max[1]! - b.min[1]!, b.max[2]! - b.min[2]!] : [1, 1, 1];
    const scale = r6(Math.min(4, 1.6 / Math.max(0.01, ...dims)));
    const cx = b ? -((b.max[0]! + b.min[0]!) / 2) * scale : 0;
    const cz = b ? -((b.max[2]! + b.min[2]!) / 2) * scale : 0;
    const lift = b ? -b.min[1]! * scale : 0;
    out.push({
      id: ids.monument,
      components: {
        "transform@1": { p: at(x, z, facing, cx, P.pedestal_h + lift, P.pedestal + cz), r: yaw(facing), s: [scale, scale, scale], parent: null },
        "mesh@1": { lods: spec.monument.lods.map((l) => ({ hash: l.hash, media: "model/gltf-binary" as const, tris: l.tris })) },
      },
    });
  }
  out.push({
    id: ids.label,
    components: {
      "transform@1": { p: at(x, z, facing, 0, P.bottom + P.h + 0.55, 0.05), r: yaw(facing), s: [1, 1, 1], parent: null },
      "label@1": {
        text: short(spec.title),
        ...(spec.i18n ? { i18n: Object.fromEntries(Object.entries(spec.i18n).map(([k, v]) => [k, short(v)])) } : {}),
        billboard: false,
        size: 0.38,
        style: "neon",
        color,
      },
    },
  });
  return out;
}

export function nexoSeed(): Seeded[] {
  const out: Seeded[] = [];
  const [cx, cz] = L.center as [number, number];
  const asset = (name: string) => {
    const a = SEED_ASSETS[name];
    if (!a) throw new Error(`falta el modelo de la forja: ${name}`);
    return a;
  };
  const mesh = (id: string, name: string, p: V3, deg = 0, collider?: V3) => {
    const components: Components = {
      "transform@1": { p, r: yaw(deg), s: [1, 1, 1], parent: null },
      "mesh@1": { lods: asset(name).lods.map((l) => ({ hash: l.hash, media: "model/gltf-binary" as const, tris: l.tris })) },
    };
    if (collider) components["collider@1"] = { shape: "box", half_extents: collider, trigger: false };
    out.push({ id, components });
  };
  const solid = (id: string, p: V3, deg: number, half: V3) =>
    out.push({
      id,
      components: {
        "transform@1": { p, r: yaw(deg), s: [1, 1, 1], parent: null },
        "collider@1": { shape: "box", half_extents: half, trigger: false },
      },
    });

  /* --- Suelo, faro y borde --- */
  mesh("nexo_floor", "nexo_floor", [cx, 0, cz]);
  mesh("nexo_beacon", "nexo_beacon", [cx, 0, cz], 0, [0.9, 1, 0.9]);
  out.push({
    id: "nexo_beacon_light",
    components: {
      "transform@1": { p: [cx, 1.2, cz], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
      "light@1": { type: "point", color: L.colors.line, intensity: 2.5, range: 12, when: "always" },
    },
  });
  // Barandilla invisible en el borde: la plataforma flota en el vacío.
  const EDGE = 32;
  const rEdge = L.platform + 0.35;
  for (let i = 0; i < EDGE; i++) {
    const phi = (360 * i) / EDGE;
    const a = (phi * Math.PI) / 180;
    const half = (Math.PI * rEdge) / EDGE + 0.05;
    solid(`nexo_edge_${i}`, [r3(cx + rEdge * Math.sin(a)), 1, r3(cz - rEdge * Math.cos(a))], -phi, [r3(half), 1, 0.2]);
  }

  /* --- «xenxo» en luz, embutido en el suelo del círculo central --- */
  out.push({
    id: "nexo_letters",
    components: {
      "transform@1": { p: [L.letters.p[0]!, 0.03, L.letters.p[1]!], r: [-0.707107, 0, 0, 0.707107], s: [1, 1, 1], parent: null },
      "label@1": { text: "xenxo", billboard: false, size: L.letters.size, style: "neon", color: L.colors.line },
    },
  });

  /* --- Marcos de portal (todos) con su peana --- */
  for (const s of NEXO_SLOTS) {
    mesh(`nexo_frame_${s.index}`, "nexo_frame", [s.x, 0, s.z], s.facing, [P.w / 2 + 0.15, 1.8, 0.14]);
    solid(`nexo_pedestal_${s.index}`, at(s.x, s.z, s.facing, 0, 0.5, P.pedestal), s.facing, [0.42, 0.5, 0.42]);
  }

  /* --- Distrito: la plaza --- */
  const gate = SEED_ASSETS.gate;
  out.push(
    ...portalEntities(
      NEXO_SLOTS[L.plaza_slot]!,
      { portal: "nexo_portal_plaza", band: "nexo_band_plaza", monument: "nexo_monument_plaza", label: "nexo_label_plaza" },
      {
        portal: {
          to: { kind: "chunk", chunk_id: PLACES.plaza, spawn: [plazaLayout.spawn[0]!, 0, plazaLayout.spawn[1]!], yaw: 0 },
          size: [P.w, P.h],
          ...(SEED_COVERS.plaza ? { cover: SEED_COVERS.plaza } : {}),
          title: "The Plaza",
          i18n: { es: "La Plaza", en: "The Plaza" },
          category: "district",
        },
        title: "The Plaza",
        i18n: { es: "La Plaza", en: "The Plaza" },
        monument: gate ? { lods: gate.lods.slice(-1), bounds: gate.lods[0]!.bounds } : undefined,
      },
    ),
  );

  return out;
}

/** Portal de vuelta al nexo bajo el arco de la puerta de la plaza. */
export function plazaGatePortal(): Seeded {
  const g = plazaLayout.gate;
  const height = 4.2 + g.span / 2;
  return {
    id: "gate_portal",
    components: {
      "transform@1": { p: [g.p[0]!, r3(height / 2), g.p[1]!], r: yaw(g.facing), s: [1, 1, 1], parent: null },
      "portal@1": {
        to: { kind: "chunk", chunk_id: PLACES.nexo, spawn: NEXO_SPAWN, yaw: 0 },
        size: [g.span, r3(height)],
        title: "Nexus",
        i18n: { es: "Nexo", en: "Nexus" },
        category: "district",
      },
    },
  };
}
