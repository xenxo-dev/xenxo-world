"""
Iconos de la app (PWA) a partir del mismo dibujo que favicon.svg: una X neón sobre noche.
Se generan, no se editan:

  python3 tools/icons/make.py
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "apps", "web", "public", "icons")
BG = (11, 13, 31)
NEON = (34, 211, 238)
SS = 4  # supermuestreo para bordes suaves


def draw(size: int, *, rounded: bool, inset: float) -> Image.Image:
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(s * 0.25) if rounded else 0
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=radius, fill=BG + (255,))
    # Resplandor suave detrás de la X
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    a, b = s * inset, s * (1 - inset)
    w = int(s * 0.125)
    for p, q in (((a, a), (b, b)), ((b, a), (a, b))):
        g.line((p, q), fill=NEON + (150,), width=int(w * 1.9))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.05))
    img.alpha_composite(glow)
    if rounded:  # que el resplandor no salga de las esquinas redondeadas
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=radius, fill=255)
        img.putalpha(Image.composite(img.getchannel("A"), Image.new("L", (s, s), 0), mask))
    d = ImageDraw.Draw(img)
    for p, q in (((a, a), (b, b)), ((b, a), (a, b))):
        d.line((p, q), fill=NEON + (255,), width=w)
        for c in (p, q):  # puntas redondas
            d.ellipse((c[0] - w / 2, c[1] - w / 2, c[0] + w / 2, c[1] + w / 2), fill=NEON + (255,))
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    out = {
        "icon-192.png": draw(192, rounded=True, inset=0.28),
        "icon-512.png": draw(512, rounded=True, inset=0.28),
        # Maskable: a sangre, con la X dentro de la zona segura (el sistema recorta la forma).
        "icon-maskable-512.png": draw(512, rounded=False, inset=0.34),
        # iOS redondea solo y no admite transparencia.
        "apple-touch-icon.png": draw(180, rounded=False, inset=0.3).convert("RGB"),
    }
    for name, im in out.items():
        path = os.path.join(OUT, name)
        im.save(path, optimize=True)
        print(path, os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()
