"""
Monumento de 2048 para su parcela de xenxo: la ficha 2048 de pie, con el número en relieve,
mirando hacia +Z (el frente en glTF). Sin texturas ni referencias externas.

  python3 xenxo/tools/monumento.py  → xenxo/monumento.glb
"""
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, "..", ".."))


def mat(name, rgb, rough=0.45, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*rgb, 1)
        b.inputs["Emission Strength"].default_value = emit
    return m


def srgb(h):
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Ficha: caja de 1,6 × 1,6 × 0,3 con bordes redondeados, de pie (Blender: Z arriba, −Y al frente).
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.8))
    tile = bpy.context.active_object
    tile.scale = (1.6, 0.3, 1.6)
    bpy.ops.object.transform_apply(scale=True)
    bev = tile.modifiers.new("bisel", "BEVEL")
    bev.width = 0.12
    bev.segments = 4
    tile.data.materials.append(mat("ficha", srgb("#edc22e"), 0.35, 0.15))
    # Número en relieve en las dos caras.
    parts = [tile]
    for side in (-1, 1):
        bpy.ops.object.text_add(location=(0, side * 0.16, 0.8))
        t = bpy.context.active_object
        t.data.body = "2048"
        t.data.align_x = "CENTER"
        t.data.align_y = "CENTER"
        t.data.size = 0.55
        t.data.extrude = 0.03
        t.rotation_euler = (1.5708, 0, 0 if side < 0 else 3.14159)
        bpy.ops.object.convert(target="MESH")
        t.data.materials.append(mat(f"num{side}", srgb("#f9f6f2"), 0.4))
        parts.append(t)
    # Peana
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.04))
    base = bpy.context.active_object
    base.scale = (1.9, 0.6, 0.08)
    base.data.materials.append(mat("peana", srgb("#bbada0"), 0.6))
    parts.append(base)
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = tile
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    path = os.path.join(GAME, "xenxo", "monumento.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_cameras=False, export_lights=False, export_extras=False)
    print(path, os.path.getsize(path) // 1024, "KB", len(bpy.context.active_object.data.polygons), "caras")


if __name__ == "__main__":
    main()
