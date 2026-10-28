# AGENTS.md — {{title}}

Instructions for the AI that codes this game (Claude, Cursor, Copilot, Codex…). Talk to the person
in their language; the rules are the same in any language.

## What this is

A web game ({{kind}}) made with the **xenxo.io** template: a 3D world in the browser where people
walk around with their avatar and open games by other creators. The game is **a normal website**:
it is hosted wherever its creator wants and also works outside xenxo. xenxo gives it three things
through `@xenxo/sdk`:

1. **Who is playing**: name, player number (#12) and their character (VRM), if the person allows it
   with "Sign in with xenxo".
2. **Back to xenxo**: `xenxo.back()` takes the person back to the world, in front of the game's portal.
3. **Language**: `xenxo.lang` (`"es"`, `"en"`…).

## Map

| File | What it is |
|---|---|
| `src/main.js` | The game. Rewrite it completely if needed |
| `src/xenxo-hud.js` | The xenxo part: connect, top bar, sign in, sign out and back |
| `src/avatar.js` (3D) | Loads the player's VRM with `@pixiv/three-vrm` and animates it with its bones |
| `src/estilo.css` | Page and bar styles |
| `public/xenxo.json` | The **game card** for xenxo (name, description, devices, age…) |
| `public/privacidad.html` | Its privacy policy (linked from `privacy` in the card) |
| `scripts/comprobar.mjs` | `npm run check`: validates the card the way xenxo will |
| `xenxo/` | **Placeholder** cover and monument to publish the project on xenxo (not served with the game) |
| `index.html` | Entry page (Vite) |

Commands (Node.js 22.12 or newer): `npm run dev` (opens the game with the simulator),
`npm run check` (validates `public/xenxo.json`; run it **every time you touch it**), `npm run build`
(to `dist/`) and `npm run deploy` (checks the card and publishes `dist/` to Cloudflare Pages with the
person's account; the first time it needs `npx wrangler login`).

## The SDK in 30 seconds

```js
import { xenxo } from "@xenxo/sdk";
const player = await xenxo.connect({ clientId, project });   // null if not signed in
// player: { id, name, playerNo, avatar: { url, format, hash }, picture, guest, simulated }
xenxo.login();   // sends them to xenxo to give permission and back to this page
xenxo.logout();  // forgets them on this page
xenxo.back();    // back to xenxo, in front of the project's portal
xenxo.lang;      // the person's language
xenxo.error;     // why they didn't sign in ("access_denied" if they said no)
```

- `id` is **only for this game**: use it as the key if you store anything for the person. Don't use
  the name (it changes) or the number for that.
- `avatar.url` is a VRM (sometimes a GLB): load it with `GLTFLoader` + `VRMLoaderPlugin`, as in
  `src/avatar.js`. If there is no avatar or it fails to load, show a default: the game must never
  stay blank.
- `picture` is their character's portrait (a 256 px square): for games without 3D. It may be missing
  (not made yet, or a guest): then show the initial of their name.
- `guest: true` = a xenxo guest: has a name, but no account or number.

## The simulator (development)

With `npm run dev` the SDK doesn't talk to xenxo: it gives a **test player** ("Jugador de prueba
#9999", with a stock character downloaded from xenxo) and adds a panel at the bottom left to switch
between *Jugador* (player), *Invitado* (guest) and *Sin sesión* (signed out). Always test all three.
`xenxo.back()` in the simulator only shows where it would go.

- `src/xenxo-hud.js` forces it (`simulate`) in development: it also works from another IP
  (`npm run dev -- --host`, for phones and headsets) and even when the card already has a `clientId`.
- `VITE_XENXO_REAL=1 npm run dev` turns it off and talks to the real xenxo (the person must have
  registered `http://localhost:5173/` as a return address).
- Published (`npm run build`), the SDK decides: with a `clientId`, the real xenxo.

## Rules (don't break them)

1. **The game works without xenxo.** If `connect()` fails or returns `null`, it plays as "Player".
   No screens blocking play until you sign in.
2. **`public/xenxo.json` always valid and up to date** (schema `xenxo.game/0`, below): run
   `npm run check` after touching it. If the game changes type or devices, or starts having ads or
   purchases, update it.
3. **No real-money gambling**: no bets, no casino, no paid loot boxes. It is banned on xenxo for every age.
4. **Privacy:** don't send the player's data to third parties. On xenxo's return page (the one with
   `?code=`) don't load third-party scripts (analytics, ads) before the SDK.
   `public/privacidad.html` describes what the template does: if you add anything that uses data
   (analytics, ads, accounts, saving games on a server), **update it at the same time** and tell the
   person. Never write anything in it that the game doesn't do.
5. **Never put secrets in the code.** The `clientId` isn't secret (it goes in `xenxo.json`); service
   keys (if there is ever a server) go in environment variables.
6. **Performance:** it must run on an ordinary phone and on a Meta Quest 3. Don't create objects in
   the render loop (`new THREE.Vector3()` inside `setAnimationLoop` kills the FPS): reuse them. Share
   geometries and materials, `devicePixelRatio` at most 2, few lights and no shadows by default.
7. **Assets:** your own models, textures and sounds, or freely licensed ones (CC0 from Poly Haven,
   ambientCG, Kenney, Quaternius…). Keep them in `public/` and note their license in the README.
8. **UI text in Spanish and English** at least (use `idioma` from `xenxo-hud.js`).
9. **PC, phone and VR headset.** The goal is that it plays on all three: keyboard on PC, **visible**
   touch controls on phones (on-screen buttons or joystick that work with several fingers at once:
   pointer events, not `click`) and, on headsets, in the Quest browser window with the controller
   pointer (same as touch). If a device doesn't work, remove it from `devices`: xenxo warns whoever
   comes from it and doesn't open the game. The template only ships "drag on the screen" as a
   starting point: add visible controls before publishing with `mobile`.
10. **You can see who is playing.** xenxo is a metaverse: the person brings their identity to your
    game. If your game has a character to control, it is **their xenxo character**
    (`player.avatar`, as in `src/avatar.js`; without an account, a stock one) and the card says
    `"avatar": "character"`. If there is no character (2D, ships, puzzles), show their name, number
    and portrait (`player.picture`, as in the bar in `xenxo-hud.js`) and the card says
    `"avatar": "badge"`. Review checks it.
11. **The character isn't yours.** Their character, portrait, name and number are only for
    representing them in that game: don't keep them beyond the session (their `id` yes, for their
    saves), don't sell or share them, don't repurpose them or use them to train models, for ads or
    for profiling. Otherwise xenxo removes the game.

## `public/xenxo.json` (schema `xenxo.game/0`)

| Field | What it is |
|---|---|
| `schema` | Always `"xenxo.game/0"` |
| `name`, `description` | `{ "es": …, "en": … }` (other languages optional). Name ≤ 60, description ≤ 280 |
| `category` | `game3d`, `game2d`, `social`, `tool` or `other` |
| `devices` | List of `pc`, `mobile`, `vr` (only the ones that really work). xenxo **warns and doesn't open** the game on devices not listed |
| `multiplayer` | `true` or `false` |
| `avatar` | `"character"` (played with their xenxo character), `"badge"` (their portrait, name and number are shown) or `"none"` (the xenxo identity isn't used; not allowed if the game uses "Sign in with xenxo") |
| `ageRating` | `"all"` or `"+14"` |
| `monetization` | `{ "hasAds": bool, "hasPurchases": bool }` |
| `author`, `contact` | Who makes it and a contact email or website (the template ships sample ones: `npm run check` warns) |
| `privacy` | The game's privacy page (https). Required to register the card on xenxo. The template points to `https://{{name}}.pages.dev/privacidad.html`: change it if wrangler gave another address |
| `thumbnail` | Optional: 16:9 cover (`/cover.webp` or https). Today xenxo shows the cover uploaded when publishing the project |
| `embed` | Whether it can open inside xenxo (sandboxed iframe). Default `true` |
| `xenxo.clientId` | The `xg_…` xenxo gives when registering the game ("Sign in with xenxo") |
| `xenxo.project` | The project's id on xenxo (its plot): for `xenxo.back()` |

Don't invent fields: xenxo rejects the card if it has any it doesn't know. With `xenxo.clientId`,
`avatar` can't be `"none"`.

## Publishing and connecting it to xenxo (the person does it)

You can prepare the code and the card; accounts and registrations are done by the person. Guide them
in this order (the README says it too):

1. `npx wrangler login` (first time) and `npm run deploy` (Cloudflare Pages, free), or any static host
   (GitHub Pages, Netlify, Vercel, itch.io). The right address is **the one wrangler prints** (not
   always `https://{{name}}.pages.dev/`): if it differs, update `privacy`.
2. On xenxo.io → **Projects → Publish mine**: link, district, plot, cover and monument (the
   placeholders in `xenxo/` are fine to start).
3. In *"Sign in with xenxo" in your game*: register the game with that **exact** address as its
   return address (and `http://localhost:5173/` to try it locally) and pick the project. It gives
   `clientId` and `project`.
4. Put `clientId` and `project` in `public/xenxo.json`, `npm run check` and deploy again.
5. In their project, **Game card → Read its xenxo.json**: it gives the link `xenxo.io/j/<name>`
   (opening it inside xenxo, catalogue, jams and district portals). It requires `privacy`.

More: https://xenxo.io · SDK: https://www.npmjs.com/package/@xenxo/sdk
