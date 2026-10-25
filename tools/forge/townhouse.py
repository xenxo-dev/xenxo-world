"""
Casa de plaza mayor mediterránea: soportales con arcos, balcones de forja, persianas,
cornisa, tejado de teja árabe o azotea, y neones para la noche.

Local (Blender): frente hacia -Y, origen en el centro de la planta, suelo en z = 0.
`detail` = 1 para equipos de escritorio, 0 para la versión ligera (Quest, móvil).
"""
from __future__ import annotations

import math
import random

import bpy
from mathutils import Matrix

from kit import Part, cut, finish, join, mat

STONE = "#d9c7a6"
STONE_DARK = "#bfa985"
IRON = "#26231f"
WOOD = "#6b4428"
GLASS = "#2a3640"
TILE = "#b5583a"


def window(p: Part, cutters: list, xc: float, z0: float, w: float, h: float, yf: float, wall_t: float,
           shutter: str, rnd: random.Random, detail: int, kind: str = "window") -> None:
    """Hueco con marco de piedra, alféizar, vidrio, carpintería y persianas abiertas o cerradas."""
    stone = mat("piedra", STONE)
    # Hueco en el muro (lo resta la booleana).
    c = Part("cut")
    c.box((xc - w / 2, yf - 0.5, z0), (xc + w / 2, yf + wall_t + 0.5, z0 + h), stone)
    cutters.append(c.to_object())

    fr = 0.16  # ancho del recerco de piedra
    pr = 0.05  # cuánto sobresale
    p.box((xc - w / 2 - fr, yf - pr, z0 + h), (xc + w / 2 + fr, yf, z0 + h + fr), stone)  # dintel
    p.box((xc - w / 2 - fr, yf - pr, z0), (xc - w / 2, yf, z0 + h), stone)  # jamba izq
    p.box((xc + w / 2, yf - pr, z0), (xc + w / 2 + fr, yf, z0 + h), stone)  # jamba der
    if kind == "window":
        p.box((xc - w / 2 - fr - 0.04, yf - 0.12, z0 - 0.08), (xc + w / 2 + fr + 0.04, yf, z0), stone)  # alféizar

    depth = 0.22

    closed = kind == "window" and rnd.random() < 0.28
    glass_y = yf + depth
    if closed:
        # Persiana cerrada dentro del hueco.
        p.box((xc - w / 2, glass_y - 0.05, z0), (xc + w / 2, glass_y, z0 + h), mat("persiana", shutter))
    else:
        p.box((xc - w / 2, glass_y, z0), (xc + w / 2, glass_y + 0.02, z0 + h), mat("ventana", GLASS))
        if detail:
            frame = mat("persiana", "#efe9df")
            t = 0.05
            p.box((xc - t / 2, glass_y - 0.03, z0), (xc + t / 2, glass_y, z0 + h), frame)  # parteluz
            p.box((xc - w / 2, glass_y - 0.03, z0 + h * 0.62), (xc + w / 2, glass_y, z0 + h * 0.62 + t), frame)
            p.box((xc - w / 2, glass_y - 0.03, z0), (xc - w / 2 + t, glass_y, z0 + h), frame)
            p.box((xc + w / 2 - t, glass_y - 0.03, z0), (xc + w / 2, glass_y, z0 + h), frame)
        # Persianas abiertas contra la fachada, a los lados.
        if rnd.random() < 0.85:
            sh = mat("persiana", shutter)
            lw = w / 2 - 0.06
            open_l = rnd.random() < 0.9
            open_r = rnd.random() < 0.9
            if open_l:
                p.box((xc - w / 2 - fr - lw, yf - 0.09, z0), (xc - w / 2 - fr - 0.02, yf - 0.05, z0 + h), sh)
            if open_r:
                p.box((xc + w / 2 + fr + 0.02, yf - 0.09, z0), (xc + w / 2 + fr + lw, yf - 0.05, z0 + h), sh)


def balcony(p: Part, xc: float, z: float, w: float, yf: float, rnd: random.Random, detail: int) -> None:
    """Balcón volado con losa de piedra, moldura y barandilla de forja con macetas."""
    stone = mat("piedra", STONE)
    iron = mat("hierro", IRON)
    out = 0.7
    x0, x1 = xc - w / 2, xc + w / 2
    p.box((x0, yf - out, z), (x1, yf, z + 0.14), stone)
    # Moldura bajo la losa
    p.prism([(yf, z), (yf - out + 0.08, z), (yf - out + 0.08, z - 0.06), (yf - 0.1, z - 0.14), (yf, z - 0.14)][::-1], x0 + 0.06, x1 - 0.06, stone)
    # Ménsulas
    for x in (x0 + 0.2, x1 - 0.2):
        p.prism([(yf, z), (yf - out + 0.15, z), (yf, z - 0.45)], x - 0.06, x + 0.06, stone)
    top = z + 0.14 + 1.0
    yo = yf - out + 0.04
    # Pasamanos y zócalo de la barandilla
    p.box((x0 + 0.02, yo - 0.025, top - 0.05), (x1 - 0.02, yo + 0.025, top), iron)
    p.box((x0 + 0.02, yo - 0.02, z + 0.2), (x1 - 0.02, yo + 0.02, z + 0.24), iron)
    for x in (x0 + 0.04, x1 - 0.04):
        p.box((x - 0.025, yo, top - 0.05), (x + 0.025, yf, top), iron)
        p.box((x - 0.02, yo, z + 0.2), (x + 0.02, yf, z + 0.24), iron)
    if detail:
        n = int((w - 0.1) / 0.12)
        for i in range(n + 1):
            x = x0 + 0.05 + i * (w - 0.1) / n
            p.box((x - 0.012, yo - 0.012, z + 0.14), (x + 0.012, yo + 0.012, top - 0.05), iron)
        steps = int(out / 0.12)
        for side in (x0 + 0.04, x1 - 0.04):
            for i in range(1, steps):
                y = yo + i * (yf - yo) / steps
                p.box((side - 0.012, y - 0.012, z + 0.14), (side + 0.012, y + 0.012, top - 0.05), iron)
        # Macetas de geranios colgadas
        for x in (x0 + 0.35, x1 - 0.35):
            if rnd.random() < 0.8:
                flower_pot(p, (x, yo - 0.12, top - 0.28), rnd, hanging=True)
    else:
        p.box((x0 + 0.04, yo - 0.005, z + 0.24), (x1 - 0.04, yo + 0.005, top - 0.05), iron)


def flower_pot(p: Part, at, rnd: random.Random, hanging: bool = False, scale: float = 1.0) -> None:
    x, y, z = at
    terracotta = mat("piedra", "#b8603e")
    r = 0.13 * scale
    p.lathe((x, y, z), [(r * 0.75, 0), (r, 0.22 * scale), (r * 1.08, 0.24 * scale), (r * 1.08, 0.27 * scale)], terracotta, segments=10, close_bottom=True)
    p.cylinder((x, y, z + 0.2 * scale), r * 0.95, 0.04, mat("tierra", "#4a3423"), segments=10, caps=(False, True))
    leaf = mat("hoja", "#3f7a35")
    colors = ["#e0304a", "#ff6b8a", "#f04b6b", "#ffffff", "#d93a8a"]
    flower = mat("flor", rnd.choice(colors))
    for i in range(5):
        a = rnd.random() * math.tau
        d = rnd.random() * r * 0.8
        p.sphere((x + math.cos(a) * d, y + math.sin(a) * d, z + 0.3 * scale + rnd.random() * 0.08), 0.09 * scale, leaf, subdiv=1, squash=0.7)
    for i in range(4):
        a = rnd.random() * math.tau
        d = rnd.random() * r
        p.sphere((x + math.cos(a) * d, y + math.sin(a) * d, z + 0.38 * scale + rnd.random() * 0.06), 0.045 * scale, flower, subdiv=1)
    if hanging:
        for i in range(3):
            a = rnd.random() * math.tau
            p.sphere((x + math.cos(a) * r, y + math.sin(a) * r, z + 0.05 * scale), 0.06 * scale, leaf, subdiv=1, squash=1.4)


def neon_arch(p: Part, xc: float, zs: float, r: float, y: float, color: str, detail: int) -> None:
    seg = 18 if detail else 10
    pts = [(xc - r, y, zs - 0.6)]
    for i in range(seg + 1):
        a = math.pi - math.pi * i / seg
        pts.append((xc + math.cos(a) * r, y, zs + math.sin(a) * r))
    pts.append((xc + r, y, zs - 0.6))
    p.tube(pts, 0.03, mat("neon", color), segments=6 if detail else 4)


def build(spec: dict, detail: int = 1, seed: int = 1) -> bpy.types.Object:
    rnd = random.Random(f"{spec['id']}:{seed}")
    W, D = spec["w"], spec["d"]
    F = spec["floors"]
    H0 = F[0]
    Ht = sum(F)
    arcade = spec["arcade"]
    yf = -D / 2  # fachada
    wall_t = 0.45
    A = 3.2  # fondo de los soportales
    n = max(3, round(W / 3))
    if n % 2 == 0:
        n -= 1
    bay = W / n

    wall = mat("estuco", spec["wall"])
    plinth = mat("estuco", spec["plinth"])
    stone = mat("piedra", STONE)
    neon = spec["neon"]

    p = Part(spec["id"])
    cutters_front: list = []
    cutters_side: list = []

    # ---------------- Muros principales (objetos aparte para las booleanas) -------------
    front = Part("front")
    front.box((-W / 2, yf, H0 + 0.3 if arcade else 0), (W / 2, yf + wall_t, Ht), wall)
    sides = Part("sides")
    # Los laterales empiezan detrás de la fachada (sin caras coplanarias que parpadeen).
    zg = H0 + 0.3
    for x0, x1 in ((-W / 2, -W / 2 + 0.5), (W / 2 - 0.5, W / 2)):
        if arcade:
            sides.box((x0, yf + 0.6, 0), (x1, D / 2, zg), wall)
            sides.box((x0, yf + wall_t, zg), (x1, D / 2, Ht), wall)
        else:
            sides.box((x0, yf + wall_t, 0), (x1, D / 2, Ht), wall)
    sides.box((-W / 2 + 0.5, D / 2 - 0.4, 0), (W / 2 - 0.5, D / 2, Ht), wall)  # fachada trasera

    # ---------------- Planta baja ---------------------------------------------------------
    if arcade:
        zs = H0 - 0.4 - (bay - 0.7) / 2  # arranque de los arcos
        r = (bay - 0.7) / 2
        arches = Part("arches")
        arches.box((-W / 2, yf, zs - 0.01), (W / 2, yf + 0.6, H0 + 0.3), stone)
        arch_obj = arches.to_object()
        cs = []
        for k in range(n):
            xc = -W / 2 + bay * (k + 0.5)
            c = Part("c")
            c.cylinder((xc, yf - 0.5, zs), r, 1.6, stone, segments=28 if detail else 14, axis="y")
            c.box((xc - r, yf - 0.5, zs - 1), (xc + r, yf + 1.1, zs + 0.001), stone)
            cs.append(c.to_object())
        cut(arch_obj, cs)

        # Columnas toscanas entre arcos
        for k in range(1, n):
            x = -W / 2 + bay * k
            yc = yf + 0.3
            p.box((x - 0.34, yc - 0.34, 0), (x + 0.34, yc + 0.34, 0.28), stone)
            p.cylinder((x, yc, 0.28), 0.25, zs - 0.28 - 0.24, stone, segments=16 if detail else 8, radius_top=0.22)
            p.cylinder((x, yc, zs - 0.24), 0.22, 0.1, stone, segments=16 if detail else 8, radius_top=0.3)
            p.box((x - 0.34, yc - 0.34, zs - 0.14), (x + 0.34, yc + 0.34, zs), stone)
        # Pilastras en los extremos
        for x0, x1 in ((-W / 2 - 0.03, -W / 2 + 0.6), (W / 2 - 0.6, W / 2 + 0.03)):
            p.box((x0, yf - 0.04, 0), (x1, yf + 0.6, zs), stone)

        # Techo de los soportales con vigas de madera
        p.box((-W / 2 + 0.5, yf + 0.6, H0), (W / 2 - 0.5, yf + A + 0.1, H0 + 0.3), mat("estuco", "#ede4d4"))
        if detail:
            beams = int((W - 1) / 0.55)
            for i in range(beams + 1):
                x = -W / 2 + 0.55 + i * (W - 1.1) / beams
                p.box((x - 0.07, yf + 0.6, H0 - 0.18), (x + 0.07, yf + A, H0), mat("madera", WOOD))
        p.box((-W / 2 + 0.5, yf + 0.0, 0), (W / 2 - 0.5, yf + A, 0.12), mat("losa", "#cdbf9f"))  # suelo

        # Muro de tiendas al fondo de los soportales
        shop = Part("shop")
        shop.box((-W / 2 + 0.5, yf + A, 0), (W / 2 - 0.5, yf + A + 0.4, H0 + 0.3), wall)
        shop_obj = shop.to_object()
        scut = []
        for k in range(n):
            xc = -W / 2 + bay * (k + 0.5)
            is_door = k == n // 2
            w = 1.6 if is_door else bay - 0.8
            h = 2.9 if is_door else 2.6
            z0 = 0.12 if is_door else 0.75
            c = Part("c")
            c.box((xc - w / 2, yf + A - 0.3, z0), (xc + w / 2, yf + A + 0.8, z0 + h), stone)
            scut.append(c.to_object())
            ys = yf + A
            p.box((xc - w / 2 - 0.15, ys - 0.05, z0), (xc - w / 2, ys, z0 + h + 0.15), stone)
            p.box((xc + w / 2, ys - 0.05, z0), (xc + w / 2 + 0.15, ys, z0 + h + 0.15), stone)
            p.box((xc - w / 2 - 0.15, ys - 0.05, z0 + h), (xc + w / 2 + 0.15, ys, z0 + h + 0.15), stone)
            if is_door:
                door = mat("persiana", "#5a3a22")
                p.box((xc - w / 2, ys + 0.2, z0), (xc + w / 2, ys + 0.26, z0 + h), door)
                if detail:
                    for sx in (-1, 1):
                        for zz in (0.35, 1.55):
                            p.box((xc + sx * w / 4 - 0.28, ys + 0.17, z0 + zz), (xc + sx * w / 4 + 0.28, ys + 0.2, z0 + zz + 0.95), door)
                p.box((xc - 0.6, ys - 0.35, z0 + h + 0.3), (xc + 0.6, ys - 0.05, z0 + h + 0.38), mat("hierro", IRON))
            else:
                p.box((xc - w / 2, ys + 0.18, z0), (xc + w / 2, ys + 0.2, z0 + h), mat("ventana", GLASS))
                if detail:
                    fr = mat("persiana", "#2a2420")
                    p.box((xc - 0.03, ys + 0.14, z0), (xc + 0.03, ys + 0.18, z0 + h), fr)
                    p.box((xc - w / 2, ys + 0.14, z0 + h * 0.78), (xc + w / 2, ys + 0.18, z0 + h * 0.78 + 0.05), fr)
                p.box((xc - w / 2 - 0.1, ys - 0.1, 0.12), (xc + w / 2 + 0.1, ys, z0), plinth)  # zócalo bajo escaparate
            # Farol colgado en cada tramo de los soportales
            lx, ly = xc, yf + A * 0.5
            p.box((lx - 0.01, ly - 0.01, H0 - 0.75), (lx + 0.01, ly + 0.01, H0 - 0.18), mat("hierro", IRON))
            lantern(p, (lx, ly, H0 - 1.15), 0.16, detail)
            # Neones en los arcos (frente de la fachada)
            neon_arch(p, xc, zs, r + 0.06, yf - 0.03, neon, detail)
        cut(shop_obj, scut)
        p.box((-W / 2 + 0.5, yf + A - 0.06, 0.12), (W / 2 - 0.5, yf + A, 0.62), plinth)
        shop_part_objs = [arch_obj, shop_obj]
    else:
        # Café con grandes ventanales y toldos (La Terraza)
        zf = H0 + 0.3
        for k in range(n):
            xc = -W / 2 + bay * (k + 0.5)
            is_door = k == n // 2
            w, h, z0 = (1.8, 3.0, 0.0) if is_door else (2.4, 2.6, 0.6)
            c = Part("c")
            c.box((xc - w / 2, yf - 0.5, z0), (xc + w / 2, yf + wall_t + 0.5, z0 + h), stone)
            cutters_front.append(c.to_object())
            ys = yf + 0.25
            p.box((xc - w / 2 - 0.18, yf - 0.06, z0), (xc - w / 2, yf, z0 + h + 0.18), stone)
            p.box((xc + w / 2, yf - 0.06, z0), (xc + w / 2 + 0.18, yf, z0 + h + 0.18), stone)
            p.box((xc - w / 2 - 0.18, yf - 0.06, z0 + h), (xc + w / 2 + 0.18, yf, z0 + h + 0.18), stone)
            p.box((xc - w / 2, ys, z0), (xc + w / 2, ys + 0.02, z0 + h), mat("ventana", GLASS))
            if is_door:
                p.box((xc - w / 2, ys - 0.03, z0), (xc - w / 2 + 0.06, ys, z0 + h), mat("persiana", "#2a2420"))
                p.box((xc + w / 2 - 0.06, ys - 0.03, z0), (xc + w / 2, ys, z0 + h), mat("persiana", "#2a2420"))
                p.box((xc - 0.03, ys - 0.03, z0), (xc + 0.03, ys, z0 + h), mat("persiana", "#2a2420"))
            elif detail:
                fr = mat("persiana", "#2a2420")
                p.box((xc - 0.03, ys - 0.03, z0), (xc + 0.03, ys, z0 + h), fr)
            # Toldo a rayas
            awning(p, xc, 3.95, w + 0.6, yf, spec["plinth"], detail)
            # Neón bajo cada toldo
            p.tube([(xc - w / 2, yf - 0.05, z0 + h + 0.28), (xc + w / 2, yf - 0.05, z0 + h + 0.28)], 0.028, mat("neon", neon), segments=6 if detail else 4)
        # Zócalo, interrumpido en la puerta
        door_x = -W / 2 + bay * (n // 2 + 0.5)
        p.box((-W / 2, yf - 0.06, 0), (door_x - 0.9 - 0.18, yf, 0.55), plinth)
        p.box((door_x + 0.9 + 0.18, yf - 0.06, 0), (W / 2, yf, 0.55), plinth)
        shop_part_objs = []

    # ---------------- Plantas altas ------------------------------------------------------
    has_sign = spec.get("sign", True)
    sign_bay = n // 2 if has_sign else -1
    z1 = H0 + 0.3
    for fi in range(1, len(F)):
        zf = sum(F[:fi]) + (0.3 if fi == 1 else 0)
        for k in range(n):
            xc = -W / 2 + bay * (k + 0.5)
            if fi == 1 and k == sign_bay:
                continue  # aquí va el cartel del barrio
            if fi == 1:
                window(p, cutters_front, xc, zf + 0.15, 1.25, 2.35, yf, wall_t, spec["shutter"], rnd, detail, kind="door")
                balcony(p, xc, zf, 1.9, yf, rnd, detail)
            else:
                window(p, cutters_front, xc, zf + 0.75, 1.1, 1.55, yf, wall_t, spec["shutter"], rnd, detail)
                if rnd.random() < 0.35:
                    awning(p, xc, zf + 2.55, 1.6, yf, spec["plinth"], detail, small=True)
        # Ventanas laterales
        for side in (-1, 1):
            for j, yy in enumerate((yf + 2.6, yf + 5.6)):
                if yy > D / 2 - 1.2:
                    continue
                side_window(p, cutters_side, side, W, yy, zf + 0.75, 1.0, 1.45, spec["shutter"], rnd, detail)

    # Cartel del barrio (el texto lo pone el mundo con label@1)
    sx = -W / 2 + bay * (n // 2 + 0.5)
    if has_sign:
        sw, sh, sz = bay - 0.5, 1.25, z1 + 0.85
        p.box((sx - sw / 2, yf - 0.12, sz), (sx + sw / 2, yf, sz + sh), mat("azulejo", "#1d3f6e"))
        p.box((sx - sw / 2 - 0.1, yf - 0.16, sz - 0.1), (sx + sw / 2 + 0.1, yf - 0.1, sz), stone)
        p.box((sx - sw / 2 - 0.1, yf - 0.16, sz + sh), (sx + sw / 2 + 0.1, yf - 0.1, sz + sh + 0.1), stone)
        rect = [(sx - sw / 2 - 0.02, yf - 0.17, sz - 0.02), (sx + sw / 2 + 0.02, yf - 0.17, sz - 0.02),
                (sx + sw / 2 + 0.02, yf - 0.17, sz + sh + 0.02), (sx - sw / 2 - 0.02, yf - 0.17, sz + sh + 0.02)]
        p.tube(rect, 0.03, mat("neon", neon), segments=6 if detail else 4, closed=True)

    # Impostas (líneas de piedra entre plantas)
    for fi in range(1, len(F)):
        zf = sum(F[:fi]) + (0.3 if fi == 1 else 0)
        p.box((-W / 2, yf - 0.07, zf - 0.22 if fi > 1 else zf - 0.3), (W / 2, yf, zf - 0.02 if fi > 1 else zf), stone)
    # Pilastras de esquina en piedra
    for x0, x1 in ((-W / 2 - 0.03, -W / 2 + 0.55), (W / 2 - 0.55, W / 2 + 0.03)):
        p.box((x0, yf - 0.05, H0 + 0.3 if arcade else 0), (x1, yf + 0.03, Ht - 0.3), stone)
    # Zócalo exterior de los laterales
    p.box((-W / 2 - 0.04, yf, 0), (-W / 2, D / 2, 0.8), plinth)
    p.box((W / 2, yf, 0), (W / 2 + 0.04, D / 2, 0.8), plinth)

    # Cornisa moldurada (frente y laterales)
    prof = [(0, -0.45), (-0.12, -0.45), (-0.12, -0.32), (-0.3, -0.18), (-0.42, -0.18), (-0.42, 0.0), (0, 0.0)]
    front_prof = [(yf + y, Ht + z) for y, z in prof]
    p.prism(front_prof, -W / 2 - 0.42, W / 2 + 0.42, stone)
    for sgn in (-1, 1):
        # Laterales: el mismo perfil, girado 90° y llevado a cada costado.
        side_c = Part("sc")
        if sgn > 0:
            side_c.prism([(y, Ht + z) for y, z in prof], yf, D / 2 + 0.42, stone)
            m = Matrix.Translation((W / 2, 0, 0)) @ Matrix.Rotation(math.radians(90), 4, "Z")
        else:
            side_c.prism([(y, Ht + z) for y, z in prof], -(D / 2 + 0.42), -yf, stone)
            m = Matrix.Translation((-W / 2, 0, 0)) @ Matrix.Rotation(math.radians(-90), 4, "Z")
        p.merge(side_c, m)
        side_c.bm.free()
    # Neón bajo la cornisa
    p.tube([(-W / 2 + 0.3, yf - 0.16, Ht - 0.55), (W / 2 - 0.3, yf - 0.16, Ht - 0.55)], 0.03, mat("neon", neon), segments=6 if detail else 4)
    for x in (-W / 2 - 0.08, W / 2 + 0.08):
        p.tube([(x, yf - 0.08, (H0 + 0.4) if arcade else 0.8), (x, yf - 0.08, Ht - 0.6)], 0.03, mat("neon", neon), segments=6 if detail else 4)

    # ---------------- Cubierta -------------------------------------------------------------
    if spec["roof"] == "hip":
        hip_roof(p, W, D, Ht, detail)
    else:
        flat_roof(p, W, D, Ht, spec, rnd, detail)

    # Bajante
    if detail:
        p.cylinder((W / 2 - 0.15, yf + 0.6 if arcade else yf - 0.08, 0), 0.05, Ht - 0.1, mat("metal", "#6e6a64"), segments=6)

    # ---------------- Unir, restar huecos ---------------------------------------------------
    front_obj = front.to_object()
    cut(front_obj, cutters_front)
    sides_obj = sides.to_object()
    cut(sides_obj, cutters_side)
    main = p.to_object()
    ob = join([main, front_obj, sides_obj, *shop_part_objs], spec["id"])
    finish(ob)
    return ob


def side_window(p: Part, cutters: list, side: int, W: float, yc: float, z0: float, w: float, h: float, shutter: str,
                rnd: random.Random, detail: int) -> None:
    stone = mat("piedra", STONE)
    x_out = side * W / 2
    c = Part("c")
    c.box((x_out - 0.8, yc - w / 2, z0), (x_out + 0.8, yc + w / 2, z0 + h), stone)
    cutters.append(c.to_object())
    s = side
    fr = 0.15
    # Recerco
    def bx(a, b, cc, d, e, f):
        p.box((min(a, b), min(cc, d), e), (max(a, b), max(cc, d), f), stone)
    bx(x_out, x_out + s * 0.05, yc - w / 2 - fr, yc + w / 2 + fr, z0 + h, z0 + h + fr)
    bx(x_out, x_out + s * 0.05, yc - w / 2 - fr, yc - w / 2, z0, z0 + h)
    bx(x_out, x_out + s * 0.05, yc + w / 2, yc + w / 2 + fr, z0, z0 + h)
    bx(x_out, x_out + s * 0.12, yc - w / 2 - fr, yc + w / 2 + fr, z0 - 0.08, z0)
    gx = x_out - s * 0.3
    if rnd.random() < 0.3:
        p.box((min(gx, gx + s * 0.04), yc - w / 2, z0), (max(gx, gx + s * 0.04), yc + w / 2, z0 + h), mat("persiana", shutter))
    else:
        p.box((min(gx, gx - s * 0.02), yc - w / 2, z0), (max(gx, gx - s * 0.02), yc + w / 2, z0 + h), mat("ventana", GLASS))
        sh = mat("persiana", shutter)
        a0, a1 = sorted((x_out + s * 0.05, x_out + s * 0.09))
        p.box((a0, yc - w / 2 - fr - w / 2, z0), (a1, yc - w / 2 - fr - 0.02, z0 + h), sh)
        p.box((a0, yc + w / 2 + fr + 0.02, z0), (a1, yc + w / 2 + fr + w / 2, z0 + h), sh)


def awning(p: Part, xc: float, ztop: float, w: float, yf: float, color: str, detail: int, small: bool = False) -> None:
    """Toldo inclinado con faldón."""
    depth = 0.9 if small else 1.5
    drop = 0.55 if small else 0.75
    m = mat("toldo", color)
    x0, x1 = xc - w / 2, xc + w / 2
    t = 0.025
    flap = 0.22
    outline = [
        (yf - 0.02, ztop), (yf - depth, ztop - drop), (yf - depth, ztop - drop - flap),
        (yf - depth + t, ztop - drop - flap), (yf - depth + t, ztop - drop - t * 0.5), (yf - 0.02, ztop - t * 2),
    ]
    p.prism(outline, x0, x1, m)
    if detail:
        iron = mat("hierro", IRON)
        p.box((x0 - 0.02, yf - depth, ztop - drop - 0.03), (x1 + 0.02, yf - depth + 0.03, ztop - drop), iron)


def lantern(p: Part, at, size: float, detail: int) -> None:
    """Farol de forja con cristal que se enciende de noche."""
    x, y, z = at
    iron = mat("hierro", IRON)
    s = size
    p.box((x - s * 0.7, y - s * 0.7, z), (x + s * 0.7, y + s * 0.7, z + s * 0.2), iron)
    p.box((x - s * 0.5, y - s * 0.5, z + s * 0.2), (x + s * 0.5, y + s * 0.5, z + s * 1.6), mat("farol", "#ffcf7a"))
    p.lathe((x, y, z + s * 1.6), [(s * 0.75, 0), (s * 0.75, s * 0.12), (s * 0.15, s * 0.6), (0.0, s * 0.75)], iron, segments=4 if not detail else 8)
    if detail:
        for dx in (-1, 1):
            for dy in (-1, 1):
                p.box((x + dx * s * 0.5 - 0.012, y + dy * s * 0.5 - 0.012, z + s * 0.2), (x + dx * s * 0.5 + 0.012, y + dy * s * 0.5 + 0.012, z + s * 1.6), iron)


def hip_roof(p: Part, W: float, D: float, Ht: float, detail: int) -> None:
    tile = mat("teja", TILE)
    o = 0.55
    zb = Ht + 0.0
    x0, x1, y0, y1 = -W / 2 - o, W / 2 + o, -D / 2 - o, D / 2 + o
    h = min(W, D) * 0.22
    inset = (y1 - y0) / 2
    r0 = (x0 + inset, 0.0, zb + h)
    r1 = (x1 - inset, 0.0, zb + h)
    ry = (y0 + y1) / 2
    r0 = (r0[0], ry, r0[2])
    r1 = (r1[0], ry, r1[2])
    a, b, c, d = (x0, y0, zb), (x1, y0, zb), (x1, y1, zb), (x0, y1, zb)
    p.poly([a, b, r1, r0], tile)  # frente
    p.poly([c, d, r0, r1], tile)  # detrás
    p.poly([b, c, r1], tile)
    p.poly([d, a, r0], tile)
    # Canto del alero
    fascia = mat("piedra", STONE_DARK)
    th = 0.12
    p.box((x0, y0, zb - th), (x1, y0 + 0.02, zb), fascia)
    p.box((x0, y1 - 0.02, zb - th), (x1, y1, zb), fascia)
    p.box((x0, y0, zb - th), (x0 + 0.02, y1, zb), fascia)
    p.box((x1 - 0.02, y0, zb - th), (x1, y1, zb), fascia)
    p.box((x0 + 0.02, y0 + 0.02, zb - th), (x1 - 0.02, y1 - 0.02, zb - th + 0.01), fascia)
    # Cumbreras
    ridge = mat("teja", "#a14a30")
    seg = 6 if detail else 4
    p.tube([a, r0], 0.07, ridge, segments=seg)
    p.tube([b, r1], 0.07, ridge, segments=seg)
    p.tube([c, r1], 0.07, ridge, segments=seg)
    p.tube([d, r0], 0.07, ridge, segments=seg)
    p.tube([r0, r1], 0.08, ridge, segments=seg)
    # Chimenea
    if detail or True:
        cx, cy = W * 0.22, D * 0.12
        wall = mat("cal", "#efe8dc")
        p.box((cx - 0.35, cy - 0.35, zb), (cx + 0.35, cy + 0.35, zb + h + 0.9), wall)
        p.box((cx - 0.45, cy - 0.45, zb + h + 0.9), (cx + 0.45, cy + 0.45, zb + h + 1.0), mat("piedra", STONE))
        p.box((cx - 0.3, cy - 0.3, zb + h + 1.25), (cx + 0.3, cy + 0.3, zb + h + 1.33), tile)
        for dx in (-0.25, 0.25):
            p.box((cx + dx - 0.05, cy - 0.25, zb + h + 1.0), (cx + dx + 0.05, cy + 0.25, zb + h + 1.25), wall)


def flat_roof(p: Part, W: float, D: float, Ht: float, spec: dict, rnd: random.Random, detail: int) -> None:
    """Azotea con pretil, depósito y un panel de neón en lo alto (el toque futurista)."""
    wall = mat("estuco", spec["wall"])
    stone = mat("piedra", STONE)
    zt = Ht
    t = 0.3
    ph = 0.9
    p.box((-W / 2, -D / 2, zt), (W / 2, -D / 2 + t, zt + ph), wall)
    p.box((-W / 2, D / 2 - t, zt), (W / 2, D / 2, zt + ph), wall)
    p.box((-W / 2, -D / 2 + t, zt), (-W / 2 + t, D / 2 - t, zt + ph), wall)
    p.box((W / 2 - t, -D / 2 + t, zt), (W / 2, D / 2 - t, zt + ph), wall)
    p.box((-W / 2 - 0.05, -D / 2 - 0.05, zt + ph), (W / 2 + 0.05, D / 2 + 0.05, zt + ph + 0.1), stone, skip=("-z",))
    p.box((-W / 2 + t, -D / 2 + t, zt), (W / 2 - t, D / 2 - t, zt + 0.05), mat("losa", "#b9a98c"))
    # Caseta de escalera
    p.box((-W / 2 + 1, D / 2 - 3, zt), (-W / 2 + 3.4, D / 2 - 0.6, zt + 2.6), mat("cal", "#efe8dc"))
    p.box((-W / 2 + 0.9, D / 2 - 3.1, zt + 2.6), (-W / 2 + 3.5, D / 2 - 0.5, zt + 2.75), stone)
    # Panel publicitario de neón sobre la azotea (estructura de metal + neón)
    metal = mat("metal", "#3a3d42")
    bw, bh = W * 0.5, 2.4
    bz = zt + 1.4
    by = D / 2 - 1.5
    for x in (-bw / 2 + 0.3, bw / 2 - 0.3):
        p.box((x - 0.06, by - 0.06, zt), (x + 0.06, by + 0.06, bz), metal)
        p.box((x - 0.04, by, zt), (x + 0.04, by + 1.2, zt + 0.08), metal)
        p.tube([(x, by, bz - 0.2), (x, by + 1.2, zt + 0.08)], 0.03, metal, segments=4)
    p.box((-bw / 2, by - 0.05, bz), (bw / 2, by + 0.05, bz + bh), mat("oscuro", "#101218"))
    rect = [(-bw / 2 + 0.12, by - 0.08, bz + 0.12), (bw / 2 - 0.12, by - 0.08, bz + 0.12), (bw / 2 - 0.12, by - 0.08, bz + bh - 0.12), (-bw / 2 + 0.12, by - 0.08, bz + bh - 0.12)]
    p.tube(rect, 0.04, mat("neon", spec["neon"]), segments=6 if detail else 4, closed=True)
    # Rombo de xenxo en el centro del panel
    cx, cz = 0.0, bz + bh / 2
    diamond = [(cx, by - 0.08, cz + 0.75), (cx + 0.75, by - 0.08, cz), (cx, by - 0.08, cz - 0.75), (cx - 0.75, by - 0.08, cz)]
    p.tube(diamond, 0.045, mat("neon", "#4fa3ff"), segments=6 if detail else 4, closed=True)
    # Depósito de agua
    if detail:
        p.cylinder((W / 2 - 2.0, -D / 2 + 2.2, zt + 0.05), 0.65, 1.3, mat("metal", "#8e8a84"), segments=14)
