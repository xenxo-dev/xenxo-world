"""
Monumento de Núcleo para su parcela de xenxo: la puerta del núcleo entreabierta, con el núcleo de
luz dentro y sus tres cerraduras, mirando hacia +Z (el frente en glTF). Sin texturas ni
referencias externas. Licencia MIT.

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


def box(name, loc, size, m):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(m)
    return o


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    dark = mat("marco", srgb("#141a26"), 0.5)
    leaf = mat("hoja", srgb("#1f2a40"), 0.4)
    cyan = mat("nucleo", srgb("#36d9ff"), 0.2, 4.0)
    mag = mat("cerradura", srgb("#ff4fd8"), 0.3, 3.0)
    green = mat("abierta", srgb("#6dff8a"), 0.3, 3.0)
    parts = []
    # Peana y marco (Blender: Z arriba, −Y al frente).
    parts.append(box("peana", (0, 0, 0.06), (1.9, 0.9, 0.12), dark))
    parts.append(box("lado_i", (-0.82, 0, 1.07), (0.16, 0.5, 1.9), dark))
    parts.append(box("lado_d", (0.82, 0, 1.07), (0.16, 0.5, 1.9), dark))
    parts.append(box("dintel", (0, 0, 2.08), (1.8, 0.5, 0.16), dark))
    # Filo de luz del marco.
    parts.append(box("filo", (0, -0.26, 2.0), (1.48, 0.03, 0.04), cyan))
    # El núcleo: una esfera de luz al fondo.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.42, location=(0, 0.08, 1.07))
    core = bpy.context.active_object
    core.data.materials.append(cyan)
    parts.append(core)
    # Hojas entreabiertas (un hueco de 0,36 m en el centro).
    parts.append(box("hoja_i", (-0.44, -0.12, 1.07), (0.56, 0.08, 1.86), leaf))
    parts.append(box("hoja_d", (0.44, -0.12, 1.07), (0.56, 0.08, 1.86), leaf))
    # Tres cerraduras en el canto de la hoja izquierda: dos cerradas (magenta) y una abierta.
    for k, z in enumerate((1.6, 1.07, 0.54)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.085, depth=0.04, location=(-0.2, -0.17, z), rotation=(1.5708, 0, 0))
        lk = bpy.context.active_object
        lk.data.materials.append(green if k == 1 else mag)
        parts.append(lk)
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    path = os.path.join(GAME, "xenxo", "monumento.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_cameras=False, export_lights=False, export_extras=False)
    print(path, os.path.getsize(path) // 1024, "KB", len(bpy.context.active_object.data.polygons), "caras")


if __name__ == "__main__":
    main()
