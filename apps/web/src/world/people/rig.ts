/**
 * El esqueleto de cada persona después de sus animaciones (world/animation.ts): lo que no sale de
 * un clip, sobre los huesos normalizados del VRM (los copia a los de verdad `vrm.update`).
 *
 *   - Encajar golpes: dos muelles amortiguados (tronco y cabeza) que reciben el impulso del golpe en
 *     su dirección (de frente, por la espalda o de lado) y vuelven solos, con su pequeño rebote.
 *   - Mirar a alguien: cuello y cabeza hacia un punto, con límites.
 *   - Llegar con la mano a un sitio (IK de dos huesos): chocar los cinco, darse la mano, abrazar.
 *   - Abrazar con el cuerpo (pair.ts → `hug`): la cadera hacia la pareja con los pies quietos, la
 *     columna inclinada o doblada para que las cabezas pasen una junto a la otra.
 *   - Juntar las palmas (aplaudir): el gesto dice cuándo se tocan (`touch`) y aquí se juntan a la
 *     medida de cada avatar (lo ancho de hombros frente a lo largo de brazos cambia de uno a otro:
 *     con la misma pose, a unos les quedaba un hueco y a otros se les atravesaban las manos).
 *   - Caer con física (people/ragdoll.ts): el cuerpo articulado manda sobre los huesos mientras
 *     cae y está en el suelo; al levantarse se funde con la animación desde la pose en que quedó.
 *
 * Sin objetos nuevos por frame.
 */
import * as THREE from "three";
import { VRMHumanBoneParentMap, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import { ALL_FINGER_BONES, handTable, type BaseHand } from "./hands";
import { PHONE_HOLD } from "./phone";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";
import type { Q4, RagdollHandle, RagdollJoint, RagdollPart, RagdollSpec, RagdollWorldApi, V3 } from "./ragdoll";

export interface Target {
  x: number;
  y: number;
  z: number;
  /** Peso pedido (0–1); el esqueleto llega a él con suavidad. */
  w: number;
  /**
   * Para una mano o un pie: hacia dónde va el codo o la rodilla (mundo). Sin esto (los tres a 0),
   * hacia donde ya iba en su pose; pero si lo pedido queda lejos de esa pose, eso deja de decir nada.
   */
  px: number;
  py: number;
  pz: number;
  /**
   * Solo para una mano, y se piden en cada frame (el esqueleto los vuelve a 0 al usarlos: quien use
   * la mano para otra cosa no los hereda). `palm`: el punto es donde va el centro de la palma, no la
   * muñeca (para que dos palmas se toquen). `nx, ny, nz` y `ux, uy, uz`: hacia dónde mira la palma y
   * hacia dónde apuntan los dedos (mundo); sin ellos (a 0), la mano girada como la puso la animación.
   * `shape`: cómo se doblan los dedos (people/hands.ts: agarrada a un canto, apoyada…); sin ella, como
   * los puso la animación.
   */
  palm: number;
  shape: BaseHand | null;
  nx: number;
  ny: number;
  nz: number;
  ux: number;
  uy: number;
  uz: number;
}

/** Lo que mide un cuerpo (m, a su escala de verdad): para que las parejas se encuentren (pair.ts). */
export interface BodySize {
  /**
   * Altura de los hombros (de pie, con los brazos abajo: la clavícula los baja un 6,5 % de lo que miden
   * en la pose en T, medido en los avatares de serie con los gestos de pareja) y de la cabeza (desde los
   * pies).
   */
  shoulder: number;
  head: number;
  /**
   * Del hombro a la muñeca, medio ancho de hombros, la mano (de la muñeca a los nudillos) y, con los
   * dedos rectos, del centro de la palma a la segunda articulación del dedo que la tenga más cerca (para
   * agarrarse a un canto: parkour/ledge.ts).
   */
  arm: number;
  width: number;
  hand: number;
  grip: number;
  /**
   * El tronco por fuera, con la ropa (de su malla, en reposo; desde los pies): hasta dónde llega el
   * pecho por delante y la espalda por detrás, a la altura del pecho y de la cintura, y su medio ancho
   * a la altura del pecho.
   */
  front: number;
  back: number;
  waist: number;
  side: number;
}
/** El tronco por fuera a una altura (m, desde su hueso): hasta dónde llega por delante, por detrás y a cada lado. */
export interface TorsoBand {
  front: number;
  back: number;
  side: number;
}
/** Un cuerpo cualquiera, para quien aún no ha cargado su avatar. */
export const BODY: BodySize = { shoulder: 1.33, head: 1.62, arm: 0.5, width: 0.18, hand: 0.09, grip: 0.06, front: 0.14, back: 0.12, waist: 0.11, side: 0.16 };
/** Lo que baja el hombro de la pose en T a de pie (ver `BodySize.shoulder`). */
const SHOULDER_DOWN = 0.935;
/**
 * La oreja, por encima del hueso de la cabeza (m, en un cuerpo de 1,62 m de la cabeza al suelo); y con
 * el teléfono, el centro de la palma: por fuera de la oreja (lo que miden el teléfono y la palma,
 * people/phone.ts), más abajo y delante (m), y los dedos, algo hacia atrás.
 */
const EAR_UP = 0.06;
const PHONE_OUT = PHONE_HOLD;
const PHONE_DOWN = 0.05;
const PHONE_FWD = 0.015;
const PHONE_BACK = 0.4;

/**
 * Lo que el abrazo le pide al cuerpo además de los brazos (pair.ts, en cada frame; el esqueleto gasta
 * `on` y `w` al usarlos, así que deja de pesar en cuanto nadie lo pide).
 */
export interface Embrace {
  /** Abrazando (aunque aún no pese): mide su tronco y su cabeza para su pareja (`Rig.frontHigh`…). */
  on: boolean;
  /** Peso (0–1). */
  w: number;
  /** Lo que se mueve la cadera (mundo, m), sin mover los pies: hacia su pareja y a un lado. */
  x: number;
  y: number;
  z: number;
  /** Lo que se aparta la cabeza (mundo, m) de la de su pareja. */
  hx: number;
  hz: number;
  /** Lo que se inclina hacia delante (rad, en la cintura y el pecho), alrededor de su izquierda (mundo: lx, lz). */
  lean: number;
  lx: number;
  lz: number;
  /**
   * Dónde quedaron las manos en la espalda de la otra persona (pair.ts; NaN, aún no): cuánto por encima
   * de su cintura (m) y cuánto la rodean (rad), la de arriba (`hr`, `ha`) y la de abajo (`lr`, `la`).
   * Abrazados, se quedan ahí: si no, al mecerse resbalaban por su espalda.
   */
  hr: number;
  ha: number;
  lr: number;
  la: number;
}

/** Lo que la gente le pide al esqueleto de una persona (vive en su `Motion`). */
export interface PersonFx {
  /** El esqueleto, cuando su avatar VRM está cargado (con el muñeco de respaldo, null). */
  rig: Rig | null;
  look: Target;
  reachL: Target;
  reachR: Target;
  hug: Embrace;
  /**
   * Dónde tiene que quedar su cadera (mundo): sentado en un asiento que no se mueve con él (el del
   * coche). Mida lo que mida el avatar y venga de la pose que venga, la cadera cae ahí.
   */
  seat: Target;
  /** Dónde van sus tobillos (mundo), con la rodilla hacia donde ya iba: los pies en los pedales. */
  footL: Target;
  footR: Target;
}
const target = (): Target => ({ x: 0, y: 0, z: 0, w: 0, px: 0, py: 0, pz: 0, palm: 0, shape: null, nx: 0, ny: 0, nz: 0, ux: 0, uy: 0, uz: 0 });
export const createFx = (): PersonFx => ({
  rig: null,
  look: target(),
  reachL: target(),
  reachR: target(),
  hug: { on: false, w: 0, x: 0, y: 0, z: 0, hx: 0, hz: 0, lean: 0, lx: 0, lz: 0, hr: NaN, ha: NaN, lr: NaN, la: NaN },
  seat: target(),
  footL: target(),
  footR: target(),
});

const DEG = Math.PI / 180;

/** Los sólidos del cuerpo que cae, en orden (cada uno después de su padre). */
export const PART = {
  hips: 0,
  abdomen: 1,
  thorax: 2,
  head: 3,
  lUpperArm: 4,
  lLowerArm: 5,
  rUpperArm: 6,
  rLowerArm: 7,
  lUpperLeg: 8,
  lLowerLeg: 9,
  rUpperLeg: 10,
  rLowerLeg: 11,
} as const;
const PARENT = [-1, 0, 1, 2, 2, 4, 2, 6, 0, 8, 0, 10];

const deg = (v: V3): V3 => [v[0] * DEG, v[1] * DEG, v[2] * DEG];
/**
 * Recorrido de cada articulación (grados en el marco del hueso padre: x > 0 se dobla hacia delante,
 * y gira a su izquierda, z se inclina a su derecha; en el brazo izquierdo, z < 0 lo baja e y < 0 lo
 * lleva delante, en el derecho al revés; en la pierna, x < 0 la lleva delante). Codos y rodillas,
 * bisagras: en el codo izquierdo el ángulo es negativo, en el derecho y en las rodillas, positivo.
 */
export const JOINT_LIMITS: [number, Partial<RagdollJoint>][] = [
  [PART.abdomen, { min: deg([-25, -30, -20]), max: deg([35, 30, 20]) }],
  [PART.thorax, { min: deg([-25, -30, -20]), max: deg([35, 30, 20]) }],
  [PART.head, { min: deg([-45, -70, -35]), max: deg([55, 70, 35]) }],
  [PART.lUpperArm, { min: deg([-80, -110, -100]), max: deg([80, 45, 45]) }],
  [PART.lLowerArm, { hinge: [0, 1, 0], range: [-150 * DEG, 3 * DEG] }],
  [PART.rUpperArm, { min: deg([-80, -45, -45]), max: deg([80, 110, 100]) }],
  [PART.rLowerArm, { hinge: [0, 1, 0], range: [-3 * DEG, 150 * DEG] }],
  [PART.lUpperLeg, { min: deg([-115, -35, -15]), max: deg([30, 35, 60]) }],
  [PART.lLowerLeg, { hinge: [1, 0, 0], range: [-3 * DEG, 150 * DEG] }],
  [PART.rUpperLeg, { min: deg([-115, -35, -60]), max: deg([30, 35, 15]) }],
  [PART.rLowerLeg, { hinge: [1, 0, 0], range: [-3 * DEG, 150 * DEG] }],
];

/** Cómo cae: impulsos (N·s) sobre sólidos y el tono con que empieza y se suelta. */
export interface FallSpec {
  vel: V3;
  impulses: { part: number; vec: V3; top?: boolean }[];
  tone: number;
  toneMin: number;
  toneTau: number;
  bounce: number;
}

/** Cómo quedó en el suelo. */
export interface Lying {
  /** Cadera (mundo). */
  x: number;
  y: number;
  z: number;
  /** Hacia dónde queda la cabeza (horizontal, unitario). */
  hx: number;
  hz: number;
  /** Hacia dónde mira el pecho en vertical: > 0 boca arriba, < 0 boca abajo. */
  face: number;
}

const BLEND_UP = 0.5;
/** Muelles de los golpes: rigidez y amortiguación (algo menos que crítica: un pequeño rebote). */
const SPRING_K = 150;
const SPRING_C = 2 * 0.5 * Math.sqrt(SPRING_K);

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _eu = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

interface Spring {
  p: number;
  r: number;
  y: number;
  vp: number;
  vr: number;
  vy: number;
}
const spring = (): Spring => ({ p: 0, r: 0, y: 0, vp: 0, vr: 0, vy: 0 });
function stepSpring(s: Spring, dt: number) {
  for (const [k, v] of [["p", "vp"], ["r", "vr"], ["y", "vy"]] as const) {
    const a = -SPRING_K * s[k] - SPRING_C * s[v];
    s[v] += a * dt;
    s[k] += s[v] * dt;
  }
}

type Bone = VRMHumanBoneName;
const PART_BONES: (Bone | "thorax")[] = [
  "hips",
  "spine",
  "thorax",
  "head",
  "leftUpperArm",
  "leftLowerArm",
  "rightUpperArm",
  "rightLowerArm",
  "leftUpperLeg",
  "leftLowerLeg",
  "rightUpperLeg",
  "rightLowerLeg",
];

export class Rig {
  private nodes = new Map<string, THREE.Object3D>();
  private parts: THREE.Object3D[] = [];
  private body = spring();
  private headS = spring();
  private lookW = 0;
  private reachW = [0, 0];
  /** El cuerpo que cae (mientras manda la física) y lo que hay que fijar mientras tanto. */
  private doll: RagdollHandle | null = null;
  private frozen: { node: THREE.Object3D; q: THREE.Quaternion }[] = [];
  /** Giro de los huesos fijos entre cada sólido y su padre (para pasar del sólido al hueso). */
  private frames: THREE.Quaternion[] = [];
  /** Al levantarse: la pose en que quedó y cuánto lleva fundiéndose con la animación. */
  private snap = new Map<THREE.Object3D, THREE.Quaternion>();
  private snapHipsPos = new THREE.Vector3();
  private snapHipsQ = new THREE.Quaternion();
  private blend = -1;
  /** Dónde empieza «levantarse» (z de la cadera, en metros de este avatar), cuando ha cargado. */
  private standZ: number | null = null;

  constructor(
    private vrm: VRM,
    private standClip: () => Promise<VRMAnimation | null>,
  ) {
    const h = vrm.humanoid;
    for (const name of Object.keys(h.humanBones)) {
      const n = h.getNormalizedBoneNode(name as Bone);
      if (n) this.nodes.set(name, n);
    }
    const thorax = this.nodes.get("upperChest") ?? this.nodes.get("chest");
    for (const name of PART_BONES) {
      const n = name === "thorax" ? thorax : this.nodes.get(name);
      if (n) this.parts.push(n);
    }
    // Lo que mide sentado: de la cadera a la coronilla (en reposo; el cráneo, en proporción).
    const hips = this.nodes.get("hips"), head = this.nodes.get("head");
    if (hips && head) {
      hips.updateWorldMatrix(true, false);
      head.updateWorldMatrix(true, false);
      const up = head.getWorldPosition(_a).y - hips.getWorldPosition(_b).y;
      if (up > 0.3 && up < 1.2) this.sitHeight = up * 1.27;
    }
  }

  /** De la cadera a la coronilla (m): para saber cuánto hay que recostarlo en un asiento bajo. */
  sitHeight = 0.82;

  private n(name: Bone) {
    return this.nodes.get(name) ?? null;
  }

  /** ¿Tiene todos los huesos que hacen falta para caer con física? */
  get canFall() {
    return this.parts.length === PART_BONES.length;
  }

  /* ---------------------------------------------------------------- */
  /* Golpes                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Un golpe: `dx, dz` hacia dónde empuja (mundo, horizontal), `power` de 0 a 1, en la cabeza o en el
   * cuerpo, y `twist` (rad/s) si además gira (un gancho).
   */
  flinch(dx: number, dz: number, power: number, head: boolean, twist = 0) {
    const root = this.vrm.scene;
    root.getWorldQuaternion(_q);
    // El VRM mira a +Z y su derecha es −X.
    _a.copy(Z).applyQuaternion(_q);
    _b.set(-1, 0, 0).applyQuaternion(_q);
    const back = -(dx * _a.x + dz * _a.z);
    const right = dx * _b.x + dz * _b.z;
    const k = 0.4 + power;
    this.body.vp += back * 5.5 * k * (head ? 0.5 : 1);
    this.body.vr += right * 4.5 * k * (head ? 0.5 : 1);
    this.body.vy += twist * 0.4;
    this.headS.vp += back * 9 * k * (head ? 1 : 0.4);
    this.headS.vr += right * 8 * k * (head ? 1 : 0.4);
    this.headS.vy += twist;
  }

  /* ---------------------------------------------------------------- */
  /* Caídas                                                             */
  /* ---------------------------------------------------------------- */

  get falling() {
    return !!this.doll;
  }

  /** Empieza a caer con física desde la pose de ahora. Devuelve false si no se puede (sin sitio o sin huesos). */
  startFall(sim: RagdollWorldApi, f: FallSpec): boolean {
    if (this.doll || !this.canFall) return false;
    void this.standClip().then((a) => {
      if (!a || this.standZ !== null) return;
      const tr = a.humanoidTracks.translation.get("hips") as THREE.VectorKeyframeTrack | undefined;
      const restY = this.vrm.humanoid.normalizedRestPose.hips?.position?.[1] ?? a.restHipsPosition.y;
      if (tr) this.standZ = tr.values[2]! * (restY / (a.restHipsPosition.y || restY || 1));
    });
    const root = this.vrm.scene;
    root.updateWorldMatrix(true, true);
    const P = this.parts;
    const pos = P.map((n) => n.getWorldPosition(new THREE.Vector3()));
    const quat = P.map((n) => n.getWorldQuaternion(new THREE.Quaternion()));
    const at = (name: Bone, fallback: THREE.Vector3) => this.n(name)?.getWorldPosition(new THREE.Vector3()) ?? fallback.clone();
    // Escala del cuerpo (pierna de 0,8 m en el de referencia).
    const legLen = pos[PART.lUpperLeg]!.distanceTo(pos[PART.lLowerLeg]!) + pos[PART.lLowerLeg]!.distanceTo(at("leftFoot", pos[PART.lLowerLeg]!));
    const s = THREE.MathUtils.clamp(legLen / 0.8, 0.6, 1.4);
    const local = (i: number, w: THREE.Vector3): V3 => {
      _v.copy(w).sub(pos[i]!).applyQuaternion(_q.copy(quat[i]!).invert());
      return [_v.x, _v.y, _v.z];
    };
    const neck = at("neck", pos[PART.head]!);
    const headTop = pos[PART.head]!.clone().add(_w.copy(Y).applyQuaternion(quat[PART.head]!).multiplyScalar(0.2 * s));
    const handL = at("leftHand", pos[PART.lLowerArm]!), handR = at("rightHand", pos[PART.rLowerArm]!);
    const reachOut = (elbow: THREE.Vector3, hand: THREE.Vector3) => hand.clone().add(_w.copy(hand).sub(elbow).normalize().multiplyScalar(0.07 * s));
    const footL = at("leftFoot", pos[PART.lLowerLeg]!), footR = at("rightFoot", pos[PART.rLowerLeg]!);
    const toes = (foot: THREE.Vector3, name: Bone, side: number) => {
      const t = this.n(name)?.getWorldPosition(new THREE.Vector3());
      return t ?? foot.clone().add(_w.copy(Z).applyQuaternion(quat[side]!).multiplyScalar(0.12 * s));
    };
    const caps: [V3, V3, number, number][] = [
      [local(0, pos[PART.lUpperLeg]!), local(0, pos[PART.rUpperLeg]!), 0.105, 900],
      [local(1, pos[1]!), local(1, pos[PART.thorax]!), 0.11, 900],
      [local(2, pos[2]!), local(2, neck), 0.125, 900],
      [local(3, pos[3]!), local(3, headTop), 0.1, 1000],
      [local(4, pos[4]!), local(4, pos[5]!), 0.048, 1000],
      [local(5, pos[5]!), local(5, reachOut(pos[5]!, handL)), 0.04, 1000],
      [local(6, pos[6]!), local(6, pos[7]!), 0.048, 1000],
      [local(7, pos[7]!), local(7, reachOut(pos[7]!, handR)), 0.04, 1000],
      [local(8, pos[8]!), local(8, pos[9]!), 0.072, 1000],
      [local(9, pos[9]!), local(9, footL), 0.052, 1000],
      [local(10, pos[10]!), local(10, pos[11]!), 0.072, 1000],
      [local(11, pos[11]!), local(11, footR), 0.052, 1000],
    ];
    const parts: RagdollPart[] = caps.map(([a, b, r, density], i) => ({
      pos: [pos[i]!.x, pos[i]!.y, pos[i]!.z],
      quat: [quat[i]!.x, quat[i]!.y, quat[i]!.z, quat[i]!.w],
      a,
      b,
      r: r * s,
      density,
      ...(i === PART.lLowerLeg ? { extra: { at: local(i, toes(footL, "leftToes", i)), r: 0.045 * s } } : {}),
      ...(i === PART.rLowerLeg ? { extra: { at: local(i, toes(footR, "rightToes", i)), r: 0.045 * s } } : {}),
    }));

    // Lo que hay entre cada sólido y su padre (clavícula, cuello, pecho…) se queda como está.
    const partSet = new Set(P);
    let broken = false;
    this.frames = P.map((node, i) => {
      const f = new THREE.Quaternion();
      if (i === 0) return f;
      const chain: THREE.Object3D[] = [];
      let o = node.parent;
      while (o && o !== P[PARENT[i]!]) {
        chain.unshift(o);
        o = o.parent;
      }
      if (!o) broken = true;
      for (const c of chain) f.multiply(c.quaternion);
      return f;
    });
    // Un esqueleto con los huesos en otro orden no puede caer con física (cae con la animación).
    if (broken) return false;
    this.frozen = [];
    for (const node of this.nodes.values()) if (!partSet.has(node)) this.frozen.push({ node, q: node.quaternion.clone() });

    const q4 = (x: THREE.Quaternion): Q4 => [x.x, x.y, x.z, x.w];
    const rel = (i: number) => _q2.copy(quat[PARENT[i]!]!).multiply(this.frames[i]!).invert().multiply(quat[i]!);
    const joint = (child: number, extra: Partial<RagdollJoint>): RagdollJoint => ({
      child,
      parent: PARENT[child]!,
      anchor: [pos[child]!.x, pos[child]!.y, pos[child]!.z],
      frame: q4(this.frames[child]!),
      target: q4(rel(child)),
      ...extra,
    });
    const joints: RagdollJoint[] = JOINT_LIMITS.map(([child, l]) => joint(child, l));
    const spec: RagdollSpec = {
      parts,
      joints,
      vel: f.vel,
      impulses: f.impulses.map((im) => {
        const p = im.top && im.part === PART.head ? headTop : pos[im.part]!;
        // En el centro de su cápsula (o arriba, en la cabeza).
        const c = parts[im.part]!;
        _v.set((c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2, (c.a[2] + c.b[2]) / 2).applyQuaternion(quat[im.part]!).add(pos[im.part]!);
        const point = im.top ? p : _v;
        return { part: im.part, point: [point.x, point.y, point.z] as V3, vec: im.vec };
      }),
      tone: f.tone,
      toneMin: f.toneMin,
      toneTau: f.toneTau,
      bounce: f.bounce,
      friction: 1,
    };
    this.doll = sim.spawn(spec);
    this.blend = -1;
    return !!this.doll;
  }

  /** Cómo está en el suelo ahora (si cae). */
  lying(out: Lying): Lying | null {
    const d = this.doll;
    if (!d) return null;
    out.x = d.pos[0]!;
    out.y = d.pos[1]!;
    out.z = d.pos[2]!;
    let hx = d.pos[PART.head * 3]! - out.x, hz = d.pos[PART.head * 3 + 2]! - out.z;
    const l = Math.hypot(hx, hz) || 1;
    out.hx = hx / l;
    out.hz = hz / l;
    // El pecho mira hacia su +Z.
    _q.set(d.quat[PART.thorax * 4]!, d.quat[PART.thorax * 4 + 1]!, d.quat[PART.thorax * 4 + 2]!, d.quat[PART.thorax * 4 + 3]!);
    out.face = _v.copy(Z).applyQuaternion(_q).y;
    return out;
  }

  /** ¿Se mueve aún? */
  get fallSpeed() {
    return this.doll ? this.doll.speed : 0;
  }
  get fallStill() {
    return this.doll ? this.doll.still : 0;
  }
  get fallAge() {
    return this.doll ? this.doll.age : 0;
  }

  /** Ayuda a darse la vuelta si cayó boca abajo (dir 1 o −1; 0 para parar). */
  rollOver(dir: number) {
    this.doll?.roll(dir);
  }

  /**
   * Deja la física y empieza a fundirse con la animación de levantarse. Devuelve dónde poner al
   * personaje (sus pies) y hacia dónde girarlo para que «levantarse» empiece en la pose en que quedó.
   */
  endFall(out: { x: number; z: number; yaw: number }): boolean {
    const d = this.doll;
    if (!d) return false;
    const l = this.lying(_lying)!;
    this.capture();
    d.remove();
    this.doll = null;
    // «Levantarse» empieza boca arriba con la cabeza hacia su −Z (mundo: +Z del grupo, girado π).
    out.yaw = Math.atan2(l.hx, l.hz);
    const back = -(this.standZ ?? -0.19);
    out.x = l.x - l.hx * back;
    out.z = l.z - l.hz * back;
    this.blend = 0;
    return true;
  }

  /** Deja la física sin más (al cambiar de lugar, al desaparecer). */
  cancelFall() {
    this.doll?.remove();
    this.doll = null;
    this.blend = -1;
  }

  /** Guarda la pose de ahora (para fundirla con la animación al levantarse). */
  private capture() {
    for (const node of this.nodes.values()) {
      const q = this.snap.get(node);
      if (q) q.copy(node.quaternion);
      else this.snap.set(node, node.quaternion.clone());
    }
    const hips = this.parts[0]!;
    hips.updateWorldMatrix(true, false);
    hips.getWorldPosition(this.snapHipsPos);
    hips.getWorldQuaternion(this.snapHipsQ);
  }

  /** Pone en los huesos lo que dice la física. */
  private applyDoll(d: RagdollHandle) {
    const P = this.parts;
    const hips = P[0]!;
    const root = hips.parent!;
    root.updateWorldMatrix(true, false);
    root.getWorldQuaternion(_qr);
    for (const f of this.frozen) f.node.quaternion.copy(f.q);
    for (let i = 0; i < P.length; i++) {
      _q.set(d.quat[i * 4]!, d.quat[i * 4 + 1]!, d.quat[i * 4 + 2]!, d.quat[i * 4 + 3]!);
      if (i === 0) {
        P[0]!.quaternion.copy(_q2.copy(_qr).invert().multiply(_q));
        _v.set(d.pos[0]!, d.pos[1]!, d.pos[2]!);
        P[0]!.position.copy(root.worldToLocal(_v));
        continue;
      }
      const p = PARENT[i]!;
      _q2.set(d.quat[p * 4]!, d.quat[p * 4 + 1]!, d.quat[p * 4 + 2]!, d.quat[p * 4 + 3]!).multiply(this.frames[i]!);
      P[i]!.quaternion.copy(_q2.invert().multiply(_q));
    }
  }

  /** Al levantarse: de la pose en que quedó a la de la animación, poco a poco. */
  private applyBlend(dt: number) {
    this.blend += dt;
    const k = THREE.MathUtils.smoothstep(this.blend / BLEND_UP, 0, 1);
    if (k >= 1) {
      this.blend = -1;
      return;
    }
    const w = 1 - k;
    for (const [node, q] of this.snap) {
      if (node === this.parts[0]) continue;
      node.quaternion.slerp(q, w);
    }
    // La cadera, en el mundo (el personaje se ha movido y girado para levantarse).
    const hips = this.parts[0]!;
    const root = hips.parent!;
    root.updateWorldMatrix(true, false);
    root.getWorldQuaternion(_qr);
    _q.copy(_qr).invert().multiply(this.snapHipsQ);
    hips.quaternion.slerp(_q, w);
    _v.copy(this.snapHipsPos);
    root.worldToLocal(_v);
    hips.position.lerp(_v, w);
  }

  /* ---------------------------------------------------------------- */
  /* Cada frame                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Lo que les faltó a las manos para llegar a lo pedido (m en vertical; negativo si sobra): el parkour
   * sube el dibujo eso al colgarse, porque no sabe lo que miden los brazos de cada avatar.
   */
  reachLift = 0;
  private liftNeed = [0, 0];

  apply(dt: number, fx: PersonFx | null) {
    if (this.doll) {
      if (!this.doll.alive) this.doll = null;
      else {
        this.applyDoll(this.doll);
        return;
      }
    }
    if (this.blend >= 0) this.applyBlend(dt);
    this.applySprings(dt);
    this.liftNeed[0] = this.liftNeed[1] = -Infinity;
    if (fx) {
      this.applyEmbrace(dt, fx.hug);
      this.applySeat(fx.seat);
      this.applyFoot(0, fx.footL);
      this.applyFoot(1, fx.footR);
      this.applyLook(dt, fx.look);
      this.applyReach(dt, 0, fx.reachL);
      // Con el teléfono, la derecha va a la oreja (si no la pide otra cosa).
      if (!(this.phone > 0.01 && fx.reachR.w < 0.01)) this.applyReach(dt, 1, fx.reachR);
    }
    if (this.phone > 0.01 && !(fx && fx.reachR.w >= 0.01)) this.applyPhone(dt);
    if (this.touch > 0.01) this.applyMeet(this.touch);
    const need = Math.max(this.liftNeed[0]!, this.liftNeed[1]!);
    this.reachLift = Number.isFinite(need) ? need : 0;
  }

  private applySprings(dt: number) {
    const b = this.body, h = this.headS;
    const h1 = Math.min(dt, 1 / 30);
    stepSpring(b, h1);
    stepSpring(h, h1);
    if (Math.abs(b.p) + Math.abs(b.r) + Math.abs(b.y) + Math.abs(h.p) + Math.abs(h.r) + Math.abs(h.y) < 1e-4) return;
    // Hacia atrás es girar en −X (x > 0 se inclina hacia delante); a su derecha, +Z; girar, +Y.
    const add = (name: Bone, p: number, r: number, y: number) => {
      const n = this.n(name);
      if (n) n.quaternion.multiply(_q.setFromEuler(_eu.set(-p, y, r, "XYZ")));
    };
    add("spine", b.p * 0.3, b.r * 0.3, b.y * 0.3);
    add("chest", b.p * 0.35, b.r * 0.3, b.y * 0.4);
    add("upperChest", b.p * 0.15, b.r * 0.15, b.y * 0.2);
    add("neck", h.p * 0.35, h.r * 0.35, h.y * 0.35);
    add("head", h.p * 0.65, h.r * 0.6, h.y * 0.6);
    // Los brazos se van un poco hacia el lado contrario (inercia).
    add("leftUpperArm", 0, 0, -b.p * 0.35);
    add("rightUpperArm", 0, 0, b.p * 0.35);
  }

  /* ---------------------------------------------------------------- */
  /* El abrazo                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Para su pareja en el abrazo (pair.ts), medidos en cada frame en que se abraza antes de apoyarse en
   * ella: por dónde va su tronco por delante a la altura de su cintura y de su pecho (en el mundo:
   * rig.ts → torsoAt, 0 y 1), la altura de sus hombros y, ya con la cadera donde va, el centro de su
   * cabeza. `hugMeasured`: medidos en este abrazo (si no, no valen). Quien los usa ve los de hace un
   * frame: sin apoyarse en lo que su pareja ya ha corregido (si no, los dos se corregían a la vez lo
   * mismo y se pasaban).
   */
  readonly frontLow = new THREE.Vector3();
  readonly frontHigh = new THREE.Vector3();
  readonly headCenter = new THREE.Vector3();
  /** Lo que se va el tronco en horizontal por cada metro que sube (inclinado, m/m; mundo: de la cintura al pecho). */
  hugTiltX = 0;
  hugTiltZ = 0;
  hugTop = 0;
  hugMeasured = false;
  private hugW = 0;
  private hugFeet = [target(), target()];

  /** Medio ancho de la cabeza a la altura de las orejas, con el pelo (m). */
  get headRadius(): number {
    if (!this.bodySize) void this.size;
    return this.frame?.ear.side ?? 0.09 * (this.bodySize!.head / BODY.head);
  }

  /** El centro de la cabeza ahora (mundo): a la altura de las orejas y algo por delante del hueso. */
  headAt(out: THREE.Vector3): boolean {
    const f = this.frame, head = this.nodes.get("head");
    if (!f || !head) return false;
    head.getWorldPosition(out);
    head.getWorldQuaternion(_q);
    out.addScaledVector(_v.set(0, 1, 0).applyQuaternion(_q), f.ear.up).addScaledVector(_w.copy(f.fwd).applyQuaternion(_q), HEAD_FWD * (this.bodySize!.head / BODY.head));
    return true;
  }

  /**
   * Abrazando: mide el pecho y la cabeza (para su pareja) y hace lo que pide pair.ts: inclinarse (si su
   * pareja es mucho más baja), la cadera hacia su pareja y a un lado con los pies donde estaban (las
   * piernas, con su IK: se doblan algo las rodillas) y la cabeza apartada de la suya (doblando la
   * columna).
   */
  private applyEmbrace(dt: number, h: Embrace) {
    const on = h.on;
    this.hugW += ((on ? h.w : 0) - this.hugW) * Math.min(1, dt * 8);
    h.on = false;
    h.w = 0;
    if (!on && this.hugW < 0.002) {
      this.hugMeasured = false;
      this.hugW = 0;
      return;
    }
    if (!this.bodySize) void this.size;
    const hips = this.parts[0] ?? this.n("hips");
    const root = hips?.parent;
    if (!hips || !root) return;
    hips.updateWorldMatrix(true, true);
    const k = this.hugW;
    // Los pies, donde estaban (con su giro, applyFoot), para dejarlos ahí por mucho que se mueva la
    // cadera (las rodillas, hacia donde iban).
    const lean = k > 0.002 && h.lean > 1e-4;
    const shift = k > 0.002 && (h.x || h.y || h.z);
    if (lean || shift) {
      for (let s = 0; s < 2; s++) {
        const foot = this.n(FEET[s]!), t = this.hugFeet[s]!;
        if (!foot) continue;
        foot.getWorldPosition(_v);
        t.x = _v.x;
        t.y = _v.y;
        t.z = _v.z;
        t.w = 1;
      }
    }
    // Inclinarse (quien es mucho más alto), como quien hace una reverencia: el pecho se queda donde
    // estaba y la cadera va atrás (los hombros y la cabeza, hacia delante y abajo; si no, su pecho se
    // metía en la cara de quien es más bajo). Antes de medir: su pareja lo ve ya inclinado.
    if (lean) {
      const chest = this.parts[PART.thorax]!;
      chest.getWorldPosition(_hc);
      _hd.set(h.lx, 0, h.lz).normalize();
      const bones = this.hugSpine();
      for (let i = 0; i < bones.length - 1; i++) this.turnWorld(bones[i]!, _hd, (h.lean * k) / (bones.length - 1));
      _hc.sub(chest.getWorldPosition(_v));
      _hc.y = 0;
      this.moveHips(hips, root, _hc);
    }
    // El tronco por delante, en horizontal a la altura de cada hueso (inclinado, la sección horizontal
    // es más larga: lo que abulta, entre el coseno), y lo que se inclina (de la cintura al pecho).
    for (let i = 0; i < 2; i++) {
      if (!this.torsoAt(i, _hc, _hf, _hl, _hb)) continue;
      if (i) _a.sub(_hc).negate();
      else _a.copy(_hc);
      const fh = Math.hypot(_hf.x, _hf.z);
      _hf.y = 0;
      _hf.normalize();
      (i ? this.frontHigh : this.frontLow).copy(_hc).addScaledVector(_hf, _hb.front / Math.max(0.6, fh));
    }
    _a.multiplyScalar(_a.y > 0.03 ? 1 / _a.y : 0);
    this.hugTiltX = _a.x;
    this.hugTiltZ = _a.z;
    this.hugTop = Math.max(this.shoulderAt(0, _v) ? _v.y : 0, this.shoulderAt(1, _v) ? _v.y : 0);
    // La cadera, adonde se pide; y las piernas, a los pies de antes.
    if (shift) this.moveHips(hips, root, _hd.set(h.x * k, h.y * k, h.z * k));
    if (lean || shift) {
      this.applyFoot(0, this.hugFeet[0]!, HUG_STRETCH);
      this.applyFoot(1, this.hugFeet[1]!, HUG_STRETCH);
    }
    this.hugMeasured = on && this.headAt(this.headCenter);
    // La cabeza: la columna entera (cintura, pecho, pecho alto y cuello) se dobla lo mismo en cada
    // articulación hacia donde tiene que ir (de lo que mide de cada una a la cabeza sale cuánto) y la
    // cabeza se endereza casi del todo (si no, quedaba torcida, con la oreja en el hombro).
    if (k > 0.002 && (h.hx || h.hz) && this.hugMeasured) {
      const bones = this.hugSpine();
      const head = this.n("head");
      if (!bones.length || !head) return;
      _hd.set(h.hx * k, 0, h.hz * k);
      let levers = 0;
      for (const b of bones) levers += b.getWorldPosition(_v).distanceTo(this.headCenter);
      const angle = _hd.length() / Math.max(0.1, levers);
      for (const b of bones) {
        _a.copy(this.headCenter).sub(b.getWorldPosition(_v));
        _ax.crossVectors(_a, _hd);
        if (_ax.lengthSq() < 1e-10) continue;
        this.turnWorld(b, _ax.normalize(), angle);
      }
      this.turnWorld(head, _ax, -angle * bones.length * HEAD_LEVEL);
    }
  }

  /** Mueve la cadera `by` (mundo, m) y pone al día lo que cuelga de ella. */
  private moveHips(hips: THREE.Object3D, root: THREE.Object3D, by: THREE.Vector3) {
    root.getWorldQuaternion(_q).invert();
    _v.copy(by).applyQuaternion(_q).divideScalar(root.getWorldScale(_ws).x || 1);
    hips.position.add(_v);
    hips.updateWorldMatrix(false, true);
  }

  /** La columna que se dobla para apartar la cabeza (sin repetir: hay VRM sin pecho alto). */
  private spine: THREE.Object3D[] | null = null;
  private hugSpine(): THREE.Object3D[] {
    if (!this.spine) {
      const all = [this.n("spine"), this.n("chest"), this.n("upperChest"), this.n("neck")];
      this.spine = all.filter((b, i): b is THREE.Object3D => !!b && all.indexOf(b) === i);
    }
    return this.spine;
  }

  /** Gira un hueso `angle` rad alrededor de un eje del mundo (sobre su articulación) y pone al día lo que cuelga de él. */
  private turnWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
    bone.getWorldQuaternion(_q2).premultiply(_q.setFromAxisAngle(axis, angle));
    bone.parent!.getWorldQuaternion(_qr);
    bone.quaternion.copy(_qr.invert().multiply(_q2));
    bone.updateWorldMatrix(false, true);
  }

  /** La cadera, donde está el asiento (quien lo pide ya suaviza su peso: va pegado al coche). */
  private applySeat(t: Target) {
    if (t.w < 0.001) return;
    const hips = this.parts[0] ?? this.n("hips");
    const root = hips?.parent;
    if (!hips || !root) return;
    root.updateWorldMatrix(true, false);
    _v.set(t.x, t.y, t.z);
    root.worldToLocal(_v);
    hips.position.lerp(_v, Math.min(1, t.w));
  }

  /**
   * IK de dos huesos de la pierna hacia el tobillo pedido (mundo), con la rodilla hacia donde ya iba.
   * El pie conserva su giro en el mundo (el de la pose: apoyado en el pedal), se doble como se doble
   * la pierna. Quien lo pide ya suaviza su peso. `stretch`: lo más que se estira (de pie, el reposo
   * lleva las piernas casi rectas: con menos, los pies se levantaban del suelo).
   */
  private applyFoot(side: 0 | 1, t: Target, stretch = 0.94) {
    const w = Math.min(1, t.w);
    if (w < 0.001) return;
    const upper = this.n(side ? "rightUpperLeg" : "leftUpperLeg");
    const lower = this.n(side ? "rightLowerLeg" : "leftLowerLeg");
    const foot = this.n(side ? "rightFoot" : "leftFoot");
    if (!upper || !lower || !foot || !upper.parent) return;
    upper.updateWorldMatrix(true, true);
    upper.getWorldPosition(_S);
    lower.getWorldPosition(_E);
    foot.getWorldPosition(_W);
    foot.getWorldQuaternion(_qf);
    const la = _S.distanceTo(_E), lb = _E.distanceTo(_W);
    _D.set(t.x, t.y, t.z).sub(_S);
    let dist = _D.length();
    // Nunca del todo estirada (a quien no llega, la rodilla le queda algo doblada).
    const max = (la + lb) * stretch;
    const min = Math.abs(la - lb) + 0.01;
    if (dist > max) _D.multiplyScalar(max / dist);
    else if (dist < min) _D.multiplyScalar(min / Math.max(dist, 1e-4));
    dist = _D.length();
    _U.copy(_D).normalize();
    // La rodilla hacia donde se pida o hacia donde ya iba (respecto a la recta cadera-tobillo nueva).
    if (t.px || t.py || t.pz) _N.set(t.px, t.py, t.pz);
    else _N.copy(_E).sub(_S);
    _N.addScaledVector(_U, -_N.dot(_U));
    if (_N.lengthSq() < 1e-8) _N.set(0, 1, 0);
    _N.normalize();
    const x = (la * la + dist * dist - lb * lb) / (2 * dist);
    const h = Math.sqrt(Math.max(0, la * la - x * x));
    _v.copy(_E).sub(_S).normalize();
    _w.copy(_U).multiplyScalar(x).addScaledVector(_N, h).normalize();
    _q.setFromUnitVectors(_v, _w);
    upper.getWorldQuaternion(_q2).premultiply(_q);
    upper.parent.getWorldQuaternion(_qr);
    _q3.copy(_qr).invert().multiply(_q2);
    upper.quaternion.slerp(_q3, w);
    upper.updateWorldMatrix(false, true);
    lower.getWorldPosition(_E);
    foot.getWorldPosition(_W);
    _v.copy(_W).sub(_E).normalize();
    _w.copy(_S).add(_D).sub(_E).normalize();
    _q.setFromUnitVectors(_v, _w);
    lower.getWorldQuaternion(_q2).premultiply(_q);
    upper.getWorldQuaternion(_qr);
    _q3.copy(_qr).invert().multiply(_q2);
    lower.quaternion.slerp(_q3, w);
    lower.updateWorldMatrix(false, true);
    // El pie, como estaba en el mundo.
    lower.getWorldQuaternion(_qr);
    _q3.copy(_qr).invert().multiply(_qf);
    foot.quaternion.slerp(_q3, w);
  }

  private applyLook(dt: number, t: Target) {
    this.lookW += (t.w - this.lookW) * Math.min(1, dt * 5);
    if (this.lookW < 0.01) return;
    const head = this.n("head"), neck = this.n("neck");
    const thorax = this.parts[PART.thorax];
    if (!head || !thorax) return;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(_a);
    _b.set(t.x, t.y, t.z).sub(_a);
    thorax.getWorldQuaternion(_q).invert();
    _b.applyQuaternion(_q);
    const yaw = THREE.MathUtils.clamp(Math.atan2(_b.x, _b.z), -1.1, 1.1) * this.lookW;
    const pitch = THREE.MathUtils.clamp(Math.atan2(_b.y, Math.hypot(_b.x, _b.z)), -0.55, 0.5) * this.lookW;
    if (neck) neck.quaternion.premultiply(_q2.setFromEuler(_eu.set(-pitch * 0.4, yaw * 0.4, 0, "YXZ")));
    head.quaternion.premultiply(_q2.setFromEuler(_eu.set(-pitch * 0.6, yaw * 0.6, 0, "YXZ")));
  }

  /** IK de dos huesos del brazo hacia la muñeca pedida (mundo), respetando hacia dónde iba el codo. */
  private applyReach(dt: number, side: 0 | 1, t: Target) {
    const palm = t.palm, shape = t.shape;
    _P.set(t.nx, t.ny, t.nz);
    _F.set(t.ux, t.uy, t.uz);
    t.palm = t.nx = t.ny = t.nz = t.ux = t.uy = t.uz = 0;
    t.shape = null;
    // Lo que va a la palma de otra persona (pair.ts) ya entra con su propia rampa, a tiempo para el
    // golpe o el apretón: aquí se sigue deprisa (con la lenta, chocar los cinco llegaba tarde).
    this.reachW[side] = this.reachW[side]! + (t.w - this.reachW[side]!) * Math.min(1, dt * (palm ? 16 : 6));
    const w = this.reachW[side]!;
    if (!shape || w < 0.01) this.shaped[side] = false;
    if (w < 0.01) return;
    const upper = this.n(side ? "rightUpperArm" : "leftUpperArm");
    const lower = this.n(side ? "rightLowerArm" : "leftLowerArm");
    const hand = this.n(side ? "rightHand" : "leftHand");
    if (!upper || !lower || !hand || !upper.parent) return;
    upper.updateWorldMatrix(true, true);
    upper.getWorldPosition(_S);
    lower.getWorldPosition(_E);
    hand.getWorldPosition(_W);
    // La mano como acabará (mundo): girada como se pide o como la puso la animación. De ahí, dónde cae
    // la palma respecto a la muñeca. Con la palma pero sin los dedos, los dedos siguen al antebrazo
    // (la muñeca se dobla solo lo justo para que la palma mire a donde se pide).
    hand.getWorldQuaternion(_qh);
    const rest = this.palmRest(side);
    const follow = _P.lengthSq() > 0.25 && _F.lengthSq() < 0.25;
    if (follow) _F.copy(_W).sub(_E);
    const aim = rest && _P.lengthSq() > 0.25 && _F.lengthSq() > 1e-8 ? this.handAim(rest, _qt) : null;
    let x = t.x, y = t.y, z = t.z;
    if (palm && rest) {
      _v.copy(rest.center).applyQuaternion(aim ?? _qh).multiplyScalar(this.worldScale());
      x -= _v.x;
      y -= _v.y;
      z -= _v.z;
    }
    const la = _S.distanceTo(_E), lb = _E.distanceTo(_W);
    if (w > 0.5) {
      const hx = Math.hypot(x - _S.x, z - _S.z);
      const reach = (la + lb) * 0.97;
      this.liftNeed[side] = y - _S.y - (hx < reach ? Math.sqrt(reach * reach - hx * hx) : 0);
    }
    this.reachArm(upper, lower, hand, x, y, z, w, t.px, t.py, t.pz);
    // Con los dedos siguiendo al antebrazo: la mano, con el antebrazo ya donde va; y si cuenta la palma,
    // otra vez el brazo hacia donde queda la muñeca con la mano así (con la del principio, la palma caía
    // a unos centímetros).
    for (let k = 0; aim && follow && k < 2; k++) {
      lower.getWorldPosition(_E);
      hand.getWorldPosition(_W);
      _F.copy(_W).sub(_E);
      this.handAim(rest!, _qt);
      if (!palm) break;
      _v.copy(rest!.center).applyQuaternion(_qt).multiplyScalar(this.worldScale());
      upper.updateWorldMatrix(true, true);
      upper.getWorldPosition(_S);
      this.reachArm(upper, lower, hand, t.x - _v.x, t.y - _v.y, t.z - _v.z, w, t.px, t.py, t.pz);
    }
    if (aim) this.turnHand(side, lower, hand, _qt, w);
    if (shape) this.shapeFingers(dt, side, shape, w);
  }

  /** Por mano: sus dedos (los huesos normalizados) y cómo van ahora (para cambiar de forma sin saltos). */
  private fingers: { node: THREE.Object3D; bone: string; now: THREE.Quaternion }[][] | null = null;
  private shaped = [false, false];
  /** Los dedos de una mano a una forma (people/hands.ts), con peso `w`; de una forma a otra, en una décima. */
  private shapeFingers(dt: number, side: 0 | 1, shape: BaseHand, w: number) {
    if (!this.fingers) {
      this.fingers = [[], []];
      for (const bone of ALL_FINGER_BONES) {
        const node = this.nodes.get(bone);
        if (node) this.fingers[bone.startsWith("right") ? 1 : 0]!.push({ node, bone, now: new THREE.Quaternion() });
      }
    }
    const t = handTable(shape, this.vrm.meta?.metaVersion === "0");
    const k = this.shaped[side] ? Math.min(1, dt / 0.1) : 1;
    for (const f of this.fingers[side]!) {
      // Al empezar, desde como los tenía la animación.
      if (!this.shaped[side]) f.now.copy(f.node.quaternion);
      f.now.slerp(t.get(f.bone)!, k);
      f.node.quaternion.slerp(f.now, w);
    }
    this.shaped[side] = true;
  }

  /**
   * La mano girada (mundo) para que su palma mire a `_P` y sus dedos apunten a `_F`. En reposo, los
   * dedos van de la muñeca a los nudillos y la palma hacia `normal` (palmRest: sale de los huesos, así
   * vale igual para los VRM 0.x, que van girados media vuelta).
   */
  private handAim(rest: { normal: THREE.Vector3; center: THREE.Vector3 }, out: THREE.Quaternion): THREE.Quaternion | null {
    _P.normalize();
    _F.addScaledVector(_P, -_F.dot(_P));
    if (_F.lengthSq() < 1e-6) return null;
    _F.normalize();
    _f0.copy(rest.center).normalize();
    _f0.addScaledVector(rest.normal, -_f0.dot(rest.normal)).normalize();
    _c0.crossVectors(_f0, rest.normal);
    _m0.makeBasis(_f0, rest.normal, _c0).transpose();
    _c0.crossVectors(_F, _P);
    _m1.makeBasis(_F, _P, _c0).multiply(_m0);
    return out.setFromRotationMatrix(_m1);
  }

  /**
   * Gira la mano a `q` (mundo) con peso `w`. Lo que gira alrededor del antebrazo se lo reparte con él
   * (el 60 %, como la supinación de los gestos, people/gestures.ts): todo en la muñeca la retorcía.
   */
  private turnHand(side: 0 | 1, lower: THREE.Object3D, hand: THREE.Object3D, q: THREE.Quaternion, w: number) {
    const along = this.vrm.humanoid.normalizedRestPose[side ? "rightHand" : "leftHand"]?.position;
    if (!along) return;
    _ax.fromArray(along).normalize();
    // Lo que le falta a la mano respecto al antebrazo, y su parte alrededor del eje del antebrazo.
    lower.getWorldQuaternion(_qr);
    _qa.copy(_qr).invert().multiply(q);
    if (_qa.w < 0) _qa.set(-_qa.x, -_qa.y, -_qa.z, -_qa.w);
    const tau = 2 * Math.atan2(_qa.x * _ax.x + _qa.y * _ax.y + _qa.z * _ax.z, _qa.w) * 0.6 * w;
    lower.quaternion.multiply(_qb.setFromAxisAngle(_ax, tau));
    hand.quaternion.slerp(_qa.premultiply(_qb.setFromAxisAngle(_ax, -tau)), w);
  }

  /** La escala del avatar en el mundo (los VRM de tamaño raro se escalan al cargarlos: avatar-model.ts). */
  private worldScale() {
    return this.vrm.scene.getWorldScale(_ws).x;
  }

  /** Lo que mide este cuerpo (se mide una vez, en su reposo). */
  private bodySize: BodySize | null = null;
  /** En el marco del modelo: hacia delante y hacia su izquierda (los VRM 0.x miran a −z); y el tronco por fuera a la altura de los huesos del pecho y de la cintura (m, desde cada hueso). */
  private frame: { fwd: THREE.Vector3; left: THREE.Vector3; chest: TorsoBand; waist: TorsoBand; ear: { up: number; side: number } } | null = null;
  get size(): BodySize {
    if (this.bodySize) return this.bodySize;
    const rest = this.vrm.humanoid.normalizedRestPose;
    const s = this.worldScale();
    // Dónde está cada hueso en reposo (en el marco del modelo): lo suyo más lo de los que tiene encima
    // (los que falten no suman).
    const at = (b: Bone) => {
      const out = new THREE.Vector3();
      for (let n: Bone | null = b; n; n = VRMHumanBoneParentMap[n] as Bone | null) {
        const p = rest[n]?.position;
        if (p) out.x += p[0]!, (out.y += p[1]!), (out.z += p[2]!);
      }
      return out;
    };
    const lu = at("leftUpperArm"), ru = at("rightUpperArm");
    const head = at("head").y * s;
    const len = (b: Bone) => new THREE.Vector3().fromArray(rest[b]?.position ?? [0, 0, 0]).length() * s;
    const palm0 = this.palmRest(0);
    const hand = (palm0?.size ?? 0) * s;
    // La segunda articulación de cada dedo, a lo largo de ellos desde el centro de la palma: la más cerca.
    let grip = Infinity;
    if (palm0) {
      const along = palm0.center.clone().normalize();
      for (const f of ["Index", "Middle", "Ring", "Little"] as const) {
        const k = rest[`left${f}Proximal` as Bone]?.position, m = rest[`left${f}Intermediate` as Bone]?.position;
        if (k && m) grip = Math.min(grip, (new THREE.Vector3().fromArray(k).dot(along) + new THREE.Vector3().fromArray(m).length() - palm0.center.length()) * s);
      }
    }
    const arm = len("leftLowerArm") + len("leftHand");
    const width = (lu.distanceTo(ru) / 2) * s;
    const shoulder = ((lu.y + ru.y) / 2) * s;
    // Hacia dónde mira y su izquierda: de los hombros (así vale igual para los VRM 0.x).
    const left = lu.clone().sub(ru).setY(0).normalize();
    const fwd = new THREE.Vector3().crossVectors(left, _up);
    const chest = at(rest.upperChest ? "upperChest" : "chest"), spine = at("spine");
    const k = head > 0.8 ? head / BODY.head : 1;
    // La oreja: algo por encima del hueso de la cabeza (y lo que abulta allí la cabeza, con el pelo).
    const earUp = EAR_UP * k;
    const ear = at("head").add(new THREE.Vector3(0, earUp / s, 0));
    const ok = width > 0.05 && fwd.lengthSq() > 0.5;
    const bands = ok ? this.torso([chest, spine, ear], fwd, left, width / s, s) : null;
    this.frame = bands ? { fwd, left, chest: bands[0]!, waist: bands[1]!, ear: { up: earUp, side: bands[2]!.side } } : null;
    this.bodySize = {
      shoulder: shoulder > 0.5 ? shoulder * SHOULDER_DOWN : BODY.shoulder,
      head: head > 0.8 ? head : BODY.head,
      arm: arm > 0.2 ? arm : BODY.arm,
      width: width > 0.05 ? width : BODY.width,
      hand: hand > 0.03 ? hand : BODY.hand,
      grip: grip > 0.02 && grip < 0.15 ? grip : (hand > 0.03 ? hand : BODY.hand) * (BODY.grip / BODY.hand),
      front: bands ? bands[0]!.front + chest.dot(fwd) * s : BODY.front * k,
      back: bands ? bands[0]!.back - chest.dot(fwd) * s : BODY.back * k,
      waist: bands ? bands[1]!.back - spine.dot(fwd) * s : BODY.waist * k,
      side: bands ? bands[0]!.side : BODY.side * k,
    };
    return this.bodySize;
  }

  /**
   * El tronco por fuera, de su malla en reposo (la ropa cuenta: con chaqueta abulta más), en una franja
   * de ±7 cm a la altura de cada hueso: hasta dónde llega por delante y por detrás de él (cerca del
   * centro) y su medio ancho (sin los brazos, que en la pose en T van por fuera de los hombros); m.
   */
  private torso(bones: THREE.Vector3[], fwd: THREE.Vector3, left: THREE.Vector3, width: number, s: number): TorsoBand[] | null {
    const scene = this.vrm.scene;
    scene.updateMatrixWorld(true);
    _m0.copy(scene.matrixWorld).invert();
    const band = 0.07 / s;
    const out = bones.map(() => ({ front: -Infinity, back: -Infinity, side: 0 }));
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const pos = mesh.isMesh ? mesh.geometry?.attributes.position : null;
      if (!pos) return;
      _m1.multiplyMatrices(_m0, mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(_m1);
        for (let k = 0; k < bones.length; k++) {
          const b = bones[k]!, t = out[k]!;
          if (Math.abs(_v.y - b.y) > band) continue;
          _w.copy(_v).sub(b);
          const lat = Math.abs(_w.dot(left)), z = _w.dot(fwd);
          if (lat < width * 0.6) {
            if (z > t.front) t.front = z;
            if (-z > t.back) t.back = -z;
          }
          if (lat < width * 1.15 && lat > t.side) t.side = lat;
        }
      }
    });
    if (out.some((t) => !(t.front > -1e3 && t.back > -1e3) || t.side <= 0)) return null;
    return out.map((t) => ({ front: t.front * s, back: t.back * s, side: t.side * s }));
  }

  /** Dónde está ahora (mundo) el hombro izquierdo (0) o el derecho (1). */
  shoulderAt(side: 0 | 1, out: THREE.Vector3): boolean {
    const n = this.n(side ? "rightUpperArm" : "leftUpperArm");
    if (!n) return false;
    n.getWorldPosition(out);
    return true;
  }

  /**
   * El tronco ahora (mundo; para que en pareja las manos se apoyen en él), a una altura por la línea
   * del hueso de la cintura (`level` 0) al del pecho (1), y algo por debajo o por encima: por dónde
   * pasa (`p`), hacia dónde mira (`fwd`) y su izquierda (`left`), con el cuerpo como esté (inclinado en
   * el abrazo, también); y en `band`, lo que abulta por fuera desde ahí (fuera de los dos huesos, lo
   * del más cercano). Sin su malla medida, false.
   */
  torsoAt(level: number, p: THREE.Vector3, fwd: THREE.Vector3, left: THREE.Vector3, band: TorsoBand): boolean {
    if (!this.bodySize) void this.size;
    const f = this.frame;
    const chest = this.nodes.get("upperChest") ?? this.nodes.get("chest"), waist = this.nodes.get("spine");
    if (!f || !chest || !waist) return false;
    const k = level < 0 ? 0 : level > 1 ? 1 : level;
    waist.getWorldPosition(p);
    chest.getWorldPosition(_v);
    p.lerp(_v, level);
    waist.getWorldQuaternion(_qb);
    _qb.slerp(chest.getWorldQuaternion(_qa), k);
    fwd.copy(f.fwd).applyQuaternion(_qb);
    left.copy(f.left).applyQuaternion(_qb);
    band.front = f.waist.front + (f.chest.front - f.waist.front) * k;
    band.back = f.waist.back + (f.chest.back - f.waist.back) * k;
    band.side = f.waist.side + (f.chest.side - f.waist.side) * k;
    return true;
  }

  /**
   * IK de dos huesos de un brazo: la muñeca a (x, y, z) del mundo con peso `w` y el codo hacia (px,
   * py, pz) o, sin eso, hacia donde ya iba. Hay que haber puesto en _S, _E y _W dónde están ahora el
   * hombro, el codo y la muñeca.
   */
  private reachArm(upper: THREE.Object3D, lower: THREE.Object3D, hand: THREE.Object3D, x: number, y: number, z: number, w: number, px = 0, py = 0, pz = 0) {
    const la = _S.distanceTo(_E), lb = _E.distanceTo(_W);
    _D.set(x, y, z).sub(_S);
    let dist = _D.length();
    const max = (la + lb) * 0.995;
    const min = Math.abs(la - lb) + 0.01;
    if (dist > max) _D.multiplyScalar(max / dist);
    else if (dist < min) _D.multiplyScalar(min / Math.max(dist, 1e-4));
    dist = _D.length();
    _U.copy(_D).normalize();
    // El codo hacia donde se pida o hacia donde ya iba (respecto a la recta hombro-mano nueva).
    if (px || py || pz) _N.set(px, py, pz);
    else _N.copy(_E).sub(_S);
    _N.addScaledVector(_U, -_N.dot(_U));
    if (_N.lengthSq() < 1e-8) _N.set(0, -1, 0);
    _N.normalize();
    const a = (la * la + dist * dist - lb * lb) / (2 * dist);
    const h = Math.sqrt(Math.max(0, la * la - a * a));
    // Brazo: de hacia el codo de ahora a hacia el codo nuevo.
    _v.copy(_E).sub(_S).normalize();
    _w.copy(_U).multiplyScalar(a).addScaledVector(_N, h).normalize();
    _q.setFromUnitVectors(_v, _w);
    upper.getWorldQuaternion(_q2).premultiply(_q);
    upper.parent!.getWorldQuaternion(_qr);
    _q3.copy(_qr).invert().multiply(_q2);
    upper.quaternion.slerp(_q3, w);
    upper.updateWorldMatrix(false, true);
    // Antebrazo: hacia la muñeca pedida.
    lower.getWorldPosition(_E);
    hand.getWorldPosition(_W);
    _v.copy(_W).sub(_E).normalize();
    _w.copy(_S).add(_D).sub(_E).normalize();
    _q.setFromUnitVectors(_v, _w);
    lower.getWorldQuaternion(_q2).premultiply(_q);
    upper.getWorldQuaternion(_qr);
    _q3.copy(_qr).invert().multiply(_q2);
    lower.quaternion.slerp(_q3, w);
  }

  /* ---------------------------------------------------------------- */
  /* El teléfono                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Con el teléfono en la mano (people/phone.ts; lo pone el animador, 0–1, entrando y saliendo con el
   * gesto): la mano derecha a su oreja, con la palma hacia la cabeza, los dedos hacia arriba y algo
   * hacia atrás y el teléfono entre la palma y la oreja. La captura la dejaba a un palmo de la cabeza
   * (cada avatar, a una distancia: sus brazos y sus hombros no son los del clip).
   */
  phone = 0;
  private phoneT = target();
  private applyPhone(dt: number) {
    if (!this.bodySize) void this.size;
    const f = this.frame, head = this.nodes.get("head");
    if (!f || !head) return;
    head.getWorldPosition(_ph);
    head.getWorldQuaternion(_phQ);
    _phR.copy(f.left).applyQuaternion(_phQ).negate();
    _phU.set(0, 1, 0).applyQuaternion(_phQ);
    _phF.copy(f.fwd).applyQuaternion(_phQ);
    // El centro de la palma: por fuera de la oreja lo que miden el teléfono y la palma, y algo más
    // abajo y delante (el teléfono, de la oreja hacia la boca).
    _ph.addScaledVector(_phU, f.ear.up - PHONE_DOWN).addScaledVector(_phR, f.ear.side + PHONE_OUT).addScaledVector(_phF, PHONE_FWD);
    const t = this.phoneT;
    t.x = _ph.x;
    t.y = _ph.y;
    t.z = _ph.z;
    t.w = this.phone;
    // El codo, por fuera, abajo y algo delante.
    t.px = _phR.x * 0.6 - _phU.x * 0.8 + _phF.x * 0.3;
    t.py = _phR.y * 0.6 - _phU.y * 0.8 + _phF.y * 0.3;
    t.pz = _phR.z * 0.6 - _phU.z * 0.8 + _phF.z * 0.3;
    t.palm = 1;
    t.nx = -_phR.x;
    t.ny = -_phR.y;
    t.nz = -_phR.z;
    t.ux = _phU.x - _phF.x * PHONE_BACK;
    t.uy = _phU.y - _phF.y * PHONE_BACK;
    t.uz = _phU.z - _phF.z * PHONE_BACK;
    this.applyReach(dt, 1, t);
  }

  /* ---------------------------------------------------------------- */
  /* Juntar las palmas                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Cuánto se tocan ahora las palmas (0–1): lo pone el animador con lo que diga el gesto
   * (people/gestures.ts → `touchAt`) por lo que pese.
   */
  touch = 0;
  /** La palma de una mano (0 izquierda, 1 derecha), en reposo y en el marco de la mano: hacia dónde mira, dónde queda su centro y lo que mide la mano (para colgarle algo: people/phone.ts). */
  palm(side: 0 | 1) {
    return this.palmRest(side);
  }

  /** Por mano: hacia fuera de la palma, dónde queda su centro (respecto a la muñeca) y lo que mide; en reposo. */
  private palms: ({ normal: THREE.Vector3; center: THREE.Vector3; size: number } | null)[] | null = null;

  private palmRest(side: 0 | 1) {
    if (!this.palms) {
      const rest = this.vrm.humanoid.normalizedRestPose;
      this.palms = (["left", "right"] as const).map((s) => {
        const at = (b: string) => rest[`${s}${b}` as Bone]?.position;
        const mid = at("MiddleProximal"), index = at("IndexProximal"), ring = at("RingProximal"), little = at("LittleProximal");
        if (!mid || !index || !ring || !little) return null;
        const v = (p: number[]) => new THREE.Vector3().fromArray(p);
        const center = v(index).add(v(mid)).add(v(ring)).add(v(little)).multiplyScalar(0.25 * PALM_AT);
        const normal = v(mid).cross(v(index).sub(v(little))).normalize();
        if (s === "right") normal.negate();
        return { normal, center, size: v(mid).length() };
      });
    }
    return this.palms[side];
  }

  /**
   * Junta las palmas a su medida: el centro de cada una (en la línea de los huesos, a medio camino de
   * la muñeca a los nudillos) a la distancia de una palma de la otra, a lo largo de hacia donde miran,
   * moviendo las dos muñecas lo mismo y sin girar las manos (la pose ya las pone una frente a otra).
   */
  private applyMeet(w: number) {
    const restL = this.palmRest(0), restR = this.palmRest(1);
    const hl = this.n("leftHand"), hr = this.n("rightHand");
    if (!restL || !restR || !hl || !hr) return;
    hl.updateWorldMatrix(true, false);
    hr.updateWorldMatrix(true, false);
    hl.getWorldQuaternion(_ql);
    hr.getWorldQuaternion(_qrr);
    const sc = this.worldScale();
    _pl.copy(restL.center).applyQuaternion(_ql).multiplyScalar(sc).add(hl.getWorldPosition(_v));
    _pr.copy(restR.center).applyQuaternion(_qrr).multiplyScalar(sc).add(hr.getWorldPosition(_v));
    // Hacia dónde se juntan: de la palma derecha a la izquierda, entre lo que miran las dos.
    _nl.copy(restL.normal).applyQuaternion(_ql);
    _nr.copy(restR.normal).applyQuaternion(_qrr);
    _ax.copy(_nr).sub(_nl);
    if (_ax.lengthSq() < 0.5) return; // no se miran: no es una palmada
    _ax.normalize();
    const gap = PALM_GAP * (restL.size + restR.size) * 0.5 * sc;
    const d = (_v.copy(_pl).sub(_pr).dot(_ax) - gap) * 0.5 * Math.min(1, w);
    if (Math.abs(d) < 5e-4) return;
    this.nudgeHand(0, hl, _ql, -d);
    this.nudgeHand(1, hr, _qrr, d);
  }

  /** Lleva una muñeca `d` metros a lo largo de `_ax`, con la mano girada como estaba (`q`, en el mundo). */
  private nudgeHand(side: 0 | 1, hand: THREE.Object3D, q: THREE.Quaternion, d: number) {
    const upper = this.n(side ? "rightUpperArm" : "leftUpperArm");
    const lower = this.n(side ? "rightLowerArm" : "leftLowerArm");
    if (!upper || !lower || !upper.parent) return;
    upper.updateWorldMatrix(true, true);
    upper.getWorldPosition(_S);
    lower.getWorldPosition(_E);
    hand.getWorldPosition(_W);
    _v.copy(_W).addScaledVector(_ax, d);
    _qm.copy(q);
    this.reachArm(upper, lower, hand, _v.x, _v.y, _v.z, 1);
    lower.updateWorldMatrix(false, false);
    lower.getWorldQuaternion(_qr);
    hand.quaternion.copy(_qr.invert().multiply(_qm));
  }
}

const _qf = new THREE.Quaternion();
/** El centro de la cabeza, por delante del hueso (m, en un cuerpo de 1,62 m de la cabeza al suelo). */
const HEAD_FWD = 0.02;
const FEET = ["leftFoot", "rightFoot"] as const;
/** Abrazando, con los pies quietos: lo más que se estira cada pierna (de la cadera al tobillo, por lo que mide). */
const HUG_STRETCH = 0.997;
/** Al apartar la cabeza doblando la columna, lo que la cabeza se endereza (de lo que se ha doblado todo). */
const HEAD_LEVEL = 0.75;
/** El abrazo (applyEmbrace). */
const _hc = new THREE.Vector3();
const _hf = new THREE.Vector3();
const _hl = new THREE.Vector3();
const _hd = new THREE.Vector3();
const _hb: TorsoBand = { front: 0, back: 0, side: 0 };
/** Juntar las palmas: hasta dónde de la muñeca a los nudillos cae el centro de la palma y a qué distancia quedan (por lo que mide la mano). */
const PALM_AT = 0.55;
const PALM_GAP = 0.3;
const _ql = new THREE.Quaternion();
const _qrr = new THREE.Quaternion();
const _qm = new THREE.Quaternion();
const _pl = new THREE.Vector3();
const _pr = new THREE.Vector3();
const _nl = new THREE.Vector3();
const _nr = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _qh = new THREE.Quaternion();
const _ws = new THREE.Vector3();
/** Girar una mano a lo pedido (applyReach → handAim, turnHand). */
const _qt = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _P = new THREE.Vector3();
const _F = new THREE.Vector3();
const _f0 = new THREE.Vector3();
const _c0 = new THREE.Vector3();
const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
/** El teléfono (applyPhone). */
const _ph = new THREE.Vector3();
const _phR = new THREE.Vector3();
const _phU = new THREE.Vector3();
const _phF = new THREE.Vector3();
const _phQ = new THREE.Quaternion();
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _W = new THREE.Vector3();
const _D = new THREE.Vector3();
const _U = new THREE.Vector3();
const _N = new THREE.Vector3();
const _lying: Lying = { x: 0, y: 0, z: 0, hx: 0, hz: 1, face: 0 };
