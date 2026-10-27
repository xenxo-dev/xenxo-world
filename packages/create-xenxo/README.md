# create-xenxo

Crea un juego web listo para [xenxo.io](https://xenxo.io) en un minuto:

```sh
npm create xenxo@latest
# o directamente:
npm create xenxo@latest mi-juego -- --3d
npm create xenxo@latest my-game -- --2d --lang en
npm create xenxo@latest mi-juego -- --3d --multi   # con sala multijugador
npm create xenxo@latest mi-distrito -- --district  # un distrito de la comunidad
```

Trae:

- Un juego mínimo **2D** (canvas) o **3D** (three.js con el personaje VRM del jugador, animado).
- **«Entrar con xenxo»** con [`@xenxo/sdk`](https://www.npmjs.com/package/@xenxo/sdk): nombre, número
  de jugador y personaje, y «Volver a xenxo».
- **Simulador local**: `npm run dev` abre el juego con un jugador de prueba, sin cuenta ni conexión.
- **`public/xenxo.json`**: la ficha del juego para xenxo (esquema `xenxo.game/0`).
- **`AGENTS.md`**: lo que tu IA (Claude, Cursor, Copilot…) necesita saber para integrarse con xenxo.
  El vibecoding funciona desde el primer prompt.
- **Multijugador opcional** (`--multi`): una sala (Worker + Durable Object) para **tu** cuenta
  gratuita de Cloudflare. Reenvía el estado de cada jugador a los demás (hasta 16 por sala) y
  comprueba con la clave pública de xenxo quién es quién: nombre, número y personaje de verdad.
  `npm run sala` en tu equipo y `npm run deploy:sala` para publicarla.
- **Publicar en un comando**: `npm run deploy` (Cloudflare Pages, gratis) o cualquier alojamiento
  estático.

**Distritos** (`--district`): una carpeta con la ficha `xenxo-district.json`, modelos de ejemplo, la
portada, el emblema y un `AGENTS.md` con las medidas y las reglas. `npm run validate` la comprueba
con [`@xenxo/district-kit`](https://www.npmjs.com/package/@xenxo/district-kit) y se sube desde
xenxo.io → Cuenta → Tu distrito.

Licencia MIT: tu juego (o tu distrito) es tuyo.
