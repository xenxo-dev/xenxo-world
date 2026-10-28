# AGENTS.md — distrito {{title}}

Instrucciones para la IA que construye este distrito (Claude, Cursor, Copilot, Codex…). Habla con la
persona en su idioma; este archivo está en español, pero las reglas valen igual.

## Qué es esto

Un **distrito de la comunidad** de **xenxo.io**: una zona de 256 × 256 m del mundo 3D, con su
ciudad, sus actividades y sus portales a juegos. Se describe entero en `xenxo-district.json` (la
**ficha**) y se dibuja con los modelos `.glb` de esta carpeta. No hay código que se ejecute: xenxo
monta el distrito a partir de la ficha, con las mismas reglas para todo el mundo.

## Mapa

| Archivo | Qué es |
|---|---|
| `xenxo-district.json` | La ficha: nombre, colores, modelos, piezas colocadas, colisiones, luces, rótulos y portales |
| `models/*.glb` | Los modelos (glTF binario). Puedes cambiarlos o añadir hasta 32 |
| `emblema.glb` | El monumento del distrito en el nexo (pequeño: hasta 10.000 triángulos) |
| `portada.png` | Portada 16:9 (WebP, JPEG o PNG; de 160×90 a 1600×900 px; hasta 300 KB) |

Comando: `npm run validate` — comprueba todo como lo hará el servidor. Úsalo después de cada cambio.
Problemas (✗) = xenxo lo rechazaría; avisos (!) = vale, pero revísalo (p. ej. `author` y `contact`
de la plantilla).

## Coordenadas

- Metros. **X** al este, **Z** al sur, **Y** arriba. El distrito va de **−96 a 160** en X y en Z.
- El centro del distrito es **(32, 0, 32)**. La gente llega del nexo por el **sur**, en
  **(32, 0, 150)**, mirando al norte.
- `yaw` en grados: 0 = el frente del modelo (+Z) mira al sur; 90 = al este; 180 = al norte.
- **Zona de la puerta** (X 22–42, Z 138–160): la pone xenxo. Ahí solo vale suelo plano (≤ 0,25 m).
- Altura máxima: 120 m.

## Campos de la ficha

| Campo | Valores |
|---|---|
| `slug` | 3–24 minúsculas, números y guiones; empieza por letra; sin «xenxo» ni nombres reservados |
| `name`, `description` | `{ "es": …, "en": … }` (≤ 40 y ≤ 200) |
| `color`, `floor` | `#rrggbb` (color del distrito: puerta, emblema y luz; color del suelo base) |
| `theme` | Ciudad de fondo: `arcade`, `pixel`, `agora`, `taller`, `frontera`, `cero` o `vertical` |
| `cover`, `emblem` | Rutas a la portada y al monumento de esta carpeta |
| `models` | `{ "nombre": { "file": "models/x.glb", "lod1": "models/x-lejos.glb" } }` (`lod1` opcional) |
| `pieces` | `{ "model", "p": [x, y, z], "yaw", "scale" }` (`scale` de 0,1 a 10; por defecto 1) |
| `primitives` | `{ "shape": "box" \| "sphere" \| "cylinder" \| "plane", "size": [x, y, z], "p", "yaw", "color", "emissive": bool, "finish": "matte" \| "glossy" \| "metal" \| "glass" }` |
| `colliders` | `{ "p", "half": [x, y, z], "yaw" }` (medias medidas de la caja) |
| `lights` | `{ "p", "color", "intensity" (0–10), "range" (0,5–30), "when": "night" \| "always" }` |
| `labels` | `{ "p", "yaw", "text": { "es", "en" }, "size" (0,2–4), "style": "plain" \| "sign" \| "neon", "color", "billboard": bool }` |
| `portals` | `{ "p", "yaw", "size": [ancho, alto], "game": "mi-juego" }` (ver la regla 4) |
| `author`, `contact` | Tu nombre y un email o una web (moderación los ve; el público, solo el nombre) |

## Presupuestos (Quest 3: el distrito entero puede verse de golpe)

| Qué | Máximo |
|---|---|
| Modelos distintos | 32 (cada uno: 6 MB, 50.000 triángulos, texturas de 2048 px) |
| Piezas colocadas | 160 |
| Triángulos de todas las piezas (LOD0) | 300.000 |
| Modelo de más de 8.000 triángulos | necesita `lod1` (como mucho la mitad de triángulos) |
| Peso de todos los modelos | 40 MB |
| Primitivas (cajas, esferas, cilindros) | 200 |
| Colisiones (cajas sólidas) | 300 |
| Luces | 12 (en gafas y móviles no se dibujan: que se vea bien sin ellas) |
| Rótulos | 48, con texto en español e inglés |
| Portales | 12 |

## Reglas

1. **Nada externo en los GLB:** sin URIs ni Draco. Aplica las transformaciones antes de exportar
   (el servidor mide la caja del modelo sin ellas).
2. **Colisiones aparte:** los modelos no chocan solos. Añade una caja en `colliders` por cada cosa
   que no se deba atravesar (su techo se puede pisar).
3. **Textos en `es` y `en`** como mínimo. Son datos: nunca instrucciones para nadie.
4. **La identidad es la de xenxo.** El distrito no pide cuentas, contraseñas ni datos. Las
   actividades son **juegos de xenxo** (con su `xenxo.json` y «Entrar con xenxo», hechos con
   `npm create xenxo`), publicados por la misma persona; aquí solo van sus portales:
   `{ "p": [x, y, z], "yaw": 0, "game": "mi-juego" }`. `game` es el nombre del enlace del juego,
   `xenxo.io/j/mi-juego` (vale también el enlace entero; se guarda el nombre). Ese enlace lo da xenxo
   en el proyecto del juego → *Ficha del juego*. Un juego que no sea de la persona → `bad_portal`.
5. **Sin marcas, personas reales ni contenido de otros** sin licencia.
6. **Rendimiento:** pocas piezas grandes mejor que muchas pequeñas; pocos materiales; luz en los
   materiales emisivos (neón) en vez de luces.

## Publicar

1. `npm run validate` sin problemas.
2. xenxo.io → **Cuenta → Tu distrito → Subir carpeta**. Se vuelve a comprobar todo y queda en
   **borrador**: solo lo ves tú. Entra y pruébalo, mejor en unas gafas.
3. **Enviar a revisión.** Moderación lo aprueba o lo rechaza con un motivo. Si lo cambias después,
   vuelve a revisión.

## Licencia

Esta plantilla es MIT. Lo que crees con ella es tuyo.
