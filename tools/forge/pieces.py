"""Catálogo de piezas de la plaza: nombre → constructor."""
import json
import os

import tower
import townhouse

LAYOUT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "realtime", "src", "plaza-layout.json")


def layout() -> dict:
    with open(LAYOUT_PATH, encoding="utf-8") as f:
        return json.load(f)


def build(what: str, detail: int = 1):
    kind, _, name = what.partition(":")
    if kind == "townhouse":
        spec = next(b for b in layout()["buildings"] if b["id"] == name)
        return townhouse.build(spec, detail)
    if kind == "tower":
        return tower.build(layout()["tower"], detail)
    raise ValueError(f"pieza desconocida: {what}")
