import { ASSET_BUDGETS } from "@xenxo/assets";
import { checkDistrict, ChunkId, describeDistrictProblem, DistrictSubmission, PARCEL_BUDGETS, PLACES } from "@xenxo/protocol";
import { communityContent, communitySystem, isCommunityChunk, submissionFiles, type ModelInfo } from "./community";
import { SEED_ASSETS } from "./seed-assets";
import { assetMeta, assetKey, forgetAssets, handleGet, handleUpload } from "./assets";
import { isAvatarPreset } from "./avatar-presets-check";
import { randomId, resolveAgent, signToken, verifyToken, type Principal } from "./auth";
import { CALL_TTL_MS, chunkList, REMOTE_METHODS, sha256B64, signRemote, TICKET_TTL_MS } from "./remote";
import type { ChunkRoom, ShowcaseItem } from "./chunk-room";
import { DISTRICTS, districtById, parcelIndex, parcelSpawn } from "./districts";
import { communityGates, SHOWCASE_SLOTS, type CommunityGate } from "./nexo";
import { fetchDevManifest, fetchManifest } from "./games";
import { MAX_AGENT_KEYS_PER_PROJECT, MAX_SKINS, type Directory, type UserRow } from "./directory";

export { ChunkRoom } from "./chunk-room";
export { Directory } from "./directory";

export interface Env {
  CHUNK: DurableObjectNamespace<ChunkRoom>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  ASSETS: R2Bucket;
  /** Recursos estáticos: modelos de la plaza generados por la forja (por hash). */
  STATIC?: Fetcher;
  TOKEN_SECRET: string;
  AGENT_KEYS?: string;
  ALLOWED_ORIGINS?: string;
  /** Dominio de las passkeys (p. ej. "xenxo.io"; "localhost" en desarrollo). */
  RP_ID?: string;
  /** "eu" para que los datos se guarden y procesen solo en la UE. Vacío = sin restricción. */
  DO_JURISDICTION?: string;
  /** Id de la cuenta del fundador (sin "usr_"): es el jugador número 0. */
  FOUNDER_USER_ID?: string;
  /** Cuenta de GitHub cuyos repos públicos muestra el panel. */
  GITHUB_OWNER?: string;
  /** Entrar con Google (opcional): cliente OAuth web. El secreto va en un secreto, nunca en el código. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * Distritos en otro servidor (docs/ALOJAMIENTO-DISTRITOS.md): su URL (https://…), qué chunks
   * viven allí (separados por comas) y la clave privada Ed25519 (JWK, un secreto) con la que se
   * firman los pases y las llamadas. Sin DISTRICT_HOST, todo vive en Cloudflare como siempre.
   */
  DISTRICT_HOST?: string;
  REMOTE_CHUNKS?: string;
  DISTRICT_SIGNING_KEY?: string;
}

/* ------------------------------------------------------------------ */
/* Entrar con Google (OpenID Connect, flujo de código + PKCE)           */
/* ------------------------------------------------------------------ */

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

function googleEnabled(env: Env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** Origen de la web al que volver: solo uno de los permitidos (nada de redirecciones abiertas). */
function webOrigin(env: Env, wanted: string | null): string {
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (wanted && allowed.includes(wanted)) return wanted;
  return allowed.find((o) => o.startsWith("https://")) ?? allowed[0] ?? "https://xenxo.io";
}

function back(origin: string, params: Record<string, string>) {
  const u = new URL("/", origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: u.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

function googleUrl(env: Env, req: Request, start: { state: string; nonce: string; code_challenge: string }) {
  const u = new URL(GOOGLE_AUTH);
  u.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  u.searchParams.set("redirect_uri", new URL("/auth/google/callback", req.url).toString());
  u.searchParams.set("response_type", "code");
  // Solo "openid": Google nos da un identificador de la cuenta y nada más (ni email ni nombre).
  u.searchParams.set("scope", "openid");
  u.searchParams.set("state", start.state);
  u.searchParams.set("nonce", start.nonce);
  u.searchParams.set("code_challenge", start.code_challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

/**
 * Cambia el código de Google por su id_token y devuelve el identificador de la cuenta.
 * El token llega directamente de Google por TLS, así que (OpenID Connect §3.1.3.7) basta con
 * comprobar emisor, audiencia, caducidad y nonce.
 */
async function googleSubject(env: Env, req: Request, code: string, verifier: string, nonce: string): Promise<string | null> {
  const r = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: new URL("/auth/google/callback", req.url).toString(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!r.ok) return null;
  const { id_token } = (await r.json()) as { id_token?: string };
  const part = id_token?.split(".")[1];
  if (!part) return null;
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))) as {
    iss?: string;
    aud?: string;
    exp?: number;
    nonce?: string;
    sub?: string;
  };
  const issOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!issOk || claims.aud !== env.GOOGLE_CLIENT_ID || !claims.exp || claims.exp * 1000 < Date.now() || claims.nonce !== nonce || !claims.sub) return null;
  return claims.sub;
}

/**
 * Repos públicos de GitHub a través del servidor, cacheados una hora.
 * Así el navegador del visitante no habla con GitHub (ni le cede su IP) y no topamos con su límite.
 */
async function githubRepos(env: Env, ctx: ExecutionContext): Promise<Response> {
  const owner = env.GITHUB_OWNER || "xenxo-dev";
  const cacheKey = new Request(`https://cache.xenxo/github/${owner}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const r = await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}/repos?sort=updated&per_page=30`, {
    headers: { "User-Agent": "xenxo-world", Accept: "application/vnd.github+json" },
  });
  const list = r.ok ? ((await r.json()) as Record<string, unknown>[]) : [];
  const repos = list
    .filter((x) => !x.fork && !x.private)
    .slice(0, 12)
    .map((x) => ({
      name: x.name,
      description: x.description,
      html_url: x.html_url,
      stargazers_count: x.stargazers_count,
      language: x.language,
    }));
  const res = json({ owner, repos }, 200, { "Cache-Control": `public, max-age=${r.ok ? 3600 : 120}` });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

const GUEST_TTL_MS = 60 * 60 * 1000;
const AGENT_TTL_MS = 15 * 60 * 1000;
const USER_TTL_MS = 12 * 60 * 60 * 1000;
/** Lugares del mundo (para denuncias de chat, exportación y baja de una cuenta). */
const CHAT_CHUNKS = [PLACES.nexo, PLACES.plaza, ...DISTRICTS.map((d) => d.chunk)];

/** Chunk del distrito donde vive el portal de un proyecto (null si es antiguo, sin parcela). */
function districtChunk(districtId: string | null | undefined): string | null {
  return districtById(districtId)?.chunk ?? null;
}

/** Deja el escaparate del nexo con los proyectos más nuevos (tras publicar, borrar u ocultar). */
async function syncShowcase(env: Env, dir: ReturnType<typeof directory>) {
  const rows = await dir.showcase(SHOWCASE_SLOTS.length);
  const items: ShowcaseItem[] = [];
  for (const r of rows) {
    const d = districtById(r.district);
    const i = parcelIndex(r.parcel);
    if (!d || i < 0) continue;
    const meta = await assetMeta(env.ASSETS, r.mesh_hash);
    const at = parcelSpawn(i);
    items.push({
      projectId: r.id,
      title: r.title,
      category: r.category,
      cover: r.cover_hash,
      mesh: meta && meta.triangles <= ASSET_BUDGETS.monument.maxTriangles ? { hash: r.mesh_hash, bounds: meta.bounds } : null,
      chunk: d.chunk,
      spawn: at.p,
      yaw: at.yaw,
    });
  }
  await chunk(env, PLACES.nexo).syncShowcase(items);
}

function inJurisdiction<T extends Rpc.DurableObjectBranded | undefined>(env: Env, ns: DurableObjectNamespace<T>): DurableObjectNamespace<T> {
  return env.DO_JURISDICTION === "eu" || env.DO_JURISDICTION === "fedramp" ? ns.jurisdiction(env.DO_JURISDICTION) : ns;
}

/** Vista RPC con los tipos de retorno originales (sin los envoltorios de serialización de RPC). */
type Api<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };

/**
 * El objeto de un chunk. Antes de cada RPC le dice qué chunk es (bind): un objeto nuevo al que se
 * llega por RPC, sin pasar por fetch, no tiene otra forma de saberlo. fetch lo lleva en X-Chunk-Id.
 */
function chunk(env: Env, id: string) {
  if (isRemote(env, id)) return remoteChunk(env, id);
  return localChunk(env, id);
}

/** El objeto del chunk en Cloudflare, viva donde viva ahora (para moverlo de servidor). */
function localChunk(env: Env, id: string) {
  const ns = inJurisdiction(env, env.CHUNK);
  const stub = ns.get(ns.idFromName(id)) as unknown as Api<ChunkRoom> & { fetch(r: Request): Promise<Response> };
  // Los métodos del stub se llaman siempre sobre el stub (con otro `this` fallan) y no tienen
  // .apply/.call de verdad: cualquier propiedad de un stub es otra llamada RPC.
  const any = stub as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  return new Proxy(stub, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "fetch") return (r: Request) => stub.fetch(r);
      return async (...args: unknown[]) => {
        await stub.bind(id);
        return any[prop]!(...args);
      };
    },
  });
}

/** Huella del state de Google para la cookie que lo ata al navegador. */
async function stateHash(state: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`xg:${state}`)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Página de xenxo donde la persona da (o no) permiso a un juego. En local, la web de desarrollo. */
function consentOrigin(env: Env): string {
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (env.RP_ID === "localhost") return allowed[0] ?? "http://localhost:5173";
  return webOrigin(env, null);
}

/**
 * Rutas del proveedor OpenID Connect. Las que usan los juegos (descubrimiento, claves, token,
 * userinfo) están abiertas a cualquier origen y sin cookies; las de la pantalla de permiso, solo
 * a la web de xenxo y con la sesión de la persona.
 */
async function oidcRoutes(req: Request, env: Env, url: URL, h: Record<string, string>, open: Record<string, string>): Promise<Response | null> {
  const path = url.pathname;
  const issuer = url.origin;
  const dir = directory(env);
  const noStore = { "Cache-Control": "no-store", Pragma: "no-cache", "Referrer-Policy": "no-referrer" };

  if (path === "/.well-known/openid-configuration" && req.method === "GET") {
    return json(
      {
        issuer,
        authorization_endpoint: `${issuer}/oidc/authorize`,
        token_endpoint: `${issuer}/oidc/token`,
        userinfo_endpoint: `${issuer}/oidc/userinfo`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code"],
        subject_types_supported: ["pairwise"],
        id_token_signing_alg_values_supported: ["EdDSA"],
        scopes_supported: ["openid", "profile", "player", "avatar"],
        claims_supported: ["sub", "iss", "aud", "exp", "iat", "auth_time", "nonce", "name", "player_no", "avatar", "picture"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        prompt_values_supported: ["consent"],
        authorization_response_iss_parameter_supported: true,
      },
      200,
      { ...open, "Cache-Control": "public, max-age=300" },
    );
  }
  if (path === "/.well-known/jwks.json" && req.method === "GET") {
    return json(await dir.jwks(), 200, { ...open, "Cache-Control": "public, max-age=600" });
  }

  if (path === "/oidc/authorize" && req.method === "GET") {
    const q = Object.fromEntries([...url.searchParams.keys()].map((k) => [k, url.searchParams.get(k)]));
    const r = await dir.authorizeRequest(q);
    const web = consentOrigin(env);
    if (r.ok) return back(web, { autorizar: r.request });
    // Sin juego o sin dirección de vuelta válidos no se redirige a ningún sitio de fuera.
    if (!r.redirect) return back(web, { autorizar_error: r.error });
    return new Response(null, { status: 302, headers: { Location: r.redirect, ...noStore } });
  }

  // Juego abierto dentro de xenxo: la web de xenxo pide el permiso por él (respuesta por postMessage).
  if (path === "/oidc/embedded" && req.method === "POST") {
    if (!h["Access-Control-Allow-Origin"]) return json({ error: "forbidden" }, 403, noStore);
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    const q: Record<string, string | null> = {};
    for (const k of ["response_type", "client_id", "redirect_uri", "scope", "state", "nonce", "code_challenge", "code_challenge_method", "prompt", "max_age"]) {
      const v = body[k];
      q[k] = typeof v === "string" ? v.slice(0, 600) : null;
    }
    // Solo el juego de «Entrar con xenxo» que declara el proyecto abierto (no otro del mismo dominio).
    if (!(await dir.embeddedClientOk(body.project_id, q.client_id))) {
      return json({ error: "invalid_client", message: "ese juego no es el de este proyecto (xenxo.clientId en su xenxo.json)" }, 400, { ...h, ...noStore });
    }
    const r = await dir.authorizeRequest(q, true);
    return r.ok ? json({ request: r.request }, 200, { ...h, ...noStore }) : json({ error: r.error, message: r.message }, 400, { ...h, ...noStore });
  }

  if (path === "/oidc/token" && req.method === "POST") {
    let body: Record<string, unknown> = {};
    const type = req.headers.get("Content-Type") ?? "";
    const text = await req.text();
    if (text.length > 8192) return json({ error: "invalid_request" }, 400, { ...open, ...noStore });
    if (type.includes("application/json")) {
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return json({ error: "invalid_request" }, 400, { ...open, ...noStore });
      }
    } else body = Object.fromEntries(new URLSearchParams(text));
    const r = await dir.exchangeCode(body, issuer);
    return r.ok ? json(r.data, 200, { ...open, ...noStore }) : json({ error: r.error, error_description: r.message }, r.status, { ...open, ...noStore });
  }

  if (path === "/oidc/userinfo" && (req.method === "GET" || req.method === "POST")) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const claims = token ? await dir.userinfo(token, issuer) : null;
    if (!claims) return json({ error: "invalid_token" }, 401, { ...open, ...noStore, "WWW-Authenticate": 'Bearer error="invalid_token"' });
    return json(claims, 200, { ...open, ...noStore });
  }

  // Pantalla de permiso (solo la web de xenxo): qué pide el juego y la respuesta de la persona.
  const reqm = path.match(/^\/oidc\/request\/(ar_[A-Za-z0-9_-]{10,40})$/);
  if (reqm) {
    const p = await bearer(req, env);
    const uid = p ? userIdOf(p) : null;
    if (req.method === "GET") {
      const r = await dir.requestInfo(reqm[1], uid);
      return r.ok ? json(r.data, 200, { ...h, ...noStore }) : failure(r, { ...h, ...noStore });
    }
    if (req.method === "POST") {
      const { approve } = await readJson(req);
      // auth_time: cuándo entró la persona en xenxo (lo dice su sesión), no cuándo pulsó «Permitir».
      const authTime = p && p.kind === "user" ? p.exp - USER_TTL_MS : Date.now();
      const r = await dir.decide(reqm[1], uid, approve === true, authTime, issuer);
      return r.ok ? json(r.data, 200, { ...h, ...noStore }) : failure(r, { ...h, ...noStore });
    }
  }
  return null;
}

/** Vacía la parcela de un proyecto: su portal, lo que construyeron sus agentes y los agentes conectados. */
async function clearParcel(env: Env, district: string | null | undefined, projectId: string, agents: string[]) {
  const c = districtChunk(district);
  if (!c) return;
  const room = chunk(env, c);
  await room.removeStand(projectId);
  await room.purgeOwner(`prj_${projectId}`);
  if (agents.length) await room.kick(agents);
}

/** ¿Vive este chunk en el servidor de distritos? */
function isRemote(env: Env, id: string): boolean {
  return !!env.DISTRICT_HOST && !!env.DISTRICT_SIGNING_KEY && chunkList(env.REMOTE_CHUNKS).has(id);
}

/**
 * Un chunk del servidor de distritos, con la misma forma que el de aquí: cada método es una
 * llamada HTTPS firmada (solo los de REMOTE_METHODS) y fetch lleva el estado público.
 */
function remoteChunk(env: Env, id: string) {
  const host = env.DISTRICT_HOST!.replace(/\/+$/, "");
  const call = async (method: string, args: unknown[]) => {
    if (!REMOTE_METHODS.has(method)) throw new Error(`método remoto no permitido: ${method}`);
    const body = JSON.stringify(args);
    const token = await signRemote(env.DISTRICT_SIGNING_KEY!, { typ: "rpc", chunk: id, method, body: await sha256B64(body), exp: Date.now() + CALL_TTL_MS });
    const r = await fetch(`${host}/rpc/${encodeURIComponent(id)}/${method}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Xenxo-Call": token }, body });
    if (!r.ok) throw new Error(`servidor de distritos: ${method} → ${r.status}`);
    return (await r.json()) as unknown;
  };
  return new Proxy({} as Api<ChunkRoom> & { fetch(r: Request): Promise<Response> }, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "fetch") return (r: Request) => fetch(`${host}/chunk/${encodeURIComponent(id)}${new URL(r.url).pathname}`);
      return (...args: unknown[]) => call(prop, args);
    },
  });
}

/** URL del WebSocket de un chunk para quien ya tiene su token de sesión (pase si vive fuera). */
/**
 * ¿Está cerrado este chunk para esta persona? Un distrito «próximamente» solo admite a moderación
 * (y a la clave de administración). Solo cuesta una llamada al Directory al intentar entrar en uno.
 */
async function closedFor(env: Env, chunkId: string, p: Principal): Promise<boolean> {
  // Un distrito de la comunidad: abierto si está aprobado; si no, solo su autor y moderación.
  if (isCommunityChunk(chunkId)) return !p.scopes.includes("admin") && !(await directory(env).districtAccess(chunkId, userIdOf(p)));
  if (!DISTRICTS.some((d) => d.chunk === chunkId && d.soon)) return false;
  if (p.scopes.includes("admin")) return false;
  const uid = userIdOf(p);
  return !(uid && (await directory(env).isModerator(uid)));
}
const SOON = { error: "soon", message: "este distrito abrirá pronto" };

/**
 * Vuelve a poner en el nexo las puertas de los distritos de la comunidad aprobados (fase 3). Se
 * llama al aprobar, ocultar, cambiar o borrar uno: pocas veces, así que se mira R2 sin caché.
 */
async function syncCommunityGates(env: Env, dir: ReturnType<typeof directory>) {
  const gates: CommunityGate[] = [];
  for (const d of await dir.communityDistricts()) {
    const m = await assetMeta(env.ASSETS, d.manifest.emblem);
    gates.push({
      chunk_id: d.chunk_id,
      name: { es: d.manifest.name.es, en: d.manifest.name.en },
      color: d.manifest.color,
      cover: d.manifest.cover,
      emblem: m ? { lods: [{ hash: d.manifest.emblem, tris: m.triangles }], bounds: m.bounds } : undefined,
    });
  }
  await chunk(env, PLACES.nexo).setCommunityGates(communityGates(gates));
}

/** Medidas de los modelos del sistema (los de la forja se pueden usar en un distrito sin subirlos). */
const SYSTEM_MODELS = new Map<string, ModelInfo>(
  Object.values(SEED_ASSETS).flatMap((a) => a.lods.map((l) => [l.hash, { triangles: l.tris, bytes: l.bytes, bounds: l.bounds }] as const)),
);

/**
 * Lee y comprueba una ficha de distrito como el kit: esquema, presupuestos y posiciones, con las
 * medidas que guardó el servidor al subir cada modelo (nunca las que diga el cliente).
 */
async function checkSubmission(env: Env, req: Request): Promise<{ ok: true; sub: DistrictSubmission; models: Record<string, ModelInfo> } | { ok: false; status: number; body: Record<string, unknown> }> {
  const text = await req.text();
  if (text.length > 512 * 1024) return { ok: false, status: 413, body: { error: "too_large", message: "la ficha pasa de 512 KB" } };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, body: { error: "bad_manifest", message: "la ficha no es JSON" } };
  }
  const parsed = DistrictSubmission.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { error: "bad_manifest", message: "la ficha no cumple el esquema (xenxo.district/0)", detail: parsed.error.issues.slice(0, 20) } };
  }
  const sub = parsed.data;
  const models: Record<string, ModelInfo> = {};
  for (const f of submissionFiles(sub)) {
    if (f.kind !== "model" || models[f.hash]) continue;
    const sys = SYSTEM_MODELS.get(f.hash);
    if (sys) { models[f.hash] = sys; continue; }
    const head = await env.ASSETS.head(assetKey(f.hash));
    const m = head?.customMetadata;
    if (m) models[f.hash] = { triangles: Number(m.tris ?? 0), bytes: Number(m.bytes ?? head!.size), bounds: m.bounds ? JSON.parse(m.bounds) : null };
  }
  const problems = checkDistrict(sub, models);
  if (problems.length) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "district_problems",
        message: `la ficha tiene ${problems.length} problema(s)`,
        // En `detail`, como los demás errores: cada problema con su código, dónde está y su explicación.
        detail: problems.map((p) => ({ ...p, es: describeDistrictProblem(p, "es"), en: describeDistrictProblem(p, "en") })),
      },
    };
  }
  return { ok: true, sub, models };
}

async function socketFor(env: Env, req: Request, chunkId: string, p: Principal, token: string): Promise<string> {
  if (isRemote(env, chunkId)) {
    const ticket = await signRemote(env.DISTRICT_SIGNING_KEY!, { typ: "ticket", chunk: chunkId, principal: p, exp: Date.now() + TICKET_TTL_MS });
    const u = new URL(`/chunk/${encodeURIComponent(chunkId)}/ws`, env.DISTRICT_HOST!);
    u.protocol = u.protocol === "http:" ? "ws:" : "wss:";
    u.searchParams.set("ticket", ticket);
    return u.toString();
  }
  const u = new URL(`/chunk/${encodeURIComponent(chunkId)}/ws`, req.url);
  u.protocol = u.protocol === "http:" ? "ws:" : "wss:";
  u.searchParams.set("token", token);
  return u.toString();
}

function directory(env: Env) {
  const ns = inJurisdiction(env, env.DIRECTORY);
  return ns.get(ns.idFromName("directory")) as unknown as Api<Directory>;
}

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());
  return allowed.includes(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      }
    : {};
}

function json(data: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** Carné público (xenxo.io/p/<n>): un minuto en la caché del borde, también los «no existe». */
const PLAYER_CARD_TTL = 60;

function edgeCache(): Cache | undefined {
  return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
}

function cardCacheKey(reqUrl: string, no: number): Request {
  return new Request(new URL(`/players/${no}`, reqUrl).toString());
}

/** Al cambiar la visibilidad o borrar la cuenta, el carné deja de servirse desde la caché al momento. */
async function purgeCard(reqUrl: string, no: number | null | undefined) {
  if (no === null || no === undefined) return;
  await edgeCache()?.delete(cardCacheKey(reqUrl, no)).catch(() => false);
}

function withHeaders(res: Response, h: Record<string, string>): Response {
  return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...h } });
}

function failure(r: { status: number; error: string; message: string; detail?: unknown }, h: Record<string, string>) {
  return json({ error: r.error, message: r.message, detail: r.detail }, r.status, h);
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 64 * 1024) throw new Error("too_large");
  try {
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function bearer(req: Request, env: Env): Promise<Principal | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return token ? verifyToken(token, env.TOKEN_SECRET) : null;
}

async function userToken(u: UserRow, env: Env) {
  const p: Principal = {
    sub: `usr_${u.id}`,
    kind: "user",
    scopes: ["upload"],
    exp: Date.now() + USER_TTL_MS,
    name: u.display_name,
    ...(u.avatar_hash ? { avatar: { hash: u.avatar_hash, format: u.avatar_format ?? "glb" } } : {}),
    ...(u.player_no != null ? { no: u.player_no } : {}),
  };
  return { token: await signToken(p, env.TOKEN_SECRET), principal: p, user: u };
}

const userIdOf = (p: Principal) => (p.kind === "user" ? p.sub.replace(/^usr_/, "") : null);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const h = cors(req, env);
    // Lo que usan los juegos de cualquier dominio («Entrar con xenxo»): abierto, sin cookies.
    const publicOidc = path.startsWith("/.well-known/") || path === "/oidc/token" || path === "/oidc/userinfo";
    const open = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
    };

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: publicOidc ? open : h });
    if (!env.TOKEN_SECRET) return json({ error: "TOKEN_SECRET no configurado" }, 500, h);

    try {
      if (path === "/health") return json({ ok: true, protocol: 0 }, 200, h);

      if (path === "/github/repos" && req.method === "GET") {
        const r = await githubRepos(env, ctx);
        return new Response(r.body, { status: r.status, headers: { ...Object.fromEntries(r.headers), ...h } });
      }

      /* --- «Entrar con xenxo»: proveedor OpenID Connect para juegos --- */
      if (path.startsWith("/.well-known/") || path.startsWith("/oidc/")) {
        const r = await oidcRoutes(req, env, url, h, open);
        if (r) return r;
      }

      /* --- Invitados y agentes --- */
      if (path === "/auth/guest" && req.method === "POST") {
        const p: Principal = { sub: randomId("g_"), kind: "guest", scopes: [], exp: Date.now() + GUEST_TTL_MS };
        return json({ token: await signToken(p, env.TOKEN_SECRET), principal: p }, 200, h);
      }
      if (path === "/auth/agent" && req.method === "POST") {
        const key = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        // Clave de parcela (la crea su dueño en la web): construye solo ahí.
        if (key.startsWith("xk_")) {
          const g = await directory(env).resolveAgentKey(key);
          if (!g) return json({ error: "unauthorized", message: "clave no válida o revocada (o el proyecto ya no está publicado)" }, 401, h);
          const p: Principal = {
            sub: `agt_${g.key_id}`,
            kind: "agent",
            scopes: ["build", "upload"],
            exp: Date.now() + AGENT_TTL_MS,
            name: g.name,
            zone: g.zone,
          };
          return json({ token: await signToken(p, env.TOKEN_SECRET), principal: p, budgets: PARCEL_BUDGETS }, 200, h);
        }
        const agent = await resolveAgent(key, env.AGENT_KEYS);
        if (!agent) return json({ error: "unauthorized" }, 401, h);
        const p: Principal = { sub: `agt_${agent.id}`, kind: "agent", scopes: agent.scopes, exp: Date.now() + AGENT_TTL_MS };
        return json({ token: await signToken(p, env.TOKEN_SECRET), principal: p }, 200, h);
      }

      /* --- Personas registradas: alta y acceso con passkey --- */
      const dir = directory(env);
      if (path === "/auth/passkey/register/options" && req.method === "POST") {
        const r = await dir.registerOptions(await readJson(req));
        return r.ok ? json(r.data, 200, h) : failure(r, h);
      }
      if (path === "/auth/passkey/register/verify" && req.method === "POST") {
        const r = await dir.registerVerify(await readJson(req));
        return r.ok ? json(await userToken(r.data, env), 200, h) : failure(r, h);
      }
      if (path === "/auth/passkey/login/options" && req.method === "POST") {
        const r = await dir.loginOptions();
        return r.ok ? json(r.data, 200, h) : failure(r, h);
      }
      if (path === "/auth/passkey/login/verify" && req.method === "POST") {
        const r = await dir.loginVerify(await readJson(req));
        return r.ok ? json(await userToken(r.data, env), 200, h) : failure(r, h);
      }

      /* --- Entrar con Google (opcional) --- */
      if (path === "/auth/methods" && req.method === "GET") {
        return json({ passkey: true, google: googleEnabled(env) }, 200, { ...h, "Cache-Control": "public, max-age=60" });
      }
      if (path === "/auth/google/start" && req.method === "GET") {
        const q = url.searchParams;
        const origin = webOrigin(env, q.get("origin"));
        if (!googleEnabled(env)) return back(origin, { auth_error: "google_disabled" });
        const r = await dir.googleStart({
          mode: q.get("mode"),
          display_name: q.get("name"),
          age_confirmed: q.get("age") === "1",
          accept_terms: q.get("terms"),
          origin,
        });
        if (!r.ok) return back(origin, { auth_error: r.error });
        // El state queda atado a este navegador: un enlace de vuelta de Google que no empezó aquí no vale.
        const cookie = `xg_state=${await stateHash(r.data.state)}; Path=/auth/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax`;
        return new Response(null, { status: 302, headers: { Location: googleUrl(env, req, r.data), "Cache-Control": "no-store", "Set-Cookie": cookie } });
      }
      if (path === "/auth/google/go" && req.method === "GET") {
        const d = await dir.googleLinkPeek(url.searchParams.get("state"));
        if (!d || !googleEnabled(env)) return back(webOrigin(env, null), { auth_error: "flow_expired" });
        const cookie = `xg_state=${await stateHash(d.state)}; Path=/auth/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax`;
        return new Response(null, { status: 302, headers: { Location: googleUrl(env, req, d), "Cache-Control": "no-store", "Set-Cookie": cookie } });
      }
      if (path === "/auth/google/callback" && req.method === "GET") {
        const q = url.searchParams;
        const bound = (req.headers.get("Cookie") ?? "").match(/(?:^|;\s*)xg_state=([A-Za-z0-9_-]{20,80})/)?.[1];
        if (!bound || bound !== (await stateHash(q.get("state") ?? ""))) return back(webOrigin(env, null), { auth_error: "flow_expired" });
        const flow = await dir.googleFlow(q.get("state"));
        if (!flow) return back(webOrigin(env, null), { auth_error: "flow_expired" });
        const code = q.get("code");
        if (!code || !googleEnabled(env)) return back(flow.origin, { auth_error: q.get("error") === "access_denied" ? "google_cancelled" : "google_failed" });
        const subject = await googleSubject(env, req, code, flow.verifier, flow.nonce);
        if (!subject) return back(flow.origin, { auth_error: "google_failed" });
        const r = await dir.googleComplete(flow, subject);
        if (!r.ok) return back(flow.origin, { auth_error: r.error });
        return back(flow.origin, r.data.linked ? { google_linked: "1" } : { google: r.data.code! });
      }
      if (path === "/auth/google/finish" && req.method === "POST") {
        const r = await dir.googleRedeem((await readJson(req)).code);
        return r.ok ? json(await userToken(r.data, env), 200, h) : failure(r, h);
      }

      /* --- Assets --- */
      // Medidas de un modelo de la gente (triángulos y caja): las usa el servidor de distritos, que
      // no tiene R2. Inmutables por hash; se guardan en la caché del centro de datos.
      const metaPath = path.match(/^\/assets\/([0-9a-f]{64})\/meta$/);
      if (metaPath && req.method === "GET") {
        const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
        const key = new Request(`https://xenxo-cache.local/meta/${metaPath[1]}`);
        const hit = await cache?.match(key);
        if (hit) return new Response(hit.body, { headers: { ...h, "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" } });
        const head = await env.ASSETS.head(assetKey(`sha256:${metaPath[1]}`));
        if (!head) return json({ error: "not_found" }, 404, h);
        const body = JSON.stringify({ customMetadata: head.customMetadata ?? {} });
        if (cache) ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": "public, max-age=86400" } })));
        return new Response(body, { headers: { ...h, "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" } });
      }
      // /s/<hash>.<ext> lo sirve Cloudflare como estático sin pasar por aquí; si llega, es que no
      // estaba (p. ej. la web es más nueva que este Worker): se atiende como cualquier asset.
      const asset = path.match(/^\/assets\/([0-9a-f]{64})$/) ?? path.match(/^\/s\/([0-9a-f]{64})\.(?:glb|webp)$/);
      if (asset && (req.method === "GET" || req.method === "HEAD")) return handleGet(asset[1]!, env.ASSETS, req, ctx, env.STATIC);
      if (path === "/assets" && req.method === "POST") {
        const p = await bearer(req, env);
        if (!p) return json({ error: "unauthorized", message: "inicia sesión para subir modelos" }, 401, h);
        // Lo que sube el agente de una parcela cuenta para su proyecto (cuota propia, y no lo toca la limpieza).
        if (p.zone && !(await dir.agentKeyAlive(p.sub.replace(/^agt_/, "")))) return json({ error: "unauthorized", message: "tu clave de agente ya no vale" }, 401, h);
        const uploader = p.zone?.owner ?? p.sub;
        const allowed = await dir.canUpload(uploader);
        if (!allowed.ok) return failure(allowed, h);
        const r = await handleUpload(req, p, env.ASSETS);
        if (!r.ok) return failure(r, h);
        await dir.recordUpload(uploader, r.data.hash, r.data.kind, r.data.bytes);
        return json(r.data, 201, h);
      }

      /* --- Distritos y parcelas (lectura pública) --- */
      if (path === "/districts" && req.method === "GET") {
        // `remote`: el distrito vive en el servidor de distritos (hay que pedir pase para entrar).
        // Los de la comunidad aprobados van detrás, sin parcelas (de momento) y sin el contacto de su autor.
        const community = (await dir.communityDistricts()).map((d) => ({
          id: d.slug,
          chunk_id: d.chunk_id,
          category: "community",
          color: d.manifest.color,
          name: d.manifest.name,
          desc: d.manifest.description,
          theme: d.manifest.theme,
          cover: d.manifest.cover,
          emblem: d.manifest.emblem,
          author: d.author,
          parcels: [],
          community: true,
        }));
        const list = [...(await dir.districts()), ...community].map((d) => (isRemote(env, d.chunk_id) ? { ...d, remote: true } : d));
        return json({ districts: list }, 200, { ...h, "Cache-Control": "public, max-age=10" });
      }

      /* --- Proyectos (lectura pública) --- */
      if (path === "/projects" && req.method === "GET") {
        return json({ projects: await dir.listProjects() }, 200, { ...h, "Cache-Control": "public, max-age=10" });
      }

      /* --- Juegos por su enlace (xenxo.io/j/<slug>): lectura pública --- */
      const gslug = path.match(/^\/games\/([a-z0-9-]{3,40})$/);
      if (gslug && req.method === "GET") {
        const g = await dir.gameBySlug(gslug[1]!);
        return g ? json({ project: g }, 200, { ...h, "Cache-Control": "public, max-age=30" }) : json({ error: "not_found", message: "ese juego no existe" }, 404, h);
      }

      /* --- Jams (lectura pública: convocatorias, juegos y, al acabar, resultados) --- */
      if (path === "/jams" && req.method === "GET") {
        return json({ jams: await dir.listJams() }, 200, { ...h, "Cache-Control": "public, max-age=30" });
      }
      const jamPath = path.match(/^\/jams\/([a-z0-9-]{3,40})(?:\/(mine|entries|votes)(?:\/([a-zA-Z0-9_-]{4,40}))?)?$/);
      if (jamPath && !jamPath[2] && req.method === "GET") {
        const r = await dir.jam(jamPath[1]!);
        return r.ok ? json(r.data, 200, { ...h, "Cache-Control": "public, max-age=15" }) : failure(r, h);
      }

      /* --- Carné de jugador (lectura pública; solo los que su dueño hizo públicos) --- */
      const pcard = path.match(/^\/players\/(0|[1-9]\d{0,8})$/);
      if (pcard && req.method === "GET") {
        const no = Number(pcard[1]);
        const cache = edgeCache();
        const key = cardCacheKey(req.url, no);
        const hit = await cache?.match(key);
        if (hit) return withHeaders(hit, h);
        const card = await dir.playerCard(no);
        const cc = { "Cache-Control": `public, max-age=${PLAYER_CARD_TTL}` };
        const res = card ? json(card, 200, cc) : json({ error: "not_found", message: "ese carné no existe o no es público" }, 404, cc);
        if (cache) ctx.waitUntil(cache.put(key, res.clone()));
        return withHeaders(res, h);
      }

      /* --- Denuncias: cualquiera con un token, también invitados --- */
      if (path === "/reports" && req.method === "POST") {
        const p = await bearer(req, env);
        if (!p) return json({ error: "unauthorized" }, 401, h);
        const body = await readJson(req);
        let evidence: unknown;
        if (body.target_type === "chat" && typeof body.target_id === "string") {
          for (const c of CHAT_CHUNKS) evidence ??= await chunk(env, c).chatMessage(body.target_id);
          if (!evidence) return json({ error: "not_found", message: "ese mensaje ya no existe" }, 404, h);
        }
        const r = await dir.report(p.sub, body, evidence);
        return r.ok ? json(r.data, 201, h) : failure(r, h);
      }

      /* --- A partir de aquí, sesión obligatoria --- */
      const principal = await bearer(req, env);
      const uid = principal ? userIdOf(principal) : null;
      const isAdmin = !!principal?.scopes.includes("admin");

      if (path === "/me" || path.startsWith("/me/")) {
        if (!uid) return json({ error: "unauthorized", message: "inicia sesión con tu passkey" }, 401, h);
        if (path === "/me" && req.method === "GET") {
          const r = await dir.me(uid);
          return r.ok ? json(r.data, 200, h) : failure(r, h);
        }
        // Renueva la sesión con los datos de ahora (número, nombre, personaje): al abrir la web.
        if (path === "/me/session" && req.method === "POST") {
          const r = await dir.me(uid);
          if (!r.ok) return failure(r, h);
          const { projects: _p, ...u } = r.data;
          return json(await userToken(u, env), 200, h);
        }
        if (path === "/me" && req.method === "PATCH") {
          const r = await dir.rename(uid, (await readJson(req)).display_name);
          return r.ok ? json(await userToken(r.data, env), 200, h) : failure(r, h);
        }
        if (path === "/me/avatar" && req.method === "POST") {
          const { hash, label } = await readJson(req);
          let format: "glb" | "vrm" = "glb";
          if (hash !== null && typeof hash === "string" && isAvatarPreset(hash)) {
            format = "vrm"; // avatar de serie
          } else if (hash !== null) {
            const meta = typeof hash === "string" ? await assetMeta(env.ASSETS, hash) : null;
            if (!meta || meta.kind !== "avatar" || meta.format === "image") return json({ error: "not_found", message: "ese avatar no existe" }, 404, h);
            format = meta.format;
          }
          const r = await dir.setAvatar(uid, hash, format, label);
          return r.ok ? json(await userToken(r.data, env), 200, h) : failure(r, h);
        }
        // El retrato del personaje (lo hace la web en el navegador; lo reciben los juegos como «picture»).
        if (path === "/me/portrait" && req.method === "PUT") {
          const b = await readJson(req);
          const r = await dir.setPortrait(uid, b.hash, b.of);
          return r.ok ? json({ portrait: r.data }, 200, h) : failure(r, h);
        }
        /* «Entrar con xenxo»: juegos registrados y juegos a los que se dio permiso */
        if (path === "/me/games" && req.method === "GET") return json({ games: await dir.clientsOf(uid) }, 200, h);
        if (path === "/me/games" && req.method === "POST") {
          const r = await dir.registerClient(uid, await readJson(req));
          return r.ok ? json(r.data, 201, h) : failure(r, h);
        }
        const game = path.match(/^\/me\/games\/(xg_[A-Za-z0-9_]{6,30})$/);
        if (game && req.method === "DELETE") {
          const r = await dir.deleteClient(uid, game[1]!);
          return r.ok ? json(r.data, 200, h) : failure(r, h);
        }
        if (path === "/me/connected" && req.method === "GET") return json({ connected: await dir.grantsOf(uid) }, 200, h);
        const conn = path.match(/^\/me\/connected\/(xg_[A-Za-z0-9_]{6,30})$/);
        if (conn && req.method === "DELETE") {
          const r = await dir.revokeGrant(uid, conn[1]!);
          return r.ok ? json(r.data, 200, h) : failure(r, h);
        }
        /* Claves de agente: construir en la parcela de un proyecto */
        if (path === "/me/agent-keys" && req.method === "GET") {
          return json({ keys: await dir.agentKeys(uid), max_per_project: MAX_AGENT_KEYS_PER_PROJECT, budgets: PARCEL_BUDGETS }, 200, h);
        }
        if (path === "/me/agent-keys" && req.method === "POST") {
          const body = await readJson(req);
          const r = await dir.createAgentKey(uid, body.project_id, body.label);
          return r.ok ? json(r.data, 201, h) : failure(r, h);
        }
        const akey = path.match(/^\/me\/agent-keys\/([a-zA-Z0-9]{4,20})$/);
        if (akey && req.method === "DELETE") {
          const r = await dir.revokeAgentKey(uid, akey[1]!);
          if (!r.ok) return failure(r, h);
          // Fuera ya: su token deja de valer en cuanto caduca, pero la conexión abierta se corta ahora.
          for (const d of DISTRICTS) await chunk(env, d.chunk).kick([r.data.sub]);
          return json({ revoked: true }, 200, h);
        }
        /* El armario: personajes propios guardados (máximo MAX_SKINS) */
        if (path === "/me/skins" && req.method === "GET") {
          return json({ skins: await dir.skins(uid), max: MAX_SKINS }, 200, h);
        }
        const skin = path.match(/^\/me\/skins\/(?:sha256:)?([0-9a-f]{64})$/);
        if (skin && req.method === "DELETE") {
          const hash = `sha256:${skin[1]}`;
          const r = await dir.removeSkin(uid, hash);
          if (!r.ok) return failure(r, h);
          if (r.data.orphan) await forgetAssets(env.ASSETS, req.url, [hash]);
          return json({ ...(await userToken(r.data.user, env)), skins: r.data.skins, max: MAX_SKINS }, 200, h);
        }
        /* Formas de entrar: más passkeys, Google */
        if (path === "/me/logins" && req.method === "GET") {
          return json({ ...(await dir.logins(uid)), google_available: googleEnabled(env) }, 200, h);
        }
        if (path === "/me/logins/google" && req.method === "POST") {
          if (!googleEnabled(env)) return json({ error: "google_disabled", message: "Entrar con Google no está activado" }, 503, h);
          const r = await dir.googleStart({ mode: "link", userId: uid, origin: webOrigin(env, req.headers.get("Origin")) });
          // Se pasa por /auth/google/go (navegación normal) para dejar la cookie que ata el state.
          return r.ok ? json({ url: new URL(`/auth/google/go?state=${encodeURIComponent(r.data.state)}`, req.url).toString() }, 200, h) : failure(r, h);
        }
        if (path === "/me/logins/google" && req.method === "DELETE") {
          const r = await dir.unlinkGoogle(uid);
          return r.ok ? json(r.data, 200, h) : failure(r, h);
        }
        if (path === "/me/passkeys/options" && req.method === "POST") {
          const r = await dir.addPasskeyOptions(uid);
          return r.ok ? json(r.data, 200, h) : failure(r, h);
        }
        if (path === "/me/passkeys/verify" && req.method === "POST") {
          const r = await dir.addPasskeyVerify(uid, await readJson(req));
          return r.ok ? json(r.data, 200, h) : failure(r, h);
        }
        if (path === "/me/roles" && req.method === "GET") {
          return json({ moderator: await dir.isModerator(uid), founder: await dir.isFounder(uid) }, 200, h);
        }
        if (path === "/me/card" && req.method === "GET") {
          const r = await dir.card(uid);
          return r.ok ? json(r.data, 200, h) : failure(r, h);
        }
        if (path === "/me/card" && req.method === "PUT") {
          const r = await dir.setCardPublic(uid, (await readJson(req)).public);
          if (!r.ok) return failure(r, h);
          await purgeCard(req.url, r.data.player_no);
          return json(r.data, 200, h);
        }
        if (path === "/me/export" && req.method === "GET") {
          const r = await dir.exportData(uid);
          if (!r.ok) return failure(r, h);
          const chat = [];
          for (const c of CHAT_CHUNKS) chat.push(...(await chunk(env, c).chatOf(`usr_${uid}`)));
          return json({ ...r.data, chat_messages: chat }, 200, {
            ...h,
            "Content-Disposition": 'attachment; filename="xenxo-mis-datos.json"',
          });
        }
        /* --- Mi distrito de la comunidad (kit de distritos; community.ts) --- */
        if (path === "/me/district" && req.method === "GET") return json({ district: await dir.myDistrict(uid) }, 200, h);
        if (path === "/me/district" && req.method === "PUT") {
          const c = await checkSubmission(env, req);
          if (!c.ok) return json(c.body, c.status, h);
          const r = await dir.saveDistrict(uid, c.sub);
          if (!r.ok) return failure(r, h);
          const d = r.data;
          await chunk(env, d.chunk_id).installDistrict({
            meta: { id: d.id, name: { es: c.sub.name.es, en: c.sub.name.en }, color: c.sub.color, theme: c.sub.theme, system: communitySystem(d.id, c.sub) },
            content: communityContent(d.id, c.sub, c.models, d.portals),
          });
          // Si estaba aprobado, vuelve a borrador: su puerta sale del nexo hasta que se apruebe otra vez.
          ctx.waitUntil(syncCommunityGates(env, dir));
          return json({ district: d }, 200, h);
        }
        if (path === "/me/district" && req.method === "DELETE") {
          const r = await dir.deleteDistrict(uid);
          if (!r.ok) return failure(r, h);
          await chunk(env, r.data.chunk_id).installDistrict(null);
          ctx.waitUntil(syncCommunityGates(env, dir));
          return json({ deleted: true }, 200, h);
        }
        if (path === "/me/district/submit" && req.method === "POST") {
          const r = await dir.submitDistrict(uid);
          return r.ok ? json({ district: r.data }, 200, h) : failure(r, h);
        }
        if (path === "/me" && req.method === "DELETE") {
          const before = await dir.card(uid);
          const r = await dir.deleteAccount(uid);
          if (!r.ok) return failure(r, h);
          for (const p of r.data.projects) await clearParcel(env, p.district, p.id, r.data.agents);
          if (r.data.community) {
            await chunk(env, r.data.community.chunk_id).installDistrict(null);
            ctx.waitUntil(syncCommunityGates(env, dir));
          }
          for (const c of CHAT_CHUNKS) await chunk(env, c).purgeOwner(`usr_${uid}`);
          await syncShowcase(env, dir);
          await forgetAssets(env.ASSETS, req.url, r.data.orphanHashes);
          if (before.ok) await purgeCard(req.url, before.data.player_no);
          return json({ deleted: true, assets_removed: r.data.orphanHashes.length }, 200, h);
        }
      }

      /* --- Jams: lo tuyo, apuntar o quitar un juego propio y votar (con cuenta) --- */
      if (jamPath && jamPath[2]) {
        if (!uid) return json({ error: "unauthorized", message: "inicia sesión con tu cuenta" }, 401, h);
        const [, slug, what, pid] = jamPath as unknown as [string, string, string, string | undefined];
        const noStore = { ...h, "Cache-Control": "no-store" };
        if (what === "mine" && !pid && req.method === "GET") {
          const r = await dir.jamMine(uid, slug);
          return r.ok ? json(r.data, 200, noStore) : failure(r, h);
        }
        if (what === "entries" && !pid && req.method === "POST") {
          const r = await dir.enterJam(uid, slug, (await readJson(req)).project_id);
          return r.ok ? json(r.data, 201, h) : failure(r, h);
        }
        if (what === "entries" && pid && req.method === "DELETE") {
          const r = await dir.leaveJam(uid, slug, pid);
          return r.ok ? json(r.data, 200, h) : failure(r, h);
        }
        if (what === "votes" && pid && req.method === "PUT") {
          const r = await dir.voteJam(uid, slug, pid, (await readJson(req)).stars);
          return r.ok ? json(r.data, 200, h) : failure(r, h);
        }
        return json({ error: "not_found" }, 404, h);
      }

      if (path === "/projects" && req.method === "POST") {
        if (!uid) return json({ error: "unauthorized", message: "inicia sesión para publicar un proyecto" }, 401, h);
        const r = await dir.createProject(uid, await readJson(req));
        if (!r.ok) return failure(r, h);
        const project = r.data;
        const meta = await assetMeta(env.ASSETS, project.mesh_hash!);
        const placed =
          meta && meta.triangles <= ASSET_BUDGETS.monument.maxTriangles
            ? await chunk(env, districtChunk(project.district)!).placeStand({
                projectId: project.id,
                owner: `usr_${uid}`,
                title: project.title,
                category: project.category,
                cover: project.cover_hash!,
                parcel: parcelIndex(project.parcel),
                mesh: { hash: project.mesh_hash!, bounds: meta.bounds },
              })
            : ({ ok: false, code: "monument_too_big", message: `el monumento debe tener como mucho ${ASSET_BUDGETS.monument.maxTriangles} triángulos` } as const);
        if (!placed.ok) {
          // Sin portal no hay proyecto: se deshace el alta y se explica por qué.
          await dir.deleteProject(project.id);
          const code = placed.code === "budget_exceeded" ? "district_full" : placed.code;
          const status = code === "parcel_taken" || code === "district_full" ? 409 : code === "monument_too_big" ? 422 : 400;
          return json({ error: code, message: placed.message }, status, h);
        }
        await dir.setInWorld(project.id, true);
        ctx.waitUntil(syncShowcase(env, dir));
        return json({ project: { ...project, in_world: true }, stand: placed }, 201, h);
      }

      const proj = path.match(/^\/projects\/([a-zA-Z0-9_-]{4,40})$/);
      if (proj && req.method === "GET") {
        const p = await dir.project(proj[1]!);
        // Solo lo publicado (revisado o no: su portal está en su parcela). Lo oculto, para nadie.
        const visible = p && (await dir.projectPlace(proj[1]!)) && (await dir.projectStatus(proj[1]!)) === "published";
        return visible ? json({ project: p }, 200, { ...h, "Cache-Control": "public, max-age=10" }) : json({ error: "not_found" }, 404, h);
      }
      if (proj && req.method === "DELETE") {
        if (!principal) return json({ error: "unauthorized" }, 401, h);
        const owner = await dir.projectOwner(proj[1]!);
        if (!owner) return json({ error: "not_found" }, 404, h);
        if (owner !== uid && !isAdmin) return json({ error: "forbidden", message: "solo su autor puede borrarlo" }, 403, h);
        const place = await dir.projectPlace(proj[1]!);
        const gone = await dir.deleteProject(proj[1]!);
        await clearParcel(env, place?.district, proj[1]!, gone.agents);
        await forgetAssets(env.ASSETS, req.url, gone.orphanHashes);
        ctx.waitUntil(syncShowcase(env, dir));
        return json({ deleted: true }, 200, h);
      }

      /* --- Moderación (agentes con scope admin) --- */
      /* --- Ficha de juego de un proyecto (xenxo.json): la lee el servidor --- */
      const pgame = path.match(/^\/projects\/([a-zA-Z0-9_-]{4,40})\/game$/);
      if (pgame && (req.method === "POST" || req.method === "DELETE")) {
        if (!uid) return json({ error: "unauthorized", message: "inicia sesión" }, 401, h);
        const id = pgame[1]!;
        if (req.method === "DELETE") {
          const r = await dir.clearGame(uid, id);
          return r.ok ? json(r.data, 200, h) : failure(r, h);
        }
        const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
        const mine = await dir.me(uid);
        const p = mine.ok ? mine.data.projects.find((x) => x.id === id && x.status === "published") : undefined;
        if (!p) return json({ error: "not_found", message: "ese proyecto no es tuyo o no existe" }, 404, h);
        if (!p.url) return json({ error: "bad_url", message: "el proyecto necesita el enlace del juego" }, 400, h);
        const quota = await dir.takeManifestRead(uid);
        if (!quota.ok) return failure(quota, h);
        // En local (RP_ID=localhost) se puede leer la ficha de un servidor de pruebas en localhost.
        const localGame = env.RP_ID === "localhost" && /^http:\/\/(localhost|127\.0\.0\.1):/.test(p.url) ? new URL("xenxo.json", p.url).toString() : null;
        const devUrl = env.RP_ID === "localhost" ? (typeof body.manifest_url === "string" ? body.manifest_url : localGame) : null;
        const read = devUrl ? await fetchDevManifest(devUrl) : await fetchManifest(p.url);
        if (!read.ok) return json({ error: read.error, message: read.message, detail: read.detail }, 400, h);
        const r = await dir.setGame(uid, id, read.manifest, body.slug);
        return r.ok ? json({ project: r.data, manifest_url: read.at }, 200, h) : failure(r, h);
      }

      /* --- Moderación (personas moderadoras; el fundador siempre) --- */
      if (path.startsWith("/mod/")) {
        const modId = isAdmin ? `admin:${principal!.sub}` : uid && (await dir.isModerator(uid)) ? `usr_${uid}` : null;
        if (!modId) return json({ error: "forbidden", message: "solo moderación" }, 403, h);
        // Distritos de la comunidad: la cola y la decisión (aprobar, rechazar u ocultar, con motivo).
        if (path === "/mod/districts" && req.method === "GET") return json({ districts: await dir.modDistricts() }, 200, h);
        const dr = path.match(/^\/mod\/districts\/([A-Za-z0-9_-]{4,24})\/review$/);
        if (dr && req.method === "POST") {
          const body = await readJson(req);
          const r = await dir.reviewDistrict(modId, dr[1]!, body.decision, body.note);
          if (!r.ok) return failure(r, h);
          await syncCommunityGates(env, dir);
          return json({ district: r.data }, 200, h);
        }
        // Mover un chunk de servidor: copia lo de la gente de Cloudflare al servidor de distritos (o al
        // revés). Solo con la clave de administración. Primero se copia; después se cambia REMOTE_CHUNKS.
        const mv = path.match(/^\/mod\/chunks\/([^/]+)\/move$/);
        if (mv && req.method === "POST") {
          if (!isAdmin) return json({ error: "forbidden", message: "solo con la clave de administración" }, 403, h);
          const id = mv[1]!;
          if (!ChunkId.safeParse(id).success || !env.DISTRICT_HOST || !env.DISTRICT_SIGNING_KEY) return json({ error: "bad_request", message: "falta DISTRICT_HOST o el chunk no es válido" }, 400, h);
          const to = (await readJson(req)).to;
          if (to !== "remote" && to !== "local") return json({ error: "bad_request", message: "to: remote | local" }, 400, h);
          const here = localChunk(env, id);
          const there = remoteChunk(env, id);
          const dump = to === "remote" ? await here.dumpState() : ((await there.dumpState()) as Awaited<ReturnType<typeof here.dumpState>>);
          const r = to === "remote" ? await there.loadState(dump) : await here.loadState(dump);
          return json({ moved: id, to, ...(r as object) }, 200, { ...h, "Cache-Control": "no-store" });
        }
        if (path === "/mod/queue" && req.method === "GET") return json(await dir.moderationQueue(), 200, { ...h, "Cache-Control": "no-store" });
        if (path === "/mod/log" && req.method === "GET") return json({ log: await dir.moderationLog() }, 200, { ...h, "Cache-Control": "no-store" });
        // Quién modera: lo ve moderación; nombrar y retirar, solo el fundador (o la clave de administración).
        if (path === "/mod/moderators" && req.method === "GET") return json({ moderators: await dir.listModerators() }, 200, { ...h, "Cache-Control": "no-store" });
        const modr = path.match(/^\/mod\/moderators\/(\d{1,9})$/);
        if (modr && (req.method === "PUT" || req.method === "DELETE")) {
          if (!isAdmin && !(await dir.isFounder(uid))) return json({ error: "forbidden", message: "solo el fundador nombra moderación" }, 403, h);
          const r = await dir.setModerator(modId, modr[1], req.method === "PUT");
          return r.ok ? json(r.data, 200, h) : failure(r, h);
        }
        const rev = path.match(/^\/mod\/projects\/([a-zA-Z0-9_-]{4,40})\/review$/);
        if (rev && req.method === "POST") {
          const b = await readJson(req);
          const r = await dir.review(modId, rev[1]!, b.decision, b.note);
          if (!r.ok) return failure(r, h);
          ctx.waitUntil(syncShowcase(env, dir));
          return json({ project: r.data }, 200, h);
        }
        const mhide = path.match(/^\/mod\/projects\/([a-zA-Z0-9_-]{4,40})\/hide$/);
        if (mhide && req.method === "POST") {
          const b = await readJson(req);
          const place = await dir.projectPlace(mhide[1]!);
          const r = await dir.moderateHide(modId, mhide[1]!, b.note);
          if (!r.ok) return failure(r, h);
          await clearParcel(env, place?.district, mhide[1]!, await dir.projectAgents(mhide[1]!));
          ctx.waitUntil(syncShowcase(env, dir));
          return json(r.data, 200, h);
        }
        if (path === "/mod/jams" && req.method === "POST") {
          const r = await dir.createJam(modId, await readJson(req));
          return r.ok ? json({ jam: r.data }, 201, h) : failure(r, h);
        }
        const mjam = path.match(/^\/mod\/jams\/([a-z0-9-]{3,40})$/);
        if (mjam && req.method === "PATCH") {
          const r = await dir.updateJam(modId, mjam[1]!, await readJson(req));
          return r.ok ? json({ jam: r.data }, 200, h) : failure(r, h);
        }
        const mjamOut = path.match(/^\/mod\/jams\/([a-z0-9-]{3,40})\/entries\/([a-zA-Z0-9_-]{4,40})\/remove$/);
        if (mjamOut && req.method === "POST") {
          const r = await dir.modRemoveJamEntry(modId, mjamOut[1]!, mjamOut[2]!, (await readJson(req)).note);
          return r.ok ? json(r.data, 200, h) : failure(r, h);
        }
        const mrep = path.match(/^\/mod\/reports\/(\d{1,12})$/);
        if (mrep && req.method === "POST") {
          const b = await readJson(req);
          const r = await dir.moderateReport(modId, Number(mrep[1]), b.status, b.note);
          return r.ok ? json(r.data, 200, h) : failure(r, h);
        }
        return json({ error: "not_found" }, 404, h);
      }

      if (path.startsWith("/admin/")) {
        if (!isAdmin) return json({ error: "forbidden" }, 403, h);
        // Limpieza de archivos huérfanos ya (la diaria va sola). En local (RP_ID=localhost) se puede simular la fecha.
        if (path === "/admin/cleanup" && req.method === "POST") {
          const body: Record<string, unknown> = await readJson(req).catch(() => ({}));
          const local = env.RP_ID === "localhost";
          const now = local && typeof body.now === "number" ? body.now : Date.now();
          const r = await dir.cleanupNow(now);
          await forgetAssets(env.ASSETS, req.url, r.deleteFromR2);
          return json({ marked: r.marked, deleted: r.deleteFromR2.length }, 200, h);
        }
        if (path === "/admin/oidc/rotate" && req.method === "POST") return json(await dir.rotateSigningKey(), 200, h);
        if (path === "/admin/reports" && req.method === "GET") {
          return json({ reports: await dir.listReports(url.searchParams.get("status") ?? "open") }, 200, h);
        }
        const rep = path.match(/^\/admin\/reports\/(\d+)$/);
        if (rep && req.method === "POST") {
          const { status } = await readJson(req);
          if (status !== "actioned" && status !== "dismissed") return json({ error: "bad_message" }, 400, h);
          await dir.resolveReport(Number(rep[1]), status);
          return json({ ok: true }, 200, h);
        }
        const hideChat = path.match(/^\/admin\/chat\/([a-zA-Z0-9_-]{4,40})\/hide$/);
        if (hideChat && req.method === "POST") {
          let hidden = false;
          for (const c of CHAT_CHUNKS) hidden = (await chunk(env, c).hideChat(hideChat[1]!)) || hidden;
          return json({ hidden }, 200, h);
        }
        const hide = path.match(/^\/admin\/projects\/([a-zA-Z0-9_-]{4,40})\/hide$/);
        if (hide && req.method === "POST") {
          const place = await dir.projectPlace(hide[1]!);
          await clearParcel(env, place?.district, hide[1]!, await dir.projectAgents(hide[1]!));
          const hidden = await dir.hideProject(hide[1]!);
          ctx.waitUntil(syncShowcase(env, dir));
          return json({ hidden }, 200, h);
        }
      }

      /* --- Chunks --- */
      // Pase para entrar en un chunk: dónde conectar el WebSocket (aquí, con el mismo token; o en el
      // servidor de distritos, con un pase firmado de 60 s). Lleva el token de sesión en Authorization.
      const tk = path.match(/^\/chunk\/([^/]+)\/ticket$/);
      if (tk && req.method === "POST") {
        const chunkId = tk[1]!;
        if (!ChunkId.safeParse(chunkId).success) return json({ error: "chunk inválido" }, 400, h);
        const raw = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        const p = await verifyToken(raw, env.TOKEN_SECRET);
        if (!p) return json({ error: "unauthorized" }, 401, h);
        if (p.zone && !(await directory(env).agentKeyAlive(p.sub.replace(/^agt_/, "")))) {
          return json({ error: "unauthorized", message: "tu clave de agente ya no vale" }, 401, h);
        }
        if (await closedFor(env, chunkId, p)) return json(SOON, 403, h);
        return json({ url: await socketFor(env, req, chunkId, p, raw), remote: isRemote(env, chunkId) }, 200, { ...h, "Cache-Control": "no-store" });
      }

      const m = path.match(/^\/chunk\/([^/]+)\/(ws|state)$/);
      if (m) {
        const chunkId = m[1]!;
        if (!ChunkId.safeParse(chunkId).success) return json({ error: "chunk inválido" }, 400, h);
        const stub = chunk(env, chunkId);
        const headers = new Headers({ "X-Chunk-Id": chunkId });

        if (m[2] === "state") {
          // Lectura pública y ligera para el panel 2D (no abre WebSocket). Se guarda 15 s en la caché
          // del centro de datos: el chunk se despierta como mucho una vez cada 15 s, mire quien mire.
          const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
          const key = new Request(`https://xenxo-cache.local/state/${chunkId}`);
          const hit = await cache?.match(key);
          const out = { ...h, "Content-Type": "application/json", "Cache-Control": "public, max-age=15" };
          if (hit) return new Response(hit.body, { status: 200, headers: out });
          const r = await stub.fetch(new Request("https://do/state", { headers }));
          const body = await r.text();
          if (r.ok && cache) ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": "public, max-age=15" } })));
          return new Response(body, { status: r.status, headers: out });
        }

        if (m[2] === "ws" && isRemote(env, chunkId)) {
          return json({ error: "elsewhere", message: "este distrito vive en otro servidor: pide un pase en /chunk/<id>/ticket" }, 421, h);
        }
        if (req.headers.get("Upgrade") !== "websocket") return json({ error: "se esperaba WebSocket" }, 426, h);
        // El token va en la query porque los navegadores no permiten cabeceras en WebSocket.
        // Es de vida corta y nunca es la clave del agente ni la passkey.
        const p = await verifyToken(url.searchParams.get("token") ?? "", env.TOKEN_SECRET);
        if (!p) return json({ error: "unauthorized" }, 401, h);
        // Un agente de parcela con la clave revocada (o el proyecto retirado) no vuelve a entrar
        // aunque su token aún no haya caducado.
        if (p.zone && !(await directory(env).agentKeyAlive(p.sub.replace(/^agt_/, "")))) {
          return json({ error: "unauthorized", message: "tu clave de agente ya no vale" }, 401, h);
        }
        if (await closedFor(env, chunkId, p)) return json(SOON, 403, h);
        headers.set("X-Principal", JSON.stringify(p));
        headers.set("Upgrade", "websocket");
        return stub.fetch(new Request("https://do/ws", { headers }));
      }

      return json({ error: "not_found" }, 404, h);
    } catch (e) {
      if ((e as Error).message === "too_large") return json({ error: "too_large" }, 413, h);
      console.error(e);
      return json({ error: "internal", message: "error interno" }, 500, h);
    }
  },
} satisfies ExportedHandler<Env>;
