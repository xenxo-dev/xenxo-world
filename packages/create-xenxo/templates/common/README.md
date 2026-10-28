# {{title}}

Juego {{kind}} para [xenxo.io](https://xenxo.io), creado con `npm create xenxo`.
*(In English: create it with `--lang en`.)*

## Empezar

Necesitas **Node.js 22.12 o más nuevo**.

```sh
npm install
npm run dev
```

Se abre con un **jugador de prueba**: es el simulador de xenxo (panel abajo a la izquierda), para
probar sin cuenta. Cambia entre *Jugador*, *Invitado* y *Sin sesión* y prueba los tres casos.

- **En el móvil o en las gafas** (misma red): `npm run dev -- --host` y abre la dirección *Network*
  que enseña Vite. En desarrollo el simulador va siempre, también ahí.
- **Con el xenxo de verdad en tu equipo** (cuando ya tengas `clientId`, abajo):
  `VITE_XENXO_REAL=1 npm run dev`, con `http://localhost:5173/` registrada como dirección de vuelta.
- **`npm run check`** comprueba la ficha del juego (`public/xenxo.json`) como lo hará xenxo.

Para cambiar el juego, pídeselo a tu IA (Claude Code, Cursor…): lee `AGENTS.md` y sabe cómo
integrarse con xenxo.

## Publicar

```sh
npx wrangler login   # solo la primera vez: tu cuenta gratuita de Cloudflare
npm run deploy       # comprueba la ficha, compila y publica en Cloudflare Pages
```

**Copia la dirección que imprime wrangler** al acabar (`https://….pages.dev`). Suele ser
`https://{{name}}.pages.dev`, pero si ese nombre ya lo tiene otra persona, Cloudflare le añade algo:
la buena es la que imprime. Si no coincide con la de `privacy` en `public/xenxo.json`, cámbiala allí
y vuelve a publicar.

También vale cualquier alojamiento estático: sube `dist/` (tras `npm run build`) a GitHub Pages,
Netlify, Vercel o itch.io.

## Conectarlo con xenxo

En [xenxo.io](https://xenxo.io), con tu cuenta (passkey o Google, sin email):

1. **Publica el proyecto.** *Proyectos → Publicar el mío*: nombre, el enlace del juego (la dirección
   de wrangler), distrito, parcela libre, portada 16:9 y monumento 3D (`.glb`, hasta 10.000
   triángulos). Para salir del paso tienes `xenxo/portada-provisional.png` y
   `xenxo/monumento-provisional.glb`: **son provisionales**, cámbialos por los tuyos cuando puedas.
2. **«Entrar con xenxo».** *Proyectos → «Entrar con xenxo» en tu juego*: registra el juego con su
   dirección **exacta** como dirección de vuelta (con la barra final, p. ej.
   `https://{{name}}.pages.dev/`) y elige tu proyecto. Si quieres probar el inicio de sesión de
   verdad en tu equipo, añade también `http://localhost:5173/`.
3. **Pon lo que te da en `public/xenxo.json`** (xenxo te enseña el fragmento para copiarlo):

   ```json
   "xenxo": { "clientId": "xg_…", "project": "…" }
   ```

   Después, `npm run check` y `npm run deploy`.
4. **Ficha del juego.** En tu proyecto: *Ficha del juego → Leer su xenxo.json*. xenxo lee
   `<tu dirección>/xenxo.json` y exige `privacy`: una página de privacidad https que exista. La
   plantilla trae `public/privacidad.html`: **revísala**, pon tu nombre y tu contacto, y cámbiala si
   tu juego hace algo más (analíticas, anuncios, guardar datos). Te da el **enlace del juego**,
   `xenxo.io/j/<nombre>`: con él se abre dentro de xenxo, sale en el catálogo cuando lo revisan, se
   apunta a las jams y puede tener portal en un distrito.

Ahora la gente entra con su cuenta de xenxo, con su nombre, su número y su personaje, y «Volver a
xenxo» la deja delante de tu portal.

## Si `npm install` falla con un 404 en `@xenxo/sdk`

Aún no está publicado en npm. Mientras tanto, sácalo del repositorio
([xenxo-dev/xenxo-world](https://github.com/xenxo-dev/xenxo-world)):

```sh
# una vez, en otra carpeta:
git clone https://github.com/xenxo-dev/xenxo-world && cd xenxo-world && npm install
mkdir -p ~/xenxo-paquetes && npm pack -w @xenxo/sdk --pack-destination ~/xenxo-paquetes
# en la carpeta del juego:
npm install ~/xenxo-paquetes/xenxo-sdk-*.tgz
```

## Licencia

La plantilla es MIT: tu juego es tuyo y le pones la licencia que quieras.
