/**
 * Las manos en el borde o en la valla (parkour), para el esqueleto (people/rig.ts → reach): dónde va el
 * centro de cada palma, hacia dónde mira, hacia dónde apuntan los dedos, cómo se doblan y hacia dónde
 * va el codo. Lo usan el jugador (Player.tsx) y la prueba de los gestos (test/gestures.mts).
 *
 * - Colgado (y al empezar a trepar, mientras tira de los brazos): agarrado al canto, con los dedos por
 *   encima (`hook`), la palma contra la cara de la pared y el antebrazo pegado a ella, por fuera, con
 *   la muñeca recta. Antes la muñeca iba encima del tejado y la mano seguía hacia arriba: los dedos,
 *   como garras en el aire, y el antebrazo atravesaba el canto.
 * - Saltando una valla, subiendo a un borde bajo o acabando de trepar: las palmas apoyadas encima, con
 *   los dedos hacia dentro (`open`) y la muñeca en el canto. Al trepar, de lo uno a lo otro poco a poco.
 *
 * Las medidas, de la mano de cada avatar (rig.ts → size.grip): así los dedos caen en el canto en
 * cualquiera. Lo mismo para quien se ve colgado desde fuera (Avatars.tsx: el canto, de las reglas de
 * moves.ts, `ledgeHandsAt`), y el dibujo sube o baja igual (`hangLift`).
 */
import type { Parkour } from "./moves";
import { BODY, type PersonFx, type Target } from "../people/rig";

/** Del centro de la palma a su piel (m). */
const PALM_SKIN = 0.013;
/**
 * Agarrada: la segunda articulación de los dedos (la del más corto: rig.ts → size.grip), por encima del
 * canto (m): la mitad de lo que mide de grueso un dedo, para que la falange que se dobla quede
 * apoyada encima.
 */
const OVER = 0.009;
/** Apoyada encima: cuánto hacia dentro del canto va el centro de la palma (por lo que mide la mano). */
const ON_TOP = 0.5;
/** Trepando desde colgado: de agarrada al canto a apoyada encima, en este tramo (de 0 a 1 del movimiento). */
const PULL_FROM = 0.18;
const PULL_TO = 0.4;

/** Colgado de un borde, lo que puede bajar el dibujo para que los brazos (largos) vayan estirados (m). */
export const HANG_SINK = 0.3;

/** De agarrada al canto (0) a apoyada encima (1): colgado, trepando a los `p` (0–1) o encima. */
export function onTopAt(move: string, p: number): number {
  if (move === "hang") return 0;
  if (move !== "climb") return 1;
  const k = Math.min(1, Math.max(0, (p - PULL_FROM) / (PULL_TO - PULL_FROM)));
  return k * k * (3 - 2 * k);
}

/** Pone las dos manos (con su peso, `pk.hand.w`). */
export function ledgeHands(pk: Parkour, fx: PersonFx) {
  const h = pk.hand;
  ledgeHandsAt(fx, pk.nx, pk.nz, h.lx, h.ly, h.lz, h.rx, h.ry, h.rz, h.w, onTopAt(pk.move, pk.p));
}

/**
 * Las dos manos en el canto de una pared que mira hacia (nx, nz) (de ella hacia quien trepa): en los
 * puntos del canto de cada una, con peso `w`, de agarradas (`top` 0) a apoyadas encima (1).
 */
export function ledgeHandsAt(fx: PersonFx, nx: number, nz: number, lx: number, ly: number, lz: number, rx: number, ry: number, rz: number, w: number, top: number) {
  const size = fx.rig?.size ?? BODY;
  // Agarrada: la palma, por debajo del canto lo que va de ella a la segunda articulación de los dedos
  // (lo de después, doblado encima).
  const down = size.grip - OVER;
  put(fx.reachL, nx, nz, lx, ly, lz, w, -1, top, size.hand, down);
  put(fx.reachR, nx, nz, rx, ry, rz, w, 1, top, size.hand, down);
}

/**
 * Lo que sube el dibujo de quien cuelga o trepa (m) para que sus brazos lleguen al canto (`need`: lo
 * que les falta, rig.ts → reachLift) y, colgado, lo que baja si les sobra, como mucho HANG_SINK y sin
 * pasar de `floor` (lo que hay hasta el suelo, negativo); al trepar, lo bajado se recoge poco a poco.
 */
export function hangLift(lift: number, need: number, dt: number, hanging: boolean, floor: number): number {
  const low = hanging ? Math.min(0, Math.max(-HANG_SINK, floor)) : Math.min(0, lift + dt * 1.5);
  return Math.min(0.6, Math.max(low, lift + need * Math.min(1, dt * 14)));
}

/** Una mano: (x, y, z), el punto del canto donde va; `side`, −1 la izquierda y 1 la derecha. */
function put(t: Target, nx: number, nz: number, x: number, y: number, z: number, w: number, side: number, top: number, hand: number, down: number) {
  // n: de la pared hacia quien trepa; a su derecha, (n.z, −n.x).
  const rx = nz, rz = -nx;
  const hook = 1 - top;
  // Agarrada: contra la cara de la pared, por debajo del canto (`down`), la palma hacia la pared y los
  // dedos hacia arriba. Encima: algo hacia dentro, la palma hacia abajo y los dedos hacia dentro.
  t.x = x + nx * (PALM_SKIN * hook - ON_TOP * hand * top);
  t.y = y - down * hook + PALM_SKIN * top;
  t.z = z + nz * (PALM_SKIN * hook - ON_TOP * hand * top);
  t.nx = -nx * hook;
  t.ny = -top;
  t.nz = -nz * hook;
  t.ux = -nx * top;
  t.uy = hook;
  t.uz = -nz * top;
  t.shape = top < 0.5 ? "hook" : "open";
  t.w = w;
  t.palm = 1;
  // El codo, por fuera y algo lejos de la pared.
  t.px = rx * side * 0.8 + nx * 0.45;
  t.py = 0;
  t.pz = rz * side * 0.8 + nz * 0.45;
}
