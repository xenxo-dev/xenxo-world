"""
Monumento de HexGL para su parcela de xenxo: la nave Feisar con su textura, mirando hacia +Z
(el frente en glTF), apoyada en el suelo. Sin Draco ni referencias externas (lo exige xenxo).

  python3 xenxo/tools/feisar_obj.py && python3 xenxo/tools/monumento.py
  → xenxo/monumento.glb
"""
import math
import os

import bpy
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "out")


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=os.path.join(OUT, "feisar.obj"), forward_axis="NEGATIVE_Z", up_axis="Y")
    ob = bpy.context.selected_objects[0]
    ob.name = "hexgl_feisar"

    # Textura a 512 px en JPEG: el GLB tiene que quedarse por debajo de 1 MB.
    tex = os.path.join(OUT, "feisar.jpg")
    Image.open(os.path.join(GAME, "textures", "ships", "feisar", "diffuse.jpg")).convert("RGB").resize((512, 512)).save(tex, "JPEG", quality=85)

    m = bpy.data.materials.new("feisar")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    img = nt.nodes.new("ShaderNodeTexImage")
    img.image = bpy.data.images.load(tex)
    nt.links.new(img.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.35
    bsdf.inputs["Metallic"].default_value = 0.6
    ob.data.materials.clear()
    ob.data.materials.append(m)

    # El OBJ ya viene con el morro hacia +Z (el frente en glTF): se fija el giro de la importación
    # y se escala a unos 3 m de largo, con el morro un poco levantado, posada en el suelo.
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    s = 3.0 / max(ob.dimensions)
    ob.scale = (s, s, s)
    # En Blender el frente glTF (+Z) es −Y: levantar el morro = girar en X hacia arriba.
    ob.rotation_euler = (math.radians(-6), 0, 0)
    bpy.context.view_layer.update()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    zs = [(ob.matrix_world @ v.co).z for v in ob.data.vertices]
    ob.location.z -= min(zs)
    bpy.ops.object.transform_apply(location=True)

    path = os.path.join(GAME, "xenxo", "monumento.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_extras=False,
    )
    print(path, os.path.getsize(path) // 1024, "KB,", len(ob.data.polygons), "caras")


if __name__ == "__main__":
    main()
