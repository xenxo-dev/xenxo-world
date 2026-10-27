"""
Instala una foto como portada del sistema (la de la plaza en el nexo):
  - WebP 1280×720 en apps/realtime/seed-assets/s/<sha256>.webp (la sirve el Worker como recurso estático),
  - copia en apps/web/public/covers/plaza.webp (tarjeta del nexo 2D),
  - índice en apps/realtime/src/seed-covers.ts.

  python3 tools/covers/install.py <foto.png> [nombre=plaza]
"""
import hashlib
import io
import os
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
src = sys.argv[1]
name = sys.argv[2] if len(sys.argv) > 2 else "plaza"

im = Image.open(src).convert("RGB")
w, h = im.size
tw, th = (w, round(w * 9 / 16)) if w / h < 16 / 9 else (round(h * 16 / 9), h)
im = im.crop(((w - tw) // 2, (h - th) // 2, (w - tw) // 2 + tw, (h - th) // 2 + th)).resize((1280, 720), Image.LANCZOS)
for q in (82, 74, 66, 58):
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=q, method=6)
    data = buf.getvalue()
    if len(data) <= 300 * 1024:
        break
digest = hashlib.sha256(data).hexdigest()

seed_dir = os.path.join(ROOT, "apps", "realtime", "seed-assets", "s")
index = os.path.join(ROOT, "apps", "realtime", "src", "seed-covers.ts")
covers = {}
if os.path.exists(index):
    for line in open(index, encoding="utf-8"):
        line = line.strip()
        if line.startswith('"') and "sha256:" in line:
            k, v = line.rstrip(",").split(":", 1)
            covers[k.strip('"')] = v.strip().strip('"')
old = covers.get(name)
if old and old != f"sha256:{digest}":
    try:
        os.remove(os.path.join(seed_dir, old[7:] + ".webp"))
    except FileNotFoundError:
        pass
covers[name] = f"sha256:{digest}"
with open(os.path.join(seed_dir, f"{digest}.webp"), "wb") as f:
    f.write(data)
web = os.path.join(ROOT, "apps", "web", "public", "covers")
os.makedirs(web, exist_ok=True)
with open(os.path.join(web, f"{name}.webp"), "wb") as f:
    f.write(data)
lines = [
    "// Generado por tools/covers/install.py. No lo edites a mano.",
    "// Portadas del sistema (WebP en apps/realtime/seed-assets/s/<hash>.webp).",
    "",
    "export const SEED_COVERS: Record<string, string> = {",
    *[f'  "{k}": "{v}",' for k, v in sorted(covers.items())],
    "};",
    "",
]
with open(index, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print(f"{name}: sha256:{digest} ({len(data) // 1024} KB)")
