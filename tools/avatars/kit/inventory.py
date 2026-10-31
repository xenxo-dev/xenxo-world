"""Inventario de las piezas de MakeHuman instaladas en MPFB: licencia, autor, etiquetas y tamaño.

Uso: python3 tools/avatars/kit/inventory.py > /tmp/inv.json
"""
import glob
import json
import os
import re
import sys

DATA = os.path.expanduser("~/.config/blender/5.2/extensions/.user/user_default/mpfb/data")


def license_of(text: str) -> str:
    head = text[:2500].lower()
    if "cc0" in head:
        return "CC0"
    if "cc-by" in head or "cc by" in head or "attribution" in head:
        return "CC-BY"
    if "agpl" in head:
        return "AGPL"
    return "?"


def obj_size(path: str) -> tuple[int, int]:
    v = f = 0
    with open(path, errors="ignore") as fh:
        for line in fh:
            if line.startswith("v "):
                v += 1
            elif line.startswith("f "):
                n = len(line.split()) - 1
                f += n - 2
    return v, f


out = []
for kind in ("hair", "clothes", "eyebrows", "eyelashes", "proxymeshes"):
    for path in sorted(glob.glob(f"{DATA}/{kind}/*/*.mhclo") + glob.glob(f"{DATA}/{kind}/*/*.proxy")):
        text = open(path, errors="ignore").read()
        meta = {}
        tags = []
        for line in text.splitlines():
            m = re.match(r"^(\w+)\s+(.*)$", line)
            if not m:
                continue
            k, v = m.group(1), m.group(2).strip()
            if k == "tag":
                tags.append(v.lower())
            elif k in ("name", "obj_file", "material", "z_depth", "author", "license", "uuid"):
                meta[k] = v
        lic = meta.get("license") or license_of(text)
        objp = os.path.join(os.path.dirname(path), meta.get("obj_file", ""))
        v, f = obj_size(objp) if os.path.isfile(objp) else (0, 0)
        out.append({
            "kind": kind, "dir": os.path.basename(os.path.dirname(path)), "name": meta.get("name"),
            "license": lic, "author": meta.get("author", ""), "tags": tags, "verts": v, "tris": f,
            "z_depth": int(meta.get("z_depth", "0") or 0), "deletes": "delete_verts" in text,
        })
json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
