"""
Forja de avatares de xenxo: personas realistas generadas con MPFB (MakeHuman para Blender,
todo CC0), vestidas, con esqueleto humanoide y exportadas como VRM 1.0 para que cualquier
animación VRMA (andar, correr, sentarse, bailar…) funcione en ellas.

  python3 tools/avatars/forge_avatars.py [salida] [--only=id,id] [--preview]

Requiere Blender 5 como módulo con las extensiones MPFB y «VRM format», y los paquetes CC0
de MakeHuman en la carpeta de datos de MPFB (ver tools/avatars/README.md).
"""
from __future__ import annotations

import importlib
import json
import math
import os
import sys
import time

import bpy  # noqa: I001
import addon_utils
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_OUT = os.path.join(ROOT, "tools", "avatars", "out")

# Personajes base. Edad MPFB: 0,5 ≈ 25 años, 0,875 ≈ 55. Género: 0 mujer, 1 hombre.
PRESETS = [
    {"id": "alba", "name": "Alba", "gender": 0.0, "age": 0.5, "muscle": 0.5, "weight": 0.45, "height": 0.45,
     "race": {"caucasian": 0.85, "african": 0.05, "asian": 0.1}, "skin": "young_caucasian_female2",
     "hair": "ponytail01", "eyebrows": "eyebrow010", "clothes": ["toigo_basic_tucked_t-shirt", "cortu_cargo_pants", "shoes02"]},
    {"id": "dani", "name": "Dani", "gender": 1.0, "age": 0.5, "muscle": 0.62, "weight": 0.48, "height": 0.6,
     "race": {"caucasian": 0.8, "african": 0.1, "asian": 0.1}, "skin": "young_caucasian_male",
     "hair": "short02", "eyebrows": "eyebrow001", "clothes": ["male_casualsuit03", "shoes01"]},
    {"id": "nora", "name": "Nora", "gender": 0.0, "age": 0.48, "muscle": 0.6, "weight": 0.45, "height": 0.55,
     "race": {"caucasian": 0.05, "african": 0.9, "asian": 0.05}, "skin": "young_african_female",
     "hair": "afro01", "eyebrows": "eyebrow006", "clothes": ["female_sportsuit01", "shoes04"]},
    {"id": "kai", "name": "Kai", "gender": 1.0, "age": 0.47, "muscle": 0.55, "weight": 0.42, "height": 0.5,
     "race": {"caucasian": 0.05, "african": 0.05, "asian": 0.9}, "skin": "young_asian_male",
     "hair": "short04", "eyebrows": "eyebrow002", "clothes": ["male_casualsuit05", "shoes03"]},
    {"id": "leo", "name": "Leo", "gender": 1.0, "age": 0.8, "muscle": 0.55, "weight": 0.55, "height": 0.55,
     "race": {"caucasian": 0.9, "african": 0.05, "asian": 0.05}, "skin": "middleage_caucasian_male",
     "hair": "short03", "eyebrows": "eyebrow003", "clothes": ["male_elegantsuit01", "shoes05"]},
    {"id": "mar", "name": "Mar", "gender": 0.0, "age": 0.78, "muscle": 0.5, "weight": 0.5, "height": 0.5,
     "race": {"caucasian": 0.85, "african": 0.05, "asian": 0.1}, "skin": "middleage_caucasian_female",
     "hair": "bob02", "eyebrows": "eyebrow011", "clothes": ["toigo_female_suit", "shoes06"]},
    {"id": "sam", "name": "Sam", "gender": 1.0, "age": 0.55, "muscle": 0.7, "weight": 0.5, "height": 0.65,
     "race": {"caucasian": 0.05, "african": 0.9, "asian": 0.05}, "skin": "young_african_male",
     "hair": "short01", "eyebrows": "eyebrow004", "clothes": ["male_worksuit01", "shoes01"]},
    {"id": "iris", "name": "Iris", "gender": 0.0, "age": 0.5, "muscle": 0.5, "weight": 0.42, "height": 0.42,
     "race": {"caucasian": 0.05, "african": 0.05, "asian": 0.9}, "skin": "young_asian_female",
     "hair": "braid01", "eyebrows": "eyebrow009", "clothes": ["toigo_turtleneck_halter_top", "toigo_wool_pants", "shoes03"]},
]

TEX_BODY = 1024
TEX_OTHER = 512


def imp(pkg: str, key: str):
    for m in list(sys.modules):
        if m.endswith(pkg):
            return getattr(importlib.import_module(m), key)
    raise ValueError(pkg)


def setup():
    addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
    addon_utils.enable("bl_ext.user_default.vrm", default_set=True)


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures, bpy.data.actions):
        for b in list(coll):
            if b.users == 0:
                coll.remove(b)


def build(p: dict):
    HumanService = imp("mpfb.services.humanservice", "HumanService")
    AssetService = imp("mpfb.services.assetservice", "AssetService")
    ExportService = imp("mpfb.services.exportservice", "ExportService")
    ObjectService = imp("mpfb.services.objectservice", "ObjectService")
    TargetService = imp("mpfb.services.targetservice", "TargetService")

    macro = TargetService.get_default_macro_info_dict()
    for k in ("gender", "age", "muscle", "weight", "height"):
        macro[k] = p[k]
    macro["proportions"] = 0.7
    macro["race"] = p["race"]
    base = HumanService.create_human(macro_detail_dict=macro)
    skin = AssetService.find_asset_absolute_path(f"{p['skin']}.mhmat", asset_subdir="skins")
    HumanService.set_character_skin(skin, base, skin_type="GAMEENGINE")
    HumanService.add_builtin_rig(base, "game_engine")
    parts = [
        ("eyes", "low-poly.mhclo", "Eyes"),
        ("eyebrows", f"{p['eyebrows']}.mhclo", "Eyebrows"),
        ("eyelashes", "eyelashes01.mhclo", "Eyelashes"),
        ("hair", f"{p['hair']}.mhclo", "Hair"),
    ] + [("clothes", f"{c}.mhclo", "Clothes") for c in p["clothes"]]
    for sub, fn, kind in parts:
        path = AssetService.find_asset_absolute_path(fn, asset_subdir=sub)
        if path is None:
            print(f"  [{p['id']}] falta {sub}/{fn}")
            continue
        HumanService.add_mhclo_asset(path, base, asset_type=kind, material_type="GAMEENGINE")

    root = ExportService.create_character_copy(base, name_suffix="_x")
    xb = ObjectService.find_object_of_type_amongst_nearest_relatives(root, "Basemesh")
    ExportService.bake_modifiers_remove_helpers(xb, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=True)
    keep = set(ObjectService.get_list_of_children(root)) | {root}
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    return root, [o for o in keep if o.type == "MESH"]


def flatten_shape_keys(meshes) -> None:
    """MPFB deja las formas del cuerpo como shape keys: se aplican (pesan megas y no se animan)."""
    for ob in meshes:
        if ob.data.shape_keys:
            bpy.context.view_layer.objects.active = ob
            for o in bpy.data.objects:
                o.select_set(o == ob)
            bpy.ops.object.shape_key_remove(all=True, apply_mix=True)


MAX_TRIS = 27_500

# La piel bajo la ropa (hide_covered_skin), con las medidas del kit de fundas (kit/forge_kit.py):
# hasta dónde se busca la prenda siguiendo la normal de la piel (o un poco por dentro: prendas que
# se meten en la piel), a qué distancia de un borde de la prenda (cuello, mangas, cintura) ya no se
# quita, y cuánto se mete la piel tapada que se queda (si la prenda va pegada).
REACH = 0.06
BEHIND = 0.015
EDGE = 0.04
PUSH = 0.006


def hide_covered_skin(root, meshes, clothes: list[str]) -> None:
    """
    Que la piel no asome por la ropa al moverse (en las prendas ceñidas se veía el cuerpo a través:
    el pecho por la camiseta, las rodillas por el pantalón). Desde cada vértice del cuerpo se sigue
    su normal hacia fuera y se busca la prenda, contando solo las partes de la prenda que mueve el
    mismo hueso o uno contiguo (así, la cara de dentro del brazo no queda «tapada» por el costado de
    la camiseta). La piel tapada se mete un poco hacia dentro; la tapada por todos lados (seis rayos
    más en cono) y lejos de los bordes de la prenda, se quita: ni asoma ni se dibuja.
    Lo mismo que hace el configurador de fundas con su kit (`coverage` en kit/forge_kit.py).
    """
    import bmesh
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from mathutils.kdtree import KDTree

    body = next((o for o in meshes if o.name == "Human_x"), None)
    wear = [o for o in meshes if any(c in o.name for c in clothes)]
    if body is None or not wear:
        return
    parent = {b.name: (b.parent.name if b.parent else None) for b in root.data.bones}

    def near(a: str | None, b: str | None) -> bool:
        return a is not None and b is not None and (a == b or parent.get(a) == b or parent.get(b) == a)

    def dominant(ob) -> list[str | None]:
        # Solo los grupos de huesos (el cuerpo de MakeHuman trae además los suyos: «body», «Left»…).
        names = {g.index: g.name for g in ob.vertex_groups if g.name in parent}
        out = []
        for v in ob.data.vertices:
            best = max((g for g in v.groups if g.group in names), key=lambda g: g.weight, default=None)
            out.append(names[best.group] if best else None)
        return out

    # Todas las prendas en un árbol de rayos (en el mundo), sabiendo de qué prenda es cada cara.
    verts, polys, owner = [], [], []
    for ob in wear:
        mw = ob.matrix_world
        base = len(verts)
        verts += [mw @ v.co for v in ob.data.vertices]
        bones = dominant(ob)
        for p in ob.data.polygons:
            polys.append([base + i for i in p.vertices])
            owner.append(bones[p.vertices[0]])
    tree = BVHTree.FromPolygons(verts, polys)
    # Bordes de las prendas (aristas con una sola cara), por puntos.
    edge_pts = []
    for ob in wear:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.transform(ob.matrix_world)
        for e in bm.edges:
            if e.is_boundary:
                a, b = e.verts[0].co, e.verts[1].co
                edge_pts += [a.lerp(b, k / 5) for k in range(6)]
        bm.free()
    kd = KDTree(max(1, len(edge_pts)))
    for i, co in enumerate(edge_pts):
        kd.insert(co, i)
    kd.balance()

    mw = body.matrix_world
    nrm_mat = mw.to_3x3().inverted().transposed()
    body_bones = dominant(body)
    vs = body.data.vertices
    under: dict[int, float] = {}
    deep: set[int] = set()
    backs = fronts = 0
    cone: dict[int, list[Vector]] = {}
    for v in vs:
        co = mw @ v.co
        n = (nrm_mat @ v.normal).normalized()
        hit, hn, idx, dist = tree.ray_cast(co - n * BEHIND, n, REACH + BEHIND)
        if hit is None or not near(body_bones[v.index], owner[idx]):
            continue
        under[v.index] = dist - BEHIND  # negativo: la prenda se mete en la piel
        if hn.dot(n) > 0:
            backs += 1
        else:
            fronts += 1
        # Seis rayos en cono (unos 33°): si alguno se escapa, esa piel se ve por una abertura.
        t1 = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized()
        t2 = n.cross(t1)
        cone[v.index] = [(n + 0.65 * (math.cos(k * math.pi / 3) * t1 + math.sin(k * math.pi / 3) * t2)).normalized() for k in range(6)]
    # Las prendas de MakeHuman tienen la normal hacia fuera: desde dentro se ve su cara de atrás.
    inside_is_back = backs >= fronts
    for i, dirs in cone.items():
        co = mw @ vs[i].co
        if edge_pts and kd.find(co)[2] <= EDGE:
            continue
        ok = True
        for d in dirs:
            hit, hn, idx, dist = tree.ray_cast(co - d * BEHIND, d, REACH * 1.6 + BEHIND)
            if hit is None or (hn.dot(d) > 0) != inside_is_back or not near(body_bones[i], owner[idx]):
                ok = False
                break
        if ok:
            deep.add(i)
    # Quitar las caras con todos sus vértices tapados del todo; meter el resto de la piel tapada.
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    for v in bm.verts:
        g = under.get(v.index)
        if g is not None and g < 0.015:
            v.co -= v.normal * (PUSH + max(0.0, -g))
    gone = [f for f in bm.faces if all(v.index in deep for v in f.verts)]
    n_gone = len(gone)
    bmesh.ops.delete(bm, geom=gone, context="FACES")
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    print(f"    piel tapada {len(under)}, se quitan {n_gone} caras", flush=True)


def fit_budget(meshes, clothes: list[str]) -> None:
    """Si se pasa del presupuesto, simplifica pelo y ropa (nunca el cuerpo ni los ojos)."""
    def tris(o):
        return sum(len(f.vertices) - 2 for f in o.data.polygons)

    total = sum(tris(o) for o in meshes)
    if total <= MAX_TRIS:
        return
    cands = sorted((o for o in meshes if not o.name.startswith("Human_x") and "low-poly" not in o.name and tris(o) > 1500), key=tris, reverse=True)
    excess = total - MAX_TRIS
    pool = sum(tris(o) for o in cands)
    import bmesh

    for o in cands:
        ratio = max(0.35, 1 - (excess / pool) * 1.1)
        # Los bordes de cada prenda (bajos, puños, cuellos, aberturas) no se tocan: si no, se quedan
        # dentados (se veía en la chaqueta y la falda de Mar). El pelo no: sus mechones son todo borde.
        edge: list[int] = []
        if any(c in o.name for c in clothes):
            bm = bmesh.new()
            bm.from_mesh(o.data)
            edge = sorted({v.index for e in bm.edges if e.is_boundary for v in e.verts})
            bm.free()
        keep = o.vertex_groups.new(name="fit_keep")
        if edge:
            keep.add(edge, 1.0, "REPLACE")
        mod = o.modifiers.new("fit", "DECIMATE")
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        if edge:
            mod.vertex_group = "fit_keep"
            mod.invert_vertex_group = True
            mod.vertex_group_factor = 10.0
        bpy.context.view_layer.objects.active = o
        for x in bpy.data.objects:
            x.select_set(x == o)
        bpy.ops.object.modifier_move_to_index(modifier="fit", index=0)
        bpy.ops.object.modifier_apply(modifier="fit")
        o.vertex_groups.remove(o.vertex_groups["fit_keep"])


def shrink_textures(meshes, clothes: list[str]) -> None:
    """Texturas al presupuesto de avatar: piel y ropa a 1024 (se ven de cerca), el resto a 512."""
    for ob in meshes:
        target = TEX_BODY if ob.name == "Human_x" or any(c in ob.name for c in clothes) else TEX_OTHER
        for m in ob.data.materials:
            if not m or not m.node_tree:
                continue
            for n in m.node_tree.nodes:
                img = getattr(n, "image", None)
                if img is None or img.size[0] == 0:
                    continue
                w, h = img.size
                s = min(1.0, target / max(w, h))
                if s < 1:
                    img.scale(max(1, int(w * s)), max(1, int(h * s)))


def to_vrm(root, p: dict, path: str) -> None:
    from bl_ext.user_default.vrm.common.vrm1 import human_bone as _hb  # noqa: F401 (comprueba la extensión)

    bpy.context.view_layer.objects.active = root
    for o in bpy.data.objects:
        o.select_set(o == root or o.parent == root)
    r = bpy.ops.vrm.assign_vrm1_humanoid_human_bones_automatically(armature_object_name=root.name)
    if r != {"FINISHED"}:
        raise RuntimeError(f"no se pudieron asignar los huesos humanoides de {p['id']}")
    ext = root.data.vrm_addon_extension
    ext.spec_version = "1.0"
    meta = ext.vrm1.meta
    meta.vrm_name = f"xenxo · {p['name']}"
    if not meta.authors:
        meta.authors.add()
    meta.authors[0].value = "xenxo.io (MakeHuman/MPFB, CC0)"
    meta.copyright_information = "CC0 — generado con MPFB a partir de recursos CC0 de la comunidad MakeHuman"
    meta.license_url = "https://vrm.dev/licenses/1.0/"
    meta.avatar_permission = "everyone"
    meta.commercial_usage = "corporation"
    meta.allow_redistribution = True
    meta.modification = "allowModificationRedistribution"
    meta.credit_notation = "unnecessary"
    res = bpy.ops.export_scene.vrm(filepath=path, armature_object_name=root.name, ignore_warning=True)
    if res != {"FINISHED"}:
        raise RuntimeError(f"exportación VRM fallida para {p['id']}: {res}")


def preview(root, meshes, path: str) -> None:
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 24
    sc.render.resolution_x, sc.render.resolution_y = 420, 760
    w = bpy.data.worlds.get("w") or bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.72, 0.75, 0.8, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    if "sun" not in bpy.data.objects:
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
        sun.data.energy = 3.2
        sun.rotation_euler = (math.radians(55), 0, math.radians(25))
        sc.collection.objects.link(sun)
    cam = bpy.data.objects.get("cam") or bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    cam.data.lens = 55
    cam.location = (0.5, -4.6, 1.1)
    cam.rotation_euler = (Vector((0, 0, 0.92)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    # Retrato para el selector del panel (busto, tres cuartos)
    head = max((o for o in meshes), key=lambda o: o.dimensions.z)  # el cuerpo
    top = max((o.matrix_world @ Vector(c)).z for o in meshes for c in o.bound_box)
    sc.render.resolution_x, sc.render.resolution_y = 320, 320
    cam.data.lens = 70
    cam.location = (0.55, -1.55, top - 0.12)
    cam.rotation_euler = (Vector((0, 0, top - 0.3)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.film_transparent = True
    sc.render.filepath = path.replace(".png", ".portrait.png")
    bpy.ops.render.render(write_still=True)
    sc.render.film_transparent = False
    del head


def forge_one(p: dict, out: str) -> dict:
    t0 = time.time()
    clear_scene()
    root, meshes = build(p)
    flatten_shape_keys(meshes)
    hide_covered_skin(root, meshes, p["clothes"])
    fit_budget(meshes, p["clothes"])
    shrink_textures(meshes, p["clothes"])
    tris = sum(sum(len(f.vertices) - 2 for f in m.data.polygons) for m in meshes)
    if "--preview" in sys.argv:
        preview(root, meshes, os.path.join(out, f"{p['id']}.png"))
    path = os.path.join(out, f"{p['id']}.vrm")
    to_vrm(root, p, path)
    print(f"[avatar] {p['id']}: {tris} triángulos, {os.path.getsize(path) // 1024} KB, {time.time() - t0:.0f}s", flush=True)
    return {"name": p["name"], "tris": tris, "bytes": os.path.getsize(path)}


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = os.path.abspath(args[0]) if args else DEFAULT_OUT
    only = None
    for a in sys.argv[1:]:
        if a.startswith("--only="):
            only = set(a.split("=", 1)[1].split(","))
    os.makedirs(out, exist_ok=True)
    todo = [p for p in PRESETS if not only or p["id"] in only]
    if "--one" in sys.argv:
        # Un personaje por proceso: en la misma sesión de Blender, lo que deja MPFB de uno se colaba
        # en el siguiente (a Iris le salía pelo de otra).
        setup()
        report = forge_one(todo[0], out)
        with open(os.path.join(out, f"{todo[0]['id']}.report.json"), "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False)
        return
    import subprocess

    report = {}
    for p in todo:
        flags = [a for a in sys.argv[1:] if a in ("--preview",)]
        subprocess.run([sys.executable, os.path.abspath(__file__), out, f"--only={p['id']}", "--one", *flags], check=True)
        rp = os.path.join(out, f"{p['id']}.report.json")
        with open(rp, encoding="utf-8") as f:
            report[p["id"]] = json.load(f)
        os.remove(rp)
    with open(os.path.join(out, "avatars.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
