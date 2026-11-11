/**
 * Los coches de los demás, tal como se dibujan: los apunta `Avatars.tsx` (uno por persona que va
 * conduciendo cerca, en cada frame) y los lee la física del coche propio (`physics.ts` → `OtherCars`),
 * que choca con ellos. Lo que mi golpe desplace a uno vuelve aquí (`ox`, `oy`, `oz`) y quien lo dibuja
 * lo suma: se ve al momento, sin esperar a que su pose lo cuente.
 *
 * Con quién se choca:
 * - fuera de una carrera, con cualquiera que vaya en marcha;
 * - corriendo una de salida conjunta, solo con quienes la corren (nadie de fuera se mete a estorbar),
 *   y en la parrilla, durante la cuenta atrás, con nadie.
 * Parados, apareciendo de golpe o ya encima: no cuentan (lo decide la física, `RIVAL_*`).
 */
import type * as THREE from "three";
import { activity } from "../../net/activity-store";
import { crashWith, stillRacing, type RoundEntry } from "../../net/round";
import type { OtherCar, OtherCars } from "./physics";

const cars = new Map<string, OtherCar>();

/** Lo apunta quien lo dibuja: dónde está ahora el coche de `id` (sin lo desplazado). Devuelve su ficha. */
export function putRival(id: string, p: THREE.Vector3, q: THREE.Quaternion): OtherCar {
  let c = cars.get(id);
  if (!c) {
    c = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, ox: 0, oy: 0, oz: 0 };
    cars.set(id, c);
  }
  c.x = p.x;
  c.y = p.y;
  c.z = p.z;
  c.qx = q.x;
  c.qy = q.y;
  c.qz = q.z;
  c.qw = q.w;
  return c;
}

/** Ha dejado de conducir, ya no se ve o se ha ido. */
export function dropRival(id: string) {
  cars.delete(id);
}

let only: readonly RoundEntry[] | null = null;
let visit: ((key: string, c: OtherCar) => void) | null = null;
function each(c: OtherCar, id: string) {
  if (only && !stillRacing(only, id)) return;
  visit!(id, c);
}

export const rivals: OtherCars = {
  each(cb) {
    const who = crashWith(activity.round);
    if (who === "none") return;
    only = who === "all" ? null : who;
    visit = cb;
    cars.forEach(each);
    visit = null;
  },
};

/**
 * ¿Hay algún coche con alguien al volante a menos de `range` m de (x, z)? Conduciendo cerca de otro
 * la pose se manda más seguido (net/pose-send.ts): cada uno choca con lo que ve del otro.
 */
export function rivalNear(x: number, z: number, range: number): boolean {
  nearX = x;
  nearZ = z;
  nearR2 = range * range;
  near = false;
  cars.forEach(isNear);
  return near;
}
let nearX = 0, nearZ = 0, nearR2 = 0, near = false;
function isNear(c: OtherCar) {
  if (!near && (c.x - nearX) ** 2 + (c.z - nearZ) ** 2 < nearR2) near = true;
}
