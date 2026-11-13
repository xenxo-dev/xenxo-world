/**
 * Gestos hechos en código (saludar, aplaudir, señalar, llamar, reírse, encogerse de hombros, animar,
 * la reverencia, las acciones en pareja, el gancho, las patadas y los empujones): la biblioteca de
 * Quaternius no los trae (o no como se dan de verdad). Cada uno se monta al vuelo como una animación VRMA más, sobre una base (el reposo o la
 * guardia del modo pelea), así vale para cualquier VRM.
 *
 * Se escriben como lo haría quien anima: dónde está cada muñeca o cada tobillo en cada momento
 * (respecto a su hombro o a su cadera, en metros de un cuerpo de 1,70 m), hacia dónde apunta el codo
 * o la rodilla, la forma de la mano y cuánto se inclinan el tronco y la cabeza. Entre fotogramas,
 * curvas suaves (Catmull-Rom: sin paradas en cada pose) que se muestrean a 30 por segundo, y en cada
 * muestra se resuelven brazos y piernas con IK de dos huesos. Las formas de la mano son las de
 * people/hands.ts.
 *
 * Ejes de los huesos normalizados de VRM (pose en T, mirando a +Z, la izquierda de la persona en +X):
 * en tronco y cabeza, x > 0 se inclina hacia delante, y > 0 gira a su izquierda y z > 0 se dobla a su
 * derecha. Brazos y piernas no se escriben en grados: se colocan con la IK.
 */
import * as THREE from "three";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";
import { FINGER_BONES, fingerPose } from "./hands";

type V3 = [number, number, number];

type TorsoBone = "spine" | "chest" | "upperChest" | "neck" | "head" | "leftShoulder" | "rightShoulder";
const TORSO: TorsoBone[] = ["spine", "chest", "upperChest", "neck", "head", "leftShoulder", "rightShoulder"];

/** Formas de la mano: las de people/hands.ts y, mezclándolas, señalar, llamar con el dedo y el pulgar arriba. */
export type Hand = "fist" | "relaxed" | "open" | "flat" | "together" | "point" | "grip" | "curl" | "thumb";

/** Un brazo: muñeca respecto al hombro (m), hacia dónde va el codo, giro del antebrazo y muñeca (grados). */
interface Arm {
  at: V3;
  pole?: V3;
  /** Giro del antebrazo (grados): positivo = palma hacia arriba (supinación), en los dos brazos. */
  twist?: number;
  wrist?: V3;
  /**
   * O, en vez de `twist` y `wrist`, hacia dónde mira la palma y hacia dónde apuntan los dedos (en el
   * marco del tronco, como `at`): el giro del antebrazo y el de la muñeca salen de ahí. Para lo que
   * se toca (aplaudir, empujar con las palmas): así la mano queda justo como se pide. Si un fotograma
   * del brazo lo lleva, todos los de ese brazo (se interpola entre ellos).
   */
  palm?: V3;
  fingers?: V3;
}
/** Una pierna: tobillo respecto a la cadera (m, en el marco de la pelvis), hacia dónde va la rodilla y el pie. */
interface Leg {
  at: V3;
  pole?: V3;
  foot?: V3;
}

interface Key {
  t: number;
  /** Tronco, hombros (clavículas), cuello y cabeza: grados que se suman a la base. */
  p?: Partial<Record<TorsoBone, V3>>;
  /** Brazo izquierdo y derecho de la persona. */
  L?: Arm;
  R?: Arm;
  /** Pierna izquierda y derecha. */
  LL?: Leg;
  RL?: Leg;
  /** Cadera: desplazamiento (m) y giro (grados), sobre la base. */
  move?: V3;
  turn?: V3;
  /** Manos. */
  l?: Hand;
  r?: Hand;
  /** Pose que se sostiene: aquí la curva se para (sin velocidad). */
  hold?: boolean;
  /**
   * Las palmas se tocan (0–1; sin esto, 0): el esqueleto las junta a la medida de cada avatar
   * (rig.ts → `touch`), porque lo ancho de hombros frente a lo largo de brazos cambia de uno a otro.
   */
  touch?: number;
}

interface Def {
  /** De dónde salen los huesos que el gesto no mueve: el reposo o la guardia. */
  base: "idle" | "guard";
  loop?: boolean;
  /**
   * Pose entera: la cadera, el tronco, el cuello y la cabeza no se suman a la base (que de pie
   * descansa sobre una pierna, con la cadera ladeada y el tronco compensando) sino que parten de la
   * pose en T: lo que no se escriba queda recto. Para estar sentado en un asiento.
   */
  still?: boolean;
  /**
   * Pierna de apoyo: no se inclina con la cadera (solo gira con ella, pivotando sobre el pie), así
   * el pie sigue en el suelo aunque la cadera se eche atrás o a un lado.
   */
  plant?: "LL" | "RL";
  keys: Key[];
}

/* ------------------------------------------------------------------ */
/* Los gestos                                                           */
/* ------------------------------------------------------------------ */

// Codos: abajo y un poco hacia fuera y atrás. Rodillas: hacia delante.
const ELBOW_L: V3 = [0.35, -1, -0.35];
const ELBOW_R: V3 = [-0.35, -1, -0.35];

/** Brazo derecho a partir del izquierdo (espejo en X). */
const mirror = (a: Arm): Arm => ({
  at: [-a.at[0], a.at[1], a.at[2]],
  pole: a.pole ? [-a.pole[0], a.pole[1], a.pole[2]] : undefined,
  twist: a.twist,
  wrist: a.wrist ? [a.wrist[0], -a.wrist[1], -a.wrist[2]] : undefined,
  palm: a.palm ? [-a.palm[0], a.palm[1], a.palm[2]] : undefined,
  fingers: a.fingers ? [-a.fingers[0], a.fingers[1], a.fingers[2]] : undefined,
});
const both = (a: Arm) => ({ L: a, R: mirror(a) });

/** Al volante: brazos al aro, manos cerradas y piernas a los pedales (ver `drive`). */
const DRIVE: Pick<Key, "L" | "R" | "l" | "r" | "LL" | "RL"> = {
  L: { at: [0.02, -0.185, 0.39], pole: [0.4, -1, -0.25], twist: 78, wrist: [0, 0, -8] },
  R: { at: [-0.02, -0.185, 0.39], pole: [-0.4, -1, -0.25], twist: 78, wrist: [0, 0, 8] },
  l: "grip",
  r: "grip",
  LL: { at: [0.1, -0.35, 0.61], pole: [0.4, 1, 0.5], foot: [14, 0, 0] },
  RL: { at: [-0.09, -0.36, 0.65], pole: [-0.4, 1, 0.5], foot: [8, 0, 0] },
};

/** Saludar con la mano (brazo derecho): la palma hacia delante (y algo hacia dentro, hacia quien tiene enfrente). */
const WAVE_PALM: V3 = [0.15, 0, 1];
/** Darse la mano (brazo derecho): la palma hacia la otra mano, el pulgar arriba y los dedos hacia delante. */
const SHAKE_PALM: V3 = [0.97, -0.12, -0.2];
const SHAKE_FINGERS: V3 = [0.2, -0.12, 0.97];
/** Aplaudir (brazo izquierdo; el derecho, en espejo): las palmas juntas y abiertas. */
const CLAP_SHUT: Arm = { at: [-0.167, -0.11, 0.225], pole: [0.5, -1, -0.2], palm: [-1, 0, 0], fingers: [0, 0.42, 0.91] };
const CLAP_OPEN: Arm = { at: [-0.062, -0.1, 0.214], pole: [0.5, -1, -0.2], palm: [-0.94, 0, 0.34], fingers: [0.31, 0.42, 0.855] };

export const GESTURES: Record<string, Def> = {
  /* --- Gestos --- */
  wave: {
    base: "idle",
    keys: [
      { t: 0 },
      { t: 0.36, R: { at: [-0.11, 0.2, 0.09], pole: [-1, -1, 0], palm: WAVE_PALM, fingers: [-0.05, 1, 0] }, r: "open", p: { head: [-2, -5, -3], chest: [0, -3, 2] } },
      { t: 0.6, R: { at: [-0.19, 0.19, 0.09], pole: [-1, -1, 0], palm: WAVE_PALM, fingers: [-0.38, 0.93, 0] }, r: "open" },
      { t: 0.86, R: { at: [-0.05, 0.21, 0.09], pole: [-1, -1, 0], palm: WAVE_PALM, fingers: [0.22, 0.97, 0] }, r: "open" },
      { t: 1.12, R: { at: [-0.19, 0.19, 0.09], pole: [-1, -1, 0], palm: WAVE_PALM, fingers: [-0.38, 0.93, 0] }, r: "open" },
      { t: 1.38, R: { at: [-0.05, 0.21, 0.09], pole: [-1, -1, 0], palm: WAVE_PALM, fingers: [0.22, 0.97, 0] }, r: "open" },
      { t: 1.64, R: { at: [-0.15, 0.2, 0.09], pole: [-1, -1, 0], palm: WAVE_PALM, fingers: [-0.2, 0.98, 0] }, r: "open", p: { head: [-2, -5, -3], chest: [0, -3, 2] } },
      { t: 2.2 },
    ],
  },
  /**
   * Aplaudir: delante del pecho, las palmas una frente a otra, los dedos hacia delante y algo arriba
   * y los pulgares encima; se juntan de golpe y se abren un poco, como un libro, entre palmada y
   * palmada. Dónde se tocan lo ajusta el esqueleto a cada avatar (`touch`).
   */
  clap: {
    base: "idle",
    loop: true,
    keys: [
      { t: 0, ...both(CLAP_OPEN), l: "together", r: "together", p: { chest: [3, 0, 0], head: [2, 0, 0] } },
      { t: 0.13, ...both(CLAP_SHUT), l: "together", r: "together", p: { chest: [4, 0, 0], head: [3, 0, 0] }, hold: true, touch: 1 },
      { t: 0.17, ...both(CLAP_SHUT), l: "together", r: "together", p: { chest: [4, 0, 0], head: [3, 0, 0] }, hold: true, touch: 1 },
      { t: 0.42, ...both(CLAP_OPEN), l: "together", r: "together", p: { chest: [3, 0, 0], head: [2, 0, 0] } },
    ],
  },
  point: {
    base: "idle",
    keys: [
      { t: 0 },
      { t: 0.32, R: { at: [0.07, 0.04, 0.46], pole: [-0.4, -1, 0], twist: -10 }, r: "point", p: { chest: [0, 9, 0], upperChest: [0, 5, 0], head: [-2, 8, 0] } },
      { t: 1.45, R: { at: [0.06, 0.05, 0.47], pole: [-0.4, -1, 0], twist: -10 }, r: "point", p: { chest: [0, 9, 0], upperChest: [0, 5, 0], head: [-2, 8, 0] } },
      { t: 1.9 },
    ],
  },
  beckon: {
    base: "idle",
    loop: true,
    keys: [
      { t: 0, R: { at: [0.02, -0.14, 0.27], pole: [-0.6, -1, -0.3], twist: 100, wrist: [0, 0, -5] }, r: "open", p: { head: [4, 0, 7] } },
      { t: 0.22, R: { at: [0.02, -0.11, 0.24], pole: [-0.6, -1, -0.3], twist: 100, wrist: [0, 0, 25] }, r: "curl", p: { head: [6, 0, 7] } },
      { t: 0.55, R: { at: [0.02, -0.14, 0.27], pole: [-0.6, -1, -0.3], twist: 100, wrist: [0, 0, -5] }, r: "open", p: { head: [4, 0, 7] } },
    ],
  },
  laugh: {
    base: "idle",
    loop: true,
    keys: [
      { t: 0, L: { at: [-0.12, -0.4, 0.17], pole: ELBOW_L, twist: -10 }, R: { at: [0.02, -0.3, 0.22], pole: ELBOW_R, twist: 30 }, l: "relaxed", r: "open", p: { chest: [-7, 0, 0], head: [-16, 0, 0], leftShoulder: [0, 0, 3], rightShoulder: [0, 0, -3] } },
      { t: 0.14, L: { at: [-0.12, -0.39, 0.17], pole: ELBOW_L, twist: -10 }, R: { at: [0.02, -0.28, 0.22], pole: ELBOW_R, twist: 30 }, l: "relaxed", r: "open", p: { chest: [-3, 0, 0], head: [-9, 0, 0], leftShoulder: [0, 0, 7], rightShoulder: [0, 0, -7] } },
      { t: 0.28, L: { at: [-0.12, -0.4, 0.17], pole: ELBOW_L, twist: -10 }, R: { at: [0.02, -0.3, 0.22], pole: ELBOW_R, twist: 30 }, l: "relaxed", r: "open", p: { chest: [-8, 0, 0], head: [-17, 0, 0], leftShoulder: [0, 0, 3], rightShoulder: [0, 0, -3] } },
      { t: 0.42, L: { at: [-0.12, -0.39, 0.17], pole: ELBOW_L, twist: -10 }, R: { at: [0.02, -0.28, 0.22], pole: ELBOW_R, twist: 30 }, l: "relaxed", r: "open", p: { chest: [-2, 0, 0], head: [-8, 0, 0], leftShoulder: [0, 0, 7], rightShoulder: [0, 0, -7] } },
      { t: 0.56, L: { at: [-0.12, -0.4, 0.17], pole: ELBOW_L, twist: -10 }, R: { at: [0.02, -0.3, 0.22], pole: ELBOW_R, twist: 30 }, l: "relaxed", r: "open", p: { chest: [4, 0, 0], head: [2, 0, 0], leftShoulder: [0, 0, 4], rightShoulder: [0, 0, -4] } },
      { t: 0.7, L: { at: [-0.12, -0.39, 0.17], pole: ELBOW_L, twist: -10 }, R: { at: [0.02, -0.28, 0.22], pole: ELBOW_R, twist: 30 }, l: "relaxed", r: "open", p: { chest: [8, 0, 0], head: [6, 0, 0], leftShoulder: [0, 0, 7], rightShoulder: [0, 0, -7] } },
      { t: 0.84, L: { at: [-0.12, -0.4, 0.17], pole: ELBOW_L, twist: -10 }, R: { at: [0.02, -0.3, 0.22], pole: ELBOW_R, twist: 30 }, l: "relaxed", r: "open", p: { chest: [-7, 0, 0], head: [-16, 0, 0], leftShoulder: [0, 0, 3], rightShoulder: [0, 0, -3] } },
    ],
  },
  shrug: {
    base: "idle",
    keys: [
      { t: 0 },
      { t: 0.32, ...both({ at: [0.1, -0.33, 0.24], pole: [0.1, -1, -0.8], twist: 90, wrist: [0, 0, -10] }), l: "open", r: "open", p: { leftShoulder: [0, 0, 13], rightShoulder: [0, 0, -13], head: [0, 0, 9], chest: [-4, 0, 0] } },
      { t: 0.95, ...both({ at: [0.11, -0.32, 0.25], pole: [0.1, -1, -0.8], twist: 95, wrist: [0, 0, -14] }), l: "open", r: "open", p: { leftShoulder: [0, 0, 14], rightShoulder: [0, 0, -14], head: [0, 0, 11], chest: [-4, 0, 0] } },
      { t: 1.45 },
    ],
  },
  cheer: {
    base: "idle",
    keys: [
      { t: 0 },
      { t: 0.26, ...both({ at: [0.12, 0.4, 0.07], pole: [1, 0.1, -0.3], twist: 15 }), l: "fist", r: "fist", p: { head: [-10, 0, 0], chest: [-5, 0, 0] }, move: [0, 0.04, 0] },
      { t: 0.48, ...both({ at: [0.13, 0.3, 0.09], pole: [1, 0, -0.3], twist: 15 }), l: "fist", r: "fist", p: { head: [-6, 0, 0], chest: [-3, 0, 0] }, move: [0, -0.02, 0] },
      { t: 0.7, ...both({ at: [0.12, 0.41, 0.07], pole: [1, 0.1, -0.3], twist: 15 }), l: "fist", r: "fist", p: { head: [-12, 0, 0], chest: [-6, 0, 0] }, move: [0, 0.05, 0] },
      { t: 0.92, ...both({ at: [0.13, 0.3, 0.09], pole: [1, 0, -0.3], twist: 15 }), l: "fist", r: "fist", p: { head: [-6, 0, 0], chest: [-3, 0, 0] }, move: [0, -0.02, 0] },
      { t: 1.14, ...both({ at: [0.12, 0.4, 0.07], pole: [1, 0.1, -0.3], twist: 15 }), l: "fist", r: "fist", p: { head: [-11, 0, 0], chest: [-5, 0, 0] }, move: [0, 0.03, 0] },
      { t: 1.65 },
    ],
  },
  bow: {
    base: "idle",
    keys: [
      { t: 0 },
      { t: 0.55, ...both({ at: [-0.02, -0.46, 0.1], pole: [0.2, -1, -0.5], twist: 0 }), l: "relaxed", r: "relaxed", p: { spine: [16, 0, 0], chest: [14, 0, 0], upperChest: [6, 0, 0], neck: [6, 0, 0], head: [8, 0, 0] }, move: [0, 0, -0.03] },
      { t: 1.2, ...both({ at: [-0.02, -0.46, 0.1], pole: [0.2, -1, -0.5], twist: 0 }), l: "relaxed", r: "relaxed", p: { spine: [17, 0, 0], chest: [15, 0, 0], upperChest: [6, 0, 0], neck: [6, 0, 0], head: [8, 0, 0] }, move: [0, 0, -0.03] },
      { t: 1.85 },
    ],
  },

  /**
   * Jugar a una máquina recreativa (la gente de las ciudades): la izquierda en la palanca, que va de
   * un lado a otro, y la derecha pulsando botones; algo inclinado hacia la pantalla.
   */
  arcade: {
    base: "idle",
    loop: true,
    keys: [
      { t: 0, L: { at: [-0.06, -0.24, 0.33], pole: [0.7, -1, -0.6], twist: 60, wrist: [0, 0, -10] }, R: { at: [0.07, -0.25, 0.35], pole: [-0.7, -1, -0.6], twist: -80 }, l: "grip", r: "curl", p: { spine: [3, 0, 0], chest: [5, 0, 0], head: [3, 0, 0] } },
      { t: 0.24, L: { at: [-0.02, -0.24, 0.33], pole: [0.7, -1, -0.6], twist: 60, wrist: [0, 0, -16] }, R: { at: [0.07, -0.27, 0.35], pole: [-0.7, -1, -0.6], twist: -80 }, l: "grip", r: "curl", p: { spine: [3, 0, 0], chest: [5, 1, 0], head: [3, 2, 0] } },
      { t: 0.46, L: { at: [-0.05, -0.24, 0.36], pole: [0.7, -1, -0.6], twist: 60, wrist: [0, 0, -10] }, R: { at: [0.1, -0.25, 0.34], pole: [-0.7, -1, -0.6], twist: -80 }, l: "grip", r: "curl", p: { spine: [3, 0, 0], chest: [6, 0, 0], head: [4, 0, 0] } },
      { t: 0.7, L: { at: [-0.1, -0.24, 0.33], pole: [0.7, -1, -0.6], twist: 60, wrist: [0, 0, -4] }, R: { at: [0.1, -0.27, 0.34], pole: [-0.7, -1, -0.6], twist: -80 }, l: "grip", r: "curl", p: { spine: [3, 0, 0], chest: [5, -1, 0], head: [3, -2, 0] } },
      { t: 0.94, L: { at: [-0.06, -0.23, 0.31], pole: [0.7, -1, -0.6], twist: 60, wrist: [0, 0, -10] }, R: { at: [0.07, -0.25, 0.35], pole: [-0.7, -1, -0.6], twist: -80 }, l: "grip", r: "curl", p: { spine: [3, 0, 0], chest: [4, 0, 0], head: [2, 0, 0] } },
      { t: 1.2, L: { at: [-0.06, -0.24, 0.33], pole: [0.7, -1, -0.6], twist: 60, wrist: [0, 0, -10] }, R: { at: [0.07, -0.25, 0.35], pole: [-0.7, -1, -0.6], twist: -80 }, l: "grip", r: "curl", p: { spine: [3, 0, 0], chest: [5, 0, 0], head: [3, 0, 0] } },
    ],
  },

  /* --- En pareja (la IK del mundo lleva después las manos hasta la otra persona) --- */
  high_five: {
    base: "idle",
    keys: [
      { t: 0 },
      { t: 0.42, R: { at: [-0.04, 0.27, 0.19], pole: [-1, -0.4, -0.3], palm: [0.1, -0.05, 1], fingers: [0.15, 0.98, 0.1] }, r: "open", p: { chest: [3, 6, 0], head: [-6, 4, 0] } },
      { t: 0.62, R: { at: [0.01, 0.26, 0.3], pole: [-1, -0.4, -0.3], palm: [0.12, -0.15, 0.98], fingers: [0.2, 0.96, 0.15] }, r: "flat", p: { chest: [6, 8, 0], head: [-4, 4, 0] }, hold: true },
      { t: 0.8, R: { at: [-0.03, 0.22, 0.24], pole: [-1, -0.4, -0.3], palm: [0.1, -0.1, 0.99], fingers: [0.15, 0.97, 0.12] }, r: "open", p: { chest: [3, 4, 0] } },
      { t: 1.55 },
    ],
  },
  handshake: {
    base: "idle",
    keys: [
      { t: 0 },
      { t: 0.45, R: { at: [0.06, -0.3, 0.36], pole: [-0.5, -1, -0.2], palm: SHAKE_PALM, fingers: SHAKE_FINGERS }, r: "grip", p: { chest: [4, 6, 0], head: [3, 4, 0] } },
      { t: 0.7, R: { at: [0.06, -0.24, 0.37], pole: [-0.5, -1, -0.2], palm: SHAKE_PALM, fingers: SHAKE_FINGERS }, r: "grip" },
      { t: 0.92, R: { at: [0.06, -0.33, 0.37], pole: [-0.5, -1, -0.2], palm: SHAKE_PALM, fingers: SHAKE_FINGERS }, r: "grip" },
      { t: 1.14, R: { at: [0.06, -0.25, 0.37], pole: [-0.5, -1, -0.2], palm: SHAKE_PALM, fingers: SHAKE_FINGERS }, r: "grip" },
      { t: 1.36, R: { at: [0.06, -0.31, 0.37], pole: [-0.5, -1, -0.2], palm: SHAKE_PALM, fingers: SHAKE_FINGERS }, r: "grip", p: { chest: [4, 6, 0], head: [3, 4, 0] } },
      { t: 1.9 },
    ],
  },
  hug: {
    base: "idle",
    keys: [
      { t: 0 },
      { t: 0.5, ...both({ at: [-0.02, -0.08, 0.4], pole: [1, -0.4, -0.4], twist: 30 }), l: "open", r: "open", p: { chest: [8, 0, 0], head: [4, 18, 0] } },
      { t: 0.85, L: { at: [-0.24, -0.1, 0.3], pole: [1, -0.2, -0.2], twist: 40 }, R: { at: [0.22, 0.05, 0.3], pole: [-1, -0.1, -0.2], twist: 40 }, l: "open", r: "open", p: { chest: [10, 0, 0], head: [6, 22, 6] } },
      { t: 1.75, L: { at: [-0.25, -0.09, 0.29], pole: [1, -0.2, -0.2], twist: 40 }, R: { at: [0.23, 0.06, 0.29], pole: [-1, -0.1, -0.2], twist: 40 }, l: "open", r: "open", p: { chest: [11, 0, 0], head: [6, 22, 6] } },
      { t: 2.3 },
    ],
  },

  /* --- Modo pelea: patadas y empujones, desde la guardia --- */
  kick: {
    base: "guard",
    plant: "LL",
    keys: [
      { t: 0 },
      { t: 0.13, RL: { at: [-0.02, -0.38, 0.34], pole: [0, 0.4, 1], foot: [20, 0, 0] }, turn: [-6, 0, 0], p: { spine: [-4, 0, 0], chest: [-2, 0, 0] }, move: [0, 0.01, 0.02] },
      { t: 0.25, RL: { at: [-0.01, -0.14, 0.78], pole: [0, 1, 0.3], foot: [-25, 0, 0] }, turn: [-14, 0, 0], p: { spine: [-8, 0, 0], chest: [-4, 0, 0], head: [8, 0, 0] }, move: [0, 0.02, 0.07], hold: true },
      { t: 0.32, RL: { at: [-0.01, -0.15, 0.77], pole: [0, 1, 0.3], foot: [-25, 0, 0] }, turn: [-14, 0, 0], p: { spine: [-8, 0, 0], chest: [-4, 0, 0], head: [8, 0, 0] }, move: [0, 0.02, 0.07] },
      { t: 0.44, RL: { at: [-0.02, -0.38, 0.32], pole: [0, 0.4, 1], foot: [20, 0, 0] }, turn: [-6, 0, 0], p: { spine: [-4, 0, 0], chest: [-2, 0, 0] }, move: [0, 0.01, 0.03] },
      { t: 0.66 },
    ],
  },
  /**
   * Gancho de izquierda (la mano de delante, como el jab): el codo sale por fuera mientras el peso pasa
   * a la pierna de delante, y el puño barre en horizontal hasta la barbilla con el codo a la altura del
   * hombro y en ángulo recto, girando cadera y tronco; la cabeza se queda mirando al rival. Corto y
   * rápido (el de la captura era un golpe a fondo con arma, con el cuerpo casi en el suelo).
   */
  hook: {
    base: "guard",
    keys: [
      { t: 0 },
      { t: 0.11, L: { at: [0.13, 0.0, 0.17], pole: [1, -0.1, -0.3], twist: 50 }, l: "fist", turn: [0, 6, 0], p: { spine: [1, 3, 0], chest: [1, 5, 0], head: [0, -6, 0] }, move: [0.015, -0.02, 0] },
      { t: 0.25, L: { at: [0.02, 0.15, 0.3], pole: [1, 0.25, -0.15], twist: 80 }, l: "fist", turn: [0, -12, 0], p: { spine: [2, -7.5, 0], chest: [2, -10.5, -3], head: [-2, 22, 0] }, move: [0.03, -0.03, 0.02], hold: true },
      { t: 0.31, L: { at: [0.01, 0.14, 0.29], pole: [1, 0.25, -0.15], twist: 80 }, l: "fist", turn: [0, -12.5, 0], p: { spine: [2, -7.8, 0], chest: [2, -10.8, -3], head: [-2, 23, 0] }, move: [0.03, -0.03, 0.02] },
      { t: 0.6 },
    ],
  },
  roundhouse: {
    base: "guard",
    plant: "LL",
    keys: [
      { t: 0 },
      { t: 0.16, RL: { at: [-0.3, -0.36, 0.18], pole: [-0.6, 0.4, 0.8], foot: [30, 0, 0] }, turn: [-3, 30, -6], p: { spine: [-3, 6, 4], chest: [-2, 6, 3] }, move: [0.02, 0.01, 0] },
      { t: 0.3, RL: { at: [-0.55, -0.26, 0.4], pole: [-0.2, 1, 0.1], foot: [40, 0, 0] }, turn: [-5, 62, -12], p: { spine: [-4, 10, 7], chest: [-3, 8, 5], head: [0, -26, -6] }, move: [0.04, 0.02, 0], hold: true },
      { t: 0.38, RL: { at: [-0.53, -0.27, 0.42], pole: [-0.2, 1, 0.1], foot: [40, 0, 0] }, turn: [-5, 64, -12], p: { spine: [-4, 10, 7], chest: [-3, 8, 5], head: [0, -28, -6] }, move: [0.04, 0.02, 0] },
      { t: 0.53, RL: { at: [-0.3, -0.37, 0.16], pole: [-0.6, 0.4, 0.8], foot: [30, 0, 0] }, turn: [-3, 30, -6], p: { spine: [-3, 6, 4], chest: [-2, 6, 3] }, move: [0.02, 0.01, 0] },
      { t: 0.78 },
    ],
  },
  shove: {
    base: "guard",
    keys: [
      { t: 0 },
      { t: 0.14, ...both({ at: [-0.05, -0.12, 0.17], pole: [0.6, -1, -0.6], palm: [-0.4, -0.25, 0.88], fingers: [0.12, 0.92, 0.35] }), l: "open", r: "open", p: { chest: [2, 0, 0] }, move: [0, -0.01, 0.02] },
      { t: 0.27, ...both({ at: [-0.08, 0.04, 0.44], pole: [0.6, -1, -0.3], palm: [-0.2, -0.36, 0.91], fingers: [0.2, 0.88, 0.42] }), l: "flat", r: "flat", p: { spine: [3, 0, 0], chest: [6, 0, 0], head: [-4, 0, 0] }, move: [0, -0.02, 0.12], hold: true },
      { t: 0.36, ...both({ at: [-0.08, 0.03, 0.43], pole: [0.6, -1, -0.3], palm: [-0.2, -0.34, 0.92], fingers: [0.19, 0.89, 0.4] }), l: "flat", r: "flat", p: { spine: [3, 0, 0], chest: [6, 0, 0], head: [-4, 0, 0] }, move: [0, -0.02, 0.12] },
      { t: 0.62 },
    ],
  },
  push: {
    base: "guard",
    keys: [
      { t: 0 },
      { t: 0.13, R: { at: [0.0, -0.14, 0.14], pole: [-0.6, -1, -0.6], palm: [0.4, -0.25, 0.88], fingers: [-0.1, 0.92, 0.35] }, r: "open", p: { chest: [0, -10, 0] } },
      { t: 0.26, R: { at: [0.06, 0.03, 0.46], pole: [-0.6, -1, -0.2], palm: [0.15, -0.36, 0.92], fingers: [-0.18, 0.88, 0.42] }, r: "flat", p: { spine: [2, 8, 0], chest: [4, 14, 0], head: [-4, -8, 0] }, move: [0, -0.02, 0.08], hold: true },
      { t: 0.34, R: { at: [0.06, 0.02, 0.45], pole: [-0.6, -1, -0.2], palm: [0.15, -0.34, 0.93], fingers: [-0.17, 0.89, 0.4] }, r: "flat", p: { spine: [2, 8, 0], chest: [4, 14, 0], head: [-4, -8, 0] }, move: [0, -0.02, 0.08] },
      { t: 0.58 },
    ],
  },

  /* --- Parkour (world/parkour): la IK del mundo pone después las manos en el borde --- */
  /**
   * Colgado de un borde: los brazos arriba casi estirados y las manos cerradas en el borde, mirando
   * hacia arriba; las rodillas algo dobladas y los pies hacia la pared, con un leve balanceo.
   */
  pk_hang: {
    base: "idle",
    loop: true,
    keys: [
      { t: 0, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], twist: 0, wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [5, 0, 0], neck: [-8, 0, 0], head: [-14, 0, 0] }, LL: { at: [0.03, -0.7, 0.2], pole: [0, 0, 1], foot: [25, 0, 0] }, RL: { at: [-0.04, -0.69, 0.25], pole: [0, 0, 1], foot: [20, 0, 0] }, turn: [4, 0, 1.5] },
      { t: 0.8, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], twist: 0, wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [6, 0, 0], neck: [-8, 0, 0], head: [-13, 0, 0] }, LL: { at: [0.03, -0.71, 0.22], pole: [0, 0, 1], foot: [22, 0, 0] }, RL: { at: [-0.04, -0.7, 0.23], pole: [0, 0, 1], foot: [22, 0, 0] }, turn: [4, 0, -1.5] },
      { t: 1.6, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], twist: 0, wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [5, 0, 0], neck: [-8, 0, 0], head: [-14, 0, 0] }, LL: { at: [0.03, -0.7, 0.2], pole: [0, 0, 1], foot: [25, 0, 0] }, RL: { at: [-0.04, -0.69, 0.25], pole: [0, 0, 1], foot: [20, 0, 0] }, turn: [4, 0, 1.5] },
    ],
  },
  /**
   * Al agarrarse a un borde (el primer momento colgado, antes de `pk_hang`): lo que traía el salto
   * sigue en las piernas: van hacia la pared, rebotan atrás y se calman en un par de vaivenes que se
   * apagan; el tronco acompaña (la cadera se dobla y se estira). Acaba justo en la pose de colgado.
   */
  pk_grab: {
    base: "idle",
    keys: [
      { t: 0, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], twist: 0, wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [9, 0, 0], neck: [-6, 0, 0], head: [-10, 0, 0] }, LL: { at: [0.04, -0.6, 0.06], pole: [0, 0, 1], foot: [30, 0, 0] }, RL: { at: [-0.04, -0.62, 0.02], pole: [0, 0, 1], foot: [30, 0, 0] }, turn: [14, 0, 0] },
      { t: 0.2, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], twist: 0, wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [3, 0, 0], neck: [-8, 0, 0], head: [-15, 0, 0] }, LL: { at: [0.03, -0.66, 0.36], pole: [0, 0, 1], foot: [12, 0, 0] }, RL: { at: [-0.04, -0.65, 0.4], pole: [0, 0, 1], foot: [10, 0, 0] }, turn: [-6, 0, 0] },
      { t: 0.45, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], twist: 0, wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [7, 0, 0], neck: [-8, 0, 0], head: [-13, 0, 0] }, LL: { at: [0.03, -0.71, 0.06], pole: [0, 0, 1], foot: [26, 0, 0] }, RL: { at: [-0.04, -0.7, 0.1], pole: [0, 0, 1], foot: [26, 0, 0] }, turn: [9, 0, 0] },
      { t: 0.68, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], twist: 0, wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [5, 0, 0], neck: [-8, 0, 0], head: [-14, 0, 0] }, LL: { at: [0.03, -0.7, 0.27], pole: [0, 0, 1], foot: [20, 0, 0] }, RL: { at: [-0.04, -0.69, 0.3], pole: [0, 0, 1], foot: [18, 0, 0] }, turn: [1, 0, 0] },
      { t: 0.9, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], twist: 0, wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [5, 0, 0], neck: [-8, 0, 0], head: [-14, 0, 0] }, LL: { at: [0.03, -0.7, 0.2], pole: [0, 0, 1], foot: [25, 0, 0] }, RL: { at: [-0.04, -0.69, 0.25], pole: [0, 0, 1], foot: [20, 0, 0] }, turn: [4, 0, 1.5] },
    ],
  },
  /**
   * Trepar desde colgado, el tirón (antes de subir encima con la captura): los codos se doblan (la IK
   * del mundo deja las manos en el borde), el pecho se pega a la pared y una rodilla sube hacia el
   * borde mientras la otra pierna empuja contra la pared.
   */
  pk_pull: {
    base: "idle",
    keys: [
      { t: 0, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], twist: 0, wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [5, 0, 0], neck: [-8, 0, 0], head: [-14, 0, 0] }, LL: { at: [0.03, -0.7, 0.2], pole: [0, 0, 1], foot: [25, 0, 0] }, RL: { at: [-0.04, -0.69, 0.25], pole: [0, 0, 1], foot: [20, 0, 0] }, turn: [4, 0, 0] },
      { t: 0.22, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], twist: 0, wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [12, 0, 0], neck: [-4, 0, 0], head: [-10, 0, 0] }, LL: { at: [0.05, -0.48, 0.3], pole: [0, 0.2, 1], foot: [10, 0, 0] }, RL: { at: [-0.05, -0.62, 0.3], pole: [0, 0, 1], foot: [35, 0, 0] }, turn: [10, 0, 0] },
      { t: 0.44, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], twist: 0, wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [18, 0, 0], neck: [0, 0, 0], head: [-6, 0, 0] }, LL: { at: [0.06, -0.3, 0.38], pole: [0, 0.4, 1], foot: [0, 0, 0] }, RL: { at: [-0.05, -0.55, 0.26], pole: [0, 0, 1], foot: [40, 0, 0] }, turn: [16, 0, 0] },
    ],
  },
  /** Colgado, de lado hacia su derecha: la cadera se balancea hacia donde va y las piernas la siguen. */
  pk_shimmy_r: {
    base: "idle",
    loop: true,
    keys: [
      { t: 0, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [5, -3, 0], head: [-12, -6, 0] }, LL: { at: [0.0, -0.71, 0.18], pole: [0, 0, 1], foot: [22, 0, 0] }, RL: { at: [-0.1, -0.67, 0.22], pole: [0, 0, 1], foot: [22, 0, 0] }, turn: [4, 0, 5] },
      { t: 0.33, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [5, -1, 0], head: [-12, -6, 0] }, LL: { at: [0.05, -0.69, 0.2], pole: [0, 0, 1], foot: [22, 0, 0] }, RL: { at: [-0.04, -0.71, 0.2], pole: [0, 0, 1], foot: [22, 0, 0] }, turn: [4, 0, -2] },
      { t: 0.66, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [5, -3, 0], head: [-12, -6, 0] }, LL: { at: [0.0, -0.71, 0.18], pole: [0, 0, 1], foot: [22, 0, 0] }, RL: { at: [-0.1, -0.67, 0.22], pole: [0, 0, 1], foot: [22, 0, 0] }, turn: [4, 0, 5] },
    ],
  },
  pk_shimmy_l: {
    base: "idle",
    loop: true,
    keys: [
      { t: 0, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [5, 3, 0], head: [-12, 6, 0] }, LL: { at: [0.1, -0.67, 0.22], pole: [0, 0, 1], foot: [22, 0, 0] }, RL: { at: [0.0, -0.71, 0.18], pole: [0, 0, 1], foot: [22, 0, 0] }, turn: [4, 0, -5] },
      { t: 0.33, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [5, 1, 0], head: [-12, 6, 0] }, LL: { at: [0.04, -0.71, 0.2], pole: [0, 0, 1], foot: [22, 0, 0] }, RL: { at: [-0.05, -0.69, 0.2], pole: [0, 0, 1], foot: [22, 0, 0] }, turn: [4, 0, 2] },
      { t: 0.66, ...both({ at: [0.04, 0.49, 0.15], pole: [1, -0.1, -0.6], wrist: [-25, 0, 0] }), l: "grip", r: "grip", p: { chest: [5, 3, 0], head: [-12, 6, 0] }, LL: { at: [0.1, -0.67, 0.22], pole: [0, 0, 1], foot: [22, 0, 0] }, RL: { at: [0.0, -0.71, 0.18], pole: [0, 0, 1], foot: [22, 0, 0] }, turn: [4, 0, -5] },
    ],
  },
  /** Equilibrio sobre una viga (encima de andar): los brazos abiertos, subiendo y bajando a contrapié. */
  pk_balance: {
    base: "idle",
    loop: true,
    keys: [
      { t: 0, L: { at: [0.4, 0.02, 0.09], pole: [0.2, -0.6, -1], twist: -15 }, R: { at: [-0.4, -0.1, 0.09], pole: [-0.2, -0.6, -1], twist: -15 }, l: "relaxed", r: "relaxed", p: { chest: [0, 0, -3], head: [6, 0, 2] } },
      { t: 0.9, L: { at: [0.4, -0.1, 0.09], pole: [0.2, -0.6, -1], twist: -15 }, R: { at: [-0.4, 0.02, 0.09], pole: [-0.2, -0.6, -1], twist: -15 }, l: "relaxed", r: "relaxed", p: { chest: [0, 0, 3], head: [6, 0, -2] } },
      { t: 1.8, L: { at: [0.4, 0.02, 0.09], pole: [0.2, -0.6, -1], twist: -15 }, R: { at: [-0.4, -0.1, 0.09], pole: [-0.2, -0.6, -1], twist: -15 }, l: "relaxed", r: "relaxed", p: { chest: [0, 0, -3], head: [6, 0, 2] } },
    ],
  },

  /* --- Al volante (world/vehicle) --- */
  /**
   * Sentado en el asiento de un deportivo, recostado (el personaje entero va echado atrás: car.ts →
   * `lean`; aquí el tronco es su vertical): los muslos sobre el cojín y las rodillas algo arriba y
   * abiertas (entre ellas pasa la columna del volante), los pies en los pedales, los brazos al aro a
   * las nueve y las tres y la cabeza derecha, mirando adelante. La cadera la pone el asiento y las
   * manos las lleva al aro la IK del esqueleto (people/rig.ts → `seat`, `reachL`, `reachR`), midan
   * lo que midan sus brazos; esto es la pose de la que parten.
   */
  drive: {
    base: "idle",
    loop: true,
    still: true,
    keys: [
      { t: 0, ...DRIVE, p: { spine: [2, 0, 0], chest: [3, 0, 0], upperChest: [3, 0, 0], neck: [8, 0, 0], head: [10, 0, 0], leftShoulder: [0, -6, 0], rightShoulder: [0, 6, 0] } },
      // Respira: el pecho sube un poco y la cabeza lo compensa.
      { t: 1.7, ...DRIVE, p: { spine: [1.6, 0, 0], chest: [2, 0, 0], upperChest: [2.4, 0, 0], neck: [8.6, 0, 0], head: [11, 0, 0], leftShoulder: [0, -6, 0.6], rightShoulder: [0, 6, -0.6] } },
      { t: 3.4, ...DRIVE, p: { spine: [2, 0, 0], chest: [3, 0, 0], upperChest: [3, 0, 0], neck: [8, 0, 0], head: [10, 0, 0], leftShoulder: [0, -6, 0], rightShoulder: [0, 6, 0] } },
    ],
  },

  /* --- Reacciones --- */
  /** Golpe por la espalda: la cadera sale hacia delante, el tronco se queda atrás y los brazos se abren. */
  hit_back: {
    base: "idle",
    keys: [
      { t: 0 },
      { t: 0.1, ...both({ at: [0.14, -0.38, -0.16], pole: [0.6, -1, 0.3], twist: -10 }), l: "open", r: "open", p: { spine: [-10, 0, 0], chest: [-12, 0, 0], head: [-18, 0, 0] }, turn: [-6, 0, 0], move: [0, 0, 0.06] },
      { t: 0.3, ...both({ at: [0.1, -0.42, -0.06], pole: [0.6, -1, 0.1], twist: -5 }), l: "relaxed", r: "relaxed", p: { spine: [6, 0, 0], chest: [8, 0, 0], head: [10, 0, 0] }, turn: [4, 0, 0], move: [0, -0.03, 0.04] },
      { t: 0.75 },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Montaje                                                              */
/* ------------------------------------------------------------------ */

const FPS = 30;
const DEG = Math.PI / 180;
/** Cuerpo de referencia (m): brazo y antebrazo, muslo y pierna. */
const ARM = [0.25, 0.24] as const;
const LEG = [0.4, 0.41] as const;

type QuatTrack = THREE.QuaternionKeyframeTrack;
type Sample = (t: number, out: THREE.Quaternion) => THREE.Quaternion;
/** El interpolador de una pista (three.js lo crea con la pista; sus tipos no lo declaran). */
export const interpolant = (track: THREE.KeyframeTrack) => (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();

/** Muestreo de una pista de la base (que se repite si el gesto dura más). */
function quatSampler(track: QuatTrack | undefined, duration: number): Sample {
  if (!track) return (_t, out) => out.identity();
  const it = interpolant(track);
  return (t, out) => {
    const r = it.evaluate(duration > 0 ? t % (duration + 1e-6) : t) as ArrayLike<number>;
    return out.set(r[0]!, r[1]!, r[2]!, r[3]!);
  };
}
function vecSampler(track: THREE.VectorKeyframeTrack | undefined, duration: number) {
  if (!track) return null;
  const it = interpolant(track);
  return (t: number, out: THREE.Vector3) => {
    const r = it.evaluate(duration > 0 ? t % (duration + 1e-6) : t) as ArrayLike<number>;
    return out.set(r[0]!, r[1]!, r[2]!);
  };
}

/** Curva por los valores `v` en los tiempos `t` (Catmull-Rom; parada en los extremos y en `hold`). */
function spline(times: number[], values: number[][], holds: boolean[], loop: boolean, period: number) {
  const n = times.length;
  const dims = values[0]!.length;
  const tangents = values.map((_, i) => {
    const m = new Array<number>(dims).fill(0);
    if (n < 2 || holds[i]) return m;
    let a = i - 1, b = i + 1, ta: number, tb: number;
    if (loop && n > 2) {
      // El último fotograma repite el primero: los vecinos dan la vuelta.
      if (i === 0 || i === n - 1) {
        a = n - 2;
        b = 1;
        ta = times[a]! - period;
        tb = times[b]!;
      } else {
        ta = times[a]!;
        tb = times[b]!;
      }
    } else {
      if (i === 0 || i === n - 1) return m;
      ta = times[a]!;
      tb = times[b]!;
    }
    const k = 0.85 / Math.max(1e-3, (i === 0 || i === n - 1 ? tb - ta : times[b]! - times[a]!));
    for (let d = 0; d < dims; d++) m[d] = (values[b]![d]! - values[a]![d]!) * k;
    return m;
  });
  return (t: number, out: number[]) => {
    if (n === 1 || t <= times[0]!) {
      for (let d = 0; d < dims; d++) out[d] = values[0]![d]!;
      return out;
    }
    if (t >= times[n - 1]!) {
      for (let d = 0; d < dims; d++) out[d] = values[n - 1]![d]!;
      return out;
    }
    let i = 0;
    while (i < n - 2 && t > times[i + 1]!) i++;
    const h = times[i + 1]! - times[i]!;
    const u = (t - times[i]!) / h;
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    for (let d = 0; d < dims; d++) out[d] = h00 * values[i]![d]! + h10 * h * tangents[i]![d]! + h01 * values[i + 1]![d]! + h11 * h * tangents[i + 1]![d]!;
    return out;
  };
}

const smooth = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

/**
 * Un canal del gesto (un brazo, un hueso del tronco, una mano…): en qué fotogramas sale y cuánto
 * pesa sobre la base en cada momento (0 antes del primero y después del último, con transición).
 */
function channel<T>(def: Def, pick: (k: Key) => T | undefined) {
  const keys = def.keys;
  const idx = keys.map((k, i) => (pick(k) !== undefined ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const first = idx[0]!, last = idx[idx.length - 1]!;
  const tIn = first > 0 ? keys[first - 1]!.t : keys[first]!.t;
  const tOut = last < keys.length - 1 ? keys[last + 1]!.t : keys[last]!.t;
  return {
    idx,
    times: idx.map((i) => keys[i]!.t),
    values: idx.map((i) => pick(keys[i]!)!),
    holds: idx.map((i) => !!keys[i]!.hold),
    /** Peso del gesto sobre la base en `t`. */
    weight(t: number) {
      if (t < keys[first]!.t) return first > 0 ? smooth((t - tIn) / Math.max(1e-3, keys[first]!.t - tIn)) : 1;
      if (t > keys[last]!.t) return last < keys.length - 1 ? 1 - smooth((t - keys[last]!.t) / Math.max(1e-3, tOut - keys[last]!.t)) : 1;
      return 1;
    },
  };
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _u = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e = new THREE.Vector3();
const _f = new THREE.Vector3();
const _t = new THREE.Vector3();
const _p = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _eu = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

/**
 * IK de dos huesos: con el primero de largo `a` y el segundo `b`, lleva el extremo a `target`
 * (respecto a la articulación) con el codo o la rodilla hacia `pole`. Devuelve la dirección del
 * primer hueso (`dirA`), la del segundo (`dirB`) y hacia dónde se dobla (`bend`, perpendicular a `dirA`).
 */
function twoBone(a: number, b: number, target: THREE.Vector3, pole: THREE.Vector3, dirA: THREE.Vector3, dirB: THREE.Vector3, bend: THREE.Vector3) {
  let d = target.length();
  const max = (a + b) * 0.999;
  if (d > max) {
    target.multiplyScalar(max / d);
    d = max;
  }
  d = Math.max(d, Math.abs(a - b) + 0.01);
  _u.copy(target).normalize();
  _n.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_n.lengthSq() < 1e-8) _n.set(0, -1, 0).addScaledVector(_u, _u.y).normalize();
  else _n.normalize();
  const x = (a * a + d * d - b * b) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  _e.copy(_u).multiplyScalar(x).addScaledVector(_n, h);
  dirA.copy(_e).normalize();
  _f.copy(_u).multiplyScalar(d).sub(_e);
  dirB.copy(_f).normalize();
  bend.copy(dirB).addScaledVector(dirA, -dirB.dot(dirA));
  if (bend.lengthSq() < 1e-8) bend.copy(_n).negate();
  bend.normalize();
}

/** Giro de un hueso a partir de sus ejes locales X, Y, Z expresados en el padre. */
function basis(xa: THREE.Vector3, ya: THREE.Vector3, za: THREE.Vector3, out: THREE.Quaternion) {
  _m.makeBasis(xa, ya, za);
  return out.setFromRotationMatrix(_m);
}

const _dirA = new THREE.Vector3();
const _dirB = new THREE.Vector3();
const _bend = new THREE.Vector3();

const _palm = new THREE.Vector3();
const _fing = new THREE.Vector3();
const _qh = new THREE.Quaternion();

/**
 * Brazo: giro del brazo, del antebrazo y de la mano (side 1 = izquierdo, −1 = derecho). Con `palm` y
 * `fingers` (no nulos), la mano queda así; si no, con el giro del antebrazo y la muñeca de `twist` y
 * `wrist`.
 */
function solveArm(side: 1 | -1, arm: { at: number[]; pole: number[]; twist: number; wrist: number[]; palm?: number[]; fingers?: number[] }, upper: THREE.Quaternion, lower: THREE.Quaternion, hand: THREE.Quaternion) {
  _t.set(arm.at[0]!, arm.at[1]!, arm.at[2]!);
  _p.set(arm.pole[0]!, arm.pole[1]!, arm.pole[2]!);
  twoBone(ARM[0], ARM[1], _t, _p, _dirA, _dirB, _bend);
  // El brazo apunta por su eje X (−X el derecho) y el antebrazo se dobla hacia su +Z.
  _x.copy(_dirA).multiplyScalar(side);
  _z.copy(_bend);
  _y.crossVectors(_z, _x);
  basis(_x, _y, _z, upper);
  const phi = Math.acos(THREE.MathUtils.clamp(_dirA.dot(_dirB), -1, 1));
  lower.setFromAxisAngle(Y, -side * phi);
  if (arm.palm && arm.fingers) {
    _palm.set(arm.palm[0]!, arm.palm[1]!, arm.palm[2]!);
    _fing.set(arm.fingers[0]!, arm.fingers[1]!, arm.fingers[2]!);
    if (_palm.lengthSq() > 0.25 && _fing.lengthSq() > 0.25) {
      // La mano que se pide: en reposo los dedos van por su X (−X la derecha), la palma mira a −Y y el
      // pulgar a +Z (VRM, pose en T). Los dedos, perpendiculares a la palma.
      _palm.normalize();
      _fing.addScaledVector(_palm, -_fing.dot(_palm)).normalize();
      _x.copy(_fing).multiplyScalar(side);
      _y.copy(_palm).negate();
      _z.crossVectors(_x, _y);
      basis(_x, _y, _z, _qh);
      // Lo que le falta respecto al antebrazo sin girar; su parte alrededor del antebrazo (X) se reparte
      // entre antebrazo y mano, como la supinación de abajo, y el resto lo hace la muñeca.
      _qa.copy(upper).multiply(lower).invert().multiply(_qh);
      if (_qa.w < 0) _qa.set(-_qa.x, -_qa.y, -_qa.z, -_qa.w);
      const tau = 2 * Math.atan2(_qa.x, _qa.w);
      lower.multiply(_qb.setFromAxisAngle(X, tau * 0.6));
      hand.setFromAxisAngle(X, -tau * 0.6).multiply(_qa);
      return;
    }
  }
  // Supinación repartida entre antebrazo y mano (sin «caramelo» en el codo). En los dos brazos es girar
  // en negativo alrededor de X: el antebrazo va por +X en el izquierdo y por −X en el derecho, y en
  // espejo un giro alrededor de X es el mismo (antes se multiplicaba por el lado y el izquierdo se
  // giraba al revés: con `both`, una palma arriba y la otra abajo).
  const tw = -arm.twist * DEG;
  lower.multiply(_qa.setFromAxisAngle(X, tw * 0.6));
  hand.setFromEuler(_eu.set(arm.wrist[0]! * DEG, arm.wrist[1]! * DEG, arm.wrist[2]! * DEG, "XYZ")).premultiply(_qb.setFromAxisAngle(X, tw * 0.4));
}

/** Pierna: giro del muslo, de la pierna y del pie. */
function solveLeg(leg: { at: number[]; pole: number[]; foot: number[] }, upper: THREE.Quaternion, lower: THREE.Quaternion, foot: THREE.Quaternion) {
  _t.set(leg.at[0]!, leg.at[1]!, leg.at[2]!);
  _p.set(leg.pole[0]!, leg.pole[1]!, leg.pole[2]!);
  twoBone(LEG[0], LEG[1], _t, _p, _dirA, _dirB, _bend);
  // La pierna apunta por su −Y y se dobla hacia su −Z.
  _y.copy(_dirA).negate();
  _z.copy(_bend).negate();
  _x.crossVectors(_y, _z);
  basis(_x, _y, _z, upper);
  const phi = Math.acos(THREE.MathUtils.clamp(_dirA.dot(_dirB), -1, 1));
  lower.setFromAxisAngle(X, phi);
  foot.setFromEuler(_eu.set(leg.foot[0]! * DEG, leg.foot[1]! * DEG, leg.foot[2]! * DEG, "XYZ"));
}

/**
 * Las formas de la mano, por hueso de los dedos. La relajada y el puño, de people/hands.ts (los
 * clips de captura traen siempre un puño en los dedos: no sirven); las demás, de mezclarlas.
 */
type HandShapes = Record<Hand, Map<string, THREE.Quaternion>>;
function handShapes(): HandShapes {
  const shapes = {} as HandShapes;
  for (const h of ["fist", "relaxed", "open", "flat", "together", "point", "grip", "curl", "thumb"] as Hand[]) shapes[h] = new Map();
  for (const side of ["left", "right"] as const) {
    for (const bone of FINGER_BONES[side]) {
      const relaxed = fingerPose("relaxed", bone);
      const fist = fingerPose("fist", bone);
      const flat = new THREE.Quaternion();
      const thumb = bone.includes("Thumb");
      const index = bone.includes("Index");
      shapes.relaxed.set(bone, relaxed);
      shapes.fist.set(bone, fist);
      shapes.flat.set(bone, flat);
      shapes.open.set(bone, fingerPose("open", bone));
      shapes.together.set(bone, fingerPose("together", bone));
      shapes.point.set(bone, index ? flat.clone().slerp(relaxed, 0.1) : fist.clone());
      shapes.grip.set(bone, fingerPose("grip", bone));
      shapes.curl.set(bone, relaxed.clone().slerp(fist, thumb ? 0.2 : 0.85));
      shapes.thumb.set(bone, thumb ? flat.clone() : fist.clone());
    }
  }
  return shapes;
}

/** Bases de los gestos (reposo y guardia) y la animación de la que salen los puños. */
export interface GestureSources {
  idle: VRMAnimation;
  guard: VRMAnimation | null;
  jab: VRMAnimation | null;
}

function cloneAnim(src: VRMAnimation, duration: number, rotation: Map<string, QuatTrack>, translation: Map<string, THREE.VectorKeyframeTrack>): VRMAnimation {
  const out = Object.create(Object.getPrototypeOf(src)) as VRMAnimation;
  Object.assign(out, src, {
    duration,
    humanoidTracks: { translation, rotation },
    expressionTracks: { preset: new Map(), custom: new Map() },
    lookAtTrack: null,
  });
  return out;
}

/**
 * Monta el gesto `name` sobre su base: muestrea a 30 por segundo las curvas de cada canal, resuelve
 * brazos y piernas y mezcla con la base donde el gesto no manda.
 */
export function buildGesture(name: string, src: GestureSources): VRMAnimation | null {
  const def = GESTURES[name];
  if (!def) return null;
  const base = def.base === "guard" && src.guard ? src.guard : src.idle;
  const shapes = handShapes();
  const duration = Math.max(0.1, def.keys[def.keys.length - 1]!.t);
  const n = Math.max(2, Math.round(duration * FPS) + 1);
  const times = Array.from({ length: n }, (_, i) => (i / (n - 1)) * duration);
  const baseRot = base.humanoidTracks.rotation as unknown as Map<string, QuatTrack>;
  const baseDur = base.duration;
  // Los dedos de la base no sirven (la captura trae siempre un puño): la mano de la base es la
  // relajada (o el puño, sobre la guardia), y la mano que no hace nada en el gesto se queda así.
  const baseHand = shapes[def.base === "guard" ? "fist" : "relaxed"];
  const sampleBase = (bone: string): Sample => {
    const h = baseHand.get(bone);
    return h ? (_t: number, out: THREE.Quaternion) => out.copy(h) : quatSampler(baseRot.get(bone), baseDur);
  };
  const rotation = new Map<string, QuatTrack>();
  for (const [bone, tr] of baseRot) rotation.set(bone, resample(baseHand.has(bone) ? sampleBase(bone) : quatSampler(tr, baseDur), times, `${bone}.quaternion`));
  const translation = new Map<string, THREE.VectorKeyframeTrack>(base.humanoidTracks.translation as unknown as Map<string, THREE.VectorKeyframeTrack>);

  const tmp: number[] = new Array(16).fill(0);
  const qBase = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  const writeQ = (values: Float32Array, i: number, v: THREE.Quaternion) => {
    values[i * 4] = v.x;
    values[i * 4 + 1] = v.y;
    values[i * 4 + 2] = v.z;
    values[i * 4 + 3] = v.w;
  };
  const track = (bone: string, values: Float32Array) => rotation.set(bone, new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));

  // Tronco, hombros, cuello y cabeza: grados sumados a la base (o, en una pose entera, a la pose en T).
  const still = !!def.still;
  const rest = (bone: string) => {
    const values = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) values[i * 4 + 3] = 1;
    track(bone, values);
  };
  for (const bone of TORSO) {
    const ch = channel(def, (k) => k.p?.[bone]);
    if (!ch) {
      if (still) rest(bone);
      continue;
    }
    const curve = spline(ch.times, ch.values as number[][], ch.holds, !!def.loop, duration);
    const sb = sampleBase(bone);
    const values = new Float32Array(n * 4);
    times.forEach((t, i) => {
      const e = curve(t, tmp);
      const w = ch.weight(t);
      q.setFromEuler(_eu.set(e[0]! * DEG * w, e[1]! * DEG * w, e[2]! * DEG * w, "XYZ"));
      writeQ(values, i, still ? q : sb(t, qBase).multiply(q));
    });
    track(bone, values);
  }

  // Cadera: giro y desplazamiento sumados a la base.
  const turn = channel(def, (k) => k.turn);
  if (turn) {
    const curve = spline(turn.times, turn.values as number[][], turn.holds, !!def.loop, duration);
    const sb = sampleBase("hips");
    const values = new Float32Array(n * 4);
    times.forEach((t, i) => {
      const e = curve(t, tmp);
      const w = turn.weight(t);
      q.setFromEuler(_eu.set(e[0]! * DEG * w, e[1]! * DEG * w, e[2]! * DEG * w, "XYZ"));
      writeQ(values, i, still ? q : sb(t, qBase).multiply(q));
    });
    track("hips", values);
  } else if (still) rest("hips");
  // La pierna de apoyo no se inclina con la cadera: muslo' = giro⁻¹ · (solo su parte en Y) · muslo.
  if (turn && def.plant) {
    const bone = def.plant === "LL" ? "leftUpperLeg" : "rightUpperLeg";
    const curve = spline(turn.times, turn.values as number[][], turn.holds, !!def.loop, duration);
    const sb = sampleBase(bone);
    const values = new Float32Array(n * 4);
    const qy = new THREE.Quaternion();
    times.forEach((t, i) => {
      const e = curve(t, tmp);
      const w = turn.weight(t);
      q.setFromEuler(_eu.set(e[0]! * DEG * w, e[1]! * DEG * w, e[2]! * DEG * w, "XYZ")).invert();
      qy.setFromAxisAngle(Y, e[1]! * DEG * w);
      writeQ(values, i, q.multiply(qy).multiply(sb(t, qBase)));
    });
    track(bone, values);
  }
  const move = channel(def, (k) => k.move);
  const hipsPos = base.humanoidTracks.translation.get("hips") as THREE.VectorKeyframeTrack | undefined;
  if (move || hipsPos) {
    const curve = move ? spline(move.times, move.values as number[][], move.holds, !!def.loop, duration) : null;
    const sb = vecSampler(hipsPos, baseDur);
    const rest = base.restHipsPosition;
    const values = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    times.forEach((t, i) => {
      if (sb) sb(t, v);
      else v.copy(rest);
      if (curve && move) {
        const o = curve(t, tmp);
        const w = move.weight(t);
        v.x += o[0]! * w;
        v.y += o[1]! * w;
        v.z += o[2]! * w;
      }
      values[i * 3] = v.x;
      values[i * 3 + 1] = v.y;
      values[i * 3 + 2] = v.z;
    });
    translation.set("hips", new THREE.VectorKeyframeTrack("hips.position", times, values));
  }

  // Brazos (IK sobre la curva de la muñeca) y piernas (sobre la del tobillo).
  const limbs = [
    { key: "L" as const, side: 1 as const, bones: ["leftUpperArm", "leftLowerArm", "leftHand"] },
    { key: "R" as const, side: -1 as const, bones: ["rightUpperArm", "rightLowerArm", "rightHand"] },
  ];
  for (const limb of limbs) {
    const ch = channel(def, (k) => k[limb.key]);
    if (!ch) continue;
    const pack = (a: Arm) => [...a.at, ...(a.pole ?? (limb.side > 0 ? ELBOW_L : ELBOW_R)), a.twist ?? 0, ...(a.wrist ?? [0, 0, 0]), ...(a.palm ?? [0, 0, 0]), ...(a.fingers ?? [0, 0, 0])];
    const curve = spline(ch.times, ch.values.map(pack), ch.holds, !!def.loop, duration);
    const sbs = limb.bones.map(sampleBase);
    const out = limb.bones.map(() => new Float32Array(n * 4));
    const qs = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
    // La muñeca se escribe respecto al tronco: se pasa al marco de la clavícula (la de la base, con
    // lo que el gesto le sume), que es el padre del brazo.
    const shoulder = rotation.get(limb.side > 0 ? "leftShoulder" : "rightShoulder");
    const sh = shoulder ? quatSampler(shoulder, duration) : null;
    const qsh = new THREE.Quaternion();
    times.forEach((t, i) => {
      const v = curve(t, tmp);
      if (sh) {
        sh(t, qsh).invert();
        // La muñeca, el codo, la palma y los dedos (de tres en tres; el giro y la muñeca van en medio).
        for (const o of [0, 3, 10, 13]) {
          _t.set(v[o]!, v[o + 1]!, v[o + 2]!).applyQuaternion(qsh);
          v[o] = _t.x;
          v[o + 1] = _t.y;
          v[o + 2] = _t.z;
        }
      }
      solveArm(limb.side, { at: [v[0]!, v[1]!, v[2]!], pole: [v[3]!, v[4]!, v[5]!], twist: v[6]!, wrist: [v[7]!, v[8]!, v[9]!], palm: [v[10]!, v[11]!, v[12]!], fingers: [v[13]!, v[14]!, v[15]!] }, qs[0]!, qs[1]!, qs[2]!);
      const w = ch.weight(t);
      for (let b = 0; b < 3; b++) writeQ(out[b]!, i, w < 1 ? sbs[b]!(t, qBase).slerp(qs[b]!, w) : qs[b]!);
    });
    limb.bones.forEach((bone, b) => track(bone, out[b]!));
  }
  const legs = [
    { key: "LL" as const, bones: ["leftUpperLeg", "leftLowerLeg", "leftFoot"] },
    { key: "RL" as const, bones: ["rightUpperLeg", "rightLowerLeg", "rightFoot"] },
  ];
  for (const limb of legs) {
    const ch = channel(def, (k) => k[limb.key]);
    if (!ch) continue;
    const pack = (l: Leg) => [...l.at, ...(l.pole ?? [0, 0, 1]), ...(l.foot ?? [0, 0, 0])];
    const curve = spline(ch.times, ch.values.map(pack), ch.holds, !!def.loop, duration);
    const sbs = limb.bones.map(sampleBase);
    const out = limb.bones.map(() => new Float32Array(n * 4));
    const qs = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
    times.forEach((t, i) => {
      const v = curve(t, tmp);
      solveLeg({ at: [v[0]!, v[1]!, v[2]!], pole: [v[3]!, v[4]!, v[5]!], foot: [v[6]!, v[7]!, v[8]!] }, qs[0]!, qs[1]!, qs[2]!);
      const w = ch.weight(t);
      for (let b = 0; b < 3; b++) writeQ(out[b]!, i, w < 1 ? sbs[b]!(t, qBase).slerp(qs[b]!, w) : qs[b]!);
    });
    limb.bones.forEach((bone, b) => track(bone, out[b]!));
  }

  // Manos: de una forma a otra con transición suave.
  for (const [key, side] of [["l", "left"], ["r", "right"]] as const) {
    const ch = channel(def, (k) => k[key]);
    if (!ch) continue;
    for (const bone of FINGER_BONES[side]) {
      const sb = sampleBase(bone);
      const values = new Float32Array(n * 4);
      times.forEach((t, i) => {
        let j = 0;
        while (j < ch.times.length - 1 && t > ch.times[j + 1]!) j++;
        const a = shapes[ch.values[j]!].get(bone)!;
        const b = shapes[ch.values[Math.min(j + 1, ch.values.length - 1)]!].get(bone)!;
        const span = (ch.times[j + 1] ?? ch.times[j]!) - ch.times[j]!;
        const k = span > 0 ? smooth((t - ch.times[j]!) / span) : 0;
        q.copy(a).slerp(b, Math.max(0, Math.min(1, k)));
        const w = ch.weight(t);
        writeQ(values, i, w < 1 ? sb(t, qBase).slerp(q, w) : q);
      });
      track(bone, values);
    }
  }

  return cloneAnim(base, duration, rotation, translation);
}

/** Pista de cuaterniones muestreada en `times`. */
function resample(sample: Sample, times: number[], name: string): QuatTrack {
  const values = new Float32Array(times.length * 4);
  const q = new THREE.Quaternion();
  times.forEach((t, i) => {
    sample(t, q);
    values[i * 4] = q.x;
    values[i * 4 + 1] = q.y;
    values[i * 4 + 2] = q.z;
    values[i * 4 + 3] = q.w;
  });
  return new THREE.QuaternionKeyframeTrack(name, times, values);
}

/**
 * La guardia del modo pelea: la pose del primer fotograma del jab (piernas abiertas, el pie izquierdo
 * delante, puños arriba), con la respiración del reposo y el leve rebote de quien boxea.
 */
export function buildGuard(idle: VRMAnimation, jab: VRMAnimation): VRMAnimation {
  const duration = 2.5;
  const n = Math.round(duration * FPS) + 1;
  const times = Array.from({ length: n }, (_, i) => (i / (n - 1)) * duration);
  const idleRot = idle.humanoidTracks.rotation as unknown as Map<string, QuatTrack>;
  const jabRot = jab.humanoidTracks.rotation as unknown as Map<string, QuatTrack>;
  const rotation = new Map<string, QuatTrack>();
  const q0 = new THREE.Quaternion(), qi = new THREE.Quaternion(), qj = new THREE.Quaternion();
  // Rebote: cuatro por ciclo, las rodillas algo más dobladas abajo.
  const bounce = (t: number) => 0.5 - 0.5 * Math.cos((t / duration) * Math.PI * 2 * 4);
  for (const [bone, jt] of jabRot) {
    qj.set(jt.values[0]!, jt.values[1]!, jt.values[2]!, jt.values[3]!);
    const it = idleRot.get(bone);
    const si = quatSampler(it, idle.duration);
    if (it) q0.set(it.values[0]!, it.values[1]!, it.values[2]!, it.values[3]!).invert();
    const values = new Float32Array(n * 4);
    times.forEach((t, i) => {
      // La pose del jab con el cambio que hace el reposo respecto a su primer fotograma (respirar).
      const v = it ? qj.clone().multiply(q0.clone().multiply(si(t, qi))) : qj.clone();
      const b = bounce(t);
      if (bone === "leftLowerLeg" || bone === "rightLowerLeg") v.multiply(qi.setFromAxisAngle(X, 5 * DEG * b));
      else if (bone === "leftUpperLeg" || bone === "rightUpperLeg") v.multiply(qi.setFromAxisAngle(X, -2.5 * DEG * b));
      else if (bone === "chest") v.multiply(qi.setFromAxisAngle(X, 1.5 * DEG * b));
      values[i * 4] = v.x;
      values[i * 4 + 1] = v.y;
      values[i * 4 + 2] = v.z;
      values[i * 4 + 3] = v.w;
    });
    rotation.set(bone, new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  }
  const translation = new Map<string, THREE.VectorKeyframeTrack>();
  const jp = jab.humanoidTracks.translation.get("hips") as THREE.VectorKeyframeTrack | undefined;
  if (jp) {
    const values = new Float32Array(n * 3);
    times.forEach((t, i) => {
      values[i * 3] = jp.values[0]!;
      values[i * 3 + 1] = jp.values[1]! - 0.014 * bounce(t);
      values[i * 3 + 2] = jp.values[2]!;
    });
    translation.set("hips", new THREE.VectorKeyframeTrack("hips.position", times, values));
  }
  return cloneAnim(jab, duration, rotation, translation);
}

/** Nombres de clip de los gestos hechos aquí (no hay archivo .vrma para ellos). */
export const PROCEDURAL = new Set(Object.keys(GESTURES));

/** Los gestos en que se tocan las palmas: sus fotogramas y cuánto se tocan en cada uno. */
const TOUCH = new Map<string, { times: number[]; values: number[]; loop: boolean; dur: number }>();
for (const [name, def] of Object.entries(GESTURES)) {
  if (!def.keys.some((k) => k.touch)) continue;
  TOUCH.set(name, { times: def.keys.map((k) => k.t), values: def.keys.map((k) => k.touch ?? 0), loop: !!def.loop, dur: def.keys[def.keys.length - 1]!.t });
}

/** Cuánto se tocan las palmas en el momento `t` (s) del gesto `name` (0 en los que no se tocan). */
export function touchAt(name: string, t: number): number {
  const c = TOUCH.get(name);
  if (!c) return 0;
  if (c.loop && c.dur > 0) t = ((t % c.dur) + c.dur) % c.dur;
  const { times, values } = c;
  if (t <= times[0]!) return values[0]!;
  for (let i = 0; i < times.length - 1; i++)
    if (t <= times[i + 1]!) return values[i]! + (values[i + 1]! - values[i]!) * smooth((t - times[i]!) / Math.max(1e-6, times[i + 1]! - times[i]!));
  return values[values.length - 1]!;
}
