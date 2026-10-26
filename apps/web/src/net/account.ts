/**
 * Cuenta de la persona: alta y acceso con passkey (sin email ni contraseña),
 * subida de avatar y proyectos, exportación y borrado de datos (RGPD).
 */
import { useSyncExternalStore } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { checkBudget, COVER_BUDGET, inspectGlb, type AssetKind, type BudgetProblem, type GlbReport } from "@xenxo/assets";
import type { ProjectCategory } from "@xenxo/protocol";
import { REALTIME_URL, loadPref, savePref } from "../config";
import { reconnect } from "./session";

export const TERMS_VERSION = "2026-10";

export interface User {
  id: string;
  display_name: string;
  avatar_hash: string | null;
  avatar_format: "glb" | "vrm" | null;
  created_at: number;
  /** Número de jugador (por orden de alta; el 0 es el fundador). */
  player_no?: number | null;
}

export interface Project {
  id: string;
  title: string;
  summary: string;
  url: string | null;
  mesh_hash: string | null;
  cover_hash: string | null;
  category: ProjectCategory;
  district: string | null;
  parcel: string | null;
  author: string;
  created_at: number;
  in_world: boolean;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

interface Stored {
  token: string;
  user: User;
  exp: number;
}

let session: Stored | null = (() => {
  const s = loadPref<Stored | null>("account", null);
  return s && s.exp > Date.now() + 60_000 ? s : null;
})();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const fn of listeners) fn();
}

function store(s: Stored | null) {
  session = s;
  savePref("account", s);
  emit();
}

export function accountToken(): string | null {
  return session && session.exp > Date.now() ? session.token : null;
}

export function currentUser(): User | null {
  return session?.user ?? null;
}

export function useAccount(): User | null {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return currentUser();
}

async function api<T>(method: string, path: string, body?: unknown, raw?: Blob): Promise<T> {
  const headers: Record<string, string> = {};
  const token = accountToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (raw) headers["Content-Type"] = raw.type || "application/octet-stream";
  const res = await fetch(new URL(path, REALTIME_URL), {
    method,
    headers,
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; detail?: unknown };
  if (!res.ok) throw new ApiError(data.error ?? String(res.status), data.message ?? "error", data.detail);
  return data as T;
}

function adopt(r: { token: string; user: User; principal: { exp: number } }) {
  store({ token: r.token, user: r.user, exp: r.principal.exp });
  reconnect();
}

/**
 * Al abrir la web con la sesión guardada: pide una nueva con los datos de ahora (el número de
 * jugador, el nombre o el personaje pueden haber cambiado en otro dispositivo o en el servidor).
 * Solo reconecta si cambió algo que ven los demás.
 */
export async function refreshSession() {
  if (!accountToken()) return;
  const before = session?.user;
  try {
    const r = await api<{ token: string; user: User; principal: { exp: number } }>("POST", "/me/session");
    store({ token: r.token, user: r.user, exp: r.principal.exp });
    const u = r.user;
    if (!before || before.player_no !== u.player_no || before.display_name !== u.display_name || before.avatar_hash !== u.avatar_hash) reconnect();
  } catch (e) {
    // La cuenta ya no existe o la sesión no vale: se sale.
    if (e instanceof ApiError && (e.code === "unauthorized" || e.code === "not_found")) store(null);
  }
}

/* --- Alta y acceso --- */

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

export async function register(displayName: string, ageConfirmed: boolean, acceptTerms: boolean) {
  const { flow_id, options } = await api<{ flow_id: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>(
    "POST",
    "/auth/passkey/register/options",
    { display_name: displayName, age_confirmed: ageConfirmed, accept_terms: acceptTerms ? TERMS_VERSION : null },
  );
  const response = await startRegistration({ optionsJSON: options });
  adopt(await api("POST", "/auth/passkey/register/verify", { flow_id, response }));
}

export async function login() {
  const { flow_id, options } = await api<{ flow_id: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>(
    "POST",
    "/auth/passkey/login/options",
    {},
  );
  const response = await startAuthentication({ optionsJSON: options });
  adopt(await api("POST", "/auth/passkey/login/verify", { flow_id, response }));
}

/* --- Entrar con Google (opcional) --- */

let methods: Promise<{ google: boolean }> | null = null;
/** ¿Está activado Entrar con Google en este servidor? */
export function authMethods() {
  methods ??= fetch(new URL("/auth/methods", REALTIME_URL))
    .then((r) => (r.ok ? (r.json() as Promise<{ google: boolean }>) : { google: false }))
    .catch(() => ({ google: false }));
  return methods;
}

/** Va a Google (la página se va y vuelve con ?google=<código>). Para darse de alta se mandan nombre, edad y condiciones. */
export function googleStart(mode: "login" | "register", reg?: { name: string; age: boolean; terms: boolean }) {
  const u = new URL("/auth/google/start", REALTIME_URL);
  u.searchParams.set("mode", mode);
  u.searchParams.set("origin", location.origin);
  if (reg) {
    u.searchParams.set("name", reg.name);
    if (reg.age) u.searchParams.set("age", "1");
    if (reg.terms) u.searchParams.set("terms", TERMS_VERSION);
  }
  location.assign(u.toString());
}

/** Vincula Google a la cuenta abierta (pide la URL con la sesión y va a Google). */
export async function googleLink() {
  const { url } = await api<{ url: string }>("POST", "/me/logins/google");
  location.assign(url);
}

export async function googleUnlink() {
  await api("DELETE", "/me/logins/google");
}

/**
 * Al volver de Google: cambia el código de un solo uso por la sesión y limpia la URL.
 * Devuelve el error (código) si lo hubo, para enseñarlo en Personalizar.
 */
export async function completeGoogleReturn(): Promise<{ error: string | null; linked: boolean; returned: boolean }> {
  const q = new URLSearchParams(location.search);
  const code = q.get("google");
  const error = q.get("auth_error");
  const linked = q.get("google_linked") === "1";
  if (!code && !error && !linked) return { error: null, linked: false, returned: false };
  history.replaceState(null, "", location.pathname + location.hash);
  if (code) {
    try {
      adopt(await api("POST", "/auth/google/finish", { code }));
    } catch (e) {
      return { error: (e as ApiError).code ?? "google_failed", linked: false, returned: true };
    }
  }
  return { error, linked, returned: true };
}

export interface Logins {
  passkeys: { created_at: number; last_used: number | null }[];
  google: { created_at: number; last_used: number | null } | null;
  google_available: boolean;
}
export async function myLogins(): Promise<Logins> {
  return api<Logins>("GET", "/me/logins");
}

/** Añade otra passkey a la cuenta abierta (otro dispositivo, o la primera si entraste con Google). */
export async function addPasskey() {
  const { flow_id, options } = await api<{ flow_id: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>(
    "POST",
    "/me/passkeys/options",
  );
  const response = await startRegistration({ optionsJSON: options });
  await api("POST", "/me/passkeys/verify", { flow_id, response });
}

export function logout() {
  store(null);
  reconnect();
}

export async function rename(name: string) {
  adopt(await api("PATCH", "/me", { display_name: name }));
}

/* --- Modelos (avatar y proyectos) --- */

export interface PreparedModel {
  bytes: Uint8Array;
  report: GlbReport;
  notes: string[];
  problems: BudgetProblem[];
}

/** Redimensiona una textura con canvas (en el navegador, sin servicios externos). */
async function resizeImage(data: Uint8Array, mime: string, max: number) {
  if (!/^image\/(png|jpeg|webp)$/.test(mime)) return null;
  const bitmap = await createImageBitmap(new Blob([data as Uint8Array<ArrayBuffer>], { type: mime }));
  const scale = max / Math.max(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const outMime = mime === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, outMime, 0.9));
  return blob ? { data: new Uint8Array(await blob.arrayBuffer()), mime: outMime } : null;
}

/** Lee, valida y optimiza en el propio navegador antes de subir. */
export async function prepareModel(file: File, kind: AssetKind): Promise<PreparedModel> {
  const input = new Uint8Array(await file.arrayBuffer());
  inspectGlb(input); // lanza GlbError con un motivo legible si el archivo no vale
  const { optimizeGlb } = await import("@xenxo/assets/optimize"); // carga diferida: solo quien sube paga su peso
  const { lods, notes } = await optimizeGlb(input, { kind, resizeImage });
  const best = lods[0]!;
  return { bytes: best.bytes, report: best.report, notes, problems: checkBudget(best.report, kind) };
}

export async function uploadModel(m: PreparedModel, kind: AssetKind) {
  return api<{ hash: string; triangles: number; format: "glb" | "vrm" }>(
    "POST",
    `/assets?kind=${kind}`,
    undefined,
    new Blob([m.bytes as Uint8Array<ArrayBuffer>], { type: "model/gltf-binary" }),
  );
}

/* --- Portadas --- */

export interface PreparedCover {
  blob: Blob;
  /** URL local para la vista previa (revócala al terminar). */
  preview: string;
}

/**
 * Recorta la imagen a 16:9 (por el centro), la deja en 1280×720 como mucho y la pasa a WebP
 * (o JPEG si el navegador no sabe hacer WebP), bajando la calidad hasta que quepa.
 */
export async function prepareCover(file: File): Promise<PreparedCover> {
  if (!/^image\//.test(file.type)) throw new ApiError("bad_image", "not an image");
  const bitmap = await createImageBitmap(file);
  const W = Math.min(1280, bitmap.width), H = Math.round((W * 9) / 16);
  const srcRatio = bitmap.width / bitmap.height;
  const sw = srcRatio > 16 / 9 ? bitmap.height * (16 / 9) : bitmap.width;
  const sh = srcRatio > 16 / 9 ? bitmap.height : bitmap.width / (16 / 9);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, W, H);
  bitmap.close();
  for (const q of [0.86, 0.76, 0.64, 0.5, 0.38]) {
    let blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", q));
    if (!blob || blob.type !== "image/webp") blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= COVER_BUDGET.maxBytes) return { blob, preview: URL.createObjectURL(blob) };
  }
  throw new ApiError("too_large", "cover too large");
}

export async function uploadCover(c: PreparedCover) {
  return api<{ hash: string }>("POST", "/assets?kind=cover", undefined, c.blob);
}

export async function setAvatar(hash: string | null) {
  adopt(await api("POST", "/me/avatar", { hash }));
}

/* --- Proyectos --- */

export async function listProjects(): Promise<Project[]> {
  return (await api<{ projects: Project[] }>("GET", "/projects")).projects;
}

export async function createProject(p: {
  title: string;
  summary: string;
  url: string;
  district: string;
  parcel: string;
  cover_hash: string;
  mesh_hash: string;
}) {
  return api<{ project: Project; stand: { ok: boolean; message?: string } }>("POST", "/projects", p);
}

export async function deleteProject(id: string) {
  await api("DELETE", `/projects/${id}`);
}

export async function myProjects(): Promise<Project[]> {
  return (await api<{ projects: Project[] }>("GET", "/me")).projects;
}

/* --- Denuncias (DSA) --- */

export const REPORT_REASONS = ["illegal", "hate", "harassment", "sexual", "minors", "violence", "spam", "ip", "other"] as const;

export async function report(targetType: "project" | "avatar" | "user" | "chat", targetId: string, reason: (typeof REPORT_REASONS)[number], details: string) {
  const token = accountToken() ?? (await guestToken());
  const res = await fetch(new URL("/reports", REALTIME_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target_type: targetType, target_id: targetId, reason, details }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(data.error ?? "unknown", data.message ?? "report failed");
  }
}

async function guestToken(): Promise<string> {
  const r = await fetch(new URL("/auth/guest", REALTIME_URL), { method: "POST" });
  return ((await r.json()) as { token: string }).token;
}

/* --- RGPD --- */

export async function exportData() {
  const data = await api<unknown>("GET", "/me/export");
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "xenxo-mis-datos.json" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function deleteAccount() {
  await api("DELETE", "/me");
  store(null);
  reconnect();
}
