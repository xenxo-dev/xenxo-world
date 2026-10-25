"""
Cielo de día: descarga un HDRI CC0 de Poly Haven, lo pasa a una imagen web (WebP con tono
ya aplicado) y localiza el sol para que la luz de la escena coincida con el cielo.

  python3 tools/materials/sky.py

Salida: apps/web/public/sky/day.webp y apps/web/src/world/sky-day.json.
"""
from __future__ import annotations

import json
import math
import os
import urllib.request

import numpy as np
from PIL import Image

import bpy  # noqa: E402  (solo para leer el .hdr)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ASSET = "kloofendal_48d_partly_cloudy_puresky"
OUT_IMG = os.path.join(ROOT, "apps", "web", "public", "sky", "day.webp")
OUT_META = os.path.join(ROOT, "apps", "web", "src", "world", "sky-day.json")
CACHE = os.path.join(ROOT, "tools", "materials", ".cache")
UA = {"User-Agent": "xenxo-forge/1.0 (+https://github.com/xenxo-dev/xenxo-world)"}


def main() -> None:
    os.makedirs(CACHE, exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(f"https://api.polyhaven.com/files/{ASSET}", headers=UA), timeout=60) as r:
        files = json.load(r)
    url = files["hdri"]["2k"]["hdr"]["url"]
    path = os.path.join(CACHE, os.path.basename(url))
    if not os.path.exists(path):
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
            open(path, "wb").write(r.read())

    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(h, w, 4)[::-1, :, :3]  # Blender guarda de abajo arriba

    # Sol: el píxel más brillante (en la mitad superior).
    lum = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    y, x = np.unravel_index(np.argmax(lum[: h // 2]), lum[: h // 2].shape)
    azimuth = (x / w) * 2 * math.pi  # 0 = centro de la imagen hacia -Z en three.js (ver Sky.tsx)
    elevation = (0.5 - y / h) * math.pi

    # Tono: exposición y curva ACES aproximada; el sol queda en blanco, las nubes con detalle.
    exposure = 0.9
    c = rgb * exposure
    a, b, cc, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    c = np.clip((c * (a * c + b)) / (c * (cc * c + d) + e), 0, 1)
    c = np.power(c, 1 / 2.2)
    out = Image.fromarray((c * 255).astype(np.uint8), "RGB").resize((2048, 1024), Image.LANCZOS)
    os.makedirs(os.path.dirname(OUT_IMG), exist_ok=True)
    out.save(OUT_IMG, "WEBP", quality=84, method=6)
    meta = {
        "source": f"Poly Haven · {ASSET} (CC0)",
        "sunU": round(float(x / w), 4),
        "sunV": round(float(y / h), 4),
        "sunElevationDeg": round(math.degrees(elevation), 2),
    }
    with open(OUT_META, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
        f.write("\n")
    print(meta, os.path.getsize(OUT_IMG) // 1024, "KB")


if __name__ == "__main__":
    main()
