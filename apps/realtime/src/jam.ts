/**
 * Jams: convocatorias con tema y fechas. Quien publica un juego lo apunta mientras la convocatoria
 * está abierta; al cerrarse se vota (con cuenta, de 1 a 5 estrellas, nunca lo propio) y al acabar la
 * votación salen los resultados. Las crea moderación. Vive en el `Directory` (mismo SQLite).
 *
 * Si moderación saca un juego, la fila se queda con su motivo (`removed_note`), que ve su autor.
 *
 * Privacidad: de cada voto se guarda quién, a qué y cuántas estrellas (para que no se vote dos
 * veces y para poder cambiarlo). Nunca se publica quién votó: solo la media y el número de votos,
 * y solo cuando la votación ha terminado.
 */

export type JamText = { es: string; en: string };
export type JamPhase = "upcoming" | "submissions" | "voting" | "results";

export type Jam = {
  slug: string;
  title: JamText;
  theme: JamText;
  about: JamText;
  starts_at: number;
  ends_at: number;
  voting_ends_at: number;
  phase: JamPhase;
  entries: number;
  cancelled: boolean;
};

export type JamResult = { project_id: string; votes: number; average: number; score: number; rank: number };

/** Una persona apunta como mucho un juego a cada jam (así se compara lo mejor de cada una). */
export const MAX_ENTRIES_PER_USER = 1;
/** Hasta 90 días de convocatoria y votación: una jam no es un concurso eterno. */
const MAX_SPAN_MS = 90 * 86_400_000;
/**
 * Media bayesiana: cada juego empieza con PRIOR_VOTES votos imaginarios de PRIOR_STARS estrellas.
 * Así un único voto de 5 no gana a veinte votos de 4,6. Se publica también la media real.
 */
const PRIOR_VOTES = 3;
const PRIOR_STARS = 3;

export const JAM_SCHEMA = `
  CREATE TABLE IF NOT EXISTS jams (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, theme TEXT NOT NULL, about TEXT NOT NULL,
    starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, voting_ends_at INTEGER NOT NULL,
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS jam_entries (
    jam_id INTEGER NOT NULL, project_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at INTEGER NOT NULL,
    removed_note TEXT, PRIMARY KEY (jam_id, project_id));
  CREATE INDEX IF NOT EXISTS jam_entries_user ON jam_entries(user_id);
  CREATE TABLE IF NOT EXISTS jam_votes (
    jam_id INTEGER NOT NULL, project_id TEXT NOT NULL, user_id TEXT NOT NULL, stars INTEGER NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (jam_id, project_id, user_id));
  CREATE INDEX IF NOT EXISTS jam_votes_user ON jam_votes(user_id);
`;

export function jamPhase(j: { starts_at: number; ends_at: number; voting_ends_at: number }, now = Date.now()): JamPhase {
  if (now < j.starts_at) return "upcoming";
  if (now < j.ends_at) return "submissions";
  if (now < j.voting_ends_at) return "voting";
  return "results";
}

export const validJamSlug = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(s);

/** Texto en ES y EN (si falta uno, vale el otro). `null` si no cumple. */
export function jamText(raw: unknown, min: number, max: number): JamText | null {
  if (typeof raw === "string") raw = { es: raw, en: raw };
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const clean = (v: unknown) => (typeof v === "string" ? v.trim().replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "") : "");
  const es = clean(r.es) || clean(r.en);
  const en = clean(r.en) || clean(r.es);
  if (es.length < min || en.length < min || es.length > max || en.length > max) return null;
  return { es, en };
}

/** Fechas en milisegundos o ISO 8601. */
export function jamTime(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw === "string") {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Comprueba el orden y la duración de las fechas. Devuelve el motivo si no valen. */
export function badJamDates(starts: number, ends: number, votingEnds: number): string | null {
  if (!(starts < ends && ends < votingEnds)) return "las fechas deben ir en orden: inicio < cierre de inscripción < fin de la votación";
  if (votingEnds - starts > MAX_SPAN_MS) return "una jam dura como mucho 90 días";
  return null;
}

/** Media de estrellas y puntuación (bayesiana) de cada juego; el puesto, por puntuación. */
export function jamRanking(rows: { project_id: string; votes: number; sum: number }[]): JamResult[] {
  const scored = rows.map((r) => ({
    project_id: r.project_id,
    votes: r.votes,
    average: r.votes ? Math.round((r.sum / r.votes) * 100) / 100 : 0,
    score: Math.round(((r.sum + PRIOR_VOTES * PRIOR_STARS) / (r.votes + PRIOR_VOTES)) * 1000) / 1000,
    rank: 0,
  }));
  scored.sort((a, b) => b.score - a.score || b.votes - a.votes || a.project_id.localeCompare(b.project_id));
  let rank = 0;
  scored.forEach((r, i) => {
    // Empate exacto (misma puntuación y votos): mismo puesto.
    const prev = scored[i - 1];
    rank = prev && prev.score === r.score && prev.votes === r.votes ? rank : i + 1;
    r.rank = rank;
  });
  return scored;
}
