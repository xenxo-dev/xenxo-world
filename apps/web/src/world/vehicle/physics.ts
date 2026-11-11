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

/**
 * Los coches de los demás, tal como se dibujan (en el juego, vehicle/rivals.ts: los de quien conduce
 * cerca). El coche propio choca con ellos. Cada cliente lleva solo su coche y ve a los demás con su
 * retraso, así que cada uno choca con lo que ve: aquí son sólidos que van a donde se les dibuja, con
 * su masa (un choque reparte la velocidad entre los dos, no es darse contra un muro) y sin giro
 * propio. Lo que mi golpe desplace al otro se ve al momento (`ox`, `oy`, `oz`) y se va deshaciendo:
 * su coche de verdad lo lleva él, y su pose dirá qué le ha pasado.
 */
export interface OtherCars {
  /** Llama a `cb` con cada coche que cuenta ahora (alguien lo conduce y se está viendo). */
  each(cb: (key: string, c: OtherCar) => void): void;
}
export interface OtherCar {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Lo que mi coche lo ha desplazado de ahí (lo escribe la física; quien lo dibuja lo suma). */
  ox: number;
  oy: number;
  oz: number;
}

/**
 * Coches de los demás a la vez (los más que caben en una parrilla), y cuándo cuentan como sólidos:
 * solo en marcha los dos, el suyo y el mío (desde `RIVAL_ON` m/s, hasta bajar de `RIVAL_OFF`). Uno
 * parado se atraviesa: así nadie corta la pista dejando el coche cruzado, a nadie lo embisten parado
 * y no estorban los de la parrilla. Uno que aparece de golpe (llega de lejos) no cuenta durante
 * `RIVAL_JUMP_S`, y ninguno empieza a contar estando ya encima del mío. Tampoco el que sube o baja
 * a plomo (más de `RIVAL_STEEP` m/s en vertical), hasta `RIVAL_STEEP_S` después: lo llevan de vuelta
 * a la pista (y va a posarse donde quizá paso yo), se ha caído de ella o va por el looping, que no
 * es sitio para empujones.
 */
const RIVALS = 15;
const RIVAL_ON = 3;
const RIVAL_OFF = 1.2;
const RIVAL_JUMP = 70;
const RIVAL_JUMP_S = 0.8;
const RIVAL_STEEP = 12;
const RIVAL_STEEP_S = 2.5;
/**
 * Lo que pesa el coche de otro en un choque, respecto al mío: lo mismo (quien alcanza a otro pierde
 * de golpe media diferencia de velocidad, y el resto mientras lo sigue empujando).
 */
const RIVAL_MASS = 1;
/**
 * Tras un toque, el coche del otro no vuelve de golpe a donde se dibuja (sería un muro que empuja
 * con toda su fuerza): durante `RIVAL_HOT_S` (y mientras siga desplazado) vuelve tirado por un
 * muelle con tope de velocidad (`RIVAL_PULL_V`, m/s) y de aceleración (`RIVAL_PULL_A`, m/s²).
 * Deja de contar un momento (`RIVAL_REST_S`: se atraviesa) si no hay manera:
 * - se queda a más de `RIVAL_FAR` m, o lleva `RIVAL_HOT_MAX` s sin conseguir volver;
 * - o me está pasando por encima: su sitio (donde se dibujaría sin mi coche en medio) lleva
 *   `RIVAL_OVER_S` s metido `RIVAL_OVER` m en el mío, y es él quien viene hacia mí. En su pantalla
 *   no ha chocado conmigo, así que aquí me da el golpe, pero no me lleva por delante. (Si soy yo
 *   quien lo alcanza, no: me quedo detrás.)
 */
const RIVAL_HOT_S = 0.5;
const RIVAL_PULL = 2.5;
const RIVAL_PULL_V = 2.5;
const RIVAL_PULL_A = 40;
const RIVAL_FAR = 8;
const RIVAL_HOT_MAX = 2.5;
const RIVAL_OVER_S = 0.12;
const RIVAL_OVER = 1;
/** El bloque con el que se choca (CarSim.block): su altura y el radio de sus cantos (m). */
const RIVAL_TALL = 1.7;
const RIVAL_ROUND = 0.3;
const RIVAL_REST_S = 0.6;
/**
 * Grupos de choque: lo sólido del lugar (1), los coches de los demás (2) y la carrocería del mío (4).
 * Los de los demás solo chocan con mi carrocería: ni con el lugar (van a donde se les dibuja, que
 * entre dos poses puede cortar por dentro de una curva o del looping) ni entre ellos. Y las ruedas
 * (rayos) solo pisan el lugar.
 */
export const SOLID_GROUPS = (0x0001 << 16) | 0xffff;
const CHASSIS_GROUPS = (0x0004 << 16) | 0xffff;
const RIVAL_GROUPS = (0x0002 << 16) | 0x0004;
const WHEEL_GROUPS = (0xffff << 16) | 0x0001;

interface Proxy {
  key: string;
  /** Su ficha (de quien los apunta): ahí se escribe lo desplazado. */
  ref: OtherCar | null;
  body: InstanceType<R["RigidBody"]>;
  solid: boolean;
  /** Visto en esta pasada. */
  seen: boolean;
  /** Lo último que se ha dibujado, su velocidad (suavizada) y dónde tiene que estar al acabar los pasos de este frame. */
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  speed: number;
  tx: number;
  ty: number;
  tz: number;
  /** Dónde estaría ahora, paso a paso, si nadie lo hubiera tocado. */
  gx: number;
  gy: number;
  gz: number;
  /** La velocidad que se le mandó en el último paso: si sale con otra, es que mi coche lo ha tocado. */
  cx: number;
  cy: number;
  cz: number;
  /**
   * Tras un toque: `away` = mi coche lo ha sacado de su sitio y aún no ha vuelto; `hot`, los segundos
   * que le quedan de volver «con muelle» (se renueva con cada toque); `hotFor`, los que lleva seguidos
   * fuera de su sitio, y `press`, los que lleva pasándome por encima.
   */
  away: boolean;
  hot: number;
  hotFor: number;
  press: number;
  /** Lo desplazado respecto a lo que se dibuja. */
  ox: number;
  oy: number;
  oz: number;
  /** Dónde estaba antes de un paso de más de la física (`holdOthers`). */
  sx: number;
  sy: number;
  sz: number;
  /** Segundos que le quedan sin contar (acaba de aparecer, ha dado un salto o se ha quedado atascado). */
  wait: number;
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
  /** Velocidad hacia delante (m/s, negativa marcha atrás). */
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
/** De vuelta a la pista (`CarSim.carry`): m/s hacia arriba, de lado y al posarse, y cuánto pasa por encima (m). */
const CARRY_UP = 26;
const CARRY_ACROSS = 30;
const CARRY_DOWN = 5;
const CARRY_OVER = 2.2;
const PEOPLE = 64;
const _p = { x: 0, y: 0, z: 0 };
const _v3 = { x: 0, y: 0, z: 0 };
const _q4 = { x: 0, y: 0, z: 0, w: 1 };
/** De mi coche al otro, en planta (lo deja `overlaps`). */
const _d = { x: 0, z: 0 };

/** Hasta dónde llegan las paredes del borde del lugar (m): por encima de la pista del cielo de Arcade y de lo que se salte desde ella. */
const WALL_TOP = 90;

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
        .setFriction(0.8)
        .setCollisionGroups(SOLID_GROUPS);
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
      const col = this.world.createCollider(R.ColliderDesc.trimesh(pos, idx, R.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.9).setCollisionGroups(SOLID_GROUPS));
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
      this.walls.push(this.world.createCollider(R.ColliderDesc.cuboid(hx, WALL_TOP / 2 + 0.5, hz).setTranslation(x, WALL_TOP / 2 - 0.5, z).setCollisionGroups(SOLID_GROUPS)));
    this.walls.push(this.world.createCollider(R.ColliderDesc.cuboid(half + 50, 1, half + 50).setTranslation(mid, -1, mid).setCollisionGroups(SOLID_GROUPS)));
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
  /**
   * Lo llevan de vuelta a la pista (`carry`): a dónde y mirando hacia dónde. Mientras dura no hay
   * física: el coche sube, cruza y baja a su ritmo, sin chocar con nada.
   */
  private toX = 0;
  private toY = 0;
  private toZ = 0;
  private toYaw = 0;
  private carried = false;

  /** Los coches de los demás: un sólido por cada uno (se crean al hacer falta y se reutilizan). */
  private proxies: Proxy[] = [];
  private byKey = new Map<string, Proxy>();
  /** ¿Va en marcha el mío? (Parado no choca con los de los demás.) */
  private rolling = false;
  /** Coches de los demás con los que se choca ahora mismo (para las pruebas). */
  rivalsSolid = 0;

  constructor(private R: R, private source: StaticSource, private crowd?: MovingPeople, private others?: OtherCars) {
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
    this.shell(body);
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
    this.restRivals();
    this.capture();
    this.read();
  }

  /**
   * La carrocería de un coche (sin masa propia: la pone el sólido): un casco con el morro y la cola
   * en cuña —como en un coche de verdad, van más altos que los bajos— y el habitáculo. Con una caja
   * hasta abajo, al empezar a subir por una rampa curva o por el looping el morro se clavaba en la
   * pista y el coche se frenaba en seco: dentro del looping (9 m de radio) el firme sube 19 cm bajo
   * el morro, más lo que se hunda la suspensión.
   * La chapa resbala contra lo que roce (se queda con el rozamiento menor de los dos): rozar un
   * quitamiedos, una pared u otro coche de refilón frena un poco, pero no clava el morro ni hace un
   * trompo. El agarre es cosa de las ruedas, que van aparte.
   */
  private shell(body: InstanceType<R["RigidBody"]>) {
    const R = this.R;
    const skin = (d: InstanceType<R["ColliderDesc"]>) =>
      d.setDensity(0).setFriction(CAR.bodyFriction).setFrictionCombineRule(R.CoefficientCombineRule.Min).setRestitution(0.1).setCollisionGroups(CHASSIS_GROUPS);
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
    if (tub) this.world.createCollider(skin(tub), body);
    this.world.createCollider(skin(R.ColliderDesc.roundCuboid(0.72 - rd, 0.2 - rd, 1.0 - rd, rd).setTranslation(0, 0.92, -0.15)), body);
  }

  /**
   * El coche de otro, para chocar con él: no su carrocería, sino un bloque con su planta, de cantos
   * bien redondos y más alto que el coche. Con dos cascos como el mío (el morro y la cola en cuña),
   * al darse por detrás la cola del uno se subía al morro del otro y salía dando una vuelta de
   * campana: contra un bloque el golpe va siempre de lado, nunca por debajo ni por encima.
   */
  private block(body: InstanceType<R["RigidBody"]>) {
    const R = this.R;
    const hw = CAR.width / 2 - 0.08, hl = CAR.length / 2 - 0.06, hh = RIVAL_TALL / 2, rd = RIVAL_ROUND;
    this.world.createCollider(
      R.ColliderDesc.roundCuboid(hw - rd, hh - rd, hl - rd, rd)
        .setTranslation(0, hh, CAR.centerZ)
        .setDensity(0)
        .setFriction(CAR.bodyFriction)
        .setFrictionCombineRule(R.CoefficientCombineRule.Min)
        .setRestitution(0.1)
        .setCollisionGroups(RIVAL_GROUPS),
      body,
    );
  }

  /**
   * Los coches de los demás, una vez por frame: dónde se dibuja cada uno, su velocidad y si cuenta
   * ya como sólido; los que han dejado de verse se apagan. `lead`: lo que el último paso de la física
   * irá por delante de lo que se dibuja (s): ahí se les lleva, para que mi coche y los suyos estén
   * en el mismo momento.
   */
  private watchOthers(dt: number, me: InstanceType<R["RigidBody"]>, lead: number) {
    const o = this.others;
    if (!o) return;
    const lv = me.linvel();
    this.rolling = Math.hypot(lv.x, lv.y, lv.z) > (this.rolling ? RIVAL_OFF : RIVAL_ON);
    for (const p of this.proxies) p.seen = false;
    this.frameDt = dt;
    this.lead = lead;
    this.mine = me;
    o.each(this.seeOther);
    this.mine = null;
    const fade = Math.exp(-dt / 0.12);
    for (const p of this.proxies) {
      if (!p.seen && p.key) {
        // Ya no cuenta (ha dejado de conducir, se ha ido, no corre en mi carrera): se suelta.
        this.byKey.delete(p.key);
        p.key = "";
        if (p.solid) this.park(p);
        p.solid = false;
        p.ox = p.oy = p.oz = 0;
        if (p.ref) p.ref.ox = p.ref.oy = p.ref.oz = 0;
        p.ref = null;
      } else if (p.seen && !p.solid && (p.ox !== 0 || p.oy !== 0 || p.oz !== 0)) {
        // Ha dejado de contar estando desplazado: lo que se dibuja vuelve a su sitio en un momento.
        p.ox *= fade;
        p.oy *= fade;
        p.oz *= fade;
        if (Math.abs(p.ox) + Math.abs(p.oy) + Math.abs(p.oz) < 0.005) p.ox = p.oy = p.oz = 0;
        if (p.ref) {
          p.ref.ox = p.ox;
          p.ref.oy = p.oy;
          p.ref.oz = p.oz;
        }
      }
    }
  }
  private frameDt = 0;
  private lead = 0;
  private mine: InstanceType<R["RigidBody"]> | null = null;
  private seeOther = (key: string, c: OtherCar) => {
    let p = this.byKey.get(key);
    const dt = this.frameDt;
    if (!p) {
      p = this.proxies.find((x) => !x.key);
      if (!p) {
        if (this.proxies.length >= RIVALS) return;
        const body = this.world.createRigidBody(
          this.R.RigidBodyDesc.dynamic().setTranslation(c.x, c.y, c.z).setGravityScale(0).lockRotations().setCanSleep(false).setAdditionalMass(CAR.mass * RIVAL_MASS),
        );
        this.block(body);
        p = {
          key: "", ref: null, body, solid: false, seen: false, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, speed: 0,
          tx: 0, ty: 0, tz: 0, gx: 0, gy: 0, gz: 0, cx: 0, cy: 0, cz: 0, away: false, hot: 0, hotFor: 0, press: 0, ox: 0, oy: 0, oz: 0, sx: 0, sy: 0, sz: 0, wait: 0,
        };
        this.proxies.push(p);
        this.park(p);
      }
      p.key = key;
      this.byKey.set(key, p);
      p.vx = p.vy = p.vz = p.speed = 0;
      p.ox = p.oy = p.oz = 0;
      // Recién visto: que se mueva un momento antes de contar (aún no se sabe a qué velocidad va).
      p.wait = 0.25;
    } else if (dt > 1e-4) {
      const vx = (c.x - p.x) / dt, vy = (c.y - p.y) / dt, vz = (c.z - p.z) / dt;
      if (Math.hypot(vx, vy, vz) > RIVAL_JUMP) {
        p.wait = RIVAL_JUMP_S;
        p.vx = p.vy = p.vz = 0;
      } else {
        const k = Math.min(1, dt * 12);
        p.vx += (vx - p.vx) * k;
        p.vy += (vy - p.vy) * k;
        p.vz += (vz - p.vz) * k;
      }
      p.speed = Math.hypot(p.vx, p.vy, p.vz);
      p.wait = Math.abs(p.vy) > RIVAL_STEEP ? Math.max(p.wait, RIVAL_STEEP_S) : Math.max(0, p.wait - dt);
    }
    p.seen = true;
    p.ref = c;
    p.x = c.x;
    p.y = c.y;
    p.z = c.z;
    p.qx = c.qx;
    p.qy = c.qy;
    p.qz = c.qz;
    p.qw = c.qw;
    const lead = this.lead;
    p.tx = p.x + p.vx * lead;
    p.ty = p.y + p.vy * lead;
    p.tz = p.z + p.vz * lead;
    const want = this.rolling && p.wait <= 0 && p.speed > (p.solid ? RIVAL_OFF : RIVAL_ON);
    if (want && !p.solid) {
      // Solo si no está ya encima del mío: aparecer dentro sería salir despedido.
      if (this.mine && this.overlaps(this.mine, p, p.x, p.y, p.z, 0.4)) return;
      p.gx = p.x;
      p.gy = p.y;
      p.gz = p.z;
      p.cx = p.vx;
      p.cy = p.vy;
      p.cz = p.vz;
      p.hot = p.hotFor = p.press = 0;
      p.away = false;
      p.ox = p.oy = p.oz = 0;
      p.body.setTranslation({ x: p.x, y: p.y, z: p.z }, false);
      p.body.setRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw }, false);
      p.body.setLinvel({ x: p.vx, y: p.vy, z: p.vz }, false);
      p.body.setEnabled(true);
      p.solid = true;
    } else if (!want && p.solid) this.rest(p, 0);
  };

  /** Deja de contar (se atraviesa) durante `wait` s; lo que estuviera desplazado se deshace a la vista. */
  private rest(p: Proxy, wait: number) {
    if (p.solid) this.park(p);
    p.solid = false;
    p.away = false;
    p.hot = p.hotFor = p.press = 0;
    p.wait = Math.max(p.wait, wait);
  }

  /**
   * Fuera de la partida: apagado y, además, lejos. Solo apagado no basta: al rehacerse lo sólido
   * del lugar (llega un modelo, alguien aparca) Rapier volvía a contar con él, y el coche propio
   * chocaba con un coche que no se veía, parado donde lo dejó el último choque.
   */
  private park(p: Proxy) {
    const b = p.body;
    _v3.x = _v3.y = _v3.z = 0;
    b.setLinvel(_v3, false);
    _v3.y = -9000 - this.proxies.indexOf(p) * 20;
    b.setTranslation(_v3, false);
    b.setEnabled(false);
  }

  /** Mi coche se ha colocado de golpe (al sacarlo, al enderezarlo, al llevarlo a su cajón): nadie cuenta un momento. */
  restRivals(wait = RIVAL_REST_S) {
    for (const p of this.proxies) this.rest(p, wait);
  }

  /**
   * ¿Se pisan en planta (y a parecida altura) mi coche y otro puesto en (x, y, z) mirando como `p`?
   * `margin`: con ese hueco de más entre los dos (o, en negativo, metidos al menos eso).
   */
  private overlaps(me: InstanceType<R["RigidBody"]>, p: Proxy, x: number, y: number, z: number, margin: number): boolean {
    const t = me.translation(), q = me.rotation();
    if (Math.abs(t.y - y) > CAR.height + 0.4) return false;
    const hw = CAR.width / 2 + margin / 2, hl = CAR.length / 2 + margin / 2;
    // Hacia dónde mira cada uno en planta, y su centro (el origen del coche va algo atrasado).
    const afx = 2 * (q.x * q.z + q.w * q.y), afz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const bfx = 2 * (p.qx * p.qz + p.qw * p.qy), bfz = 1 - 2 * (p.qx * p.qx + p.qy * p.qy);
    const al = Math.hypot(afx, afz) || 1, bl = Math.hypot(bfx, bfz) || 1;
    const ax = afx / al, az = afz / al, bx = bfx / bl, bz = bfz / bl;
    const dx = x + bx * CAR.centerZ - (t.x + ax * CAR.centerZ), dz = z + bz * CAR.centerZ - (t.z + az * CAR.centerZ);
    _d.x = dx;
    _d.z = dz;
    // Ejes separadores: los dos de cada caja (a lo largo: (x, z); a lo ancho: (z, −x)).
    const cos = Math.abs(ax * bx + az * bz), sin = Math.abs(ax * bz - az * bx);
    if (Math.abs(dx * ax + dz * az) > hl + hl * cos + hw * sin) return false;
    if (Math.abs(dx * az - dz * ax) > hw + hw * cos + hl * sin) return false;
    if (Math.abs(dx * bx + dz * bz) > hl + hl * cos + hw * sin) return false;
    if (Math.abs(dx * bz - dz * bx) > hw + hw * cos + hl * sin) return false;
    return true;
  }

  /**
   * Un paso de los coches de los demás (quedan `left` en este frame). Sin tocarlo nadie, cada uno
   * va justo a donde le toca (lo que le falta hasta donde se dibuja, repartido en los pasos que
   * quedan). Si mi coche lo ha tocado —sale del paso con otra velocidad que la que se le mandó—,
   * se queda con la que le ha dado el choque y vuelve a su sitio tirado por un muelle con tope.
   */
  private moveOthers(left: number, me: InstanceType<R["RigidBody"]>) {
    const k = 1 / Math.max(1, left);
    for (const p of this.proxies) {
      if (!p.solid) continue;
      const b = p.body;
      const t = b.translation(), v = b.linvel();
      if (Math.abs(v.x - p.cx) + Math.abs(v.y - p.cy) + Math.abs(v.z - p.cz) > 0.03) {
        p.hot = RIVAL_HOT_S;
        p.away = true;
      }
      // Su sitio tras este paso, y lo desplazado antes de él.
      const nx = p.gx + (p.tx - p.gx) * k, ny = p.gy + (p.ty - p.gy) * k, nz = p.gz + (p.tz - p.gz) * k;
      let ex = p.gx - t.x, ey = p.gy - t.y, ez = p.gz - t.z;
      if (p.away) {
        // Un golpe solo lo desplaza en su plano (adelante, atrás y a los lados), nunca hacia arriba
        // o hacia abajo: no tiene peso ni ruedas que lo sujeten, y el morro de mi coche, al cabecear,
        // lo iba levantando hasta pasarle por debajo.
        const ux = 2 * (p.qx * p.qy - p.qw * p.qz), uy = 1 - 2 * (p.qx * p.qx + p.qz * p.qz), uz = 2 * (p.qy * p.qz + p.qw * p.qx);
        const lift = ex * ux + ey * uy + ez * uz;
        const rise = (v.x - (nx - p.gx) / STEP) * ux + (v.y - (ny - p.gy) / STEP) * uy + (v.z - (nz - p.gz) / STEP) * uz;
        ex -= ux * lift;
        ey -= uy * lift;
        ez -= uz * lift;
        t.x += ux * lift;
        t.y += uy * lift;
        t.z += uz * lift;
        v.x -= ux * rise;
        v.y -= uy * rise;
        v.z -= uz * rise;
        b.setTranslation(t, true);
      }
      const off = Math.hypot(ex, ey, ez);
      if (p.away && p.hot <= 0 && off < 0.05) p.away = false;
      if (!p.away) {
        // Nadie lo ha tocado: a su sitio justo (lo que se haya ido —un redondeo— se recoge en este paso).
        p.hotFor = p.press = 0;
        p.cx = (nx - t.x) / STEP;
        p.cy = (ny - t.y) / STEP;
        p.cz = (nz - t.z) / STEP;
      } else {
        p.hot -= STEP;
        p.hotFor = off > 0.3 ? p.hotFor + STEP : 0;
        // ¿Me pasa por encima? Su sitio, metido en mi coche, y viniendo él hacia mí (de su sitio al
        // mío, `_d`): lo que avanza su sitio en este paso va en esa dirección.
        const over = this.overlaps(me, p, p.gx, p.gy, p.gz, -RIVAL_OVER) && (nx - p.gx) * -_d.x + (nz - p.gz) * -_d.z > 0.5 * STEP * Math.hypot(_d.x, _d.z);
        p.press = over ? p.press + STEP : 0;
        if (off > RIVAL_FAR || p.hotFor > RIVAL_HOT_MAX || p.press > RIVAL_OVER_S) {
          this.rest(p, RIVAL_REST_S);
          continue;
        }
        // La velocidad de su sitio más lo que tira el muelle (con tope), y hacia ella con aceleración limitada.
        const pull = off > 1e-6 ? Math.min(off * RIVAL_PULL, RIVAL_PULL_V) / off : 0;
        const wx = (nx - p.gx) / STEP + ex * pull, wy = (ny - p.gy) / STEP + ey * pull, wz = (nz - p.gz) / STEP + ez * pull;
        const dx = wx - v.x, dy = wy - v.y, dz = wz - v.z;
        const d = Math.hypot(dx, dy, dz);
        const a = d > 1e-6 ? Math.min(d, RIVAL_PULL_A * STEP) / d : 0;
        p.cx = v.x + dx * a;
        p.cy = v.y + dy * a;
        p.cz = v.z + dz * a;
      }
      p.gx = nx;
      p.gy = ny;
      p.gz = nz;
      _v3.x = p.cx;
      _v3.y = p.cy;
      _v3.z = p.cz;
      b.setLinvel(_v3, true);
      // El giro, el que se dibuja (el choque no lo cambia).
      const r = b.rotation();
      const sign = r.x * p.qx + r.y * p.qy + r.z * p.qz + r.w * p.qw < 0 ? -1 : 1;
      const qx = r.x + (p.qx * sign - r.x) * k, qy = r.y + (p.qy * sign - r.y) * k, qz = r.z + (p.qz * sign - r.z) * k, qw = r.w + (p.qw * sign - r.w) * k;
      const l = Math.hypot(qx, qy, qz, qw) || 1;
      _q4.x = qx / l;
      _q4.y = qy / l;
      _q4.z = qz / l;
      _q4.w = qw / l;
      b.setRotation(_q4, true);
    }
  }

  /** Para un paso de más de la física (ver `stale`): apunta dónde está cada uno y, después, lo devuelve ahí con su velocidad. */
  private holdOthers(before: boolean) {
    for (const p of this.proxies) {
      if (!p.solid) continue;
      if (before) {
        const t = p.body.translation();
        p.sx = t.x;
        p.sy = t.y;
        p.sz = t.z;
      } else {
        _v3.x = p.sx;
        _v3.y = p.sy;
        _v3.z = p.sz;
        p.body.setTranslation(_v3, true);
        _v3.x = p.cx;
        _v3.y = p.cy;
        _v3.z = p.cz;
        p.body.setLinvel(_v3, true);
      }
    }
  }

  /** Tras los pasos del frame: lo que cada uno ha quedado desplazado de donde se dibuja, para quien lo dibuja. */
  private readOthers() {
    let solid = 0;
    for (const p of this.proxies) {
      if (!p.solid) continue;
      solid++;
      const t = p.body.translation();
      p.ox = t.x - p.gx;
      p.oy = t.y - p.gy;
      p.oz = t.z - p.gz;
      if (Math.abs(p.ox) + Math.abs(p.oy) + Math.abs(p.oz) < 0.005) p.ox = p.oy = p.oz = 0;
      if (p.ref) {
        p.ref.ox = p.ox;
        p.ref.oy = p.oy;
        p.ref.oz = p.oz;
      }
    }
    this.rivalsSolid = solid;
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
    if (this.carried) {
      this.carryStep(dt, body);
      this.read();
      const s = this.state;
      s.speed = s.slip = s.impact = 0;
      s.contacts = 0;
      return;
    }
    this.acc = Math.min(this.acc + dt, STEP * MAX_STEPS);
    // Los pasos de este frame (contados como los cuenta el bucle) y lo que sobrará tras ellos.
    let left = 0, rest = this.acc;
    while (rest >= STEP) {
      rest -= STEP;
      left++;
    }
    const steps = left;
    this.watchOthers(dt, body, STEP - rest);
    let impact = 0;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.simTime += STEP;
      // Un paso del mundo antes de lanzar los rayos de las ruedas si algo sólido ha cambiado (`stale`).
      // Ese paso no es de nadie: los coches de los demás se quedan donde estaban.
      if (this.stale) {
        this.stale = false;
        this.holdOthers(true);
        this.world.step();
        this.holdOthers(false);
      }
      impact = Math.max(impact, this.hitPeople(body));
      this.controls(drive, body, v);
      // Las ruedas solo pisan lo sólido del lugar (no los coches de los demás, que van y vienen).
      v.updateVehicle(STEP, undefined, WHEEL_GROUPS);
      this.moveOthers(left--, body);
      this.world.step();
      const sp = v.currentVehicleSpeed();
      impact = Math.max(impact, Math.abs(this.lastSpeed) - Math.abs(sp));
      this.lastSpeed = sp;
      this.recover(body);
      this.capture();
    }
    if (steps > 0) this.readOthers();
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
    this.restRivals();
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
   * De vuelta a la pista: lleva el coche a (x, y, z) mirando a `yaw`, sin física y sin chocar con
   * nada (se ha caído de una pista en alto: vehicle/rescue.ts). Sube en vertical, cruza por encima y
   * baja, a un ritmo que el servidor da por bueno (no es un salto: §7 «Movimiento»): hasta
   * `CARRY_UP` m/s en vertical y `CARRY_ACROSS` en horizontal. Al llegar se queda parado, sobre sus
   * ruedas, y vuelve la física.
   */
  carry(x: number, y: number, z: number, yaw: number) {
    if (!this.chassis) return;
    this.toX = x;
    this.toY = y;
    this.toZ = z;
    this.toYaw = yaw;
    this.carried = true;
    this.restRivals(1.5);
  }

  /** ¿Lo llevan de vuelta a la pista ahora mismo? */
  get carrying() {
    return this.carried;
  }

  private carryStep(dt: number, body: InstanceType<R["RigidBody"]>) {
    const p = body.translation(), q = body.rotation();
    const dx = this.toX - p.x, dz = this.toZ - p.z, flat = Math.hypot(dx, dz);
    // Primero arriba (un poco por encima de donde va), después de lado y, ya encima, abajo.
    const over = this.toY + CARRY_OVER;
    let nx = p.x, ny = p.y, nz = p.z;
    if (flat > 0.05) {
      if (p.y < over - 0.05) ny = Math.min(over, p.y + CARRY_UP * dt);
      else {
        const k = Math.min(1, (CARRY_ACROSS * dt) / flat);
        nx += dx * k;
        nz += dz * k;
        ny = over;
      }
    } else {
      nx = this.toX;
      nz = this.toZ;
      ny = Math.max(this.toY, p.y - CARRY_DOWN * dt);
    }
    // Y se va poniendo derecho, mirando hacia donde sigue la pista.
    const g = Math.min(1, dt * 5);
    const tw = Math.cos(this.toYaw / 2), ty = Math.sin(this.toYaw / 2);
    const sign = q.y * ty + q.w * tw < 0 ? -1 : 1;
    const qx = q.x * (1 - g), qy = q.y + (ty * sign - q.y) * g, qz = q.z * (1 - g), qw = q.w + (tw * sign - q.w) * g;
    const l = Math.hypot(qx, qy, qz, qw) || 1;
    _v3.x = nx;
    _v3.y = ny;
    _v3.z = nz;
    body.setTranslation(_v3, true);
    _q4.x = qx / l;
    _q4.y = qy / l;
    _q4.z = qz / l;
    _q4.w = qw / l;
    body.setRotation(_q4, true);
    _v3.x = _v3.y = _v3.z = 0;
    body.setLinvel(_v3, true);
    body.setAngvel(_v3, true);
    this.acc = 0;
    this.jumped = true;
    this.capture();
    if (flat <= 0.05 && ny <= this.toY + 1e-3) {
      // Ha llegado: derecho del todo, y la física vuelve con todo en su sitio.
      _q4.x = 0;
      _q4.y = ty;
      _q4.z = 0;
      _q4.w = tw;
      body.setRotation(_q4, true);
      this.carried = false;
      this.stale = true;
      this.steerNow = 0;
      this.lastSpeed = 0;
      this.upsideDown = this.stuck = 0;
      this.exiting = this.flatFor = 0;
      this.jumped = true;
      this.capture();
    }
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
      this.restRivals();
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
