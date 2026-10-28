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
  CREATE TABLE IF NOT EXISTS act_race_week (
    race_key TEXT NOT NULL, week TEXT NOT NULL, sub TEXT NOT NULL, name TEXT NOT NULL, player_no INTEGER, ms INTEGER NOT NULL, ts INTEGER NOT NULL,
    PRIMARY KEY (race_key, week, sub));
`;

/** Semana ISO (UTC) de un instante: «2026-W44». Los marcadores semanales empiezan el lunes. */
export function isoWeek(t = Date.now()): string {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7; // lunes = 0
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Lunes 00:00 UTC de la semana de `t` (para filtrar por semana). */
export function weekStart(t = Date.now()): number {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

/** Margen (m) sobre el radio del objeto o del punto: la pose llega cada 200 ms y el cliente interpola. */
export const NEAR_SLACK = 2.5;
/** Una pose más vieja que esto no vale como prueba de dónde está alguien. */
export const POSE_MAX_AGE_MS = 3000;
/** Más rápido que esto (m/s en línea recta entre puntos) es imposible a pie, incluso con impulso. */
export const MAX_SPEED = 14;
/** Una carrera sin terminar se cancela pasado este tiempo. */
export const RACE_TIMEOUT_MS = 30 * 60_000;

/*
 * Movimiento creíble (POSE): el servidor lleva, por sesión, cuánto se puede mover cada pose (un cubo
 * de metros que se rellena con el tiempo). Lo que se pasa de ahí es un SALTO: la pose se reparte igual
 * (ir junto a alguien, el arco de las gafas…), pero durante un rato no cuentan las actividades y la
 * carrera en curso se anula. La primera pose de una conexión es la llegada (portal, viaje): libre.
 */
/** Velocidad sostenida máxima (m/s), en horizontal: el coche (31 m/s) con margen. */
export const MAX_MOVE_SPEED = 40;
/** Lo que se puede avanzar de golpe (m): el arco de teletransporte de las gafas llega a unos 13 m. */
export const MOVE_BURST = 15;
/** Subidas y caídas (m de golpe y m/s): escaleras, pasarelas, saltos y caídas largas. */
export const MAX_CLIMB = 12;
export const FALL_SPEED = 60;
/** A pie, en una carrera: corriendo con las placas de impulso (12 m/s) y su margen. */
export const FOOT_SPEED = 16;
export const FOOT_BURST = 8;
/** Tras un salto, durante esto no se recoge nada ni se pasa por puntos de carrera. */
export const JUMP_COOLDOWN_MS = 15_000;
/** Más llegadas que esto de la misma cuenta en ARRIVALS_WINDOW_MS: la siguiente ya no es libre. */
export const ARRIVALS_FREE = 4;
export const ARRIVALS_WINDOW_MS = 120_000;

/** Lo que el servidor sabe del movimiento de una sesión (en memoria; se pierde al hibernar). */
export interface Move {
  p: [number, number, number];
  t: number;
  /** Metros que puede avanzar ahora sin que sea un salto. */
  budget: number;
  /** Lo mismo, a pie (para las carreras). */
  foot: number;
  /** Último salto (ms) o 0. */
  jumpAt: number;
}

/**
 * Apunta una pose y dice qué ha sido: `jump` (más lejos de lo posible) y `fast` (más rápida que a pie,
 * aunque no sea un salto). Modifica `m` en su sitio: sin objetos nuevos por pose.
 */
export function stepMove(m: Move, p: readonly number[], now: number): { jump: boolean; fast: boolean } {
  const dt = Math.min(10, Math.max(0, (now - m.t) / 1000));
  const dx = p[0]! - m.p[0], dz = p[2]! - m.p[2], dy = Math.abs(p[1]! - m.p[1]);
  const d = Math.hypot(dx, dz);
  m.budget = Math.min(MOVE_BURST, m.budget + MAX_MOVE_SPEED * dt);
  m.foot = Math.min(FOOT_BURST, m.foot + FOOT_SPEED * dt);
  let jump = false, fast = false;
  if (d > m.budget || dy > MAX_CLIMB + FALL_SPEED * dt) {
    jump = fast = true;
    m.jumpAt = now;
    m.budget = MOVE_BURST;
    m.foot = FOOT_BURST;
  } else {
    m.budget -= d;
    if (d > m.foot) {
      fast = true;
      m.foot = FOOT_BURST;
    } else m.foot -= d;
  }
  m.p[0] = p[0]!;
  m.p[1] = p[1]!;
  m.p[2] = p[2]!;
  m.t = now;
  return { jump, fast };
}
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

/** Cuaternión unidad (o null si no se puede normalizar): los que llegan sin normalizar escalan el modelo. */
export function unitQuat(q: readonly number[]): [number, number, number, number] | null {
  const n = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!);
  if (!(n > 1e-6) || !Number.isFinite(n)) return null;
  return [q[0]! / n, q[1]! / n, q[2]! / n, q[3]! / n];
}
