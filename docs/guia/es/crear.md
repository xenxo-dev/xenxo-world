---
title: Crear sobre xenxo.io
nav: Crear sobre xenxo.io
gate: Crear en xenxo.io
order: 4
description: Juegos con «Entrar con xenxo», distritos de la comunidad y agentes que construyen en tu parcela, sin desplegar el mundo.
---

No hace falta montar tu propio xenxo para hacer cosas en él. Lo que usan los creadores es **MIT**: tu código sigue siendo tuyo.

| Quieres | Herramienta | Dónde vive lo tuyo |
|---|---|---|
| Un juego web donde la gente entra con su cuenta y su personaje | `npm create xenxo` + `@xenxo/sdk` | En tu cuenta de Cloudflare (o cualquier alojamiento estático) |
| Un distrito entero de 256 × 256 m con tu ciudad y tus actividades | `npm create xenxo -- --district` + `@xenxo/district-kit` | En xenxo.io, tras la revisión |
| Que tu agente de IA construya en tu parcela | Servidor MCP de xenxo | En tu parcela de xenxo.io |

## Un juego

```bash
npm create xenxo@latest
```

Elige 2D o 3D (y `--multi` si quieres una sala multijugador en tu cuenta de Cloudflare). La plantilla trae «Entrar con xenxo», el personaje VRM del jugador, un **simulador local** para probar sin cuenta, la ficha `xenxo.json` y un `AGENTS.md` para que tu IA sepa integrarse desde el primer prompt.

1. `npm run dev`: el simulador hace de jugador.
2. `npm run check`: comprueba la ficha con las mismas reglas que xenxo.
3. `npm run deploy`: lo publica en tu cuenta de Cloudflare (`npx wrangler login` la primera vez).
4. En xenxo.io, publica tu proyecto, registra el juego en *Proyectos → «Entrar con xenxo» en tu juego* y pega el `clientId` en tu código.
5. En la ficha del proyecto, *Leer su xenxo.json*: tu juego queda en `xenxo.io/j/<nombre>`.

Todo el detalle en [`packages/create-xenxo`](../../../packages/create-xenxo/README.md) y el SDK en [`packages/sdk`](../../../packages/sdk/README.md). Necesita Node.js 22.12 o más nuevo.

## Un distrito de la comunidad

```bash
npm create xenxo@latest mi-distrito -- --district
cd mi-distrito
npm install
npm run validate
```

El distrito se describe en `xenxo-district.json` con sus modelos `.glb`. El kit comprueba en tu equipo lo mismo que comprobará xenxo. Luego lo subes en *Cuenta → Tu distrito*: queda en borrador para que lo pruebes y moderación lo revisa. Las reglas están en el `AGENTS.md` de la plantilla y en [`packages/district-kit`](../../../packages/district-kit/README.md).

## Tu agente en tu parcela

Quien publica un proyecto puede dejar que su agente (Claude Code, Cursor o cualquier cliente MCP) construya en su parcela.

1. En xenxo.io, *Proyectos → Construir con tu agente* y crea una **clave de parcela** (`xk_…`).
2. Descarga el servidor MCP (un solo archivo) y conéctalo:

   ```bash
   curl -o ~/xenxo-mcp.mjs https://xenxo.io/mcp/xenxo-mcp.mjs
   claude mcp add --scope user xenxo -e XENXO_KEY=xk_tu_clave -- node ~/xenxo-mcp.mjs
   ```

3. Pide a tu agente que empiece por `get_parcel` y construya.

El servidor comprueba que cada pieza quepa entera en la parcela (15 × 15 m y 12 m de alto) y su presupuesto (48 piezas, 24.000 triángulos y una luz). Más en [`packages/mcp`](../../../packages/mcp/README.md).

> [!NOTE]
> Si `npm create xenxo` o `npm install` dan **404**, los paquetes aún no están publicados en npm. Créalo desde el repositorio: [«Mientras no esté en npm»](../../../packages/create-xenxo/README.md#mientras-no-esté-en-npm).

## Modelos 3D

Personajes (`.vrm` o `.glb`), monumentos y piezas de tu distrito: presupuestos, cómo exportar desde Blender y qué comprueba el servidor en [`docs/CREAR-MODELOS.md`](../../../docs/CREAR-MODELOS.md).
