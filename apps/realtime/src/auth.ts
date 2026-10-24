/**
 * Tokens de sesión de vida corta, firmados con HMAC-SHA256 (WebCrypto, sin dependencias).
 *
 * Flujo:
 *   - Invitados:  POST /auth/guest                        → token de 1 h, sin permisos de construcción.
 *   - Agentes:    POST /auth/agent  (Authorization: Bearer <clave del agente>) → token de 15 min.
 * La clave larga del agente nunca viaja por el WebSocket; solo el token corto.
 */

export type PrincipalKind = "guest" | "user" | "agent";

export interface Principal {
  sub: string;
  kind: PrincipalKind;
  scopes: string[];
  exp: number; // epoch ms
}

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

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signToken(p: Principal, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(p)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifyToken(token: string, secret: string): Promise<Principal | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Principal;
    if (typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** AGENT_KEYS = "id:sha256hex[:scope1|scope2],id2:..." */
export async function resolveAgent(
  presentedKey: string,
  agentKeys: string | undefined,
): Promise<{ id: string; scopes: string[] } | null> {
  if (!agentKeys || presentedKey.length < 16) return null;
  const hash = await sha256Hex(presentedKey);
  for (const entry of agentKeys.split(",")) {
    const [id, h, scopes] = entry.trim().split(":");
    if (id && h && timingSafeEqual(h.toLowerCase(), hash)) {
      return { id, scopes: scopes ? scopes.split("|") : ["build"] };
    }
  }
  return null;
}

export function randomId(prefix: string, bytes = 9): string {
  return prefix + b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
