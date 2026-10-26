/**
 * Colisiones sencillas con los collider@1 del mundo (cajas orientadas).
 * El jugador es un círculo en el plano XZ; la cámara se acerca si una pared se interpone.
 * Sin físicas ni objetos nuevos por frame: se recalcula solo cuando cambia el mundo.
 */
import { CHUNK_SIZE, ColliderV1, TransformV1 } from "@xenxo/protocol";
import { world } from "../net/world-store";

interface Box {
  x: number;
  y: number;
  z: number;
  /** Medio tamaño en el espacio de la caja. */
  hx: number;
  hy: number;
  hz: number;
  /** Giro alrededor de Y (coseno y seno). */
  c: number;
  s: number;
}

let boxes: Box[] = [];
let version = -1;

/** Origen de un chunk respecto al lugar actual (que se dibuja en 0..CHUNK_SIZE). */
const chunkOrigin = (chunkId: string) => world.offsetOf(chunkId);

function refresh() {
  const v = world.getVersion();
  if (v === version) return;
  version = v;
  const out: Box[] = [];
  for (const e of world.entities.values()) {
    const col = ColliderV1.safeParse(e.components["collider@1"]);
    if (!col.success || col.data.trigger) continue;
    const t = TransformV1.safeParse(e.components["transform@1"]);
    if (!t.success) continue;
    const [ox, oz] = chunkOrigin(e.chunk_id);
    const [qx, qy, qz, qw] = t.data.r;
    // Solo el giro horizontal (los colisionadores del mundo están derechos).
    const yaw = Math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qy * qy + qx * qx));
    const [sx, sy, sz] = t.data.s;
    const [hx, hy, hz] = col.data.half_extents;
    out.push({
      x: t.data.p[0] + ox,
      y: t.data.p[1],
      z: t.data.p[2] + oz,
      hx: hx * Math.abs(sx),
      hy: hy * Math.abs(sy),
      hz: hz * Math.abs(sz),
      c: Math.cos(yaw),
      s: Math.sin(yaw),
    });
  }
  boxes = out;
}

/**
 * Empuja un círculo (centro px, pz; radio r; altura de pies y cabeza) fuera de las cajas.
 * Modifica `p` en su sitio. Dos pasadas bastan para esquinas.
 */
export function resolveCircle(p: { x: number; z: number }, r: number, feet: number, head: number) {
  refresh();
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxes) {
      if (feet > b.y + b.hy || head < b.y - b.hy) continue;
      // Al espacio local de la caja (giro inverso).
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const lx = dx * b.c - dz * b.s;
      const lz = dx * b.s + dz * b.c;
      const cx = Math.max(-b.hx, Math.min(b.hx, lx));
      const cz = Math.max(-b.hz, Math.min(b.hz, lz));
      let nx = lx - cx;
      let nz = lz - cz;
      const d2 = nx * nx + nz * nz;
      if (d2 >= r * r) continue;
      let push: number;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        nx /= d;
        nz /= d;
        push = r - d;
      } else {
        // Centro dentro de la caja: salir por el lado más cercano.
        const ex = b.hx - Math.abs(lx);
        const ez = b.hz - Math.abs(lz);
        if (ex < ez) {
          nx = Math.sign(lx) || 1;
          nz = 0;
          push = ex + r;
        } else {
          nx = 0;
          nz = Math.sign(lz) || 1;
          push = ez + r;
        }
      }
      // De vuelta al mundo.
      const wx = nx * b.c + nz * b.s;
      const wz = -nx * b.s + nz * b.c;
      p.x += wx * push;
      p.z += wz * push;
    }
  }
}

/** ¿Está el punto dentro de alguna caja (con margen)? */
function inside(x: number, y: number, z: number, margin: number) {
  for (const b of boxes) {
    if (Math.abs(y - b.y) > b.hy + margin) continue;
    const dx = x - b.x;
    const dz = z - b.z;
    const lx = dx * b.c - dz * b.s;
    const lz = dx * b.s + dz * b.c;
    if (Math.abs(lx) < b.hx + margin && Math.abs(lz) < b.hz + margin) return true;
  }
  return false;
}

/**
 * Fracción (0..1) del segmento objetivo→cámara que se puede recorrer sin meterse en una pared.
 * La cámara en tercera persona usa esto para no atravesar los edificios.
 */
export function cameraReach(tx: number, ty: number, tz: number, cx: number, cy: number, cz: number): number {
  refresh();
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    if (inside(tx + (cx - tx) * k, ty + (cy - ty) * k, tz + (cz - tz) * k, 0.25)) return Math.max(0.15, (i - 1) / steps);
  }
  return 1;
}

/**
 * Asiento cercano (un colisionador bajo y alargado, como un banco) para el gesto de sentarse.
 * Devuelve dónde colocarse y hacia dónde mirar (el frente del asiento es su +Z local).
 */
export function findSeat(x: number, z: number, maxDist = 1.8): { x: number; z: number; yaw: number } | null {
  refresh();
  let best: { x: number; z: number; yaw: number } | null = null;
  let bestD = maxDist;
  for (const b of boxes) {
    if (b.hy > 0.55 || b.hx < 0.6 || b.hz > 0.45) continue;
    // Borde delantero del asiento (en local: z = +hz * 0.2), de vuelta al mundo.
    const lz = b.hz * 0.2;
    const sx = b.x + lz * b.s;
    const sz = b.z + lz * b.c;
    const d = Math.hypot(sx - x, sz - z);
    if (d < bestD) {
      bestD = d;
      best = { x: sx, z: sz, yaw: Math.atan2(b.s, b.c) };
    }
  }
  return best;
}
