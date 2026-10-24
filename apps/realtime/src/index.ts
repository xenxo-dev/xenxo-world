import { ChunkId } from "@xenxo/protocol";
import { randomId, resolveAgent, signToken, verifyToken, type Principal } from "./auth";
import type { ChunkRoom } from "./chunk-room";

export { ChunkRoom } from "./chunk-room";

export interface Env {
  CHUNK: DurableObjectNamespace<ChunkRoom>;
  TOKEN_SECRET: string;
  AGENT_KEYS?: string;
  ALLOWED_ORIGINS?: string;
}

const GUEST_TTL_MS = 60 * 60 * 1000;
const AGENT_TTL_MS = 15 * 60 * 1000;

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());
  return allowed.includes(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        Vary: "Origin",
      }
    : {};
}

function json(data: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const h = cors(req, env);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (!env.TOKEN_SECRET) return json({ error: "TOKEN_SECRET no configurado" }, 500, h);

    if (url.pathname === "/health") return json({ ok: true, protocol: 0 }, 200, h);

    // --- Autenticación ---
    if (url.pathname === "/auth/guest" && req.method === "POST") {
      const p: Principal = { sub: randomId("g_"), kind: "guest", scopes: [], exp: Date.now() + GUEST_TTL_MS };
      return json({ token: await signToken(p, env.TOKEN_SECRET), principal: p }, 200, h);
    }

    if (url.pathname === "/auth/agent" && req.method === "POST") {
      const key = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const agent = await resolveAgent(key, env.AGENT_KEYS);
      if (!agent) return json({ error: "unauthorized" }, 401, h);
      const p: Principal = { sub: `agt_${agent.id}`, kind: "agent", scopes: agent.scopes, exp: Date.now() + AGENT_TTL_MS };
      return json({ token: await signToken(p, env.TOKEN_SECRET), principal: p }, 200, h);
    }

    // --- Chunks ---
    const m = url.pathname.match(/^\/chunk\/([^/]+)\/(ws|state)$/);
    if (m) {
      const chunkId = m[1]!;
      if (!ChunkId.safeParse(chunkId).success) return json({ error: "chunk inválido" }, 400, h);
      const stub = env.CHUNK.get(env.CHUNK.idFromName(chunkId));
      const headers = new Headers({ "X-Chunk-Id": chunkId });

      if (m[2] === "state") {
        // Lectura pública y ligera para el panel 2D (no abre WebSocket).
        const r = await stub.fetch(new Request("https://do/state", { headers }));
        return new Response(r.body, { status: r.status, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "public, max-age=5" } });
      }

      if (req.headers.get("Upgrade") !== "websocket") return json({ error: "se esperaba WebSocket" }, 426, h);
      // El token va en la query porque los navegadores no permiten cabeceras en WebSocket.
      // Es de vida corta y no la clave del agente.
      const principal = await verifyToken(url.searchParams.get("token") ?? "", env.TOKEN_SECRET);
      if (!principal) return json({ error: "unauthorized" }, 401, h);
      headers.set("X-Principal", JSON.stringify(principal));
      headers.set("Upgrade", "websocket");
      return stub.fetch(new Request("https://do/ws", { headers }));
    }

    return json({ error: "not_found" }, 404, h);
  },
} satisfies ExportedHandler<Env>;
