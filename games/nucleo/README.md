# Núcleo · Core

Juego de ejemplo de xenxo.io hecho con `@xenxo/sdk`, como lo haría cualquier creador: su ficha
(`xenxo.json`), su privacidad (`privacidad.html`), su dominio (`xenxo-nucleo.xenxo.workers.dev`,
nunca `*.xenxo.io`) y su parcela en **Distrito Cero**.

**Cómo se juega.** La puerta del núcleo tiene tres cerraduras, cada una con una secuencia de
códigos. Se elige un código de la fila marcada; después, uno de su columna; después, de su fila…
Cada código va a la memoria y, cuando en ella aparece la secuencia de una cerradura, se abre. Con
las tres abiertas se pasa de nivel. Siempre hay solución: la matriz sale de un camino válido.

- Sin compilar: `index.html`, `style.css` y `game.js` (módulo) tal cual.
- En local: `python3 -m http.server` aquí (el SDK arranca su simulador); copia antes
  `packages/sdk/dist/index.js` en `xenxo/xenxo-sdk.mjs` (el despliegue lo hace solo).
- Monumento de la parcela: `python3 xenxo/tools/monumento.py` → `xenxo/monumento.glb`.

## Publicarlo en xenxo

1. Panel → Proyectos → Publicar el mío: nombre, enlace `https://xenxo-nucleo.xenxo.workers.dev/`,
   distrito **Distrito Cero**, una parcela libre, `portada.webp` y `xenxo/monumento.glb`.
2. En el proyecto, «Registrar juego» con la ficha `https://xenxo-nucleo.xenxo.workers.dev/xenxo.json`.
3. Copia el `clientId` (`xg_…`) y el id del proyecto en `xenxo.json` → `xenxo` y vuelve a desplegar.
