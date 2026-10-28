---
title: Districts on your server
nav: Districts on your server
gate: Your server
order: 3
description: Turn a machine at home or a VPS into a node that hosts districts, with the same code, no open ports and automatic failover if it goes down.
---

Districts are what uses most of Cloudflare's free plan: every pose from every person counts against the day's requests. A **node** is a machine that runs exactly the same district code (`ChunkRoom`) with [workerd](https://github.com/cloudflare/workerd), the open-source engine behind Cloudflare Workers. There can be several nodes, and each district lives on one of them or on Cloudflare.

```text
browser ──wss──▶ Cloudflare (tunnel) ──▶ cloudflared ──▶ workerd on 127.0.0.1:8788 (NODE_ID)
                        ▲                                    │ one SQLite per district
api.yourdomain ─────────┘ signed passes and calls            └─▶ copy every 15 min (NAS or disk)
      │
      └── every 2 min: answering? anything changed? → copy in R2 · 3 failures → the district returns to Cloudflare
```

- **Stays on Cloudflare:** the web, accounts, “Sign in with xenxo”, moderation, the nexus, the plaza and files.
- **Moves to the node:** the districts assigned to it, with their people, activities and plots.
- **No open ports:** it's reached only through a Cloudflare Tunnel.
- **No secrets on the node:** it only keeps the Worker's **public** key and its own id. Everything the Worker signs for it is addressed to it, so it's useless to another node.
- **If it goes down:** anyone trying to get in sees “this district isn't available right now” and, a few minutes later, the district returns to Cloudflare on its own with its latest copy.

> [!NOTE]
> This guide works for **your instance** (you need [it deployed](cloudflare.md)) and for **contributing a node to xenxo.io**. In the second case you do steps 1, 2 and 4 on your machine, and whoever runs xenxo.io gives you the node id and registers it. Write to [contact@xenxo.io](mailto:contact@xenxo.io). For now, by invitation only.

## What machine you need

CPU and memory are more than enough: a laptop a few years old will do. What matters is your connection's **upload** speed.

| People at once in the node's districts | Upload needed (approx.) |
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

## 2. Install the node

```bash
sudo git clone https://github.com/xenxo-dev/xenxo-world /opt/xenxo-world
sudo bash /opt/xenxo-world/tools/district-host/install.sh
```

If it's for your instance, clone **your** repository. The installer:

- creates the `xenxo` system user and the data folders;
- builds the node (`npm run build:district-host`) and installs it as the `xenxo-distritos` service, listening only on `127.0.0.1:8788`;
- schedules the copy every 15 minutes and turns on automatic security updates;
- stops a laptop from suspending when the lid is closed.

The service is hardened with systemd: no new privileges, a read-only file system, and writes only to its data.

## 3. Configure the node

Edit `/etc/xenxo-distritos.env` on the machine:

```bash
NODE_ID=home-1
DISTRICT_PUBLIC_KEY={"kty":"OKP","crv":"Ed25519","x":"…"}
HOSTED_CHUNKS=*
ASSETS_URL=https://api.yourdomain.com
```

- `NODE_ID`: the id you'll register it with (3–32 lowercase letters, numbers and hyphens).
- `DISTRICT_PUBLIC_KEY`: your server's **public** key, the line returned by `curl https://api.yourdomain.com/nodes/key`. Your server creates its key pair on its own when you register the first node (step 5), and the private key never leaves it. If it still returns 404, fill this in after registering.
- `HOSTED_CHUNKS`: which districts you're willing to host (`*` = whatever you're assigned, or a list like `c_1_0,c_-1_0`).
- `ASSETS_URL`: your server, where the node gets the measurements of people's models.

Restart and check:

```bash
sudo systemctl restart xenxo-distritos
curl http://127.0.0.1:8788/node
```

It should answer with your id: `{"id":"home-1","chunks":["*"],"protocol":0}`. Restart the service whenever you change the public key.

> [!NOTE]
> If you'd rather set the signing key yourself (for example, so the same one works on another instance), create it with `node tools/district-host/keys.mjs` and store it as the `DISTRICT_SIGNING_KEY` secret on the Worker or on GitHub. If it exists, it takes precedence over the one the server keeps.

## 4. The tunnel

In the Cloudflare dashboard: *Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared*.

1. Name it after the node and run on the machine the install command it gives you for Debian/Ubuntu. It contains a token: it's a secret.
2. **Public hostname:** for example `home-1.yourdomain.com` → service `HTTP` → `localhost:8788`.
3. From outside: `curl https://home-1.yourdomain.com/node` should answer with its id.
4. Turn on *Notifications → Tunnel health* to know if it goes down.

The web's security policy already allows connecting to any subdomain of yours. If the node is on another domain (for example, a node contributed by someone else), add its `wss://…` origin to `connect-src` in `apps/web/public/_headers`.

## 5. Register it and give it districts

On your site, with the founder account: *Account → Nodes*.

1. **Add a node:** its id (the same `NODE_ID`), a name (people will see it: “this district is hosted by…”) and its `https://…` address. If it answers with its id, it shows **Online**. If it was the first one, there's now a key: put the one from `/nodes/key` on the node (step 3) and restart it.
2. **Where each district lives:** pick the node next to the district and press **Move**. Everything people made (project portals, builds, activities and chat) is copied and, as soon as it finishes, people go straight to the node.

Whatever changes in the district while it's being copied (a few seconds) is lost: do it when few people are inside.

The same from the terminal, with a moderation key from `AGENT_KEYS`:

```bash
T=$(curl -s -X POST https://api.yourdomain.com/auth/agent -H "Authorization: Bearer $XENXO_ADMIN_KEY" | jq -r .token)
curl -s -X POST https://api.yourdomain.com/mod/nodes -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"id":"home-1","name":"Ana'"'"'s place","url":"https://home-1.yourdomain.com"}'
curl -s -X POST https://api.yourdomain.com/mod/chunks/c_1_0/move -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"to":"home-1"}'
```

The districts' chunks:

| District | Chunk |
|---|---|
| Arcade | `c_1_0` |
| Pixel | `c_-1_0` |
| Agora | `c_0_1` |
| Workshop | `c_0_-1` |
| Frontier | `c_1_-1` |
| District Zero | `c_-1_-1` |
| Vertical | `c_-1_1` |
| Community districts | `c_1000_<n>` |

> [!IMPORTANT]
> Before moving the first one, add to your privacy policy (in `apps/web/public/legal/`, in both languages) that districts may be processed on community servers, and where. Whoever runs a node sees the chat, the poses and the IP address of people entering its districts: legally, they're your data processor.

## 6. If a node goes down

| When | What happens |
|---|---|
| Immediately | Anyone trying to get in sees “this district isn't available right now”, with a button back to the nexus. It keeps retrying on its own. |
| Every 2 minutes | The Worker asks each node who it is. If a district changed, it stores its copy in R2. |
| After 3 rounds without an answer (about 6 minutes) | The node's districts return to Cloudflare with their latest copy. The panel marks them as failover and, if you have n8n, the `node.down` notice arrives. |
| When the node comes back | It stays without districts until you press **Move** again. That way two places never write the same district. |

**Turning off** a node from the panel does the same immediately: use it if a machine misbehaves.

## 7. Day to day

| To | Command |
|---|---|
| Update after a change in the repository | `sudo /opt/xenxo-world/tools/district-host/update.sh` |
| See whether it's running | `systemctl status xenxo-distritos` |
| Read the logs | `journalctl -u xenxo-distritos -f` |
| See the local backups | `ls /mnt/nas/xenxo-distritos/ultima/` |

**Local backups:** a consistent copy of each district every 15 minutes in `ultima/` and one per day for 30 days in `YYYY-MM-DD/`. To restore: stop the service, copy the `.sqlite` files to `/var/lib/xenxo-distritos/datos/` and start it. On top of that, the Worker keeps the latest copy of each district in R2 for failover.

**NAS failover:** if you have a Synology NAS with Docker, it can act as this same node (same `NODE_ID` and same tunnel) with the latest copy: [NAS failover](../../../tools/district-host/relevo/README.md) (in Spanish).

**Changing machines:** same install on the new one, copy `/var/lib/xenxo-distritos/datos/` with the service stopped and switch the tunnel to the new machine. The node id doesn't change.

## Common problems

| What you see | What to do |
|---|---|
| `curl 127.0.0.1:8788/node` gives `"id":null` | `NODE_ID` is missing from `/etc/xenxo-distritos.env`. Without it, the node accepts nothing signed. |
| The panel says it isn't responding, but the tunnel works | The node's `NODE_ID` doesn't match the id it was registered with. |
| **Move** returns `node_refuses` | The district isn't in the node's `HOSTED_CHUNKS`. |
| **Move** returns `node_unreachable` | The node doesn't answer at its `https://…` address: check the tunnel. |
| `/nodes/key` returns 404 | You haven't registered any node yet: the key is created with the first one. |
| The node answers `/node` but lets nobody in | Its `DISTRICT_PUBLIC_KEY` isn't the one at `/nodes/key` (was the key changed in the panel?). Set the current one and restart. |
| People's models don't show in the district | `ASSETS_URL` must be your `https://api.yourdomain.com`. |
| The browser can't connect to a node on another domain | Add its `wss://…` to `connect-src` in `apps/web/public/_headers`. |
