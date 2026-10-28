# create-xenxo

Crea un juego web listo para [xenxo.io](https://xenxo.io) en un minuto *(English below)*:

```sh
npm create xenxo@latest
# o directamente:
npm create xenxo@latest mi-juego -- --3d
npm create xenxo@latest my-game -- --2d --lang en
npm create xenxo@latest mi-juego -- --3d --multi   # con sala multijugador
npm create xenxo@latest mi-distrito -- --district  # un distrito de la comunidad
```

Necesitas **Node.js 22.12 o más nuevo**. Sin terminal interactiva (por ejemplo, si lo lanza tu IA),
no pregunta nada: di `--2d` o `--3d` (por defecto, 3D) y la carpeta.

Trae:

- Un juego mínimo **2D** (canvas) o **3D** (three.js con el personaje VRM del jugador, animado).
- **«Entrar con xenxo»** con [`@xenxo/sdk`](https://www.npmjs.com/package/@xenxo/sdk): nombre, número
  de jugador y personaje, y «Volver a xenxo».
- **Simulador local**: `npm run dev` abre el juego con un jugador de prueba, sin cuenta (también en el
  móvil o las gafas con `npm run dev -- --host`; `VITE_XENXO_REAL=1` lo apaga).
- **`public/xenxo.json`**: la ficha del juego para xenxo (esquema `xenxo.game/0`), y
  **`npm run check`** para comprobarla en tu equipo como lo hará xenxo.
- **`public/privacidad.html`**: una política de privacidad mínima y honesta de lo que hace la
  plantilla (revísala y pon tus datos), ya enlazada en la ficha.
- **`xenxo/`**: portada y monumento 3D **provisionales** para publicar el proyecto en xenxo desde el
  primer día.
- **`AGENTS.md`**: lo que tu IA (Claude, Cursor, Copilot…) necesita saber para integrarse con xenxo.
  El vibecoding funciona desde el primer prompt. `README.md` y `AGENTS.md` salen en el idioma de
  `--lang` (`es` o `en`).
- **Multijugador opcional** (`--multi`): una sala (Worker + Durable Object) para **tu** cuenta
  gratuita de Cloudflare. Reenvía el estado de cada jugador a los demás (hasta 16 por sala) y
  comprueba con la clave pública de xenxo quién es quién: nombre, número y personaje de verdad.
  `npm run sala` en tu equipo y `npm run deploy:sala` para publicarla.
- **Publicar en un comando**: `npx wrangler login` (la primera vez) y `npm run deploy` (Cloudflare
  Pages, gratis), o cualquier alojamiento estático. Copia la dirección que imprime wrangler: es la que
  registras en xenxo.

**Distritos** (`--district`): una carpeta con la ficha `xenxo-district.json`, modelos de ejemplo, la
portada, el emblema y un `AGENTS.md` con las medidas y las reglas. `npm run validate` la comprueba
con [`@xenxo/district-kit`](https://www.npmjs.com/package/@xenxo/district-kit) y se sube desde
xenxo.io → Cuenta → Tu distrito.

## Mientras no esté en npm

Si `npm create xenxo@latest` (o `npm install` en la carpeta creada) da un **404**, los paquetes aún
no están publicados. Usa el repositorio:

```sh
git clone https://github.com/xenxo-dev/xenxo-world && cd xenxo-world && npm install
mkdir -p ~/xenxo-paquetes
npm pack -w @xenxo/sdk -w @xenxo/district-kit --pack-destination ~/xenxo-paquetes

node packages/create-xenxo/index.mjs ~/mi-juego --2d          # en vez de npm create xenxo@latest
cd ~/mi-juego && npm install ~/xenxo-paquetes/xenxo-sdk-*.tgz && npm run dev
# un distrito: node …/index.mjs ~/mi-distrito --district
#   y en su carpeta: npm install -D ~/xenxo-paquetes/xenxo-district-kit-*.tgz
```

Licencia MIT: tu juego (o tu distrito) es tuyo.

---

## English

Creates a web game ready for [xenxo.io](https://xenxo.io) in a minute:

```sh
npm create xenxo@latest my-game -- --3d --lang en
npm create xenxo@latest my-game -- --2d --lang en --multi   # with a multiplayer room
npm create xenxo@latest my-district -- --district --lang en # a community district
```

You need **Node.js 22.12 or newer**. Without an interactive terminal (for example, when your AI runs
it) it asks nothing: pass `--2d` or `--3d` (default 3D) and the folder.

You get a minimal **2D** (canvas) or **3D** (three.js with the player's animated VRM character) game
with **"Sign in with xenxo"** ([`@xenxo/sdk`](https://www.npmjs.com/package/@xenxo/sdk)), a **local
simulator** (`npm run dev` opens it with a test player and no account; `--host` for phones and
headsets, `VITE_XENXO_REAL=1` turns it off), the game card **`public/xenxo.json`** with
**`npm run check`** to validate it, a minimal honest **privacy page** already linked from the card,
**placeholder** cover and monument in `xenxo/`, and an **`AGENTS.md`** for your AI. With
`--lang en`, `README.md` and `AGENTS.md` are in English. `--multi` adds a room (Worker + Durable
Object) for **your** free Cloudflare account. Publish with `npx wrangler login` (first time) and
`npm run deploy`, and copy the address wrangler prints: that is the one you register on xenxo.

**Districts** (`--district`): a folder with the `xenxo-district.json` manifest, sample models, cover,
emblem and an `AGENTS.md` with the sizes and rules. `npm run validate` checks it with
[`@xenxo/district-kit`](https://www.npmjs.com/package/@xenxo/district-kit); upload it from
xenxo.io → Account → Your district.

**Until it is on npm:** if `npm create xenxo@latest` or `npm install` returns a **404**, clone
[xenxo-dev/xenxo-world](https://github.com/xenxo-dev/xenxo-world), run `npm install`, pack the
packages with `npm pack -w @xenxo/sdk -w @xenxo/district-kit --pack-destination ~/xenxo-packages`,
create the game with `node packages/create-xenxo/index.mjs ~/my-game --2d --lang en` and install the
SDK in it with `npm install ~/xenxo-packages/xenxo-sdk-*.tgz`.

MIT license: your game (or district) is yours.
