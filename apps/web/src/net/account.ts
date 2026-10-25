/**
 * Cuenta de la persona: alta y acceso con passkey (sin email ni contraseña),
 * subida de avatar y proyectos, exportación y borrado de datos (RGPD).
 */
import { useSyncExternalStore } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { checkBudget, inspectGlb, type AssetKind, type BudgetProblem, type GlbReport } from "@xenxo/assets";
import { REALTIME_URL, loadPref, savePref } from "../config";
import { reconnect } from "./session";

export const TERMS_VERSION = "2026-10";

export interface User {
  id: string;
  display_name: string;
  avatar_hash: string | null;
  avatar_format: "glb" | "vrm" | null;
  created_at: number;
}

export interface Project {
  id: string;
  title: string;
  summary: string;
  url: string | null;
  mesh_hash: string | null;
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
  if (raw) headers["Content-Type"] = "model/gltf-binary";
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

export async function setAvatar(hash: string | null) {
  adopt(await api("POST", "/me/avatar", { hash }));
}

/* --- Proyectos --- */

export async function listProjects(): Promise<Project[]> {
  return (await api<{ projects: Project[] }>("GET", "/projects")).projects;
}

export async function createProject(p: { title: string; summary: string; url: string; mesh_hash: string | null }) {
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

export async function report(targetType: "project" | "avatar" | "user", targetId: string, reason: (typeof REPORT_REASONS)[number], details: string) {
  const token = accountToken() ?? (await guestToken());
  const res = await fetch(new URL("/reports", REALTIME_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target_type: targetType, target_id: targetId, reason, details }),
  });
  if (!res.ok) throw new ApiError("report_failed", "no se pudo enviar la denuncia");
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
