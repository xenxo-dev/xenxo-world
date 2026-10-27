"""
Interiores: algunos edificios de cada ciudad se pueden visitar.

La planta baja de esos edificios es una sala: muros con una puerta hacia la calle, suelo, techo con
paneles de luz y mobiliario según el distrito (un nodo de datos en Cero, una sala recreativa en
Arcade, un café de píxeles en Píxel y una nave en el Taller). Lo de arriba sigue siendo macizo.

Modelo y colisiones salen de aquí (`room` dibuja y devuelve las cajas), así que nunca se separan.
El mobiliario usa su propio azar, sembrado con el rectángulo del edificio: igual en el modelo y en
las colisiones. Todo en coordenadas del chunk (X este, Z sur).
"""
from __future__ import annotations

import random

from kit import CHUNK, Part, mat

C = CHUNK / 2
T = 0.3          # grosor de los muros
FLOOR = 0.12     # suelo de la sala (por encima de las capas de la calle)
CEIL = 0.3       # grosor del techo

# Edificios abiertos por distrito: (manzana i, j) y cuál de sus edificios (el primero).
OPEN_BLOCKS = {"cero": [(0, 2), (2, 0)], "arcade": [(0, 2), (2, 0)], "pixel": [(0, 2), (2, 0)], "taller": [(0, 2), (2, 0)]}

THEME = {
    "cero": {"name": "nodo", "wall": ("metal", "#2e3548"), "floor": ("scifi", "#3a4252"), "light": "#36d9ff", "accent": "#ff4fd8"},
    "arcade": {"name": "sala", "wall": ("metal", "#151a28"), "floor": ("panel", "#232a3a"), "light": "#4fa3ff", "accent": "#ffd54f"},
    "pixel": {"name": "cafe", "wall": ("azulejo", "#2a2340"), "floor": ("azulejo", "#3b3355"), "light": "#ffd54f", "accent": "#ff4fd8"},
    "taller": {"name": "nave", "wall": ("panel", "#59616e"), "floor": ("scifi", "#5f6b7d"), "light": "#cfe8ff", "accent": "#ff8a2c"},
}


def _box(p: Part, x0, z0, x1, z1, y0, y1, m, skip=()):
    p.box((x0 - C, -(z1 - C), y0), (x1 - C, -(z0 - C), y1), m, skip=skip)


def spec(b: dict, theme: str) -> dict:
    """Dónde va la puerta y cuánto mide la sala de un edificio abierto (lo usan el modelo y las colisiones)."""
    x0, z0, x1, z1 = b["rect"]
    style = b["style"]
    if style == "cabinet":
        side = b["front"]
        y1, dw, dh = 6.0, 2.8, 2.8
    else:
        side = "s" if b["q"] in (0, 1) else "n"
        if style == "hall":
            y1, dw, dh = b["h"] - 2, 4.4, 4.2
        elif style == "voxel":
            y1, dw, dh = round(b["h"] / 3, 3), 2.4, 3.0
        else:  # torre de Cero: el zócalo de 5 m es el vestíbulo
            y1, dw, dh = 5.0, 2.6, 3.2
    along = side in ("s", "n")
    lo, hi = (x0, x1) if along else (z0, z1)
    c = (lo + hi) / 2
    # En Cero el atrezo de la acera está frente al centro de la manzana: la puerta, a un lado.
    if theme == "cero":
        c += 6
    c = max(lo + T + dw / 2 + 0.6, min(hi - T - dw / 2 - 0.6, c))
    return {"side": side, "y1": y1, "door_c": round(c, 3), "door_w": dw, "door_h": dh}


def room(p: Part | None, b: dict, theme: str, detail: int = 1) -> list[tuple]:
    """Dibuja la sala (si `p`) y devuelve sus cajas sólidas (x0, z0, x1, z1, y0, y1)."""
    s = spec(b, theme)
    th = THEME[theme]
    x0, z0, x1, z1 = b["rect"]
    y1, side, dc, dw, dh = s["y1"], s["side"], s["door_c"], s["door_w"], s["door_h"]
    boxes: list[tuple] = []
    wall = mat(*th["wall"]) if p else None
    light = mat("neon", th["light"]) if p else None

    def solid(a0, b0, a1, b1, c0, c1, m=None, skip=(), collide=True):
        if p is not None and m is not None:
            _box(p, a0, b0, a1, b1, c0, c1, m, skip)
        if collide:
            boxes.append((a0, b0, a1, b1, c0, c1))

    # Muros (el de la puerta en dos tramos y un dintel).
    walls = {
        "n": (x0, z0, x1, z0 + T),
        "s": (x0, z1 - T, x1, z1),
        "w": (x0, z0 + T, x0 + T, z1 - T),
        "e": (x1 - T, z0 + T, x1, z1 - T),
    }
    for k, (a0, b0, a1, b1) in walls.items():
        if k != side:
            solid(a0, b0, a1, b1, 0, y1, wall)
            continue
        if k in ("n", "s"):
            solid(a0, b0, dc - dw / 2, b1, 0, y1, wall)
            solid(dc + dw / 2, b0, a1, b1, 0, y1, wall)
            solid(dc - dw / 2, b0, dc + dw / 2, b1, dh, y1, wall)
        else:
            solid(a0, b0, a1, dc - dw / 2, 0, y1, wall)
            solid(a0, dc + dw / 2, a1, b1, 0, y1, wall)
            solid(a0, dc - dw / 2, a1, dc + dw / 2, dh, y1, wall)
    ix0, iz0, ix1, iz1 = x0 + T, z0 + T, x1 - T, z1 - T
    # Suelo y techo.
    solid(ix0, iz0, ix1, iz1, 0, FLOOR, mat(*th["floor"]) if p else None, skip=("-z",))
    solid(ix0, iz0, ix1, iz1, y1 - CEIL, y1, mat("metal", "#14161f") if p else None)
    if p is not None:
        # Paneles de luz en el techo (solo los lados y la cara de abajo: la de arriba toca el techo).
        nx = max(1, int((ix1 - ix0) // 4))
        nz = max(1, int((iz1 - iz0) // 4))
        for i in range(nx):
            for j in range(nz):
                cx = ix0 + (i + 0.5) * (ix1 - ix0) / nx
                cz = iz0 + (j + 0.5) * (iz1 - iz0) / nz
                _box(p, cx - 0.6, cz - 0.12, cx + 0.6, cz + 0.12, y1 - CEIL - 0.05, y1 - CEIL, light, skip=("+z",))
        # Marco de luz de la puerta, por fuera.
        acc = mat("neon", th["accent"])
        e = 0.12
        if side in ("n", "s"):
            zf = z1 if side == "s" else z0 - 0.06
            _box(p, dc - dw / 2 - e, zf, dc - dw / 2, zf + 0.06, 0, dh + e, acc)
            _box(p, dc + dw / 2, zf, dc + dw / 2 + e, zf + 0.06, 0, dh + e, acc)
            _box(p, dc - dw / 2, zf, dc + dw / 2, zf + 0.06, dh, dh + e, acc)
        else:
            xf = x1 if side == "e" else x0 - 0.06
            _box(p, xf, dc - dw / 2 - e, xf + 0.06, dc - dw / 2, 0, dh + e, acc)
            _box(p, xf, dc + dw / 2, xf + 0.06, dc + dw / 2 + e, 0, dh + e, acc)
            _box(p, xf, dc - dw / 2, xf + 0.06, dc + dw / 2, dh, dh + e, acc)
    boxes += _furnish(p, (ix0, iz0, ix1, iz1), s, theme, b)
    return boxes


def _furnish(p: Part | None, inner, s: dict, theme: str, b: dict) -> list[tuple]:
    """Mobiliario de cada distrito. Deja libre un pasillo de 2,5 m desde la puerta."""
    rnd = random.Random(int(sum(b["rect"]) * 1000) + len(theme))
    ix0, iz0, ix1, iz1 = inner
    side, dc = s["side"], s["door_c"]
    f = FLOOR
    out: list[tuple] = []
    th = THEME[theme]

    def put(a0, b0, a1, b1, c0, c1, m, collide=True, skip=()):
        if p is not None:
            _box(p, a0, b0, a1, b1, c0, c1, m, skip)
        if collide:
            out.append((a0, b0, a1, b1, c0, c1))

    M = (lambda lib, tint: mat(lib, tint)) if p is not None else (lambda lib, tint: None)

    # Ejes locales: «u» a lo largo de la pared de la puerta, «v» hacia dentro desde ella.
    along = side in ("s", "n")
    if along:
        u0, u1 = ix0, ix1
        v_in = (lambda v: iz1 - v) if side == "s" else (lambda v: iz0 + v)
        depth = iz1 - iz0
    else:
        u0, u1 = iz0, iz1
        v_in = (lambda v: ix1 - v) if side == "e" else (lambda v: ix0 + v)
        depth = ix1 - ix0

    def rect_uv(ua, ub, va, vb):
        za, zb = sorted((v_in(va), v_in(vb)))
        return (ua, za, ub, zb) if along else (za, ua, zb, ub)

    def item(ua, ub, va, vb, c0, c1, m, collide=True, skip=()):
        a0, b0, a1, b1 = rect_uv(ua, ub, va, vb)
        put(a0, b0, a1, b1, c0, c1, m, collide, skip)

    def clear_of_door(ua, ub, va):
        return va > 3.0 or ub < dc - 1.8 or ua > dc + 1.8

    # Filas de muebles: una sola caja de colisión por tramo seguido (menos entidades en el mundo).
    row = {"a": None, "b": None, "v": 0.0, "d": 0.0, "h": 0.0}

    def row_add(ua, ub, v, d, h):
        if row["a"] is not None and abs(ua - row["b"]) < 0.25 and row["v"] == v:
            row["b"] = ub
            return
        row_flush()
        row.update(a=ua, b=ub, v=v, d=d, h=h)

    def row_flush():
        if row["a"] is not None:
            a0, b0, a1, b1 = rect_uv(row["a"], row["b"], row["v"], row["v"] + row["d"])
            out.append((a0, b0, a1, b1, f, f + row["h"]))
        row["a"] = None

    width = u1 - u0
    if theme == "cero":
        # Nodo de datos: filas de armarios con luces vivas al fondo, mostrador junto a la puerta y una pantalla grande.
        rack, front = M("metal", "#0f131d"), M("pantalla", "#36d9ff")
        rows = max(1, int((depth - 6) // 3))
        for r in range(rows):
            v = 5 + r * 3
            k = u0 + 1.2
            while k + 0.7 < u1 - 1.2:
                if clear_of_door(k, k + 0.7, v) and abs((k + 0.35) - dc) > 1.6:
                    item(k, k + 0.7, v, v + 1.0, f, f + 2.3, rack, collide=False)
                    item(k + 0.08, k + 0.62, v - 0.03, v, f + 0.3, f + 2.1, front, collide=False)
                    row_add(k, k + 0.7, v, 1.0, 2.3)
                else:
                    row_flush()
                k += 0.8
            row_flush()
        # Mostrador en L junto a la entrada (a un lado del pasillo).
        dsk = M("metal", "#232a3a")
        ua = dc + 2.2
        if ua + 3.2 < u1:
            item(ua, ua + 3.2, 1.6, 2.4, f, f + 1.05, dsk)
            item(ua, ua + 3.2, 1.55, 1.6, f + 0.9, f + 1.0, M("neon", th["accent"]), collide=False)
        # Pantalla en la pared del fondo.
        item(u0 + width * 0.25, u1 - width * 0.25, depth - 0.12, depth, f + 1.2, min(s["y1"] - CEIL - 0.4, f + 3.8), M("pantalla", "#ff4fd8"), collide=False)
    elif theme == "arcade":
        # Sala recreativa: filas de máquinas mirando a los pasillos, mostrador de premios y moqueta de luz.
        body = M("metal", "#151a28")
        tints = ["#4fa3ff", "#ff4fd8", "#36d9ff", "#ffd54f", "#6dff8a"]
        rows = max(1, int((depth - 4) // 3.2))
        for r in range(rows):
            v = 3.6 + r * 3.2
            k = u0 + 0.6
            while k + 0.9 < u1 - 0.6:
                if clear_of_door(k, k + 0.9, v):
                    item(k, k + 0.9, v, v + 0.8, f, f + 1.9, body, collide=False)
                    row_add(k, k + 0.9, v, 0.8, 1.9)
                    tint = rnd.choice(tints)
                    item(k + 0.1, k + 0.8, v - 0.02, v, f + 1.0, f + 1.6, M("pantalla", tint), collide=False)
                    item(k + 0.05, k + 0.85, v - 0.03, v, f + 1.68, f + 1.85, M("neon", tint), collide=False)
                else:
                    row_flush()
                k += 1.1
            row_flush()
        if depth > 4:
            item(u0 + 0.6, u0 + 3.6, depth - 1.2, depth - 0.4, f, f + 1.1, M("metal", "#2c3348"))
            item(u0 + 0.6, u0 + 3.6, depth - 1.25, depth - 1.2, f + 0.95, f + 1.05, M("neon", "#ffd54f"), collide=False)
        for k in range(3):
            v = 1.0 + k * 0.6
            item(dc - 1.2, dc + 1.2, v, v + 0.1, f, f + 0.01, M("neon", tints[k]), collide=False, skip=("-z",))
    elif theme == "pixel":
        # Café de píxeles: barra, mesas cúbicas con taburetes y un mural de píxeles en el fondo.
        wood, top = M("azulejo", "#ffd54f"), M("azulejo", "#ff7a45")
        if depth > 5:
            item(u0 + 0.6, u0 + min(5.0, width * 0.45), depth - 1.4, depth - 0.6, f, f + 1.05, wood)
            item(u0 + 0.6, u0 + min(5.0, width * 0.45), depth - 1.45, depth - 0.55, f + 1.05, f + 1.12, top)
        cols = max(1, int((width - 2) // 3))
        for c in range(cols):
            for r in range(max(1, int((depth - 5) // 3))):
                uc = u0 + 1.8 + c * 3
                v = 3.4 + r * 3
                if not clear_of_door(uc - 0.5, uc + 0.5, v):
                    continue
                item(uc - 0.45, uc + 0.45, v, v + 0.9, f, f + 0.75, M("azulejo", rnd.choice(["#4fa3ff", "#ff4fd8", "#6dff8a"])))
                for (du, dv) in ((-0.9, 0.2), (0.6, 0.2)):
                    item(uc + du, uc + du + 0.3, v + dv, v + dv + 0.5, f, f + 0.45, M("azulejo", "#a26bff"))
        if p is not None:
            k = 0
            for i in range(10):
                for j in range(4):
                    if rnd.random() < 0.55:
                        continue
                    ua = u0 + 1 + i * 0.6
                    if ua + 0.5 > u1 - 1:
                        continue
                    item(ua, ua + 0.5, depth - 0.1 - 0.01 * (k % 3), depth, f + 1.5 + j * 0.6, f + 2.0 + j * 0.6,
                         M("neon", rnd.choice(["#ff4fd8", "#4fa3ff", "#ffd54f", "#6dff8a"])), collide=False)
                    k += 1
    else:
        # Nave del Taller: bancos de trabajo, estanterías, cajas y un elevador con su coche de pruebas.
        steel, wood = M("metal", "#8c95a8"), M("madera", "#9b7046")
        for k in range(3):
            v = 3.5 + k * 3.2
            if v + 1 > depth - 1:
                break
            item(u0 + 0.6, u0 + 2.8, v, v + 0.9, f, f + 0.95, wood)
            item(u0 + 0.6, u0 + 2.8, v - 0.05, v + 0.95, f + 0.95, f + 1.0, steel, collide=False)
        for k in range(int((depth - 2) // 2.4)):
            v = 1.5 + k * 2.4
            if clear_of_door(u1 - 0.9, u1 - 0.3, v):
                item(u1 - 0.9, u1 - 0.3, v, v + 2.0, f, f + 2.6, M("metal", "#3a4256"))
        if width > 9 and depth > 8:
            uc, vc = (u0 + u1) / 2 + 1.5, depth * 0.6
            item(uc - 1.4, uc + 1.4, vc - 2.2, vc + 2.2, f, f + 0.25, M("metal", "#ff8a2c"))
            item(uc - 0.9, uc + 0.9, vc - 1.8, vc + 1.8, f + 0.25, f + 1.25, M("metal", "#4fa3ff"))
        cr = M("madera", "#b07d4a")
        for k in range(4):
            ua = u0 + 0.6 + (k % 2) * 1.1
            va = depth - 1.6 - (k // 2) * 1.1
            item(ua, ua + 1.0, va, va + 1.0, f, f + 1.0, cr)
    return out
