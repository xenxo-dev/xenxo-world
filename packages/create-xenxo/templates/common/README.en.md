# {{title}}

A {{kind}} game for [xenxo.io](https://xenxo.io), made with `npm create xenxo`.

## Getting started

You need **Node.js 22.12 or newer**.

```sh
npm install
npm run dev
```

It opens with a **test player**: the xenxo simulator (panel at the bottom left), so you can try it
without an account. Switch between *Jugador* (player), *Invitado* (guest) and *Sin sesión* (signed
out) and test all three.

- **On your phone or headset** (same network): `npm run dev -- --host` and open the *Network* address
  Vite prints. In development the simulator is always on, there too.
- **Against the real xenxo on your machine** (once you have a `clientId`, below):
  `VITE_XENXO_REAL=1 npm run dev`, with `http://localhost:5173/` registered as a return address.
- **`npm run check`** validates the game card (`public/xenxo.json`) the way xenxo will.

To change the game, ask your AI (Claude Code, Cursor…): it reads `AGENTS.md` and knows how to work
with xenxo.

## Publish

```sh
npx wrangler login   # first time only: your free Cloudflare account
npm run deploy       # checks the card, builds and publishes to Cloudflare Pages
```

**Copy the address wrangler prints** at the end (`https://….pages.dev`). It is usually
`https://{{name}}.pages.dev`, but if someone already has that name Cloudflare adds something to it:
the right one is the one it prints. If it doesn't match `privacy` in `public/xenxo.json`, change it
there and deploy again.

Any static host works too: upload `dist/` (after `npm run build`) to GitHub Pages, Netlify, Vercel
or itch.io.

## Connect it to xenxo

On [xenxo.io](https://xenxo.io), with your account (passkey or Google, no email):

1. **Publish the project.** *Projects → Publish mine*: name, the game's link (the wrangler address),
   district, a free plot, a 16:9 cover and a 3D monument (`.glb`, up to 10,000 triangles). To get
   going you have `xenxo/portada-provisional.png` and `xenxo/monumento-provisional.glb`: **they are
   placeholders**, replace them with your own when you can.
2. **"Sign in with xenxo".** *Projects → "Sign in with xenxo" in your game*: register the game with its
   **exact** address as the return address (with the trailing slash, e.g.
   `https://{{name}}.pages.dev/`) and pick your project. To try the real sign-in on your machine, also
   add `http://localhost:5173/`.
3. **Put what it gives you in `public/xenxo.json`** (xenxo shows you the snippet to copy):

   ```json
   "xenxo": { "clientId": "xg_…", "project": "…" }
   ```

   Then `npm run check` and `npm run deploy`.
4. **Game card.** In your project: *Game card → Read its xenxo.json*. xenxo reads
   `<your address>/xenxo.json` and requires `privacy`: an https privacy page that exists. The template
   ships `public/privacidad.html`: **review it**, add your name and contact, and change it if your game
   does more (analytics, ads, storing data). You get the **game link**, `xenxo.io/j/<name>`: it opens
   the game inside xenxo, lists it in the catalogue once reviewed, enters it in jams and lets a
   district have a portal to it.

Now people sign in with their xenxo account, with their name, number and character, and "Back to
xenxo" leaves them in front of your portal.

## If `npm install` fails with a 404 on `@xenxo/sdk`

It isn't on npm yet. Until it is, take it from the repository
([xenxo-dev/xenxo-world](https://github.com/xenxo-dev/xenxo-world)):

```sh
# once, in another folder:
git clone https://github.com/xenxo-dev/xenxo-world && cd xenxo-world && npm install
mkdir -p ~/xenxo-packages && npm pack -w @xenxo/sdk --pack-destination ~/xenxo-packages
# in the game folder:
npm install ~/xenxo-packages/xenxo-sdk-*.tgz
```

## License

The template is MIT: your game is yours, license it however you like.
