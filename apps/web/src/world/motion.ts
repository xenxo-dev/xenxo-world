import type { PersonFx } from "./people/rig";

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
  /** En modo pelea: guardia en reposo y puños arriba al andar. */
  fight?: boolean;
  /** Lo que la gente le pide a su esqueleto (golpes, parejas, caídas): people/rig.ts. */
  fx?: PersonFx | null;
  /**
   * Un gesto de brazos por encima de lo que esté haciendo (saludar sentado en un banco, asentir
   * jugando a una máquina): solo la parte de arriba del cuerpo. Lo usan los ciudadanos.
   */
  gesture?: string | null;
  /** No se dibuja (lejos o fuera de la vista): el avatar no se anima. */
  hidden?: boolean;
  /**
   * Parkour en curso ("pk_vault", "pk_hang"…: world/parkour/moves.ts) o null. Manda sobre el gesto.
   * `pkP`: su progreso (0..1) en los guionados, si se sabe (el propio jugador); si no, el reloj.
   */
  pk?: string | null;
  pkP?: number;
  /**
   * El arma que lleva en la mano (sacada; world/people/guns.ts y la pose de los demás) o null. Con
   * ella, el avatar apunta (IK de los brazos) y se dibuja el arma en la mano (HeldWeapon).
   */
  weapon?: string | null;
  /**
   * Dónde está su mano derecha (respecto al grupo del personaje), con el arma sacada: lo escribe el
   * avatar después de animarse (avatar-model.ts). `ok` false: sin esqueleto (el muñeco de respaldo).
   */
  hand?: { x: number; y: number; z: number; ok: boolean };
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
