# {{title}}

Juego {{kind}} para [xenxo.io](https://xenxo.io), creado con `npm create xenxo`.
*A {{kind}} game for xenxo.io, made with `npm create xenxo`.*

## Empezar · Getting started

```sh
npm install
npm run dev
```

Se abre con un **jugador de prueba**: es el simulador de xenxo (panel abajo a la izquierda), para
probar sin cuenta ni conexión. *It opens with a test player from the xenxo simulator.*

Para cambiar el juego, pídeselo a tu IA (Claude Code, Cursor…): lee `AGENTS.md` y sabe cómo
integrarse con xenxo. *Ask your AI for changes: it reads `AGENTS.md`.*

## Publicar · Publish

```sh
npm run deploy      # Cloudflare Pages (gratis): https://{{name}}.pages.dev
```

O sube `dist/` (tras `npm run build`) a GitHub Pages, Netlify, Vercel o itch.io.

## Conectarlo con xenxo · Connect it to xenxo

1. En xenxo.io → **Proyectos**, publica tu proyecto con el enlace del juego (elige distrito y
   parcela, portada y monumento 3D).
2. En *«Entrar con xenxo» en tu juego*, registra el juego con su dirección **exacta**
   (p. ej. `https://{{name}}.pages.dev/`). Te da un `client_id` (`xg_…`).
3. Ponlo en `public/xenxo.json`, junto al id de tu proyecto:

   ```json
   "xenxo": { "clientId": "xg_…", "project": "…" }
   ```

4. Vuelve a publicar. Ahora la gente entra con su cuenta de xenxo, con su nombre, su número y su
   personaje, y «Volver a xenxo» la deja delante de tu portal.

## Licencia · License

La plantilla es MIT: tu juego es tuyo y le pones la licencia que quieras.
*The template is MIT: your game is yours.*
