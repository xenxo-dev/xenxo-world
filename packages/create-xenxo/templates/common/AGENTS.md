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
| `index.html` | Página de entrada (Vite) |

Comandos: `npm run dev` (abre el juego con el simulador), `npm run build` (a `dist/`),
`npm run deploy` (publica `dist/` en Cloudflare Pages con la cuenta de la persona).

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

En `localhost`, sin `clientId`, el SDK no habla con xenxo: da un **jugador de prueba** («Jugador
de prueba #9999», con un personaje de serie) y pone un panel abajo a la izquierda para cambiar
entre *Jugador*, *Invitado* y *Sin sesión*. Prueba siempre los tres casos. `xenxo.back()` en el
simulador solo enseña adónde iría.

## Reglas (no las rompas)

1. **El juego funciona sin xenxo.** Si `connect()` falla o devuelve `null`, se juega igual como
   «Jugador». Nada de pantallas bloqueadas pidiendo cuenta.
2. **`public/xenxo.json` siempre válido y al día** (esquema `xenxo.game/0`, abajo). Si el juego
   cambia de tipo, de equipos o empieza a tener anuncios o compras, actualízalo.
3. **Nada de juego con dinero real**: ni apuestas, ni casino, ni cajas de botín de pago. Está
   prohibido en xenxo para cualquier edad.
4. **Privacidad:** no mandes los datos del jugador a terceros. En la página de vuelta de xenxo (la
   que lleva `?code=`) no cargues scripts de terceros (analíticas, anuncios) antes del SDK.
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
   va, quítalo de `devices`: xenxo avisa a quien entre desde él y no le abre el juego.
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
| `author`, `contact` | Quién lo hace y un email o web de contacto |
| `privacy` | Página de privacidad del juego (https). Obligatoria para publicarlo en xenxo |
| `thumbnail` | Portada 16:9 (`/portada.webp` o https). Obligatoria para publicarlo en xenxo |
| `embed` | Si se puede abrir dentro de xenxo (iframe aislado). Por defecto `true` |
| `xenxo.clientId` | El `xg_…` que da xenxo al registrar el juego («Entrar con xenxo») |
| `xenxo.project` | El id del proyecto en xenxo (su parcela): para `xenxo.back()` |

No inventes campos: xenxo rechaza la ficha si hay alguno que no conoce.

## Publicar y conectarlo con xenxo (lo hace la persona)

1. `npm run deploy` (Cloudflare Pages, gratis) o cualquier alojamiento estático (GitHub Pages,
   Netlify, Vercel, itch.io). Apunta la dirección final, p. ej. `https://{{name}}.pages.dev/`.
2. En xenxo.io → **Proyectos**: publica el proyecto (enlace, distrito, parcela, portada y monumento)
   y, en *«Entrar con xenxo» en tu juego*, registra el juego con esa dirección **exacta** como
   dirección de vuelta. Da un `client_id`.
3. Pon `clientId` y `project` en `public/xenxo.json` y vuelve a publicar.

Más: https://xenxo.io · SDK: https://www.npmjs.com/package/@xenxo/sdk
