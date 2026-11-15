/**
 * Del movimiento de una persona en un vídeo (los puntos que saca MediaPipe del cuerpo y de las manos,
 * capture/mediapipe.ts) al de un personaje VRM: el giro de cada hueso del humanoide normalizado en cada
 * fotograma. Sin nada del navegador (se prueba en Node: test/capture.mts).
 *
 * Por direcciones, no por posiciones: cada hueso apunta hacia donde apunta ese tramo del cuerpo en el
 * vídeo, así que vale para cualquier personaje, mida lo que mida. Lo que una dirección no dice (cuánto
 * gira un hueso sobre sí mismo) sale de otro eje: el tronco, de la línea de las caderas y de la de los
 * hombros; la cabeza, de las orejas y los ojos; el brazo y la pierna, de su bisagra (el codo y la rodilla
 * doblan en el plano que forman con el brazo y el antebrazo, el muslo y la pierna); la mano, de su palma;
 * y lo que la mano gira sobre el antebrazo se lo reparten el antebrazo y la muñeca, como en el esqueleto
 * del juego (people/rig.ts → turnHand).
 *
 * MediaPipe da los puntos en metros, con el origen entre las caderas y los ejes de la imagen (x a la
 * derecha, y hacia abajo, z alejándose de la cámara); aquí, los del modelo de VRM (x a su izquierda, y
 * arriba, z delante: quien mira a la cámara, con la cara hacia +z). La persona se gira para que mire de
 * frente (lo que mira de media en el trozo elegido) y sin desplazarse: es un gesto en el sitio. La
 * cadera sube y baja para que el pie más bajo pise el suelo (al agacharse, también el cuerpo).
 */
import * as THREE from "three";
import { handTable } from "../world/people/hands";

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

/** Los puntos del cuerpo de MediaPipe Pose (de la persona: «l», su izquierda). */
export const LM = {
  nose: 0, lEye: 2, rEye: 5, lEar: 7, rEar: 8,
  lSho: 11, rSho: 12, lElb: 13, rElb: 14, lWri: 15, rWri: 16,
  lPinky: 17, rPinky: 18, lIndex: 19, rIndex: 20,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28, lHeel: 29, rHeel: 30, lFoot: 31, rFoot: 32,
} as const;
/** Los de la mano (MediaPipe Hands): la muñeca y, por dedo, sus cuatro puntos (de la base a la punta). */
export const HAND = { wrist: 0, thumb: [1, 2, 3, 4], index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], little: [17, 18, 19, 20] } as const;
/** Pares izquierda/derecha del cuerpo (para el espejo). */
const PAIRS: [number, number][] = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];

/** Un fotograma de la captura. */
export interface CaptureFrame {
  /** Segundos desde el principio del vídeo. */
  t: number;
  /** Los 33 puntos del cuerpo (m, como los da MediaPipe), o null si no se vio a nadie. */
  pose: V3[] | null;
  /** Las manos que se vieron: de quién son (de la persona: 0 la izquierda, 1 la derecha) y sus 21 puntos (m, sobre su centro, mismos ejes). */
  hands: { side: 0 | 1; world: V3[] }[];
  /**
   * Lo que se ve en la imagen (para dibujarlo encima del vídeo): los puntos del cuerpo y de cada mano
   * (de 0 a 1, desde arriba a la izquierda) y lo visible que está cada punto del cuerpo (de 0 a 1).
   */
  view?: { pose: [number, number][]; vis: number[]; hands: { side: 0 | 1; pts: [number, number][] }[] };
}

/** Un hueso del humanoide en reposo (la pose en T de VRM 1.0, mirando a +z): dónde está respecto a su padre (m). */
export interface RestBone {
  name: string;
  parent: string | null;
  offset: V3;
}

/** El movimiento: por fotograma, el giro de cada hueso respecto a su padre (la cadera, en el mundo) y dónde está la cadera (m). */
export interface Motion {
  fps: number;
  bones: RestBone[];
  frames: { t: number; hips: V3; rot: Record<string, Q4> }[];
}

export interface RetargetOptions {
  /** Fotogramas por segundo de la captura (los de `frames`, que van seguidos). */
  fps: number;
  /** El vídeo, en espejo (una cámara frontal): la izquierda de la persona es la derecha del personaje. */
  mirror?: boolean;
  /** Solo de cintura para arriba: las piernas y la cadera, en reposo (un gesto que sigue al andar). */
  upper?: boolean;
  /** La cadera sube y baja para que el pie más bajo pise el suelo (si no, a su altura de pie). */
  ground?: boolean;
  /** Cuánto se suaviza (fotogramas: la sigma de una gaussiana centrada, sin retraso; 0, nada). */
  smooth?: number;
  /** El trozo que se queda (s del vídeo). */
  from?: number;
  to?: number;
  /** En bucle: el final va hacia el principio (`LOOP_S`), para que al repetirse no salte. */
  loop?: boolean;
}

/** En bucle: lo que tarda el final en llegar a la pose del principio (s). */
const LOOP_S = 0.35;
/**
 * El tronco entre la cadera y los hombros: lo que gira cada hueso de la columna (de la cadera al
 * pecho), y la cabeza: el cuello y la cabeza.
 */
const SPINE = { spine: 0.4, chest: 0.3, upperChest: 0.3 };
const NECK = 0.4;
/**
 * La cabeza: de las orejas a los ojos se sube algo (rad): con la cabeza recta, los ojos quedan algo por
 * encima de la línea de las orejas.
 */
const HEAD_PITCH = 0.18;
/** Lo que gira el antebrazo de lo que gira la mano sobre él (el resto, la muñeca), como en rig.ts. */
const FOREARM_TWIST = 0.6;
/** Por debajo de este seno, un brazo o una pierna van casi rectos y su bisagra sale de la del fotograma anterior. */
const STRAIGHT = 0.12;
/** Doblado al revés por menos que esto (seno): pasado de recto, con la bisagra de antes. */
const FLIP = 0.45;
/** Lo menos que gira la mano sobre el antebrazo hacia la palma arriba (rad, desde la palma abajo de la pose en T). */
const TWIST_FROM = -95 * (Math.PI / 180);
/** Sin ver una mano, lo que se siguen usando sus puntos de cuando se vio (s); después, la mano sale de los del cuerpo. */
const HAND_HOLD = 0.3;
/**
 * La palma de canto a la cámara: por debajo del primero (lo que mira hacia la cámara, de 0 a 1), el giro
 * de la mano sobre los dedos es el de la mano del cuerpo; por encima del segundo, el de la captura.
 * Medido con vídeos de personajes haciendo clips conocidos (MediaPipe de verdad).
 */
const EDGE_ON: [number, number] = [0.5, 0.9];
/** Lo que tardan los dedos en pasar de la captura a la mano relajada (s), al dejar de verse la mano. */
const FINGER_FADE = 0.35;

const BONES_LIMBS = {
  arm: [
    { side: 0, upper: "leftUpperArm", lower: "leftLowerArm", hand: "leftHand", s: LM.lSho, e: LM.lElb, w: LM.lWri, index: LM.lIndex, pinky: LM.lPinky },
    { side: 1, upper: "rightUpperArm", lower: "rightLowerArm", hand: "rightHand", s: LM.rSho, e: LM.rElb, w: LM.rWri, index: LM.rIndex, pinky: LM.rPinky },
  ],
  leg: [
    { upper: "leftUpperLeg", lower: "leftLowerLeg", foot: "leftFoot", toes: "leftToes", h: LM.lHip, k: LM.lKnee, a: LM.lAnk, heel: LM.lHeel, tip: LM.lFoot },
    { upper: "rightUpperLeg", lower: "rightLowerLeg", foot: "rightFoot", toes: "rightToes", h: LM.rHip, k: LM.rKnee, a: LM.rAnk, heel: LM.rHeel, tip: LM.rFoot },
  ],
} as const;
const FINGERS = [
  ["Thumb", ["Metacarpal", "Proximal", "Distal"], HAND.thumb],
  ["Index", ["Proximal", "Intermediate", "Distal"], HAND.index],
  ["Middle", ["Proximal", "Intermediate", "Distal"], HAND.middle],
  ["Ring", ["Proximal", "Intermediate", "Distal"], HAND.ring],
  ["Little", ["Proximal", "Intermediate", "Distal"], HAND.little],
] as const;

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3();
const _e = new THREE.Vector3(), _f = new THREE.Vector3(), _g = new THREE.Vector3(), _h = new THREE.Vector3();
const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4();
const _x0 = new THREE.Vector3(), _y0 = new THREE.Vector3(), _z0 = new THREE.Vector3();
const _x1 = new THREE.Vector3(), _y1 = new THREE.Vector3(), _z1 = new THREE.Vector3();

/**
 * El giro que lleva `a0` a `a` y `b0` a `b` (`a` exacto; `b`, lo que tiene de perpendicular a `a`).
 * Ninguno sale cambiado.
 */
export function turnOf(a0: THREE.Vector3, b0: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _x0.copy(a0).normalize();
  _y0.copy(b0).addScaledVector(_x0, -b0.dot(_x0)).normalize();
  _z0.crossVectors(_x0, _y0);
  _x1.copy(a).normalize();
  _y1.copy(b).addScaledVector(_x1, -b.dot(_x1));
  if (_y1.lengthSq() < 1e-10) _y1.copy(_y0);
  _y1.normalize();
  _z1.crossVectors(_x1, _y1);
  _m0.makeBasis(_x0, _y0, _z0).transpose();
  _m1.makeBasis(_x1, _y1, _z1).multiply(_m0);
  return out.setFromRotationMatrix(_m1);
}

/** Dónde está cada hueso en reposo (m, desde la raíz del humanoide), por nombre. */
function restPositions(bones: RestBone[]) {
  const at = new Map<string, THREE.Vector3>();
  const byName = new Map(bones.map((b) => [b.name, b]));
  const get = (n: string): THREE.Vector3 => {
    const hit = at.get(n);
    if (hit) return hit;
    const b = byName.get(n)!;
    const p = new THREE.Vector3(...b.offset);
    if (b.parent) p.add(get(b.parent));
    at.set(n, p);
    return p;
  };
  for (const b of bones) get(b.name);
  return at;
}

/** Suavizado gaussiano centrado (sin retraso) de una serie de vectores, con los huecos (null) rellenos de sus vecinos. */
function smoothSeries(series: (THREE.Vector3 | null)[], sigma: number): THREE.Vector3[] {
  const n = series.length;
  // Los huecos: del más cercano que haya (primero, hacia atrás; si no, hacia delante).
  const filled: THREE.Vector3[] = new Array(n);
  let last: THREE.Vector3 | null = null;
  for (let i = 0; i < n; i++) {
    if (series[i]) last = series[i]!;
    filled[i] = (last ?? new THREE.Vector3()).clone();
  }
  let next: THREE.Vector3 | null = null;
  for (let i = n - 1; i >= 0; i--) {
    if (series[i]) next = series[i]!;
    else if (!last && next) filled[i]!.copy(next);
  }
  if (sigma <= 0) return filled;
  const r = Math.ceil(sigma * 2.5);
  const w = Array.from({ length: r * 2 + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)));
  const out: THREE.Vector3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = new THREE.Vector3();
    let sum = 0;
    for (let k = -r; k <= r; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      s.addScaledVector(filled[j]!, w[k + r]!);
      sum += w[k + r]!;
    }
    out[i] = s.divideScalar(sum);
  }
  return out;
}

/** De los ejes de MediaPipe (x a la derecha de la imagen, y abajo, z hacia dentro) a los del modelo (x a su izquierda, y arriba, z delante). */
const toModel = (p: V3, mirror: boolean) => new THREE.Vector3(mirror ? -p[0] : p[0], -p[1], -p[2]);

/** El movimiento de `frames` en el humanoide de `bones`. */
export function retarget(frames: CaptureFrame[], bones: RestBone[], o: RetargetOptions): Motion {
  const from = o.from ?? -Infinity, to = o.to ?? Infinity;
  const use = frames.filter((f) => f.t >= from - 1e-6 && f.t <= to + 1e-6);
  const n = use.length;
  const mirror = !!o.mirror;
  const has = new Set(bones.map((b) => b.name));
  const byName = new Map(bones.map((b) => [b.name, b]));
  const restAt = restPositions(bones);
  const dirOf = (child: string) => new THREE.Vector3(...(byName.get(child)?.offset ?? [0, 0, 0])).normalize();

  // Los puntos de cada fotograma, en los ejes del modelo (en espejo: la izquierda de la persona pasa a
  // ser la derecha), suavizados en el tiempo.
  const swap = new Map<number, number>();
  for (const [a, b] of PAIRS) swap.set(a, b), swap.set(b, a);
  const posePts: THREE.Vector3[][] = [];
  for (let k = 0; k < 33; k++) {
    const src = mirror ? (swap.get(k) ?? k) : k;
    posePts.push(smoothSeries(use.map((f) => (f.pose ? toModel(f.pose[src]!, mirror) : null)), o.smooth ?? 1.2));
  }
  const handPts: THREE.Vector3[][][] = [0, 1].map((side) => {
    const src = mirror ? 1 - side : side;
    const pts: THREE.Vector3[][] = [];
    for (let k = 0; k < 21; k++)
      pts.push(
        smoothSeries(
          use.map((f) => {
            const h = f.hands.find((x) => x.side === src);
            return h ? toModel(h.world[k]!, mirror) : null;
          }),
          o.smooth ?? 1.2,
        ),
      );
    return pts;
  });
  const handSeen = [0, 1].map((side) => use.map((f) => f.hands.some((x) => x.side === (mirror ? 1 - side : side))));

  // De frente: lo que mira la cadera de media (su izquierda × arriba), y todo girado para que mire a +z.
  let sx = 0, sz = 0;
  for (let i = 0; i < n; i++) {
    _a.subVectors(posePts[LM.lHip]![i]!, posePts[LM.rHip]![i]!);
    _b.crossVectors(_a, Y);
    if (_b.lengthSq() > 1e-8) _b.normalize(), (sx += _b.x), (sz += _b.z);
  }
  const yaw = Math.atan2(sx, sz);
  const face = new THREE.Quaternion().setFromAxisAngle(Y, -yaw);
  for (const series of [...posePts, ...handPts.flat()]) for (const p of series) p.applyQuaternion(face);
  // Hacia la cámara, con la persona ya de frente.
  const camDir = new THREE.Vector3(0, 0, 1).applyQuaternion(face);

  // En reposo: hacia dónde va cada tramo y la bisagra de codos y rodillas (al doblarse, el antebrazo va
  // hacia delante y la pierna hacia atrás).
  const armRest = BONES_LIMBS.arm.map((l) => {
    const ax = dirOf(l.lower), fore = dirOf(l.hand);
    return { ax, fore, hinge: new THREE.Vector3().crossVectors(ax, Z).normalize() };
  });
  // La planta, en reposo: hacia la punta del pie, en horizontal (de pie, la planta va por el suelo; la
  // punta del pie queda más baja que el tobillo).
  const legRest = BONES_LIMBS.leg.map((l) => {
    const ax = dirOf(l.lower), toe = dirOf(l.toes);
    return { ax, shin: dirOf(l.foot), hinge: new THREE.Vector3().crossVectors(ax, Z).negate().normalize(), sole: toe.setY(0).normalize() };
  });
  // La mano en reposo: hacia dónde van los dedos (al medio) y hacia dónde mira la palma (de los nudillos
  // del meñique a los del índice, cruzado con los dedos). Sin dedos en el personaje, lo de VRM: la palma
  // hacia abajo y los dedos a lo largo del brazo.
  const handRest = [0, 1].map((side) => {
    const name = side ? "right" : "left";
    const fingers = byName.has(`${name}MiddleProximal`) ? dirOf(`${name}MiddleProximal`) : new THREE.Vector3(side ? -1 : 1, 0, 0);
    const across = new THREE.Vector3(...(byName.get(`${name}IndexProximal`)?.offset ?? [0, 0, 0.02])).sub(new THREE.Vector3(...(byName.get(`${name}LittleProximal`)?.offset ?? [0, 0, -0.02])));
    const normal = side ? new THREE.Vector3().crossVectors(across, fingers) : new THREE.Vector3().crossVectors(fingers, across);
    return { fingers, normal: normal.normalize() };
  });
  const prevHinge = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const hipsRest = restAt.get("hips") ?? new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), qi = new THREE.Quaternion();

  // La mano, de los puntos del cuerpo (la muñeca y los nudillos del índice y del meñique): siempre se
  // tienen, aunque dicen poco de cómo gira.
  const bodyHand = (side: number, i: number) => {
    const l = BONES_LIMBS.arm[side]!;
    const w = posePts[l.w]![i]!, a = posePts[l.index]![i]!, b = posePts[l.pinky]![i]!;
    return palmTurn(handRest[side]!, side, _c.copy(a).add(b).multiplyScalar(0.5).sub(w), _d.subVectors(a, b), new THREE.Quaternion());
  };
  // Las manos vistas: lo que corrige la mano de la captura a la del cuerpo y cómo van los dedos (cada
  // falange respecto a la anterior; la primera, respecto a la mano), en los fotogramas en que se ven. En
  // los demás, lo de los de al lado (entre dos, a medias) y, lejos de ellos, la mano del cuerpo y los
  // dedos relajados (`w`: cuánto vale lo de la captura).
  const hold = Math.max(1, Math.round(HAND_HOLD * o.fps));
  const relaxed = handTable("relaxed");
  const hands = [0, 1].map((side) => {
    const seen = handSeen[side]!, hp = handPts[side]!, hr = handRest[side]!;
    const name = side ? "right" : "left";
    const corr: (THREE.Quaternion | null)[] = new Array(n).fill(null);
    const fingers = new Map<string, (THREE.Quaternion | null)[]>();
    for (let i = 0; i < n; i++) {
      if (!seen[i]) continue;
      const capW = palmTurn(hr, side, _c.copy(hp[HAND.middle[0]]![i]!).sub(hp[HAND.wrist]![i]!), _d.subVectors(hp[HAND.index[0]]![i]!, hp[HAND.little[0]]![i]!), new THREE.Quaternion());
      // De canto a la cámara, hacia qué lado mira la palma casi no se ve (con un vídeo de verdad, la
      // mano de MediaPipe salía girada media vuelta en la mitad de los fotogramas): hacia dónde van los
      // dedos, de la captura; el giro sobre ellos, de la mano del cuerpo, tanto más cuanto más de canto.
      const bodyW = bodyHand(side, i);
      const fC = _e.copy(hr.fingers).applyQuaternion(capW).normalize();
      const nC = _f.copy(hr.normal).applyQuaternion(capW);
      const facing = THREE.MathUtils.clamp((Math.abs(nC.dot(camDir)) - EDGE_ON[0]) / (EDGE_ON[1] - EDGE_ON[0]), 0, 1);
      const nB = _g.copy(hr.normal).applyQuaternion(bodyW);
      nB.addScaledVector(fC, -nB.dot(fC));
      nC.addScaledVector(fC, -nC.dot(fC));
      let handW = capW;
      if (facing < 1 && nB.lengthSq() > 1e-8 && nC.lengthSq() > 1e-8) {
        nB.normalize();
        nC.normalize();
        const turn = Math.atan2(_h.crossVectors(nB, nC).dot(fC), nB.dot(nC));
        handW = turnOf(hr.fingers, hr.normal, fC, nB.applyAxisAngle(fC, turn * facing), new THREE.Quaternion());
      }
      corr[i] = bodyW.invert().multiply(handW);
      // Los dedos: cada falange, lo justo para ir hacia la siguiente desde la anterior (sin girar sobre
      // sí misma: un dedo no se retuerce; con la palma como eje de lado, en un puño las falanges van casi
      // a lo largo de ella y su giro salía de cualquier manera), desde la mano que queda.
      for (const [finger, parts, pts] of FINGERS) {
        const parentW = handW.clone();
        for (let j = 0; j < 3; j++) {
          const bone = `${name}${finger}${parts[j]}`;
          const rest = dirOf(j < 2 ? `${name}${finger}${parts[j + 1]}` : bone);
          if (!has.has(bone) || rest.lengthSq() < 1e-8) break;
          const seg = _c.subVectors(hp[pts[j + 1]!]![i]!, hp[pts[j]!]![i]!);
          if (seg.lengthSq() < 1e-12) break;
          seg.normalize().applyQuaternion(qi.copy(parentW).invert());
          const local = new THREE.Quaternion().setFromUnitVectors(rest, seg);
          let list = fingers.get(bone);
          if (!list) fingers.set(bone, (list = new Array(n).fill(null)));
          list[i] = local;
          parentW.multiply(local);
        }
      }
    }
    const ok = near(seen, hold);
    const w = smoothSeries(ok.map((x) => new THREE.Vector3(x ? 1 : 0, 0, 0)), Math.max(1, (FINGER_FADE * o.fps) / 2.5)).map((v) => v.x);
    return { corr, fingers, w, gap: gaps(seen) };
  });

  const out: Motion = { fps: o.fps, bones, frames: [] };
  const W = new Map<string, THREE.Quaternion>();
  const P = (k: number, i: number) => posePts[k]![i]!;

  for (let i = 0; i < n; i++) {
    W.clear();
    const rot: Record<string, Q4> = {};
    // Cómo está cada hueso en el mundo (los que aún no se han puesto, como en reposo respecto a su padre).
    const world = (name: string): THREE.Quaternion => {
      const hit = W.get(name);
      if (hit) return hit;
      const parent = byName.get(name)?.parent;
      const w = parent ? world(parent).clone() : new THREE.Quaternion();
      W.set(name, w);
      return w;
    };
    const setLocal = (name: string, local: THREE.Quaternion) => {
      if (!has.has(name)) return;
      const parent = byName.get(name)!.parent;
      W.set(name, (parent ? world(parent).clone() : new THREE.Quaternion()).multiply(local));
      rot[name] = [local.x, local.y, local.z, local.w];
    };
    const setWorld = (name: string, w: THREE.Quaternion) => {
      if (!has.has(name)) return;
      const parent = byName.get(name)!.parent;
      setLocal(name, qi.copy(parent ? world(parent) : q2.identity()).invert().multiply(w));
    };

    // El tronco: la cadera, de la línea de las caderas y de las caderas a los hombros; el pecho, de la
    // línea de los hombros (lo que gira de una a otra, repartido por la columna).
    const hipMid = _a.addVectors(P(LM.lHip, i), P(LM.rHip, i)).multiplyScalar(0.5).clone();
    const shoMid = _b.addVectors(P(LM.lSho, i), P(LM.rSho, i)).multiplyScalar(0.5).clone();
    const up = shoMid.clone().sub(hipMid);
    const pelvisW = turnOf(X, Y, _c.subVectors(P(LM.lHip, i), P(LM.rHip, i)), up, new THREE.Quaternion());
    const chestW = turnOf(X, Y, _d.subVectors(P(LM.lSho, i), P(LM.rSho, i)), up, new THREE.Quaternion());
    // Solo de cintura para arriba: la cadera, quieta (las piernas, las de quien lo hace: el reposo o
    // andar), y lo que va el pecho respecto a estar de frente y derecho (inclinarse también), en la columna.
    const hipsW = o.upper ? new THREE.Quaternion() : pelvisW;
    W.set("hips", hipsW);
    rot.hips = [hipsW.x, hipsW.y, hipsW.z, hipsW.w];
    const rel = hipsW.clone().invert().multiply(chestW);
    for (const [bone, part] of Object.entries(SPINE) as [keyof typeof SPINE, number][]) {
      if (!has.has(bone)) continue;
      // Lo que no tenga el personaje (sin upperChest, por ejemplo), al hueso de antes.
      const share = bone === "chest" && !has.has("upperChest") ? part + SPINE.upperChest : part;
      setLocal(bone, q.identity().slerp(rel, share));
    }
    const chestTop = has.has("upperChest") ? "upperChest" : has.has("chest") ? "chest" : "spine";

    // La cabeza: de oreja a oreja y de las orejas a los ojos (algo subido: con la cabeza recta, los ojos
    // quedan por encima de las orejas); lo que gira desde el pecho, entre el cuello y la cabeza.
    const earMid = _c.addVectors(P(LM.lEar, i), P(LM.rEar, i)).multiplyScalar(0.5).clone();
    const eyeMid = _d.addVectors(P(LM.lEye, i), P(LM.rEye, i)).multiplyScalar(0.5).clone();
    const earL = P(LM.lEar, i).clone().sub(P(LM.rEar, i)).normalize();
    const fwd = eyeMid.sub(earMid);
    fwd.addScaledVector(earL, -fwd.dot(earL)).normalize().applyAxisAngle(earL, HEAD_PITCH);
    const headW = turnOf(X, Z, earL, fwd, new THREE.Quaternion());
    const headRel = world(chestTop).clone().invert().multiply(headW);
    if (has.has("neck")) setLocal("neck", q.identity().slerp(headRel, NECK));
    setWorld("head", headW);

    // Los brazos: el brazo hacia el codo con su bisagra en el plano del brazo y el antebrazo; el antebrazo,
    // doblado en ella; la mano, de su palma (de los puntos de la mano o, si no se vio, de los del cuerpo),
    // con lo que gira sobre el antebrazo repartido; y los dedos, cada falange hacia la siguiente.
    BONES_LIMBS.arm.forEach((l, side) => {
      const r = armRest[side]!;
      if (!has.has(l.upper) || !has.has(l.lower) || !has.has(l.hand)) return;
      // La mano: la del cuerpo, con lo que la corrige la de la captura.
      const hk = hands[side]!;
      const handW = bodyHand(side, i);
      const fix = fill(hk.corr, hk.gap, i);
      if (fix) handW.multiply(fix.slerp(q2.identity(), 1 - hk.w[i]!));
      // El brazo; casi recto, doblaría hacia donde mira la mano (sin girar el antebrazo).
      const d1 = P(l.e, i).clone().sub(P(l.s, i)), d2 = P(l.w, i).clone().sub(P(l.e, i));
      const hinge = bend(d1, d2, prevHinge[side]!, _r.copy(r.hinge).applyQuaternion(handW));
      setWorld(l.upper, turnOf(r.ax, r.hinge, d1, hinge, q));
      const upperW = world(l.upper);
      setLocal(l.lower, q.setFromUnitVectors(r.fore, _c.copy(d2).normalize().applyQuaternion(qi.copy(upperW).invert())));
      // Lo que gira la mano sobre el antebrazo, una parte el antebrazo y el resto la muñeca. Contado
      // hacia la palma arriba (supinar) desde la palma abajo de la pose en T, entre −95° y 265°: un
      // antebrazo de verdad va de algo más allá de la palma abajo a algo más allá de arriba, así que
      // con la palma hacia arriba no salta de un lado al otro.
      const lowerW = world(l.lower);
      const local = lowerW.clone().invert().multiply(handW);
      const ax = r.fore;
      const sup = side ? 1 : -1;
      let turned = sup * twistAbout(local, ax);
      if (turned < TWIST_FROM) turned += Math.PI * 2;
      const tw = sup * turned * FOREARM_TWIST;
      const lowerLocal = new THREE.Quaternion(...(rot[l.lower] ?? [0, 0, 0, 1])).multiply(q2.setFromAxisAngle(ax, tw));
      setLocal(l.lower, lowerLocal);
      setWorld(l.hand, handW);
      // Los dedos: los de la captura (cada falange hacia la siguiente) o, si no se ven, relajados.
      const name = side ? "right" : "left";
      for (const [finger, parts] of FINGERS)
        for (const part of parts) {
          const bone = `${name}${finger}${part}`;
          if (!has.has(bone)) continue;
          const local = (relaxed.get(bone) ?? q2.identity()).clone();
          const cap = hk.fingers.get(bone);
          const got = cap ? fill(cap, hk.gap, i) : null;
          if (got) local.slerp(got, hk.w[i]!);
          setLocal(bone, local);
        }
    });

    // Las piernas (como los brazos, con la rodilla hacia delante) y el pie, de la planta (del talón a la
    // punta), con su eje de lado el de la rodilla.
    BONES_LIMBS.leg.forEach((l, side) => {
      if (o.upper) return;
      const r = legRest[side]!;
      // Casi recta, la rodilla hacia donde apunta el pie.
      const sole = P(l.tip, i).clone().sub(P(l.heel, i));
      const d1 = P(l.k, i).clone().sub(P(l.h, i)), d2 = P(l.a, i).clone().sub(P(l.k, i));
      const hinge = bend(d1, d2, prevHinge[2 + side]!, _r.crossVectors(sole.lengthSq() > 1e-8 ? sole : Z, d1));
      setWorld(l.upper, turnOf(r.ax, r.hinge, d1, hinge, q));
      setLocal(l.lower, q.setFromUnitVectors(r.shin, _c.copy(d2).normalize().applyQuaternion(qi.copy(world(l.upper)).invert())));
      if (r.sole.lengthSq() > 1e-8 && sole.lengthSq() > 1e-8) setWorld(l.foot, turnOf(r.sole, r.hinge, sole, hinge, q));
    });

    // Lo que no se ha movido (las clavículas, los dedos de los pies, los ojos…), en reposo.
    for (const b of bones) rot[b.name] ??= [0, 0, 0, 1];
    out.frames.push({ t: use[i]!.t - (use[0]?.t ?? 0), hips: [hipsRest.x, hipsRest.y, hipsRest.z], rot });
  }

  if (o.ground && !o.upper) ground(out, restAt);
  if (o.loop) loopBlend(out);
  return out;
}

/**
 * La bisagra de un brazo o una pierna (unitaria): la del plano que forman sus dos tramos. Casi rectos,
 * ese plano no se ve (lo que se doblan es poco más que el temblor de los puntos): la que dice `ref`
 * (por dónde doblaría sin girar sobre sí mismo: el brazo, hacia donde mira su mano; la pierna, hacia
 * donde apunta su pie), girada hacia la medida según lo que se doble. Y doblado poco hacia el otro
 * lado del fotograma anterior, pasado de recto (no el brazo entero girado media vuelta de golpe).
 */
function bend(d1: THREE.Vector3, d2: THREE.Vector3, prev: THREE.Vector3, ref: THREE.Vector3): THREE.Vector3 {
  const axis = _a.copy(d1).normalize();
  const h = new THREE.Vector3().crossVectors(d1, d2);
  const s = h.length() / Math.max(1e-9, d1.length() * d2.length());
  if (prev.lengthSq() > 0.5 && s > STRAIGHT && s < FLIP && h.dot(prev) < 0) h.negate();
  let out: THREE.Vector3;
  if (s >= STRAIGHT) out = h.normalize();
  else {
    out = ref.clone().addScaledVector(axis, -ref.dot(axis));
    if (out.lengthSq() < 1e-8) out.copy(prev.lengthSq() > 0.5 ? prev : _b.set(axis.y, -axis.x, 0).lengthSq() > 1e-6 ? _b : X).addScaledVector(axis, -out.dot(axis));
    out.normalize();
    if (s > 1e-6) {
      h.normalize();
      const angle = Math.atan2(_b.crossVectors(out, h).dot(axis), out.dot(h));
      out.applyAxisAngle(axis, angle * (s / STRAIGHT));
    }
  }
  prev.copy(out);
  return out;
}

/** Lo que gira `q` alrededor de `axis` (unitario): su parte de giro sobre ese eje (rad, de −π a π). */
export function twistAbout(q: THREE.Quaternion, axis: THREE.Vector3): number {
  const w = q.w < 0 ? -q.w : q.w, s = (q.w < 0 ? -1 : 1) * (q.x * axis.x + q.y * axis.y + q.z * axis.z);
  return 2 * Math.atan2(s, w);
}

/** Por fotograma: ¿hay uno con la mano vista a `hold` fotogramas o menos? */
function near(seen: boolean[], hold: number): boolean[] {
  const n = seen.length;
  const dist = new Array<number>(n).fill(Infinity);
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    if (seen[i]) last = i;
    dist[i] = i - last;
  }
  last = Infinity;
  for (let i = n - 1; i >= 0; i--) {
    if (seen[i]) last = i;
    dist[i] = Math.min(dist[i]!, last - i);
  }
  return dist.map((d) => d <= hold);
}

/**
 * El giro de la mano (en el mundo) que lleva sus dedos y su palma de reposo a los de ahora: `fingers`,
 * de la muñeca hacia los dedos; `across`, de los nudillos del meñique a los del índice.
 */
function palmTurn(rest: { fingers: THREE.Vector3; normal: THREE.Vector3 }, side: number, fingers: THREE.Vector3, across: THREE.Vector3, out: THREE.Quaternion) {
  const normal = side ? _n.crossVectors(across, fingers) : _n.crossVectors(fingers, across);
  return turnOf(rest.fingers, rest.normal, fingers, normal, out);
}
const _n = new THREE.Vector3();

/** Por fotograma, el anterior y el siguiente en que se vio la mano (−1 si no hay). */
function gaps(seen: boolean[]) {
  const n = seen.length;
  const prev = new Int32Array(n), next = new Int32Array(n);
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (seen[i]) last = i;
    prev[i] = last;
  }
  last = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (seen[i]) last = i;
    next[i] = last;
  }
  return { prev, next };
}

/** Lo de un fotograma sin ver la mano: entre el anterior y el siguiente que la vieron (o el que haya). Nuevo. */
function fill(list: (THREE.Quaternion | null)[], gap: { prev: Int32Array; next: Int32Array }, i: number): THREE.Quaternion | null {
  const a = gap.prev[i]!, b = gap.next[i]!;
  const qa = a >= 0 ? list[a] : null, qb = b >= 0 ? list[b] : null;
  if (qa && qb) return a === b ? qa.clone() : qa.clone().slerp(qb, (i - a) / (b - a));
  return (qa ?? qb)?.clone() ?? null;
}

/**
 * La cadera a la altura en que el pie más bajo (el tobillo o la punta) queda donde queda de pie, en
 * reposo; suavizada.
 */
function ground(m: Motion, restAt: Map<string, THREE.Vector3>) {
  const byName = new Map(m.bones.map((b) => [b.name, b]));
  const feet = ["leftFoot", "leftToes", "rightFoot", "rightToes"].filter((n) => byName.has(n));
  if (!feet.length) return;
  const restLow = Math.min(...feet.map((f) => restAt.get(f)!.y));
  const heights: number[] = [];
  const W = new Map<string, THREE.Quaternion>(), at = new Map<string, THREE.Vector3>();
  for (const fr of m.frames) {
    W.clear();
    at.clear();
    const walk = (name: string): { q: THREE.Quaternion; p: THREE.Vector3 } => {
      const b = byName.get(name)!;
      if (!b.parent) {
        const q = new THREE.Quaternion(...fr.rot[name]!);
        W.set(name, q);
        at.set(name, new THREE.Vector3());
        return { q, p: at.get(name)! };
      }
      const parent = W.has(b.parent) ? { q: W.get(b.parent)!, p: at.get(b.parent)! } : walk(b.parent);
      const local = fr.rot[name] ? new THREE.Quaternion(...fr.rot[name]!) : new THREE.Quaternion();
      const q = parent.q.clone().multiply(local);
      const p = new THREE.Vector3(...b.offset).applyQuaternion(parent.q).add(parent.p);
      W.set(name, q);
      at.set(name, p);
      return { q, p };
    };
    // Lo más bajo de los pies, respecto a la cadera: la cadera, a la altura que lo deja donde queda de pie.
    let low = Infinity;
    for (const f of feet) low = Math.min(low, walk(f).p.y);
    heights.push(restLow - low);
  }
  const smooth = smoothSeries(heights.map((h) => new THREE.Vector3(0, h, 0)), 2);
  m.frames.forEach((fr, i) => (fr.hips = [fr.hips[0], smooth[i]!.y, fr.hips[2]]));
}

/** En bucle: los últimos `LOOP_S` s van hacia la pose del primer fotograma. */
function loopBlend(m: Motion) {
  const n = m.frames.length;
  const k = Math.min(n - 1, Math.round(LOOP_S * m.fps));
  if (k < 2) return;
  const first = m.frames[0]!;
  const a = new THREE.Quaternion(), b = new THREE.Quaternion();
  for (let j = 0; j < k; j++) {
    const fr = m.frames[n - k + j]!;
    const w = (j + 1) / k, s = w * w * (3 - 2 * w);
    for (const [name, r] of Object.entries(fr.rot)) {
      const f = first.rot[name];
      if (!f) continue;
      a.set(...r).slerp(b.set(...f), s);
      fr.rot[name] = [a.x, a.y, a.z, a.w];
    }
    fr.hips = [fr.hips[0] + (first.hips[0] - fr.hips[0]) * s, fr.hips[1] + (first.hips[1] - fr.hips[1]) * s, fr.hips[2] + (first.hips[2] - fr.hips[2]) * s];
  }
}
