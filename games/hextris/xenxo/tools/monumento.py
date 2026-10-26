"""
Monumento de Hextris para su parcela de xenxo: el hexágono del juego de pie, con el núcleo
oscuro, bloques de colores en sus lados y el anillo gris, mirando hacia +Z (el frente en glTF).

  python3 xenxo/tools/monumento.py  → xenxo/monumento.glb
"""
import math
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, "..", ".."))


def srgb(h):
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mat(name, hexcol, rough=0.5, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(hexcol), 1)
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*srgb(hexcol), 1)
        b.inputs["Emission Strength"].default_value = emit
    return m


def hexprism(r, depth, z, m, ring=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=r, depth=depth, location=(0, 0, 0))
    o = bpy.context.active_object
    o.rotation_euler = (math.pi / 2, 0, 0)  # de pie, mirando al frente (−Y en Blender)
    o.location = (0, 0, z)
    if ring:
        bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=ring, depth=depth * 2, location=(0, 0, 0))
        hole = bpy.context.active_object
        hole.rotation_euler = o.rotation_euler
        hole.location = o.location
        mod = o.modifiers.new("hueco", "BOOLEAN")
        mod.object = hole
        mod.operation = "DIFFERENCE"
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="hueco")
        bpy.data.objects.remove(hole)
    o.data.materials.append(m)
    return o


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cz = 1.25
    parts = [
        hexprism(1.15, 0.12, cz, mat("anillo", "#bdc3c7", 0.6), ring=1.02),
        hexprism(0.42, 0.3, cz, mat("nucleo", "#2c3e50", 0.4)),
    ]
    # Bloques de colores pegados a cuatro lados del núcleo.
    colors = ["#e74c3c", "#f1c40f", "#3498db", "#2ecc71"]
    apothem = 0.42 * math.cos(math.pi / 6)
    for i, c in zip((0, 1, 3, 4), colors):
        a = i * math.pi / 3  # normal de cada cara del núcleo (en el plano XZ)
        bpy.ops.mesh.primitive_cube_add(size=1)
        b = bpy.context.active_object
        b.scale = (0.4, 0.24, 0.12)
        d = apothem + 0.065
        b.location = (math.cos(a) * d, 0, cz + math.sin(a) * d)
        b.rotation_euler = (0, -(a + math.pi / 2), 0)
        b.data.materials.append(mat(f"bloque{i}", c, 0.35, 0.25))
        parts.append(b)
    # Columna y peana
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.07, depth=0.2, location=(0, 0, 0.1))
    col = bpy.context.active_object
    col.data.materials.append(mat("columna", "#7f8c8d", 0.5))
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.6, depth=0.08, location=(0, 0, 0.04))
    base = bpy.context.active_object
    base.data.materials.append(mat("peana", "#2c3e50", 0.6))
    parts += [col, base]
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.join()
    path = os.path.join(GAME, "xenxo", "monumento.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_cameras=False, export_lights=False, export_extras=False)
    print(path, os.path.getsize(path) // 1024, "KB", len(bpy.context.active_object.data.polygons), "caras")


if __name__ == "__main__":
    main()
