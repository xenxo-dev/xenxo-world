/**
 * Cómo se dibuja a los demás a partir de las muestras de su pose (docs/PROTOCOL.md §7, «Poses»).
 *
 * De cada persona llegan unas cinco muestras por segundo, cada una con la hora del servidor en que
 * se tomó. Se la dibuja un poco en el pasado, entre dos muestras, y aquí se decide cuánto:
 *
 *  - `ServerClock`: la hora del servidor vista desde aquí. Se queda con el viaje más rápido de los
 *    últimos segundos (un mensaje que tarda, o una página que se atasca medio segundo, no lo mueve)
 *    y se corrige poco a poco, sin saltos.
 *  - `PeerPlayout`: el retraso con que se dibuja a cada persona, el justo para que la muestra
 *    siguiente ya haya llegado cuando hace falta: su intervalo de envío más lo que tardan en llegar
 *    las suyas. Con buena red son unos 250 ms; con una red móvil, lo que pida. Cambia poco a
 *    poco (se la ve un pelín más lenta o más rápida), nunca a saltos.
 *  - `seek`: entre qué dos muestras toca dibujar. Si la siguiente no ha llegado (se ha perdido o
 *    viene tarde), se sigue un momento con la velocidad que llevaba en vez de dejarla clavada.
 *
 * Sin Three.js ni nada del navegador: se prueba en Node (test/netplay.mts). Los relojes locales son
 * el que diga quien llama, siempre el mismo (el mundo usa `performance.now()`).
 */

/** El reloj se queda con el mejor viaje de las dos últimas ventanas de este tamaño (ms). */
const CLOCK_WINDOW_MS = 10_000;
/** Y se acerca a él a este ritmo (ms por ms: 20 ms cada segundo). Más de CLOCK_SNAP_MS de golpe: es otro reloj. */
const CLOCK_SLEW = 0.02;
const CLOCK_SNAP_MS = 1000;

export class ServerClock {
  /** horaDelServidor ≈ horaLocal + offset (ms). */
  offset = 0;
  private target = 0;
  private cur = -Infinity;
  private prev = -Infinity;
  private since = 0;
  private known = false;

  /** Un punto fijo (el servidor acaba de decir su hora y aún no hay nada mejor). */
  reset(serverT: number, now: number) {
    this.offset = this.target = this.cur = serverT - now;
    this.prev = -Infinity;
    this.since = now;
    this.known = true;
  }

  /**
   * Un mensaje que salió del servidor a su hora `serverT`, recibido a la hora local `now`. Lo que
   * tarda solo puede hacer que el servidor parezca ir más atrasado: el mejor viaje es el que manda.
   */
  sample(serverT: number, now: number) {
    if (!this.known) return this.reset(serverT, now);
    const c = serverT - now;
    if (now - this.since > CLOCK_WINDOW_MS) {
      this.prev = this.cur;
      this.cur = -Infinity;
      this.since = now;
    }
    if (c > this.cur) this.cur = c;
    this.target = Math.max(this.cur, this.prev);
  }

  /** Un frame: se acerca a lo estimado sin saltos. `dt` en ms. */
  step(dt: number) {
    const e = this.target - this.offset;
    if (Math.abs(e) > CLOCK_SNAP_MS) {
      this.offset = this.target;
      return;
    }
    const max = Math.max(0, dt) * CLOCK_SLEW;
    this.offset += e > max ? max : e < -max ? -max : e;
  }
}

/** Sin saber nada aún de alguien, se le dibuja con este retraso (ms). */
export const START_DELAY_MS = 260;
/** El intervalo de envío de siempre (5 Hz): lo que vale una muestra de alguien que está parado. */
const NOMINAL_MS = 200;
/** Lo más que se espera entre dos muestras de alguien que se mueve (quien manda más despacio se ve a saltos cortos). */
const MAX_INTERVAL_MS = 500;
/** Holgura sobre lo medido (ms). */
const MARGIN_MS = 12;
/** Límites cuerdos del retraso (ms, en hora del servidor). */
const MIN_DELAY_MS = 60;
const MAX_DELAY_MS = 900;
/** Cuántas muestras se miran: el retraso es lo que pidió la segunda que más (una suelta que llega tarde se cubre siguiendo). */
const NEED_N = 12;
/** A qué ritmo cambia el retraso (ms por ms): sube antes (se la ve un 15 % más lenta) de lo que baja (un 5 % más rápida). */
const DELAY_UP = 0.15;
const DELAY_DOWN = 0.05;
/** Más diferencia que esta (ms) no se recorre: de golpe. */
const DELAY_SNAP_MS = 400;

export class PeerPlayout {
  /** horaLocal − horaDeLaMuestraQueSeDibuja (ms): lleva dentro la diferencia entre los dos relojes. */
  private delay = NaN;
  private target = NaN;
  private need = new Float64Array(NEED_N);
  private count = 0;
  private head = 0;
  private lastT = NaN;
  private lastMoved = false;
  private lastNow = NaN;
  /** Lo que tardó en llegar la última muestra (en el mismo reloj que `delay`). */
  private transit = NaN;

  /**
   * Llega una muestra tomada a la hora `t` del servidor, a la hora local `arrival`. `moved`: su
   * pose ha cambiado respecto a la anterior. `counts` = false si su llegada no dice nada de la red
   * (la página estaba atascada o es la foto del lugar): se apunta, pero no cuenta para el retraso.
   */
  push(t: number, arrival: number, moved: boolean, counts = true) {
    const gap = Number.isNaN(this.lastT) ? NOMINAL_MS : t - this.lastT;
    // Lo que tarda entre una y otra solo dice cada cuánto manda si se venía moviendo: la primera
    // tras estar parada llega cuando toca, no a su ritmo.
    const steady = moved && this.lastMoved;
    this.lastT = t;
    this.lastMoved = moved;
    if (!counts) return;
    const interval = Math.min(Math.max(gap, 0), steady ? MAX_INTERVAL_MS : NOMINAL_MS);
    this.transit = arrival - t;
    this.need[this.head] = interval + this.transit;
    this.head = (this.head + 1) % NEED_N;
    if (this.count < NEED_N) this.count++;
    let a = -Infinity, b = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const v = this.need[i]!;
      if (v > a) {
        b = a;
        a = v;
      } else if (v > b) b = v;
    }
    this.target = (this.count >= 4 ? b : a) + MARGIN_MS;
    if (Number.isNaN(this.delay)) this.delay = this.target;
  }

  /**
   * La hora del servidor de la que toca dibujar a esta persona ahora (`now` local; `offset` es el
   * del reloj del servidor, solo para no salirse de unos límites cuerdos).
   */
  time(now: number, offset: number): number {
    if (Number.isNaN(this.delay)) return now + offset - START_DELAY_MS;
    const dt = Number.isNaN(this.lastNow) ? 0 : Math.min(250, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    const want = Math.min(MAX_DELAY_MS - offset, Math.max(MIN_DELAY_MS - offset, this.target));
    const e = want - this.delay;
    if (Math.abs(e) > DELAY_SNAP_MS) this.delay = want;
    else this.delay += e > 0 ? Math.min(e, dt * DELAY_UP) : Math.max(e, -dt * DELAY_DOWN);
    return now - this.delay;
  }

  /** El retraso de ahora en ms de verdad (para medir y enseñar). */
  delayMs(offset: number): number {
    return Number.isNaN(this.delay) ? START_DELAY_MS : this.delay + offset;
  }

  /**
   * Cuánto pasa (ms) entre que llega algo suyo y se dibuja lo que hacía en ese momento: lo que hay
   * que esperar para enseñar a la vez lo que no viaja con las poses (un golpe, un disparo).
   */
  lagMs(): number {
    if (Number.isNaN(this.delay) || Number.isNaN(this.transit)) return NOMINAL_MS;
    return Math.min(MAX_DELAY_MS, Math.max(0, this.delay - this.transit));
  }
}

/**
 * Pasada la última muestra se sigue a su velocidad este rato (ms) y después se va frenando (otros
 * LEAD_TAIL_MS de recorrido como mucho). Lo justo para cubrir una muestra que tarda: si quien se
 * mueve se ha parado y no lo ha dicho (un cliente que no manda la pose de «me he parado»), esto es
 * lo que se pasa de largo antes de volver.
 */
const LEAD_FULL_MS = 80;
const LEAD_TAIL_MS = 70;
/**
 * Solo se sigue si las dos últimas muestras son de un movimiento seguido (ms entre ellas): ni muy
 * separadas (la primera tras estar parada) ni casi juntas (de dos muestras pegadas no sale una velocidad).
 */
const LEAD_MIN_SPAN_MS = 50;
const LEAD_MAX_SPAN_MS = 450;

/** Cuánto movimiento (ms, a la velocidad que llevaba) se dibuja `over` ms después de la última muestra. */
export function lead(over: number): number {
  if (over <= LEAD_FULL_MS) return Math.max(0, over);
  return LEAD_FULL_MS + LEAD_TAIL_MS * (1 - Math.exp(-(over - LEAD_FULL_MS) / LEAD_TAIL_MS));
}

export interface Cursor {
  /** Entre qué dos muestras (índices) y cuánto de una a otra: por encima de 1, siguiendo más allá de la última. */
  i0: number;
  i1: number;
  k: number;
  /** Lo mismo para los giros (se sigue la mitad: un giro que se alarga se nota más que un paso). */
  kr: number;
  /** ms pasados de la última muestra (0 si se dibuja entre dos). */
  over: number;
}

export const cursor = (): Cursor => ({ i0: 0, i1: 0, k: 1, kr: 1, over: 0 });

/** Dónde cae la hora `rt` en las muestras de alguien (ordenadas por su hora `t`; al menos una). */
export function seek(buf: readonly { t: number }[], rt: number, out: Cursor): Cursor {
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1]!.t > rt) i--;
  const i0 = i > 0 ? i - 1 : 0;
  const t0 = buf[i0]!.t, t1 = buf[i]!.t;
  const span = t1 - t0;
  let k = 1, over = 0;
  if (rt > t1) over = rt - t1;
  if (span > 0) {
    k = (rt - t0) / span;
    if (k < 0) k = 0;
    else if (k > 1) k = span >= LEAD_MIN_SPAN_MS && span <= LEAD_MAX_SPAN_MS ? 1 + lead(over) / span : 1;
  }
  out.i0 = i0;
  out.i1 = i;
  out.k = k;
  out.kr = k > 1 ? 1 + (k - 1) * 0.5 : k;
  out.over = over;
  return out;
}

/** Con qué rapidez se deshace el desajuste al llegar una muestra que se esperaba (s). */
const BLEND_S = 0.1;
/** Un desajuste mayor que este (m) no se disimula: es un salto de verdad (un portal, un «Ir»). */
const BLEND_MAX_M = 3;

/**
 * Cuando se iba siguiendo a alguien más allá de su última muestra y llega la siguiente, lo normal es
 * que no caiga justo donde se le suponía. En vez de dar el salto, la diferencia se guarda aquí (se
 * suma a lo dibujado) y se apaga en un momento.
 *
 * Cada frame: `redo` dice si hay que mirar dónde habría caído el frame anterior con las muestras de
 * ahora (y a qué hora); si es así, `absorb` con ese punto; y después `frame` con lo de este frame.
 */
export class Catchup {
  /** El desajuste que queda (m): se suma a la posición que sale de las muestras. */
  x = 0;
  y = 0;
  z = 0;
  private rt = NaN;
  private newest = NaN;
  private over = false;
  private tx = 0;
  private ty = 0;
  private tz = 0;

  /** La hora del frame anterior si entonces se iba más allá de la última muestra y ahora hay otra; si no, NaN. */
  redo(newest: number): number {
    return this.over && newest !== this.newest ? this.rt : NaN;
  }

  /** Dónde cae el frame anterior con las muestras de ahora: lo que va de ahí a lo que se dibujó es el desajuste. */
  absorb(x: number, y: number, z: number) {
    this.x += this.tx - x;
    this.y += this.ty - y;
    this.z += this.tz - z;
    // (Así escrito, un NaN tampoco pasa.)
    if (!(this.x * this.x + this.y * this.y + this.z * this.z <= BLEND_MAX_M * BLEND_MAX_M)) this.x = this.y = this.z = 0;
  }

  /** Lo de este frame: la hora, la última muestra que hay, si se va más allá de ella y el punto (sin desajuste). `dt` en s. */
  frame(rt: number, newest: number, over: boolean, x: number, y: number, z: number, dt: number) {
    this.rt = rt;
    this.newest = newest;
    this.over = over;
    this.tx = x;
    this.ty = y;
    this.tz = z;
    if (this.x !== 0 || this.y !== 0 || this.z !== 0) {
      const f = Math.exp(-Math.min(Math.max(dt, 0), 0.1) / BLEND_S);
      this.x *= f;
      this.y *= f;
      this.z *= f;
      if (this.x * this.x + this.y * this.y + this.z * this.z < 1e-8) this.x = this.y = this.z = 0;
    }
  }
}
