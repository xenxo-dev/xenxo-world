"""
Vertical, el distrito del parkour (diseño de detalle).

**Las Pilas** (a lo Ready Player One: torres de caravanas en andamios de acero, que se escalan) en
el borde de la ciudad, y alrededor de la plaza **la Ruta de las Azoteas**: una
vuelta a la plaza por los tejados de siete manzanas, cruzando las calles por tablones, vigas y
caravanas en voladizo. En cada manzana, un reto del parkour de world/parkour (saltar huecos y vallas,
subir de un piso a otro, correr por la pared sobre un foso, deslizarse bajo un tubo, dejarse caer
rodando). En las esquinas, **chimeneas**: dos paredes de caravanas muy juntas por las que se sube
rebotando de una a otra. En la plaza, **el Patio**: el parque para aprender cada movimiento, con sus
carteles (los textos van como datos: district-activities.json), la torre de salida de la ruta y la
plataforma de llegada.

Todo sale de `plan()`, puro y determinista: el modelo (`build`) y las colisiones (`colliders`) usan
las mismas cajas. `course()` da los puntos de la ruta y los banderines (la búsqueda) para la ficha de
actividades. Las Pilas van en sus propios modelos (`towers_object`: las piezas `vertical_towers` y
`vertical_towers_b`, que el servidor pone como atrezo; la escalera de la Gran Pila, `stairs_object`,
choca con su malla): así la ruta y el Patio caben con su detalle en el presupuesto de un modelo.
Materiales de verdad: chapa ondulada, óxido, hormigón y hormigón pintado
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
        self.pilas: list[dict] = []

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
    """Todo Vertical: la ruta, los cruces, el Patio y las Pilas. Y sus marcas."""
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
    _pilas(pl, rnd)
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


# --------------------------------------------------------------------------------------
# Las Pilas (a lo Ready Player One)
# --------------------------------------------------------------------------------------
# Torres de caravanas en andamios de acero, que se escalan. Una caravana por piso, en espiral: al norte,
# al este, al sur y al oeste del andamio (cada una girada un cuarto respecto a la de debajo, apoyada en
# ella por una esquina y en las vigas por el resto). Así siempre queda, junto a la pared de la de
# encima (2,7 m), un trozo de tejado donde ponerse, y por encima de esa pared, sitio para subir
# colgándose del borde: se sube dando la vuelta (con dos por piso, alguna taparía el borde de otra).
# Pilares y pasarelas son sólidos; vigas y cruces, no. La Gran Pila (16 pisos) lleva además la escalera
# hasta el mirador de arriba (su malla es su colisión: `stairs_object`), puentes a sus tejados y un
# montacargas.
FRAME = 3.7          # m: del centro de una pila a la línea de sus pilares
COL = 0.12           # m: medio grueso de un pilar
EDGE = TL / 2        # 3,4: del centro al lado de fuera de cada caravana
INNER = EDGE - TW    # 0,95: del centro al lado de dentro
GRAN_TOP = 15        # último piso de la Gran Pila (16 pisos)
MIRADOR = roof(GRAN_TOP)
HOLE = 0.4           # m: hasta dónde llega (en X) el hueco del mirador por el que se llega trepando
STAIR_W = 1.0        # m: ancho de cada tramo de la escalera
STAIR_IN = FRAME + 0.15   # m: del centro de la Gran Pila a su escalera (al este)
STAIR_RUN = 2.3      # m: medio largo de un tramo
STAIR_END = 3.6      # m: del centro al borde de fuera de los descansillos
STEPS = 8            # peldaños por tramo (medio piso: 1,35 m)
LIFT = (FRAME + 0.35, FRAME + 2.25, 0.95)  # montacargas, al oeste: de dónde a dónde (en X) y medio ancho
# Las cuatro posiciones de la espiral: (dirección del lado, a lo largo de X).
SIDES = (("N", True), ("E", False), ("S", True), ("W", False))
# Dónde: manzana, centro en su marco (u = x, v = z), fase de la espiral (qué posición lleva el piso 0) y
# último piso. Un anillo de pilas en el borde de la ciudad, por fuera de la ruta; la primera, la Gran
# Pila, en la manzana del noroeste (sin ruta). Las que tienen pasarela entre sí van con fases que
# difieren en dos: a la misma altura, una tiene su caravana del lado de la otra y la otra, al revés.
PILA_SITES = [
    ((0, 0), 14.6, 14.0, 0, GRAN_TOP),   # 0: la Gran Pila
    ((0, 0), 4.0, 4.0, 1, 12),           # 1
    ((0, 0), 4.0, 14.5, 3, 10),          # 2
    ((0, 0), 17.5, 4.0, 3, 11),          # 3
    ((1, 0), 16.5, 4.0, 0, 13),          # 4
    ((1, 0), 4.0, 15.3, 2, 11),          # 5
    ((2, 0), 6.0, 4.0, 2, 11),           # 6
    ((2, 0), 19.05, 16.0, 2, 12),        # 7
    ((2, 0), 4.0, 19.0, 1, 10),          # 8
    ((0, 1), 4.0, 15.3, 1, 12),          # 9
    ((0, 1), 16.5, 4.0, 3, 10),          # 10
    ((2, 1), 18.8, 5.0, 0, 11),          # 11
    ((2, 1), 18.8, 17.6, 2, 13),         # 12
    ((0, 2), 4.0, 5.2, 3, 13),           # 13
    ((0, 2), 15.5, 19.0, 3, 12),         # 14
    ((0, 2), 19.0, 4.0, 0, 10),          # 15
    ((1, 2), 5.6, 19.0, 1, 10),          # 16
    ((1, 2), 17.4, 19.0, 3, 12),         # 17
    ((2, 2), 19.0, 5.6, 0, 11),          # 18
    ((2, 2), 6.0, 19.0, 1, 12),          # 19
]
# Pasarelas (de tejado a tejado, entre pilas alineadas: la primera al norte o al oeste) y a qué
# altura más o menos.
WALKS = [(1, 2, 13.0), (1, 3, 21.0), (4, 6, 24.0), (9, 13, 19.0), (7, 11, 16.0), (11, 12, 22.0), (12, 18, 18.0),
         (14, 16, 16.0), (16, 17, 22.0), (17, 19, 16.0)]


def side_of(p: dict, k: int) -> int:
    """Posición de la espiral (0 = N, 1 = E, 2 = S, 3 = W) de la caravana del piso k."""
    return (k + p["phase"]) % 4


def side_box(p: dict, s: int) -> tuple[float, float, float, float]:
    """Planta de la caravana en la posición s de la pila."""
    cx, cz = p["cx"], p["cz"]
    if s == 0:
        return cx - EDGE, cz - EDGE, cx + EDGE, cz - INNER
    if s == 1:
        return cx + INNER, cz - EDGE, cx + EDGE, cz + EDGE
    if s == 2:
        return cx - EDGE, cz + INNER, cx + EDGE, cz + EDGE
    return cx - EDGE, cz - EDGE, cx - INNER, cz + EDGE


def _pila_model(cx: float, cz: float) -> str:
    """Las pilas van en dos modelos (cada uno con su presupuesto): las del noroeste y las del sureste."""
    return "a" if cx + cz < 2 * C else "b"


def _footprint(p: dict) -> tuple[float, float, float, float]:
    """Lo que ocupa una pila en planta: el andamio; en la Gran Pila, también escalera y montacargas."""
    a = FRAME + COL
    x0, z0, x1, z1 = p["cx"] - a, p["cz"] - a, p["cx"] + a, p["cz"] + a
    if p["gran"]:
        x0, x1 = p["cx"] - LIFT[1] - 0.1, p["cx"] + STAIR_IN + 2 * STAIR_W + 0.1
        z0, z1 = p["cz"] - STAIR_END - 0.2, p["cz"] + STAIR_END + 0.2
    return x0, z0, x1, z1


def pila_list() -> list[dict]:
    """Las pilas (sin el plano): dónde, su fase, hasta qué piso y en qué modelo van."""
    out = []
    for n, ((i, j), cu, cv, phase, top) in enumerate(PILA_SITES):
        bx, bz = _inner(i, j)
        p = {"id": n, "i": i, "j": j, "cx": bx + cu, "cz": bz + cv, "top": top, "phase": phase, "gran": n == 0}
        p["model"] = _pila_model(p["cx"], p["cz"])
        p["h"] = MIRADOR + RAIL if p["gran"] else roof(top) + 0.35
        out.append(p)
    return out


def _pilas(pl: Plan, rnd: random.Random) -> list[dict]:
    """Las Pilas: sus caravanas y pilares, lo de la Gran Pila y las pasarelas."""
    pilas = pila_list()
    for p in pilas:
        bx, bz = _inner(p["i"], p["j"])
        x0, z0, x1, z1 = _footprint(p)
        if x0 < bx - 0.01 or z0 < bz - 0.01 or x1 > bx + S + 0.01 or z1 > bz + S + 0.01:
            raise ValueError(f"la pila {p['id']} se sale de su manzana")
        if not pl.free(x0, z0, x1, z1, 0, MIRADOR + 3, margin=0.1):
            raise ValueError(f"la pila {p['id']} pisa algo de la ruta")
        _pila_stack(pl, p, rnd)
    _gran(pl, pilas[0])
    p_walks = _catwalks(pl, pilas)
    for p in pilas:
        p["walks"] = [w for w in p_walks if p["id"] in (w["a"], w["b"])]
    pl.pilas = pilas
    return pilas


def _pila_stack(pl: Plan, p: dict, rnd: random.Random) -> None:
    """Las caravanas de una pila (de arriba abajo, una por piso, en espiral) y sus cuatro pilares."""
    kw = {"tower": True, "pila": p["id"], "model": p["model"]}
    for k in range(p["top"], -1, -1):
        s = side_of(p, k)
        x0, z0, x1, z1 = side_box(p, s)
        it = pl.trailer(x0, z0, x1, z1, k, rnd.choice(TINTS), side=s, **kw)
        if k == p["top"]:
            it["top"] = True
            if p["gran"]:
                it["mirador"] = True
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = p["cx"] + sx * FRAME, p["cz"] + sz * FRAME
            pl.add("column", x - COL, z - COL, x + COL, z + COL, 0, p["h"], **kw)


def _gran(pl: Plan, g: dict) -> None:
    """
    La Gran Pila: arriba, el mirador (el tejado de la última caravana y, alrededor, rejilla hasta los
    pilares, con barandilla menos por donde llega la escalera; junto a la última caravana, un hueco con
    barandilla en tres lados: por ahí se llega trepando). El sitio de la escalera (su malla es su
    colisión) y el montacargas (sólido entero).
    """
    cx, cz = g["cx"], g["cz"]
    kw = {"tower": True, "pila": 0, "model": g["model"]}
    if side_of(g, g["top"]) != 3 or side_of(g, g["top"] - 1) != 2:
        raise ValueError("el mirador cuenta con la última caravana al oeste y la de debajo al sur")
    y = MIRADOR
    a = FRAME + COL
    grates = [
        (cx - a, cz - a, cx + a, cz - EDGE),          # norte
        (cx - a, cz + EDGE, cx + a, cz + a),          # sur
        (cx - a, cz - EDGE, cx - EDGE, cz + EDGE),    # oeste (por fuera de la última caravana)
        (cx - INNER, cz - EDGE, cx + a, cz + INNER),  # el noreste, sobre el vacío
        (cx + HOLE, cz + INNER, cx + a, cz + EDGE),   # el sureste, sobre la penúltima
    ]
    for (x0, z0, x1, z1) in grates:
        pl.add("grate", x0, z0, x1, z1, y - 0.1, y, mirador=True, **kw)
    t = 0.06
    pl.add("rail", cx - a, cz - a, cx + a, cz - a + t, y, y + RAIL, **kw)
    pl.add("rail", cx - a, cz + a - t, cx + a, cz + a, y, y + RAIL, **kw)
    pl.add("rail", cx - a, cz - a + t, cx - a + t, cz + a - t, y, y + RAIL, **kw)
    pl.add("rail", cx + a - t, cz - STAIR_RUN + 0.1, cx + a, cz + a - t, y, y + RAIL, **kw)
    # El hueco (x de -0,95 a 0,4; z de 0,95 a 3,4): barandilla al norte, al este y al sur.
    pl.add("rail", cx - INNER, cz + INNER, cx + HOLE, cz + INNER + t, y, y + RAIL, **kw)
    pl.add("rail", cx + HOLE, cz + INNER, cx + HOLE + t, cz + EDGE, y, y + RAIL, **kw)
    pl.add("rail", cx - INNER, cz + EDGE - t, cx + HOLE, cz + EDGE, y, y + RAIL, **kw)
    xa = cx + STAIR_IN
    pl.add("stairs", xa, cz - STAIR_END - 0.1, xa + 2 * STAIR_W, cz + STAIR_END + 0.1, 0, MIRADOR + RAIL, nocol=True, **kw)
    pl.add("lift", cx - LIFT[1], cz - LIFT[2], cx - LIFT[0], cz + LIFT[2], 0, MIRADOR + 2.6, **kw)


def stair_flights(g: dict) -> list[dict]:
    """
    La escalera de la Gran Pila, al este de su andamio: tramos de medio piso (1,35 m en 4,6 m) en zigzag
    por dos carriles, descansillos en los dos extremos y, en los pisos donde la caravana de debajo está
    al este (cada cuatro), un puente a su tejado. El último descansillo da al mirador. Pura y
    determinista: la usa el modelo (su malla es su colisión).
    """
    cx, cz, top = g["cx"], g["cz"], g["top"]
    xa = cx + STAIR_IN
    lanes = ((xa, xa + STAIR_W), (xa + STAIR_W, xa + 2 * STAIR_W))
    n0, n1 = cz - STAIR_RUN, cz + STAIR_RUN
    half = LV / 2
    n = 2 * (top + 1)
    out = []
    for k in range(n):
        y0, y1 = k * half, (k + 1) * half
        south = k % 2 == 0  # los pares suben hacia el sur por el carril de dentro; los impares, de vuelta
        lane = lanes[k % 2]
        out.append({"kind": "flight", "x0": lane[0], "x1": lane[1], "za": n0 if south else n1, "zb": n1 if south else n0, "y0": y0, "y1": y1, "lane": k % 2})
        z0, z1 = (n1, cz + STAIR_END) if south else (cz - STAIR_END, n0)
        lvl = (k + 1) // 2
        bridge = not south and k < n - 1 and side_of(g, lvl - 1) == 1
        out.append({"kind": "landing", "x0": xa, "x1": xa + 2 * STAIR_W, "z0": z0, "z1": z1, "y": y1, "end": "S" if south else "N", "top": k == n - 1, "bridge": bridge})
        if bridge:
            out.append({"kind": "bridge", "x0": cx + EDGE - 0.45, "x1": xa, "z0": cz - EDGE + 0.05, "z1": n0, "y": y1})
    return out


def _catwalks(pl: Plan, pilas: list[dict]) -> list[dict]:
    """
    Pasarelas de `WALKS`: rectas, de tejado a tejado, en un piso en que la primera pila tiene su
    caravana del lado de la segunda y la segunda, del lado de la primera (por eso sus fases difieren en
    dos), a la altura más cercana a la que se pide; sin tocar nada por el camino.
    """
    out = []
    for (ia, ib, want) in WALKS:
        a, b = pilas[ia], pilas[ib]
        dx, dz = b["cx"] - a["cx"], b["cz"] - a["cz"]
        along_z = abs(dx) < 0.6 and dz > 0
        if not along_z and not (abs(dz) < 0.6 and dx > 0):
            raise ValueError(f"la pasarela {ia}-{ib} no va recta (la primera, al norte o al oeste)")
        sa, sb = (2, 0) if along_z else (1, 3)
        floors = [k for k in range(2, min(a["top"], b["top"])) if side_of(a, k) == sa and side_of(b, k) == sb]
        if not floors:
            raise ValueError(f"la pasarela {ia}-{ib} no tiene piso común")
        k = min(floors, key=lambda k: abs(roof(k) - want))
        y = roof(k)
        w = 0.55
        kw = {"tower": True, "model": a["model"]}
        if along_z:
            c = (a["cx"] + b["cx"]) / 2
            z0, z1 = a["cz"] + EDGE, b["cz"] - EDGE
            box = (c - w, z0, c + w, z1)
        else:
            c = (a["cz"] + b["cz"]) / 2
            x0, x1 = a["cx"] + EDGE, b["cx"] - EDGE
            box = (x0, c - w, x1, c + w)
        # Lo de en medio, libre (sin contar los dos tejados de los extremos).
        inset = FRAME + COL - EDGE + 0.05
        free = (box[0] + 0.05, box[1] + inset, box[2] - 0.05, box[3] - inset) if along_z else (box[0] + inset, box[1] + 0.05, box[2] - inset, box[3] - 0.05)
        if not pl.free(*free, y - 0.6, y + 2.6):
            raise ValueError(f"la pasarela {ia}-{ib} pisa algo")
        pl.add("catwalk", *box, y - 0.1, y, along="z" if along_z else "x", **kw)
        t = 0.05
        if along_z:
            pl.add("rail", c - w, z0, c - w + t, z1, y, y + RAIL, **kw)
            pl.add("rail", c + w - t, z0, c + w, z1, y, y + RAIL, **kw)
        else:
            pl.add("rail", x0, c - w, x1, c - w + t, y, y + RAIL, **kw)
            pl.add("rail", x0, c + w - t, x1, c + w, y, y + RAIL, **kw)
        out.append({"a": ia, "b": ib, "k": k, "along_z": along_z})
    return out


# --------------------------------------------------------------------------------------
# Colisiones y datos de la ruta
# --------------------------------------------------------------------------------------

def colliders() -> list[list[float]]:
    pl, _marks = plan()
    out = []
    for it in pl.items:
        if it.get("nocol"):
            continue
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
SHEET_STEEL = "#80878f"   # chapa de acero (las barandillas de las Pilas en el nivel ligero)
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
    elif detail and it.get("tower"):
        # En las pilas, nada en los lados (por ahí se trepa): a veces, un rótulo de neón en la trasera.
        if 0.4 < extra < 0.62 and it.get("level", 0) >= 2:
            _sign(q, L, W, H, yb, color)
    elif detail and it.get("level", 0) == 0:
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
    if it.get("top") and not it.get("mirador"):
        _roof_life(q, L, W, H, pick, detail)
    elif detail and not route and not it.get("tower"):
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
    """La ruta y el Patio, con sus farolas (las Pilas van aparte: towers_object y stairs_object)."""
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


def _beam_box(p: Part, x0, z0, x1, z1, y0, y1, m) -> None:
    """Viga de acero: una caja sin las tapas de los extremos."""
    if (x1 - x0) >= (z1 - z0):
        _box(p, x0, z0, x1, z1, y0, y1, m, skip=("+x", "-x"))
    else:
        _box(p, x0, z0, x1, z1, y0, y1, m, skip=("+y", "-y"))


def _grate(p: Part, it: dict) -> None:
    """Suelo de chapa de acero (pasarelas, descansillos y el mirador) sobre su canto de perfil oxidado."""
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    _box(p, x0, z0, x1, z1, y1 - 0.04, y1, mat("metal", "#4a4f58"))
    _box(p, x0, z0, x1, z1, y0, y1 - 0.04, mat("oxido", STEEL), skip=("+z",))


def _frame(p: Part, g: dict, items: list, detail: int) -> None:
    """
    El andamio de una pila: pilares en H, un anillo de vigas en cada piso, una viga bajo el extremo de
    cada caravana que no descansa en la de debajo (se ve que la aguanta el andamio), cruces de San
    Andrés en dos lados por donde no llega ninguna pasarela (en la Gran Pila, solo detrás del
    montacargas: al este va la escalera) y, cada pocos pisos, una lámpara de obra en un pilar.
    """
    cx, cz, top = g["cx"], g["cz"], g["top"]
    steel = mat("oxido", STEEL)
    F = FRAME
    for it in items:
        if it["kind"] == "column" and it.get("pila") == g["id"]:
            _column(p, it)
    for k in range(1, top + 2):
        y = k * LV
        if detail or k % 2 == 0 or k == top + 1:
            b0, b1 = y - 0.2, y - 0.02
            _beam_box(p, cx - F, cz - F - 0.05, cx + F, cz - F + 0.05, b0, b1, steel)
            _beam_box(p, cx - F, cz + F - 0.05, cx + F, cz + F + 0.05, b0, b1, steel)
            _beam_box(p, cx - F - 0.05, cz - F, cx - F + 0.05, cz + F, b0, b1, steel)
            _beam_box(p, cx + F - 0.05, cz - F, cx + F + 0.05, cz + F, b0, b1, steel)
        if k <= top:
            # El extremo de la caravana del piso k que no se apoya en la de debajo, de lado a lado.
            e = EDGE - 0.15
            s = side_of(g, k)
            if s == 0:
                _beam_box(p, cx + e - 0.06, cz - F, cx + e + 0.06, cz + F, y - 0.17, y - 0.01, steel)
            elif s == 1:
                _beam_box(p, cx - F, cz + e - 0.06, cx + F, cz + e + 0.06, y - 0.17, y - 0.01, steel)
            elif s == 2:
                _beam_box(p, cx - e - 0.06, cz - F, cx - e + 0.06, cz + F, y - 0.17, y - 0.01, steel)
            else:
                _beam_box(p, cx - F, cz - e - 0.06, cx + F, cz - e + 0.06, y - 0.17, y - 0.01, steel)
    # Cruces: en dos lados (opuestos, si se puede) por donde no pasa ninguna pasarela.
    used = set()
    for w in g.get("walks", []):
        first = w["a"] == g["id"]
        used.add(("z", 1 if first else -1) if w["along_z"] else ("x", 1 if first else -1))
    if g["gran"]:
        faces = [("x", -1)]
    else:
        faces = [f for f in (("x", -1), ("x", 1)) if f not in used]
        if len(faces) < 2:
            faces = [f for f in (("z", -1), ("z", 1)) if f not in used] if not ({("z", -1), ("z", 1)} & used) else faces
    for (axis, sg) in faces:
        for k in range(top + 1):
            if not detail and k % 2:
                continue
            ya, yb = k * LV + 0.12, (k + 1) * LV - 0.28
            if axis == "x":
                x = cx + sg * (F + 0.02)
                ends = ((_bl(x, cz - F, ya), _bl(x, cz + F, yb)), (_bl(x, cz + F, ya), _bl(x, cz - F, yb)))
            else:
                z = cz + sg * (F + 0.02)
                ends = ((_bl(cx - F, z, ya), _bl(cx + F, z, yb)), (_bl(cx + F, z, ya), _bl(cx - F, z, yb)))
            for (u, v) in ends:
                p.tube([u, v], 0.035, steel, segments=4 if detail else 3)
    # Lámparas de obra: cada tres pisos, en un pilar distinto (por fuera de la esquina).
    corners = ((1, 1), (-1, 1), (-1, -1), (1, -1))
    for n, k in enumerate(range(2, top + 1, 3)):
        sx, sz = corners[(n + g["id"]) % 4]
        x, z = cx + sx * (F + COL + 0.12), cz + sz * (F + COL + 0.12)
        y = k * LV + 2.1
        _box(p, min(x, cx + sx * (F + COL)), z - 0.02, max(x, cx + sx * (F + COL)), z + 0.02, y + 0.06, y + 0.1, steel)
        p.sphere(_bl(x, z, y), 0.08, mat("farol", BULB), subdiv=0)
        if detail:
            p.lathe(_bl(x, z, y + 0.02), [(0.15, 0.0), (0.1, 0.07), (0.03, 0.13)], mat("hierro", DARK), segments=8, close_top=True)


def _catwalk(p: Part, it: dict, detail: int) -> None:
    """Pasarela entre dos pilas: suelo de chapa y, a los lados, vigas de celosía (las barandillas, aparte)."""
    _grate(p, it)
    x0, z0, x1, z1, y0, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y0"], it["y1"]
    steel = mat("oxido", STEEL)
    along_x = it.get("along") == "x"
    L = (x1 - x0) if along_x else (z1 - z0)
    n = max(2, round(L / 1.6))
    lo, hi = y0 - 0.22, y1 + RAIL - 0.04
    for side in (-1, 1):
        if along_x:
            zc = (z0 + z1) / 2 + side * ((z1 - z0) / 2 - 0.03)

            def at(s, y, zc=zc):
                return _bl(x0 + s, zc, y)
        else:
            xc = (x0 + x1) / 2 + side * ((x1 - x0) / 2 - 0.03)

            def at(s, y, xc=xc):
                return _bl(xc, z0 + s, y)
        p.tube([at(0.0, lo), at(L, lo)], 0.05, steel, segments=4)
        for k in range(n if detail else 0):
            s0, s1 = L * k / n, L * (k + 1) / n
            a, b = (lo, hi) if k % 2 == 0 else (hi, lo)
            p.tube([at(s0, a), at(s1, b)], 0.022, steel, segments=4)
    # Travesaños bajo el suelo (de lado a lado), cada tramo de la celosía.
    for k in range(n + 1):
        s = L * k / n
        if along_x:
            _beam_box(p, x0 + s - 0.04, z0, x0 + s + 0.04, z1, lo - 0.05, y0, steel)
        else:
            _beam_box(p, x0, z0 + s - 0.04, x1, z0 + s + 0.04, lo - 0.05, y0, steel)


def _cage(p: Part, x0, z0, x1, z1, y0, y1, detail: int) -> None:
    """Jaula del montacargas: suelo, techo, cuatro postes y barrotes (la puerta, al oeste, de rombos)."""
    steel = mat("oxido", STEEL)
    paint = mat("pintado", YELLOW)
    _box(p, x0, z0, x1, z1, y0, y0 + 0.12, steel)
    _box(p, x0, z0, x1, z1, y1 - 0.1, y1, paint)
    for (x, z) in ((x0, z0), (x1, z0), (x0, z1), (x1, z1)):
        _box(p, x - 0.04, z - 0.04, x + 0.04, z + 0.04, y0 + 0.12, y1 - 0.1, paint, skip=("+z", "-z"))
    n = 6 if detail else 3
    for k in range(1, n):
        t = k / n
        x, z = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
        for (a0, b0, a1, b1) in ((x - 0.012, z0 - 0.012, x + 0.012, z0 + 0.012), (x - 0.012, z1 - 0.012, x + 0.012, z1 + 0.012), (x1 - 0.012, z - 0.012, x1 + 0.012, z + 0.012)):
            _box(p, a0, b0, a1, b1, y0 + 0.12, y1 - 0.1, steel, skip=("+z", "-z"))
    if detail:  # la puerta de tijera
        for k in range(5):
            za, zb = z0 + (z1 - z0) * k / 5, z0 + (z1 - z0) * (k + 1) / 5
            p.tube([_bl(x0, za, y0 + 0.15), _bl(x0, zb, y1 - 0.15)], 0.012, steel, segments=3)
            p.tube([_bl(x0, zb, y0 + 0.15), _bl(x0, za, y1 - 0.15)], 0.012, steel, segments=3)


def _lift(p: Part, it: dict, detail: int) -> None:
    """
    El montacargas de la Gran Pila, al oeste: cuatro guías de abajo arriba atadas cada piso (y al
    andamio cada dos), el cabezal sobre el mirador con su polea, los cables y dos jaulas: una abajo y
    otra parada a media altura.
    """
    x0, z0, x1, z1, y1 = it["x0"], it["z0"], it["x1"], it["z1"], it["y1"]
    steel = mat("oxido", STEEL)
    dark = mat("hierro", DARK)
    top = y1 - 0.5
    for (x, z) in ((x0 + 0.06, z0 + 0.06), (x1 - 0.06, z0 + 0.06), (x0 + 0.06, z1 - 0.06), (x1 - 0.06, z1 - 0.06)):
        _box(p, x - 0.06, z - 0.06, x + 0.06, z + 0.06, 0, top, steel, skip=("-z",))
    for k in range(1, int(top / LV) + 1):
        if not detail and k % 2:
            continue
        y = k * LV
        _beam_box(p, x0, z0, x1, z0 + 0.08, y - 0.1, y, steel)
        _beam_box(p, x0, z1 - 0.08, x1, z1, y - 0.1, y, steel)
        _beam_box(p, x0, z0, x0 + 0.08, z1, y - 0.1, y, steel)
        if k % 2 == 0:  # atada al andamio
            _beam_box(p, x1, z0 + 0.3, x1 + (LIFT[0] - FRAME), z0 + 0.38, y - 0.1, y, steel)
            _beam_box(p, x1, z1 - 0.38, x1 + (LIFT[0] - FRAME), z1 - 0.3, y - 0.1, y, steel)
    # El cabezal: dos vigas por encima y la polea en medio.
    xm, zm = (x0 + x1) / 2, (z0 + z1) / 2
    _beam_box(p, x0, z0, x1, z0 + 0.14, top, top + 0.22, steel)
    _beam_box(p, x0, z1 - 0.14, x1, z1, top, top + 0.22, steel)
    _box(p, xm - 0.1, z0, xm + 0.1, z1, top + 0.22, top + 0.4, steel)
    wx, wy, wz = _bl(xm - 0.06, zm, top + 0.75)
    p.cylinder((wx, wy, wz), 0.38, 0.12, mat("pintado", YELLOW), segments=14 if detail else 8, axis="x")
    for (zz, cy) in ((zm - 0.36, 0.0), (zm + 0.36, roof(7) + 0.4)):
        p.tube([_bl(xm, zz, top + 0.75), _bl(xm, zz, cy + 2.45)], 0.014, dark, segments=3)
    for cy in (0.0, roof(7) + 0.4):
        _cage(p, x0 + 0.16, z0 + 0.16, x1 - 0.16, z1 - 0.16, cy, cy + 2.45, detail)


def _mast(p: Part, g: dict, color: str, detail: int) -> None:
    """Mástil del mirador: en la esquina del suroeste, con su banderín y una baliza que brilla."""
    x, z = g["cx"] - FRAME + 0.35, g["cz"] + FRAME - 0.35
    dark = mat("hierro", DARK)
    p.cylinder(_bl(x, z, MIRADOR), 0.06, 6.5, dark, segments=8 if detail else 5, radius_top=0.035)
    q = Part("banderin")
    q.prism([(0.0, 0.0), (1.6, 0.35), (0.0, 0.9)], -0.015, 0.015, mat("neon", ORANGE))
    p.merge(q, Matrix.Translation(_bl(x, z, MIRADOR + 5.3)) @ Matrix.Rotation(math.radians(-30), 4, "Z"))
    q.bm.free()
    p.sphere(_bl(x, z, MIRADOR + 6.6), 0.12, mat("neon", color), subdiv=1 if detail else 0)


def _pila_cables(p: Part, mine: list[dict], pilas: list[dict], solid: list[dict], rnd: random.Random) -> None:
    """
    Cables de una pila a sus dos vecinas más cercanas, de lo alto de un pilar a lo alto del otro (los
    de la que está más al noroeste: así no se dibujan dos veces), y en la mitad, bombillas.
    """
    wire = mat("hierro", DARK)
    bulb = mat("farol", BULB)
    ids = {g["id"] for g in mine}
    done = set()
    for a in pilas:
        near = sorted((math.hypot(b["cx"] - a["cx"], b["cz"] - a["cz"]), b["id"]) for b in pilas if b is not a)
        for d, bid in near[:2]:
            b = pilas[bid]
            key = (min(a["id"], b["id"]), max(a["id"], b["id"]))
            lit = rnd.random() < 0.6
            if key in done or key[0] not in ids or not (8.0 < d < 34.0):
                continue
            done.add(key)
            dx, dz = (b["cx"] - a["cx"]) / d, (b["cz"] - a["cz"]) / d
            sa = (1 if dx >= 0 else -1, 1 if dz >= 0 else -1)
            pa = (a["cx"] + sa[0] * FRAME, a["h"] - 0.15, a["cz"] + sa[1] * FRAME)
            pb = (b["cx"] - sa[0] * FRAME, b["h"] - 0.15, b["cz"] - sa[1] * FRAME)
            sag = 0.6 + 0.05 * d
            clear = True
            for k in range(1, 16):
                t = k / 16
                x, z = pa[0] + (pb[0] - pa[0]) * t, pa[2] + (pb[2] - pa[2]) * t
                y = pa[1] + (pb[1] - pa[1]) * t - sag * 4 * t * (1 - t)
                if any(it["x0"] - 0.1 < x < it["x1"] + 0.1 and it["z0"] - 0.1 < z < it["z1"] + 0.1 and it["y0"] - 0.1 < y < it["y1"] + 0.1 for it in solid):
                    clear = False
                    break
            if clear:
                _catenary(p, pa, pb, sag, wire, bulb if lit else None, every=1.2, n=12)


def towers_object(color: str, detail: int, model: str = "a"):
    """
    Las Pilas (decorado y retos libres), en dos modelos (cada uno con su presupuesto): las del noroeste
    (`vertical_towers`, con la Gran Pila) y las del sureste (`vertical_towers_b`). Caravanas, andamios,
    balcones, pasarelas, cables con bombillas y, en la Gran Pila, el montacargas y el mástil del
    mirador. Sus colisiones van con las de la ciudad (colliders()); la escalera, aparte (stairs_object).
    """
    name = "vertical_towers" if model == "a" else "vertical_towers_b"
    p = Part(name)
    pl, _marks = plan()
    pilas = pl.pilas
    mine = [g for g in pilas if g["model"] == model]
    rnd = random.Random(4242 if model == "a" else 4243)
    items = [it for it in pl.items if it.get("tower") and it.get("model") == model]
    for it in items:
        k = it["kind"]
        if k == "trailer":
            _trailer(p, it, rnd, detail, color)
        elif k == "grate":
            _grate(p, it)
        elif k == "rail":
            if detail:
                _rail(p, it, detail)
            else:  # en el nivel ligero, una chapa de acero (como la colisión)
                _box(p, it["x0"], it["z0"], it["x1"], it["z1"], it["y0"] + 0.06, it["y1"], mat("metal", SHEET_STEEL), skip=("-z",))
        elif k == "catwalk":
            _catwalk(p, it, detail)
        elif k == "lift":
            _lift(p, it, detail)
    for g in mine:
        _frame(p, g, items, detail)
        if g["gran"]:
            _mast(p, g, color, detail)
    if detail:
        solid = [it for it in pl.items if it["kind"] == "trailer"]
        _pila_cables(p, mine, pilas, solid, random.Random(77))
    ob = p.to_object()
    ob.name = name
    finish(ob)
    return ob


def _incline(p: Part, x: float, za: float, zb: float, ya: float, yb: float, r: float, m, seg: int) -> None:
    """Tubo inclinado a lo largo de Z (pasamanos, barras y zancas de la escalera)."""
    p.tube([_bl(x, za, ya), _bl(x, zb, yb)], r, m, segments=seg)


def stairs_object(color: str, detail: int):
    """
    La escalera de la Gran Pila (stair_flights): peldaños de chapa sobre dos zancas, descansillos,
    puentes al tejado de la atravesada del este y barandillas en todo lo que da al vacío, con los
    postes de su torre y, en cada descansillo de fuera, una bombilla. Su malla es su colisión: el
    nivel ligero (el que choca) lleva lo mismo que se pisa y las barandillas.
    """
    p = Part("vertical_stairs")
    g = pila_list()[0]
    cx, cz = g["cx"], g["cz"]
    steel = mat("oxido", STEEL)
    plate = mat("metal", "#4a4f58")
    galv = mat("pintado", GALV)
    sheet = mat("metal", SHEET_STEEL)  # las barandillas del nivel ligero: una chapa
    yellow = mat("pintado", YELLOW)
    seg = 6 if detail else 4
    xa = cx + STAIR_IN
    xb = xa + 2 * STAIR_W
    flights = stair_flights(g)

    def panel(x, za, zb, ya, yb):
        """Barandilla de chapa (nivel ligero): de (za, ya) a (zb, yb) a lo largo de Z, en x."""
        outline = [(-(za - C), ya), (-(zb - C), yb), (-(zb - C), yb + RAIL - 0.03), (-(za - C), ya + RAIL - 0.03)]
        p.prism(outline, x - 0.015 - C, x + 0.015 - C, sheet)

    def rail_x(x, z0, z1, y):
        """Barandilla recta a lo largo de Z (en x), a la altura y."""
        if not detail:
            panel(x, z0, z1, y, y)
            return
        n = max(1, round((z1 - z0) / 1.2))
        for k in range(n + 1):
            z = z0 + 0.03 + (z1 - z0 - 0.06) * k / n
            _box(p, x - 0.025, z - 0.025, x + 0.025, z + 0.025, y, y + RAIL - 0.03, galv, skip=("+z", "-z"))
        _incline(p, x, z0, z1, y + RAIL - 0.03, y + RAIL - 0.03, 0.03, galv, seg)
        _incline(p, x, z0, z1, y + 0.5, y + 0.5, 0.016, galv, 4)

    def rail_z(z, x0, x1, y):
        """Barandilla recta a lo largo de X (en z)."""
        if not detail:
            _box(p, x0, z - 0.015, x1, z + 0.015, y, y + RAIL - 0.03, sheet, skip=("-z",))
            return
        n = max(1, round((x1 - x0) / 1.2))
        for k in range(n + 1):
            x = x0 + 0.03 + (x1 - x0 - 0.06) * k / n
            _box(p, x - 0.025, z - 0.025, x + 0.025, z + 0.025, y, y + RAIL - 0.03, galv, skip=("+z", "-z"))
        p.tube([_bl(x0, z, y + RAIL - 0.03), _bl(x1, z, y + RAIL - 0.03)], 0.03, galv, segments=seg)
        p.tube([_bl(x0, z, y + 0.5), _bl(x1, z, y + 0.5)], 0.016, galv, segments=4)

    for f in flights:
        if f["kind"] == "flight":
            x0, x1, za, zb, y0, y1 = f["x0"], f["x1"], f["za"], f["zb"], f["y0"], f["y1"]
            sgn = 1 if zb > za else -1
            run = abs(zb - za) / STEPS
            rise = (y1 - y0) / STEPS
            for i in range(STEPS):
                za_i = za + sgn * i * run
                zb_i = za + sgn * (i + 1) * run
                top = y0 + (i + 1) * rise
                lo, hi = sorted((za_i, zb_i))
                _box(p, x0 + 0.04, lo, x1 - 0.04, hi, top - 0.045, top, plate, skip=() if detail else ("+x", "-x"))
                if detail:  # el canto amarillo de cada peldaño
                    edge = hi if sgn < 0 else lo
                    _box(p, x0 + 0.04, edge - 0.02, x1 - 0.04, edge + 0.02, top - 0.002, top + 0.004, yellow, skip=("-z",))
            # Zancas a los dos lados (de un descansillo al otro).
            for x in (x0 + 0.03, x1 - 0.03):
                _incline(p, x, za, zb, y0 - 0.12, y1 - 0.12, 0.05, steel, 4)
            # Barandillas: la de fuera y la de en medio (cada carril, la suya), inclinadas.
            outer = x0 + 0.03 if f["lane"] == 0 else x1 - 0.03
            middle = x1 - 0.03 if f["lane"] == 0 else x0 + 0.03
            for x in (outer, middle):
                if not detail:
                    panel(x, za, zb, y0, y1)
                    continue
                n = 4
                for k in range(n + 1):
                    t = k / n
                    z = za + (zb - za) * (0.04 + 0.92 * t)
                    yy = y0 + (y1 - y0) * (0.04 + 0.92 * t)
                    _box(p, x - 0.025, z - 0.025, x + 0.025, z + 0.025, yy, yy + RAIL - 0.03, galv, skip=("+z", "-z"))
                _incline(p, x, za, zb, y0 + RAIL - 0.03, y1 + RAIL - 0.03, 0.03, galv, seg)
                _incline(p, x, za, zb, y0 + 0.5, y1 + 0.5, 0.016, galv, 4)
        elif f["kind"] == "landing":
            x0, x1, z0, z1, y = f["x0"], f["x1"], f["z0"], f["z1"], f["y"]
            _grate(p, {"x0": x0, "z0": z0, "x1": x1, "z1": z1, "y0": y - 0.12, "y1": y})
            far = z1 - 0.03 if f["end"] == "S" else z0 + 0.03
            rail_z(far, x0, x1, y)
            rail_x(x1 - 0.03, z0, z1, y)
            if not f["bridge"] and not f["top"]:
                rail_x(x0 + 0.03, z0, z1, y)
            if f["top"]:  # arriba no sigue ningún tramo por el carril de dentro
                rail_z(z1 - 0.03, x0, x0 + STAIR_W, y)
            if f["end"] == "S":  # una bombilla en el poste de fuera
                xl, zl = x1 + 0.12, (z0 + z1) / 2
                _box(p, x1 - 0.03, zl - 0.03, xl, zl + 0.03, y + 2.1, y + 2.16, steel)
                p.sphere(_bl(xl, zl, y + 2.0), 0.07, mat("farol", BULB), subdiv=0)
        else:  # puente al tejado de la atravesada del este
            x0, x1, z0, z1, y = f["x0"], f["x1"], f["z0"], f["z1"], f["y"]
            _grate(p, {"x0": x0, "z0": z0, "x1": x1, "z1": z1, "y0": y - 0.1, "y1": y + 0.012})
            rail_z(z0 + 0.03, x0 + 0.2, x1, y)
            rail_z(z1 - 0.03, x0 + 0.2, x1, y)
    # La torre de la escalera: postes en las esquinas y en los extremos de los tramos, de abajo arriba.
    top = MIRADOR + RAIL
    for x in (xa + 0.05, xb - 0.05):
        for z in (cz - STAIR_END + 0.05, cz - STAIR_RUN, cz + STAIR_RUN, cz + STAIR_END - 0.05):
            _box(p, x - 0.06, z - 0.06, x + 0.06, z + 0.06, 0, top, steel, skip=("-z",))
    ob = p.to_object()
    ob.name = "vertical_stairs"
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
