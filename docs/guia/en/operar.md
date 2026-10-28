---
title: Running your instance
nav: Running your instance
gate: Operate
order: 5
description: What to have in order before opening your xenxo to the public and to keep it running: security, limits, backups, moderation and licence.
---

## Before opening to the public

A short list. Anything missing here is your job, not xenxo's.

- [ ] **Legal pages** (`apps/web/public/legal/`, in Spanish and English) with your details, your contact and where you process data. Have someone who knows review them.
- [ ] **“Source code” link** in the panel pointing to your repository (AGPL, below).
- [ ] **`TOKEN_SECRET`** long and random, stored only in GitHub or Cloudflare secrets.
- [ ] **Your own agent and moderation keys** in `AGENT_KEYS`. The example keys don't work outside `localhost`, but don't build on them.
- [ ] **Your founder account** with `FOUNDER_USER_ID`.
- [ ] **Two-factor authentication** on your GitHub and Cloudflare accounts, and the Cloudflare token limited to your account and zone.
- [ ] **`SECURITY.md`** with how you receive vulnerability reports.
- [ ] On Cloudflare, **HSTS** enabled on the zone (*SSL/TLS → Edge Certificates*) and **usage notifications** for Workers and Durable Objects (*Notifications*).

## What xenxo already does for you

| Risk | How the code covers it |
|---|---|
| Someone changes the world without permission | A single write door (`MUTATE_WORLD`) that validates schema, budgets, ownership, version and idempotency |
| A malicious or huge 3D model | The server re-inspects every GLB: allowed extensions, structure, embedded textures and budgets for triangles, vertices and images |
| Flooding the server | Per-IP limits on what can be requested without an account (without storing the IP), message buckets per connection, caps on connections per account and on uploads per day |
| Stolen sessions | Passkeys, sessions with a 30-day maximum life and “Sign out on every device” |
| The web talking to third parties | A strict security policy (CSP): the browser only connects to your domain, including for the 3D text fonts |
| An outside game impersonating you | It opens in an isolated `iframe`, with no access to the session, and the “Sign in with xenxo” permission can't be requested in a loop |
| A pull request pulling out your secrets | The deploy only runs on a *push* to `main` of your repository and secrets are only visible to the deploy steps |

Details in [`SECURITY.md`](../../../SECURITY.md) and in the rules of [`CLAUDE.md`](../../../CLAUDE.md).

## Free plan limits

On the free plan, Workers and Durable Objects **cut off, they don't bill**: if you go over a limit one day, the world and accounts are down until 00:00 UTC and the static web stays up. R2 would bill beyond its free tier; that's why the server caps storage and uploads.

| Resource | Free limit per day | 15-minute visits it handles (approx.) |
|---|---|---|
| Worker requests | 100,000 | About 3,000 |
| Durable Object requests | 100,000 | **About 950**: this is the bottleneck |
| SQLite rows | 5 million read, 100,000 written | Plenty |
| The web and system models | Unlimited | — |

How this was measured: [`docs/LIMITES-CLOUDFLARE.md`](../../../docs/LIMITES-CLOUDFLARE.md) (in Spanish). If it falls short, you have two ways out:

- **Move the districts to your server** ([guide](servidor.md)): they're what uses the most.
- **Workers Paid** ($5 a month): stops cutting off and bills by usage beyond its quota.

> [!CAUTION]
> Don't open several free accounts to spread the load: Cloudflare's terms forbid using the service to get around its limits and they can suspend everything.

## Backups

| What | Where it is | How to back it up |
|---|---|---|
| The code | Your repository | Any clone will do; `git bundle create backup.bundle --all` puts it in a single file |
| Districts on your server | `/var/lib/xenxo-distritos/datos` | It's done automatically every 15 minutes ([guide](servidor.md#6-day-to-day)) |
| Accounts, projects and places on Cloudflare | Durable Objects | Each person can download their data from *Account*; xenxo has no full copy of its own today |
| Uploaded models and covers | R2 | Addressed by hash: they can be uploaded again |

## Moderation

- With `FOUNDER_USER_ID` you always moderate and can appoint more moderators from the panel.
- Reports reach the panel; hiding or rejecting requires a reason the author can see, and it stays in the moderation log (the EU's DSA asks for it).
- The n8n notices (optional) write to you when something needs review, without data on who reported: [`tools/n8n`](../../../tools/n8n/).

## Updating

Bring xenxo's changes into your repository (`git fetch upstream && git merge upstream/main`) and push: CI runs the tests and the deploy publishes. If you have districts on your server, run `update.sh` there afterwards.

Before merging large changes, check whether they touch the protocol (`docs/PROTOCOL.md`): changes in meaning arrive as new versions (`foo@2`) so clients don't break.

## The AGPL licence

The world is AGPL-3.0. In practice, if you open your instance to the public:

- offer the **exact source code** of what you serve, with your changes (the panel's “Source code” link does that if it points to your repository);
- keep the licence notices and credits ([`CREDITS.md`](../../../CREDITS.md));
- some assets have their own licence: for example, the HexGL example game includes files that don't allow commercial use.

What creators use (protocol, SDK, MCP, district kit and template) is MIT. This isn't legal advice: if your case isn't clear, ask someone who knows.

## Signs something is wrong

| Sign | Where to look |
|---|---|
| `https://api.yourdomain.com/health` doesn't answer | From outside, with an uptime monitor |
| 1027 errors or request spikes | *Workers & Pages → xenxo-realtime → Metrics* |
| The districts' tunnel goes down | *Notifications → Tunnel health* on Cloudflare |
| Failed deploys | The *Actions* tab of your repository |
