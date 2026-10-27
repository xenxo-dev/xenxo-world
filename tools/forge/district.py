"""
Distritos (disposición v2): suelo con la ciudad en el centro (su cruz de calles y su plaza; los
edificios, en city.py), la calle en anillo y las 16 parcelas de 10×10 m alrededor, bordeadas de luz
del color del distrito, y la puerta de vuelta al nexo. Más el emblema de cada distrito (su
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


def _rect(p: Part, x0: float, z0: float, x1: float, z1: float, y0: float, y1: float, m) -> None:
    a, b = _W(x0, z1), _W(x1, z0)
    p.box((a[0], a[1], y0), (b[0], b[1], y1), m, skip=("-z",))


def _frame_lines(p: Part, x0: float, z0: float, x1: float, z1: float, y: float, w: float, m) -> None:
    """Contorno de luz de un rectángulo, embutido en el suelo."""
    _rect(p, x0, z0, x1, z0 + w, y, y + 0.004, m)
    _rect(p, x0, z1 - w, x1, z1, y, y + 0.004, m)
    _rect(p, x0, z0 + w, x0 + w, z1 - w, y, y + 0.004, m)
    _rect(p, x1 - w, z0 + w, x1, z1 - w, y, y + 0.004, m)


def ground(lay: dict, d: dict, detail: int = 1):
    color = d["color"]
    floor = mat("panel", "#252c38")
    street = mat("panel", "#323b4b")
    pad = mat("scifi", "#2a3140")
    void = mat("oscuro", "#04060a")
    neon = mat("neon", color)
    white = mat("neon", "#cfe8ff")
    p = Part(f"district_{d['id']}")
    S = CHUNK
    # Base del chunk (el vacío se ve por debajo de los bordes)
    p.box((-S / 2, -S / 2, -0.62), (S / 2, S / 2, -0.6), void, skip=("-z",))
    _rect(p, 0, 0, S, S, -0.6, 0.0, floor)
    # Calle en anillo alrededor de la ciudad, un tono más clara, con sus bordes de luz blanca fría.
    r0, r1, r2, r3_ = lay["ring"]
    for (x0, z0, x1, z1) in ((0.5, r0, S - 0.5, r1), (0.5, r2, S - 0.5, r3_), (r0, r1, r1, r2), (r2, r1, r3_, r2)):
        _rect(p, x0, z0, x1, z1, 0.0, 0.003, street)
    for x in (r0, r3_ - 0.06):
        _rect(p, x, r1, x + 0.06, r2, 0.003, 0.007, white)
    for z in (r0, r3_ - 0.06):
        _rect(p, 0.5, z, S - 0.5, z + 0.06, 0.003, 0.007, white)
    # La ciudad: acera del color del distrito en el borde, cruz de calles y plaza central.
    c = lay["city"]
    pave = mat("losa", "#3a4252")
    _rect(p, c["x0"], c["z0"], c["x1"], c["z1"], 0.0, 0.004, pave)
    _frame_lines(p, c["x0"], c["z0"], c["x1"], c["z1"], 0.004, 0.1, neon)
    h = c["cross"] / 2
    C2 = S / 2
    _rect(p, C2 - h, c["z0"], C2 + h, c["z1"], 0.004, 0.006, street)
    _rect(p, c["x0"], C2 - h, c["x1"], C2 + h, 0.004, 0.006, street)
    seg = 48 if detail else 24
    p.lathe((0, 0, 0), [(c["plaza"], 0.008), (c["plaza"] - 0.15, 0.008)], neon, segments=seg, smooth=False)
    # Parcelas: rejilla octogonal y contorno de luz del color del distrito
    W, D = lay["parcel"]["w"], lay["parcel"]["d"]
    for q in lay["parcels"]:
        x0, z0 = q["x"] - W / 2, q["z"] - D / 2
        _rect(p, x0, z0, x0 + W, z0 + D, 0.0, 0.005, pad)
        _frame_lines(p, x0, z0, x0 + W, z0 + D, 0.005, 0.08, neon)
    # Borde del chunk
    _frame_lines(p, 0.4, 0.4, S - 0.4, S - 0.4, 0.0, 0.08, neon)
    # Emblema del punto de llegada
    sx, _, sz = lay["spawn"]
    ox, oy = _W(sx, sz)
    seg = 48 if detail else 24
    p.lathe((ox, oy, 0.0), [(1.7, 0.008), (1.58, 0.008)], neon, segments=seg, smooth=False)
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
