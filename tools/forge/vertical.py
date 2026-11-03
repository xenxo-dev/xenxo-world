"""
Vertical, el distrito del parkour (diseño de detalle).

Torres de caravanas apiladas alrededor de la plaza, y por encima **la Ruta de las Azoteas**: una
vuelta a la plaza por los tejados de siete manzanas, cruzando las calles por tablones, vigas y
caravanas en voladizo. En cada manzana, un reto del parkour de world/parkour (saltar huecos y vallas,
subir de un piso a otro, correr por la pared sobre un foso, deslizarse bajo un tubo, dejarse caer
rodando). En las esquinas, **chimeneas**: dos paredes de caravanas muy juntas por las que se sube
rebotando de una a otra. En la plaza, **el Patio**: el parque para aprender cada movimiento, con sus
carteles (los textos van como datos: district-activities.json), la torre de salida de la ruta y la
plataforma de llegada.

Todo sale de `plan()`, puro y determinista: el modelo (`build`) y las colisiones (`colliders`) usan
las mismas cajas. `course()` da los puntos de la ruta y los banderines (la búsqueda) para la ficha de
actividades.

Coordenadas del chunk (X este, Z sur, Y arriba); el modelo va centrado en el chunk (Blender:
x = X − 32, y = −(Z − 32), z arriba), como el resto de la ciudad (city.py).
"""
from __future__ import annotations

import math
import random

from mathutils import Matrix

from kit import CHUNK, Part, finish, mat

C = CHUNK / 2
# Caravanas: largo, ancho y altura de cada piso (la caravana con su chasis).
TL, TW = 6.8, 2.45
LV = 2.7
HALF = TW / 2
# Interior de cada manzana (sin aceras) y dónde empieza.
S = 23.0
ORANGE = "#ff7a45"
TINTS = ["#d9c6a8", "#c8bfae", "#b9b2a4", "#8f9aa3", "#c0a080", "#b07d5e", "#9fb4a0", "#d6a46c", "#a7b8c9", "#c98f7a"]


def roof(level: int) -> float:
    """Altura del techo de una caravana del piso `level` (0 = en el suelo)."""
    return (level + 1) * LV


def _inner(i: int, j: int) -> tuple[float, float]:
    """Esquina noroeste del interior de la manzana (i, j) (city.py: 3 × 3 de 26 m, calles de 11 m, aceras de 1,5 m)."""
    return (-18.0 + 37.0 * i + 1.5, -18.0 + 37.0 * j + 1.5)


# --------------------------------------------------------------------------------------
# Marco de cada manzana: u hacia donde va la ruta, v a su derecha
# --------------------------------------------------------------------------------------

def _to_world(i: int, j: int, o: str, u: float, v: float) -> tuple[float, float]:
    bx, bz = _inner(i, j)
    if o == "E":
        return bx + u, bz + v
    if o == "S":
        return bx + S - v, bz + u
    if o == "W":
        return bx + S - u, bz + S - v
    return bx + v, bz + S - u  # N


def _rect(i, j, o, u0, v0, u1, v1):
    xa, za = _to_world(i, j, o, u0, v0)
    xb, zb = _to_world(i, j, o, u1, v1)
    return min(xa, xb), min(za, zb), max(xa, xb), max(za, zb)


class Plan:
    """Lo que hay: cajas con su tipo (caravana, tablón, viga, tubo, caja…). y0/y1, alturas."""

    def __init__(self) -> None:
        self.items: list[dict] = []

    def add(self, kind: str, x0, z0, x1, z1, y0, y1, **kw) -> dict:
        it = {"kind": kind, "x0": round(x0, 3), "z0": round(z0, 3), "x1": round(x1, 3), "z1": round(z1, 3), "y0": round(y0, 3), "y1": round(y1, 3), **kw}
        self.items.append(it)
        return it

    def trailer(self, x0, z0, x1, z1, level: int, tint: str, **kw) -> dict:
        return self.add("trailer", x0, z0, x1, z1, level * LV, roof(level), tint=tint, level=level, **kw)

    def free(self, x0, z0, x1, z1, y0, y1, margin=0.05) -> bool:
        """¿Está libre esa caja (con margen)?"""
        for it in self.items:
            if it["x1"] + margin <= x0 or it["x0"] - margin >= x1 or it["z1"] + margin <= z0 or it["z0"] - margin >= z1:
                continue
            if it["y1"] <= y0 or it["y0"] >= y1:
                continue
            return False
        return True


class Block:
    """Una manzana de la ruta en su marco (u, v), con su orientación."""

    def __init__(self, pl: Plan, i: int, j: int, o: str, rnd: random.Random):
        self.pl, self.i, self.j, self.o, self.rnd = pl, i, j, o, rnd

    def rect(self, u0, v0, u1, v1):
        return _rect(self.i, self.j, self.o, u0, v0, u1, v1)

    def point(self, u, v):
        return _to_world(self.i, self.j, self.o, u, v)

    def stack(self, u0, v0, u1, v1, top: int, cross: bool = True, tint: str | None = None, route: bool = True) -> None:
        """
        Torre de caravanas hasta el piso `top`: la de arriba con esa planta y, debajo, alternando, dos
        cruzadas (o la misma planta si `cross` es falso: para no invadir lo de al lado).
        """
        rnd = self.rnd
        long_u = (u1 - u0) >= (v1 - v0)
        cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
        for k in range(top, -1, -1):
            t = tint if (tint and k == top) else rnd.choice(TINTS)
            if not cross or (top - k) % 2 == 0:
                x0, z0, x1, z1 = self.rect(u0, v0, u1, v1)
                self.pl.trailer(x0, z0, x1, z1, k, t, route=route and k == top)
            else:
                # Dos caravanas atravesadas, cada una de largo TL, repartidas a lo largo.
                span = (u1 - u0) if long_u else (v1 - v0)
                for s in (-1, 1):
                    off = s * min(span / 2 - HALF, TL / 4 + 0.2)
                    if long_u:
                        a0, a1, b0, b1 = cu + off - HALF, cu + off + HALF, cv - TL / 2, cv + TL / 2
                    else:
                        a0, a1, b0, b1 = cu - TL / 2, cu + TL / 2, cv + off - HALF, cv + off + HALF
                    x0, z0, x1, z1 = self.rect(a0, b0, a1, b1)
                    self.pl.trailer(x0, z0, x1, z1, k, rnd.choice(TINTS))

    def box(self, kind: str, u0, v0, u1, v1, y0, y1, **kw) -> dict:
        x0, z0, x1, z1 = self.rect(u0, v0, u1, v1)
        return self.pl.add(kind, x0, z0, x1, z1, y0, y1, **kw)


PATH = (11.5 - HALF, 11.5 + HALF)


def _straight_up(b: Block, P: int, marks: list) -> None:
    """Saltos: un hueco de 2 m, una valla (la máquina del aire) y, al final, un piso más arriba."""
    v0, v1 = PATH
    b.stack(0, v0, TL, v1, P)
    b.stack(8.8, v0, 8.8 + TL, v1, P)
    b.box("ac", 12.0, 10.6, 12.7, 12.4, roof(P), roof(P) + 1.0)
    b.stack(16.0, v0, 16.0 + TL, v1, P + 1)
    marks.append(("cp", b.point(11.0, 11.5), roof(P)))


def _straight_down(b: Block, P: int, marks: list) -> None:
    """Un hueco, un tubo por el que deslizarse (o saltarlo) y una caída de un piso: rodando."""
    v0, v1 = PATH
    b.stack(0, v0, TL, v1, P)
    b.stack(8.6, v0, 8.6 + TL, v1, P)
    b.box("pipe", 12.4, 8.8, 12.7, 14.2, roof(P) + 1.08, roof(P) + 1.38)
    for vv in (9.0, 14.0):
        b.box("post", 12.45, vv - 0.1, 12.65, vv + 0.1, roof(P), roof(P) + 1.08)
    b.stack(16.6, v0, 16.6 + TL, v1, P - 1)
    marks.append(("cp", b.point(11.0, 11.5), roof(P)))


def _straight_wall(b: Block, P: int, marks: list) -> None:
    """El foso: 5 m sin suelo con una pared a la derecha por la que se cruza corriendo; luego un tubo."""
    v0, v1 = PATH
    b.stack(0, v0, TL, v1, P, cross=False)
    # La pared: dos caravanas de un piso más, pegadas al camino por su derecha, del principio al final.
    for (a, c) in ((3.4, 3.4 + TL), (3.4 + TL, 3.4 + 2 * TL)):
        b.stack(a, v1, c, v1 + TW, P + 1, cross=False)
    # Encima de la pared, sobre el foso, un banderín (se sube por ella desde el tejado de antes).
    marks.append(("flag", b.point(3.4 + TL, v1 + HALF), roof(P + 1)))
    b.stack(11.8, v0, 11.8 + TL, v1, P, cross=False)
    b.box("pipe", 15.6, 8.6, 15.9, 12.725, roof(P) + 1.08, roof(P) + 1.38)
    b.box("post", 15.65, 8.6, 15.85, 8.8, roof(P), roof(P) + 1.08)
    b.stack(18.8, v0, 23.0, v1, P, cross=False)
    marks.append(("cp", b.point(15.0, 11.5), roof(P)))


def _corner(b: Block, P: int, Q: int, marks: list, chimney: bool = True) -> None:
    """
    Esquina: dos tramos hacia delante (un salto corto y una valla) y el giro a la derecha saltando un
    hueco de 2,3 m al tramo de salida, que puede estar un piso más arriba (agarrarse al borde y subir),
    igual o más abajo. En el rincón de fuera, la chimenea.
    """
    v0, v1 = PATH
    b.stack(0, v0, TL, v1, P)
    b.stack(7.8, v0, 7.8 + TL, v1, P)
    b.box("ac", 9.6, 10.7, 10.2, 12.3, roof(P), roof(P) + 0.95)
    b.stack(11.5 - HALF, 15.0, 11.5 + HALF, 15.0 + TL, Q, cross=True)
    marks.append(("cp", b.point(11.5, 18.4), roof(Q)))
    if chimney:
        # Dos paredes de caravanas a 1,6 m, de dos pisos, en el rincón de delante a la izquierda.
        for (a, c) in ((2.0, 2.0 + TW), (2.0 + TW + 1.6, 2.0 + 2 * TW + 1.6)):
            b.stack(15.6, a, 15.6 + TL, c, 1, cross=False, route=False)
        marks.append(("flag", b.point(19.0, 2.0 + HALF), roof(1)))


# La ruta: manzana, orientación, tipo, piso al entrar y al salir. Los cruces entre manzanas van al
# piso de salida de la anterior (tablón, viga o caravanas en voladizo con un hueco que se salta).
ROUTE = [
    ((1, 0), "N", "corner", 1, 2),
    ((2, 0), "E", "corner", 2, 1),
    ((2, 1), "S", "wall", 1, 1),
    ((2, 2), "S", "corner", 1, 2),
    ((1, 2), "W", "down", 2, 1),
    ((0, 2), "W", "corner", 1, 1),
    ((0, 1), "N", "corner", 1, 1),
]
# Cruces de calle (desde la salida de cada manzana): tablón, viga o voladizo.
CROSS = ["cantilever", "plank", "beam", "cantilever", "plank", "beam", "plank"]

# El Patio (la plaza, interior 20,5–43,5): estaciones para aprender.
PLAZA = (20.5, 20.5, 43.5, 43.5)
START = {"deck": (28.5, 20.5, 35.5, 23.3), "y": roof(1)}
FINISH = {"deck": (20.5, 30.6, 23.5, 33.4), "y": roof(1)}


def _exit(b: Block, kind: str) -> tuple[float, float, float, float]:
    """Dónde sale la ruta de la manzana: el punto (u, v) del borde y la dirección (du, dv) en el marco."""
    if kind == "corner":
        return 11.5, 15.0 + TL, 0.0, 1.0
    if kind == "wall":
        return 23.0, 11.5, 1.0, 0.0
    return 16.6 + TL if kind == "down" else 16.0 + TL, 11.5, 1.0, 0.0


def plan() -> tuple[Plan, list]:
    """Todo Vertical: la ruta, los cruces, el Patio y las torres de alrededor. Y sus marcas."""
    rnd = random.Random(1789)
    pl = Plan()
    marks: list = []
    exits = []
    for n, ((i, j), o, kind, P, Q) in enumerate(ROUTE):
        b = Block(pl, i, j, o, rnd)
        if kind == "corner":
            _corner(b, P, Q, marks)
        elif kind == "wall":
            _straight_wall(b, P, marks)
        elif kind == "down":
            _straight_down(b, P, marks)
        else:
            _straight_up(b, P, marks)
        u, v, du, dv = _exit(b, kind)
        exits.append((b, u, v, du, dv, Q))
    # Cruces de calle: desde la salida de cada manzana hasta la entrada de la siguiente (o la plaza).
    for n, (b, u, v, du, dv, Q) in enumerate(exits):
        # Tablones y vigas se apoyan 40 cm en cada tejado; las caravanas en voladizo empiezan en el borde.
        lap = 0.0 if CROSS[n] == "cantilever" else 0.4
        x0, z0 = b.point(u - lap * du, v - lap * dv)
        if n + 1 < len(ROUTE):
            (ni, nj), no, _k, _P, _Q = ROUTE[n + 1]
            x1, z1 = _to_world(ni, nj, no, lap, 11.5)
        else:
            x1, z1 = FINISH["deck"][2] - 0.4, (FINISH["deck"][1] + FINISH["deck"][3]) / 2
        _crossing(pl, CROSS[n], x0, z0, x1, z1, roof(Q), rnd)
    # De la torre de salida a la primera manzana.
    sx = (START["deck"][0] + START["deck"][2]) / 2
    (fi, fj), fo, _k, fP, _Q = ROUTE[0]
    x1, z1 = _to_world(fi, fj, fo, 0.4, 11.5)
    _crossing(pl, "plank", sx, START["deck"][1] + 0.4, x1, z1, roof(fP), rnd)
    _patio(pl, marks)
    _towers(pl, rnd)
    return pl, marks


def _crossing(pl: Plan, kind: str, x0, z0, x1, z1, y, rnd: random.Random) -> None:
    """Un cruce de calle recto (en X o en Z) a la altura de los tejados `y`."""
    along_x = abs(x1 - x0) > abs(z1 - z0)
    a0, a1 = sorted((x0, x1)) if along_x else sorted((z0, z1))
    c = (z0 + z1) / 2 if along_x else (x0 + x1) / 2

    def put(k, s0, s1, w, y0, y1, **kw):
        if along_x:
            pl.add(k, s0, c - w / 2, s1, c + w / 2, y0, y1, **kw)
        else:
            pl.add(k, c - w / 2, s0, c + w / 2, s1, y0, y1, **kw)

    if kind == "plank":
        put("plank", a0, a1, 0.42, y, y + 0.08)
    elif kind == "beam":
        put("beam", a0, a1, 0.24, y - 0.3, y + 0.06)
    else:
        # Dos caravanas en voladizo desde cada lado, con un hueco de 3 m en medio.
        mid = (a0 + a1) / 2
        lvl = int(round(y / LV)) - 1
        for (s0, s1) in ((a0, mid - 1.5), (mid + 1.5, a1)):
            put("trailer", s0, s1, TW, lvl * LV, roof(lvl), tint=rnd.choice(TINTS), level=lvl, route=True, cantilever=True)


def _patio(pl: Plan, marks: list) -> None:
    """El Patio: la torre de salida con su escalera de cajas, las estaciones y la plataforma de llegada."""
    x0, z0, x1, z1 = START["deck"]
    y = START["y"]
    pl.add("deck", x0, z0, x1, z1, y - 0.2, y)
    for (px, pz) in ((x0 + 0.15, z0 + 0.15), (x1 - 0.15, z0 + 0.15), (x0 + 0.15, z1 - 0.15), (x1 - 0.15, z1 - 0.15)):
        pl.add("post", px - 0.15, pz - 0.15, px + 0.15, pz + 0.15, 0, y - 0.2)
    # Escalera de cajas hacia el oeste: cada una 1,2 m más alta (se sube de una en una).
    for k in range(4):
        h = 1.2 * (k + 1)
        pl.add("crate", x0 - 1.25 * (4 - k), z0, x0 - 1.25 * (3 - k) - 0.05, z0 + 1.25, 0, h)
    marks.append(("start", ((x0 + x1) / 2, (z0 + z1) / 2), y))
    # Llegada: plataforma al oeste (desde el último cruce) y salto a la plaza.
    fx0, fz0, fx1, fz1 = FINISH["deck"]
    pl.add("deck", fx0, fz0, fx1, fz1, FINISH["y"] - 0.2, FINISH["y"])
    for (px, pz) in ((fx0 + 0.15, fz0 + 0.15), (fx1 - 0.15, fz0 + 0.15), (fx0 + 0.15, fz1 - 0.15), (fx1 - 0.15, fz1 - 0.15)):
        pl.add("post", px - 0.15, pz - 0.15, px + 0.15, pz + 0.15, 0, FINISH["y"] - 0.2)
    marks.append(("finish", (26.5, 32.0), 0.0))
    # Estaciones (de oeste a este por el sur, y el este de norte a sur).
    # 1) Vallas: tres muretes de 1 m en fila (correr contra ellos).
    for z in (25.0, 29.0, 33.0):
        pl.add("wall", 38.6, z - 0.15, 43.0, z + 0.15, 0, 1.0, station="vault")
    # 2) Tubo para deslizarse.
    pl.add("pipe", 38.4, 37.0, 43.2, 37.3, 1.08, 1.38, station="slide")
    for x in (38.5, 43.1):
        pl.add("post", x - 0.1, 37.05, x + 0.1, 37.25, 0, 1.08)
    # 3) Muro de 2,9 m (colgarse y trepar) y de 3,7 m (subir corriendo por él): bloques macizos.
    pl.add("wall", 22.0, 41.3, 27.0, 43.5, 0, 2.9, station="hang")
    pl.add("wall", 28.0, 41.3, 33.0, 43.5, 0, 3.7, station="wallup")
    marks.append(("flag", (30.5, 42.4), 3.7))
    # 4) Viga de equilibrio a 1 m.
    pl.add("beam", 34.2, 39.9, 43.0, 40.1, 0.86, 1.0, station="balance")
    for x in (34.4, 38.6, 42.8):
        pl.add("post", x - 0.08, 39.92, x + 0.08, 40.08, 0, 0.86)
    # 5) Pared para correr por ella (12 m) y chimenea (dos paredes a 1,6 m).
    # La chimenea del Patio: tan alta como las de las esquinas (el banderín no se alcanza desde abajo).
    pl.add("wall", 24.4, 24.0, 25.0, 27.5, 0, roof(1), station="chimney")
    pl.add("wall", 26.6, 24.0, 27.2, 27.5, 0, roof(1))
    marks.append(("flag", (24.7, 25.75), roof(1)))
    pl.add("wall", 20.6, 35.0, 21.1, 40.6, 0, 4.0, station="wallrun")


def _towers(pl: Plan, rnd: random.Random) -> None:
    """Torres de alrededor (decorado y retos libres): donde quepan, sin tocar la ruta ni las aceras."""
    for (i, j) in [(i, j) for j in range(3) for i in range(3) if (i, j) != (1, 1)]:
        bx, bz = _inner(i, j)
        spots = [(3.5, 3.5), (19.5, 3.5), (3.5, 19.5), (19.5, 19.5), (11.5, 3.5), (3.5, 11.5), (19.5, 11.5), (11.5, 19.5)]
        rnd.shuffle(spots)
        placed = 0
        for (cu, cv) in spots:
            if placed >= (4 if (i, j) == (0, 0) else 2):
                break
            along_x = rnd.random() < 0.5
            hx, hz = (TL / 2, HALF) if along_x else (HALF, TL / 2)
            x0, z0, x1, z1 = bx + cu - hx, bz + cv - hz, bx + cu + hx, bz + cv + hz
            if x0 < bx or z0 < bz or x1 > bx + S or z1 > bz + S:
                continue
            top = rnd.randint(4, 8) if (i, j) == (0, 0) else rnd.randint(3, 6)
            # Cruzadas debajo: comprobar el sitio con la huella de las cruzadas también.
            cx0, cz0, cx1, cz1 = bx + cu - TL / 2, bz + cv - TL / 2, bx + cu + TL / 2, bz + cv + TL / 2
            if cx0 < bx or cz0 < bz or cx1 > bx + S or cz1 > bz + S:
                continue
            if not pl.free(cx0 - 0.6, cz0 - 0.6, cx1 + 0.6, cz1 + 0.6, 0, roof(top) + 0.5):
                continue
            b = Block(pl, i, j, "E", rnd)
            b.stack(cu - (TL / 2 if along_x else HALF), cv - (HALF if along_x else TL / 2), cu + (TL / 2 if along_x else HALF), cv + (HALF if along_x else TL / 2), top, route=False)
            pl.items[-1]["tower"] = True
            placed += 1


# --------------------------------------------------------------------------------------
# Colisiones y datos de la ruta
# --------------------------------------------------------------------------------------

def colliders() -> list[list[float]]:
    pl, _marks = plan()
    out = []
    for it in pl.items:
        x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
        out.append([round((x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), round((z0 + z1) / 2, 3), round((x1 - x0) / 2, 3), round((y1 - y0) / 2, 3), round((z1 - z0) / 2, 3)])
    return out


def course() -> dict:
    """Salida, puntos de control (en orden) y llegada de la ruta, y los banderines."""
    _pl, marks = plan()
    cps, flags, start, finish = [], [], None, None
    for kind, (x, z), y in marks:
        p = [round(x, 2), round(y, 2), round(z, 2)]
        if kind == "cp":
            cps.append(p)
        elif kind == "flag":
            flags.append(p)
        elif kind == "start":
            start = p
        else:
            finish = p
    return {"start": start, "cps": cps, "finish": finish, "flags": flags}


# --------------------------------------------------------------------------------------
# Modelo
# --------------------------------------------------------------------------------------

def _box(p: Part, x0, z0, x1, z1, y0, y1, m, skip=()):
    p.box((x0 - C, -(z1 - C), y0), (x1 - C, -(z0 - C), y1), m, skip=skip)


# Dos tonos de caravana: la carrocería (crema o pastel) y su banda baja.
SHELLS = ["#e3d3b4", "#d6dccb", "#e8cfb2", "#c9d6dc", "#dcc6d0", "#e6dca8", "#cfdccb", "#e2c4a8", "#d3cfe0", "#ece2cc"]
BANDS = ["#2f5f95", "#2f7d6a", "#b5523b", "#c88a2a", "#6a4c8c", "#2e3f5c", "#9a3a3a", "#4e7a3a", "#1f7f8f", "#c25a7a"]


def _profile(L: float, H: float, yb: float, r: float, seg: int) -> list[tuple[float, float]]:
    """Silueta de una caravana de lado (largo, alto): esquinas de arriba redondeadas y el morro algo inclinado."""
    pts = [(0.12, yb), (L - 0.12, yb)]
    # Esquina de detrás (s = L) y de delante (s = 0), de abajo arriba y de vuelta.
    for k in range(seg + 1):
        a = (math.pi / 2) * k / seg
        pts.append((L - r + r * math.cos(a), H - r + r * math.sin(a)))
    for k in range(seg + 1):
        a = math.pi / 2 + (math.pi / 2) * k / seg
        pts.append((r + r * math.cos(a), H - r + r * math.sin(a)))
    pts.append((0.0, yb + 0.35))
    return pts


def _trailer(p: Part, it: dict, rnd: random.Random, detail: int, color: str) -> None:
    """
    Una caravana de las de antes: carrocería de chapa crema o pastel con las esquinas de arriba
    redondeadas, banda de color abajo y una fina del color del distrito, ventanas (de noche, unas
    encendidas), la puerta con su ventanuco, el ventanal del morro y, a veces, algo en el techo.
    """
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    along_x = (x1 - x0) >= (z1 - z0)
    L = (x1 - x0) if along_x else (z1 - z0)
    W = (z1 - z0) if along_x else (x1 - x0)
    H = y1 - y0
    # Todo lo que se sortea, primero y siempre igual: los dos niveles de detalle salen iguales.
    flip = rnd.random() < 0.5  # el morro hacia un lado o el otro
    shell = mat("chapa", rnd.choice(SHELLS))
    band = mat("chapa", rnd.choice(BANDS))
    glass = mat("ventana", rnd.choice(["#2c3a4a", "#33404d", "#283544"]))
    door_side = -1 if rnd.random() < 0.5 else 1
    r = rnd.random()
    antenna = 1.6 + rnd.random()
    q = Part("caravana")
    dark = mat("metal", "#2b2f38")
    yb = 0.14
    # En local: largo en Y (0..L), ancho en X (−W/2..W/2), alto en Z; se coloca después.
    q.box((-W / 2 + 0.3, 0.3, 0), (W / 2 - 0.3, L - 0.3, yb), dark, skip=("-z",))
    q.prism(_profile(L, H, yb, 0.55 if detail else 0.32, 3 if detail else 1), -W / 2, W / 2, shell)
    # Dos tonos: la parte de abajo del color de la banda, con un filete claro encima.
    q.box((-W / 2 - 0.015, 0.1, yb + 0.02), (W / 2 + 0.015, L - 0.1, yb + 0.95), band, skip=("-z",))
    q.box((-W / 2 - 0.02, 0.06, yb + 0.95), (W / 2 + 0.02, L - 0.06, yb + 1.02), mat("chapa", "#f6f4ee"), skip=("-z",))
    # Ventanas (cristal sobre la chapa: solo sus caras de fuera), la puerta y el ventanal del morro.
    n = 2 if L > 5 else 1
    for sx in (-1, 1):
        inner = "+x" if sx < 0 else "-x"
        for k in range(n):
            c = (k + 1) * L / (n + 1) + (0.4 if k == 0 else -0.4)
            xa = -W / 2 - 0.02 if sx < 0 else W / 2
            q.box((xa, c - 0.6, yb + 1.34), (xa + 0.02, c + 0.6, yb + 1.96), glass, skip=(inner, "+z", "-z"))
    sx = door_side
    xa = -W / 2 - 0.022 if sx < 0 else W / 2 + 0.002
    dy = L - 1.3 if L > 4 else L / 2
    q.box((xa, dy - 0.38, yb + 0.06), (xa + 0.02, dy + 0.38, yb + 2.05), mat("chapa", "#f2efe6"), skip=("+x" if sx < 0 else "-x", "+z", "-z"))
    if detail:
        q.box((xa - 0.004 if sx < 0 else xa + 0.004, dy - 0.18, yb + 1.45), (xa + 0.016 if sx < 0 else xa + 0.024, dy + 0.18, yb + 1.85), glass, skip=("+x" if sx < 0 else "-x",))
    q.box((-W / 2 + 0.45, -0.025, yb + 1.3), (W / 2 - 0.45, 0.0, yb + 1.85), glass, skip=("+y", "+z", "-z"))
    if detail:
        q.box((-W / 2 + 0.15, -0.02, yb + 0.6), (-W / 2 + 0.35, 0.0, yb + 0.72), mat("farol", "#ffb766"), skip=("+y",))
        # En el techo, a veces: claraboya, máquina del aire o antena (nunca en lo que se pisa de la ruta).
        if not it.get("route"):
            if r < 0.25:
                q.box((-0.45, L * 0.5 - 0.35, H), (0.45, L * 0.5 + 0.35, H + 0.5), mat("metal", "#c8ccd4"))
            elif r < 0.4:
                q.cylinder((0.6, L * 0.3, H), 0.03, antenna, mat("hierro", "#4a4f5c"), segments=4)
                q.lathe((0.6, L * 0.3, H + 1.0), [(0.02, 0.0), (0.32, 0.12), (0.36, 0.14)], mat("chapa", "#e4e6ea"), segments=10)
            elif r < 0.55:
                q.box((-W / 2 + 0.25, 0.8, H), (W / 2 - 0.25, L - 0.8, H + 0.06), mat("chapa", "#1d2c4a"))
        elif r < 0.5:
            q.box((-0.35, L * 0.25 - 0.3, H - 0.02), (0.35, L * 0.25 + 0.3, H + 0.08), mat("chapa", "#d9dde2"))
    # Colocar: el largo (Y local) a lo largo de X o de Z del mundo; el morro a un lado u otro.
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    rot = (-math.pi / 2 if along_x else 0.0) + (math.pi if flip else 0.0)
    m = Matrix.Translation((cx - C, -(cz - C), y0)) @ Matrix.Rotation(rot, 4, "Z") @ Matrix.Translation((0, -L / 2, 0))
    p.merge(q, m)
    q.bm.free()


def _plank(p: Part, it: dict, detail: int) -> None:
    """Tablón: tablas de madera con su canto (y, en los largos, unas cuerdas de banderitas)."""
    _box(p, it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"], mat("madera", "#8a6a48"))
    if detail:
        along_x = (it["x1"] - it["x0"]) > (it["z1"] - it["z0"])
        L = (it["x1"] - it["x0"]) if along_x else (it["z1"] - it["z0"])
        k = 0.0
        while k < L:
            if along_x:
                _box(p, it["x0"] + k, it["z0"] - 0.02, it["x0"] + k + 0.06, it["z1"] + 0.02, it["y1"] - 0.01, it["y1"] + 0.005, mat("madera", "#5e4630"))
            else:
                _box(p, it["x0"] - 0.02, it["z0"] + k, it["x1"] + 0.02, it["z0"] + k + 0.06, it["y1"] - 0.01, it["y1"] + 0.005, mat("madera", "#5e4630"))
            k += 1.1


def _beam(p: Part, it: dict) -> None:
    """Viga en I de acero: alas arriba y abajo y el alma."""
    m = mat("hierro", "#3d4452")
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    along_x = (x1 - x0) > (z1 - z0)
    _box(p, x0, z0, x1, z1, y1 - 0.06, y1, m)
    _box(p, x0, z0, x1, z1, y0, y0 + 0.06, m)
    if along_x:
        c = (z0 + z1) / 2
        _box(p, x0, c - 0.03, x1, c + 0.03, y0 + 0.06, y1 - 0.06, m)
    else:
        c = (x0 + x1) / 2
        _box(p, c - 0.03, z0, c + 0.03, z1, y0 + 0.06, y1 - 0.06, m)


def _pipe(p: Part, it: dict, detail: int) -> None:
    """Tubo horizontal (por debajo se pasa deslizándose)."""
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    r = (y1 - y0) / 2
    yc = (y0 + y1) / 2
    m = mat("metal", ORANGE)
    if (x1 - x0) > (z1 - z0):
        p.tube([(x0 - C, -((z0 + z1) / 2 - C), yc), (x1 - C, -((z0 + z1) / 2 - C), yc)], r, m, segments=10 if detail else 6)
    else:
        p.tube([((x0 + x1) / 2 - C, -(z0 - C), yc), ((x0 + x1) / 2 - C, -(z1 - C), yc)], r, m, segments=10 if detail else 6)


def _crate(p: Part, it: dict, detail: int) -> None:
    """Pila de cajas de madera: una caja cada 1,2 m, con sus listones."""
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    wood = mat("madera", "#b0844e")
    lath = mat("madera", "#7a5a34")
    y = y0
    while y < y1 - 0.01:
        h = min(1.2, y1 - y)
        _box(p, x0, z0, x1, z1, y, y + h, wood)
        if detail:
            _box(p, x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, y + h - 0.1, y + h, lath, skip=("+z", "-z"))
            _box(p, x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, y, y + 0.1, lath, skip=("+z", "-z"))
        y += h


def _wall(p: Part, it: dict, color: str, detail: int) -> None:
    """Muros del Patio: hormigón con la franja de su estación y el canto pintado (se ve de dónde agarrarse)."""
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    _box(p, x0, z0, x1, z1, y0, y1 - 0.08, mat("panel", "#8d939c"))
    _box(p, x0 - 0.01, z0 - 0.01, x1 + 0.01, z1 + 0.01, y1 - 0.08, y1, mat("metal", ORANGE))
    if detail and y1 > 2:
        _box(p, x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02, 0.9, 1.0, mat("neon", color), skip=("+z", "-z"))


def _boards(p: Part, color: str, detail: int) -> None:
    """Respaldo de los marcadores de district-activities.json (los pinta el cliente delante) y sus postes."""
    import json
    import os
    path = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "realtime", "src", "district-activities.json")
    with open(path, encoding="utf-8") as f:
        boards = json.load(f).get("vertical", {}).get("boards", [])
    back = mat("metal", "#1b1f2e")
    edge = mat("neon", color)
    for b in boards:
        x, y, z = b["p"]
        w, h = b["size"]
        a = math.radians(b["yaw"])
        # Mira hacia (sin, cos) en (X, Z): el respaldo va detrás, hacia el lado contrario.
        fx, fz = math.sin(a), math.cos(a)
        q = Part("board")
        # El título va encima del panel: el respaldo lo tapa también (de espaldas no se lee al revés).
        top = h / 2 + 0.95
        q.box((-w / 2 - 0.15, 0.04, -h / 2 - 0.15), (w / 2 + 0.15, 0.2, top), back)
        if detail:
            q.box((-w / 2 - 0.2, 0.0, top - 0.05), (w / 2 + 0.2, 0.06, top + 0.05), edge)
            q.box((-w / 2 - 0.2, 0.0, -h / 2 - 0.2), (w / 2 + 0.2, 0.06, -h / 2 - 0.1), edge)
        # El de encima de la torre de salida, con postes hasta su plataforma; los demás van en un muro.
        if abs(x - 32) < 4 and abs(z - 21.9) < 3:
            for sx in (-1, 1):
                q.box((sx * (w / 2 - 0.3) - 0.08, 0.06, START["y"] - y), (sx * (w / 2 - 0.3) + 0.08, 0.2, -h / 2 - 0.15), back)
        # Local: ancho en X, la cara hacia −Y (= +Z del mundo con giro 0); se gira con el marcador.
        m = Matrix.Translation((x - C, -(z - C), y)) @ Matrix.Rotation(a, 4, "Z")
        p.merge(q, m)
        q.bm.free()


def build(p: Part, color: str, detail: int) -> None:
    _boards(p, color, detail)
    pl, _marks = plan()
    rnd = random.Random(42)
    deck = mat("metal", "#3a3f4a")
    post = mat("hierro", "#4a4f5c")
    for it in pl.items:
        k = it["kind"]
        if k == "trailer":
            _trailer(p, it, rnd, detail, color)
            if it.get("cantilever") and detail:
                # Riostra diagonal bajo el voladizo.
                x0, z0, x1, z1, y0 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"]
                along_x = (x1 - x0) > (z1 - z0)
                if along_x:
                    p.tube([(x0 - C, -((z0 + z1) / 2 - C), y0 - 1.6), (x1 - C, -((z0 + z1) / 2 - C), y0)], 0.07, post, segments=4)
                else:
                    p.tube([((x0 + x1) / 2 - C, -(z0 - C), y0 - 1.6), ((x0 + x1) / 2 - C, -(z1 - C), y0)], 0.07, post, segments=4)
        elif k == "plank":
            _plank(p, it, detail)
        elif k == "beam":
            _beam(p, it)
        elif k == "pipe":
            _pipe(p, it, detail)
        elif k == "post":
            _box(p, it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"], post)
        elif k == "deck":
            _box(p, it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"], deck)
            _box(p, it["x0"] - 0.02, it["z0"] - 0.02, it["x1"] + 0.02, it["z1"] + 0.02, it["y0"], it["y0"] + 0.06, mat("neon", color), skip=("+z", "-z"))
        elif k == "crate":
            _crate(p, it, detail)
        elif k == "ac":
            _box(p, it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"], mat("metal", "#c8ccd4"))
            if detail:
                cx, cz = (it["x0"] + it["x1"]) / 2, (it["z0"] + it["z1"]) / 2
                p.cylinder((cx - C, -(cz - C), it["y1"]), 0.26, 0.03, mat("metal", "#2b2f38"), segments=10)
        elif k == "wall":
            _wall(p, it, color, detail)
    if detail:
        _lights(p, pl, rnd, color)


def _lights(p: Part, pl: Plan, rnd: random.Random, color: str) -> None:
    """Guirnaldas de bombillas entre caravanas de la ruta (de noche se ve el camino)."""
    bulb = mat("farol", "#ffd27a")
    wire = mat("hierro", "#2b2f38")
    route = [it for it in pl.items if it["kind"] == "trailer" and it.get("route")]
    for a, b in zip(route, route[1:]):
        ax, az = (a["x0"] + a["x1"]) / 2, (a["z0"] + a["z1"]) / 2
        bx, bz = (b["x0"] + b["x1"]) / 2, (b["z0"] + b["z1"]) / 2
        d = math.hypot(bx - ax, bz - az)
        if d > 14 or d < 3:
            continue
        ya, yb = a["y1"] + 2.6, b["y1"] + 2.6
        p.tube([(ax - C, -(az - C), ya), (bx - C, -(bz - C), yb)], 0.012, wire, segments=3)
        n = int(d // 1.2)
        for k in range(1, n):
            t = k / n
            sag = math.sin(t * math.pi) * 0.45
            p.sphere((ax + (bx - ax) * t - C, -(az + (bz - az) * t - C), ya + (yb - ya) * t - sag), 0.06, bulb, subdiv=0)


def flag_object(detail: int):
    """El banderín de la búsqueda de Vertical: mástil corto con su peana y un banderín triangular que brilla."""
    p = Part("vertical_flag")
    pole = mat("hierro", "#2b2f38")
    p.cylinder((0, 0, 0), 0.03, 1.1, pole, segments=6 if detail else 4)
    p.cylinder((0, 0, 0), 0.16, 0.05, pole, segments=10 if detail else 6)
    # Perfil (y, z) extruido a lo largo de X: el triángulo sale del mástil hacia +Y.
    p.prism([(0.0, 0.6), (0.52, 0.82), (0.0, 1.05)], -0.012, 0.012, mat("neon", ORANGE))
    p.sphere((0, 0, 1.12), 0.05, mat("neon", "#ffd27a"), subdiv=1)
    ob = p.to_object()
    ob.name = "vertical_flag"
    finish(ob)
    return ob
