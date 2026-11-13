/**
 * Parkour de Vertical (el distrito lo dice en WELCOME.parkour; en el resto, world/locomotion.ts tal
 * cual). Con los mismos botones de siempre, según lo que tengas delante:
 *
 * - **Saltar vallas** (vault): corriendo contra algo de 0,45–1,35 m de alto y poco fondo, se pasa por
 *   encima apoyando las manos, sin pararse.
 * - **Subir** (mantle): lo mismo pero con fondo (una plataforma): manos arriba, rodilla y de pie
 *   encima. Corriendo, solo; andando, con el salto o empujando contra el borde un momento.
 * - **Colgarse** de un borde que pillas con las manos al saltar (hasta ~2,3 m por encima de los pies):
 *   de lado a lado por el borde, arriba con el salto (o hacia delante), abajo con agacharse y, de
 *   espaldas, un salto hacia atrás.
 * - **Correr por paredes**: saltando corriendo junto a una pared casi paralela, unos pasos por ella
 *   (algo más de un segundo) y, con el salto, rebote hacia el otro lado. **Subir por la pared**:
 *   saltando de frente contra una pared alta, dos pasos hacia arriba y, si llegas, a colgarte.
 * - **Rebote en la pared** (wall jump): en el aire, tocando una pared, el salto te lanza hacia fuera
 *   (y de una pared a otra, sin repetir la misma hasta tocar el suelo).
 * - **Deslizarse** corriendo con agacharse (por debajo de lo que esté a más de ~1 m) y **agacharse**
 *   andando (por debajo de ~1,2 m).
 * - **Rodar al caer**: al caer de alto moviéndote (o con agacharse justo antes de tocar el suelo),
 *   una voltereta que no te frena; de más de ~2,5 m sin rodar, el golpe de siempre.
 * - **Equilibrio** sobre una viga estrecha (los brazos se abren; lo dibuja la animación).
 *
 * Lo que se guía (saltar vallas, subir, trepar desde colgado) comprueba antes con las sondas de
 * world/collision.ts que hay sitio para todo el recorrido, y lo hace por una curva: la de subir sale
 * de la captura de movimiento (ClimbUp_1m de la Universal Animation Library 2, CC0), estirada a la
 * altura y al fondo de cada borde. Lo demás es física de verdad sobre `stepBody`.
 *
 * Sin objetos nuevos por frame: el estado vive en `Parkour` y las sondas, en objetos de módulo. Sin
 * nada del navegador: se prueba en Node (test/parkour.mts).
 */
import { floorAt, groundHeight, ceilingHeight, probeWall, solidColumn, wallHit } from "../collision";
import { BODY_HEIGHT, BODY_RADIUS, GRAVITY, JUMP_V, requestJump, STEP_UP, stepBody, type Body } from "../locomotion";

const R = BODY_RADIUS;
/** Alturas del cuerpo agachado y deslizándose (m). */
export const CROUCH_H = 1.1;
export const SLIDE_H = 0.95;
/** Velocidad para que salte vallas y suba solo, sin pulsar nada (m/s). */
const RUN_MIN = 3.4;
/** Velocidad mínima para deslizarse y para correr por una pared. */
const SLIDE_MIN = 3.8;
const WALLRUN_MIN = 3.4;
/** Agachado se anda despacio. */
const CROUCH_SPEED = 1.5;
/** De lo alto del borde a los pies, colgado (manos arriba, brazos casi estirados). */
export const HANG_DROP = 2.05;
/**
 * Colgado: del centro del cuerpo a la cara de la pared (lo que deja el cuerpo de las colisiones) y lo
 * que el dibujo va más pegado a ella (el pecho casi contra la pared, como de verdad).
 */
export const HANG_OFF = BODY_RADIUS + 0.05;
export const HANG_IN = 0.18;
/** Lo que dura trepar desde colgado (s): también lo dibuja así quien lo ve (Avatars.tsx). */
export const HANG_CLIMB_S = 1.05;
/** Bordes que se pillan: por encima de los pies, para subir directo y para colgarse. */
const MANTLE_LO = 0.45;
const MANTLE_HI = 1.35;
const MANTLE_HI_AIR = 1.55;
const HANG_HI = 2.3;
/** A partir de esta velocidad de caída (≈ 2,5 m) el aterrizaje duele (o se rueda). */
const SOFT_LANDING = 8.6;
/** De más alto que esto (≈ 10 m) ni rodando. */
const ROLL_MAX = 17.5;
/** Sin rodar, de más alto que esto (≈ 5 m) las piernas no aguantan: se cae de verdad (people/selfPeople). */
const FALL_LANDING = 12.2;
/** Corriendo de frente contra una pared alta sin saltar, a partir de esta velocidad: el golpe y al suelo. */
const CRASH_SPEED = 5.2;
/**
 * …y solo con carrerilla: este rato seguido corriendo (unos tres metros desde parado). El cuerpo coge
 * la velocidad de correr en un par de décimas, y con teclado se corre siempre: sin esto, quien
 * arrancaba a un paso de una pared (la salida de un nivel, que es al pie de su pila) se estampaba
 * nada más pulsar W, y otra vez al levantarse.
 */
export const CRASH_RUN = 0.45;

export type PkMove = "none" | "vault" | "mantle" | "hang" | "climb" | "wallrun" | "wallup" | "slide" | "slideup" | "crouch" | "roll" | "land";

/** Lo que pide quien juega, ya en el mundo. */
export interface ParkourInput {
  /** Velocidad pedida en el plano (m/s). */
  wantX: number;
  wantZ: number;
  /** Salto pulsado este frame (lo consume el parkour: un salto normal o un movimiento). */
  jump: boolean;
  /** Agacharse mantenido y pulsado este frame (X o el botón). */
  crouch: boolean;
  crouchPressed: boolean;
  /** Hacia dónde mira el cuerpo (adelante = (−sin, −cos)). */
  yaw: number;
}

export interface Parkour {
  move: PkMove;
  /** Segundos en el movimiento y su duración (los guionados). */
  t: number;
  dur: number;
  /** Progreso 0..1 (lo usa la animación). */
  p: number;
  /** Correr por paredes: la pared a la izquierda (−1) o a la derecha (1). Colgado: hacia dónde va. */
  side: number;
  /** Guion: de dónde sale, a dónde llega y la altura máxima (y en qué parte del recorrido). */
  sx: number;
  sy: number;
  sz: number;
  ex: number;
  ey: number;
  ez: number;
  apex: number;
  pa: number;
  /** Colgado o al trepar: los pies, antes de subir (la mitad del guion de trepar). */
  hx: number;
  hz: number;
  /** Normal de la pared (hacia fuera: hacia quien la mira) y punto del borde (entre las manos). */
  nx: number;
  nz: number;
  lx: number;
  ly: number;
  lz: number;
  /** Dirección y rapidez del movimiento (deslizarse, rodar, correr por la pared). */
  dx: number;
  dz: number;
  speed: number;
  /** Los pies contra la pared (colgado). */
  braced: boolean;
  /** Termina de pie (o agachado: no cabe de pie). */
  stand: boolean;
  /** Hacia dónde mira el cuerpo mientras dura el movimiento (NaN: lo decide quien camina). */
  yaw: number;
  /** El cuerpo entero inclinado (rad): de lado (+ hacia su derecha) y hacia atrás (+). */
  lean: number;
  pitch: number;
  /** El dibujo desplazado respecto al cuerpo (m, mundo): los pies contra la pared. */
  ox: number;
  oz: number;
  /**
   * Dónde se agarran o se apoyan las manos: el punto del canto de cada una (mundo; cómo va la mano ahí,
   * parkour/ledge.ts) y su peso para la IK.
   */
  hand: { lx: number; ly: number; lz: number; rx: number; ry: number; rz: number; w: number };
  /** Lo que ven los demás y la animación ("pk_vault"…); null sin parkour. */
  emote: string | null;
  /** Sobre una viga estrecha. */
  balance: boolean;
  /** Pared de la última carrera o rebote (no se repite sin tocar el suelo). */
  wallNx: number;
  wallNz: number;
  wallD: number;
  wallUsed: boolean;
  /** Rebote recién hecho: la animación del salto encogido (s que quedan). */
  airFx: number;
  /** Tiempo desde que se pidió agacharse en el aire (rodar al caer); Infinity si no. */
  rollAge: number;
  /** No agarrarse a un borde hasta que pase esto (s): al soltarse. */
  noGrab: number;
  /** Empujando contra un borde andando (s): sube al rato, sin saltar. */
  push: number;
  /** Segundos seguidos corriendo (a velocidad de estamparse): la carrerilla. */
  run: number;
  /** Paso de las manos al moverse colgado (m recorridos). */
  shim: number;
  /** Rebotes en paredes desde la última vez que se pisó suelo (o se colgó): como mucho MAX_KICKS. */
  kicks: number;
  /**
   * Una caída de verdad que empieza (la hace la gente, people/selfPeople: el cuerpo con física y
   * levantarse): aterrizar de muy alto sin rodar ("land", con la velocidad que llevaba en fallX/Z) o
   * estrellarse corriendo contra una pared ("crash", con su normal). Quien la lee la borra.
   */
  fall: "" | "land" | "crash";
  fallX: number;
  fallZ: number;
  /** La velocidad del golpe (m/s). */
  fallV: number;
}

export function createParkour(): Parkour {
  return {
    move: "none", t: 0, dur: 0, p: 0, side: 0,
    sx: 0, sy: 0, sz: 0, ex: 0, ey: 0, ez: 0, apex: 0, pa: 0.5, hx: 0, hz: 0,
    nx: 0, nz: 1, lx: 0, ly: 0, lz: 0, dx: 0, dz: -1, speed: 0, braced: false, stand: true,
    yaw: NaN, lean: 0, pitch: 0, ox: 0, oz: 0,
    hand: { lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, w: 0 },
    emote: null, balance: false,
    wallNx: 0, wallNz: 0, wallD: 0, wallUsed: false, airFx: 0, rollAge: Infinity, noGrab: 0, push: 0, run: 0, shim: 0, kicks: 0,
    fall: "", fallX: 0, fallZ: 0, fallV: 0,
  };
}

/** Vuelve a nada (al aparecer en otro sitio, al subir al coche…): de pie, sin movimiento. */
export function resetParkour(pk: Parkour, b: Body) {
  pk.move = "none";
  pk.fall = "";
  pk.t = pk.p = 0;
  pk.yaw = NaN;
  pk.lean = pk.pitch = pk.ox = pk.oz = 0;
  pk.hand.w = 0;
  pk.emote = null;
  pk.balance = false;
  pk.wallUsed = false;
  pk.airFx = 0;
  pk.rollAge = Infinity;
  pk.push = 0;
  pk.run = 0;
  b.h = BODY_HEIGHT;
}

/* ------------------------------------------------------------------ */
/* Sondas                                                               */
/* ------------------------------------------------------------------ */

/** Un borde delante: distancia a su cara, normal, punto del borde y altura de arriba. */
const ledge = { d: 0, nx: 0, nz: 0, ex: 0, ez: 0, top: 0 };

/**
 * ¿Hay un borde delante (en la dirección dx, dz, a menos de `reach` del centro del cuerpo) cuya parte
 * de arriba quede entre `lo` y `hi` sobre los pies, con sitio encima para las manos y el cuerpo?
 * Mira la cara a varias alturas (rodillas, pecho y, si hace falta, por encima de la cabeza).
 */
function findLedge(b: Body, dx: number, dz: number, reach: number, lo: number, hi: number, minFacing = 0.6): boolean {
  let best = Infinity;
  let nx = 0;
  let nz = 0;
  const heights = hi > 1.6 ? [0.45, 1.15, Math.min(hi - 0.15, 2.15)] : [0.45, Math.min(hi - 0.12, 1.15)];
  for (const h of heights) {
    if (probeWall(b.x, b.y + h, b.z, dx, dz, reach) && wallHit.d < best) {
      best = wallHit.d;
      nx = wallHit.nx;
      nz = wallHit.nz;
    }
  }
  if (best === Infinity) {
    // Una barra fina (una valla de tubo, la viga del Patio) cabe entre dos alturas: se busca desde
    // arriba (lo primero que se pisaría delante) y se mira su cara justo por debajo de lo alto.
    for (let d = R + 0.05; d <= reach; d += 0.15) {
      const t = floorAt(b.x + dx * d, b.z + dz * d, b.y + hi + 0.05);
      if (t < b.y + lo || t > b.y + hi) continue;
      if (probeWall(b.x, t - 0.05, b.z, dx, dz, reach)) {
        best = wallHit.d;
        nx = wallHit.nx;
        nz = wallHit.nz;
      }
      break;
    }
    if (best === Infinity) return false;
  }
  // De frente (o casi): la cara mira hacia quien llega.
  if (-(nx * dx + nz * dz) < minFacing) return false;
  // Lo de arriba, un poco dentro de la cara.
  const hx = b.x + dx * best;
  const hz = b.z + dz * best;
  const ix = hx - nx * 0.14;
  const iz = hz - nz * 0.14;
  const top = floorAt(ix, iz, b.y + hi + 0.05);
  if (top < b.y + lo || top > b.y + hi) return false;
  // Sitio encima: para las manos y para pasar el cuerpo.
  if (solidColumn(ix, iz, top + 0.03, top + 0.95)) return false;
  // La cara justo debajo del labio (si hay voladizo, la de antes vale).
  let d = best;
  if (probeWall(b.x, top - 0.1, b.z, dx, dz, best + 0.45)) d = wallHit.d;
  ledge.d = d;
  ledge.nx = nx;
  ledge.nz = nz;
  ledge.ex = b.x + dx * d;
  ledge.ez = b.z + dz * d;
  ledge.top = top;
  return true;
}

/**
 * Fondo del obstáculo desde el borde, hacia dentro (−normal): dónde vuelve a bajar el suelo. Sin
 * techo encima en todo el recorrido. -1 si hay algo encima; Infinity si sigue más de `max` (una
 * plataforma).
 */
function depthOf(ex: number, ez: number, nx: number, nz: number, top: number, max: number): number {
  for (let k = 0.1; k <= max + 1e-6; k += 0.1) {
    const qx = ex - nx * k;
    const qz = ez - nz * k;
    if (solidColumn(qx, qz, top + 0.03, top + 0.9)) return -1;
    if (floorAt(qx, qz, top + 0.1) < top - 0.3) return k;
  }
  return Infinity;
}

/** ¿Cabe el cuerpo (de pie o con esta altura) en (x, z) sobre `y`? */
const fits = (x: number, z: number, y: number, h: number) => !solidColumn(x, z, y + 0.05, y + h, R * 0.7);

/* ------------------------------------------------------------------ */
/* Guiones                                                              */
/* ------------------------------------------------------------------ */

/**
 * Recorrido de la cadera en la captura de subir un borde de 1 m (ClimbUp_1m, 0,67 s), normalizado:
 * cuánto ha subido (de 0 a 1) y cuánto ha avanzado (de 0 a 1) en cada 1/15 del tiempo.
 */
const CLIMB_UP = [0, 0.16, 0.34, 0.44, 0.57, 0.7, 0.83, 0.96, 1.03, 0.99, 1];
const CLIMB_FWD = [0, 0.06, 0.14, 0.23, 0.33, 0.43, 0.52, 0.63, 0.75, 0.88, 1];
export const CLIMB_CLIP_SECONDS = 0.667;

function table(tab: number[], p: number) {
  const f = Math.min(1, Math.max(0, p)) * (tab.length - 1);
  const i = Math.min(tab.length - 2, Math.floor(f));
  const k = f - i;
  // Entre muestras, suave (Hermite con las pendientes de los vecinos).
  const a = tab[Math.max(0, i - 1)]!;
  const b = tab[i]!;
  const c = tab[i + 1]!;
  const d = tab[Math.min(tab.length - 1, i + 2)]!;
  const m0 = (c - a) / 2;
  const m1 = (d - b) / 2;
  const k2 = k * k;
  const k3 = k2 * k;
  return (2 * k3 - 3 * k2 + 1) * b + (k3 - 2 * k2 + k) * m0 + (-2 * k3 + 3 * k2) * c + (k3 - k2) * m1;
}

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

function startScripted(pk: Parkour, b: Body, move: PkMove, dur: number) {
  pk.move = move;
  pk.t = 0;
  pk.p = 0;
  pk.dur = dur;
  pk.sx = b.x;
  pk.sy = b.y;
  pk.sz = b.z;
  b.vx = b.vy = b.vz = 0;
  b.grounded = false;
  b.jumpAge = Infinity;
}

/** Saltar la valla: del despegue al aterrizaje por encima del borde, con las manos en él. */
function tryVault(pk: Parkour, b: Body, dx: number, dz: number, speed: number): boolean {
  if (!findLedge(b, dx, dz, R + 0.3 + speed * 0.12, MANTLE_LO, MANTLE_HI, 0.75)) return false;
  const { ex, ez, nx, nz, top } = ledge;
  const depth = depthOf(ex, ez, nx, nz, top, 1.6);
  if (depth < 0 || depth === Infinity) return false;
  // Al otro lado: suelo (no más de 3 m por debajo) y sitio para el cuerpo.
  const lx = ex - nx * (depth + 0.65);
  const lz = ez - nz * (depth + 0.65);
  const land = floorAt(lx, lz, top + 0.1);
  if (land < b.y - 3 || !fits(lx, lz, land, 1.7)) return false;
  const dist = Math.hypot(lx - b.x, lz - b.z);
  startScripted(pk, b, "vault", Math.min(0.85, Math.max(0.42, dist / Math.max(speed, 3.8))));
  pk.ex = lx;
  pk.ey = land;
  pk.ez = lz;
  pk.apex = top + 0.22;
  pk.pa = Math.min(0.75, Math.max(0.3, Math.hypot(ex - nx * depth * 0.5 - b.x, ez - nz * depth * 0.5 - b.z) / dist));
  pk.dx = -nx;
  pk.dz = -nz;
  pk.speed = Math.max(speed * 0.92, 3.5);
  pk.yaw = Math.atan2(nx, nz);
  setEdge(pk, ex, top, ez, nx, nz);
  return true;
}

/** Subir a lo alto de un borde (de pie, o agachado si no cabe más). */
function tryMantle(pk: Parkour, b: Body, dx: number, dz: number, reach: number, hi: number, speed: number): boolean {
  if (!findLedge(b, dx, dz, reach, MANTLE_LO, hi)) return false;
  const { ex, ez, nx, nz, top } = ledge;
  // Dónde se queda: medio metro dentro o, si es un muro estrecho, en medio.
  let k = 0.5;
  if (floorAt(ex - nx * k, ez - nz * k, top + 0.1) < top - 0.12) {
    const depth = depthOf(ex, ez, nx, nz, top, 0.5);
    if (depth < 0.25) return false;
    k = depth / 2;
  }
  const tx = ex - nx * k;
  const tz = ez - nz * k;
  if (!fits(tx, tz, top, CROUCH_H)) return false;
  const rise = top - b.y;
  startScripted(pk, b, "mantle", CLIMB_CLIP_SECONDS * (0.55 + 0.45 * Math.min(1.3, rise)) * (speed > RUN_MIN ? 1 : 1.25));
  pk.ex = tx;
  pk.ey = top;
  pk.ez = tz;
  pk.stand = fits(tx, tz, top, BODY_HEIGHT);
  pk.dx = -nx;
  pk.dz = -nz;
  pk.speed = speed > RUN_MIN ? Math.min(speed, 3.2) : 0;
  pk.yaw = Math.atan2(nx, nz);
  setEdge(pk, ex, top, ez, nx, nz);
  return true;
}

/** Colgarse del borde que se tiene delante (desde el aire o subiendo por la pared). */
function tryHang(pk: Parkour, b: Body, dx: number, dz: number, reach: number): boolean {
  if (pk.noGrab > 0) return false;
  if (!findLedge(b, dx, dz, reach, MANTLE_HI_AIR, HANG_HI, 0.5)) return false;
  const { ex, ez, nx, nz, top } = ledge;
  const hx = ex + nx * HANG_OFF;
  const hz = ez + nz * HANG_OFF;
  // Que quepa el cuerpo colgado (sin nada debajo del borde que lo atraviese).
  if (solidColumn(hx, hz, top - HANG_DROP + 0.1, top - 0.15, R * 0.6)) return false;
  startScripted(pk, b, "hang", 0.15);
  pk.ex = hx;
  pk.ey = top - HANG_DROP;
  pk.ez = hz;
  pk.hx = hx;
  pk.hz = hz;
  pk.nx = nx;
  pk.nz = nz;
  pk.yaw = Math.atan2(nx, nz);
  pk.side = 0;
  pk.shim = 0;
  pk.braced = probeWall(hx, pk.ey + 0.5, hz, -nx, -nz, R + 0.45);
  setEdge(pk, ex, top, ez, nx, nz);
  return true;
}

/** El borde (entre las manos), la normal de su pared y las manos sobre él. */
function setEdge(pk: Parkour, ex: number, top: number, ez: number, nx: number, nz: number) {
  pk.lx = ex;
  pk.ly = top;
  pk.lz = ez;
  pk.nx = nx;
  pk.nz = nz;
  placeHands(pk, 0);
}

/**
 * Las manos en el canto, a ambos lados (y, al moverse colgado, alternando el paso): el punto del canto
 * de cada una; agarrada o apoyada, lo decide parkour/ledge.ts.
 */
function placeHands(pk: Parkour, step: number) {
  // Derecha de quien mira la pared (mira hacia −n): (n.z, −n.x)... con adelante (−nx, −nz), la derecha
  // es (−adelante.z, adelante.x) = (nz, −nx).
  const rx = pk.nz;
  const rz = -pk.nx;
  const half = 0.21;
  const sl = -half + Math.max(0, -step) * 0.12;
  const sr = half + Math.max(0, step) * 0.12;
  pk.hand.lx = pk.lx + rx * sl;
  pk.hand.lz = pk.lz + rz * sl;
  pk.hand.ly = pk.ly;
  pk.hand.rx = pk.lx + rx * sr;
  pk.hand.rz = pk.lz + rz * sr;
  pk.hand.ry = pk.ly;
}

/* ------------------------------------------------------------------ */
/* Paredes                                                              */
/* ------------------------------------------------------------------ */

const sameWall = (pk: Parkour, nx: number, nz: number, x: number, z: number) =>
  pk.wallUsed && nx * pk.wallNx + nz * pk.wallNz > 0.94 && Math.abs(nx * x + nz * z - pk.wallD) < 0.6;

function useWall(pk: Parkour, nx: number, nz: number, x: number, z: number) {
  pk.wallUsed = true;
  pk.wallNx = nx;
  pk.wallNz = nz;
  pk.wallD = nx * x + nz * z;
}

/** ¿Es alta la pared en esa dirección (de los tobillos a por encima de la cabeza)? */
function tallWall(b: Body, dx: number, dz: number, reach: number): boolean {
  return probeWall(b.x, b.y + 0.35, b.z, dx, dz, reach) && probeWall(b.x, b.y + 1.75, b.z, dx, dz, reach) && probeWall(b.x, b.y + 1.05, b.z, dx, dz, reach);
}

/** Correr por la pared de un lado, saltando junto a ella. */
function tryWallRun(pk: Parkour, b: Body, speed: number): boolean {
  if (speed < WALLRUN_MIN || b.vy < -3.5) return false;
  const fx = b.vx / speed;
  const fz = b.vz / speed;
  for (const side of [1, -1]) {
    // Derecha = (−f.z, f.x); izquierda, al revés.
    const sx = -fz * side;
    const sz = fx * side;
    if (!probeWall(b.x, b.y + 1.05, b.z, sx, sz, R + 0.5)) continue;
    const nx = wallHit.nx;
    const nz = wallHit.nz;
    const d = wallHit.d;
    // Casi paralela a la carrera.
    if (Math.abs(fx * nx + fz * nz) > 0.55) continue;
    if (!tallWall(b, sx, sz, R + 0.7)) continue;
    if (sameWall(pk, nx, nz, b.x, b.z)) continue;
    // Por la pared: la velocidad, quitando lo que va contra ella.
    let tx = fx - nx * (fx * nx + fz * nz);
    let tz = fz - nz * (fx * nx + fz * nz);
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    pk.move = "wallrun";
    pk.t = 0;
    pk.side = side;
    pk.nx = nx;
    pk.nz = nz;
    pk.dx = tx;
    pk.dz = tz;
    pk.speed = Math.max(speed, 5.2);
    // Un arco suave (no se trepa corriendo de lado): sube poco más de medio metro y baja.
    b.vy = Math.min(2.6, Math.max(b.vy, 1.8));
    // Pegado a la pared.
    b.x += sx * (d - R - 0.05);
    b.z += sz * (d - R - 0.05);
    pk.yaw = Math.atan2(-tx, -tz);
    useWall(pk, nx, nz, b.x, b.z);
    return true;
  }
  return false;
}

/** Subir por la pared de frente (dos pasos hacia arriba). */
function tryWallUp(pk: Parkour, b: Body, dx: number, dz: number, into: number, grounded: boolean): boolean {
  // Desde el aire, solo al final de un salto desde el suelo (no después de rebotar).
  if (into < 2.0 || (!grounded && pk.kicks > 0)) return false;
  const reach = R + (grounded ? 0.45 : 0.3) + into * 0.06;
  if (!probeWall(b.x, b.y + 1.0, b.z, dx, dz, reach)) return false;
  const nx = wallHit.nx;
  const nz = wallHit.nz;
  const d = wallHit.d;
  if (-(nx * dx + nz * dz) < 0.8 || !tallWall(b, dx, dz, reach + 0.1)) return false;
  if (sameWall(pk, nx, nz, b.x, b.z)) return false;
  pk.move = "wallup";
  pk.t = 0;
  pk.nx = nx;
  pk.nz = nz;
  b.x += dx * (d - R - 0.04);
  b.z += dz * (d - R - 0.04);
  b.vx = b.vz = 0;
  // Dos pasos por la pared: hasta ~1,6 m más arriba (las manos llegan a bordes de ~3,9 m).
  b.vy = grounded ? 7.0 : Math.max(b.vy, 6.2);
  b.grounded = false;
  b.jumpAge = Infinity;
  b.jumped = true;
  pk.yaw = Math.atan2(nx, nz);
  useWall(pk, nx, nz, b.x, b.z);
  pk.kicks++;
  return true;
}

/** Rebotes seguidos sin pisar suelo: se gana algo de altura entre dos paredes, no se trepa sin fin. */
const MAX_KICKS = 3;

const DIRS8 = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)] as const);

/** Rebote: en el aire, tocando una pared, el salto lanza hacia fuera. */
function tryWallJump(pk: Parkour, b: Body): boolean {
  if (pk.kicks >= MAX_KICKS) return false;
  let best = Infinity;
  let nx = 0;
  let nz = 0;
  for (const [dx, dz] of DIRS8) {
    if (probeWall(b.x, b.y + 1.0, b.z, dx, dz, R + 0.3) && wallHit.d < best) {
      best = wallHit.d;
      nx = wallHit.nx;
      nz = wallHit.nz;
    }
  }
  if (best === Infinity || sameWall(pk, nx, nz, b.x, b.z)) return false;
  wallKick(pk, b, nx, nz, 0.65);
  return true;
}

function wallKick(pk: Parkour, b: Body, nx: number, nz: number, keep: number) {
  const along = b.vx * nx + b.vz * nz;
  const tx = (b.vx - nx * along) * keep;
  const tz = (b.vz - nz * along) * keep;
  b.vx = nx * 4.3 + tx;
  b.vz = nz * 4.3 + tz;
  b.vy = 5.4;
  b.grounded = false;
  b.jumped = true;
  b.jumpAge = Infinity;
  useWall(pk, nx, nz, b.x, b.z);
  pk.kicks++;
  pk.move = "none";
  pk.airFx = 0.4;
  pk.yaw = NaN;
  pk.lean = pk.pitch = pk.ox = pk.oz = 0;
  pk.hand.w = 0;
}

/* ------------------------------------------------------------------ */
/* Cada frame                                                           */
/* ------------------------------------------------------------------ */

let _jumpWanted = false;

/** Lo más largo que es un paso del parkour (s): con frames más largos se dan varios. */
const PK_STEP = 1 / 60;

/**
 * Avanza `dt` segundos: lo que se esté haciendo o, sin nada, el movimiento normal (stepBody) mirando
 * antes si empieza algo. `min`/`max`: límites del lugar en X y Z.
 *
 * Por debajo de 60 fps se dan varios pasos de como mucho 1/60 s: subir por una pared o correr por
 * ella se calculan paso a paso, y con pasos largos se llegaba menos alto (a 20 fps, 15 cm menos: un
 * borde que a 60 fps se alcanza, ya no). Así un móvil justo de fuerza juega lo mismo que un PC. Lo
 * que se pulsa (saltar, agacharse) cuenta en el primer paso.
 */
export function parkourStep(pk: Parkour, b: Body, inp: ParkourInput, dt: number, min: number, max: number) {
  if (!(dt > 0)) return;
  dt = Math.min(dt, 0.1);
  const n = Math.ceil(dt / PK_STEP - 1e-6);
  if (n <= 1) return parkourOne(pk, b, inp, dt, min, max);
  const jump = inp.jump, crouchPressed = inp.crouchPressed;
  for (let i = 0; i < n; i++) {
    if (i === 1) inp.jump = inp.crouchPressed = false;
    parkourOne(pk, b, inp, dt / n, min, max);
    // Una caída de verdad: de eso se ocupa quien llama (people/selfPeople.ts), ya.
    if (pk.fall) break;
  }
  inp.jump = jump;
  inp.crouchPressed = crouchPressed;
}

function parkourOne(pk: Parkour, b: Body, inp: ParkourInput, dt: number, min: number, max: number) {
  _jumpWanted = inp.jump;
  if (pk.noGrab > 0) pk.noGrab -= dt;
  if (pk.airFx > 0) pk.airFx -= dt;
  if (b.grounded) pk.rollAge = Infinity;
  else if (inp.crouchPressed) pk.rollAge = 0;
  else pk.rollAge += dt;
  switch (pk.move) {
    case "none":
    case "land":
      free(pk, b, inp, dt, min, max);
      break;
    case "vault":
    case "mantle":
    case "climb":
      scripted(pk, b, dt);
      break;
    case "hang":
      hang(pk, b, inp, dt);
      break;
    case "wallrun":
      wallRun(pk, b, dt, min, max);
      break;
    case "wallup":
      wallUp(pk, b, inp, dt);
      break;
    case "slide":
    case "slideup":
    case "crouch":
    case "roll":
      lowMove(pk, b, inp, dt, min, max);
      break;
  }
  b.x = Math.min(max, Math.max(min, b.x));
  b.z = Math.min(max, Math.max(min, b.z));
  pk.emote = emoteOf(pk);
}

function emoteOf(pk: Parkour): string | null {
  switch (pk.move) {
    case "none":
      return pk.airFx > 0 ? "pk_walljump" : pk.balance ? "pk_balance" : null;
    case "hang":
      return pk.t < pk.dur ? "pk_hang" : pk.side < 0 ? "pk_shimmy_l" : pk.side > 0 ? "pk_shimmy_r" : "pk_hang";
    case "wallrun":
      return pk.side < 0 ? "pk_wallrun_l" : "pk_wallrun_r";
    default:
      return `pk_${pk.move}`;
  }
}

/** Hacia dónde va: la velocidad si se mueve; si no, lo que pide; si no, hacia donde mira. */
const _dir = { x: 0, z: -1 };
function moveDir(b: Body, inp: ParkourInput) {
  const sp = Math.hypot(b.vx, b.vz);
  const w = Math.hypot(inp.wantX, inp.wantZ);
  if (sp > 0.8) {
    _dir.x = b.vx / sp;
    _dir.z = b.vz / sp;
  } else if (w > 0.3) {
    _dir.x = inp.wantX / w;
    _dir.z = inp.wantZ / w;
  } else {
    _dir.x = -Math.sin(inp.yaw);
    _dir.z = -Math.cos(inp.yaw);
  }
  return _dir;
}

function free(pk: Parkour, b: Body, inp: ParkourInput, dt: number, min: number, max: number) {
  const speed = Math.hypot(b.vx, b.vz);
  const want = Math.hypot(inp.wantX, inp.wantZ);
  // La carrerilla: cuánto lleva corriendo sin parar (tras una valla o un salto, la que traía).
  pk.run = speed >= CRASH_SPEED ? pk.run + dt : 0;
  const dir = moveDir(b, inp);
  const dx = dir.x;
  const dz = dir.z;
  if (pk.move === "land") {
    pk.t += dt;
    pk.p = Math.max(0, Math.min(1, pk.t / 0.4));
    if (pk.t > 0.4 || (want > 0.3 && pk.t > 0)) pk.move = "none";
  }
  pk.yaw = NaN;
  pk.lean = pk.pitch = pk.ox = pk.oz = 0;
  pk.hand.w = Math.max(0, pk.hand.w - dt * 6);
  pk.balance = false;

  if (b.grounded) {
    pk.wallUsed = false;
    pk.kicks = 0;
    // Agacharse: corriendo, a deslizarse; despacio, agachado.
    if (inp.crouchPressed && speed >= SLIDE_MIN && !onBeam(b, dx, dz)) return startSlide(pk, b, dx, dz, speed);
    if (inp.crouch && speed < SLIDE_MIN) {
      pk.move = "crouch";
      pk.t = 0;
      b.h = CROUCH_H;
      return lowMove(pk, b, inp, dt, min, max);
    }
    // Contra algo, corriendo: saltar la valla o subir, sin pulsar nada (o con el salto).
    const toward = want > 0.3 ? (inp.wantX * dx + inp.wantZ * dz) / want : 0;
    if ((speed > RUN_MIN && toward > 0.7) || _jumpWanted) {
      if (speed > RUN_MIN && tryVault(pk, b, dx, dz, speed)) return consumeJump();
      const reach = R + 0.3 + speed * 0.1;
      if ((speed > RUN_MIN || _jumpWanted) && tryMantle(pk, b, dx, dz, reach, MANTLE_HI, speed)) return consumeJump();
    }
    // Andando contra un borde un momento: sube.
    if (want > 0.3 && toward > 0.85 && speed < 1.2 && findLedge(b, dx, dz, R + 0.18, MANTLE_LO, MANTLE_HI, 0.85)) {
      pk.push += dt;
      if (pk.push > 0.25 && tryMantle(pk, b, dx, dz, R + 0.18, MANTLE_HI, 0)) {
        pk.push = 0;
        return;
      }
    } else pk.push = 0;
    if (_jumpWanted) {
      // De frente contra una pared alta: arriba por ella.
      const into = Math.max(speed * Math.max(0, toward), want * Math.max(0, toward));
      if (tryWallUp(pk, b, dx, dz, into, true)) return consumeJump();
      requestJump(b);
      consumeJump();
    } else if (speed >= CRASH_SPEED && pk.run >= CRASH_RUN && toward > 0.7) {
      // Corriendo de frente y con carrerilla contra una pared alta, sin saltar: se la come (la
      // velocidad de antes del choque, que el paso de la física se quedaría al pararle).
      const ux = b.vx / speed;
      const uz = b.vz / speed;
      if (probeWall(b.x, b.y + 1.25, b.z, ux, uz, R + speed * dt + 0.06) && -(wallHit.nx * ux + wallHit.nz * uz) > 0.9) {
        pk.fall = "crash";
        pk.fallX = wallHit.nx;
        pk.fallZ = wallHit.nz;
        pk.fallV = speed;
        b.vx = b.vz = 0;
        return;
      }
    }
    pk.balance = speed < 4.5 && onBeam(b, dx, dz);
  } else {
    if (_jumpWanted && b.airTime > 0.12 && tryWallJump(pk, b)) return consumeJump();
    if (_jumpWanted && b.airTime <= 0.12) {
      requestJump(b);
      consumeJump();
    }
    // Las manos en un borde: subir si está bajo, colgarse si está alto.
    if (b.vy < 3) {
      const reach = R + 0.35 + speed * 0.06;
      if (tryMantle(pk, b, dx, dz, reach, MANTLE_HI_AIR, speed)) return;
      if (tryHang(pk, b, dx, dz, reach)) return;
    }
    if (tryWallRun(pk, b, speed)) return;
    const toward = want > 0.3 ? (inp.wantX * dx + inp.wantZ * dz) / want : 0;
    if (b.airTime < 0.3 && toward > 0.7 && tryWallUp(pk, b, dx, dz, speed * toward, false)) return;
  }

  stepBody(b, inp.wantX, inp.wantZ, dt, min, max);
  if (b.landed > 0) land(pk, b, inp);
}

function consumeJump() {
  _jumpWanted = false;
}

/** Al tocar el suelo: sin golpe hasta ~2,5 m; más alto, rodar si se va deprisa (o se pidió). */
function land(pk: Parkour, b: Body, inp: ParkourInput) {
  const v = b.landed;
  const speed = Math.hypot(b.vx, b.vz);
  if (v <= SOFT_LANDING) {
    b.stun = 0;
    if (v > 5.5 && speed < 1.5) {
      pk.move = "land";
      pk.t = 0;
    }
    return;
  }
  if (v <= ROLL_MAX && (speed > 2.2 || pk.rollAge < 0.5) && fits(b.x, b.z, b.y, 1.0)) {
    b.stun = 0;
    const dir = moveDir(b, inp);
    pk.move = "roll";
    pk.t = 0;
    pk.dur = 0.8;
    pk.dx = dir.x;
    pk.dz = dir.z;
    pk.speed = Math.max(speed, 3.2);
    pk.yaw = Math.atan2(-dir.x, -dir.z);
    b.h = 1.0;
    return;
  }
  // De muy alto, o sin rodar desde bastante alto: las piernas no aguantan y se cae de verdad.
  if (v > FALL_LANDING) {
    b.stun = 0;
    pk.fall = "land";
    pk.fallX = b.vx;
    pk.fallZ = b.vz;
    pk.fallV = v;
    pk.move = "none";
    return;
  }
  // Sin rodar: el golpe (más largo cuanto más alto).
  b.stun = Math.min(1.1, 0.25 + (v - SOFT_LANDING) * 0.07);
  pk.move = "land";
  pk.t = -b.stun;
}

/** ¿Pisa una viga (nada a los lados a menos de ~30 cm)? */
function onBeam(b: Body, dx: number, dz: number): boolean {
  const rx = -dz;
  const rz = dx;
  return floorAt(b.x + rx * 0.3, b.z + rz * 0.3, b.y + 0.05) < b.y - 0.4 && floorAt(b.x - rx * 0.3, b.z - rz * 0.3, b.y + 0.05) < b.y - 0.4;
}

/* --- Guionados: saltar la valla, subir y trepar desde colgado --- */

function scripted(pk: Parkour, b: Body, dt: number) {
  pk.t += dt;
  const p = Math.min(1, pk.t / pk.dur);
  pk.p = p;
  if (pk.move === "vault") {
    const h = ease(p) * 0.25 + p * 0.75;
    b.x = pk.sx + (pk.ex - pk.sx) * h;
    b.z = pk.sz + (pk.ez - pk.sz) * h;
    b.y =
      p < pk.pa
        ? pk.sy + (pk.apex - pk.sy) * Math.sin((Math.PI / 2) * (p / pk.pa))
        : pk.apex + (pk.ey - pk.apex) * (1 - Math.cos((Math.PI / 2) * ((p - pk.pa) / (1 - pk.pa))));
    // Las manos en el borde mientras se pasa por encima.
    pk.hand.w = p < 0.12 ? p / 0.12 : p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) / 0.15);
  } else if (pk.move === "mantle") {
    const up = table(CLIMB_UP, p);
    const fw = table(CLIMB_FWD, p);
    b.x = pk.sx + (pk.ex - pk.sx) * fw;
    b.z = pk.sz + (pk.ez - pk.sz) * fw;
    b.y = pk.sy + (pk.ey - pk.sy) * up;
    pk.hand.w = p < 0.08 ? p / 0.08 : p < 0.45 ? 1 : Math.max(0, 1 - (p - 0.45) / 0.15);
  } else {
    // Trepar desde colgado: primero tirar de los brazos (la cadera al borde), luego subir encima.
    const PULL = 0.42;
    const midY = pk.ey - 0.95;
    if (p < PULL) {
      const k = ease(p / PULL);
      b.x = pk.hx;
      b.z = pk.hz;
      b.y = pk.sy + (midY - pk.sy) * k;
    } else {
      // El tramo de la captura desde las manos arriba (0,13 s): de ahí al final, normalizado.
      const q = (p - PULL) / (1 - PULL);
      const c = 0.2 + 0.8 * q;
      const u0 = table(CLIMB_UP, 0.2);
      const f0 = table(CLIMB_FWD, 0.2);
      const up = (table(CLIMB_UP, c) - u0) / (1 - u0);
      const fw = (table(CLIMB_FWD, c) - f0) / (1 - f0);
      b.x = pk.hx + (pk.ex - pk.hx) * fw;
      b.z = pk.hz + (pk.ez - pk.hz) * fw;
      b.y = midY + (pk.ey - midY) * up;
    }
    // Pegado a la pared mientras tira de los brazos; al pasar por encima, el dibujo vuelve al cuerpo.
    const off = HANG_IN * (p < PULL ? 1 : Math.max(0, 1 - ((p - PULL) / (1 - PULL)) * 1.6));
    pk.ox = -pk.nx * off;
    pk.oz = -pk.nz * off;
    pk.hand.w = p < 0.75 ? 1 : Math.max(0, 1 - (p - 0.75) / 0.15);
  }
  if (p >= 1) {
    b.grounded = true;
    b.airTime = 0;
    b.jumped = false;
    b.vy = 0;
    b.vx = pk.dx * pk.speed;
    b.vz = pk.dz * pk.speed;
    b.h = pk.stand ? BODY_HEIGHT : CROUCH_H;
    pk.hand.w = 0;
    pk.yaw = NaN;
    pk.move = pk.stand ? "none" : "crouch";
    pk.t = 0;
    pk.stand = true;
  }
}

/* --- Colgado --- */

const _l = { x: 0, z: 0 };

function hang(pk: Parkour, b: Body, inp: ParkourInput, dt: number) {
  pk.t += dt;
  pk.kicks = 0;
  b.vx = b.vy = b.vz = 0;
  b.grounded = false;
  b.airTime = 0;
  pk.hand.w = Math.min(1, pk.hand.w + dt * 10);
  pk.yaw = Math.atan2(pk.nx, pk.nz);
  // El dibujo, contra la pared (el cuerpo de las colisiones no cabe tan cerca).
  const inK = pk.t < pk.dur ? ease(pk.t / pk.dur) : 1;
  pk.ox = -pk.nx * HANG_IN * inK;
  pk.oz = -pk.nz * HANG_IN * inK;
  // Al agarrarse: del salto a la posición colgada, en un momento.
  if (pk.t < pk.dur) {
    const k = ease(pk.t / pk.dur);
    b.x = pk.sx + (pk.hx - pk.sx) * k;
    b.y = pk.sy + (pk.ey - pk.sy) * k;
    b.z = pk.sz + (pk.hz - pk.sz) * k;
    return;
  }
  b.x = pk.hx;
  b.y = pk.ey;
  b.z = pk.hz;
  // Lo que se pide, respecto a la pared: hacia ella (adelante), y de lado (derecha de quien la mira).
  const w = Math.hypot(inp.wantX, inp.wantZ);
  const fwd = w > 0.3 ? -(inp.wantX * pk.nx + inp.wantZ * pk.nz) / w : 0;
  const lat = w > 0.3 ? (inp.wantX * pk.nz - inp.wantZ * pk.nx) / w : 0;
  if (_jumpWanted) {
    consumeJump();
    if (fwd < -0.5) {
      // De espaldas: salto hacia atrás, girándose.
      pk.move = "none";
      pk.noGrab = 0.3;
      b.vx = pk.nx * 4.2;
      b.vz = pk.nz * 4.2;
      b.vy = 5.0;
      b.jumped = true;
      pk.hand.w = 0;
      useWall(pk, pk.nx, pk.nz, b.x, b.z);
      return;
    }
    if (Math.abs(lat) > 0.7) {
      // De lado: salto a lo largo de la pared (a otro borde).
      pk.move = "none";
      pk.noGrab = 0.12;
      b.vx = pk.nz * Math.sign(lat) * 3.4 + pk.nx * 0.6;
      b.vz = -pk.nx * Math.sign(lat) * 3.4 + pk.nz * 0.6;
      b.vy = 5.2;
      b.jumped = true;
      pk.hand.w = 0;
      return;
    }
    if (startClimb(pk, b)) return;
  }
  if (inp.crouchPressed) {
    // Soltarse.
    pk.move = "none";
    pk.noGrab = 0.35;
    b.vx = pk.nx * 0.6;
    b.vz = pk.nz * 0.6;
    pk.hand.w = 0;
    return;
  }
  if (fwd > 0.75) {
    pk.push += dt;
    if (pk.push > 0.3 && startClimb(pk, b)) return;
  } else pk.push = 0;
  // De lado por el borde, mientras siga.
  pk.side = 0;
  if (Math.abs(lat) > 0.5) {
    const s = Math.sign(lat);
    const step = 0.9 * dt;
    const rx = pk.nz * s;
    const rz = -pk.nx * s;
    // Nada que choque a ese lado.
    if (!probeWall(pk.hx, pk.ey + 1.0, pk.hz, rx, rz, R + 0.08 + step) && shimmyTo(pk, pk.hx + rx * step, pk.hz + rz * step)) {
      pk.side = s;
      pk.shim += step;
    }
  }
  placeHands(pk, pk.side ? Math.sin(pk.shim * 12) * pk.side : 0);
}

/** ¿Sigue el borde en esa posición? Si sí, se mueve ahí (con la nueva altura y normal). */
function shimmyTo(pk: Parkour, x: number, z: number): boolean {
  const y = pk.ey;
  _l.x = x;
  _l.z = z;
  // Desde ahí hacia la pared, a la altura de la cara y del labio.
  if (!probeWall(x, pk.ly - 0.15, z, -pk.nx, -pk.nz, R + 0.4)) return false;
  const d = wallHit.d;
  const nx = wallHit.nx;
  const nz = wallHit.nz;
  if (nx * pk.nx + nz * pk.nz < 0.85) return false;
  const ex = x - pk.nx * d;
  const ez = z - pk.nz * d;
  const top = floorAt(ex - nx * 0.14, ez - nz * 0.14, pk.ly + 0.3);
  if (Math.abs(top - pk.ly) > 0.25 || solidColumn(ex - nx * 0.14, ez - nz * 0.14, top + 0.03, top + 0.6)) return false;
  pk.hx = ex + nx * HANG_OFF;
  pk.hz = ez + nz * HANG_OFF;
  pk.ey = top - HANG_DROP;
  pk.lx = ex;
  pk.lz = ez;
  pk.ly = top;
  pk.nx = nx;
  pk.nz = nz;
  pk.braced = probeWall(pk.hx, y + 0.5, pk.hz, -nx, -nz, R + 0.45);
  return true;
}

/** De colgado a encima del borde (si hay sitio arriba). */
function startClimb(pk: Parkour, b: Body): boolean {
  const tx = pk.lx - pk.nx * 0.45;
  const tz = pk.lz - pk.nz * 0.45;
  if (!fits(tx, tz, pk.ly, CROUCH_H)) return false;
  pk.move = "climb";
  pk.t = 0;
  pk.p = 0;
  pk.dur = HANG_CLIMB_S;
  pk.sx = b.x;
  pk.sy = b.y;
  pk.sz = b.z;
  pk.ex = tx;
  pk.ey = pk.ly;
  pk.ez = tz;
  pk.stand = fits(tx, tz, pk.ly, BODY_HEIGHT);
  pk.dx = -pk.nx;
  pk.dz = -pk.nz;
  pk.speed = 0;
  pk.push = 0;
  return true;
}

/* --- Por la pared --- */

function wallRun(pk: Parkour, b: Body, dt: number, min: number, max: number) {
  pk.t += dt;
  b.airTime += dt;
  pk.yaw = Math.atan2(-pk.dx, -pk.dz);
  // Inclinado hacia fuera, con los pies contra la pared.
  pk.lean = 0.4 * -pk.side * Math.min(1, pk.t / 0.12);
  pk.ox = -pk.nx * 0.27;
  pk.oz = -pk.nz * 0.27;
  if (_jumpWanted) {
    consumeJump();
    // Rebote hacia el otro lado, sin perder la carrera.
    b.vx = pk.dx * pk.speed;
    b.vz = pk.dz * pk.speed;
    wallKick(pk, b, pk.nx, pk.nz, 0.8);
    return;
  }
  pk.speed = Math.max(3, pk.speed - 0.6 * dt);
  b.vy -= GRAVITY * 0.35 * dt;
  const nx0 = b.x + pk.dx * pk.speed * dt;
  const nz0 = b.z + pk.dz * pk.speed * dt;
  let end = pk.t > 1.2 || b.vy < -4.5;
  // Algo delante: se acaba.
  if (probeWall(b.x, b.y + 1.0, b.z, pk.dx, pk.dz, R + pk.speed * dt + 0.05)) end = true;
  if (!end) {
    // La pared sigue a ese lado (y puede girar un poco).
    if (probeWall(nx0, b.y + 1.05, nz0, -pk.nx, -pk.nz, R + 0.45) && wallHit.nx * pk.nx + wallHit.nz * pk.nz > 0.85) {
      const d = wallHit.d;
      pk.nx = wallHit.nx;
      pk.nz = wallHit.nz;
      b.x = nx0 - pk.nx * (d - R - 0.05);
      b.z = nz0 - pk.nz * (d - R - 0.05);
      // La dirección, a lo largo de la nueva normal.
      const along = pk.dx * pk.nx + pk.dz * pk.nz;
      let tx = pk.dx - pk.nx * along;
      let tz = pk.dz - pk.nz * along;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      pk.dx = tx;
      pk.dz = tz;
    } else end = true;
  }
  const y1 = b.y + b.vy * dt;
  if (b.vy > 0 && y1 + b.h > ceilingHeight(b.x, b.z, R * 0.75, b.y + b.h - 0.01)) b.vy = 0;
  const g = groundHeight(b.x, b.z, R * 0.75, b.y + STEP_UP);
  if (y1 <= g) {
    b.y = g;
    end = true;
    b.grounded = true;
    b.vy = 0;
  } else b.y = y1;
  b.x = Math.min(max, Math.max(min, b.x));
  b.z = Math.min(max, Math.max(min, b.z));
  if (end) {
    b.vx = pk.dx * pk.speed + pk.nx * 0.8;
    b.vz = pk.dz * pk.speed + pk.nz * 0.8;
    pk.move = "none";
    pk.yaw = NaN;
    pk.lean = pk.ox = pk.oz = 0;
  }
}

function wallUp(pk: Parkour, b: Body, inp: ParkourInput, dt: number) {
  pk.t += dt;
  b.airTime += dt;
  pk.yaw = Math.atan2(pk.nx, pk.nz);
  pk.pitch = 0.3 * Math.min(1, pk.t / 0.1);
  pk.ox = -pk.nx * 0.2;
  pk.oz = -pk.nz * 0.2;
  if (_jumpWanted) {
    consumeJump();
    // Patada hacia atrás, de espaldas a la pared.
    b.vx = pk.nx * 4.4;
    b.vz = pk.nz * 4.4;
    b.vy = 5.0;
    useWall(pk, pk.nx, pk.nz, b.x, b.z);
    pk.kicks++;
    pk.move = "none";
    pk.airFx = 0.4;
    pk.yaw = NaN;
    pk.pitch = pk.ox = pk.oz = 0;
    return;
  }
  if (inp.crouchPressed) {
    pk.move = "none";
    pk.yaw = NaN;
    pk.pitch = pk.ox = pk.oz = 0;
    b.vx = pk.nx * 0.5;
    b.vz = pk.nz * 0.5;
    return;
  }
  b.vy -= GRAVITY * dt;
  const y1 = b.y + b.vy * dt;
  if (b.vy > 0 && y1 + b.h > ceilingHeight(b.x, b.z, R * 0.75, b.y + b.h - 0.01)) b.vy = 0;
  else b.y = y1;
  // ¿Llegan las manos a un borde?
  const dx = -pk.nx;
  const dz = -pk.nz;
  pk.move = "none";
  if (tryMantle(pk, b, dx, dz, R + 0.4, MANTLE_HI_AIR, 0) || tryHang(pk, b, dx, dz, R + 0.4)) {
    pk.pitch = pk.ox = pk.oz = 0;
    return;
  }
  pk.move = "wallup";
  const g = groundHeight(b.x, b.z, R * 0.75, b.y + STEP_UP);
  if (b.y <= g) {
    b.y = g;
    b.grounded = true;
    b.vy = 0;
  }
  if (b.grounded || b.vy < -1.5 || pk.t > 0.9) {
    // Se acabó el impulso: a caer (resbalando por la pared).
    pk.move = "none";
    pk.yaw = NaN;
    pk.pitch = pk.ox = pk.oz = 0;
    b.vx = pk.nx * 0.4;
    b.vz = pk.nz * 0.4;
  }
}

/* --- Bajo: deslizarse, agachado y rodar --- */

function startSlide(pk: Parkour, b: Body, dx: number, dz: number, speed: number) {
  pk.move = "slide";
  pk.t = 0;
  pk.dx = dx;
  pk.dz = dz;
  pk.speed = Math.max(speed, 6.0);
  pk.yaw = Math.atan2(-dx, -dz);
  b.h = SLIDE_H;
  consumeJump();
}

function lowMove(pk: Parkour, b: Body, inp: ParkourInput, dt: number, min: number, max: number) {
  pk.t += dt;
  pk.balance = false;
  pk.lean = pk.pitch = pk.ox = pk.oz = 0;
  let wx = inp.wantX;
  let wz = inp.wantZ;
  if (pk.move === "slide") {
    pk.speed = Math.max(0, pk.speed - 4.0 * dt);
    wx = pk.dx * pk.speed;
    wz = pk.dz * pk.speed;
    pk.yaw = Math.atan2(-pk.dx, -pk.dz);
    const room = fits(b.x, b.z, b.y, BODY_HEIGHT);
    if (_jumpWanted && pk.t > 0.15 && room) {
      consumeJump();
      b.h = BODY_HEIGHT;
      pk.move = "none";
      pk.yaw = NaN;
      requestJump(b);
    } else if (pk.speed < 2.0 || (pk.t > 0.4 && !inp.crouch)) {
      if (room) {
        pk.move = "slideup";
        pk.t = 0;
        b.h = BODY_HEIGHT;
      } else {
        pk.move = "crouch";
        pk.t = 0;
        b.h = CROUCH_H;
      }
    }
  } else if (pk.move === "slideup") {
    wx *= 0.7;
    wz *= 0.7;
    pk.yaw = NaN;
    pk.p = Math.min(1, pk.t / 0.35);
    if (pk.t > 0.35) pk.move = "none";
  } else if (pk.move === "roll") {
    const k = Math.max(0, 1 - pk.t / pk.dur);
    wx = pk.dx * pk.speed * (0.55 + 0.45 * k);
    wz = pk.dz * pk.speed * (0.55 + 0.45 * k);
    pk.p = Math.min(1, pk.t / pk.dur);
    if (pk.t >= pk.dur) {
      if (fits(b.x, b.z, b.y, BODY_HEIGHT)) {
        b.h = BODY_HEIGHT;
        pk.move = "none";
        pk.yaw = NaN;
      } else {
        b.h = CROUCH_H;
        pk.move = "crouch";
        pk.t = 0;
      }
    }
  } else {
    // Agachado: despacio; al soltar, de pie si cabe.
    const w = Math.hypot(wx, wz);
    if (w > CROUCH_SPEED) {
      wx *= CROUCH_SPEED / w;
      wz *= CROUCH_SPEED / w;
    }
    pk.yaw = NaN;
    if (!inp.crouch && fits(b.x, b.z, b.y, BODY_HEIGHT)) {
      b.h = BODY_HEIGHT;
      pk.move = "none";
      if (_jumpWanted) {
        consumeJump();
        requestJump(b);
      }
    } else if (_jumpWanted) consumeJump();
  }
  stepBody(b, wx, wz, dt, min, max);
  if (!b.grounded && (pk.move === "slide" || pk.move === "crouch")) {
    // Se acabó el suelo: a caer (de pie si cabe).
    b.h = fits(b.x, b.z, b.y, BODY_HEIGHT) ? BODY_HEIGHT : CROUCH_H;
    pk.move = "none";
    pk.yaw = NaN;
  }
  if (b.landed > 0 && pk.move === "none") land(pk, b, inp);
}

/** Saltos: velocidad inicial del salto normal (para quien la necesite fuera). */
export const PK_JUMP_V = JUMP_V;
