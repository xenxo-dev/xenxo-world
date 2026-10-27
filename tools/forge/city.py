"""
La ciudad del centro de cada distrito (disposición v3 de districts.json): 100 × 100 m, 3 × 3
manzanas de 26 m con calles de 11 m; la del medio es la plaza con el monumento del distrito y sus
puestos de actividad, y las otras ocho llevan edificios de su tema (dos parcelas por manzana).

Todo sale de `plan(lay, d)`, puro y determinista: lo usan el modelo (`build`) y las colisiones
(`colliders`), que la forja escribe en apps/realtime/src/district-cities.json para el servidor.

Coordenadas: mundo del chunk (X este, Z sur); el modelo va centrado en el chunk (Blender: x = X − 32,
y = −(Z − 32), z arriba), como el suelo de district.py.
"""
from __future__ import annotations

import json
import math
import os
import random

from mathutils import Matrix

import arcade
import pixel
import cero
import decor
from kit import CHUNK, Part, finish, mat
from townhouse import hip_roof

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_JSON = os.path.join(ROOT, "apps", "realtime", "src", "district-cities.json")
C = CHUNK / 2


def _seed(text: str) -> int:
    s = 7
    for ch in text:
        s = (s * 31 + ord(ch)) % 2_147_483_647
    return s


def _lo_hi(x0: float, z0: float, x1: float, z1: float, y0: float, y1: float):
    return (x0 - C, -(z1 - C), y0), (x1 - C, -(z0 - C), y1)


def _box(p: Part, x0, z0, x1, z1, y0, y1, m, skip=()):
    lo, hi = _lo_hi(x0, z0, x1, z1, y0, y1)
    p.box(lo, hi, m, skip=skip)


def _blocks(lay: dict):
    """Las 8 manzanas de la ciudad (sin la del medio, que es la plaza): (i, j, x0, z0, x1, z1) en bruto."""
    c = lay["city"]
    blk, st = c["block"], c["street"]
    out = []
    for j in range(3):
        for i in range(3):
            if i == 1 and j == 1:
                continue
            x0 = c["x0"] + i * (blk + st)
            z0 = c["z0"] + j * (blk + st)
            out.append((i, j, x0, z0, x0 + blk, z0 + blk))
    return out


# --------------------------------------------------------------------------------------
# Plan: qué edificios van en cada manzana, con sus cajas de colisión
# --------------------------------------------------------------------------------------

SIDEWALK = 1.5
ALLEY = 2.0


def plan(lay: dict, d: dict) -> dict:
    rnd = random.Random(_seed(d["id"]))
    theme = d["id"]
    out = {"buildings": [], "props": [], "landmark": None}
    for (i, j, bx0, bz0, bx1, bz1) in _blocks(lay):
        x0, z0, x1, z1 = bx0 + SIDEWALK, bz0 + SIDEWALK, bx1 - SIDEWALK, bz1 - SIDEWALK
        q = 2 if j == 2 else 0  # la puerta mira a la calle de la plaza (norte → su cara sur)
        midx = (x0 + x1) / 2
        # En las manzanas del eje norte-sur, el callejón es una galería que deja ver la plaza.
        gap = 6.0 if (i == 1 and theme == "pixel") else ALLEY
        lots = [[x0, z0, midx - gap / 2, z1], [midx + gap / 2, z0, x1, z1]]
        if theme == "cero":  # diseño propio: pasajes en los ejes y torres ancla (cero.py)
            out["buildings"] += cero.lots(i, j, x0, z0, x1, z1, rnd)
        elif theme == "arcade":  # diseño propio: torres-máquina que miran a la plaza (arcade.py)
            out["buildings"] += arcade.lots(i, j, x0, z0, x1, z1, rnd)
        elif theme == "pixel":
            for lot in lots:
                out["buildings"].append({"style": "voxel", "rect": lot, "h": round(rnd.uniform(16, 30), 2), "q": q})
        elif theme == "agora":
            midz = (z0 + z1) / 2
            for (a, b) in ((x0, midx - ALLEY / 2), (midx + ALLEY / 2, x1)):
                out["buildings"].append({"style": "house", "rect": [a, z0, b, midz - ALLEY / 2], "h": round(rnd.uniform(7, 11), 2), "q": 0})
                out["buildings"].append({"style": "house", "rect": [a, midz + ALLEY / 2, b, z1], "h": round(rnd.uniform(7, 12), 2), "q": 2})
        elif theme == "taller":
            for lot in lots:
                out["buildings"].append({"style": "hall", "rect": lot, "h": round(rnd.uniform(10, 14), 2), "q": q})
        elif theme == "frontera":
            midz = (z0 + z1) / 2
            for lot in lots:
                out["buildings"].append({"style": "outpost", "rect": [lot[0], z0, lot[2], midz - ALLEY / 2], "h": 6.0, "q": 0})
                out["buildings"].append({"style": "outpost", "rect": [lot[0], midz + ALLEY / 2, lot[2], z1], "h": 6.0, "q": 2})
        elif theme == "vertical":
            for lot in lots:
                out["buildings"].append({"style": "stack", "rect": [lot[0] + 0.5, lot[1] + 0.5, lot[2] - 0.5, lot[3] - 0.5], "h": round(3.1 * rnd.randint(7, 12), 2), "q": q})
        # Atrezo del tema en las aceras que dan a las calles de dentro de la ciudad.
        spots = []
        if i != 1:
            spots.append((bx1 - 0.8 if i == 0 else bx0 + 0.8, (bz0 + bz1) / 2, 90 if i == 0 else -90))
        if j != 1:
            spots.append(((bx0 + bx1) / 2, bz1 - 0.8 if j == 0 else bz0 + 0.8, 0 if j == 0 else 180))
        for (px, pz, rot) in spots:
            if theme == "cero":
                px, pz = cero.prop_shift(px, pz)
            elif theme in ("arcade", "pixel"):  # el atrezo no tapa el callejón entre los dos edificios
                if abs(px - (bx0 + bx1) / 2) < 0.01:
                    px += 6
                if abs(pz - (bz0 + bz1) / 2) < 0.01:
                    pz += 6
            out["props"].append({"x": round(px, 2), "z": round(pz, 2), "rot": rot})
    # Cero no lleva monumento en la plaza: allí está la Torre Cero (cero.py).
    out["landmark"] = None if theme in ("cero", "arcade", "pixel") else {"x": C, "z": C}
    return out


def colliders(lay: dict, d: dict) -> list[list[float]]:
    """Cajas sólidas [cx, cy, cz, hx, hy, hz] en coordenadas del chunk."""
    pl = plan(lay, d)
    boxes = []
    for b in pl["buildings"]:
        x0, z0, x1, z1 = b["rect"]
        boxes.append([round((x0 + x1) / 2, 3), round(b["h"] / 2, 3), round((z0 + z1) / 2, 3), round((x1 - x0) / 2, 3), round(b["h"] / 2, 3), round((z1 - z0) / 2, 3)])
    for pr in pl["props"]:
        boxes.append([pr["x"], 1.0, pr["z"], 0.7, 1.0, 0.7])
    lm = pl["landmark"]
    if lm:
        boxes.append([lm["x"], 2.5, lm["z"], 3.2, 2.5, 3.2])
    if d["id"] == "cero":
        boxes += cero.colliders()
    if d["id"] == "arcade":
        boxes += arcade.colliders()
    return boxes


def write_colliders(lay: dict, districts: list[dict]) -> None:
    data = {"$comment": "Generado por tools/forge/city.py. No lo edites a mano: vuelve a forjar (npm run forge:districts).", "cities": {}}
    for d in districts:
        data["cities"][d["id"]] = colliders(lay, d)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")


# --------------------------------------------------------------------------------------
# Estilos de edificio
# --------------------------------------------------------------------------------------

def _tower(p: Part, b: dict, color: str, rnd: random.Random, dark: bool, detail: int):
    x0, z0, x1, z1 = b["rect"]
    h = b["h"]
    face = mat("fachada", "#3a3f58" if dark else rnd.choice(["#7f98b0", "#9fb4c8", "#6f8aa3"]))
    trim = mat("metal", "#1b1f2e")
    neon = mat("neon", color)
    alt = mat("neon", rnd.choice(["#36d9ff", "#ff4fd8", "#ff4f8b"]))
    # Zócalo con tienda (luz) y torre retranqueada encima.
    _box(p, x0, z0, x1, z1, 0, 5, trim)
    _box(p, x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, 4.6, 5.0, neon)
    i = 1.0
    _box(p, x0 + i, z0 + i, x1 - i, z1 - i, 5, h, face)
    # Franjas verticales de luz en las cuatro esquinas y una corona.
    for (cx, cz) in ((x0 + i, z0 + i), (x1 - i, z0 + i), (x0 + i, z1 - i), (x1 - i, z1 - i)):
        _box(p, cx - 0.12, cz - 0.12, cx + 0.12, cz + 0.12, 5, h, alt if dark else neon)
    _box(p, x0 + i - 0.1, z0 + i - 0.1, x1 - i + 0.1, z1 - i + 0.1, h - 1.2, h - 0.6, neon)
    _box(p, x0 + 2.5, z0 + 2.5, x1 - 2.5, z1 - 2.5, h, h + 2.2, trim)
    lo, hi = _lo_hi((x0 + x1) / 2, (z0 + z1) / 2, (x0 + x1) / 2, (z0 + z1) / 2, 0, 0)
    p.cylinder((lo[0], lo[1], h + 2.2), 0.12, 4 + rnd.random() * 4, trim, segments=6)
    # Anuncio vertical sin letras en la cara que da a la cruz.
    if detail:
        qx = x1 - i + 0.05 if b["q"] in (0, 2) else x0 + i - 0.35
        _box(p, qx, z0 + 3, qx + 0.3, z0 + 5, h * 0.35, h * 0.75, mat("pantalla", rnd.choice(["#36d9ff", "#ff4fd8", "#ff4f8b"])))


def _voxel(p: Part, b: dict, color: str, rnd: random.Random, detail: int):
    x0, z0, x1, z1 = b["rect"]
    tints = ["#ff4fd8", "#4fa3ff", "#ffd54f", "#6dff8a", "#ff7a45", "#a26bff"]
    y = 0.0
    inset = 0.0
    tiers = 3
    for k in range(tiers):
        th = b["h"] / tiers
        m = mat("azulejo", rnd.choice(tints))
        _box(p, x0 + inset, z0 + inset, x1 - inset, z1 - inset, y, y + th, m)
        _box(p, x0 + inset - 0.05, z0 + inset - 0.05, x1 - inset + 0.05, z1 - inset + 0.05, y + th - 0.4, y + th, mat("neon", color))
        if detail:
            # Píxeles encendidos en la fachada que da a la cruz.
            for n in range(6):
                px = x0 + inset + 1 + rnd.random() * (x1 - x0 - 2 * inset - 2.5)
                py = y + 1 + rnd.random() * (th - 2.5)
                face_z = z1 - inset + 0.02 if b["q"] in (0, 1) else z0 + inset - 0.12
                _box(p, px, face_z, px + 1.0, face_z + 0.1, py, py + 1.0, mat("neon", rnd.choice(tints)))
        y += th
        inset += 1.6


def _house(p: Part, b: dict, color: str, rnd: random.Random, detail: int):
    x0, z0, x1, z1 = b["rect"]
    h = b["h"]
    wall = mat("cal", "#f2ece0")
    _box(p, x0, z0, x1, z1, 0, h, wall)
    _box(p, x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, 0, 0.6, mat("piedra", "#d9cfb8"))
    roof = Part("roof")
    hip_roof(roof, x1 - x0, z1 - z0, 0.0, detail)
    cx, cy = (x0 + x1) / 2 - C, -((z0 + z1) / 2 - C)
    p.merge(roof, Matrix.Translation((cx, cy, h)))
    roof.bm.free()
    # Ventanas con persianas y una puerta con toldo hacia la cruz.
    glass = mat("ventana", "#ffd27a")
    shut = mat("persiana", rnd.choice(["#2f7d6a", "#3a6ea5", "#8a5a3c"]))
    floors = max(1, int((h - 1) // 3))
    for f in range(floors):
        y = 1.4 + f * 3
        for t in (0.3, 0.7):
            x = x0 + (x1 - x0) * t
            for face_z, d in ((z0 - 0.06, 0.06), (z1, 0.06)):
                _box(p, x - 0.5, face_z, x + 0.5, face_z + d, y, y + 1.4, glass)
                if detail:
                    _box(p, x - 0.95, face_z - 0.02, x - 0.55, face_z + d + 0.02, y, y + 1.4, shut)
                    _box(p, x + 0.55, face_z - 0.02, x + 0.95, face_z + d + 0.02, y, y + 1.4, shut)
    door_z = z1 if b["q"] in (0, 1) else z0 - 0.06
    xm = (x0 + x1) / 2
    _box(p, xm - 0.7, door_z, xm + 0.7, door_z + 0.06, 0, 2.3, mat("persiana", "#6b4a2c"))
    aw_z0, aw_z1 = (z1, z1 + 1.4) if b["q"] in (0, 1) else (z0 - 1.4, z0)
    _box(p, xm - 1.6, aw_z0, xm + 1.6, aw_z1, 2.6, 2.75, mat("toldo", color))


def _hall(p: Part, b: dict, color: str, rnd: random.Random, detail: int):
    x0, z0, x1, z1 = b["rect"]
    h = b["h"]
    wall = mat("panel", rnd.choice(["#6a7584", "#7d8794", "#59616e"]))
    _box(p, x0, z0, x1, z1, 0, h - 2, wall)
    # Tejado plano con lucernarios en fila (el «diente de sierra» de las naves) y sus tapas.
    _box(p, x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2, h - 2, h - 1.8, mat("metal", "#3a4256"))
    n = 4
    step = (x1 - x0) / n
    for k in range(n):
        a = x0 + k * step + step * 0.2
        _box(p, a, z0 + 0.6, a + step * 0.45, z1 - 0.6, h - 1.8, h - 0.4, mat("ventana", "#cfe8ff"))
        _box(p, a - 0.1, z0 + 0.5, a + step * 0.45 + 0.1, z1 - 0.5, h - 0.4, h - 0.2, mat("metal", "#8c95a8"))
    # Franja de seguridad y gran portón hacia la cruz.
    _box(p, x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, 1.0, 1.4, mat("metal", "#ff8a2c"))
    door_z = z1 if b["q"] in (0, 1) else z0 - 0.08
    xm = (x0 + x1) / 2
    _box(p, xm - 2.2, door_z, xm + 2.2, door_z + 0.08, 0, 4.2, mat("metal", "#3a4256"))
    _box(p, xm - 2.3, door_z - 0.02, xm + 2.3, door_z + 0.1, 4.2, 4.45, mat("neon", color))
    # Chimenea con anillo rojo.
    cxw, czw = (x0 + 1.5, z0 + 1.5) if b["q"] in (0, 2) else (x1 - 1.5, z0 + 1.5)
    lo, _ = _lo_hi(cxw, czw, cxw, czw, 0, 0)
    ch = h + 8 + rnd.random() * 6
    p.cylinder((lo[0], lo[1], 0), 0.9, ch, mat("metal", "#9aa3ae"), segments=12 if detail else 8)
    p.cylinder((lo[0], lo[1], ch - 1.6), 0.95, 0.6, mat("neon", "#ff3b3b"), segments=12 if detail else 8)


def _outpost(p: Part, b: dict, color: str, rnd: random.Random, detail: int):
    x0, z0, x1, z1 = b["rect"]
    shell = mat("scifi", "#c8cfdc")
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    lo, _ = _lo_hi(cx, cz, cx, cz, 0, 0)
    r = min(x1 - x0, z1 - z0) / 2 - 0.5
    seg = 24 if detail else 12
    prof = [(r * math.cos(t), r * math.sin(t)) for t in [k * math.pi / 2 / 8 for k in range(9)]]
    p.lathe((lo[0], lo[1], 0), [(max(x, 0.001), y) for x, y in prof], shell, segments=seg, close_top=True)
    p.lathe((lo[0], lo[1], 0), [(r + 0.06, 0.6), (r + 0.06, 0.9)], mat("neon", color), segments=seg, smooth=False)
    # Módulo de entrada hacia la cruz y antena.
    door_z = z1 - 1 if b["q"] in (0, 1) else z0 - 1
    _box(p, cx - 1.5, door_z, cx + 1.5, door_z + 2, 0, 2.6, mat("scifi", "#b8c2d6"))
    _box(p, cx - 0.8, door_z + (2.02 if b["q"] in (0, 1) else -0.02), cx + 0.8, door_z + (2.06 if b["q"] in (0, 1) else 0.02), 0.2, 2.2, mat("neon", color))
    p.cylinder((lo[0] + r * 0.4, lo[1], r * 0.8), 0.08, 5 + rnd.random() * 3, mat("metal", "#8c95a8"), segments=6)


def _stack(p: Part, b: dict, color: str, rnd: random.Random, detail: int):
    x0, z0, x1, z1 = b["rect"]
    lh = 3.1
    levels = int(round(b["h"] / lh))
    pole = mat("hierro", "#4a4f5c")
    deck = mat("metal", "#3a3f4a")
    tints = ["#b9b2a4", "#c8bfae", "#a6a39a", "#d9c6a8", "#8f9aa3", "#c0a080", "#b07d5e"]
    for k in range(levels):
        y = k * lh
        _box(p, x0, z0, x1, z1, y, y + 0.15, deck)
        # Dos o tres caravanas por planta, alternando la orientación y desplazadas.
        along = k % 2 == 0
        n = 2 if (x1 - x0) < 10 else 3
        for i in range(n):
            if rnd.random() < 0.12:
                continue
            tint = mat("metal", rnd.choice(tints))
            if along:
                cz = z0 + (z1 - z0) * (i + 0.5) / n + rnd.uniform(-0.3, 0.3)
                a0, a1 = x0 + rnd.uniform(0, 1.5), x1 - rnd.uniform(0, 1.5)
                _box(p, a0, cz - 1.15, a1, cz + 1.15, y + 0.15, y + 2.65, tint)
                _box(p, a0 - 0.02, cz - 1.17, a1 + 0.02, cz + 1.17, y + 1.3, y + 1.45, mat("metal", color))
                if detail:
                    for wx in (a0 + 1, a1 - 2):
                        _box(p, wx, cz - 1.19, wx + 1, cz - 1.15, y + 1.55, y + 2.25, mat("ventana", "#ffd27a"))
            else:
                cx = x0 + (x1 - x0) * (i + 0.5) / n + rnd.uniform(-0.3, 0.3)
                a0, a1 = z0 + rnd.uniform(0, 1.5), z1 - rnd.uniform(0, 1.5)
                _box(p, cx - 1.15, a0, cx + 1.15, a1, y + 0.15, y + 2.65, tint)
                _box(p, cx - 1.17, a0 - 0.02, cx + 1.17, a1 + 0.02, y + 1.3, y + 1.45, mat("metal", color))
                if detail:
                    for wz in (a0 + 1, a1 - 2):
                        _box(p, cx - 1.19, wz, cx - 1.15, wz + 1, y + 1.55, y + 2.25, mat("ventana", "#ffd27a"))
        # Andamio: postes en las esquinas y a media fachada.
        for (px, pz) in ((x0, z0), (x1, z0), (x0, z1), (x1, z1), ((x0 + x1) / 2, z0), ((x0 + x1) / 2, z1)):
            _box(p, px - 0.1, pz - 0.1, px + 0.1, pz + 0.1, y, y + lh, pole)
    # Escalera en zigzag por una cara y bombillas.
    if detail:
        for k in range(levels):
            y = k * lh
            xa = x0 - 0.9
            za, zb = (z0 + 0.5, z0 + 3.5) if k % 2 == 0 else (z0 + 3.5, z0 + 0.5)
            p.tube([(xa - C, -(za - C), y + 0.2), (xa - C, -(zb - C), y + lh)], 0.06, pole, segments=4)
        for k in range(1, levels, 2):
            p.sphere(((x0 + x1) / 2 - C, -(z0 - 0.4 - C), k * lh + 2.4), 0.12, mat("farol", "#ffd27a"), subdiv=1)


STYLES = {"tower": None, "voxel": _voxel, "house": _house, "hall": _hall, "outpost": _outpost, "stack": _stack}

PROPS = {
    "arcade": ["cabinet", "coin"],
    "pixel": ["voxel_tree", "voxel_flower"],
    "agora": ["cafe_table", "string_lamp"],
    "taller": ["crates", "robot_arm"],
    "frontera": ["rock", "crystals"],
    "cero": ["neon_sign", "vending"],
    "vertical": ["fire_barrel", "tires"],
}
LANDMARK = {
    "arcade": ("joystick", 2.4),
    "pixel": ("pixel_heart", 2.4),
    "agora": ("cafe_table", 2.2),
    "taller": ("gear", 2.2),
    "frontera": ("crystals", 2.6),
    "vertical": ("trailer", 2.0),
}


def _put(target: Part, item: Part, x: float, z: float, rot: float, scale: float = 1.0) -> None:
    target.merge(item, Matrix.Translation((x - C, -(z - C), 0.0)) @ Matrix.Rotation(math.radians(rot), 4, "Z") @ Matrix.Scale(scale, 4))
    item.bm.free()


def build(lay: dict, d: dict, detail: int = 1):
    """Modelo de la ciudad del centro del distrito (un objeto, centrado en el chunk)."""
    rnd = random.Random(_seed(d["id"]) + 1)
    color = d["color"]
    p = Part(f"district_city_{d['id']}")
    pl = plan(lay, d)
    if d["id"] == "arcade":
        arcade.build(p, [b for b in pl["buildings"] if b["style"] == "cabinet"], rnd, detail)
    if d["id"] == "pixel":
        pixel.build(p, detail)
    for b in pl["buildings"]:
        if b["style"] == "cabinet":
            continue
        if b["style"] == "tower":
            _tower(p, b, color, rnd, d["id"] == "cero", detail)
        else:
            STYLES[b["style"]](p, b, color, rnd, detail)
    names = PROPS.get(d["id"], ["crates", "rock"])
    for i, pr in enumerate(pl["props"]):
        _put(p, decor.BUILDERS[names[i % len(names)]](color), pr["x"], pr["z"], pr["rot"])
    if d["id"] == "cero":
        cero.build(p, _blocks(lay), detail)
    name, scale = LANDMARK.get(d["id"], ("crystals", 2.0))
    lm = pl["landmark"]
    # Peana de la plaza con su anillo de luz, y el monumento encima.
    seg = 32 if detail else 16
    if not lm:
        ob = p.to_object()
        ob.name = f"district_city_{d['id']}"
        finish(ob)
        return ob
    p.cylinder((0, 0, 0), 3.6, 0.6, mat("metal", "#1b1f2e"), segments=seg)
    p.lathe((0, 0, 0), [(3.65, 0.35), (3.65, 0.5)], mat("neon", color), segments=seg, smooth=False)
    item = decor.BUILDERS[name](color)
    target = Part("lm")
    target.merge(item, Matrix.Translation((0, 0, 0.6)) @ Matrix.Scale(scale * 1.35, 4))
    item.bm.free()
    p.merge(target, Matrix.Translation((lm["x"] - C, -(lm["z"] - C), 0)))
    target.bm.free()
    ob = p.to_object()
    ob.name = f"district_city_{d['id']}"
    finish(ob)
    return ob
