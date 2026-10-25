/**
 * Estado de movimiento de un personaje, compartido entre quien lo mueve
 * (red o teclado) y quien lo dibuja. Mutable a propósito: se lee en useFrame.
 */
export interface Motion {
  /** Velocidad horizontal suavizada (m/s). */
  speed: number;
  /** Fase del ciclo de paso (radianes). La avanza quien dibuja. */
  phase: number;
  /** En el aire (saltando). */
  airborne: boolean;
  /** Gesto en curso ("dance", "wave", "sit"…) o null. */
  emote: string | null;
}

export function createMotion(): Motion {
  return { speed: 0, phase: 0, airborne: false, emote: null };
}

/** Pasos por metro aproximados: el ciclo completo (dos pasos) son ~1,4 m. */
const RAD_PER_METER = (2 * Math.PI) / 1.4;

export function advance(m: Motion, dt: number) {
  m.phase = (m.phase + m.speed * dt * RAD_PER_METER) % (Math.PI * 200);
}

/** Suaviza una velocidad medida a saltos (red) para que el paso no tiemble. */
export function smoothSpeed(m: Motion, measured: number, dt: number) {
  m.speed += (Math.min(measured, 8) - m.speed) * Math.min(1, dt * 6);
  if (m.speed < 0.02) m.speed = 0;
}
