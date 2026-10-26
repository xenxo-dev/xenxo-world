import { PARCEL_BUDGETS, type Components } from "@xenxo/protocol";

/**
 * Zonas de construcción (parcelas): qué caja ocupa una entidad en el chunk, para que lo que
 * construye el agente de una parcela quepa entero en ella (no solo su centro).
 */

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

export interface Zone {
  chunk_id: string;
  owner: string;
  /** Parcela ("A1"…"D4"): de ella sale lo reservado para su portal. */
  parcel: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

function grow(box: Box | null, min: number[], max: number[]): Box {
  if (!box) return { min: [min[0]!, min[1]!, min[2]!], max: [max[0]!, max[1]!, max[2]!] };
  for (let i = 0; i < 3; i++) {
    box.min[i] = Math.min(box.min[i]!, min[i]!);
    box.max[i] = Math.max(box.max[i]!, max[i]!);
  }
  return box;
}

/** Caja local (antes de escala, giro y posición) de todo lo que dibuja o hace la entidad. */
export function localBox(c: Components, meshBounds: { min: number[]; max: number[] } | null): Box | null {
  let box: Box | null = null;
  const prim = c["primitive@1"];
  if (prim) box = grow(box, prim.size.map((v) => -v / 2), prim.size.map((v) => v / 2));
  if (c["mesh@1"]) {
    // Sin medidas no se puede comprobar: en una parcela solo entran modelos medidos.
    if (!meshBounds) return null;
    box = grow(box, meshBounds.min, meshBounds.max);
  }
  const col = c["collider@1"];
  if (col) box = grow(box, col.half_extents.map((v) => -v), col.half_extents);
  const label = c["label@1"];
  if (label) {
    const w = (label.text.length * label.size * 0.62) / 2;
    const h = label.size / 2;
    // Un rótulo que mira siempre a la cámara puede girar: ocupa su ancho en X y en Z.
    box = label.billboard ? grow(box, [-w, -h, -w], [w, h, w]) : grow(box, [-w, -h, -0.05], [w, h, 0.05]);
  }
  const portal = c["portal@1"];
  if (portal) {
    const [w, h] = portal.size;
    box = grow(box, [-w / 2, -h / 2, -0.1], [w / 2, h / 2, 0.1]);
  }
  return box ?? { min: [0, 0, 0], max: [0, 0, 0] };
}

/** Caja en el chunk: escala, giro (cuaternión) y posición del transform, con sus 8 esquinas. */
export function worldBox(t: Components["transform@1"], local: Box): Box {
  const [qx, qy, qz, qw] = t.r;
  const out: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < 8; i++) {
    const v = [
      (i & 1 ? local.max[0] : local.min[0]) * t.s[0]!,
      (i & 2 ? local.max[1] : local.min[1]) * t.s[1]!,
      (i & 4 ? local.max[2] : local.min[2]) * t.s[2]!,
    ] as [number, number, number];
    // v' = v + w·t + q×t, con t = 2·(q×v)
    const tx = 2 * (qy * v[2] - qz * v[1]);
    const ty = 2 * (qz * v[0] - qx * v[2]);
    const tz = 2 * (qx * v[1] - qy * v[0]);
    const r = [
      v[0] + qw * tx + (qy * tz - qz * ty),
      v[1] + qw * ty + (qz * tx - qx * tz),
      v[2] + qw * tz + (qx * ty - qy * tx),
    ];
    for (let k = 0; k < 3; k++) {
      const w = r[k]! + t.p[k]!;
      out.min[k] = Math.min(out.min[k]!, w);
      out.max[k] = Math.max(out.max[k]!, w);
    }
  }
  return out;
}

/** ¿Cabe la caja entera en la parcela (con 1 cm de margen) y entre el suelo y la altura máxima? */
export function fitsZone(box: Box, z: Zone): boolean {
  const e = 0.01;
  return (
    box.min[0] >= z.x0 - e &&
    box.max[0] <= z.x1 + e &&
    box.min[2] >= z.z0 - e &&
    box.max[2] <= z.z1 + e &&
    box.min[1] >= -0.5 &&
    box.max[1] <= PARCEL_BUDGETS.maxHeight + e
  );
}
