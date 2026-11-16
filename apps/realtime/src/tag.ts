/**
 * Juegos de pillar (`tag@1`, docs/PROTOCOL.md §9 decies): el corro, la cuenta atrás, quién la lleva,
 * los toques, quién se queda fuera y quién gana. Aquí está la cuenta, sin nada del Durable Object: se
 * prueba en Node (apps/web/test/tag.mts). Vive en memoria: una ronda dura un par de minutos.
 *
 * - `tag` (pilla-pilla): la lleva uno; si toca a alguien, la lleva el otro (que no puede pillar en
 *   un momento) y quien se la pasó no puede ser pillado enseguida (sin devolución). Gana quien menos
 *   tiempo la ha llevado.
 * - `infection`: empieza uno infectado (dos con mucha gente); cada toque infecta. Si se acaba el
 *   tiempo, ganan quienes siguen corriendo; si caen todos, quien más ha pillado.
 */
import { TAG_PLAYERS_MAX } from "@xenxo/protocol";

export type TagMode = "tag" | "infection";
export type TagRole = "runner" | "it" | "out";
export type TagEnd = "time" | "caught" | "few";

/** Personas que hacen falta para empezar. */
export const TAG_MIN: Record<TagMode, number> = { tag: 2, infection: 3 };
/** Con bastante gente en el corro, cuánto falta para empezar (ms): tiempo para que se apunte alguien más. */
export const TAG_COUNTDOWN_MS = 10_000;
/** Quien entra con menos que esto por delante retrasa el comienzo hasta dejarle este margen (ms)… */
export const TAG_JOIN_MS = 4000;
/** …pero no más allá de esto desde que empezó la cuenta atrás (ms). */
export const TAG_OPEN_MAX_MS = 25_000;
/** Ventaja al empezar (ms): quien la lleva se queda quieto en el corro mientras los demás se dispersan. */
export const TAG_HEADSTART_MS = 5000;
/** Quien pasa a llevarla (o acaban de infectar) no puede pillar en este rato (ms)… */
export const TAG_READY_MS = 2000;
/** …y a quien se la acaba de pasar no se le puede pillar en este (ms): sin devolución. */
export const TAG_BACK_MS = 5000;
/** Fuera de la zona de juego más de esto (ms): fuera de la ronda. */
export const TAG_OUTSIDE_MS = 4000;
/** Para entrar hay que quedarse en el corro este rato (ms): quien solo pasa por encima no se apunta. */
export const TAG_DWELL_MS = 1500;
/** Tras una ronda, el corro espera esto antes de formar otra (ms): el podio se lee. */
export const TAG_PAUSE_MS = 6000;
/**
 * Alcance de un toque comprobado con las poses (m): en horizontal y en altura. Holgado: la pose de
 * quien corre llega con un poco de retraso (a 6 m/s, 200 ms son 1,2 m) y el cliente avisa al tocar.
 */
export const TAG_REACH = 3;
export const TAG_REACH_Y = 2.2;
/** Con esta gente o más, en infección empiezan dos infectados. */
export const TAG_TWO_INFECTED = 8;

export interface TagPlayer {
  session_id: string;
  /** Cuenta (o invitado) y si sus victorias se apuntan. */
  sub: string;
  ranked: boolean;
  name: string;
  no?: number;
  role: TagRole;
  /** Lo que la ha llevado (ms) sin contar la vez de ahora, que empezó en `itSince`. */
  itMs: number;
  itSince?: number;
  tags: number;
  readyAt: number;
  immuneUntil: number;
  /** Desde cuándo está fuera de la zona (si lo está). */
  outsideSince?: number;
  /** Infección: cuándo le pillaron. */
  caughtAt?: number;
  joinedAt: number;
}

export type TagWho = Pick<TagPlayer, "session_id" | "sub" | "ranked" | "name" | "no">;

export interface TagGame {
  entity_id: string;
  game: string;
  owner: string;
  mode: TagMode;
  /** Lo que dura una ronda (s). */
  seconds: number;
  round: number;
  state: "idle" | "open" | "countdown" | "running" | "done";
  /** Cuándo empezó la cuenta atrás. */
  countFrom: number;
  goAt: number;
  endAt: number;
  doneAt: number;
  players: Map<string, TagPlayer>;
  last?: { from: string; to: string; at: number };
  end?: TagEnd;
  winners: string[];
  /** Cuántos empezaron la ronda (los puntos piden los mínimos). */
  started: number;
}

export function newTagGame(base: Pick<TagGame, "entity_id" | "game" | "owner" | "mode" | "seconds">): TagGame {
  return { ...base, round: 0, state: "idle", countFrom: 0, goAt: 0, endAt: 0, doneAt: 0, players: new Map(), winners: [], started: 0 };
}

const minOf = (g: TagGame) => TAG_MIN[g.mode];

/** Se pone a llevarla `p` (o queda infectado): desde ahora y sin pillar hasta `readyAt`. */
function makeIt(p: TagPlayer, now: number, readyAt: number) {
  p.role = "it";
  p.itSince = now;
  p.readyAt = readyAt;
}

/** Deja de llevarla (o se acaba la ronda): se suma lo que la ha llevado. */
function stopIt(p: TagPlayer, now: number) {
  if (p.itSince === undefined) return;
  p.itMs += Math.max(0, now - p.itSince);
  p.itSince = undefined;
}

/** Lo que la ha llevado hasta `now` (con la vez de ahora). */
export function itMsAt(p: TagPlayer, now: number): number {
  return p.itMs + (p.itSince !== undefined ? Math.max(0, now - p.itSince) : 0);
}

/**
 * Alguien que lleva un rato en el corro entra en la ronda que se forma (o la abre). Con los mínimos,
 * empieza la cuenta atrás; quien llega después la alarga lo justo para ver la cuenta. Devuelve true
 * si ha cambiado algo (false: ya estaba, está llena, hay una ronda en juego o es pronto tras la última).
 */
export function joinTag(g: TagGame, who: TagWho, now: number): boolean {
  if (g.state === "running") return false;
  if (g.state === "done" && now - g.doneAt < TAG_PAUSE_MS) return false;
  if (g.state === "done" || g.state === "idle") {
    g.round++;
    g.state = "open";
    g.players = new Map();
    g.last = undefined;
    g.end = undefined;
    g.winners = [];
    g.started = 0;
  }
  if (g.players.has(who.session_id) || g.players.size >= TAG_PLAYERS_MAX) return false;
  g.players.set(who.session_id, { ...who, role: "runner", itMs: 0, tags: 0, readyAt: 0, immuneUntil: 0, joinedAt: now });
  if (g.state === "open" && g.players.size >= minOf(g)) {
    g.state = "countdown";
    g.countFrom = now;
    g.goAt = now + TAG_COUNTDOWN_MS;
  } else if (g.state === "countdown") {
    g.goAt = Math.max(g.goAt, Math.min(now + TAG_JOIN_MS, g.countFrom + TAG_OPEN_MAX_MS));
  }
  return true;
}

/** Alguien sale del corro (o se va) antes de empezar. Sin los mínimos, la cuenta atrás se para. */
export function leaveLobby(g: TagGame, sid: string): boolean {
  if (g.state !== "open" && g.state !== "countdown") return false;
  if (!g.players.delete(sid)) return false;
  if (g.players.size === 0) g.state = "idle";
  else if (g.state === "countdown" && g.players.size < minOf(g)) g.state = "open";
  return true;
}

/**
 * A su hora, empieza: se elige al azar quién la lleva (en infección, uno; dos con mucha gente), que
 * no puede pillar hasta pasada la ventaja. false si ya no hay gente bastante (vuelve a esperar).
 */
export function startTag(g: TagGame, now: number, rnd: () => number): boolean {
  if (g.state !== "countdown") return false;
  if (g.players.size < minOf(g)) {
    g.state = g.players.size ? "open" : "idle";
    return false;
  }
  g.state = "running";
  g.goAt = now;
  g.endAt = now + g.seconds * 1000;
  g.started = g.players.size;
  const pool = [...g.players.values()];
  const n = g.mode === "infection" && pool.length >= TAG_TWO_INFECTED ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const p = pool.splice(Math.min(pool.length - 1, Math.floor(rnd() * pool.length)), 1)[0]!;
    makeIt(p, now, now + TAG_HEADSTART_MS);
    if (g.mode === "infection") p.caughtAt = now;
  }
  return true;
}

export type TagRefusal = "state" | "role" | "ready" | "immune";

/**
 * `from` ha tocado a `to` (la cercanía la comprueba quien llama, con las poses). En pilla-pilla se la
 * pasa; en infección, le infecta. Devuelve "ok" o por qué no cuenta.
 */
export function tagHit(g: TagGame, from: string, to: string, now: number): "ok" | TagRefusal {
  if (g.state !== "running" || now >= g.endAt) return "state";
  const a = g.players.get(from), b = g.players.get(to);
  if (!a || !b || a === b || a.role !== "it" || b.role !== "runner") return "role";
  if (now < a.readyAt) return "ready";
  if (now < b.immuneUntil) return "immune";
  a.tags++;
  if (g.mode === "tag") {
    stopIt(a, now);
    a.role = "runner";
    a.immuneUntil = now + TAG_BACK_MS;
    makeIt(b, now, now + TAG_READY_MS);
  } else {
    makeIt(b, now, now + TAG_READY_MS);
    b.caughtAt = now;
  }
  g.last = { from, to, at: now };
  return "ok";
}

/**
 * Alguien se queda fuera de la ronda (se va, llega de un salto o pasa demasiado rato fuera de la
 * zona). Antes de empezar, solo sale del corro. Si era quien la llevaba (o el último infectado), la
 * lleva otro al azar. true si ha cambiado algo.
 */
export function dropTag(g: TagGame, sid: string, now: number, rnd: () => number): boolean {
  if (g.state === "open" || g.state === "countdown") return leaveLobby(g, sid);
  const p = g.players.get(sid);
  if (g.state !== "running" || !p || p.role === "out") return false;
  const wasIt = p.role === "it";
  stopIt(p, now);
  p.role = "out";
  p.outsideSince = undefined;
  const players = [...g.players.values()];
  if (wasIt && !players.some((x) => x.role === "it")) {
    const runners = players.filter((x) => x.role === "runner");
    // Con uno solo ya no hay juego (tagOver lo cierra).
    if (runners.length >= 2) {
      const next = runners[Math.min(runners.length - 1, Math.floor(rnd() * runners.length))]!;
      makeIt(next, now, now + TAG_READY_MS);
      if (g.mode === "infection") next.caughtAt = now;
    }
  }
  return true;
}

/**
 * Dónde está quien juega: dentro o fuera de la zona. Fuera más de TAG_OUTSIDE_MS, se queda fuera de
 * la ronda (dropTag). true si ha cambiado algo de lo que se reparte.
 */
export function seeTag(g: TagGame, sid: string, inside: boolean, now: number, rnd: () => number): boolean {
  const p = g.players.get(sid);
  if (g.state !== "running" || !p || p.role === "out") return false;
  if (inside) {
    p.outsideSince = undefined;
    return false;
  }
  p.outsideSince ??= now;
  return now - p.outsideSince >= TAG_OUTSIDE_MS ? dropTag(g, sid, now, rnd) : false;
}

/** ¿Se ha acabado? Por tiempo, porque han pillado a todos (infección) o porque queda muy poca gente. */
export function tagOver(g: TagGame, now: number): TagEnd | null {
  if (g.state !== "running") return null;
  let its = 0, runners = 0;
  for (const p of g.players.values()) {
    if (p.role === "it") its++;
    else if (p.role === "runner") runners++;
  }
  if (g.mode === "infection" && runners === 0) return "caught";
  if (its + runners < 2 || its === 0) return "few";
  return now >= g.endAt ? "time" : null;
}

/**
 * Se acaba: lo que la llevaba cada cual hasta el final (como mucho, la hora de acabar) y quién gana.
 * Pilla-pilla: quien menos la ha llevado (de los que siguen). Infección: quienes siguen corriendo si
 * se acabó el tiempo; si pillaron a todos, quien más pilló. Con muy poca gente, nadie.
 */
export function finishTag(g: TagGame, now: number, end: TagEnd) {
  const at = Math.min(now, g.endAt || now);
  for (const p of g.players.values()) stopIt(p, at);
  g.state = "done";
  g.doneAt = now;
  g.end = end;
  const live = [...g.players.values()].filter((p) => p.role !== "out");
  if (end === "few") g.winners = [];
  else if (g.mode === "tag") {
    const best = Math.min(...live.map((p) => p.itMs));
    g.winners = live.filter((p) => p.itMs === best).map((p) => p.session_id);
  } else if (end === "time") g.winners = live.filter((p) => p.role === "runner").map((p) => p.session_id);
  else {
    const most = Math.max(0, ...live.map((p) => p.tags));
    g.winners = most > 0 ? live.filter((p) => p.tags === most).map((p) => p.session_id) : [];
  }
}

/** A quién se le apunta la victoria (cuentas, y solo si empezaron los que hacen falta). */
export function tagPoints(g: TagGame): TagPlayer[] {
  if (g.state !== "done" || g.end === "few" || g.started < minOf(g)) return [];
  return g.winners.map((id) => g.players.get(id)!).filter((p) => p?.ranked);
}

/** Cómo van: en pilla-pilla, quien menos la ha llevado primero; en infección, primero quienes corren. Fuera, al final. */
export function tagStandings(g: TagGame, now: number): TagPlayer[] {
  const rank = (p: TagPlayer) => (p.role === "out" ? 2 : g.mode === "infection" && p.role === "it" ? 1 : 0);
  return [...g.players.values()].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    if (g.mode === "tag") return itMsAt(a, now) - itMsAt(b, now) || a.joinedAt - b.joinedAt;
    if (a.role === "it" && b.role === "it") return b.tags - a.tags || (a.caughtAt ?? 0) - (b.caughtAt ?? 0);
    return a.joinedAt - b.joinedAt;
  });
}

/** El cuerpo de TAG_ROUND (sin lo que pone quien llama: la entidad ya va en `g`). */
export function tagPayload(g: TagGame, now: number) {
  const timed = g.state === "countdown" || g.state === "running" || g.state === "done";
  return {
    entity_id: g.entity_id,
    game: g.game,
    owner: g.owner,
    mode: g.mode,
    round: g.round,
    state: g.state,
    now,
    min: minOf(g),
    ...(timed ? { go_at: g.goAt } : {}),
    ...(g.state === "running" || g.state === "done" ? { end_at: g.endAt } : {}),
    players: tagStandings(g, now).map((p) => ({
      session_id: p.session_id,
      name: p.name,
      ...(p.no != null ? { player_no: p.no } : {}),
      role: p.role,
      it_ms: Math.round(itMsAt(p, g.state === "done" ? g.doneAt : now)),
      tags: p.tags,
      ...(p.readyAt > now ? { ready_at: p.readyAt } : {}),
      ...(p.immuneUntil > now ? { immune_until: p.immuneUntil } : {}),
    })),
    ...(g.last ? { tag: g.last } : {}),
    ...(g.state === "done" && g.end ? { end: g.end, winners: g.winners } : {}),
  };
}

/**
 * Quién lleva cuánto rato en qué corro: para entrar hay que quedarse TAG_DWELL_MS. `lobby` = el corro
 * en el que está ahora (null: en ninguno). true cuando ya lleva bastante.
 */
export function dwellIn(d: Map<string, { lobby: string; since: number }>, sid: string, lobby: string | null, now: number): boolean {
  if (!lobby) {
    d.delete(sid);
    return false;
  }
  const cur = d.get(sid);
  if (!cur || cur.lobby !== lobby) {
    d.set(sid, { lobby, since: now });
    return false;
  }
  return now - cur.since >= TAG_DWELL_MS;
}
