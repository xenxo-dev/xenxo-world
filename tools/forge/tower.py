"""
Campanario de la plaza: base de sillería, fuste encalado con esquinas de piedra,
reloj, campanas, cúpula de azulejo azul (a la valenciana) y linterna con baliza de neón.
Frente hacia -Y, origen en el centro de la planta.
"""
from __future__ import annotations

import math

from kit import Part, cut, finish, join, mat

STONE = "#d9c7a6"
STONE_DARK = "#bfa985"
IRON = "#26231f"


def build(spec: dict, detail: int = 1):
    S = 5.4  # lado del fuste
    h = S / 2
    stone = mat("piedra", STONE)
    cal = mat("cal", "#f4efe6")
    neon_a = mat("neon", "#4fa3ff")
    neon_b = mat("neon", "#ff6a3d")
    seg = 6 if detail else 4

    p = Part("tower")
    # Zócalo de sillería
    p.box((-h - 0.3, -h - 0.3, 0), (h + 0.3, h + 0.3, 1.2), stone)
    p.box((-h - 0.15, -h - 0.15, 1.2), (h + 0.15, h + 0.15, 1.35), stone)

    # Fuste (objeto aparte para abrir puerta y ventanas)
    shaft = Part("shaft")
    shaft.box((-h, -h, 1.35), (h, h, 14.2), cal)
    shaft_obj = shaft.to_object()
    cutters = []

    def cutter(lo, hi):
        c = Part("c")
        c.box(lo, hi, stone)
        cutters.append(c.to_object())

    def arch_cutter(xc, y0, y1, zs, r, axis="y"):
        c = Part("c")
        if axis == "y":
            c.cylinder((xc, y0, zs), r, y1 - y0, stone, segments=24 if detail else 12, axis="y")
            c.box((xc - r, y0, zs - 3), (xc + r, y1, zs + 0.001), stone)
        else:
            c.cylinder((y0, xc, zs), r, y1 - y0, stone, segments=24 if detail else 12, axis="x")
            c.box((y0, xc - r, zs - 3), (y1, xc + r, zs + 0.001), stone)
        cutters.append(c.to_object())

    # Puerta de medio punto
    arch_cutter(0, -h - 0.5, -h + 0.6, 3.0, 0.85)
    p.box((-0.85, -h + 0.35, 0), (0.85, -h + 0.42, 3.85), mat("persiana", "#5a3a22"))
    for k in range(13):
        a = math.pi * k / 12
        x, z = math.cos(a) * 1.05, 3.0 + math.sin(a) * 1.05
        p.box((x - 0.14, -h - 0.06, z - 0.14), (x + 0.14, -h, z + 0.14), stone)  # dovelas
    p.box((-1.2, -h - 0.06, 0), (-0.85, -h, 3.0), stone)
    p.box((0.85, -h - 0.06, 0), (1.2, -h, 3.0), stone)

    # Ventanas saeteras en los costados
    for z in (5.5, 9.0):
        for sx in (-1, 1):
            cutter((sx * h - 0.5, -0.25, z), (sx * h + 0.5, 0.25, z + 1.3))

    cut(shaft_obj, cutters)
    for sx in (-1, 1):
        for z in (5.5, 9.0):
            p.box((sx * (h - 0.35) - 0.01, -0.25, z), (sx * (h - 0.35) + 0.01, 0.25, z + 1.3), mat("oscuro", "#141414"))

    # Esquinas de sillería alternada
    if detail:
        z = 1.35
        k = 0
        while z < 14.0:
            hh = 0.45
            long_ = 0.75 if k % 2 == 0 else 0.45
            short = 0.45 if k % 2 == 0 else 0.75
            for sx in (-1, 1):
                for sy in (-1, 1):
                    x0, x1 = sorted((sx * (h + 0.03), sx * (h - long_)))
                    y0, y1 = sorted((sy * (h + 0.03), sy * (h - short)))
                    p.box((x0, y0, z + 0.01), (x1, y1, z + hh - 0.01), stone)
            z += hh
            k += 1
    else:
        for sx in (-1, 1):
            for sy in (-1, 1):
                x0, x1 = sorted((sx * (h + 0.03), sx * (h - 0.6)))
                y0, y1 = sorted((sy * (h + 0.03), sy * (h - 0.6)))
                p.box((x0, y0, 1.35), (x1, y1, 14.0), stone)

    # Placa de azulejo para el nombre (el texto lo pone el mundo)
    p.box((-2.3, -h - 0.1, 7.7), (2.3, -h, 9.1), mat("azulejo", "#1d3f6e"))
    p.box((-2.42, -h - 0.14, 7.58), (2.42, -h - 0.08, 7.7), stone)
    p.box((-2.42, -h - 0.14, 9.1), (2.42, -h - 0.08, 9.22), stone)

    # Reloj en las cuatro caras
    for ang in (0, 90, 180, 270):
        _clock(p, ang, h, 12.4, detail)

    # Cornisa con banda de azulejo y neón
    p.box((-h - 0.12, -h - 0.12, 14.0), (h + 0.12, h + 0.12, 14.6), mat("azulejo", "#2f6fb0"))
    p.box((-h - 0.3, -h - 0.3, 14.6), (h + 0.3, h + 0.3, 14.85), stone)
    ring = [(-h - 0.17, -h - 0.17, 13.9), (h + 0.17, -h - 0.17, 13.9), (h + 0.17, h + 0.17, 13.9), (-h - 0.17, h + 0.17, 13.9)]
    p.tube(ring, 0.035, neon_a, segments=seg, closed=True)

    # Campanario: cuerpo con cuatro arcos
    bh = 4.6
    B = S - 0.6
    bz = 14.85
    bel = Part("belfry")
    bel.box((-B / 2, -B / 2, bz), (B / 2, B / 2, bz + bh), cal)
    bel_obj = bel.to_object()
    cutters = []
    arch_cutter(0, -B / 2 - 0.5, B / 2 + 0.5, bz + 2.6, 0.95)
    arch_cutter(0, -B / 2 - 0.5, B / 2 + 0.5, bz + 2.6, 0.95, axis="x")
    cut(bel_obj, cutters)
    # Interior oscuro y campanas
    p.box((-B / 2 + 0.4, -B / 2 + 0.4, bz), (B / 2 - 0.4, B / 2 - 0.4, bz + 0.05), mat("oscuro", "#1a1714"))
    p.box((-B / 2 + 0.4, -B / 2 + 0.4, bz + bh - 0.3), (B / 2 - 0.4, B / 2 - 0.4, bz + bh - 0.25), mat("oscuro", "#1a1714"))
    bronze = mat("metal", "#8a6a3a")
    for (bx, by) in ((0, -B / 2 + 0.75), (-B / 2 + 0.75, 0)):
        p.lathe((bx, by, bz + 2.0), [(0.62, 0), (0.6, 0.08), (0.45, 0.35), (0.38, 0.8), (0.3, 1.0), (0.0, 1.05)], bronze, segments=16 if detail else 8, close_bottom=True)
        p.box((bx - 0.05, by - 0.05, bz + 3.05), (bx + 0.05, by + 0.05, bz + bh - 0.3), mat("madera", "#5a3a22"))
    # Impostas de los arcos
    for ang in range(4):
        for sx in (-1, 1):
            p.box(*_rot_box((sx * 1.05 - 0.2, -B / 2 - 0.06, bz + 2.45), (sx * 1.05 + 0.2, -B / 2 + 0.01, bz + 2.6), ang), stone)
    # Pináculos en las esquinas
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (h - 0.05), sy * (h - 0.05)
            p.box((x - 0.25, y - 0.25, 14.85), (x + 0.25, y + 0.25, 15.6), stone)
            p.lathe((x, y, 15.6), [(0.2, 0), (0.24, 0.15), (0.14, 0.45), (0.05, 0.75), (0.0, 0.85)], stone, segments=8 if detail else 6)

    # Cornisa superior y neón naranja
    zt = bz + bh
    p.box((-B / 2 - 0.25, -B / 2 - 0.25, zt), (B / 2 + 0.25, B / 2 + 0.25, zt + 0.35), stone)
    ring2 = [(-B / 2 - 0.3, -B / 2 - 0.3, zt - 0.05), (B / 2 + 0.3, -B / 2 - 0.3, zt - 0.05), (B / 2 + 0.3, B / 2 + 0.3, zt - 0.05), (-B / 2 - 0.3, B / 2 + 0.3, zt - 0.05)]
    p.tube(ring2, 0.035, neon_b, segments=seg, closed=True)

    # Tambor octogonal y cúpula de azulejo
    zd = zt + 0.35
    p.lathe((0, 0, zd), [(1.9, 0), (1.9, 1.0), (2.05, 1.0), (2.05, 1.2)], cal, segments=8, close_bottom=False)
    dome = []
    n = 10 if detail else 6
    for i in range(n + 1):
        a = (math.pi / 2) * i / n
        dome.append((2.0 * math.cos(a), 1.2 + 2.1 * math.sin(a)))
    p.lathe((0, 0, zd), [(2.05, 1.2)] + dome[1:], mat("azulejo", "#2f5fb0"), segments=24 if detail else 12)
    # Nervios de la cúpula
    if detail:
        for k in range(8):
            a = 2 * math.pi * k / 8
            pts = [(math.cos(a) * r * 1.01, math.sin(a) * r * 1.01, zd + z) for r, z in dome]
            p.tube(pts, 0.04, mat("azulejo", "#e8d9a8"), segments=4)
    # Linterna, aguja y baliza
    zl = zd + 1.2 + 2.1
    p.cylinder((0, 0, zl - 0.05), 0.45, 0.9, cal, segments=8)
    p.cylinder((0, 0, zl + 0.85), 0.55, 0.12, stone, segments=8)
    p.lathe((0, 0, zl + 0.97), [(0.5, 0), (0.0, 0.7)], mat("azulejo", "#2f5fb0"), segments=8)
    p.cylinder((0, 0, zl + 1.6), 0.03, 1.4, mat("hierro", IRON), segments=4)
    p.sphere((0, 0, zl + 3.1), 0.22, neon_b, subdiv=2)
    for z in (zl + 2.0, zl + 2.45):
        p.tube([(math.cos(t) * 0.35, math.sin(t) * 0.35, z) for t in [2 * math.pi * i / 12 for i in range(12)]], 0.02, neon_a, segments=4, closed=True)

    main = p.to_object()
    ob = join([main, shaft_obj, bel_obj], "tower")
    finish(ob)
    return ob


def _clock(p: Part, ang: int, h: float, z: float, detail: int) -> None:
    """Esfera con números de piedra y agujas de hierro marcando las diez y diez."""
    r = 1.05
    face = mat("farol", "#f6e7b0")
    stone = mat("piedra", STONE)
    iron = mat("hierro", IRON)
    tmp = Part("clock")
    tmp.cylinder((0, -h - 0.02, z), r, 0.04, face, segments=32 if detail else 16, axis="y")
    tmp.cylinder((0, -h - 0.05, z), r + 0.15, 0.05, stone, segments=32 if detail else 16, axis="y", caps=(True, False))
    for k in range(12):
        a = 2 * math.pi * k / 12
        x, zz = math.sin(a) * (r - 0.15), math.cos(a) * (r - 0.15)
        tmp.box((x - 0.04, -h - 0.07, z + zz - 0.04), (x + 0.04, -h - 0.04, z + zz + 0.04), iron)
    # Agujas
    tmp.poly([(-0.04, -h - 0.08, z), (0.04, -h - 0.08, z), (math.sin(math.radians(305)) * 0.55, -h - 0.08, z + math.cos(math.radians(305)) * 0.55)], iron)
    tmp.poly([(-0.03, -h - 0.09, z), (0.03, -h - 0.09, z), (math.sin(math.radians(60)) * 0.85, -h - 0.09, z + math.cos(math.radians(60)) * 0.85)], iron)
    from mathutils import Matrix
    p.merge(tmp, Matrix.Rotation(math.radians(ang), 4, "Z"))
    tmp.bm.free()


def _rot(v, quarter):
    x, y, z = v
    for _ in range(quarter):
        x, y = -y, x
    return (x, y, z)


def _rot_box(lo, hi, quarter):
    a = _rot(lo, quarter)
    b = _rot(hi, quarter)
    return (min(a[0], b[0]), min(a[1], b[1]), min(a[2], b[2])), (max(a[0], b[0]), max(a[1], b[1]), max(a[2], b[2]))
