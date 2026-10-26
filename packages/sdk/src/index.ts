/**
 * @xenxo/sdk — «Entrar con xenxo» para tu juego web, sin dependencias.
 *
 *   import { xenxo } from "https://xenxo.io/sdk/xenxo.mjs";
 *   const jugador = await xenxo.connect({ clientId: "xg_…", redirectUri: location.origin + "/" });
 *   if (!jugador) boton.onclick = () => xenxo.login();
 *
 * En tu equipo (localhost, sin clientId) arranca el simulador: un jugador de prueba sin cuenta ni
 * conexión con xenxo, y un panel para cambiar entre jugador, invitado y sin sesión.
 *
 * Lo que hace por ti: OpenID Connect con PKCE (S256), `state` y `nonce`; comprueba la firma Ed25519
 * del id_token con la clave pública de xenxo (y su emisor, destinatario, caducidad y nonce), y te
 * da el jugador: id propio de tu juego, nombre, número y personaje (VRM). Nada se guarda fuera de
 * `sessionStorage` de tu página, y se borra al cerrar la pestaña.
 */

export interface XenxoOptions {
  /** El `xg_…` que te da xenxo al registrar el juego. Sin él, en localhost, se usa el simulador. */
  clientId?: string;
  /** Dirección de vuelta registrada en xenxo (exacta). Por defecto, esta página sin `?…` ni `#…`. */
  redirectUri?: string;
  /** Además de "openid": "profile" (nombre), "player" (número), "avatar" (personaje). */
  scopes?: ("profile" | "player" | "avatar")[];
  /** Servidor de identidad. Por defecto, https://api.xenxo.io. */
  issuer?: string;
  /** Tu proyecto en xenxo (`id` de su ficha): `xenxo.back()` vuelve delante de su portal. */
  project?: string;
  /** Simulador local. Por defecto, solo en localhost y sin `clientId`. */
  simulate?: boolean;
  /** La web de xenxo a la que se vuelve. Por defecto, https://xenxo.io. */
  home?: string;
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
  /** Invitado de xenxo: tiene nombre pero no cuenta (sin número; su id cambia entre visitas). */
  guest?: boolean;
  /** Jugador del simulador local: no es una persona de verdad. */
  simulated?: boolean;
}

type Resolved = XenxoOptions & { clientId: string; redirectUri: string };

const KEY = "xenxo:sdk";
let opts: Resolved | null = null;
let lastError: string | null = null;
let simulating = false;
/** La web de xenxo que tiene abierto el juego dentro (iframe), si contestó al saludo. */
let parentOrigin: string | null = null;
let welcome: { lang?: string; account: boolean; guest: { name: string } | null } | null = null;

/** Un personaje de serie de xenxo (Alba, CC0) para el jugador de prueba del simulador. */
const SIM_AVATAR = "927ec08956aae9186f4b0585645d2124d3586ab9f05ed0bf63848e439a0e2cf4";
type SimMode = "player" | "guest" | "none";

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

function issuerOf(o: Pick<XenxoOptions, "issuer">) {
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

async function finish(o: Resolved, code: string, state: string): Promise<XenxoPlayer> {
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

function isLocal(): boolean {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");
}

function homeOf(o: XenxoOptions | null): string {
  return (o?.home ?? "https://xenxo.io").replace(/\/+$/, "");
}

function simPlayer(mode: SimMode, o: XenxoOptions): XenxoPlayer | null {
  if (mode === "none") return null;
  const avatar = { url: `${issuerOf(o)}/assets/${SIM_AVATAR}`, format: "vrm" as const, hash: `sha256:${SIM_AVATAR}` };
  const base = { idToken: "", expiresAt: Date.now() + 3600_000, signatureChecked: false, simulated: true, avatar };
  return mode === "guest"
    ? { ...base, id: "sim_invitado", name: "Invitado-4821", playerNo: null, guest: true }
    : { ...base, id: "sim_jugador", name: "Jugador de prueba", playerNo: 9999 };
}

/** Aviso pequeño del simulador (sin estilos del juego: va en su propia sombra). */
function toast(text: string) {
  const el = document.createElement("div");
  el.textContent = text;
  el.setAttribute("style", "position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:2147483647;background:#12142b;color:#f6f1e7;border:1px solid #4fa3ff;border-radius:10px;padding:8px 12px;font:13px system-ui,sans-serif;max-width:90vw");
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

/** Panel del simulador: elegir jugador de prueba, invitado o sin sesión (recarga la página). */
function simPanel(mode: SimMode) {
  if (document.getElementById("xenxo-sim")) return;
  const host = document.createElement("div");
  host.id = "xenxo-sim";
  host.setAttribute("style", "position:fixed;left:12px;bottom:12px;z-index:2147483647");
  const root = host.attachShadow({ mode: "open" });
  const opt = (m: SimMode, label: string) =>
    `<button data-m="${m}" aria-pressed="${m === mode}">${label}</button>`;
  root.innerHTML = `<style>
    .p{font:12px system-ui,sans-serif;color:#f6f1e7;background:rgba(18,20,43,.92);border:1px solid rgba(246,241,231,.15);border-radius:12px;padding:8px 10px;box-shadow:0 4px 20px rgba(0,0,0,.4)}
    b{color:#9cc9ff;font-weight:600}
    .r{display:flex;gap:4px;margin-top:6px}
    button{font:inherit;color:rgba(246,241,231,.7);background:none;border:1px solid rgba(246,241,231,.15);border-radius:8px;padding:3px 8px;cursor:pointer}
    button[aria-pressed=true]{background:#4fa3ff;color:#12142b;border-color:#4fa3ff}
    small{display:block;margin-top:6px;color:rgba(246,241,231,.45)}
  </style><div class="p"><b>xenxo</b> · simulador<div class="r">${opt("player", "Jugador")}${opt("guest", "Invitado")}${opt("none", "Sin sesión")}</div><small>Solo en tu equipo. En tu web se entra con xenxo.</small></div>`;
  root.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
    b.addEventListener("click", () => {
      store("sim", b.dataset.m);
      location.reload();
    }),
  );
  document.body.append(host);
}

/**
 * ¿Quién podría ser xenxo alrededor? Su web (www incluida, o, para desarrollar, un xenxo en
 * localhost que lo diga con ?xenxo_origin=). Solo se habla con ese origen y solo se escucha a ese origen.
 */
function parentCandidate(o: XenxoOptions): string | null {
  if (window.parent === window) return null;
  const home = new URL(homeOf(o)).origin;
  const q = new URLSearchParams(location.search).get("xenxo_origin");
  if (q && q !== home && (q === "https://www.xenxo.io" || /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(q))) return q;
  return home;
}

/** Saludo al xenxo de alrededor: si contesta, el juego está dentro de xenxo. */
function greet(origin: string): Promise<typeof welcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      removeEventListener("message", on);
      resolve(null);
    }, 1500);
    function on(e: MessageEvent) {
      if (e.source !== window.parent || e.origin !== origin) return;
      const d = e.data as { type?: string; lang?: unknown; account?: unknown; guest?: { name?: unknown } | null } | null;
      if (!d || d.type !== "xenxo:welcome") return;
      clearTimeout(timer);
      removeEventListener("message", on);
      resolve({
        lang: typeof d.lang === "string" && /^[a-z]{2}$/.test(d.lang) ? d.lang : undefined,
        account: d.account === true,
        guest: d.guest && typeof d.guest.name === "string" ? { name: d.guest.name.slice(0, 32) } : null,
      });
    }
    addEventListener("message", on);
    window.parent.postMessage({ type: "xenxo:hello", v: 0 }, origin);
  });
}

/** Un invitado de xenxo (solo su nombre visible; el id vale para esta pestaña). */
function guestPlayer(name: string): XenxoPlayer {
  let id = read<string>("guest");
  if (!id) store("guest", (id = `guest_${random(9)}`));
  return { id, name, playerNo: null, avatar: null, idToken: "", expiresAt: Date.now() + 3600_000, signatureChecked: false, guest: true };
}

export const xenxo = {
  /**
   * Prepara el SDK y devuelve el jugador si ya entró (o si vuelve ahora de xenxo con su permiso).
   * Si vuelve sin permiso, devuelve null y `xenxo.error` dice por qué.
   */
  async connect(options: XenxoOptions = {}): Promise<XenxoPlayer | null> {
    lastError = null;
    const project = options.project && /^[A-Za-z0-9_-]{4,40}$/.test(options.project) ? options.project : undefined;
    simulating = options.simulate ?? (isLocal() && !options.clientId);
    const o: Resolved = {
      ...options,
      project,
      clientId: options.clientId ?? "",
      redirectUri: options.redirectUri ?? `${location.origin}${location.pathname}`,
    };
    opts = o;
    if (simulating) {
      const mode = read<SimMode>("sim") ?? "player";
      if (document.body) simPanel(mode);
      else addEventListener("DOMContentLoaded", () => simPanel(mode), { once: true });
      return simPlayer(mode, o);
    }
    if (!o.clientId) throw new Error("falta clientId: regístralo en xenxo.io → Proyectos (en localhost, sin él, se usa el simulador)");
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
    // ¿Dentro de xenxo? Entonces se habla con xenxo por postMessage (sin salir del juego).
    const candidate = parentCandidate(o);
    if (candidate) {
      welcome = await greet(candidate);
      parentOrigin = welcome ? candidate : null;
      // Un xenxo de desarrollo (localhost) usa su servidor local de identidad, salvo que digas otro.
      if (parentOrigin?.startsWith("http://") && !options.issuer) o.issuer = "http://localhost:8787";
    }
    const saved = read<XenxoPlayer>("player");
    if (saved && saved.expiresAt > Date.now()) return saved;
    if (welcome?.guest) return guestPlayer(welcome.guest.name);
    return null;
  },

  /** Lleva a la persona a xenxo para que dé permiso (vuelve a `redirectUri`). */
  async login(prompt?: "consent"): Promise<void> {
    if (!opts) throw new Error("llama antes a xenxo.connect()");
    if (simulating) {
      store("sim", "player");
      return location.reload();
    }
    const verifier = random(48);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const pending = { state: random(16), nonce: random(16), verifier };
    store("pending", pending);
    const params: Record<string, string> = {
      response_type: "code",
      client_id: opts.clientId,
      redirect_uri: opts.redirectUri,
      scope: ["openid", ...(opts.scopes ?? ["profile", "player", "avatar"])].join(" "),
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...(prompt ? { prompt } : {}),
    };
    if (parentOrigin) {
      // Dentro de xenxo: xenxo enseña el permiso encima del juego y devuelve el código por postMessage.
      const from = parentOrigin;
      const res = await new Promise<Record<string, unknown>>((resolve) => {
        function on(e: MessageEvent) {
          if (e.source !== window.parent || e.origin !== from) return;
          const d = e.data as { type?: string; params?: unknown } | null;
          if (!d || d.type !== "xenxo:authorization" || !d.params || typeof d.params !== "object") return;
          removeEventListener("message", on);
          resolve(d.params as Record<string, unknown>);
        }
        addEventListener("message", on);
        window.parent.postMessage({ type: "xenxo:login", params }, from);
      });
      const str = (k: string) => (typeof res[k] === "string" ? (res[k] as string) : null);
      if (str("error")) {
        store("pending", null);
        lastError = str("error");
        return;
      }
      if (str("iss") !== issuerOf(opts) || !str("code") || !str("state")) {
        store("pending", null);
        lastError = "la respuesta no viene de xenxo";
        return;
      }
      try {
        store("player", await finish(opts, str("code")!, str("state")!));
        location.reload();
      } catch (e) {
        lastError = (e as Error).message;
      }
      return;
    }
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
    if (simulating) store("sim", "none");
  },

  /**
   * Vuelve a xenxo, delante del portal de tu proyecto (si diste `project`). Si xenxo abrió el juego
   * dentro de su página, se lo pide a xenxo; si no, navega. En el simulador solo lo enseña.
   */
  back() {
    const home = homeOf(opts);
    const url = opts?.project ? `${home}/?volver=${encodeURIComponent(opts.project)}` : `${home}/`;
    if (simulating) return toast(`xenxo.back() → ${url}`);
    if (parentOrigin) {
      window.parent.postMessage({ type: "xenxo:back", project: opts?.project ?? null }, parentOrigin);
      return;
    }
    location.assign(url);
  },

  /** ¿Está el juego abierto dentro de xenxo? (tras `connect()`) */
  get embedded() {
    return parentOrigin !== null;
  },

  /** Dentro de xenxo: ¿tiene la persona cuenta en xenxo? (si no, es invitada). */
  get hasXenxoAccount() {
    return welcome?.account ?? false;
  },

  /** ¿Es el simulador local? */
  get simulated() {
    return simulating;
  },

  /** Idioma de la persona: el que diga xenxo al abrir el juego (`?xenxo_lang=`) o el del navegador. */
  get lang(): string {
    if (welcome?.lang) return welcome.lang;
    const q = new URLSearchParams(location.search).get("xenxo_lang");
    return (q && /^[a-z]{2}$/.test(q) ? q : navigator.language.slice(0, 2).toLowerCase()) || "es";
  },

  /** Último error al volver de xenxo ("access_denied" si dijo que no), o null. */
  get error() {
    return lastError;
  },
};

export default xenxo;
