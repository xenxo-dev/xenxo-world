/**
 * «Entrar con xenxo»: piezas puras del proveedor OpenID Connect (sin estado). El estado (claves,
 * juegos, permisos, códigos) vive en el Directory; las rutas, en index.ts.
 *
 * Reglas de seguridad que se cumplen aquí y en el Directory:
 *  - Solo clientes públicos (juegos web): PKCE S256 obligatorio, nada de `plain` ni de secretos.
 *  - `redirect_uri` exacta a una de las registradas: https (o http a localhost para desarrollo),
 *    sin fragmento ni credenciales. Un error antes de validarla nunca redirige.
 *  - Códigos de un solo uso, 60 s, atados a juego, redirect y reto PKCE.
 *  - Tokens de identidad firmados con Ed25519 (EdDSA); la clave privada no sale del Directory.
 *  - `sub` distinto en cada juego (HMAC con un secreto del Directory): dos juegos no cruzan datos
 *    por el identificador. El número de jugador solo va si la persona lo aprueba.
 */

export const OIDC_SCOPES = ["openid", "profile", "player", "avatar"] as const;
export type OidcScope = (typeof OIDC_SCOPES)[number];

export const CODE_TTL_MS = 60_000;
export const REQUEST_TTL_MS = 10 * 60_000;
export const ID_TOKEN_TTL_S = 3600;
export const ACCESS_TOKEN_TTL_MS = 3600_000;
export const MAX_CLIENTS_PER_USER = 3;
export const MAX_REDIRECTS = 5;

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlJson(v: unknown): string {
  return b64url(enc.encode(JSON.stringify(v)));
}

export async function sha256b64url(text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

/** Ámbitos pedidos: separados por espacios, todos conocidos, sin repetir y con `openid`. */
export function parseScopes(raw: unknown): OidcScope[] | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  const list = [...new Set(raw.split(" ").filter(Boolean))];
  if (!list.includes("openid")) return null;
  if (list.some((s) => !(OIDC_SCOPES as readonly string[]).includes(s))) return null;
  return OIDC_SCOPES.filter((s) => list.includes(s));
}

/** Una dirección de vuelta aceptable para registrar: https, o http a localhost para probar en local. */
export function validRedirectUri(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.hash || u.username || u.password) return null;
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  // Se guarda tal cual la escribió (la comparación es exacta, carácter a carácter).
  return raw;
}

/** Verificador PKCE: 43–128 caracteres de [A-Za-z0-9-._~] (RFC 7636). */
export function validVerifier(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
}

/** Reto PKCE S256: 43 caracteres base64url. */
export function validChallenge(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}

export function validState(v: unknown): v is string | undefined {
  return v === undefined || v === null || v === "" || (typeof v === "string" && v.length <= 500 && !/[\u0000-\u001f]/.test(v));
}

export function validNonce(v: unknown): v is string | undefined {
  return v === undefined || v === null || v === "" || (typeof v === "string" && v.length <= 200 && !/[\u0000-\u001f]/.test(v));
}

/** Nombre de un juego: 2–40 caracteres, sin controles. */
export function validClientName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 40 && !/[\u0000-\u001f<>]/.test(name) ? name : null;
}

/** Firma un JWT compacto con EdDSA (Ed25519). */
export async function signJwt(key: CryptoKey, kid: string, payload: Record<string, unknown>, typ = "JWT"): Promise<string> {
  const head = b64urlJson({ alg: "EdDSA", typ, kid });
  const body = b64urlJson(payload);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

/** Dirección de vuelta con los parámetros añadidos (sin perder los que ya tuviera). */
export function withParams(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, v);
  return u.toString();
}
