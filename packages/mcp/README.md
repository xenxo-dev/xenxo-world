# Servidor MCP de xenxo

Deja que tu agente (Claude Code, Cursor o cualquier cliente MCP) construya en la **parcela de tu
proyecto** en [xenxo.io](https://xenxo.io). Le describes lo que quieres y lo construye: suelos,
paredes, rótulos de neón, una luz y tus propios modelos `.glb`. *(English below.)*

Es un cliente más del protocolo de xenxo: entra con una **clave de parcela** y todo lo que hace pasa
por la misma puerta que cualquiera (`MUTATE_WORLD`), con las mismas reglas. La clave solo sirve
para tu parcela (15 × 15 m y 12 m de alto) y la puedes revocar cuando quieras.

## 1. Saca tu clave

En xenxo.io → **Proyectos** → tu proyecto → **Construir con tu agente** → *Crear clave*. Empieza
por `xk_` y solo se enseña una vez: guárdala como una contraseña. El proyecto tiene que estar
publicado en una parcela.

## 2. Descarga el servidor

Un solo archivo, sin instalar nada más (necesitas Node.js 22 o más nuevo; vale desde el 20):

```sh
curl -o ~/xenxo-mcp.mjs https://xenxo.io/mcp/xenxo-mcp.mjs
```

En Windows (PowerShell): `Invoke-WebRequest https://xenxo.io/mcp/xenxo-mcp.mjs -OutFile $HOME\xenxo-mcp.mjs`.

## 3. Conéctalo a tu agente

**Claude Code** (`--scope user`: así está en todas tus carpetas, no solo en la que lo añades)

```sh
claude mcp add --scope user xenxo -e XENXO_KEY=xk_tu_clave -- node ~/xenxo-mcp.mjs
```

En Windows, con la ruta entera (PowerShell no cambia `~` al llamar a otros programas):

```powershell
claude mcp add --scope user xenxo -e XENXO_KEY=xk_tu_clave -- node C:\Users\tu-usuario\xenxo-mcp.mjs
```

Compruébalo con `claude mcp list`: tiene que salir `xenxo … Connected`.

**Cursor** (`~/.cursor/mcp.json`, con la ruta entera al archivo)

```json
{
  "mcpServers": {
    "xenxo": { "command": "node", "args": ["/home/tu-usuario/xenxo-mcp.mjs"], "env": { "XENXO_KEY": "xk_tu_clave" } }
  }
}
```

Y pídele algo: *«mira mi parcela de xenxo y móntame una tienda de neón con un mostrador y un rótulo
que diga ABIERTO»*.

**Si algo falla:** sin clave (o sin `xk_` delante) el servidor se para y lo dice; con una clave
revocada o de un proyecto que ya no está publicado, las herramientas responden `xenxo no acepta la
clave (401…)`: crea otra. Si estás detrás de un proxy y sale `fetch failed`, añade
`-e NODE_USE_ENV_PROXY=1` al `claude mcp add` (Node 22.21 o más nuevo) para que use `HTTPS_PROXY`.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `get_parcel` | Tu parcela: tamaño, altura máxima, presupuesto usado y lo que hay construido. **Llámala primero** |
| `place_shape` | Caja, esfera, cilindro o plano (color, acabado, brillo, sólido o no) |
| `place_label` | Rótulo de texto, normal o de neón |
| `place_light` | Una luz puntual (una por parcela) |
| `upload_model` | Optimiza y sube un `.glb` de tu equipo. **Solo de dentro de la carpeta donde corre el servidor** (con Claude Code, la carpeta en la que lo abres): copia ahí el modelo |
| `place_model` | Coloca un modelo subido, apoyado en el suelo |
| `update_piece` | Mueve, gira, escala, pinta o cambia el texto de una pieza |
| `remove_pieces` | Quita piezas (o todas) |

Coordenadas en metros, de la parcela, mirando desde la calle: `x` de 0 (izquierda) a 15 (derecha),
`z` de 0 (la calle) a 15 (el fondo, donde está el portal de tu proyecto) e `y` hacia arriba, hasta
12 m. Las medidas exactas las da `get_parcel` (`size`): úsalas en vez de suponerlas. El portal ocupa
el fondo: el servidor deja libre la zona `x` 5–10, `z` 6,9–15 por debajo de 3,6 m (el marco, la peana
y la franja que abre la ficha; un suelo plano de hasta 10 cm sí vale). Se llega desde la calle,
mirando al portal.

Presupuesto de una parcela: 48 piezas, 24.000 triángulos y 1 luz.

`XENXO_URL` (opcional; por defecto `https://api.xenxo.io`) tiene que ser `https://`: la clave viaja en
cada petición. Solo `localhost` y `127.0.0.1` pueden ir por `http://`, para desarrollar.

## Desarrollo

```sh
npm run build -w @xenxo/mcp          # dist/xenxo-mcp.mjs (un solo archivo)
XENXO_KEY=xk_… XENXO_URL=http://localhost:8787 npm start -w @xenxo/mcp
npm run mcp-e2e -w @xenxo/headless   # prueba de punta a punta contra el servidor local
```

Licencia MIT: tu agente y lo que hagas con él son tuyos.

---

## English

Lets your agent (Claude Code, Cursor or any MCP client) build on **your project's plot** on
[xenxo.io](https://xenxo.io): floors, walls, neon signs, one light and your own `.glb` models. It is
an ordinary protocol client: it signs in with a **plot key** and everything goes through
`MUTATE_WORLD` with the same rules as everyone else. The key only works on your plot (15 × 15 m,
12 m high) and you can revoke it at any time.

1. **Get your key:** xenxo.io → **Projects** → your project → **Build with your agent** → *Create key*.
   It starts with `xk_` and is shown only once. The project must be published on a plot.
2. **Download the server** (one file; Node.js 22 or newer, 20 works):
   `curl -o ~/xenxo-mcp.mjs https://xenxo.io/mcp/xenxo-mcp.mjs`
   (Windows PowerShell: `Invoke-WebRequest https://xenxo.io/mcp/xenxo-mcp.mjs -OutFile $HOME\xenxo-mcp.mjs`).
3. **Connect it.** Claude Code, available in every folder:
   `claude mcp add --scope user xenxo -e XENXO_KEY=xk_your_key -- node ~/xenxo-mcp.mjs`
   (on Windows use the full path, e.g. `node C:\Users\you\xenxo-mcp.mjs`), then check
   `claude mcp list` shows `xenxo … Connected`. Cursor: in `~/.cursor/mcp.json`,
   `{ "mcpServers": { "xenxo": { "command": "node", "args": ["/full/path/xenxo-mcp.mjs"], "env": { "XENXO_KEY": "xk_your_key" } } } }`.

Then ask: *"look at my xenxo plot and build me a neon shop with a counter and a sign saying OPEN"*.

**Coordinates** are in metres, local to the plot, seen from the street: `x` from 0 (left) to 15
(right), `z` from 0 (street) to 15 (the back, where your project's portal stands), `y` up to 12 m.
**Call `get_parcel` first**: its `size` is the source of truth. The server keeps `x` 5–10, `z` 6.9–15
clear below 3.6 m for the portal (a flat floor up to 10 cm is fine). Budget: 48 pieces, 24,000
triangles and 1 light.

**`upload_model`** only accepts files **inside the folder where the server runs** (with Claude Code,
the folder you open it in): copy the model there first. **`XENXO_URL`** (optional, default
`https://api.xenxo.io`) must be `https://` because the key travels with every request; only
`localhost` and `127.0.0.1` may use `http://`, for development.

**Troubleshooting:** no key (or no `xk_` prefix) → the server exits and says so; a revoked key, or a
project that is no longer published → tools answer `xenxo no acepta la clave (401…)`: create a new
one. Behind a proxy with `fetch failed` → add `-e NODE_USE_ENV_PROXY=1` to `claude mcp add` (Node 22.21+).
