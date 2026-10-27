/**
 * El servidor de distritos: el mismo chunk (ChunkRoom) que en Cloudflare, corriendo con workerd en
 * una máquina propia (docs/ALOJAMIENTO-DISTRITOS.md, tools/district-host/). Solo atiende los chunks
 * de `HOSTED_CHUNKS` y no guarda ningún secreto: comprueba con la clave PÚBLICA lo que firma el
 * Worker de Cloudflare (pases para entrar y llamadas; ver remote.ts).
 *
 *   GET  /health                       → "ok"
 *   GET  /chunk/<id>/state             → estado público del chunk
 *   GET  /chunk/<id>/ws?ticket=<pase>  → WebSocket del chunk (el pase dice quién entra)
 *   POST /rpc/<id>/<método>            → llamada firmada del Worker (cabecera X-Xenxo-Call)
 *
 * Las medidas de los modelos de la gente se piden al Worker (ASSETS_URL); los modelos del
 * sistema van dentro del código, como en Cloudflare.
 */
import type { ChunkRoom } from "./chunk-room";
import { chunkList, REMOTE_METHODS, sha256B64, verifyRemote, type RemoteCall, type Ticket } from "./remote";

export { ChunkRoom } from "./chunk-room";

export interface HostEnv {
  CHUNK: DurableObjectNamespace<ChunkRoom>;
  /** Clave pública Ed25519 (JWK) del Worker de Cloudflare. */
  DISTRICT_PUBLIC_KEY: string;
  /** Chunks que atiende este servidor (separados por comas). */
  HOSTED_CHUNKS: string;
  /** Worker de Cloudflare, para las medidas de los modelos (https://api.xenxo.io). */
  ASSETS_URL: string;
}

const MAX_RPC_BYTES = 64 * 1024;
/** Mover un distrito entero (loadState) puede pesar más. */
const MAX_LOAD_BYTES = 16 * 1024 * 1024;

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
}

type Stub = DurableObjectStub<ChunkRoom> & Record<string, (...a: unknown[]) => Promise<unknown>> & { bind(id: string): Promise<void> };

function stubOf(env: HostEnv, id: string): Stub {
  return env.CHUNK.get(env.CHUNK.idFromName(id)) as unknown as Stub;
}

export default {
  async fetch(req: Request, env: HostEnv): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === "/health") return new Response("ok");

    const hosted = chunkList(env.HOSTED_CHUNKS);

    const c = path.match(/^\/chunk\/([^/]+)\/(ws|state)$/);
    if (c) {
      const id = decodeURIComponent(c[1]!);
      if (!hosted.has(id)) return json({ error: "not_found", message: "este servidor no tiene ese chunk" }, 404);
      const headers = new Headers({ "X-Chunk-Id": id });
      if (c[2] === "state") {
        const r = await stubOf(env, id).fetch(new Request("https://do/state", { headers }));
        return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=15" } });
      }
      if (req.headers.get("Upgrade") !== "websocket") return json({ error: "se esperaba WebSocket" }, 426);
      const t = await verifyRemote<Ticket>(env.DISTRICT_PUBLIC_KEY, url.searchParams.get("ticket") ?? "");
      if (!t || t.typ !== "ticket" || t.chunk !== id || !t.principal) return json({ error: "unauthorized", message: "pase no válido o caducado" }, 401);
      headers.set("X-Principal", JSON.stringify(t.principal));
      headers.set("Upgrade", "websocket");
      return stubOf(env, id).fetch(new Request("https://do/ws", { headers }));
    }

    const r = path.match(/^\/rpc\/([^/]+)\/([A-Za-z]+)$/);
    if (r && req.method === "POST") {
      const id = decodeURIComponent(r[1]!);
      const method = r[2]!;
      if (!hosted.has(id) || !REMOTE_METHODS.has(method)) return json({ error: "not_found" }, 404);
      const body = await req.text();
      if (body.length > (method === "loadState" ? MAX_LOAD_BYTES : MAX_RPC_BYTES)) return json({ error: "too_large" }, 413);
      const call = await verifyRemote<RemoteCall>(env.DISTRICT_PUBLIC_KEY, req.headers.get("X-Xenxo-Call") ?? "");
      if (!call || call.typ !== "rpc" || call.chunk !== id || call.method !== method || call.body !== (await sha256B64(body))) {
        return json({ error: "unauthorized" }, 401);
      }
      const args = JSON.parse(body) as unknown[];
      if (!Array.isArray(args)) return json({ error: "bad_request" }, 400);
      const stub = stubOf(env, id);
      await stub.bind(id);
      const out = await stub[method]!(...args);
      return json(out ?? null);
    }

    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<HostEnv>;
