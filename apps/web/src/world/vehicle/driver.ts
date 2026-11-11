/**
 * Quien va al volante, el propio personaje y los de los demás: su cadera en el asiento del coche y
 * sus manos en el aro (lo pone el esqueleto de cada avatar, people/rig.ts, mida lo que mida). La pose
 * de la que parte es la de conducir (people/gestures.ts → `drive`); las medidas, las del coche (car.ts).
 */
import type * as THREE from "three";
import type { PersonFx, Target } from "../people/rig";
import { CAR, leanFor } from "./car";

/** Un vector del coche (en sus ejes), en el mundo: v' = q · v · q⁻¹, sin objetos. */
const _o = { x: 0, y: 0, z: 0 };
function turn(lx: number, ly: number, lz: number, q: THREE.Quaternion) {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const ix = qw * lx + qy * lz - qz * ly, iy = qw * ly + qz * lx - qx * lz, iz = qw * lz + qx * ly - qy * lx, iw = -qx * lx - qy * ly - qz * lz;
  _o.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  _o.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  _o.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return _o;
}

/** Un punto del coche en el mundo, con su peso; y hacia dónde va el codo o la rodilla (también en ejes del coche). */
function put(t: Target, at: { x: number; y: number; z: number }, side: number, p: THREE.Vector3, q: THREE.Quaternion, w: number, pole: readonly [number, number, number]) {
  const a = turn(at.x * side, at.y, at.z, q);
  t.x = p.x + a.x;
  t.y = p.y + a.y;
  t.z = p.z + a.z;
  t.w = w;
  const b = turn(pole[0] * side, pole[1], pole[2], q);
  t.px = b.x;
  t.py = b.y;
  t.pz = b.z;
}

/** Codos: abajo y un poco afuera y atrás. Rodillas: arriba y abiertas (entre ellas pasa la columna del volante). */
const ELBOW = [0.45, -1, -0.3] as const;
const KNEE = [0.5, 1, 0.15] as const;
const KNEE_R = [-0.5, 1, 0.15] as const;
const NONE = [0, 0, 0] as const;

/**
 * Sienta a alguien en el coche que está en `p` con giro `q`: `seat`, cuánto manda ya el asiento sobre
 * su cadera y sus pies (0–1: al subir y al bajar va entrando y saliendo); `hands`, si lleva las manos
 * al volante.
 */
export function driverFx(fx: PersonFx | null | undefined, p: THREE.Vector3, q: THREE.Quaternion, seat: number, hands: number) {
  if (!fx) return;
  put(fx.seat, CAR.driverHips, 1, p, q, seat, NONE);
  put(fx.footL, CAR.ankleL, 1, p, q, seat, KNEE);
  put(fx.footR, CAR.ankleR, 1, p, q, seat, KNEE_R);
  put(fx.reachL, CAR.wrist, 1, p, q, hands, ELBOW);
  put(fx.reachR, CAR.wrist, -1, p, q, hands, ELBOW);
}

/** Cuánto va recostado (rad): lo que pida su estatura sentado (car.ts → `leanFor`). */
export function driverLean(fx: PersonFx | null | undefined): number {
  return fx?.rig ? leanFor(fx.rig.sitHeight) : CAR.lean;
}

/** Ya no va sentado: suelta la cadera, los pies y las manos (y el codo vuelve a ir por donde iba). */
export function releaseDriver(fx: PersonFx | null | undefined) {
  if (!fx) return;
  off(fx.seat);
  off(fx.footL);
  off(fx.footR);
  off(fx.reachL);
  off(fx.reachR);
}
const off = (t: Target) => void (t.w = t.px = t.py = t.pz = 0);
