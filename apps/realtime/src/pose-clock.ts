/**
 * La hora de cada muestra de pose (docs/PROTOCOL.md §7: «Poses: cuándo se tomó cada una»).
 *
 * Quien recibe las poses de otra persona la dibuja entre dos muestras, y para que ande a velocidad
 * uniforme tiene que saber cuándo se tomó cada una. La hora a la que el lote sale de aquí no vale:
 * las muestras esperan dentro del lote un rato distinto cada vez, y con eso los demás la veían
 * avanzar a tirones (un 30 % de más o de menos) aunque la red fuera perfecta. Tampoco la hora a la
 * que llegan aquí: por una red móvil llegan a rachas.
 *
 * Cada `POSE` trae `t`, la hora del reloj de quien la manda. De ese reloj solo se usan las
 * diferencias: aquí se calcula cuánto hay que sumarle para tener la hora de este servidor (con el
 * viaje más rápido de los últimos segundos) y con eso cada muestra queda fechada como se tomó, no
 * como llegó. Sin dependencias (ni del Worker ni del Durable Object): se prueba en Node.
 */

/** Una muestra nunca se da por más vieja que esto al llegar (ms): un reloj roto no mueve a nadie al pasado. */
export const SAMPLE_MAX_AGE_MS = 1000;
/** El viaje más rápido se busca en las dos últimas ventanas de este tamaño (ms): así sigue a un reloj que se desvía o que cambia. */
const WINDOW_MS = 10_000;
/** Un salto mayor que esto (ms) entre lo esperado y lo que llega es otro reloj (o el suyo, cambiado): se empieza de cero. */
const RESET_MS = 2000;

export interface PoseClock {
  /** Lo menos que ha habido que sumar a su `t` para tener la hora de aquí, en esta ventana y en la anterior (ms). */
  cur: number;
  prev: number;
  /** Cuándo empezó esta ventana y a qué hora se dio por tomada su última muestra (hora de aquí, ms). */
  since: number;
  last: number;
}

/**
 * Llega una muestra con `t` (el reloj de quien la manda) a la hora `now` de aquí. Devuelve su reloj
 * (el mismo objeto, o uno nuevo si no había o ha saltado), con `last` = la hora de aquí en que se
 * tomó: nunca después de ahora, nunca más de SAMPLE_MAX_AGE_MS antes y nunca antes que la anterior.
 */
export function stampSample(c: PoseClock | undefined, t: number, now: number): PoseClock {
  const raw = now - t;
  if (!c || !Number.isFinite(raw) || !(Math.abs(raw - Math.min(c.cur, c.prev)) <= RESET_MS)) {
    c = { cur: Number.isFinite(raw) ? raw : 0, prev: Infinity, since: now, last: c?.last ?? 0 };
  } else {
    if (now - c.since > WINDOW_MS) {
      c.prev = c.cur;
      c.cur = Infinity;
      c.since = now;
    }
    if (raw < c.cur) c.cur = raw;
  }
  const taken = Math.max(now - SAMPLE_MAX_AGE_MS, t + Math.min(c.cur, c.prev));
  c.last = Math.min(now, Math.max(c.last + 1, Number.isFinite(taken) ? taken : now));
  return c;
}

/**
 * Tope de frecuencia que deja pasar las rachas: de media no más de `hz`, pero varias muestras que
 * llegan juntas tras un atasco de la red (hasta `burst`) no se tiran. `tat` es la hora a la que
 * tocaría la siguiente si llegaran al ritmo justo; devuelve la nueva, o -1 si esta sobra.
 */
export function allowSample(tat: number | undefined, now: number, hz: number, burst = 3): number {
  const gap = 1000 / hz;
  const next = Math.max(tat ?? 0, now);
  return next - now > gap * burst + 1e-6 ? -1 : next + gap;
}

/**
 * Cada cuánto se reparten las poses (ms) según cuánta gente las está mandando. Con poca, al momento
 * (cada espera dentro del lote es retraso con el que los demás la ven); con mucha, en lotes, que es
 * lo que mantiene a raya los mensajes que recibe cada uno. `slowest` es el intervalo de siempre.
 */
export function batchGap(senders: number, slowest: number): number {
  if (senders <= 6) return 0;
  if (senders <= 10) return Math.min(slowest, 40);
  if (senders <= 24) return Math.min(slowest, 70);
  return slowest;
}

/** Decimales que viajan: milímetros en las posiciones y diezmilésimas en los giros (un tercio menos de bytes). */
export const roundP = (v: number) => Math.round(v * 1000) / 1000;
export const roundR = (v: number) => Math.round(v * 10000) / 10000;
