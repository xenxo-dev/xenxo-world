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
4. La librería de Quaternius (*Standard*, gratuita) en `.glb`.

## Generar

```bash
python3 tools/avatars/ual_to_vrma.py "UAL1_Standard.glb"     # → apps/web/public/anims/*.vrma
python3 tools/avatars/forge_avatars.py out --preview          # personas → out/*.vrm (+ retratos)
python3 tools/avatars/pack_avatars.py out                     # texturas WebP, presupuesto, hash
```

- Los VRM quedan por hash en `apps/realtime/seed-assets/s/` (se sirven como estáticos en `/s/<hash>.glb`),
  el catálogo en `apps/realtime/src/avatar-presets.ts` y `apps/web/src/world/avatar-presets.json`,
  y los retratos en `apps/web/public/avatars/`.
- Las animaciones VRMA valen para **cualquier** VRM, también los que sube la gente.
- Presupuesto de avatar: 30.000 triángulos, 4 MB, texturas de 1024 px (la forja reduce pelo y ropa si hace falta).

## Kit del configurador de fundas

`python3 tools/avatars/kit/forge_kit.py` (con MPFB instalado como arriba; tarda unos 3 minutos)
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
- `kit.json`: el índice de todo.

`inventory.py` lista las piezas instaladas con su licencia y su tamaño (para elegir qué entra).
Con ids sueltos (`forge_kit.py hair_afro top_tee`) rehace solo esas piezas y conserva las demás.
