# Rodar vídeos del mundo

Dos formas de sacar vídeo de xenxo, sin programas de captura y sin que salga el HUD:

| | Para qué | Cómo |
|---|---|---|
| **Modo cine** | Rodar a mano, con una tarjeta gráfica de verdad | Dentro del mundo, tecla **K** |
| **`render.mjs`** | Rodar con un guion, también en una máquina sin tarjeta gráfica | `node tools/cine/render.mjs guion.json` |

Además, cualquier visitante puede grabar un **clip** de hasta 30 s con el botón de vídeo del HUD
(arriba a la derecha, junto a la foto): lleva la marca «xenxo.io · lugar», como las fotos.

Todo se graba en el navegador y se descarga: nada sale del equipo.

## Modo cine (tecla K)

Solo en escritorio. Quita el HUD y deja una barra de rodaje (no sale en el vídeo: se graba el
canvas del mundo, y la barra es HTML). El personaje se lleva igual que siempre.

| Tecla | Qué hace |
|---|---|
| **K** | Entrar y salir |
| **N** | Siguiente cámara |
| **L** | Grabar / parar (el vídeo se descarga al parar; 90 s como mucho por toma) |
| **B** | Con o sin tu personaje |
| **H** | Esconder la barra |

**Cámaras.** Cada plano empieza desde donde esté la cámara al elegirlo (elige otra vez la misma
para repetirlo):

- *La de siempre*: la cámara normal, detrás del personaje.
- *Órbita*: gira despacio alrededor del personaje (una vuelta en medio minuto).
- *Grúa*: sale de detrás, a ras de suelo, y sube y se aleja en nueve segundos.
- *Trípode*: se queda donde estaba y sigue al personaje con la mirada.
- *Travelling*: se desliza de lado, mirando a donde miraba.

**Encuadre.** *Pantalla* graba lo que se ve. *9:16*, *16:9* y *1:1* dan al mundo esa forma, centrado,
y lo dibujan a tamaño de vídeo (1080 × 1920, 1920 × 1080, 1080 × 1080) se vea al tamaño que se vea:
lo grabado ya es el vídeo final. Sube antes la calidad en *Personalizar → Gráficos* y elige el
ambiente (día o noche).

**Formato.** MP4 (H.264) donde el navegador sabe grabarlo (Chrome y Safari recientes); si no, WebM.

**Al empezar.** Tras pulsar grabar, el botón dice «Preparando…» hasta que el navegador arranca su
codificador (un instante con tarjeta gráfica; varios segundos sin ella), y el contador empieza
entonces: lo anterior no sale en el vídeo. Si paras antes, no hay vídeo que guardar, y se avisa.

Con la dirección también se puede entrar ya rodando:
`/d/vertical/mirador?cine=orbit&frame=9x16&self=0&bar=0` (`cine`: `follow`, `orbit`, `crane`,
`tripod`, `travel`; `frame`: `9x16`, `16x9`, `1x1`; `self=0`: sin personaje; `bar=0`: sin barra).

## Con un guion (`render.mjs`)

Para repetir un plano igual cuantas veces haga falta, o para rodar en un servidor sin tarjeta
gráfica. No graba en tiempo real: para el reloj de la página y avanza **fotograma a fotograma**, así
que da igual lo que tarde cada uno (en una máquina sin GPU, unos 3 s por fotograma en «medium»):
el vídeo sale fluido, a los fotogramas por segundo que pidas.

```sh
npm run dev:realtime &          # el mundo en local
npm run dev:web &               # la web de desarrollo (deja colocar al personaje donde digas)
node tools/cine/render.mjs tools/cine/guion.example.json            # todos los planos
node tools/cine/render.mjs tools/cine/guion.example.json vertical-grua   # solo uno
```

Necesita [Playwright](https://playwright.dev) con su Chromium y `ffmpeg`. Los vídeos quedan en la
carpeta `out` del guion (junto a él), en MP4 H.264.

### El guion

```json
{
  "url": "http://localhost:5173", "out": "videos", "fps": 30,
  "quality": "medium", "ambience": "night", "settle": 30,
  "shots": [
    { "name": "arcade-orbita", "place": "/d/arcade", "at": [32, 0, 56], "yaw": 0,
      "cam": "orbit", "frame": "9x16", "seconds": 6,
      "actions": [{ "t": 1, "press": "Digit1" }] }
  ]
}
```

| Campo | Qué es |
|---|---|
| `place` | El enlace del lugar: `/d/<distrito>` o `/d/<distrito>/<sitio>` (los de «Qué hacer aquí») |
| `at`, `yaw` | Dónde poner al personaje (metros del lugar) y hacia dónde mira (grados; 0 = norte). Solo con la web de desarrollo |
| `drag`, `zoom` | Antes de rodar: arrastrar la vista `[x, y]` en píxeles (`y` negativo mira hacia arriba) y la rueda (positivo aleja) |
| `cam` | `follow`, `orbit`, `crane`, `tripod` o `travel` (por defecto `orbit`) |
| `frame` | `9x16`, `16x9` o `1x1` |
| `seconds` | Lo que dura el plano |
| `self` | `false`: sin el personaje |
| `actions` | Lo que hace el personaje, en segundos del vídeo: `{ "t": 0.5, "hold": "KeyW", "for": 4 }` (mantener una tecla) o `{ "t": 1, "press": "Digit2" }` (pulsarla). Las teclas, como en el mundo: `KeyW/A/S/D`, `ShiftLeft` (correr), `Space`, `Digit1`–`4` (gestos), `KeyC` (coche)… |
| `quality`, `ambience`, `settle`, `lang` | Por plano o para todos: nivel gráfico (`low`…`ultra`), `day`/`night`, segundos de espera para que cargue el lugar, e idioma de los rótulos (`es`/`en`) |

Lo que llega por la red (otra gente, el chat) sigue en tiempo real: para planos con más gente,
conéctala antes (otros navegadores o `apps/headless`).

## Qué no hacer

- **Nada de marcas ni personas reales** en lo que se rueda (rótulos de la zona de pruebas, nombres).
- **Las vistas previas de los enlaces** (`apps/web/public/og/`) son capturas de verdad del mundo, no
  montajes: ver [`tools/share`](../share/README.md).
- La música y los rótulos se ponen después, al montar: aquí solo sale imagen.
