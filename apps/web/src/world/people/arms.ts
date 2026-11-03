/**
 * Las armas en la mano (§9 octies ter): dónde tiene cada una la boca del cañón y el guardamanos
 * (salen de tools/models/library/blasters.mjs), cómo se apunta (las manos con el IK del esqueleto,
 * people/rig.ts) y dónde está ahora la boca del cañón de cada persona (los rayos salen de ahí). Lo
 * comparten el propio jugador (guns.ts) y quien mira (Avatars.tsx). Sin objetos nuevos por frame.
 */
import { WEAPONS, type WeaponId } from "@xenxo/protocol";
import type { PersonFx } from "./rig";

/**
 * De cada arma (m, en el arma: la palma en el origen, arriba +Y y el cañón hacia +Z): la boca del
 * cañón y, a dos manos, el guardamanos, como (y, z). Los imprime blasters.mjs.
 */
export const ARMS: Record<WeaponId, { muzzle: [number, number]; fore?: [number, number] }> = {
  pipa: { muzzle: [0.074, 0.24] },
  chispa: { muzzle: [0.075, 0.238] },
  canon: { muzzle: [0.039, 0.287] },
  rafaga: { muzzle: [0.115, 0.328] },
  trueno: { muzzle: [0.073, 0.455], fore: [-0.044, 0.292] },
  tormenta: { muzzle: [0.055, 0.625], fore: [0.011, 0.423] },
  halcon: { muzzle: [0.066, 0.712], fore: [0.029, 0.33] },
};

/**
 * Dónde van las muñecas al apuntar, respecto a los pies y mirando hacia delante (−Z; a la derecha,
 * +X), para un personaje de 1,75 m (a otros, el IK los acerca lo que puede): a una mano, el brazo
 * estirado a la altura del hombro; a dos, la derecha junto al pecho.
 */
const ONE = { x: 0.12, y: 1.38, z: -0.47 };
const TWO = { x: 0.15, y: 1.25, z: -0.3 };
/** De la muñeca a la palma (m, hacia delante): el arma va en la palma. */
export const PALM = 0.07;
/** Sin esqueleto (el muñeco de respaldo): el arma delante del hombro derecho. */
export const NO_RIG_HAND = { x: 0.26, y: 1.22, z: -0.32 };

/** Respecto a los pies y al giro `yaw` (adelante = (−sin, −cos)) → mundo. */
function put(t: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number, yaw: number, lx: number, ly: number, lz: number, w: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  t.x = x + lx * c + lz * s;
  t.y = y + ly;
  t.z = z - lx * s + lz * c;
  t.w = w;
}

/**
 * Las manos apuntando con `weapon` (mundo), para quien tiene los pies en (x, y, z) y mira a `yaw`:
 * la derecha estirada (o junto al pecho, a dos manos) y la izquierda en el guardamanos.
 */
export function aimHands(fx: PersonFx, x: number, y: number, z: number, yaw: number, weapon: WeaponId) {
  const a = ARMS[weapon];
  if (WEAPONS[weapon].twoHanded && a.fore) {
    put(fx.reachR, x, y, z, yaw, TWO.x, TWO.y, TWO.z, 1);
    // La palma izquierda en el guardamanos: la muñeca, algo por detrás, por debajo y hacia dentro.
    const [fy, fz] = a.fore;
    put(fx.reachL, x, y, z, yaw, TWO.x - 0.05, TWO.y + fy - 0.05, TWO.z - PALM - fz + 0.05, 1);
  } else {
    put(fx.reachR, x, y, z, yaw, ONE.x, ONE.y, ONE.z, 1);
    fx.reachL.w = 0;
  }
}

/** Dónde está ahora la boca del cañón de cada persona (mundo; `t`: performance.now). La escribe HeldWeapon. */
export interface Muzzle {
  x: number;
  y: number;
  z: number;
  t: number;
}
export const muzzles = new Map<string, Muzzle>();

export function setMuzzle(id: string, x: number, y: number, z: number) {
  let m = muzzles.get(id);
  if (!m) muzzles.set(id, (m = { x: 0, y: 0, z: 0, t: 0 }));
  m.x = x;
  m.y = y;
  m.z = z;
  m.t = performance.now();
}
