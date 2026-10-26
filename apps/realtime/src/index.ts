import { ASSET_BUDGETS } from "@xenxo/assets";
import { ChunkId, PLACES } from "@xenxo/protocol";
import { assetMeta, assetKey, handleGet, handleUpload } from "./assets";
import { isAvatarPreset } from "./avatar-presets-check";
import { randomId, resolveAgent, signToken, verifyToken, type Principal } from "./auth";
import type { ChunkRoom, ShowcaseItem } from "./chunk-room";
import { DISTRICTS, districtById, parcelIndex, parcelSpawn } from "./districts";
import { SHOWCASE_SLOTS } from "./nexo";
import type { Directory, UserRow } from "./directory";

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
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      }
    : {};
}

function json(data: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
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

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (!env.TOKEN_SECRET) return json({ error: "TOKEN_SECRET no configurado" }, 500, h);

    try {
      if (path === "/health") return json({ ok: true, protocol: 0 }, 200, h);

      if (path === "/github/repos" && req.method === "GET") {
        const r = await githubRepos(env, ctx);
        return new Response(r.body, { status: r.status, headers: { ...Object.fromEntries(r.headers), ...h } });
      }

      /* --- Invitados y agentes --- */
      if (path === "/auth/guest" && req.method === "POST") {
        const p: Principal = { sub: randomId("g_"), kind: "guest", scopes: [], exp: Date.now() + GUEST_TTL_MS };
        return json({ token: await signToken(p, env.TOKEN_SECRET), principal: p }, 200, h);
      }
      if (path === "/auth/agent" && req.method === "POST") {
        const key = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
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
        return json(r.data, 200, h);
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
        return new Response(null, { status: 302, headers: { Location: googleUrl(env, req, r.data), "Cache-Control": "no-store" } });
      }
      if (path === "/auth/google/callback" && req.method === "GET") {
        const q = url.searchParams;
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
      const asset = path.match(/^\/assets\/([0-9a-f]{64})$/);
      if (asset && (req.method === "GET" || req.method === "HEAD")) return handleGet(asset[1]!, env.ASSETS, req, ctx, env.STATIC);
      if (path === "/assets" && req.method === "POST") {
        const p = await bearer(req, env);
        if (!p) return json({ error: "unauthorized", message: "inicia sesión para subir modelos" }, 401, h);
        const allowed = await dir.canUpload(p.sub);
        if (!allowed.ok) return failure(allowed, h);
        const r = await handleUpload(req, p, env.ASSETS);
        if (!r.ok) return failure(r, h);
        await dir.recordUpload(p.sub, r.data.hash, r.data.kind, r.data.bytes);
        return json(r.data, 201, h);
      }

      /* --- Distritos y parcelas (lectura pública) --- */
      if (path === "/districts" && req.method === "GET") {
        return json({ districts: await dir.districts() }, 200, { ...h, "Cache-Control": "public, max-age=10" });
      }

      /* --- Proyectos (lectura pública) --- */
      if (path === "/projects" && req.method === "GET") {
        return json({ projects: await dir.listProjects() }, 200, { ...h, "Cache-Control": "public, max-age=10" });
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
          const { hash } = await readJson(req);
          let format: "glb" | "vrm" = "glb";
          if (hash !== null && typeof hash === "string" && isAvatarPreset(hash)) {
            format = "vrm"; // avatar de serie
          } else if (hash !== null) {
            const meta = typeof hash === "string" ? await assetMeta(env.ASSETS, hash) : null;
            if (!meta || meta.kind !== "avatar" || meta.format === "image") return json({ error: "not_found", message: "ese avatar no existe" }, 404, h);
            format = meta.format;
          }
          const r = await dir.setAvatar(uid, hash, format);
          return r.ok ? json(await userToken(r.data, env), 200, h) : failure(r, h);
        }
        /* Formas de entrar: más passkeys, Google */
        if (path === "/me/logins" && req.method === "GET") {
          return json({ ...(await dir.logins(uid)), google_available: googleEnabled(env) }, 200, h);
        }
        if (path === "/me/logins/google" && req.method === "POST") {
          if (!googleEnabled(env)) return json({ error: "google_disabled", message: "Entrar con Google no está activado" }, 503, h);
          const r = await dir.googleStart({ mode: "link", userId: uid, origin: webOrigin(env, req.headers.get("Origin")) });
          return r.ok ? json({ url: googleUrl(env, req, r.data) }, 200, h) : failure(r, h);
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
        if (path === "/me" && req.method === "DELETE") {
          const r = await dir.deleteAccount(uid);
          if (!r.ok) return failure(r, h);
          for (const p of r.data.projects) {
            const c = districtChunk(p.district);
            if (c) await chunk(env, c).removeStand(p.id);
          }
          for (const c of CHAT_CHUNKS) await chunk(env, c).purgeOwner(`usr_${uid}`);
          await syncShowcase(env, dir);
          for (const hash of r.data.orphanHashes) await env.ASSETS.delete(assetKey(hash));
          return json({ deleted: true, assets_removed: r.data.orphanHashes.length }, 200, h);
        }
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
      if (proj && req.method === "DELETE") {
        if (!principal) return json({ error: "unauthorized" }, 401, h);
        const owner = await dir.projectOwner(proj[1]!);
        if (!owner) return json({ error: "not_found" }, 404, h);
        if (owner !== uid && !isAdmin) return json({ error: "forbidden", message: "solo su autor puede borrarlo" }, 403, h);
        const place = await dir.projectPlace(proj[1]!);
        const c = districtChunk(place?.district);
        if (c) await chunk(env, c).removeStand(proj[1]!);
        await dir.deleteProject(proj[1]!);
        ctx.waitUntil(syncShowcase(env, dir));
        return json({ deleted: true }, 200, h);
      }

      /* --- Moderación (agentes con scope admin) --- */
      if (path.startsWith("/admin/")) {
        if (!isAdmin) return json({ error: "forbidden" }, 403, h);
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
          const c = districtChunk(place?.district);
          if (c) await chunk(env, c).removeStand(hide[1]!);
          const hidden = await dir.hideProject(hide[1]!);
          ctx.waitUntil(syncShowcase(env, dir));
          return json({ hidden }, 200, h);
        }
      }

      /* --- Chunks --- */
      const m = path.match(/^\/chunk\/([^/]+)\/(ws|state)$/);
      if (m) {
        const chunkId = m[1]!;
        if (!ChunkId.safeParse(chunkId).success) return json({ error: "chunk inválido" }, 400, h);
        const stub = chunk(env, chunkId);
        const headers = new Headers({ "X-Chunk-Id": chunkId });

        if (m[2] === "state") {
          // Lectura pública y ligera para el panel 2D (no abre WebSocket).
          const r = await stub.fetch(new Request("https://do/state", { headers }));
          return new Response(r.body, { status: r.status, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "public, max-age=5" } });
        }

        if (req.headers.get("Upgrade") !== "websocket") return json({ error: "se esperaba WebSocket" }, 426, h);
        // El token va en la query porque los navegadores no permiten cabeceras en WebSocket.
        // Es de vida corta y nunca es la clave del agente ni la passkey.
        const p = await verifyToken(url.searchParams.get("token") ?? "", env.TOKEN_SECRET);
        if (!p) return json({ error: "unauthorized" }, 401, h);
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
