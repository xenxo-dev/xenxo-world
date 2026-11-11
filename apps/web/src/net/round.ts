/**
 * Carreras de salida conjunta en el cliente (`ROUND`, docs/PROTOCOL.md §7): de las rondas del lugar,
 * cuál se enseña, y qué me toca en ella. El servidor lleva la cuenta; aquí solo se elige y se lee.
 * Sin red, sin React y sin nada del navegador: se prueba en Node (test/race.mts).
 */
import type { MessageOf, ServerMessage } from "@xenxo/protocol";

export type RoundPayload = MessageOf<ServerMessage, "ROUND">["payload"];
export type RoundEntry = RoundPayload["entrants"][number];

export interface RoundState extends RoundPayload {
  /** Estoy (o he estado) en ella. */
  mine: boolean;
  /** Sigo en ella: esperando la salida o corriendo. */
  live: boolean;
  /** Cuándo llegó este aviso (reloj local, ms). */
  at: number;
}

/** Cuánto se queda a la vista la clasificación final (ms). */
export const PODIUM_MS = 12_000;
/** Una ronda de la que no llega nada en este tiempo ya no se enseña (ms): el servidor avisa en cada puerta. */
export const ROUND_STALE_MS = 70_000;
/** Mirando sin correr: la ronda que se enseña no cambia por otra en marcha antes de esto (ms). */
const WATCH_MS = 6000;

const entryOf = (p: RoundPayload, me: string | null) => (me ? p.entrants.find((e) => e.session_id === me) : undefined);

/** ¿Sigue valiendo lo que se sabe de esta ronda? (Acabada: mientras dura el podio. Si no: mientras lleguen avisos.) */
export function roundFresh(r: RoundState, now: number): boolean {
  return now - r.at < (r.state === "done" ? PODIUM_MS : ROUND_STALE_MS);
}

/**
 * Llega cómo va una ronda (`p`) teniendo delante `cur`: devuelve la que queda. Manda la ronda en la
 * que sigo (esperando o corriendo); después, la mía que acaba de terminar (el podio); y quien solo
 * mira ve la que se está formando —es a la que puede apuntarse— antes que una en marcha.
 */
export function nextRound(cur: RoundState | null, p: RoundPayload, me: string | null, now: number): RoundState {
  const e = entryOf(p, me);
  const live = !!e && !e.out && e.ms === undefined && p.state !== "done";
  const next: RoundState = { ...p, mine: !!e, live, at: now };
  if (!cur || cur.round === p.round || !roundFresh(cur, now)) return next;
  if (live) return next;
  if (cur.live || cur.mine) return cur;
  return p.state === "countdown" || cur.state === "done" || now - cur.at > WATCH_MS ? next : cur;
}

/**
 * Lo que me toca en la ronda (si sigo corriendo): la puerta siguiente, como en las carreras a pie
 * (`next` = el punto que toca, 1..total; total + 1 = la meta), la vuelta y el puesto.
 */
export function myRun(r: RoundState | null, me: string | null): { next: number; total: number; lap: number; place: number; of: number } | null {
  if (!r || !r.live || r.state !== "running") return null;
  const i = r.entrants.findIndex((e) => e.session_id === me);
  if (i < 0) return null;
  const e = r.entrants[i]!;
  return {
    next: (e.gates % r.per_lap) + 1,
    total: r.per_lap - 1,
    lap: Math.min(r.laps, Math.floor(e.gates / r.per_lap) + 1),
    place: i + 1,
    of: r.entrants.filter((x) => !x.out).length,
  };
}

/** ¿Toca esperar en la parrilla? Estoy en una ronda que aún no ha salido: el coche no arranca. */
export function gridHold(r: RoundState | null, serverNow: number, now: number): boolean {
  return !!r && r.live && r.state === "countdown" && serverNow < r.go_at && roundFresh(r, now);
}

/**
 * El semáforo de la salida: cuántas de sus cinco luces rojas van encendidas (una más cada segundo,
 * las cinco en el último) y si ya está en verde (los dos segundos siguientes a la salida).
 */
export function startLights(r: RoundState | null, serverNow: number, now: number): { red: number; green: boolean } {
  if (!r || r.state === "done" || !roundFresh(r, now)) return OFF;
  const left = r.go_at - serverNow;
  if (left > 0) return r.state === "countdown" ? REDS[Math.max(0, Math.min(5, 5 - Math.floor((left - 1) / 1000)))]! : OFF;
  return left > -2000 ? GREEN : OFF;
}
const OFF = { red: 0, green: false };
const GREEN = { red: 0, green: true };
const REDS = [0, 1, 2, 3, 4, 5].map((red) => ({ red, green: false }));
