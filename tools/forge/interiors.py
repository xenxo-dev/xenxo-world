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

import math
import random

from kit import CHUNK, Part, mat

C = CHUNK / 2
T = 0.3          # grosor de los muros
FLOOR = 0.12     # suelo de la sala (por encima de las capas de la calle)
CEIL = 0.3       # grosor del techo

# Edificios abiertos por distrito: (manzana i, j) y cuál de sus edificios (el primero).
OPEN_BLOCKS = {
    # Distrito Cero, la ciudad más viva: seis plantas bajas abiertas (las dos esquinas y las cuatro de los pasajes).
    "cero": [(0, 2), (2, 0), (1, 0), (1, 2), (0, 1), (2, 1)],
    "arcade": [(0, 2), (2, 0)], "pixel": [(0, 2), (2, 0)], "taller": [(0, 2), (2, 0)],
}

# Qué es cada sala de Cero: nodo de datos, club, bar de fideos, bar de terminales y mercado.
CERO_ROOMS = {(0, 2): "nodo", (2, 0): "club", (1, 0): "fideos", (1, 2): "fideos", (0, 1): "mercado", (2, 1): "bar"}

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


def room(p: Part | None, b: dict, theme: str, detail: int = 1, life: dict | None = None) -> list[tuple]:
    """
    Dibuja la sala (si `p`) y devuelve sus cajas sólidas (x0, z0, x1, z1, y0, y1). Si se le pasa
    `life`, apunta ahí la puerta, los asientos, la gente y las máquinas-portal (interiors.life_of).
    """
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
    if life is not None:
        # La puerta corredera (la dibuja el cliente: dos hojas que se abren al acercarse alguien).
        if side in ("n", "s"):
            life["doors"].append({"x": round(dc, 3), "z": round(z1 - T / 2 if side == "s" else z0 + T / 2, 3), "axis": "x", "w": dw, "h": dh, "y": FLOOR})
        else:
            life["doors"].append({"x": round(x1 - T / 2 if side == "e" else x0 + T / 2, 3), "z": round(dc, 3), "axis": "z", "w": dw, "h": dh, "y": FLOOR})
    boxes += _furnish(p, (ix0, iz0, ix1, iz1), s, theme, b, life if life is not None else {"doors": [], "seats": [], "npcs": [], "cabinets": []})
    return boxes


def life_of(b: dict, theme: str) -> dict:
    """Lo vivo de un interior: puerta, asientos (cajas con giro), gente y máquinas-portal."""
    life = {"doors": [], "seats": [], "npcs": [], "cabinets": []}
    room(None, b, theme, 1, life)
    return life


def _furnish(p: Part | None, inner, s: dict, theme: str, b: dict, life: dict) -> list[tuple]:
    """
    Mobiliario y vida de cada distrito. Deja libre un pasillo de 3 m desde la puerta. Todo en ejes
    de la sala: «u» a lo largo de la pared de la puerta y «v» hacia dentro desde ella.
    """
    rnd = random.Random(int(sum(b["rect"]) * 1000) + len(theme))
    ix0, iz0, ix1, iz1 = inner
    side, dc = s["side"], s["door_c"]
    f = FLOOR
    out: list[tuple] = []
    th = THEME[theme]
    M = (lambda lib, tint: mat(lib, tint)) if p is not None else (lambda lib, tint: None)

    along = side in ("s", "n")
    if along:
        u0, u1 = ix0, ix1
        v_in = (lambda v: iz1 - v) if side == "s" else (lambda v: iz0 + v)
        depth = iz1 - iz0
        V = (0.0, -1.0) if side == "s" else (0.0, 1.0)
        U = (1.0, 0.0)
    else:
        u0, u1 = iz0, iz1
        v_in = (lambda v: ix1 - v) if side == "e" else (lambda v: ix0 + v)
        depth = ix1 - ix0
        V = (-1.0, 0.0) if side == "e" else (1.0, 0.0)
        U = (0.0, 1.0)
    width = u1 - u0

    def xz(u, v):
        return (u, v_in(v)) if along else (v_in(v), u)

    def yaw_of(du, dv):
        """Giro (grados) para mirar hacia (du, dv) en ejes de la sala (0 = +Z del mundo)."""
        dx = U[0] * du + V[0] * dv
        dz = U[1] * du + V[1] * dv
        return round(math.degrees(math.atan2(dx, dz)), 1)

    def rect_uv(ua, ub, va, vb):
        za, zb = sorted((v_in(va), v_in(vb)))
        return (ua, za, ub, zb) if along else (za, ua, zb, ub)

    def item(ua, ub, va, vb, c0, c1, m, collide=True, skip=()):
        a0, b0, a1, b1 = rect_uv(ua, ub, va, vb)
        if p is not None and m is not None:
            _box(p, a0, b0, a1, b1, c0, c1, m, skip)
        if collide:
            out.append((a0, b0, a1, b1, c0, c1))

    def seat(uc, vc, du, dv, length, tint):
        """Banco donde sentarse, mirando hacia (du, dv): asiento, respaldo y su caja con giro."""
        yaw = yaw_of(du, dv)
        x, z = xz(uc, vc)
        life["seats"].append([round(x, 3), round(f + 0.225, 3), round(z, 3), round(length / 2, 3), 0.225, 0.25, yaw])
        if p is None:
            return
        fu, fv = du, dv  # frente
        lu, lv = (abs(dv), abs(du))  # a lo largo del banco
        hu = (length / 2) * lu + 0.25 * abs(fu)
        hv = (length / 2) * lv + 0.25 * abs(fv)
        item(uc - hu, uc + hu, vc - hv, vc + hv, f, f + 0.45, M("metal", tint), collide=False)
        bu, bv = uc - fu * 0.22, vc - fv * 0.22
        tu = (length / 2) * lu + 0.04 * abs(fu)
        tv = (length / 2) * lv + 0.04 * abs(fv)
        item(bu - tu, bu + tu, bv - tv, bv + tv, f + 0.45, f + 0.95, M("metal", tint), collide=False)

    def npc(uc, vc, du, dv, pose):
        x, z = xz(uc, vc)
        life["npcs"].append({"x": round(x, 3), "y": f, "z": round(z, 3), "yaw": yaw_of(du, dv), "pose": pose})

    def sit_on(uc, vc, du, dv):
        """Alguien sentado en el banco de (uc, vc) que mira hacia (du, dv)."""
        npc(uc + du * 0.05, vc + dv * 0.05, du, dv, "sit")

    def cabinet(uc, vc, du, dv):
        """Máquina-portal (la llena el Worker con un proyecto del distrito: syncCabinets)."""
        x, z = xz(uc, vc)
        life["cabinets"].append({"p": [round(x, 3), f, round(z, 3)], "yaw": yaw_of(du, dv)})

    # Filas de muebles: una sola caja de colisión por tramo seguido.
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

    kind = CERO_ROOMS.get(tuple(b.get("block", (0, 2))), "nodo") if theme == "cero" else theme
    cyan, mag = "#36d9ff", "#ff4fd8"

    def strip(ua, ub, va, vb, y, tint):
        """Filo de luz en una pared o un mueble (sin colisión)."""
        item(ua, ub, va, vb, y, y + 0.06, M("neon", tint), collide=False)

    if kind == "club":
        # Club: pista de baldosas de luz, cabina del DJ con su pantalla, barra con camarero y sofás.
        uc = (u0 + u1) / 2 - 1.0
        tints = [cyan, mag, "#a26bff", "#ffd54f"]
        for a in range(-3, 4):
            for c in range(7):
                v = 7.5 + c
                if p is not None:
                    item(uc + a - 0.48, uc + a + 0.48, v + 0.02, v + 0.98, f, f + 0.012, M("neon", tints[(a + c) % 4]), collide=False, skip=("-z",))
        item(uc - 2.0, uc + 2.0, depth - 2.4, depth - 1.5, f, f + 1.1, M("metal", "#141a26"))
        strip(uc - 2.0, uc + 2.0, depth - 2.45, depth - 2.4, f + 0.95, mag)
        item(uc - 4.5, uc + 4.5, depth - 0.12, depth, f + 1.3, f + 4.2, M("pantalla", mag), collide=False)
        npc(uc, depth - 0.9, 0, -1, "dance")
        for (du, dv) in ((-2.2, 9.0), (0.6, 8.2), (2.4, 10.4), (-0.8, 12.2), (1.4, 13.0), (-2.6, 12.6)):
            npc(uc + du, dv, -du * 0.3, 1, "dance")
        # Barra en la pared izquierda.
        item(u0 + 1.3, u0 + 2.1, 4.0, 11.0, f, f + 1.1, M("metal", "#232a3a"))
        strip(u0 + 2.1, u0 + 2.15, 4.0, 11.0, f + 0.95, cyan)
        npc(u0 + 0.6, 7.2, 1, 0, "talk")
        for v in (4.4, 6.0, 7.6, 9.2):  # botellas: puntos de luz en la pared de detrás
            item(u0, u0 + 0.12, v, v + 1.0, f + 1.6, f + 1.75, M("neon", tints[int(v) % 4]), collide=False)
        seat(u0 + 2.75, 5.4, -1, 0, 1.6, "#3a2a55")
        seat(u0 + 2.75, 9.4, -1, 0, 1.6, "#3a2a55")
        sit_on(u0 + 2.75, 5.4, -1, 0)
        # Sofás en la pared derecha (lejos de la puerta) con alguien charlando.
        for v in (8.0, 11.5, 15.0):
            seat(u1 - 0.45, v, -1, 0, 1.8, "#2a1f4a")
        sit_on(u1 - 0.45, 11.5, -1, 0)
        npc(u1 - 1.5, 15.0, 1, 0, "talk")
        for v in (16.0, 19.0):
            strip(u0, u0 + 0.06, v, v + 2.0, f + 2.4, mag)
    elif kind == "fideos":
        # Bar de fideos: barra larga en la pared izquierda con dos cocineros detrás, taburetes corridos
        # con gente comiendo, farolillos rojos y dos máquinas-portal al fondo.
        item(u0 + 1.0, u0 + 1.7, 3.6, depth - 4.5, f, f + 1.05, M("madera", "#7a4a2a"))
        strip(u0 + 1.7, u0 + 1.75, 3.6, depth - 4.5, f + 0.9, "#ff4f4f")
        item(u0, u0 + 0.12, 4.0, depth - 5.0, f + 1.9, f + 2.6, M("pantalla", "#ffd54f"), collide=False)  # la carta
        npc(u0 + 0.5, 6.0, 1, 0, "talk")
        npc(u0 + 0.5, 11.5, 1, 0, "idle")
        k = 0
        v = 5.0
        while v + 1 < depth - 4.5:
            seat(u0 + 2.2, v, -1, 0, 1.4, "#3a2a2a")
            if k % 2 == 0:
                sit_on(u0 + 2.2, v, -1, 0)
            k += 1
            v += 2.2
        if p is not None:
            for v in range(4, int(depth) - 4, 2):  # farolillos
                uc = u0 + 2.6
                item(uc - 0.18, uc + 0.18, v - 0.18, v + 0.18, f + 3.0, f + 3.45, M("neon", "#ff4f4f"), collide=False)
        cabinet(u0 + 1.3, depth - 0.55, 0, -1)
        cabinet(u1 - 1.3, depth - 0.55, 0, -1)
        npc(u1 - 1.3, depth - 1.6, 0, 1, "idle")
    elif kind == "bar":
        # Bar de terminales: barra al fondo con camarera, bancos frente a ella, tres máquinas-portal y un sofá.
        item(u0 + 1.0, u0 + 9.0, depth - 1.9, depth - 1.1, f, f + 1.1, M("metal", "#232a3a"))
        strip(u0 + 1.0, u0 + 9.0, depth - 1.95, depth - 1.9, f + 0.95, mag)
        npc(u0 + 4.5, depth - 0.55, 0, -1, "talk")
        for k in range(6):
            item(u0 + 1.2 + k * 1.3, u0 + 2.0 + k * 1.3, depth - 0.12, depth, f + 1.5 + (k % 2) * 0.4, f + 1.65 + (k % 2) * 0.4,
                 M("neon", [cyan, mag, "#ffd54f"][k % 3]), collide=False)
        for k, uc in enumerate((u0 + 2.2, u0 + 4.8, u0 + 7.4)):
            seat(uc, depth - 2.7, 0, 1, 1.6, "#3a2a55")
            if k != 1:
                sit_on(uc, depth - 2.7, 0, 1)
        for k in range(3):
            cabinet(u0 + 11.0 + k * 1.5, depth - 0.55, 0, -1)
        npc(u0 + 11.0, depth - 1.6, 0, 1, "idle")
        npc(u0 + 14.0, depth - 1.6, 0, 1, "idle")
        seat(u1 - 0.45, 3.6, -1, 0, 1.6, "#2a1f4a")
        sit_on(u1 - 0.45, 3.6, -1, 0)
    elif kind == "mercado":
        # Mercado de piezas: estanterías al fondo llenas de cajas de luz, mostrador con su tendero,
        # clientes mirando y un banco junto a la entrada.
        tints = [cyan, mag, "#ffd54f", "#6dff8a"]
        item(u0 + 0.5, u1 - 0.5, depth - 0.8, depth - 0.15, f, f + 2.3, M("metal", "#1b2233"))
        if p is not None:
            for r in range(3):
                for c in range(int((u1 - u0 - 1.4) / 0.9)):
                    if rnd.random() < 0.3:
                        continue
                    ua = u0 + 0.7 + c * 0.9
                    item(ua, ua + 0.6, depth - 0.88, depth - 0.8, f + 0.35 + r * 0.7, f + 0.75 + r * 0.7, M("neon", rnd.choice(tints)), collide=False)
        ua = max(dc + 2.2, u1 - 4.4)
        item(ua, ua + 2.8, 3.0, 3.8, f, f + 1.0, M("metal", "#232a3a"))
        strip(ua, ua + 2.8, 2.95, 3.0, f + 0.85, cyan)
        npc(ua + 1.4, 4.5, 0, -1, "talk")
        npc(ua + 1.4, 2.3, 0, 1, "idle")
        npc(u0 + 3.0, depth - 1.5, 0, 1, "idle")
        npc(u0 + 8.0, depth - 1.5, 0.3, 1, "idle")
        npc(u0 + 12.5, depth - 1.5, 0, 1, "crouch")
        seat(u0 + 0.45, 3.0, 1, 0, 1.6, "#3a2a55")
        sit_on(u0 + 0.45, 3.0, 1, 0)
    elif kind == "nodo":
        # Nodo de datos: vestíbulo con recepción, sofás frente a una pantalla, dos terminales
        # (máquinas-portal) y, al fondo, las filas de servidores con sus técnicos.
        rack, front = M("metal", "#0f131d"), M("pantalla", "#36d9ff")
        v = 11.0
        while v + 1.0 < depth - 1.0:
            k = u0 + 1.2
            while k + 0.7 < u1 - 1.2:
                item(k, k + 0.7, v, v + 1.0, f, f + 2.3, rack, collide=False)
                item(k + 0.08, k + 0.62, v - 0.03, v, f + 0.3, f + 2.1, front, collide=False)
                row_add(k, k + 0.7, v, 1.0, 2.3)
                k += 0.8
            row_flush()
            v += 3.0
        npc(u0 + 3.0, 10.3, 0, 1, "crouch")
        npc(u1 - 4.0, 13.2, 0, 1, "idle")
        # Recepción junto a la entrada, con alguien detrás.
        ua = min(dc + 2.4, u1 - 4.0)
        item(ua, ua + 3.2, 1.6, 2.4, f, f + 1.05, M("metal", "#232a3a"))
        item(ua, ua + 3.2, 1.55, 1.6, f + 0.9, f + 1.0, M("neon", th["accent"]), collide=False)
        npc(ua + 1.6, 3.0, 0, -1, "talk")
        # Pantalla en la pared de la izquierda y dos sofás mirándola.
        item(u0, u0 + 0.12, 4.0, 9.0, f + 1.2, f + 3.6, M("pantalla", "#ff4fd8"), collide=False)
        seat(u0 + 3.2, 5.2, -1, 0, 1.8, "#3a2a55")
        seat(u0 + 3.2, 7.6, -1, 0, 1.8, "#3a2a55")
        sit_on(u0 + 3.2, 5.6, -1, 0)
        # Terminales en la pared de la derecha.
        cabinet(u1 - 0.6, 5.0, -1, 0)
        cabinet(u1 - 0.6, 7.2, -1, 0)
    elif theme == "arcade":
        # Sala recreativa: máquinas-portal en la pared izquierda (los juegos del distrito), bancos
        # enfrente, filas de máquinas de decorado al fondo, mostrador de premios y moqueta de luz.
        for k, v in enumerate((4.6, 6.4, 8.2, 10.0)):
            cabinet(u0 + 0.55, v, 1, 0)
        npc(u0 + 1.45, 4.6, -1, 0, "idle")
        npc(u0 + 1.45, 8.2, -1, 0, "idle")
        seat(u1 - 0.45, 5.6, -1, 0, 1.6, "#2a1f4a")
        seat(u1 - 0.45, 8.8, -1, 0, 1.6, "#2a1f4a")
        sit_on(u1 - 0.45, 8.8, -1, 0)
        body = M("metal", "#151a28")
        tints = ["#4fa3ff", "#ff4fd8", "#36d9ff", "#ffd54f", "#6dff8a"]
        v = 13.0
        while v + 0.8 < depth - 3.0:
            k = u0 + 0.6
            mid = (u0 + u1) / 2
            while k + 0.9 < u1 - 0.6:
                if abs(k + 0.45 - mid) < 1.1:  # pasillo por el medio hasta el mostrador del fondo
                    row_flush()
                    k += 1.1
                    continue
                item(k, k + 0.9, v, v + 0.8, f, f + 1.9, body, collide=False)
                tint = rnd.choice(tints)
                item(k + 0.1, k + 0.8, v - 0.02, v, f + 1.0, f + 1.6, M("pantalla", tint), collide=False)
                item(k + 0.05, k + 0.85, v - 0.03, v, f + 1.68, f + 1.85, M("neon", tint), collide=False)
                row_add(k, k + 0.9, v, 0.8, 1.9)
                k += 1.1
            row_flush()
            v += 3.2
        npc((u0 + u1) / 2, 12.0, 0, 1, "idle")
        # Mostrador de premios al fondo, con su dependiente.
        item(u0 + 0.6, u0 + 3.6, depth - 2.2, depth - 1.4, f, f + 1.1, M("metal", "#2c3348"))
        item(u0 + 0.6, u0 + 3.6, depth - 2.25, depth - 2.2, f + 0.95, f + 1.05, M("neon", "#ffd54f"), collide=False)
        npc(u0 + 2.1, depth - 0.8, 0, -1, "talk")
        # Moqueta de luz a la entrada y alguien bailando en ella.
        for k in range(3):
            v = 1.0 + k * 0.6
            item(dc - 1.2, dc + 1.2, v, v + 0.1, f, f + 0.01, M("neon", tints[k]), collide=False, skip=("-z",))
        npc(dc + 2.4, 2.4, 0, -1, "dance")
    elif theme == "pixel":
        # Café de píxeles: barra al fondo con su camarero, mesas con bancos (y gente), dos
        # máquinas-portal de juegos 2D y el mural de píxeles.
        if depth > 6:
            item(u0 + 0.6, u0 + min(5.0, width * 0.5), depth - 1.6, depth - 0.8, f, f + 1.05, M("azulejo", "#ffd54f"))
            item(u0 + 0.6, u0 + min(5.0, width * 0.5), depth - 1.65, depth - 0.75, f + 1.05, f + 1.12, M("azulejo", "#ff7a45"), collide=False)
            npc(u0 + 2.6, depth - 0.35, 0, -1, "talk")
        cols = [u0 + 2.2, u1 - 2.2] if width > 7 else [(u0 + u1) / 2]
        sitting = 0
        for c, uc in enumerate(cols):
            v = 5.0
            while v + 2.6 < depth - 4.0:
                item(uc - 0.45, uc + 0.45, v, v + 0.9, f, f + 0.75, M("azulejo", rnd.choice(["#4fa3ff", "#ff4fd8", "#6dff8a"])))
                seat(uc, v - 0.5, 0, 1, 1.3, "#a26bff")
                seat(uc, v + 1.4, 0, -1, 1.3, "#a26bff")
                if (c + int(v)) % 2 == 0 and sitting < 3:
                    sit_on(uc, v - 0.5, 0, 1)
                    sitting += 1
                v += 3.6
        cabinet(u1 - 0.55, depth - 4.2, -1, 0)
        cabinet(u1 - 0.55, depth - 2.6, -1, 0)
        npc(u1 - 1.45, depth - 4.2, 1, 0, "idle")
        if p is not None:
            k = 0
            for i in range(10):
                for j in range(4):
                    if rnd.random() < 0.55:
                        continue
                    ua = u0 + 5.6 + i * 0.4
                    if ua + 0.35 > u1 - 1.4:
                        continue
                    item(ua, ua + 0.35, depth - 0.1 - 0.01 * (k % 3), depth, f + 1.4 + j * 0.45, f + 1.75 + j * 0.45,
                         M("neon", rnd.choice(["#ff4fd8", "#4fa3ff", "#ffd54f", "#6dff8a"])), collide=False)
                    k += 1
    else:
        # Nave del Taller: banco para sentarse a la entrada, bancos de trabajo con gente, estanterías,
        # el elevador con su coche y su mecánico, cajas y dos máquinas-portal con herramientas.
        seat(u0 + 0.45, 2.2, 1, 0, 1.6, "#4a5266")
        steel, wood = M("metal", "#8c95a8"), M("madera", "#9b7046")
        for k in range(3):
            v = 5.0 + k * 3.2
            if v + 1 > depth - 3:
                break
            item(u0 + 0.6, u0 + 2.8, v, v + 0.9, f, f + 0.95, wood)
            item(u0 + 0.6, u0 + 2.8, v - 0.05, v + 0.95, f + 0.95, f + 1.0, steel, collide=False)
            if k < 2:
                npc(u0 + 3.3, v + 0.45, -1, 0, "idle")
        for k in range(int((depth - 2) // 2.4)):
            v = 1.5 + k * 2.4
            if v > 3.0 or u1 - 0.9 > dc + 1.8:
                item(u1 - 0.9, u1 - 0.3, v, v + 2.0, f, f + 2.6, M("metal", "#3a4256"))
        if width > 7 and depth > 10:
            uc, vc = (u0 + u1) / 2 + 0.6, depth * 0.55
            item(uc - 1.4, uc + 1.4, vc - 2.2, vc + 2.2, f, f + 0.25, M("metal", "#ff8a2c"))
            item(uc - 0.9, uc + 0.9, vc - 1.8, vc + 1.8, f + 0.25, f + 1.25, M("metal", "#4fa3ff"))
            npc(uc + 1.9, vc, -1, 0, "crouch")
        cr = M("madera", "#b07d4a")
        for k in range(4):
            ua = u0 + 0.6 + (k % 2) * 1.1
            va = depth - 1.6 - (k // 2) * 1.1
            item(ua, ua + 1.0, va, va + 1.0, f, f + 1.0, cr)
        cabinet(u1 - 1.7, depth - 0.6, 0, -1)
        cabinet(u1 - 3.0, depth - 0.6, 0, -1)
    return out
