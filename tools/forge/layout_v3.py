"""
Disposición v3 de los distritos (256 × 256 m): escribe `bounds`, `city`, `roads`, `gate`, `spawn`,
`parcel` y la lista de 64 parcelas en apps/realtime/src/districts.json. Se ejecuta a mano una vez
(python3 tools/forge/layout_v3.py); después districts.json es la única fuente, como siempre.

Coordenadas del chunk (X este, Z sur, metros); el centro de la ciudad es (32, 32).
  - Ciudad: 100 × 100 m en el centro, 3 × 3 manzanas de 26 m con calles de 11 m; la del medio es
    la plaza (monumento y sitio para actividades).
  - Anillo 1 (10 m) alrededor de la ciudad; fila 1 de parcelas (15 × 15) mirando a él.
  - Anillo 2 (12 m) más fuera; fila 2 de parcelas mirando a él.
  - Cuatro avenidas (12 m) del centro a los bordes; la del sur lleva a la puerta del nexo.
  - Lo que queda hasta el borde (26 m por lado) es para actividades y para el horizonte.
"""
import json
import os
from collections import OrderedDict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PATH = os.path.join(ROOT, "apps", "realtime", "src", "districts.json")
C = 32.0


def mirror(v):
    return round(2 * C - v, 2)


def segment(a, b, n):
    pitch = (b - a) / n
    return [round(a + pitch * (i + 0.5), 2) for i in range(n)]


def main():
    d = json.load(open(PATH, encoding="utf-8"), object_pairs_hook=OrderedDict)
    row1 = segment(-28, 24.5, 3) + segment(39.5, 92, 3)          # 6 por lado
    row2 = segment(-55, 24.5, 5) + segment(39.5, 119, 5)         # 10 por lado
    z1, z2 = -35.5, -62.5                                        # norte, filas 1 y 2
    parcels = []
    def add(side, i, x, z, facing):
        parcels.append(OrderedDict([("id", f"{side}{i}"), ("x", x), ("z", z), ("facing", facing)]))
    for side, facing in (("N", 0), ("S", 180), ("W", 90), ("E", 270)):
        for k, (row, depth) in enumerate(((row1, z1), (row2, z2))):
            for j, along in enumerate(row):
                i = j + 1 + (0 if k == 0 else len(row1))
                if side == "N":
                    add(side, i, along, depth, facing)
                elif side == "S":
                    add(side, i, along, mirror(depth), facing)
                elif side == "W":
                    add(side, i, depth, along, facing)
                else:
                    add(side, i, mirror(depth), along, facing)
    out = OrderedDict()
    for k, v in d.items():
        if k in ("parcels", "districts", "$comment"):
            continue
    out["$comment"] = (
        "Distritos y su plantilla (coordenadas del chunk: X este, Z sur, metros). La usan el servidor (districts.ts), "
        "la forja (tools/forge/district.py y city.py) y la web (por GET /districts). Disposición v3 (tools/forge/layout_v3.py): "
        "256 × 256 m (`bounds`), más grande que su chunk. En el centro, la ciudad (`city`: 3 × 3 manzanas, la del medio es la plaza); "
        "alrededor, dos anillos de calles (`roads`) con 64 parcelas de 15 × 15 m mirando a ellos (N, S, E y W: fila 1 del 1 al 6, "
        "fila 2 del 7 al 16) y cuatro avenidas; al sur, la puerta del nexo. Si cambias algo, vuelve a forjar (npm run forge:districts) "
        "y sube DISTRICT_SEED_VERSION; si mueves parcelas, añade su migración (districts.ts)."
    )
    out["parcel"] = OrderedDict([("w", 15), ("d", 15), ("frame_back", 3)])
    out["bounds"] = [-96, 160]
    out["city"] = OrderedDict([("x0", -18), ("z0", -18), ("x1", 82), ("z1", 82), ("block", 26), ("street", 11), ("plaza", 9)])
    out["roads"] = OrderedDict([("ring1", [-28, -18]), ("ring2", [-55, -43]), ("avenue", 12)])
    out["gate"] = OrderedDict([("z", 156), ("span", 8)])
    out["spawn"] = [32, 0, 150]
    out["parcels"] = parcels
    out["districts"] = d["districts"]
    open(PATH, "w", encoding="utf-8").write(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(len(parcels), "parcelas")


if __name__ == "__main__":
    main()
