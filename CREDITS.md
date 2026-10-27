# Créditos

Los recursos gráficos que no son propios son de dominio público (CC0): no hace falta atribuirlos, pero se agradece.
La excepción son las texturas generadas con IA (abajo), que tienen su propia nota.

- **Texturas y cielo**: [Poly Haven](https://polyhaven.com) y [ambientCG](https://ambientcg.com) (CC0). La lista exacta está en
  `apps/web/src/world/material-library.json` y `apps/web/src/world/sky-day.json`.
- **Personas de serie**: generadas con [MPFB / MakeHuman](https://static.makehumancommunity.org)
  y sus paquetes de recursos CC0 (pieles, pelo, ropa).
- **Animaciones**: [Universal Animation Library](https://quaternius.com) de Quaternius (CC0).
- **Kits de ciudad** (`tools/kits/kenney/`): packs de [Kenney](https://kenney.nl) (CC0), descargados el 27-10-2026. La lista está en `tools/kits/README.md`.
- **Coche para conducir** (`tools/models/library/vehicle_car*`): «Car Concept», de los modelos de
  muestra de glTF de Khronos ([KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept)),
  © The Khronos Group, con licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); hecho a
  partir de un modelo de dominio público de Unity Fan. **Modificado** para xenxo con
  `tools/models/library/concept-car.mjs`: sin los logotipos de Khronos (sus marcas no entran en la
  licencia), sin piezas ocultas, simplificado, con el cristal sin transmisión y separado en
  carrocería, puertas y ruedas. No es CC0: hay que mantener esta atribución.
- **Física del coche**: [Rapier](https://rapier.rs) de Dimforge (Apache-2.0), su vehículo de rayos con suspensión.
- **Tipografías**: Space Grotesk (titulares y carteles), Inter (texto), IBM Plex Mono (datos técnicos) y Tilt Neon de Andy Clymer (rótulos de neón), todas con licencia SIL Open Font License y empaquetadas con la web (sin CDN).

## Generado con IA

Texturas en `tools/materials/generated/` (cada una con su `meta.json`: plataforma, modelo, fecha,
plan y prompt). Son de xenxo según las condiciones de cada plataforma, que dan la propiedad y el
uso comercial de lo generado, pero **no son CC0**: las condiciones de Higgsfield prohíben usar sus
resultados para entrenar modelos de IA, y esa restricción acompaña a estas imágenes.

- **Conceptos de las cuatro ciudades** (`docs/conceptos/`, con su `meta.json`): ocho imágenes de
  referencia de estilo para Distrito Cero, Arcade, Píxel y Taller. No se sirven en el mundo.
- **Fondo panorámico del nexo** (`tools/materials/generated/nexo-panorama/`, servido como
  `apps/web/public/sky/nexo-*.webp`): megaciudad cyberpunk y espacio, de noche y de día. Seis
  paneles generados con Higgsfield (GPT Image 2.5, plan Plus, 26-10-2026) y unidos con `stitch.py`.
- **Modelos 3D de la vida de las ciudades** (`tools/models/generated/`, cada uno con su
  `meta.json`): coche volador (`hover_car`), dron de reparto (`drone`) y máquina expendedora
  (`vending`) y máquina recreativa de Arcade (`arcade_cabinet`). Generados con Higgsfield (Tripo, plan Plus, 27-10-2026); `tools/forge/pack.mjs` los
  pone a su tamaño y los optimiza.
- **Escultura de Xen** en Distrito Cero (`tools/models/generated/xen_statue/`): el modelo 3D del
  personaje oficial de xenxo.io, generado por Pencho con **Tripo** a partir de su diseño. Si viene
  del plan gratuito de Tripo, su licencia es CC BY 4.0: «Modelo generado con Tripo (tripo3d.ai)».

Herramientas: Blender, VRM Add-on for Blender, glTF-Transform, meshoptimizer, three.js, @pixiv/three-vrm.
