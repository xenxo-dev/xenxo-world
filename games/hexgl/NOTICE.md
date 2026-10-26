# HexGL en xenxo — licencias

**HexGL** es de [Thibaut Despoulain (BKcore)](https://github.com/BKcore/HexGL). Esta copia está
adaptada para [xenxo.io](https://xenxo.io) y se usa **sin fines comerciales** (sin anuncios ni compras).

- **Código y recursos:** MIT (`LICENSE`), «salvo que el archivo diga otra cosa».
- **Lo que dice otra cosa:** los archivos de `bkcore/hexgl/` (lógica, HUD, nave, cámara y el circuito
  Cityscape) llevan en su cabecera *Creative Commons Attribution-NonCommercial 3.0*
  ([CC BY-NC 3.0](https://creativecommons.org/licenses/by-nc/3.0/)). Por eso este juego no puede
  tener anuncios, compras ni ningún uso comercial mientras use esos archivos.
- **Sonidos:** CC BY 3.0 o dominio público, con sus autores en `audio/LICENSE`.
- **Gráficos:** modelo base HexMKI de Charnel; textura del circuito de Nobiax.
- **Letra:** Bebas Neue (Dharma Type).

## Cambios de xenxo (2026)

- `index.html`: sin analíticas de terceros ni enlaces a redes; créditos ampliados; carga `xenxo/`.
- `launch.js`: textos en español e inglés, sin Leap Motion, calidad media por defecto en táctil.
- `bkcore/hexgl/HexGL.js`: al acabar una carrera avisa a `xenxo/xenxo-hexgl.js` (mejor tiempo).
- `xenxo/`: «Entrar con xenxo» con [`@xenxo/sdk`](https://www.npmjs.com/package/@xenxo/sdk) (MIT),
  barra con tu nombre y número, mejor tiempo por jugador y «Volver a xenxo».
- `xenxo/monumento.glb`: la nave Feisar convertida a glTF para la parcela de Arcade
  (`xenxo/tools/`).
- Se han quitado `package.zip`, el *appcache*, los manifiestos de Firefox OS y el editor de `libs/`.
