---
title: Districts on your server
nav: Districts on your server
gate: Your server
order: 3
description: Move your instance's multiplayer cities to a machine at home or a VPS, with the same code and without opening ports.
---

Districts are what uses most of Cloudflare's free plan: every pose from every person counts against the day's requests. The **district server** runs exactly the same chunk code (`ChunkRoom`) on a machine of yours, with [workerd](https://github.com/cloudflare/workerd), the open-source engine behind Cloudflare Workers.

```text
browser ──wss──▶ Cloudflare (tunnel) ──▶ cloudflared ──▶ workerd on 127.0.0.1:8788
                        ▲                                    │ one SQLite per district
api.yourdomain ─────────┘ signed passes and calls            └─▶ copy every 15 min (NAS or disk)
```

- **Stays on Cloudflare:** the web, accounts, the nexus, the plaza and files.
- **Moves to your machine:** the districts you choose, with their people, activities and plots.
- **No open ports:** it's reached only through a Cloudflare Tunnel.
- **No secrets on your machine:** it only keeps the **public** key it uses to check what your Worker signs.

> [!NOTE]
> This guide extends [your instance on Cloudflare](cloudflare.md): you need it deployed. Today xenxo.io's districts are hosted by its team; if you'd like to contribute a server to xenxo.io, write to [contact@xenxo.io](mailto:contact@xenxo.io).

## What machine you need

CPU and memory are more than enough: a laptop a few years old will do. What matters is your connection's **upload** speed.

| People at once in the districts | Upload needed (approx.) |
|---|---|
| 20 | 2 Mbit/s |
| 100 | 9 Mbit/s |
| 300 | 27 Mbit/s |

Each person receives the poses of those nearby (about 60 m) five times per second. Symmetric fibre has plenty; ADSL or 4G does not.

- **System:** Ubuntu Server 24.04 LTS or Debian 12, on x86-64.
- **Network:** wired, with a fixed IP on the router (DHCP reservation).
- **Disk:** a few GB for the repository and the databases.
- **Backups (recommended):** a folder on a NAS or another disk.

## 1. Prepare the machine

Install Node.js 22 and git:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

Backups go to `/mnt/nas/xenxo-distritos`. Mount your NAS folder (over NFS, for example) or another disk there before installing.

## 2. Install the server

Clone **your** repository and run the installer:

```bash
sudo git clone https://github.com/<your-user>/xenxo-world /opt/xenxo-world
sudo bash /opt/xenxo-world/tools/district-host/install.sh
```

The installer:

- creates the `xenxo` system user and the data folders;
- builds the server (`npm run build:district-host`) and installs it as the `xenxo-distritos` service, listening only on `127.0.0.1:8788`;
- schedules the copy every 15 minutes and turns on automatic security updates;
- stops a laptop from suspending when the lid is closed.

The service is hardened with systemd: no new privileges, a read-only file system, and writes only to its data.

## 3. The keys

Your Worker signs the passes to enter the districts and the calls it makes to them; your machine only checks the signature. On **your computer**, with the repository and `npx wrangler login` done:

```bash
node tools/district-host/keys.mjs
npx wrangler secret put DISTRICT_SIGNING_KEY --config apps/realtime/wrangler.toml < distrito-privada.jwk
rm distrito-privada.jwk
```

The private key stays only on Cloudflare. The script prints the **public** key (one JSON line). Edit `/etc/xenxo-distritos.env` on the machine:

```bash
DISTRICT_PUBLIC_KEY={"kty":"OKP","crv":"Ed25519","x":"…"}
HOSTED_CHUNKS=c_1_0,c_-1_0,c_0_1,c_0_-1,c_1_-1,c_-1_-1,c_-1_1
ASSETS_URL=https://api.yourdomain.com
```

Restart and check:

```bash
sudo systemctl restart xenxo-distritos
curl http://127.0.0.1:8788/health
```

It should answer `ok`.

> [!WARNING]
> Never paste the private key into a chat or commit it. If it leaks, generate a new one and repeat this step.

## 4. The tunnel

In the Cloudflare dashboard: *Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared*.

1. Name it `xenxo-distritos` and run on the machine the install command it gives you for Debian/Ubuntu. It contains a token: it's a secret.
2. **Public hostname:** `districts.yourdomain.com` → service `HTTP` → `localhost:8788`.
3. From outside: `curl https://districts.yourdomain.com/health` should answer `ok`.
4. Turn on *Notifications → Tunnel health* to know if it goes down.

The web's security policy already allows connecting to any subdomain of yours, so there's nothing to change there.

## 5. Move the districts

These are the districts' chunks:

| District | Chunk |
|---|---|
| Arcade | `c_1_0` |
| Pixel | `c_-1_0` |
| Agora | `c_0_1` |
| Workshop | `c_0_-1` |
| Frontier | `c_1_-1` |
| District Zero | `c_-1_-1` |
| Vertical | `c_-1_1` |

One at a time:

1. **Tell your Worker where the server is.** In `apps/realtime/wrangler.toml`, `[vars]` section, set `DISTRICT_HOST = "https://districts.yourdomain.com"` and deploy.
2. **Copy what the district has** (project portals, what's been built and the chat) to your machine, with a moderation key from `AGENT_KEYS`:

   ```bash
   T=$(curl -s -X POST https://api.yourdomain.com/auth/agent -H "Authorization: Bearer $XENXO_ADMIN_KEY" | jq -r .token)
   curl -s -X POST https://api.yourdomain.com/mod/chunks/c_-1_1/move \
     -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"to":"remote"}'
   ```

3. **Switch the district over:** add it to `REMOTE_CHUNKS` (comma-separated, for example `REMOTE_CHUNKS = "c_-1_1"`) and deploy.
4. Go into the district and check everything is there. Then the next one.

Whatever changes in the district between steps 2 and 3 is lost: do it when few people are inside.

**Back to Cloudflare:** the other way round. First `{"to":"local"}` on `/mod/chunks/<id>/move`, then remove the chunk from `REMOTE_CHUNKS` and deploy.

> [!IMPORTANT]
> Before moving the first one, add to your privacy policy (in `apps/web/public/legal/`, in both languages) where the districts are processed.

## 6. Day to day

| To | Command |
|---|---|
| Update after a change in the repository | `sudo /opt/xenxo-world/tools/district-host/update.sh` |
| See whether it's running | `systemctl status xenxo-distritos` |
| Read the logs | `journalctl -u xenxo-distritos -f` |
| See the backups | `ls /mnt/nas/xenxo-distritos/ultima/` |

**Backups:** a consistent copy of each district every 15 minutes in `ultima/` and one per day for 30 days in `YYYY-MM-DD/`. To restore: stop the service, copy the `.sqlite` files to `/var/lib/xenxo-distritos/datos/` and start it.

**If the machine goes down,** its districts become unavailable and the rest of the world carries on. If you have a Synology NAS with Docker, it can take over on its own with the latest copy: [NAS failover](../../../tools/district-host/relevo/README.md) (in Spanish).

**Changing machines:** same install on the new one, copy `/var/lib/xenxo-distritos/datos/` with the service stopped and switch the tunnel to the new machine.

## Common problems

| What you see | What to do |
|---|---|
| `curl 127.0.0.1:8788/health` doesn't answer | `journalctl -u xenxo-distritos -n 50`. Usually an empty or badly copied `DISTRICT_PUBLIC_KEY`. |
| The tunnel answers 502 | The service is stopped or the hostname points to another port. |
| `move` returns “falta DISTRICT_HOST” | Deploy first with `DISTRICT_HOST` and the `DISTRICT_SIGNING_KEY` secret. |
| You can't enter the district | The Worker can't reach your machine: check the tunnel and that `HOSTED_CHUNKS` includes that chunk. |
| People's models don't show in the district | `ASSETS_URL` must be your `https://api.yourdomain.com`. |
