# @xenxo/sdk — «Entrar con xenxo»

Deja que la gente entre en tu juego web con su cuenta de [xenxo.io](https://xenxo.io): recibes su
**nombre**, su **número de jugador** y su **personaje (VRM)** si te dan permiso, firmados por xenxo.
Sin dependencias, unos 8 KB. Licencia MIT: tu juego sigue siendo tuyo.

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
| `idToken` | El id_token firmado, para que tu servidor lo compruebe si quiere |
| `signatureChecked` | Si el navegador comprobó la firma Ed25519 |
| `guest` | Invitado de xenxo: nombre, pero sin cuenta ni número |
| `simulated` | Jugador del simulador local |

`xenxo.error` dice por qué no entró (`access_denied` si dijo que no). `xenxo.logout()` lo olvida
en tu página (el permiso se retira en xenxo → Cuenta → Juegos conectados).

## Simulador (en tu equipo)

En `localhost` y sin `clientId`, `connect()` no habla con xenxo: devuelve un **jugador de prueba**
(«Jugador de prueba #9999», con un personaje de serie) y pone un panel abajo a la izquierda para
cambiar entre *Jugador*, *Invitado* y *Sin sesión*. Así pruebas todo sin cuenta. Fuérzalo o quítalo
con `simulate: true | false`. `jugador.simulated` dice si es de prueba.

## Volver a xenxo e idioma

```js
await xenxo.connect({ clientId: "xg_…", project: "id-de-tu-proyecto" });
boton.onclick = () => xenxo.back();   // a xenxo, delante del portal de tu proyecto
const idioma = xenxo.lang;            // "es", "en"… (el que diga xenxo, o el del navegador)
```

`project` es el id de tu proyecto en xenxo (Proyectos → *«Entrar con xenxo» en tu juego* te lo da
junto al `client_id`). Sin él, `back()` lleva a la portada de xenxo. Si xenxo abrió tu juego dentro
de su página, `back()` se lo pide a xenxo en vez de navegar.

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
