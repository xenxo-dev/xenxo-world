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
actividades. Las torres de alrededor van en su propio modelo (`towers_object`, la pieza
`vertical_towers`, que el servidor pone como atrezo): así la ruta y el Patio caben con su detalle en
el presupuesto de un modelo. Materiales de verdad: chapa ondulada, óxido, hormigón y hormigón pintado
(tools/materials/fetch.py). Las farolas del Patio salen de `lights` en district-activities.json, la
misma lista con la que el servidor pone su luz (light@1).

Coordenadas del chunk (X este, Z sur, Y arriba); el modelo va centrado en el chunk (Blender:
x = X − 32, y = −(Z − 32), z arriba), como el resto de la ciudad (city.py).
"""
from __future__ import annotations

import json
import math
import os
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
RAIL = 1.05    # barandillas de las plataformas
LAMP_H = 4.3   # farolas del Patio: altura del poste

ACTIVITIES = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "realtime", "src", "district-activities.json")


def _activities() -> dict:
    with open(ACTIVITIES, encoding="utf-8") as f:
        return json.load(f).get("vertical", {})


def lamps() -> list[dict]:
    """Farolas del Patio: la misma lista con la que el servidor pone sus luces (light@1)."""
    return _activities().get("lights", [])


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
    pl.add("deck", x0, z0, x1, z1, y - 0.2, y, exit="N")
    for (px, pz) in ((x0 + 0.15, z0 + 0.15), (x1 - 0.15, z0 + 0.15), (x0 + 0.15, z1 - 0.15), (x1 - 0.15, z1 - 0.15)):
        pl.add("post", px - 0.15, pz - 0.15, px + 0.15, pz + 0.15, 0, y - 0.2)
    # Escalera de cajas hacia el oeste: cada una 1,2 m más alta (se sube de una en una).
    for k in range(4):
        h = 1.2 * (k + 1)
        pl.add("crate", x0 - 1.25 * (4 - k), z0, x0 - 1.25 * (3 - k) - 0.05, z0 + 1.25, 0, h)
    marks.append(("start", ((x0 + x1) / 2, (z0 + z1) / 2), y))
    # Llegada: plataforma al oeste (desde el último cruce) y salto a la plaza.
    fx0, fz0, fx1, fz1 = FINISH["deck"]
    pl.add("deck", fx0, fz0, fx1, fz1, FINISH["y"] - 0.2, FINISH["y"], exit="E")
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
    pl.add("wall", 24.4, 24.0, 25.0, 27.5, 0, roof(1), station="chimney", inner="+x")
    pl.add("wall", 26.6, 24.0, 27.2, 27.5, 0, roof(1), station="chimney", inner="-x")
    marks.append(("flag", (24.7, 25.75), roof(1)))
    pl.add("wall", 20.6, 35.0, 21.1, 40.6, 0, 4.0, station="wallrun")
    # La torre de salida es de acero: cruces en los lados cortos (cierran por debajo: las cajas
    # tapan el oeste) y barandilla donde no se entra ni se sale (sur y este). En la llegada, a los
    # lados por los que no se llega (por el oeste, el tablón) ni se salta a la plaza (este).
    for x in (x0 + 0.15, x1 - 0.15):
        pl.add("brace", x - 0.04, z0 + 0.3, x + 0.04, z1 - 0.3, 0, y - 0.2)
    pl.add("rail", x0, z1 - 0.06, x1, z1, y, y + RAIL)
    pl.add("rail", x1 - 0.06, z0, x1, z1 - 0.06, y, y + RAIL)
    pl.add("rail", x0, z0 + 1.45, x0 + 0.06, z1 - 0.06, y, y + RAIL)  # al oeste, menos por donde llegan las cajas
    for z in (fz0, fz1 - 0.06):
        pl.add("rail", fx0, z, fx1, z + 0.06, FINISH["y"], FINISH["y"] + RAIL)
    # Farolas (las luces van en district-activities.json, como datos: el servidor pone su light@1).
    for lt in lamps():
        x, _y, z = lt["p"]
        pl.add("lamp", x - 0.1, z - 0.1, x + 0.1, z + 0.1, 0, LAMP_H)


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
            n0 = len(pl.items)
            b.stack(cu - (TL / 2 if along_x else HALF), cv - (HALF if along_x else TL / 2), cu + (TL / 2 if along_x else HALF), cv + (HALF if along_x else TL / 2), top, route=False)
            # Las torres van en su propio modelo (towers_object); la de arriba lleva lo de la azotea.
            for it in pl.items[n0:]:
                it["tower"] = True
            pl.items[n0]["top"] = True
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


def _bl(x: float, z: float, y: float) -> tuple[float, float, float]:
    """Punto del chunk (X, Z y la altura) en el modelo (Blender: x = X − 32, y = −(Z − 32), z arriba)."""
    return (x - C, -(z - C), y)


def _face(p: Part, pts: list, m, toward: tuple[float, float, float]) -> None:
    """Cara plana (puntos del modelo) que mira hacia `toward`: se le da la vuelta si hace falta."""
    n = [0.0, 0.0, 0.0]
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n[0] += (a[1] - b[1]) * (a[2] + b[2])
        n[1] += (a[2] - b[2]) * (a[0] + b[0])
        n[2] += (a[0] - b[0]) * (a[1] + b[1])
    if n[0] * toward[0] + n[1] * toward[1] + n[2] * toward[2] < 0:
        pts = list(reversed(pts))
    p.poly(pts, m)


def _catenary(p: Part, a, b, sag: float, wire, bulb=None, every: float = 1.0, n: int = 8) -> None:
    """Cable colgado entre dos puntos del chunk (X, Y, Z) con su comba y, si lleva, sus bombillas."""
    ax, ay, az = a
    bx, by, bz = b

    def at(t: float, drop: float = 0.0):
        return _bl(ax + (bx - ax) * t, az + (bz - az) * t, ay + (by - ay) * t - sag * 4 * t * (1 - t) - drop)

    p.tube([at(k / n) for k in range(n + 1)], 0.012, wire, segments=3)
    if bulb is not None:
        m = max(2, int(math.dist(a, b) / every))
        for k in range(1, m):
            p.sphere(at(k / m, 0.07), 0.055, bulb, subdiv=0)


# Dos tonos de caravana: la carrocería (crema o pastel) y su banda baja.
# (Pocos tonos: cada material es una llamada de dibujo más en las gafas.)
SHELLS = ["#e3d3b4", "#d6dccb", "#e8cfb2", "#c9d6dc", "#dcc6d0", "#e6dca8"]
BANDS = ["#2f5f95", "#2f7d6a", "#b5523b", "#c88a2a", "#6a4c8c", "#9a3a3a"]
TRIM = "#f2efe6"          # filete, puerta y marcos de las ventanas
# Lo viejo: chasis, vigas, pilares y riostras de acero con óxido; y algunas bandas que el óxido ya se come.
RUST = "#3b3632"
STEEL = "#6a625a"
RUSTY_BANDS = ["#7a4a32", "#4f5f78"]
# El Patio: hormigón, muros pintados con su mural, chapa y el amarillo de los bordes.
CONCRETE = "#c2bdb3"
CONCRETE_DARK = "#8f8a80"
TEAL = "#3f9c93"
CORAL = "#e0715a"
YELLOW = "#f2c230"
GALV = "#c9ced6"          # acero galvanizado (barandillas y farolas)
SHEET = "#5f8fa8"         # la chapa de la pared de correr
AWNINGS = ["#c8553d", "#2f7d6a", "#d9a441"]
CLOTHES = ["#d94f4f", "#f2e6c9"]
SIGN = "#4fe3ff"           # pantallas de los rótulos (el marco, del color del distrito)
DARK = "#3a3f4a"           # postes, cables y antenas
PALE = "#e4e6ea"           # parabólicas y casetas
GREY = "#c8ccd4"           # aparatos del aire, claraboyas y depósitos
BULB = "#ffd27a"           # bombillas y faroles
LATH = "#6a4f33"           # listones de tablones y cajas


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
    Una caravana de las de antes: carrocería de chapa ondulada crema o pastel con las esquinas de arriba
    redondeadas, banda de color abajo (en las viejas, comida por el óxido) con un filete claro, chasis
    oxidado, ventanas con su marco (de noche, unas encendidas), la puerta con su ventanuco y el ventanal
    del morro. Las de la ruta llevan un filo de luz en los bordes del techo y el amarillo de dónde se
    salta; las de las torres y las del suelo, a veces, un toldo, el aparato del aire o un rótulo; la de
    arriba de cada torre, su azotea (depósito, tendedero, huerto o antenas).
    """
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    along_x = (x1 - x0) >= (z1 - z0)
    L = (x1 - x0) if along_x else (z1 - z0)
    W = (z1 - z0) if along_x else (x1 - x0)
    H = y1 - y0
    # Todo lo que se sortea, primero y siempre igual: los dos niveles de detalle salen iguales.
    flip = rnd.random() < 0.5  # el morro hacia un lado o el otro
    shell_tint = rnd.choice(SHELLS)
    band_tint = rnd.choice(BANDS)
    rusty = rnd.random() < 0.3
    rusty_tint = rnd.choice(RUSTY_BANDS)
    door_side = -1 if rnd.random() < 0.5 else 1
    r = rnd.random()
    antenna = 1.6 + rnd.random()
    extra = rnd.random()
    pick = rnd.randrange(12)
    if not detail:
        # El nivel ligero (gafas y móviles; nunca se ve junto al otro): menos tonos y sin óxido en las
        # bandas, que cada material es una llamada de dibujo más.
        shell_tint = SHELLS[SHELLS.index(shell_tint) % 3]
        band_tint = BANDS[BANDS.index(band_tint) % 3]
        rusty = False
    shell = mat("chapa", shell_tint)
    glass = mat("ventana", "#2c3a4a")
    band = mat("oxido", rusty_tint) if rusty else mat("chapa", band_tint)
    trim = mat("chapa", TRIM)
    route = bool(it.get("route"))
    q = Part("caravana")
    yb = 0.14
    # En local: largo en Y (0..L), ancho en X (−W/2..W/2), alto en Z; se coloca después.
    q.box((-W / 2 + 0.3, 0.3, 0), (W / 2 - 0.3, L - 0.3, yb), mat("oxido", RUST), skip=("-z",))
    q.prism(_profile(L, H, yb, 0.55 if detail else 0.32, 3 if detail else 1), -W / 2, W / 2, shell)
    # Dos tonos: la parte de abajo del color de la banda, con un filete claro encima.
    q.box((-W / 2 - 0.015, 0.1, yb + 0.02), (W / 2 + 0.015, L - 0.1, yb + 0.95), band, skip=("-z",))
    q.box((-W / 2 - 0.02, 0.06, yb + 0.95), (W / 2 + 0.02, L - 0.06, yb + 1.02), trim, skip=("-z",))
    # La puerta (con su ventanuco) a un lado; las ventanas, con su marco claro, donde no la tapen.
    dy = L - 1.3 if L > 4 else L / 2
    n = 2 if L > 5 else 1
    thin = () if detail else ("+y", "-y")
    wins = []
    for sx in (-1, 1):
        inner = "+x" if sx < 0 else "-x"
        for k in range(n):
            c = (k + 1) * L / (n + 1) + (0.4 if k == 0 else -0.4)
            if sx == door_side and abs(c - dy) < 1.15:
                continue
            wins.append((sx, c))
            xa = -W / 2 - 0.02 if sx < 0 else W / 2
            # En el nivel ligero, de los cantos de 2 cm (cristal, puerta, ventanal) solo su cara de fuera.
            q.box((xa, c - 0.6, yb + 1.34), (xa + 0.02, c + 0.6, yb + 1.96), glass, skip=(inner, "+z", "-z") + thin)
            if detail:  # el marco: una placa clara algo mayor entre la chapa y el cristal (su cara de fuera)
                xf = -W / 2 - 0.011 if sx < 0 else W / 2
                q.box((xf, c - 0.68, yb + 1.27), (xf + 0.011, c + 0.68, yb + 2.03), trim, skip=(inner, "+z", "-z", "+y", "-y"))
    sx = door_side
    xa = -W / 2 - 0.022 if sx < 0 else W / 2 + 0.002
    q.box((xa, dy - 0.38, yb + 0.06), (xa + 0.02, dy + 0.38, yb + 2.05), trim, skip=("+x" if sx < 0 else "-x", "+z", "-z") + thin)
    if detail:
        q.box((xa - 0.004 if sx < 0 else xa + 0.004, dy - 0.18, yb + 1.45), (xa + 0.016 if sx < 0 else xa + 0.024, dy + 0.18, yb + 1.85), glass, skip=("+x" if sx < 0 else "-x",))
    q.box((-W / 2 + 0.45, -0.025, yb + 1.3), (W / 2 - 0.45, 0.0, yb + 1.85), glass, skip=("+y", "+z", "-z") + (() if detail else ("+x", "-x")))
    if detail:
        q.box((-W / 2 + 0.15, -0.02, yb + 0.6), (-W / 2 + 0.35, 0.0, yb + 0.72), mat("farol", BULB), skip=("+y",))
    if route:
        # Un filo de luz en los dos bordes del techo (de noche se ve por dónde va la ruta) y el
        # amarillo de los extremos, de donde se salta.
        rc = 0.6
        for sx in (-1, 1):
            xe = -W / 2 - 0.015 if sx < 0 else W / 2
            q.box((xe, rc, H - 0.07), (xe + 0.015, L - rc, H - 0.02), mat("neon", color), skip=("+x" if sx < 0 else "-x", "+y", "-y"))
        for (a, b) in ((rc, rc + 0.3), (L - rc - 0.3, L - rc)):
            q.box((-W / 2 + 0.06, a, H), (W / 2 - 0.06, b, H + 0.008), mat("pintado", YELLOW), skip=("-z",))
        if detail:  # juntas de la chapa del techo
            seam = mat("metal", GALV)
            k = rc + 1.25
            while k < L - rc - 0.9:
                q.box((-W / 2 + 0.05, k - 0.025, H), (W / 2 - 0.05, k + 0.025, H + 0.012), seam, skip=("-z",))
                k += 1.25
    elif detail and (it.get("tower") or it.get("level", 0) == 0):
        # La vida de fuera de la ruta: toldo sobre la puerta, el aparato del aire bajo una ventana o,
        # en lo alto de las torres, un rótulo de neón en la trasera.
        if extra < 0.3:
            _awning(q, W, dy, yb, door_side, mat("toldo", AWNINGS[pick % len(AWNINGS)]))
        elif extra < 0.5 and wins:
            ws, wc = wins[pick % len(wins)]
            xs, xo = ws * W / 2, ws * (W / 2 + 0.42)
            q.box((min(xs, xo), wc - 0.32, yb + 0.95), (max(xs, xo), wc + 0.32, yb + 1.33), mat("metal", GREY), skip=("+x" if ws < 0 else "-x",))
            xg = xo + ws * 0.004
            q.box((min(xo, xg), wc - 0.26, yb + 1.0), (max(xo, xg), wc + 0.26, yb + 1.28), mat("metal", "#2b2f38"), skip=("+x" if ws < 0 else "-x",))
        elif extra < 0.62 and it.get("level", 0) >= 2:
            _sign(q, L, W, H, yb, color)
    if it.get("top"):
        _roof_life(q, L, W, H, pick, detail)
    elif detail and not route:
        # En el techo, a veces: claraboya, antena con su parabólica o placas solares.
        if r < 0.25:
            q.box((-0.45, L * 0.5 - 0.35, H), (0.45, L * 0.5 + 0.35, H + 0.5), mat("metal", GREY))
        elif r < 0.4:
            q.cylinder((0.6, L * 0.3, H), 0.03, antenna, mat("hierro", DARK), segments=4)
            q.lathe((0.6, L * 0.3, H + 1.0), [(0.02, 0.0), (0.32, 0.12), (0.36, 0.14)], mat("chapa", PALE), segments=10)
        elif r < 0.55:
            q.box((-W / 2 + 0.25, 0.8, H), (W / 2 - 0.25, L - 0.8, H + 0.06), mat("chapa", "#1d2c4a"))
    # Colocar: el largo (Y local) a lo largo de X o de Z del mundo; el morro a un lado u otro.
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    rot = (-math.pi / 2 if along_x else 0.0) + (math.pi if flip else 0.0)
    m = Matrix.Translation((cx - C, -(cz - C), y0)) @ Matrix.Rotation(rot, 4, "Z") @ Matrix.Translation((0, -L / 2, 0))
    p.merge(q, m)
    q.bm.free()


def _awning(q: Part, W: float, y: float, yb: float, side: int, m) -> None:
    """Toldo sobre la puerta: empinado (sus rayas van hacia abajo), con su faldón."""
    xw, xo = side * (W / 2 + 0.01), side * (W / 2 + 0.6)
    zt, zb = yb + 2.35, yb + 1.62
    ya, yz = y - 0.95, y + 0.95
    out = (side * 1.0, 0.0, 0.8)
    top = [(xw, ya, zt), (xw, yz, zt), (xo, yz, zb), (xo, ya, zb)]
    _face(q, top, m, out)
    _face(q, [(x, yy, z - 0.015) for (x, yy, z) in top], m, (-out[0], 0.0, -out[2]))
    q.box((min(xo, xo + side * 0.02), ya, zb - 0.2), (max(xo, xo + side * 0.02), yz, zb), m, skip=("+z",))


def _sign(q: Part, L: float, W: float, H: float, yb: float, color: str) -> None:
    """Rótulo de la trasera: pantalla viva (sin letras) con su marco de neón del color del distrito."""
    hw, z0, z1 = 0.75, yb + 1.05, yb + 1.75
    q.box((-hw, L + 0.03, z0), (hw, L + 0.05, z1), mat("pantalla", SIGN), skip=("-y", "+z", "-z", "+x", "-x"))
    neon = mat("neon", color)
    e = 0.05
    for (a0, b0, a1, b1) in ((-hw - e, z1, hw + e, z1 + e), (-hw - e, z0 - e, hw + e, z0), (-hw - e, z0, -hw, z1), (hw, z0, hw + e, z1)):
        q.box((a0, L + 0.02, b0), (a1, L + 0.08, b1), neon, skip=("-y",))


def _roof_life(q: Part, L: float, W: float, H: float, pick: int, detail: int) -> None:
    """La azotea de arriba de cada torre: depósito de agua, tendedero, huerto en cajones o antenas."""
    kind = pick % 4
    seg = 10 if detail else 6
    if kind == 0:  # depósito de agua en su base de acero
        tank = mat("metal", GREY)
        legs = mat("oxido", STEEL)
        cy = L * 0.3
        for (lx, ly) in ((-0.45, cy - 0.45), (0.45, cy - 0.45), (-0.45, cy + 0.45), (0.45, cy + 0.45)):
            q.box((lx - 0.04, ly - 0.04, H), (lx + 0.04, ly + 0.04, H + 0.6), legs, skip=("-z", "+z"))
        q.box((-0.55, cy - 0.55, H + 0.6), (0.55, cy + 0.55, H + 0.68), legs)
        q.cylinder((0, cy, H + 0.68), 0.62, 1.25, tank, segments=seg, caps=(False, False))
        q.lathe((0, cy, H + 1.93), [(0.62, 0.0), (0.32, 0.2), (0.05, 0.28)], tank, segments=seg, close_top=True)
    elif kind == 1:  # tendedero con la ropa
        pole = mat("hierro", DARK)
        for y in (1.0, L - 1.0):
            q.cylinder((0, y, H), 0.03, 1.75, pole, segments=4)
        if detail:
            pts = [(0.0, 1.0 + (L - 2.0) * t, H + 1.7 - 0.25 * 4 * t * (1 - t)) for t in (k / 6 for k in range(7))]
            q.tube(pts, 0.008, pole, segments=3)
            for k in range(4):
                t = (k + 0.8) / 4.6
                y, z = 1.0 + (L - 2.0) * t, H + 1.7 - 0.25 * 4 * t * (1 - t)
                q.box((-0.006, y - 0.24, z - 0.62), (0.006, y + 0.24, z), mat("tela", CLOTHES[(pick + k) % len(CLOTHES)]), skip=("+z", "-z"))
    elif kind == 2:  # huerto en cajones
        wood = mat("madera", "#8a6a48")
        leaf = mat("hoja", "#5d8f45")
        for y in (1.3, L / 2, L - 1.3):
            q.box((-0.5, y - 0.4, H), (0.5, y + 0.4, H + 0.42), wood, skip=("-z",))
            q.sphere((0, y, H + 0.62), 0.5, leaf, subdiv=1 if detail else 0, squash=0.65)
    else:  # caseta, antenas y parabólica
        q.box((-0.6, L - 1.9, H), (0.6, L - 0.7, H + 1.0), mat("chapa", PALE), skip=("-z",))
        pole = mat("hierro", DARK)
        q.cylinder((0.5, 1.0, H), 0.03, 2.4, pole, segments=4)
        q.cylinder((-0.5, 1.6, H), 0.03, 1.8, pole, segments=4)
        q.lathe((0.0, L * 0.45, H + 0.6), [(0.02, 0.0), (0.42, 0.14), (0.46, 0.16)], mat("chapa", PALE), segments=seg)
        q.cylinder((0.0, L * 0.45, H), 0.04, 0.6, pole, segments=4)


def _plank(p: Part, it: dict, detail: int) -> None:
    """Tablón: tablas de madera con su canto."""
    _box(p, it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"], mat("madera", "#8a6a48"))
    if detail:
        along_x = (it["x1"] - it["x0"]) > (it["z1"] - it["z0"])
        L = (it["x1"] - it["x0"]) if along_x else (it["z1"] - it["z0"])
        k = 0.0
        while k < L:
            if along_x:
                _box(p, it["x0"] + k, it["z0"] - 0.02, it["x0"] + k + 0.06, it["z1"] + 0.02, it["y1"] - 0.01, it["y1"] + 0.005, mat("madera", LATH))
            else:
                _box(p, it["x0"] - 0.02, it["z0"] + k, it["x1"] + 0.02, it["z0"] + k + 0.06, it["y1"] - 0.01, it["y1"] + 0.005, mat("madera", LATH))
            k += 1.1


def _beam(p: Part, it: dict) -> None:
    """Viga en I de acero viejo; la del Patio (equilibrio), con el ala de arriba pintada de amarillo."""
    m = mat("oxido", STEEL)
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    along_x = (x1 - x0) > (z1 - z0)
    _box(p, x0, z0, x1, z1, y1 - 0.06, y1, mat("pintado", YELLOW) if it.get("station") else m)
    _box(p, x0, z0, x1, z1, y0, y0 + 0.06, m)
    if along_x:
        c = (z0 + z1) / 2
        _box(p, x0, c - 0.03, x1, c + 0.03, y0 + 0.06, y1 - 0.06, m, skip=("+z", "-z"))
    else:
        c = (x0 + x1) / 2
        _box(p, c - 0.03, z0, c + 0.03, z1, y0 + 0.06, y1 - 0.06, m, skip=("+z", "-z"))


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


def _column(p: Part, it: dict) -> None:
    """Pilar de acero en H (los de las plataformas), con su placa en el suelo."""
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    m = mat("oxido", STEEL)
    t = 0.025
    _box(p, x0, z0, x1, z0 + t, y0, y1, m, skip=("-z", "+z"))
    _box(p, x0, z1 - t, x1, z1, y0, y1, m, skip=("-z", "+z"))
    cx = (x0 + x1) / 2
    _box(p, cx - t / 2, z0 + t, cx + t / 2, z1 - t, y0, y1, m, skip=("-z", "+z", "-y", "+y"))
    _box(p, x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, y0, y0 + 0.025, m, skip=("-z",))


def _brace(p: Part, it: dict, detail: int) -> None:
    """Cruz de San Andrés entre dos pilares (su caja cierra el lado: no se pasa por en medio)."""
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    m = mat("oxido", STEEL)
    if (x1 - x0) < (z1 - z0):
        xc = (x0 + x1) / 2
        a0, a1, b0, b1 = _bl(xc, z0, y0 + 0.3), _bl(xc, z1, y1 - 0.3), _bl(xc, z1, y0 + 0.3), _bl(xc, z0, y1 - 0.3)
        ties = [(_bl(xc, z0, y), _bl(xc, z1, y)) for y in (y0 + 0.3, y1 - 0.3)]
    else:
        zc = (z0 + z1) / 2
        a0, a1, b0, b1 = _bl(x0, zc, y0 + 0.3), _bl(x1, zc, y1 - 0.3), _bl(x1, zc, y0 + 0.3), _bl(x0, zc, y1 - 0.3)
        ties = [(_bl(x0, zc, y), _bl(x1, zc, y)) for y in (y0 + 0.3, y1 - 0.3)]
    p.tube([a0, a1], 0.035, m, segments=4)
    p.tube([b0, b1], 0.035, m, segments=4)
    if detail:
        for (u, v) in ties:
            p.tube([u, v], 0.035, m, segments=4)


def _rail(p: Part, it: dict, detail: int) -> None:
    """Barandilla de acero pintado: postes, pasamanos, una barra en medio y el rodapié amarillo."""
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    m = mat("pintado", GALV)
    seg = 6 if detail else 4
    along_x = (x1 - x0) > (z1 - z0)
    L = (x1 - x0) if along_x else (z1 - z0)

    def at(s: float, y: float):
        return _bl(x0 + s, (z0 + z1) / 2, y) if along_x else _bl((x0 + x1) / 2, z0 + s, y)

    n = max(1, round(L / 1.2))
    for k in range(n + 1):
        s = 0.04 + (L - 0.08) * k / n
        p.cylinder(at(s, y0), 0.022, y1 - y0 - 0.03, m, segments=seg)
    p.tube([at(0.0, y1 - 0.03), at(L, y1 - 0.03)], 0.03, m, segments=seg)
    if detail:
        p.tube([at(0.0, y0 + 0.5), at(L, y0 + 0.5)], 0.016, m, segments=4)
        if along_x:
            _box(p, x0, (z0 + z1) / 2 - 0.01, x1, (z0 + z1) / 2 + 0.01, y0, y0 + 0.1, mat("pintado", YELLOW))
        else:
            _box(p, (x0 + x1) / 2 - 0.01, z0, (x0 + x1) / 2 + 0.01, z1, y0, y0 + 0.1, mat("pintado", YELLOW))


def _deck(p: Part, it: dict, color: str) -> None:
    """Plataforma de chapa con su perfil de acero alrededor, el filo de luz y el amarillo de por dónde se sale."""
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    _box(p, x0, z0, x1, z1, y0, y1, mat("metal", "#3a3f4a"))
    _box(p, x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02, y0 + 0.06, y1, mat("oxido", STEEL), skip=("+z", "-z"))
    _box(p, x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02, y0, y0 + 0.06, mat("neon", color), skip=("+z", "-z"))
    paint = mat("pintado", YELLOW)
    if it.get("exit") == "N":
        _box(p, x0, z0, x1, z0 + 0.18, y1, y1 + 0.006, paint, skip=("-z",))
    elif it.get("exit") == "E":
        _box(p, x1 - 0.18, z0, x1, z1, y1, y1 + 0.006, paint, skip=("-z",))


def _crate(p: Part, it: dict, detail: int) -> None:
    """Pila de cajas de madera: una caja cada 1,2 m, con sus listones y sus esquineras."""
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    wood = mat("madera", "#b0844e")
    lath = mat("madera", LATH)
    y = y0
    while y < y1 - 0.01:
        h = min(1.2, y1 - y)
        _box(p, x0, z0, x1, z1, y, y + h, wood)
        if detail:
            _box(p, x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, y + h - 0.1, y + h, lath, skip=("+z", "-z"))
            _box(p, x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, y, y + 0.1, lath, skip=("+z", "-z"))
            for (cx, cz) in ((x0, z0), (x1, z0), (x0, z1), (x1, z1)):
                _box(p, cx - 0.04, cz - 0.04, cx + 0.04, cz + 0.04, y + 0.1, y + h - 0.1, lath, skip=("+z", "-z"))
        y += h


def _wall(p: Part, it: dict, color: str, detail: int) -> None:
    """
    Muros del Patio, con el canto de acero naranja (se ve de dónde agarrarse) y su zócalo: hormigón
    (vallas y chimenea, con las marcas amarillas de por dónde se sube rebotando), muros pintados con un
    mural (colgarse y subir por la pared) y la pared de chapa con sus pilares (correr por ella).
    """
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    st = it.get("station")
    cap = mat("pintado", ORANGE)
    if st == "wallrun":
        steel = mat("oxido", STEEL)
        # Pilares a ras de la caja (de por donde se corre no sobresale nada) y la chapa, metida 3 cm.
        for cz in (z0, (z0 + z1) / 2 - 0.1, z1 - 0.2):
            _box(p, x0, cz, x1, cz + 0.2, y0, y1 - 0.07, steel, skip=("-z",))
        _box(p, x0 + 0.03, z0 + 0.2, x1 - 0.03, z1 - 0.2, y0, y1 - 0.07, mat("chapa", SHEET), skip=("-z", "+y", "-y"))
    else:
        body = mat("pintado", TEAL if st == "hang" else CORAL) if st in ("hang", "wallup") else mat("hormigon", CONCRETE)
        _box(p, x0, z0, x1, z1, y0, y1 - 0.07, body, skip=("-z",))
        _box(p, x0 - 0.01, z0 - 0.01, x1 + 0.01, z1 + 0.01, y0, y0 + 0.14, mat("hormigon", CONCRETE_DARK), skip=("-z", "+z"))
    _box(p, x0 - 0.012, z0 - 0.012, x1 + 0.012, z1 + 0.012, y1 - 0.07, y1, cap)
    if st in ("hang", "wallup"):
        # Mural en la cara de donde se llega (norte): tres franjas en diagonal.
        h0, h1 = y0 + 0.35, y1 - 0.35
        run = (h1 - h0) * (1.0 if st == "hang" else -0.6)
        cols = (YELLOW, TRIM, CORAL) if st == "hang" else (TEAL, YELLOW, TRIM)
        zf = z0 - 0.006
        for k, tint in enumerate(cols):
            a = x0 + 0.45 + 0.75 * k if run > 0 else x1 - 0.45 - 0.45 - 0.9 * k
            pts = [_bl(a, zf, h0), _bl(a + 0.45, zf, h0), _bl(a + 0.45 + run, zf, h1), _bl(a + run, zf, h1)]
            _face(p, pts, mat("pintado", tint), (0.0, 1.0, 0.0))
    if st == "chimney":
        # Marcas amarillas en la cara de dentro: por aquí se sube, de una pared a la otra.
        xi = x1 if it.get("inner") == "+x" else x0
        sgn = 1 if it.get("inner") == "+x" else -1
        for h in (1.0, 2.0, 3.0, 4.0, 5.0):
            _box(p, min(xi, xi + sgn * 0.008), z0 + 0.2, max(xi, xi + sgn * 0.008), z1 - 0.2, h, h + 0.12, mat("pintado", YELLOW), skip=("-x" if sgn > 0 else "+x",))
    if detail and y1 > 2:
        _box(p, x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02, 0.9, 1.0, mat("neon", color), skip=("+z", "-z"))


def _lamp(p: Part, x: float, z: float, detail: int) -> None:
    """Farola del Patio: poste pintado con su base, y arriba una campana oscura con la bombilla dentro."""
    seg = 8 if detail else 5
    dark = mat("hierro", DARK)
    p.cylinder(_bl(x, z, 0), 0.11, 0.4, dark, segments=seg)
    p.cylinder(_bl(x, z, 0.4), 0.06, LAMP_H - 0.4, mat("pintado", GALV), segments=seg, radius_top=0.045, caps=(False, False))
    ring = seg * 2 if detail else seg + 1
    p.lathe(_bl(x, z, LAMP_H - 0.34), [(0.3, 0.0), (0.29, 0.04), (0.2, 0.2), (0.07, 0.32), (0.05, 0.36)], dark, segments=ring, close_top=True)
    p.lathe(_bl(x, z, LAMP_H - 0.3), [(0.0, 0.0), (0.13, 0.04), (0.15, 0.12), (0.06, 0.2)], mat("farol", BULB), segments=ring, smooth=True)


def _festoon(p: Part) -> None:
    """Guirnalda de bombillas de farola a farola alrededor del Patio (de noche)."""
    pts = [lt["p"] for lt in lamps()]
    if len(pts) < 2:
        return
    wire = mat("hierro", DARK)
    bulb = mat("farol", BULB)
    for a, b in zip(pts, pts[1:] + pts[:1]):
        ya = yb = LAMP_H - 0.3
        _catenary(p, (a[0], ya, a[2]), (b[0], yb, b[2]), 0.6, wire, bulb, every=0.9, n=10)


def _boards(p: Part, color: str, detail: int) -> None:
    """Respaldo de los marcadores de district-activities.json (los pinta el cliente delante) y sus postes."""
    back = mat("metal", "#3a3f4a")
    edge = mat("neon", color)
    for b in _activities().get("boards", []):
        x, y, z = b["p"]
        w, h = b["size"]
        a = math.radians(b["yaw"])
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
    """La ruta y el Patio, con sus farolas (las torres de alrededor van aparte: towers_object)."""
    _boards(p, color, detail)
    pl, _marks = plan()
    rnd = random.Random(42)
    for it in pl.items:
        if it.get("tower"):
            continue
        k = it["kind"]
        if k == "trailer":
            _trailer(p, it, rnd, detail, color)
            if it.get("cantilever") and detail:
                # Riostra diagonal bajo el voladizo.
                x0, z0, x1, z1, y0 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"]
                if (x1 - x0) > (z1 - z0):
                    p.tube([_bl(x0, (z0 + z1) / 2, y0 - 1.6), _bl(x1, (z0 + z1) / 2, y0)], 0.07, mat("oxido", STEEL), segments=4)
                else:
                    p.tube([_bl((x0 + x1) / 2, z0, y0 - 1.6), _bl((x0 + x1) / 2, z1, y0)], 0.07, mat("oxido", STEEL), segments=4)
        elif k == "plank":
            _plank(p, it, detail)
        elif k == "beam":
            _beam(p, it)
        elif k == "pipe":
            _pipe(p, it, detail)
        elif k == "post":
            if it["y1"] - it["y0"] > 3:
                _column(p, it)
            else:
                _box(p, it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"], mat("oxido", STEEL), skip=("-z",))
        elif k == "deck":
            _deck(p, it, color)
        elif k == "crate":
            _crate(p, it, detail)
        elif k == "ac":
            _box(p, it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"], mat("metal", GREY))
            if detail:
                cx, cz = (it["x0"] + it["x1"]) / 2, (it["z0"] + it["z1"]) / 2
                p.cylinder((cx - C, -(cz - C), it["y1"]), 0.26, 0.03, mat("metal", "#2b2f38"), segments=10)
        elif k == "wall":
            _wall(p, it, color, detail)
        elif k == "brace":
            _brace(p, it, detail)
        elif k == "rail":
            _rail(p, it, detail)
        elif k == "lamp":
            _lamp(p, (it["x0"] + it["x1"]) / 2, (it["z0"] + it["z1"]) / 2, detail)
    _festoon(p)


def _cables(p: Part, pl: Plan, rnd: random.Random) -> None:
    """Cables de torre a torre (con su vecina más cercana), y en la mitad, bombillas."""
    tops = [it for it in pl.items if it.get("top")]
    wire = mat("hierro", DARK)
    bulb = mat("farol", BULB)
    solid = [it for it in pl.items if it["kind"] == "trailer"]

    def centre(it):
        return (it["x0"] + it["x1"]) / 2, (it["z0"] + it["z1"]) / 2

    def exit_point(it, dx, dz):
        cx, cz = centre(it)
        hx, hz = (it["x1"] - it["x0"]) / 2, (it["z1"] - it["z0"]) / 2
        t = min(hx / abs(dx) if dx else 1e9, hz / abs(dz) if dz else 1e9)
        return cx + dx * (t + 0.02), cz + dz * (t + 0.02)

    done = set()
    for a in tops:
        ax, az = centre(a)
        near = sorted((math.hypot(centre(b)[0] - ax, centre(b)[1] - az), n) for n, b in enumerate(tops) if b is not a)
        lit = rnd.random() < 0.5
        for d, n in near[:2]:
            b = tops[n]
            key = tuple(sorted((id(a), id(b))))
            if key in done or not (6.0 < d < 24.0):
                continue
            done.add(key)
            bx, bz = centre(b)
            dx, dz = (bx - ax) / d, (bz - az) / d
            pa, pb = exit_point(a, dx, dz), exit_point(b, -dx, -dz)
            ya, yb = a["y1"] - 0.35, b["y1"] - 0.35
            sag = 0.25 + 0.05 * d
            # Que no atraviese ninguna caravana por el camino.
            clear = True
            for k in range(1, 12):
                t = k / 12
                x, z = pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t
                y = ya + (yb - ya) * t - sag * 4 * t * (1 - t)
                for it in solid:
                    if it is a or it is b:
                        continue
                    if it["x0"] - 0.1 < x < it["x1"] + 0.1 and it["z0"] - 0.1 < z < it["z1"] + 0.1 and it["y0"] - 0.1 < y < it["y1"] + 0.1:
                        clear = False
                        break
                if not clear:
                    break
            if clear:
                _catenary(p, (pa[0], ya, pa[1]), (pb[0], yb, pb[1]), sag, wire, bulb if lit else None, every=1.1)


def towers_object(color: str, detail: int):
    """
    Las torres de caravanas de alrededor (decorado y retos libres), en su propio modelo: con su azotea,
    sus cables de una a otra y, en la mitad de los cables, bombillas. Sus colisiones van con las de la
    ciudad (colliders()); el servidor las pone con el atrezo de district-activities.json.
    """
    p = Part("vertical_towers")
    pl, _marks = plan()
    rnd = random.Random(4242)
    for it in pl.items:
        if it.get("tower"):
            _trailer(p, it, rnd, detail, color)
    if detail:
        _cables(p, pl, random.Random(77))
    ob = p.to_object()
    ob.name = "vertical_towers"
    finish(ob)
    return ob


def flag_object(detail: int):
    """El banderín de la búsqueda de Vertical: mástil corto con su peana y un banderín triangular que brilla."""
    p = Part("vertical_flag")
    pole = mat("hierro", DARK)
    p.cylinder((0, 0, 0), 0.03, 1.1, pole, segments=6 if detail else 4)
    p.cylinder((0, 0, 0), 0.16, 0.05, pole, segments=10 if detail else 6)
    # Perfil (y, z) extruido a lo largo de X: el triángulo sale del mástil hacia +Y.
    p.prism([(0.0, 0.6), (0.52, 0.82), (0.0, 1.05)], -0.012, 0.012, mat("neon", ORANGE))
    p.sphere((0, 0, 1.12), 0.05, mat("neon", "#ffd27a"), subdiv=1)
    ob = p.to_object()
    ob.name = "vertical_flag"
    finish(ob)
    return ob
