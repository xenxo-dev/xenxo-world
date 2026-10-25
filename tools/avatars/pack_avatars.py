"""
Empaqueta los avatares de la forja para la web:
  - texturas PNG → WebP (con transparencia solo donde hace falta),
  - comprueba el presupuesto de avatar (triángulos, tamaño, texturas),
  - los guarda por hash en apps/realtime/seed-assets/ (el servidor los sirve tal cual),
  - y escribe el catálogo en apps/web/src/world/avatar-presets.json.

Reescribe el GLB a mano para no perder las extensiones VRM (VRMC_*).

  python3 tools/avatars/pack_avatars.py [carpeta-de-la-forja]
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import struct
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, "tools", "avatars", "out")
DEST = os.path.join(ROOT, "apps", "realtime", "seed-assets")
CATALOG = os.path.join(ROOT, "apps", "web", "src", "world", "avatar-presets.json")
INDEX_TS = os.path.join(ROOT, "apps", "realtime", "src", "avatar-presets.ts")

MAX_BYTES = 4 * 1024 * 1024
MAX_TRIS = 30_000
MAX_TEX = 1024


def read_glb(data: bytes):
    magic, version, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "no es un GLB"
    off = 12
    j = None
    b = b""
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8 : off + 8 + clen]
        if ctype == 0x4E4F534A:
            j = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            b = bytes(chunk)
        off += 8 + clen
    return j, b


def write_glb(j: dict, b: bytes) -> bytes:
    js = json.dumps(j, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    b += b"\0" * ((4 - len(b) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(b)
    return struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(b), 0x004E4942) + b


def view_bytes(j, b, idx):
    v = j["bufferViews"][idx]
    o = v.get("byteOffset", 0)
    return b[o : o + v["byteLength"]]


def triangles(j) -> int:
    n = 0
    for m in j.get("meshes", []):
        for p in m["primitives"]:
            if p.get("mode", 4) != 4:
                continue
            if "indices" in p:
                n += j["accessors"][p["indices"]]["count"] // 3
            else:
                n += j["accessors"][p["attributes"]["POSITION"]]["count"] // 3
    return n


def repack(data: bytes) -> tuple[bytes, dict]:
    j, b = read_glb(data)
    views = [view_bytes(j, b, i) for i in range(len(j["bufferViews"]))]
    max_tex = 0
    alpha_images = set()
    for ii, img in enumerate(j.get("images", [])):
        if "bufferView" not in img:
            raise ValueError("imagen externa: no permitida")
        raw = views[img["bufferView"]]
        im = Image.open(io.BytesIO(raw))
        im.load()
        max_tex = max(max_tex, *im.size)
        has_alpha = im.mode in ("RGBA", "LA") and im.getchannel("A").getextrema()[0] < 250
        if has_alpha:
            alpha_images.add(ii)
        out = io.BytesIO()
        if has_alpha:
            im.convert("RGBA").save(out, "WEBP", quality=85, method=6)
        else:
            im.convert("RGB").save(out, "WEBP", quality=85, method=6)
        views[img["bufferView"]] = out.getvalue()
        img["mimeType"] = "image/webp"
    # Transparencias: el exportador lo marca todo como BLEND, y eso desordena el dibujo (cara, ropa…).
    # Opaco salvo lo que de verdad tiene alfa: cejas y pestañas mezclan, el pelo recorta.
    textures = j.get("textures", [])
    for m in j.get("materials", []):
        tex = m.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        src = textures[tex["index"]].get("source") if tex is not None else None
        name = m.get("name", "").lower()
        if src is not None and src in alpha_images:
            if "eyebrow" in name or "eyelash" in name:
                m["alphaMode"] = "BLEND"
            else:
                m["alphaMode"] = "MASK"
                m["alphaCutoff"] = 0.4
            m["doubleSided"] = True
        else:
            m.pop("alphaMode", None)
            m.pop("alphaCutoff", None)
            m["doubleSided"] = False
    for t in j.get("textures", []):
        if "source" in t:
            src = t.pop("source")
            t.setdefault("extensions", {})["EXT_texture_webp"] = {"source": src}
    if j.get("images"):
        for key in ("extensionsUsed", "extensionsRequired"):
            lst = j.setdefault(key, [])
            if "EXT_texture_webp" not in lst:
                lst.append("EXT_texture_webp")
    # Reconstruir el buffer con las vistas nuevas (alineadas a 4 bytes)
    blob = bytearray()
    for i, v in enumerate(j["bufferViews"]):
        while len(blob) % 4:
            blob.append(0)
        v["byteOffset"] = len(blob)
        v["byteLength"] = len(views[i])
        v["buffer"] = 0
        blob += views[i]
    j["buffers"] = [{"byteLength": len(blob)}]
    out = write_glb(j, bytes(blob))
    return out, {"tris": triangles(j), "max_tex": max_tex, "bytes": len(out)}


def main() -> None:
    os.makedirs(DEST, exist_ok=True)
    # Borra los avatares de la tanda anterior (la carpeta la comparten con los modelos de la plaza).
    if os.path.exists(CATALOG):
        for old in json.load(open(CATALOG, encoding="utf-8")):
            path = os.path.join(DEST, f"{old['hash'][7:]}.glb")
            if os.path.exists(path):
                os.remove(path)
    meta = json.load(open(os.path.join(SRC, "avatars.json"), encoding="utf-8"))
    catalog = []
    for aid, info in meta.items():
        data = open(os.path.join(SRC, f"{aid}.vrm"), "rb").read()
        packed, st = repack(data)
        problems = []
        if st["tris"] > MAX_TRIS:
            problems.append(f"{st['tris']} triángulos > {MAX_TRIS}")
        if st["bytes"] > MAX_BYTES:
            problems.append(f"{st['bytes']} bytes > {MAX_BYTES}")
        if st["max_tex"] > MAX_TEX:
            problems.append(f"textura de {st['max_tex']} px > {MAX_TEX}")
        if problems:
            raise SystemExit(f"{aid}: fuera de presupuesto: {', '.join(problems)}")
        h = hashlib.sha256(packed).hexdigest()
        open(os.path.join(DEST, f"{h}.glb"), "wb").write(packed)
        catalog.append({"id": aid, "name": info["name"], "hash": f"sha256:{h}", "format": "vrm", "tris": st["tris"], "bytes": st["bytes"]})
        print(f"{aid:6} {st['tris']:6} tri  {st['bytes'] // 1024:5} KB (antes {len(data) // 1024} KB)")
    # Retratos para el selector del panel
    thumbs = os.path.join(ROOT, "apps", "web", "public", "avatars")
    os.makedirs(thumbs, exist_ok=True)
    for c in catalog:
        src = os.path.join(SRC, f"{c['id']}.portrait.png")
        if os.path.exists(src):
            Image.open(src).convert("RGBA").resize((192, 192), Image.LANCZOS).save(os.path.join(thumbs, f"{c['id']}.webp"), "WEBP", quality=86, method=6)
    with open(CATALOG, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=1, ensure_ascii=False)
        f.write("\n")
    lines = [
        "// Generado por tools/avatars/pack_avatars.py. No lo edites a mano.",
        "",
        "/** Avatares de serie (VRM servidos como recursos estáticos, por hash). */",
        "export const AVATAR_PRESETS: { id: string; name: string; hash: string; format: \"vrm\" }[] = [",
        *[f"  {{ id: {json.dumps(c['id'])}, name: {json.dumps(c['name'])}, hash: {json.dumps(c['hash'])}, format: \"vrm\" }}," for c in catalog],
        "];",
        "",
    ]
    open(INDEX_TS, "w", encoding="utf-8").write("\n".join(lines))


if __name__ == "__main__":
    main()
