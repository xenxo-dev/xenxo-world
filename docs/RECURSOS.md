# De dónde sacar recursos para xenxo

Todo lo que entra en el repo tiene que poder redistribuirse en un proyecto de código abierto.
Por eso la base es **CC0** (dominio público): sin atribución obligatoria y sin sorpresas.
Lo generado con IA también vale, con sus reglas (abajo).

Nada se enlaza en caliente: los archivos se descargan, se preparan y se sirven desde xenxo
(el navegador del visitante nunca habla con estas plataformas).

## Texturas y cielos

| Plataforma | Licencia | Qué tiene | Cómo se usa en xenxo |
|---|---|---|---|
| [Poly Haven](https://polyhaven.com) | CC0 | Escaneos reales (piedra, madera, cal…), cielos HDRI | `tools/materials/fetch.py` (automático) |
| [ambientCG](https://ambientcg.com) | CC0 | Materiales PBR: metal, paneles, suelos técnicos, azulejos… | `tools/materials/fetch.py` con el prefijo `acg:<Id>` (automático) |
| [ShareTextures](https://www.sharetextures.com) | CC0 | ~600 texturas 4K y algunos modelos | A mano: descarga el set y añádelo como textura propia (`generated/` con `platform: "ShareTextures"`) |
| [cgbookcase](https://www.cgbookcase.com) | CC0 | Texturas PBR | Igual que ShareTextures |
| Higgsfield y plataformas de IA | Propiedad de xenxo, **no CC0** | Texturas a medida | `tools/materials/generated/` (ver su README) |

## Modelos 3D

| Plataforma | Licencia | Qué tiene | Notas |
|---|---|---|---|
| [Kenney](https://kenney.nl/assets) | CC0 | Miles de piezas de juego: ciudad, mobiliario, vehículos, espacio | Low-poly ligero: ideal para la Quest |
| [KayKit](https://kaylousberg.itch.io) | CC0 | Kits de bloques, mobiliario, mazmorras, minijuegos | Buenas plantillas para parcelas y distritos |
| [Quaternius](https://quaternius.com) | CC0 | Personajes, naturaleza, ciudad (y las animaciones que ya usamos) | |
| [Smithsonian Open Access](https://www.si.edu/openaccess) | CC0 (solo lo marcado CC0) | Más de 2.000 escaneos de museo | Pesados: simplifica antes de subir |
| [Poly Pizza](https://poly.pizza) | **Mixta** | Buscador enorme de low-poly | Usa solo los marcados CC0 |

**Orden para un modelo nuevo:** primero se busca en todas estas fuentes y se elige la opción de
más calidad; solo si nada llega al nivel se genera con IA (abajo).

### Modelos generados con IA

| Vía | Coste | Licencia de lo generado | Notas |
|---|---|---|---|
| Higgsfield → **Tripo** (texto a 3D) | ≈ 5 créditos por modelo | Propiedad y uso comercial (plan de pago), no CC0 | Lo que usamos: buena calidad, PBR, 3–5 k triángulos. `tools/models/generated/` |
| Higgsfield → **Meshy 6/7** | ≈ 25–38 créditos | Igual | Más caro; rigging y animaciones de personajes |
| **Meshy, plan gratuito** | 100 créditos al mes | **CC BY 4.0**: uso comercial citando a Meshy | Apúntalo en `CREDITS.md` con la atribución |
| **TripoSR** en local (MIT) | Gratis | MIT | Cabe en 6 GB (GTX 1060), calidad mucho menor y sin PBR. Necesita CUDA (NVIDIA) |
| **TRELLIS.2** en local (MIT) | Gratis | MIT | Muy bueno, pero pide 24 GB de VRAM (NVIDIA) |
| ~~Hunyuan3D~~ (Tencent) | — | **Excluye la UE**, Reino Unido y Corea del Sur | No se usa |

Los modelos de IA en local necesitan una NVIDIA (CUDA); una AMD (p. ej. RX 5700 XT) sirve para
renderizar en Blender (Cycles con HIP), no para estos modelos.

Los modelos se suben como cualquier otro: desde la web o con
`npm run upload-asset -w @xenxo/headless -- <archivo.glb>` (se validan y optimizan igual).

## Avatares

| Plataforma | Licencia | Qué tiene |
|---|---|---|
| [100Avatars (Polygonal Mind)](https://polygonalmind.com/100avatars) | CC0 | VRM listos para usar |
| [Open Source Avatars](https://www.opensourceavatars.com) | CC0 (por avatar) | Registro de VRM abiertos |
| MakeHuman / MPFB | CC0 | Lo que usa `tools/avatars/` para los de serie |

## Sonido

| Plataforma | Licencia | Notas |
|---|---|---|
| [Freesound](https://freesound.org) | **Mixta** | Filtra por CC0: ambiente de plaza, fuentes, pasos, zumbido de neón |

## Reglas

- Apunta en `CREDITS.md` de dónde sale cada cosa (aunque CC0 no lo exija, se agradece y deja rastro).
- Licencia mixta = mira cada archivo. Si no pone CC0 claramente, no entra.
- Nada de marcas, logotipos ni personajes con dueño, venga de donde venga.
