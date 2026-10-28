/**
 * Distritos en otro servidor (docs/ALOJAMIENTO-DISTRITOS.md).
 *
 * Algunos distritos viven fuera de Cloudflare, en nodos (servidores de distritos registrados en
 * /mod/nodes, ver nodes.ts) que corren este mismo código con workerd (src/district-host.ts). Un nodo no
 * guarda ningún secreto de xenxo: solo la clave PÚBLICA Ed25519 con la que comprueba lo que firma
 * el Worker de Cloudflare con su clave privada (`DISTRICT_SIGNING_KEY`, un secreto de Wrangler):
 *
 *   - pases (`ticket`): quién es la persona o el agente y a qué chunk entra, válidos 60 s;
 *   - llamadas (`rpc`): lo que el Worker le pide al chunk (colocar un portal, expulsar, el chat de
 *     una denuncia…), atadas al chunk, al método y al hash del cuerpo, válidas 30 s.
 *
 * Formato: base64url(JSON) "." base64url(firma Ed25519 de la primera parte). Sin dependencias.
 *
 * Puede haber varios servidores (nodos, ver nodes.ts): todo lo firmado lleva `aud`, el id del nodo al
 * que va, y cada nodo solo acepta lo suyo. Así un nodo no puede reenviar a otro lo que recibe.
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
  // Cada firma lleva su `jti` (al azar): el servidor de distritos no acepta dos veces la misma llamada.
  const body = b64url(enc.encode(JSON.stringify({ jti: b64url(crypto.getRandomValues(new Uint8Array(12))), ...payload })));
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
  /** Nodo al que va (su id en el registro): otro nodo no lo acepta. */
  aud?: string;
}

/** Llamada firmada del Worker a un chunk de otro servidor. */
export interface RemoteCall {
  typ: "rpc";
  chunk: string;
  method: string;
  body: string; // sha256 (base64url) del cuerpo
  exp: number;
  /** Id de un solo uso (lo pone signRemote): una llamada repetida se rechaza. */
  jti?: string;
  /** Nodo al que va: una llamada copiada de un nodo no vale en otro. */
  aud?: string;
}

/**
 * Llamadas ya atendidas (por su `jti`, o por la firma entera si no lo trae), hasta que caducan: una
 * llamada copiada no se puede repetir dentro de sus 30 s. En memoria del servidor de distritos.
 */
export class SeenCalls {
  private seen = new Map<string, number>();
  constructor(private max = 10_000) {}
  /** true si es nueva (y la apunta); false si ya se vio o no cabe más. */
  claim(id: string, exp: number, now = Date.now()): boolean {
    // Por orden de llegada: las primeras son las que antes caducan (casi siempre).
    for (const [k, e] of this.seen) {
      if (e >= now) break;
      this.seen.delete(k);
    }
    if (this.seen.has(id) || this.seen.size >= this.max) return false;
    this.seen.set(id, exp);
    return true;
  }
}

export const TICKET_TTL_MS = 60_000;
export const CALL_TTL_MS = 30_000;

/** Lista de chunks de una variable ("c_1_0,c_-1_0"); vacía = ninguno; «*» = todos. */
export function chunkList(v: string | undefined): { has(id: string): boolean } {
  const items = (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (items.includes("*")) return { has: () => true };
  const exact = new Set(items.filter((s) => !s.endsWith("*")));
  // «c_1000_*»: todos los que empiezan así (los distritos de la comunidad, por ejemplo).
  const prefixes = items.filter((s) => s.endsWith("*")).map((s) => s.slice(0, -1));
  return { has: (id: string) => exact.has(id) || prefixes.some((p) => p.length > 0 && id.startsWith(p)) };
}

/** Métodos del chunk que el Worker puede llamar en otro servidor (y nada más). */
export const REMOTE_METHODS = new Set(["stateRev", "placeStand", "removeStand", "purgeOwner", "kick", "chatMessage", "chatOf", "hideChat", "dumpState", "loadState", "installDistrict", "activityOf", "syncCabinets", "syncBillboards", "clearSandbox", "boardsOf"]);
