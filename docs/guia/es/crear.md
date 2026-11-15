---
title: Crear sobre xenxo.io
nav: Crear sobre xenxo.io
gate: Crear en xenxo.io
order: 4
description: Juegos con «Entrar con xenxo», distritos de la comunidad, agentes que construyen en tu parcela y gestos desde un vídeo, sin desplegar el mundo.
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
4. En xenxo.io, publica tu proyecto, registra el juego en *Proyectos → «Entrar con xenxo» en tu juego* (con su dirección exacta como dirección de vuelta) y pega lo que te da en `public/xenxo.json`: `"xenxo": { "clientId": "xg_…", "project": "…" }`. Vuelve a publicar.
5. En la ficha del proyecto, *Leer su xenxo.json*: tu juego queda en `xenxo.io/j/<nombre>`.

Todo el detalle en [`packages/create-xenxo`](../../../packages/create-xenxo/README.md) y el SDK en [`packages/sdk`](../../../packages/sdk/README.md). Necesita Node.js 22.12 o más nuevo.

## Un distrito de la comunidad

```bash
npm create xenxo@latest mi-distrito -- --district
cd mi-distrito
npm install
npm run validate
```

El distrito se describe en `xenxo-district.json` con sus modelos `.glb`. El kit comprueba en tu equipo lo mismo que comprobará xenxo. Luego lo subes en *Cuenta → Tu distrito*: queda en borrador para que lo pruebes y moderación lo revisa. Cuando se aprueba, su puerta aparece en el segundo aro del nexo (el de la comunidad, al que llevan las pasarelas violetas que salen del círculo central entre isla e isla), con tu portada y tu emblema. Las reglas están en el `AGENTS.md` de la plantilla y en [`packages/district-kit`](../../../packages/district-kit/README.md).

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

## Gestos desde un vídeo

En xenxo.io, *Crear → Gestos desde un vídeo* abre el **estudio de gestos**: eliges un vídeo corto de una persona haciendo el gesto (de cuerpo entero o de cintura para arriba, con buena luz y sin nadie más delante), marcas dónde empieza y dónde acaba, y se analiza **en tu navegador** con MediaPipe (Pose y Hand Landmarker, Apache-2.0, servidos desde xenxo): el vídeo no se envía ni se guarda. Lo ves en un personaje al lado del vídeo o tal como iría en el juego (quieto o andando), con estas opciones:

- **Una vez** o **en bucle** (el final se funde con el principio).
- **Solo de cintura para arriba**: las piernas son las de quien lo hace (de pie o andando); el estudio lo propone solo si no se ven las piernas.
- **Sigue al andar**: al moverse, el gesto sigue en los brazos.
- **Pisar el suelo** y el **suavizado** (cuánto se quita del temblor de los puntos).

Se descarga en **`.vrma`** (VRM Animation: lo abren xenxo, Blender con su complemento de VRM, Unity o three-vrm) y en **`.bvh`**. El `.vrma` lleva dentro su ficha: el nombre en el juego (`a-z` y `_`, hasta 24) y sus nombres en español y en inglés.

Para que esté en la rueda de gestos de xenxo, se añade **por código** desde el repositorio:

```bash
npm run gesture:add -- ~/Descargas/saludo_militar.vrma            # añadirlo
npm run gesture:add -- ~/Descargas/saludo_militar.vrma --check    # solo comprobarlo
npm run gesture:add -- ~/Descargas/saludo_militar.vrma --replace  # cambiar uno que ya está
```

Comprueba el archivo (su humanoide, un clip, la ficha, de 0,2 a 20 s y hasta 4 MB) y que el nombre no lo use otro gesto; lo copia a `apps/web/public/anims/`, lo apunta en `apps/web/src/world/people/captured-gestures.json` y pone sus nombres en `apps/web/src/i18n.ts`. Después, `npm run typecheck`, probarlo en el mundo (rueda de acciones → Gestos) y subirlo como cualquier cambio. Quien no tenga una versión nueva de la web no lo ve: los clientes ignoran los gestos que no conocen.

## Modelos 3D

Personajes (`.vrm` o `.glb`), monumentos y piezas de tu distrito: presupuestos, cómo exportar desde Blender y qué comprueba el servidor en [`docs/CREAR-MODELOS.md`](../../../docs/CREAR-MODELOS.md).
