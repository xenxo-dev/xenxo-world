# Servidor de distritos con workerd (docs/ALOJAMIENTO-DISTRITOS.md, tools/district-host/README.md).
# Va en la misma carpeta que district-host.js (npm run build:district-host). Arranque:
#   workerd serve distritos.capnp --experimental
# Las variables (NODE_ID, DISTRICT_PUBLIC_KEY, HOSTED_CHUNKS, ASSETS_URL) vienen del entorno (el servicio de
# systemd las lee de /etc/xenxo-distritos.env). Los datos de cada distrito (SQLite) van en DATOS.
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "distritos", worker = .distritos),
    (name = "datos", disk = (path = "/var/lib/xenxo-distritos/datos", writable = true)),
    # Salida a internet solo para pedir al Worker de Cloudflare las medidas de los modelos.
    (name = "internet", network = (allow = ["public"], tlsOptions = (trustBrowserCas = true))),
  ],
  # Solo en la máquina: el túnel de Cloudflare (cloudflared) es lo único que entra aquí.
  sockets = [ (name = "http", address = "127.0.0.1:8788", http = (), service = "distritos") ],
);

const distritos :Workerd.Worker = (
  modules = [ (name = "district-host.js", esModule = embed "district-host.js") ],
  compatibilityDate = "2026-10-01",
  durableObjectNamespaces = [ (className = "ChunkRoom", uniqueKey = "xenxo-distritos-chunk", enableSql = true) ],
  durableObjectStorage = (localDisk = "datos"),
  globalOutbound = "internet",
  bindings = [
    (name = "CHUNK", durableObjectNamespace = "ChunkRoom"),
    (name = "DISTRICT_PUBLIC_KEY", fromEnvironment = "DISTRICT_PUBLIC_KEY"),
    (name = "HOSTED_CHUNKS", fromEnvironment = "HOSTED_CHUNKS"),
    (name = "ASSETS_URL", fromEnvironment = "ASSETS_URL"),
    (name = "NODE_ID", fromEnvironment = "NODE_ID"),
  ],
);
