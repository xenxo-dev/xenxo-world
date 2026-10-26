# create-xenxo

Crea un juego web listo para [xenxo.io](https://xenxo.io) en un minuto:

```sh
npm create xenxo@latest
# o directamente:
npm create xenxo@latest mi-juego -- --3d
npm create xenxo@latest my-game -- --2d --lang en
```

Trae:

- Un juego mínimo **2D** (canvas) o **3D** (three.js con el personaje VRM del jugador, animado).
- **«Entrar con xenxo»** con [`@xenxo/sdk`](https://www.npmjs.com/package/@xenxo/sdk): nombre, número
  de jugador y personaje, y «Volver a xenxo».
- **Simulador local**: `npm run dev` abre el juego con un jugador de prueba, sin cuenta ni conexión.
- **`public/xenxo.json`**: la ficha del juego para xenxo (esquema `xenxo.game/0`).
- **`AGENTS.md`**: lo que tu IA (Claude, Cursor, Copilot…) necesita saber para integrarse con xenxo.
  El vibecoding funciona desde el primer prompt.
- **Publicar en un comando**: `npm run deploy` (Cloudflare Pages, gratis) o cualquier alojamiento
  estático.

Licencia MIT: tu juego es tuyo.
