import { PORTAL_ZONE_DEPTH, type Components } from "@xenxo/protocol";
import nexoLayout from "./nexo-layout.json";
import { SEED_ASSETS } from "./seed-assets";

/**
 * Piezas comunes de los lugares del sistema (nexo y distritos): giros, posiciones y el conjunto
 * de entidades de un portal ocupado (marco, portada, banda, monumento y rótulo).
 */

export type V3 = [number, number, number];
export type Q = [number, number, number, number];
export type Seeded = { id: string; components: Components };

export const r3 = (v: number) => Math.round(v * 1000) / 1000;
export const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Giro alrededor del eje Y (grados): el +Z local apunta hacia (sin, cos) en el mundo. */
export function yaw(deg: number): Q {
  const h = (deg * Math.PI) / 360;
  return [0, r6(Math.sin(h)), 0, r6(Math.cos(h))];
}

/** Punto local (x, y, z) de algo girado `deg` y situado en (px, pz) → chunk. */
export function at(px: number, pz: number, deg: number, x: number, y: number, z: number): V3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [r3(px + x * c + z * s), r3(y), r3(pz - x * s + z * c)];
}

/** Base de un marco de portal: dónde está y hacia dónde mira (+Z local, en grados). */
export interface Slot {
  index: number;
  x: number;
  z: number;
  facing: number;
}

/** Medidas del marco de portal (las mismas en el nexo y en las parcelas). */
export const FRAME = nexoLayout.portals;

const CATEGORY_COLORS = nexoLayout.colors as Record<string, string>;
export function categoryColor(category: string | undefined): string {
  return CATEGORY_COLORS[category ?? "other"] ?? CATEGORY_COLORS.other!;
}

/**
 * Sitio para aparecer delante de un portal, fuera de su franja: `facingPortal` = mirándolo
 * (al llegar a una parcela) o de espaldas (al volver al nexo, mirando a su centro).
 * Devuelve el punto y el giro en grados del protocolo (0 = norte).
 */
export function spawnInFront(slot: Slot, facingPortal: boolean): { p: V3; yaw: number } {
  const p = at(slot.x, slot.z, slot.facing, 0, 0, PORTAL_ZONE_DEPTH + 1.2);
  const y = facingPortal ? slot.facing : slot.facing + 180;
  return { p, yaw: ((((y + 180) % 360) + 360) % 360) - 180 };
}

/** Corta un título largo para el rótulo (la ficha enseña el completo). */
function short(text: string, max = 26): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

export interface PortalIds {
  portal: string;
  band: string;
  monument: string;
  label: string;
  /** Solo si el marco no está sembrado (parcelas): el propio marco y la peana. */
  frame?: string;
  pedestal?: string;
}

/**
 * Las entidades de un portal ocupado: el propio portal (con su portada), la banda de color de
 * su categoría, el monumento sobre la peana y el rótulo encima del marco. En las parcelas, también
 * el marco y la peana (en el nexo ya están sembrados).
 */
export function portalEntities(
  slot: Slot,
  ids: PortalIds,
  spec: {
    portal: NonNullable<Components["portal@1"]>;
    title: string;
    i18n?: Record<string, string>;
    color?: string;
    monument?: { lods: { hash: string; tris: number }[]; bounds: { min: number[]; max: number[] } | null } | undefined;
  },
): Seeded[] {
  const P = FRAME;
  const { x, z, facing } = slot;
  const out: Seeded[] = [];
  const color = spec.color ?? categoryColor(spec.portal.category);
  if (ids.frame) {
    const frame = SEED_ASSETS.nexo_frame;
    if (!frame) throw new Error("falta el modelo de la forja: nexo_frame");
    out.push({
      id: ids.frame,
      components: {
        "transform@1": { p: [r3(x), 0, r3(z)], r: yaw(facing), s: [1, 1, 1], parent: null },
        "mesh@1": { lods: frame.lods.map((l) => ({ hash: l.hash, media: "model/gltf-binary" as const, tris: l.tris })) },
        "collider@1": { shape: "box", half_extents: [P.w / 2 + 0.15, 1.8, 0.14], trigger: false },
      },
    });
  }
  if (ids.pedestal) {
    out.push({
      id: ids.pedestal,
      components: {
        "transform@1": { p: at(x, z, facing, 0, 0.5, P.pedestal), r: yaw(facing), s: [1, 1, 1], parent: null },
        "collider@1": { shape: "box", half_extents: [0.42, 0.5, 0.42], trigger: false },
      },
    });
  }
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
    // Cabe en un cubo de 1,6 m sobre la peana, centrado y mirando hacia donde mira el portal.
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

/** Monumento del sistema (emblema de la forja) en el formato de portalEntities. */
export function seedMonument(name: string) {
  const a = SEED_ASSETS[name];
  return a ? { lods: a.lods.slice(-1), bounds: a.lods[0]!.bounds } : undefined;
}
