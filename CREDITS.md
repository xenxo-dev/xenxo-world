# Créditos

Los recursos gráficos que no son propios son de dominio público (CC0): no hace falta atribuirlos, pero se agradece.
La excepción son las texturas generadas con IA (abajo), que tienen su propia nota.

- **Texturas y cielo**: [Poly Haven](https://polyhaven.com) y [ambientCG](https://ambientcg.com) (CC0). La lista exacta está en
  `apps/web/src/world/material-library.json` y `apps/web/src/world/sky-day.json`.
- **Personas de serie**: generadas con [MPFB / MakeHuman](https://static.makehumancommunity.org)
  y sus paquetes de recursos CC0 (pieles, pelo, ropa).
- **Animaciones**: [Universal Animation Library](https://quaternius.com) de Quaternius (CC0).
- **Tipografías**: Inter, Archivo y Tilt Neon de Andy Clymer, para los rótulos de neón (SIL Open Font License), empaquetadas con la web.

## Generado con IA

Texturas en `tools/materials/generated/` (cada una con su `meta.json`: plataforma, modelo, fecha,
plan y prompt). Son de xenxo según las condiciones de cada plataforma, que dan la propiedad y el
uso comercial de lo generado, pero **no son CC0**: las condiciones de Higgsfield prohíben usar sus
resultados para entrenar modelos de IA, y esa restricción acompaña a estas imágenes.

- **Fondo panorámico del nexo** (`tools/materials/generated/nexo-panorama/`, servido como
  `apps/web/public/sky/nexo-*.webp`): megaciudad cyberpunk y espacio, de noche y de día. Seis
  paneles generados con Higgsfield (GPT Image 2.5, plan Plus, 26-10-2026) y unidos con `stitch.py`.

Herramientas: Blender, VRM Add-on for Blender, glTF-Transform, meshoptimizer, three.js, @pixiv/three-vrm.
