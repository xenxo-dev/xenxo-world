"""
Arcade, la ciudad-salón recreativo (diseño de detalle; ver «Propuestas: las 4 ciudades de xenxo»).

Recorrido: las torres son **máquinas recreativas gigantes** que miran a la plaza (pantalla viva,
panel de mandos con su palanca y botones, marquesina y ranuras de monedas a pie de calle). En la
plaza, la **palanca gigante** con un corro de máquinas-portal a su alrededor (los juegos del
distrito: tools/models/generated/arcade_cabinet) y, al norte, la **pantalla del marcador** del
Circuito Neón. El circuito sale de la plaza y da la vuelta por el primer anillo de calles, con
placas de impulso en las rectas (district-activities.json).

Código de color: azul del distrito y magenta en las pantallas; amarillo para lo que se coge
(monedas) y lo que se pulsa.

Todo en coordenadas del chunk (X este, Z sur). Las colisiones salen de aquí (`colliders`).
"""
from __future__ import annotations

import math

from kit import CHUNK, Part, finish, mat

C = CHUNK / 2
CX = CZ = 32.0
BLUE, MAGENTA, YELLOW, RED = "#4fa3ff", "#ff4fd8", "#ffd54f", "#ff4f6d"
ALLEY = 2.0

# Palanca gigante del centro de la plaza.
STICK_BASE = (2.6, 1.0)       # radio y alto de la base
STICK = (0.3, 3.6, 1.0)       # radio del palo, alto hasta la bola, radio de la bola (bajo: no tapa el marcador)
# Pantalla del marcador (el panel lo dibuja el cliente: scoreboard@1), al norte de la plaza.
BOARD = {"x0": 25.6, "x1": 38.4, "z": 21.0, "y0": 7.2, "y1": 14.8}
# Callejón del eje (manzanas del norte y del sur): una galería ancha que deja ver la plaza desde la puerta.
AXIS_GALLERY = 6.0


def _box(p: Part, x0, z0, x1, z1, y0, y1, m):
    p.box((x0 - C, -(z1 - C), y0), (x1 - C, -(z0 - C), y1), m)


def _xz(x: float, z: float) -> tuple[float, float]:
    return (x - C, -(z - C))


def front_of(i: int, j: int) -> str:
    """Hacia dónde mira cada manzana (la cara de máquina, hacia la plaza)."""
    if j == 0:
        return "s"
    if j == 2:
        return "n"
    return "e" if i == 0 else "w"


def lots(i: int, j: int, x0: float, z0: float, x1: float, z1: float, rnd) -> list[dict]:
    """Dos máquinas por manzana, una al lado de la otra según hacia dónde miren."""
    f = front_of(i, j)
    q = 2 if j == 2 else 0
    out = []
    if f in ("e", "w"):
        mz = (z0 + z1) / 2
        rects = [[x0, z0, x1, mz - ALLEY / 2], [x0, mz + ALLEY / 2, x1, z1]]
    else:
        mx = (x0 + x1) / 2
        gap = AXIS_GALLERY if i == 1 else ALLEY
        rects = [[x0, z0, mx - gap / 2, z1], [mx + gap / 2, z0, x1, z1]]
    for r in rects:
        out.append({"style": "cabinet", "rect": r, "h": round(rnd.uniform(30, 46), 2), "q": q, "front": f})
    return out


# --------------------------------------------------------------------------------------
# Cara de máquina: cajas en coordenadas de la fachada (u a lo ancho, w hacia fuera)
# --------------------------------------------------------------------------------------

def _face(p: Part, b: dict, u0, u1, w0, w1, y0, y1, m):
    x0, z0, x1, z1 = b["rect"]
    f = b["front"]
    if f == "s":
        _box(p, x0 + u0, z1 + w0, x0 + u1, z1 + w1, y0, y1, m)
    elif f == "n":
        _box(p, x0 + u0, z0 - w1, x0 + u1, z0 - w0, y0, y1, m)
    elif f == "e":
        _box(p, x1 + w0, z0 + u0, x1 + w1, z0 + u1, y0, y1, m)
    else:
        _box(p, x0 - w1, z0 + u0, x0 - w0, z0 + u1, y0, y1, m)


def _face_point(b: dict, u: float, w: float) -> tuple[float, float]:
    x0, z0, x1, z1 = b["rect"]
    f = b["front"]
    if f == "s":
        return x0 + u, z1 + w
    if f == "n":
        return x0 + u, z0 - w
    if f == "e":
        return x1 + w, z0 + u
    return x0 - w, z0 + u


def cabinet_tower(p: Part, b: dict, rnd, detail: int) -> None:
    """Torre-máquina: cuerpo con ventanas, y en la cara de la plaza pantalla, mandos y marquesina."""
    x0, z0, x1, z1 = b["rect"]
    h = b["h"]
    width = (x1 - x0) if b["front"] in ("s", "n") else (z1 - z0)
    body = mat("fachada", rnd.choice(["#2a3050", "#252b45", "#30365a"]))
    dark = mat("metal", "#151a28")
    blue = mat("neon", BLUE)
    screen_tint = rnd.choice([BLUE, MAGENTA, "#36d9ff"])
    marquee_tint = MAGENTA if screen_tint != MAGENTA else BLUE
    # Cuerpo y remate.
    _box(p, x0, z0, x1, z1, 0, h, body)
    _box(p, x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, h - 0.5, h, blue)
    # Pie: mueble oscuro con dos ranuras de monedas y la puerta de luz.
    _face(p, b, 0, width, -0.05, 0.25, 0, 6, dark)
    for k, u in enumerate((width * 0.3, width * 0.7)):
        _face(p, b, u - 0.35, u + 0.35, 0.25, 0.32, 3.2, 4.4, mat("neon", YELLOW if k == 0 else RED))
    _face(p, b, width / 2 - 1.4, width / 2 + 1.4, 0.25, 0.3, 0, 2.6, mat("pantalla", BLUE))
    # Panel de mandos: una repisa que sale 2,4 m, con la palanca y cuatro botones.
    yd = round(h * 0.3, 2)
    _face(p, b, 0.4, width - 0.4, -0.05, 2.4, yd - 1.2, yd, dark)
    _face(p, b, 0.35, width - 0.35, 2.4, 2.48, yd - 0.25, yd - 0.05, blue)
    sx, sz = _face_point(b, width * 0.28, 1.2)
    cx, cy = _xz(sx, sz)
    p.cylinder((cx, cy, yd), 0.12, 1.6, mat("metal", "#c8cfdc"), segments=10 if detail else 6)
    p.sphere((cx, cy, yd + 1.75), 0.38, mat("neon", RED), subdiv=2 if detail else 1)
    for k, c in enumerate((YELLOW, "#6dff8a", MAGENTA, "#36d9ff")):
        bx, bz = _face_point(b, width * (0.52 + 0.1 * k), 1.0 + 0.4 * (k % 2))
        bxx, byy = _xz(bx, bz)
        p.cylinder((bxx, byy, yd), 0.32, 0.14, mat("neon", c), segments=12 if detail else 8)
    # Pantalla: hundida en su marco, viva (xenxo:pantalla).
    ys0, ys1 = round(h * 0.38, 2), round(h * 0.78, 2)
    _face(p, b, 0.6, width - 0.6, -0.05, 0.45, ys0 - 0.5, ys1 + 0.5, dark)
    _face(p, b, 1.0, width - 1.0, 0.45, 0.5, ys0, ys1, mat("pantalla", screen_tint))
    # Marquesina arriba, saliente.
    _face(p, b, 0.2, width - 0.2, -0.05, 1.0, h * 0.83, h * 0.95, dark)
    _face(p, b, 0.4, width - 0.4, 1.0, 1.05, h * 0.84, h * 0.94, mat("pantalla", marquee_tint))
    # Espalda: una valla viva vertical (lo que se ve al llegar y desde el anillo de calles).
    depth = (z1 - z0) if b["front"] in ("s", "n") else (x1 - x0)
    _face(p, b, width * 0.2, width * 0.8, -depth - 0.4, -depth + 0.05, h * 0.42, h * 0.86, dark)
    _face(p, b, width * 0.24, width * 0.76, -depth - 0.45, -depth - 0.4, h * 0.44, h * 0.84, mat("pantalla", marquee_tint))
    # Filos de luz en las dos aristas de la cara.
    for u in (0.0, width):
        _face(p, b, u - 0.12, u + 0.12, 0.0, 0.2, 6, h - 0.5, blue)


# --------------------------------------------------------------------------------------
# Plaza: palanca gigante y pantalla del marcador
# --------------------------------------------------------------------------------------

def plaza(p: Part, detail: int) -> None:
    cx, cy = _xz(CX, CZ)
    seg = 32 if detail else 16
    r, hb = STICK_BASE
    p.cylinder((cx, cy, 0), r, hb, mat("metal", "#1b1f2e"), segments=seg)
    p.lathe((cx, cy, 0), [(r + 0.03, hb - 0.2), (r + 0.03, hb - 0.05)], mat("neon", BLUE), segments=seg, smooth=False)
    p.cylinder((cx, cy, hb), r * 0.55, 0.3, mat("metal", "#2c3348"), segments=seg)
    rs, hs, rb = STICK
    p.cylinder((cx, cy, hb + 0.3), rs, hs - hb, mat("metal", "#c8cfdc"), segments=16 if detail else 8)
    p.sphere((cx, cy, hs + rb * 0.8), rb, mat("neon", RED), subdiv=3 if detail else 2)
    # Cuatro botones gigantes alrededor de la base (se pisan: son losas de luz).
    for k, c in enumerate((YELLOW, "#6dff8a", MAGENTA, "#36d9ff")):
        a = math.pi / 4 + k * math.pi / 2
        bx, by = cx + math.cos(a) * (r + 1.6), cy + math.sin(a) * (r + 1.6)
        p.cylinder((bx, by, 0), 0.75, 0.12, mat("neon", c), segments=24 if detail else 12)
    # Pantalla del marcador: dos postes, marco y marquesina viva (el panel lo pone el cliente).
    B = BOARD
    dark = mat("metal", "#151a28")
    for x in (B["x0"], B["x1"]):
        _box(p, x - 0.35, B["z"] - 0.35, x + 0.35, B["z"] + 0.35, 0, B["y1"] + 1.4, dark)
        _box(p, x - 0.37, B["z"] - 0.37, x + 0.37, B["z"] + 0.37, 0.3, 0.45, mat("neon", BLUE))
    _box(p, B["x0"], B["z"] - 0.3, B["x1"], B["z"] - 0.1, B["y0"] - 0.3, B["y1"] + 0.3, dark)
    _box(p, B["x0"] - 0.4, B["z"] - 0.35, B["x1"] + 0.4, B["z"] + 0.35, B["y1"] + 0.3, B["y1"] + 1.4, dark)
    _box(p, B["x0"] - 0.2, B["z"] + 0.35, B["x1"] + 0.2, B["z"] + 0.4, B["y1"] + 0.45, B["y1"] + 1.25, mat("pantalla", MAGENTA))


def colliders() -> list[list[float]]:
    boxes: list[list[float]] = []

    def add(x0, z0, x1, z1, y0, y1):
        boxes.append([round((x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), round((z0 + z1) / 2, 3),
                      round((x1 - x0) / 2, 3), round((y1 - y0) / 2, 3), round((z1 - z0) / 2, 3)])

    r, hb = STICK_BASE
    a = r * 0.88
    add(CX - a, CZ - a, CX + a, CZ + a, 0, hb)
    rs, hs, rb = STICK
    add(CX - rs, CZ - rs, CX + rs, CZ + rs, hb, hs)
    B = BOARD
    for x in (B["x0"], B["x1"]):
        add(x - 0.35, B["z"] - 0.35, x + 0.35, B["z"] + 0.35, 0, B["y1"] + 1.4)
    return boxes


def build(p: Part, buildings: list[dict], rnd, detail: int) -> None:
    for b in buildings:
        cabinet_tower(p, b, rnd, detail)
    plaza(p, detail)


def coin(detail: int) -> Part:
    """Moneda del Arcade: disco dorado de canto con su anillo de luz (gira y flota en el cliente)."""
    p = Part("arcade_coin")
    seg = 24 if detail else 12
    p.cylinder((0, -0.05, 0), 0.42, 0.1, mat("metal", "#ffc94f"), segments=seg, axis="y")
    p.cylinder((0, -0.06, 0), 0.3, 0.12, mat("neon", "#ffe28a"), segments=seg, axis="y")
    return p


def coin_object(detail: int):
    ob = coin(detail).to_object()
    ob.name = "arcade_coin"
    finish(ob)
    return ob
