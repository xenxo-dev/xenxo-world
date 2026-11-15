---
title: Build on xenxo.io
nav: Build on xenxo.io
gate: Build on xenxo.io
order: 4
description: Games with “Sign in with xenxo”, community districts, agents that build on your plot and gestures from a video, without deploying the world.
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
4. On xenxo.io, publish your project, register the game in *Projects → “Sign in with xenxo” in your game* (with its exact address as the return address) and paste what it gives you into `public/xenxo.json`: `"xenxo": { "clientId": "xg_…", "project": "…" }`. Deploy again.
5. On the project's card, *Read its xenxo.json*: your game is now at `xenxo.io/j/<name>`.

Full details in [`packages/create-xenxo`](../../../packages/create-xenxo/README.md) and the SDK in [`packages/sdk`](../../../packages/sdk/README.md). Needs Node.js 22.12 or newer.

## A community district

```bash
npm create xenxo@latest my-district -- --district --lang en
cd my-district
npm install
npm run validate
```

The district is described in `xenxo-district.json` with its `.glb` models. The kit checks on your machine the same things xenxo will check. Then you upload it in *Account → Your district*: it stays as a draft so you can try it, and moderation reviews it. Once approved, its gate appears on the nexus's second ring (the community one, reached by the violet walkways that leave the central circle between the islands), with your cover and your emblem. The rules are in the template's `AGENTS.md` and in [`packages/district-kit`](../../../packages/district-kit/README.md).

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

## Gestures from a video

On xenxo.io, *Create → Gestures from a video* opens the **gesture studio**: pick a short video of one person doing the gesture (full body or from the waist up, with good light and nobody else in front), mark where it starts and where it ends, and it's analysed **in your browser** with MediaPipe (Pose and Hand Landmarker, Apache-2.0, served from xenxo): the video is neither sent nor stored. You see it on a character next to the video or as it would play in the game (standing or walking), with these options:

- **Once** or **looping** (the end blends into the start).
- **Waist up only**: the legs are whatever the player is doing (standing or walking); the studio suggests it on its own when the legs can't be seen.
- **Keeps going while walking**: when moving, the gesture stays on the arms.
- **Feet on the ground** and **smoothing** (how much of the landmarks' jitter is removed).

It downloads as **`.vrma`** (VRM Animation: xenxo, Blender with its VRM add-on, Unity or three-vrm open it) and as **`.bvh`**. The `.vrma` carries its details inside: the name in the game (`a-z` and `_`, up to 24) and its names in Spanish and English.

To get it into xenxo's action wheel, it's added **through code** from the repository:

```bash
npm run gesture:add -- ~/Downloads/military_salute.vrma            # add it
npm run gesture:add -- ~/Downloads/military_salute.vrma --check    # only check it
npm run gesture:add -- ~/Downloads/military_salute.vrma --replace  # change one that's already in
```

It checks the file (its humanoid, one clip, the details, 0.2 to 20 s and up to 4 MB) and that no other gesture uses the name; it copies it to `apps/web/public/anims/`, lists it in `apps/web/src/world/people/captured-gestures.json` and adds its names to `apps/web/src/i18n.ts`. Then `npm run typecheck`, try it in the world (action wheel → Gestures) and ship it like any other change. Anyone on an older version of the web doesn't see it: clients ignore gestures they don't know.

## 3D models

Characters (`.vrm` or `.glb`), monuments and pieces for your district: budgets, how to export from Blender and what the server checks, in [`docs/CREAR-MODELOS.md`](../../../docs/CREAR-MODELOS.md) (in Spanish).
