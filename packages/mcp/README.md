# Servidor MCP de xenxo

Deja que tu agente (Claude Code, Cursor o cualquier cliente MCP) construya en la **parcela de tu
proyecto** en [xenxo.io](https://xenxo.io). Le describes lo que quieres y lo construye: suelos,
paredes, rótulos de neón, una luz y tus propios modelos `.glb`.

Es un cliente más del protocolo de xenxo: entra con una **clave de parcela** y todo lo que hace pasa
por la misma puerta que cualquiera (`MUTATE_WORLD`), con las mismas reglas. La clave solo sirve
para tu parcela (10 × 10 m y 12 m de alto) y la puedes revocar cuando quieras.

## 1. Saca tu clave

En xenxo.io → **Proyectos** → tu proyecto → **Construir con tu agente** → *Crear clave*. Empieza
por `xk_` y solo se enseña una vez: guárdala como una contraseña.

## 2. Descarga el servidor

Un solo archivo, sin instalar nada más (necesitas Node.js 20 o más nuevo):

```sh
curl -o ~/xenxo-mcp.mjs https://xenxo.io/mcp/xenxo-mcp.mjs
```

## 3. Conéctalo a tu agente

**Claude Code**

```sh
claude mcp add xenxo -e XENXO_KEY=xk_tu_clave -- node ~/xenxo-mcp.mjs
```

**Cursor** (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "xenxo": { "command": "node", "args": ["/ruta/a/xenxo-mcp.mjs"], "env": { "XENXO_KEY": "xk_tu_clave" } }
  }
}
```

Y pídele algo: *«mira mi parcela de xenxo y móntame una tienda de neón con un mostrador y un rótulo
que diga ABIERTO»*.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `get_parcel` | Tu parcela: tamaño, presupuesto usado y lo que hay construido |
| `place_shape` | Caja, esfera, cilindro o plano (color, acabado, brillo, sólido o no) |
| `place_label` | Rótulo de texto, normal o de neón |
| `place_light` | Una luz puntual (una por parcela) |
| `upload_model` | Optimiza y sube un `.glb` de tu equipo |
| `place_model` | Coloca un modelo subido, apoyado en el suelo |
| `update_piece` | Mueve, gira, escala, pinta o cambia el texto de una pieza |
| `remove_pieces` | Quita piezas (o todas) |

Coordenadas en metros, de la parcela: `x` de 0 a 10 de izquierda a derecha mirando desde la calle,
`z` de 0 (la calle) a 10 (el fondo, donde está el portal de tu proyecto) e `y` hacia arriba. El
portal ocupa el fondo: deja libre la zona `x` 2,5–7,5, `z` 6–10.

Presupuesto de una parcela: 32 piezas, 16.000 triángulos y 1 luz.

## Desarrollo

```sh
npm run build -w @xenxo/mcp          # dist/xenxo-mcp.mjs (un solo archivo)
XENXO_KEY=xk_… XENXO_URL=http://localhost:8787 npm start -w @xenxo/mcp
npm run mcp-e2e -w @xenxo/headless   # prueba de punta a punta contra el servidor local
```

Licencia MIT: tu agente y lo que hagas con él son tuyos.
