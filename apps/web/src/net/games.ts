/**
 * Juegos de fuera: buscar por enlace (/j/<slug>) o por id, registrar la ficha de un proyecto propio
 * (la lee el servidor) y la moderación (revisión, ocultar, denuncias, registro).
 */
import { REALTIME_URL } from "../config";
import { accountToken, ApiError, type Project } from "./account";
import { projectById } from "./projects";

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

/** Un juego por su enlace (null si no existe o está oculto). */
export async function gameBySlug(slug: string): Promise<Project | null> {
  try {
    return (await call<{ project: Project }>("GET", `/games/${encodeURIComponent(slug)}`)).project;
  } catch {
    return null;
  }
}

const byId = new Map<string, { at: number; p: Project | null }>();

/** Un proyecto publicado por su id (del catálogo si está; si no, se pide: puede estar sin revisar). */
export async function projectByIdAny(id: string): Promise<Project | null> {
  const known = projectById(id);
  if (known) return known;
  const c = byId.get(id);
  if (c && Date.now() - c.at < 30_000) return c.p;
  let p: Project | null = null;
  try {
    p = (await call<{ project: Project }>("GET", `/projects/${encodeURIComponent(id)}`)).project;
  } catch {
    p = null;
  }
  byId.set(id, { at: Date.now(), p });
  return p;
}

/** /j/<slug> → slug. */
export function gameRoute(pathname: string): string | null {
  const m = pathname.match(/^\/j\/([a-z0-9-]{3,40})\/?$/);
  return m ? m[1]! : null;
}

export function gameLink(slug: string): string {
  return `${location.origin}/j/${slug}`;
}

/** Lee el xenxo.json del juego (desde el servidor) y lo guarda con su enlace. */
export function registerGameCard(projectId: string, slug?: string) {
  return call<{ project: Project; manifest_url: string }>("POST", `/projects/${encodeURIComponent(projectId)}/game`, slug ? { slug } : {});
}

export function clearGameCard(projectId: string) {
  return call<{ cleared: true }>("DELETE", `/projects/${encodeURIComponent(projectId)}/game`);
}

/* --- Moderación --- */

export interface Report {
  id: number;
  ts: number;
  reporter: string;
  target_type: string;
  target_id: string;
  reason: string;
  details: string | null;
}

export interface LogEntry {
  id: number;
  ts: number;
  moderator: string;
  action: string;
  target_type: string;
  target_id: string;
  note: string | null;
}

export async function myRoles(): Promise<{ moderator: boolean; founder?: boolean }> {
  if (!accountToken()) return { moderator: false };
  return call("GET", "/me/roles");
}

export interface ModeratorRow {
  player_no: number | null;
  display_name: string;
  added_at: number | null;
  founder: boolean;
}

export function modModerators() {
  return call<{ moderators: ModeratorRow[] }>("GET", "/mod/moderators");
}

/** Solo el fundador: nombrar o retirar a alguien de moderación por su número de jugador. */
export function modSetModerator(playerNo: number, on: boolean) {
  return call<{ player_no: number; moderator: boolean }>(on ? "PUT" : "DELETE", `/mod/moderators/${playerNo}`);
}

export function modQueue() {
  return call<{ pending: Project[]; reports: Report[] }>("GET", "/mod/queue");
}

export function modLog() {
  return call<{ log: LogEntry[] }>("GET", "/mod/log");
}

export function modReview(projectId: string, decision: "approved" | "rejected", note: string) {
  return call("POST", `/mod/projects/${encodeURIComponent(projectId)}/review`, { decision, note });
}

export function modHide(projectId: string, note: string) {
  return call("POST", `/mod/projects/${encodeURIComponent(projectId)}/hide`, { note });
}

/** Vuelve a colocar las máquinas-portal de las plazas con los juegos de cada distrito. */
export function modSyncShowcase() {
  return call<{ synced: boolean }>("POST", "/mod/showcase/sync");
}

export function modReport(id: number, status: "actioned" | "dismissed", note: string) {
  return call("POST", `/mod/reports/${id}`, { status, note });
}
