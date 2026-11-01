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
        ("top_camisole", "toigo_camisole_top", "Camisola", "Camisole"),
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
        ("fit_skinsuit", "matcreator_mc-skinsuit_2022", "Traje ceñido", "Skinsuit"),
        ("fit_casual_m0", "male_casualsuit01", "Informal 8", "Casual 8"),
        ("fit_skirt_suit", "toigo_female_suit", "Traje con falda", "Skirt suit"),
        ("fit_suit_f2", "toigo_female_suit_2", "Traje 2", "Suit 2"),
        ("fit_bowtie", "toigo_suit_with_jacket_and_bowtie", "Traje con pajarita", "Suit and bow tie"),
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
        ("sh_ankle_f", "toigo_ankle_boots_female", "Botines 2", "Ankle boots 2"),
        ("sh_overknee", "cortu_floppy_overknee_shoes", "Botas altas", "Over-knee boots"),
        ("sh_bows", "toigo_ballet_flats_with_bows", "Bailarinas con lazo", "Flats with bows"),
    ]],
    # Gorros
    *[{"id": i, "src": f"clothes/{d}", "cat": "hat", "tint": "cloth", "es": es, "en": en} for i, d, es, en in [
        ("hat_fedora", "fedora01", "Sombrero", "Fedora"),
        ("hat_fedora2", "fedora_cocked", "Sombrero ladeado", "Cocked fedora"),
        ("hat_cloche", "aethelraed_unraed_cloche_hat", "Gorro campana", "Cloche"),
        ("hat_xmas", "joepal_xmas_cap", "Gorro de Navidad", "Christmas hat"),
        ("hat_hood", "donitz_monk_robe_hood", "Capucha", "Hood"),
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
# Más ajustes del cuerpo, compartidos por las dos bases (como los de la cara). Sin ajustes de pecho.
DETAIL_SLIDERS = [
    ("shoulders", "torso/measure-shoulder-dist-decr", "torso/measure-shoulder-dist-incr"),
    ("vshape", "torso/torso-vshape-decr", "torso/torso-vshape-incr"),
    ("waist", "torso/measure-waist-circ-decr", "torso/measure-waist-circ-incr"),
    ("hips", "torso/measure-hips-circ-decr", "torso/measure-hips-circ-incr"),
    ("belly", "stomach/stomach-pregnant-decr", "stomach/stomach-pregnant-incr"),
    ("torso_length", "torso/torso-scale-vert-decr", "torso/torso-scale-vert-incr"),
    ("neck_length", "neck/measure-neck-height-decr", "neck/measure-neck-height-incr"),
    ("arm_length", "arms/measure-upperarm-length-decr+arms/measure-lowerarm-length-decr",
     "arms/measure-upperarm-length-incr+arms/measure-lowerarm-length-incr"),
    ("arms", "arms/l-upperarm-muscle-decr+arms/r-upperarm-muscle-decr+arms/l-lowerarm-muscle-decr+arms/r-lowerarm-muscle-decr",
     "arms/l-upperarm-muscle-incr+arms/r-upperarm-muscle-incr+arms/l-lowerarm-muscle-incr+arms/r-lowerarm-muscle-incr"),
    ("leg_length", "legs/upperlegs-height-decr+legs/lowerlegs-height-decr", "legs/upperlegs-height-incr+legs/lowerlegs-height-incr"),
    ("legs", "legs/l-upperleg-muscle-decr+legs/r-upperleg-muscle-decr+legs/l-lowerleg-muscle-decr+legs/r-lowerleg-muscle-decr",
     "legs/l-upperleg-muscle-incr+legs/r-upperleg-muscle-incr+legs/l-lowerleg-muscle-incr+legs/r-lowerleg-muscle-incr"),
    ("hands", "hands/l-hand-scale-decr+hands/r-hand-scale-decr", "hands/l-hand-scale-incr+hands/r-hand-scale-incr"),
    ("feet", "feet/l-foot-scale-decr+feet/r-foot-scale-decr", "feet/l-foot-scale-incr+feet/r-foot-scale-incr"),
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


COVER_CATS = {"top", "bottom", "outfit", "shoes", "gloves", "hat"}
BODY_VERTS = 13380  # los primeros vértices de la base son el cuerpo (los demás, ayudas)
REACH = 0.6  # dm: hasta dónde se busca la prenda siguiendo la normal de la piel
BEHIND = 0.15  # dm: o un poco por dentro (prendas que se meten en la piel)
EDGE_DEEP = 0.4  # dm: la piel se quita solo a más de esto de los bordes de la prenda


def body_quads(faces) -> np.ndarray:
    """Caras del cuerpo de la base (cuadriláteros; un triángulo repite su último vértice)."""
    out = []
    for f in faces:
        ids = [vi for vi, _ in f]
        if max(ids) >= BODY_VERTS or len(ids) not in (3, 4):
            continue
        out.append(ids if len(ids) == 4 else ids + [ids[2]])
    return np.array(out, np.int64)


def vertex_normals(v: np.ndarray, quads: np.ndarray) -> np.ndarray:
    """Normales de los vértices del cuerpo (hacia fuera)."""
    a, b, c, d = (v[quads[:, k]] for k in range(4))
    fn = np.cross(c - a, d - b)
    n = np.zeros((BODY_VERTS, 3))
    for k in range(4):
        np.add.at(n, quads[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def bone_distance(parents: list[int]) -> np.ndarray:
    """Saltos entre cada par de huesos en el árbol del esqueleto."""
    n = len(parents)
    chain = []
    for b in range(n):
        c, x = [], b
        while x >= 0:
            c.append(x)
            x = parents[x]
        chain.append(c)
    out = np.zeros((n, n), np.int64)
    for a in range(n):
        da = {x: i for i, x in enumerate(chain[a])}
        for b in range(n):
            for j, x in enumerate(chain[b]):
                if x in da:
                    out[a, b] = da[x] + j
                    break
    return out


def coverage(human: np.ndarray, nrm: np.ndarray, pos: np.ndarray, tris: np.ndarray, part_bone: np.ndarray,
             body_bone: np.ndarray, near: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Qué piel tapa de verdad una prenda (con rayos: trimesh + Embree). Desde cada vértice del cuerpo
    se sigue su normal hacia fuera (o un poco hacia dentro) y se busca la prenda, contando solo las
    partes atadas a ese mismo trozo del cuerpo (mismo hueso o uno contiguo: así, la cara interior del
    brazo no queda «tapada» por el costado de la camiseta). Además se lanzan seis rayos en cono
    alrededor de la normal: si alguno se escapa (por un cuello, una manga o la abertura de una
    capucha), esa piel se ve desde fuera y no se quita. Devuelve:
      - `under`: vértices tapados (ordenan las capas y, si la prenda va pegada, se meten un poco),
      - `gap`: a cuánto queda la prenda de cada uno (mm),
      - `deep`: los tapados por todos lados y lejos de los bordes de la prenda, que se quitan.
    """
    import trimesh
    from trimesh.ray.ray_pyembree import RayMeshIntersector

    mesh = trimesh.Trimesh(pos, tris, process=False)
    rmi = RayMeshIntersector(mesh)
    tn = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
    tri_bones = part_bone[tris]
    cent = pos[tris].mean(1)
    d, _ = cKDTree(np.concatenate([pos, cent])).query(human[:BODY_VERTS], distance_upper_bound=REACH + 0.25)
    cand = np.where(np.isfinite(d))[0]
    n0 = nrm[cand]

    def cast(dirs: np.ndarray, reach: float) -> tuple[np.ndarray, np.ndarray]:
        """Primer cruce con una parte compatible de la prenda: distancia (o inf) y triángulo."""
        origins = human[cand] - dirs * BEHIND
        loc, ir, it = rmi.intersects_location(origins, dirs, multiple_hits=True)
        best = np.full(len(cand), np.inf)
        tri = np.full(len(cand), -1)
        if len(ir):
            t = np.einsum("ij,ij->i", loc - origins[ir], dirs[ir])
            ok = (t >= 0) & (t <= reach + BEHIND) & near[body_bone[cand[ir]][:, None], tri_bones[it]].any(1)
            ir, it, t = ir[ok], it[ok], t[ok]
            order = np.lexsort((t, ir))
            ir, it, t = ir[order], it[order], t[order]
            first = np.r_[True, ir[1:] != ir[:-1]]
            best[ir[first]] = t[first] - BEHIND
            tri[ir[first]] = it[first]
        return best, tri

    hit, tri = cast(n0, REACH)
    # Seis rayos en cono (unos 33° alrededor de la normal), algo más largos.
    up = np.where(np.abs(n0[:, 1:2]) < 0.9, np.array([[0.0, 1.0, 0.0]]), np.array([[1.0, 0.0, 0.0]]))
    t1 = np.cross(n0, up)
    t1 /= np.maximum(np.linalg.norm(t1, axis=1, keepdims=True), 1e-9)
    t2 = np.cross(n0, t1)
    cone = np.zeros(len(cand), int)
    for k in range(6):
        a = k * np.pi / 3
        dirs = n0 + 0.65 * (np.cos(a) * t1 + np.sin(a) * t2)
        dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
        h, _ = cast(dirs, REACH * 1.6)
        cone += np.isfinite(h)
    under_c = np.isfinite(hit)
    back = np.zeros(len(cand), bool)
    has = tri >= 0
    back[has] = np.einsum("ij,ij->i", n0[has], tn[tri[has]]) > 0
    # Las prendas de MakeHuman tienen la normal hacia fuera; si la mayoría de cruces van al revés,
    # la malla está dada la vuelta.
    if under_c.sum() and back[under_c].mean() < 0.5:
        back = ~back
    # Bordes de la prenda (con las costuras de UV soldadas).
    key: dict = {}
    weld = np.array([key.setdefault(tuple(np.round(x, 4)), i) for i, x in enumerate(pos)])
    count: dict[tuple[int, int], int] = {}
    for tr in tris:
        for i, j in ((0, 1), (1, 2), (2, 0)):
            e = tuple(sorted((weld[tr[i]], weld[tr[j]])))
            count[e] = count.get(e, 0) + 1
    edges = np.array([e for e, n in count.items() if n == 1])
    far = np.ones(len(cand), bool)
    if len(edges):
        ea, eb = pos[edges[:, 0]], pos[edges[:, 1]]
        bpts = np.concatenate([ea + (eb - ea) * k for k in np.linspace(0, 1, 6)])
        db, _ = cKDTree(bpts).query(human[cand])
        far = db > EDGE_DEEP
    deep_c = under_c & (cone == 6) & far & back
    ids = cand[under_c]
    gap = np.clip(np.round(hit[under_c] * 100), 0, 255)  # dm → mm
    return ids, gap, cand[deep_c]


def skin_under(human: np.ndarray, quads: np.ndarray, pos: np.ndarray, tris: np.ndarray) -> np.ndarray:
    """Por cada vértice de una pieza, el vértice de la piel que queda debajo (hacia dentro de la pieza)."""
    import trimesh
    from trimesh.ray.ray_pyembree import RayMeshIntersector

    near = cKDTree(human[:BODY_VERTS]).query(pos)[1]
    if not len(tris):
        return near
    btris = np.concatenate([quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]])
    btris = btris[(btris[:, 0] != btris[:, 1]) & (btris[:, 1] != btris[:, 2]) & (btris[:, 0] != btris[:, 2])]
    body = trimesh.Trimesh(human[:BODY_VERTS], btris, process=False)
    # Normales de la pieza (soldando las costuras de UV).
    key: dict = {}
    weld = np.array([key.setdefault(tuple(np.round(x, 4)), i) for i, x in enumerate(pos)])
    fn = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
    vn = np.zeros_like(pos)
    for k in range(3):
        np.add.at(vn, weld[tris[:, k]], fn)
    vn = vn[weld]
    vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
    rmi = RayMeshIntersector(body)
    out = near.copy()
    for sign in (1.0, -1.0):
        todo = np.where(out == near)[0] if sign < 0 else np.arange(len(pos))
        if not len(todo):
            break
        dirs = -vn[todo] * sign
        loc, ir, it = rmi.intersects_location(pos[todo], dirs, multiple_hits=False)
        if not len(ir):
            continue
        dist = np.linalg.norm(loc - pos[todo][ir], axis=1)
        ok = dist < 1.5  # dm
        ir, it, loc = ir[ok], it[ok], loc[ok]
        cand = btris[it]
        best = cand[np.arange(len(cand)), np.argmin(np.linalg.norm(human[cand] - loc[:, None, :], axis=2), axis=1)]
        out[todo[ir]] = best
    return out


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
def proxy_body(folder: str, human: np.ndarray) -> dict:
    """Un cuerpo de MakeHuman (proxy) colocado en `human`: UV, triángulos, posiciones (m) y atadura."""
    bind = read_binding(next(os.path.join(folder, f) for f in os.listdir(folder) if f.endswith(".proxy")))
    _, uv, faces = read_obj(next(os.path.join(folder, f) for f in os.listdir(folder) if f.endswith(".obj")))
    pos, puv, tris, src = unweld(fit(human, bind), uv, faces)
    return {"uv": puv, "tris": tris, "pos": pos * UNIT, "refs": bind["refs"][src], "w": bind["w"][src]}


def forge_skin_maps(base: np.ndarray, quads: np.ndarray, groups: dict, order: list[str], ji: np.ndarray, jw: np.ndarray,
                    joint_ids: dict, body_bone: np.ndarray, near: np.ndarray) -> None:
    """Zonas, juntas, líneas de panel, maquillaje, barba de tres días y pecas en el espacio UV del cuerpo."""
    from maps import ZONES, blur_on_mesh, make_maps, smoothstep, zone_of_bone

    human = shape(base, neutral(0.5))
    hm = human * UNIT
    n = len(base)
    nb = len(order)
    bone_w = np.zeros((n, nb))
    for k in range(4):
        np.add.at(bone_w, (np.arange(n), ji[:, k]), jw[:, k])
    zone_w = np.zeros((n, len(ZONES)))
    for bi, name in enumerate(order):
        zone_w[:, zone_of_bone(name)] += bone_w[:, bi]
    tris = np.concatenate([quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]])
    tris = tris[(tris[:, 0] != tris[:, 1]) & (tris[:, 1] != tris[:, 2]) & (tris[:, 0] != tris[:, 2])]
    nrm = np.zeros((n, 3))
    nrm[:BODY_VERTS] = vertex_normals(human, quads)

    def joint(name: str, end: str) -> np.ndarray:
        return hm[joint_ids[f"{name}.{end}"]].mean(0)

    def grp(name: str) -> np.ndarray:
        ids = []
        for a, c in groups[name]:
            ids.extend(range(a, c + 1))
        return np.array(ids)

    eyes = [hm[grp(g)] for g in ("helper-l-eye", "helper-r-eye")]
    ec = [e.mean(0) for e in eyes]
    er = float(np.mean([np.linalg.norm(e - c, axis=1).max() for e, c in zip(eyes, ec)]))
    body = np.zeros(n, bool)
    body[:BODY_VERTS] = True
    p = hm
    front = nrm[:, 2]

    # Labios: lo que mueven los objetivos de volumen de los labios.
    lip = np.linalg.norm(target("mouth/mouth-upperlip-volume-incr", n), axis=1) + np.linalg.norm(target("mouth/mouth-lowerlip-volume-incr", n), axis=1)
    lip = lip / max(np.percentile(lip[lip > 0], 92), 1e-9)
    lips = smoothstep(0.18, 0.55, lip) * body

    # Párpados: alrededor de cada ojo, por encima de su centro y por delante.
    shadow = np.zeros(n)
    blush = np.zeros(n)
    for c in ec:
        d = np.linalg.norm(p - c, axis=1)
        m = (1 - smoothstep(er * 1.02, er * 1.95, d)) * smoothstep(c[1] - er * 0.15, c[1] + er * 0.45, p[:, 1]) * (p[:, 2] > c[2] - er * 0.4)
        shadow = np.maximum(shadow, m)
        # Mejillas: bajo el ojo y hacia fuera, sobre la piel.
        side = np.sign(c[0])
        want = c + np.array([side * er * 0.55, -er * 2.6, 0.0])
        cand = np.where(body & (front > 0.25))[0]
        onskin = p[cand[np.argmin(np.linalg.norm(p[cand] - want, axis=1))]]
        dd = np.linalg.norm(p - onskin, axis=1)
        blush = np.maximum(blush, (1 - smoothstep(er * 0.4, er * 2.3, dd)) * (front > 0.1))
    shadow *= body
    blush *= body * (1 - lips)

    # Pecas: nariz y mejillas.
    mid = (ec[0] + ec[1]) / 2
    cand = np.where(body & (front > 0.5))[0]
    want = mid + np.array([0.0, -er * 1.4, er * 1.5])
    nose = p[cand[np.argmin(np.linalg.norm(p[cand] - want, axis=1))]]
    ell = np.sqrt(((p[:, 0] - nose[0]) / (er * 4.6)) ** 2 + ((p[:, 1] - nose[1]) / (er * 2.3)) ** 2)
    freckle = (1 - smoothstep(0.55, 1.0, ell)) * (p[:, 2] > nose[2] - er * 3.0) * (front > 0.15) * body * (1 - lips)

    # Barba de tres días: la piel que tapan la barba larga y el bigote, suavizada.
    beard = np.zeros(n)
    for src in ("clothes/rehmanpolanski_beard_viking", "clothes/rehmanpolanski_moustache_viking"):
        folder = os.path.join(ASSETS, src)
        bnd = read_binding(next(os.path.join(folder, f) for f in os.listdir(folder) if f.endswith(".mhclo")))
        _, uv, faces = read_obj(os.path.join(folder, bnd["meta"].get("obj_file") or next(f for f in os.listdir(folder) if f.endswith(".obj"))))
        pos, _, btris, srcv = unweld(fit(human, bnd), uv, faces)
        prim = bnd["refs"][srcv][np.arange(len(pos)), np.argmax(bnd["w"][srcv], axis=1)]
        under, _, _ = coverage(human, nrm, pos, btris, body_bone[prim], body_bone, near)
        beard[under] = 1.0
    beard = blur_on_mesh(beard, tris, 3)
    stubble = smoothstep(0.25, 0.75, beard) * body * (1 - smoothstep(0.05, 0.4, lips))

    # Cabeza: centro, barbilla, frente y ángulo del contorno de la cara.
    head_c = (joint("head", "head") + joint("head", "tail")) / 2
    head_c[0] = 0.0
    face = body & (bone_w[:, order.index("head")] > 0.6) & (p[:, 2] > head_c[2])
    chin_y = float(p[face, 1].min()) + 0.004
    joints = {"head_center": head_c, "chin_y": chin_y, "forehead_y": float(mid[1] + er * 3.0), "face_angle": np.radians(60.0)}
    bodies = [proxy_body(os.path.join(ASSETS, "proxymeshes", d), shape(base, neutral(g))) for d, g in (("female_generic", 0.0), ("male_generic", 1.0))]
    fields = {"zone_w": zone_w, "bone_w": bone_w, "lips": lips, "shadow": shadow, "blush": blush,
              "stubble_area": stubble, "freckle_area": freckle}
    make_maps(f"{OUT}/tex", 1024, bodies, fields, joints)
    print("mapas de piel: body_maps, face_maps, skin_maps")


# Implantes (piezas propias, hechas aquí: CC0). (id, ES, EN, discos: (sitio, desplazamiento en dm, radio en dm))
IMPLANTS = [
    ("imp_nape", "Nuca", "Nape", [("nape", 0.0, 0.11)]),
    ("imp_spine", "Columna", "Spine", [("nape", 0.24, 0.07), ("nape", 0.0, 0.08), ("nape", -0.24, 0.07)]),
    ("imp_temples", "Sienes", "Temples", [("temple_l", 0.0, 0.07), ("temple_r", 0.0, 0.07)]),
]


def implant_texture() -> None:
    """Un disco metálico con lente y un aro que puede brillar (y su máscara de brillo)."""
    size = 128
    yy, xx = np.mgrid[0:size, 0:size] + 0.5
    rho = np.hypot(xx - size / 2, yy - size / 2) / (size / 2)
    ang = np.arctan2(yy - size / 2, xx - size / 2)

    def band(a: float, b: float) -> np.ndarray:
        return ((rho >= a) & (rho < b)).astype(float)

    col = np.zeros((size, size, 3))
    lens = band(0, 0.28)
    hl = np.clip(1 - np.hypot(xx - size * 0.44, yy - size * 0.42) / (size * 0.07), 0, 1) * lens
    col += lens[..., None] * np.array([14, 17, 22]) + hl[..., None] * 160
    col += band(0.28, 0.4)[..., None] * np.array([184, 192, 200])
    col += band(0.4, 0.58)[..., None] * np.array([226, 244, 252])
    grooves = 0.9 + 0.1 * np.cos(ang * 48)
    col += (band(0.58, 0.86) * grooves)[..., None] * np.array([142, 152, 163])
    col += band(0.86, 1.01)[..., None] * np.array([42, 48, 56])
    col += (rho >= 1.01)[..., None] * np.array([42, 48, 56])
    Image.fromarray(np.clip(col, 0, 255).astype(np.uint8), "RGB").save(f"{OUT}/tex/implant.webp", "WEBP", quality=90)
    glow = np.clip(1 - np.abs(rho - 0.49) / 0.075, 0, 1) ** 0.7
    g = np.repeat(np.round(glow * 255).astype(np.uint8)[..., None], 3, axis=2)
    Image.fromarray(g, "RGB").save(f"{OUT}/tex/implant_glow.webp", "WEBP", lossless=True)


def forge_implants(base: np.ndarray, quads: np.ndarray, joint_ids: dict, body_bone: np.ndarray, order: list[str]) -> list[dict]:
    """Discos atados a la piel (nuca, columna o sienes): siguen al cuerpo sea cual sea su forma."""
    human = shape(base, neutral(0.5))
    nrm = vertex_normals(human, quads)
    hv = human[:BODY_VERTS]

    def jpos(name: str, end: str) -> np.ndarray:
        return human[joint_ids[f"{name}.{end}"]].mean(0)

    neck0, head0 = jpos("neck_01", "head"), jpos("head", "head")
    nape_y = neck0[1] + (head0[1] - neck0[1]) * 0.45
    head_ids = np.where(body_bone[:BODY_VERTS] == order.index("head"))[0]
    hx = np.abs(hv[head_ids, 0]).max()
    top = hv[head_ids, 1].max()

    def anchor(site: str, dy: float) -> int:
        if site == "nape":
            c = np.where((np.abs(hv[:, 0]) < 0.06) & (hv[:, 2] < neck0[2]) & (nrm[:, 2] < -0.6))[0]
            want = np.array([0.0, nape_y + dy, hv[c, 2].min()])
        else:
            side = 1 if site.endswith("_l") else -1
            c = head_ids[(np.sign(hv[head_ids, 0]) == side) & (np.abs(nrm[head_ids, 0]) > 0.7)]
            want = np.array([side * hx, top - 0.62, head0[2] + 0.55])
        return int(c[np.argmin(np.linalg.norm(hv[c] - want, axis=1))])

    entries = []
    for pid, es, en, discs in IMPLANTS:
        pos_l, uv_l, tri_l, ref_l = [], [], [], []
        for site, dy, rad in discs:
            a = anchor(site, dy)
            n = nrm[a]
            up = np.array([0.0, 1.0, 0.0]) if abs(n[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
            t1 = np.cross(up, n)
            t1 /= np.linalg.norm(t1)
            t2 = np.cross(n, t1)
            seg = 28
            h, sink = 0.035, 0.03
            rings = [(0.0, h + 0.012), (0.3, h + 0.009), (0.92, h), (1.0, h * 0.55), (1.0, -sink)]
            start = sum(len(x) for x in pos_l)
            verts, uvs = [], []
            for ri, (rr, hh) in enumerate(rings):
                count = 1 if rr == 0 else seg
                for k in range(count):
                    ang = 2 * np.pi * k / seg
                    lx, ly = np.cos(ang) * rr * rad, np.sin(ang) * rr * rad
                    verts.append(hv[a] + t1 * lx + t2 * ly + n * hh)
                    ur = rr * (0.97 if ri < 4 else 1.0)
                    uvs.append((0.5 + np.cos(ang) * ur * 0.5, 0.5 + np.sin(ang) * ur * 0.5))
            tris = []
            for k in range(seg):  # tapa
                tris.append((0, 1 + k, 1 + (k + 1) % seg))
            for ri in range(1, len(rings) - 1):
                o0, o1 = 1 + (ri - 1) * seg, 1 + ri * seg
                for k in range(seg):
                    k2 = (k + 1) % seg
                    tris.append((o0 + k, o1 + k, o1 + k2))
                    tris.append((o0 + k, o1 + k2, o0 + k2))
            pos_l.append(np.array(verts))
            uv_l.append(np.array(uvs))
            tri_l.append(np.array(tris) + start)
            ref_l.append(np.full(len(verts), a))
        pos = np.concatenate(pos_l)
        uv = np.concatenate(uv_l)
        tris = np.concatenate(tri_l)
        ref = np.concatenate(ref_l)
        b = Bin()
        b.add("refs", np.stack([ref, ref, ref], 1), "<u2")
        b.add("w", np.tile([1.0, 0.0, 0.0], (len(pos), 1)), "<f4")
        b.add("off", q16((pos - human[ref]) * UNIT, Q_POS), "<i2")
        b.add("uv", np.round(np.clip(uv, 0, 1) * 65535), "<u2")
        b.add("idx", tris, "<u2")
        size = b.save(f"{OUT}/parts/{pid}.bin")
        # Miniatura: los discos sobre fondo oscuro, colocados como van.
        th = Image.new("RGB", (96, 96), (18, 22, 30))
        disc = Image.open(f"{OUT}/tex/implant.webp").convert("RGB")
        spots = {"imp_nape": [(48, 48, 40)], "imp_spine": [(48, 20, 24), (48, 48, 28), (48, 76, 24)], "imp_temples": [(24, 48, 30), (72, 48, 30)]}[pid]
        for cx, cy, d in spots:
            m = Image.new("L", (d, d), 0)
            from PIL import ImageDraw
            ImageDraw.Draw(m).ellipse((0, 0, d - 1, d - 1), fill=255)
            th.paste(disc.resize((d, d), Image.LANCZOS), (cx - d // 2, cy - d // 2), m)
        th.save(f"{OUT}/thumbs/{pid}.webp", "WEBP", quality=85)
        entries.append({"id": pid, "cat": "implant", "file": f"parts/{pid}.bin", "bytes": size, "index": b.index, "verts": int(len(pos)),
                        "tris": int(len(tris)), "scale": {}, "z": 60, "es": es, "en": en, "tex": "tex/implant.webp",
                        "glow": "tex/implant_glow.webp", "thumb": f"thumbs/{pid}.webp"})
        print(f"  {pid:<18} implant  {len(tris):>6} tri  {size / 1e3:6.0f} kB")
    return entries


def forge_eye_mask() -> None:
    """Iris y pupila de la textura de ojos (todas comparten dibujo): para teñirlos o hacerlos brillar."""
    from scipy import ndimage

    im = np.asarray(Image.open(os.path.join(ASSETS, "eyes", "materials", "brown_eye.png")).convert("RGB").resize((256, 256), Image.LANCZOS)).astype(float)
    lum = im @ np.array([0.2126, 0.7152, 0.0722])
    sat = im.max(2) - im.min(2)
    m = np.clip((175 - lum) / 70, 0, 1) * np.clip((sat + 60 - (lum - 60) * 0.2) / 60, 0, 1)
    m = ndimage.gaussian_filter(m, 0.8)
    m = np.clip((m - 0.25) / 0.5, 0, 1)
    rgb = np.repeat(np.round(m * 255).astype(np.uint8)[..., None], 3, axis=2)
    Image.fromarray(rgb, "RGB").save(f"{OUT}/tex/eye_mask.webp", "WEBP", lossless=True)


def main() -> None:
    os.makedirs(f"{OUT}/parts", exist_ok=True)
    os.makedirs(f"{OUT}/tex", exist_ok=True)
    os.makedirs(f"{OUT}/thumbs", exist_ok=True)
    only = set(a for a in sys.argv[1:] if not a.startswith("--"))

    base, _, base_faces = read_obj(f"{MPFB}/3dobjs/base.obj")
    n = len(base)
    quads = body_quads(base_faces)
    groups = json.load(open(f"{MPFB}/mesh_metadata/basemesh_vertex_groups.json"))
    rig = json.load(open(f"{MPFB}/rigs/standard/rig.game_engine.json"))
    weights = json.load(open(f"{MPFB}/rigs/standard/weights.game_engine.json"))["weights"]
    default_human = shape(base, neutral(0.5))

    kit: dict = {"version": KIT_VERSION, "unit": UNIT, "q": Q_POS, "cage": n, "bases": {}, "body": [s[0] for s in BODY_SLIDERS],
                 "face": [s[0] for s in FACE_SLIDERS], "detail": [s[0] for s in DETAIL_SLIDERS], "parts": [], "skins": [],
                 "eyes": EYES, "humanoid": HUMANOID}

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
    for sid, lo, hi in FACE_SLIDERS + DETAIL_SLIDERS:
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
    joint_ids: dict[str, np.ndarray] = {}
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
            joint_ids[f"{name}.{end}"] = np.array(ids)
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
    # Hueso que más mueve cada vértice y qué huesos son contiguos (para saber qué piel tapa cada prenda).
    body_bone = ji[:, 0]
    near = bone_distance([x["parent"] for x in bones]) <= 1
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
        if spec["cat"] != "body":
            # La piel que cada vértice de la pieza tiene debajo: muchas prendas se atan a las «ayudas»
            # de MakeHuman (mallas que no se dibujan), no a la piel, y para ordenar capas hace falta
            # saberlo. Se busca hacia dentro, siguiendo la normal de la pieza (lo abultado, como una
            # cinturilla, cae sobre la piel de debajo y no sobre la más cercana).
            on_body = skin_under(human, quads, pos, tris)
            b.add("body", on_body, "<u2")
        if spec["cat"] in COVER_CATS:
            under, gap, deep = coverage(human, vertex_normals(human, quads), pos, tris, body_bone[on_body], body_bone, near)
            b.add("under", under, "<u2")  # piel tapada: se mete hacia dentro y ordena las capas
            b.add("gap", gap, "u1")  # a cuántos mm queda la prenda de cada una
            b.add("cover", deep, "<u2")  # piel que se quita (lejos de los bordes)
            print(f"    piel tapada {len(under)}, se quita {len(deep)}")
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
    if not only or any(x[0] in only for x in IMPLANTS):
        implant_texture()
        kit["parts"] += forge_implants(base, quads, joint_ids, body_bone, order)

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
    if not only or "--maps" in sys.argv:
        forge_skin_maps(base, quads, groups, order, ji, jw, joint_ids, body_bone, near)
        forge_eye_mask()
    kit["maps"] = {"body": "tex/body_maps.webp", "face": "tex/face_maps.webp", "skin": "tex/skin_maps.webp", "iris": "tex/eye_mask.webp",
                   "zones": __import__("maps").ZONES}

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
