# AGENTS.md — {{title}}

Instrucciones para la IA que programa este juego (Claude, Cursor, Copilot, Codex…). Habla con la
persona en su idioma; este archivo está en español, pero las reglas valen igual.

## Qué es esto

Un juego web ({{kind}}) hecho con la plantilla de **xenxo.io**: un mundo 3D en el navegador donde
la gente entra con su avatar y abre juegos de otros creadores. El juego es **una web normal**: se
aloja donde quiera su creador y funciona también fuera de xenxo. xenxo le da tres cosas a través
de `@xenxo/sdk`:

1. **Quién juega**: nombre, número de jugador (#12) y su personaje (VRM), si la persona da permiso
   con «Entrar con xenxo».
2. **Volver a xenxo**: `xenxo.back()` devuelve a la persona delante del portal del juego.
3. **Idioma**: `xenxo.lang` (`"es"`, `"en"`…).

## Mapa

| Archivo | Qué es |
|---|---|
| `src/main.js` | El juego. Cámbialo entero si hace falta |
| `src/xenxo-hud.js` | La parte de xenxo: conectar, barra de arriba, entrar, salir y volver |
| `src/avatar.js` (3D) | Carga el VRM del jugador con `@pixiv/three-vrm` y lo anima con sus huesos |
| `src/estilo.css` | Estilos de la página y de la barra |
| `public/xenxo.json` | La **ficha del juego** para xenxo (nombre, descripción, equipos, edad…) |
| `public/privacidad.html` | Su política de privacidad (va en `privacy` de la ficha) |
| `scripts/comprobar.mjs` | `npm run check`: comprueba la ficha como lo hará xenxo |
| `xenxo/` | Portada y monumento **provisionales** para publicar el proyecto en xenxo (no se sirven con el juego) |
| `index.html` | Página de entrada (Vite) |

Comandos (Node.js 22.12 o más nuevo): `npm run dev` (abre el juego con el simulador),
`npm run check` (comprueba `public/xenxo.json`; pásalo **cada vez que la toques**), `npm run build`
(a `dist/`) y `npm run deploy` (comprueba la ficha y publica `dist/` en Cloudflare Pages con la
cuenta de la persona; la primera vez necesita `npx wrangler login`).

## El SDK en 30 segundos

```js
import { xenxo } from "@xenxo/sdk";
const jugador = await xenxo.connect({ clientId, project });   // null si no ha entrado
// jugador: { id, name, playerNo, avatar: { url, format, hash }, picture, guest, simulated }
xenxo.login();   // lleva a xenxo para dar permiso y vuelve a esta página
xenxo.logout();  // lo olvida en esta página
xenxo.back();    // vuelve a xenxo, delante del portal del proyecto
xenxo.lang;      // idioma de la persona
xenxo.error;     // por qué no entró ("access_denied" si dijo que no)
```

- `id` es **solo para este juego**: úsalo como clave si guardas algo de la persona. No uses el
  nombre (cambia) ni el número para eso.
- `avatar.url` es un VRM (a veces un GLB): cárgalo con `GLTFLoader` + `VRMLoaderPlugin`, como en
  `src/avatar.js`. Si no hay avatar o no carga, enseña algo por defecto: el juego nunca debe
  quedarse en blanco.
- `picture` es el retrato de su personaje (imagen cuadrada de 256 px): para juegos sin 3D. Puede
  faltar (aún no lo tiene o es invitado): entonces enseña la inicial de su nombre.
- `guest: true` = invitado de xenxo: tiene nombre, pero no cuenta ni número.

## El simulador (desarrollo)

Con `npm run dev`, el SDK no habla con xenxo: da un **jugador de prueba** («Jugador de prueba
#9999», con un personaje de serie que se descarga de xenxo) y pone un panel abajo a la izquierda
para cambiar entre *Jugador*, *Invitado* y *Sin sesión*. Prueba siempre los tres casos.
`xenxo.back()` en el simulador solo enseña adónde iría.

- Lo fuerza `src/xenxo-hud.js` (`simulate`) en desarrollo: va también desde otra IP
  (`npm run dev -- --host`, para el móvil o las gafas) y aunque la ficha ya tenga `clientId`.
- `VITE_XENXO_REAL=1 npm run dev` lo apaga: habla con el xenxo de verdad (la persona tiene que
  haber registrado `http://localhost:5173/` como dirección de vuelta).
- Publicado (`npm run build`), decide el SDK: con `clientId`, el xenxo de verdad.

## Reglas (no las rompas)

1. **El juego funciona sin xenxo.** Si `connect()` falla o devuelve `null`, se juega igual como
   «Jugador». Nada de pantallas bloqueadas pidiendo cuenta.
2. **`public/xenxo.json` siempre válido y al día** (esquema `xenxo.game/0`, abajo): pasa
   `npm run check` después de tocarla. Si el juego cambia de tipo, de equipos o empieza a tener
   anuncios o compras, actualízala.
3. **Nada de juego con dinero real**: ni apuestas, ni casino, ni cajas de botín de pago. Está
   prohibido en xenxo para cualquier edad.
4. **Privacidad:** no mandes los datos del jugador a terceros. En la página de vuelta de xenxo (la
   que lleva `?code=`) no cargues scripts de terceros (analíticas, anuncios) antes del SDK.
   `public/privacidad.html` describe lo que hace la plantilla: si añades algo que use datos
   (analíticas, anuncios, cuentas, guardar partidas en un servidor), **actualízala a la vez** y
   díselo a la persona. Nunca escribas en ella algo que el juego no cumpla.
5. **Nunca pongas secretos en el código.** El `clientId` no es secreto (va en `xenxo.json`); las
   claves de servicios (si algún día hay servidor) van en variables de entorno.
6. **Rendimiento:** tiene que ir en un móvil normal y en unas Meta Quest 3. En el bucle de dibujo no
   crees objetos (`new THREE.Vector3()` dentro de `setAnimationLoop` tira los FPS): reutiliza.
   Comparte geometrías y materiales, `devicePixelRatio` como mucho 2, pocas luces y nada de sombras
   por defecto.
7. **Recursos:** modelos, texturas y sonidos propios o con licencia libre (CC0 de Poly Haven,
   ambientCG, Kenney, Quaternius…). Guárdalos en `public/` y apunta su licencia en el README.
8. **Textos de la interfaz en español e inglés** como mínimo (usa `idioma` de `xenxo-hud.js`).
9. **PC, móvil y gafas VR.** El objetivo es que se pueda jugar en los tres: teclado en el PC,
   controles táctiles **visibles** en el móvil (botones o joystick en pantalla, que funcionen con
   varios dedos a la vez: eventos de puntero, no `click`) y, en las gafas, en la ventana del
   navegador de las Quest con el puntero de los mandos (lo mismo que el táctil). Si algún equipo no
   va, quítalo de `devices`: xenxo avisa a quien entre desde él y no le abre el juego. La plantilla
   trae solo «arrastrar en la pantalla» como punto de partida: añade controles visibles antes de
   publicar con `mobile`.
10. **Se ve quién juega.** xenxo es un metaverso: la persona lleva su identidad a tu juego. Si en tu
    juego se maneja un personaje, es **su personaje de xenxo** (`jugador.avatar`, como en
    `src/avatar.js`; sin cuenta, uno de serie) y la ficha dice `"avatar": "character"`. Si no hay
    personaje (2D, naves, puzles), enseña su nombre, su número y su retrato (`jugador.picture`,
    como en la barra de `xenxo-hud.js`) y la ficha dice `"avatar": "badge"`. La revisión lo comprueba.
11. **El personaje no es tuyo.** Su personaje, su retrato, su nombre y su número solo sirven para
    representarle en esa partida: no los guardes más allá de la sesión (su `id` sí, para sus
    partidas), no los vendas ni los pases a nadie, no los cambies para otra cosa ni los uses para
    entrenar modelos, anuncios o perfiles. Si no, xenxo retira el juego.

## `public/xenxo.json` (esquema `xenxo.game/0`)

| Campo | Qué es |
|---|---|
| `schema` | Siempre `"xenxo.game/0"` |
| `name`, `description` | `{ "es": …, "en": … }` (otros idiomas opcionales). Nombre ≤ 60, descripción ≤ 280 |
| `category` | `game3d`, `game2d`, `social`, `tool` u `other` |
| `devices` | Lista de `pc`, `mobile`, `vr` (solo los que de verdad funcionan). xenxo **avisa y no abre** el juego en los equipos que no estén |
| `multiplayer` | `true` o `false` |
| `avatar` | `"character"` (se juega con su personaje de xenxo), `"badge"` (se ven su retrato, su nombre y su número) o `"none"` (no se usa la identidad de xenxo; no vale si el juego usa «Entrar con xenxo») |
| `ageRating` | `"all"` o `"+14"` |
| `monetization` | `{ "hasAds": bool, "hasPurchases": bool }` |
| `author`, `contact` | Quién lo hace y un email o web de contacto (la plantilla trae unos de ejemplo: `npm run check` avisa) |
| `privacy` | Página de privacidad del juego (https). Obligatoria para registrar la ficha en xenxo. La plantilla apunta a `https://{{name}}.pages.dev/privacidad.html`: cámbiala si wrangler dio otra dirección |
| `thumbnail` | Opcional: portada 16:9 (`/portada.webp` o https). Hoy xenxo enseña la portada que se sube al publicar el proyecto |
| `embed` | Si se puede abrir dentro de xenxo (iframe aislado). Por defecto `true` |
| `xenxo.clientId` | El `xg_…` que da xenxo al registrar el juego («Entrar con xenxo») |
| `xenxo.project` | El id del proyecto en xenxo (su parcela): para `xenxo.back()` |

No inventes campos: xenxo rechaza la ficha si hay alguno que no conoce. Con `xenxo.clientId`,
`avatar` no puede ser `"none"`.

## Publicar y conectarlo con xenxo (lo hace la persona)

Tú puedes preparar el código y la ficha; las cuentas y los registros los hace la persona. Guíala
en este orden (el README lo cuenta también):

1. `npx wrangler login` (la primera vez) y `npm run deploy` (Cloudflare Pages, gratis), o cualquier
   alojamiento estático (GitHub Pages, Netlify, Vercel, itch.io). La dirección buena es **la que
   imprime wrangler** (no siempre es `https://{{name}}.pages.dev/`): si cambia, actualiza `privacy`.
2. En xenxo.io → **Proyectos → Publicar el mío**: enlace, distrito, parcela, portada y monumento
   (valen los provisionales de `xenxo/` para empezar).
3. En *«Entrar con xenxo» en tu juego*: registra el juego con esa dirección **exacta** como
   dirección de vuelta (y `http://localhost:5173/` si quiere probarlo en su equipo) y elige el
   proyecto. Da `clientId` y `project`.
4. Pon `clientId` y `project` en `public/xenxo.json`, `npm run check` y vuelve a publicar.
5. En su proyecto, **Ficha del juego → Leer su xenxo.json**: da el enlace `xenxo.io/j/<nombre>`
   (abrirlo dentro de xenxo, catálogo, jams y portales de distrito). Exige `privacy`.

Más: https://xenxo.io · SDK: https://www.npmjs.com/package/@xenxo/sdk
