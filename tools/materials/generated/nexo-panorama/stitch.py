"""
Une los tres paneles del fondo del nexo (generados con IA, ver meta.json) en una franja que da la
vuelta entera sin costuras: cada panel funde con el siguiente (y el último con el primero) y se
alinean sus horizontes. Saca WebP de 8192 px (escritorio) y 4096 px (gafas y móvil).

  python3 tools/materials/generated/nexo-panorama/stitch.py
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
OUT = os.path.join(ROOT, "apps", "web", "public", "sky")
BLEND = 0.12  # parte de cada panel que se funde con el vecino


def horizon(a: np.ndarray) -> int:
    """Fila del horizonte: donde más cambia el brillo medio entre el 35 % y el 65 % de la altura."""
    lum = a[..., :3].mean(axis=(1, 2))
    h = len(lum)
    lo, hi = int(h * 0.35), int(h * 0.65)
    grad = np.abs(np.diff(np.convolve(lum, np.ones(9) / 9, mode="same")))
    return lo + int(np.argmax(grad[lo:hi]))


def strip(names: list[str]) -> Image.Image:
    panels = [np.asarray(Image.open(os.path.join(HERE, n)).convert("RGB")).astype(np.float32) for n in names]
    hs = [horizon(p) for p in panels]
    target = int(np.median(hs))
    h = panels[0].shape[0]
    # Alinear horizontes: desplazar cada panel en vertical y quedarse con las filas que no dieron la vuelta.
    shift = [target - x for x in hs]
    r0 = max(0, max(shift))
    r1 = h + min(0, min(shift))
    # Y recorte simétrico: el horizonte queda justo en el medio (lo que espera el cliente).
    m = min(target - r0, r1 - target)
    aligned = [np.roll(p, s, axis=0)[target - m : target + m] for p, s in zip(panels, shift)]
    w = aligned[0].shape[1]
    b = int(w * BLEND)
    ramp = np.linspace(0.0, 1.0, b, dtype=np.float32)[None, :, None]
    parts = []
    n = len(aligned)
    for i, a in enumerate(aligned):
        prev = aligned[(i - 1) % n]
        # Zona de unión: final del anterior → principio de este.
        parts.append(prev[:, w - b :] * (1 - ramp) + a[:, :b] * ramp)
        parts.append(a[:, b : w - b])
    out = np.concatenate(parts, axis=1)
    print(f"horizontes {hs} → {target}; franja {out.shape[1]}×{out.shape[0]}")
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for mode in ("night", "day"):
        names = [f"{mode}-{k}.webp" for k in "abc"]
        if not all(os.path.exists(os.path.join(HERE, n)) for n in names):
            print(f"faltan los paneles de {mode}")
            continue
        im = strip(names)
        for width in (8192, 4096):
            h = round(im.height * width / im.width)
            path = os.path.join(OUT, f"nexo-{mode}-{width // 1024}k.webp")
            im.resize((width, h), Image.LANCZOS).save(path, "WEBP", quality=82, method=6)
            print(path, os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()
