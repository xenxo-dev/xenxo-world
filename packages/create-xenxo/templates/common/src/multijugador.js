/**
 * Multijugador: este juego es de un jugador, así que aquí no hay sala y `otros` siempre está vacío.
 * Para tener una, crea el juego con `npm create xenxo@latest mi-juego -- --multi` (trae una sala
 * para tu cuenta gratuita de Cloudflare) o copia `src/multijugador.js` y `sala/` de una plantilla así.
 */
export function iniciarMultijugador() {
  return {
    /** Los demás jugadores: id → { jugador, estado }. */
    otros: new Map(),
    conectado: false,
    /** Manda tu estado (posición, etc.). Se envía como mucho 10 veces por segundo. */
    enviar() {},
    /** Algo que pasa una vez (un disparo, un emoji). */
    evento() {},
    /** Avisos: "entra", "sale", "evento", "conexion". */
    on() {
      return () => {};
    },
  };
}
