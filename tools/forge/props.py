"""
Fuente, farolas, bancos, naranjos, terraza del café y suelo de la plaza.
Frente hacia -Y, origen en la base (suelo z = 0).
"""
from __future__ import annotations

import math
import random

from mathutils import Matrix

from kit import Part, cut, finish, join, mat

STONE = "#d9c7a6"
STONE_LIGHT = "#e6d9bf"
IRON = "#26231f"


def _done(p: Part, name: str):
    ob = p.to_object()
    ob.name = name
    finish(ob)
    return ob


# --------------------------------------------------------------------------------------
# Fuente
# --------------------------------------------------------------------------------------

def fountain(detail: int = 1):
    stone = mat("piedra", STONE_LIGHT)
    water = mat("agua", "#3d7f95")
    neon = mat("neon", "#4fa3ff")
    p = Part("fountain")
    R = 3.6
    seg = 8  # pilón octogonal
    rot = math.pi / 8
    # Pilón: muro octogonal con borde moldurado (perfil girado sobre 8 lados)
    outer = [(R, 0), (R, 0.12), (R - 0.05, 0.14), (R - 0.05, 0.62), (R + 0.08, 0.66), (R + 0.08, 0.78), (R - 0.32, 0.78),
             (R - 0.32, 0.55)]
    _lathe_rot(p, outer, stone, seg, rot)
    # Agua del pilón
    _lathe_rot(p, [(R - 0.32, 0.55), (0.0, 0.55)], water, seg, rot, smooth=False)
    # Neón bajo el borde
    ring = []
    for i in range(seg):
        a = rot + 2 * math.pi * i / seg
        rr = (R + 0.1) / math.cos(math.pi / seg)
        ring.append((math.cos(a) * rr, math.sin(a) * rr, 0.6))
    p.tube(ring, 0.03, neon, segments=6 if detail else 4, closed=True)
    # Pedestal central con tazas
    s = 24 if detail else 12
    p.lathe((0, 0, 0.5), [(0.75, 0), (0.75, 0.2), (0.55, 0.3), (0.42, 0.45), (0.36, 1.0), (0.42, 1.1), (0.3, 1.2), (0.3, 1.3)], stone, segments=s)
    # Taza grande
    p.lathe((0, 0, 1.75), [(0.3, 0), (0.5, 0.06), (1.1, 0.22), (1.55, 0.36), (1.62, 0.42), (1.55, 0.46), (1.4, 0.4)], stone, segments=s)
    p.lathe((0, 0, 1.75), [(1.42, 0.38), (0.0, 0.38)], water, segments=s, smooth=False)
    # Fuste y taza pequeña
    p.lathe((0, 0, 2.13), [(0.26, 0), (0.2, 0.25), (0.17, 0.55), (0.22, 0.7)], stone, segments=s)
    p.lathe((0, 0, 2.83), [(0.2, 0), (0.45, 0.05), (0.78, 0.18), (0.82, 0.24), (0.7, 0.22)], stone, segments=s)
    p.lathe((0, 0, 2.83), [(0.72, 0.2), (0.0, 0.2)], water, segments=s, smooth=False)
    # Remate (piña)
    p.lathe((0, 0, 3.03), [(0.1, 0), (0.14, 0.1), (0.16, 0.25), (0.1, 0.42), (0.0, 0.5)], stone, segments=s)
    # Cortinas de agua que caen de las tazas
    if detail:
        # Caños con su chorro hacia el pilón
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            x, y = math.cos(a) * 0.4, math.sin(a) * 0.4
            p.sphere((x, y, 1.32), 0.12, stone, subdiv=1)
            jet = [(x, y, 1.32), (math.cos(a) * 1.2, math.sin(a) * 1.2, 1.15), (math.cos(a) * 1.9, math.sin(a) * 1.9, 0.6)]
            p.tube(jet, 0.035, water, segments=5)
    return _done(p, "fountain")


def _lathe_rot(p: Part, profile, m, seg, rot, smooth=True):
    tmp = Part("l")
    tmp.lathe((0, 0, 0), profile, m, segments=seg, smooth=smooth)
    p.merge(tmp, Matrix.Rotation(rot, 4, "Z"))
    tmp.bm.free()


# --------------------------------------------------------------------------------------
# Farola fernandina
# --------------------------------------------------------------------------------------

def lamp(detail: int = 1):
    iron = mat("hierro", IRON)
    glass = mat("farol", "#ffd27a")
    p = Part("lamp")
    s = 12 if detail else 8
    p.lathe((0, 0, 0), [(0.3, 0), (0.3, 0.12), (0.22, 0.2), (0.2, 0.45), (0.14, 0.55), (0.1, 0.62)], iron, segments=8, close_bottom=True)
    p.cylinder((0, 0, 0.62), 0.075, 2.5, iron, segments=s, radius_top=0.06)
    for z in (1.0, 2.2, 3.1):
        p.cylinder((0, 0, z), 0.1, 0.06, iron, segments=s)
    if detail:
        # Volutas decorativas
        for k in range(4):
            a = k * math.pi / 2
            pts = [(math.cos(a) * r, math.sin(a) * r, 2.7 + z) for r, z in ((0.06, 0), (0.22, 0.12), (0.26, 0.3), (0.16, 0.42), (0.08, 0.4))]
            p.tube(pts, 0.015, iron, segments=4)
    # Farol
    z0 = 3.12
    p.lathe((0, 0, z0), [(0.06, 0), (0.18, 0.05), (0.2, 0.1)], iron, segments=6)
    p.lathe((0, 0, z0 + 0.1), [(0.17, 0), (0.27, 0.62)], glass, segments=6, smooth=False)
    if detail:
        for k in range(6):
            a = 2 * math.pi * k / 6
            p.tube([(math.cos(a) * 0.17, math.sin(a) * 0.17, z0 + 0.1), (math.cos(a) * 0.27, math.sin(a) * 0.27, z0 + 0.72)], 0.012, iron, segments=4)
    p.lathe((0, 0, z0 + 0.72), [(0.3, 0), (0.33, 0.03), (0.12, 0.25), (0.05, 0.32), (0.06, 0.38), (0.0, 0.45)], iron, segments=6)
    return _done(p, "lamp")


# --------------------------------------------------------------------------------------
# Banco de forja y madera
# --------------------------------------------------------------------------------------

def bench(detail: int = 1):
    iron = mat("hierro", IRON)
    wood = mat("madera", "#8a5a34")
    p = Part("bench")
    L = 1.9
    for x in (-L / 2 + 0.15, L / 2 - 0.15):
        # Pata/costado de forja en S
        side = [(x, -0.28, 0.0), (x, -0.22, 0.2), (x, -0.25, 0.42), (x, 0.18, 0.45), (x, 0.24, 0.42), (x, 0.26, 0.0)]
        p.tube(side[:3], 0.025, iron, segments=6 if detail else 4)
        p.tube(side[2:4], 0.02, iron, segments=4)
        p.tube([(x, 0.2, 0.0), (x, 0.17, 0.45), (x, 0.24, 0.85), (x, 0.31, 0.9)], 0.025, iron, segments=6 if detail else 4)
        p.tube([(x, -0.28, 0.42), (x, -0.32, 0.6), (x, -0.25, 0.64), (x, -0.15, 0.6)], 0.02, iron, segments=4)  # brazo
    for i in range(5):
        y = -0.24 + i * 0.105
        p.box((-L / 2, y - 0.045, 0.44), (L / 2, y + 0.045, 0.475), wood)
    for i in range(3):
        z = 0.58 + i * 0.12
        y = 0.2 + (z - 0.45) * 0.17
        p.box((-L / 2, y - 0.015, z - 0.045), (L / 2, y + 0.015, z + 0.045), wood)
    return _done(p, "bench")


# --------------------------------------------------------------------------------------
# Naranjo en alcorque
# --------------------------------------------------------------------------------------

def orange_tree(detail: int = 1, seed: int = 3):
    rnd = random.Random(seed)
    bark = mat("corteza", "#5a4636")
    leaf = mat("hoja", "#3d6e2e")
    leaf2 = mat("hoja", "#4f8a3c")
    fruit = mat("fruta", "#f28a1a")
    stone = mat("piedra", STONE)
    p = Part("tree")
    # Alcorque de piedra con tierra
    p.box((-0.75, -0.75, 0), (0.75, 0.75, 0.08), stone, skip=())
    p.box((-0.6, -0.6, 0.0), (0.6, 0.6, 0.09), mat("tierra", "#5a412c"))
    # Tronco y ramas principales
    p.tube([(0, 0, 0), (0.05, 0.02, 0.8), (0.0, 0.06, 1.4)], 0.13, bark, segments=8 if detail else 6)
    for k in range(4 if detail else 3):
        a = k * math.tau / (4 if detail else 3) + rnd.random() * 0.5
        p.tube([(0.0, 0.06, 1.3), (math.cos(a) * 0.5, math.sin(a) * 0.5, 1.9), (math.cos(a) * 0.75, math.sin(a) * 0.75, 2.3)], 0.06, bark, segments=6 if detail else 4)
    # Copa redondeada: varias masas de hojas
    blobs = 9 if detail else 5
    centers = [(0, 0, 2.6)]
    for i in range(blobs):
        a = rnd.random() * math.tau
        r = 0.6 + rnd.random() * 0.5
        centers.append((math.cos(a) * r, math.sin(a) * r, 2.25 + rnd.random() * 0.8))
    for i, c in enumerate(centers):
        rad = 1.15 if i == 0 else 0.6 + rnd.random() * 0.25
        p.sphere(c, rad, leaf if i % 3 else leaf2, subdiv=2 if detail else 1, squash=0.85)
    # Naranjas
    for i in range(18 if detail else 8):
        a = rnd.random() * math.tau
        z = 1.9 + rnd.random() * 1.2
        r = 1.25 + rnd.random() * 0.15 - abs(z - 2.5) * 0.25
        p.sphere((math.cos(a) * r, math.sin(a) * r, z), 0.07, fruit, subdiv=1)
    ob = _done(p, "tree")
    _jitter(ob, mat_names=("xenxo:hoja",), amount=0.06, seed=seed)
    return ob


def _jitter(ob, mat_names, amount, seed):
    """Desplaza los vértices de ciertas mallas para que las copas no parezcan esferas perfectas."""
    rnd = random.Random(seed)
    me = ob.data
    idx = {i for i, m in enumerate(me.materials) if any(m.name.startswith(n) for n in mat_names)}
    verts = set()
    for poly in me.polygons:
        if poly.material_index in idx:
            verts.update(poly.vertices)
    for vi in verts:
        v = me.vertices[vi]
        n = v.normal
        d = (rnd.random() - 0.3) * amount * 2
        v.co += n * d


# --------------------------------------------------------------------------------------
# Terraza del café: mesa, sillas y sombrilla
# --------------------------------------------------------------------------------------

def terrace(detail: int = 1, seed: int = 5):
    rnd = random.Random(seed)
    metal = mat("metal", "#2f3338")
    top = mat("piedra", "#efe9df")
    cloth = mat("toldo", "#7a3b2a")
    p = Part("terrace")
    s = 16 if detail else 8
    p.cylinder((0, 0, 0), 0.25, 0.03, metal, segments=s)
    p.cylinder((0, 0, 0.03), 0.035, 0.7, metal, segments=6)
    p.cylinder((0, 0, 0.72), 0.36, 0.03, top, segments=s)
    for k in range(3):
        a = k * math.tau / 3 + rnd.random() * 0.4
        cx, cy = math.cos(a) * 0.72, math.sin(a) * 0.72
        face = a + math.pi
        chair = Part("chair")
        chair.box((-0.22, -0.22, 0.44), (0.22, 0.22, 0.47), mat("madera", "#8a5a34"))
        for dx in (-0.19, 0.19):
            for dy in (-0.19, 0.19):
                chair.box((dx - 0.015, dy - 0.015, 0), (dx + 0.015, dy + 0.015, 0.44), metal)
        chair.box((-0.2, 0.19, 0.47), (0.2, 0.22, 0.85), mat("madera", "#8a5a34"))
        # Las sillas miran a la mesa: su "frente" (-Y) apunta hacia el centro.
        m = Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(face + math.pi / 2, 4, "Z")
        p.merge(chair, m)
        chair.bm.free()
    # Sombrilla
    p.cylinder((0, 0, 0.75), 0.02, 1.6, metal, segments=6)
    p.lathe((0, 0, 2.15), [(1.25, 0), (1.2, 0.05), (0.0, 0.42)], cloth, segments=8 if detail else 6, smooth=False)
    p.lathe((0, 0, 2.15), [(0.0, 0.40), (1.2, 0.03)], cloth, segments=8 if detail else 6, smooth=False)
    return _done(p, "terrace")


# --------------------------------------------------------------------------------------
# Suelo de la plaza (en coordenadas del chunk; origen en el centro, x este, -y sur)
# --------------------------------------------------------------------------------------

def ground(lay: dict, detail: int = 1):
    from kit import CHUNK
    C = CHUNK / 2
    p = Part("ground")
    adoquin = mat("adoquin", "#9a8f80")
    losa = mat("losa", "#d8cbb0")
    banda = mat("piedra", "#bfae8c")
    azul = mat("azulejo", "#2f6fb0")
    blanco = mat("azulejo", "#efe9df")
    neon = mat("neon", "#4fa3ff")

    def W(x, z):  # mundo (x, z) → local Blender (x, y)
        return (x - C, -(z - C))

    def rect(x0, z0, x1, z1, top, m, bottom=-0.3):
        a = W(x0, z1)
        b = W(x1, z0)
        p.box((a[0], a[1], bottom), (b[0], b[1], top), m, skip=("-z",))

    # Calles alrededor (adoquín)
    rect(0, 0, CHUNK, CHUNK, 0.0, adoquin, bottom=-0.6)
    (px0, pz0), (px1, pz1) = lay["plaza"]["min"], lay["plaza"]["max"]
    # Bordillo y plaza ligeramente elevada
    rect(px0 - 0.5, pz0 - 0.5, px1 + 0.5, pz1 + 0.5, 0.1, banda)
    rect(px0, pz0, px1, pz1, 0.12, losa)
    # Bandas cruzadas y anillo de azulejo alrededor de la fuente
    fx, fz = lay["fountain"]
    rect(fx - 0.6, pz0, fx + 0.6, pz1, 0.125, banda)
    rect(px0, fz - 0.6, px1, fz + 0.6, 0.125, banda)
    s = 48 if detail else 24
    cx, cy = W(fx, fz)
    p.lathe((cx, cy, 0.0), [(6.2, 0.126), (5.4, 0.126)], azul, segments=s, smooth=False)
    p.lathe((cx, cy, 0.0), [(5.4, 0.127), (4.2, 0.127)], blanco, segments=s, smooth=False)
    # Línea de neón embutida alrededor de la plaza
    for (x0, z0, x1, z1) in ((px0, pz0, px1, pz0), (px1, pz0, px1, pz1), (px1, pz1, px0, pz1), (px0, pz1, px0, pz0)):
        a, b = W(x0, z0), W(x1, z1)
        lo = (min(a[0], b[0]) - 0.07, min(a[1], b[1]) - 0.07, 0.12)
        hi = (max(a[0], b[0]) + 0.07, max(a[1], b[1]) + 0.07, 0.135)
        p.box(lo, hi, neon)
    # Emblema del punto de aparición: la X de xenxo en azulejo con neón
    sx, sz = lay["spawn"]
    ox, oy = W(sx, sz)
    p.lathe((ox, oy, 0.0), [(1.9, 0.128), (1.75, 0.128)], azul, segments=s, smooth=False)
    for ang in (45, -45):
        bar = Part("x")
        bar.box((-1.35, -0.16, 0.12), (1.35, 0.16, 0.131), azul)
        bar.box((-1.3, -0.04, 0.131), (1.3, 0.04, 0.136), neon)
        p.merge(bar, Matrix.Translation((ox, oy, 0)) @ Matrix.Rotation(math.radians(ang), 4, "Z"))
        bar.bm.free()
    ob = p.to_object()
    ob.name = "ground"
    finish(ob)
    return ob


# --------------------------------------------------------------------------------------
# Puerta de la plaza: arco monumental de piedra con neón y ático para el nombre
# --------------------------------------------------------------------------------------

def gate(spec: dict, detail: int = 1):
    span = spec["span"]
    r = span / 2
    pw = 1.3  # ancho de cada pilar
    W = span + 2 * pw
    T = 1.2  # grosor
    zs = 4.2  # arranque del arco
    top = zs + r + 1.4
    stone = mat("piedra", "#dccbab")
    dark = mat("piedra", "#bfa985")
    neon = mat("neon", spec["neon"])
    p = Part("gate")
    body = Part("gate_body")
    body.box((-W / 2, -T / 2, 0), (W / 2, T / 2, top), stone)
    body_obj = body.to_object()
    c = Part("c")
    c.cylinder((0, -T, zs), r, 2 * T, stone, segments=40 if detail else 20, axis="y")
    c.box((-r, -T, -1), (r, T, zs + 0.001), stone)
    cutter = c.to_object()
    cut(body_obj, [cutter])
    # Zócalos, impostas, cornisa y ático
    for sx in (-1, 1):
        x0, x1 = sorted((sx * (r + pw + 0.12), sx * (r - 0.12)))
        p.box((x0, -T / 2 - 0.12, 0), (x1, T / 2 + 0.12, 0.9), dark)
        p.box((x0, -T / 2 - 0.1, zs - 0.25), (x1, T / 2 + 0.1, zs), dark)
    p.box((-W / 2 - 0.25, -T / 2 - 0.25, top - 1.5), (W / 2 + 0.25, T / 2 + 0.25, top - 1.2), dark)
    p.box((-W / 2 - 0.35, -T / 2 - 0.35, top), (W / 2 + 0.35, T / 2 + 0.35, top + 0.35), dark)
    p.box((-3.2, -T / 2 - 0.1, top - 1.15), (3.2, -T / 2, top - 0.1), mat("hierro", "#1a1e38"))
    p.box((-3.2, T / 2, top - 1.15), (3.2, T / 2 + 0.1, top - 0.1), mat("hierro", "#1a1e38"))
    # Dovelas marcadas y clave
    seg = 15
    for k in range(seg + 1):
        a = math.pi * k / seg
        x, z = math.cos(a) * (r + 0.3), zs + math.sin(a) * (r + 0.3)
        for y0, y1 in ((-T / 2 - 0.05, -T / 2), (T / 2, T / 2 + 0.05)):
            p.box((x - 0.2, y0, z - 0.2), (x + 0.2, y1, z + 0.2), dark)
    # Neón: el arco por las dos caras y el marco del ático
    for y in (-T / 2 - 0.08, T / 2 + 0.08):
        pts = [(-r, y, 0.9)] + [(math.cos(math.pi - math.pi * i / 24) * (r + 0.02), y, zs + math.sin(math.pi - math.pi * i / 24) * (r + 0.02)) for i in range(25)] + [(r, y, 0.9)]
        p.tube(pts, 0.04, neon, segments=6 if detail else 4)
        rect = [(-3.3, y, top - 1.2), (3.3, y, top - 1.2), (3.3, y, top - 0.05), (-3.3, y, top - 0.05)]
        p.tube(rect, 0.03, mat("hierro", "#26231f"), segments=4, closed=True)
    # Faroles en los pilares (por la cara de la plaza)
    from townhouse import lantern
    for sx in (-1, 1):
        x = sx * (r + pw / 2)
        p.box((x - 0.05, -T / 2 - 0.45, zs + 0.6), (x + 0.05, -T / 2, zs + 0.7), mat("hierro", "#26231f"))
        lantern(p, (x, -T / 2 - 0.45, zs + 0.1), 0.2, detail)
    main = p.to_object()
    ob = join([main, body_obj], "gate")
    finish(ob)
    return ob
