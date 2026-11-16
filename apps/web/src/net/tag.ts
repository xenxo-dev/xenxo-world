/**
 * Juegos de pillar en el cliente (`TAG_ROUND`, docs/PROTOCOL.md §9 decies): qué ronda se enseña, qué
 * soy en ella, si tengo que quedarme quieto al empezar y a quién estoy tocando. El servidor lleva la
 * cuenta; aquí solo se elige y se lee. Sin red, sin React y sin nada del navegador: se prueba en Node
 * (test/tag.mts).
 */
import type { MessageOf, ServerMessage } from "@xenxo/protocol";

export type TagPayload = MessageOf<ServerMessage, "TAG_ROUND">["payload"];
export type TagEntry = TagPayload["players"][number];
export type TagRoleName = TagEntry["role"];

export interface TagState extends TagPayload {
  /** Cuándo llegó este aviso (reloj local, ms). */
  at: number;
}

/** Cuánto se queda a la vista el final de una ronda en la que he jugado (ms). */
export const TAG_PODIUM_MS = 12_000;
/**
 * Una ronda de la que no llega nada en este tiempo ya no vale (ms): el servidor avisa en cada cambio,
 * pero una ronda tranquila puede pasar un rato sin toques; las rondas no duran más de 5 minutos.
 */
export const TAG_STALE_MS = 6 * 60_000;
/**
 * A esta distancia (m, de pies a pies, en horizontal) y con menos de TOUCH_Y de altura entre los dos,
 * se da por tocado a quien se ve. El servidor admite algo más (sus poses llegan con retraso).
 */
export const TOUCH_R = 1.15;
export const TOUCH_Y = 1.6;

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** ¿Sigue valiendo lo que se sabe de esta ronda? Acabada, mientras dura el podio; si no, mientras siga dentro de su hora. */
export function tagFresh(g: TagState, now: number): boolean {
  if (g.state === "idle") return false;
  return now - g.at < (g.state === "done" ? TAG_PODIUM_MS : TAG_STALE_MS);
}

export const entryOf = (g: TagState | TagPayload | null, me: string | null): TagEntry | undefined => (g && me ? g.players.find((p) => p.session_id === me) : undefined);

/** Lo que soy en esa ronda (null: no juego en ella). */
export function myRole(g: TagState | null, me: string | null): TagRoleName | null {
  return entryOf(g, me)?.role ?? null;
}

/** ¿Juego en ella ahora? (esperando en el corro o corriendo, sin haberme quedado fuera). */
export function playing(g: TagState | null, me: string | null): boolean {
  if (!g || (g.state !== "open" && g.state !== "countdown" && g.state !== "running")) return false;
  const e = entryOf(g, me);
  return !!e && e.role !== "out";
}

/**
 * Llega cómo va un juego (`p`) teniendo delante `cur` (la ronda que se enseña): devuelve la que queda.
 * Manda la ronda en la que juego; después, la mía que acaba de terminar (su podio); si no juego en
 * ninguna, la última de la que ha llegado algo.
 */
export function nextTag(cur: TagState | null, p: TagPayload, me: string | null, now: number): TagState | null {
  const next: TagState = { ...p, at: now };
  const mineNow = !!entryOf(p, me);
  if (!cur || (cur.entity_id === p.entity_id && cur.round === p.round) || !tagFresh(cur, now)) return p.state === "idle" ? null : next;
  if (mineNow && p.state !== "idle") return next;
  if (playing(cur, me) || (cur.state === "done" && entryOf(cur, me))) return cur;
  return p.state === "idle" ? cur : next;
}

/**
 * ¿Tengo que quedarme quieto? Al empezar, quien la lleva espera en el corro mientras los demás se
 * dispersan (hasta su `ready_at`, antes del primer toque).
 */
export function heldAtStart(g: TagState | null, me: string | null, serverNow: number): boolean {
  if (!g || g.state !== "running" || g.tag) return false;
  const e = entryOf(g, me);
  return !!e && e.role === "it" && (e.ready_at ?? 0) > serverNow;
}

/** ¿Puedo pillar ya? (La llevo, la ronda está en juego y ha pasado mi `ready_at`.) */
export function canTag(g: TagState | null, me: string | null, serverNow: number): boolean {
  if (!g || g.state !== "running" || (g.end_at ?? Infinity) <= serverNow) return false;
  const e = entryOf(g, me);
  return !!e && e.role === "it" && (e.ready_at ?? 0) <= serverNow;
}

/**
 * A quién estoy tocando ahora: de quienes corren en mi ronda (y no acaban de pasármela), el más
 * cercano a menos de TOUCH_R. `feetOf` dice dónde se dibuja a cada uno (null: no se le ve).
 */
export function touchTarget(g: TagState | null, me: string | null, serverNow: number, self: V3, feetOf: (id: string) => V3 | null): string | null {
  if (!canTag(g, me, serverNow)) return null;
  let best: string | null = null, bestD = TOUCH_R;
  for (const p of g!.players) {
    if (p.role !== "runner" || p.session_id === me || (p.immune_until ?? 0) > serverNow) continue;
    const f = feetOf(p.session_id);
    if (!f || Math.abs(f.y - self.y) > TOUCH_Y) continue;
    const d = Math.hypot(f.x - self.x, f.z - self.z);
    if (d < bestD) {
      bestD = d;
      best = p.session_id;
    }
  }
  return best;
}

/** Quién la lleva ahora (en infección, los infectados). */
export function itsOf(g: TagState | null): TagEntry[] {
  return g && g.state === "running" ? g.players.filter((p) => p.role === "it") : [];
}

/** Lo que la ha llevado cada uno hasta `serverNow` (el servidor manda `it_ms` hasta su `now`; quien la lleva sigue sumando). */
export function itMsNow(g: TagState, p: TagEntry, serverNow: number): number {
  return p.it_ms + (g.state === "running" && p.role === "it" ? Math.max(0, Math.min(serverNow, g.end_at ?? serverNow) - g.now) : 0);
}

/** «1:05» o «42 s»: lo que queda (redondeado hacia arriba al segundo). */
export function tagClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s} s`;
}

/** ¿Dentro de la zona? (Un círculo en horizontal.) */
export function insideArea(area: { x: number; z: number; r: number }, p: V3): boolean {
  return Math.hypot(p.x - area.x, p.z - area.z) <= area.r;
}
