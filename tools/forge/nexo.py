"""
El nexo: plataforma flotante fuera del mapa. Suelo oscuro con líneas de luz cian, un faro central
fino, y en el anillo las puertas abiertas de los distritos; detrás de cada una, su isla flotante
(casco con agujas de neón) con el distrito en pequeño, que se ve a través de la puerta.

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
    """(x, z, facing) de cada hueco de puerta: en anillo, mirando al centro (igual que nexo.ts)."""
    cx, cz = lay["center"]
    G = lay["gates"]
    out = []
    for i in range(G["count"]):
        phi = 360.0 * i / G["count"]
        a = math.radians(phi)
        out.append((round(cx + G["ring"] * math.sin(a), 3), round(cz - G["ring"] * math.cos(a), 3), -phi))
    return out


def used_slots(lay: dict) -> list[int]:
    """Huecos con distrito (el resto queda libre para distritos futuros)."""
    return sorted(set(lay["district_slots"].values()))


def island_spot(lay: dict, i: int) -> tuple[float, float, float]:
    """(x, z, facing) de la isla de un hueco: detrás de su puerta, mirando al centro."""
    cx, cz = lay["center"]
    G, I = lay["gates"], lay["islands"]
    phi = 360.0 * i / G["count"]
    a = math.radians(phi)
    ring = I["ring_alt"] if i % 2 else I["ring"]
    return (round(cx + ring * math.sin(a), 3), round(cz - ring * math.cos(a), 3), -phi)


def _annulus(p: Part, r0: float, r1: float, z: float, m, segments: int) -> None:
    """Anillo plano (corona) a la altura z."""
    p.lathe((0, 0, 0), [(r1, z), (r0, z)], m, segments=segments, smooth=False)


def floor(lay: dict, detail: int = 1):
    """Plataforma circular con anillos de luz y líneas hacia cada portal. Centrada en el origen."""
    cyan = lay["colors"]["line"]
    plat = mat("panel", "#2a3242")
    core = mat("panel", "#3a4558")
    neon = mat("neon", cyan)
    seg = 128 if detail else 64
    R = lay["platform"]
    p = Part("nexo_floor")
    # La plataforma con canto (alrededor, nada: se ve la ciudad de abajo, que pinta el cliente).
    p.lathe((0, 0, 0), [(R, -0.6), (R, 0.0)], plat, segments=seg, smooth=False)
    p.lathe((0, 0, 0), [(R, 0.0), (0.0001, 0.0)], plat, segments=seg, smooth=False)
    # Círculo central un tono más claro, enrasado
    _annulus(p, 0.0001, lay["rings"][0], 0.004, core, seg)
    # Anillos de luz embutidos
    for r in lay["rings"]:
        _annulus(p, r - 0.05, r + 0.05, 0.009, neon, seg)
    # Línea hacia cada puerta con distrito (del anillo medio al pie de la puerta)
    G = lay["gates"]
    r_in = lay["rings"][1] + 0.3
    r_out = G["ring"] - 0.6
    for i in used_slots(lay):
        a = math.radians(360.0 * i / G["count"])
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


def gate(lay: dict, detail: int = 1):
    """
    Puerta de distrito: un arco abierto (sin pantalla) para ver la isla del distrito a través de
    él. Dos pilares con filos de luz por dentro, dintel con remate y escalón. Frente hacia −Y.
    """
    G = lay["gates"]
    cyan = lay["colors"]["line"]
    W, H, Z0 = G["w"], G["h"], G["bottom"]
    body = mat("metal", "#141a26")
    edge = mat("metal", "#28324a")
    neon = mat("neon", cyan)
    pw, pd = 0.55, 0.7  # pilar: ancho y fondo
    p = Part("nexo_gate")
    # Escalón de entrada
    p.box((-W / 2 - pw - 0.2, -0.9, 0.0), (W / 2 + pw + 0.2, 0.5, Z0), edge)
    for sx in (-1, 1):
        x0 = sx * W / 2
        x1 = sx * (W / 2 + pw)
        lo, hi = min(x0, x1), max(x0, x1)
        p.box((lo, -pd / 2, Z0), (hi, pd / 2, Z0 + H), body)
        # Remate escalonado en lo alto del pilar
        p.box((lo - 0.08, -pd / 2 - 0.08, Z0 + H), (hi + 0.08, pd / 2 + 0.08, Z0 + H + 0.25), edge)
        # Filo de luz en la cara interior y franjas en la frontal
        xi = x0 - sx * 0.02
        p.box((min(xi, x0), -0.06, Z0 + 0.1), (max(xi, x0), 0.06, Z0 + H - 0.1), neon)
        for k in range(3 if detail else 2):
            z = Z0 + 0.8 + k * 1.6
            p.box((lo + 0.1, -pd / 2 - 0.02, z), (hi - 0.1, -pd / 2, z + 0.05), neon)
    # Dintel con su filo inferior de luz
    p.box((-W / 2 - pw - 0.08, -pd / 2, Z0 + H + 0.25), (W / 2 + pw + 0.08, pd / 2, Z0 + H + 0.75), body)
    p.box((-W / 2, -0.06, Z0 + H - 0.02), (W / 2, 0.06, Z0 + H), neon)
    p.box((-W / 2 - pw, -pd / 2 - 0.02, Z0 + H + 0.45), (W / 2 + pw, -pd / 2, Z0 + H + 0.5), neon)
    ob = p.to_object()
    ob.name = "nexo_gate"
    finish(ob)
    return ob


def island(lay: dict, detail: int = 1):
    """
    Casco de una isla flotante: tapa plana (donde va el distrito en pequeño) con su borde de luz y
    una quilla facetada que se pierde hacia abajo, con «raíces» de neón. Centrada en el origen,
    con la tapa en z = 0.
    """
    R = lay["islands"]["radius"]
    cyan = lay["colors"]["line"]
    top = mat("panel", "#1e2433")
    hull = mat("oscuro", "#0a0d16")
    rim = mat("metal", "#2a3245")
    neon = mat("neon", cyan)
    s = 48 if detail else 24
    p = Part("nexo_island")
    p.lathe((0, 0, 0), [(R, -0.6), (R, 0.0), (0.0001, 0.0)], top, segments=s, smooth=False)
    # Quilla facetada (pocos lados: se lee como roca o metal tallado)
    k = 12 if detail else 8
    p.lathe((0, 0, 0), [(R * 0.92, -0.6), (R * 0.7, -2.4), (R * 0.45, -5.0), (R * 0.2, -8.0), (0.0001, -11.0)], hull, segments=k, smooth=False)
    # Borde: un canto metálico y un anillo de luz
    p.lathe((0, 0, 0), [(R + 0.15, -0.65), (R + 0.15, 0.08), (R - 0.1, 0.08)], rim, segments=s, smooth=False)
    p.lathe((0, 0, 0), [(R + 0.17, -0.25), (R + 0.17, -0.15)], neon, segments=s, smooth=False)
    # Raíces de luz colgando de la quilla
    for j in range(6 if detail else 4):
        a = 2 * math.pi * j / (6 if detail else 4) + 0.3
        r0 = R * 0.6
        path = [(r0 * math.cos(a), r0 * math.sin(a), -3.0), (r0 * 0.55 * math.cos(a), r0 * 0.55 * math.sin(a), -7.5), (0.0, 0.0, -12.5)]
        p.tube(path, 0.07, neon, segments=5 if detail else 4)
    ob = p.to_object()
    ob.name = "nexo_island"
    finish(ob)
    return ob


def spires(lay: dict, d: dict, detail: int = 1):
    """
    Agujas cyberpunk de la isla de un distrito: torres en corona alrededor del centro (donde va el
    emblema), con franjas de neón del color del distrito y antenas. Centradas en el origen.
    """
    R = lay["islands"]["radius"]
    color = d["color"]
    body = mat("metal", "#161c2a")
    trim = mat("metal", "#262f44")
    neon = mat("neon", color)
    p = Part(f"nexo_spires_{d['id']}")
    rnd = [0.37, 0.81, 0.12, 0.66, 0.94, 0.28, 0.55, 0.73, 0.05]
    n = 9 if detail else 7
    for i in range(n):
        a = 2 * math.pi * i / n + 0.35
        r = R * (0.62 + 0.18 * rnd[i % len(rnd)])
        x, y = r * math.cos(a), r * math.sin(a)
        h = 3.5 + 8.0 * rnd[(i * 4 + 1) % len(rnd)]
        w = 1.1 + 0.9 * rnd[(i * 2 + 3) % len(rnd)]
        p.box((x - w / 2, y - w / 2, 0.0), (x + w / 2, y + w / 2, h), body)
        p.box((x - w / 2 - 0.08, y - w / 2 - 0.08, h), (x + w / 2 + 0.08, y + w / 2 + 0.08, h + 0.2), trim)
        # Franjas de luz verticales en dos caras y una horizontal arriba
        p.box((x - 0.04, y - w / 2 - 0.03, 0.4), (x + 0.04, y - w / 2, h - 0.3), neon)
        p.box((x - w / 2 - 0.03, y - 0.04, 0.4), (x - w / 2, y + 0.04, h - 0.3), neon)
        p.box((x - w / 2 - 0.02, y - w / 2 - 0.02, h - 0.55), (x + w / 2 + 0.02, y + w / 2 + 0.02, h - 0.45), neon)
        if detail and i % 2 == 0:
            p.cylinder((x, y, h + 0.2), 0.04, 1.6 + rnd[i % len(rnd)] * 1.4, trim, segments=6)
    ob = p.to_object()
    ob.name = f"nexo_spires_{d['id']}"
    finish(ob)
    return ob
