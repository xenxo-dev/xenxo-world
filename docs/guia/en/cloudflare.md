---
title: Your instance on Cloudflare
nav: Your instance on Cloudflare
gate: Cloudflare
order: 2
description: Your own copy of xenxo on the internet, on your domain and deployed automatically from GitHub, on Cloudflare's free plan.
---

This is how xenxo.io works: every time CI passes on `main`, GitHub Actions deploys the server to `api.<domain>` and the web to `<domain>`. Your copy does exactly the same with your accounts.

| Piece | Where it ends up | Cloudflare service |
|---|---|---|
| The web | `yourdomain.com` and `www.yourdomain.com` | Workers (static assets, free and unlimited) |
| The server | `api.yourdomain.com` | Workers + Durable Objects with SQLite |
| 3D models and covers | Bucket `xenxo-assets`, in the EU | R2 |
| Example games | `xenxo-<game>.<your-subdomain>.workers.dev` | Workers |

## Before you start

- A **GitHub** account.
- A **Cloudflare** account (the free plan is enough).
- A **domain** managed on Cloudflare. If you bought it elsewhere, switch its DNS servers to the ones Cloudflare gives you. Passkeys are tied to that domain.

> [!IMPORTANT]
> Decide **where data is stored** before the first deploy. `DO_JURISDICTION = "eu"` in `apps/realtime/wrangler.toml` keeps it in the EU. If you change it later, the new Durable Objects start empty.

## 1. Your copy of the repository

1. **Fork** [xenxo-dev/xenxo-world](https://github.com/xenxo-dev/xenxo-world) (or push it to a repository of your own).
2. In the fork's **Actions** tab, enable workflows (GitHub turns them off on forks).

Before opening it to the public, change what belongs to xenxo.io:

| File | What to change |
|---|---|
| `apps/web/public/legal/` | Who the controller is, your contact and where you keep data. They exist in Spanish and English and have the gaps in square brackets. |
| `apps/web/src/panel/Panel.tsx` | The “Source code” link must lead to **your** repository: the AGPL requires offering the source of what you serve. |
| `apps/realtime/wrangler.toml` | `GITHUB_OWNER`: the account whose repositories appear in the panel. |
| `SECURITY.md` | Where to report a security issue to you. |

> [!NOTE]
> xenxo.io is the original instance. If you publish yours, make it clear it is a different one: your name, your domain and your legal pages.

## 2. Prepare Cloudflare

1. **Add your domain** to Cloudflare and wait until it's active.
2. **Turn on R2** in the dashboard (R2 Object Storage). Cloudflare may ask for a payment method even though it doesn't charge while you stay within its free tier; xenxo has storage and upload caps so you don't go over.
3. **Open *Workers & Pages* once** so your account gets its `workers.dev` subdomain (the deploy creates it if missing, but this way the first run doesn't fail).
4. **Create an API token:** *My Profile → API Tokens → Create Token →* the **Edit Cloudflare Workers** template, limited to your account and your domain's zone.
5. Also copy your **Account ID** (right-hand column of the domain page).

## 3. Secrets and variables on GitHub

In your fork: *Settings → Secrets and variables → Actions*.

| Name | Type | Value |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | The token from the previous step |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Your Account ID |
| `TOKEN_SECRET` | Secret | A long random string: `openssl rand -hex 32`. Don't change it later or every session will be closed |
| `WEB_DOMAIN` | Variable | Your domain, for example `yourdomain.com` (without `https://`) |
| `AGENT_KEYS` | Secret, optional | Agent and moderation keys (below) |
| `FOUNDER_USER_ID` | Variable, optional | Your account id, to be player #0 and always moderate |
| `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` | Variable and secret, optional | “Sign in with Google” (below) |

Without the first three the deploy skips itself and says so: nothing breaks.

## 4. Deploy

Push to `main` or run *Actions → Desplegar → Run workflow*. In about two minutes the workflow:

1. creates the account's `workers.dev` subdomain if it doesn't exist;
2. creates the `xenxo-assets` bucket in the EU (first time only);
3. publishes the server to `api.yourdomain.com` with your secrets;
4. builds the web against that server, adapts its security policy (CSP) to your domain and publishes it;
5. publishes the example games and checks everything answers.

Check it yourself too:

```bash
curl https://api.yourdomain.com/health
```

It should return `{"ok":true,"protocol":0}`. Open `https://yourdomain.com` and enter the world.

> [!TIP]
> The workflow only deploys what reaches `main` of your own repository by *push*, never code from a pull request. That way nobody can pull your secrets out with a PR.

## 5. Your founder account

1. Open your site and create an account (*Account → Create account with a passkey*).
2. *Account → Download my data* and copy your `id`.
3. Save it in the `FOUNDER_USER_ID` variable and deploy again.

From then on you are **player #0**, always moderate and can appoint more moderators from the panel.

## Optional

### Agent and moderation keys

Generate the fingerprint of a key (only you keep the key itself):

```bash
npm run hash-key -w @xenxo/headless -- "a-long-random-key"
```

Then put comma-separated entries in `AGENT_KEYS`: `builder-01:<fingerprint>` for an agent that builds and `admin-01:<fingerprint>:build|upload|admin` to moderate from the terminal. The example keys in `.dev.vars.example` don't work outside `localhost`.

### Sign in with Google

1. In Google Cloud, create an OAuth client of type **web application**.
2. Authorised redirect URI: `https://api.yourdomain.com/auth/google/callback`.
3. Save `GOOGLE_CLIENT_ID` (variable) and `GOOGLE_CLIENT_SECRET` (secret) and deploy.

xenxo only asks for `openid` and stores a fingerprint of the identifier, never the identifier. Without these two, the button doesn't show.

### Moderation notices

With `N8N_WEBHOOK_URL` and `N8N_WEBHOOK_SECRET`, the server notifies an n8n flow when something needs review. Setup in [`tools/n8n`](../../../tools/n8n/).

### Districts on your server

The multiplayer cities are what uses most of the free plan. You can move them to a machine of yours: [Districts on your server](servidor.md).

## Without GitHub Actions

If you prefer to deploy from your computer:

1. Edit the `[vars]` section of `apps/realtime/wrangler.toml`: `RP_ID = "yourdomain.com"` and `ALLOWED_ORIGINS = "https://yourdomain.com,https://www.yourdomain.com"`.
2. Deploy the server:

   ```bash
   npx wrangler login
   cd apps/realtime
   npx wrangler r2 bucket create xenxo-assets --jurisdiction eu
   npx wrangler deploy --domain api.yourdomain.com
   openssl rand -hex 32 | npx wrangler secret put TOKEN_SECRET
   cd ../..
   ```

3. Build the web against your server, replace `*.xenxo.io` with `*.yourdomain.com` in `apps/web/dist/_headers` and publish it:

   ```bash
   VITE_REALTIME_URL=https://api.yourdomain.com npm run build -w @xenxo/web
   cd apps/web
   npx wrangler deploy --domain yourdomain.com --domain www.yourdomain.com
   ```

## Keeping it up to date

Bring in xenxo's changes whenever you like; CI tests them and the deploy publishes them:

```bash
git remote add upstream https://github.com/xenxo-dev/xenxo-world
git fetch upstream
git merge upstream/main
git push
```

## Common problems

| What you see | What to do |
|---|---|
| The deploy says “Faltan CLOUDFLARE_API_TOKEN…” (missing) | Check the names of the three required secrets. |
| “No se pudo crear el subdominio workers.dev” | Open *Workers & Pages* once in the Cloudflare dashboard and run it again. |
| Creating the bucket fails | Turn on R2 in the dashboard. |
| `api.yourdomain.com` doesn't resolve | The domain isn't active on Cloudflare yet or `WEB_DOMAIN` doesn't match. |
| The web opens but doesn't connect | Check the browser console: if it's the CSP, make sure the deploy replaced `*.xenxo.io` with your domain in `_headers`. |
| Error 1027 or 429 at certain times | You've hit the free plan's daily limit; it comes back at 00:00 UTC. See [Running your instance](operar.md). |
