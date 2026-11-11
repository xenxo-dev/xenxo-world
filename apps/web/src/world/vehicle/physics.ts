/**
 * Física del coche con Rapier (Apache-2.0): un sólido rígido de verdad (masa, inercia, centro de
 * masas bajo) con cuatro ruedas de rayos (muelle, amortiguador y agarre de neumático), motor,
 * frenos, aire y rodadura. El mundo de Rapier se rellena con lo mismo con lo que choca el
 * personaje (las cajas y las mallas de collision.ts) y con la gente de las ciudades.
 *
 * Se carga aparte (import dinámico) solo cuando alguien saca el coche. Paso fijo de 1/60 s; lo que
 * se dibuja va entre el paso anterior y el último (`state`), para que se vea fluido a cualquier tasa
 * de frames. Nada nuevo por frame: los vectores de ida y vuelta son de módulo.
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

/**
 * Gente que se mueve (ciudadanos y residentes): posiciones x, y (pies), z. Si el coche le da a
 * alguien, `hit` le dice hacia dónde sale despedido (horizontal, unitario) y a qué velocidad iba el
 * coche contra él (m/s).
 */
export interface MovingPeople {
  count: number;
  at(i: number, out: { x: number; y: number; z: number }): void;
  /** Le da el coche; false si no cuenta (ya está en el suelo: se le pasa por encima). */
  hit?(i: number, nx: number, nz: number, speed: number): boolean | void;
}

/** Masa de una persona (kg): lo que el coche pierde al llevársela por delante. */
const PERSON_MASS = 80;
/** Medio ancho de una persona (m) y cuánto tarda en poder volver a recibir un golpe (s). */
const PERSON_R = 0.3;
const HIT_COOLDOWN = 2;

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

/** Dónde está el coche tras un paso de la física: posición, giro y, por rueda, altura y vueltas. */
interface Snap {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  wheelY: Float32Array;
  wheelSpin: Float32Array;
}
const snap = (): Snap => ({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, wheelY: new Float32Array(4), wheelSpin: new Float32Array(4) });
function copySnap(from: Snap, to: Snap) {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.qx = from.qx;
  to.qy = from.qy;
  to.qz = from.qz;
  to.qw = from.qw;
  to.wheelY.set(from.wheelY);
  to.wheelSpin.set(from.wheelSpin);
}

let rapier: R | null = null;
/** Carga Rapier (WASM) una sola vez. */
export async function loadRapier(): Promise<R> {
  if (!rapier) {
    await RAPIER.init();
    rapier = RAPIER;
  }
  return rapier;
}

/**
 * Lo sólido del lugar dentro de un mundo de Rapier (las cajas y las mallas de collision.ts, un suelo
 * de reserva y paredes en los límites): lo comparten el coche y las caídas del modo pelea.
 */
export class StaticWorld {
  private statics: InstanceType<R["Collider"]>[] = [];
  private meshes = new Map<string, { col: InstanceType<R["Collider"]>; n: number }>();
  private walls: InstanceType<R["Collider"]>[] = [];
  private seen = -1;

  constructor(private R: R, private world: InstanceType<R["World"]>, private source: StaticSource) {}

  /**
   * Se rehace solo si ha cambiado (las mallas, solo las nuevas o quitadas). Devuelve true si ha
   * rehecho algo: hasta el siguiente paso del mundo, los rayos (las ruedas del coche) aún ven lo
   * que se acaba de quitar.
   */
  sync(force = false): boolean {
    const v = this.source.version();
    if (!force && v === this.seen) return false;
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
      // Con las aristas de dentro arregladas (une los vértices repetidos y mira los triángulos de al
      // lado): rozando una pared hecha de muchos triángulos, la esquina de una caja se enganchaba en
      // cada junta como si fuera un escalón (el coche se paraba en seco contra un quitamiedos liso).
      const col = this.world.createCollider(R.ColliderDesc.trimesh(pos, idx, R.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.9));
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
    return true;
  }
}

export class CarSim {
  private world: InstanceType<R["World"]>;
  private chassis: InstanceType<R["RigidBody"]> | null = null;
  private vehicle: ReturnType<InstanceType<R["World"]>["createVehicleController"]> | null = null;
  private statics: StaticWorld;
  /** Cuándo le dio el coche por última vez a cada hueco de la gente (s de simulación). */
  private lastHit = new Float64Array(PEOPLE).fill(-1e9);
  private simTime = 0;
  private acc = 0;
  private steerNow = 0;
  private lastSpeed = 0;
  private upsideDown = 0;
  /** Ruedas apoyadas en el último paso. */
  private touching = 0;
  private stuck = 0;
  /**
   * La salida del looping: `exiting` = segundos que lleva bajando (0 = no está en ello), `flatFor` =
   * los que lleva ya en llano (ahí se acaba la ayuda) y `lane`, hacia dónde va la pista (en planta).
   */
  private laneX = 0;
  private laneZ = 0;
  private exiting = 0;
  private flatFor = 0;
  /**
   * Se ha quitado o puesto algo sólido (el coche mismo al sacarlo, lo sólido del lugar al cambiar)
   * y el mundo aún no ha dado un paso. Los rayos de las ruedas buscan en un índice que solo se pone
   * al día al dar el paso: si se lanzan antes, pueden dar con lo que ya no está (al sacar el coche
   * por segunda vez, con el anterior) y la física se va al infinito: el coche desaparecía.
   */
  private stale = true;
  /**
   * El coche tras el paso anterior y tras el último. La física va a 60 pasos por segundo y la pantalla
   * a lo que vaya (90, 120, 144…): dibujando solo el último paso, a 144 Hz el coche no se movía en más
   * de la mitad de los frames y se veía a tirones (y, con él, todo: la cámara lo sigue). `state` va
   * entre los dos, según lo que falte para el paso siguiente.
   */
  private before = snap();
  private now = snap();
  /** Se ha colocado de golpe (al sacarlo, al enderezarlo): ese salto no se suaviza. */
  private jumped = true;
  readonly state: CarState = {
    x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, steer: 0,
    wheelY: new Float32Array(4), wheelSpin: new Float32Array(4), contacts: 0, slip: 0, impact: 0,
  };

  constructor(private R: R, private source: StaticSource, private crowd?: MovingPeople) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.statics = new StaticWorld(R, this.world, source);
  }

  /** Lo sólido del lugar (StaticWorld): se rehace solo si ha cambiado. */
  syncStatic(force = false) {
    if (this.statics.sync(force)) this.stale = true;
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
    // Carrocería (sin masa propia: la pone el sólido): un casco con el morro y la cola en cuña —como
    // en un coche de verdad, van más altos que los bajos— y el habitáculo. Con una caja hasta abajo,
    // al empezar a subir por una rampa curva o por el looping el morro se clavaba en la pista y el
    // coche se frenaba en seco: dentro del looping (9 m de radio) el firme sube 19 cm bajo el morro,
    // más lo que se hunda la suspensión.
    // La chapa resbala contra lo que roce (se queda con el rozamiento menor de los dos): rozar un
    // quitamiedos o una pared de refilón frena un poco, pero no clava el morro ni hace un trompo.
    // El agarre es cosa de las ruedas, que van aparte.
    const shell = (d: InstanceType<R["ColliderDesc"]>) => d.setDensity(0).setFriction(CAR.bodyFriction).setFrictionCombineRule(R.CoefficientCombineRule.Min).setRestitution(0.1);
    const hw = CAR.width / 2 - 0.08;
    const tail = CAR.centerZ - CAR.length / 2 + 0.06, nose = CAR.centerZ + CAR.length / 2 - 0.06;
    // Con los cantos redondeados (`round`: el casco se da con esos centímetros de menos y se engorda
    // otros tantos): una arista viva rozando una pared de triángulos se engancha en cada junta.
    const hull: number[] = [];
    const rd = CAR.hull.round;
    const rearZ = CAR.wheels[2]!.z + 0.1, frontZ = CAR.wheels[0]!.z - 0.1;
    for (const side of [-1, 1]) {
      // Por abajo (más estrecho que el coche: los bajos van por dentro de las ruedas, así al
      // balancearse no es la chapa la que toca el suelo): cola, eje trasero, eje delantero y morro.
      const x = side * (CAR.hull.keel - rd);
      hull.push(x, CAR.hull.tail + rd, tail + rd, x, CAR.hull.belly + rd, rearZ, x, CAR.hull.belly + rd, frontZ, x, CAR.hull.nose + rd, nose - rd);
      // El costado a todo lo ancho, del estribo a la línea de la cintura.
      const w = side * (hw - rd);
      hull.push(w, CAR.hull.sill + 0.06 + rd, tail + rd, w, CAR.hull.sill + rd, rearZ, w, CAR.hull.sill + rd, frontZ, w, CAR.hull.sill + 0.08 + rd, nose - rd);
      hull.push(w, CAR.hull.top - rd, tail + rd, w, CAR.hull.top - rd, nose - rd);
    }
    const tub = R.ColliderDesc.roundConvexHull(new Float32Array(hull), rd);
    if (tub) this.world.createCollider(shell(tub), body);
    this.world.createCollider(shell(R.ColliderDesc.roundCuboid(0.72 - rd, 0.2 - rd, 1.0 - rd, rd).setTranslation(0, 0.92, -0.15)), body);
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
    this.stale = true;
    this.acc = 0;
    this.steerNow = 0;
    this.lastSpeed = 0;
    this.upsideDown = 0;
    this.stuck = 0;
    this.touching = 0;
    this.exiting = 0;
    this.flatFor = 0;
    this.jumped = true;
    this.capture();
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
      this.simTime += STEP;
      // Un paso del mundo antes de lanzar los rayos de las ruedas si algo sólido ha cambiado (`stale`).
      if (this.stale) {
        this.stale = false;
        this.world.step();
      }
      impact = Math.max(impact, this.hitPeople(body));
      this.controls(drive, body, v);
      v.updateVehicle(STEP);
      this.world.step();
      const sp = v.currentVehicleSpeed();
      impact = Math.max(impact, Math.abs(this.lastSpeed) - Math.abs(sp));
      this.lastSpeed = sp;
      this.recover(body);
      this.capture();
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
    // ¿En una pared o del revés (el looping)? Muy empinado hacia arriba o hacia abajo, o con el
    // suelo del coche mirando de lado o al cielo, y con ruedas apoyadas (las del paso anterior).
    const q = body.rotation();
    const fx = 2 * (q.x * q.z + q.w * q.y), fy = 2 * (q.y * q.z - q.w * q.x), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const ux = 2 * (q.x * q.y - q.w * q.z), upY = 1 - 2 * (q.x * q.x + q.z * q.z), uz = 2 * (q.y * q.z + q.w * q.x);
    const looping = this.touching >= 2 && (Math.abs(fy) > 0.5 || upY < 0.2);
    // La salida del looping (CAR.loopExitGrip). Empieza pasado lo alto (del revés y con el morro ya
    // hacia abajo) y se acaba al volver al llano. El rumbo de la pista sale del propio looping:
    // bajando, el suelo del coche mira hacia delante (hacia el centro de la vuelta), así que su
    // parte horizontal es la dirección del carril, entre por donde entre y venga como venga.
    const flat = this.touching >= 2 && Math.abs(fy) < 0.12 && upY > 0.95;
    if (this.exiting > 0) {
      this.exiting += STEP;
      this.flatFor = flat ? this.flatFor + STEP : 0;
      const h = Math.hypot(ux, uz);
      if (h > 0.35 && fy < 0 && this.touching >= 2) {
        // Suavizado: el balanceo de la carrocería (un toque con el quitamiedos) no lo tuerce.
        const lx = this.laneX + (ux / h - this.laneX) * 0.1, lz = this.laneZ + (uz / h - this.laneZ) * 0.1;
        const l = Math.hypot(lx, lz) || 1;
        this.laneX = lx / l;
        this.laneZ = lz / l;
      }
      const turned = upY > 0.5 && fx * this.laneX + fz * this.laneZ < 0.3;
      if (this.flatFor > 0.3 || this.exiting > 8 || Math.abs(fwd) < 3 || turned) this.exiting = 0;
    } else if (looping && upY < -0.3 && fy < -0.05) {
      // Arriba va del revés: su morro mira hacia atrás (más o menos: lo afina la bajada).
      const h = Math.hypot(fx, fz) || 1;
      this.laneX = -fx / h;
      this.laneZ = -fz / h;
      this.exiting = STEP;
      this.flatFor = 0;
    }
    const exiting = this.exiting > 0;
    let touching = 0;
    for (let i = 0; i < 4; i++) {
      const front = CAR.wheels[i]!.front;
      // En el looping las ruedas casi no agarran de lado: al coche lo llevan los quitamiedos (la
      // pista se va desplazando hacia el otro carril), sin que los neumáticos se empeñen en seguir
      // recto y acabe haciendo un trompo contra ellos.
      v.setWheelSideFrictionStiffness(i, looping || exiting ? CAR.loopSideGrip : 1);
      v.setWheelSteering(i, front ? this.steerNow : 0);
      v.setWheelEngineForce(i, front ? 0 : engine);
      const hand = drive.handbrake && !front;
      v.setWheelBrake(i, hand ? CAR.handbrake : brake);
      if (!front) v.setWheelFrictionSlip(i, hand ? CAR.frictionRearHandbrake : CAR.frictionRear);
      // Topes: cuanto más aplastado va el muelle, más duro (ver CAR.bumpFrom).
      const squeeze = CAR.suspensionRest - (v.wheelSuspensionLength(i) ?? CAR.suspensionRest);
      const over = Math.max(0, Math.min(1, (squeeze - CAR.bumpFrom) / (CAR.suspensionTravel - CAR.bumpFrom)));
      v.setWheelSuspensionStiffness(i, CAR.suspensionStiffness * (1 + CAR.bumpGain * over));
      if (v.wheelIsInContact(i)) touching++;
    }
    this.touching = touching;
    // Aire y rodadura, contra la velocidad.
    const lv = body.linvel();
    const sp = Math.hypot(lv.x, lv.y, lv.z);
    body.resetForces(true);
    if (sp > 0.05) {
      const f = CAR.drag * sp * sp + CAR.rolling;
      body.addForce({ x: (-lv.x / sp) * f, y: (-lv.y / sp) * f, z: (-lv.z / sp) * f }, true);
    }
    // Apoyo aerodinámico: hacia el suelo del coche (no hacia abajo del mundo), con ruedas apoyadas.
    if (touching >= 2 && sp > 1) {
      const f = -CAR.downforce * sp * sp;
      body.addForce({ x: ux * f, y: upY * f, z: uz * f }, true);
    }
    // Subiendo por una pared o del revés (el looping), con las ruedas apoyadas y sin frenar: no se
    // queda sin velocidad a media vuelta (se caería de espaldas desde lo alto). Es una ayuda de
    // recreativa: quien entra despacio da la vuelta igual, solo que más lento.
    // (Con el coche parado a media subida, basta dar gas; sin gas solo ayuda a quien ya va lanzado.)
    if (touching >= 2 && !drive.handbrake && t > -0.05 && (fy > 0.5 || upY < 0.2) && (t > 0.3 ? fwd > -1 : fwd > 3) && fwd < CAR.loopHold) {
      const f = CAR.mass * CAR.loopPush * Math.min(1, (CAR.loopHold - fwd) / 3);
      body.addForce({ x: fx * f, y: fy * f, z: fz * f }, true);
    }
    // Bajando del looping: lo que lleve de lado respecto al rumbo con que entró se va perdiendo (el
    // quitamiedos de fuera lo sigue llevando al otro carril, y al acabar sale recto).
    if (exiting && touching >= 2) {
      const ax = -this.laneZ, az = this.laneX;
      // Ya en llano (los últimos metros), más deprisa: que no se lleve lo que le queda de lado.
      const cut = (lv.x * ax + lv.z * az) * (1 - Math.exp(-CAR.loopExitGrip * (flat ? 3 : 1) * STEP));
      lv.x -= ax * cut;
      lv.z -= az * cut;
      body.setLinvel(lv, true);
    }
    // Y el morro, hacia donde va de verdad (lo que mandan los quitamiedos): gira sobre su propio eje
    // vertical hasta mirar a su velocidad. Sin esto saldría del looping mirando hacia un lado.
    if ((looping || exiting) && touching >= 2 && sp > 4) {
      // La velocidad, sobre el suelo del coche.
      const along = lv.x * ux + lv.y * upY + lv.z * uz;
      let vx = lv.x - ux * along, vy = lv.y - upY * along, vz = lv.z - uz * along;
      const vl = Math.hypot(vx, vy, vz);
      if (vl > 3) {
        vx /= vl;
        vy /= vl;
        vz /= vl;
        if (fx * vx + fy * vy + fz * vz > 0.3) {
          // (adelante × velocidad) · arriba = el seno de lo que le falta por girar.
          const turn = ((fy * vz - fz * vy) * ux + (fz * vx - fx * vz) * upY + (fx * vy - fy * vx) * uz) * CAR.loopAlign;
          const av = body.angvel();
          const add = (turn - (av.x * ux + av.y * upY + av.z * uz)) * CAR.loopAlignBlend;
          body.setAngvel({ x: av.x + ux * add, y: av.y + upY * add, z: av.z + uz * add }, true);
        }
      }
    }
    // En el aire: el morro hacia donde se vuela (si va más o menos de frente; dando vueltas, no).
    if (touching === 0 && sp > 6) {
      const vx = lv.x / sp, vy = lv.y / sp, vz = lv.z / sp;
      if (fx * vx + fy * vy + fz * vz > 0.5) {
        const av = body.angvel();
        const k = CAR.airAlign, b = CAR.airBlend;
        // Adelante × velocidad: el giro que lleva el morro a la dirección de vuelo (sin alabeo).
        body.setAngvel(
          { x: av.x + ((fy * vz - fz * vy) * k - av.x) * b, y: av.y + ((fz * vx - fx * vz) * k - av.y) * b, z: av.z + ((fx * vy - fy * vx) * k - av.z) * b },
          true,
        );
      }
    }
  }

  /**
   * Lleva el coche hacia (x, z) mirando a `yaw` sin pasar por la física, a `speed` m/s como mucho
   * (colocarlo en su cajón de la parrilla): la altura no se toca, sigue apoyado en sus muelles.
   * Devuelve true cuando ya está en su sitio.
   */
  slide(x: number, z: number, yaw: number, dt: number, speed = 26): boolean {
    const body = this.chassis;
    if (!body) return true;
    const p = body.translation(), q = body.rotation();
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    const cur = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    let turn = yaw - cur;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    if (d < 0.03 && Math.abs(turn) < 0.01) return true;
    // Rápido de lejos y suave al llegar; el giro, a la vez.
    const k = d > 1e-6 ? Math.min(d, Math.min(speed, 2 + d * 5) * dt) / d : 0;
    const a = cur + turn * Math.min(1, dt * 6);
    body.setTranslation({ x: p.x + dx * k, y: p.y, z: p.z + dz * k }, true);
    body.setRotation({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    return false;
  }

  /**
   * Una placa de turbo: `kick` m/s más hacia delante, sin pasar de `max` (ni frenar a quien ya va
   * más rápido). Solo con ruedas en el suelo.
   */
  turbo(kick: number = CAR.turboKick, max: number = CAR.turboMax): boolean {
    const body = this.chassis, v = this.vehicle;
    if (!body || !v || this.touching < 2) return false;
    const speed = v.currentVehicleSpeed();
    const add = Math.min(kick, max - speed);
    if (speed < 2 || add <= 0) return false;
    const q = body.rotation();
    const fx = 2 * (q.x * q.z + q.w * q.y), fy = 2 * (q.y * q.z - q.w * q.x), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const lv = body.linvel();
    body.setLinvel({ x: lv.x + fx * add, y: lv.y + fy * add, z: lv.z + fz * add }, true);
    return true;
  }

  /**
   * Si se queda volcado unos segundos, se endereza solo (en su sitio, un poco más alto). Con las
   * ruedas apoyadas no está volcado, por mucho que el suelo del coche mire al cielo: va por un
   * peralte o por lo alto del looping.
   */
  private recover(body: InstanceType<R["RigidBody"]>) {
    const r = body.rotation();
    const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
    // (Volcado y casi quieto: por el aire, cayendo del revés, no se endereza a media caída.)
    const lv = body.linvel();
    const moving = Math.hypot(lv.x, lv.y, lv.z);
    this.upsideDown = upY < 0.35 && this.touching < 2 && moving < 3 ? this.upsideDown + STEP : 0;
    // Tampoco se queda tirado de lado o colgado de un quitamiedos: quieto y sin ruedas en el suelo.
    this.stuck = this.touching === 0 && moving < 0.6 ? this.stuck + STEP : 0;
    if (this.upsideDown > 2 || this.stuck > 2.5) {
      this.stuck = 0;
      const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
      const p = body.translation();
      body.setTranslation({ x: p.x, y: p.y + 1.2, z: p.z }, true);
      body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.upsideDown = 0;
      this.jumped = true;
    }
  }

  /**
   * Atropellos: la gente no es un poste (el coche se clavaba en seco contra ella), sino una masa de
   * 80 kg. Quien esté dentro de la planta del coche (más su medio ancho) y a la altura de la
   * carrocería sale despedido hacia fuera del coche y el coche pierde el impulso que le da.
   * Devuelve el golpe (m/s) para el sonido.
   */
  private hitPeople(body: InstanceType<R["RigidBody"]>): number {
    const c = this.crowd;
    if (!c || !c.hit) return 0;
    const t = body.translation(), q = body.rotation(), lv = body.linvel();
    // Ejes del coche en el mundo (adelante = +Z, izquierda = +X).
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const lx = 1 - 2 * (q.y * q.y + q.z * q.z), lz = 2 * (q.x * q.z - q.w * q.y);
    const hw = CAR.width / 2 + PERSON_R, hl = CAR.length / 2 + PERSON_R;
    const n = Math.min(c.count, PEOPLE);
    let bang = 0;
    for (let i = 0; i < n; i++) {
      c.at(i, _p);
      if (_p.y > t.y + CAR.height || _p.y + 1.7 < t.y) continue;
      const dx = _p.x - t.x, dz = _p.z - t.z;
      const along = dx * fx + dz * fz - CAR.centerZ, side = dx * lx + dz * lz;
      if (Math.abs(along) > hl || Math.abs(side) > hw) continue;
      if (this.simTime - this.lastHit[i]! < HIT_COOLDOWN) continue;
      // Hacia dónde sale: lejos del centro del coche, y sobre todo hacia donde va el coche.
      let nx = dx, nz = dz;
      const d = Math.hypot(nx, nz) || 1;
      nx /= d;
      nz /= d;
      const speed = lv.x * nx + lv.z * nz;
      if (speed < 0.6) continue; // rozándola parado o alejándose: nada
      const sp = Math.hypot(lv.x, lv.z) || 1;
      const ox = nx * 0.4 + (lv.x / sp) * 0.6, oz = nz * 0.4 + (lv.z / sp) * 0.6;
      const od = Math.hypot(ox, oz) || 1;
      if (c.hit(i, ox / od, oz / od, speed) === false) continue;
      this.lastHit[i] = this.simTime;
      // Choque casi plástico: el coche le da su velocidad a la persona y pierde ese impulso.
      const j = (PERSON_MASS * CAR.mass) / (PERSON_MASS + CAR.mass) * speed;
      body.applyImpulse({ x: -nx * j, y: 0, z: -nz * j }, true);
      bang = Math.max(bang, speed * 0.6);
    }
    return bang;
  }

  /** Apunta dónde ha quedado el coche tras un paso (el de antes pasa a ser «el anterior»). */
  private capture() {
    const body = this.chassis, v = this.vehicle;
    if (!body || !v) return;
    const a = this.before, b = this.now;
    copySnap(b, a);
    const p = body.translation(), q = body.rotation();
    b.x = p.x;
    b.y = p.y;
    b.z = p.z;
    b.qx = q.x;
    b.qy = q.y;
    b.qz = q.z;
    b.qw = q.w;
    for (let i = 0; i < 4; i++) {
      const len = v.wheelSuspensionLength(i) ?? CAR.suspensionRest;
      b.wheelY[i] = CAR.wheels[i]!.y + CAR.suspensionRest - 0.08 - len;
      b.wheelSpin[i] = v.wheelRotation(i) ?? 0;
    }
    if (this.jumped) {
      copySnap(b, a);
      this.jumped = false;
    }
  }

  /** Lo que se dibuja: entre el paso anterior y el último, según lo que falte para el siguiente. */
  private read() {
    const body = this.chassis, v = this.vehicle, s = this.state;
    if (!body || !v) return;
    const a = this.before, b = this.now;
    const k = Math.max(0, Math.min(1, this.acc / STEP));
    s.x = a.x + (b.x - a.x) * k;
    s.y = a.y + (b.y - a.y) * k;
    s.z = a.z + (b.z - a.z) * k;
    // Giro: mezcla lineal normalizada (entre dos pasos seguidos el giro es pequeño), por el lado corto.
    const dot = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
    const sign = dot < 0 ? -1 : 1;
    const qx = a.qx + (b.qx * sign - a.qx) * k, qy = a.qy + (b.qy * sign - a.qy) * k;
    const qz = a.qz + (b.qz * sign - a.qz) * k, qw = a.qw + (b.qw * sign - a.qw) * k;
    const ql = Math.hypot(qx, qy, qz, qw) || 1;
    s.qx = qx / ql;
    s.qy = qy / ql;
    s.qz = qz / ql;
    s.qw = qw / ql;
    s.speed = v.currentVehicleSpeed();
    s.steer = this.steerNow;
    let contacts = 0;
    for (let i = 0; i < 4; i++) {
      s.wheelY[i] = a.wheelY[i]! + (b.wheelY[i]! - a.wheelY[i]!) * k;
      s.wheelSpin[i] = a.wheelSpin[i]! + (b.wheelSpin[i]! - a.wheelSpin[i]!) * k;
      if (v.wheelIsInContact(i)) contacts++;
    }
    s.contacts = contacts;
    // Derrape: la velocidad de lado (en el eje X del coche), solo con ruedas en el suelo.
    const lv = body.linvel(), q = body.rotation();
    const rx = 1 - 2 * (q.y * q.y + q.z * q.z), ry = 2 * (q.x * q.y + q.w * q.z), rz = 2 * (q.x * q.z - q.w * q.y);
    s.slip = contacts ? Math.abs(lv.x * rx + lv.y * ry + lv.z * rz) : 0;
  }

  dispose() {
    this.despawn();
    this.world.free();
  }
}
