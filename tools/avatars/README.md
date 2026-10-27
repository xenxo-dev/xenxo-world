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
