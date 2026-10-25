"""
Biblioteca de materiales de xenxo: descarga texturas escaneadas CC0 de Poly Haven,
las prepara para la web y las deja en apps/web/public/materials/ (se sirven desde xenxo:
el navegador del visitante nunca habla con Poly Haven).

  python3 tools/materials/fetch.py

Por cada material:
  albedo  → color con la oclusión fina ya multiplicada. En modo "tinte" se desatura y
            se normaliza a luminancia ~0,82, para que el color lo ponga el tinte del modelo.
  normal  → mapa de normales (convención OpenGL, la de three.js).
  rm      → G = rugosidad, B = metal (canales de three.js).
Tamaños: 512 (Media y Quest) y 1024 (Alta y Ultra), en WebP.
"""
from __future__ import annotations

import io
import json
import os
import sys
import urllib.request

from PIL import Image, ImageChops, ImageStat

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "apps", "web", "public", "materials")
INDEX = os.path.join(ROOT, "apps", "web", "src", "world", "material-library.json")
CACHE = os.path.join(ROOT, "tools", "materials", ".cache")

# biblioteca → (asset de Poly Haven, modo, saturación conservada)
LIBRARY = {
    "cal": ("white_stucco", "tint", 0.1),
    "estuco": ("white_plaster_02", "tint", 0.1),
    "piedra": ("sandstone_blocks_04", "tint", 0.25),
    "losa": ("large_grey_tiles", "tint", 0.2),
    "adoquin": ("cobblestone_square", "tint", 0.3),
    "teja": ("clay_roof_tiles_02", "tint", 0.35),
    "azulejo": ("rounded_square_tiled_wall", "tint", 0.0),
    "madera": ("fine_grained_wood", "tint", 0.3),
    "persiana": ("wood_shutter", "tint", 0.0),
    "hierro": ("metal_plate_02", "tint", 0.0),
    "metal": ("metal_plate_02", "tint", 0.0),
    "toldo": ("denim_fabric", "stripes", 0.0),
    "tela": ("denim_fabric", "tint", 0.0),
    "corteza": ("bark_brown_01", "tint", 0.3),
    "tierra": ("dirt_floor", "tint", 0.3),
    "hoja": ("leafy_grass", "tint", 0.45),
}
SIZES = (512, 1024)
# Tamaño de repetición (m) cuando el real no sirve: las rayas del toldo miden 25 cm.
TILE_OVERRIDE = {"toldo": 2.0, "tela": 0.5}
UA = {"User-Agent": "xenxo-forge/1.0 (+https://github.com/xenxo-dev/xenxo-world)"}


def get(url: str) -> bytes:
    os.makedirs(CACHE, exist_ok=True)
    key = os.path.join(CACHE, url.split("/")[-1])
    if os.path.exists(key):
        return open(key, "rb").read()
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        data = r.read()
    open(key, "wb").write(data)
    return data


def api(path: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(f"https://api.polyhaven.com/{path}", headers=UA), timeout=60) as r:
        return json.load(r)


def prepare_albedo(diff: Image.Image, ao: Image.Image, mode: str, keep: float) -> Image.Image:
    diff = diff.convert("RGB")
    ao = ao.convert("L").resize(diff.size)
    # Oclusión fina (juntas, grietas) multiplicada, suavizada
    ao = ao.point(lambda v: int(255 * ((v / 255) ** 0.6)))
    diff = ImageChops.multiply(diff, Image.merge("RGB", (ao, ao, ao)))
    if mode in ("tint", "stripes"):
        gray = diff.convert("L")
        mean = ImageStat.Stat(gray).mean[0] / 255
        k = 0.82 / max(0.05, mean)
        gray = gray.point(lambda v: min(255, int(v * k)))
        if keep > 0:
            col = diff.point(lambda v: min(255, int(v * k)))
            diff = Image.blend(Image.merge("RGB", (gray, gray, gray)), col, keep)
        else:
            diff = Image.merge("RGB", (gray, gray, gray))
    if mode == "stripes":
        # Toldo a rayas: franjas de 25 cm (la textura cubre el ancho de su tamaño real)
        w, h = diff.size
        stripes = Image.new("L", (w, h))
        n = 8
        px = stripes.load()
        for x in range(w):
            v = 255 if (x * n // w) % 2 == 0 else 150
            for y in range(h):
                px[x, y] = v
        diff = ImageChops.multiply(diff, Image.merge("RGB", (stripes, stripes, stripes)))
    return diff


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    index = {}
    done: dict[str, dict] = {}
    for lib, (asset, mode, keep) in LIBRARY.items():
        info = api(f"info/{asset}")
        files = api(f"files/{asset}")
        tile = TILE_OVERRIDE.get(lib) or round(info.get("dimensions", [2000, 2000])[0] / 1000, 3)
        src = {m: Image.open(io.BytesIO(get(files[m]["2k"]["jpg"]["url"]))) for m in ("Diffuse", "nor_gl", "arm")}
        arm = src["arm"].convert("RGB")
        r, g, b = arm.split()
        albedo = prepare_albedo(src["Diffuse"], r, mode, keep)
        rm = Image.merge("RGB", (Image.new("L", arm.size, 255), g, b))
        normal = src["nor_gl"].convert("RGB")
        folder = os.path.join(OUT, lib)
        os.makedirs(folder, exist_ok=True)
        for size in SIZES:
            albedo.resize((size, size), Image.LANCZOS).save(os.path.join(folder, f"albedo.{size}.webp"), "WEBP", quality=82, method=6)
            normal.resize((size, size), Image.LANCZOS).save(os.path.join(folder, f"normal.{size}.webp"), "WEBP", quality=88, method=6)
            rm.resize((size, size), Image.LANCZOS).save(os.path.join(folder, f"rm.{size}.webp"), "WEBP", quality=80, method=6)
        index[lib] = {"tile": tile, "source": f"Poly Haven · {info.get('name', asset)} (CC0)", "asset": asset}
        print(f"{lib:9} ← {asset:24} {tile} m", flush=True)
    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=1, ensure_ascii=False)
        f.write("\n")
    total = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(OUT) for fn in fns)
    print(f"{len(index)} materiales, {total / 1048576:.1f} MB → {OUT}")


if __name__ == "__main__":
    sys.exit(main())
