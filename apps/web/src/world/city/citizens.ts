/**
 * La gente de las ciudades: pocos ciudadanos (diez por distrito, catorce en Distrito Cero), cada uno
 * con su cara, su forma de ser y su día. Son los mismos para todos los del distrito (§9 nonies): el
 * servidor elige a uno de los que están (`CityLink`) que los mueve aquí ("host") y reparte su estado;
 * los demás los dibujan como llegan ("replica": con un poco de retraso, como a las personas) y le
 * cuentan lo que les hacen. Sin red (o sin nadie que los lleve), cada cliente los mueve para sí
 * ("local"). Se portan como gente:
 *
 *   - **Van a sitios** (city/nav.ts): se sientan en los bancos, juegan a las máquinas, sacan algo de
 *     la expendedora, miran escaparates y anuncios, esperan con el móvil, charlan en los corros de
 *     Distrito Cero o bailan en su esquina (y otros se paran a mirar); si se cruzan dos con ganas de
 *     hablar, se paran a charlar.
 *   - **Se dan cuenta de ti** (y de las demás personas): te miran al pasar, te rodean, contestan a tus
 *     gestos (saludar, aplaudir, reírse, bailar, la reverencia, señalar…), te siguen un rato si los
 *     llamas con la mano, chocan los cinco, te dan la mano o un abrazo si se lo propones desde la rueda
 *     y después te saludan al verte.
 *   - **Física de verdad**: andan con el mismo cuerpo que tu personaje (suelo, bordillos, la escalera
 *     de la pasarela, paredes, el coche aparcado), se empujan con su masa entre ellos y, si te echas
 *     encima, les empujas; si corres contra alguien, trastabilla; un golpe fuerte o el coche los tira
 *     con la física de las caídas (knock.ts) y se levantan donde han caído. Si ven venir el coche,
 *     saltan a un lado.
 *   - **Recuerdan**: si les pegas o los atropellas, te tienen miedo y rencor un rato (se apartan, se
 *     van y no te contestan); si ven una pelea, unos miran desde lejos y otros se van; si estás en modo
 *     pelea cerca, los más miedosos se apartan. A cada persona, lo suyo: a quien le pega, a quien saluda.
 *
 * Solo se dibujan los más cercanos (`FEATURES.pedestrians`); el resto sigue su vida por el mapa, sin
 * física. Todo lo de fuera (tú, las demás personas, el coche, la física, las caídas) llega por
 * `CityEnv` (city/env.ts): así esto corre también en Node (test/citizens.mts). Sin objetos nuevos por
 * frame (solo al decidir un camino nuevo).
 */
import * as THREE from "three";
import { PAIR_RANGE, type NpcHitKind, type NpcSnap, type PairAction } from "@xenxo/protocol";
import { createMotion, type Motion } from "../motion";
import { createFx, type PersonFx } from "../people/rig";
import { PAIR, pairTargets } from "../people/pair";
import { mine, remoteFeet, remoteFx } from "../people/where";
import type { Body } from "../locomotion";
import { clearLine, faceYaw, findPath, nearestNode, rng, seedOf, type CityNav, type Poi, type PoiKind } from "./nav";

/* ------------------------------------------------------------------ */
/* Lo de fuera                                                          */
/* ------------------------------------------------------------------ */

/** Tú: dónde, hacia dónde miras, tu velocidad y la que pides, tu gesto, si conduces y el modo pelea. */
export interface Me {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  wx: number;
  wz: number;
  emote: string | null;
  driving: boolean;
  fight: boolean;
}

/** Otra persona (multijugador), donde se la ve, y si está en modo pelea. */
export interface Remote {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  emote: string | null;
  fight: boolean;
}

/**
 * Un coche (el tuyo o el de otra persona): dónde, hacia dónde avanza (unitario), a qué velocidad
 * (m/s, ≥ 0) y quién lo conduce ("me" o su sesión; sin decir, tú).
 */
export interface CarInfo {
  x: number;
  z: number;
  fx: number;
  fz: number;
  speed: number;
  who?: string;
}

/** Un estado de los ciudadanos que llega de quien los lleva (`t`: hora del servidor, ms). */
export interface NpcStateIn {
  t: number;
  cast: NpcSnap[];
}

/** Lo que alguien le ha hecho a un ciudadano (le llega a quien los lleva): un golpe o una propuesta. */
export interface NpcEvent {
  kind: "hit" | "pair";
  from: string;
  npc: number;
  dir: [number, number];
  power: number;
  head: boolean;
  hit: NpcHitKind;
  pair: PairAction;
}

/**
 * La red (§9 nonies, net/npc-store.ts). `role`: "local" (cada uno los suyos), "host" (este cliente los
 * mueve y reparte su estado) o "replica" (los dibuja como llegan y cuenta lo que les hace).
 */
export interface CityLink {
  role(): "local" | "host" | "replica";
  /** Hora del servidor (ms). */
  now(): number;
  /** Esta sesión (los ciudadanos dicen a quién atienden con su sesión). */
  me(): string | null;
  /** Cuántas personas más hay en el lugar (sin nadie, se reparte el estado mucho menos). */
  others(): number;
  publish(cast: NpcSnap[]): void;
  /** Lo siguiente que le han hecho los demás a algún ciudadano (o null). */
  nextEvent(): NpcEvent | null;
  /** Los estados que han llegado, del más viejo al más nuevo. */
  states(): readonly NpcStateIn[];
  hit(npc: number, dx: number, dz: number, power: number, head: boolean, kind: NpcHitKind): void;
  pair(npc: number, kind: PairAction): void;
}

export interface CityEnv {
  me: Me;
  /** Al empezar cada frame: pone al día `me`. */
  sync(): void;
  /** Las demás personas: rellena `out` y dice cuántas hay. */
  remotes(out: Remote[]): number;
  /** Tu coche (si conduces). */
  car(): CarInfo | null;
  /** Todos los coches que se mueven (el tuyo y los de los demás): rellena `out` y dice cuántos. Sin esto, solo el tuyo. */
  cars?(out: CarInfo[]): number;
  /** Un paso de física (locomotion.stepBody, sin la gente: entre ellos se empujan aquí). */
  step(b: Body, wantX: number, wantZ: number, dt: number): void;
  /** Golpes y caídas (knock.ts) del hueco `i`; true mientras mandan ellos. */
  knock(i: number, g: THREE.Object3D, x: number, y: number, z: number, yaw: number, m: Motion): boolean;
  knockReset(m: Motion): void;
  /** Tu parte de una acción en pareja con un ciudadano (selfPeople.startLocalPair). */
  pair(kind: PairAction, key: string): void;
  /** Los huecos de la gente (collision.ts → npcs): dónde están y los golpes que les llegan. */
  npcs: { count: number; pos: Float32Array; knock: Float32Array; knockHead?: Uint8Array; knockShot?: Uint8Array; ghost?: Uint8Array };
  /** La red: sin ella, cada cliente los suyos. */
  link?: CityLink;
}

/* ------------------------------------------------------------------ */
/* Cómo son                                                             */
/* ------------------------------------------------------------------ */

/** Cuántos viven en cada distrito. */
export const CAST = 10;
export const CAST_CERO = 14;
export const castFor = (district: string) => (district === "cero" ? CAST_CERO : CAST);
/** Lo más que se dibujan a la vez (los huecos de collision.ts → NPC_CITY dan para más). */
export const MAX_DRAWN = 16;
/** Más allá no se dibuja a nadie (m; la niebla de noche empieza a 45). */
const RANGE = 40;
/**
 * Con física y enterándose de lo que pasa: los que se dibujan y los que estén a menos de esto (m). Los
 * demás van por el mapa sin física (sus caminos no atraviesan nada: city/nav.ts).
 */
const NEAR = 14;
/** Radio de una persona (m) y el del jugador (locomotion.BODY_RADIUS). */
const R = 0.3;
const R_ME = 0.32;
/** Cuánto antes de tocarse cuenta como «contra él» (m). */
const CONTACT = 0.08;
const JOG = 2.9;
/** Contestan a gestos hechos a menos de esto (m) y te miran al pasar a menos de esto. */
const GREET = 8;
const NOTICE = 4.5;
/** Miedo que se pasa por segundo; rencor y simpatía (s). */
const FEAR_DECAY = 0.035;
const GRUDGE = 150;
const FRIEND = 180;
/** Seguirte cuando los llamas: cuánto (s), a qué distancia (m) y cuánto aguantan contigo parado (s). */
const FOLLOW = 25;
const FOLLOW_GAP = 1.6;
const FOLLOW_IDLE = 12;
const MAX_FOLLOWERS = 2;
/** Cuánto dura un bocadillo (s). */
const SPEECH = 2.6;
const HIDDEN_Y = -1000;
/** Por encima de esta fuerza (m/s) un golpe tira al suelo (knock.ts → FALL_SPEED). */
const FALL_AT = 2.5;
/** Cuánto está «en el suelo» alguien a quien han dado lejos de quien los lleva (sin física: s). */
const VK_FALL = 4.8;
const VK_REACT = 0.8;
/**
 * Quien los lleva reparte su estado cada tanto (ms de verdad, no del reloj de la ciudad: con pocos
 * frames por segundo ese va más despacio): con más gente en el lugar y sin nadie más (para que el
 * servidor sepa que sigue: a los 4 s sin nada, elige a otro).
 */
const PUB_GAP_MS = 250;
const PUB_IDLE_MS = 1500;
/** Los demás los dibujan este tanto por detrás (ms): dos estados de margen, como a las personas. */
const NPC_DELAY_MS = 450;
/** Un golpe a un ciudadano se ve en el estado (para quien no lo ha dado) durante esto (s). */
const KNOCK_SHOW = 3;
const EMOTE_OK = /^[a-z_]{1,24}$/;
const SPEECH_OK = /^npc\.[a-z_]{1,24}$/;

type Doing = "travel" | "stay" | "chat" | "respond" | "follow" | "watch" | "flee" | "dodge" | "pair" | "down";
/** Qué le ha dado: corrías contra él, un golpe del modo pelea o el coche. */
type HitKind = "" | NpcHitKind;

export interface Citizen {
  id: number;
  /** Su clave para quien lo busca (parejas: where.ts). */
  key: string;
  /** Forma de ser (0–1): ganas de charlar, valor, curiosidad; y su paso (m/s). */
  social: number;
  bold: number;
  curious: number;
  pace: number;
  body: Body;
  motion: Motion;
  yaw: number;
  visY: number;
  feet: THREE.Vector3;
  /** Cerca (física), entre los que se quieren ver, dibujado; su grupo y si ya tiene su personaje. */
  near: boolean;
  wanted: boolean;
  drawn: boolean;
  group: THREE.Object3D | null;
  ready: boolean;
  /** Hueco en collision.ts → npcs (fijo mientras se dibuja) o −1. */
  slot: number;
  dist: number;
  knocked: boolean;
  hitKind: HitKind;
  doing: Doing;
  t: number;
  dur: number;
  path: number[];
  pi: number;
  /** Última vez (s, en `t`) que se probó un atajo. */
  pull: number;
  poi: Poi | null;
  /** Llegando al sitio (el último tramo, sin física). */
  arriving: boolean;
  recent: Poi[];
  /** Con quién charla y si le toca hablar. */
  partner: number;
  talking: boolean;
  /** A quién atiende ("me", la sesión de otra persona o "") y un punto que mirar (fx, fz; NaN si no). */
  who: string;
  fx: number;
  fz: number;
  /** Gesto pendiente de contestar (encima o de cuerpo entero), cuándo y cuánto dura. */
  reply: string | null;
  replyFull: boolean;
  replyAt: number;
  replyDur: number;
  /** Hasta cuándo dura el gesto de encima (Motion.gesture). */
  gestUntil: number;
  pairKind: PairAction;
  /** Cuánto lleva empujado por ti (s). */
  pushT: number;
  /** Cuándo se da cuenta del coche (o Infinity) y hacia dónde salta. */
  dangerAt: number;
  dodgeX: number;
  dodgeZ: number;
  dodgeSaid: boolean;
  fear: number;
  /** De qué tiene miedo: de una persona ("me" o su sesión) o de una pelea ("fight", en fx, fz). */
  feared: string;
  /** Rencor y simpatía: hasta cuándo y a quién. */
  grudge: number;
  grudgeWho: string;
  friend: number;
  friendWho: string;
  lastChat: number;
  lastGreet: number;
  lastSaid: number;
  /** Mirando a alguien hasta `glance`; no vuelve a mirar antes de `glanceNext`. */
  glance: number;
  glanceNext: number;
  /** Contigo parado mientras te sigue (s). */
  idleT: number;
  /** Lo que dice (clave de i18n) y hasta cuándo; `said` cambia cada vez (para el bocadillo). */
  speech: string | null;
  speechUntil: number;
  said: number;
  /** Atascado: cuánto, cuántas veces seguidas, y apartarse un momento a un lado. */
  stuck: number;
  stuckN: number;
  side: number;
  sideDir: number;
  lastX: number;
  lastZ: number;
  /** Quién le ha dado (y, con quien los lleva, de qué y quién: lo de los demás llega por la red). */
  hitBy: string;
  pendingKind: HitKind;
  pendingBy: string;
  /** Le han dado lejos de quien los lleva: «en el suelo» sin física hasta entonces (o −1). */
  vk: number;
  /** Golpes: cuántos (cambia con cada uno), el último (hacia dónde, fuerza, en la cabeza) y cuándo. */
  kn: number;
  kAt: number;
  /** Quien conduce el coche del que se aparta y dónde estaba. */
  dangerWho: string;
  dangerX: number;
  dangerZ: number;
  /** Viéndolos como llegan: el último golpe visto, cuándo le diste tú, si el golpe es de la red y si la pareja es contigo. */
  kSeen: number;
  localHitAt: number;
  injected: boolean;
  pairMine: boolean;
  /** Al levantarse (viéndolos como llegan): de dónde a dónde dice el estado, se junta poco a poco. */
  ox: number;
  oz: number;
  /** Su estado para repartir (siempre el mismo objeto). */
  snap: NpcSnap;
  snapP: [number, number, number];
  snapL: [number, number, number, number];
  snapK: [number, number, number, number, number];
}

/** Qué contestan a cada gesto: gesto (encima de lo que hagan) o de cuerpo entero, y qué dicen. */
export const REPLY: Record<string, { g: string; full?: boolean; say?: string[] } | undefined> = {
  wave: { g: "wave", say: ["npc.hi", "npc.hey"] },
  cheer: { g: "clap" },
  clap: { g: "clap" },
  laugh: { g: "laugh" },
  bow: { g: "bow", full: true },
  shrug: { g: "shrug" },
  nod: { g: "nod" },
  shake_head: { g: "shrug" },
  talk: { g: "nod" },
  point: { g: "shrug", say: ["npc.where"] },
};
/** Gestos que los tienen en su sitio (sentado, jugando…): contestan con los brazos, sin levantarse. */
export const POSED = new Set(["sit", "arcade", "talk", "dance", "phone", "interact", "crouch"]);
/** Sitios: cuánto apetece cada uno (después, según cada cual). */
const WANT: Record<PoiKind, number> = { sit: 1.1, play: 1.1, vend: 0.7, window: 0.9, look: 0.8, hang: 1.0, dance: 0.35, watch: 0.7, corner: 0.5 };

const _remotes: Remote[] = Array.from({ length: 48 }, () => ({ id: "", x: 0, y: 0, z: 0, yaw: 0, emote: null, fight: false }));
const _cars: CarInfo[] = Array.from({ length: 16 }, () => ({ x: 0, z: 0, fx: 0, fz: 1, speed: 0, who: "" }));
const _order: Citizen[] = [];
const byDist = (a: Citizen, b: Citizen) => a.dist - b.dist;
const _want = { x: 0, z: 0 };
/** A quién se mira al pasar (notice) y dónde está la pelea que da miedo (fearAt). */
const _near = { who: "", d: 0, x: 0, y: 0, z: 0, yaw: 0 };
const _fear = { x: 0, z: 0 };
const _me = new THREE.Vector3();

const newBody = (): Body => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, airTime: 0, jumpAge: Infinity, jumped: false, landed: 0, stun: 0, h: 1.8 });
function placeAt(b: Body, x: number, y: number, z: number) {
  b.x = x;
  b.y = y;
  b.z = z;
  b.vx = b.vy = b.vz = 0;
  b.grounded = true;
  b.airTime = 0;
  b.jumpAge = Infinity;
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** El ciudadano `i` de un estado (van en orden; si falta alguno, se busca). */
function snapIn(st: NpcStateIn, i: number): NpcSnap | null {
  const c = st.cast[i];
  if (c && c.i === i) return c;
  for (const o of st.cast) if (o.i === i) return o;
  return null;
}

/* ------------------------------------------------------------------ */
/* La ciudad                                                            */
/* ------------------------------------------------------------------ */

export class CitySim {
  readonly cast: Citizen[] = [];
  /** Cuántos se dibujan a la vez como mucho (FEATURES.pedestrians). */
  drawnMax = 6;
  /** Cambia cuando alguien quiere que se monte su personaje (para CityLife). */
  version = 0;
  /** Segundos desde que empezó. */
  clock = 0;
  private r: () => number;
  private tick = 0;
  private lastEmote = new Map<string, string | null>();
  private nRemotes = 0;
  private slots: (Citizen | null)[] = new Array<Citizen | null>(MAX_DRAWN).fill(null);
  /** Por grupo de la calle (Cero): sus sitios y el de quien baila. */
  private groupPois = new Map<number, Poi[]>();
  private danceOf = new Map<number, Poi>();
  /** Lo que se suma al rodear a alguien (avoid). */
  private ax = 0;
  private az = 0;
  private nCars = 0;
  /** La red y el papel de este cliente (§9 nonies): ver CityLink. */
  private link: CityLink | null;
  role: "local" | "host" | "replica" = "local";
  /** Viéndolos como llegan: ¿ya ha llegado el primer estado? */
  private synced = false;
  /** Cuándo se repartió el estado por última vez (hora del servidor, ms). */
  private pubAt = -1e12;
  private snaps: NpcSnap[] = [];

  constructor(
    readonly nav: CityNav,
    private env: CityEnv,
    count: number,
  ) {
    this.link = env.link ?? null;
    this.r = rng(seedOf(`city-${nav.id}`));
    for (const p of nav.pois) {
      if (p.group < 0) continue;
      const list = this.groupPois.get(p.group) ?? [];
      list.push(p);
      this.groupPois.set(p.group, list);
      if (p.kind === "dance") this.danceOf.set(p.group, p);
    }
    const r = this.r;
    for (let id = 0; id < count; id++) {
      const c: Citizen = {
        id,
        key: `npc:${nav.id}:${id}`,
        social: 0.15 + r() * 0.85,
        bold: 0.15 + r() * 0.85,
        curious: 0.15 + r() * 0.85,
        pace: 1.05 + r() * 0.4,
        body: newBody(),
        motion: createMotion(),
        yaw: 0,
        visY: 0,
        feet: new THREE.Vector3(),
        near: false,
        wanted: false,
        drawn: false,
        group: null,
        ready: false,
        slot: -1,
        dist: Infinity,
        knocked: false,
        hitKind: "",
        doing: "travel",
        t: 0,
        dur: 0,
        path: [],
        pi: 0,
        pull: 0,
        poi: null,
        arriving: false,
        recent: [],
        partner: -1,
        talking: false,
        who: "",
        fx: NaN,
        fz: NaN,
        reply: null,
        replyFull: false,
        replyAt: 0,
        replyDur: 2.4,
        gestUntil: 0,
        pairKind: "high_five",
        pushT: 0,
        dangerAt: Infinity,
        dodgeX: 0,
        dodgeZ: 0,
        dodgeSaid: false,
        fear: 0,
        feared: "me",
        grudge: -1,
        grudgeWho: "me",
        friend: -1,
        friendWho: "me",
        lastChat: -60,
        lastGreet: -120,
        lastSaid: -60,
        glance: 0,
        glanceNext: 0,
        idleT: 0,
        speech: null,
        speechUntil: 0,
        said: 0,
        stuck: 0,
        stuckN: 0,
        side: 0,
        sideDir: 1,
        lastX: 0,
        lastZ: 0,
        hitBy: "me",
        pendingKind: "",
        pendingBy: "",
        vk: -1,
        kn: 0,
        kAt: -1e9,
        dangerWho: "me",
        dangerX: 0,
        dangerZ: 0,
        kSeen: 0,
        localHitAt: -1e9,
        injected: false,
        pairMine: false,
        ox: 0,
        oz: 0,
        snap: { i: id, p: [0, 0, 0], r: 0, v: 0 },
        snapP: [0, 0, 0],
        snapL: [0, 0, 0, 0],
        snapK: [0, 0, 0, 0, 0],
      };
      c.snap.p = c.snapP;
      c.motion.fx = createFx();
      c.motion.hidden = true;
      this.cast.push(c);
      // Cada uno empieza en un sitio (a mitad de lo que hace allí) o andando hacia uno.
      const poi = this.choosePoi(c, null);
      if (poi && r() < 0.65) {
        this.take(c, poi);
        placeAt(c.body, poi.x, poi.y, poi.z);
        c.yaw = poi.yaw;
        this.startStay(c, r());
      } else {
        const n = nav.nodes[this.randomNode()]!;
        placeAt(c.body, n.x, n.y, n.z);
        this.goSomewhere(c);
      }
      c.visY = c.body.y;
      c.lastX = c.body.x;
      c.lastZ = c.body.z;
      c.feet.set(c.body.x, c.body.y, c.body.z);
    }
  }

  /** Al entrar en el distrito: que se les pueda encontrar (parejas, where.ts). */
  attach() {
    for (const c of this.cast) {
      remoteFeet.set(c.key, c.feet);
      remoteFx.set(c.key, c.motion.fx!);
    }
  }

  /** Al irse (se puede volver a `attach`: React monta dos veces en desarrollo). */
  detach() {
    for (const c of this.cast) {
      remoteFeet.delete(c.key);
      remoteFx.delete(c.key);
      if (c.knocked) this.env.knockReset(c.motion);
      c.knocked = false;
    }
    this.env.npcs.count = 0;
  }

  /** Una pelea entre personas en (x, z): quién mira desde lejos y quién se va. */
  event(kind: "fight", x: number, z: number) {
    // Viéndolos como llegan, de eso se encarga quien los lleva.
    if (this.watching()) return;
    let said = false;
    for (const c of this.cast) {
      if (!c.near || c.knocked || kind !== "fight") continue;
      const d = Math.hypot(c.body.x - x, c.body.z - z);
      if (d > 12) continue;
      if (c.bold < 0.45 || d < 3.5) {
        c.fear = Math.min(1, c.fear + 0.35 + (1 - c.bold) * 0.25);
        c.feared = "fight";
        c.fx = x;
        c.fz = z;
      } else if (c.doing !== "follow" && c.doing !== "pair" && c.doing !== "flee") this.watch(c, x, z, 5 + c.curious * 4, c.bold > 0.7 ? "cheer" : "shake_head");
      if (!said && d < 9 && this.clock - c.lastSaid > 6) {
        said = true;
        this.say(c, "npc.fight");
      }
    }
  }

  /** Propuesta desde la rueda (chocar los cinco, apretón, abrazo) a quien tengas delante. */
  offerPair(kind: PairAction): boolean {
    const me = this.env.me;
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    let best: Citizen | null = null, bestD = PAIR_RANGE;
    for (const c of this.cast) {
      if (!c.drawn || c.knocked || c.doing === "dodge" || c.doing === "pair") continue;
      const dx = c.body.x - me.x, dz = c.body.z - me.z, d = Math.hypot(dx, dz);
      if (d > bestD || Math.abs(c.body.y - me.y) > 1.2) continue;
      if (d > 0.3 && (dx * fx + dz * fz) / d < -0.7) continue;
      best = c;
      bestD = d;
    }
    if (!best) return false;
    // Viéndolos como llegan: se lo pregunta quien los lleva (si dice que sí, su estado lo dirá).
    if (this.watching()) {
      this.link!.pair(best.id, kind);
      return true;
    }
    this.pairWith(best, kind, "me");
    return true;
  }

  /** `who` le propone `kind` a `c`: si le apetece, se queda de cara para hacerlo; si no, que no. */
  private pairWith(c: Citizen, kind: PairAction, who: string) {
    if (c.knocked || c.vk >= 0 || c.doing === "dodge" || c.doing === "pair") return;
    if (this.upset(c, who)) {
      // No, gracias.
      this.reply(c, who, "shake_head", false, 0.3, 2);
      this.say(c, c.fear > 0.3 ? "npc.leave" : "npc.no");
      return;
    }
    this.leaveChat(c);
    this.release(c);
    c.doing = "pair";
    c.pairKind = kind;
    c.t = 0;
    c.dur = PAIR[kind].s + 0.3;
    c.who = who;
    c.motion.gesture = null;
    // Tu parte la haces tú (selfPeople.ts); la de los demás, cada uno en su cliente (al ver el estado).
    if (who === "me") this.env.pair(kind, c.key);
  }

  /** ¿Le tiene manía a `who`? (rencor o miedo: entonces no le contesta ni le choca los cinco). */
  private upset(c: Citizen, who: string): boolean {
    return (c.grudge > this.clock && c.grudgeWho === who) || (c.fear > 0.3 && (c.feared === who || c.feared === "fight"));
  }

  /** ¿Se les dibuja con el estado de quien los lleva? (entonces aquí no se decide nada). */
  private watching(): boolean {
    return this.role === "replica" && this.synced;
  }

  /** ¿Se entera de lo que pasa a su alrededor? Llevándolos para todos, si está cerca de alguien; si no, si se le ve aquí. */
  private aware(c: Citizen): boolean {
    return this.role === "host" ? c.near : c.drawn;
  }

  /* ---------------------------------------------------------------- */
  /* Cada frame                                                         */
  /* ---------------------------------------------------------------- */

  frame(dt: number) {
    dt = Math.min(dt, 0.1);
    if (!(dt > 0)) return;
    this.clock += dt;
    this.env.sync();
    const role = this.link?.role() ?? "local";
    if (role !== this.role) this.switchRole(role);
    if (role === "replica") {
      const states = this.link!.states();
      // Hasta que llegue el primer estado, siguen a lo suyo aquí.
      if (states.length) return this.replicaFrame(dt, states);
    }
    const me = this.env.me;
    this.nRemotes = this.env.remotes(_remotes);
    this.nCars = this.carsNow();
    // Lo que los demás les han hecho (llevándolos para todos).
    if (role === "host") for (let ev = this.link!.nextEvent(); ev; ev = this.link!.nextEvent()) this.remoteEvent(ev);
    for (const c of this.cast) {
      c.dist = Math.hypot(c.body.x - me.x, c.body.z - me.z, (c.body.y - me.y) * 2);
      // Con física y enterándose: cerca de ti o de cualquiera (cada uno los ve en su cliente).
      let any = c.dist;
      for (let k = 0; k < this.nRemotes; k++) {
        const o = _remotes[k]!;
        any = Math.min(any, Math.hypot(c.body.x - o.x, c.body.z - o.z, (c.body.y - o.y) * 2));
      }
      const near = c.drawn || any < NEAR;
      if (near && !c.near) {
        placeAt(c.body, c.body.x, c.body.y, c.body.z);
        c.lastX = c.body.x;
        c.lastZ = c.body.z;
      }
      c.near = near;
    }
    this.gestures();
    if (--this.tick <= 0) {
      this.tick = 15;
      this.selectDrawn();
    }
    for (const c of this.cast) {
      c.t += dt;
      c.fear = Math.max(0, c.fear - FEAR_DECAY * dt);
      c.pushT = Math.max(0, c.pushT - dt * 0.5);
      if (c.speech && this.clock > c.speechUntil) c.speech = null;
      if (c.motion.gesture && this.clock > c.gestUntil) c.motion.gesture = null;
      if (c.knocked) continue;
      if (c.vk >= 0) {
        // Le han dado lejos de aquí: «en el suelo» (los demás lo ven caer con su física) y luego, de pie.
        if (this.clock < c.vk) continue;
        c.vk = -1;
        this.recover(c, c.body.x, c.body.y, c.body.z, c.yaw);
      }
      if (c.near) this.think(c, dt);
      else this.farStep(c, dt);
    }
    this.physics(dt);
    this.knocks();
    this.place(dt);
    if (role === "host") this.publish();
  }

  /** Los coches que se mueven ahora (el tuyo y, si se sabe, los de los demás), en `_cars`. */
  private carsNow(): number {
    if (this.env.cars) return this.env.cars(_cars);
    const car = this.env.car();
    if (!car) return 0;
    Object.assign(_cars[0]!, car);
    _cars[0]!.who = car.who ?? "me";
    return 1;
  }

  /* ---------------------------------------------------------------- */
  /* Compartidos (§9 nonies)                                            */
  /* ---------------------------------------------------------------- */

  private switchRole(next: "local" | "host" | "replica") {
    // Dejan de llegar los estados de otro: desde como se les veía, a decidir aquí.
    if (this.watching() && next !== "replica") this.adoptBrain();
    if (next === "replica") this.synced = false;
    if (next === "host") this.pubAt = -1e12;
    this.role = next;
  }

  /**
   * Se pasa a llevarlos (quien los llevaba se ha ido): cada uno sigue desde donde se le veía; quien
   * estaba en su sitio, sigue en él; los demás, a un sitio nuevo.
   */
  private adoptBrain() {
    for (const p of this.nav.pois) p.taken = -1;
    for (const c of this.cast) {
      c.kn = Math.max(c.kn, c.kSeen);
      c.pairMine = c.injected = false;
      c.reply = null;
      c.partner = -1;
      c.who = "";
      c.fx = c.fz = NaN;
      c.side = c.stuck = c.stuckN = 0;
      c.arriving = false;
      c.poi = null;
      c.path = [];
      c.pi = 0;
      c.ox = c.oz = 0;
      c.motion.fx!.reachL.w = c.motion.fx!.reachR.w = 0;
      c.motion.fx!.look.w = 0;
      c.lastX = c.body.x;
      c.lastZ = c.body.z;
      const was = c.doing;
      c.doing = "travel";
      if (c.knocked) continue; // al levantarse, recover() lo pone en marcha
      if (was === "down") {
        c.vk = this.clock + 1.5;
        continue;
      }
      if (was === "stay") {
        let best: Poi | null = null, bestD = 0.6;
        for (const p of this.nav.pois) {
          const d = Math.hypot(p.x - c.body.x, p.z - c.body.z);
          if (p.taken < 0 && d < bestD && Math.abs(p.y - c.body.y) < 0.5) (best = p), (bestD = d);
        }
        if (best) {
          this.take(c, best);
          this.startStay(c, 0.3 + this.r() * 0.5);
          continue;
        }
      }
      c.motion.emote = null;
      c.motion.gesture = null;
      this.goSomewhere(c);
    }
  }

  /** Llevándolos para todos: lo que otra persona le ha hecho a uno (un golpe o una propuesta). */
  private remoteEvent(ev: NpcEvent) {
    const c = this.cast[ev.npc];
    if (!c) return;
    const who = ev.from === this.link?.me() ? "me" : ev.from;
    if (ev.kind === "pair") return this.pairWith(c, ev.pair, who);
    if (c.knocked || c.vk >= 0) return;
    const npcs = this.env.npcs;
    if (c.drawn && c.slot >= 0 && c.group) {
      // Se le ve aquí: cae con su física, como con un golpe tuyo (knocks).
      const i = c.slot;
      npcs.knock[i * 4] = this.clock * 1000 + 1;
      npcs.knock[i * 4 + 1] = ev.dir[0];
      npcs.knock[i * 4 + 2] = ev.dir[1];
      npcs.knock[i * 4 + 3] = ev.power;
      if (npcs.knockHead) npcs.knockHead[i] = ev.head ? 1 : 0;
      c.pendingKind = ev.hit;
      c.pendingBy = who;
      return;
    }
    // Lejos de aquí: sin física; quien lo ve, lo ve caer (el golpe va en el estado).
    this.noteKnock(c, ev.dir[0], ev.dir[1], ev.power, ev.head ? 1 : 0);
    c.hitKind = ev.hit;
    c.hitBy = who;
    c.vk = this.clock + (ev.power >= FALL_AT ? VK_FALL : VK_REACT);
    this.struck(c);
  }

  /** Apunta un golpe (para repartirlo en el estado). */
  private noteKnock(c: Citizen, nx: number, nz: number, power: number, head: number) {
    c.kn++;
    c.kAt = this.clock;
    const k = c.snapK;
    k[0] = c.kn;
    k[1] = r3(nx);
    k[2] = r3(nz);
    k[3] = r2(Math.min(30, power));
    k[4] = head ? 1 : 0;
  }

  /** Llevándolos para todos: reparte el estado de cada uno (a menudo si hay alguien más; si no, de vez en cuando). */
  private publish() {
    const link = this.link!;
    const now = link.now();
    if (now - this.pubAt < (link.others() > 0 ? PUB_GAP_MS : PUB_IDLE_MS)) return;
    this.pubAt = now;
    const myId = link.me();
    const list = this.snaps;
    list.length = 0;
    for (const c of this.cast) {
      const s = c.snap, m = c.motion;
      const down = c.knocked || c.vk >= 0;
      // En el suelo (aquí, con su física), donde está su cuerpo; si no, donde va.
      const x = down && c.drawn ? c.feet.x : c.body.x, y = down && c.drawn ? c.feet.y : c.body.y, z = down && c.drawn ? c.feet.z : c.body.z;
      s.p[0] = r2(x);
      s.p[1] = r2(y);
      s.p[2] = r2(z);
      s.r = r3(wrap(c.yaw));
      s.v = r2(Math.max(0, Math.min(20, m.speed)));
      s.e = m.emote && EMOTE_OK.test(m.emote) ? m.emote : undefined;
      s.g = m.gesture && EMOTE_OK.test(m.gesture) ? m.gesture : undefined;
      const l = m.fx!.look;
      if (l.w > 0.01) {
        c.snapL[0] = r2(l.x);
        c.snapL[1] = r2(l.y);
        c.snapL[2] = r2(l.z);
        c.snapL[3] = r2(Math.min(1, l.w));
        s.l = c.snapL;
      } else s.l = undefined;
      if (c.speech && SPEECH_OK.test(c.speech)) {
        s.s = c.speech;
        s.n = c.said;
      } else s.s = s.n = undefined;
      s.k = c.kn > 0 && this.clock - c.kAt < KNOCK_SHOW ? c.snapK : undefined;
      s.d = down ? "down" : c.doing;
      s.w = c.who === "me" ? (myId ?? undefined) : c.who && c.who !== "fight" ? c.who.slice(0, 64) : undefined;
      s.q = c.doing === "pair" ? c.pairKind : undefined;
      list.push(s);
    }
    link.publish(list);
  }

  /**
   * Viéndolos como llegan: cada uno donde dice el estado (entre los dos que rodean el momento que se
   * dibuja), con lo que hace, lo que mira y lo que dice; los golpes de los demás, con su física aquí;
   * los tuyos se ven enseguida y se le cuentan a quien los lleva (knocks).
   */
  private replicaFrame(dt: number, states: readonly NpcStateIn[]) {
    const link = this.link!;
    const me = this.env.me;
    this.nRemotes = this.env.remotes(_remotes);
    const myId = link.me();
    const first = !this.synced;
    this.synced = true;
    const rt = link.now() - NPC_DELAY_MS;
    let i1 = 0;
    while (i1 < states.length && states[i1]!.t <= rt) i1++;
    const s0 = states[Math.max(0, i1 - 1)]!, s1 = states[Math.min(states.length - 1, i1)]!;
    const span = s1.t - s0.t;
    const k = span > 0 ? Math.max(0, Math.min(1, (rt - s0.t) / span)) : 1;
    const npcs = this.env.npcs;
    for (const c of this.cast) {
      c.t += dt;
      if (c.speech && this.clock > c.speechUntil) c.speech = null;
      const a = snapIn(s0, c.id), b = snapIn(s1, c.id);
      const now = a ?? b;
      if (!now) continue;
      const to = b ?? a!;
      const m = c.motion, body = c.body;
      // Dónde: entre los dos estados (si ha dado un salto, sin pasar por en medio).
      let x = to.p[0], y = to.p[1], z = to.p[2], yaw = to.r, v = to.v;
      if (a && b && a !== b) {
        if (Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) < 6) {
          x = a.p[0] + (b.p[0] - a.p[0]) * k;
          y = a.p[1] + (b.p[1] - a.p[1]) * k;
          z = a.p[2] + (b.p[2] - a.p[2]) * k;
          yaw = a.r + wrap(b.r - a.r) * k;
          v = a.v + (b.v - a.v) * k;
        } else if (k < 0.5) (x = a.p[0]), (y = a.p[1]), (z = a.p[2]), (yaw = a.r), (v = a.v);
      }
      if (first || !c.near) {
        // Recién llegado (o lejos): donde está, sin más.
        c.visY = y;
        c.ox = c.oz = 0;
      }
      body.x = x;
      body.y = y;
      body.z = z;
      body.vx = body.vz = body.vy = 0;
      body.grounded = true;
      c.near = c.drawn;
      c.dist = Math.hypot(x - me.x, z - me.z, (y - me.y) * 2);
      if (!c.knocked) {
        c.yaw = yaw;
        m.speed = v;
        m.airborne = false;
      }
      // Qué hace (lo del estado que manda en este momento).
      const doing = (now.d ?? "travel") as Doing;
      if (doing !== c.doing) {
        if (c.doing === "pair") {
          m.fx!.reachL.w = m.fx!.reachR.w = 0;
          c.pairMine = false;
        }
        c.doing = doing;
        c.t = 0;
      }
      if (!c.knocked) {
        m.emote = now.e ?? null;
        m.gesture = now.g ?? null;
      }
      const look = m.fx!.look;
      if (now.l && now.w && now.w === myId) {
        // Te mira a ti: a donde estás (no a donde te veía quien los lleva).
        look.x = me.x;
        look.y = me.y + 1.55;
        look.z = me.z;
        look.w = now.l[3];
      } else if (now.l) {
        look.x = now.l[0];
        look.y = now.l[1];
        look.z = now.l[2];
        look.w = now.l[3];
      } else look.w = 0;
      if (now.s) {
        if (now.n !== c.said || !c.speech) {
          c.speech = now.s;
          c.said = now.n ?? c.said + 1;
          c.speechUntil = this.clock + SPEECH;
        }
      } else c.speech = null;
      // En pareja: las manos se encuentran con las de su pareja; si es contigo, tu parte la haces tú.
      if (doing === "pair" && now.q) {
        const p = now.w === myId ? me : now.w ? this.whereIs(now.w) : null;
        if (p) {
          _me.set(p.x, p.y, p.z);
          // Contigo, con tu reloj (where.ts → `mine`): su estado llega con retraso.
          pairTargets(now.q, mine.with === c.key ? mine.t : c.t, body.x, body.y, body.z, _me, m.fx!, this.fxOf(now.w === myId ? "me" : (now.w ?? "")));
        }
        if (now.w === myId && !c.pairMine) {
          c.pairMine = true;
          this.env.pair(now.q, c.key);
        }
      }
      // Un golpe nuevo de otro: cae aquí con su física (si se le ve; el tuyo ya se ve desde que lo das).
      if (now.k) {
        const n = now.k[0];
        if (first) c.kSeen = Math.max(c.kSeen, n);
        else if (n > c.kSeen) {
          c.kSeen = n;
          if (this.clock - c.localHitAt > 2.5 && c.drawn && c.slot >= 0 && c.group && !c.knocked) {
            const i = c.slot;
            npcs.knock[i * 4] = this.clock * 1000 + 1;
            npcs.knock[i * 4 + 1] = now.k[1];
            npcs.knock[i * 4 + 2] = now.k[2];
            npcs.knock[i * 4 + 3] = now.k[3];
            if (npcs.knockHead) npcs.knockHead[i] = now.k[4];
            c.injected = true;
          }
        }
      }
    }
    if (--this.tick <= 0) {
      this.tick = 15;
      this.selectDrawn();
    }
    this.knocks();
    this.place(dt);
  }

  /* ---------------------------------------------------------------- */
  /* Quién se dibuja                                                    */
  /* ---------------------------------------------------------------- */

  private selectDrawn() {
    _order.length = 0;
    for (const c of this.cast) {
      // Quien está cayendo sigue dibujado hasta que se levanta (si no, se cortaría en el aire).
      if (c.dist < RANGE + (c.drawn ? 4 : 0) || (c.knocked && c.dist < RANGE + 15)) _order.push(c);
    }
    _order.sort(byDist);
    const max = Math.min(this.drawnMax, MAX_DRAWN);
    let mount = false;
    for (const c of this.cast) c.wanted = false;
    for (let k = 0; k < _order.length && k < max; k++) {
      const c = _order[k]!;
      c.wanted = true;
      if (!c.group) mount = true;
    }
    if (mount) this.version++;
    // Primero se va quien sobra (deja su hueco) y después entra quien llega.
    for (const c of this.cast) if (c.drawn && (!c.wanted || !c.group || !c.ready || c.slot >= max)) this.undraw(c);
    for (const c of this.cast) if (!c.drawn && c.wanted && c.group && c.ready) this.draw(c, max);
  }

  private draw(c: Citizen, max: number) {
    let i = 0;
    while (i < max && this.slots[i]) i++;
    if (i >= max) return;
    this.slots[i] = c;
    c.slot = i;
    c.drawn = true;
    c.motion.hidden = false;
    c.visY = c.body.y;
    // Un golpe que iba para quien tenía antes el hueco no es para este.
    this.env.npcs.knock[i * 4] = 0;
    if (c.group) c.group.visible = true;
  }

  private undraw(c: Citizen) {
    if (c.knocked) {
      this.env.knockReset(c.motion);
      c.knocked = false;
      if (c.group) placeAt(c.body, c.group.position.x, c.group.position.y, c.group.position.z);
    }
    if (c.doing === "pair") this.resume(c);
    if (c.slot >= 0) {
      this.slots[c.slot] = null;
      this.env.npcs.pos[c.slot * 3 + 1] = HIDDEN_Y;
    }
    c.slot = -1;
    c.drawn = false;
    c.motion.hidden = true;
    c.speech = null;
    if (c.group) c.group.visible = false;
  }

  /* ---------------------------------------------------------------- */
  /* Gestos de la gente: quién contesta                                 */
  /* ---------------------------------------------------------------- */

  private gestures() {
    const me = this.env.me;
    this.seen("me", me.driving ? null : me.emote, me.x, me.y, me.z, me.yaw);
    for (let k = 0; k < this.nRemotes; k++) {
      const o = _remotes[k]!;
      this.seen(o.id, o.emote, o.x, o.y, o.z, o.yaw);
    }
  }

  /** Alguien ha empezado un gesto: le contestan uno o dos de los que tenga cerca y de cara. */
  private seen(who: string, emote: string | null, x: number, y: number, z: number, yaw: number) {
    const before = this.lastEmote.get(who) ?? null;
    if (emote === before) return;
    this.lastEmote.set(who, emote);
    if (!emote || (!REPLY[emote] && emote !== "beckon" && emote !== "dance")) return;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    // Los que están más cerca y más de frente; con ganas de charlar, más.
    let a: Citizen | null = null, b: Citizen | null = null, sa = 0.12, sb = 0.12;
    const reach = emote === "dance" ? 11 : GREET;
    for (const c of this.cast) {
      if (!this.aware(c) || c.knocked || c.vk >= 0 || c.doing === "dodge" || c.doing === "pair" || c.doing === "flee") continue;
      const dx = c.body.x - x, dz = c.body.z - z, d = Math.hypot(dx, dz);
      if (d > reach || Math.abs(c.body.y - y) > 1.5) continue;
      const toward = d > 0.3 ? (dx * fx + dz * fz) / d : 1;
      const s = (1 - d / reach) * (0.35 + 0.65 * Math.max(0, toward)) * (0.4 + c.social * 0.6);
      if (s > sa) {
        b = a;
        sb = sa;
        a = c;
        sa = s;
      } else if (s > sb) {
        b = c;
        sb = s;
      }
    }
    if (a) this.answer(a, who, emote, x, z, yaw, true);
    if (b && this.r() < b.social) this.answer(b, who, emote, x, z, yaw, false);
    // Bailar delante de la gente: se acerca un corrillo a mirar y a aplaudir.
    if (emote === "dance")
      for (const c of this.cast) {
        if (c === a || c === b || !this.aware(c) || c.knocked || c.vk >= 0 || c.doing !== "travel" || c.curious < 0.45) continue;
        if (Math.hypot(c.body.x - x, c.body.z - z) < 11) this.watch(c, x, z, 6 + c.curious * 4, "clap", who);
      }
  }

  private answer(c: Citizen, who: string, emote: string, x: number, z: number, yaw: number, first: boolean) {
    if (this.upset(c, who)) {
      if (first) {
        this.reply(c, who, "shake_head", false, 0.4, 2);
        this.say(c, "npc.leave");
      }
      return;
    }
    if (emote === "beckon") {
      if (!first) return;
      let followers = 0;
      for (const o of this.cast) if (o.doing === "follow") followers++;
      if (c.social > 0.3 && c.fear < 0.2 && followers < MAX_FOLLOWERS && c.doing !== "follow") {
        this.leaveChat(c);
        this.release(c);
        c.doing = "follow";
        c.who = who;
        c.t = 0;
        c.dur = FOLLOW;
        c.idleT = 0;
        c.path.length = 0;
        c.pi = 0;
        this.gest(c, "nod", 1.5);
        this.say(c, "npc.coming");
        c.lastGreet = this.clock;
      } else {
        this.reply(c, who, "shake_head", false, 0.4, 2);
        this.say(c, "npc.no");
      }
      return;
    }
    if (emote === "dance") {
      if (c.social > 0.6 && !POSED.has(c.motion.emote ?? "") && c.doing !== "follow") {
        this.reply(c, who, "dance", true, 0.5, 6 + c.social * 3);
        if (first) this.say(c, "npc.nice");
      } else this.reply(c, who, "clap", false, 0.5, 3);
      return;
    }
    const r = REPLY[emote];
    if (!r) return;
    this.reply(c, who, r.g, !!r.full, 0.25 + this.r() * 0.45, 2.4);
    if (emote === "point") {
      // Primero te mira y después, hacia donde señalas.
      c.fx = x - Math.sin(yaw) * 8;
      c.fz = z - Math.cos(yaw) * 8;
    }
    if (r.say && first) this.say(c, r.say[Math.floor(this.r() * r.say.length)]!);
    // Ya os habéis saludado: no te vuelve a saludar en un rato.
    c.lastGreet = this.clock;
    if (emote === "wave") {
      c.friend = this.clock + FRIEND;
      c.friendWho = who;
    }
  }

  /**
   * Contestar con `gesture` a `who` dentro de `delay` s. Sentado, en su sitio o siguiéndote, solo con
   * los brazos y la cabeza (no se levanta); de pie, se para y se gira hacia quien sea.
   */
  private reply(c: Citizen, who: string, gesture: string, full: boolean, delay: number, dur: number) {
    c.who = who;
    c.fx = c.fz = NaN;
    c.replyAt = this.clock + delay;
    c.replyDur = dur;
    c.glance = this.clock + delay + dur;
    const posed = (c.doing === "stay" && POSED.has(c.motion.emote ?? "")) || c.doing === "follow";
    c.reply = posed && full ? "nod" : gesture;
    c.replyFull = full && !posed;
    if (posed) return;
    this.leaveChat(c);
    this.keepGoal(c);
    c.doing = "respond";
    c.t = 0;
    c.dur = dur + delay;
  }

  /** Mirar algo un rato (una pelea, quien baila): de cara, con un gesto. */
  private watch(c: Citizen, x: number, z: number, dur: number, gesture: string | null, who = "") {
    if (c.doing === "watch") {
      c.dur = Math.max(c.dur, c.t + dur);
      return;
    }
    this.leaveChat(c);
    this.keepGoal(c);
    c.doing = "watch";
    c.t = 0;
    c.dur = dur;
    c.fx = x;
    c.fz = z;
    c.who = who;
    c.reply = gesture;
    c.replyFull = false;
    c.replyAt = this.clock + 0.6 + this.r() * 1.2;
    c.replyDur = 3;
  }

  private gest(c: Citizen, name: string, dur: number) {
    c.motion.gesture = name;
    c.gestUntil = this.clock + dur;
  }

  private say(c: Citizen, key: string) {
    // Sin dibujar aquí no lo oye nadie (salvo llevándolos para todos: lo oyen donde se les vea).
    if (!c.drawn && this.role !== "host") return;
    c.speech = key;
    c.speechUntil = this.clock + SPEECH;
    c.said++;
    c.lastSaid = this.clock;
  }

  /* ---------------------------------------------------------------- */
  /* Decidir y moverse (los de cerca)                                   */
  /* ---------------------------------------------------------------- */

  private think(c: Citizen, dt: number) {
    const me = this.env.me;
    const m = c.motion;
    const b = c.body;
    let wantX = 0, wantZ = 0;
    let face = NaN;

    // El coche: si viene hacia él, a un lado (de un salto), en cuanto se da cuenta.
    this.danger(c);
    if (c.doing !== "dodge" && c.doing !== "pair" && this.clock >= c.dangerAt) this.startDodge(c);
    this.wary(c, dt);
    // Miedo: lejos de quien le da miedo (o de la pelea), corriendo.
    if (c.fear > 0.35 && c.doing !== "dodge" && c.doing !== "flee" && c.doing !== "pair") {
      const f = this.fearAt(c);
      if (f && Math.hypot(b.x - f.x, b.z - f.z) < 6.5) this.flee(c, f.x, f.z);
    }

    switch (c.doing) {
      case "travel": {
        if (c.arriving) {
          this.arrive(c, dt);
          return;
        }
        this.followPath(c, c.pace);
        wantX = _want.x;
        wantZ = _want.z;
        this.meet(c);
        break;
      }
      case "stay":
        this.stay(c, dt);
        return;
      case "chat": {
        const o = this.cast[c.partner];
        if (!o || o.doing !== "chat" || o.partner !== c.id || c.t > c.dur) {
          this.endChat(c);
          break;
        }
        const dx = o.body.x - b.x, dz = o.body.z - b.z, d = Math.hypot(dx, dz) || 1;
        face = faceYaw(dx, dz);
        if (d > 1.35) (wantX = (dx / d) * 0.7), (wantZ = (dz / d) * 0.7);
        else if (d < 0.85) (wantX = (-dx / d) * 0.5), (wantZ = (-dz / d) * 0.5);
        // Hablan por turnos; quien escucha asiente o se ríe de vez en cuando.
        if (c.talking && c.t > 1 && c.t % 4.5 < dt) {
          c.talking = false;
          o.talking = true;
        }
        m.emote = c.talking ? "talk" : null;
        if (!c.talking && !m.gesture && this.r() < dt * 0.25) this.gest(c, this.r() < 0.5 ? "nod" : "laugh", 1.6);
        this.lookAt(c, o.body.x, o.body.y + 1.55, o.body.z, 0.9);
        break;
      }
      case "respond": {
        const p = this.whereIs(c.who);
        const point = !Number.isNaN(c.fx) && (c.t > 0.7 || !p);
        const tx = point ? c.fx : p ? p.x : NaN, tz = point ? c.fz : p ? p.z : NaN;
        if (!Number.isNaN(tx)) {
          face = faceYaw(tx - b.x, tz - b.z);
          this.lookAt(c, tx, point || !p ? b.y + 1.4 : p.y + 1.55, tz, 1);
        }
        if (c.t > c.dur) this.resume(c);
        break;
      }
      case "watch": {
        const p = this.whereIs(c.who);
        const tx = p ? p.x : c.fx, tz = p ? p.z : c.fz;
        if (Number.isFinite(tx)) {
          const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz) || 1;
          face = faceYaw(dx, dz);
          this.lookAt(c, tx, (p ? p.y : b.y) + 1.4, tz, 1);
          // Una pelea, desde una distancia prudente; a quien baila, un poco más cerca.
          if (!c.who && d < 4) (wantX = (-dx / d) * 1.2), (wantZ = (-dz / d) * 1.2);
          else if (c.who && d > 6 && c.t < 3) (wantX = (dx / d) * 0.9), (wantZ = (dz / d) * 0.9);
        }
        if (c.t > c.dur) this.resume(c);
        break;
      }
      case "follow": {
        const p = this.whereIs(c.who);
        const still = p === me ? Math.hypot(me.vx, me.vz) < 0.3 : false;
        c.idleT = still ? c.idleT + dt : 0;
        if (!p || c.t > c.dur || c.idleT > FOLLOW_IDLE || Math.hypot(p.x - b.x, p.z - b.z) > 25 || Math.abs(p.y - b.y) > 3 || this.upset(c, c.who) || (c.who === "me" && me.driving)) {
          this.gest(c, "wave", 2);
          this.say(c, "npc.bye");
          this.resume(c);
          break;
        }
        // Detrás de ti y un poco a un lado (cada uno al suyo); si te paras, se para de cara a ti.
        const side = c.id % 2 ? 0.7 : -0.7;
        const pfx = -Math.sin(p.yaw), pfz = -Math.cos(p.yaw);
        const tx = p.x - pfx * FOLLOW_GAP + pfz * side, tz = p.z - pfz * FOLLOW_GAP - pfx * side;
        const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
        if (d > 0.4) {
          const v = Math.min(JOG + 0.6, 0.6 + d * 1.3);
          if (d < 2 || clearLine(this.nav.boxes, b.x, b.z, tx, tz, b.y, 0.25)) {
            wantX = (dx / d) * v;
            wantZ = (dz / d) * v;
            c.path.length = 0;
          } else {
            // Una esquina en medio: por el mapa hasta donde estás.
            if (c.t - c.pull > 1.2 || c.pi >= c.path.length) {
              this.pathTo(c, nearestNode(this.nav, p.x, p.y, p.z));
              c.pull = c.t;
            }
            this.followPath(c, v);
            wantX = _want.x;
            wantZ = _want.z;
          }
        } else face = faceYaw(p.x - b.x, p.z - b.z);
        this.lookAt(c, p.x, p.y + 1.55, p.z, 0.7);
        break;
      }
      case "flee": {
        const f = this.fearAt(c);
        const far = f ? Math.hypot(b.x - f.x, b.z - f.z) : Infinity;
        if (!f || c.fear < 0.2 || far > 14) {
          this.resume(c);
          break;
        }
        const tx = f.x, tz = f.z;
        this.followPath(c, c.fear > 0.6 ? JOG : 2.2);
        wantX = _want.x;
        wantZ = _want.z;
        if (c.pi >= c.path.length) this.flee(c, tx, tz);
        // Mira atrás de vez en cuando.
        if (c.t % 3 < 0.8) this.lookAt(c, tx, b.y + 1.5, tz, 0.8);
        else m.fx!.look.w = 0;
        break;
      }
      case "dodge": {
        if (c.t < 0.5) {
          wantX = c.dodgeX * 4.8;
          wantZ = c.dodgeZ * 4.8;
        } else if (c.t > 0.8 && !c.dodgeSaid && b.grounded) {
          c.dodgeSaid = true;
          this.gest(c, "shake_head", 2);
          this.say(c, this.r() < 0.5 ? "npc.careful" : "npc.crazy");
          c.fear = Math.min(1, c.fear + 0.25);
          c.feared = c.dangerWho;
          c.grudge = Math.max(c.grudge, this.clock + GRUDGE * 0.5);
          c.grudgeWho = c.dangerWho;
        }
        // Mira al coche (el que le hizo saltar).
        for (let k = 0; k < this.nCars; k++) {
          const car = _cars[k]!;
          if ((car.who ?? "me") !== c.dangerWho) continue;
          c.dangerX = car.x;
          c.dangerZ = car.z;
        }
        this.lookAt(c, c.dangerX, b.y + 1.2, c.dangerZ, 0.9);
        if (c.t > c.dur && b.grounded) this.resume(c);
        break;
      }
      case "pair": {
        // Se queda de cara a su pareja; ella se acerca a la distancia de la acción (selfPeople.ts).
        const p = this.whereIs(c.who);
        if (p) {
          _me.set(p.x, p.y, p.z);
          face = faceYaw(p.x - b.x, p.z - b.z);
          pairTargets(c.pairKind, mine.with === c.key ? mine.t : c.t, b.x, b.y, b.z, _me, m.fx!, this.fxOf(c.who));
        }
        m.emote = c.pairKind;
        if (c.t > c.dur || !p) {
          m.fx!.reachL.w = m.fx!.reachR.w = 0;
          c.friend = this.clock + FRIEND;
          c.friendWho = c.who;
          c.lastGreet = this.clock;
          this.say(c, c.pairKind === "hug" ? "npc.thanks" : "npc.ok");
          this.resume(c);
        }
        break;
      }
    }

    // De paso: te mira (y si te conoce, te saluda); un gesto pendiente de contestar.
    if (c.doing === "travel" && !this.notice(c, dt)) m.fx!.look.w = 0;
    this.applyReply(c);
    // Rodear a quien venga de frente (tú, las demás personas, otros ciudadanos) y, si se ha quedado
    // atascado contra algo que el mapa no sabe (el coche aparcado, alguien quieto), apartarse a un lado.
    let speed2 = wantX * wantX + wantZ * wantZ;
    if (speed2 > 0.04 && c.doing !== "dodge") {
      this.avoid(c, wantX, wantZ);
      wantX = _want.x;
      wantZ = _want.z;
      if (c.side > 0) {
        c.side -= dt;
        const l = Math.sqrt(speed2);
        const sx = (-wantZ / l) * c.sideDir * 1.1, sz = (wantX / l) * c.sideDir * 1.1;
        wantX = wantX * 0.35 + sx;
        wantZ = wantZ * 0.35 + sz;
      }
      speed2 = wantX * wantX + wantZ * wantZ;
    }
    this.env.step(b, wantX, wantZ, dt);
    this.unstick(c, dt, speed2);
    const sp = Math.hypot(b.vx, b.vz);
    m.speed += (sp - m.speed) * Math.min(1, dt * 6);
    if (m.speed < 0.05) m.speed = 0;
    m.airborne = !b.grounded && b.airTime > 0.06;
    m.vy = b.vy;
    if (sp > 0.25 && c.doing !== "dodge" && c.doing !== "pair") face = Math.atan2(-b.vx, -b.vz);
    if (!Number.isNaN(face)) this.turn(c, face, dt, sp > 0.25 ? 7 : 4);
  }

  /** Atascado (pide andar y casi no se mueve): primero a un lado; si sigue, otro camino. */
  private unstick(c: Citizen, dt: number, speed2: number) {
    const b = c.body;
    const moved = Math.hypot(b.x - c.lastX, b.z - c.lastZ);
    c.lastX = b.x;
    c.lastZ = b.z;
    if ((c.doing !== "travel" && c.doing !== "flee" && c.doing !== "follow") || speed2 < 0.25) {
      c.stuck = 0;
      return;
    }
    c.stuck = moved < 0.3 * dt ? c.stuck + dt : Math.max(0, c.stuck - dt);
    if (c.stuck < 1.2) {
      if (moved > 0.6 * dt) c.stuckN = 0;
      return;
    }
    c.stuck = 0;
    c.stuckN++;
    c.side = 0.9;
    c.sideDir = this.r() < 0.5 ? 1 : -1;
    if (c.stuckN >= 2 && c.doing === "travel") {
      if (c.poi) this.pathTo(c, c.poi.node);
      else this.goSomewhere(c);
    }
    // Encerrado de verdad (y sin nadie mirando): al punto del mapa más cercano.
    if (c.stuckN >= 5 && !c.drawn) {
      const n = this.nav.nodes[nearestNode(this.nav, b.x, b.y, b.z)];
      if (n) placeAt(b, n.x, n.y, n.z);
      c.stuckN = 0;
    }
  }

  /** ¿Viene un coche hacia él? Apunta cuándo se da cuenta (antes quien es más precavido). */
  private danger(c: Citizen) {
    const b = c.body;
    if (c.doing === "dodge") {
      c.dangerAt = Infinity;
      return;
    }
    let car: CarInfo | null = null, lat = 0;
    for (let k = 0; k < this.nCars; k++) {
      const o = _cars[k]!;
      if (o.speed < 4) continue;
      const rx = b.x - o.x, rz = b.z - o.z;
      const along = rx * o.fx + rz * o.fz;
      const l = rx * -o.fz + rz * o.fx;
      if (along > 0.5 && along < o.speed * 1.4 + 2 && Math.abs(l) < 2) {
        car = o;
        lat = l;
        break;
      }
    }
    if (!car) {
      c.dangerAt = Infinity;
      return;
    }
    if (c.dangerAt !== Infinity) return;
    c.dangerWho = car.who ?? "me";
    c.dangerX = car.x;
    c.dangerZ = car.z;
    c.dangerAt = this.clock + 0.15 + c.bold * 0.3 + this.r() * 0.15;
    // Hacia el lado en que ya está (si está en medio, al que tenga sitio).
    const lx = -car.fz, lz = car.fx;
    let side = Math.sign(lat) || 1;
    if (Math.abs(lat) < 0.4 && !clearLine(this.nav.boxes, b.x, b.z, b.x + lx * side * 2, b.z + lz * side * 2, b.y, 0.25)) side = -side;
    c.dodgeX = lx * side;
    c.dodgeZ = lz * side;
  }

  private startDodge(c: Citizen) {
    this.leaveChat(c);
    this.keepGoal(c);
    c.arriving = false;
    c.doing = "dodge";
    c.t = 0;
    c.dur = 1.6;
    c.dangerAt = Infinity;
    c.dodgeSaid = false;
    c.motion.emote = null;
    c.motion.gesture = null;
    // Un salto a un lado.
    const b = c.body;
    b.vx = c.dodgeX * 4.8;
    b.vz = c.dodgeZ * 4.8;
    b.vy = 2.6;
    b.grounded = false;
  }

  /** Alguien en modo pelea cerca: los miedosos se apartan; los demás le miran con los brazos cruzados. */
  private wary(c: Citizen, dt: number) {
    if (c.doing === "pair" || c.doing === "dodge") return;
    const me = this.env.me;
    if (me.fight && !me.driving && this.waryOf(c, dt, "me", me.x, me.y, me.z)) return;
    for (let k = 0; k < this.nRemotes; k++) {
      const o = _remotes[k]!;
      if (o.fight && this.waryOf(c, dt, o.id, o.x, o.y, o.z)) return;
    }
  }

  private waryOf(c: Citizen, dt: number, who: string, x: number, y: number, z: number): boolean {
    const d = Math.hypot(x - c.body.x, z - c.body.z);
    if (d > 4.5 || Math.abs(y - c.body.y) > 1.5) return false;
    if (c.bold < 0.5) {
      c.fear = Math.min(0.6, c.fear + dt * 0.3);
      c.feared = who;
    } else if (this.clock > c.glanceNext && c.doing !== "follow") {
      this.lookAt(c, x, y + 1.55, z, 0.9);
      this.gest(c, "fold_arms", 3);
      c.who = who;
      c.glance = this.clock + 3;
      c.glanceNext = c.glance + 6;
    }
    return true;
  }

  /** Dónde está lo que le da miedo (la persona o la pelea), o null si ya no está. */
  private fearAt(c: Citizen): { x: number; z: number } | null {
    if (c.feared !== "fight") return this.whereIs(c.feared);
    if (!Number.isFinite(c.fx) || !Number.isFinite(c.fz)) return null;
    _fear.x = c.fx;
    _fear.z = c.fz;
    return _fear;
  }

  private flee(c: Citizen, tx: number, tz: number) {
    this.leaveChat(c);
    if (c.doing === "stay" || c.arriving) this.release(c);
    const was = c.doing;
    c.doing = "flee";
    c.t = 0;
    c.motion.emote = null;
    c.motion.gesture = null;
    // El punto del mapa que más le aleja, entre los que están a 8–20 m.
    let best = -1, bestD = -1;
    const N = this.nav.nodes;
    for (let i = 0; i < N.length; i++) {
      const n = N[i]!;
      if (!n.links.length || Math.abs(n.y - c.body.y) > 1) continue;
      const d = Math.hypot(n.x - c.body.x, n.z - c.body.z);
      if (d < 8 || d > 20) continue;
      const away = Math.hypot(n.x - tx, n.z - tz);
      if (away > bestD) (bestD = away), (best = i);
    }
    if (best >= 0) this.pathTo(c, best);
    if (was !== "flee" && this.r() < 0.5) this.say(c, "npc.leave");
  }

  /** Por el camino, si se cruzan dos con ganas de hablar, se paran a charlar. */
  private meet(c: Citizen) {
    if (c.social < 0.45 || this.clock - c.lastChat < 50 || c.arriving) return;
    for (const o of this.cast) {
      if (o === c || !o.near || o.knocked || o.doing !== "travel" || o.arriving || o.social < 0.45 || this.clock - o.lastChat < 50) continue;
      if (Math.hypot(o.body.x - c.body.x, o.body.z - c.body.z) > 2.6 || Math.abs(o.body.y - c.body.y) > 0.5) continue;
      c.lastChat = o.lastChat = this.clock;
      if (this.r() > 0.35 + (c.social + o.social) * 0.2) return;
      const dur = 7 + this.r() * 9;
      this.startChat(c, o, dur, true);
      this.startChat(o, c, dur, false);
      this.gest(c, "wave", 1.8);
      this.say(c, "npc.hey");
      return;
    }
  }

  private startChat(a: Citizen, b: Citizen, dur: number, talking: boolean) {
    a.doing = "chat";
    a.partner = b.id;
    a.t = 0;
    a.dur = dur;
    a.talking = talking;
  }

  private endChat(c: Citizen) {
    const o = this.cast[c.partner];
    c.partner = -1;
    c.motion.emote = null;
    if (o && o.partner === c.id) {
      o.partner = -1;
      o.motion.emote = null;
      this.gest(o, "wave", 1.8);
      this.resume(o);
    }
    this.resume(c);
  }

  private leaveChat(c: Citizen) {
    if (c.doing !== "chat") return;
    const o = this.cast[c.partner];
    c.partner = -1;
    c.motion.emote = null;
    if (o && o.partner === c.id) {
      o.partner = -1;
      o.motion.emote = null;
      this.resume(o);
    }
  }

  /**
   * Te mira al pasar (y si te conoce, o es muy sociable y le miras, te saluda). Devuelve true si
   * ahora está mirando a alguien (entonces no se le pone otra cosa que mirar).
   */
  private notice(c: Citizen, dt: number): boolean {
    if (this.clock < c.glance) {
      // Contestando o mirando a alguien: le sigue con la mirada.
      const p = this.whereIs(c.who);
      if (p) this.lookAt(c, p.x, p.y + 1.55, p.z, c.motion.fx!.look.w || 0.8);
      return true;
    }
    // Sin dibujar no hay a quién mirar (ni quien lo vea; llevándolos para todos, quien esté cerca).
    if (!this.aware(c)) return false;
    // La persona más cercana que tenga delante (tú o cualquiera).
    const me = this.env.me;
    const b = c.body;
    const n = _near;
    n.who = "";
    n.d = NOTICE;
    if (!me.driving) this.consider(c, "me", me.x, me.y, me.z, me.yaw);
    for (let k = 0; k < this.nRemotes; k++) {
      const o = _remotes[k]!;
      this.consider(c, o.id, o.x, o.y, o.z, o.yaw);
    }
    const who = n.who, d = n.d, px = n.x, py = n.y, pz = n.z, pyaw = n.yaw;
    if (!who) return false;
    const dx = px - b.x, dz = pz - b.z;
    const looked = d > 0.1 ? (-dx * -Math.sin(pyaw) + -dz * -Math.cos(pyaw)) / d : 1;
    if (this.clock - c.lastGreet > 90 && d < 4.5 && looked > 0.6 && ((c.friend > this.clock && c.friendWho === who) || (c.social > 0.75 && this.r() < dt * 0.8))) {
      c.lastGreet = this.clock;
      this.gest(c, "wave", 2.2);
      this.say(c, "npc.hi");
      this.lookAt(c, px, py + 1.55, pz, 0.8);
      c.who = who;
      c.glance = this.clock + 2.5;
      c.glanceNext = c.glance + 6;
      return true;
    }
    if (this.clock > c.glanceNext && this.r() < dt * (0.5 + c.curious)) {
      this.lookAt(c, px, py + 1.55, pz, c.grudge > this.clock && c.grudgeWho === who ? 0.9 : 0.65);
      c.who = who;
      c.glance = this.clock + 1.5 + this.r() * 1.5;
      c.glanceNext = c.glance + 4 + this.r() * 6;
      return true;
    }
    return false;
  }

  /** ¿Es esta persona la más cercana de las que `c` tiene delante? (en `_near`) */
  private consider(c: Citizen, id: string, x: number, y: number, z: number, yaw: number) {
    const b = c.body, n = _near;
    const dd = Math.hypot(x - b.x, z - b.z);
    if (dd > n.d || Math.abs(y - b.y) > 1.5) return;
    const front = dd > 0.1 ? ((x - b.x) * -Math.sin(c.yaw) + (z - b.z) * -Math.cos(c.yaw)) / dd : 1;
    if (front < -0.2) return;
    n.who = id;
    n.d = dd;
    n.x = x;
    n.y = y;
    n.z = z;
    n.yaw = yaw;
  }

  /** El gesto pendiente de contestar, cuando toca. */
  private applyReply(c: Citizen) {
    if (!c.reply || this.clock < c.replyAt) return;
    if (c.replyFull) {
      c.motion.emote = c.reply;
      c.motion.gesture = null;
    } else this.gest(c, c.reply, c.replyDur);
    c.reply = null;
  }

  /**
   * Rodear a quien venga hacia él (se aparta a su derecha, como en la calle) sin pisar a nadie: lo que
   * quiere (wx, wz) más el desvío, en `_want`.
   */
  private avoid(c: Citizen, wx: number, wz: number) {
    const b = c.body;
    const speed = Math.hypot(wx, wz);
    this.ax = this.az = 0;
    const me = this.env.me;
    if (!me.driving && Math.abs(me.y - b.y) < 1.2) this.avoidOne(b, me.x, me.z, me.vx, me.vz, R_ME, wx, wz, speed);
    for (let k = 0; k < this.nRemotes; k++) {
      const o = _remotes[k]!;
      if (Math.abs(o.y - b.y) < 1.2) this.avoidOne(b, o.x, o.z, 0, 0, R, wx, wz, speed);
    }
    for (const o of this.cast) if (o !== c && o.near && !o.knocked && Math.abs(o.body.y - b.y) < 1.2) this.avoidOne(b, o.body.x, o.body.z, o.body.vx, o.body.vz, R, wx, wz, speed);
    let x = wx + this.ax, z = wz + this.az;
    const l = Math.hypot(x, z);
    if (l > speed * 1.15) (x *= (speed * 1.15) / l), (z *= (speed * 1.15) / l);
    _want.x = x;
    _want.z = z;
  }

  private avoidOne(b: Body, ox: number, oz: number, ovx: number, ovz: number, r: number, wx: number, wz: number, speed: number) {
    const px = ox - b.x, pz = oz - b.z;
    const d = Math.hypot(px, pz);
    if (d > 3.2 || d < 1e-3) return;
    // ¿Cuándo y a cuánto se cruzan, si los dos siguen igual?
    const rvx = ovx - wx, rvz = ovz - wz;
    const rv2 = rvx * rvx + rvz * rvz;
    const tca = rv2 > 1e-4 ? -(px * rvx + pz * rvz) / rv2 : 0;
    if (tca < 0 || tca > 1.6) return;
    const cx = px + rvx * tca, cz = pz + rvz * tca;
    const miss = Math.hypot(cx, cz);
    const need = r + R + 0.25;
    if (miss > need) return;
    // A la derecha de hacia donde va (o hacia donde ya se iba a apartar).
    const hx = wx / speed, hz = wz / speed;
    let sx = -hz, sz = hx;
    if (sx * cx + sz * cz > 0 && miss > 0.15) (sx = -sx), (sz = -sz);
    const k = ((need - miss) / need) * (1 - tca / 1.6);
    this.ax += sx * k * speed * 1.6;
    this.az += sz * k * speed * 1.6;
  }

  private lookAt(c: Citizen, x: number, y: number, z: number, w: number) {
    const l = c.motion.fx!.look;
    l.x = x;
    l.y = y;
    l.z = z;
    l.w = w;
  }

  private turn(c: Citizen, want: number, dt: number, rate: number) {
    const d = wrap(want - c.yaw);
    c.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
  }

  /** Lo que el esqueleto de su pareja sabe de sí mismo (lo que mide), para las acciones en pareja. */
  private fxOf(who: string): PersonFx | null {
    if (!who || who === "fight") return null;
    if (who === "me" || who === this.link?.me()) return mine.fx;
    return remoteFx.get(who) ?? null;
  }

  private whereIs(who: string): { x: number; y: number; z: number; yaw: number } | null {
    if (!who || who === "fight") return null;
    if (who === "me" || who === this.link?.me()) return this.env.me;
    for (let k = 0; k < this.nRemotes; k++) if (_remotes[k]!.id === who) return _remotes[k]!;
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Caminos y sitios                                                   */
  /* ---------------------------------------------------------------- */

  private randomNode(): number {
    const N = this.nav.nodes;
    for (let k = 0; k < 40; k++) {
      const i = Math.floor(this.r() * N.length);
      if (N[i]!.links.length) return i;
    }
    return 0;
  }

  /** ¿Hay alguien de su corro (de la calle de Cero) ya en su sitio? */
  private groupBusy(p: Poi, kind?: PoiKind): boolean {
    for (const q of this.groupPois.get(p.group) ?? []) {
      if (q === p || q.taken < 0 || (kind && q.kind !== kind)) continue;
      if (this.cast[q.taken]?.doing === "stay") return true;
    }
    return false;
  }

  /** Adónde ir ahora: un sitio libre, ni muy cerca ni muy lejos, que no sea de los últimos. */
  private choosePoi(c: Citizen, from: { x: number; z: number } | null): Poi | null {
    const pois = this.nav.pois;
    const w = (p: Poi) => {
      if (p.taken >= 0) return 0;
      let v = WANT[p.kind];
      if (p.kind === "hang" || p.kind === "dance") v *= 0.4 + c.social;
      if (p.kind === "play" || p.kind === "look" || p.kind === "window") v *= 0.5 + c.curious;
      if (p.kind === "dance") v *= c.bold;
      // Donde ya hay alguien de un corro, apetece más (la gente se junta); para mirar, que alguien baile.
      if (p.group >= 0) {
        if (p.kind === "watch") v *= this.groupBusy(p, "dance") ? 3 : 0;
        else if (this.groupBusy(p)) v *= 2.5;
      }
      if (c.recent.includes(p)) v *= 0.08;
      if (from) {
        const d = Math.hypot(p.x - from.x, p.z - from.z);
        v *= d < 5 ? 0.05 : d > 75 ? 0.25 : 1;
      }
      return v;
    };
    let total = 0;
    for (const p of pois) total += w(p);
    if (total <= 0) return null;
    let k = this.r() * total;
    for (const p of pois) {
      k -= w(p);
      if (k <= 0) return p;
    }
    return null;
  }

  private take(c: Citizen, p: Poi) {
    if (c.poi && c.poi !== p && c.poi.taken === c.id) c.poi.taken = -1;
    c.poi = p;
    p.taken = c.id;
  }

  /** Deja su sitio (lo libera) y lo que estaba haciendo allí. */
  private release(c: Citizen) {
    if (c.poi) {
      if (c.poi.taken === c.id) c.poi.taken = -1;
      c.recent.push(c.poi);
      if (c.recent.length > 4) c.recent.shift();
    }
    c.poi = null;
    c.arriving = false;
    c.motion.emote = null;
  }

  /** Antes de atender a otra cosa: si estaba en su sitio, se levanta (pero lo guarda para volver). */
  private keepGoal(c: Citizen) {
    if (c.doing === "stay" && c.poi) {
      c.motion.emote = null;
      c.arriving = false;
    }
  }

  /** Vuelve a lo suyo: a su sitio si lo tenía (o a otro). */
  private resume(c: Citizen) {
    c.reply = null;
    c.partner = -1;
    c.who = "";
    c.fx = c.fz = NaN;
    c.side = 0;
    const m = c.motion;
    m.fx!.reachL.w = m.fx!.reachR.w = 0;
    m.emote = null;
    if (c.poi && c.poi.taken === c.id) {
      c.doing = "travel";
      c.t = 0;
      c.arriving = Math.hypot(c.body.x - c.poi.ax, c.body.z - c.poi.az) < 0.8 && Math.abs(c.body.y - c.poi.y) < 0.5;
      if (!c.arriving) this.pathTo(c, c.poi.node);
      return;
    }
    this.goSomewhere(c);
  }

  private goSomewhere(c: Citizen) {
    if (c.poi) this.release(c);
    c.doing = "travel";
    c.t = 0;
    c.motion.emote = null;
    const p = this.choosePoi(c, c.body);
    if (p) {
      this.take(c, p);
      this.pathTo(c, p.node);
    } else this.pathTo(c, this.randomNode());
  }

  private pathTo(c: Citizen, to: number) {
    const from = nearestNode(this.nav, c.body.x, c.body.y, c.body.z);
    c.path = findPath(this.nav, from, to) ?? [];
    // Primero al punto del mapa más cercano (los atajos lo saltan si ya se ve el siguiente).
    if (from >= 0 && c.path[0] !== from) c.path.unshift(from);
    c.pi = 0;
    c.pull = c.t;
  }

  /** Velocidad para seguir el camino (con atajos cuando el siguiente punto ya se ve), en `_want`. */
  private followPath(c: Citizen, speed: number) {
    const b = c.body, N = this.nav.nodes;
    _want.x = _want.z = 0;
    if (c.pi >= c.path.length) return;
    let n = N[c.path[c.pi]!]!;
    // Atajo: si se ve el siguiente, se va a por él (cada poco, que cuesta).
    if (c.t - c.pull > 0.4 && c.pi + 1 < c.path.length) {
      c.pull = c.t;
      const nx = N[c.path[c.pi + 1]!]!;
      if (Math.abs(nx.y - b.y) < 0.6 && !n.stairs && !nx.stairs && clearLine(this.nav.boxes, b.x, b.z, nx.x, nx.z, b.y, 0.3)) {
        c.pi++;
        n = nx;
      }
    }
    const dx = n.x - b.x, dz = n.z - b.z, d = Math.hypot(dx, dz);
    const last = c.pi === c.path.length - 1;
    if (d < (last ? 0.35 : 0.75) && Math.abs(n.y - b.y) < 1) {
      c.pi++;
      if (c.pi >= c.path.length) {
        if (c.doing === "travel") {
          if (c.poi) c.arriving = true;
          else this.goSomewhere(c);
        }
        return;
      }
      n = N[c.path[c.pi]!]!;
    }
    const ex = n.x - b.x, ez = n.z - b.z, e = Math.hypot(ex, ez) || 1;
    // Despacio en las escaleras y al llegar.
    const v = (n.stairs ? 0.75 : 1) * speed * (c.pi === c.path.length - 1 ? Math.min(1, 0.35 + e / 2) : 1);
    _want.x = (ex / e) * v;
    _want.z = (ez / e) * v;
  }

  /** El último tramo hasta el sitio (sin física: un banco es una caja y lo subiría encima). */
  private arrive(c: Citizen, dt: number) {
    const p = c.poi!, b = c.body, m = c.motion;
    // ¿Ya está ahí alguien (tú, otra persona)? Entonces, a otro sitio.
    const me = this.env.me;
    if (Math.hypot(me.x - p.x, me.z - p.z) < 0.55 && Math.abs(me.y - p.y) < 1) {
      this.goSomewhere(c);
      return;
    }
    for (let k = 0; k < this.nRemotes; k++) {
      const o = _remotes[k]!;
      if (Math.hypot(o.x - p.x, o.z - p.z) < 0.55 && Math.abs(o.y - p.y) < 1) {
        this.goSomewhere(c);
        return;
      }
    }
    const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, 0.8 * dt);
    if (d > 1e-3) {
      b.x += (dx / d) * step;
      b.z += (dz / d) * step;
    }
    b.y += (p.y - b.y) * Math.min(1, dt * 6);
    b.vx = b.vz = 0;
    m.speed = d > 0.05 ? 0.8 : 0;
    m.airborne = false;
    this.turn(c, d > 0.3 ? faceYaw(dx, dz) : p.yaw, dt, 5);
    this.notice(c, dt);
    if (d < 0.03 && Math.abs(wrap(p.yaw - c.yaw)) < 0.15) {
      c.arriving = false;
      this.startStay(c, 0);
    }
  }

  private startStay(c: Citizen, done: number) {
    const p = c.poi!;
    c.doing = "stay";
    c.dur = p.stay[0] + this.r() * (p.stay[1] - p.stay[0]);
    c.t = c.dur * done;
    c.motion.emote = p.emote;
    c.motion.speed = 0;
    c.stuckN = 0;
    placeAt(c.body, p.x, p.y, p.z);
  }

  /** En su sitio: quieto (sin física), con lo suyo; al acabar, a otro. */
  private stay(c: Citizen, dt: number) {
    const p = c.poi!, m = c.motion, b = c.body;
    b.x = p.x;
    b.y = p.y;
    b.z = p.z;
    b.vx = b.vz = 0;
    m.speed = 0;
    m.airborne = false;
    this.turn(c, p.yaw, dt, 4);
    // La expendedora: pulsar un momento y después, de pie; en una esquina sin nada, el móvil a ratos.
    if (p.kind === "vend" && c.t > 2.6) m.emote = null;
    if (p.kind === "corner" && !p.emote) m.emote = c.t % 9 < 4.5 ? "phone" : null;
    const busy = this.notice(c, dt);
    if (p.kind === "hang") {
      // En un corro: charla con quien haya, por turnos; si está solo, el móvil a ratos.
      const mate = this.mateOf(c);
      if (mate) {
        if (!busy) this.lookAt(c, mate.body.x, mate.body.y + 1.55, mate.body.z, 0.85);
        const turn = Math.floor((this.clock + p.group * 1.3) / 3.5) % 2 === (c.id < mate.id ? 0 : 1);
        m.emote = turn ? "talk" : null;
        if (!turn && !m.gesture && this.r() < dt * 0.2) this.gest(c, this.r() < 0.6 ? "nod" : "laugh", 1.6);
      } else {
        m.emote = c.t % 10 < 6 ? "phone" : null;
        if (!busy) m.fx!.look.w = 0;
      }
    } else if (!busy) {
      if (p.look) this.lookAt(c, p.look[0], p.look[1], p.look[2], 0.8);
      else m.fx!.look.w = 0;
    }
    // El público de quien baila: aplaude de vez en cuando.
    if (p.kind === "watch" && !m.gesture) {
      const dancer = this.danceOf.get(p.group);
      if (dancer && dancer.taken >= 0 && this.cast[dancer.taken]?.doing === "stay" && this.r() < dt * 0.15) this.gest(c, "clap", 2.5);
    }
    this.applyReply(c);
    if (c.t > c.dur) {
      m.gesture = null;
      this.goSomewhere(c);
    }
  }

  /** Alguien de su corro que ya está en su sitio. */
  private mateOf(c: Citizen): Citizen | null {
    const p = c.poi!;
    for (const q of this.groupPois.get(p.group) ?? []) {
      if (q === p || q.taken < 0) continue;
      const o = this.cast[q.taken];
      if (o && o.doing === "stay" && o.poi === q) return o;
    }
    return null;
  }

  /** Lejos: por el mapa, sin física ni nada que ver; en sus sitios, el tiempo pasa igual. */
  private farStep(c: Citizen, dt: number) {
    const b = c.body;
    c.motion.speed = 0;
    if (c.doing !== "travel" && c.doing !== "stay") this.resume(c);
    if (c.doing === "stay") {
      if (c.t > c.dur) this.goSomewhere(c);
      return;
    }
    if (c.arriving || c.pi >= c.path.length) {
      if (c.poi) {
        placeAt(b, c.poi.x, c.poi.y, c.poi.z);
        c.yaw = c.poi.yaw;
        c.arriving = false;
        this.startStay(c, 0);
      } else this.goSomewhere(c);
      return;
    }
    const n = this.nav.nodes[c.path[c.pi]!]!;
    const dx = n.x - b.x, dz = n.z - b.z, dy = n.y - b.y, d = Math.hypot(dx, dz);
    const step = c.pace * dt;
    if (d <= step) {
      b.x = n.x;
      b.y = n.y;
      b.z = n.z;
      c.pi++;
    } else {
      b.x += (dx / d) * step;
      b.z += (dz / d) * step;
      b.y += dy * (step / d);
    }
    if (d > 1e-3) c.yaw = faceYaw(dx, dz);
  }

  /* ---------------------------------------------------------------- */
  /* Física: empujarse                                                  */
  /* ---------------------------------------------------------------- */

  /** ¿Se le puede mover? (sentado, jugando, en pareja o en el suelo, no). */
  private movable(c: Citizen) {
    return c.near && !c.knocked && c.doing !== "stay" && c.doing !== "pair" && !c.arriving;
  }

  private physics(dt: number) {
    const me = this.env.me;
    const cast = this.cast;
    for (let i = 0; i < cast.length; i++) {
      const a = cast[i]!;
      if (!a.near || a.knocked) continue;
      const ma = this.movable(a);
      // Entre ellos: cada uno se aparta la mitad (o todo, si el otro no se puede mover) y el choque
      // reparte la velocidad (con la misma masa, casi sin rebote).
      for (let j = i + 1; j < cast.length; j++) {
        const o = cast[j]!;
        if (!o.near || o.knocked || Math.abs(a.body.y - o.body.y) > 1.2) continue;
        const dx = o.body.x - a.body.x, dz = o.body.z - a.body.z;
        const d = Math.hypot(dx, dz);
        if (d >= 2 * R || d < 1e-6) continue;
        const mo = this.movable(o);
        if (!ma && !mo) continue;
        const nx = dx / d, nz = dz / d, over = 2 * R - d;
        const ka = ma ? (mo ? 0.5 : 1) : 0, ko = mo ? (ma ? 0.5 : 1) : 0;
        a.body.x -= nx * over * ka;
        a.body.z -= nz * over * ka;
        o.body.x += nx * over * ko;
        o.body.z += nz * over * ko;
        const vn = (a.body.vx - o.body.vx) * nx + (a.body.vz - o.body.vz) * nz;
        if (vn > 0) {
          const imp = vn * 0.55;
          a.body.vx -= nx * imp * ka * 2;
          a.body.vz -= nz * imp * ka * 2;
          o.body.vx += nx * imp * ko * 2;
          o.body.vz += nz * imp * ko * 2;
        }
      }
      if (!ma) continue;
      // Contigo: si estáis encima, se aparta él (a ti te frena tu propia colisión, collision.ts); si
      // empujas hacia él, le empujas (a tu paso, algo frenado) y lo dice.
      if (!me.driving && mine.apart !== a.key && Math.abs(me.y - a.body.y) < 1.2) {
        const dx = a.body.x - me.x, dz = a.body.z - me.z;
        const d = Math.hypot(dx, dz);
        if (d < R + R_ME + CONTACT && d > 1e-6) {
          const nx = dx / d, nz = dz / d;
          const over = R + R_ME - d;
          if (over > 0) {
            a.body.x += nx * over;
            a.body.z += nz * over;
          }
          const wish = me.wx * nx + me.wz * nz;
          if (wish > 0.3) {
            const v = Math.min(1.3, wish * 0.6);
            a.body.x += nx * v * dt;
            a.body.z += nz * v * dt;
            a.pushT += dt * 1.5;
            if (a.pushT > 0.4 && this.clock - a.lastSaid > 5) {
              this.say(a, a.pushT > 1.6 ? "npc.push" : "npc.excuse");
              this.lookAt(a, me.x, me.y + 1.55, me.z, 0.9);
              a.who = "me";
              a.glance = this.clock + 2;
            }
          }
        }
      }
      // Las demás personas: no se mueven por él (cada cliente mueve a los suyos); se aparta él.
      for (let k = 0; k < this.nRemotes; k++) {
        const o = _remotes[k]!;
        if (Math.abs(o.y - a.body.y) > 1.2) continue;
        const dx = a.body.x - o.x, dz = a.body.z - o.z, d = Math.hypot(dx, dz);
        if (d < 2 * R && d > 1e-6) {
          a.body.x += (dx / d) * (2 * R - d);
          a.body.z += (dz / d) * (2 * R - d);
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Golpes y caídas (knock.ts), y dibujarlos                           */
  /* ---------------------------------------------------------------- */

  private knocks() {
    const me = this.env.me;
    const npcs = this.env.npcs;
    const watching = this.watching();
    for (const c of this.cast) {
      if (!c.drawn || c.slot < 0 || !c.group) continue;
      const i = c.slot;
      if (npcs.knock[i * 4]) {
        // Un golpe nuevo: de qué (el coche si conduces, un golpe en modo pelea o que corrías contra él)
        // y de quién (lo de los demás llega con lo suyo: remoteEvent).
        const kind: HitKind = npcs.knockShot?.[i] ? "shot" : me.driving ? "car" : me.fight ? "hit" : "bump";
        if (watching) {
          // Viéndolos como llegan: el de la red ya está contado; el tuyo se ve ya y se le cuenta a quien los lleva.
          if (c.injected) c.injected = false;
          else {
            c.localHitAt = this.clock;
            this.link!.hit(c.id, npcs.knock[i * 4 + 1]!, npcs.knock[i * 4 + 2]!, npcs.knock[i * 4 + 3]!, (npcs.knockHead?.[i] ?? 0) === 1, kind as NpcHitKind);
          }
        } else {
          c.hitKind = c.pendingKind || kind;
          c.hitBy = c.pendingBy || "me";
          c.pendingKind = "";
          c.pendingBy = "";
          this.noteKnock(c, npcs.knock[i * 4 + 1]!, npcs.knock[i * 4 + 2]!, npcs.knock[i * 4 + 3]!, npcs.knockHead?.[i] ?? 0);
        }
      }
      const was = c.knocked;
      const g = c.group;
      const busy = this.env.knock(i, g, c.body.x, c.body.y, c.body.z, c.yaw, c.motion);
      c.knocked = busy;
      if (watching) {
        // De pie otra vez: de donde se levantó a donde dice el estado, poco a poco (place).
        if (!busy && was) {
          c.ox = g.position.x - c.body.x;
          c.oz = g.position.z - c.body.z;
          c.visY = g.position.y;
          c.yaw = g.rotation.y;
        }
        continue;
      }
      if (busy && !was) this.struck(c);
      if (!busy && was) this.recover(c, g.position.x, g.position.y, g.position.z, g.rotation.y);
    }
  }

  /** Le acaban de dar: suelta lo que hacía; los de alrededor se asustan o se paran a mirar. */
  private struck(c: Citizen) {
    this.leaveChat(c);
    if (c.doing === "stay" || c.arriving || c.doing === "pair") this.release(c);
    c.motion.gesture = null;
    c.reply = null;
    c.doing = "travel";
    c.path.length = 0;
    c.pi = 0;
    if (c.hitKind === "bump") return;
    for (const o of this.cast) {
      if (o === c || !o.near || o.knocked) continue;
      const d = Math.hypot(o.body.x - c.body.x, o.body.z - c.body.z);
      if (d > 10) continue;
      o.fear = Math.min(1, o.fear + (0.25 + (1 - o.bold) * 0.4) * (1 - d / 12));
      o.feared = c.hitBy;
      if (o.fear <= 0.35 && o.doing !== "pair" && o.doing !== "follow" && o.doing !== "dodge") this.watch(o, c.body.x, c.body.z, 3 + o.curious * 3, o.bold > 0.6 ? "shake_head" : null);
    }
  }

  /** Ya de pie, donde ha caído: sigue con su vida (con miedo y rencor a quien le ha dado, según lo que le ha hecho). */
  private recover(c: Citizen, x: number, y: number, z: number, yaw: number) {
    placeAt(c.body, x, y, z);
    c.visY = y;
    c.yaw = yaw;
    c.motion.gesture = null;
    c.lastX = c.body.x;
    c.lastZ = c.body.z;
    const kind = c.hitKind;
    const by = c.hitBy || "me";
    c.hitKind = "";
    c.feared = by;
    if (kind === "bump") {
      c.fear = Math.min(1, c.fear + 0.12);
      this.say(c, this.r() < 0.5 ? "npc.careful" : "npc.ouch");
      this.gest(c, "shake_head", 1.8);
      const p = this.whereIs(by);
      if (p) this.lookAt(c, p.x, p.y + 1.55, p.z, 0.9);
      c.who = by;
      c.glance = this.clock + 2;
    } else {
      // Un coche o un disparo asustan más que un golpe.
      c.fear = Math.min(1, c.fear + (kind === "car" ? 0.6 : kind === "shot" ? 0.55 : 0.4) + (1 - c.bold) * 0.4);
      c.grudge = this.clock + (kind === "car" ? GRUDGE * 1.4 : GRUDGE);
      c.grudgeWho = by;
      this.say(c, kind === "car" ? "npc.crazy" : this.r() < 0.5 ? "npc.ouch" : "npc.leave");
    }
    this.resume(c);
  }

  private place(dt: number) {
    const npcs = this.env.npcs;
    let count = 0;
    for (const c of this.cast) {
      const g = c.group;
      if (!c.drawn || !g || c.slot < 0) {
        c.feet.set(c.body.x, c.body.y, c.body.z);
        continue;
      }
      if (!c.knocked) {
        // Los escalones, con suavidad (la física sube de golpe).
        const dy = c.body.y - c.visY;
        c.visY = Math.abs(dy) < 0.6 && c.body.grounded ? c.visY + dy * Math.min(1, dt * 14) : c.body.y;
        // Tras levantarse (viéndolos como llegan), de donde quedó a donde está, poco a poco.
        if (c.ox !== 0 || c.oz !== 0) {
          const f = Math.exp(-dt * 2.5);
          c.ox = Math.abs(c.ox) < 0.01 ? 0 : c.ox * f;
          c.oz = Math.abs(c.oz) < 0.01 ? 0 : c.oz * f;
        }
        g.position.set(c.body.x + c.ox, c.visY, c.body.z + c.oz);
        g.rotation.set(0, c.yaw, 0);
      }
      c.feet.set(g.position.x, g.position.y, g.position.z);
      const i = c.slot;
      npcs.pos[i * 3] = g.position.x;
      npcs.pos[i * 3 + 1] = g.position.y;
      npcs.pos[i * 3 + 2] = g.position.z;
      // En pareja contigo no es sólido para ti (un abrazo es más cerca que dos cuerpos), ni al acabar,
      // hasta que os separáis (where.ts → `apart`).
      if (npcs.ghost) npcs.ghost[i] = mine.with === c.key || mine.apart === c.key ? 1 : 0;
      count = Math.max(count, i + 1);
    }
    // Los huecos libres por debajo del último, fuera de todo (no chocan ni se les puede dar).
    for (let i = 0; i < count; i++) if (!this.slots[i]) npcs.pos[i * 3 + 1] = HIDDEN_Y;
    npcs.count = count;
  }
}
