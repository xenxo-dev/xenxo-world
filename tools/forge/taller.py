"""
Taller, el distrito de quien crea (diseño de detalle; ver «Propuestas: las 4 ciudades de xenxo»).

Entre la plaza y la puerta, la manzana del sur es la **zona de pruebas**: una explanada de rejilla
con barrera de seguridad, donde cualquier cuenta construye con piezas básicas (chunk-room.ts,
`sandbox`). Sobre ella, una **grúa torre** que se ve desde la llegada. En la plaza, el engranaje y
cuatro **paneles de «cómo se hace»** (sus textos van como datos: district-activities.json).

Todo en coordenadas del chunk (X este, Z sur). Las colisiones salen de aquí (`colliders`).
"""
from __future__ import annotations

import math

from mathutils import Matrix

from kit import CHUNK, Part, mat

C = CHUNK / 2
ORANGE, YELLOW = "#ff8a2c", "#ffd54f"
# La zona de pruebas: la manzana (1, 2), sin acera.
ZONE = (20.5, 57.5, 43.5, 80.5)
GAP = 5.0  # entradas en los lados norte (hacia la plaza) y sur (hacia la puerta)
# Grúa: mástil en la esquina sureste de la zona, pluma hacia el oeste sobre la explanada.
CRANE = {"x": 41.5, "z": 78.5, "h": 34.0, "jib": 30.0, "counter": 9.0}
# Paneles de «cómo se hace»: en las cuatro esquinas de la plaza, mirando hacia dentro.
PANELS = [(22.5, 22.5, 45), (41.5, 22.5, -45), (22.5, 41.5, 135), (41.5, 41.5, -135)]
PANEL_W, PANEL_H, PANEL_Y = 3.6, 2.4, 1.0
# Pantalla de «agentes construyendo» en el borde este de la plaza, mirando al oeste (el marcador
# `builds` de district-activities.json va delante; desde la llegada no la tapa el engranaje).
SCREEN = {"x": 43.6, "z": 32.0, "yaw": -90, "w": 6.4, "h": 3.8, "y": 3.4}


def _box(p: Part, x0, z0, x1, z1, y0, y1, m):
    p.box((x0 - C, -(z1 - C), y0), (x1 - C, -(z0 - C), y1), m)


def _xz(x: float, z: float) -> tuple[float, float]:
    return (x - C, -(z - C))


def _barrier(p: Part, x0, z0, x1, z1, detail: int):
    """Tramo de barrera: postes y dos largueros con franjas naranjas y negras."""
    post = mat("metal", "#2c3348")
    stripe_a, stripe_b = mat("metal", ORANGE), mat("metal", "#1b1f2e")
    along_x = abs(x1 - x0) >= abs(z1 - z0)
    length = abs(x1 - x0) if along_x else abs(z1 - z0)
    n = max(1, int(length // 1.0))
    for k in range(n):
        a = k * length / n
        b = (k + 1) * length / n
        m = stripe_a if k % 2 == 0 else stripe_b
        if along_x:
            _box(p, x0 + a, z0 - 0.06, x0 + b, z0 + 0.06, 0.75, 0.95, m)
        else:
            _box(p, x0 - 0.06, z0 + a, x0 + 0.06, z0 + b, 0.75, 0.95, m)
    for k in range(int(length // 3) + 1):
        a = min(length, k * 3.0)
        px, pz = (x0 + a, z0) if along_x else (x0, z0 + a)
        _box(p, px - 0.08, pz - 0.08, px + 0.08, pz + 0.08, 0, 1.05, post)


def zone(p: Part, detail: int) -> None:
    x0, z0, x1, z1 = ZONE
    floor = mat("scifi", "#5f6b7d")
    _box(p, x0, z0, x1, z1, 0, 0.06, floor)
    # Líneas amarillas del suelo cada 4 m (la retícula para construir).
    line = mat("neon", YELLOW)
    k = x0 + 4
    while k < x1 - 0.5:
        _box(p, k - 0.03, z0 + 0.6, k + 0.03, z1 - 0.6, 0.06, 0.075, line)
        k += 4
    k = z0 + 4
    while k < z1 - 0.5:
        _box(p, x0 + 0.6, k - 0.03, x1 - 0.6, k + 0.03, 0.06, 0.075, line)
        k += 4
    # Barrera alrededor, con entrada al norte y al sur (en el eje).
    mx = (x0 + x1) / 2
    for (a0, a1) in ((x0, mx - GAP / 2), (mx + GAP / 2, x1)):
        _barrier(p, a0, z0, a1, z0, detail)
        _barrier(p, a0, z1, a1, z1, detail)
    _barrier(p, x0, z0, x0, z1, detail)
    _barrier(p, x1, z0, x1, z1, detail)
    # Pórtico de la entrada norte con su luz.
    dark = mat("metal", "#2c3348")
    for x in (mx - GAP / 2, mx + GAP / 2):
        _box(p, x - 0.15, z0 - 0.15, x + 0.15, z0 + 0.15, 0, 3.6, dark)
    _box(p, mx - GAP / 2 - 0.2, z0 - 0.2, mx + GAP / 2 + 0.2, z0 + 0.2, 3.6, 4.0, dark)
    _box(p, mx - GAP / 2, z0 + 0.2, mx + GAP / 2, z0 + 0.24, 3.65, 3.95, mat("neon", ORANGE))


def crane(p: Part, detail: int) -> None:
    """Grúa torre: mástil de celosía, pluma, contrapluma con contrapeso y luz roja en lo alto."""
    c = CRANE
    cx, cy = _xz(c["x"], c["z"])
    yellow = mat("metal", "#f2b632")
    dark = mat("metal", "#2c3348")
    w = 0.9
    # Mástil: cuatro montantes y riostras cada 3 m.
    for dx in (-w, w):
        for dy in (-w, w):
            p.box((cx + dx - 0.1, cy + dy - 0.1, 0), (cx + dx + 0.1, cy + dy + 0.1, c["h"]), yellow)
    y = 0.0
    while y < c["h"] - 1:
        for (a, b) in (((-w, -w), (w, -w)), ((w, -w), (w, w)), ((w, w), (-w, w)), ((-w, w), (-w, -w))):
            p.tube([(cx + a[0], cy + a[1], y), (cx + b[0], cy + b[1], y + 3)], 0.05, yellow, segments=4)
        y += 3
    p.box((cx - 1.4, cy - 1.4, 0), (cx + 1.4, cy + 1.4, 0.6), dark)
    # Cabina y pluma hacia el oeste (−X), contrapluma hacia el este.
    h = c["h"]
    p.box((cx - 1.2, cy - 1.2, h), (cx + 1.2, cy + 1.2, h + 2.0), yellow)
    p.box((cx + 1.0, cy - 1.0, h + 0.6), (cx + 1.6, cy + 1.0, h + 1.8), mat("ventana", "#cfe8ff"))
    p.box((cx - c["jib"], cy - 0.5, h + 2.0), (cx, cy + 0.5, h + 2.9), yellow)
    p.box((cx, cy - 0.5, h + 2.0), (cx + c["counter"], cy + 0.5, h + 2.9), yellow)
    p.box((cx + c["counter"] - 3, cy - 0.9, h + 0.3), (cx + c["counter"], cy + 0.9, h + 2.0), dark)
    p.box((cx - 0.4, cy - 0.4, h + 2.9), (cx + 0.4, cy + 0.4, h + 7.5), yellow)
    for end in (-c["jib"], c["counter"]):
        p.tube([(cx, cy, h + 7.5), (cx + end, cy, h + 2.9)], 0.05, dark, segments=4)
    p.sphere((cx, cy, h + 7.7), 0.25, mat("neon", "#ff3b3b"), subdiv=1)
    # Carro y gancho a media pluma, colgando sobre la explanada.
    tx = cx - c["jib"] * 0.55
    p.box((tx - 0.6, cy - 0.6, h + 1.6), (tx + 0.6, cy + 0.6, h + 2.0), dark)
    p.tube([(tx, cy, h + 1.6), (tx, cy, 12.0)], 0.03, dark, segments=4)
    p.box((tx - 0.35, cy - 0.35, 11.2), (tx + 0.35, cy + 0.35, 12.0), mat("metal", ORANGE))


def panels(p: Part, detail: int) -> None:
    """Paneles de «cómo se hace»: atril oscuro con marco naranja (el texto lo pone el sembrado)."""
    dark = mat("metal", "#1b1f2e")
    orange = mat("neon", ORANGE)
    w, h, y = PANEL_W, PANEL_H, PANEL_Y
    for (x, z, deg) in PANELS:
        q = Part("panel")
        # En local: frente hacia −Y de Blender (= +Z del mundo, el lado que mira a la plaza).
        q.box((-w / 2, -0.06, y), (w / 2, 0.06, y + h), dark)
        q.box((-w / 2 - 0.08, -0.1, y + h), (w / 2 + 0.08, 0.1, y + h + 0.12), orange)
        q.box((-w / 2 - 0.08, -0.1, y - 0.12), (w / 2 + 0.08, 0.1, y), orange)
        q.box((-0.12, -0.12, 0), (0.12, 0.12, y), dark)
        cx, cy = _xz(x, z)
        p.merge(q, Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(math.radians(deg), 4, "Z"))
        q.bm.free()


def agents_screen(p: Part, detail: int) -> None:
    """Monolito con la pantalla de lo que construyen los agentes: marco oscuro, filo naranja y piloto rojo."""
    s = SCREEN
    w, h, y = s["w"], s["h"], s["y"]
    dark = mat("metal", "#1b1f2e")
    orange = mat("neon", ORANGE)
    q = Part("agents_screen")
    # En local: frente hacia −Y de Blender (hacia donde mira); el marcador se pinta en el plano y = 0.
    q.box((-w / 2 - 0.4, 0.05, 0), (w / 2 + 0.4, 0.45, y + h / 2 + 0.5), dark)
    q.box((-w / 2 - 0.6, -0.1, 0), (w / 2 + 0.6, 0.6, 0.3), dark)
    e = 0.1
    for (x0, x1, z0, z1) in ((-w / 2 - 0.2, w / 2 + 0.2, y + h / 2 + 0.05, y + h / 2 + 0.05 + e), (-w / 2 - 0.2, w / 2 + 0.2, y - h / 2 - 0.05 - e, y - h / 2 - 0.05),
                             (-w / 2 - 0.2 - e, -w / 2 - 0.2, y - h / 2 - 0.15, y + h / 2 + 0.15), (w / 2 + 0.2, w / 2 + 0.2 + e, y - h / 2 - 0.15, y + h / 2 + 0.15)):
        q.box((x0, -0.02, z0), (x1, 0.05, z1), orange)
    # Piloto «en directo» y antena encima.
    q.box((w / 2 - 0.5, -0.03, y + h / 2 + 0.6), (w / 2 - 0.1, 0.3, y + h / 2 + 0.9), mat("neon", "#ff3b3b"))
    q.box((-0.05, 0.2, y + h / 2 + 0.5), (0.05, 0.3, y + h / 2 + 2.2), dark)
    q.sphere((0, 0.25, y + h / 2 + 2.3), 0.12, mat("neon", ORANGE), subdiv=1)
    cx, cy = _xz(s["x"], s["z"])
    p.merge(q, Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(math.radians(s["yaw"]), 4, "Z"))
    q.bm.free()


def colliders() -> list[list[float]]:
    boxes: list[list[float]] = []

    def add(x0, z0, x1, z1, y0, y1):
        boxes.append([round((x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), round((z0 + z1) / 2, 3),
                      round((x1 - x0) / 2, 3), round((y1 - y0) / 2, 3), round((z1 - z0) / 2, 3)])

    x0, z0, x1, z1 = ZONE
    mx = (x0 + x1) / 2
    for (a0, a1) in ((x0, mx - GAP / 2), (mx + GAP / 2, x1)):
        add(a0, z0 - 0.1, a1, z0 + 0.1, 0, 1.05)
        add(a0, z1 - 0.1, a1, z1 + 0.1, 0, 1.05)
    add(x0 - 0.1, z0, x0 + 0.1, z1, 0, 1.05)
    add(x1 - 0.1, z0, x1 + 0.1, z1, 0, 1.05)
    c = CRANE
    add(c["x"] - 1.4, c["z"] - 1.4, c["x"] + 1.4, c["z"] + 1.4, 0, c["h"])
    for (x, z, _deg) in PANELS:
        add(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 0, PANEL_Y + PANEL_H)
    s = SCREEN  # mirando al oeste: el cuerpo va detrás, hacia el este
    add(s["x"] - 0.1, s["z"] - s["w"] / 2 - 0.6, s["x"] + 0.6, s["z"] + s["w"] / 2 + 0.6, 0, s["y"] + s["h"] / 2 + 0.9)
    return boxes


def build(p: Part, detail: int) -> None:
    zone(p, detail)
    crane(p, detail)
    panels(p, detail)
    agents_screen(p, detail)
