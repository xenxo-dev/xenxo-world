# Lo que se ve al compartir un enlace

Cuando alguien pega `xenxo.io/d/vertical` en WhatsApp, X, Discord o LinkedIn, esas aplicaciones no
ejecutan JavaScript: leen el HTML y buscan sus etiquetas Open Graph. Como xenxo es una sola página,
todas las rutas enseñaban lo mismo (y antes, nada).

`build.mjs` se lanza al final de `npm run build -w @xenxo/web` y escribe en `apps/web/dist/`:

| Archivo | Se sirve en | Qué lleva |
|---|---|---|
| `index.html` | `/` | La portada en español |
| `en.html` | `/en` | La portada en inglés |
| `d/<distrito>.html` | `/d/<distrito>` | El nombre y la descripción del distrito (`districts.json`) y su imagen |
| `d/<distrito>/<sitio>.html` | `/d/<distrito>/<sitio>` | El sitio (`apps/web/src/world/guide.json` y sus textos de `i18n.ts`) |
| `en/d/…` | `/en/d/…` | Lo mismo, en inglés |
| `sitemap.xml`, `robots.txt` | | El mapa del sitio para los buscadores |

Todas son la misma aplicación con otra cabecera (lo que hay entre `<!-- share:start -->` y
`<!-- share:end -->` en `apps/web/index.html`). Son archivos estáticos: no gastan ninguna petición
del plan gratuito. La aplicación lee la ruta al arrancar (`apps/web/src/routes.ts`) y lleva allí.

El dominio sale de `WEB_DOMAIN` (por defecto `xenxo.io`), como en el despliegue.

## Las imágenes

Están en `apps/web/public/og/<nombre>.jpg`: `xenxo.jpg` (la portada), `plaza.jpg` y una por distrito
abierto, de 1200 × 630 px. Son **capturas reales del mundo**, sin retocar y sin HUD: nada de arte
conceptual ni de imágenes generadas (lo que se enseña al compartir tiene que ser lo que se encuentra
al entrar).

Para rehacer una: abre el distrito en un navegador con gráfica, con la ventana a 1200 × 630, calidad
«Alta» o «Ultra» y el ambiente que mejor le quede (Personalizar), ve a un buen sitio, pasa a primera
persona (V) y haz la foto (P, o el modo cine). Guárdala como JPEG de calidad 85 más o menos. Si falta
la de un distrito, su página usa la de la portada y `build.mjs` lo avisa.

## Enlaces con etiqueta

Añade `?v=<etiqueta>` a cualquiera de estos enlaces (`xenxo.io/d/vertical?v=tiktok-12`) para saber,
sumado y sin identificar a nadie, cuántas visitas trae cada vídeo o publicación y cuántas acaban
entrando, creando cuenta o publicando (`apps/web/src/net/campaign.ts`; los totales, en moderación).
La etiqueta: minúsculas, números, guiones y guiones bajos, 24 caracteres como mucho.
