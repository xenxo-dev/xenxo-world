# Avatares de serie y animaciones

Personas realistas generadas con **MPFB** (MakeHuman para Blender) y animadas con la
**Universal Animation Library** de Quaternius. Todo es CC0.

## Preparación (una vez)

1. Blender 5 como módulo: `pip install --break-system-packages bpy==5.2.3`.
2. Extensiones en ese Blender (`bpy.ops.extensions.package_install_files`):
   - MPFB 2 (`src/mpfb` de github.com/makehumancommunity/mpfb2, empaquetado en .zip),
   - *VRM format* (`src/io_scene_vrm` de github.com/saturday06/VRM-Addon-for-Blender).
3. Paquetes CC0 de MakeHuman descomprimidos en la carpeta de datos de MPFB
   (`~/.config/blender/5.2/extensions/.user/user_default/mpfb/data`):
   `makehuman_system_assets`, `skins01`, `skins02`, `hair01`, `eyebrows01`, `eyelashes01`,
   `shirts01`, `pants01`, `shoes01`, `suits01`, `suits02` y los de materiales
   (`system_clothes_materials01`, `system_hair_materials01`).
4. Las librerías de Quaternius (*Universal Animation Library* 1 y 2, *Standard*, gratuitas) en `.glb`:
   de la 2 salen levantarse del suelo y los gestos de brazos cruzados, sí, no y teléfono (el gancho
   y las patadas se hacen en código: `apps/web/src/world/people/gestures.ts`).

## Generar

```bash
python3 tools/avatars/ual_to_vrma.py "UAL1_Standard.glb" "UAL2_Standard.glb"   # → apps/web/public/anims/*.vrma
python3 tools/avatars/forge_avatars.py out --preview          # personas → out/*.vrm (+ retratos)
python3 tools/avatars/pack_avatars.py out                     # texturas WebP, presupuesto, hash
```

- Los VRM quedan por hash en `apps/realtime/seed-assets/s/` (se sirven como estáticos en `/s/<hash>.glb`),
  el catálogo en `apps/realtime/src/avatar-presets.ts` y `apps/web/src/world/avatar-presets.json`,
  y los retratos en `apps/web/public/avatars/`.
- Las animaciones VRMA valen para **cualquier** VRM, también los que sube la gente.
- Presupuesto de avatar: 30.000 triángulos, 4 MB, texturas de 1024 px (la forja reduce pelo y ropa si hace falta).

## Kit del configurador de fundas

`python3 tools/avatars/kit/forge_kit.py` (con MPFB instalado como arriba y `pip install trimesh embreex`
para los rayos; tarda unos 5 minutos)
escribe en `apps/web/public/fundas/` lo que el configurador de la web necesita para montar una funda
en el navegador (`apps/web/src/fundas/`):

- `cage-f.bin` / `cage-m.bin`: la malla base de MakeHuman (sin dibujar) en su forma neutra de mujer y
  de hombre, con los ajustes del cuerpo (`BODY_SLIDERS`) como diferencias; `face.bin`, los de la cara
  (`FACE_SLIDERS`, compartidos); `rig.bin`, el esqueleto `game_engine` (cada articulación es la media
  de unos vértices de la base) y los pesos de piel.
- `parts/*.bin`: cada pieza de `CATALOG` (solo CC0, nada que imite a nadie) con su atadura a la base
  (formato mhclo: tres vértices, pesos y desplazamiento), simplificada al presupuesto de su categoría
  (`BUDGET`: cualquier combinación cabe en los 30.000 triángulos de un avatar); `tex/` (WebP, con el
  color de cada isla UV extendido) y `thumbs/`.
- Para cada prenda y gorro, qué piel tapa de verdad (`coverage`, con rayos: desde cada vértice de la
  piel se sigue su normal hasta la prenda, solo por partes atadas al mismo trozo del cuerpo, y otros
  seis rayos en cono ven si esa piel asoma por alguna abertura): `under` (piel tapada, que se mete un
  poco hacia dentro), `gap` (a cuántos mm queda la prenda) y `cover` (la tapada por todos lados y
  lejos de los bordes, que se quita). Así no se abren huecos en cuellos, mangas ni capuchas.
- `DETAIL_SLIDERS`: más ajustes del cuerpo (hombros, cintura, caderas, largo de brazos y piernas…),
  compartidos como los de la cara (van en `face.bin`).
- `tex/body_maps.webp`, `face_maps.webp` y `skin_maps.webp` (`maps.py`): en el espacio UV del cuerpo
  (el mismo para todas las pieles), las zonas para los acabados sintéticos y robóticos, sus juntas y
  líneas de panel (con grosor fijo en milímetros), y las zonas de maquillaje, barba de tres días y
  pecas; `tex/eye_mask.webp`, el iris. El navegador pinta con ellos (`fundas/paint.ts`).
- Los implantes (`IMPLANTS`: discos en la nuca, la columna o las sienes), hechos aquí con su textura y
  lo que brilla.
- `kit.json`: el índice de todo.

`inventory.py` lista las piezas instaladas con su licencia y su tamaño (para elegir qué entra).
Con ids sueltos (`forge_kit.py hair_afro top_tee`) rehace solo esas piezas y conserva las demás;
`forge_kit.py none --maps` rehace solo los mapas de la piel.

`calibrate.mjs` (con la web en marcha) renderiza las fundas neutras de frente, les pasa MediaPipe y
mide cuánto cambia cada medida de la cara con cada ajuste: la «funda desde una foto» usa esa tabla
(`public/fundas/vision/calibration.json`). Rehazla si cambias el kit o `face-measure.ts`.
