"""Qué caracteres tiene cada fuente empaquetada de los textos 3D (apps/web/src/world/font-coverage.ts).

Con esto font.ts elige, para cada texto, una fuente que lo cubra y cambia por «?» lo que ninguna
cubre: así troika nunca pide una fuente a un CDN. Si cambias las fuentes de world/font.ts, vuelve
a ejecutarlo: python3 tools/fonts/coverage.py (necesita fontTools).
"""
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
FILES = ROOT / "node_modules/@fontsource"
FONTS = {
    "interLatin": "inter/files/inter-latin-600-normal.woff",
    "spaceGrotesk": "space-grotesk/files/space-grotesk-latin-700-normal.woff",
    "tiltNeon": "tilt-neon/files/tilt-neon-latin-400-normal.woff",
    "interLatinExt": "inter/files/inter-latin-ext-600-normal.woff",
    "interCyrillic": "inter/files/inter-cyrillic-600-normal.woff",
    "interCyrillicExt": "inter/files/inter-cyrillic-ext-600-normal.woff",
    "interGreek": "inter/files/inter-greek-600-normal.woff",
    "interGreekExt": "inter/files/inter-greek-ext-600-normal.woff",
    "interVietnamese": "inter/files/inter-vietnamese-600-normal.woff",
}


def ranges(cps):
    s = sorted(cps)
    out = []
    for c in s:
        if out and c == out[-1][1] + 1:
            out[-1][1] = c
        else:
            out.append([c, c])
    return [v for r in out for v in r]


lines = [
    "// Generado por tools/fonts/coverage.py: no lo edites a mano.",
    "// Caracteres de cada fuente empaquetada, como pares [desde, hasta, desde, hasta…].",
    "export const COVERAGE = {",
]
for name, rel in FONTS.items():
    cmap = TTFont(FILES / rel).getBestCmap()
    lines.append(f"  {name}: [{','.join(map(str, ranges(cmap.keys())))}],")
lines.append("} as const;")
lines.append("")
(ROOT / "apps/web/src/world/font-coverage.ts").write_text("\n".join(lines), encoding="utf8")
print("ok")
