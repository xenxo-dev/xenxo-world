/**
 * Distritos en otro servidor (docs/ALOJAMIENTO-DISTRITOS.md).
 *
 * Algunos chunks (los de `REMOTE_CHUNKS`) viven fuera de Cloudflare, en un servidor de distritos
 * (`DISTRICT_HOST`) que corre este mismo código con workerd (src/district-host.ts). Ese servidor no
 * guarda ningún secreto de xenxo: solo la clave PÚBLICA Ed25519 con la que comprueba lo que firma
 * el Worker de Cloudflare con su clave privada (`DISTRICT_SIGNING_KEY`, un secreto de Wrangler):
 *
 *   - pases (`ticket`): quién es la persona o el agente y a qué chunk entra, válidos 60 s;
 *   - llamadas (`rpc`): lo que el Worker le pide al chunk (colocar un portal, expulsar, el chat de
 *     una denuncia…), atadas al chunk, al método y al hash del cuerpo, válidas 30 s.
 *
 * Formato: base64url(JSON) "." base64url(firma Ed25519 de la primera parte). Sin dependencias.
 */
import type { Principal } from "./auth";

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export async function sha256B64(data: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(data))));
}

const keys = new Map<string, Promise<CryptoKey>>();
function importKey(jwk: string, use: "sign" | "verify"): Promise<CryptoKey> {
  const id = `${use}:${jwk}`;
  let k = keys.get(id);
  if (!k) {
    // Solo lo esencial del JWK: cada motor (Node, workerd) entiende distinto `alg`, `key_ops` y `ext`.
    const { kty, crv, x, d } = JSON.parse(jwk) as JsonWebKey;
    const clean: JsonWebKey = use === "sign" ? { kty, crv, x, d } : { kty, crv, x };
    k = crypto.subtle.importKey("jwk", clean, { name: "Ed25519" }, false, [use]) as Promise<CryptoKey>;
    keys.set(id, k);
  }
  return k;
}

export async function signRemote(privateJwk: string, payload: Record<string, unknown>): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, await importKey(privateJwk, "sign"), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifyRemote<T extends { exp: number }>(publicJwk: string, token: string): Promise<T | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, await importKey(publicJwk, "verify"), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T;
    if (typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

/** Pase para entrar en un chunk de otro servidor. */
export interface Ticket {
  typ: "ticket";
  chunk: string;
  principal: Principal;
  exp: number;
}

/** Llamada firmada del Worker a un chunk de otro servidor. */
export interface RemoteCall {
  typ: "rpc";
  chunk: string;
  method: string;
  body: string; // sha256 (base64url) del cuerpo
  exp: number;
}

export const TICKET_TTL_MS = 60_000;
export const CALL_TTL_MS = 30_000;

/** Lista de chunks de una variable ("c_1_0,c_-1_0"); vacía = ninguno. */
export function chunkList(v: string | undefined): { has(id: string): boolean } {
  const items = (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const exact = new Set(items.filter((s) => !s.endsWith("*")));
  // «c_1000_*»: todos los que empiezan así (los distritos de la comunidad, por ejemplo).
  const prefixes = items.filter((s) => s.endsWith("*")).map((s) => s.slice(0, -1));
  return { has: (id: string) => exact.has(id) || prefixes.some((p) => p.length > 0 && id.startsWith(p)) };
}

/** Métodos del chunk que el Worker puede llamar en otro servidor (y nada más). */
export const REMOTE_METHODS = new Set(["placeStand", "removeStand", "purgeOwner", "kick", "chatMessage", "chatOf", "hideChat", "dumpState", "loadState", "installDistrict", "activityOf", "syncCabinets", "clearSandbox", "boardsOf"]);
