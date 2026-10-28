---
title: Build on xenxo.io
nav: Build on xenxo.io
gate: Build on xenxo.io
order: 4
description: Games with “Sign in with xenxo”, community districts and agents that build on your plot, without deploying the world.
---

You don't need to run your own xenxo to make things in it. What creators use is **MIT**: your code stays yours.

| You want | Tool | Where your work lives |
|---|---|---|
| A web game where people sign in with their account and character | `npm create xenxo` + `@xenxo/sdk` | On your Cloudflare account (or any static host) |
| A whole 256 × 256 m district with your city and activities | `npm create xenxo -- --district` + `@xenxo/district-kit` | On xenxo.io, after review |
| Your AI agent building on your plot | xenxo's MCP server | On your plot on xenxo.io |

## A game

```bash
npm create xenxo@latest
```

Choose 2D or 3D (and `--multi` if you want a multiplayer room on your Cloudflare account). The template comes with “Sign in with xenxo”, the player's VRM character, a **local simulator** to test without an account, the `xenxo.json` card and an `AGENTS.md` so your AI knows how to integrate from the first prompt.

1. `npm run dev`: the simulator plays the player.
2. `npm run check`: checks the card with the same rules as xenxo.
3. `npm run deploy`: publishes it to your Cloudflare account (`npx wrangler login` the first time).
4. On xenxo.io, publish your project, register the game in *Projects → “Sign in with xenxo” in your game* and paste the `clientId` into your code.
5. On the project's card, *Read its xenxo.json*: your game is now at `xenxo.io/j/<name>`.

Full details in [`packages/create-xenxo`](../../../packages/create-xenxo/README.md) and the SDK in [`packages/sdk`](../../../packages/sdk/README.md). Needs Node.js 22.12 or newer.

## A community district

```bash
npm create xenxo@latest my-district -- --district --lang en
cd my-district
npm install
npm run validate
```

The district is described in `xenxo-district.json` with its `.glb` models. The kit checks on your machine the same things xenxo will check. Then you upload it in *Account → Your district*: it stays as a draft so you can try it, and moderation reviews it. The rules are in the template's `AGENTS.md` and in [`packages/district-kit`](../../../packages/district-kit/README.md).

## Your agent on your plot

Anyone who publishes a project can let their agent (Claude Code, Cursor or any MCP client) build on their plot.

1. On xenxo.io, *Projects → Build with your agent* and create a **plot key** (`xk_…`).
2. Download the MCP server (a single file) and connect it:

   ```bash
   curl -o ~/xenxo-mcp.mjs https://xenxo.io/mcp/xenxo-mcp.mjs
   claude mcp add --scope user xenxo -e XENXO_KEY=xk_your_key -- node ~/xenxo-mcp.mjs
   ```

3. Ask your agent to start with `get_parcel` and build.

The server checks each piece fits entirely within the plot (15 × 15 m and 12 m high) and its budget (48 pieces, 24,000 triangles and one light). More in [`packages/mcp`](../../../packages/mcp/README.md).

> [!NOTE]
> If `npm create xenxo` or `npm install` return **404**, the packages aren't on npm yet. Create it from the repository: [“Until it is on npm”](../../../packages/create-xenxo/README.md#mientras-no-esté-en-npm).

## 3D models

Characters (`.vrm` or `.glb`), monuments and pieces for your district: budgets, how to export from Blender and what the server checks, in [`docs/CREAR-MODELOS.md`](../../../docs/CREAR-MODELOS.md) (in Spanish).
