/**
 * Gestos hechos a mano, en código (aplaudir, señalar, llamar, reírse, encogerse de hombros, las
 * acciones en pareja y los golpes): la biblioteca de Quaternius no los trae. Cada uno es una
 * animación VRMA como las demás, montada al vuelo sobre el reposo (`idle`): de él salen las piernas,
 * la cadera y la respiración, y el gesto pone encima los huesos que mueve (brazos, tronco, cabeza o
 * una pierna). Así vale para cualquier VRM, como los clips de la biblioteca.
 *
 * Ejes de los huesos normalizados de VRM (pose en T, mirando a +Z): en el brazo izquierdo, z < 0
 * lo baja, y < 0 lo lleva hacia delante y z > 0 hacia arriba (el derecho, al revés); en el codo,
 * y dobla el antebrazo hacia delante (izquierdo < 0, derecho > 0); en tronco y cabeza, x > 0 se
 * inclina hacia delante; en la pierna, x < 0 la lleva hacia delante y en la rodilla, x > 0 la dobla.
 */
import * as THREE from "three";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";

type Euler = [number, number, number];
/** Un fotograma: segundo y giro (grados) de cada hueso que se mueve. */
type Frame = [number, Partial<Record<Bone, Euler>>];
type Bone =
  | "spine" | "chest" | "neck" | "head"
  | "leftShoulder" | "rightShoulder"
  | "leftUpperArm" | "leftLowerArm" | "leftHand"
  | "rightUpperArm" | "rightLowerArm" | "rightHand"
  | "leftUpperLeg" | "leftLowerLeg" | "rightUpperLeg" | "rightLowerLeg";

/** Brazos en reposo, junto al cuerpo (para empezar y acabar los gestos). */
const REST: Partial<Record<Bone, Euler>> = {
  leftUpperArm: [0, 0, -72],
  leftLowerArm: [0, -12, 0],
  rightUpperArm: [0, 0, 72],
  rightLowerArm: [0, 12, 0],
};
const rest = (extra: Partial<Record<Bone, Euler>> = {}) => ({ ...REST, ...extra });

/** Gesto → fotogramas y si se repite. Los que no se repiten acaban donde empezaron. */
export const GESTURES: Record<string, { loop: boolean; frames: Frame[] }> = {
  clap: {
    loop: true,
    frames: [
      [0, { leftUpperArm: [0, -52, -18], leftLowerArm: [0, -100, 0], rightUpperArm: [0, 52, 18], rightLowerArm: [0, 100, 0] }],
      [0.18, { leftUpperArm: [0, -70, -14], leftLowerArm: [0, -108, 0], rightUpperArm: [0, 70, 14], rightLowerArm: [0, 108, 0] }],
      [0.36, { leftUpperArm: [0, -52, -18], leftLowerArm: [0, -100, 0], rightUpperArm: [0, 52, 18], rightLowerArm: [0, 100, 0] }],
    ],
  },
  point: {
    loop: false,
    frames: [
      [0, rest()],
      [0.35, rest({ rightUpperArm: [0, 82, -8], rightLowerArm: [0, 4, 0], chest: [0, -10, 0], head: [0, -6, 0] })],
      [1.5, rest({ rightUpperArm: [0, 82, -8], rightLowerArm: [0, 4, 0], chest: [0, -10, 0], head: [0, -6, 0] })],
      [1.9, rest()],
    ],
  },
  beckon: {
    loop: true,
    frames: [
      [0, rest({ rightUpperArm: [0, 55, 40], rightLowerArm: [0, 20, 0] })],
      [0.3, rest({ rightUpperArm: [0, 55, 40], rightLowerArm: [0, 95, 0], head: [6, 0, 0] })],
      [0.6, rest({ rightUpperArm: [0, 55, 40], rightLowerArm: [0, 20, 0] })],
    ],
  },
  laugh: {
    loop: true,
    frames: [
      [0, { leftUpperArm: [0, -22, -68], leftLowerArm: [0, -82, 0], rightUpperArm: [0, 22, 68], rightLowerArm: [0, 82, 0], chest: [8, 0, 0], head: [-14, 0, 0] }],
      [0.22, { leftUpperArm: [0, -22, -68], leftLowerArm: [0, -82, 0], rightUpperArm: [0, 22, 68], rightLowerArm: [0, 82, 0], chest: [16, 0, 0], head: [-4, 0, 0] }],
      [0.44, { leftUpperArm: [0, -22, -68], leftLowerArm: [0, -82, 0], rightUpperArm: [0, 22, 68], rightLowerArm: [0, 82, 0], chest: [8, 0, 0], head: [-14, 0, 0] }],
    ],
  },
  shrug: {
    loop: false,
    frames: [
      [0, rest()],
      [0.35, { leftShoulder: [0, 0, 14], rightShoulder: [0, 0, -14], leftUpperArm: [0, -18, -62], leftLowerArm: [0, -78, 0], leftHand: [-50, 0, 0], rightUpperArm: [0, 18, 62], rightLowerArm: [0, 78, 0], rightHand: [-50, 0, 0], head: [0, 0, 10] }],
      [1.0, { leftShoulder: [0, 0, 14], rightShoulder: [0, 0, -14], leftUpperArm: [0, -18, -62], leftLowerArm: [0, -78, 0], leftHand: [-50, 0, 0], rightUpperArm: [0, 18, 62], rightLowerArm: [0, 78, 0], rightHand: [-50, 0, 0], head: [0, 0, 10] }],
      [1.4, rest()],
    ],
  },
  high_five: {
    loop: false,
    frames: [
      [0, rest()],
      [0.4, rest({ rightUpperArm: [0, 40, -62], rightLowerArm: [0, 22, 0], chest: [0, -8, 0] })],
      [0.62, rest({ rightUpperArm: [0, 52, -50], rightLowerArm: [0, 6, 0], chest: [0, -14, 0] })],
      [1.1, rest({ rightUpperArm: [0, 40, -62], rightLowerArm: [0, 22, 0] })],
      [1.6, rest()],
    ],
  },
  hug: {
    loop: false,
    frames: [
      [0, rest()],
      [0.5, { leftUpperArm: [0, -70, -8], leftLowerArm: [0, -55, 0], rightUpperArm: [0, 70, 8], rightLowerArm: [0, 55, 0], chest: [10, 0, 0] }],
      [1.8, { leftUpperArm: [0, -78, -14], leftLowerArm: [0, -82, 0], rightUpperArm: [0, 78, 14], rightLowerArm: [0, 82, 0], chest: [12, 0, 0], head: [6, 14, 0] }],
      [2.3, rest()],
    ],
  },
  handshake: {
    loop: false,
    frames: [
      [0, rest()],
      [0.45, rest({ rightUpperArm: [0, 48, 52], rightLowerArm: [0, 62, 0] })],
      [0.7, rest({ rightUpperArm: [0, 48, 60], rightLowerArm: [0, 62, 0] })],
      [0.95, rest({ rightUpperArm: [0, 48, 46], rightLowerArm: [0, 62, 0] })],
      [1.2, rest({ rightUpperArm: [0, 48, 60], rightLowerArm: [0, 62, 0] })],
      [1.45, rest({ rightUpperArm: [0, 48, 52], rightLowerArm: [0, 62, 0] })],
      [1.9, rest()],
    ],
  },
  punch: {
    loop: false,
    frames: [
      [0, rest({ leftUpperArm: [0, -40, -58], leftLowerArm: [0, -110, 0], rightUpperArm: [0, 40, 58], rightLowerArm: [0, 110, 0] })],
      [0.12, rest({ leftUpperArm: [0, -40, -58], leftLowerArm: [0, -110, 0], rightUpperArm: [0, 30, 62], rightLowerArm: [0, 120, 0], chest: [0, 16, 0] })],
      [0.24, rest({ leftUpperArm: [0, -40, -58], leftLowerArm: [0, -110, 0], rightUpperArm: [0, 86, 4], rightLowerArm: [0, 4, 0], chest: [4, -22, 0], spine: [0, -8, 0] })],
      [0.42, rest({ leftUpperArm: [0, -40, -58], leftLowerArm: [0, -110, 0], rightUpperArm: [0, 86, 4], rightLowerArm: [0, 4, 0], chest: [4, -22, 0], spine: [0, -8, 0] })],
      [0.7, rest()],
    ],
  },
  kick: {
    loop: false,
    frames: [
      [0, rest()],
      [0.18, rest({ rightUpperLeg: [-40, 0, 0], rightLowerLeg: [75, 0, 0], leftUpperArm: [0, -20, -40], rightUpperArm: [0, -20, 40], spine: [-6, 0, 0] })],
      [0.32, rest({ rightUpperLeg: [-82, 0, 0], rightLowerLeg: [6, 0, 0], leftUpperArm: [0, -10, -30], rightUpperArm: [0, -30, 34], spine: [-14, 0, 0] })],
      [0.5, rest({ rightUpperLeg: [-60, 0, 0], rightLowerLeg: [40, 0, 0], spine: [-8, 0, 0] })],
      [0.8, rest()],
    ],
  },
  shove: {
    loop: false,
    frames: [
      [0, rest()],
      [0.18, { leftUpperArm: [0, -60, -40], leftLowerArm: [0, -100, 0], rightUpperArm: [0, 60, 40], rightLowerArm: [0, 100, 0], chest: [-4, 0, 0] }],
      [0.32, { leftUpperArm: [0, -86, -6], leftLowerArm: [0, -6, 0], rightUpperArm: [0, 86, 6], rightLowerArm: [0, 6, 0], chest: [14, 0, 0], spine: [6, 0, 0] }],
      [0.5, { leftUpperArm: [0, -86, -6], leftLowerArm: [0, -6, 0], rightUpperArm: [0, 86, 6], rightLowerArm: [0, 6, 0], chest: [14, 0, 0], spine: [6, 0, 0] }],
      [0.8, rest()],
    ],
  },
  hit_stagger: {
    loop: false,
    frames: [
      [0, rest()],
      [0.12, { leftUpperArm: [0, 20, -38], leftLowerArm: [0, -30, 0], rightUpperArm: [0, -20, 38], rightLowerArm: [0, 30, 0], spine: [-16, 0, 6], chest: [-10, 0, 0], head: [-22, 8, 0] }],
      [0.45, { leftUpperArm: [0, 10, -52], rightUpperArm: [0, -10, 52], spine: [-6, 0, 2], head: [-8, 0, 0] }],
      [0.85, rest()],
    ],
  },
  hit_down: {
    loop: true,
    frames: [
      [0, { leftUpperArm: [0, 0, -28], leftLowerArm: [0, -20, 0], rightUpperArm: [0, 0, 28], rightLowerArm: [0, 20, 0], head: [-10, 0, 0], leftUpperLeg: [-8, 0, 4], rightUpperLeg: [-16, 0, -6], rightLowerLeg: [20, 0, 0] }],
      [1, { leftUpperArm: [0, 0, -30], leftLowerArm: [0, -24, 0], rightUpperArm: [0, 0, 26], rightLowerArm: [0, 18, 0], head: [-12, 0, 0], leftUpperLeg: [-8, 0, 4], rightUpperLeg: [-16, 0, -6], rightLowerLeg: [20, 0, 0] }],
    ],
  },
};

const DEG = Math.PI / 180;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Monta el gesto `name` sobre la animación de reposo: copia sus pistas (piernas, cadera,
 * respiración) y pone encima las de los huesos que mueve el gesto.
 */
export function buildGesture(name: string, idle: VRMAnimation): VRMAnimation | null {
  const g = GESTURES[name];
  if (!g) return null;
  const bones = new Set<Bone>();
  for (const [, pose] of g.frames) for (const b of Object.keys(pose) as Bone[]) bones.add(b);
  const duration = g.frames[g.frames.length - 1]![0];
  const rotation = new Map(idle.humanoidTracks.rotation);
  for (const bone of bones) {
    const times: number[] = [];
    const values: number[] = [];
    for (const [t, pose] of g.frames) {
      // Un hueso que no sale en un fotograma vuelve a su reposo (el de REST o sin giro).
      const d = pose[bone] ?? REST[bone] ?? [0, 0, 0];
      _q.setFromEuler(_e.set(d[0] * DEG, d[1] * DEG, d[2] * DEG, "XYZ"));
      times.push(t);
      values.push(_q.x, _q.y, _q.z, _q.w);
    }
    rotation.set(bone, new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  }
  // Las pistas del reposo pueden durar más que el gesto: se recortan para que el bucle cuadre.
  const out = Object.create(Object.getPrototypeOf(idle)) as VRMAnimation;
  Object.assign(out, idle, {
    duration: Math.max(duration, 0.1),
    humanoidTracks: { translation: new Map(idle.humanoidTracks.translation), rotation },
  });
  return out;
}

/** Nombres de clip de los gestos hechos aquí (no hay archivo .vrma para ellos). */
export const PROCEDURAL = new Set(Object.keys(GESTURES));
