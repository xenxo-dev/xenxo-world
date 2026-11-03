"""
Las fichas de las armas para el HUD (apps/web/public/armas/<id>.webp): cada arma de perfil, con el
cañón hacia la derecha y fondo transparente, a partir de los modelos que prepara blasters.mjs.

    python3 tools/models/library/blasters-icons.py

Necesita Blender como módulo de Python (bpy), como la forja.
"""
import io
import math
import os
import sys

import bpy
from mathutils import Vector
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "apps", "web", "public", "armas")
IDS = ["pipa", "chispa", "canon", "rafaga", "trueno", "tormenta", "halcon"]
W, H = 320, 180


def render(wid: str) -> Image.Image:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, f"weapon_{wid}", "model.glb"))
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.display.shading.show_specular_highlight = False
    sc.render.resolution_x, sc.render.resolution_y = W * 2, H * 2
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    # Límites en Blender (x, y, z) = (x, −z, y) de glTF.
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in sc.objects:
        if o.type != "MESH":
            continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    c = (lo + hi) / 2
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    # Desde −X mirando a +X: el cañón (+Z de glTF, −Y de Blender) queda a la derecha. Un poco desde arriba.
    cam.data.ortho_scale = max(hi.y - lo.y, (hi.z - lo.z) * W / H) * 1.12
    cam.location = Vector((-3, c.y, c.z + 0.35))
    cam.rotation_euler = (math.pi / 2 - math.atan2(0.35, 3), 0, -math.pi / 2)
    sc.camera = cam
    path = os.path.join(OUT, f".{wid}.png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    im = Image.open(path).convert("RGBA").resize((W, H), Image.LANCZOS)
    os.remove(path)
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    for wid in IDS:
        im = render(wid)
        im.save(os.path.join(OUT, f"{wid}.webp"), "WEBP", quality=88, method=6)
        print(wid, os.path.getsize(os.path.join(OUT, f"{wid}.webp")), "bytes")


if __name__ == "__main__":
    sys.exit(main())
