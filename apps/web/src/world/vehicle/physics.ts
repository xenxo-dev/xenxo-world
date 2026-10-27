/**
 * Física del coche con Rapier (Apache-2.0): un sólido rígido de verdad (masa, inercia, centro de
 * masas bajo) con cuatro ruedas de rayos (muelle, amortiguador y agarre de neumático), motor,
 * frenos, aire y rodadura. El mundo de Rapier se rellena con lo mismo con lo que choca el
 * personaje (las cajas y las mallas de collision.ts) y con la gente de las ciudades.
 *
 * Se carga aparte (import dinámico) solo cuando alguien saca el coche. Paso fijo de 1/60 s.
 * Nada nuevo por frame: los vectores de ida y vuelta son de módulo.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { CAR, type Drive } from "./car";

type R = typeof RAPIER;

/** Una caja sólida del mundo (como en collision.ts): centro, medio tamaño y giro en Y. */
export interface SolidBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  c: number;
  s: number;
}

/** De dónde sale lo sólido del lugar (collision.ts en el juego; datos de prueba en los tests). */
export interface StaticSource {
  version(): number;
  boxes(cb: (b: SolidBox) => void): void;
  meshes(cb: (id: string, positions: Float32Array, index: Uint32Array | null) => void): void;
  /** Límites del lugar en X y Z (paredes invisibles). */
  bounds(): [number, number];
}

/** Gente que se mueve (peatones y residentes): posiciones x, y (pies), z. */
export interface MovingPeople {
  count: number;
  at(i: number, out: { x: number; y: number; z: number }): void;
}

export interface CarState {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Velocidad hacia delante (m/s, negativa marcha atrás) y total. */
  speed: number;
  /** Giro de las ruedas delanteras (rad). */
  steer: number;
  /** Por rueda: altura del centro respecto al origen del coche y vueltas (rad). */
  wheelY: Float32Array;
  wheelSpin: Float32Array;
  /** Ruedas que pisan algo, derrape (velocidad de lado, m/s) y golpe del último paso (m/s perdidos). */
  contacts: number;
  slip: number;
  impact: number;
}

const STEP = 1 / 60;
const MAX_STEPS = 4;
const PEOPLE = 64;
const _p = { x: 0, y: 0, z: 0 };

let rapier: R | null = null;
/** Carga Rapier (WASM) una sola vez. */
export async function loadRapier(): Promise<R> {
  if (!rapier) {
    await RAPIER.init();
    rapier = RAPIER;
  }
  return rapier;
}

export class CarSim {
  private world: InstanceType<R["World"]>;
  private chassis: InstanceType<R["RigidBody"]> | null = null;
  private vehicle: ReturnType<InstanceType<R["World"]>["createVehicleController"]> | null = null;
  private statics: InstanceType<R["Collider"]>[] = [];
  private meshes = new Map<string, { col: InstanceType<R["Collider"]>; n: number }>();
  private walls: InstanceType<R["Collider"]>[] = [];
  private people: InstanceType<R["RigidBody"]>[] = [];
  private seen = -1;
  private acc = 0;
  private steerNow = 0;
  private lastSpeed = 0;
  private upsideDown = 0;
  readonly state: CarState = {
    x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, steer: 0,
    wheelY: new Float32Array(4), wheelSpin: new Float32Array(4), contacts: 0, slip: 0, impact: 0,
  };

  constructor(private R: R, private source: StaticSource, private crowd?: MovingPeople) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    // Gente: cilindros cinemáticos (se mueven solos; el coche choca con ellos y no los empuja).
    for (let i = 0; i < PEOPLE; i++) {
      const b = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -1000 - i * 3, 0));
      this.world.createCollider(R.ColliderDesc.cylinder(0.85, 0.3).setTranslation(0, 0.85, 0), b);
      this.people.push(b);
    }
  }

  /** Lo sólido del lugar: se rehace solo si ha cambiado (las mallas, solo las nuevas o quitadas). */
  syncStatic(force = false) {
    const v = this.source.version();
    if (!force && v === this.seen) return;
    this.seen = v;
    const R = this.R;
    for (const c of this.statics) this.world.removeCollider(c, false);
    this.statics = [];
    this.source.boxes((b) => {
      const yaw = Math.atan2(b.s, b.c);
      const desc = R.ColliderDesc.cuboid(Math.max(0.01, b.hx), Math.max(0.01, b.hy), Math.max(0.01, b.hz))
        .setTranslation(b.x, b.y, b.z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setFriction(0.8);
      this.statics.push(this.world.createCollider(desc));
    });
    const alive = new Set<string>();
    this.source.meshes((id, pos, index) => {
      alive.add(id);
      const n = pos.length;
      const had = this.meshes.get(id);
      if (had && had.n === n) return;
      if (had) this.world.removeCollider(had.col, false);
      let idx = index;
      if (!idx) {
        idx = new Uint32Array(n / 3);
        for (let i = 0; i < idx.length; i++) idx[i] = i;
      }
      const col = this.world.createCollider(R.ColliderDesc.trimesh(pos, idx).setFriction(0.9));
      this.meshes.set(id, { col, n });
    });
    for (const [id, m] of this.meshes)
      if (!alive.has(id)) {
        this.world.removeCollider(m.col, false);
        this.meshes.delete(id);
      }
    // Suelo de reserva (por si la malla del suelo aún no ha llegado) y paredes en los límites.
    for (const c of this.walls) this.world.removeCollider(c, false);
    this.walls = [];
    const [lo, hi] = this.source.bounds();
    const mid = (lo + hi) / 2, half = (hi - lo) / 2;
    const wall = (x: number, z: number, hx: number, hz: number) =>
      this.walls.push(this.world.createCollider(R.ColliderDesc.cuboid(hx, 20, hz).setTranslation(x, 19, z)));
    this.walls.push(this.world.createCollider(R.ColliderDesc.cuboid(half + 50, 1, half + 50).setTranslation(mid, -1, mid)));
    wall(lo - 1, mid, 1, half + 2);
    wall(hi + 1, mid, 1, half + 2);
    wall(mid, lo - 1, half + 2, 1);
    wall(mid, hi + 1, half + 2, 1);
  }

  /** Saca el coche en (x, y, z) mirando a `yaw` (0 = +Z). */
  spawn(x: number, y: number, z: number, yaw: number) {
    this.despawn();
    const R = this.R;
    this.syncStatic(true);
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y + 0.1, z)
        .setRotation(q)
        .setCcdEnabled(true)
        .setLinearDamping(0.02)
        .setAngularDamping(0.4)
        // Masa y centro de masas a mano (las cajas no pesan): bajo y algo adelantado, como un motor delantero.
        .setAdditionalMassProperties(
          CAR.mass,
          CAR.centerOfMass,
          { x: (CAR.mass / 12) * (CAR.height ** 2 + CAR.length ** 2), y: (CAR.mass / 12) * (CAR.width ** 2 + CAR.length ** 2), z: (CAR.mass / 12) * (CAR.width ** 2 + CAR.height ** 2) },
          { x: 0, y: 0, z: 0, w: 1 },
        ),
    );
    // Carrocería: la parte baja y el habitáculo (sin masa propia: la pone el sólido).
    this.world.createCollider(
      R.ColliderDesc.cuboid(CAR.width / 2 - 0.08, 0.28, CAR.length / 2 - 0.06).setTranslation(0, 0.46, CAR.centerZ).setDensity(0).setFriction(0.4).setRestitution(0.1),
      body,
    );
    this.world.createCollider(R.ColliderDesc.cuboid(0.72, 0.2, 1.0).setTranslation(0, 0.92, -0.15).setDensity(0).setFriction(0.4), body);
    const v = this.world.createVehicleController(body);
    v.indexUpAxis = 1;
    v.setIndexForwardAxis = 2;
    CAR.wheels.forEach((w, i) => {
      // El rayo de cada rueda sale de encima de su centro en reposo (lo que comprime el muelle a peso).
      v.addWheel({ x: w.x, y: w.y + CAR.suspensionRest - 0.08, z: w.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, CAR.suspensionRest, CAR.wheelRadius);
      v.setWheelMaxSuspensionTravel(i, CAR.suspensionTravel);
      v.setWheelSuspensionStiffness(i, CAR.suspensionStiffness);
      v.setWheelSuspensionCompression(i, CAR.suspensionCompression);
      v.setWheelSuspensionRelaxation(i, CAR.suspensionRelaxation);
      v.setWheelMaxSuspensionForce(i, CAR.suspensionMaxForce);
      v.setWheelFrictionSlip(i, w.front ? CAR.frictionFront : CAR.frictionRear);
      v.setWheelSideFrictionStiffness(i, 1);
    });
    this.chassis = body;
    this.vehicle = v;
    this.acc = 0;
    this.steerNow = 0;
    this.lastSpeed = 0;
    this.upsideDown = 0;
    this.read();
  }

  despawn() {
    if (this.vehicle) this.world.removeVehicleController(this.vehicle);
    if (this.chassis) this.world.removeRigidBody(this.chassis);
    this.vehicle = null;
    this.chassis = null;
  }

  get active() {
    return this.chassis !== null;
  }

  /** Avanza la simulación `dt` segundos con lo que pide quien conduce. */
  update(dt: number, drive: Drive) {
    const body = this.chassis, v = this.vehicle;
    if (!body || !v) return;
    this.syncStatic();
    this.acc = Math.min(this.acc + dt, STEP * MAX_STEPS);
    let impact = 0;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.movePeople();
      this.controls(drive, body, v);
      v.updateVehicle(STEP);
      this.world.step();
      const sp = v.currentVehicleSpeed();
      impact = Math.max(impact, Math.abs(this.lastSpeed) - Math.abs(sp));
      this.lastSpeed = sp;
      this.recover(body);
    }
    this.read();
    this.state.impact = impact;
  }

  private controls(drive: Drive, body: InstanceType<R["RigidBody"]>, v: NonNullable<CarSim["vehicle"]>) {
    const speed = v.currentVehicleSpeed();
    const fwd = speed;
    // Dirección: más giro en parado que a toda velocidad; el volante va a su ritmo.
    const max = CAR.steerMax / (1 + Math.abs(fwd) / CAR.steerSpeedFalloff);
    const want = -drive.steer * max;
    const d = want - this.steerNow;
    const stepMax = CAR.steerRate * STEP;
    this.steerNow += Math.max(-stepMax, Math.min(stepMax, d));
    // Acelerar, frenar o marcha atrás según hacia dónde se va.
    const t = drive.throttle;
    let engine = 0;
    let brake = 0;
    if (t > 0.05) {
      if (fwd < -0.8) brake = CAR.brake * t;
      else engine = CAR.engineForce * t * Math.max(0, 1 - (fwd / CAR.topSpeed) ** 2);
    } else if (t < -0.05) {
      if (fwd > 0.8) brake = CAR.brake * -t;
      else engine = -CAR.engineForce * 0.7 * -t * Math.max(0, 1 - (fwd / CAR.reverseSpeed) ** 2);
    } else brake = CAR.engineBrake;
    for (let i = 0; i < 4; i++) {
      const front = CAR.wheels[i]!.front;
      v.setWheelSteering(i, front ? this.steerNow : 0);
      v.setWheelEngineForce(i, front ? 0 : engine);
      const hand = drive.handbrake && !front;
      v.setWheelBrake(i, hand ? CAR.handbrake : brake);
      if (!front) v.setWheelFrictionSlip(i, hand ? CAR.frictionRearHandbrake : CAR.frictionRear);
    }
    // Aire y rodadura, contra la velocidad.
    const lv = body.linvel();
    const sp = Math.hypot(lv.x, lv.y, lv.z);
    body.resetForces(true);
    if (sp > 0.05) {
      const f = CAR.drag * sp * sp + CAR.rolling;
      body.addForce({ x: (-lv.x / sp) * f, y: (-lv.y / sp) * f, z: (-lv.z / sp) * f }, true);
    }
  }

  /** Si se queda volcado unos segundos, se endereza solo (en su sitio, un poco más alto). */
  private recover(body: InstanceType<R["RigidBody"]>) {
    const r = body.rotation();
    const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
    this.upsideDown = upY < 0.35 ? this.upsideDown + STEP : 0;
    if (this.upsideDown > 2) {
      const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
      const p = body.translation();
      body.setTranslation({ x: p.x, y: p.y + 1.2, z: p.z }, true);
      body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.upsideDown = 0;
    }
  }

  private movePeople() {
    const c = this.crowd;
    const n = c ? Math.min(c.count, PEOPLE) : 0;
    for (let i = 0; i < PEOPLE; i++) {
      const b = this.people[i]!;
      if (i < n) {
        c!.at(i, _p);
        b.setNextKinematicTranslation(_p);
      } else if (b.translation().y > -500) b.setNextKinematicTranslation({ x: 0, y: -1000 - i * 3, z: 0 });
    }
  }

  private read() {
    const body = this.chassis, v = this.vehicle, s = this.state;
    if (!body || !v) return;
    const p = body.translation(), q = body.rotation();
    s.x = p.x;
    s.y = p.y;
    s.z = p.z;
    s.qx = q.x;
    s.qy = q.y;
    s.qz = q.z;
    s.qw = q.w;
    s.speed = v.currentVehicleSpeed();
    s.steer = this.steerNow;
    let contacts = 0;
    for (let i = 0; i < 4; i++) {
      const w = CAR.wheels[i]!;
      const len = v.wheelSuspensionLength(i) ?? CAR.suspensionRest;
      s.wheelY[i] = w.y + CAR.suspensionRest - 0.08 - len;
      s.wheelSpin[i] = v.wheelRotation(i) ?? 0;
      if (v.wheelIsInContact(i)) contacts++;
    }
    s.contacts = contacts;
    // Derrape: la velocidad de lado (en el eje X del coche), solo con ruedas en el suelo.
    const lv = body.linvel();
    const rx = 1 - 2 * (q.y * q.y + q.z * q.z), ry = 2 * (q.x * q.y + q.w * q.z), rz = 2 * (q.x * q.z - q.w * q.y);
    s.slip = contacts ? Math.abs(lv.x * rx + lv.y * ry + lv.z * rz) : 0;
  }

  dispose() {
    this.despawn();
    this.world.free();
  }
}
