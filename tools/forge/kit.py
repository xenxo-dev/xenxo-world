"""
Herramientas de modelado de la forja (Blender 5 como módulo de Python, sin pantalla).

Convenciones (Blender, Z arriba):
  - Cada pieza se modela con su frente mirando a -Y (al exportar a glTF, -Y pasa a +Z:
    el frente que el seed orienta hacia la fuente).
  - Unidades en metros.
  - Materiales con nombre "xenxo:<biblioteca>.<tinte>": el cliente web los sustituye por los
    de su biblioteca (texturas reales, según el nivel gráfico). Cualquier otro cliente ve
    el color base y la oclusión horneada, que ya se ven bien por sí solos.
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

import bmesh
import bpy
from mathutils import Matrix, Vector

V = Vector

CHUNK = 64.0  # lado de un chunk en metros (igual que CHUNK_SIZE del protocolo)


# --------------------------------------------------------------------------------------
# Escena y materiales
# --------------------------------------------------------------------------------------

def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))  # type: ignore[return-value]


# Biblioteca: rugosidad y metal por defecto (el cliente aplica sus propias texturas encima).
LIBRARY = {
    "cal": (0.92, 0.0),        # enlucido encalado
    "estuco": (0.85, 0.0),     # enlucido pintado
    "piedra": (0.8, 0.0),      # arenisca / caliza en molduras, columnas y zócalos
    "losa": (0.7, 0.0),        # losas del suelo de la plaza
    "adoquin": (0.85, 0.0),    # calles
    "teja": (0.75, 0.0),       # teja árabe
    "azulejo": (0.18, 0.0),    # cerámica vidriada
    "madera": (0.7, 0.0),
    "persiana": (0.6, 0.0),    # madera pintada de persianas y puertas
    "hierro": (0.45, 0.85),    # forja
    "metal": (0.3, 0.9),
    "panel": (0.5, 0.0),       # paneles de metal grandes (ambientCG): suelos del nexo y los distritos
    "scifi": (0.55, 0.0),      # rejilla octogonal (ambientCG): parcelas
    "toldo": (0.95, 0.0),
    "ventana": (0.08, 0.0),    # vidrio de ventanas y escaparates: se encienden de noche
    "agua": (0.02, 0.0),
    "neon": (0.4, 0.0),        # tubos de neón: brillan según el ambiente
    "farol": (0.1, 0.0),       # cristal de farolas: luz cálida de noche
    "hoja": (0.8, 0.0),
    "corteza": (0.9, 0.0),
    "fruta": (0.5, 0.0),
    "flor": (0.8, 0.0),
    "tierra": (1.0, 0.0),
    "tela": (0.9, 0.0),
    "oscuro": (1.0, 0.0),      # huecos profundos (interior de campanario, etc.)
}

MATS: dict[str, bpy.types.Material] = {}


def mat(lib: str, tint: str = "#ffffff") -> bpy.types.Material:
    """Material de biblioteca con tinte. Se reutiliza si ya existe."""
    if lib not in LIBRARY:
        raise ValueError(f"material desconocido: {lib}")
    tint = tint.lower()
    name = f"xenxo:{lib}.{tint.lstrip('#')}"
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    rough, metal = LIBRARY[lib]
    rgb = hex_rgb(tint)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if lib in ("neon", "farol"):
        bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if lib in ("ventana", "agua"):
        bsdf.inputs["Alpha"].default_value = 1.0
    MATS[name] = m
    return m


def is_emissive(m: bpy.types.Material) -> bool:
    return any(f"xenxo:{k}." in m.name for k in ("neon", "farol"))


# --------------------------------------------------------------------------------------
# Construcción con bmesh: una "pieza" acumula geometría con materiales por cara
# --------------------------------------------------------------------------------------

class Part:
    """Acumula geometría (bmesh) y la convierte en un objeto de Blender."""

    def __init__(self, name: str):
        self.name = name
        self.bm = bmesh.new()
        self.materials: list[bpy.types.Material] = []

    def _mi(self, m: bpy.types.Material) -> int:
        if m not in self.materials:
            self.materials.append(m)
        return self.materials.index(m)

    # -- primitivas -------------------------------------------------------------------

    def box(self, lo: Sequence[float], hi: Sequence[float], m: bpy.types.Material, skip: Iterable[str] = ()) -> None:
        """Caja alineada a los ejes entre lo y hi. `skip`: caras a omitir ('-x','+x','-y','+y','-z','+z')."""
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        if x1 - x0 <= 0 or y1 - y0 <= 0 or z1 - z0 <= 0:
            return
        bm = self.bm
        p = [
            bm.verts.new((x0, y0, z0)), bm.verts.new((x1, y0, z0)), bm.verts.new((x1, y1, z0)), bm.verts.new((x0, y1, z0)),
            bm.verts.new((x0, y0, z1)), bm.verts.new((x1, y0, z1)), bm.verts.new((x1, y1, z1)), bm.verts.new((x0, y1, z1)),
        ]
        faces = {
            "-z": (p[0], p[3], p[2], p[1]),
            "+z": (p[4], p[5], p[6], p[7]),
            "-y": (p[0], p[1], p[5], p[4]),
            "+y": (p[2], p[3], p[7], p[6]),
            "-x": (p[3], p[0], p[4], p[7]),
            "+x": (p[1], p[2], p[6], p[5]),
        }
        mi = self._mi(m)
        skip = set(skip)
        for k, vs in faces.items():
            if k in skip:
                continue
            f = bm.faces.new(vs)
            f.material_index = mi
        # Vértices de caras omitidas que no se usan: se limpian al final (clean()).

    def prism(self, outline: Sequence[tuple[float, float]], x0: float, x1: float, m: bpy.types.Material, caps: bool = True) -> None:
        """Extruye un perfil (y, z) a lo largo de X, de x0 a x1 (molduras, cornisas)."""
        bm = self.bm
        mi = self._mi(m)
        # El perfil debe ir en sentido antihorario (y a la derecha, z arriba) para que las caras miren afuera.
        area = sum(outline[i][0] * outline[(i + 1) % len(outline)][1] - outline[(i + 1) % len(outline)][0] * outline[i][1] for i in range(len(outline)))
        if area < 0:
            outline = list(reversed(outline))
        if x1 < x0:
            x0, x1 = x1, x0
        a = [bm.verts.new((x0, y, z)) for y, z in outline]
        b = [bm.verts.new((x1, y, z)) for y, z in outline]
        n = len(outline)
        for i in range(n if caps else n - 1):
            j = (i + 1) % n
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = mi
        if caps:
            fa = bm.faces.new(list(reversed(a)))
            fb = bm.faces.new(b)
            fa.material_index = fb.material_index = mi

    def cylinder(self, center: Sequence[float], radius: float, height: float, m: bpy.types.Material, segments: int = 12,
                 axis: str = "z", radius_top: float | None = None, caps: tuple[bool, bool] = (True, True)) -> None:
        """Cilindro (o tronco de cono) con base en `center` a lo largo de `axis`."""
        bm = self.bm
        mi = self._mi(m)
        rt = radius if radius_top is None else radius_top
        cx, cy, cz = center

        def place(u: float, v: float, h: float) -> tuple[float, float, float]:
            if axis == "z":
                return (cx + u, cy + v, cz + h)
            if axis == "y":
                return (cx + u, cy + h, cz + v)
            return (cx + h, cy + u, cz + v)

        bot = [bm.verts.new(place(math.cos(t) * radius, math.sin(t) * radius, 0)) for t in _angles(segments)]
        top = [bm.verts.new(place(math.cos(t) * rt, math.sin(t) * rt, height)) for t in _angles(segments)]
        flip = axis == "y"  # el eje Y invierte la orientación del círculo
        for i in range(segments):
            j = (i + 1) % segments
            vs = (bot[i], bot[j], top[j], top[i])
            f = bm.faces.new(tuple(reversed(vs)) if flip else vs)
            f.material_index = mi
            f.smooth = True
        if caps[0] and radius > 0:
            f = bm.faces.new(bot if flip else list(reversed(bot)))
            f.material_index = mi
        if caps[1] and rt > 0:
            f = bm.faces.new(list(reversed(top)) if flip else top)
            f.material_index = mi

    def lathe(self, center: Sequence[float], profile: Sequence[tuple[float, float]], m: bpy.types.Material, segments: int = 24,
              close_top: bool = False, close_bottom: bool = False, smooth: bool = True) -> None:
        """Superficie de revolución: perfil (radio, altura) girado alrededor del eje Z (fuentes, macetas, cúpulas)."""
        bm = self.bm
        mi = self._mi(m)
        cx, cy, cz = center
        rings = []
        for r, h in profile:
            rings.append([bm.verts.new((cx + math.cos(t) * r, cy + math.sin(t) * r, cz + h)) for t in _angles(segments)])
        for a, b in zip(rings, rings[1:]):
            for i in range(segments):
                j = (i + 1) % segments
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
                f.material_index = mi
                f.smooth = smooth
        if close_bottom and profile[0][0] > 0:
            f = bm.faces.new(list(reversed(rings[0])))
            f.material_index = mi
        if close_top and profile[-1][0] > 0:
            f = bm.faces.new(rings[-1])
            f.material_index = mi

    def sphere(self, center: Sequence[float], radius: float, m: bpy.types.Material, subdiv: int = 1, squash: float = 1.0) -> None:
        """Icoesfera (frutas, flores, copas)."""
        mi = self._mi(m)
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=radius)
        for v in tmp.verts:
            v.co.z *= squash
            v.co += V(center)
        self._absorb(tmp, mi, smooth=True)

    def poly(self, pts: Sequence[Sequence[float]], m: bpy.types.Material) -> None:
        mi = self._mi(m)
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        f.material_index = mi

    def tube(self, path: Sequence[Sequence[float]], radius: float, m: bpy.types.Material, segments: int = 6, closed: bool = False) -> None:
        """Tubo a lo largo de una polilínea (neones, barandillas curvas, ramas)."""
        bm = self.bm
        mi = self._mi(m)
        pts = [V(p) for p in path]
        if closed:
            pts.append(pts[0])
        rings = []
        for i, p in enumerate(pts):
            if i == 0:
                d = (pts[1] - p)
            elif i == len(pts) - 1:
                d = (p - pts[i - 1])
            else:
                d = (pts[i + 1] - pts[i - 1])
            d.normalize()
            up = V((0, 0, 1)) if abs(d.z) < 0.9 else V((1, 0, 0))
            u = d.cross(up).normalized()
            w = d.cross(u).normalized()
            rings.append([bm.verts.new(p + (u * math.cos(t) + w * math.sin(t)) * radius) for t in _angles(segments)])
        for a, b in zip(rings, rings[1:]):
            for i in range(segments):
                j = (i + 1) % segments
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
                f.material_index = mi
                f.smooth = True
        if not closed:
            f = bm.faces.new(list(reversed(rings[0])))
            f.material_index = mi
            f = bm.faces.new(rings[-1])
            f.material_index = mi

    def merge(self, other: "Part", matrix: Matrix | None = None) -> None:
        """Copia otra pieza dentro de esta (con una transformación opcional)."""
        remap = {i: self._mi(m) for i, m in enumerate(other.materials)}
        tmp = other.bm.copy()
        if matrix is not None:
            bmesh.ops.transform(tmp, matrix=matrix, verts=tmp.verts)
        for f in tmp.faces:
            f.material_index = remap.get(f.material_index, 0)
        self._absorb(tmp, None)

    def _absorb(self, tmp: bmesh.types.BMesh, mi: int | None, smooth: bool | None = None) -> None:
        me = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(me)
        tmp.free()
        if mi is not None:
            for p in me.polygons:
                p.material_index = mi
                if smooth is not None:
                    p.use_smooth = smooth
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    # -- salida -----------------------------------------------------------------------

    def to_object(self, collection: bpy.types.Collection | None = None) -> bpy.types.Object:
        bmesh.ops.delete(self.bm, geom=[v for v in self.bm.verts if not v.link_faces], context="VERTS")
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.materials:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        return ob


def _angles(n: int) -> list[float]:
    return [2 * math.pi * i / n for i in range(n)]


# --------------------------------------------------------------------------------------
# Operaciones sobre objetos
# --------------------------------------------------------------------------------------

def activate(ob: bpy.types.Object) -> None:
    bpy.context.view_layer.update()
    for o in bpy.data.objects:
        if o.name in bpy.context.view_layer.objects:
            o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def cut(target: bpy.types.Object, cutters: Sequence[bpy.types.Object]) -> None:
    """Resta (booleana exacta) varios objetos de `target` y los elimina."""
    if not cutters:
        return
    join_into = cutters[0]
    if len(cutters) > 1:
        activate(join_into)
        for c in cutters[1:]:
            c.select_set(True)
        bpy.ops.object.join()
    mod = target.modifiers.new("cut", "BOOLEAN")
    mod.object = join_into
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.use_self = True
    mod.use_hole_tolerant = True
    activate(target)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(join_into, do_unlink=True)


def bevel(ob: bpy.types.Object, width: float = 0.015, angle_deg: float = 40) -> None:
    mod = ob.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = 1
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle_deg)
    mod.harden_normals = True
    activate(ob)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def join(objs: Sequence[bpy.types.Object], name: str) -> bpy.types.Object:
    objs = [o for o in objs if o is not None]
    activate(objs[0])
    for o in objs[1:]:
        o.select_set(True)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def finish(ob: bpy.types.Object, smooth_angle: float = 35) -> None:
    """Limpia, une vértices duplicados y suaviza por ángulo."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bmesh.ops.dissolve_degenerate(bm, dist=0.0001, edges=bm.edges)
    bm.to_mesh(ob.data)
    bm.free()
    activate(ob)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
    # El suavizado por ángulo marca bordes vivos; las caras planas quedan planas.


def world_uv(ob: bpy.types.Object, name: str = "UV0") -> None:
    """UV en metros por proyección de caja: las texturas de biblioteca repiten con densidad constante."""
    me = ob.data
    uv = me.uv_layers.get(name) or me.uv_layers.new(name=name)
    mw = ob.matrix_world
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                u, v = (co.y if n.x > 0 else -co.y), co.z
            elif ax == 1:
                u, v = (-co.x if n.y > 0 else co.x), co.z
            else:
                u, v = co.x, (co.y if n.z > 0 else -co.y)
            uv.data[li].uv = (u, v)


def lightmap_uv(ob: bpy.types.Object, name: str = "UV1", margin: float = 0.004) -> None:
    """Segundo canal UV, único y sin solapes, para hornear la oclusión ambiental."""
    me = ob.data
    if name not in me.uv_layers:
        me.uv_layers.new(name=name)
    me.uv_layers.active = me.uv_layers[name]
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=margin, rotate=True, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    me.uv_layers.active = me.uv_layers[0]


def tris(ob: bpy.types.Object) -> int:
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# --------------------------------------------------------------------------------------
# Horneado de oclusión ambiental (Cycles en CPU)
# --------------------------------------------------------------------------------------

def setup_bake(distance: float = 3.0, samples: int = 96) -> None:
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    if sc.world is None:
        sc.world = bpy.data.worlds.new("world")
    sc.world.light_settings.distance = distance
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = True


def bake_ao(ob: bpy.types.Object, size: int, path: str) -> None:
    """Hornea la oclusión de `ob` (con todo lo visible de la escena como oclusor) en un JPEG."""
    img = bpy.data.images.new(f"ao_{ob.name}", size, size, alpha=False, float_buffer=False)
    img.generated_color = (1, 1, 1, 1)
    me = ob.data
    me.uv_layers.active = me.uv_layers["UV1"]
    added = []
    for m in me.materials:
        nt = m.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        nt.nodes.active = node
        added.append((nt, node))
    activate(ob)
    bpy.ops.object.bake(type="AO", margin=6, use_clear=True)
    for nt, node in added:
        nt.nodes.remove(node)
    me.uv_layers.active = me.uv_layers["UV0"]
    png = path + ".png"
    img.filepath_raw = png
    img.file_format = "PNG"
    img.save(filepath=png)
    bpy.data.images.remove(img)
    # Un leve desenfoque quita el ruido del horneado (y la WebP pesa la mitad).
    from PIL import Image, ImageFilter

    im = Image.open(png).convert("L").filter(ImageFilter.GaussianBlur(radius=max(0.6, size / 1400)))
    im.save(path, "WEBP", quality=80, method=6)
    import os

    os.remove(png)


def export_glb(ob: bpy.types.Object, path: str) -> None:
    activate(ob)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_extras=False,
    )
