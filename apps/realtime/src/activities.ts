/**
 * Actividades de un lugar (búsquedas, carreras y marcadores): lo que guarda cada chunk y las
 * comprobaciones que hace antes de apuntar nada. El cliente solo dice «estoy aquí»; el servidor mira
 * dónde está de verdad (la última pose de esa sesión), el orden de la carrera y el reloj.
 *
 * Una búsqueda o una carrera se identifica por su dueño y su nombre (`<owner>:<id>`): lo de una
 * parcela no se mezcla con lo del sistema ni con lo de otra parcela.
 */

export const ACTIVITY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS act_collected (
    sub TEXT NOT NULL, entity_id TEXT NOT NULL, set_key TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (sub, entity_id));
  CREATE TABLE IF NOT EXISTS act_hunt_done (
    set_key TEXT NOT NULL, sub TEXT NOT NULL, name TEXT NOT NULL, player_no INTEGER, ts INTEGER NOT NULL, PRIMARY KEY (set_key, sub));
  CREATE TABLE IF NOT EXISTS act_race_best (
    race_key TEXT NOT NULL, sub TEXT NOT NULL, name TEXT NOT NULL, player_no INTEGER, ms INTEGER NOT NULL, ts INTEGER NOT NULL,
    PRIMARY KEY (race_key, sub));
  CREATE INDEX IF NOT EXISTS act_race_best_ms ON act_race_best (race_key, ms);
`;

/** Margen (m) sobre el radio del objeto o del punto: la pose llega cada 200 ms y el cliente interpola. */
export const NEAR_SLACK = 2.5;
/** Una pose más vieja que esto no vale como prueba de dónde está alguien. */
export const POSE_MAX_AGE_MS = 3000;
/** Más rápido que esto (m/s en línea recta entre puntos) es imposible a pie, incluso con impulso. */
export const MAX_SPEED = 14;
/** Una carrera sin terminar se cancela pasado este tiempo. */
export const RACE_TIMEOUT_MS = 30 * 60_000;
export const SCORES_LIMIT = 10;

export const activityKey = (owner: string, id: string) => `${owner}:${id}`;

/** ¿Está el punto `p` a menos de `r` m de `q` (con el margen)? En horizontal, y con 4 m de alto. */
export function near(p: number[], q: number[], r: number): boolean {
  const dx = p[0]! - q[0]!, dz = p[2]! - q[2]!, dy = Math.abs((p[1] ?? 0) - (q[1] ?? 0));
  const R = r + NEAR_SLACK;
  return dx * dx + dz * dz <= R * R && dy <= 4 + r;
}

/** Lo mínimo que puede durar una carrera: la suma de las rectas entre sus puntos, al máximo de velocidad. */
export function minRaceMs(points: number[][]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    d += Math.hypot(b[0]! - a[0]!, b[2]! - a[2]!);
  }
  return Math.floor((d / MAX_SPEED) * 1000);
}

/** La carrera en curso de una sesión (se guarda en el adjunto del WebSocket: sobrevive a la hibernación). */
export interface RaceRun {
  key: string;
  race: string;
  owner: string;
  t0: number;
  /** Siguiente punto que toca: 1..n son los `cp` por orden; n + 1 es la meta. */
  next: number;
  /** Puntos `cp` de la carrera cuando empezó. */
  total: number;
}
