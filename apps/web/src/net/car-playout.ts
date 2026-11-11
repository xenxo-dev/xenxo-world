/**
 * Dónde está AHORA el coche de otra persona.
 *
 * A la gente se la dibuja con retraso, entre dos de sus poses (playout.ts): a pie no se nota. Un coche
 * a 30 m/s, con 300 ms de retraso, se ve nueve metros por detrás de donde está: dos que van rueda con
 * rueda se ven el uno al otro muy atrás, y cada uno chocaría con un coche que el otro no lleva ahí.
 * Así que el coche de quien conduce no se dibuja donde estaba, sino donde estará ahora si sigue como
 * iba: desde su última pose, con la velocidad y el giro que traía entre las dos últimas (si iba
 * girando, sigue girando: en una curva o en el looping la cuenta sale igual de bien que en recta).
 * Cuando llega la pose siguiente y no cae justo donde se le suponía, la diferencia se deshace en un
 * momento, sin saltos. Con eso, cada uno ve al otro cerca de donde está de verdad (a lo que tarda la
 * red, que no se puede saber), y los choques entre coches (vehicle/rivals.ts) los notan los dos.
 *
 * Sin Three.js ni nada del navegador: se prueba en Node (test/netplay.mts).
 */

/** Una pose con coche (`PoseSample`, world-store.ts): la hora del servidor en que se tomó y dónde estaba. */
export interface CarSample {
  t: number;
  vehicle?: string;
  car?: { p: readonly number[]; r: readonly number[] };
}

/** Lo más que se sigue adelante desde la última pose (ms): si no llega otra, el coche se queda ahí. */
export const AHEAD_MAX_MS = 350;
/**
 * Lo que se supone que tarda la red de un cliente a otro (ms), además de lo que se mide: la hora de
 * cada pose y la del servidor se estiman con el viaje más rápido, así que lo que tardan no se ve.
 */
export const TRANSIT_MS = 50;
/** En cuánto se deshace (s) lo que una pose nueva corrige, y el giro. */
const SETTLE_S = 0.12;
const TURN_S = 0.07;
/** Una corrección mayor que esto (m) no se suaviza: ha vuelto a la pista o ha llegado de un salto. */
const SNAP_M = 7;
/** Entre dos poses tan separadas (ms) o tan juntas, su velocidad no dice nada. */
const GAP_MAX_MS = 650;
const GAP_MIN_MS = 15;
/** Topes de cordura: m/s y rad/s. */
const SPEED_MAX = 90;
const SPIN_MAX = 7;

export class CarPlayout {
  x = 0;
  y = 0;
  z = 0;
  qx = 0;
  qy = 0;
  qz = 0;
  qw = 1;
  /** La última pose en que se apoya (su hora) y lo previsto en el frame anterior. */
  private base = NaN;
  private has = false;
  /** Lo que queda por deshacer de la última corrección. */
  private ex = 0;
  private ey = 0;
  private ez = 0;

  /** Empieza de nuevo (ha dejado de conducir, se ha ido). */
  reset() {
    this.has = false;
    this.base = NaN;
    this.ex = this.ey = this.ez = 0;
  }

  /**
   * Un frame: `buf`, sus poses por orden; `now`, la hora del servidor (ms); `dt`, lo que ha durado el
   * frame (s). Deja en x, y, z y q dónde dibujar su coche. Devuelve false si no hay con qué.
   */
  frame(buf: readonly CarSample[], now: number, dt: number): boolean {
    let bi = buf.length - 1;
    while (bi >= 0 && !buf[bi]!.car) bi--;
    if (bi < 0) return false;
    const b = buf[bi]!, bc = b.car!;
    // La anterior con coche (y conduciendo: de una en la que aún subía no sale una velocidad).
    let a: CarSample | null = null;
    for (let i = bi - 1; i >= 0; i--) {
      const s = buf[i]!;
      if (!s.car) continue;
      const gap = b.t - s.t;
      if (gap < GAP_MIN_MS) continue;
      if (gap <= GAP_MAX_MS && s.vehicle === "car" && b.vehicle === "car") a = s;
      break;
    }
    const h = Math.max(0, Math.min(AHEAD_MAX_MS, now - b.t + TRANSIT_MS)) / 1000;
    ahead(a, b, bc, h, _now);
    if (!this.has) {
      this.has = true;
      this.ex = this.ey = this.ez = 0;
      this.qx = _now.qx;
      this.qy = _now.qy;
      this.qz = _now.qz;
      this.qw = _now.qw;
    } else if (b.t !== this.base) {
      // Pose nueva: lo que se dibujaba sigue donde iba, y la diferencia con lo que ahora se prevé
      // para ese mismo momento (el frame anterior) es lo que hay que deshacer.
      ahead(a, b, bc, h - dt, _was);
      const ex = this.x - _was.x, ey = this.y - _was.y, ez = this.z - _was.z;
      if (ex * ex + ey * ey + ez * ez > SNAP_M * SNAP_M) this.ex = this.ey = this.ez = 0;
      else {
        this.ex = ex;
        this.ey = ey;
        this.ez = ez;
      }
    }
    this.base = b.t;
    const k = Math.exp(-Math.max(0, dt) / SETTLE_S);
    this.ex *= k;
    this.ey *= k;
    this.ez *= k;
    this.x = _now.x + this.ex;
    this.y = _now.y + this.ey;
    this.z = _now.z + this.ez;
    // El giro, hacia lo previsto (por el lado corto).
    const g = 1 - Math.exp(-Math.max(0, dt) / TURN_S);
    const sign = this.qx * _now.qx + this.qy * _now.qy + this.qz * _now.qz + this.qw * _now.qw < 0 ? -1 : 1;
    const qx = this.qx + (_now.qx * sign - this.qx) * g, qy = this.qy + (_now.qy * sign - this.qy) * g;
    const qz = this.qz + (_now.qz * sign - this.qz) * g, qw = this.qw + (_now.qw * sign - this.qw) * g;
    const l = Math.hypot(qx, qy, qz, qw) || 1;
    this.qx = qx / l;
    this.qy = qy / l;
    this.qz = qz / l;
    this.qw = qw / l;
    return true;
  }
}

interface Pose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}
const _now: Pose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
const _was: Pose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

/**
 * El coche `h` segundos después de su pose `b`, si sigue como iba desde `a`: la misma velocidad,
 * girando al mismo ritmo (la velocidad gira con él). Sin `a`, se queda donde lo dejó `b`.
 */
function ahead(a: CarSample | null, b: CarSample, bc: NonNullable<CarSample["car"]>, h: number, out: Pose) {
  const bp = bc.p, br = bc.r;
  out.x = bp[0]!;
  out.y = bp[1]!;
  out.z = bp[2]!;
  out.qx = br[0]!;
  out.qy = br[1]!;
  out.qz = br[2]!;
  out.qw = br[3]!;
  if (!a) return;
  const ap = a.car!.p, ar = a.car!.r;
  const gap = (b.t - a.t) / 1000;
  const vx = (bp[0]! - ap[0]!) / gap, vy = (bp[1]! - ap[1]!) / gap, vz = (bp[2]! - ap[2]!) / gap;
  const sp = Math.hypot(vx, vy, vz);
  if (sp > SPEED_MAX) return;
  // El giro de `a` a `b` (b · a⁻¹, en los ejes del mundo): su eje y su ritmo.
  const ax = -ar[0]!, ay = -ar[1]!, az = -ar[2]!, aw = ar[3]!;
  let dx = br[3]! * ax + br[0]! * aw + br[1]! * az - br[2]! * ay;
  let dy = br[3]! * ay - br[0]! * az + br[1]! * aw + br[2]! * ax;
  let dz = br[3]! * az + br[0]! * ay - br[1]! * ax + br[2]! * aw;
  let dw = br[3]! * aw - br[0]! * ax - br[1]! * ay - br[2]! * az;
  if (dw < 0) {
    dx = -dx;
    dy = -dy;
    dz = -dz;
    dw = -dw;
  }
  const sin = Math.hypot(dx, dy, dz);
  const w = sin > 1e-5 ? Math.min(SPIN_MAX, (2 * Math.atan2(sin, dw)) / gap) : 0;
  const ang = w * h;
  if (w < 1e-3) {
    out.x += vx * h;
    out.y += vy * h;
    out.z += vz * h;
    return;
  }
  // Lo que avanza a lo largo del eje sigue recto; lo demás describe un arco.
  const nx = dx / sin, ny = dy / sin, nz = dz / sin;
  const along = nx * vx + ny * vy + nz * vz;
  let px = vx - nx * along, py = vy - ny * along, pz = vz - nz * along;
  let cx = ny * pz - nz * py, cy = nz * px - nx * pz, cz = nx * py - ny * px;
  // La velocidad medida entre las dos poses es la de la mitad del intervalo, y por la cuerda (más
  // corta que el arco): se gira medio intervalo más, hasta la de `b`, y se alarga lo que toca.
  const half = (w * gap) / 2;
  const stretch = half > 1e-3 ? half / Math.sin(half) : 1;
  let c = Math.cos(half) * stretch, s = Math.sin(half) * stretch;
  const qx = px * c + cx * s, qy = py * c + cy * s, qz = pz * c + cz * s;
  px = qx;
  py = qy;
  pz = qz;
  cx = ny * pz - nz * py;
  cy = nz * px - nx * pz;
  cz = nx * py - ny * px;
  const sa = Math.sin(ang) / w, ca = (1 - Math.cos(ang)) / w;
  out.x += nx * along * h + px * sa + cx * ca;
  out.y += ny * along * h + py * sa + cy * ca;
  out.z += nz * along * h + pz * sa + cz * ca;
  // El giro: `ang` más alrededor de n, delante del de `b`.
  c = Math.cos(ang / 2);
  s = Math.sin(ang / 2);
  const rx = nx * s, ry = ny * s, rz = nz * s;
  out.qx = c * br[0]! + rx * br[3]! + ry * br[2]! - rz * br[1]!;
  out.qy = c * br[1]! - rx * br[2]! + ry * br[3]! + rz * br[0]!;
  out.qz = c * br[2]! + rx * br[1]! - ry * br[0]! + rz * br[3]!;
  out.qw = c * br[3]! - rx * br[0]! - ry * br[1]! - rz * br[2]!;
}
