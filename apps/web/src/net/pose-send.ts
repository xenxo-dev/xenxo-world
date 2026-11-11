/**
 * Cuándo se manda la pose propia.
 *
 * Cada pose es 1/20 de petición del plan gratuito de Durable Objects (docs/LIMITES-CLOUDFLARE.md):
 * se mandan cinco por segundo mientras uno se mueve, no más. Con esas mismas se consigue que los
 * demás lo vean bien:
 *
 *  - Al pararse sale una más, con la misma pose: así los demás saben que se ha parado y no lo siguen
 *    dibujando hacia donde iba. Después, un latido por segundo.
 *  - Un cambio de gesto, de arma o de lo que se hace con el coche no espera a su turno: sale al
 *    momento si queda crédito (un cubo que se llena a ese mismo ritmo: de media nunca se manda más).
 *  - Con alguien al lado en el modo pelea, el doble de seguido mientras dura (`SEND_TIGHT_MS`).
 *
 * Sin Three.js ni nada del navegador: se prueba en Node (test/netplay.mts).
 */

/** Cada cuánto se manda en marcha (ms): 5 Hz. El movimiento se suaviza al otro lado (playout.ts). */
export const SEND_EVERY_MS = 200;
/** Con alguien al lado en el modo pelea (ms): 10 Hz, para que los golpes y las esquivas cuadren. */
export const SEND_TIGHT_MS = 100;
/** Nunca más seguido que esto (ms): el servidor admite 15 Hz de media. */
export const SEND_MIN_MS = 70;
/** Parado, un latido cada tanto (ms): sigue aquí. */
export const HEARTBEAT_MS = 1000;
/** A menos de esto (m) de alguien que también pelea se manda más seguido. */
export const TIGHT_RANGE_M = 10;

export class PoseSender {
  private last = -Infinity;
  private at = NaN;
  private tokens = 1;
  private settle = false;

  /**
   * ¿Toca mandar la pose ahora (`now` en ms)? `moved`: ha cambiado desde la última que se mandó.
   * `state`: ha cambiado el gesto, el arma o lo del coche. `every`: el ritmo de ahora.
   */
  due(now: number, moved: boolean, state: boolean, every = SEND_EVERY_MS): boolean {
    if (!Number.isNaN(this.at)) this.tokens = Math.min(2, this.tokens + Math.max(0, now - this.at) / every);
    this.at = now;
    const since = now - this.last;
    if (since < SEND_MIN_MS) return false;
    if (since < every && !(state && this.tokens >= 1)) return false;
    if (!moved && !state && !this.settle && since < HEARTBEAT_MS) return false;
    this.last = now;
    this.tokens = Math.max(0, this.tokens - 1);
    // Tras una pose que cambia toca otra aunque ya no cambie nada: la que dice que se ha parado.
    this.settle = moved || state;
    return true;
  }

  /**
   * ¿Se puede mandar una pose ya, fuera de turno? (Justo antes de avisar al servidor de «estoy
   * aquí»: una búsqueda, un punto de carrera.) Cuenta como una más: la siguiente espera su turno.
   */
  force(now: number): boolean {
    if (now - this.last < SEND_MIN_MS) return false;
    this.last = now;
    this.tokens = Math.max(0, this.tokens - 1);
    this.settle = true;
    return true;
  }
}
