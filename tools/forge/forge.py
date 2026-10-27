"""
La forja: genera la plaza (arquitectura y mobiliario) con Blender, hornea la oclusión
ambiental de cada pieza EN SU SITIO (con sus vecinas haciendo sombra) y exporta un GLB
por pieza y nivel de detalle, más su mapa de oclusión.

  python3 tools/forge/forge.py [salida] [--only nombre,nombre] [--fast]

Después, `node tools/forge/pack.mjs` empaqueta (oclusión, cuantización, meshopt, hash)
hacia apps/realtime/src/seed-assets/, que el servidor sube a R2 al sembrar la plaza.
"""
from __future__ import annotations

import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

import bpy  # noqa: E402

import cero  # noqa: E402
import city  # noqa: E402
import decor  # noqa: E402
import district  # noqa: E402
import kit  # noqa: E402
import nexo  # noqa: E402
import pieces  # noqa: E402
import props  # noqa: E402
import tower  # noqa: E402
import townhouse  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_OUT = os.path.join(ROOT, "tools", "forge", "out")

# Tamaño del mapa de oclusión por pieza: [detallado, ligero]
AO_SIZE = {"district": (1024, 512), "nexo": (1024, 512), "building": (1024, 512), "tower": (1024, 512), "fountain": (512, 256), "ground": (2048, 1024), "prop": (256, 128)}


def place(ob, x: float, z: float, facing_deg: float = 0.0) -> None:
    """Mundo (x este, z sur) → Blender (x, -z); el frente local (-Y) gira hacia `facing`."""
    ob.location = (x, -z, 0.0)
    ob.rotation_euler = (0.0, 0.0, math.radians(facing_deg))


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = os.path.abspath(args[0]) if args else DEFAULT_OUT
    only = None
    for a in sys.argv[1:]:
        if a.startswith("--only="):
            only = set(a.split("=", 1)[1].split(","))
    fast = "--fast" in sys.argv
    os.makedirs(out, exist_ok=True)

    lay = pieces.layout()
    kit.reset()
    kit.setup_bake(distance=2.5, samples=24 if fast else 96)

    # pieza → {"kind", "lods": [obj, obj], "instances": [(x, z, facing)]}
    catalog: dict[str, dict] = {}

    def add(name: str, kind: str, builder, instances):
        lods = []
        for detail in (1, 0):
            ob = builder(detail)
            ob.name = f"{name}.lod{1 - detail}"
            kit.world_uv(ob)  # UV de biblioteca en coordenadas locales (antes de colocar)
            lods.append(ob)
        catalog[name] = {"kind": kind, "lods": lods, "instances": instances}

    for b in lay["buildings"]:
        add(b["id"], "building", lambda d, b=b: townhouse.build(b, d), [(b["p"][0], b["p"][1], b["facing"])])
    t = lay["tower"]
    add("tower", "tower", lambda d: tower.build(t, d), [(t["p"][0], t["p"][1], t["facing"])])
    g = lay["gate"]
    add("gate", "tower", lambda d: props.gate(g, d), [(g["p"][0], g["p"][1], g["facing"])])
    add("fountain", "fountain", props.fountain, [(lay["fountain"][0], lay["fountain"][1], 0)])
    add("lamp", "prop", props.lamp, [(x, z, 0) for x, z in lay["lamps"]])
    add("bench", "prop", props.bench, [(x, z, f) for x, z, f in lay["benches"]])
    add("orange_tree", "prop", props.orange_tree, [(x, z, 0) for x, z in lay["trees"]])
    add("terrace", "prop", props.terrace, [(x, z, 0) for x, z in lay["terrace"]])
    add("ground", "ground", lambda d: props.ground(lay, d), [(32.0, 32.0, 0)])

    # El nexo es otro chunk: se hornea lejos de la plaza para que sus casas no le hagan sombra.
    nx = nexo.layout()
    far = 1000.0
    cx, cz = nx["center"]
    add("nexo_floor", "nexo", lambda d: nexo.floor(nx, d), [(cx + far, cz, 0)])
    add("nexo_beacon", "prop", lambda d: nexo.beacon(nx, d), [(cx + far, cz, 0)])
    # El marco de las parcelas (los distritos lo usan; en el nexo ya no hay marcos de proyecto).
    add("nexo_frame", "prop", lambda d: nexo.frame(nx, d), [(cx + far, cz + 300.0, 0)])
    gate_spots = [s for i, s in enumerate(nexo.slots(nx)) if i in nexo.used_slots(nx)]
    add("nexo_gate", "prop", lambda d: nexo.gate(nx, d), [(x + far, z, f) for x, z, f in gate_spots])
    add("nexo_island", "district", lambda d: nexo.island(nx, d), [(x + far, z, f) for x, z, f in (nexo.island_spot(nx, i) for i in nexo.used_slots(nx))])

    # Distritos: cada uno en su sitio lejano (también para hornear sin vecinos) y su emblema.
    dl = district.layout()
    for i, dd in enumerate(dl["districts"]):
        # 400 m entre distritos: el suelo de cada uno mide 256 m (no se hacen sombra al hornear).
        ox = 2000.0 + i * 400.0
        add(f"district_{dd['id']}", "district", lambda d, dd=dd: district.ground(dl, dd, d), [(ox + 32.0, 32.0, 0)])
        add(f"district_city_{dd['id']}", "district", lambda d, dd=dd: city.build(dl, dd, d), [(ox + 32.0, 32.0, 0)])
        add(f"emblem_{dd['id']}", "prop", lambda d, dd=dd: district.emblem(dd, d), [(ox + 32.0, -300.0, 0)])
        add(f"nexo_spires_{dd['id']}", "prop", lambda d, dd=dd: nexo.spires(nx, dd, d), [(ox + 32.0, -380.0, 0)])
        add(f"nexo_decor_{dd['id']}", "prop", lambda d, dd=dd: decor.build(nx, dd["id"], dd["color"], d), [(ox + 32.0, -460.0, 0)])
        if dd["id"] == "cero":  # el fragmento del Rastro de datos (se recoge: collectible@1)
            add("cero_fragment", "prop", cero.fragment_object, [(ox + 32.0, -540.0, 0)])
    # Las colisiones de las ciudades de los distritos (las mismas cajas que sus edificios).
    city.write_colliders(dl, dl["districts"])
    # La plaza también tiene su isla en el nexo, con su decorado mediterráneo.
    add("nexo_decor_plaza", "prop", lambda d: decor.build(nx, "plaza", nx["colors"]["district"], d), [(1900.0 + 32.0, -200.0, 0)])

    # Colocar: la primera instancia es el propio objeto; el resto, copias enlazadas (solo como oclusores).
    for name, item in catalog.items():
        for ob in item["lods"]:
            x, z, f = item["instances"][0]
            place(ob, x, z, f)
        item["lods"][1].hide_render = True  # el nivel ligero solo se ve mientras se hornea a sí mismo
        for (x, z, f) in item["instances"][1:]:
            dup = item["lods"][0].copy()
            dup.name = f"{name}.occ"
            bpy.context.scene.collection.objects.link(dup)
            place(dup, x, z, f)
            item.setdefault("occluders", []).append(dup)

    for name, item in catalog.items():
        if only and name not in only:
            continue
        for lod_i, ob in enumerate(item["lods"]):
            t0 = time.time()
            kit.lightmap_uv(ob)
            # Mientras se hornea un nivel, el otro nivel de la misma pieza no hace sombra.
            other = item["lods"][1 - lod_i]
            other.hide_render = True
            ob.hide_render = False
            size = AO_SIZE[item["kind"]][lod_i]
            ao_path = os.path.join(out, f"{name}.lod{lod_i}.ao.webp")
            kit.bake_ao(ob, size, ao_path)
            item["lods"][0].hide_render = False
            item["lods"][1].hide_render = True
            # Exportar en coordenadas locales
            loc, rot = ob.location.copy(), ob.rotation_euler.copy()
            ob.location = (0, 0, 0)
            ob.rotation_euler = (0, 0, 0)
            glb = os.path.join(out, f"{name}.lod{lod_i}.glb")
            kit.export_glb(ob, glb)
            ob.location, ob.rotation_euler = loc, rot
            print(f"[forja] {name} lod{lod_i}: {kit.tris(ob)} triángulos, AO {size}px, {time.time() - t0:.1f}s", flush=True)

    manifest = {
        name: {"kind": item["kind"], "instances": item["instances"], "tris": [kit.tris(o) for o in item["lods"]]}
        for name, item in catalog.items()
        if not only or name in only
    }
    path = os.path.join(out, "forge.json")
    if only and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            prev = json.load(f)
        prev.update(manifest)
        manifest = prev
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    print("[forja] listo:", out)


if __name__ == "__main__":
    main()
