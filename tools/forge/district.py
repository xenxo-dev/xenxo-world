"""
Distritos (disposición v3, 256 × 256 m): suelo con la ciudad en el centro (3 × 3 manzanas y la
plaza; los edificios, en city.py), dos anillos de calles, cuatro avenidas, las 64 parcelas de
15 × 15 m bordeadas de luz del color del distrito, la zona de actividades y la puerta del nexo. Más el emblema de cada distrito (su
monumento en el nexo).

La disposición sale de apps/realtime/src/districts.json (la misma que usan el servidor y la web).
"""
from __future__ import annotations

import json
import math
import os

from mathutils import Matrix

from kit import CHUNK, Part, finish, mat

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def layout() -> dict:
    with open(os.path.join(ROOT, "apps", "realtime", "src", "districts.json"), encoding="utf-8") as f:
        return json.load(f)


def _W(x: float, z: float) -> tuple[float, float]:
    """Mundo (x, z) del chunk → Blender local centrado en el chunk."""
    C = CHUNK / 2
    return (x - C, -(z - C))


# Las capas del suelo (calles, losas, líneas) se separan ×6 en altura: con milímetros entre ellas
# el búfer de profundidad no las distingue a 50 m y el suelo parpadea al andar (z-fighting).
LIFT = 6.0


def _lift(y: float) -> float:
    return y * LIFT if 0.0 < y < 0.05 else y


def _rect(p: Part, x0: float, z0: float, x1: float, z1: float, y0: float, y1: float, m) -> None:
    a, b = _W(x0, z1), _W(x1, z0)
    p.box((a[0], a[1], _lift(y0)), (b[0], b[1], _lift(y1)), m, skip=("-z",))


def _frame_lines(p: Part, x0: float, z0: float, x1: float, z1: float, y: float, w: float, m) -> None:
    """Contorno de luz de un rectángulo, embutido en el suelo."""
    _rect(p, x0, z0, x1, z0 + w, y, y + 0.004, m)
    _rect(p, x0, z1 - w, x1, z1, y, y + 0.004, m)
    _rect(p, x0, z0 + w, x0 + w, z1 - w, y, y + 0.004, m)
    _rect(p, x1 - w, z0 + w, x1, z1 - w, y, y + 0.004, m)


def _square_ring(p: Part, a: float, b: float, m, y0: float = 0.0, y1: float = 0.003) -> None:
    """Calle en anillo cuadrado entre las coordenadas a..b (por fuera) y su simétrica (64 − b..64 − a)."""
    S = CHUNK
    lo0, lo1 = a, b
    hi0, hi1 = S - b, S - a
    _rect(p, lo0, lo0, hi1, lo1, y0, y1, m)        # norte
    _rect(p, lo0, hi0, hi1, hi1, y0, y1, m)        # sur
    _rect(p, lo0, lo1, lo1, hi0, y0, y1, m)        # oeste
    _rect(p, hi0, lo1, hi1, hi0, y0, y1, m)        # este


def ground(lay: dict, d: dict, detail: int = 1):
    """Suelo del distrito v3 (256 × 256 m): calles, ciudad, parcelas, zona de actividades y puerta."""
    color = d["color"]
    floor = mat("panel", "#252c38")
    street = mat("panel", "#323b4b")
    pad = mat("scifi", "#2a3140")
    void = mat("oscuro", "#04060a")
    park = mat("panel", "#1f2a2c")
    neon = mat("neon", color)
    white = mat("neon", "#cfe8ff")
    p = Part(f"district_{d['id']}")
    b0, b1 = lay["bounds"]
    # Base (el vacío se ve por debajo de los bordes) y suelo.
    _rect(p, b0, b0, b1, b1, -0.62, -0.6, void)
    _rect(p, b0, b0, b1, b1, -0.6, 0.0, floor)
    # Franja exterior: zona de actividades y parques (un tono verdoso), con su borde de luz.
    r = lay["roads"]
    edge = r["ring2"][0] - lay["parcel"]["d"]
    for (x0, z0, x1, z1) in ((b0, b0, b1, edge), (b0, CHUNK - edge, b1, b1), (b0, edge, edge, CHUNK - edge), (CHUNK - edge, edge, b1, CHUNK - edge)):
        _rect(p, x0, z0, x1, z1, 0.0, 0.002, park)
    _frame_lines(p, b0 + 0.4, b0 + 0.4, b1 - 0.4, b1 - 0.4, 0.002, 0.12, neon)
    # Dos anillos de calles y cuatro avenidas del centro a los bordes, con bordes de luz fría.
    _square_ring(p, r["ring1"][0], r["ring1"][1], street)
    _square_ring(p, r["ring2"][0], r["ring2"][1], street)
    h = r["avenue"] / 2
    C2 = CHUNK / 2
    _rect(p, C2 - h, b0, C2 + h, b1, 0.003, 0.005, street)
    _rect(p, b0, C2 - h, b1, C2 + h, 0.003, 0.005, street)
    for x in (C2 - h, C2 + h - 0.08):
        _rect(p, x, b0, x + 0.08, b1, 0.005, 0.008, white)
        _rect(p, b0, x, b1, x + 0.08, 0.005, 0.008, white)
    # La ciudad: losa, borde de luz del distrito, calles entre manzanas y la plaza del medio.
    c = lay["city"]
    pave = mat("losa", "#3a4252")
    _rect(p, c["x0"], c["z0"], c["x1"], c["z1"], 0.0, 0.006, pave)
    _frame_lines(p, c["x0"], c["z0"], c["x1"], c["z1"], 0.006, 0.12, neon)
    blk, st = c["block"], c["street"]
    for k in (1, 2):
        a = c["x0"] + k * blk + (k - 1) * st
        _rect(p, a, c["z0"], a + st, c["z1"], 0.006, 0.008, street)
        _rect(p, c["x0"], a, c["x1"], a + st, 0.006, 0.008, street)
    pa = c["x0"] + blk + st
    plaza = mat("losa", "#4a4f5c")
    _rect(p, pa, pa, pa + blk, pa + blk, 0.008, 0.01, plaza)
    seg = 64 if detail else 32
    p.lathe((0, 0, 0), [(c["plaza"], _lift(0.012)), (c["plaza"] - 0.2, _lift(0.012))], neon, segments=seg, smooth=False)
    # Cuatro puestos de actividad en las esquinas de la plaza (círculos de luz, para minijuegos).
    for (ax, az) in ((pa + 4, pa + 4), (pa + blk - 4, pa + 4), (pa + 4, pa + blk - 4), (pa + blk - 4, pa + blk - 4)):
        ox, oy = _W(ax, az)
        p.lathe((ox, oy, 0.0), [(2.2, _lift(0.012)), (2.05, _lift(0.012))], white, segments=32 if detail else 16, smooth=False)
    # Parcelas: rejilla octogonal y contorno de luz del color del distrito.
    W, D = lay["parcel"]["w"], lay["parcel"]["d"]
    for q in lay["parcels"]:
        x0, z0 = q["x"] - W / 2, q["z"] - D / 2
        _rect(p, x0, z0, x0 + W, z0 + D, 0.0, 0.007, pad)
        _frame_lines(p, x0, z0, x0 + W, z0 + D, 0.007, 0.1, neon)
    # Emblema del punto de llegada
    sx, _, sz = lay["spawn"]
    ox, oy = _W(sx, sz)
    p.lathe((ox, oy, 0.0), [(1.7, _lift(0.012)), (1.58, _lift(0.012))], neon, segments=48 if detail else 24, smooth=False)
    # Puerta de vuelta al nexo: dos pilares y dintel con luz por dentro
    g = lay["gate"]
    body = mat("metal", "#1a202b")
    half = g["span"] / 2
    gz = g["z"]
    for sx_ in (-1, 1):
        cx = 32 + sx_ * (half + 0.45)
        _rect(p, cx - 0.45, gz - 0.45, cx + 0.45, gz + 0.45, 0.0, 6.2, body)
        inner = cx - sx_ * 0.45
        lo, hi = sorted((inner, inner - sx_ * 0.05))
        _rect(p, lo, gz - 0.3, hi, gz + 0.3, 0.2, 5.6, neon)
    _rect(p, 32 - half - 0.9, gz - 0.5, 32 + half + 0.9, gz + 0.5, 6.2, 7.0, body)
    _rect(p, 32 - half, gz - 0.3, 32 + half, gz + 0.3, 6.15, 6.2, neon)
    ob = p.to_object()
    ob.name = f"district_{d['id']}"
    finish(ob)
    return ob


def emblem(d: dict, detail: int = 1):
    """Monumento del distrito en el nexo: una forma sencilla del color del distrito sobre un anillo de luz."""
    color = d["color"]
    body = mat("azulejo", color)
    neon = mat("neon", color)
    p = Part(f"emblem_{d['id']}")
    s = 32 if detail else 16
    p.lathe((0, 0, 0), [(0.5, 0.02), (0.42, 0.02)], neon, segments=s, smooth=False)
    shape = d["emblem"]
    if shape == "sphere":
        p.sphere((0, 0, 0.62), 0.45, body, subdiv=3 if detail else 2)
    elif shape == "ico":
        p.sphere((0, 0, 0.62), 0.5, body, subdiv=1)
    elif shape == "cube":
        c = Part("c")
        c.box((-0.32, -0.32, -0.32), (0.32, 0.32, 0.32), body)
        p.merge(c, Matrix.Translation((0, 0, 0.65)) @ Matrix.Rotation(math.radians(35), 4, "X") @ Matrix.Rotation(math.radians(45), 4, "Z"))
        c.bm.free()
    elif shape == "torus":
        n = 48 if detail else 24
        ring = [(0.36 * math.cos(2 * math.pi * k / n), 0.0, 0.62 + 0.36 * math.sin(2 * math.pi * k / n)) for k in range(n)]
        p.tube(ring, 0.11, body, segments=12 if detail else 8, closed=True)
    elif shape == "cone":
        p.cylinder((0, 0, 0.1), 0.45, 1.0, body, segments=4, radius_top=0.0)
    elif shape == "zero":
        # Un cero tachado (Ø) de pie: óvalo de tubo con su barra en diagonal, en neón.
        n = 48 if detail else 24
        oval = [(0.3 * math.cos(2 * math.pi * k / n), 0.0, 0.62 + 0.46 * math.sin(2 * math.pi * k / n)) for k in range(n)]
        p.tube(oval, 0.09, body, segments=12 if detail else 8, closed=True)
        p.tube([(-0.26, 0.0, 0.26), (0.26, 0.0, 0.98)], 0.05, neon, segments=8 if detail else 6)
    elif shape == "stack":
        # Tres caravanas apiladas y desplazadas, como las torres del distrito.
        for i, (dx, rz) in enumerate([(0.0, 0.0), (0.1, 18.0), (-0.08, -12.0)]):
            c = Part("c")
            c.box((-0.4, -0.17, 0.0), (0.4, 0.17, 0.26), body)
            c.box((-0.41, -0.18, 0.11), (0.41, 0.18, 0.14), neon)
            p.merge(c, Matrix.Translation((dx, 0, 0.08 + i * 0.3)) @ Matrix.Rotation(math.radians(rz), 4, "Z"))
            c.bm.free()
    else:
        raise ValueError(f"emblema desconocido: {shape}")
    ob = p.to_object()
    ob.name = f"emblem_{d['id']}"
    finish(ob)
    return ob
