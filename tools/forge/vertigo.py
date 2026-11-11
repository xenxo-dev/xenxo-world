"""
El Circuito Vértigo: la segunda carrera de coches de Arcade, por el cielo y sin quitamiedos.

Una pista que flota a 26 m (por encima de las parcelas y entre las torres de la ciudad), más
estrecha que la del Gran Premio y sin nada a los lados: quien se pasa de frenada o apura de más,
se cae. Da la vuelta en el mismo sentido que el Gran Premio (contrario a las agujas del reloj visto
desde arriba). Lo que tiene, en orden desde la parrilla (al sur, sobre el segundo anillo de calles):

  1. Curva peraltada del sureste y la recta del este, con **el salto**: rampa, doce metros de vacío
     y caída. Hay que llegar con velocidad (una placa de turbo a un lado de la rampa ayuda a quien
     sale de parado) y, después, frenar a tiempo.
  2. La curva del noreste, **llana y cerrada**: quien no llega frenado, sigue recto.
  3. La recta del norte es **la viga**: 4,6 m de ancho (el coche mide 2,24).
  4. Curva peraltada del noroeste y **el cañón**: la pista se mete entre las torres por la calle del
     oeste de la plaza, baja seis metros (a fondo, el coche despega en el cambio de rasante), pasa
     junto a la plaza y vuelve a subir.
  5. Curva peraltada del suroeste y la recta de meta.

Aquí está todo lo que sale del trazado, de una sola lista de tramos (`plan()`): la malla que se ve y
con la que se choca (`mesh_collider`), los puntos de la carrera (cada uno con su rumbo: a quien se
cae, su coche lo devuelve al último que pasó), la parrilla, la placa de turbo, los marcadores, los
carteles y las dos puertas (del suelo a la plataforma y vuelta). La parte de geometría no necesita
Blender: `python3 tools/forge/vertigo.py <salida.json>` vuelca la pista para las pruebas.

Coordenadas del chunk (X este, Y arriba, Z sur), como en circuit.py.
"""
from __future__ import annotations

import json
import math
import os
import sys

from circuit import Path, _add, _heading_yaw, at

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ACTIVITIES = os.path.join(ROOT, "apps", "realtime", "src", "district-activities.json")
# La línea central del trazado, para la prueba que da las vueltas con el coche de verdad (test:race).
LINE = os.path.join(ROOT, "apps", "web", "test", "vertigo-line.json")

H = 26.0           # altura de la pista (las parcelas no pasan de 12 m; las torres llegan a 44)
W = 7.0            # ancho de la calzada (la del Gran Premio mide 9)
W_GRID = 9.0       # en la parrilla, para dos cajones por fila
W_BEAM = 4.6       # la viga
W_CANYON = 6.0     # entre las torres
R = 22.0           # radio de las tres curvas peraltadas (por el centro)
R_FLAT = 13.0      # y el de la llana: con lo que agarra el coche, la de 22 se tomaba a fondo; esta no
BANK = 20.0        # peralte de las curvas del sureste y del suroeste (grados)
BANK_NW = 16.0     # el de la del noroeste (la del noreste no lleva)
BANK_RUN = 14.0    # metros de recta en los que la pista se inclina (o deja de estarlo)
EDGE = 0.35        # ancho de las líneas de luz de los bordes
SIDE = 0.18        # canto de la pista
KEEL, KEEL_W = 0.55, 0.9   # la quilla: lo que baja por el centro y su media anchura

# Por dónde va (el centro de la calzada): un rectángulo. La recta del oeste es la calle de la ciudad
# que queda entre las torres del oeste y la plaza (x de 8 a 19; las fachadas, a 6,5 y 20,6).
X_E, X_W = 113.0, 13.5
Z_S, Z_N = 113.0, -49.0

# La recta de meta: la línea, la parrilla (cuatro filas de dos) y el pórtico con el semáforo.
FINISH_X = 50.0
GRID_X = [56.0, 61.0, 66.0, 71.0]
GRID_Z = [Z_S - 2.2, Z_S + 2.2]
START = (63.5, Z_S)
GRID_END = 77.0
GANTRY_X = 84.0    # el pórtico (un marco alrededor de la pista), lejos de la pole para que se vean sus luces
GANTRY_H = 6.4
LIGHT_GAP = 1.1

# El salto de la recta del este (rumbo norte): la pista sigue recta antes, sube, se corta y cae.
JUMP_LEAD, JUMP_RAMP, JUMP_GAP, JUMP_LAND = 16.0, 26.0, 12.0, 30.0
JUMP_H, LAND_H = 2.6, 1.5
# La viga de la recta del norte y el cañón (lo que baja y en cuántos metros; el llano y la subida).
BEAM_IN, BEAM = 8.0, 40.0
DIVE, DIVE_RUN, CANYON_FLAT, CLIMB_RUN = 6.0, 44.0, 12.0, 36.0

# La plataforma (al sur de la parrilla, a ras de pista): ahí se llega por la puerta y se saca el coche.
PLAT_X = (FINISH_X, GRID_END)
PLAT_Z = (Z_S + W_GRID / 2, Z_S + W_GRID / 2 + 9.0)
RAIL_H = 1.15
# Las puertas: la del suelo (junto a la recta de meta del Gran Premio, al sur, mirando a quien viene
# de la entrada del distrito) y la de vuelta, en la plataforma.
GROUND_DOOR = (66.0, 153.0)
PORTAL = (3.2, 2.8)


def plan() -> dict:
    """El trazado entero: secciones de pista (en orden, desde la línea de meta) y dónde va cada cosa."""
    p = Path(FINISH_X, Z_S, 0.0, y=H)
    p.mark("finish")
    # Recta de meta y parrilla; después se estrecha y se inclina hacia la curva del sureste.
    p.straight(GRID_END - FINISH_X, w=(W_GRID, W_GRID), zone="grid")
    p.straight(X_E - R - GRID_END, w=(W_GRID, W), bank=(0, BANK), step=2.0, zone="bank")
    p.arc(R, 90, BANK, w=W, zone="curve")
    # Recta del este (hacia el norte): el salto.
    p.mark("east")
    p.straight(BANK_RUN, bank=(BANK, 0), w=(W, W), step=2.0, zone="bank")
    p.straight(JUMP_LEAD, w=(W, W))
    p.mark("ramp")
    p.straight(JUMP_RAMP, y1=H + JUMP_H, shape="launch", w=(W, W), step=2.0, zone="ramp")
    p.mark("lip")
    p.gap(JUMP_GAP, H + LAND_H)
    p.mark("land")
    p.straight(JUMP_LAND, y1=H, shape="land", w=(W, W), step=2.0, zone="ramp", restart=True)
    p.mark("landed")
    east = (Z_S - R) - (Z_N + R_FLAT)
    p.straight(east - BANK_RUN - JUMP_LEAD - JUMP_RAMP - JUMP_GAP - JUMP_LAND, w=(W, W))
    # Curva del noreste: llana y cerrada. Hay que llegar frenado.
    p.mark("ne")
    p.arc(R_FLAT, 90, 0, w=W, step=1.2, zone="flat")
    # Recta del norte (hacia el oeste): la viga, y al final se ensancha y se inclina.
    p.mark("north")
    north = (X_E - R_FLAT) - (X_W + R)
    p.straight(BEAM_IN, w=(W, W_BEAM), step=2.0, zone="beam")
    p.mark("beam")
    p.straight(BEAM, w=(W_BEAM, W_BEAM), zone="beam")
    p.mark("beam_end")
    p.straight(north - BEAM_IN - BEAM, w=(W_BEAM, W), bank=(0, BANK_NW), step=1.5, zone="bank")
    p.arc(R, 90, BANK_NW, w=W, zone="curve")
    # El cañón (hacia el sur, entre las torres): baja, pasa junto a la plaza y vuelve a subir.
    p.mark("canyon")
    west = (Z_S - R) - (Z_N + R)
    p.straight(12.0, bank=(BANK_NW, 0), w=(W, W_CANYON), step=2.0, zone="bank")
    p.mark("dive")
    p.straight(DIVE_RUN, y1=H - DIVE, shape="ramp", w=(W_CANYON, W_CANYON), step=2.0, zone="canyon")
    p.mark("low")
    p.straight(CANYON_FLAT, w=(W_CANYON, W_CANYON), zone="canyon")
    p.straight(CLIMB_RUN, y1=H, shape="ramp", w=(W_CANYON, W_CANYON), step=2.0, zone="canyon")
    p.mark("top")
    p.straight(west - 12.0 - DIVE_RUN - CANYON_FLAT - CLIMB_RUN, w=(W_CANYON, W), bank=(0, BANK), step=2.0, zone="bank")
    p.arc(R, 90, BANK, w=W, zone="curve")
    # Y de vuelta a la recta de meta: deja de inclinarse y se ensancha.
    p.mark("south")
    p.straight(FINISH_X - (X_W + R), bank=(BANK, 0), w=(W, W_GRID), step=2.0, zone="bank")
    p.mark("end")
    if abs(p.x - FINISH_X) > 1e-6 or abs(p.z - Z_S) > 1e-6 or abs(p.y - H) > 1e-6:
        raise ValueError(f"vértigo: el trazado no cierra ({p.x:.3f}, {p.y:.3f}, {p.z:.3f})")
    frames = p.frames[:-1]  # la última sección es la primera otra vez
    return {"frames": frames, "marks": p.marks, "length": p.s, "turbos": [p.marks["ramp"] + TURBO[0]]}


# La placa de turbo: al empezar la rampa, a un lado (quien ya viene lanzado la deja a su derecha).
TURBO = (1.0, -1.6, 1.9)   # metros desde el principio de la rampa, a lo ancho (negativo = a la derecha) y radio


# --------------------------------------------------------------------------------------
# La malla: calzada, líneas de luz, cantos y quilla
# --------------------------------------------------------------------------------------

DASH_W = 0.2
DASH_ON, DASH_GAP = 3.0, 4.5


def section(f: dict) -> dict:
    """Puntos de una sección: bordes de la calzada y de las líneas de luz, el canto y la quilla."""
    p, b, n, h = f["p"], f["b"], f["n"], f["w"] / 2
    L, Rr = _add(p, b, h), _add(p, b, -h)
    return {
        "L": L, "R": Rr, "Li": _add(p, b, h - EDGE), "Ri": _add(p, b, -(h - EDGE)),
        "Ls": _add(L, n, -SIDE), "Rs": _add(Rr, n, -SIDE),
        "Kl": _add(_add(p, b, KEEL_W), n, -KEEL), "Kr": _add(_add(p, b, -KEEL_W), n, -KEEL),
    }


def strips(pl: dict) -> list[dict]:
    """
    Las tiras de caras de la pista, sección a sección: cada una con su material (`kind`) y sus
    cuatro esquinas (en coordenadas del chunk). Es lo que se dibuja y con lo que se choca.
    """
    out: list[dict] = []
    fr = pl["frames"]
    n = len(fr)

    def quad(kind, a, b, c, d):
        out.append({"kind": kind, "q": (a, b, c, d)})

    def cap(S, back):
        """El frente de la pista donde se corta (el salto): su perfil, cerrado. `back`: mira hacia atrás."""
        if back:
            quad("front", S["R"], S["L"], S["Ls"], S["Rs"])
            quad("front", S["Rs"], S["Ls"], S["Kl"], S["Kr"])
        else:
            quad("front", S["L"], S["R"], S["Rs"], S["Ls"])
            quad("front", S["Ls"], S["Rs"], S["Kr"], S["Kl"])

    for i in range(n):
        a = fr[i]
        b = fr[(i + 1) % n]
        if a.get("cut"):
            cap(section(a), False)
            cap(section(b), True)
            continue
        A, B = section(a), section(b)
        zone = b["zone"]
        # Por arriba: dos líneas de luz y el firme.
        quad("edge", A["L"], A["Li"], B["Li"], B["L"])
        quad(zone, A["Li"], A["Ri"], B["Ri"], B["Li"])
        quad("edge", A["Ri"], A["R"], B["R"], B["Ri"])
        # Línea central a trazos, un pelo por encima del firme (en la viga, seguida).
        mid = (a["s"] + b["s"]) / 2
        if zone != "grid" and (zone == "beam" or mid % (DASH_ON + DASH_GAP) < DASH_ON):
            up_a, up_b = _add(a["p"], a["n"], 0.012), _add(b["p"], b["n"], 0.012)
            quad("dash", _add(up_a, a["b"], DASH_W / 2), _add(up_a, a["b"], -DASH_W / 2), _add(up_b, b["b"], -DASH_W / 2), _add(up_b, b["b"], DASH_W / 2))
        # Los cantos (luz: de lejos y desde abajo se ve el dibujo de la pista) y, por debajo, la quilla.
        quad("side", A["Ls"], A["L"], B["L"], B["Ls"])
        quad("side", A["R"], A["Rs"], B["Rs"], B["R"])
        lit = i % 4 == 0
        quad("belly", A["Kl"], A["Ls"], B["Ls"], B["Kl"])
        quad("belly", A["Rs"], A["Kr"], B["Kr"], B["Rs"])
        quad("pod" if lit else "keel", A["Kr"], A["Kl"], B["Kl"], B["Kr"])
    return out


# --------------------------------------------------------------------------------------
# Lo que se forja (Blender): la pista con sus colores, la plataforma, el pórtico y los aros
# --------------------------------------------------------------------------------------

BLUE, MAGENTA, YELLOW, RED, CYAN, WHITE = "#4fa3ff", "#ff4fd8", "#ffd54f", "#ff4f6d", "#36d9ff", "#eef2ff"
# De qué color es la luz en cada tramo: el cian es el de la carrera; el rojo avisa de donde más se cae.
ZONE_LIGHT = {"road": CYAN, "grid": WHITE, "bank": CYAN, "curve": MAGENTA, "flat": RED, "beam": RED, "ramp": YELLOW, "canyon": CYAN}
ZONE_ROAD = {"grid": "#262b3a", "ramp": "#2a2a36", "beam": "#2b1f2a", "flat": "#2b1f2a", "canyon": "#1c2836"}
ROAD = "#1e2434"
# Los aros del cañón: a cuántos metros de su principio (la marca `canyon`).
HOOPS = [18.0, 40.0, 62.0, 84.0, 106.0]
HOOP_R = 4.6


def lights_at() -> tuple[float, float, float]:
    """El centro de la fila de luces del semáforo (mirando a la parrilla)."""
    return GANTRY_X - 0.62, H + GANTRY_H - 0.4, Z_S


def hoops(pl: dict) -> list[list[tuple[float, float, float]]]:
    """Los aros del cañón: ocho puntos cada uno, alrededor de la pista."""
    out = []
    for d in HOOPS:
        f = at(pl, pl["marks"]["canyon"] + d)
        c = _add(f["p"], f["n"], 1.4)
        out.append([_add(_add(c, f["b"], HOOP_R * math.cos(k * math.pi / 4 + math.pi / 8)), f["n"], HOOP_R * math.sin(k * math.pi / 4 + math.pi / 8)) for k in range(8)])
    return out


def track_object(detail: int):
    """La pista entera, de una pieza: su malla es su colisión (district-activities: mesh_collider)."""
    from kit import CHUNK, Part, finish, mat

    C = CHUNK / 2
    p = Part("arcade_vertigo")
    pl = plan()

    def B(v):
        return (v[0] - C, -(v[2] - C), v[1])

    dark = mat("metal", "#151a28")
    under = mat("metal", "#1b2030")
    zone_of = "road"
    for st in strips(pl):
        k = st["kind"]
        if k in ZONE_LIGHT:
            zone_of = k
            m = mat("panel", ZONE_ROAD.get(k, ROAD))
        elif k in ("edge", "side", "pod"):
            m = mat("neon", ZONE_LIGHT[zone_of])
        elif k == "dash":
            m = mat("neon", ZONE_LIGHT[zone_of] if zone_of == "beam" else WHITE)
        elif k == "front":
            m = dark
        else:
            m = under
        p.poly([B(v) for v in st["q"]], m)

    def box(x0, z0, x1, z1, y0, y1, m, skip=()):
        p.box((x0 - C, -(z1 - C), y0), (x1 - C, -(z0 - C), y1), m, skip=skip)

    white = mat("pintado", "#eef2f8")
    black = mat("pintado", "#12141c")
    # Línea de meta (ajedrezado de dos filas) y los cajones de la parrilla, un pelo por encima del firme.
    y = H + 0.012
    n = 9
    for row in range(2):
        for k in range(n):
            x0 = FINISH_X - 0.6 + row * 0.6
            z0 = Z_S - W_GRID / 2 + EDGE + k * (W_GRID - 2 * EDGE) / n
            box(x0, z0, x0 + 0.6, z0 + (W_GRID - 2 * EDGE) / n, y, y + 0.004, white if (row + k) % 2 == 0 else black, skip=("-z",))
    for gx in GRID_X:
        for gz in GRID_Z:
            box(gx + 2.5, gz - 1.5, gx + 2.68, gz + 1.5, y, y + 0.004, white, skip=("-z",))
            for sz in (-1.5, 1.32):
                box(gx + 0.9, gz + sz, gx + 2.5, gz + sz + 0.18, y, y + 0.004, white, skip=("-z",))
    # La plataforma: a ras de pista, con su barandilla por fuera (al sur y a los lados) y su filo de luz.
    x0, x1 = PLAT_X
    z0, z1 = PLAT_Z
    box(x0, z0, x1, z1, H - 0.45, H, mat("panel", "#232a3c"))
    box(x0, z0, x1, z1, H - 0.5, H - 0.45, mat("neon", CYAN), skip=("+z",))
    for rx0, rz0, rx1, rz1 in ((x0, z1 - 0.2, x1, z1), (x0, z0, x0 + 0.2, z1), (x1 - 0.2, z0, x1, z1)):
        box(rx0, rz0, rx1, rz1, H, H + RAIL_H, dark)
        box(rx0 - 0.01, rz0 - 0.01, rx1 + 0.01, rz1 + 0.01, H + RAIL_H, H + RAIL_H + 0.06, mat("neon", CYAN))
    # El marco de la puerta de vuelta (el velo lo dibuja el cliente: portal@1), contra la barandilla del oeste.
    dz = (z0 + z1) / 2
    for z in (dz - PORTAL[0] / 2 - 0.2, dz + PORTAL[0] / 2):
        box(x0 + 0.2, z, x0 + 0.5, z + 0.2, H, H + PORTAL[1] + 0.3, dark)
    box(x0 + 0.2, dz - PORTAL[0] / 2 - 0.2, x0 + 0.5, dz + PORTAL[0] / 2 + 0.2, H + PORTAL[1] + 0.1, H + PORTAL[1] + 0.4, dark)
    box(x0 + 0.5, dz - PORTAL[0] / 2 - 0.2, x0 + 0.54, dz + PORTAL[0] / 2 + 0.2, H + PORTAL[1] + 0.16, H + PORTAL[1] + 0.34, mat("neon", CYAN))
    # Pórtico de salida: un marco alrededor de la pista (dos postes por fuera, una viga por debajo y
    # el dintel con su pantalla y los cinco semáforos).
    gz0, gz1 = Z_S - W_GRID / 2 - 0.9, Z_S + W_GRID / 2 + 0.9
    for z in (gz0, gz1):
        box(GANTRY_X - 0.3, z - 0.3, GANTRY_X + 0.3, z + 0.3, H - 1.9, H + GANTRY_H + 1.4, dark)
        box(GANTRY_X - 0.32, z - 0.32, GANTRY_X + 0.32, z + 0.32, H + 1.6, H + 1.75, mat("neon", CYAN))
    box(GANTRY_X - 0.3, gz0, GANTRY_X + 0.3, gz1, H - 1.9, H - 1.5, dark)
    box(GANTRY_X - 0.4, gz0, GANTRY_X + 0.4, gz1, H + GANTRY_H, H + GANTRY_H + 1.4, dark)
    box(GANTRY_X - 0.46, gz0 + 0.6, GANTRY_X - 0.4, gz1 - 0.6, H + GANTRY_H + 0.15, H + GANTRY_H + 1.25, mat("pantalla", CYAN))
    # (Las luces van apagadas en el modelo: las enciende el cliente con la cuenta atrás, lights_at().)
    lx0, ly0, _ = lights_at()
    for k in range(5):
        lz = Z_S + (k - 2) * LIGHT_GAP
        box(lx0, lz - 0.34, GANTRY_X - 0.4, lz + 0.34, ly0 - 0.35, ly0 + 0.35, dark)
        p.sphere((lx0 - C, -(lz - C), ly0), 0.24, mat("metal", "#2a0d12"), subdiv=2 if detail else 1)
    # Los aros del cañón (se ven desde la plaza: los coches pasan por dentro).
    for ring in hoops(pl):
        p.tube([B(v) for v in ring], 0.16, mat("neon", MAGENTA), segments=6 if detail else 4, closed=True)
    # La puerta del suelo: su marco, junto a la recta de meta del Gran Premio.
    gx, gz = GROUND_DOOR
    for z in (gz - PORTAL[0] / 2 - 0.2, gz + PORTAL[0] / 2):
        box(gx, z, gx + 0.3, z + 0.2, 0, PORTAL[1] + 0.3, dark)
    box(gx, gz - PORTAL[0] / 2 - 0.2, gx + 0.3, gz + PORTAL[0] / 2 + 0.2, PORTAL[1] + 0.1, PORTAL[1] + 0.4, dark)
    box(gx - 0.04, gz - PORTAL[0] / 2 - 0.2, gx, gz + PORTAL[0] / 2 + 0.2, PORTAL[1] + 0.16, PORTAL[1] + 0.34, mat("neon", CYAN))
    ob = p.to_object()
    ob.name = "arcade_vertigo"
    finish(ob)
    return ob


# --------------------------------------------------------------------------------------
# La ficha: la carrera, la parrilla, la placa de turbo, los marcadores, los carteles y las puertas
# --------------------------------------------------------------------------------------

RACE = "vertigo"
LAPS = 3
CP_RADIUS = 7.0


def checkpoints(pl: dict) -> list[list[float]]:
    """
    Los puntos de la carrera, en orden, cada uno con su rumbo (cuarto valor, grados): van en las
    rectas, después de cada curva y de cada trampa, porque también son los sitios a los que vuelve
    quien se cae (con sitio por delante para coger velocidad: el primero, antes del salto).
    """
    m = pl["marks"]
    where = [m["east"] + BANK_RUN + 1, m["landed"] + 8, m["north"] + 4, m["beam_end"] + 6, m["canyon"] + 6, m["low"] + CANYON_FLAT / 2, m["top"] + 6]
    out = []
    for s in where:
        f = at(pl, s)
        out.append([round(f["p"][0], 2), round(f["p"][1], 2), round(f["p"][2], 2), _heading_yaw(f["t"])])
    return out


def write_activities(path: str = ACTIVITIES) -> None:
    """Deja en la ficha de Arcade lo que sale del trazado (lo demás, como estaba)."""
    pl = plan()
    data = json.load(open(path, encoding="utf-8"))
    a = data["arcade"]
    own = lambda e: e.get("vertigo")  # noqa: E731  (lo que pone esta función lleva su marca)
    a["props"] = [e for e in a.get("props", []) if e.get("piece") != "arcade_vertigo"] + [
        {"piece": "arcade_vertigo", "p": [32, 0, 32], "yaw": 0, "half": [0, 0, 0], "mesh_collider": True}]
    a["races"] = [r for r in a.get("races", []) if r["id"] != RACE] + [{
        "id": RACE, "vehicle": "car", "mode": "grid", "laps": LAPS, "radius": CP_RADIUS,
        "start": {"p": [START[0], H, START[1]], "radius": 8.0, "yaw": _heading_yaw((1.0, 0.0, 0.0))},
        "grid": [[gx, H, gz] for gx in GRID_X[::-1] for gz in GRID_Z],
        "lights": [round(c, 2) for c in lights_at()],
        "cps": checkpoints(pl),
        "finish": {"p": [FINISH_X, H, Z_S], "radius": CP_RADIUS, "yaw": _heading_yaw((1.0, 0.0, 0.0))},
    }]
    f = at(pl, pl["turbos"][0])
    side = _add(f["p"], f["b"], TURBO[1])
    turbo = {"p": [round(side[0], 2), round(side[1] + 0.03, 2), round(side[2], 2)], "yaw": _heading_yaw(f["t"]), "radius": TURBO[2], "speed": 12, "seconds": 1, "vertigo": True}
    a["boosts"] = [e for e in a.get("boosts", []) if not own(e)] + [turbo]
    bz = PLAT_Z[1] - 0.35
    bx = (PLAT_X[0] + PLAT_X[1]) / 2 + 6
    boards = [
        {"kind": "race", "id": RACE, "period": "week", "p": [bx - 4.2, H + 2.9, bz], "yaw": 180, "size": [4.6, 3.2],
         "title": {"es": "VÉRTIGO · SEMANA", "en": "VERTIGO · WEEK"}, "title_size": 0.4, "vertigo": True},
        {"kind": "race", "id": RACE, "period": "all", "p": [bx + 4.2, H + 2.9, bz], "yaw": 180, "size": [4.6, 3.2],
         "title": {"es": "VÉRTIGO · SIEMPRE", "en": "VERTIGO · ALL TIME"}, "title_size": 0.4, "vertigo": True},
    ]
    a["boards"] = [e for e in a.get("boards", []) if not own(e)] + boards
    gx, gz = GROUND_DOOR
    labels = [
        {"text": {"es": "CIRCUITO VÉRTIGO", "en": "VERTIGO CIRCUIT"}, "p": [GANTRY_X - 0.5, H + GANTRY_H + 2.1, Z_S], "yaw": 270, "size": 0.9, "vertigo": True},
        {"text": {"es": "PARRILLA", "en": "GRID"}, "p": [GRID_X[0] - 3.0, H + 0.03, Z_S], "yaw": 270, "size": 0.7, "flat": True, "vertigo": True},
        {"text": {"es": "Tres vueltas sin quitamiedos. Saca el coche (C) y párate en la parrilla; si te caes, vuelves al último punto.",
                  "en": "Three laps, no guard rails. Get your car (C) and stop on the grid; if you fall, you go back to the last gate."},
         "p": [bx, H + 5.2, bz], "yaw": 180, "size": 0.34, "width": 9.4, "max_distance": 60, "vertigo": True},
        {"text": {"es": "CIRCUITO VÉRTIGO", "en": "VERTIGO CIRCUIT"}, "p": [gx - 0.06, PORTAL[1] + 0.85, gz], "yaw": 270, "size": 0.42, "vertigo": True},
        {"text": {"es": "La carrera del cielo: más difícil que el Gran Premio.", "en": "The race in the sky: harder than the Grand Prix."},
         "p": [gx - 0.06, PORTAL[1] + 1.35, gz], "yaw": 270, "size": 0.22, "width": 5, "max_distance": 40, "vertigo": True},
    ]
    a["labels"] = [e for e in a.get("labels", []) if not own(e)] + labels
    # Una caja bajo la parrilla y la plataforma, a ras: quien llega ahí de un salto (el enlace, la
    # guía, la puerta) aparece antes de que la malla de la pista haya cargado, y sin ella se caía.
    zs0, zs1 = Z_S - W_GRID / 2, PLAT_Z[1]
    a["solids"] = [e for e in a.get("solids", []) if not own(e)] + [
        {"p": [(PLAT_X[0] + PLAT_X[1]) / 2, H - 0.2, (zs0 + zs1) / 2], "half": [(PLAT_X[1] - PLAT_X[0]) / 2, 0.2, (zs1 - zs0) / 2], "vertigo": True}]
    # Las puertas: se cruzan a pie. La del suelo sube a la plataforma; la de la plataforma baja a su lado.
    dz = (PLAT_Z[0] + PLAT_Z[1]) / 2
    a["portals"] = [e for e in a.get("portals", []) if not own(e)] + [
        {"p": [gx + 0.1, PORTAL[1] / 2, gz], "yaw": 270, "size": list(PORTAL), "color": CYAN,
         "title": {"es": "Circuito Vértigo", "en": "Vertigo Circuit"},
         "to": {"p": [PLAT_X[0] + 6.0, H, dz], "yaw": 0}, "vertigo": True},
        {"p": [PLAT_X[0] + 0.6, H + PORTAL[1] / 2, dz], "yaw": 90, "size": list(PORTAL), "color": BLUE,
         "title": {"es": "Bajar a Arcade", "en": "Back down to Arcade"},
         "to": {"p": [gx - 5.0, 0, gz], "yaw": 90}, "vertigo": True},
    ]
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    write_line(pl)
    print(f"[forja] circuito Vértigo: {pl['length']:.0f} m, {len(a['races'][-1]['cps'])} puntos, a {H:.0f} m")


def write_line(pl: dict, path: str = LINE) -> None:
    """La línea central (un punto por sección, con sus metros desde la meta, su tramo y su ancho) y las marcas."""
    line = [[round(f["p"][0], 2), round(f["p"][1], 2), round(f["p"][2], 2), round(f["s"], 1), f["zone"], round(f["w"], 2)] for f in pl["frames"]]
    out = {"length": round(pl["length"], 2), "marks": {k: round(v, 1) for k, v in pl["marks"].items()}, "turbos": [round(t, 1) for t in pl["turbos"]], "line": line}
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(out, separators=(",", ":")) + "\n")


def dump(path: str) -> None:
    """Vuelca la pista (triángulos y línea central) para las pruebas del coche."""
    pl = plan()
    pos: list[float] = []
    idx: list[int] = []
    for st in strips(pl):
        base = len(pos) // 3
        for v in st["q"]:
            pos.extend(round(c, 4) for c in v)
        idx.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    line = [{"p": [round(c, 3) for c in f["p"]], "s": round(f["s"], 2), "zone": f["zone"], "w": f["w"]} for f in pl["frames"]]
    json.dump({"positions": pos, "index": idx, "line": line, "length": round(pl["length"], 2), "marks": pl["marks"], "turbos": pl["turbos"], "cps": checkpoints(pl)}, open(path, "w"))
    print(f"vértigo: {pl['length']:.0f} m, {len(pl['frames'])} secciones, {len(idx) // 3} triángulos")


if __name__ == "__main__":
    dump(sys.argv[1] if len(sys.argv) > 1 else "/dev/stdout")
