"""
El nexo: vestíbulo minimalista fuera del mapa. Suelo oscuro con líneas de luz cian,
un faro central fino (no tapa la vista entre portales) y marcos de portal con su peana.

La disposición sale de apps/realtime/src/nexo-layout.json (la misma que usa el servidor).
Las letras «xenxo» del suelo no son geometría: las siembra el servidor como label@1 de neón.
"""
from __future__ import annotations

import json
import math
import os

from mathutils import Matrix

from kit import Part, finish, mat

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def layout() -> dict:
    with open(os.path.join(ROOT, "apps", "realtime", "src", "nexo-layout.json"), encoding="utf-8") as f:
        return json.load(f)


def slots(lay: dict) -> list[tuple[float, float, float]]:
    """(x, z, facing) de cada portal: en anillo, mirando al centro (igual que seed-nexo.ts)."""
    cx, cz = lay["center"]
    P = lay["portals"]
    out = []
    for i in range(P["count"]):
        phi = 360.0 * i / P["count"]
        a = math.radians(phi)
        out.append((round(cx + P["ring"] * math.sin(a), 3), round(cz - P["ring"] * math.cos(a), 3), -phi))
    return out


def _annulus(p: Part, r0: float, r1: float, z: float, m, segments: int) -> None:
    """Anillo plano (corona) a la altura z."""
    p.lathe((0, 0, 0), [(r1, z), (r0, z)], m, segments=segments, smooth=False)


def floor(lay: dict, detail: int = 1):
    """Plataforma circular con anillos de luz y líneas hacia cada portal. Centrada en el origen."""
    cyan = lay["colors"]["line"]
    plat = mat("panel", "#2a3242")
    core = mat("panel", "#3a4558")
    void = mat("oscuro", "#04060a")
    neon = mat("neon", cyan)
    seg = 128 if detail else 64
    R = lay["platform"]
    p = Part("nexo_floor")
    # Vacío alrededor (todo el chunk) y la plataforma con canto.
    p.box((-32, -32, -0.62), (32, 32, -0.6), void, skip=("-z",))
    p.lathe((0, 0, 0), [(R, -0.6), (R, 0.0)], plat, segments=seg, smooth=False)
    p.lathe((0, 0, 0), [(R, 0.0), (0.0001, 0.0)], plat, segments=seg, smooth=False)
    # Círculo central un tono más claro, enrasado
    _annulus(p, 0.0001, lay["rings"][0], 0.004, core, seg)
    # Anillos de luz embutidos
    for r in lay["rings"]:
        _annulus(p, r - 0.05, r + 0.05, 0.009, neon, seg)
    # Línea hacia cada portal (del anillo medio a la peana)
    Pc = lay["portals"]
    r_in = lay["rings"][1] + 0.3
    r_out = Pc["ring"] - Pc["pedestal"] - 0.75
    for i in range(Pc["count"]):
        a = math.radians(360.0 * i / Pc["count"])
        bar = Part("l")
        bar.box((-0.03, r_in, 0.0), (0.03, r_out, 0.009), neon)
        # Bearing φ (0 = norte = −Z del mundo = +Y de Blender), girando hacia el este (+X).
        p.merge(bar, Matrix.Rotation(-a, 4, "Z"))
        bar.bm.free()
    ob = p.to_object()
    ob.name = "nexo_floor"
    finish(ob)
    return ob


def beacon(lay: dict, detail: int = 1):
    """Faro central: peana baja, un haz fino de luz y tres anillos flotando por encima de la cabeza."""
    cyan = lay["colors"]["line"]
    base = mat("metal", "#2a3240")
    neon = mat("neon", cyan)
    p = Part("nexo_beacon")
    s = 48 if detail else 24
    p.cylinder((0, 0, 0), 1.2, 0.12, base, segments=s)
    p.lathe((0, 0, 0), [(1.22, 0.125), (1.1, 0.125)], neon, segments=s, smooth=False)
    p.cylinder((0, 0, 0.12), 0.06, 14.0, neon, segments=8 if detail else 6)
    for z, r, tilt in ((3.4, 2.6, 0.0), (5.0, 1.9, 0.22), (6.4, 1.2, -0.3)):
        n = 64 if detail else 32
        ring = [(r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n), 0.0) for k in range(n)]
        part = Part("r")
        part.tube(ring, 0.05, neon, segments=6 if detail else 4, closed=True)
        p.merge(part, Matrix.Translation((0, 0, z)) @ Matrix.Rotation(tilt, 4, "X"))
        part.bm.free()
    ob = p.to_object()
    ob.name = "nexo_beacon"
    finish(ob)
    return ob


def frame(lay: dict, detail: int = 1):
    """
    Marco de portal: pantalla (la portada la pinta el cliente encima), patas, filo de luz y,
    delante, la peana del monumento. Frente hacia −Y (mira al centro una vez colocado).
    """
    P = lay["portals"]
    cyan = lay["colors"]["line"]
    W, H, Z0 = P["w"], P["h"], P["bottom"]
    body = mat("metal", "#161b24")
    edge = mat("metal", "#2b3445")
    screen = mat("oscuro", "#0e1624")
    neon = mat("neon", cyan)
    b = 0.12  # grosor del marco
    p = Part("nexo_frame")
    # Trasera y pantalla apagada
    p.box((-W / 2 - b, 0.0, Z0 - b), (W / 2 + b, 0.14, Z0 + H + b), body)
    p.box((-W / 2, -0.005, Z0), (W / 2, 0.0, Z0 + H), screen)
    # Marco que sobresale por delante
    for lo, hi in (
        ((-W / 2 - b, -0.07, Z0 + H), (W / 2 + b, 0.0, Z0 + H + b)),
        ((-W / 2 - b, -0.07, Z0 - b), (W / 2 + b, 0.0, Z0)),
        ((-W / 2 - b, -0.07, Z0), (-W / 2, 0.0, Z0 + H)),
        ((W / 2, -0.07, Z0), (W / 2 + b, 0.0, Z0 + H)),
    ):
        p.box(lo, hi, edge)
    # Filo de luz alrededor de la pantalla: el anillo de portales se lee como portales aunque estén libres
    e = 0.022
    for lo, hi in (
        ((-W / 2, -0.075, Z0 + H - e), (W / 2, -0.07, Z0 + H)),
        ((-W / 2, -0.075, Z0), (W / 2, -0.07, Z0 + e)),
        ((-W / 2, -0.075, Z0 + e), (-W / 2 + e, -0.07, Z0 + H - e)),
        ((W / 2 - e, -0.075, Z0 + e), (W / 2, -0.07, Z0 + H - e)),
    ):
        p.box(lo, hi, neon)
    # Patas y pie
    for sx in (-1, 1):
        x = sx * (W / 2 - 0.5)
        p.box((x - 0.07, 0.02, 0.0), (x + 0.07, 0.12, Z0 - b), body)
        p.box((x - 0.25, -0.25, 0.0), (x + 0.25, 0.4, 0.05), body)
    # Peana del monumento, delante
    s = 32 if detail else 16
    d = P["pedestal"]
    ph = P["pedestal_h"]
    p.cylinder((0, -d, 0), 0.55, ph, edge, segments=s)
    p.lathe((0, -d, 0), [(0.56, ph + 0.002), (0.47, ph + 0.002)], neon, segments=s, smooth=False)
    ob = p.to_object()
    ob.name = "nexo_frame"
    finish(ob)
    return ob
