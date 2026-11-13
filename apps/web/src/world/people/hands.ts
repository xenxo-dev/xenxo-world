/**
 * Las manos. Los clips de captura (la Universal Animation Library, tools/avatars) traen en los dedos
 * siempre la misma pose, un puño cerrado (la conversión la dejó fija en todos: andar, el reposo, los
 * golpes, la escalada…), y por eso todo el mundo iba con los puños apretados. Aquí van las formas de
 * la mano hechas a mano, en el espacio normalizado de VRM (dedos estirados = sin giro): relajada
 * (cada dedo algo más doblado que el anterior, del índice al meñique, un poco abiertos en abanico y
 * el pulgar junto al índice), el puño, la de agarrar (un borde, una barra) y la abierta. Las usan el
 * animador (la base de cada momento, animation.ts) y los gestos hechos en código (people/gestures.ts).
 *
 * Los ejes, en la pose en T de VRM 1 (mirando a +Z, la mano izquierda en +X, **las palmas hacia
 * abajo** y el pulgar hacia delante):
 * - doblar un dedo (hacia la palma) es girar alrededor de Z: − en la mano izquierda, + en la derecha
 *   (es el eje del puño de la captura, medido en los clips);
 * - abrirlo en abanico es girar alrededor de Y (la normal de la palma): el meñique, + en la izquierda;
 * - el pulgar se cierra alrededor de sus propios ejes, los del puño de la captura (`THUMB_AXES`).
 * Girar alrededor de Y no dobla nada: barre el dedo de lado, por el plano de la palma (así estaban
 * antes, con los dedos torcidos hacia un lado). `test/hands.mts` lo comprueba con los esqueletos de
 * los personajes de serie: con cada forma, las puntas van hacia la palma y no de lado.
 *
 * Los VRM 0.x (que también se pueden subir) miran hacia el otro lado: sus ejes son los mismos girados
 * media vuelta alrededor de Y (x y z cambian de signo), como hace three-vrm con los clips
 * (`createVRMAnimationClip`). `forVrm0` da la tabla así.
 */
import * as THREE from "three";
import type { VRMHumanBoneName, VRMHumanoid } from "@pixiv/three-vrm";

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

type Long = "Index" | "Middle" | "Ring" | "Little";
/**
 * Por dedo, los grados que se dobla cada articulación (de la base a la punta) y cuánto se abre en
 * abanico desde la base (+: hacia fuera de la mano, del lado del meñique; el índice, al revés); el
 * pulgar, lo que se cierra cada una de sus tres articulaciones.
 */
interface Shape {
  fingers: Record<Long, [number, number, number]>;
  spread: Record<Long, number>;
  thumb: [number, number, number];
}
const SHAPES: Record<BaseHand, Shape> = {
  relaxed: {
    fingers: { Index: [18, 26, 12], Middle: [24, 34, 16], Ring: [30, 40, 20], Little: [36, 46, 24] },
    spread: { Index: 3, Middle: 0, Ring: 3, Little: 7 },
    thumb: [14, 10, 16],
  },
  fist: {
    fingers: { Index: [80, 96, 58], Middle: [84, 98, 60], Ring: [86, 98, 60], Little: [88, 96, 58] },
    spread: { Index: -2, Middle: 0, Ring: -2, Little: -4 },
    thumb: [40, 28, 62],
  },
  grip: {
    fingers: { Index: [50, 60, 34], Middle: [54, 64, 36], Ring: [56, 66, 36], Little: [58, 66, 36] },
    spread: { Index: 0, Middle: 0, Ring: 0, Little: 2 },
    thumb: [28, 18, 36],
  },
  open: {
    fingers: { Index: [6, 9, 5], Middle: [8, 11, 6], Ring: [10, 13, 7], Little: [12, 14, 8] },
    spread: { Index: 4, Middle: 0, Ring: 4, Little: 10 },
    thumb: [6, 4, 6],
  },
  flat: {
    fingers: { Index: [0, 0, 0], Middle: [0, 0, 0], Ring: [0, 0, 0], Little: [0, 0, 0] },
    spread: { Index: 0, Middle: 0, Ring: 0, Little: 0 },
    thumb: [0, 0, 0],
  },
};

/**
 * Los ejes del pulgar izquierdo (metacarpo, falange y punta): los del puño de la captura (el giro de
 * cada hueso, idle.vrma). El derecho, en espejo (x, −y, −z).
 */
const THUMB_AXES: [number, number, number][] = [
  [0.58, 0.61, -0.55],
  [0.27, 0.96, -0.12],
  [0.21, 0.96, -0.21],
];

const DEG = Math.PI / 180;
const _flex = new THREE.Vector3();
const _fan = new THREE.Vector3();
const _a = new THREE.Quaternion();

/** El giro de un hueso de los dedos («leftIndexProximal»…) en una forma (un objeto nuevo: se llama al cargar, no por frame). */
export function fingerPose(shape: BaseHand, bone: string): THREE.Quaternion {
  const m = /^(left|right)(Thumb|Index|Middle|Ring|Little)(Metacarpal|Proximal|Intermediate|Distal)$/.exec(bone);
  const q = new THREE.Quaternion();
  if (!m) return q;
  const left = m[1] === "left";
  const s = SHAPES[shape];
  const finger = m[2] as (typeof FINGERS)[number];
  const j = JOINTS[finger].indexOf(m[3]!);
  if (finger === "Thumb") {
    const [x, y, z] = THUMB_AXES[j]!;
    return q.setFromAxisAngle(_flex.set(x, left ? y : -y, left ? z : -z).normalize(), s.thumb[j]! * DEG);
  }
  // Doblar (alrededor de Z) y, en la base, abrirse en abanico (alrededor de la normal de la palma):
  // primero se dobla y después se lleva el dedo entero de lado, así se dobla en su propio plano.
  q.setFromAxisAngle(_flex.set(0, 0, left ? -1 : 1), s.fingers[finger][j]! * DEG);
  if (j === 0) {
    const out = finger === "Index" ? -1 : finger === "Middle" ? 0 : 1;
    const deg = out * s.spread[finger];
    if (deg) q.premultiply(_a.setFromAxisAngle(_fan.set(0, left ? 1 : -1, 0), deg * DEG));
  }
  return q;
}

/** La tabla de un VRM 0.x: el mismo giro, media vuelta alrededor de Y (ver arriba). */
export const forVrm0 = (q: THREE.Quaternion, out: THREE.Quaternion) => out.set(-q.x, q.y, -q.z, q.w);

/** Por debajo de esto (rad: unos 6°), la mano en reposo de un modelo ya vale como está. */
const MIN_FIX = 0.1;
/** El pulgar izquierdo en reposo según VRM 1 (y en los personajes de serie): a 45° hacia delante, en el plano de la palma. */
const THUMB_REST = new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2);

/**
 * Cómo se pasa el giro de un hueso de los dedos (el de las formas y los clips, pensado para una mano
 * en la pose de VRM) a una mano que en reposo está de otra manera: `pre · giro · post`.
 */
export interface RestFix {
  node: THREE.Object3D;
  pre: THREE.Quaternion;
  post: THREE.Quaternion;
}

/**
 * Lo que hay que enderezar en las manos de un modelo para que partan de la pose que esperan las
 * formas de aquí y los clips: los dedos rectos y el pulgar a 45° hacia delante, en el plano de la
 * palma (lo que pide VRM 1, y como están los personajes de serie). Las fundas traen en reposo la
 * mano de MakeHuman, con los dedos algo doblados y el pulgar hacia abajo: sin esto, la mano relajada
 * salía en garra y el pulgar del puño asomaba por debajo. Se mide en el reposo normalizado de
 * three-vrm (dónde está cada hueso respecto al anterior; ahí nada está girado): por cada falange, el
 * giro que la pone donde la espera la pose de VRM (`fix`; en los dedos, solo lo que se doblan hacia
 * la palma o hacia atrás: cómo se abren en abanico es de cada mano) y, sumado al de las de antes, lo
 * que lleva cada una (`R`). El giro de cada hueso se pasa a esa mano como R(anterior)⁻¹ · giro · R
 * (animation.ts lo aplica después de todo lo demás): así cada falange acaba donde en un personaje de
 * serie, también las del pulgar, que con solo enderezar su base se cerraba hacia otro lado. La
 * última falange, que no tiene un hueso detrás que diga hacia dónde va, sigue a la de antes. Vacío
 * si no hace falta (los de serie).
 */
export function restFix(h: VRMHumanoid, vrm0: boolean): RestFix[] {
  const rest = h.normalizedRestPose;
  const at = (b: string) => {
    const p = rest[b as VRMHumanBoneName]?.position;
    const v = p ? new THREE.Vector3().fromArray(p) : null;
    return v && v.lengthSq() > 1e-12 ? v.normalize() : null;
  };
  const angle = (q: THREE.Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
  const out: RestFix[] = [];
  /** Una cadena de huesos con el giro que endereza cada uno (o null): la de antes es la mano, sin giro. */
  const chain = (bones: string[], fixes: (THREE.Quaternion | null)[]) => {
    let R = new THREE.Quaternion();
    for (let i = 0; i < bones.length; i++) {
      const node = h.getNormalizedBoneNode(bones[i] as VRMHumanBoneName);
      if (!node) return;
      const fix = fixes[i];
      const next = fix && angle(fix) > MIN_FIX ? R.clone().multiply(fix) : R.clone();
      if (angle(R) > 1e-4 || angle(next) > 1e-4) out.push({ node, pre: R.clone().invert(), post: next });
      R = next;
    }
  };
  const a = new THREE.Vector3(), up = new THREE.Vector3(), vp = new THREE.Vector3();
  for (const side of ["left", "right"] as const) {
    const mid = at(`${side}MiddleProximal`), index = at(`${side}IndexProximal`), little = at(`${side}LittleProximal`);
    if (!mid || !index || !little) continue;
    // La normal de la palma (hacia fuera de ella), con el dedo corazón y la línea del meñique al índice.
    const palm = mid.clone().cross(index.clone().sub(little)).normalize();
    if (side === "right") palm.negate();
    for (const f of ["Index", "Middle", "Ring", "Little"]) {
      const bones = [`${side}${f}Proximal`, `${side}${f}Intermediate`, `${side}${f}Distal`];
      const fixes: (THREE.Quaternion | null)[] = [null, null, null];
      // u: el hueso de antes (para la primera falange, de la muñeca a la base del dedo); v: el de ahora.
      let u = at(bones[0]!);
      for (let i = 0; i < 2 && u; i++) {
        const v = at(bones[i + 1]!);
        if (!v) break;
        a.crossVectors(u, palm).normalize();
        up.copy(u).addScaledVector(a, -u.dot(a));
        vp.copy(v).addScaledVector(a, -v.dot(a));
        const bend = Math.atan2(_flex.crossVectors(up, vp).dot(a), up.dot(vp));
        fixes[i] = new THREE.Quaternion().setFromAxisAngle(a, -bend);
        u = v;
      }
      chain(bones, fixes);
    }
    const want = THUMB_REST.clone();
    if (side === "right") want.x = -want.x;
    if (vrm0) want.set(-want.x, want.y, -want.z);
    const meta = at(`${side}ThumbProximal`), prox = at(`${side}ThumbDistal`);
    if (meta)
      chain(
        [`${side}ThumbMetacarpal`, `${side}ThumbProximal`, `${side}ThumbDistal`],
        [new THREE.Quaternion().setFromUnitVectors(meta, want), prox ? new THREE.Quaternion().setFromUnitVectors(prox, meta) : null, null],
      );
  }
  return out;
}

/** Todas las formas, por hueso: se calculan una vez. */
const table = new Map<string, Map<string, THREE.Quaternion>>();
export function handTable(shape: BaseHand, vrm0 = false): Map<string, THREE.Quaternion> {
  const key = vrm0 ? `${shape}:0` : shape;
  let t = table.get(key);
  if (!t) {
    t = new Map();
    for (const b of ALL_FINGER_BONES) {
      const q = fingerPose(shape, b);
      t.set(b, vrm0 ? forVrm0(q, q) : q);
    }
    table.set(key, t);
  }
  return t;
}
