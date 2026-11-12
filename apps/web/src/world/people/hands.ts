/**
 * Las manos. Los clips de captura (la Universal Animation Library, tools/avatars) traen en los dedos
 * siempre la misma pose, un puño cerrado (la conversión la dejó fija en todos: andar, el reposo, los
 * golpes, la escalada…), y por eso todo el mundo iba con los puños apretados. Aquí van las formas de
 * la mano hechas a mano, en el espacio normalizado de VRM (dedos estirados = sin giro): relajada
 * (cada dedo algo más doblado que el anterior, del índice al meñique, y el pulgar junto al índice),
 * el puño, la de agarrar (un borde, una barra) y la abierta. Las usan el animador (la base de cada
 * momento, animation.ts) y los gestos hechos en código (people/gestures.ts).
 *
 * Doblar un dedo es girar alrededor de su Y (+ en la mano izquierda, − en la derecha); el pulgar,
 * además, se cierra hacia la palma por su X (igual en las dos). Medido mirando la mano de cerca.
 */
import * as THREE from "three";

export const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"] as const;
export const JOINTS: Record<(typeof FINGERS)[number], readonly string[]> = {
  Thumb: ["Metacarpal", "Proximal", "Distal"],
  Index: ["Proximal", "Intermediate", "Distal"],
  Middle: ["Proximal", "Intermediate", "Distal"],
  Ring: ["Proximal", "Intermediate", "Distal"],
  Little: ["Proximal", "Intermediate", "Distal"],
};
const fingerBones = (side: "left" | "right") => FINGERS.flatMap((f) => JOINTS[f].map((j) => `${side}${f}${j}`));
export const FINGER_BONES = { left: fingerBones("left"), right: fingerBones("right") };
export const ALL_FINGER_BONES = [...FINGER_BONES.left, ...FINGER_BONES.right];

/** Las formas de base: relajada, puño, agarrar, abierta y estirada. */
export type BaseHand = "relaxed" | "fist" | "grip" | "open" | "flat";

/** Grados de cada articulación (de la base a la punta) por dedo; el pulgar, [cerrar (X), doblar (Y)]. */
interface Shape {
  fingers: Record<"Index" | "Middle" | "Ring" | "Little", [number, number, number]>;
  thumb: [[number, number], [number, number], [number, number]];
}
const SHAPES: Record<BaseHand, Shape> = {
  relaxed: {
    fingers: { Index: [20, 30, 16], Middle: [26, 36, 18], Ring: [32, 40, 20], Little: [38, 44, 22] },
    thumb: [[14, 8], [0, 14], [0, 12]],
  },
  fist: {
    fingers: { Index: [82, 96, 52], Middle: [86, 98, 54], Ring: [88, 100, 54], Little: [90, 100, 54] },
    thumb: [[38, 22], [0, 42], [0, 40]],
  },
  grip: {
    fingers: { Index: [52, 62, 34], Middle: [56, 66, 36], Ring: [58, 68, 36], Little: [60, 68, 36] },
    thumb: [[30, 16], [0, 26], [0, 22]],
  },
  open: {
    fingers: { Index: [7, 10, 5], Middle: [9, 12, 6], Ring: [11, 14, 7], Little: [13, 15, 8] },
    thumb: [[5, 3], [0, 5], [0, 4]],
  },
  flat: {
    fingers: { Index: [0, 0, 0], Middle: [0, 0, 0], Ring: [0, 0, 0], Little: [0, 0, 0] },
    thumb: [[0, 0], [0, 0], [0, 0]],
  },
};

const DEG = Math.PI / 180;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Quaternion();

/** El giro de un hueso de los dedos («leftIndexProximal»…) en una forma (un objeto nuevo: se llama al cargar, no por frame). */
export function fingerPose(shape: BaseHand, bone: string): THREE.Quaternion {
  const m = /^(left|right)(Thumb|Index|Middle|Ring|Little)(Metacarpal|Proximal|Intermediate|Distal)$/.exec(bone);
  const q = new THREE.Quaternion();
  if (!m) return q;
  const sign = m[1] === "left" ? 1 : -1;
  const s = SHAPES[shape];
  const finger = m[2] as (typeof FINGERS)[number];
  const j = JOINTS[finger].indexOf(m[3]!);
  if (finger === "Thumb") {
    const [close, bend] = s.thumb[j]!;
    q.setFromAxisAngle(X, close * DEG).multiply(_a.setFromAxisAngle(Y, sign * bend * DEG));
  } else q.setFromAxisAngle(Y, sign * s.fingers[finger][j]! * DEG);
  return q;
}

/** Todas las formas, por hueso: se calculan una vez. */
const table = new Map<BaseHand, Map<string, THREE.Quaternion>>();
export function handTable(shape: BaseHand): Map<string, THREE.Quaternion> {
  let t = table.get(shape);
  if (!t) {
    t = new Map(ALL_FINGER_BONES.map((b) => [b, fingerPose(shape, b)]));
    table.set(shape, t);
  }
  return t;
}
