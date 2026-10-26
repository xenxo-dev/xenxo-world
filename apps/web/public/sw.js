/*
 * Service worker de xenxo.io (PWA). Solo toca peticiones GET de este mismo origen; la API, el
 * tiempo real y los assets del mundo van a otro origen y no pasan por aquí.
 *
 * - Páginas: primero la red (así las actualizaciones llegan al momento); sin red, la última copia.
 * - /assets/* (con hash, inmutables): primero la caché. No se borran al actualizar, para que una
 *   pestaña abierta con la versión anterior pueda seguir cargando sus trozos.
 * - Texturas, cielo, animaciones, avatares de serie e iconos: la copia guardada al instante y se
 *   refresca por detrás.
 * Todo queda en el dispositivo de la persona; no hay datos personales en estas cachés.
 */
const SHELL = "xenxo-shell-v1";
const ASSETS = "xenxo-assets-v1";
const MEDIA = "xenxo-media-v1";
const KEEP = [SHELL, ASSETS, MEDIA];
const LIMITS = { [ASSETS]: 300, [MEDIA]: 250 };

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/favicon.svg"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("xenxo-") && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(name) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  const extra = keys.length - (LIMITS[name] ?? Infinity);
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

async function put(name, req, res) {
  if (!res || !res.ok || res.type !== "basic") return;
  const cache = await caches.open(name);
  await cache.put(req, res);
  await trim(name);
}

async function networkFirst(event) {
  try {
    const res = await fetch(event.request);
    // La SPA es siempre el mismo index.html: con una copia basta (solo rutas de la app, sin
    // extensión, y solo si es HTML).
    const html = (res.headers.get("content-type") || "").includes("text/html");
    if (res.ok && html && !/\.[a-z0-9]+$/i.test(new URL(event.request.url).pathname)) event.waitUntil(put(SHELL, "/", res.clone()));
    return res;
  } catch {
    return (await caches.match("/", { cacheName: SHELL })) ?? Response.error();
  }
}

async function cacheFirst(event, name) {
  const hit = await caches.match(event.request, { cacheName: name });
  if (hit) return hit;
  const res = await fetch(event.request);
  event.waitUntil(put(name, event.request, res.clone()));
  return res;
}

async function staleWhileRevalidate(event, name) {
  const hit = await caches.match(event.request, { cacheName: name });
  const fresh = fetch(event.request).then((res) => {
    event.waitUntil(put(name, event.request, res.clone()));
    return res;
  });
  if (hit) {
    event.waitUntil(fresh.catch(() => {}));
    return hit;
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Rangos (vídeo, audio) y lo que no es de la app: directo a la red.
  if (req.headers.has("range")) return;
  const p = url.pathname;
  if (p === "/sw.js" || p.startsWith("/sdk/") || p.startsWith("/legal/") || p.startsWith("/mcp/")) return;

  if (req.mode === "navigate") return event.respondWith(networkFirst(event));
  if (p.startsWith("/assets/")) return event.respondWith(cacheFirst(event, ASSETS));
  if (/^\/(materials|sky|anims|avatars|covers|icons)\//.test(p) || p === "/favicon.svg" || p === "/manifest.webmanifest") {
    return event.respondWith(staleWhileRevalidate(event, MEDIA));
  }
});
