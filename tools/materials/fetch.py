"""
Biblioteca de materiales de xenxo: prepara las texturas para la web y las deja en
apps/web/public/materials/ (se sirven desde xenxo: el navegador del visitante nunca habla
con Poly Haven ni con ninguna plataforma de IA).

Tres orígenes:
  - Poly Haven (CC0): escaneos reales que se descargan solos.
  - ambientCG (CC0): materiales PBR (metal, paneles, suelos técnicos…), con el prefijo "acg:".
  - Generadas con IA (Higgsfield u otras): la imagen vive en tools/materials/generated/<biblioteca>/
    con su meta.json (plataforma, modelo, fecha, prompt, plan…). Ver generated/README.md.

  python3 tools/materials/fetch.py            # todas
  python3 tools/materials/fetch.py cal neon   # solo esas (el resto del índice se conserva)

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
GENERATED = os.path.join(ROOT, "tools", "materials", "generated")

# biblioteca → (asset de Poly Haven, modo, saturación conservada).
# Las generadas con IA no van aquí: se descubren solas en generated/<biblioteca>/meta.json.
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
    # ambientCG (CC0)
    "panel": ("acg:MetalPlates004", "tint", 0.0),  # paneles de metal grandes (suelos del nexo y los distritos)
    "scifi": ("acg:MetalPlates015A", "tint", 0.0),  # rejilla octogonal (parcelas)
    "fachada": ("acg:Facade017", "color", 1.0),  # rascacielos de oficinas con ventanas encendidas (agujas de las islas del nexo)
}
SIZES = (512, 1024)
# Tamaño de repetición (m) cuando el real no sirve: las rayas del toldo miden 25 cm.
TILE_OVERRIDE = {"toldo": 2.0, "tela": 0.5, "panel": 2.0, "scifi": 2.0, "fachada": 3.0}
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


def ambientcg(asset: str) -> tuple[dict[str, Image.Image], str]:
    """Descarga (con caché) el zip 2K-JPG de un material de ambientCG y devuelve sus mapas."""
    import zipfile

    data = get(f"https://ambientcg.com/get?file={asset}_2K-JPG.zip")
    z = zipfile.ZipFile(io.BytesIO(data))
    maps: dict[str, Image.Image] = {}
    for name in z.namelist():
        for key in ("Color", "NormalGL", "Roughness", "Metalness", "AmbientOcclusion"):
            if name.endswith(f"_{key}.jpg"):
                maps[key] = Image.open(io.BytesIO(z.read(name)))
    if "Color" not in maps or "NormalGL" not in maps:
        raise SystemExit(f"ambientCG {asset}: faltan mapas en el zip")
    return maps, asset


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


def normal_from_height(img: Image.Image, strength: float = 2.0) -> Image.Image:
    """Mapa de normales (OpenGL) a partir de la luminancia, para texturas que no traen el suyo."""
    g = img.convert("L")
    w, h = g.size
    px = g.load()
    out = Image.new("RGB", (w, h))
    po = out.load()
    for y in range(h):
        for x in range(w):
            dx = (px[(x + 1) % w, y] - px[(x - 1) % w, y]) / 255 * strength
            dy = (px[x, (y + 1) % h] - px[x, (y - 1) % h]) / 255 * strength
            nx, ny, nz = -dx, dy, 1.0
            n = (nx * nx + ny * ny + nz * nz) ** 0.5
            po[x, y] = (int((nx / n * 0.5 + 0.5) * 255), int((ny / n * 0.5 + 0.5) * 255), int((nz / n * 0.5 + 0.5) * 255))
    return out


def generated_libraries() -> dict[str, dict]:
    """Texturas generadas con IA: generated/<biblioteca>/meta.json + albedo.png (y normal/rough opcionales)."""
    found: dict[str, dict] = {}
    if not os.path.isdir(GENERATED):
        return found
    for lib in sorted(os.listdir(GENERATED)):
        meta_path = os.path.join(GENERATED, lib, "meta.json")
        if not os.path.exists(meta_path):
            continue
        meta = json.load(open(meta_path, encoding="utf-8"))
        if meta.get("kind") == "panorama":
            continue  # fondos (p. ej. el del nexo): no son materiales
        for k in ("platform", "model", "date", "prompt", "plan", "tile"):
            if k not in meta:
                raise SystemExit(f"{meta_path}: falta «{k}» (ver generated/README.md)")
        found[lib] = meta
    return found


def build_generated(lib: str, meta: dict) -> tuple[Image.Image, Image.Image, Image.Image]:
    folder = os.path.join(GENERATED, lib)
    base = Image.open(os.path.join(folder, "albedo.png"))
    albedo = prepare_albedo(base, Image.new("L", base.size, 255), meta.get("mode", "tint"), meta.get("keep", 0.2))
    normal_path = os.path.join(folder, "normal.png")
    normal = Image.open(normal_path).convert("RGB") if os.path.exists(normal_path) else normal_from_height(base.resize((512, 512)))
    rough_path = os.path.join(folder, "rough.png")
    rough = (
        Image.open(rough_path).convert("L").resize(base.size)
        if os.path.exists(rough_path)
        else Image.new("L", base.size, int(255 * meta.get("roughness", 0.8)))
    )
    metal = Image.new("L", base.size, int(255 * meta.get("metalness", 0.0)))
    rm = Image.merge("RGB", (Image.new("L", base.size, 255), rough, metal))
    return albedo, normal, rm


def save(lib: str, albedo: Image.Image, normal: Image.Image, rm: Image.Image) -> None:
    folder = os.path.join(OUT, lib)
    os.makedirs(folder, exist_ok=True)
    for size in SIZES:
        albedo.resize((size, size), Image.LANCZOS).save(os.path.join(folder, f"albedo.{size}.webp"), "WEBP", quality=82, method=6)
        normal.resize((size, size), Image.LANCZOS).save(os.path.join(folder, f"normal.{size}.webp"), "WEBP", quality=88, method=6)
        rm.resize((size, size), Image.LANCZOS).save(os.path.join(folder, f"rm.{size}.webp"), "WEBP", quality=80, method=6)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    index = json.load(open(INDEX, encoding="utf-8")) if only and os.path.exists(INDEX) else {}
    generated = generated_libraries()
    clash = set(generated) & set(LIBRARY)
    if clash:
        raise SystemExit(f"bibliotecas repetidas (Poly Haven y generadas): {', '.join(sorted(clash))}")
    for lib, meta in generated.items():
        if only and lib not in only:
            continue
        save(lib, *build_generated(lib, meta))
        index[lib] = {
            "tile": meta["tile"],
            "source": f"{meta['platform']} · {meta['model']} (generada con IA, {meta['date']}; ver CREDITS.md)",
            "generated": True,
        }
        print(f"{lib:9} ← IA {meta['platform']} {meta['model']} {meta['tile']} m", flush=True)
    for lib, (asset, mode, keep) in LIBRARY.items():
        if only and lib not in only:
            continue
        if asset.startswith("acg:"):
            maps, name = ambientcg(asset[4:])
            color = maps["Color"].convert("RGB")
            white = Image.new("L", color.size, 255)
            albedo = prepare_albedo(color, maps.get("AmbientOcclusion", white).convert("L"), mode, keep)
            rough = maps.get("Roughness", Image.new("L", color.size, 200)).convert("L").resize(color.size)
            metal = maps.get("Metalness", Image.new("L", color.size, 0)).convert("L").resize(color.size)
            rm = Image.merge("RGB", (white, rough, metal))
            save(lib, albedo, maps["NormalGL"].convert("RGB"), rm)
            index[lib] = {"tile": TILE_OVERRIDE.get(lib, 2.0), "source": f"ambientCG · {name} (CC0)", "asset": name}
            print(f"{lib:9} ← ambientCG {name}", flush=True)
            continue
        info = api(f"info/{asset}")
        files = api(f"files/{asset}")
        tile = TILE_OVERRIDE.get(lib) or round(info.get("dimensions", [2000, 2000])[0] / 1000, 3)
        src = {m: Image.open(io.BytesIO(get(files[m]["2k"]["jpg"]["url"]))) for m in ("Diffuse", "nor_gl", "arm")}
        arm = src["arm"].convert("RGB")
        r, g, b = arm.split()
        albedo = prepare_albedo(src["Diffuse"], r, mode, keep)
        rm = Image.merge("RGB", (Image.new("L", arm.size, 255), g, b))
        normal = src["nor_gl"].convert("RGB")
        save(lib, albedo, normal, rm)
        index[lib] = {"tile": tile, "source": f"Poly Haven · {info.get('name', asset)} (CC0)", "asset": asset}
        print(f"{lib:9} ← {asset:24} {tile} m", flush=True)
    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=1, ensure_ascii=False)
        f.write("\n")
    total = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(OUT) for fn in fns)
    print(f"{len(index)} materiales, {total / 1048576:.1f} MB → {OUT}")


if __name__ == "__main__":
    sys.exit(main())
