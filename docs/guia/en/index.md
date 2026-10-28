---
title: Developer guide
nav: Overview
order: 0
hero: Run your own xenxo
lead: xenxo is open source. Start it on your computer in five minutes, publish your own copy on Cloudflare without paying anything, or move the districts to a server at home. This guide walks through every path from start to finish.
description: How to run xenxo locally, deploy your own instance on Cloudflare and host the districts on your own server.
---

## Choose where to start

<ul class="paths">
<li><a href="local"><b>On your computer</b><span>The whole world locally: web, real-time server, accounts and districts. To work on the code or try it before anything else.</span><em>Node 22, about 5 minutes, free</em></a></li>
<li><a href="cloudflare"><b>Your instance on Cloudflare</b><span>Your own copy of xenxo on the internet, on your domain, deployed automatically on every push from GitHub.</span><em>Your domain, about 30 minutes, free plan</em></a></li>
<li><a href="servidor"><b>Districts on your server</b><span>The multiplayer cities on a machine at home or a VPS, behind a tunnel, with no open ports.</span><em>Ubuntu or Debian, one hour, your power and your connection</em></a></li>
<li><a href="crear"><b>Build on xenxo.io</b><span>Without deploying the world: make a game with “Sign in with xenxo”, a community district, or let your agent build on your plot.</span><em>npm create xenxo, MIT licence</em></a></li>
</ul>

If you are going to open your instance to the public, also read [Running your instance](operar.md): security, backups, free plan limits and what the licence requires.

## How it is built

xenxo is a set of small pieces that speak one protocol. The web only draws; the truth about the world lives in one server per piece of the map.

```text
 browser (2D panel + 3D world, WebXR)
      │  HTTPS and WebSocket
      ▼
 api.yourdomain ── Cloudflare Worker (apps/realtime)
      ├── Directory ........ passkey accounts, projects, games, moderation
      ├── ChunkRoom × N .... one Durable Object per place: nexus, plaza, districts
      └── R2 ............... 3D models and covers, by hash
                     │  signed passes (Ed25519)
                     ▼
 districts.yourdomain ── optional: the same ChunkRoom on your server (workerd + tunnel)
```

| Piece | Where it is in the repository | What it does |
|---|---|---|
| Protocol | [`packages/protocol`](../../../packages/protocol/) | The contract: entities, components and messages, with Zod |
| Real-time server | [`apps/realtime`](../../../apps/realtime/) | Validates every change to the world, stores state in SQLite and relays poses |
| Web | [`apps/web`](../../../apps/web/) | 2D panel and 3D world (React Three Fiber) on desktop, mobile and headsets |
| District server | [`tools/district-host`](../../../tools/district-host/) | The same chunk code, on a machine of yours with workerd |
| What creators use | `packages/sdk`, `mcp`, `district-kit`, `create-xenxo` | Game SDK, MCP server, district kit and template (MIT) |

The full contract is in [`docs/PROTOCOL.md`](../../../docs/PROTOCOL.md).

## What each path needs

| | On your computer | On Cloudflare | On your server |
|---|---|---|---|
| System | Windows, macOS or Linux | Whatever you use for GitHub | Ubuntu 24.04 or Debian 12 |
| Software | Node.js 22 and git | A GitHub account | Node.js 22, git and cloudflared |
| Accounts | None | Cloudflare (free) and GitHub | Your Cloudflare ones |
| Domain | No | Yes, managed on Cloudflare | A subdomain of it |
| Cost | €0 | €0 on the free plan (plus the domain) | Power and connection |
| What matters most | — | The free plan's daily limits | Your connection's **upload** speed |

> [!NOTE]
> The district server extends an instance on Cloudflare: accounts, the web and files stay there. Today there is no supported way to move **all** of xenxo to your own server without Cloudflare.

## The licence, in two sentences

The world (server, web and tools) is [AGPL-3.0](../../../LICENSE): you can use it, change it and run your copy, and if you open it to the public you must publish your source with your changes. What creators use (protocol, SDK, MCP, district kit and template) is MIT: connecting your game or agent doesn't change your code's licence.

## Help

- Questions and bugs: [issues on GitHub](https://github.com/xenxo-dev/xenxo-world/issues).
- A security issue: don't publish it; follow [`SECURITY.md`](../../../SECURITY.md).
- Anything else: [contact@xenxo.io](mailto:contact@xenxo.io).
