/**
 * Acciones en pareja (chocar los cinco, abrazo, apretón de manos): cuánto duran, a qué distancia se
 * ponen y cuándo y dónde se buscan las manos. Lo usan el propio jugador (selfPeople.ts) y quien mira
 * (remotePeople.ts), cada uno con la posición en que ve a la otra persona.
 */
import type * as THREE from "three";
import type { PairAction } from "@xenxo/protocol";
import type { PersonFx } from "./rig";

/** Cuánto dura cada una (s), a qué distancia se ponen (m) y cuándo entran y salen las manos (s). */
export const PAIR: Record<PairAction, { s: number; gap: number; reach: [number, number, number, number] }> = {
  high_five: { s: 1.55, gap: 0.82, reach: [0.22, 0.55, 0.78, 1.15] },
  hug: { s: 2.3, gap: 0.42, reach: [0.4, 0.9, 1.8, 2.2] },
  handshake: { s: 1.9, gap: 0.8, reach: [0.28, 0.6, 1.5, 1.85] },
};

/**
 * Dónde se buscan las manos (mundo) en cada acción en pareja, entre `a` (quien hace el gesto) y `b`
 * (la otra persona). Lo usa también quien mira (remotePeople.ts).
 */
export function pairTargets(kind: PairAction, t: number, ax: number, ay: number, az: number, b: THREE.Vector3, fx: PersonFx) {
  const ux = b.x - ax, uz = b.z - az;
  const d = Math.hypot(ux, uz) || 1;
  const nx = ux / d, nz = uz / d;
  // A su derecha (mirando hacia la otra persona).
  const rx = -nz, rz = nx;
  const mx = (ax + b.x) / 2, mz = (az + b.z) / 2, my = Math.min(ay, b.y);
  const [i0, i1, o0, o1] = PAIR[kind].reach;
  const w = t < i0 ? 0 : t < i1 ? (t - i0) / (i1 - i0) : t < o0 ? 1 : t < o1 ? 1 - (t - o0) / (o1 - o0) : 0;
  const k = w * w * (3 - 2 * w);
  fx.look.x = b.x;
  fx.look.y = b.y + 1.5;
  fx.look.z = b.z;
  fx.look.w = t < o1 ? 1 : 0;
  fx.reachL.w = 0;
  fx.reachR.w = 0;
  if (kind === "high_five") {
    fx.reachR.x = mx + rx * 0.06;
    fx.reachR.y = my + 1.7;
    fx.reachR.z = mz + rz * 0.06;
    fx.reachR.w = k;
  } else if (kind === "handshake") {
    fx.reachR.x = mx;
    fx.reachR.y = my + 0.98;
    fx.reachR.z = mz;
    fx.reachR.w = k;
  } else {
    // Abrazo: las manos a la espalda de la otra persona, una más alta que la otra.
    fx.reachL.x = b.x + nx * 0.1 - rx * 0.12;
    fx.reachL.y = b.y + 1.18;
    fx.reachL.z = b.z + nz * 0.1 - rz * 0.12;
    fx.reachR.x = b.x + nx * 0.1 + rx * 0.12;
    fx.reachR.y = b.y + 1.32;
    fx.reachR.z = b.z + nz * 0.1 + rz * 0.12;
    fx.reachL.w = fx.reachR.w = k * 0.85;
  }
}
