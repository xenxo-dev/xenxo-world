
## Multiplayer

The game comes with a **room** (`sala/`): a Worker with a Durable Object that relays each player's
state to the others. It runs on **your** free Cloudflare account, not xenxo's.

```sh
npm run sala          # in another terminal, next to npm run dev: ws://localhost:8788
npm run deploy:sala   # publish it: you get https://{{name}}-sala.<your-subdomain>.workers.dev
```

Then:

1. In `sala/wrangler.toml`, put your published game's address in `ORIGENES` and, once you have
   registered it on xenxo, your `client_id` in `XENXO_CLIENT_ID` (so name, number and avatar come
   verified by xenxo; without it everyone joins as a guest). Run `npm run deploy:sala` again.
2. Create `.env.production` with `VITE_SALA_URL=wss://{{name}}-sala.<your-subdomain>.workers.dev` and
   run `npm run deploy`.

Separate rooms with `?sala=name` in the address. Limits per room:

- **16 players**: only those who have said `hola` count; anyone who doesn't say it within **10 s** is
  closed (code 4003) when another connection arrives.
- **48 connections** in total (including those that haven't said hello yet; beyond that, 4001
  "room full") and **8 from the same network** (4004; the client doesn't reconnect by itself).
- 30 messages per second and 1.5 KB per message.

Without a verified "Sign in with xenxo", people join as **guests**: with the name they give, without
`#` (they can't pass as "name #number") and always marked as guests. On the free plan, limits cut
off, they don't bill.
