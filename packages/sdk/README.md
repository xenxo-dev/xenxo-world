# @xenxo/sdk — «Entrar con xenxo»

Deja que la gente entre en tu juego web con su cuenta de [xenxo.io](https://xenxo.io): recibes su
**nombre**, su **número de jugador** y su **personaje (VRM)** si te dan permiso, firmados por xenxo.
Sin dependencias, unos 5 KB. Licencia MIT: tu juego sigue siendo tuyo.

## 1. Registra tu juego

En xenxo.io → **Proyectos** → *«Entrar con xenxo» en tu juego*: nombre y **dirección de vuelta**
(la página de tu juego a la que vuelve la persona; `https://`, o `http://localhost` para probar).
Te da un `client_id` (`xg_…`). No hay secreto: los juegos web son clientes públicos y la
seguridad la pone PKCE.

## 2. Ponlo en tu juego

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

`xenxo.error` dice por qué no entró (`access_denied` si dijo que no). `xenxo.logout()` lo olvida
en tu página (el permiso se retira en xenxo → Cuenta → Juegos conectados).

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

Juego de ejemplo: [xenxo.io/sdk/ejemplo.html](https://xenxo.io/sdk/ejemplo.html) (pon tu `client_id`).
