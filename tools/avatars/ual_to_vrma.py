"""
Convierte animaciones de la Universal Animation Library de Quaternius (CC0) en VRMA:
el formato estándar de animación de VRM, que sirve para CUALQUIER avatar humanoide
(los personajes de xenxo y los VRM que suba la gente).

  python3 tools/avatars/ual_to_vrma.py <UAL1_Standard.glb> [salida]

Requiere Blender 5 como módulo (pip install bpy) con la extensión «VRM format» instalada.
"""
from __future__ import annotations

import os
import sys

import bpy  # noqa: I001  (bpy primero: después existen sus módulos)
import addon_utils

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_OUT = os.path.join(ROOT, "apps", "web", "public", "anims")

# Nombre en xenxo → animación de la librería. Los bucles terminan en _Loop.
CLIPS = {
    "idle": "Idle_Loop",
    "walk": "Walk_Loop",
    "jog": "Jog_Fwd_Loop",
    "sprint": "Sprint_Loop",
    "jump_start": "Jump_Start",
    "jump_loop": "Jump_Loop",
    "jump_land": "Jump_Land",
    "sit_enter": "Sitting_Enter",
    "sit_idle": "Sitting_Idle_Loop",
    "sit_exit": "Sitting_Exit",
    "sit_talk": "Sitting_Talking_Loop",
    "talk": "Idle_Talking_Loop",
    "dance": "Dance_Loop",
    "interact": "Interact",
    "crouch_idle": "Crouch_Idle_Loop",
    "crouch_walk": "Crouch_Fwd_Loop",
    "walk_formal": "Walk_Formal_Loop",
}


def main() -> None:
    src = sys.argv[1]
    out = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    os.makedirs(out, exist_ok=True)
    addon_utils.enable("bl_ext.user_default.vrm", default_set=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon_utils.enable("bl_ext.user_default.vrm", default_set=True)
    sc = bpy.context.scene
    sc.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=src)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    # La malla de muestra (maniquí) no hace falta.
    for o in list(bpy.data.objects):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    r = bpy.ops.vrm.assign_vrm1_humanoid_human_bones_automatically(armature_object_name=arm.name)
    print("asignación de huesos:", r)

    actions = {a.name: a for a in bpy.data.actions}
    if arm.animation_data is None:
        arm.animation_data_create()
    for name, clip in CLIPS.items():
        act = next((a for n, a in actions.items() if n == clip or n.startswith(clip + ".") or n.endswith("|" + clip)), None)
        if act is None:
            print("falta", clip)
            continue
        arm.animation_data.action = act
        if hasattr(arm.animation_data, "action_slot") and act.slots:
            arm.animation_data.action_slot = act.slots[0]
        f0, f1 = (int(round(v)) for v in act.frame_range)
        sc.frame_start, sc.frame_end = f0, f1
        sc.frame_set(f0)
        path = os.path.join(out, f"{name}.vrma")
        res = bpy.ops.export_scene.vrma(filepath=path, armature_object_name=arm.name)
        size = os.path.getsize(path) if os.path.exists(path) else 0
        print(f"{name:12} ← {clip:22} {f1 - f0:4d} frames  {size // 1024} KB  {res}", flush=True)


if __name__ == "__main__":
    main()
