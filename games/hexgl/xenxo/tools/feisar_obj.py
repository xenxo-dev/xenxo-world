"""
Convierte la nave de HexGL (geometries/ships/feisar/feisar.js, formato JSON 3.1 de three.js) a OBJ,
para hacer el monumento GLB de xenxo con Blender (ver monumento.py).

  python3 xenxo/tools/feisar_obj.py  → xenxo/tools/out/feisar.obj
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "out")


def main() -> None:
    d = json.load(open(os.path.join(GAME, "geometries", "ships", "feisar", "feisar.js")))
    v, n, f = d["vertices"], d["normals"], d["faces"]
    uv = d["uvs"][0] if d["uvs"] else []
    layers = len([u for u in d["uvs"] if u])
    os.makedirs(OUT, exist_ok=True)
    lines = ["# HexGL Feisar (MIT, Thibaut Despoulain), convertido para xenxo"]
    lines += [f"v {v[i]:.5f} {v[i + 1]:.5f} {v[i + 2]:.5f}" for i in range(0, len(v), 3)]
    lines += [f"vt {uv[i]:.5f} {uv[i + 1]:.5f}" for i in range(0, len(uv), 2)]
    lines += [f"vn {n[i]:.5f} {n[i + 1]:.5f} {n[i + 2]:.5f}" for i in range(0, len(n), 3)]
    i = 0
    tris = 0
    while i < len(f):
        t = f[i]
        i += 1
        quad, has_mat, face_uv, vert_uv, face_n, vert_n, face_c, vert_c = ((t >> b) & 1 for b in range(8))
        k = 4 if quad else 3
        vi = f[i : i + k]
        i += k
        if has_mat:
            i += 1
        if face_uv:
            i += layers
        ti = None
        if vert_uv:
            ti = f[i : i + k]
            i += k * layers
        if face_n:
            i += 1
        ni = None
        if vert_n:
            ni = f[i : i + k]
            i += k
        if face_c:
            i += 1
        if vert_c:
            i += k
        corner = lambda j: f"{vi[j] + 1}/{'' if ti is None else ti[j] + 1}/{'' if ni is None else ni[j] + 1}"
        lines.append("f " + " ".join(corner(j) for j in range(k)))
        tris += 2 if quad else 1
    open(os.path.join(OUT, "feisar.obj"), "w").write("\n".join(lines) + "\n")
    print(f"{len(v) // 3} vértices, {tris} triángulos → {OUT}/feisar.obj")


if __name__ == "__main__":
    main()
