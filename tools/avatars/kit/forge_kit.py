"""El kit de fundas: lo que el configurador de la web necesita para montar una funda en el navegador.

Hace en Python, una vez, la parte pesada de MakeHuman (MPFB, todo CC0) y deja en
`apps/web/public/fundas/` datos compactos para que el navegador haga lo demás:

- la «jaula»: la malla base de MakeHuman (sin dibujar) en su forma neutra de mujer y de hombre,
  con los ajustes del cuerpo (complexión, músculo, altura, edad) y de la cara (cabeza, mandíbula,
  nariz, ojos, boca, orejas…) como diferencias;
- el esqueleto (`game_engine` de MPFB): cada articulación es la media de unos vértices de la jaula,
  así que se recoloca sola al cambiar el cuerpo; y los pesos de piel de cada vértice;
- las piezas (cuerpo, ojos, cejas, pestañas, pelo, barbas, ropa, calzado, gorros, gafas, guantes):
  su malla con su «atadura» a la jaula (tres vértices, pesos y desplazamiento: el formato mhclo de
  MakeHuman), simplificada al presupuesto de cada categoría, con su textura en WebP y su miniatura;
- las pieles y los ojos (texturas).

Solo entra lo que es CC0 y no imita a nadie (personajes con derechos, marcas, política). Las
piezas se eligen a mano en CATALOG.

Uso: python3 tools/avatars/kit/forge_kit.py            (necesita MPFB instalado: ver ../README.md)
"""
from __future__ import annotations

import gzip
import io
import itertools
import json
import os
import re
import struct
import sys

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "apps", "web", "public", "fundas")
MPFB = "/root/.config/blender/5.2/extensions/user_default/mpfb/data"
if not os.path.isdir(MPFB):
    MPFB = os.path.expanduser("~/.config/blender/5.2/extensions/user_default/mpfb/data")
ASSETS = os.path.expanduser("~/.config/blender/5.2/extensions/.user/user_default/mpfb/data")
TARGETS = f"{MPFB}/targets"

KIT_VERSION = 1
# De decímetros (MakeHuman) a metros.
UNIT = 0.1

# ---------------------------------------------------------------------------------------------
# Lo que entra (todo CC0, comprobado con inventory.py). Textos ES/EN para el configurador.
# cat: body | eyes | brows | lashes | hair | beard | top | bottom | outfit | shoes | hat | glasses
#      | gloves | socks
# tint: "hair" (se tiñe del color de pelo), "cloth" (color propio) o None (tal cual).
# ---------------------------------------------------------------------------------------------
CATALOG: list[dict] = [
    # Cuerpos (uno por base; se simplifican)
    {"id": "body_f", "src": "proxymeshes/female_generic", "cat": "body", "base": "f"},
    {"id": "body_m", "src": "proxymeshes/male_generic", "cat": "body", "base": "m"},
    # Ojos y pestañas
    {"id": "eyes", "src": "eyes/low-poly", "cat": "eyes"},
    {"id": "lashes", "src": "eyelashes/eyelashes01", "cat": "lashes"},
    # Pelo
    *[{"id": f"hair_{n}", "src": f"hair/{d}", "cat": "hair", "tint": "hair", "es": es, "en": en}
      for n, d, es, en in [
          ("short01", "short01", "Corto clásico", "Classic short"),
          ("short02", "short02", "Corto con volumen", "Short volume"),
          ("short03", "short03", "Corto despeinado", "Short tousled"),
          ("short04", "short04", "Rapado", "Buzz"),
          ("messy", "cortu_short_messy_hair", "Revuelto", "Messy"),
          ("shaggy", "cortu_shaggy_green_hair", "Melena corta", "Shaggy"),
          ("bangs", "cortu_straight_bangs", "Liso con flequillo", "Straight bangs"),
          ("afro", "afro01", "Afro", "Afro"),
          ("cloud", "cortu_strawberry_cloud_hair", "Rizos", "Curls"),
          ("pixie", "faydaen_hair_1", "Pixie", "Pixie"),
          ("bob", "bob02", "Bob", "Bob"),
          ("bob_long", "bob01", "Bob largo", "Long bob"),
          ("blunt", "toigo_blunt_bob", "Bob recto", "Blunt bob"),
          ("blunt_bangs", "toigo_blunt_bob_with_bangs", "Bob recto con flequillo", "Blunt bob, bangs"),
          ("curled", "toigo_curled_under_bob", "Bob hacia dentro", "Curled bob"),
          ("inverted", "toigo_inverted_bob", "Bob invertido", "Inverted bob"),
          ("long", "long01", "Largo", "Long"),
          ("ponytail", "ponytail01", "Coleta", "Ponytail"),
          ("braid", "braid01", "Trenza", "Braid"),
      ]],
    # Cejas
    *[{"id": f"brows_{i:02d}", "src": f"eyebrows/eyebrow{i:03d}", "cat": "brows", "tint": "hair"} for i in range(1, 13)],
    # Barba
    {"id": "beard_full", "src": "clothes/rehmanpolanski_beard_viking", "cat": "beard", "tint": "hair", "es": "Barba larga", "en": "Long beard"},
    {"id": "beard_moustache", "src": "clothes/rehmanpolanski_moustache_viking", "cat": "beard", "tint": "hair", "es": "Bigote", "en": "Moustache"},
    # Parte de arriba
    *[{"id": i, "src": f"clothes/{d}", "cat": "top", "tint": "cloth", "es": es, "en": en} for i, d, es, en in [
        ("top_tee", "elvs_crude_t-shirt_male", "Camiseta", "T-shirt"),
        ("top_tee_f", "joepal_crude_t-shirt_female", "Camiseta entallada", "Fitted tee"),
        ("top_tucked", "toigo_basic_tucked_t-shirt", "Camiseta por dentro", "Tucked tee"),
        ("top_polo", "namuhekam_male_polo_shirt", "Polo", "Polo"),
        ("top_sweater", "toigo_fisherman_sweater", "Jersey", "Sweater"),
        ("top_tank", "toigo_keyhole_tank_top", "Camiseta de tirantes", "Tank top"),
        ("top_turtle", "toigo_turtleneck_halter_top", "Cuello alto", "Turtleneck"),
        ("top_bodice", "toigo_bodice-style_top", "Corpiño", "Bodice top"),
        ("top_tunic", "rehmanpolanski_viking_tunic", "Túnica", "Tunic"),
    ]],
    # Parte de abajo
    *[{"id": i, "src": f"clothes/{d}", "cat": "bottom", "tint": "cloth", "es": es, "en": en} for i, d, es, en in [
        ("bot_cargo", "cortu_cargo_pants", "Cargo", "Cargo pants"),
        ("bot_shorts", "cortu_jeans_shorts", "Pantalón corto", "Shorts"),
        ("bot_wool", "toigo_wool_pants", "Pantalón de vestir", "Dress pants"),
        ("bot_harem", "toigo_harem_pants", "Bombacho", "Harem pants"),
        ("bot_viking", "rehmanpolanski_viking_pants", "Pantalón de lino", "Linen pants"),
    ]],
    # Conjuntos (arriba y abajo a la vez)
    *[{"id": i, "src": f"clothes/{d}", "cat": "outfit", "tint": "cloth", "es": es, "en": en} for i, d, es, en in [
        ("fit_casual_m1", "male_casualsuit02", "Informal 1", "Casual 1"),
        ("fit_casual_m2", "male_casualsuit03", "Informal 2", "Casual 2"),
        ("fit_casual_m3", "male_casualsuit04", "Informal 3", "Casual 3"),
        ("fit_casual_m4", "male_casualsuit05", "Informal 4", "Casual 4"),
        ("fit_casual_m5", "male_casualsuit06", "Informal 5", "Casual 5"),
        ("fit_casual_f1", "female_casualsuit01", "Informal 6", "Casual 6"),
        ("fit_casual_f2", "female_casualsuit02", "Informal 7", "Casual 7"),
        ("fit_sport", "female_sportsuit01", "Deporte", "Sport"),
        ("fit_work", "male_worksuit01", "Mono de trabajo", "Work overalls"),
        ("fit_elegant_m", "male_elegantsuit01", "Elegante", "Smart"),
        ("fit_elegant_f", "female_elegantsuit01", "Elegante 2", "Smart 2"),
        ("fit_suit", "toigo_male_double-breasted_suit", "Traje cruzado", "Double-breasted suit"),
        ("fit_suit_f", "toigo_female_double-breasted_suit", "Traje cruzado 2", "Double-breasted suit 2"),
        ("fit_suit3", "toigo_male_suit_3", "Traje", "Suit"),
        ("fit_tie", "toigo_male_suit_tie_and_jacket", "Traje con corbata", "Suit and tie"),
        ("fit_dinner", "toigo_suit_with_dinner_jacket", "Esmoquin", "Dinner jacket"),
        ("fit_cyborg", "joachip_cyborg_suit", "Traje cíborg", "Cyborg suit"),
        ("fit_warrior", "thegreatengineer_galactic_warrior_uniform", "Uniforme estelar", "Star uniform"),
        ("fit_robe", "donitz_monk_robe", "Hábito", "Robe"),
    ]],
    # Calzado
    *[{"id": i, "src": f"clothes/{d}", "cat": "shoes", "tint": "cloth", "es": es, "en": en} for i, d, es, en in [
        ("sh_01", "shoes01", "Zapatillas", "Sneakers"),
        ("sh_02", "shoes02", "Zapatos", "Shoes"),
        ("sh_03", "shoes03", "Deportivas", "Trainers"),
        ("sh_04", "shoes04", "Mocasines", "Loafers"),
        ("sh_05", "shoes05", "Zapato fino", "Dress shoes"),
        ("sh_06", "shoes06", "Bailarinas", "Flats"),
        ("sh_ankle", "toigo_ankle_boots_male", "Botines", "Ankle boots"),
        ("sh_cloth", "toigo_mj_cloth_shoes", "Zapatillas de tela", "Canvas shoes"),
        ("sh_tbar", "cortu_t-bar", "Merceditas", "T-bar shoes"),
        ("sh_boots", "rehmanpolanski_viking_boots", "Botas", "Boots"),
    ]],
    # Gorros
    *[{"id": i, "src": f"clothes/{d}", "cat": "hat", "tint": "cloth", "es": es, "en": en} for i, d, es, en in [
        ("hat_fedora", "fedora01", "Sombrero", "Fedora"),
        ("hat_fedora2", "fedora_cocked", "Sombrero ladeado", "Cocked fedora"),
        ("hat_cloche", "aethelraed_unraed_cloche_hat", "Gorro campana", "Cloche"),
        ("hat_xmas", "joepal_xmas_cap", "Gorro de Navidad", "Christmas hat"),
    ]],
    # Gafas
    *[{"id": i, "src": f"clothes/{d}", "cat": "glasses", "es": es, "en": en} for i, d, es, en in [
        ("gl_01", "spamrakuen_sagerfrogs_glasses_01", "Gafas 1", "Glasses 1"),
        ("gl_02", "spamrakuen_sagerfrogs_glasses_02", "Gafas 2", "Glasses 2"),
        ("gl_03", "spamrakuen_sagerfrogs_glasses_03", "Gafas 3", "Glasses 3"),
        ("gl_04", "spamrakuen_sagerfrogs_glasses_04", "Gafas 4", "Glasses 4"),
        ("gl_frames", "spamrakuen_tbm_glasses_frames_01", "Montura fina", "Thin frames"),
        ("gl_round", "toigo_round_glasses_leopard", "Redondas", "Round"),
    ]],
    # Guantes
    *[{"id": i, "src": f"clothes/{d}", "cat": "gloves", "tint": "cloth", "es": es, "en": en} for i, d, es, en in [
        ("gv_short", "toigo_gloves_short", "Guantes", "Gloves"),
        ("gv_medium", "toigo_gloves_medium", "Guantes medios", "Mid gloves"),
        ("gv_long", "toigo_gloves_long", "Guantes largos", "Long gloves"),
    ]],
]

# Triángulos como mucho por categoría (la funda entera no pasa de 30.000: ASSET_BUDGETS).
BUDGET = {"body": 11000, "hair": 4500, "beard": 2600, "top": 4200, "bottom": 2600, "outfit": 6500,
          "shoes": 1600, "hat": 1400, "glasses": 1100, "gloves": 1400, "eyes": 2000, "brows": 400, "lashes": 600}
TEX = {"body": 1024, "hair": 512, "outfit": 512, "top": 512, "bottom": 512}
TEX_DEFAULT = 256

# Ajustes del cuerpo: (id, variable de MakeHuman, valor en -1, valor en +1). El neutro es 0,5.
BODY_SLIDERS = [
    ("weight", "weight", 0.1, 0.9),
    ("muscle", "muscle", 0.0, 1.0),
    ("height", "height", 0.2, 0.8),  # MakeHuman llega a 2,3 m: aquí, de ~1,50 a ~1,95
    ("proportions", "proportions", 0.0, 1.0),
    ("age", "age", 0.5, 0.875),  # 25 → 55 años (nunca menos de 25)
]
# Ajustes de la cara: (id, objetivo para −1, objetivo para +1). Los de un lado se suman al otro.
FACE_SLIDERS = [
    ("head_width", "head/head-scale-horiz-decr", "head/head-scale-horiz-incr"),
    ("head_height", "head/head-scale-vert-decr", "head/head-scale-vert-incr"),
    ("head_depth", "head/head-scale-depth-decr", "head/head-scale-depth-incr"),
    ("head_fat", "head/head-fat-decr", "head/head-fat-incr"),
    ("head_round", "head/head-square", "head/head-round"),
    ("head_oval", "head/head-triangular", "head/head-oval"),
    ("forehead", "forehead/forehead-scale-vert-decr", "forehead/forehead-scale-vert-incr"),
    ("forehead_slope", "forehead/forehead-trans-backward", "forehead/forehead-trans-forward"),
    ("brow_height", "eyebrows/eyebrows-trans-down", "eyebrows/eyebrows-trans-up"),
    ("brow_angle", "eyebrows/eyebrows-angle-down", "eyebrows/eyebrows-angle-up"),
    ("eye_size", "eyes/l-eye-scale-decr+eyes/r-eye-scale-decr", "eyes/l-eye-scale-incr+eyes/r-eye-scale-incr"),
    ("eye_height", "eyes/l-eye-trans-down+eyes/r-eye-trans-down", "eyes/l-eye-trans-up+eyes/r-eye-trans-up"),
    ("eye_dist", "eyes/l-eye-trans-in+eyes/r-eye-trans-in", "eyes/l-eye-trans-out+eyes/r-eye-trans-out"),
    ("eye_angle", "eyes/l-eye-corner1-down+eyes/r-eye-corner1-down", "eyes/l-eye-corner1-up+eyes/r-eye-corner1-up"),
    ("eye_fold", "eyes/l-eye-epicanthus-in+eyes/r-eye-epicanthus-in", "eyes/l-eye-epicanthus-out+eyes/r-eye-epicanthus-out"),
    ("nose_width", "nose/nose-scale-horiz-decr", "nose/nose-scale-horiz-incr"),
    ("nose_length", "nose/nose-scale-vert-decr", "nose/nose-scale-vert-incr"),
    ("nose_depth", "nose/nose-scale-depth-decr", "nose/nose-scale-depth-incr"),
    ("nose_bridge", "nose/nose-hump-decr", "nose/nose-hump-incr"),
    ("nose_tip", "nose/nose-point-down", "nose/nose-point-up"),
    ("nostrils", "nose/nose-flaring-decr", "nose/nose-flaring-incr"),
    ("mouth_width", "mouth/mouth-scale-horiz-decr", "mouth/mouth-scale-horiz-incr"),
    ("mouth_height", "mouth/mouth-trans-down", "mouth/mouth-trans-up"),
    ("lip_upper", "mouth/mouth-upperlip-volume-decr", "mouth/mouth-upperlip-volume-incr"),
    ("lip_lower", "mouth/mouth-lowerlip-volume-decr", "mouth/mouth-lowerlip-volume-incr"),
    ("mouth_corners", "mouth/mouth-angles-down", "mouth/mouth-angles-up"),
    ("cheekbones", "cheek/l-cheek-bones-decr+cheek/r-cheek-bones-decr", "cheek/l-cheek-bones-incr+cheek/r-cheek-bones-incr"),
    ("cheeks", "cheek/l-cheek-volume-decr+cheek/r-cheek-volume-decr", "cheek/l-cheek-volume-incr+cheek/r-cheek-volume-incr"),
    ("jaw_width", "chin/chin-width-decr", "chin/chin-width-incr"),
    ("jaw_angle", "chin/chin-bones-decr", "chin/chin-bones-incr"),
    ("chin_height", "chin/chin-height-decr", "chin/chin-height-incr"),
    ("chin_forward", "chin/chin-prognathism-decr", "chin/chin-prognathism-incr"),
    ("chin_cleft", "chin/chin-cleft-decr", "chin/chin-cleft-incr"),
    ("ear_size", "ears/l-ear-scale-decr+ears/r-ear-scale-decr", "ears/l-ear-scale-incr+ears/r-ear-scale-incr"),
    ("ear_out", "ears/l-ear-flap-decr+ears/r-ear-flap-decr", "ears/l-ear-flap-incr+ears/r-ear-flap-incr"),
    ("ear_point", "ears/l-ear-shape-round+ears/r-ear-shape-round", "ears/l-ear-shape-pointed+ears/r-ear-shape-pointed"),
    ("neck_width", "neck/neck-scale-horiz-decr", "neck/neck-scale-horiz-incr"),
]
SKINS = [  # (id, carpeta, tono para el selector)
    *[(f"{a}_{r}_{g}", f"{a}_{r}_{g}ale" if g == "m" else f"{a}_{r}_{g}emale") for a in ("young", "middleage", "old")
      for r in ("caucasian", "african", "asian") for g in ("f", "m")],
]
EYES = ["brown", "brownlight", "green", "bluegreen", "blue", "lightblue", "deepblue", "grey", "ice"]
# Huesos de MPFB → huesos humanoides de VRM.
HUMANOID = {
    "pelvis": "hips", "spine_01": "spine", "spine_02": "chest", "spine_03": "upperChest", "neck_01": "neck", "head": "head",
    "clavicle_l": "leftShoulder", "upperarm_l": "leftUpperArm", "lowerarm_l": "leftLowerArm", "hand_l": "leftHand",
    "clavicle_r": "rightShoulder", "upperarm_r": "rightUpperArm", "lowerarm_r": "rightLowerArm", "hand_r": "rightHand",
    "thigh_l": "leftUpperLeg", "calf_l": "leftLowerLeg", "foot_l": "leftFoot", "ball_l": "leftToes",
    "thigh_r": "rightUpperLeg", "calf_r": "rightLowerLeg", "foot_r": "rightFoot", "ball_r": "rightToes",
    **{f"{f}_0{i}_{s}": f"{'left' if s == 'l' else 'right'}{F}{seg}"
       for f, F in (("thumb", "Thumb"), ("index", "Index"), ("middle", "Middle"), ("ring", "Ring"), ("pinky", "Little"))
       for i, seg in ((1, "Proximal"), (2, "Intermediate"), (3, "Distal")) for s in ("l", "r")},
}
# En VRM el pulgar tiene metacarpo/proximal/distal.
for s, side in (("l", "left"), ("r", "right")):
    HUMANOID[f"thumb_01_{s}"] = f"{side}ThumbMetacarpal"
    HUMANOID[f"thumb_02_{s}"] = f"{side}ThumbProximal"
    HUMANOID[f"thumb_03_{s}"] = f"{side}ThumbDistal"


# ---------------------------------------------------------------------------------------------
# Lectura de MakeHuman
# ---------------------------------------------------------------------------------------------
def read_obj(path: str):
    """Vértices, coordenadas de textura y caras (con sus índices de UV) de un .obj de MakeHuman."""
    v, vt, faces = [], [], []
    with open(path, errors="ignore") as fh:
        for line in fh:
            if line.startswith("v "):
                v.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("vt "):
                vt.append([float(x) for x in line.split()[1:3]])
            elif line.startswith("f "):
                f = []
                for tok in line.split()[1:]:
                    p = tok.split("/")
                    f.append((int(p[0]) - 1, int(p[1]) - 1 if len(p) > 1 and p[1] else -1))
                faces.append(f)
    return np.array(v, np.float64), np.array(vt, np.float64) if vt else np.zeros((0, 2)), faces


def read_binding(path: str):
    """Atadura mhclo/proxy: por vértice, tres vértices de la jaula, pesos y desplazamiento; escalas y borrados."""
    refs, w, off, delete, scale, meta = [], [], [], [], {}, {"tags": []}
    mode = None
    with open(path, errors="ignore") as fh:
        for line in fh:
            s = line.split()
            if not s or line.startswith("#"):
                continue
            k = s[0]
            if k in ("x_scale", "y_scale", "z_scale"):
                scale[k[0]] = (int(s[1]), int(s[2]), float(s[3]))
                continue
            if k == "verts":
                mode = "v"
                continue
            if k == "delete_verts":
                mode = "d"
                continue
            if k in ("material", "obj_file", "z_depth", "name"):
                meta[k] = " ".join(s[1:])
            if k == "tag":
                meta["tags"].append(" ".join(s[1:]).lower())
            if mode == "v" and re.match(r"^\s*-?\d", line):
                if len(s) == 9:
                    refs.append([int(x) for x in s[:3]])
                    w.append([float(x) for x in s[3:6]])
                    off.append([float(x) for x in s[6:9]])
                    continue
                if len(s) == 1:
                    refs.append([int(s[0])] * 3)
                    w.append([1.0, 0.0, 0.0])
                    off.append([0.0, 0.0, 0.0])
                    continue
                mode = None
            if mode == "d" and re.match(r"^\s*\d", line):
                prev = None
                seq = False
                for tok in s:
                    if tok == "-":
                        seq = True
                        continue
                    n = int(tok)
                    if seq and prev is not None:
                        delete.extend(range(prev + 1, n + 1))
                        seq = False
                    else:
                        delete.append(n)
                    prev = n
    return {"refs": np.array(refs, np.int64), "w": np.array(w, np.float64), "off": np.array(off, np.float64),
            "delete": sorted(set(delete)), "scale": scale, "meta": meta}


def interp(pts, v):
    for (a, la), (b, lb) in zip(pts, pts[1:]):
        if a <= v <= b:
            t = (v - a) / (b - a)
            out = {}
            if la:
                out[la] = out.get(la, 0) + 1 - t
            if lb:
                out[lb] = out.get(lb, 0) + t
            return {k: x for k, x in out.items() if x > 1e-6}
    return {}


def macro_weights(m: dict) -> dict[str, float]:
    f = {
        "gender": interp([(0, "female"), (1, "male")], m["gender"]),
        "age": interp([(0, "baby"), (0.1875, "child"), (0.5, "young"), (1, "old")], m["age"]),
        "muscle": interp([(0, "minmuscle"), (0.5, "averagemuscle"), (1, "maxmuscle")], m["muscle"]),
        "weight": interp([(0, "minweight"), (0.5, "averageweight"), (1, "maxweight")], m["weight"]),
        "height": interp([(0, "minheight"), (0.5, ""), (1, "maxheight")], m["height"]),
        "proportions": interp([(0, "uncommonproportions"), (0.5, ""), (1, "idealproportions")], m["proportions"]),
    }
    out: dict[str, float] = {}

    def combo(keys, fmt):
        for c in itertools.product(*[list(f[k].items()) for k in keys]):
            w = float(np.prod([x[1] for x in c]))
            if w < 1e-6 or any(x[0] == "" for x in c):
                continue
            name = fmt.format(*[x[0] for x in c])
            out[name] = out.get(name, 0) + w

    combo(["gender", "age", "muscle", "weight"], "macrodetails/universal-{}-{}-{}-{}")
    combo(["gender", "age", "muscle", "weight", "height"], "macrodetails/height/{}-{}-{}-{}-{}")
    combo(["gender", "age", "muscle", "weight", "proportions"], "macrodetails/proportions/{}-{}-{}-{}-{}")
    tot = sum(m["race"].values())
    for r, rv in m["race"].items():
        for (g, gw), (a, aw) in itertools.product(f["gender"].items(), f["age"].items()):
            k = f"macrodetails/{r}-{g}-{a}"
            out[k] = out.get(k, 0) + rv / tot * gw * aw
    return out


_targets: dict[str, np.ndarray] = {}


def target(name: str, n: int) -> np.ndarray:
    if "+" in name:
        return sum(target(x, n) for x in name.split("+"))
    if name in _targets:
        return _targets[name]
    d = np.zeros((n, 3), np.float64)
    p = f"{TARGETS}/{name}.target.gz"
    if not os.path.exists(p):
        raise FileNotFoundError(p)
    with gzip.open(p, "rt") as fh:
        for line in fh:
            s = line.split()
            if len(s) == 4 and not line.startswith("#"):
                d[int(s[0])] = [float(s[1]), float(s[2]), float(s[3])]
    _targets[name] = d
    return d


def shape(base: np.ndarray, m: dict) -> np.ndarray:
    v = base.copy()
    for k, w in macro_weights(m).items():
        v += w * target(k, len(base))
    return v


def neutral(gender: float) -> dict:
    return dict(gender=gender, age=0.5, muscle=0.5, weight=0.5, height=0.5, proportions=0.5,
                race=dict(african=1 / 3, asian=1 / 3, caucasian=1 / 3))


def sizes(v: np.ndarray, sc: dict) -> np.ndarray:
    return np.array([abs(v[sc[a][0]][i] - v[sc[a][1]][i]) / sc[a][2] for i, a in enumerate("xyz")])


def fit(v: np.ndarray, b: dict) -> np.ndarray:
    s = sizes(v, b["scale"]) if b["scale"] else np.ones(3)
    return (v[b["refs"]] * b["w"][..., None]).sum(1) + b["off"] * s


# ---------------------------------------------------------------------------------------------
# Mallas: separar por UV, simplificar al presupuesto y volver a atar
# ---------------------------------------------------------------------------------------------
def unweld(pos: np.ndarray, uv: np.ndarray, faces) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Un vértice por pareja (posición, UV), triángulos. Devuelve posiciones, UV, índices y de qué vértice viene cada uno."""
    key: dict[tuple[int, int], int] = {}
    src, uvs, tris = [], [], []
    for f in faces:
        ids = []
        for vi, ti in f:
            k = (vi, ti)
            if k not in key:
                key[k] = len(src)
                src.append(vi)
                uvs.append(uv[ti] if ti >= 0 and len(uv) else (0.0, 0.0))
            ids.append(key[k])
        for i in range(1, len(ids) - 1):
            tris.append((ids[0], ids[i], ids[i + 1]))
    src = np.array(src)
    return pos[src], np.array(uvs, np.float64), np.array(tris, np.int64), src


def decimate(pos: np.ndarray, uv: np.ndarray, tris: np.ndarray, target_tris: int):
    """Simplifica con Blender (colapso de aristas, respetando las costuras de UV)."""
    if len(tris) <= target_tris:
        return pos, uv, tris
    import bpy  # noqa: I001
    import bmesh

    # Soldar por posición para que Blender vea una malla continua (las costuras quedan en las UV).
    tree = cKDTree(pos)
    groups = tree.query_ball_point(pos, 1e-6)
    weld = np.array([min(g) for g in groups])
    uniq, inv = np.unique(weld, return_inverse=True)
    me = bpy.data.meshes.new("dec")
    bm = bmesh.new()
    verts = [bm.verts.new(tuple(pos[u])) for u in uniq]
    bm.verts.ensure_lookup_table()
    uvl = bm.loops.layers.uv.new("UV")
    for t in tris:
        a, b, c = (inv[t[0]], inv[t[1]], inv[t[2]])
        if len({a, b, c}) < 3:
            continue
        try:
            f = bm.faces.new((verts[a], verts[b], verts[c]))
        except ValueError:
            continue
        for loop, vi in zip(f.loops, t):
            loop[uvl].uv = tuple(uv[vi])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("dec", me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new("d", "DECIMATE")
    mod.ratio = max(0.05, target_tris / max(1, len(me.polygons)))
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    m2 = bpy.data.meshes.new_from_object(ev)
    m2.calc_loop_triangles()
    uvd = m2.uv_layers.active.data
    key: dict[tuple, int] = {}
    npos, nuv, ntris = [], [], []
    for lt in m2.loop_triangles:
        ids = []
        for li in lt.loops:
            vi = m2.loops[li].vertex_index
            u = tuple(round(x, 5) for x in uvd[li].uv)
            k = (vi, u)
            if k not in key:
                key[k] = len(npos)
                npos.append(tuple(m2.vertices[vi].co))
                nuv.append(u)
            ids.append(key[k])
        ntris.append(ids)
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(m2)
    return np.array(npos, np.float64), np.array(nuv, np.float64), np.array(ntris, np.int64)


def rebind(new_pos: np.ndarray, old_pos: np.ndarray, b: dict, src: np.ndarray, s: np.ndarray) -> dict:
    """La atadura de cada vértice nuevo: la de su vértice original más cercano, con el desplazamiento corregido."""
    _, near = cKDTree(old_pos).query(new_pos)
    o = src[near]
    off = b["off"][o] + (new_pos - old_pos[near]) / s
    return {"refs": b["refs"][o], "w": b["w"][o], "off": off}


# ---------------------------------------------------------------------------------------------
# Escritura compacta
# ---------------------------------------------------------------------------------------------
class Bin:
    """Un .bin con varios arrays seguidos (alineados a 4 bytes) y su índice para el JSON."""

    def __init__(self):
        self.buf = io.BytesIO()
        self.index: dict[str, list] = {}

    def add(self, name: str, arr: np.ndarray, dtype: str):
        a = np.ascontiguousarray(arr, dtype=dtype)
        pad = (-self.buf.tell()) % 4
        self.buf.write(b"\0" * pad)
        self.index[name] = [dtype, self.buf.tell(), int(a.size)]
        self.buf.write(a.tobytes())

    def save(self, path: str) -> int:
        data = self.buf.getvalue()
        with open(path, "wb") as fh:
            fh.write(data)
        return len(data)


Q_POS = 1 / 4096  # m: cuantización de diferencias (0,25 mm)


def q16(a: np.ndarray, step: float) -> np.ndarray:
    return np.clip(np.round(a / step), -32767, 32767).astype(np.int16)


def sparse_delta(bin_: Bin, name: str, d: np.ndarray, eps: float = 1e-5) -> dict:
    nz = np.where(np.abs(d).max(1) > eps)[0]
    bin_.add(f"{name}.i", nz, "<u2")
    bin_.add(f"{name}.d", q16(d[nz] * UNIT, Q_POS), "<i2")
    return {"n": int(len(nz))}


def uv_mask(size: tuple[int, int], uvs: list[tuple[np.ndarray, np.ndarray]]) -> np.ndarray:
    """Qué píxeles de la textura usa la malla (sus triángulos en el espacio UV), un poco engordado."""
    from PIL import ImageDraw
    from scipy.ndimage import binary_dilation

    w, h = size
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    for uv, tris in uvs:
        px = np.c_[uv[:, 0] * w, (1 - uv[:, 1]) * h]
        for t in tris:
            d.polygon([tuple(px[t[0]]), tuple(px[t[1]]), tuple(px[t[2]])], fill=255)
    return binary_dilation(np.asarray(m) > 0, iterations=2)


def bleed(im: Image.Image, mask: np.ndarray) -> Image.Image:
    """Extiende el color de cada isla UV hacia fuera (sin bordes negros al filtrar la textura)."""
    from scipy.ndimage import distance_transform_edt

    if mask.all() or not mask.any():
        return im
    a = np.asarray(im).copy()
    _, (iy, ix) = distance_transform_edt(~mask, return_indices=True)
    out = a[iy, ix]
    if a.shape[-1] == 4:
        out[..., 3] = np.where(mask, a[..., 3], 0)
    return Image.fromarray(out, im.mode)


def tex_out(src: str, dst: str, size: int, keep_alpha: bool | None = None, uvs: list | None = None) -> bool:
    """WebP del tamaño pedido (con el color de las islas extendido si se dan sus UV); devuelve si tiene transparencia útil."""
    im = Image.open(src)
    alpha = False
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        a = np.asarray(im)[..., 3]
        alpha = bool((a < 250).mean() > 0.002)
    else:
        im = im.convert("RGB")
    if keep_alpha is False or not alpha:
        im = im.convert("RGB")
    if uvs:
        im = bleed(im, uv_mask(im.size, uvs))
    s = min(1.0, size / max(im.size))
    if s < 1:
        im = im.resize((max(1, int(im.size[0] * s)), max(1, int(im.size[1] * s))), Image.LANCZOS)
    im.save(dst, "WEBP", quality=82, method=6)
    return alpha


def material_texture(folder: str, meta: dict) -> str | None:
    mat = meta.get("material")
    cands = []
    if mat:
        p = os.path.join(folder, mat)
        if os.path.isfile(p):
            for line in open(p, errors="ignore"):
                if line.startswith("diffuseTexture"):
                    cands.append(os.path.join(folder, line.split(None, 1)[1].strip()))
    cands += [os.path.join(folder, f) for f in sorted(os.listdir(folder)) if re.search(r"diffuse.*\.png$|\.png$", f, re.I) and "normal" not in f.lower() and "spec" not in f.lower() and "bump" not in f.lower()]
    for c in cands:
        if os.path.isfile(c):
            return c
    return None


# ---------------------------------------------------------------------------------------------
def main() -> None:
    os.makedirs(f"{OUT}/parts", exist_ok=True)
    os.makedirs(f"{OUT}/tex", exist_ok=True)
    os.makedirs(f"{OUT}/thumbs", exist_ok=True)
    only = set(a for a in sys.argv[1:] if not a.startswith("--"))

    base, _, _ = read_obj(f"{MPFB}/3dobjs/base.obj")
    n = len(base)
    groups = json.load(open(f"{MPFB}/mesh_metadata/basemesh_vertex_groups.json"))
    rig = json.load(open(f"{MPFB}/rigs/standard/rig.game_engine.json"))
    weights = json.load(open(f"{MPFB}/rigs/standard/weights.game_engine.json"))["weights"]
    default_human = shape(base, neutral(0.5))

    kit: dict = {"version": KIT_VERSION, "unit": UNIT, "q": Q_POS, "cage": n, "bases": {}, "body": [s[0] for s in BODY_SLIDERS],
                 "face": [s[0] for s in FACE_SLIDERS], "parts": [], "skins": [], "eyes": EYES, "humanoid": HUMANOID}

    # ---- Jaula: forma neutra y ajustes de cada base ----
    for key, g in (("f", 0.0), ("m", 1.0)):
        b = Bin()
        m0 = neutral(g)
        v0 = shape(base, m0)
        b.add("neutral", np.round(v0 * UNIT / Q_POS).astype(np.int32), "<i4")
        sl = {}
        for sid, var, lo, hi in BODY_SLIDERS:
            for side, val in (("lo", lo), ("hi", hi)):
                m = dict(m0)
                m[var] = val
                sl[f"{sid}.{side}"] = sparse_delta(b, f"{sid}.{side}", shape(base, m) - v0)
        size = b.save(f"{OUT}/cage-{key}.bin")
        kit["bases"][key] = {"file": f"cage-{key}.bin", "bytes": size, "index": b.index}
        print(f"jaula {key}: {size / 1e6:.2f} MB")

    # ---- Cara (compartida) ----
    b = Bin()
    for sid, lo, hi in FACE_SLIDERS:
        sparse_delta(b, f"{sid}.lo", target(lo, n))
        sparse_delta(b, f"{sid}.hi", target(hi, n))
    size = b.save(f"{OUT}/face.bin")
    kit["faceFile"] = {"file": "face.bin", "bytes": size, "index": b.index}
    print(f"cara: {size / 1e6:.2f} MB")

    # ---- Esqueleto y pesos ----
    def group_ids(name):
        ids = []
        for a, c in groups[name]:
            ids.extend(range(a, c + 1))
        return ids

    bones, joints = [], {}
    order = []

    def visit(name):
        if name in order:
            return
        p = rig[name].get("parent")
        if p:
            visit(p)
        order.append(name)

    for name in rig:
        visit(name)
    b = Bin()
    for name in order:
        spec = rig[name]
        out = {"name": name, "parent": order.index(spec["parent"]) if spec.get("parent") else -1}
        for end in ("head", "tail"):
            h = spec[end]
            if h["strategy"] == "CUBE":
                ids = group_ids(h["cube_name"])
            elif h["strategy"] in ("MEAN", "VERTEX"):
                ids = h["vertex_indices"]
            else:
                raise ValueError(f"articulación desconocida {name}.{end}: {h['strategy']}")
            b.add(f"{name}.{end}", np.array(ids), "<u2")
        bones.append(out)
    # Pesos: hasta 4 huesos por vértice de la jaula.
    per: list[list[tuple[int, float]]] = [[] for _ in range(n)]
    for bi, name in enumerate(order):
        for vi, w in weights.get(name, []):
            per[vi].append((bi, w))
    jw = np.zeros((n, 4), np.float64)
    ji = np.zeros((n, 4), np.int64)
    for vi, lst in enumerate(per):
        lst.sort(key=lambda x: -x[1])
        lst = lst[:4]
        s = sum(w for _, w in lst) or 1.0
        for k, (bi, w) in enumerate(lst):
            ji[vi, k] = bi
            jw[vi, k] = w / s
    b.add("skin.i", ji, "u1")
    b.add("skin.w", np.round(jw * 255), "u1")
    size = b.save(f"{OUT}/rig.bin")
    kit["rig"] = {"file": "rig.bin", "bytes": size, "index": b.index, "bones": bones}
    print(f"esqueleto: {len(bones)} huesos, {size / 1e3:.0f} kB")

    # ---- Piezas ----
    total = 0
    for spec in CATALOG:
        if only and spec["id"] not in only:
            continue
        folder = os.path.join(ASSETS, spec["src"])
        if spec["cat"] == "body":
            bind_path = next(os.path.join(folder, f) for f in os.listdir(folder) if f.endswith(".proxy"))
        else:
            bind_path = next(os.path.join(folder, f) for f in os.listdir(folder) if f.endswith(".mhclo"))
        bnd = read_binding(bind_path)
        obj = os.path.join(folder, bnd["meta"].get("obj_file") or next(f for f in os.listdir(folder) if f.endswith(".obj")))
        _, uv, faces = read_obj(obj)
        human = shape(base, neutral(0.0 if spec.get("base") == "f" else 1.0 if spec.get("base") == "m" else 0.5))
        fitted = fit(human, bnd)
        pos, puv, tris, src = unweld(fitted, uv, faces)
        bnd_split = {"refs": bnd["refs"][src], "w": bnd["w"][src], "off": bnd["off"][src]}
        s = sizes(human, bnd["scale"]) if bnd["scale"] else np.ones(3)
        budget = BUDGET.get(spec["cat"], 2000)
        if len(tris) > budget:
            npos, nuv, ntris = decimate(pos, puv, tris, budget)
            nb = rebind(npos, fitted, bnd, np.arange(len(fitted)), s)
            pos, puv, tris, bnd_split = npos, nuv, ntris, nb
        b = Bin()
        b.add("refs", bnd_split["refs"], "<u2")
        b.add("w", bnd_split["w"], "<f4")
        b.add("off", q16(bnd_split["off"] * UNIT, Q_POS), "<i2")
        b.add("uv", np.round(np.clip(puv, 0, 1) * 65535), "<u2")
        b.add("idx", tris, "<u2" if len(pos) < 65536 else "<u4")
        if bnd["delete"]:
            b.add("delete", np.array(bnd["delete"]), "<u2")
        size = b.save(f"{OUT}/parts/{spec['id']}.bin")
        total += size
        entry = {"id": spec["id"], "cat": spec["cat"], "file": f"parts/{spec['id']}.bin", "bytes": size, "index": b.index,
                 "verts": int(len(pos)), "tris": int(len(tris)), "scale": bnd["scale"], "z": int(bnd["meta"].get("z_depth", 50) or 50)}
        for k in ("base", "tint", "es", "en"):
            if spec.get(k):
                entry[k] = spec[k]
        # Textura y miniatura
        if spec["cat"] not in ("body", "eyes"):
            texsrc = material_texture(folder, bnd["meta"])
            if texsrc:
                entry["alpha"] = tex_out(texsrc, f"{OUT}/tex/{spec['id']}.webp", TEX.get(spec["cat"], TEX_DEFAULT), uvs=[(puv, tris)])
                entry["tex"] = f"tex/{spec['id']}.webp"
        thumb = next((os.path.join(folder, f) for f in os.listdir(folder) if f.endswith(".thumb")), None)
        if thumb:
            try:
                Image.open(thumb).convert("RGB").resize((96, 96), Image.LANCZOS).save(f"{OUT}/thumbs/{spec['id']}.webp", "WEBP", quality=80)
                entry["thumb"] = f"thumbs/{spec['id']}.webp"
            except Exception as e:  # noqa: BLE001
                print("  sin miniatura", spec["id"], e)
        kit["parts"].append(entry)
        print(f"  {spec['id']:<18} {spec['cat']:<8} {len(tris):>6} tri  {size / 1e3:6.0f} kB")
    print(f"piezas: {total / 1e6:.2f} MB")

    # ---- Pieles y ojos (con las islas UV de los cuerpos y de los ojos) ----
    def obj_uvs(folder):
        objp = next(os.path.join(folder, f) for f in os.listdir(folder) if f.endswith(".obj"))
        v, uv, faces = read_obj(objp)
        _, puv, tris, _ = unweld(v, uv, faces)
        return (puv, tris)

    body_uvs = [obj_uvs(os.path.join(ASSETS, "proxymeshes", d)) for d in ("female_generic", "male_generic")]
    eye_uvs = [obj_uvs(os.path.join(ASSETS, "eyes", "low-poly"))]
    for sid, d in SKINS:
        folder = os.path.join(ASSETS, "skins", d)
        mat = next(f for f in os.listdir(folder) if f.endswith(".mhmat"))
        tex = material_texture(folder, {"material": mat})
        tex_out(tex, f"{OUT}/tex/skin_{sid}.webp", 1024, keep_alpha=False, uvs=body_uvs)
        im = np.asarray(Image.open(f"{OUT}/tex/skin_{sid}.webp").convert("RGB").resize((64, 64)))
        tone = "#%02x%02x%02x" % tuple(int(x) for x in np.median(im[20:44, 20:44].reshape(-1, 3), axis=0))
        kit["skins"].append({"id": sid, "tex": f"tex/skin_{sid}.webp", "tone": tone})
    for e in EYES:
        tex_out(os.path.join(ASSETS, "eyes", "materials", f"{e}_eye.png"), f"{OUT}/tex/eye_{e}.webp", 256, keep_alpha=False, uvs=eye_uvs)

    # Con piezas sueltas en la línea de órdenes, se conservan las demás del kit anterior.
    if only and os.path.isfile(f"{OUT}/kit.json"):
        old = json.load(open(f"{OUT}/kit.json"))
        done = {p["id"] for p in kit["parts"]}
        kit["parts"] += [p for p in old.get("parts", []) if p["id"] not in done]
        order = {s["id"]: i for i, s in enumerate(CATALOG)}
        kit["parts"].sort(key=lambda p: order.get(p["id"], 1e9))
    with open(f"{OUT}/kit.json", "w") as fh:
        json.dump(kit, fh, ensure_ascii=False, separators=(",", ":"))
    print("listo:", OUT)


if __name__ == "__main__":
    main()
