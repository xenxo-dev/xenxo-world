/**
 * Saltos y pasos en la animación de los personajes (world/animation.ts), sin nada de Three.js: se
 * prueba en Node (test/leap.mts).
 *
 * - **El salto en tres tiempos**: el impulso (`jump_start`, desde que ya ha despegado: el agacharse
 *   de antes no da tiempo a verse), el vuelo (`jump_loop`) y el aterrizaje (`jump_land`, desde que
 *   toca el suelo), que se agacha más cuanto más fuerte llega: de un saltito, casi nada; de un
 *   tejado, hasta el fondo. Corriendo, el aterrizaje es más corto y se mezcla con la carrera.
 * - **Sin falsos saltos**: bajar una escalera o un bordillo deja los pies un momento en el aire (y,
 *   de los demás, la pose llega a saltos); solo es vuelo si dura (`AIR_DELAY`) o si sube deprisa.
 * - **Los pies no patinan**: andar, trotar y correr van con la misma fase (el mismo pie en el mismo
 *   punto del paso, `PHASE0`), que avanza con lo que se avanza de verdad sobre el suelo. Mezclados
 *   (al acelerar, al frenar, a medias), las piernas no se cruzan; antes cada clip iba a su ritmo y,
 *   mezclados, salían dos zancadas a la vez.
 */

/** Lo que tiene que durar el vuelo para serlo (s), salvo que suba deprisa (un salto de verdad). */
export const AIR_DELAY = 0.08;
/** Subiendo a más de esto (m/s), es un salto desde el primer frame. */
export const RISE_VY = 1.5;
/** La gravedad del cuerpo (locomotion.ts), para estimar el golpe de quien no dice su velocidad. */
const G = 15;
/** El impulso: desde dónde de `jump_start` (s; el clip empieza agachado y a los 0,07 s ya está estirado) y cuánto dura antes de pasar al vuelo. */
export const START_FROM = 0.03;
const START_HOLD = 0.22;
const START_OUT = 0.42;
/** El aterrizaje: desde dónde de `jump_land` (s: a los 0,05 s toca el suelo; lo más hondo, a los 0,2 s). */
export const LAND_FROM = 0.05;

/** Fuerza del aterrizaje (0..1) según la velocidad con la que llega al suelo (m/s). */
export function landStrength(impact: number, airTime: number): number {
  if (airTime < 0.2) return 0;
  return Math.min(1, Math.max(0, (impact - 3) / 6));
}

const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Leap {
  /** En el aire (de verdad: ver `AIR_DELAY`). */
  air = false;
  /** El vuelo empezó con un salto (subiendo), no cayendo de un borde. */
  rose = false;
  /** Tiempo en el aire. */
  airT = 0;
  /** Lo más deprisa que ha bajado en este vuelo (m/s, negativo), si se sabe. */
  private minVy = 0;
  private knowVy = false;
  /** El aterrizaje en curso: su fuerza (0: ninguno) y cuánto lleva. */
  land = 0;
  landT = 0;
  /** Acaba de empezar un aterrizaje o un salto (en este frame): las mezclas entran deprisa. */
  sharp = false;

  /**
   * Un frame. `airborne`: los pies no pisan (lo que diga quien lo mueve); `vy`: su velocidad vertical
   * (m/s), si se sabe.
   */
  step(dt: number, airborne: boolean, vy?: number) {
    this.sharp = false;
    if (airborne) {
      this.airT += dt;
      if (vy !== undefined) {
        this.knowVy = true;
        this.minVy = Math.min(this.minVy, vy);
      }
      if (!this.air && (this.airT > AIR_DELAY || (vy ?? 0) > RISE_VY)) {
        this.air = true;
        // Sin saber su velocidad, se toma por un salto (lo normal); sabiéndola, si aún sube.
        this.rose = vy === undefined || vy > 0.5;
        this.land = 0;
        this.sharp = this.rose;
      }
      return;
    }
    if (this.air) {
      const impact = this.knowVy ? -this.minVy : G * this.airT * (this.rose ? 0.5 : 1);
      this.land = landStrength(impact, this.airT);
      this.landT = 0;
      this.sharp = this.land > 0;
    } else if (this.land > 0) {
      this.landT += dt;
      if (this.landT > this.landDur()) this.land = 0;
    }
    this.air = false;
    this.airT = 0;
    this.minVy = 0;
    this.knowVy = false;
  }

  /** Lo que dura el aterrizaje (s): más, cuanto más fuerte. */
  landDur(): number {
    return 0.35 + 0.5 * this.land;
  }

  /** Peso del impulso en el vuelo (el resto es el vuelo en sí). */
  startW(): number {
    return this.air && this.rose ? 1 - smooth(this.airT, START_HOLD, START_OUT) : 0;
  }

  /** Por dónde va el clip del impulso (s). */
  startTime(): number {
    return START_FROM + this.airT;
  }

  /** Peso del aterrizaje sobre lo de debajo (andar, correr, el reposo); `speed` en m/s. */
  landW(speed: number): number {
    if (this.land <= 0) return 0;
    const d = this.landDur();
    const e = 1 - smooth(this.landT, d * 0.45, d);
    // Corriendo no se para: se agacha menos y sigue.
    return this.land * e * (1 - 0.45 * smooth(speed, 1, 4));
  }

  /** Por dónde va el clip del aterrizaje (s): uno suave baja y sube antes. */
  landTime(): number {
    return LAND_FROM + this.landT * (1.6 - 0.6 * this.land);
  }
}

/**
 * La fase común de andar, trotar y correr: en qué punto de cada clip está el mismo momento del paso.
 * Medido en los clips (Walk_Loop, Jog_Fwd_Loop y Sprint_Loop de la Universal Animation Library,
 * tools/avatars): el desfase con el que las piernas de uno y otro se parecen más a lo largo de todo
 * el ciclo (de andar a trotar, 25° de diferencia media por hueso; con el peor desfase, 50°). Si se
 * cambian los clips, se vuelve a medir.
 */
export const PHASE0: Record<string, number> = { walk: 0.13, jog: 0.05, sprint: 0.04 };

/** Velocidad (m/s) a la que cada clip pisa sin patinar (lo que avanza un ciclo, por su duración). */
export const NATURAL: Record<string, number> = { walk: 1.25, jog: 3.0, sprint: 5.8 };

/**
 * Cuánto avanza la fase común (ciclos) en `dt`: lo que se avanza sobre el suelo entre lo que avanza
 * un ciclo de la mezcla (`w`: el peso de cada clip; `dur`: su duración). Muy despacio, el paso no se
 * para del todo (como mucho, a algo más de la mitad de su ritmo): la mezcla con el reposo lo tapa.
 */
export function cycleStep(dt: number, speed: number, w: Record<string, number>, dur: Record<string, number>): number {
  let sw = 0, stride = 0, period = 0;
  for (const k in NATURAL) {
    const x = w[k] ?? 0, d = dur[k];
    if (x <= 0 || !d) continue;
    sw += x;
    stride += x * NATURAL[k]! * d;
    period += x * d;
  }
  if (sw < 1e-3) return 0;
  stride /= sw;
  period /= sw;
  const natural = 1 / period;
  return dt * Math.min(natural * 1.7, Math.max(natural * 0.55, speed / stride));
}

/** Lo más que se inclina al girar (rad: unos 12°). */
export const MAX_LEAN = 0.21;

/**
 * Al girar corriendo, el cuerpo se inclina hacia dentro de la curva (con los pies donde están: el
 * giro se aplica al grupo del personaje, que tiene el origen en los pies). Lo que se inclinaría de
 * verdad (tan θ = v·ω/g), algo menos y con tope; parado o girando sin avanzar, nada. Positivo: hacia
 * la izquierda, con el giro de Three.js (`rotation.z` del grupo en orden YXZ).
 */
export class TurnLean {
  private yaw = NaN;
  private rate = 0;
  lean = 0;
  /** Un frame: hacia dónde mira (rad), lo deprisa que va (m/s) y si toca (en el suelo, sin parkour). */
  step(dt: number, yaw: number, speed: number, on: boolean): number {
    if (!(dt > 0)) return this.lean;
    let d = Number.isNaN(this.yaw) ? 0 : yaw - this.yaw;
    d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    this.yaw = yaw;
    // Un giro de golpe (aparecer, darse la vuelta al llegar) no es una curva.
    const w = Math.abs(d) > 1 ? 0 : d / dt;
    this.rate += (w - this.rate) * Math.min(1, dt / 0.12);
    const want = on && speed > 0.5 ? Math.max(-MAX_LEAN, Math.min(MAX_LEAN, Math.atan((speed * this.rate) / 9.8) * 0.6)) : 0;
    this.lean += (want - this.lean) * Math.min(1, dt / 0.15);
    return this.lean;
  }
}
