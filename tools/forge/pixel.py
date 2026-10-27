"""
Píxel, la ciudad de 8 bits (diseño de detalle; ver «Propuestas: las 4 ciudades de xenxo»).

La plaza es **la plaza tablero**: una cuadrícula de 8 × 8 baldosas de 3 m (tiles@1). El suelo y las
juntas de luz son de la forja; lo que se enciende en cada ronda lo dibuja el cliente encima. Sobre
el centro flota el **corazón de píxeles** gigante, que se ve desde todo el distrito. Alrededor, las
máquinas-portal a los juegos 2D y los dos marcadores (puntos del día y sprites encontrados).

Todo en coordenadas del chunk (X este, Z sur). Las colisiones salen de aquí (`colliders`).
"""
from __future__ import annotations

from kit import CHUNK, Part, finish, mat

C = CHUNK / 2
CX = CZ = 32.0
COLS = ROWS = 8
TILE = 3.0
HEART_Y = 13.0   # altura del corazón flotante
HEART_PX = 1.1   # lado de cada píxel del corazón
TINTS = ["#ff4fd8", "#4fa3ff", "#ffd54f", "#6dff8a", "#ff7a45", "#a26bff"]


def _box(p: Part, x0, z0, x1, z1, y0, y1, m):
    p.box((x0 - C, -(z1 - C), y0), (x1 - C, -(z0 - C), y1), m)


def board(p: Part, detail: int) -> None:
    """Tablero: losas oscuras ligeramente elevadas y juntas de luz entre ellas."""
    w = COLS * TILE
    x0, z0 = CX - w / 2, CZ - w / 2
    slab = mat("azulejo", "#1d2033")
    _box(p, x0 - 0.4, z0 - 0.4, x0 + w + 0.4, z0 + w + 0.4, 0, 0.04, mat("metal", "#14161f"))
    gap = 0.12
    for r in range(ROWS):
        for c in range(COLS):
            a, b = x0 + c * TILE + gap, z0 + r * TILE + gap
            _box(p, a, b, a + TILE - 2 * gap, b + TILE - 2 * gap, 0.04, 0.08, slab)
    # Marco de luz del tablero (blanco cálido) y un filo de color por lado.
    line = mat("neon", "#cfe8ff")
    t = 0.08
    for k in range(COLS + 1):
        x = x0 + k * TILE
        _box(p, x - t / 2, z0, x + t / 2, z0 + w, 0.04, 0.06, line)
    for k in range(ROWS + 1):
        z = z0 + k * TILE
        _box(p, x0, z - t / 2, x0 + w, z + t / 2, 0.04, 0.06, line)
    for k, (a0, b0, a1, b1) in enumerate(((x0 - 0.4, z0 - 0.4, x0 + w + 0.4, z0 - 0.2), (x0 - 0.4, z0 + w + 0.2, x0 + w + 0.4, z0 + w + 0.4),
                                         (x0 - 0.4, z0 - 0.4, x0 - 0.2, z0 + w + 0.4), (x0 + w + 0.2, z0 - 0.4, x0 + w + 0.4, z0 + w + 0.4))):
        _box(p, a0, b0, a1, b1, 0.04, 0.1, mat("neon", TINTS[k]))


def heart(p: Part, detail: int) -> None:
    """Corazón de píxeles gigante flotando sobre el centro, con su sombra de luz en el tablero."""
    rows = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"]
    s = HEART_PX
    red = mat("neon", "#ff4f6d")
    dark = mat("metal", "#2a1020")
    for r, line in enumerate(rows):
        for c, ch in enumerate(line):
            if ch != "1":
                continue
            x = CX + (c - 3.5) * s
            y = HEART_Y + (len(rows) - 1 - r) * s
            # Cara de luz y canto oscuro (se lee como píxel y no como bloque plano).
            _box(p, x, CZ - 0.5, x + s, CZ + 0.5, y, y + s, dark)
            _box(p, x + 0.06, CZ - 0.56, x + s - 0.06, CZ + 0.56, y + 0.06, y + s - 0.06, red)
    # Mástil fino de luz hasta el tablero (para que «flote» atado a la plaza).
    _box(p, CX - 0.06, CZ - 0.06, CX + 0.06, CZ + 0.06, 0.08, HEART_Y, mat("neon", "#ff4f6d"))


def colliders() -> list[list[float]]:
    return []


def build(p: Part, detail: int) -> None:
    board(p, detail)
    heart(p, detail)


# --------------------------------------------------------------------------------------
# Sprites de la búsqueda: piezas de vóxeles pequeñas (giran y flotan en el cliente)
# --------------------------------------------------------------------------------------

SPRITES = {
    "gem": (["..##..", ".####.", "######", ".####.", "..##.."], "#4fe3ff"),
    "star": (["..#..", ".###.", "#####", ".###.", "#...#"], "#ffd54f"),
    "heart": (["##.##", "#####", ".###.", "..#.."], "#ff4f6d"),
    "key": (["##...", "#.###", "##..#"], "#a26bff"),
}


def sprite(kind: str, detail: int) -> Part:
    rows, color = SPRITES[kind]
    p = Part(f"pixel_sprite_{kind}")
    s = 0.16
    face, edge = mat("neon", color), mat("metal", "#1b1f2e")
    h = len(rows)
    w = max(len(r) for r in rows)
    for r, line in enumerate(rows):
        for c, ch in enumerate(line):
            if ch != "#":
                continue
            x = (c - w / 2) * s
            z = (h / 2 - r - 1) * s
            p.box((x, -0.05, z), (x + s, 0.05, z + s), edge)
            p.box((x + 0.015, -0.065, z + 0.015), (x + s - 0.015, 0.065, z + s - 0.015), face)
    return p


def sprite_object(kind: str):
    def make(detail: int):
        ob = sprite(kind, detail).to_object()
        ob.name = f"pixel_sprite_{kind}"
        finish(ob)
        return ob
    return make
