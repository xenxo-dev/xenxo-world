import { ChunkId } from "@xenxo/protocol";
import { assetMeta, assetKey, handleGet, handleUpload } from "./assets";
import { randomId, resolveAgent, signToken, verifyToken, type Principal } from "./auth";
import type { ChunkRoom } from "./chunk-room";
import type { Directory, UserRow } from "./directory";

export { ChunkRoom } from "./chunk-room";
export { Directory } from "./directory";

export interface Env {
  CHUNK: DurableObjectNamespace<ChunkRoom>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  ASSETS: R2Bucket;
  TOKEN_SECRET: string;
  AGENT_KEYS?: string;
  ALLOWED_ORIGINS?: string;
  /** Dominio de las passkeys (p. ej. "xenxo.io"; "localhost" en desarrollo). */
  RP_ID?: string;
  /** "eu" para que los datos se guarden y procesen solo en la UE. Vacío = sin restricción. */
  DO_JURISDICTION?: string;
  /** Cuenta de GitHub cuyos repos públicos muestra el panel. */
  GITHUB_OWNER?: string;
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
/** La exposición de proyectos vive, por ahora, en la plaza central. */
const EXPO_CHUNK = "c_0_0";

function inJurisdiction<T extends Rpc.DurableObjectBranded | undefined>(env: Env, ns: DurableObjectNamespace<T>): DurableObjectNamespace<T> {
  return env.DO_JURISDICTION === "eu" || env.DO_JURISDICTION === "fedramp" ? ns.jurisdiction(env.DO_JURISDICTION) : ns;
}

/** Vista RPC con los tipos de retorno originales (sin los envoltorios de serialización de RPC). */
type Api<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };

function chunk(env: Env, id: string) {
  const ns = inJurisdiction(env, env.CHUNK);
  return ns.get(ns.idFromName(id)) as unknown as Api<ChunkRoom> & { fetch(r: Request): Promise<Response> };
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

      /* --- Assets --- */
      const asset = path.match(/^\/assets\/([0-9a-f]{64})$/);
      if (asset && (req.method === "GET" || req.method === "HEAD")) return handleGet(asset[1]!, env.ASSETS, req);
      if (path === "/assets" && req.method === "POST") {
        const p = await bearer(req, env);
        if (!p) return json({ error: "unauthorized", message: "inicia sesión para subir modelos" }, 401, h);
        const allowed = await dir.canUpload(p.sub);
        if (!allowed.ok) return failure(allowed, h);
        const r = await handleUpload(req, p, env.ASSETS);
        if (!r.ok) return failure(r, h);
        await dir.recordUpload(p.sub, r.data.hash, r.data.kind);
        return json(r.data, 201, h);
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
          evidence = await chunk(env, EXPO_CHUNK).chatMessage(body.target_id);
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
        if (path === "/me" && req.method === "PATCH") {
          const r = await dir.rename(uid, (await readJson(req)).display_name);
          return r.ok ? json(await userToken(r.data, env), 200, h) : failure(r, h);
        }
        if (path === "/me/avatar" && req.method === "POST") {
          const { hash } = await readJson(req);
          let format: "glb" | "vrm" = "glb";
          if (hash !== null) {
            const meta = typeof hash === "string" ? await assetMeta(env.ASSETS, hash) : null;
            if (!meta || meta.kind !== "avatar") return json({ error: "not_found", message: "ese avatar no existe" }, 404, h);
            format = meta.format;
          }
          const r = await dir.setAvatar(uid, hash, format);
          return r.ok ? json(await userToken(r.data, env), 200, h) : failure(r, h);
        }
        if (path === "/me/export" && req.method === "GET") {
          const r = await dir.exportData(uid);
          if (!r.ok) return failure(r, h);
          const chat = await chunk(env, EXPO_CHUNK).chatOf(`usr_${uid}`);
          return json({ ...r.data, chat_messages: chat }, 200, {
            ...h,
            "Content-Disposition": 'attachment; filename="xenxo-mis-datos.json"',
          });
        }
        if (path === "/me" && req.method === "DELETE") {
          const r = await dir.deleteAccount(uid);
          if (!r.ok) return failure(r, h);
          const room = chunk(env, EXPO_CHUNK);
          for (const id of r.data.projectIds) await room.removeStand(id);
          await room.purgeOwner(`usr_${uid}`);
          for (const hash of r.data.orphanHashes) await env.ASSETS.delete(assetKey(hash));
          return json({ deleted: true, assets_removed: r.data.orphanHashes.length }, 200, h);
        }
      }

      if (path === "/projects" && req.method === "POST") {
        if (!uid) return json({ error: "unauthorized", message: "inicia sesión para publicar un proyecto" }, 401, h);
        const r = await dir.createProject(uid, await readJson(req));
        if (!r.ok) return failure(r, h);
        const project = r.data;
        const meta = project.mesh_hash ? await assetMeta(env.ASSETS, project.mesh_hash) : null;
        const placed = await chunk(env, EXPO_CHUNK).placeStand({
          projectId: project.id,
          owner: `usr_${uid}`,
          title: project.title,
          ...(project.mesh_hash ? { mesh: { hash: project.mesh_hash, bounds: meta?.bounds ?? null } } : {}),
        });
        if (placed.ok) await dir.setInWorld(project.id, true);
        return json({ project: { ...project, in_world: placed.ok }, stand: placed }, 201, h);
      }

      const proj = path.match(/^\/projects\/([a-zA-Z0-9_-]{4,40})$/);
      if (proj && req.method === "DELETE") {
        if (!principal) return json({ error: "unauthorized" }, 401, h);
        const owner = await dir.projectOwner(proj[1]!);
        if (!owner) return json({ error: "not_found" }, 404, h);
        if (owner !== uid && !isAdmin) return json({ error: "forbidden", message: "solo su autor puede borrarlo" }, 403, h);
        await chunk(env, EXPO_CHUNK).removeStand(proj[1]!);
        await dir.deleteProject(proj[1]!);
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
          return json({ hidden: await chunk(env, EXPO_CHUNK).hideChat(hideChat[1]!) }, 200, h);
        }
        const hide = path.match(/^\/admin\/projects\/([a-zA-Z0-9_-]{4,40})\/hide$/);
        if (hide && req.method === "POST") {
          await chunk(env, EXPO_CHUNK).removeStand(hide[1]!);
          return json({ hidden: await dir.hideProject(hide[1]!) }, 200, h);
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
