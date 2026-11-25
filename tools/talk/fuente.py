#!/usr/bin/env python3
"""
Lo que usa «hablar con el cuerpo» (apps/web/src/world/people/talk.ts y talk-pose.ts) del pipeline de
vídeo de Xen (bench/xen_toon/mh_plano.py, que no es público): ver README.md.

    python3 -I tools/talk/fuente.py <mh_plano.py> --diff tools/talk/mh_plano.json
    python3 -I tools/talk/fuente.py <mh_plano.py> --write tools/talk/mh_plano.json [--leido <fecha ISO>]

El archivo se lee con `ast`: no se ejecuta nada de él (ni se importa). De lo de hablar se guardan los
datos (las manos, las posturas, las formas y los conjuntos) y una huella de cada bloque de su código;
del resto del archivo, solo huellas, sin nombres: el pipeline no es público.

--diff dice primero «CAMBIOS: sí» o «CAMBIOS: no» (en lo que usa hablar) y luego qué ha cambiado.
"""
import argparse
import ast
import copy
import datetime
import hashlib
import json
import sys

# Las formas de la mano del pipeline (talk.ts: "relaxed", "open", "point"…; ver README.md).
MANOS = ("SUELTA", "MEDIA", "ABIERTA", "INDICE", "PUNO", "PULGAR")
# Los datos que usa hablar, en orden (cada uno puede usar los de antes: SEGUIDOS lleva EMOCIONES).
DATOS = MANOS + ("POLO_BRAZO", "POSES", "FORMAS", "VIVAS", "EMOCIONES", "SEGUIDOS", "ALTOS")
# Los bloques de código de arriba del todo que usa hablar, por su clave (`def x`, `if …`, lo asignado).
CODIGO = (
    # las posturas y el plan de cada frase (trozos, variantes, golpes)
    "def _pose", "ESC_B", "GESTOS_CLAVE", "CLAVES", "FRASES", "GOLPES", "def _clave", "if GESTOS_CLAVE",
    # la vida: la voz, el muelle de la muñeca, el vaivén, los golpes, el arrastre, el hombro y la cabeza
    "VIDA", "def postura_nombre", "ENER_F", "HABLA_F", "if VIDA", "RESORTE", "def _ruido", "def _pulso",
    "def _env", "def postura_en", "def gestos_clave", "def _suaviza_q", "def _limita_q", "if GESTOS_CLAVE (2)",
    # cuánto se exagera según quién habla
    "COMICO", "AMPLIO", "FUERZA", "def tope_forma",
    # los brazos: la IK, la muñeca, los dedos y fuera del tronco
    "def ik2", "def limitar_muneca", "def brazo_a", "def empuje_tronco", "RADIO_BRAZO", "def separar_brazo",
    "def separar_brazos", "def sacar_antebrazo", "def giro_antebrazo", "def dedos", "CASCADA", "CIERRE", "AGARRE",
    "MANO_SUELTA", "REPOSO",
    # solo para Xen (su parka): normalmente no se trae
    "if QUIEN == 'xen'",
)


class NoSe(Exception):
    """Algo que este lector no sabe evaluar sin ejecutar el archivo."""


def _hash(texto, n=16):
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()[:n]


def _clave(node):
    u = ast.unparse
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        k = f"def {node.name}"
    elif isinstance(node, ast.ClassDef):
        k = f"class {node.name}"
    elif isinstance(node, ast.Assign):
        k = ", ".join(u(t) for t in node.targets)
    elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
        k = u(node.target)
    elif isinstance(node, ast.If):
        k = f"if {u(node.test)}"
    elif isinstance(node, (ast.For, ast.AsyncFor)):
        k = f"for {u(node.target)} in {u(node.iter)}"
    elif isinstance(node, ast.While):
        k = f"while {u(node.test)}"
    elif isinstance(node, (ast.With, ast.AsyncWith)):
        k = "with " + ", ".join(u(i) for i in node.items)
    elif isinstance(node, (ast.Import, ast.ImportFrom)):
        k = u(node)
    elif isinstance(node, ast.Expr):
        k = "expr " + u(node.value)
    else:
        k = type(node).__name__.lower()
    return k if len(k) <= 80 else k[:77] + "…"


def _sin_docstrings(node):
    node = copy.deepcopy(node)
    for n in ast.walk(node):
        body = getattr(n, "body", None)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and body and isinstance(body[0], ast.Expr) \
                and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
            n.body = body[1:] or [ast.Pass()]
    return node


def _huella(node):
    # Sin comentarios (no están en el árbol) ni docstrings: cambiar solo eso no es un cambio.
    return _hash(ast.unparse(_sin_docstrings(node)))


def bloques(tree):
    """Cada bloque de arriba del todo, con su clave (las repetidas, «clave (2)»…) y su huella."""
    out, vistos = {}, {}
    for node in tree.body:
        k = _clave(node)
        vistos[k] = vistos.get(k, 0) + 1
        if vistos[k] > 1:
            k = f"{k} ({vistos[k]})"
        out[k] = _huella(node)
    return out


def _valor(n, env):
    if isinstance(n, ast.Constant):
        return n.value
    if isinstance(n, (ast.Tuple, ast.List)):
        out = []
        for e in n.elts:
            if isinstance(e, ast.Starred):
                out.extend(_valor(e.value, env))
            else:
                out.append(_valor(e, env))
        return out
    if isinstance(n, ast.Set):
        return sorted(_valor(e, env) for e in n.elts)
    if isinstance(n, ast.Dict):
        out = {}
        for k, v in zip(n.keys, n.values):
            if k is None:
                out.update(_valor(v, env))
            else:
                out[_valor(k, env)] = _valor(v, env)
        return out
    if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.USub, ast.UAdd)):
        v = _valor(n.operand, env)
        return -v if isinstance(n.op, ast.USub) else v
    if isinstance(n, ast.BinOp) and isinstance(n.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
        a, b = _valor(n.left, env), _valor(n.right, env)
        if isinstance(n.op, ast.Add):
            return a + b
        if isinstance(n.op, ast.Sub):
            return a - b
        if isinstance(n.op, ast.Mult):
            return a * b
        return a / b
    if isinstance(n, ast.Name):
        if n.id in env:
            return env[n.id]
        raise NoSe(n.id)
    if isinstance(n, ast.IfExp):
        return {"si": ast.unparse(n.test), "entonces": _valor(n.body, env), "si_no": _valor(n.orelse, env)}
    if isinstance(n, ast.Call) and isinstance(n.func, ast.Name):
        if n.func.id == "_pose":
            return _pose(n, env)
        if n.func.id in ("dict", "tuple", "list", "set") and not n.keywords and len(n.args) <= 1:
            v = _valor(n.args[0], env) if n.args else ([] if n.func.id != "dict" else {})
            return sorted(v) if n.func.id == "set" else v
    raise NoSe(ast.unparse(n)[:60])


def _pose(call, env):
    """Una postura, con los nombres de `_pose(ik, y, z, d, polo)`: la mano por su nombre si es una de MANOS."""
    nombres = ("ik", "y", "z", "d", "polo")
    args = dict(zip(nombres, call.args))
    args.update({k.arg: k.value for k in call.keywords})
    if any(k not in args for k in nombres[:4]) or len(call.args) > len(nombres):
        raise NoSe(ast.unparse(call)[:60])
    d = args["d"]
    polo = args.get("polo")
    return {
        "ik": _valor(args["ik"], env),
        "y": _valor(args["y"], env),
        "z": _valor(args["z"], env),
        "dedos": d.id if isinstance(d, ast.Name) and d.id in MANOS else _valor(d, env),
        "polo": None if polo is None or (isinstance(polo, ast.Constant) and polo.value is None) else _valor(polo, env),
    }


def datos(tree):
    """Los DATOS (la primera vez que se asigna cada uno; antes los de arriba del todo) y lo que no se ha podido leer."""
    asign = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            asign.setdefault(node.targets[0].id, node.value)
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            asign.setdefault(node.targets[0].id, node.value)
    env, out, mal = {}, {}, {}
    for nombre in DATOS:
        if nombre not in asign:
            mal[nombre] = "ya no está en el archivo"
            continue
        try:
            out[nombre] = env[nombre] = _valor(asign[nombre], env)
        except NoSe as e:
            mal[nombre] = f"no sé leer «{e}»"
    return out, mal


def leer(ruta):
    src = open(ruta, encoding="utf-8").read()
    tree = ast.parse(src)
    d, mal = datos(tree)
    todo = bloques(tree)
    codigo = {k: v for k, v in todo.items() if k in CODIGO}
    otros = {k: v for k, v in todo.items() if k not in CODIGO and k not in DATOS}
    return {"sha256": hashlib.sha256(src.encode("utf-8")).hexdigest(), "datos": d, "no_leidos": mal,
            "codigo": codigo, "otros": otros}


def instantanea(leido, cuando):
    # Del resto del archivo, solo huellas: ni sus nombres.
    return {
        "fuente": "bench/xen_toon/mh_plano.py (pipeline de vídeo de Xen)",
        "leido": cuando,
        "sha256": leido["sha256"],
        "datos": leido["datos"],
        **({"no_leidos": leido["no_leidos"]} if leido["no_leidos"] else {}),
        "codigo": leido["codigo"],
        "otros": {"#" + _hash(k, 12): v for k, v in sorted(leido["otros"].items())},
    }


def _json(v, ind=0):
    """JSON con lo que cabe en una línea, en una línea (más fácil de comparar en una PR)."""
    linea = json.dumps(v, ensure_ascii=False)
    if not isinstance(v, (dict, list)) or len(linea) + ind <= 150:
        return linea
    pad = " " * (ind + 1)
    if isinstance(v, dict):
        cosas = [f"{pad}{json.dumps(k, ensure_ascii=False)}: {_json(x, ind + 1)}" for k, x in v.items()]
        return "{\n" + ",\n".join(cosas) + "\n" + " " * ind + "}"
    return "[\n" + ",\n".join(pad + _json(x, ind + 1) for x in v) + "\n" + " " * ind + "]"


def _corto(v):
    return json.dumps(v, ensure_ascii=False)


def comparar(antes, ahora):
    """Las líneas del informe y si hay cambios en lo que usa hablar."""
    lineas, hay = [], False
    if ahora["sha256"] == antes.get("sha256"):
        return ["CAMBIOS: no (el archivo es el mismo que la última vez)"], False
    da, dn = antes.get("datos", {}), ahora["datos"]

    def por_nombre(titulo, a, b):
        nonlocal hay
        out = []
        for k in b:
            if k not in a:
                out.append(f"  + {k}: {_corto(b[k])}")
        for k in a:
            if k not in b:
                out.append(f"  - {k} (ya no está)")
        for k in b:
            if k in a and a[k] != b[k]:
                if isinstance(a[k], dict) and isinstance(b[k], dict):
                    partes = [f"{c}: {_corto(a[k].get(c))} → {_corto(b[k].get(c))}"
                              for c in list(dict.fromkeys([*a[k], *b[k]])) if a[k].get(c) != b[k].get(c)]
                    out.append(f"  ~ {k}: " + "; ".join(partes))
                elif isinstance(a[k], list) and isinstance(b[k], list) and all(isinstance(x, str) for x in a[k] + b[k]):
                    mas = [x for x in b[k] if x not in a[k]]
                    menos = [x for x in a[k] if x not in b[k]]
                    cambio = ", ".join([*(f"+{x}" for x in mas), *(f"-{x}" for x in menos)]) or "el orden"
                    out.append(f"  ~ {k}: {cambio}")
                else:
                    out.append(f"  ~ {k}: {_corto(a[k])} → {_corto(b[k])}")
        if out:
            hay = True
            lineas.append(titulo)
            lineas.extend(out)

    por_nombre("Posturas (POSES):", da.get("POSES", {}), dn.get("POSES", {}))
    por_nombre("Formas (FORMAS):", da.get("FORMAS", {}), dn.get("FORMAS", {}))
    por_nombre("Manos:", {k: da[k] for k in MANOS if k in da}, {k: dn[k] for k in MANOS if k in dn})
    resto = ("POLO_BRAZO", "VIVAS", "EMOCIONES", "SEGUIDOS", "ALTOS")
    por_nombre("Conjuntos y el polo del codo:", {k: da[k] for k in resto if k in da}, {k: dn[k] for k in resto if k in dn})
    if ahora["no_leidos"]:
        hay = True
        lineas.append("No se ha podido leer (míralo en el archivo):")
        lineas.extend(f"  ! {k}: {v}" for k, v in ahora["no_leidos"].items())

    ca, cn = antes.get("codigo", {}), ahora["codigo"]
    cod = [f"  ~ {k}" for k in cn if k in ca and ca[k] != cn[k]]
    cod += [f"  + {k}" for k in cn if k not in ca]
    cod += [f"  - {k} (ya no está)" for k in ca if k not in cn]
    if cod:
        hay = True
        lineas.append("Código de hablar (léelo en el archivo nuevo y compáralo con talk.ts / talk-pose.ts):")
        lineas.extend(cod)

    oa = antes.get("otros", {})
    cambiados, nuevos, vistos = [], [], set()
    for k, v in ahora["otros"].items():
        h = "#" + _hash(k, 12)
        vistos.add(h)
        if h not in oa:
            nuevos.append(k)
        elif oa[h] != v:
            cambiados.append(k)
    quitados = len([h for h in oa if h not in vistos])
    if cambiados or nuevos or quitados:
        lineas.append("Otras partes del archivo (no son de hablar; mira si algo nuevo lo es):")
        if cambiados:
            lineas.append(f"  ~ {len(cambiados)} cambiadas: " + ", ".join(cambiados))
        if nuevos:
            lineas.append(f"  + {len(nuevos)} nuevas: " + ", ".join(nuevos))
        if quitados:
            lineas.append(f"  - {quitados} quitadas")
    return [f"CAMBIOS: {'sí' if hay else 'no'} (copia anterior: {antes.get('leido', '?')})", *lineas], hay


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("archivo", help="la copia de mh_plano.py")
    ap.add_argument("--diff", metavar="JSON", help="compara con lo que se trajo la última vez")
    ap.add_argument("--write", metavar="JSON", help="guarda lo leído como lo último que se ha traído")
    ap.add_argument("--leido", help="cuándo se copió el archivo (ISO; si no, ahora)")
    a = ap.parse_args()
    try:
        leido = leer(a.archivo)
    except (OSError, SyntaxError, UnicodeDecodeError) as e:
        print(f"No se puede leer {a.archivo}: {e}", file=sys.stderr)
        return 2
    if a.diff:
        antes = json.load(open(a.diff, encoding="utf-8"))
        lineas, _ = comparar(antes, leido)
        print("\n".join(lineas))
    if a.write:
        cuando = a.leido or datetime.datetime.now().astimezone().isoformat(timespec="minutes")
        with open(a.write, "w", encoding="utf-8") as f:
            f.write(_json(instantanea(leido, cuando)) + "\n")
        print(f"Guardado {a.write}")
    if not a.diff and not a.write:
        sys.stdout.write(_json(instantanea(leido, a.leido or "")) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
