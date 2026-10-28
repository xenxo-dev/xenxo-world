---
title: xenxo on your computer
nav: On your computer
gate: Your computer
order: 1
description: The whole world locally, with accounts, districts and the test bench, in about five minutes.
---

All of xenxo runs on your machine with two processes: the real-time server (`wrangler dev`, the same engine Cloudflare uses) and the web (Vite). No accounts or keys needed.

## Before you start

- **Node.js 22** or newer (`node -v`). On Windows, macOS and Linux.
- **git**.
- About 2 GB free: the repository includes the world's 3D models and the dependencies take another 700 MB.

## Start

1. **Clone the repository and install.**

   ```bash
   git clone https://github.com/xenxo-dev/xenxo-world
   cd xenxo-world
   npm install
   ```

2. **Copy the example configuration.** It comes with test keys that only work on `localhost`.

   ```bash
   cp apps/realtime/.dev.vars.example apps/realtime/.dev.vars
   cp apps/web/.env.example apps/web/.env
   ```

   On Windows (PowerShell), use `copy` instead of `cp`.

3. **Start the server** in one terminal. It runs on `http://localhost:8787`.

   ```bash
   npm run dev:realtime
   ```

4. **Start the web** in another terminal. It runs on `http://localhost:5173`.

   ```bash
   npm run dev:web
   ```

5. **Go in.** Open `http://localhost:5173` in two tabs and press *Enter world* in both: you'll see each other move in the nexus. Walk through a gate to reach the plaza or a district.

> [!TIP]
> Check the server answers with `curl http://localhost:8787/health`. It should return `{"ok":true,"protocol":0}`.

## Accounts, moderation and data locally

- **Create an account:** *Account → Create account* with a passkey. They work locally because the passkey domain is `localhost` (`RP_ID` in `.dev.vars`).
- **Be player #0 and moderate:** download your data (*Account → Download my data*), copy your `id` and add `FOUNDER_USER_ID=<id>` to `apps/realtime/.dev.vars`. Restart the server.
- **Test keys:** `dev-agent-key-change-me` builds and uploads models; `dev-admin-key-change-me` also moderates. Outside `localhost` the server rejects them.
- **Start from scratch:** stop the server and delete `apps/realtime/.wrangler/state`. On start, the nexus, plaza and districts are seeded again.

## The test bench

With the server running, the conformance bench runs the protocol end to end: more than 60 scenarios covering accounts, world, districts, games, moderation and GDPR.

```bash
XENXO_AGENT_KEY=dev-agent-key-change-me XENXO_ADMIN_KEY=dev-admin-key-change-me npm run conformance
```

Before proposing a change, also run:

```bash
npm run typecheck
npm run build
```

The repository rules (what can be changed and how) are in [`CLAUDE.md`](../../../CLAUDE.md), which is also what your AI agent reads if you work with one.

> [!NOTE]
> Per-IP limits are off locally: the test bench creates hundreds of accounts from your machine. To test them, add `RATE_LIMIT_LOCAL=1` to `.dev.vars`.

## Try it from your phone

The phone has to reach both processes through your computer's IP (for example `192.168.1.20`):

1. Start the server listening on the network:

   ```bash
   npm run dev -w @xenxo/realtime -- --ip 0.0.0.0
   ```

2. In `apps/web/.env`, point the web at that IP: `VITE_REALTIME_URL=http://192.168.1.20:8787`.
3. In `apps/realtime/.dev.vars`, allow the web's origin: `ALLOWED_ORIGINS=http://localhost:5173,http://192.168.1.20:5173`.
4. Restart the web and open `http://192.168.1.20:5173` on the phone.

Outside `localhost` passkeys don't work: go in as a guest.

> [!IMPORTANT]
> Virtual reality (WebXR) requires HTTPS. To try it on a Meta Quest, the simplest way is [your instance on Cloudflare](cloudflare.md).

## Regenerate the world

Buildings and districts are not edited by hand: they are **forged** by Python scripts that run Blender headless. You only need this if you change the architecture.

| What | Command | Needs |
|---|---|---|
| The whole world | `npm run forge` | Python 3 and Blender 5 as a module (`pip install bpy`) |
| Just the nexus | `npm run forge:nexo` | The same |
| Just the districts | `npm run forge:districts` | The same |

Details in [`tools/forge/README.md`](../../../tools/forge/README.md).

## Common problems

| What you see | What to do |
|---|---|
| `EADDRINUSE` on start | Another process is using 8787 or 5173. Close it or change the port. |
| The web loads but says “offline” | The server isn't running or `VITE_REALTIME_URL` doesn't point to it. |
| `Unsupported engine` or odd install errors | You need Node.js 22. Delete `node_modules` and run `npm install` again. |
| The passkey fails | Use `http://localhost:5173`, not the IP. Firefox on Linux may have no passkey manager: try Chrome. |
| `429` responses | You turned on `RATE_LIMIT_LOCAL=1`: wait a minute or remove it. |
