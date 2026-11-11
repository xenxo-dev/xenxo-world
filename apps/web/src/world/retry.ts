/**
 * Lo que no llega a la primera (un modelo, un personaje): un corte de red de un momento, lo normal en
 * un móvil, no puede dejar un lugar sin su suelo, sin la pista de un circuito o sin su gente hasta que
 * se recargue la página. Se vuelve a pedir unas cuantas veces, cada vez más espaciadas; lo que ya no
 * existe (un 404) no se reintenta. Sin Three.js ni React: se prueba en Node (test/arrive.mts).
 */

/** Esperas entre intento e intento (ms). Con la última, el modelo se da por perdido. */
export const RETRY_MS: readonly number[] = [2000, 6000, 15_000, 30_000];

const text = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * ¿Un fallo que no se arregla esperando? Los cargadores de Three.js dicen «responded with <código>»:
 * un 4xx es que no está o no se puede (borrado, sin permiso); un 408 o un 429 sí pasan solos, y un
 * 5xx o un «Failed to fetch», también.
 */
export function gone(e: unknown): boolean {
  const status = Number(/responded with (\d{3})/.exec(text(e))?.[1]);
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** La dirección que no se pudo cargar, si el error la dice (el de useLoader: «Could not load <url>: …»). */
export function failedUrl(e: unknown): string | null {
  return /Could not load (\S+?): /.exec(text(e))?.[1] ?? null;
}

/** Cuánto esperar antes del intento número `tries` (0 = el primero que se repite); undefined = ya no. */
export function retryIn(e: unknown, tries: number): number | undefined {
  return gone(e) ? undefined : RETRY_MS[tries];
}
