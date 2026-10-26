/**
 * Jams: convocatorias con tema y fechas. Lectura pública; apuntar, quitar y votar, con cuenta;
 * crear, cambiar o sacar un juego, moderación.
 */
import { REALTIME_URL } from "../config";
import { accountToken, ApiError, type Project } from "./account";

export type JamText = { es: string; en: string };
export type JamPhase = "upcoming" | "submissions" | "voting" | "results";

export interface Jam {
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
}

export interface JamResult {
  project_id: string;
  votes: number;
  average: number;
  score: number;
  rank: number;
}

export interface JamDetail {
  jam: Jam;
  entries: Project[];
  results: JamResult[] | null;
}

export interface JamMine {
  votes: Record<string, number>;
  entries: { project_id: string; removed_note: string | null }[];
  can_vote: boolean;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = accountToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(new URL(path, REALTIME_URL), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; detail?: unknown };
  if (!res.ok) throw new ApiError(data.error ?? String(res.status), data.message ?? "error", data.detail);
  return data as T;
}

const s = (slug: string) => encodeURIComponent(slug);

export async function listJams(): Promise<Jam[]> {
  return (await call<{ jams: Jam[] }>("GET", "/jams")).jams;
}

export function jamDetail(slug: string) {
  return call<JamDetail>("GET", `/jams/${s(slug)}`);
}

export async function jamMine(slug: string): Promise<JamMine | null> {
  if (!accountToken()) return null;
  return call<JamMine>("GET", `/jams/${s(slug)}/mine`);
}

export function enterJam(slug: string, projectId: string) {
  return call("POST", `/jams/${s(slug)}/entries`, { project_id: projectId });
}

export function leaveJam(slug: string, projectId: string) {
  return call("DELETE", `/jams/${s(slug)}/entries/${encodeURIComponent(projectId)}`);
}

/** De 1 a 5 estrellas; 0 retira el voto. */
export function voteJam(slug: string, projectId: string, stars: number) {
  return call("PUT", `/jams/${s(slug)}/votes/${encodeURIComponent(projectId)}`, { stars });
}

/* --- Moderación --- */

export interface JamInput {
  slug?: string;
  title?: JamText;
  theme?: JamText;
  about?: JamText;
  starts_at?: number;
  ends_at?: number;
  voting_ends_at?: number;
  cancelled?: boolean;
  note?: string;
}

export function modCreateJam(j: JamInput) {
  return call<{ jam: Jam }>("POST", "/mod/jams", j);
}

export function modUpdateJam(slug: string, j: JamInput) {
  return call<{ jam: Jam }>("PATCH", `/mod/jams/${s(slug)}`, j);
}

export function modRemoveJamEntry(slug: string, projectId: string, note: string) {
  return call("POST", `/mod/jams/${s(slug)}/entries/${encodeURIComponent(projectId)}/remove`, { note });
}

/** La jam que se enseña en el nexo: la que esté en marcha, si no la próxima, si no la última acabada (30 días). */
export function featuredJam(jams: Jam[], now = Date.now()): Jam | null {
  const live = jams.filter((j) => j.phase === "submissions" || j.phase === "voting").sort((a, b) => a.ends_at - b.ends_at)[0];
  if (live) return live;
  const next = jams.filter((j) => j.phase === "upcoming").sort((a, b) => a.starts_at - b.starts_at)[0];
  if (next) return next;
  return jams.filter((j) => j.phase === "results" && now - j.voting_ends_at < 30 * 86_400_000).sort((a, b) => b.voting_ends_at - a.voting_ends_at)[0] ?? null;
}
