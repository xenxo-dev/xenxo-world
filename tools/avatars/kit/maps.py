"""Mapas de la piel en el espacio UV del cuerpo (los mismos para todas las pieles de MakeHuman).

Con ellos el navegador pinta, sobre la piel elegida, el maquillaje, la barba de tres días, las pecas
y los acabados sintéticos o robóticos por zonas, sin texturas nuevas por persona:

- body_maps.webp (RGB): R = zona (cabeza, torso, brazo izq., brazo der., piernas: id × 50 + 25),
  G = juntas entre zonas, B = líneas de panel (entre huesos, contorno de la cara y líneas del centro).
- face_maps.webp (RGB): R = labios, G = párpados (sombra de ojos), B = mejillas (colorete).
- skin_maps.webp (RGB): R = barba de tres días (ya con su grano), G = pecas, B = sin uso.

Todo sale de la malla base y del esqueleto de MakeHuman (CC0): las zonas, de los pesos de piel; las
líneas, donde un hueso deja paso a otro, con un grosor fijo en milímetros (no en píxeles); el
maquillaje, de la geometría de la cara. Se dibuja con los cuerpos de mujer y de hombre (sus islas UV
casi coinciden) y los bordes de cada isla se rellenan para que no salgan costuras.
"""
from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

ZONES = ["head", "torso", "arm_l", "arm_r", "legs"]


def zone_of_bone(name: str) -> int:
    if name in ("head", "neck_01"):
        return 0
    if name.endswith("_l") and not name.startswith(("thigh", "calf", "foot", "ball", "clavicle")):
        return 2
    if name.endswith("_r") and not name.startswith(("thigh", "calf", "foot", "ball", "clavicle")):
        return 3
    if name.startswith(("thigh", "calf", "foot", "ball")):
        return 4
    return 1


def smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


class Raster:
    """Dibuja campos por vértice en el espacio UV de una malla (interpolados en cada triángulo)."""

    def __init__(self, size: int, uv: np.ndarray, tris: np.ndarray, pos: np.ndarray):
        self.size = size
        self.px = np.stack([uv[:, 0] * size, (1 - uv[:, 1]) * size], 1)
        self.tris = tris
        self.pos = pos
        self.cells = []  # por triángulo: (ys, xs, l0, l1, l2, metros por píxel)
        for t in tris:
            p = self.px[t]
            x0, y0 = np.floor(p.min(0)).astype(int)
            x1, y1 = np.ceil(p.max(0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, size), min(y1, size)
            if x1 <= x0 or y1 <= y0:
                self.cells.append(None)
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
            (ax, ay), (bx, by), (cx, cy) = p
            d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
            if abs(d) < 1e-9:
                self.cells.append(None)
                continue
            l1 = ((xs - ax) * (cy - ay) - (ys - ay) * (cx - ax)) / d
            l2 = ((bx - ax) * (ys - ay) - (by - ay) * (xs - ax)) / d
            l0 = 1 - l1 - l2
            inside = (l0 >= -1e-4) & (l1 >= -1e-4) & (l2 >= -1e-4)
            if not inside.any():
                self.cells.append(None)
                continue
            area3 = np.linalg.norm(np.cross(pos[t[1]] - pos[t[0]], pos[t[2]] - pos[t[0]])) / 2
            mpp = np.sqrt(max(area3, 1e-12) / (abs(d) / 2))  # metros por píxel en este triángulo
            self.cells.append((ys[inside].astype(int), xs[inside].astype(int), l0[inside], l1[inside], l2[inside], mpp))

    def mask(self) -> np.ndarray:
        m = np.zeros((self.size, self.size), bool)
        for c in self.cells:
            if c is not None:
                m[c[0], c[1]] = True
        return m

    def field(self, f: np.ndarray, out: np.ndarray, only_empty: np.ndarray | None = None):
        """Campo escalar (o vector) por vértice → píxeles."""
        for t, c in zip(self.tris, self.cells):
            if c is None:
                continue
            ys, xs, l0, l1, l2, _ = c
            v = f[t[0]] * l0[..., None] + f[t[1]] * l1[..., None] + f[t[2]] * l2[..., None] if f.ndim == 2 else \
                f[t[0]] * l0 + f[t[1]] * l1 + f[t[2]] * l2
            if only_empty is not None:
                keep = ~only_empty[ys, xs]
                ys, xs, v = ys[keep], xs[keep], v[keep]
            out[ys, xs] = v

    def iso_lines(self, f: np.ndarray, levels: list[float], half: float, out: np.ndarray, where: np.ndarray | None = None):
        """Líneas donde el campo `f` vale cada nivel, de `half` metros a cada lado y con el borde suavizado."""
        for t, c in zip(self.tris, self.cells):
            if c is None:
                continue
            if where is not None and not where[t].all():
                continue
            ys, xs, l0, l1, l2, mpp = c
            g = grad3(self.pos[t], f[t])
            if g < 1e-9:
                continue
            v = f[t[0]] * l0 + f[t[1]] * l1 + f[t[2]] * l2
            for lv in levels:
                dist = np.abs(v - lv) / g
                a = np.clip((half - dist) / mpp + 0.5, 0, 1)
                np.maximum.at(out, (ys, xs), a)

    def margin_lines(self, w: np.ndarray, half: float, out: np.ndarray, skip: set[tuple[int, int]] | None = None):
        """Líneas donde se cruzan los dos canales más altos de `w` (V × C): fronteras entre zonas o huesos."""
        for t, c in zip(self.tris, self.cells):
            if c is None:
                continue
            ch = np.where(w[t].max(0) > 0.02)[0]
            if len(ch) < 2:
                continue
            ys, xs, l0, l1, l2, mpp = c
            wt = w[t][:, ch]  # 3 × k
            v = l0[:, None] * wt[0] + l1[:, None] * wt[1] + l2[:, None] * wt[2]
            order = np.argsort(-v, axis=1)
            a, b = order[:, 0], order[:, 1]
            for i in range(len(ch)):
                for j in range(len(ch)):
                    if i == j:
                        continue
                    if skip and (ch[i], ch[j]) in skip:
                        continue
                    sel = (a == i) & (b == j)
                    if not sel.any():
                        continue
                    diff = wt[:, i] - wt[:, j]
                    g = grad3(self.pos[t], diff)
                    if g < 1e-9:
                        continue
                    dist = (v[sel, i] - v[sel, j]) / g
                    al = np.clip((half - dist) / mpp + 0.5, 0, 1)
                    np.maximum.at(out, (ys[sel], xs[sel]), al)


def grad3(p: np.ndarray, f: np.ndarray) -> float:
    """Módulo del gradiente de un campo lineal sobre un triángulo en 3D (por metro)."""
    e1, e2 = p[1] - p[0], p[2] - p[0]
    a11, a12, a22 = e1 @ e1, e1 @ e2, e2 @ e2
    det = a11 * a22 - a12 * a12
    if det < 1e-16:
        return 0.0
    d1, d2 = f[1] - f[0], f[2] - f[0]
    x = (a22 * d1 - a12 * d2) / det
    y = (a11 * d2 - a12 * d1) / det
    g = x * e1 + y * e2
    return float(np.linalg.norm(g))


def fill_gutters(img: np.ndarray, covered: np.ndarray) -> np.ndarray:
    """Rellena lo que queda fuera de las islas con el valor más cercano (sin costuras al filtrar)."""
    _, (iy, ix) = ndimage.distance_transform_edt(~covered, return_indices=True)
    return img[iy, ix]


def blur_on_mesh(f: np.ndarray, tris: np.ndarray, steps: int) -> np.ndarray:
    """Suaviza un campo por vértice con sus vecinos (sobre la malla, sin cruzar costuras de UV)."""
    n = len(f)
    edges = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    edges = np.concatenate([edges, edges[:, ::-1]])
    deg = np.bincount(edges[:, 0], minlength=n).astype(float)
    g = f.astype(float).copy()
    for _ in range(steps):
        acc = np.zeros(n)
        np.add.at(acc, edges[:, 0], g[edges[:, 1]])
        g = 0.5 * g + 0.5 * acc / np.maximum(deg, 1)
    return g


def weld_tris(pos: np.ndarray, tris: np.ndarray) -> np.ndarray:
    """Triángulos con los vértices soldados por posición (para suavizar a través de costuras)."""
    key: dict = {}
    w = np.array([key.setdefault(tuple(np.round(x, 5)), i) for i, x in enumerate(pos)])
    return w[tris], w


def make_maps(out_dir: str, size: int, bodies: list[dict], base_fields: dict, joints: dict, rng_seed: int = 7):
    """
    bodies: por cada cuerpo (mujer y hombre) {uv, tris, pos (m), refs, w} con la atadura a la base.
    base_fields: campos por vértice de la base: zone_w (n×5), bone_w (n×B), y lo de la cara
      (lips, shadow, blush, stubble_area, freckle_area) ya calculado en metros.
    joints: posiciones (m) de lo que hace falta: centro de la cabeza, ojos, eje del torso.
    """
    zone_w_img = np.zeros((size, size, len(ZONES)))
    seams = np.zeros((size, size))
    detail = np.zeros((size, size))
    face = np.zeros((size, size, 3))
    skin = np.zeros((size, size, 3))
    covered = np.zeros((size, size), bool)

    for body in bodies:
        r = Raster(size, body["uv"], body["tris"], body["pos"])
        here = r.mask()
        first = ~covered
        refs, w = body["refs"], body["w"]

        def per_vertex(f):
            return (f[refs] * (w[..., None] if f.ndim == 2 else w)).sum(1)

        zw = per_vertex(base_fields["zone_w"])
        bw = per_vertex(base_fields["bone_w"])
        tmp = np.zeros_like(zone_w_img)
        r.field(zw, tmp)
        zone_w_img[first & here] = tmp[first & here]

        s = np.zeros((size, size))
        r.margin_lines(zw, 0.0018, s)
        d = np.zeros((size, size))
        r.margin_lines(bw, 0.0011, d, skip=base_fields.get("skip_pairs"))
        # Contorno de la cara (vertical a cada lado, por la frente) y líneas del centro del torso.
        p = body["pos"]
        hc = joints["head_center"]
        theta = np.arctan2(p[:, 0] - hc[0], p[:, 2] - hc[2])
        head = zw[:, 0] > 0.6
        torso = zw[:, 1] > 0.6
        side = head & (p[:, 1] > joints["chin_y"]) & (p[:, 1] < joints["forehead_y"])
        r.iso_lines(np.abs(theta), [joints["face_angle"]], 0.0011, d, where=side)
        brow = head & (np.abs(theta) < joints["face_angle"]) & (p[:, 2] > hc[2])
        r.iso_lines(p[:, 1], [joints["forehead_y"]], 0.0011, d, where=brow)
        r.iso_lines(p[:, 0], [0.0], 0.0011, d, where=torso & (np.abs(p[:, 0]) < 0.05))
        seams[first & here] = s[first & here]
        detail[first & here] = d[first & here]

        f = np.zeros((size, size, 3))
        r.field(np.stack([per_vertex(base_fields[k]) for k in ("lips", "shadow", "blush")], 1), f)
        face[first & here] = f[first & here]
        g = np.zeros((size, size, 3))
        r.field(np.stack([per_vertex(base_fields["stubble_area"]), per_vertex(base_fields["freckle_area"]), np.zeros(len(refs))], 1), g)
        skin[first & here] = g[first & here]
        covered |= here

    zone_img = np.argmax(zone_w_img, axis=2)
    rng = np.random.default_rng(rng_seed)
    # Grano de la barba: puntos de un píxel, más densos en el centro de la zona.
    grain = rng.random((size, size))
    stubble = skin[..., 0] * np.clip((grain - 0.25) / 0.75, 0, 1) ** 0.6
    stubble = ndimage.gaussian_filter(stubble, 0.35)
    # Pecas: puntitos de 1 a 2,5 px (1 a 2 mm en la cara) por la nariz y las mejillas.
    freckles = np.zeros((size, size))
    area = skin[..., 1]
    ys, xs = np.nonzero(area > 0.05)
    if len(ys):
        n = int(area.sum() / 12)
        pick = rng.choice(len(ys), size=min(n, len(ys)), replace=False, p=area[ys, xs] / area[ys, xs].sum())
        yy, xx = np.mgrid[-3:4, -3:4]
        for k in pick:
            rad = rng.uniform(0.6, 1.3)
            a = rng.uniform(0.35, 0.9) * area[ys[k], xs[k]]
            blob = np.clip(1.25 - np.hypot(yy, xx) / rad, 0, 1) * a
            y0, x0 = ys[k] - 3, xs[k] - 3
            if y0 < 0 or x0 < 0 or y0 + 7 > size or x0 + 7 > size:
                continue
            np.maximum(freckles[y0:y0 + 7, x0:x0 + 7], blob, out=freckles[y0:y0 + 7, x0:x0 + 7])
    skin[..., 0] = stubble
    skin[..., 1] = freckles

    def save(name: str, rgb: np.ndarray):
        rgb = fill_gutters(rgb, covered)
        Image.fromarray(np.clip(np.round(rgb * 255), 0, 255).astype(np.uint8), "RGB").save(f"{out_dir}/{name}", "WEBP", lossless=True, method=6)

    zone_rgb = np.stack([(zone_img * 50 + 25) / 255.0, seams, detail], 2)
    save("body_maps.webp", zone_rgb)
    save("face_maps.webp", face)
    save("skin_maps.webp", skin)
