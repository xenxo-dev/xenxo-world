/**
 * El esqueleto de cada persona después de sus animaciones (world/animation.ts): lo que no sale de
 * un clip, sobre los huesos normalizados del VRM (los copia a los de verdad `vrm.update`).
 *
 *   - Encajar golpes: dos muelles amortiguados (tronco y cabeza) que reciben el impulso del golpe en
 *     su dirección (de frente, por la espalda o de lado) y vuelven solos, con su pequeño rebote.
 *   - Mirar a alguien: cuello y cabeza hacia un punto, con límites.
 *   - Llegar con la mano a un sitio (IK de dos huesos): chocar los cinco, darse la mano, abrazar.
 *   - Juntar las palmas (aplaudir): el gesto dice cuándo se tocan (`touch`) y aquí se juntan a la
 *     medida de cada avatar (lo ancho de hombros frente a lo largo de brazos cambia de uno a otro:
 *     con la misma pose, a unos les quedaba un hueco y a otros se les atravesaban las manos).
 *   - Caer con física (people/ragdoll.ts): el cuerpo articulado manda sobre los huesos mientras
 *     cae y está en el suelo; al levantarse se funde con la animación desde la pose en que quedó.
 *
 * Sin objetos nuevos por frame.
 */
import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
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
}

/** Lo que la gente le pide al esqueleto de una persona (vive en su `Motion`). */
export interface PersonFx {
  /** El esqueleto, cuando su avatar VRM está cargado (con el muñeco de respaldo, null). */
  rig: Rig | null;
  look: Target;
  reachL: Target;
  reachR: Target;
  /**
   * Dónde tiene que quedar su cadera (mundo): sentado en un asiento que no se mueve con él (el del
   * coche). Mida lo que mida el avatar y venga de la pose que venga, la cadera cae ahí.
   */
  seat: Target;
  /** Dónde van sus tobillos (mundo), con la rodilla hacia donde ya iba: los pies en los pedales. */
  footL: Target;
  footR: Target;
}
const target = (): Target => ({ x: 0, y: 0, z: 0, w: 0, px: 0, py: 0, pz: 0 });
export const createFx = (): PersonFx => ({ rig: null, look: target(), reachL: target(), reachR: target(), seat: target(), footL: target(), footR: target() });

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
      this.applySeat(fx.seat);
      this.applyFoot(0, fx.footL);
      this.applyFoot(1, fx.footR);
      this.applyLook(dt, fx.look);
      this.applyReach(dt, 0, fx.reachL);
      this.applyReach(dt, 1, fx.reachR);
    }
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
   * la pierna. Quien lo pide ya suaviza su peso.
   */
  private applyFoot(side: 0 | 1, t: Target) {
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
    const max = (la + lb) * 0.94;
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
    this.reachW[side] = this.reachW[side]! + (t.w - this.reachW[side]!) * Math.min(1, dt * 6);
    const w = this.reachW[side]!;
    if (w < 0.01) return;
    const upper = this.n(side ? "rightUpperArm" : "leftUpperArm");
    const lower = this.n(side ? "rightLowerArm" : "leftLowerArm");
    const hand = this.n(side ? "rightHand" : "leftHand");
    if (!upper || !lower || !hand || !upper.parent) return;
    upper.updateWorldMatrix(true, true);
    upper.getWorldPosition(_S);
    lower.getWorldPosition(_E);
    hand.getWorldPosition(_W);
    const la = _S.distanceTo(_E), lb = _E.distanceTo(_W);
    if (w > 0.5) {
      const hx = Math.hypot(t.x - _S.x, t.z - _S.z);
      const reach = (la + lb) * 0.97;
      this.liftNeed[side] = t.y - _S.y - (hx < reach ? Math.sqrt(reach * reach - hx * hx) : 0);
    }
    this.reachArm(upper, lower, hand, t.x, t.y, t.z, w, t.px, t.py, t.pz);
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
  /* Juntar las palmas                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Cuánto se tocan ahora las palmas (0–1): lo pone el animador con lo que diga el gesto
   * (people/gestures.ts → `touchAt`) por lo que pese.
   */
  touch = 0;
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
    _pl.copy(restL.center).applyQuaternion(_ql).add(hl.getWorldPosition(_v));
    _pr.copy(restR.center).applyQuaternion(_qrr).add(hr.getWorldPosition(_v));
    // Hacia dónde se juntan: de la palma derecha a la izquierda, entre lo que miran las dos.
    _nl.copy(restL.normal).applyQuaternion(_ql);
    _nr.copy(restR.normal).applyQuaternion(_qrr);
    _ax.copy(_nr).sub(_nl);
    if (_ax.lengthSq() < 0.5) return; // no se miran: no es una palmada
    _ax.normalize();
    const gap = PALM_GAP * (restL.size + restR.size) * 0.5;
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
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _W = new THREE.Vector3();
const _D = new THREE.Vector3();
const _U = new THREE.Vector3();
const _N = new THREE.Vector3();
const _lying: Lying = { x: 0, y: 0, z: 0, hx: 0, hz: 1, face: 0 };
