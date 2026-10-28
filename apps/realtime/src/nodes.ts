/**
 * Nodos: servidores de distritos de la comunidad (fase 1, docs/guia/es/servidor.md).
 *
 * Un nodo corre el mismo ChunkRoom con workerd (district-host.ts) y atiende los distritos que
 * moderación le asigna desde el panel (/mod/nodes). Lo que no sale nunca de Cloudflare: cuentas,
 * «Entrar con xenxo», moderación, archivos, la web, el nexo y la plaza.
 *
 *   - Encaminar: el registro (Directory: nodes + chunk_hosts) dice qué distrito atiende cada nodo.
 *     El Worker lo guarda 30 s en memoria y en la caché del centro de datos (no despierta al
 *     Directory en cada petición).
 *   - Salud: antes de dar un pase se pregunta al nodo quién es (/node), con memoria de unos segundos.
 *     Si no responde, el visitante recibe `district_unavailable` en vez de un WebSocket que no llega.
 *   - Copias: cada pocos minutos (cron) se mira la huella de cada distrito en su nodo (stateRev) y,
 *     si cambió, se guarda su volcado en R2 (nodes/snapshots/<chunk>.json, uno por distrito).
 *   - Relevo: tras NODE_FAILS_TO_FALLBACK comprobaciones fallidas seguidas, los distritos del nodo
 *     vuelven a Cloudflare con su última copia (estado `fallback`). La vuelta al nodo es a mano,
 *     desde el panel: así nunca hay dos sitios escribiendo el mismo distrito.
 */
import type { NodeRoutes } from "./directory";

export const ROUTES_TTL_MS = 30_000;
/** Sin ningún nodo, las rutas se vuelven a mirar cada 5 minutos (el alta de un nodo las borra al momento aquí). */
const EMPTY_TTL_MS = 300_000;
const isEmpty = (r: NodeRoutes) => Object.keys(r.nodes).length === 0;
const ttlOf = (r: NodeRoutes) => (isEmpty(r) ? EMPTY_TTL_MS : ROUTES_TTL_MS);
const ROUTES_KEY = "https://xenxo-cache.local/node-routes";
const EMPTY: NodeRoutes = { nodes: {}, chunks: {} };

let mem: { at: number; routes: NodeRoutes } | null = null;

/** Las rutas que se cargaron por última vez (vacías si aún no). Síncrono: lo usa chunk(env, id). */
export function currentRoutes(): NodeRoutes {
  return mem?.routes ?? EMPTY;
}

function edgeCache(): Cache | undefined {
  return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
}

/** Carga las rutas si las de memoria tienen más de 30 s: primero la caché del centro de datos, luego el Directory. */
export async function loadRoutes(fresh: () => Promise<NodeRoutes>, force = false): Promise<NodeRoutes> {
  if (!force && mem && Date.now() - mem.at < ttlOf(mem.routes)) return mem.routes;
  const cache = edgeCache();
  if (!force && cache) {
    const hit = await cache.match(ROUTES_KEY).catch(() => undefined);
    if (hit) {
      try {
        mem = { at: Date.now(), routes: (await hit.json()) as NodeRoutes };
        return mem.routes;
      } catch {
        /* caché rota: se pide de nuevo */
      }
    }
  }
  const routes = await fresh();
  mem = { at: Date.now(), routes };
  if (cache) {
    await cache
      .put(ROUTES_KEY, new Response(JSON.stringify(routes), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttlOf(routes) / 1000}` } }))
      .catch(() => {});
  }
  return routes;
}

/** Tras cambiar el registro: se olvida aquí y en la caché de este centro de datos (los demás tardan como mucho 30 s, o 5 min si aún no había nodos). */
export async function forgetRoutes(): Promise<void> {
  mem = null;
  await edgeCache()?.delete(ROUTES_KEY).catch(() => false);
}

const health = new Map<string, { at: number; ok: boolean; chunks: string[] }>();
const OK_TTL_MS = 15_000;
const FAIL_TTL_MS = 5_000;
const CHECK_TIMEOUT_MS = 2_500;

/**
 * ¿Responde el nodo y es quien dice ser? (GET <url>/node → { id }). Se recuerda unos segundos para
 * no preguntar en cada pase. `force` pregunta siempre (cron, alta y traslados).
 */
export async function nodeAlive(id: string, url: string, force = false): Promise<{ ok: boolean; chunks: string[] }> {
  const prev = health.get(id);
  if (!force && prev && Date.now() - prev.at < (prev.ok ? OK_TTL_MS : FAIL_TTL_MS)) return prev;
  let out = { ok: false, chunks: [] as string[] };
  try {
    const r = await fetch(`${url.replace(/\/+$/, "")}/node`, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), headers: { Accept: "application/json" } });
    if (r.ok) {
      const j = (await r.json()) as { id?: unknown; chunks?: unknown };
      out = { ok: j.id === id, chunks: Array.isArray(j.chunks) ? j.chunks.filter((c): c is string => typeof c === "string") : [] };
    }
  } catch {
    /* no responde */
  }
  health.set(id, { at: Date.now(), ...out });
  if (health.size > 200) health.clear();
  return out;
}

/** ¿Acepta el nodo este chunk? (su HOSTED_CHUNKS: la lista, o «*»). */
export function nodeAccepts(chunks: string[], chunkId: string): boolean {
  return chunks.some((c) => c === "*" || c === chunkId || (c.endsWith("*") && c.length > 1 && chunkId.startsWith(c.slice(0, -1))));
}

/** Dirección de un nodo: https a cualquier sitio; http solo a la propia máquina y solo en local. */
export function nodeUrl(raw: unknown, local: boolean): string | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash) return null;
  const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:" && loopback)) return null;
  if (!local && loopback) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

/** Dónde se guarda la última copia de un distrito de un nodo. */
export const snapshotKey = (chunkId: string) => `nodes/snapshots/${chunkId}.json`;

/** La clave pública que reparten los nodos (la parte pública del JWK privado del Worker). */
export function publicJwk(privateJwk: string): { kty: string; crv: string; x: string } | null {
  try {
    const { kty, crv, x } = JSON.parse(privateJwk) as { kty?: string; crv?: string; x?: string };
    return kty === "OKP" && crv === "Ed25519" && typeof x === "string" ? { kty, crv, x } : null;
  } catch {
    return null;
  }
}
