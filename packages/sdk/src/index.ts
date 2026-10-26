/**
 * @xenxo/sdk — «Entrar con xenxo» para tu juego web, sin dependencias.
 *
 *   import { xenxo } from "https://xenxo.io/sdk/xenxo.mjs";
 *   const jugador = await xenxo.connect({ clientId: "xg_…", redirectUri: location.origin + "/" });
 *   if (!jugador) boton.onclick = () => xenxo.login();
 *
 * Lo que hace por ti: OpenID Connect con PKCE (S256), `state` y `nonce`; comprueba la firma Ed25519
 * del id_token con la clave pública de xenxo (y su emisor, destinatario, caducidad y nonce), y te
 * da el jugador: id propio de tu juego, nombre, número y personaje (VRM). Nada se guarda fuera de
 * `sessionStorage` de tu página, y se borra al cerrar la pestaña.
 */

export interface XenxoOptions {
  clientId: string;
  /** Dirección de vuelta registrada en xenxo (exacta). */
  redirectUri: string;
  /** Además de "openid": "profile" (nombre), "player" (número), "avatar" (personaje). */
  scopes?: ("profile" | "player" | "avatar")[];
  /** Servidor de identidad. Por defecto, https://api.xenxo.io. */
  issuer?: string;
}

export interface XenxoPlayer {
  /** Identificador de la persona SOLO para tu juego (en otro juego es otro). */
  id: string;
  name?: string;
  playerNo?: number | null;
  avatar?: { url: string; format: "vrm" | "glb"; hash: string } | null;
  /** El id_token tal cual, por si tu servidor quiere comprobarlo (con /.well-known/jwks.json). */
  idToken: string;
  /** Hasta cuándo vale (ms desde 1970). */
  expiresAt: number;
  /** ¿Se comprobó la firma en este navegador? (los muy antiguos no tienen Ed25519 en WebCrypto). */
  signatureChecked: boolean;
}

const KEY = "xenxo:sdk";
let opts: XenxoOptions | null = null;
let lastError: string | null = null;

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

function store(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(`${KEY}:${key}`);
    else sessionStorage.setItem(`${KEY}:${key}`, JSON.stringify(value));
  } catch {
    /* modo privado: se vive sin recordar */
  }
}
function read<T>(key: string): T | null {
  try {
    const v = sessionStorage.getItem(`${KEY}:${key}`);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function issuerOf(o: XenxoOptions) {
  return (o.issuer ?? "https://api.xenxo.io").replace(/\/+$/, "");
}

/** Comprueba la firma EdDSA con las claves públicas de xenxo. null = este navegador no sabe Ed25519. */
async function verifySignature(idToken: string, issuer: string): Promise<boolean | null> {
  const [h, p, s] = idToken.split(".");
  if (!h || !p || !s) return false;
  const header = JSON.parse(new TextDecoder().decode(fromB64url(h))) as { alg?: string; kid?: string };
  if (header.alg !== "EdDSA") return false;
  const jwks = (await (await fetch(`${issuer}/.well-known/jwks.json`)).json()) as { keys: (JsonWebKey & { kid: string })[] };
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) return false;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, { name: "Ed25519" }, false, ["verify"]);
  } catch {
    return null;
  }
  return crypto.subtle.verify({ name: "Ed25519" }, key, fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
}

async function finish(o: XenxoOptions, code: string, state: string): Promise<XenxoPlayer> {
  const pending = read<{ state: string; nonce: string; verifier: string }>("pending");
  store("pending", null);
  if (!pending || pending.state !== state) throw new Error("state no coincide: inicia sesión otra vez");
  const issuer = issuerOf(o);
  const res = await fetch(`${issuer}/oidc/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: o.redirectUri, client_id: o.clientId, code_verifier: pending.verifier }),
  });
  const tok = (await res.json()) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !tok.id_token) throw new Error(tok.error_description ?? tok.error ?? `token: HTTP ${res.status}`);
  const signed = await verifySignature(tok.id_token, issuer);
  if (signed === false) throw new Error("la firma del id_token no es válida");
  const c = JSON.parse(new TextDecoder().decode(fromB64url(tok.id_token.split(".")[1]!))) as Record<string, unknown>;
  const now = Date.now() / 1000;
  if (c.iss !== issuer || c.aud !== o.clientId || typeof c.exp !== "number" || c.exp < now || c.nonce !== pending.nonce) {
    throw new Error("el id_token no es para este juego o ya caducó");
  }
  return {
    id: String(c.sub),
    ...(c.name !== undefined ? { name: String(c.name) } : {}),
    ...(c.player_no !== undefined ? { playerNo: c.player_no as number | null } : {}),
    ...(c.avatar !== undefined ? { avatar: c.avatar as XenxoPlayer["avatar"] } : {}),
    idToken: tok.id_token,
    expiresAt: (c.exp as number) * 1000,
    signatureChecked: signed === true,
  };
}

export const xenxo = {
  /**
   * Prepara el SDK y devuelve el jugador si ya entró (o si vuelve ahora de xenxo con su permiso).
   * Si vuelve sin permiso, devuelve null y `xenxo.error` dice por qué.
   */
  async connect(o: XenxoOptions): Promise<XenxoPlayer | null> {
    opts = o;
    lastError = null;
    const u = new URL(location.href);
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    const err = u.searchParams.get("error");
    const iss = u.searchParams.get("iss");
    if (code || err) {
      for (const k of ["code", "state", "error", "error_description", "iss"]) u.searchParams.delete(k);
      history.replaceState(history.state, "", u.toString());
    }
    if (err) {
      store("pending", null);
      lastError = err;
      return null;
    }
    if (code && state) {
      // RFC 9207: la respuesta dice quién la emite; si no es xenxo, no se sigue.
      if (iss && iss !== issuerOf(o)) {
        store("pending", null);
        lastError = "la respuesta no viene de xenxo";
        return null;
      }
      try {
        const player = await finish(o, code, state);
        store("player", player);
        return player;
      } catch (e) {
        lastError = (e as Error).message;
        return null;
      }
    }
    const saved = read<XenxoPlayer>("player");
    return saved && saved.expiresAt > Date.now() ? saved : null;
  },

  /** Lleva a la persona a xenxo para que dé permiso (vuelve a `redirectUri`). */
  async login(prompt?: "consent" | "login"): Promise<void> {
    if (!opts) throw new Error("llama antes a xenxo.connect()");
    const verifier = random(48);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const pending = { state: random(16), nonce: random(16), verifier };
    store("pending", pending);
    const q = new URLSearchParams({
      response_type: "code",
      client_id: opts.clientId,
      redirect_uri: opts.redirectUri,
      scope: ["openid", ...(opts.scopes ?? ["profile", "player", "avatar"])].join(" "),
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...(prompt ? { prompt } : {}),
    });
    location.assign(`${issuerOf(opts)}/oidc/authorize?${q}`);
  },

  /** Olvida al jugador en esta página (no toca su permiso: eso se retira en xenxo). */
  logout() {
    store("player", null);
    store("pending", null);
  },

  /** Último error al volver de xenxo ("access_denied" si dijo que no), o null. */
  get error() {
    return lastError;
  },
};

export default xenxo;
