# @xenxo/sdk — «Entrar con xenxo»

Deja que la gente entre en tu juego web con su cuenta de [xenxo.io](https://xenxo.io): recibes su
**nombre**, su **número de jugador** y su **personaje (VRM)** si te dan permiso, firmados por xenxo.
Sin dependencias, unos 8 KB. Licencia MIT: tu juego sigue siendo tuyo. *(English below.)*

## 1. Registra tu juego

En xenxo.io → **Proyectos** → *«Entrar con xenxo» en tu juego*: nombre y **dirección de vuelta**
(la página de tu juego a la que vuelve la persona; `https://`, o `http://localhost` para probar).
Tiene que coincidir **exacta** con `redirectUri`: ojo con los alojamientos que quitan el `.html` o
añaden la barra final.
Te da un `client_id` (`xg_…`). No hay secreto: los juegos web son clientes públicos y la
seguridad la pone PKCE.

## Lo más rápido: la plantilla

```sh
npm create xenxo@latest
```

Crea un juego 2D o 3D con el SDK, la ficha `xenxo.json`, el simulador y un `AGENTS.md` para tu IA.
Si ya tienes juego, sigue aquí.

## 2. Ponlo en tu juego

```sh
npm install @xenxo/sdk
```

o, sin instalar nada, `import { xenxo } from "https://xenxo.io/sdk/xenxo.mjs"`.

> **¿`npm install` da 404?** Aún no está publicado en npm. Usa la versión de
> `https://xenxo.io/sdk/xenxo.mjs` o empaquétalo del repositorio:
> `git clone https://github.com/xenxo-dev/xenxo-world && cd xenxo-world && npm install && npm pack -w @xenxo/sdk`
> e instala el `.tgz` que deja (`npm install ruta/xenxo-sdk-0.3.0.tgz`).

```html
<button id="entrar" hidden>Entrar con xenxo</button>
<script type="module">
  import { xenxo } from "https://xenxo.io/sdk/xenxo.mjs";
  const jugador = await xenxo.connect({
    clientId: "xg_…",
    redirectUri: "https://mijuego.example/",   // exacta, como la registraste
    scopes: ["profile", "player", "avatar"],
  });
  if (!jugador) {
    const b = document.querySelector("#entrar");
    b.hidden = false;
    b.onclick = () => xenxo.login();
  } else {
    console.log(jugador.name, jugador.playerNo, jugador.avatar?.url);
  }
</script>
```

`jugador`:

| Campo | Qué es |
|---|---|
| `id` | Identificador de la persona **solo para tu juego** (en otro juego es otro) |
| `name` | Nombre visible (con `profile`) |
| `playerNo` | Número de jugador de xenxo (con `player`). Es el mismo en todos los juegos: con él, varios juegos pueden saber que es la misma persona, por eso se pide aparte |
| `avatar` | `{ url, format, hash }` de su personaje (con `avatar`): un VRM que cargas con `@pixiv/three-vrm`, UniVRM (Unity) o el importador de Godot |
| `picture` | Retrato de su personaje (imagen cuadrada de 256 px, con `avatar`), para juegos sin 3D. Puede faltar: enseña su inicial |
| `idToken` | El id_token firmado, para que tu servidor lo compruebe si quiere |
| `signatureChecked` | Si el navegador comprobó la firma Ed25519 |
| `guest` | Invitado de xenxo: nombre, pero sin cuenta ni número |
| `simulated` | Jugador del simulador local |

`redirectUri` es opcional: por defecto, la página actual sin parámetros (`origen + ruta`).

`xenxo.error` dice por qué no entró (`access_denied` si dijo que no). `xenxo.logout()` lo olvida
en tu página (el permiso se retira en xenxo → Cuenta → Juegos conectados).

## Simulador (en tu equipo)

En `localhost` y sin `clientId`, `connect()` no habla con xenxo: devuelve un **jugador de prueba**
(«Jugador de prueba #9999», con un personaje de serie) y pone un panel abajo a la izquierda para
cambiar entre *Jugador*, *Invitado* y *Sin sesión*. Así pruebas todo sin cuenta (el personaje y el
retrato de prueba se descargan de xenxo; sin red, enseña lo que tengas por defecto).
`jugador.simulated` dice si es de prueba.

Fuérzalo o quítalo con `simulate: true | false`. Ojo con dos casos en los que, sin forzarlo, **no**
hay simulador: desde otra IP (el móvil o las gafas contra tu equipo) y en `localhost` en cuanto pones
el `clientId`. Con Vite, lo cómodo es simular siempre en desarrollo salvo que pidas lo real (es lo que
hace la plantilla de `npm create xenxo`):

```js
const simulate = import.meta.env.DEV && !import.meta.env.VITE_XENXO_REAL ? true : undefined;
await xenxo.connect({ clientId, project, simulate });
// VITE_XENXO_REAL=1 npm run dev → el xenxo de verdad (registra http://localhost:5173/ como vuelta)
```

## Volver a xenxo e idioma

```js
await xenxo.connect({ clientId: "xg_…", project: "id-de-tu-proyecto" });
boton.onclick = () => xenxo.back();   // a xenxo, delante del portal de tu proyecto
const idioma = xenxo.lang;            // "es", "en"… (el que diga xenxo, o el del navegador)
```

`project` es el id de tu proyecto en xenxo (Proyectos → *«Entrar con xenxo» en tu juego* te lo da
junto al `client_id`). Sin él, `back()` lleva a la portada de xenxo. Si xenxo abrió tu juego dentro
de su página, `back()` se lo pide a xenxo en vez de navegar.

## Dentro de xenxo

Si tu ficha (`xenxo.json`) dice `"embed": true`, xenxo puede abrir tu juego dentro de su página
(un iframe aislado en tu dominio). El SDK lo detecta solo: `xenxo.embedded` es `true`, `xenxo.lang`
es el idioma de la persona, `xenxo.login()` enseña el permiso encima del juego **sin salir de él**
(el código llega por `postMessage` a tu origen exacto) y `xenxo.back()` cierra el juego y devuelve
a la persona al mundo. xenxo no le cuenta nada de la persona hasta que entra con su permiso.
No tienes que hacer nada distinto: que tu dirección de vuelta registrada sea la de esa página y que
el `client_id` esté en `xenxo.json` (`"xenxo": { "clientId": "xg_…" }`), porque dentro de xenxo solo
se acepta el juego que declara la ficha.

## Comprobarlo en tu servidor

El `id_token` es un JWT firmado con **EdDSA (Ed25519)**. Claves públicas en
`https://api.xenxo.io/.well-known/jwks.json` y todo lo demás en
`https://api.xenxo.io/.well-known/openid-configuration`. Comprueba `iss`, `aud` (tu `client_id`),
`exp` y la firma; cualquier librería OpenID Connect que admita EdDSA sirve.

## Qué hace por ti (y por qué es seguro)

- PKCE con S256, `state` y `nonce` en cada entrada; nada de secretos en el navegador.
- La dirección de vuelta tiene que ser exacta a la registrada: nadie puede llevarse el código a otra web.
- Los códigos sirven una vez y 60 segundos; el id_token, una hora.
- Lo que recuerda se guarda en `sessionStorage` de tu página y se borra al cerrar la pestaña.
- Comprueba que la respuesta viene de xenxo (`iss`, RFC 9207) y la firma, el destinatario, la caducidad y el `nonce` del id_token.

**Tu parte:** en la página de vuelta no cargues scripts de terceros (analíticas, anuncios) antes del
SDK: la dirección lleva el código un instante, hasta que el SDK la limpia. Y si tu juego tiene
servidor, que compruebe él mismo el `idToken` (firma, `aud`, `exp`) en vez de fiarse de
`signatureChecked`.

Juego de ejemplo: [xenxo.io/sdk/ejemplo](https://xenxo.io/sdk/ejemplo) (pon tu `client_id`; para probarlo con tu
propio juego registrado, su dirección de vuelta es `https://xenxo.io/sdk/ejemplo`).

---

## English

"Sign in with xenxo" for web games: people sign in to your game with their
[xenxo.io](https://xenxo.io) account and, if they allow it, you get their **name**, **player number**
and **character (VRM)**, signed by xenxo. No dependencies, about 8 KB, MIT.

1. **Register your game** at xenxo.io → **Projects** → *"Sign in with xenxo" in your game*: a name and
   the **return address** (your game's page; `https://`, or `http://localhost` for testing). It must
   match `redirectUri` **exactly** (watch out for hosts that drop `.html` or add a trailing slash).
   You get a `client_id` (`xg_…`) and no secret: web games are public clients, PKCE keeps it safe.
   The fastest start is the template: `npm create xenxo@latest -- --lang en`.
2. **Add it to your game**: `npm install @xenxo/sdk` or `import { xenxo } from "https://xenxo.io/sdk/xenxo.mjs"`
   (if npm returns 404 it isn't published yet: use that URL or `npm pack -w @xenxo/sdk` from the
   [repository](https://github.com/xenxo-dev/xenxo-world)).

```js
const player = await xenxo.connect({ clientId: "xg_…", project: "your-project-id", scopes: ["profile", "player", "avatar"] });
if (!player) loginButton.onclick = () => xenxo.login(); // null = not signed in yet
else console.log(player.name, player.playerNo, player.avatar?.url, player.picture);
backButton.onclick = () => xenxo.back();                 // back to xenxo, in front of your portal
```

`player` has `id` (only valid in your game), `name`, `playerNo`, `avatar` (`{ url, format, hash }`),
`picture` (256 px portrait), `idToken`, `signatureChecked`, `guest` and `simulated`. `redirectUri`
defaults to the current page (origin + path). `xenxo.error` says why sign-in failed
(`access_denied` if they said no); `xenxo.lang` is the person's language.

**Simulator:** on `localhost` without a `clientId`, `connect()` returns a test player ("Jugador de
prueba #9999") and shows a panel to switch between player, guest and signed out. Force it on or off
with `simulate: true | false`: without forcing, there is **no** simulator from another IP (your phone
or headset) or on localhost once you set the `clientId`. With Vite:
`simulate: import.meta.env.DEV && !import.meta.env.VITE_XENXO_REAL ? true : undefined`.

**Inside xenxo:** with `"embed": true` in your `xenxo.json`, xenxo may open your game in a sandboxed
iframe; the SDK detects it (`xenxo.embedded`), shows the consent on top of the game and `back()`
closes it. Keep the `client_id` in `xenxo.json` (`"xenxo": { "clientId": "xg_…" }`).

**On your server:** the `id_token` is an EdDSA (Ed25519) JWT. Keys at
`https://api.xenxo.io/.well-known/jwks.json`, discovery at
`https://api.xenxo.io/.well-known/openid-configuration`. Check `iss`, `aud` (your `client_id`), `exp`
and the signature. On the return page (the one with `?code=`) don't load third-party scripts before
the SDK.

Example game: [xenxo.io/sdk/ejemplo](https://xenxo.io/sdk/ejemplo).
