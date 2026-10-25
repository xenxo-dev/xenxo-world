"""
Vista previa rápida de una pieza de la forja (Cycles en CPU).

  python3 tools/forge/preview.py townhouse:projects out.png [detail]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import kit  # noqa: E402
import pieces  # noqa: E402


def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def main():
    what, out = sys.argv[1], sys.argv[2]
    detail = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    kit.reset()
    ob = pieces.build(what, detail)
    print("triángulos:", kit.tris(ob), "materiales:", len(ob.data.materials))
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 900, 600
    world = bpy.data.worlds.new("w")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.55, 0.7, 0.95, 1)
    bg.inputs["Strength"].default_value = 0.9
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4
    sun.angle = math.radians(3)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    sc.collection.objects.link(so)
    bpy.ops.mesh.primitive_plane_add(size=80)
    g = bpy.context.active_object
    g.data.materials.append(kit.mat("losa", "#cdbf9f"))
    dims = ob.dimensions
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 28
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    r = max(dims.x, dims.z) * 1.25 + 4
    cam.location = (r * 0.55, -r, dims.z * 0.45 + 1.2)
    look_at(cam, (0, 0, dims.z * 0.42))
    sc.camera = cam
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
