/**
 * La simulación de las caídas (people/ragdoll.ts): un mundo de Rapier con lo sólido del lugar
 * (StaticWorld, lo mismo con lo que choca el personaje) y los cuerpos articulados de quien está
 * cayendo. Rapier une los sólidos (rótulas y bisagras) con sus límites (en las rótulas, por eje); el
 * tono muscular se pone aquí, corrigiendo el giro relativo en cada paso. Los cuerpos no chocan entre
 * sí (ni con los de otras personas): solo con el lugar.
 *
 * Paso fijo de 1/60 s; lo que se dibuja (`pos`, `quat`) va entre el paso anterior y el último, para
 * que una caída se vea fluida también a 90, 120 o 144 Hz (como el coche: vehicle/physics.ts). Se
 * carga aparte; también corre en Node (test/ragdoll.mts).
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { StaticWorld, type StaticSource } from "../vehicle/physics";
import type { RagdollHandle, RagdollJoint, RagdollSpec, RagdollWorldApi } from "./ragdoll";

type R = typeof RAPIER;
type Body = InstanceType<R["RigidBody"]>;

const STEP = 1 / 60;
/** Ejes de giro de las articulaciones de Rapier (RawJointAxis: AngX, AngY, AngZ). */
const ANG_X = 3;
const MAX_STEPS = 4;
/** Grupo de choque de los cuerpos: miembros del 2, solo chocan con el 1 (el lugar). */
const GROUPS = (0x0002 << 16) | 0x0001;
/**
 * El tono se pone por velocidad (estable con cualquier masa): cada paso se pide un cambio de giro
 * relativo hacia la pose del golpe (en TONE_T/tono segundos) y se aplica con la inercia del hijo, que
 * es menor que la que de verdad mueve la articulación: nunca se pasa.
 */
const TONE_T = 0.1;
/** Rozamiento de las articulaciones sin tono (fracción del giro relativo que se quita por paso). */
const FRICTION = 0.04;
/** Por debajo de esto (m/s) un sólido está casi quieto. */
const STILL = 0.22;
/**
 * Lo más que puede ganar de energía un cuerpo en un paso (J). Un cuerpo que cae no gana energía (no
 * tiene motor), pero a veces el solver sí se la mete: en un atropello, una articulación llevada al
 * límite contra el suelo podía lanzarlo por los aires. Si la gana, se le quita (todas sus velocidades
 * a escala). No cuenta al principio (los impulsos del golpe y el tono) ni al darse la vuelta.
 */
const ENERGY_SLACK = 3;
const GUARD_AFTER = 0.25;

/** Cuaterniones y vectores de ida y vuelta (nada nuevo por paso). */
interface Qt {
  x: number;
  y: number;
  z: number;
  w: number;
}
const q = () => ({ x: 0, y: 0, z: 0, w: 1 });
const qMul = (a: Qt, b: Qt, o: Qt) => {
  const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  o.x = x;
  o.y = y;
  o.z = z;
  o.w = w;
  return o;
};
const qConj = (a: Qt, o: Qt) => {
  o.x = -a.x;
  o.y = -a.y;
  o.z = -a.z;
  o.w = a.w;
  return o;
};
/** Rota el vector (x, y, z) por `a` y lo deja en `o`. */
const qRot = (a: Qt, x: number, y: number, z: number, o: { x: number; y: number; z: number }) => {
  const ix = a.w * x + a.y * z - a.z * y;
  const iy = a.w * y + a.z * x - a.x * z;
  const iz = a.w * z + a.x * y - a.y * x;
  const iw = -a.x * x - a.y * y - a.z * z;
  o.x = ix * a.w + iw * -a.x + iy * -a.z - iz * -a.y;
  o.y = iy * a.w + iw * -a.y + iz * -a.x - ix * -a.z;
  o.z = iz * a.w + iw * -a.z + ix * -a.y - iy * -a.x;
  return o;
};
/** Eje (unitario) y ángulo (0..π) de un giro. */
const axisAngle = (a: Qt, out: { x: number; y: number; z: number }) => {
  let { x, y, z, w } = a;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const s = Math.hypot(x, y, z);
  const angle = 2 * Math.atan2(s, w);
  if (s < 1e-6) {
    out.x = 1;
    out.y = 0;
    out.z = 0;
    return 0;
  }
  out.x = x / s;
  out.y = y / s;
  out.z = z / s;
  return angle;
};

const _qp = q();
const _qa = q();
const _ql = q();
const _qd = q();
const _qi = q();
const _qn = q();
const _ax = { x: 0, y: 0, z: 0 };
const _w = { x: 0, y: 0, z: 0 };
const _v = { x: 0, y: 0, z: 0 };

interface Joint {
  spec: RagdollJoint;
  frame: Qt;
  target: Qt;
  /** Ángulo de la bisagra en la pose del golpe. */
  targetAngle: number;
  mass: number;
  /** Inercia principal del hijo y su marco (en el del sólido). */
  inertia: { x: number; y: number; z: number };
  inertiaFrame: Qt;
}

class Ragdoll implements RagdollHandle {
  pos: Float32Array;
  quat: Float32Array;
  /** Tras el paso anterior y tras el último (lo que se dibuja va entre los dos: `blend`). */
  private pos0: Float32Array;
  private quat0: Float32Array;
  private pos1: Float32Array;
  private quat1: Float32Array;
  private fresh = true;
  speed = 0;
  spin = 0;
  age = 0;
  still = 0;
  alive = true;
  rolling = 0;
  rollT = 0;
  joints: Joint[];
  /** Masa e inercia de cada sólido (no cambian) y la energía del paso anterior (J). */
  private mass: number[];
  private inertia: { x: number; y: number; z: number }[];
  private inertiaFrame: Qt[];
  private energy: number | null = null;

  constructor(
    private owner: RagdollWorld,
    public bodies: Body[],
    spec: RagdollSpec,
    public tone: { start: number; min: number; tau: number },
  ) {
    this.pos = new Float32Array(bodies.length * 3);
    this.quat = new Float32Array(bodies.length * 4);
    this.pos0 = new Float32Array(bodies.length * 3);
    this.quat0 = new Float32Array(bodies.length * 4);
    this.pos1 = new Float32Array(bodies.length * 3);
    this.quat1 = new Float32Array(bodies.length * 4);
    this.mass = bodies.map((b) => b.mass());
    this.inertia = bodies.map((b) => ({ ...b.principalInertia() }));
    this.inertiaFrame = bodies.map((b) => ({ ...b.principalInertiaLocalFrame() }));
    this.joints = spec.joints.map((j) => {
      const target = { x: j.target[0], y: j.target[1], z: j.target[2], w: j.target[3] };
      return {
        spec: j,
        frame: { x: j.frame[0], y: j.frame[1], z: j.frame[2], w: j.frame[3] },
        target,
        targetAngle: j.hinge ? hingeAngle(target, j.hinge) : 0,
        mass: bodies[j.child]!.mass(),
        inertia: { ...bodies[j.child]!.principalInertia() },
        inertiaFrame: { ...bodies[j.child]!.principalInertiaLocalFrame() },
      };
    });
  }

  roll(dir: number) {
    this.rolling = dir;
    this.rollT = 0;
  }

  remove() {
    if (!this.alive) return;
    this.alive = false;
    this.owner.drop(this);
  }

  /** El tono de las articulaciones (los límites los pone Rapier) antes de cada paso. */
  drive() {
    const t = this.tone;
    const tone = t.min + (t.start - t.min) * Math.exp(-this.age / Math.max(0.05, t.tau));
    for (const j of this.joints) {
      const p = this.bodies[j.spec.parent]!, c = this.bodies[j.spec.child]!;
      const rp = p.rotation(), rc = c.rotation();
      // Giro local del hijo respecto a su padre (con los huesos fijos de en medio).
      qMul(rp as Qt, j.frame, _qa);
      qMul(qConj(_qa, _qi), rc as Qt, _ql);
      const wp = p.angvel(), wc = c.angvel();
      _w.x = wc.x - wp.x;
      _w.y = wc.y - wp.y;
      _w.z = wc.z - wp.z;
      // Cambio de giro relativo que se pide en este paso (rad/s, mundo).
      let dx: number, dy: number, dz: number;
      if (tone <= 0.02) {
        dx = -_w.x * FRICTION;
        dy = -_w.y * FRICTION;
        dz = -_w.z * FRICTION;
      } else if (j.spec.hinge) {
        const h = j.spec.hinge;
        qRot(_qa, h[0], h[1], h[2], _ax);
        const rel = _w.x * _ax.x + _w.y * _ax.y + _w.z * _ax.z;
        const d = ((j.targetAngle - hingeAngle(_ql, h)) / (TONE_T / tone) - rel) * 0.35 * tone;
        dx = _ax.x * d;
        dy = _ax.y * d;
        dz = _ax.z * d;
      } else {
        // Hacia la pose del golpe.
        qMul(j.target, qConj(_ql, _qi), _qd);
        const ang = axisAngle(_qd, _ax);
        qRot(_qa, _ax.x, _ax.y, _ax.z, _v);
        const k = 0.35 * tone, sp = ang / (TONE_T / tone);
        dx = (_v.x * sp - _w.x) * k;
        dy = (_v.y * sp - _w.y) * k;
        dz = (_v.z * sp - _w.z) * k;
      }
      // Impulso = inercia del hijo × cambio pedido (en su marco principal).
      qMul(rc as Qt, j.inertiaFrame, _qn);
      qRot(qConj(_qn, _qi), dx, dy, dz, _v);
      _v.x *= j.inertia.x;
      _v.y *= j.inertia.y;
      _v.z *= j.inertia.z;
      qRot(_qn, _v.x, _v.y, _v.z, _v);
      const max = 0.5 * j.mass;
      const mag = Math.hypot(_v.x, _v.y, _v.z);
      if (mag > max) {
        _v.x *= max / mag;
        _v.y *= max / mag;
        _v.z *= max / mag;
      }
      c.applyTorqueImpulse(_v, true);
      _v.x = -_v.x;
      _v.y = -_v.y;
      _v.z = -_v.z;
      p.applyTorqueImpulse(_v, true);
    }
    // Darse la vuelta (boca abajo → boca arriba): un empujón hacia arriba del tronco, como quien se
    // apoya en un brazo, y un giro sobre el eje del cuerpo (de la cadera al pecho).
    if (this.rolling) {
      this.rollT += STEP;
      // Hasta quedar boca arriba (el pecho mira a su +Z): ni un poco más.
      const r = this.bodies[2]!.rotation();
      const face = qRot(r as Qt, 0, 0, 1, _ax).y;
      if (face > 0.45 && this.rollT > 0.1) this.rolling = 0;
    }
    if (this.rolling) {
      const hips = this.bodies[0]!.translation(), chest = this.bodies[2]!.translation();
      let ax = chest.x - hips.x, ay = chest.y - hips.y, az = chest.z - hips.z;
      const l = Math.hypot(ax, ay, az) || 1;
      ax /= l;
      ay /= l;
      az /= l;
      for (const i of [0, 1, 2, 3]) {
        const b = this.bodies[i]!;
        const m = b.mass();
        if (this.rollT <= STEP * 1.5) b.applyImpulse({ x: 0, y: m * 1.5, z: 0 }, true);
        if (this.rollT > 0.75) continue;
        const w = b.angvel();
        const spin = w.x * ax + w.y * ay + w.z * az;
        const k = (7 * this.rolling - spin) * 0.3 * m * 0.03;
        _v.x = ax * k;
        _v.y = ay * k;
        _v.z = az * k;
        b.applyTorqueImpulse(_v, true);
      }
    }
  }

  /** Después de cada paso: si ha ganado energía, se le quita (ENERGY_SLACK). */
  guard() {
    let ke = 0, pe = 0;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]!;
      const v = b.linvel(), w = b.angvel(), m = this.mass[i]!, I = this.inertia[i]!;
      ke += 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z);
      // El giro, en los ejes principales del sólido.
      qMul(b.rotation() as Qt, this.inertiaFrame[i]!, _qn);
      qRot(qConj(_qn, _qi), w.x, w.y, w.z, _v);
      ke += 0.5 * (I.x * _v.x * _v.x + I.y * _v.y * _v.y + I.z * _v.z * _v.z);
      pe += m * 9.81 * b.translation().y;
    }
    const e = ke + pe;
    if (this.energy !== null && this.age > GUARD_AFTER && !this.rolling && e > this.energy + ENERGY_SLACK && ke > 1e-4) {
      const k = Math.sqrt(Math.max(0, this.energy - pe) / ke);
      for (const b of this.bodies) {
        const v = b.linvel(), w = b.angvel();
        b.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
        b.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
      }
    } else this.energy = e;
  }

  read(dt: number) {
    let speed = 0, spin = 0;
    this.pos0.set(this.pos1);
    this.quat0.set(this.quat1);
    const P = this.pos1, Q = this.quat1;
    this.bodies.forEach((b, i) => {
      const t = b.translation(), r = b.rotation(), v = b.linvel(), w = b.angvel();
      P[i * 3] = t.x;
      P[i * 3 + 1] = t.y;
      P[i * 3 + 2] = t.z;
      Q[i * 4] = r.x;
      Q[i * 4 + 1] = r.y;
      Q[i * 4 + 2] = r.z;
      Q[i * 4 + 3] = r.w;
      speed = Math.max(speed, Math.hypot(v.x, v.y, v.z));
      spin = Math.max(spin, Math.hypot(w.x, w.y, w.z));
    });
    if (this.fresh) {
      // Recién puesto: no hay paso anterior del que venir.
      this.fresh = false;
      this.pos0.set(P);
      this.quat0.set(Q);
      this.pos.set(P);
      this.quat.set(Q);
    }
    this.speed = speed;
    this.spin = spin;
    this.age += dt;
    this.still = speed < STILL && spin < 1.2 ? this.still + dt : 0;
  }

  /** Lo que se dibuja: entre el paso anterior y el último (`k`: 0 = el anterior, 1 = el último). */
  blend(k: number) {
    const p0 = this.pos0, p1 = this.pos1, q0 = this.quat0, q1 = this.quat1, P = this.pos, Q = this.quat;
    for (let i = 0; i < P.length; i++) P[i] = p0[i]! + (p1[i]! - p0[i]!) * k;
    for (let i = 0; i < Q.length; i += 4) {
      // Mezcla lineal normalizada, por el lado corto (entre dos pasos el giro es pequeño).
      const dot = q0[i]! * q1[i]! + q0[i + 1]! * q1[i + 1]! + q0[i + 2]! * q1[i + 2]! + q0[i + 3]! * q1[i + 3]!;
      const s = dot < 0 ? -1 : 1;
      const x = q0[i]! + (q1[i]! * s - q0[i]!) * k, y = q0[i + 1]! + (q1[i + 1]! * s - q0[i + 1]!) * k;
      const z = q0[i + 2]! + (q1[i + 2]! * s - q0[i + 2]!) * k, w = q0[i + 3]! + (q1[i + 3]! * s - q0[i + 3]!) * k;
      const l = Math.hypot(x, y, z, w) || 1;
      Q[i] = x / l;
      Q[i + 1] = y / l;
      Q[i + 2] = z / l;
      Q[i + 3] = w / l;
    }
  }
}

/** Ángulo (con signo) de un giro alrededor del eje `h` (el giro de una bisagra). */
function hingeAngle(a: Qt, h: readonly number[]) {
  const s = a.x * h[0]! + a.y * h[1]! + a.z * h[2]!;
  let ang = 2 * Math.atan2(s, a.w);
  if (ang > Math.PI) ang -= 2 * Math.PI;
  else if (ang < -Math.PI) ang += 2 * Math.PI;
  return ang;
}

export class RagdollWorld implements RagdollWorldApi {
  private world: InstanceType<R["World"]>;
  private statics: StaticWorld;
  private list: Ragdoll[] = [];
  private acc = 0;

  constructor(
    private R: R,
    source: StaticSource,
    private max: () => number,
  ) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    // Sin CCD: con las articulaciones, el CCD separa los sólidos al chocar (a estas velocidades no hace falta).
    this.world.numSolverIterations = 8;
    this.statics = new StaticWorld(R, this.world, source);
  }

  get active() {
    return this.list.length;
  }

  spawn(spec: RagdollSpec): RagdollHandle | null {
    if (this.list.length >= this.max()) return null;
    const R = this.R;
    this.statics.sync();
    const bodies = spec.parts.map((p) => {
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(p.pos[0], p.pos[1], p.pos[2])
          .setRotation({ x: p.quat[0], y: p.quat[1], z: p.quat[2], w: p.quat[3] })
          .setLinvel(spec.vel[0], spec.vel[1], spec.vel[2])
          .setLinearDamping(0.08)
          .setAngularDamping(0.7),
      );
      // La cápsula de `a` a `b` (en el marco del sólido): Rapier las hace a lo largo de su Y.
      const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], dz = p.b[2] - p.a[2];
      const len = Math.hypot(dx, dy, dz);
      const rot = fromY(dx / (len || 1), dy / (len || 1), dz / (len || 1));
      this.world.createCollider(
        R.ColliderDesc.capsule(Math.max(0.01, len / 2 - p.r * 0.5), p.r)
          .setTranslation((p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2)
          .setRotation(rot)
          .setDensity(p.density)
          .setFriction(spec.friction)
          .setRestitution(spec.bounce)
          .setCollisionGroups(GROUPS),
        body,
      );
      if (p.extra) {
        this.world.createCollider(
          R.ColliderDesc.ball(p.extra.r)
            .setTranslation(p.extra.at[0], p.extra.at[1], p.extra.at[2])
            .setDensity(p.density)
            .setFriction(spec.friction)
            .setRestitution(spec.bounce)
            .setCollisionGroups(GROUPS),
          body,
        );
      }
      return body;
    });
    for (const j of spec.joints) {
      const p = bodies[j.parent]!, c = bodies[j.child]!;
      const a1 = toLocal(p, j.anchor), a2 = toLocal(c, j.anchor);
      const data = j.hinge
        ? R.JointData.revolute(a1, a2, { x: j.hinge[0], y: j.hinge[1], z: j.hinge[2] })
        : R.JointData.spherical(a1, a2);
      const joint = this.world.createImpulseJoint(data, p, c, true);
      joint.setContactsEnabled(false);
      // Límites de Rapier (se resuelven con el resto: firmes también en las caídas fuertes).
      if (j.hinge && j.range) (joint as InstanceType<R["RevoluteImpulseJoint"]>).setLimits(j.range[0], j.range[1]);
      else if (j.min && j.max) {
        const raw = (this.world.impulseJoints as unknown as { raw: { jointSetLimits(h: number, axis: number, min: number, max: number): void } }).raw;
        for (let a = 0; a < 3; a++) raw.jointSetLimits(joint.handle, ANG_X + a, j.min[a]!, j.max[a]!);
      }
    }
    for (const im of spec.impulses) {
      const b = bodies[im.part];
      if (b) b.applyImpulseAtPoint({ x: im.vec[0], y: im.vec[1], z: im.vec[2] }, { x: im.point[0], y: im.point[1], z: im.point[2] }, true);
    }
    const doll = new Ragdoll(this, bodies, spec, { start: spec.tone, min: spec.toneMin, tau: spec.toneTau });
    doll.read(0);
    this.list.push(doll);
    return doll;
  }

  drop(d: Ragdoll) {
    const i = this.list.indexOf(d);
    if (i >= 0) this.list.splice(i, 1);
    for (const b of d.bodies) this.world.removeRigidBody(b);
  }

  step(dt: number) {
    if (!this.list.length) {
      this.acc = 0;
      return;
    }
    this.acc += Math.min(dt, MAX_STEPS * STEP);
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      for (const d of this.list) d.drive();
      this.world.step();
      this.acc -= STEP;
      steps++;
      for (const d of this.list) {
        d.guard();
        d.read(STEP);
      }
    }
    const k = Math.max(0, Math.min(1, this.acc / STEP));
    for (const d of this.list) d.blend(k);
  }
}

/** Giro que lleva el eje Y a la dirección (x, y, z) (unitaria). */
function fromY(x: number, y: number, z: number) {
  // Entre (0, 1, 0) y v: eje = Y × v, ángulo = acos(v.y).
  const d = y;
  if (d > 0.999999) return { x: 0, y: 0, z: 0, w: 1 };
  if (d < -0.999999) return { x: 1, y: 0, z: 0, w: 0 };
  const ax = z, az = -x;
  const s = Math.sqrt((1 + d) * 2);
  return { x: ax / s, y: 0, z: az / s, w: s / 2 };
}

/** Un punto del mundo en el marco de un sólido. */
function toLocal(b: Body, p: readonly number[]) {
  const t = b.translation(), r = b.rotation();
  const inv = { x: -r.x, y: -r.y, z: -r.z, w: r.w };
  return qRot(inv, p[0]! - t.x, p[1]! - t.y, p[2]! - t.z, { x: 0, y: 0, z: 0 });
}
