/**
 * De vuelta a la pista. En una carrera de coches por una pista en alto (el Circuito Vértigo de
 * Arcade, sin quitamiedos), quien se cae no se queda fuera: su coche vuelve solo al último punto de
 * la carrera que pasó, mirando hacia donde sigue la pista, y arranca de parado. Lo que se pierde es
 * tiempo.
 *
 * No hace falta que la carrera lo diga: se sabe por la altura. Cada cliente conoce los puntos de su
 * carrera (checkpoint@1) y entre cuáles va; si el coche queda muy por debajo del más bajo de los
 * dos, es que se ha caído. En el Gran Premio (a ras de suelo) no pasa nunca.
 *
 * Sin Three.js ni nada del navegador: se prueba en Node (test/race.mts).
 */

/** Un punto de la carrera: dónde está y hacia dónde sigue la pista (el giro de su `transform@1`, rad). */
export interface Gate {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Caído: tantos metros por debajo del más bajo de los dos puntos entre los que va. */
export const FALL_DEEP = 8;
/** Tras volver, un momento sin mirar (s): el coche se está posando. */
export const RESCUE_REST_S = 1.2;

/**
 * ¿Se ha caído el coche? `y`: su altura; `last` y `next`: el último punto que pasó y el que le toca.
 * (Solo la altura: entre dos puntos la pista puede bajar y volver a subir, o el coche ir por el
 * aire en un salto, pero nunca tan por debajo de los dos.)
 */
export function fallen(y: number, last: Gate, next: Gate): boolean {
  return y < Math.min(last.y, next.y) - FALL_DEEP;
}

/**
 * Entre qué puntos voy en mi carrera (los pone Activities.tsx mientras corro una de salida conjunta
 * en coche; `on` = false si no): lo lee vehicle/drive.ts en cada frame.
 */
export const raceGates = {
  on: false,
  last: { x: 0, y: 0, z: 0, yaw: 0 } as Gate,
  next: { x: 0, y: 0, z: 0, yaw: 0 } as Gate,
};
