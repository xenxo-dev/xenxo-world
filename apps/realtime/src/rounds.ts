/**
 * Carreras de salida conjunta (docs/PROTOCOL.md §7): las rondas de una carrera con parrilla
 * (`checkpoint@1.mode = "grid"`). Quien se pone en la parrilla entra en la ronda que se está
 * formando; a su hora sale (quien no esté en su sitio se queda fuera) y cada cual va pasando por sus
 * puertas —los puntos y la meta de cada vuelta, en orden— hasta completar las vueltas. Aquí está la
 * cuenta, sin nada del Durable Object: se prueba en Node. Vive en memoria: una ronda dura minutos.
 */

/** De quien llega primero a la parrilla a la salida (ms): tiempo para que se apunte alguien más. */
export const ROUND_COUNTDOWN_MS = 8000;
/** Quien se apunta con menos que esto por delante retrasa la salida hasta dejarle este margen (ms). */
export const ROUND_JOIN_MS = 3500;
/** Y la salida no se retrasa más que esto desde que se abrió la ronda (ms). */
export const ROUND_OPEN_MAX_MS = 20_000;
/** Una ronda no dura más que esto (ms); y, tras llegar el primero, los demás tienen ROUND_AFTER_MS. */
export const ROUND_MAX_MS = 6 * 60_000;
export const ROUND_AFTER_MS = 45_000;
/** Quien no ha pasado ni una puerta en este tiempo desde la salida se queda fuera (ms): se ha quedado en la parrilla. */
export const ROUND_IDLE_MS = 40_000;
/** Coches por ronda. */
export const ROUND_ENTRANTS = 16;
/** Más rápido que esto en coche es imposible (m/s): el tope de movimiento del servidor. */
export const CAR_SPEED = 40;

export interface Entrant {
  session_id: string;
  /** Cuenta (o invitado) y si sus tiempos se apuntan. */
  sub: string;
  ranked: boolean;
  name: string;
  no?: number;
  /** Su cajón de la parrilla (si la carrera los tiene). */
  slot?: number;
  gates: number;
  at?: number;
  ms?: number;
  out?: boolean;
}

export interface Round {
  id: number;
  key: string;
  race: string;
  owner: string;
  state: "countdown" | "running" | "done";
  openedAt: number;
  goAt: number;
  laps: number;
  /** Puertas por vuelta (los puntos más la meta). */
  perLap: number;
  /** Lo mínimo que puede durar (ms): más rápido no cuenta. */
  minMs: number;
  /** Cajones de la parrilla (0 = sin cajones: caben ROUND_ENTRANTS y cada cual donde se pare). */
  slots: number;
  entrants: Map<string, Entrant>;
  /** Cuándo llegó el primero (ms desde la salida). */
  firstMs?: number;
}

/**
 * Alguien se pone en la parrilla: entra en la ronda de esa carrera que se está formando (o la abre).
 * Devuelve la ronda, o null si no cabe nadie más. Si ya estaba, no cambia nada.
 */
export function joinRound(rounds: Round[], make: () => Omit<Round, "state" | "openedAt" | "goAt" | "entrants">, who: Omit<Entrant, "gates" | "slot">, now: number): Round | null {
  const base = make();
  let r = rounds.find((x) => x.key === base.key && x.state === "countdown");
  if (r?.entrants.has(who.session_id)) return r;
  // Si no cabe en la que se está formando, no se abre otra: a esperar a que salga.
  if (r && r.entrants.size >= (r.slots || ROUND_ENTRANTS)) return null;
  if (!r) {
    r = { ...base, state: "countdown", openedAt: now, goAt: now + ROUND_COUNTDOWN_MS, entrants: new Map() };
    rounds.push(r);
  }
  // El primer cajón libre (el primero en llegar, la pole).
  let slot: number | undefined;
  if (r.slots > 0) {
    const taken = new Set([...r.entrants.values()].map((e) => e.slot));
    slot = 0;
    while (taken.has(slot)) slot++;
  }
  r.entrants.set(who.session_id, { ...who, ...(slot !== undefined ? { slot } : {}), gates: 0 });
  // Que le dé tiempo a ver la cuenta atrás; sin eternizar la espera de los que ya estaban.
  r.goAt = Math.max(r.goAt, Math.min(now + ROUND_JOIN_MS, r.openedAt + ROUND_OPEN_MAX_MS));
  return r;
}

/** Dan la salida: quien no está en su sitio (`ready`) se queda fuera. false si no queda nadie. */
export function startRound(r: Round, ready: (session_id: string) => boolean): boolean {
  for (const e of r.entrants.values()) if (!ready(e.session_id)) e.out = true;
  r.state = "running";
  return [...r.entrants.values()].some((e) => !e.out);
}

/**
 * Qué puerta le toca a quien lleva `gates`: el índice de su punto (0..n-1) o "finish".
 * `perLap` = puntos + 1.
 */
export function nextGate(gates: number, perLap: number): number | "finish" {
  const g = gates % perLap;
  return g === perLap - 1 ? "finish" : g;
}

/**
 * Pasa por una puerta (`gate`: el índice de su punto o "finish"). Devuelve "pass", "finish" (ha
 * acabado), o null si no era la suya, no corre o va imposible de rápido.
 */
export function passGate(r: Round, session_id: string, gate: number | "finish", now: number): "pass" | "finish" | null {
  const e = r.entrants.get(session_id);
  if (r.state !== "running" || !e || e.out || e.ms !== undefined || now < r.goAt) return null;
  if (nextGate(e.gates, r.perLap) !== gate) return null;
  const at = now - r.goAt;
  const total = r.laps * r.perLap;
  // Más rápido de lo posible hasta aquí (a ojo: la parte de carrera que lleva): fuera.
  if (at < (r.minMs * (e.gates + 1)) / total) {
    e.out = true;
    return null;
  }
  e.gates++;
  e.at = at;
  if (e.gates < total) return "pass";
  e.ms = at;
  if (r.firstMs === undefined) r.firstMs = at;
  return "finish";
}

/** Cómo van, de primero a último: quien ha llegado (por tiempo), quien corre (más puertas; antes) y quien está fuera. */
export function standings(r: Round): Entrant[] {
  const rank = (e: Entrant) => (e.out ? 2 : e.ms !== undefined ? 0 : 1);
  return [...r.entrants.values()].sort((a, b) => rank(a) - rank(b) || (a.ms ?? 0) - (b.ms ?? 0) || b.gates - a.gates || (a.at ?? 0) - (b.at ?? 0));
}

/**
 * Quien sigue en la parrilla mucho después de la salida (ni una puerta) se queda fuera: no ocupa un
 * puesto en la clasificación ni alarga la ronda de los demás. Devuelve true si ha sacado a alguien.
 */
export function dropIdle(r: Round, now: number): boolean {
  if (r.state !== "running" || now - r.goAt < ROUND_IDLE_MS) return false;
  let any = false;
  for (const e of r.entrants.values()) {
    if (e.gates > 0 || e.out) continue;
    e.out = true;
    any = true;
  }
  return any;
}

/** ¿Se ha acabado? Todos han llegado o están fuera, o se ha pasado el tiempo. */
export function roundOver(r: Round, now: number): boolean {
  if (r.state !== "running") return false;
  if ([...r.entrants.values()].every((e) => e.out || e.ms !== undefined)) return true;
  if (now - r.goAt > ROUND_MAX_MS) return true;
  return r.firstMs !== undefined && now - r.goAt - r.firstMs > ROUND_AFTER_MS;
}

/**
 * Lo mínimo que puede durar una carrera: sus vueltas por la suma de las rectas entre sus puertas, a
 * lo más rápido que se puede ir (`speed`, m/s: en coche o a pie).
 */
export function minRoundMs(gates: number[][], laps: number, speed = CAR_SPEED): number {
  let d = 0;
  for (let i = 0; i < gates.length; i++) {
    const a = gates[i]!, b = gates[(i + 1) % gates.length]!;
    d += Math.hypot(b[0]! - a[0]!, b[2]! - a[2]!);
  }
  return Math.floor(((d * laps) / speed) * 1000);
}
