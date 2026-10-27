"""
Decorado temático de las islas del nexo: cada distrito pone en los huecos de su isla
(`islands.decor` de nexo-layout.json) cosas de su tema. Todo en una pieza por distrito, en
coordenadas de la isla (Blender: x igual, y = −z de la isla), con los materiales de la biblioteca.
Piezas bajas y de pocos triángulos: la isla entera se ve desde lejos y en la Quest.
"""
from __future__ import annotations

import math

from mathutils import Matrix

from kit import Part, finish, mat


def _put(target: Part, item: Part, x: float, z: float, rot: float) -> None:
    target.merge(item, Matrix.Translation((x, -z, 0.0)) @ Matrix.Rotation(math.radians(rot), 4, "Z"))


# ---------------------------------------------------------------- Arcade (juegos 3D)

def cabinet(color: str) -> Part:
    """Máquina recreativa: mueble oscuro, pantalla encendida, marquesina y mandos."""
    p = Part("cabinet")
    body, trim, neon = mat("metal", "#1b1f2e"), mat("metal", "#2c3348"), mat("neon", color)
    p.box((-0.42, -0.36, 0.0), (0.42, 0.36, 1.85), body)
    p.box((-0.34, -0.38, 1.0), (0.34, -0.36, 1.5), mat("neon", "#9cd8ff"))  # pantalla
    p.box((-0.42, -0.42, 1.62), (0.42, -0.34, 1.82), neon)  # marquesina
    p.box((-0.4, -0.62, 0.82), (0.4, -0.36, 0.92), trim)  # panel de mandos
    p.cylinder((-0.18, -0.5, 0.92), 0.025, 0.12, trim, segments=6)
    p.sphere((-0.18, -0.5, 1.06), 0.05, mat("neon", "#ff4f6d"), subdiv=1)
    for i, c in enumerate(("#ffd54f", "#6dff8a", "#ff4fd8")):
        p.cylinder((0.05 + i * 0.11, -0.5, 0.92), 0.035, 0.02, mat("neon", c), segments=8)
    p.box((-0.43, -0.37, 0.05), (-0.41, 0.37, 1.8), neon)  # filos de luz
    p.box((0.41, -0.37, 0.05), (0.43, 0.37, 1.8), neon)
    return p


def joystick(color: str) -> Part:
    """Palanca gigante de recreativa."""
    p = Part("joystick")
    p.cylinder((0, 0, 0), 0.75, 0.45, mat("metal", "#1b1f2e"), segments=20)
    p.lathe((0, 0, 0), [(0.77, 0.4), (0.77, 0.47)], mat("neon", color), segments=20)
    p.cylinder((0, 0, 0.45), 0.08, 1.15, mat("metal", "#c8cfdc"), segments=10)
    p.sphere((0, 0, 1.75), 0.3, mat("neon", "#ff4f6d"), subdiv=2)
    return p


def coin(color: str) -> Part:
    """Moneda de juego gigante sobre su peana."""
    p = Part("coin")
    p.cylinder((0, 0, 0), 0.45, 0.6, mat("metal", "#1b1f2e"), segments=12)
    p.cylinder((0, -0.09, 1.45), 0.75, 0.18, mat("metal", "#ffc94f"), segments=24, axis="y")
    p.cylinder((0, -0.1, 1.45), 0.55, 0.2, mat("neon", "#ffe28a"), segments=24, axis="y", caps=(True, True))
    p.box((-0.05, -0.1, 0.6), (0.05, 0.1, 0.72), mat("metal", "#2c3348"))
    return p


# ---------------------------------------------------------------- Píxel (juegos 2D)

def _voxels(p: Part, cells: list[tuple[int, int, int]], size: float, m, z0: float = 0.0) -> None:
    for (i, j, k) in cells:
        p.box((i * size, j * size, z0 + k * size), ((i + 1) * size, (j + 1) * size, z0 + (k + 1) * size), m)


def voxel_tree(color: str) -> Part:
    p = Part("voxel_tree")
    s = 0.45
    _voxels(p, [(0, 0, k) for k in range(3)], s, mat("corteza", "#7a5232"))
    leaf = mat("hoja", "#3fbf5a")
    cells = [(i, j, k) for i in range(-1, 2) for j in range(-1, 2) for k in range(3, 5)]
    cells += [(0, 0, 5), (1, 0, 5), (0, -1, 5)]
    _voxels(p, [c for c in cells if not (abs(c[0]) == 1 and abs(c[1]) == 1 and c[2] == 4)], s, leaf)
    return p


def pixel_heart(color: str) -> Part:
    """Corazón de píxeles de pie, sobre su peana."""
    p = Part("pixel_heart")
    p.box((-0.35, -0.35, 0.0), (0.35, 0.35, 0.5), mat("metal", "#1b1f2e"))
    rows = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"]
    s = 0.2
    m = mat("neon", "#ff4f6d")
    for r, line in enumerate(rows):
        for c, ch in enumerate(line):
            if ch == "1":
                x = (c - 3.5) * s
                z = 0.6 + (len(rows) - 1 - r) * s
                p.box((x, -0.08, z), (x + s, 0.08, z + s), m)
    return p


def voxel_flower(color: str) -> Part:
    p = Part("voxel_flower")
    s = 0.25
    _voxels(p, [(0, 0, k) for k in range(4)], s, mat("hoja", "#3fbf5a"))
    _voxels(p, [(1, 0, 1), (-1, 0, 2)], s, mat("hoja", "#56d86f"))
    petal = mat("flor", color)
    _voxels(p, [(-1, 0, 4), (1, 0, 4), (0, -1, 4), (0, 1, 4), (0, 0, 5)], s, petal)
    _voxels(p, [(0, 0, 4)], s, mat("neon", "#ffe28a"))
    return p


# ---------------------------------------------------------------- Ágora (quedadas)

def cafe_table(color: str) -> Part:
    """Mesa de terraza con sombrilla y dos taburetes."""
    p = Part("cafe_table")
    metal = mat("metal", "#2c3348")
    p.cylinder((0, 0, 0), 0.06, 0.72, metal, segments=8)
    p.cylinder((0, 0, 0.72), 0.45, 0.04, mat("madera", "#a8774a"), segments=16)
    p.cylinder((0, 0, 0.76), 0.03, 1.5, metal, segments=6)
    p.lathe((0, 0, 0), [(1.15, 2.05), (0.0001, 2.45)], mat("toldo", color), segments=12, close_bottom=True)
    for a in (0.0, math.pi):
        x, y = math.cos(a) * 0.75, math.sin(a) * 0.75
        p.cylinder((x, y, 0), 0.04, 0.45, metal, segments=6)
        p.cylinder((x, y, 0.45), 0.2, 0.05, mat("madera", "#a8774a"), segments=10)
    return p


def speakers(color: str) -> Part:
    """Torre de altavoces de fiesta."""
    p = Part("speakers")
    body = mat("metal", "#14161f")
    for i, h in enumerate((0.0, 0.85)):
        p.box((-0.5, -0.4, h), (0.5, 0.4, h + 0.8), body)
        p.cylinder((0, -0.41, h + 0.4), 0.28, 0.02, mat("neon", color), segments=18, axis="y")
        p.cylinder((0, -0.43, h + 0.4), 0.18, 0.03, mat("oscuro", "#050608"), segments=14, axis="y")
    p.box((-0.52, -0.42, 1.65), (0.52, 0.42, 1.72), mat("neon", color))
    return p


def string_lamp(color: str) -> Part:
    """Farol de verbena: poste con guirnalda de bombillas."""
    p = Part("string_lamp")
    p.cylinder((0, 0, 0), 0.06, 2.6, mat("hierro", "#2a2a30"), segments=8)
    p.box((-0.9, -0.03, 2.5), (0.9, 0.03, 2.56), mat("hierro", "#2a2a30"))
    for i in range(7):
        x = -0.9 + i * 0.3
        sag = 0.18 * math.sin(math.pi * i / 6)
        p.sphere((x, 0, 2.42 - sag), 0.07, mat("farol", ("#ffd27a", color)[i % 2]), subdiv=1)
    return p


# ---------------------------------------------------------------- Taller (herramientas)

def crates(color: str) -> Part:
    p = Part("crates")
    wood, band = mat("madera", "#9b7046"), mat("metal", "#3a4256")
    for (x, y, z, s) in ((-0.45, 0, 0, 0.8), (0.45, 0.05, 0, 0.75), (0.0, 0.0, 0.8, 0.7)):
        p.box((x - s / 2, y - s / 2, z), (x + s / 2, y + s / 2, z + s), wood)
        p.box((x - s / 2 - 0.01, y - s / 2 - 0.01, z + s * 0.45), (x + s / 2 + 0.01, y + s / 2 + 0.01, z + s * 0.55), band)
    p.box((-0.12, -0.36, 1.1), (0.12, -0.34, 1.3), mat("neon", color))
    return p


def gear(color: str) -> Part:
    """Engranaje gigante de pie."""
    p = Part("gear")
    steel = mat("metal", "#8c95a8")
    p.box((-0.5, -0.3, 0), (0.5, 0.3, 0.35), mat("metal", "#2c3348"))
    cz = 1.25
    p.cylinder((0, -0.12, cz), 0.8, 0.24, steel, segments=24, axis="y")
    for i in range(12):
        a = 2 * math.pi * i / 12
        x, z = math.cos(a) * 0.92, math.sin(a) * 0.92
        p.box((x - 0.12, -0.12, cz + z - 0.12), (x + 0.12, 0.12, cz + z + 0.12), steel)
    p.cylinder((0, -0.14, cz), 0.25, 0.28, mat("neon", color), segments=16, axis="y")
    return p


def robot_arm(color: str) -> Part:
    p = Part("robot_arm")
    body, joint = mat("metal", "#ffb84f"), mat("metal", "#2c3348")
    p.cylinder((0, 0, 0), 0.55, 0.35, joint, segments=16)
    p.cylinder((0, 0, 0.35), 0.35, 0.3, body, segments=14)
    p.tube([(0, 0, 0.6), (0.2, 0, 1.5)], 0.14, body, segments=8)
    p.sphere((0.2, 0, 1.55), 0.2, joint, subdiv=1)
    p.tube([(0.2, 0, 1.55), (0.95, 0, 1.25)], 0.11, body, segments=8)
    p.sphere((0.95, 0, 1.25), 0.15, joint, subdiv=1)
    p.box((1.0, -0.12, 0.95), (1.08, 0.12, 1.2), mat("neon", color))
    return p


# ---------------------------------------------------------------- Frontera (experimentos)

def crystals(color: str) -> Part:
    p = Part("crystals")
    m = mat("neon", color)
    for (x, y, h, r, tilt) in ((0, 0, 2.1, 0.32, 0.0), (0.45, 0.15, 1.3, 0.22, 0.25), (-0.4, -0.1, 1.6, 0.25, -0.2), (0.1, -0.45, 0.9, 0.18, 0.3)):
        c = Part("c")
        c.lathe((0, 0, 0), [(r, 0.0), (r, h * 0.7), (0.0001, h)], m, segments=6, smooth=False)
        p.merge(c, Matrix.Translation((x, y, 0)) @ Matrix.Rotation(tilt, 4, "X"))
    p.sphere((0, 0, 0.05), 0.75, mat("piedra", "#4a4f5c"), subdiv=1, squash=0.35)
    return p


def dish(color: str) -> Part:
    """Antena parabólica de puesto avanzado."""
    p = Part("dish")
    frame = mat("metal", "#8c95a8")
    p.cylinder((0, 0, 0), 0.4, 0.3, mat("metal", "#2c3348"), segments=10)
    p.cylinder((0, 0, 0.3), 0.07, 1.3, frame, segments=8)
    d = Part("d")
    d.lathe((0, 0, 0), [(0.0001, 0.0), (0.6, 0.12), (1.0, 0.38)], mat("metal", "#c8cfdc"), segments=18)
    d.cylinder((0, 0, 0.0), 0.03, 0.8, frame, segments=6)
    d.sphere((0, 0, 0.82), 0.08, mat("neon", color), subdiv=1)
    p.merge(d, Matrix.Translation((0, 0, 1.6)) @ Matrix.Rotation(math.radians(-55), 4, "X"))
    return p


def rock(color: str) -> Part:
    p = Part("rock")
    stone = mat("piedra", "#5b6070")
    p.sphere((0, 0, 0.3), 0.8, stone, subdiv=1, squash=0.6)
    p.sphere((0.55, 0.2, 0.2), 0.45, stone, subdiv=1, squash=0.7)
    p.box((-0.05, -0.81, 0.25), (0.05, -0.79, 0.65), mat("neon", color))
    return p


# ---------------------------------------------------------------- Distrito Cero (ciberpunk)

def neon_sign(color: str) -> Part:
    """Poste con letreros de neón en bandera, uno encima de otro (sin letras: solo barras de luz)."""
    p = Part("neon_sign")
    metal = mat("metal", "#1b1f2e")
    p.box((-0.3, -0.3, 0.0), (0.3, 0.3, 0.25), metal)
    p.cylinder((0, 0, 0.25), 0.07, 3.0, metal, segments=8)
    for i, (h, w, c) in enumerate(((1.4, 0.55, color), (2.15, 0.7, "#36d9ff"), (2.85, 0.45, "#ff4f8b"))):
        side = 1 if i % 2 == 0 else -1
        x0 = 0.07 if side > 0 else -0.07 - w
        p.box((x0, -0.06, h), (x0 + w, 0.06, h + 0.5), mat("metal", "#0d1018"))
        p.box((x0 + 0.06, -0.08, h + 0.08), (x0 + w - 0.06, -0.06, h + 0.16), mat("neon", c))
        p.box((x0 + 0.06, -0.08, h + 0.3), (x0 + w * 0.6, -0.06, h + 0.38), mat("neon", c))
    return p


def vending(color: str) -> Part:
    """Máquina expendedora con frontal encendido."""
    p = Part("vending")
    body = mat("metal", "#232a3c")
    p.box((-0.45, -0.38, 0.0), (0.45, 0.38, 1.9), body)
    p.box((-0.38, -0.4, 0.55), (0.18, -0.38, 1.75), mat("neon", "#cfe8ff"))  # escaparate
    for k in range(4):
        z = 0.7 + k * 0.27
        p.box((-0.34, -0.42, z), (0.14, -0.4, z + 0.03), mat("neon", color))
    p.box((0.24, -0.4, 1.0), (0.38, -0.38, 1.5), mat("metal", "#0d1018"))  # panel
    p.box((-0.38, -0.4, 0.15), (0.38, -0.38, 0.4), mat("oscuro", "#050608"))  # cajón
    p.box((-0.46, -0.39, 1.82), (0.46, 0.39, 1.9), mat("neon", color))
    return p


def data_pylon(color: str) -> Part:
    """Columna de datos: pilar oscuro con anillos de luz y cables al suelo."""
    p = Part("data_pylon")
    dark, cable = mat("metal", "#14161f"), mat("oscuro", "#050608")
    p.cylinder((0, 0, 0), 0.6, 0.2, mat("metal", "#2c3348"), segments=8)
    p.cylinder((0, 0, 0.2), 0.32, 2.6, dark, segments=8)
    for k, c in enumerate((color, "#36d9ff", color)):
        p.cylinder((0, 0, 0.8 + k * 0.6), 0.34, 0.07, mat("neon", c), segments=8)
    p.sphere((0, 0, 2.95), 0.18, mat("neon", "#36d9ff"), subdiv=1)
    for a in (0.4, 2.3, 4.2):
        p.tube([(math.cos(a) * 0.3, math.sin(a) * 0.3, 0.5), (math.cos(a) * 0.65, math.sin(a) * 0.65, 0.05)], 0.04, cable, segments=6)
    return p


# ---------------------------------------------------------------- Vertical (torres de caravanas)

def trailer(color: str) -> Part:
    """Caravana pequeña de chapa, con ventanas encendidas y su toldo."""
    p = Part("trailer")
    shell, trim = mat("metal", "#b9b2a4"), mat("metal", "#3a4256")
    p.box((-0.75, -0.42, 0.25), (0.75, 0.42, 1.35), shell)
    p.box((-0.77, -0.44, 0.75), (0.77, 0.44, 0.82), mat("metal", color))  # franja
    for x in (-0.45, 0.25):
        p.box((x, -0.44, 0.9), (x + 0.3, -0.42, 1.15), mat("farol", "#ffd27a"))
    p.box((-0.15, -0.44, 0.3), (0.1, -0.42, 0.95), trim)  # puerta
    p.box((-0.5, -0.8, 1.2), (0.6, -0.42, 1.24), mat("toldo", color))
    for x in (-0.5, 0.5):
        p.cylinder((x, -0.46, 0.18), 0.18, 0.92, mat("oscuro", "#050608"), segments=10, axis="y")
    p.box((-0.75, -0.4, 0.0), (0.75, 0.4, 0.06), trim)
    return p


def scaffold(color: str) -> Part:
    """Torre de andamio con una tabla y una bombilla colgando."""
    p = Part("scaffold")
    pipe = mat("hierro", "#5b6070")
    h = 2.8
    for x in (-0.6, 0.6):
        for y in (-0.6, 0.6):
            p.cylinder((x, y, 0), 0.04, h, pipe, segments=6)
    for z in (0.9, 1.8, 2.7):
        for (a, b) in (((-0.6, -0.6), (0.6, -0.6)), ((-0.6, 0.6), (0.6, 0.6)), ((-0.6, -0.6), (-0.6, 0.6)), ((0.6, -0.6), (0.6, 0.6))):
            p.tube([(a[0], a[1], z), (b[0], b[1], z)], 0.03, pipe, segments=6)
    p.tube([(-0.6, -0.6, 0.1), (0.6, -0.6, 0.9)], 0.025, pipe, segments=6)
    p.box((-0.62, -0.62, 1.8), (0.62, 0.62, 1.86), mat("madera", "#9b7046"))
    p.tube([(0.0, 0.0, 2.7), (0.0, 0.0, 2.35)], 0.01, mat("oscuro", "#050608"), segments=4)
    p.sphere((0.0, 0.0, 2.3), 0.07, mat("farol", "#ffd27a"), subdiv=1)
    return p


def tires(color: str) -> Part:
    """Pila de neumáticos viejos con una lata encima."""
    p = Part("tires")
    rubber = mat("oscuro", "#1a1b20")
    for k, (x, y) in enumerate(((0.0, 0.0), (0.06, -0.04), (-0.05, 0.03), (0.02, 0.05))):
        n = 16
        ring = [(x + 0.42 * math.cos(2 * math.pi * i / n), y + 0.42 * math.sin(2 * math.pi * i / n), 0.12 + k * 0.24) for i in range(n)]
        p.tube(ring, 0.12, rubber, segments=8, closed=True)
    p.cylinder((0.0, 0.0, 0.96), 0.14, 0.3, mat("metal", color), segments=10)
    return p


def fire_barrel(color: str) -> Part:
    """Bidón con fuego, donde se calientan los vecinos."""
    p = Part("fire_barrel")
    p.cylinder((0, 0, 0), 0.32, 0.9, mat("metal", "#7a4a32"), segments=12)
    for z in (0.25, 0.65):
        p.cylinder((0, 0, z), 0.335, 0.05, mat("metal", "#3a2a22"), segments=12)
    p.lathe((0, 0, 0.88), [(0.26, 0.0), (0.16, 0.25), (0.0001, 0.5)], mat("neon", "#ff8a2c"), segments=7, smooth=False)
    return p


# ---------------------------------------------------------------- La Plaza (mediterránea)

def orange_tree(color: str) -> Part:
    p = Part("orange_tree")
    p.cylinder((0, 0, 0), 0.5, 0.45, mat("piedra", "#d9cfb8"), segments=12)
    p.cylinder((0, 0, 0.45), 0.12, 1.1, mat("corteza", "#6b4a2c"), segments=7)
    p.sphere((0, 0, 1.9), 0.75, mat("hoja", "#2f7d3a"), subdiv=2, squash=0.85)
    for (x, y, z) in ((0.5, -0.4, 1.8), (-0.45, -0.35, 2.05), (0.1, -0.6, 2.2), (-0.3, 0.5, 1.7), (0.55, 0.3, 2.1)):
        p.sphere((x, y, z), 0.09, mat("fruta", "#ff9e2c"), subdiv=1)
    return p


def bench(color: str) -> Part:
    p = Part("bench")
    wood, iron = mat("madera", "#a8774a"), mat("hierro", "#2a2a30")
    p.box((-0.9, -0.22, 0.42), (0.9, 0.22, 0.48), wood)
    p.box((-0.9, 0.2, 0.5), (0.9, 0.26, 0.9), wood)
    for x in (-0.75, 0.75):
        p.box((x - 0.04, -0.22, 0.0), (x + 0.04, 0.24, 0.42), iron)
    return p


def lamp(color: str) -> Part:
    p = Part("lamp")
    iron = mat("hierro", "#2a2a30")
    p.cylinder((0, 0, 0), 0.16, 0.3, iron, segments=8)
    p.cylinder((0, 0, 0.3), 0.05, 2.6, iron, segments=8)
    p.lathe((0, 0, 2.85), [(0.0001, 0.0), (0.2, 0.05), (0.16, 0.45), (0.22, 0.5), (0.0001, 0.62)], mat("farol", "#ffd27a"), segments=8)
    return p


BUILDERS = {
    "cabinet": cabinet, "joystick": joystick, "coin": coin,
    "voxel_tree": voxel_tree, "pixel_heart": pixel_heart, "voxel_flower": voxel_flower,
    "cafe_table": cafe_table, "speakers": speakers, "string_lamp": string_lamp,
    "crates": crates, "gear": gear, "robot_arm": robot_arm,
    "crystals": crystals, "dish": dish, "rock": rock,
    "neon_sign": neon_sign, "vending": vending, "data_pylon": data_pylon,
    "trailer": trailer, "scaffold": scaffold, "tires": tires, "fire_barrel": fire_barrel,
    "orange_tree": orange_tree, "bench": bench, "lamp": lamp,
}

# Qué va en cada hueco (`islands.decor`, en el mismo orden) según el distrito.
THEMES = {
    "plaza": ["orange_tree", "bench", "lamp", "orange_tree", "bench", "orange_tree", "lamp", "orange_tree"],
    "arcade": ["cabinet", "cabinet", "joystick", "cabinet", "coin", "cabinet", "coin", "joystick"],
    "pixel": ["voxel_tree", "pixel_heart", "voxel_flower", "voxel_tree", "voxel_flower", "voxel_tree", "pixel_heart", "voxel_flower"],
    "agora": ["cafe_table", "string_lamp", "speakers", "cafe_table", "string_lamp", "cafe_table", "speakers", "string_lamp"],
    "taller": ["crates", "gear", "robot_arm", "crates", "gear", "robot_arm", "crates", "gear"],
    "frontera": ["crystals", "dish", "rock", "crystals", "rock", "dish", "crystals", "rock"],
    "cero": ["neon_sign", "vending", "data_pylon", "neon_sign", "vending", "data_pylon", "neon_sign", "vending"],
    "vertical": ["trailer", "fire_barrel", "scaffold", "tires", "trailer", "scaffold", "fire_barrel", "tires"],
}


def build(lay: dict, district_id: str, color: str, detail: int = 1):
    """Todo el decorado de la isla de un distrito en una pieza (los dos niveles, iguales: son pocas piezas y llevan colisión)."""
    spots = lay["islands"]["decor"]
    theme = THEMES[district_id]
    p = Part(f"nexo_decor_{district_id}")
    for i, (x, z, rot, _half) in enumerate(spots):
        _put(p, BUILDERS[theme[i % len(theme)]](color), x, z, rot)
    ob = p.to_object()
    ob.name = f"nexo_decor_{district_id}"
    finish(ob)
    return ob
