"""
Distrito Cero, la ciudad de Xen (diseño de detalle; ver «Propuestas: las 4 ciudades de xenxo»).

Recorrido: se llega por el sur y la **Torre Cero** (92 m, en el centro de la plaza) se ve desde la
puerta. Las cuatro manzanas de los ejes tienen un **pasaje** de 10 m alineado con el centro, así que
desde cualquier lado se ve la torre y se llega recto a la plaza. Las cuatro manzanas de las esquinas
son torres ancla (58–64 m). Alrededor de la plaza, sobre las calles, una **pasarela a 8 m** con
cuatro vestíbulos en los cruces y dos escaleras en diagonal (suroeste y noreste): el segundo nivel
para explorar y parte del Rastro de datos.

Código de color: cian = el camino de Xen (torre, pasarela, arcos de los pasajes); magenta = lo que
se recoge y los anuncios; el resto, oscuro.

Todo en coordenadas del chunk (X este, Z sur). Las colisiones salen de aquí (`colliders`) y las usa
city.colliders, así que modelo y colisión no se separan nunca.
"""
from __future__ import annotations

import json
import math
import os

from mathutils import Matrix

from kit import CHUNK, Part, finish, mat

C = CHUNK / 2
CX = CZ = 32.0  # centro de la plaza

PASSAGE = 10.0           # ancho de los pasajes de los ejes
WALK_Y = 8.0             # altura del suelo de la pasarela
WALK_T = 0.4             # grueso del tablero
DECK = 4.0               # ancho de la pasarela
RAIL_H = 1.1             # más que un salto (≈ 0,9 m): no se cae nadie sin querer
RAIL_T = 0.1             # medio grueso de la barandilla
STEP_RISE, STEP_RUN = 0.4, 0.5
N_STEPS = int(round(WALK_Y / STEP_RISE))
PLINTH = (6.0, 4.8)      # medio lado de los dos escalones de la peana de la torre
TOWER_H = 92.0
CYAN, MAGENTA = "#36d9ff", "#ff4fd8"

# Calles que rodean la plaza (centros 13.5 y 50.5): la pasarela va encima, los vestíbulos en los cruces.
A, B = 13.5, 50.5
LINES = (A, B)
LOBBY = 5.5  # medio lado del vestíbulo: el cruce entero (las calles miden 11 m)

# Escaleras: (x0, x1, z de arriba, sentido): +1 baja hacia el sur, −1 hacia el norte.
STAIRS = [
    (A - DECK / 2, A + DECK / 2, B + LOBBY, +1),  # vestíbulo suroeste → calle oeste del sur
    (B - DECK / 2, B + DECK / 2, A - LOBBY, -1),  # vestíbulo noreste → calle este del norte
]


def _box(p: Part, x0, z0, x1, z1, y0, y1, m):
    p.box((x0 - C, -(z1 - C), y0), (x1 - C, -(z0 - C), y1), m)


def _xz(x: float, z: float) -> tuple[float, float]:
    return (x - C, -(z - C))


# --------------------------------------------------------------------------------------
# Plan: qué lleva cada manzana
# --------------------------------------------------------------------------------------

def lots(i: int, j: int, x0: float, z0: float, x1: float, z1: float, rnd) -> list[dict]:
    """Edificios de una manzana de Distrito Cero (rectángulo ya sin acera)."""
    q = 2 if j == 2 else 0
    if i != 1 and j != 1:  # esquinas: una torre ancla que ocupa la manzana
        return [{"style": "tower", "rect": [x0, z0, x1, z1], "h": round(rnd.uniform(58, 64), 2), "q": q}]

    def h():
        return round(rnd.uniform(34, 44), 2)

    if i == 1:  # norte y sur: pasaje a lo largo de Z, centrado en X = 32
        return [
            {"style": "tower", "rect": [x0, z0, CX - PASSAGE / 2, z1], "h": h(), "q": q},
            {"style": "tower", "rect": [CX + PASSAGE / 2, z0, x1, z1], "h": h(), "q": q},
        ]
    # este y oeste: pasaje a lo largo de X, centrado en Z = 32
    return [
        {"style": "tower", "rect": [x0, z0, x1, CZ - PASSAGE / 2], "h": h(), "q": q},
        {"style": "tower", "rect": [x0, CZ + PASSAGE / 2, x1, z1], "h": h(), "q": q},
    ]


def prop_shift(x: float, z: float) -> tuple[float, float]:
    """El atrezo de las aceras no tapa la salida de un pasaje: se aparta 9 m del eje."""
    if abs(x - CX) < 0.01:
        x += 9
    if abs(z - CZ) < 0.01:
        z += 9
    return x, z


# --------------------------------------------------------------------------------------
# La pasarela: tableros, barandillas, pilares y escaleras (rectángulos x0, z0, x1, z1)
# --------------------------------------------------------------------------------------

def _decks() -> list[tuple[float, float, float, float]]:
    """Suelo de la pasarela: 4 vestíbulos y 4 tramos."""
    h = DECK / 2
    out = [(x - LOBBY, z - LOBBY, x + LOBBY, z + LOBBY) for x in LINES for z in LINES]
    out += [
        (A + LOBBY, A - h, B - LOBBY, A + h),  # tramo norte
        (A + LOBBY, B - h, B - LOBBY, B + h),  # tramo sur
        (A - h, A + LOBBY, A + h, B - LOBBY),  # tramo oeste
        (B - h, A + LOBBY, B + h, B - LOBBY),  # tramo este
    ]
    return out


def _edge(a0: float, a1: float, gaps: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Trozos de [a0, a1] que quedan al quitar los huecos."""
    out, cur = [], a0
    for g0, g1 in sorted(gaps):
        if g0 > cur:
            out.append((cur, g0))
        cur = max(cur, g1)
    if cur < a1:
        out.append((cur, a1))
    return out


def _rails() -> list[tuple[float, float, float, float]]:
    """Barandillas: el contorno de la pasarela menos las uniones con los tramos y las escaleras."""
    t, h = RAIL_T, DECK / 2
    out = []
    for x in LINES:
        for z in LINES:
            x0, z0, x1, z1 = x - LOBBY, z - LOBBY, x + LOBBY, z + LOBBY
            # Lados norte y sur (a lo largo de X): el que mira a la plaza une con el tramo oeste/este.
            for zz in (z0, z1):
                gaps = []
                if (zz == z1 and z == A) or (zz == z0 and z == B):
                    gaps.append((x - h, x + h))
                gaps += [(s[0], s[1]) for s in STAIRS if abs(s[2] - zz) < 0.01 and x0 <= s[0] and s[1] <= x1]
                out += [(a, zz - t, b, zz + t) for a, b in _edge(x0, x1, gaps)]
            # Lados oeste y este (a lo largo de Z): el que mira a la plaza une con el tramo norte/sur.
            for xx in (x0, x1):
                gaps = [(z - h, z + h)] if (xx == x1 and x == A) or (xx == x0 and x == B) else []
                out += [(xx - t, a, xx + t, b) for a, b in _edge(z0, z1, gaps)]
    for z in LINES:  # lados largos de los tramos norte y sur
        for zz in (z - h, z + h):
            out.append((A + LOBBY, zz - t, B - LOBBY, zz + t))
    for x in LINES:  # y de los tramos oeste y este
        for xx in (x - h, x + h):
            out.append((xx - t, A + LOBBY, xx + t, B - LOBBY))
    return out


def _pillars() -> list[tuple[float, float]]:
    """Pilares: cuatro por vestíbulo y dos por tramo (a un cuarto de cada punta, nunca en el eje)."""
    q1, q2 = A + (B - A) * 0.25, A + (B - A) * 0.75
    out = [(x + dx, z + dz) for x in LINES for z in LINES for dx in (-3.5, 3.5) for dz in (-3.5, 3.5)]
    out += [(q, z) for z in LINES for q in (q1, q2)]
    out += [(x, q) for x in LINES for q in (q1, q2)]
    return out


def _steps():
    """Escalones de cada escalera: (x0, x1, z0, z1, alto) desde arriba hacia abajo."""
    for (x0, x1, ztop, sense) in STAIRS:
        for k in range(N_STEPS):
            za = ztop + sense * k * STEP_RUN
            zb = za + sense * STEP_RUN
            top = max(WALK_Y - (k + 1) * STEP_RISE, 0.0) or 0.05
            yield x0, x1, min(za, zb), max(za, zb), round(top, 3)


def _stair_walls():
    """Pretiles de las escaleras, por tramos de 4 escalones: 1,1 m por encima del escalón más alto del tramo."""
    out = []
    for (x0, x1, ztop, sense) in STAIRS:
        for k0 in range(0, N_STEPS, 4):
            za = ztop + sense * k0 * STEP_RUN
            zb = ztop + sense * (k0 + 4) * STEP_RUN
            top = WALK_Y - (k0 + 1) * STEP_RISE + RAIL_H
            for xx in (x0, x1):
                out.append((xx - RAIL_T, min(za, zb), xx + RAIL_T, max(za, zb), round(top, 3)))
    return out


FOOT_H = 3.4  # alto del marco al pie de las escaleras


def _stair_feet():
    """Pie de cada escalera: (x0, x1, z, sentido)."""
    for (x0, x1, ztop, sense) in STAIRS:
        yield x0, x1, ztop + sense * N_STEPS * STEP_RUN, sense


# Peana de la escultura de Xen (el modelo va aparte: tools/models/generated/xen_statue), en la
# avenida de llegada y en el eje de la Torre Cero: primer plano de la vista desde la puerta.
STATUE = (CX, 88.0)
STATUE_BASE = (2.2, 0.3)   # medio lado y alto del escalón
STATUE_PLINTH = (1.6, 1.2)  # medio lado y alto del pedestal (la figura se apoya arriba)


def colliders() -> list[list[float]]:
    """Cajas [cx, cy, cz, hx, hy, hz] de la pasarela, las escaleras y la Torre Cero."""
    boxes: list[list[float]] = []

    def add(x0, z0, x1, z1, y0, y1):
        boxes.append([round((x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), round((z0 + z1) / 2, 3),
                      round((x1 - x0) / 2, 3), round((y1 - y0) / 2, 3), round((z1 - z0) / 2, 3)])

    for (x0, z0, x1, z1) in _decks():
        add(x0, z0, x1, z1, WALK_Y - WALK_T, WALK_Y)
    for (x0, z0, x1, z1) in _rails():
        add(x0, z0, x1, z1, WALK_Y, WALK_Y + RAIL_H)
    for (x, z) in _pillars():
        add(x - 0.45, z - 0.45, x + 0.45, z + 0.45, 0, WALK_Y - WALK_T)
    for (x0, x1, z0, z1, top) in _steps():
        add(x0, z0, x1, z1, 0, top)
    for (x0, z0, x1, z1, top) in _stair_walls():
        add(x0, z0, x1, z1, 0, top)
    for (x0, x1, z, _sense) in _stair_feet():
        for xx in (x0, x1):
            add(xx - 0.18, z - 0.18, xx + 0.18, z + 0.18, 0, FOOT_H)
    sx, sz = STATUE
    add(sx - STATUE_BASE[0], sz - STATUE_BASE[0], sx + STATUE_BASE[0], sz + STATUE_BASE[0], 0, STATUE_BASE[1])
    add(sx - STATUE_PLINTH[0], sz - STATUE_PLINTH[0], sx + STATUE_PLINTH[0], sz + STATUE_PLINTH[0], 0, STATUE_PLINTH[1] + 4.2)
    # La peana (dos escalones de 25 cm, se suben andando) y el cuerpo de la torre.
    for k, s in enumerate(PLINTH):
        add(CX - s, CZ - s, CX + s, CZ + s, 0, 0.25 * (k + 1))
    add(CX - 3.4, CZ - 3.4, CX + 3.4, CZ + 3.4, 0, TOWER_H)
    return boxes


# --------------------------------------------------------------------------------------
# Modelo
# --------------------------------------------------------------------------------------

PROFILE = [(0.5, 3.4), (12, 3.0), (30, 2.4), (55, 1.6), (75, 0.9), (88, 0.35), (TOWER_H, 0.05)]


def _tower_radius(h: float) -> float:
    for (h0, r0), (h1, r1) in zip(PROFILE, PROFILE[1:]):
        if h0 <= h <= h1:
            return r0 + (r1 - r0) * (h - h0) / (h1 - h0)
    return PROFILE[-1][1]


def torre_cero(p: Part, detail: int) -> None:
    """La Torre Cero: aguja de cristal oscuro con aros de luz, cuatro filos y dos halos arriba."""
    cx, cy = _xz(CX, CZ)
    seg = 32 if detail else 16
    glass = mat("fachada", "#1d2238")
    base = mat("metal", "#141a26")
    cyan = mat("neon", CYAN)
    white = mat("neon", "#cfe8ff")
    # Peana cuadrada en dos escalones (como la retícula de la ciudad) con su filo de luz.
    for k, s in enumerate(PLINTH):
        _box(p, CX - s, CZ - s, CX + s, CZ + s, 0.25 * k, 0.25 * (k + 1), base)
    s = PLINTH[0]
    for (x0, z0, x1, z1) in ((CX - s, CZ - s - 0.05, CX + s, CZ - s), (CX - s, CZ + s, CX + s, CZ + s + 0.05),
                             (CX - s - 0.05, CZ - s, CX - s, CZ + s), (CX + s, CZ - s, CX + s + 0.05, CZ + s)):
        _box(p, x0, z0, x1, z1, 0.12, 0.2, cyan)
    # La aguja.
    p.lathe((cx, cy, 0), [(r, h) for h, r in PROFILE], glass, segments=seg, close_top=True)
    # Aros de luz cada 10 m (más finos arriba).
    for h in range(10, 90, 10):
        r = _tower_radius(h) + 0.04
        p.lathe((cx, cy, 0), [(r, h), (r, h + (0.35 if h < 50 else 0.22))], cyan, segments=seg, smooth=False)
    # Cuatro filos verticales que siguen el estrechamiento.
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        path = [(cx + math.cos(a) * (_tower_radius(h) + 0.05), cy + math.sin(a) * (_tower_radius(h) + 0.05), h)
                for h in (0.6, 12, 30, 55, 75, 88)]
        p.tube(path, 0.07, white, segments=4)
    # Halos a 70 y 78 m: lo que se ve desde la puerta del distrito.
    n = 48 if detail else 24
    for (r, h, w, m) in ((4.6, 70.0, 0.16, cyan), (3.2, 78.0, 0.1, white)):
        ring = [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n), h) for k in range(n)]
        p.tube(ring, w, m, segments=6, closed=True)


def walkway(p: Part, detail: int) -> None:
    """La pasarela: tableros con filo de luz cian (se ve desde la calle), barandillas, pilares y escaleras."""
    deck = mat("metal", "#232a3a")
    under = mat("metal", "#141a26")
    cyan = mat("neon", CYAN)
    glass = mat("metal", "#1b2233")  # (no `ventana`: de noche se encendería como una fila de pisos)
    pole = mat("metal", "#2f3647")
    body = mat("metal", "#141a26")
    seg = 12 if detail else 8
    for (x0, z0, x1, z1) in _decks():
        _box(p, x0, z0, x1, z1, WALK_Y - WALK_T, WALK_Y, deck)
        _box(p, x0 + 0.4, z0 + 0.4, x1 - 0.4, z1 - 0.4, WALK_Y - WALK_T - 0.3, WALK_Y - WALK_T, under)
    for (x0, z0, x1, z1) in _rails():
        _box(p, x0, z0, x1, z1, WALK_Y, WALK_Y + RAIL_H - 0.1, glass)
        _box(p, x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02, WALK_Y + RAIL_H - 0.1, WALK_Y + RAIL_H, cyan)
        # El filo de luz bajo el borde: de noche dibuja el circuito en el aire.
        _box(p, x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, WALK_Y - WALK_T - 0.08, WALK_Y - WALK_T, cyan)
    for (x, z) in _pillars():
        px, py = _xz(x, z)
        p.cylinder((px, py, 0), 0.45, WALK_Y - WALK_T, pole, segments=seg)
        p.cylinder((px, py, 0.4), 0.48, 0.08, cyan, segments=seg)
    for (x0, x1, z0, z1, top) in _steps():
        _box(p, x0, z0, x1, z1, 0, top, deck)
        # El borde de cada escalón, en luz (también en el nivel ligero: la escalera tiene que leerse).
        _box(p, x0 + 0.1, z0 - 0.01, x1 - 0.1, z1 + 0.01, top - 0.04, top + 0.005, cyan)
    for (x0, z0, x1, z1, top) in _stair_walls():
        _box(p, x0, z0, x1, z1, 0, top - 0.1, glass)
        _box(p, x0 - 0.02, z0, x1 + 0.02, z1, top - 0.1, top, cyan)
    # Marco de luz al pie de cada escalera: desde la calle se ve por dónde se sube.
    for (x0, x1, z, _sense) in _stair_feet():
        for xx in (x0, x1):
            _box(p, xx - 0.18, z - 0.18, xx + 0.18, z + 0.18, 0, FOOT_H, body)
            _box(p, xx - 0.2, z - 0.2, xx + 0.2, z + 0.2, FOOT_H - 0.6, FOOT_H - 0.45, cyan)
        _box(p, x0 - 0.18, z - 0.18, x1 + 0.18, z + 0.18, FOOT_H, FOOT_H + 0.35, body)
        _box(p, x0 - 0.2, z - 0.2, x1 + 0.2, z + 0.2, FOOT_H - 0.05, FOOT_H, cyan)


def gateways(p: Part, blocks, detail: int) -> None:
    """Arcos de luz en las dos bocas de cada pasaje y anuncios verticales magenta en sus paredes."""
    body = mat("metal", "#141a26")
    cyan = mat("neon", CYAN)
    mag = mat("pantalla", MAGENTA)  # anuncios vivos (el cliente los anima)
    s = 1.5  # acera
    for (i, j, bx0, bz0, bx1, bz1) in blocks:
        if (i == 1) == (j == 1):
            continue
        if i == 1:  # pasaje norte-sur entre x = 27 y x = 37
            xa, xb = CX - PASSAGE / 2, CX + PASSAGE / 2
            for z in (bz0 + s, bz1 - s):
                _box(p, xa, z - 0.4, xb, z + 0.4, 11.0, 12.2, body)
                _box(p, xa, z - 0.42, xb, z + 0.42, 10.85, 11.0, cyan)
            # Anuncios en la torre (retranqueada 1 m sobre el zócalo de 5 m), uno a cada lado.
            if detail:
                _box(p, xa - 1.15, bz0 + 7, xa - 0.95, bz0 + 9.5, 7, 17, mag)
                _box(p, xb + 0.95, bz1 - 9.5, xb + 1.15, bz1 - 7, 9, 19, mag)
        else:  # pasaje este-oeste entre z = 27 y z = 37
            za, zb = CZ - PASSAGE / 2, CZ + PASSAGE / 2
            for x in (bx0 + s, bx1 - s):
                _box(p, x - 0.4, za, x + 0.4, zb, 11.0, 12.2, body)
                _box(p, x - 0.42, za, x + 0.42, zb, 10.85, 11.0, cyan)
            if detail:
                _box(p, bx0 + 7, za - 1.15, bx0 + 9.5, za - 0.95, 7, 17, mag)
                _box(p, bx1 - 9.5, zb + 0.95, bx1 - 7, zb + 1.15, 9, 19, mag)


ACTIVITIES = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "realtime", "src", "district-activities.json")


def billboard_slots() -> list[dict]:
    """Anuncios de fachada: la misma lista con la que el Worker pone las portadas (syncBillboards)."""
    with open(ACTIVITIES, encoding="utf-8") as f:
        return json.load(f)["cero"].get("billboards", [])


def billboards(p: Part, detail: int) -> None:
    """Marcos de los anuncios de fachada: placa oscura, pantalla viva de fondo (se ve sin portada) y filo de luz."""
    body = mat("metal", "#141a26")
    screen = mat("pantalla", MAGENTA)
    cyan = mat("neon", CYAN)
    for k, sl in enumerate(billboard_slots()):
        x, y, z = sl["p"]
        w, h = sl["size"]
        q = Part("billboard")
        # En local: frente hacia −Y de Blender (= hacia donde mira el anuncio); la fachada queda a +0,25.
        q.box((-w / 2 - 0.45, -0.15, y - h / 2 - 0.45), (w / 2 + 0.45, 0.25, y + h / 2 + 0.45), body)
        q.box((-w / 2, -0.18, y - h / 2), (w / 2, -0.15, y + h / 2), screen if k % 2 == 0 else mat("pantalla", CYAN))
        e = 0.12
        for (x0, z0, x1, z1) in ((-w / 2 - 0.3, y + h / 2, w / 2 + 0.3, y + h / 2 + e), (-w / 2 - 0.3, y - h / 2 - e, w / 2 + 0.3, y - h / 2),
                                 (-w / 2 - e, y - h / 2, -w / 2, y + h / 2), (w / 2, y - h / 2, w / 2 + e, y + h / 2)):
            q.box((x0, -0.34, z0), (x1, -0.15, z1), cyan)
        # Dos ménsulas hasta la fachada, debajo.
        for bx in (-w / 3, w / 3):
            q.box((bx - 0.1, -0.15, y - h / 2 - 1.2), (bx + 0.1, 0.25, y - h / 2 - 0.45), body)
        cx, cy = _xz(x, z)
        p.merge(q, Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(math.radians(sl["yaw"]), 4, "Z"))
        q.bm.free()


def statue_plinth(p: Part, detail: int) -> None:
    """Pedestal de la escultura de Xen: escalón, bloque oscuro con filos de luz y un aro magenta."""
    sx, sz = STATUE
    base = mat("metal", "#141a26")
    stone = mat("piedra", "#2a2f3c")
    cyan = mat("neon", CYAN)
    mag = mat("neon", MAGENTA)
    b, h = STATUE_BASE
    _box(p, sx - b, sz - b, sx + b, sz + b, 0, h, base)
    w, ph = STATUE_PLINTH
    _box(p, sx - w, sz - w, sx + w, sz + w, h, ph, stone)
    # Filo de luz arriba y abajo del pedestal y en las aristas verticales.
    for y0, y1 in ((h, h + 0.05), (ph - 0.06, ph)):
        _box(p, sx - w - 0.02, sz - w - 0.02, sx + w + 0.02, sz + w + 0.02, y0, y1, cyan)
    for dx in (-w, w):
        for dz in (-w, w):
            _box(p, sx + dx - 0.04, sz + dz - 0.04, sx + dx + 0.04, sz + dz + 0.04, h, ph, cyan)
    cx, cy = _xz(sx, sz)
    n = 40 if detail else 20
    ring = [(cx + (b + 0.25) * math.cos(2 * math.pi * k / n), cy + (b + 0.25) * math.sin(2 * math.pi * k / n), 0.04) for k in range(n)]
    p.tube(ring, 0.05, mag, segments=4, closed=True)


def build(p: Part, blocks, detail: int) -> None:
    statue_plinth(p, detail)
    torre_cero(p, detail)
    walkway(p, detail)
    gateways(p, blocks, detail)
    billboards(p, detail)


def fragment(detail: int) -> Part:
    """Fragmento del Rastro de datos: cristal magenta de doble punta con un aro cian (la entidad lo pone a 1,2 m)."""
    p = Part("cero_fragment")
    p.lathe((0, 0, 0), [(0.001, -0.45), (0.22, 0.0), (0.001, 0.55)], mat("neon", MAGENTA), segments=6, smooth=False)
    n = 24 if detail else 12
    ring = [(0.42 * math.cos(2 * math.pi * k / n), 0.42 * math.sin(2 * math.pi * k / n), 0.0) for k in range(n)]
    p.tube(ring, 0.025, mat("neon", CYAN), segments=4, closed=True)
    return p


def fragment_object(detail: int):
    ob = fragment(detail).to_object()
    ob.name = "cero_fragment"
    finish(ob)
    return ob
