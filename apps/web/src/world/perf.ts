/**
 * Vigila la fluidez y dice cuándo hay que bajar un nivel de gráficos (graphics.decline()).
 *
 * Cuenta los frames por ventanas de un segundo. Si cinco de las seis últimas van por debajo de lo
 * que pide la pantalla, toca bajar. Y no mide cuando no hay nada que medir: mientras el lugar carga
 * (modelos, texturas y shaders dan tirones que no son del nivel), justo después de cambiar de lugar o
 * de nivel, ni al volver de tener la pestaña escondida.
 *
 * Vigila todo el rato, no solo al principio: entrar en un distrito pesado media hora después también
 * cuenta. Sin nada de Three.js ni del navegador (el reloj y si está cargando le llegan de fuera): se
 * prueba en Node (test/graphics.mts).
 */

/** Una ventana (ms) y cuántas se miran: con `NEED` lentas de las últimas `KEEP`, se baja. */
const WINDOW_MS = 1000;
const KEEP = 6;
const NEED = 5;
/** Tras cambiar de lugar o de nivel no se mide durante este rato (ms): todo se está cargando. */
export const SETTLE_MS = 6000;
/** Y tras la última descarga, este (ms): lo recién llegado aún compila sus shaders. */
export const LOADED_MS = 2500;
/** Un frame más largo que esto no es lentitud: la pestaña estaba escondida o el equipo, dormido. */
const GAP_MS = 2500;

/**
 * Por debajo de cuántos frames por segundo va «lento», según la pantalla (lo más que ha dado):
 * a 60 Hz, 45; en las gafas (72 y 90 Hz), 50, que pilla la media tasa (36 y 45) con la que se quedan
 * cuando no llegan; en pantallas rápidas (120 Hz o más), 60.
 */
export function slowBelow(refresh: number): number {
  if (refresh > 100) return 60;
  if (refresh > 65) return 50;
  return 45;
}

export class FpsWatch {
  private start = -1;
  private last = -1;
  private frames = 0;
  private until = 0;
  /** Lo más que ha dado esta pantalla (frames por segundo de la mejor ventana). */
  private refresh = 0;
  private slow: boolean[] = [];

  /** Deja de medir durante `ms` (y olvida lo medido): ha cambiado el lugar, el nivel o la pestaña. */
  rest(now: number, ms = SETTLE_MS) {
    this.until = Math.max(this.until, now + ms);
    this.start = -1;
    this.slow.length = 0;
  }

  /**
   * Un frame. `now` en ms; `busy`: se está descargando algo. Devuelve true cuando toca bajar un
   * nivel (y entonces deja un rato para que el nuevo se asiente antes de volver a medir).
   */
  frame(now: number, busy: boolean): boolean {
    const gap = this.last >= 0 ? now - this.last : 0;
    this.last = now;
    if (busy) this.rest(now, LOADED_MS);
    else if (gap > GAP_MS) this.rest(now, LOADED_MS);
    if (now < this.until) return false;
    if (this.start < 0) {
      this.start = now;
      this.frames = 0;
      return false;
    }
    this.frames++;
    const span = now - this.start;
    if (span < WINDOW_MS) return false;
    const fps = (this.frames * 1000) / span;
    this.start = now;
    this.frames = 0;
    this.refresh = Math.max(this.refresh, Math.min(fps, 240));
    this.slow.push(fps < slowBelow(this.refresh));
    if (this.slow.length > KEEP) this.slow.shift();
    if (this.slow.length < KEEP) return false;
    let n = 0;
    for (const s of this.slow) if (s) n++;
    if (n < NEED) return false;
    this.rest(now);
    return true;
  }
}
