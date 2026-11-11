"""
El Gran Premio Neón: el circuito de coches de Arcade (el único distrito con coches).

Da la vuelta al distrito por la franja de fuera (26 m entre las parcelas y el borde), en el sentido
contrario a las agujas del reloj visto desde arriba. Lo que tiene, en orden desde la parrilla (al
sureste, a la derecha de quien llega del nexo):

  1. Curva peraltada del sureste y la recta del este (con sus placas de turbo).
  2. Curva del noreste y la recta del norte, con su chicane.
  3. Curva del noroeste y la recta del oeste, con un cambio de rasante.
  4. Curva del suroeste, turbo y **el looping**: entra por el carril de fuera y sale por el de dentro.
  5. La rampa y **el salto sobre la avenida de la puerta** (quien llega al distrito ve pasar los
     coches por encima) y la recta de meta.

Aquí está todo lo que sale del trazado, de una sola lista de tramos (`plan()`): la malla que se ve y
con la que se choca (es la misma: `mesh_collider`), los puntos de la carrera, la parrilla, las placas
de turbo, los carteles y los marcadores (`write_activities`). La parte de geometría no necesita
Blender: `python3 tools/forge/circuit.py <salida.json>` vuelca la pista para las pruebas.

Coordenadas del chunk (X este, Y arriba, Z sur). El rumbo `a` se mide de este (0) hacia el sur
(+90°): girar a la izquierda es restarle.
"""
from __future__ import annotations

import json
import math
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ACTIVITIES = os.path.join(ROOT, "apps", "realtime", "src", "district-activities.json")
# La línea central del trazado, para la prueba que da la vuelta con el coche de verdad (test:race).
LINE = os.path.join(ROOT, "apps", "web", "test", "circuit-line.json")

W = 9.0            # ancho de la calzada (m)
W_LOOP = 6.5       # y dentro del looping
BASE = 0.22        # altura de la calzada en llano (un bordillo sobre el suelo del distrito)
CURVE_R = 20.0     # radio de las cuatro curvas (por el centro)
BANK = 24.0        # peralte de las curvas (grados)...
BANK_SW = 12.0     # ...menos la del suroeste: sale directa al looping, y con menos peralte la pista baja antes
RAMP_IN = 30.0     # metros de recta en los que la pista sube hasta la curva (y baja al salir)...
BANK_RUN = 16.0    # ...y, de ellos, los últimos en los que se inclina


def lift_of(bank_deg: float) -> float:
    """Lo que sube el centro de la calzada para que, inclinada, su borde de dentro no baje del suelo."""
    return (W / 2) * math.sin(math.radians(bank_deg))
WALL_H = 0.95      # quitamiedos (donde la pista va inclinada, en alto o en el looping): más altos que el costado del coche, que si no se engancha en su canto al rozarlos
EDGE = 0.35        # ancho de las líneas de luz de los bordes

# El cambio de rasante de la recta del oeste: lo que sube y en cuántos metros (y otros tantos de bajada).
CREST_H, CREST_RUN = 2.2, 35.0

# La chicane de la recta del norte: radio de sus arcos y cuánto gira el primero (grados).
CHICANE_R, CHICANE_TURN = 32.0, 17.0

# Dónde va (por el centro de la calzada): las cuatro rectas y sus carriles.
X_EAST, X_WEST = 147.0, -83.0
Z_NORTH = -78.0
Z_OUT, Z_IN = 150.5, 141.5      # el sur: carril de fuera (antes del looping) y de dentro (después)
LOOP_SHIFT = Z_OUT - Z_IN       # lo que el looping lleva la pista hacia dentro

# El looping: la curvatura sube poco a poco al entrar y baja al salir (una lágrima, no un círculo:
# así no hay un golpe al empezar a subir) y arriba es más cerrado, que es donde menos corre el coche.
LOOP_R = 9.0       # radio de la parte de arriba (m)
LOOP_EASE = 22.0   # metros de entrada (y de salida) en los que la curvatura va de 0 a 1/LOOP_R
LOOP_IN = -29.0    # dónde empieza a subir (x); sale unos 21 m más adelante, por el otro carril
SW_OUT = 22.0      # la salida de la curva del suroeste es más corta: detrás van el looping y el salto

# El salto sobre la avenida de la puerta (x de 26 a 38): rampa, hueco y rampa de caída.
JUMP_FROM, JUMP_LIP, JUMP_LAND, JUMP_END = -5.0, 25.4, 38.6, 74.0
JUMP_H, LAND_H = 2.6, 1.5

# La recta de meta: la línea y la parrilla (cuatro filas de dos, en el llano que queda entre la
# caída del salto y la subida a la curva del sureste). La salida (el círculo en el que hay que
# pararse para entrar en la carrera) va en su centro: todos los cajones caen dentro de su radio.
FINISH_X = 76.0
GRID_X = [81.5, 86.5, 91.5, 96.5]
GRID_Z = [Z_IN - 2.2, Z_IN + 2.2]
START = (89.0, Z_IN)

# Placas de turbo: en qué tramo (marca) y a cuántos metros de su principio.
TURBOS = [("east", 40.0), ("chicane_end", 12.0), ("west", 40.0), ("south", 27.0), ("ramp", 4.0)]


def _smooth(u: float) -> float:
    u = min(1.0, max(0.0, u))
    return u * u * (3 - 2 * u)


class Path:
    """Tortuga que va dejando secciones de pista: centro, tangente, normal (hacia arriba de la calzada) e izquierda."""

    def __init__(self, x: float, z: float, heading_deg: float, y: float = BASE):
        self.x, self.z, self.y = x, z, y
        self.a = math.radians(heading_deg)
        self.s = 0.0
        self.frames: list[dict] = []
        self.marks: dict[str, float] = {}

    # -- utilidades ------------------------------------------------------------------
    def _axes(self):
        ca, sa = math.cos(self.a), math.sin(self.a)
        return (ca, 0.0, sa), (sa, 0.0, -ca)  # adelante (en planta) e izquierda

    def _emit(self, pitch: float, bank: float, w: float, **attrs) -> None:
        th, left = self._axes()
        cp, sp = math.cos(pitch), math.sin(pitch)
        t = (th[0] * cp, sp, th[2] * cp)
        up = (-th[0] * sp, cp, -th[2] * sp)
        cb, sb = math.cos(bank), math.sin(bank)
        n = (up[0] * cb + left[0] * sb, up[1] * cb + left[1] * sb, up[2] * cb + left[2] * sb)
        b = (left[0] * cb - up[0] * sb, left[1] * cb - up[1] * sb, left[2] * cb - up[2] * sb)
        self._push((self.x, self.y, self.z), t, n, b, w, bank=bank, **attrs)

    def _push(self, p, t, n, b, w, **attrs) -> None:
        if self.frames:
            q = self.frames[-1]["p"]
            self.s += math.dist(p, q)
        f = {"p": p, "t": t, "n": n, "b": b, "w": w, "s": self.s, "solid": True, "walls": (False, False), "skirt": False, "zone": "road"}
        f.update(attrs)
        self.frames.append(f)

    def mark(self, name: str) -> None:
        self.marks[name] = self.s

    # -- tramos ----------------------------------------------------------------------
    def straight(self, length: float, y1: float | None = None, shape: str = "smooth", bank=(0.0, 0.0), step: float = 4.0,
                 w=(W, W), bank_span=(0.0, 1.0), **attrs) -> None:
        """
        Recta de `length` m. `y1`: la altura a la que acaba; `shape` dice cómo sube o baja:
        "smooth" (en S), "launch" (coge pendiente y la mantiene hasta el final, para despegar) o
        "land" (cae con pendiente y acaba llana). `bank`: peralte al empezar y al acabar (grados),
        que cambia en el trozo `bank_span` de la recta (de 0 a 1).
        """
        y0 = self.y
        y1 = y0 if y1 is None else y1
        n = max(1, round(length / step))
        th, _ = self._axes()
        x0, z0 = self.x, self.z

        def height(u: float) -> float:
            if shape == "ramp":
                # Media parábola hacia arriba y media hacia abajo: la subida más suave posible para esa
                # altura (la calzada que sube a una curva peraltada no debe hacer de trampolín).
                f = 2 * u * u if u < 0.5 else 1 - 2 * (1 - u) * (1 - u)
                return y0 + (y1 - y0) * f
            if shape == "launch":
                k = 0.4  # hasta aquí coge pendiente; después es una rampa recta
                f = u * u / (k * (2 - k)) if u <= k else (2 * u - k) / (2 - k)
                return y0 + (y1 - y0) * f
            if shape == "land":
                return y1 + (y0 - y1) * (1 - u) * (1 - u)
            return y0 + (y1 - y0) * _smooth(u)

        first = 0 if not self.frames or attrs.get("restart") else 1
        attrs.pop("restart", None)
        for i in range(first, n + 1):
            u = i / n
            self.x, self.z = x0 + th[0] * length * u, z0 + th[2] * length * u
            self.y = height(u)
            e = 1e-3
            pitch = math.atan2(height(min(1, u + e)) - height(max(0, u - e)), length * (min(1, u + e) - max(0, u - e)))
            bu = (u - bank_span[0]) / max(1e-6, bank_span[1] - bank_span[0])
            bank_now = math.radians(bank[0] + (bank[1] - bank[0]) * _smooth(bu))
            self._emit(pitch, bank_now, w[0] + (w[1] - w[0]) * _smooth(u), **attrs)

    def arc(self, radius: float, turn_deg: float, bank_deg: float = 0.0, step: float = 1.6, w: float = W, **attrs) -> None:
        """Curva de `turn_deg` grados (positivo = a la izquierda) con su peralte (la calzada cae hacia dentro)."""
        turn = math.radians(turn_deg)
        n = max(2, round(abs(turn) * radius / step))
        side = 1.0 if turn > 0 else -1.0
        th, left = self._axes()
        cx, cz = self.x + left[0] * radius * side, self.z + left[2] * radius * side
        a0 = self.a
        for i in range(1, n + 1):
            self.a = a0 - turn * i / n
            _, lf = self._axes()
            self.x, self.z = cx - lf[0] * radius * side, cz - lf[2] * radius * side
            self._emit(0.0, math.radians(bank_deg) * side, w, **attrs)

    def gap(self, length: float, y1: float) -> None:
        """Un hueco (el salto): la pista sigue más allá, a la altura `y1`, sin nada en medio."""
        th, _ = self._axes()
        self.frames[-1]["cut"] = True  # aquí se acaba la calzada: lleva su frente
        self.x, self.z, self.y = self.x + th[0] * length, self.z + th[2] * length, y1
        self.s += length

    def loop(self, radius: float, ease: float, shift: float, w: float = W_LOOP, step: float = 1.0, **attrs) -> None:
        """
        El looping: una vuelta entera hacia arriba en el plano del rumbo, mientras la pista se va
        `shift` m hacia la izquierda (entra por un carril y sale por el de al lado). Empieza y acaba
        llano, a la misma altura. La tortuga queda en la salida.
        """
        k = 1.0 / radius
        hold = 2 * math.pi / k - ease          # metros a curvatura máxima (el total gira 2π)
        if hold < 0:
            raise ValueError("looping: la entrada es demasiado larga para ese radio")
        total = 2 * ease + hold
        n = max(8, round(total / step))
        th, left = self._axes()
        x0, y0, z0 = self.x, self.y, self.z

        def curv(s: float) -> float:
            if s < ease:
                return k * s / ease
            if s > total - ease:
                return k * (total - s) / ease
            return k

        # Se integra el perfil (X a lo largo, Y arriba) con pasos finos y se queda con n secciones.
        fine = 40
        theta = X = Y = 0.0
        ds = total / (n * fine)
        pts = [(0.0, 0.0, 0.0)]
        for i in range(1, n * fine + 1):
            s_mid = (i - 0.5) * ds
            th_mid = theta + curv(s_mid) * ds / 2
            X += math.cos(th_mid) * ds
            Y += math.sin(th_mid) * ds
            theta += curv(s_mid) * ds
            if i % fine == 0:
                pts.append((X, Y, theta))
        for i in range(1, n + 1):
            X, Y, theta = pts[i]
            u = i / n
            g = shift * _smooth(u)
            dg = shift * 6 * u * (1 - u) / total  # d(desplazamiento)/ds
            p = (x0 + th[0] * X + left[0] * g, y0 + Y, z0 + th[2] * X + left[2] * g)
            ct, st = math.cos(theta), math.sin(theta)
            t = (th[0] * ct + left[0] * dg, st, th[2] * ct + left[2] * dg)
            tl = math.hypot(*t)
            t = (t[0] / tl, t[1] / tl, t[2] / tl)
            nrm = (-th[0] * st, ct, -th[2] * st)
            # La normal, perpendicular a la tangente (el desplazamiento lateral la tuerce un pelín).
            d = nrm[0] * t[0] + nrm[1] * t[1] + nrm[2] * t[2]
            nrm = (nrm[0] - d * t[0], nrm[1] - d * t[1], nrm[2] - d * t[2])
            nl = math.hypot(*nrm)
            nrm = (nrm[0] / nl, nrm[1] / nl, nrm[2] / nl)
            b = (nrm[1] * t[2] - nrm[2] * t[1], nrm[2] * t[0] - nrm[0] * t[2], nrm[0] * t[1] - nrm[1] * t[0])
            self._push(p, t, nrm, b, w, bank=0.0, pitch=theta, **attrs)
        X, Y, _ = pts[-1]
        self.x, self.y, self.z = x0 + th[0] * X + left[0] * shift, y0 + Y, z0 + th[2] * X + left[2] * shift
        self.loop_size = {"length": total, "advance": X, "top": max(p[1] for p in pts), "x_min": min(p[0] for p in pts), "x_max": max(p[0] for p in pts)}


def loop_profile(radius: float = LOOP_R, ease: float = LOOP_EASE) -> dict:
    """Medidas del looping (para colocarlo): cuánto avanza de la entrada a la salida, su alto y lo que sobresale."""
    p = Path(0, 0, 0, 0)
    p._emit(0, 0, W_LOOP)
    p.loop(radius, ease, 0.0)
    return p.loop_size


def plan() -> dict:
    """El trazado entero: secciones de pista (en orden, desde la línea de meta) y dónde va cada cosa."""
    lp = loop_profile()
    loop_in = LOOP_IN
    loop_out = loop_in + lp["advance"]
    r = CURVE_R
    walls = {"walls": (True, True)}
    p = Path(FINISH_X, Z_IN, 0.0)

    def into(bank: float = BANK, length: float = RAMP_IN) -> None:
        """Hacia una curva: la pista sube y, al final, se inclina (el quitamiedos, por fuera)."""
        p.straight(length, y1=BASE + lift_of(bank), shape="ramp", bank=(0, bank), bank_span=(1 - BANK_RUN / length, 1.0), step=2.0, walls=(False, True), zone="bank")

    def out_of(bank: float = BANK, length: float = RAMP_IN) -> None:
        p.straight(length, y1=BASE, shape="ramp", bank=(bank, 0), bank_span=(0.0, BANK_RUN / length), step=2.0, walls=(False, True), zone="bank")

    def curve(bank: float = BANK) -> None:
        p.arc(r, 90, bank, walls=(False, True), zone="curve")

    p.mark("finish")
    # Recta de meta y parrilla, hasta donde la pista empieza a subir hacia la curva del sureste.
    se = X_EAST - r                       # donde empieza la curva (x)
    p.straight(se - RAMP_IN - FINISH_X, zone="grid")
    into()
    curve()
    # Recta del este (hacia el norte): turbo y a fondo.
    z_ne = Z_NORTH + r                    # donde empieza la curva del noreste (z)
    east = (Z_IN - r) - z_ne
    p.mark("east")
    out_of()
    p.straight(east - 2 * RAMP_IN)
    into()
    curve()
    # Recta del norte (hacia el oeste), con la chicane en medio.
    north = (X_EAST - r) - (X_WEST + r)
    p.mark("north")
    out_of()
    lead = (north - 2 * RAMP_IN - chicane_advance()) / 2
    p.straight(lead)
    p.mark("chicane")
    for turn in chicane_turns():          # a la derecha, a la izquierda y de vuelta a su línea
        p.arc(CHICANE_R, turn, 0, zone="chicane")
    p.mark("chicane_end")
    p.straight(lead)
    into()
    curve()
    # Recta del oeste (hacia el sur), con el cambio de rasante.
    z_sw = Z_OUT - r
    west = z_sw - z_ne
    p.mark("west")
    out_of()
    flat = (west - 2 * RAMP_IN - 2 * CREST_RUN) / 2
    p.straight(flat)
    p.mark("crest")
    p.straight(CREST_RUN, y1=BASE + CREST_H, step=2.5, zone="crest")
    p.straight(CREST_RUN, y1=BASE, step=2.5, zone="crest")
    p.straight(flat)
    into(BANK_SW)
    curve(BANK_SW)
    # El sur: sale de la curva por el carril de fuera, turbo, y el looping lo lleva al de dentro.
    p.mark("south")
    out_of(BANK_SW, SW_OUT)
    run = loop_in - (X_WEST + r) - SW_OUT
    # La pista se estrecha hacia el looping entre dos quitamiedos (un embudo): quien llega pegado a
    # un lado roza y entra, en vez de salirse y dar de frente con el principio del quitamiedos.
    p.straight(run, w=(W, W_LOOP), step=2.0, **walls)
    p.mark("loop")
    p.loop(LOOP_R, LOOP_EASE, LOOP_SHIFT, zone="loop", **walls)
    p.mark("loop_end")
    # Del looping a la rampa: vuelve a su ancho. Rampa, salto sobre la avenida y caída.
    p.straight(JUMP_FROM - loop_out, w=(W_LOOP, W), step=1.5, **walls)
    p.mark("ramp")
    p.straight(JUMP_LIP - JUMP_FROM, y1=JUMP_H, shape="launch", step=2.0, zone="ramp", **walls)
    p.mark("lip")
    p.gap(JUMP_LAND - JUMP_LIP, LAND_H)
    p.mark("land")
    p.straight(JUMP_END - JUMP_LAND, y1=BASE, shape="land", step=2.0, zone="ramp", restart=True, **walls)
    p.straight(FINISH_X - JUMP_END)
    p.mark("end")
    if run < 8 or JUMP_FROM - loop_out < 2:
        raise ValueError("circuito: el looping no cabe entre la curva y la rampa")
    turbos = [p.marks[m] + d for m, d in TURBOS]
    return {"frames": p.frames, "marks": p.marks, "length": p.s, "loop": {**lp, "in": loop_in, "out": loop_out}, "turbos": turbos}


def chicane_turns() -> list[float]:
    """
    Los cuatro arcos de la chicane (grados; positivo = izquierda): se va a la derecha, cruza a la
    izquierda y vuelve a su línea con el mismo rumbo. El arco del medio es más largo para que los dos
    bultos midan lo mismo.
    """
    a = math.radians(CHICANE_TURN)
    b = math.degrees(math.acos(2 * math.cos(a) - 1))
    return [-CHICANE_TURN, CHICANE_TURN + b, -(b + CHICANE_TURN), CHICANE_TURN]


def chicane_advance() -> float:
    """Cuánto avanza la chicane a lo largo de la recta (m)."""
    q = Path(0, 0, 180.0)
    q._emit(0, 0, W)
    for turn in chicane_turns():
        q.arc(CHICANE_R, turn)
    return abs(q.x)


def at(pl: dict, s: float) -> dict:
    """La sección de pista que toca a `s` metros de la meta (interpolada)."""
    fr = pl["frames"]
    s = s % pl["length"]
    for i in range(1, len(fr)):
        if fr[i]["s"] >= s:
            a, b = fr[i - 1], fr[i]
            k = (s - a["s"]) / max(1e-6, b["s"] - a["s"])
            mix = lambda u, v: tuple(u[j] + (v[j] - u[j]) * k for j in range(3))  # noqa: E731
            return {"p": mix(a["p"], b["p"]), "t": mix(a["t"], b["t"]), "n": mix(a["n"], b["n"]), "b": mix(a["b"], b["b"]), "w": a["w"] + (b["w"] - a["w"]) * k}
    return fr[-1]


# --------------------------------------------------------------------------------------
# La malla: calzada, líneas de luz de los bordes, quitamiedos y faldones
# --------------------------------------------------------------------------------------

def _add(a, b, k):
    return (a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k)


FLARE = 1.1        # lo que se abre hacia fuera el principio (y el final) de un quitamiedos (m)
STUB_H = 0.08      # y la altura con la que empieza: sube en cuña, no hay un canto contra el que chocar
DASH_W = 0.2       # ancho de la línea central (m)
DASH_ON, DASH_GAP = 3.0, 4.5   # trazo y hueco de la línea central (m)


def strips(pl: dict) -> list[dict]:
    """
    Las tiras de caras de la pista, sección a sección: cada una con su material (`kind`) y sus
    cuatro esquinas (en coordenadas del chunk). Es lo que se dibuja y con lo que se choca.
    """
    out: list[dict] = []
    fr = pl["frames"]
    n = len(fr)

    def quad(kind, a, b, c, d):
        out.append({"kind": kind, "q": (a, b, c, d)})

    def section(f):
        """Puntos de la sección: bordes de la calzada, de las líneas de luz y de fuera (con su grosor)."""
        p, b, w = f["p"], f["b"], f["w"]
        h = w / 2
        return {
            "L": _add(p, b, h), "R": _add(p, b, -h),
            "Li": _add(p, b, h - EDGE), "Ri": _add(p, b, -(h - EDGE)),
            "Lb": _add(p, b, h + 0.3), "Rb": _add(p, b, -(h + 0.3)),
        }

    def ground(q):
        return (q[0], 0.0, q[2])

    def rail_pts(f, sign, height, flare):
        """Un quitamiedos en la sección `f`: pie y canto de dentro, canto y pie de fuera."""
        p, b, nn = f["p"], f["b"], f["n"]
        h = f["w"] / 2 + flare
        foot_in, foot_out = _add(p, b, sign * h), _add(p, b, sign * (h + 0.3))
        if flare > 0:
            # Abierto hacia fuera ya no pisa la calzada: baja hasta el suelo.
            foot_in, foot_out = ground(foot_in), ground(foot_out)
            return foot_in, _add(_add(p, b, sign * h), nn, height), _add(_add(p, b, sign * (h + 0.3)), nn, height), foot_out
        return foot_in, _add(foot_in, nn, height), _add(foot_out, nn, height), foot_out

    def rail(a, b, sign, has0, has1):
        """
        El quitamiedos de un lado entre dos secciones. Donde empieza no hay un canto contra el que
        chocar: arranca bajo y abierto hacia fuera, y en ese tramo sube y se cierra hasta el borde
        (a quien llega un poco salido lo mete en la pista). Donde acaba, baja en cuña sin abrirse:
        quien viene rozándolo sigue recto por la pista.
        """
        if not (has0 or has1):
            return
        A = rail_pts(a, sign, WALL_H if has0 else STUB_H, 0.0 if has0 else FLARE)
        B = rail_pts(b, sign, WALL_H if has1 else STUB_H, 0.0)
        faces = [("wall", A[1], A[0], B[0], B[1]), ("rail", A[2], A[1], B[1], B[2]), ("wall", A[3], A[2], B[2], B[3])]
        for kind, q0, q1, q2, q3 in faces:
            if sign > 0:
                quad(kind, q0, q1, q2, q3)
            else:
                quad(kind, q1, q0, q3, q2)
        # La testa (donde arranca y donde acaba), para que no se vea hueco por dentro.
        if not has0:
            quad("wall", *( (A[0], A[1], A[2], A[3]) if sign > 0 else (A[3], A[2], A[1], A[0]) ))
        if not has1:
            quad("wall", *( (B[3], B[2], B[1], B[0]) if sign > 0 else (B[0], B[1], B[2], B[3]) ))

    for i in range(n):
        a = fr[i]
        b = fr[(i + 1) % n]
        if a.get("cut"):
            continue
        A, B = section(a), section(b)
        zone = b["zone"]
        # Calzada (dos líneas de luz y el firme) y, en la parrilla y la meta, su material.
        quad("edge", A["L"], A["Li"], B["Li"], B["L"])
        quad(zone, A["Li"], A["Ri"], B["Ri"], B["Li"])
        quad("edge", A["Ri"], A["R"], B["R"], B["Ri"])
        # Línea central a trazos (en el looping, seguida): un pelo por encima del firme.
        mid = (a["s"] + b["s"]) / 2
        if zone != "grid" and (zone == "loop" or mid % (DASH_ON + DASH_GAP) < DASH_ON):
            up_a, up_b = _add(a["p"], a["n"], 0.012), _add(b["p"], b["n"], 0.012)
            quad("dash", _add(up_a, a["b"], DASH_W / 2), _add(up_a, a["b"], -DASH_W / 2), _add(up_b, b["b"], -DASH_W / 2), _add(up_b, b["b"], DASH_W / 2))
        wl, wr = b["walls"]
        wl0, wr0 = a["walls"]
        rail(a, b, 1.0, wl0, wl)
        rail(a, b, -1.0, wr0, wr)
        # Faldones hasta el suelo donde la pista va en alto (rampas, cambio de rasante, peraltes).
        high = max(a["p"][1], b["p"][1]) > BASE + 0.05 or abs(a.get("bank", 0)) > 0.01 or abs(b.get("bank", 0)) > 0.01
        if zone == "loop":
            # El looping es una viga: cantos y panza, con costillas de luz (de lejos se ve un aro a trazos).
            th = 0.45
            Lu, Ru = _add(A["Lb"], a["n"], -th), _add(A["Rb"], a["n"], -th)
            Lv, Rv = _add(B["Lb"], b["n"], -th), _add(B["Rb"], b["n"], -th)
            if not (wl and wl0):
                quad("wall", A["Lb"], A["L"], B["L"], B["Lb"])
                quad("wall", A["R"], A["Rb"], B["Rb"], B["R"])
            lit = i % 3 == 0
            quad("rib" if lit else "beam", Lu, A["Lb"], B["Lb"], Lv)
            quad("rib" if lit else "beam", A["Rb"], Ru, Rv, B["Rb"])
            if lit:
                # Costilla en la panza: una franja de luz de lado a lado, y el resto oscuro.
                k = 0.3
                Lm = tuple(Lu[c] + (Lv[c] - Lu[c]) * k for c in range(3))
                Rm = tuple(Ru[c] + (Rv[c] - Ru[c]) * k for c in range(3))
                quad("rib", Ru, Lu, Lm, Rm)
                quad("belly", Rm, Lm, Lv, Rv)
            else:
                quad("belly", Ru, Lu, Lv, Rv)
        elif high or b["skirt"] or a["skirt"]:
            eL = "Lb" if (wl and wl0) else "L"
            eR = "Rb" if (wr and wr0) else "R"
            quad("skirt", ground(A[eL]), A[eL], B[eL], ground(B[eL]))
            quad("skirt", A[eR], ground(A[eR]), ground(B[eR]), B[eR])
        else:
            # En llano: un bordillo en rampa a cada lado, para subir y bajar de la pista con el coche
            # (donde hay quitamiedos, el bordillo queda por fuera de él).
            la, lb = _add(A["L"], a["b"], 0.9), _add(B["L"], b["b"], 0.9)
            ra, rb = _add(A["R"], a["b"], -0.9), _add(B["R"], b["b"], -0.9)
            quad("kerb", ground(la), A["L"], B["L"], ground(lb))
            quad("kerb", A["R"], ground(ra), ground(rb), B["R"])
    # Los frentes del salto: donde se corta la calzada y donde vuelve a empezar. Dan a la avenida de
    # la puerta (es lo primero que ve quien llega): llevan dos franjas de luz.
    def front(S, flip):
        lo_l, lo_r = ground(S["Lb"]), ground(S["Rb"])
        pts = (S["Rb"], lo_r, lo_l, S["Lb"]) if not flip else (S["Lb"], lo_l, lo_r, S["Rb"])
        quad("front", *pts)
        top = min(S["Lb"][1], S["Rb"][1])
        out_x = 0.03 if not flip else -0.03   # un pelo por delante de la cara (hacia la avenida)
        for y0, y1 in ((top - 0.34, top - 0.1), (0.22, 0.4)):
            if y1 <= y0 or y0 < 0.1:
                continue
            band = [(q[0] + out_x, y, q[2]) for q, y in ((pts[0], y1), (pts[1], y0), (pts[2], y0), (pts[3], y1))]
            quad("glow", *band)

    for i in range(n):
        a = fr[i]
        if a.get("cut"):
            front(section(a), False)
            front(section(fr[(i + 1) % n]), True)
    return out


# --------------------------------------------------------------------------------------
# Lo que se forja (Blender): la pista con sus colores y su decorado
# --------------------------------------------------------------------------------------

BLUE, MAGENTA, YELLOW, RED, CYAN, WHITE = "#4fa3ff", "#ff4fd8", "#ffd54f", "#ff4f6d", "#36d9ff", "#eef2ff"
# De qué color es la luz de los bordes en cada tramo (y el firme, si cambia).
ZONE_LIGHT = {"road": BLUE, "grid": WHITE, "bank": BLUE, "curve": MAGENTA, "chicane": RED, "crest": CYAN, "loop": MAGENTA, "ramp": YELLOW}
ZONE_ROAD = {"loop": "#2b2140", "ramp": "#2a2a36", "grid": "#262b3a"}
ROAD = "#1e2434"
# El pórtico de salida (delante de la parrilla, con sus semáforos) y las torres del looping.
GANTRY_X = 107.0
GANTRY_H = 6.4
LIGHT_GAP = 1.1    # entre luz y luz del semáforo (lo sabe también el cliente: checkpoint@1.lights)
PYLON_OUT = 9.6


def lights_at() -> tuple[float, float, float]:
    """El centro de la fila de luces del semáforo (mirando a la parrilla)."""
    return GANTRY_X - 0.62, GANTRY_H - 0.4, Z_IN


def loop_mid() -> tuple[float, float]:
    """El centro del looping en planta (x, z)."""
    return LOOP_IN + loop_profile()["advance"] / 2, (Z_OUT + Z_IN) / 2


def track_object(detail: int):
    """La pista entera, de una pieza: su malla es su colisión (district-activities: mesh_collider)."""
    from kit import CHUNK, Part, finish, mat

    C = CHUNK / 2
    p = Part("arcade_circuit")
    pl = plan()

    def B(v):
        return (v[0] - C, -(v[2] - C), v[1])

    dark = mat("metal", "#151a28")
    skirt = mat("metal", "#1b2030")
    kerb = mat("pintado", "#2f3754")
    zone_of = "road"
    for st in strips(pl):
        k = st["kind"]
        if k in ZONE_LIGHT:
            zone_of = k
            m = mat("panel", ZONE_ROAD.get(k, ROAD))
        elif k == "glow":
            m = mat("neon", YELLOW)
        elif k in ("edge", "rail", "rib"):
            m = mat("neon", ZONE_LIGHT[zone_of])
        elif k == "dash":
            m = mat("neon", ZONE_LIGHT[zone_of] if zone_of == "loop" else WHITE)
        elif k in ("wall", "front", "beam", "belly"):
            m = dark
        elif k == "kerb":
            m = kerb
        else:
            m = skirt
        p.poly([B(v) for v in st["q"]], m)

    def box(x0, z0, x1, z1, y0, y1, m, skip=()):
        p.box((x0 - C, -(z1 - C), y0), (x1 - C, -(z0 - C), y1), m, skip=skip)

    white = mat("pintado", "#eef2f8")
    black = mat("pintado", "#12141c")
    # Línea de meta: ajedrezado de dos filas, un pelo por encima del firme.
    y = BASE + 0.012
    n = 9
    for row in range(2):
        for k in range(n):
            x0 = FINISH_X - 0.6 + row * 0.6
            z0 = Z_IN - W / 2 + EDGE + k * (W - 2 * EDGE) / n
            box(x0, z0, x0 + 0.6, z0 + (W - 2 * EDGE) / n, y, y + 0.004, white if (row + k) % 2 == 0 else black, skip=("-z",))
    # Parrilla: el cajón de cada coche (una raya delante y dos a los lados).
    for gx in GRID_X:
        for gz in GRID_Z:
            box(gx + 2.5, gz - 1.5, gx + 2.68, gz + 1.5, y, y + 0.004, white, skip=("-z",))
            for sz in (-1.5, 1.32):
                box(gx + 0.9, gz + sz, gx + 2.5, gz + sz + 0.18, y, y + 0.004, white, skip=("-z",))
    # Pórtico de salida: dos postes, el dintel con su pantalla y los cinco semáforos.
    gz0, gz1 = Z_IN - W / 2 - 1.2, Z_IN + W / 2 + 1.2
    for z in (gz0, gz1):
        box(GANTRY_X - 0.35, z - 0.35, GANTRY_X + 0.35, z + 0.35, 0, GANTRY_H + 1.4, dark)
        box(GANTRY_X - 0.37, z - 0.37, GANTRY_X + 0.37, z + 0.37, 0.3, 0.45, mat("neon", BLUE))
    box(GANTRY_X - 0.4, gz0, GANTRY_X + 0.4, gz1, GANTRY_H, GANTRY_H + 1.4, dark)
    box(GANTRY_X - 0.46, gz0 + 0.6, GANTRY_X - 0.4, gz1 - 0.6, GANTRY_H + 0.15, GANTRY_H + 1.25, mat("pantalla", MAGENTA))
    # Las luces van apagadas en el modelo: las enciende el cliente con la cuenta atrás (lights_at()).
    lx0, ly0, _ = lights_at()
    for k in range(5):
        lz = Z_IN + (k - 2) * LIGHT_GAP
        box(lx0, lz - 0.34, GANTRY_X - 0.4, lz + 0.34, ly0 - 0.35, ly0 + 0.35, dark)
        p.sphere((lx0 - C, -(lz - C), ly0), 0.24, mat("metal", "#2a0d12"), subdiv=2 if detail else 1)
    # Dos postes en la línea de meta (bajos, con su luz), fuera del bordillo: a quien se sale un
    # poco de la pista no le paran en seco.
    for z in (gz0 - 0.5, gz1 + 0.5):
        box(FINISH_X - 0.2, z - 0.2, FINISH_X + 0.2, z + 0.2, 0, 3.2, dark)
        box(FINISH_X - 0.22, z - 0.22, FINISH_X + 0.22, z + 0.22, 2.9, 3.2, mat("neon", WHITE))
    # Torres del looping: una a cada lado, con su tirante a lo más alto y su filo de luz.
    lx, lz = loop_mid()
    top = BASE + loop_profile()["top"]
    for side in (-1, 1):
        z = lz + side * PYLON_OUT
        box(lx - 0.45, z - 0.45, lx + 0.45, z + 0.45, 0, top + 2.2, dark)
        box(lx - 0.47, z - 0.47, lx + 0.47, z + 0.47, top + 1.7, top + 2.2, mat("neon", MAGENTA))
        for yy in (top * 0.33, top * 0.66):
            box(lx - 0.47, z - 0.47, lx + 0.47, z + 0.47, yy, yy + 0.12, mat("neon", MAGENTA))
        z_in = lz + side * (W_LOOP / 2 + 0.3)
        za, zb = sorted((z - side * 0.45, z_in))
        box(lx - 0.22, za, lx + 0.22, zb, top - 0.75, top - 0.4, dark)
    ob = p.to_object()
    ob.name = "arcade_circuit"
    finish(ob)
    return ob


# --------------------------------------------------------------------------------------
# La ficha: la carrera, la parrilla, las placas de turbo, los marcadores y los carteles
# --------------------------------------------------------------------------------------

RACE = "gp"
LAPS = 2
CP_RADIUS = 8.0


def _heading_yaw(t) -> float:
    """Giro (grados, como en la ficha: 0 = hacia −Z) que apunta hacia donde va la pista."""
    return round(math.degrees(math.atan2(-t[0], -t[2])), 1)


def checkpoints(pl: dict) -> list[list[float]]:
    """
    Los puntos de la carrera, en orden: el vértice de cada curva (no vale atajar por dentro), uno por
    recta, lo alto del looping (no vale rodearlo) y las dos rampas del salto.
    """
    m = pl["marks"]
    top_s = max((f for f in pl["frames"] if f["zone"] == "loop"), key=lambda f: f["p"][1])["s"]
    apex = math.pi * CURVE_R / 4          # del final de una curva (su marca) atrás hasta su vértice
    where = [m["east"] - apex, (m["east"] + m["north"]) / 2 - 20, m["north"] - apex, (m["chicane"] + m["chicane_end"]) / 2, m["west"] - apex,
             m["crest"] + CREST_RUN, m["south"] - apex, m["south"] + 30, top_s, m["ramp"] + 14, m["land"] + 18]
    return [[round(c, 2) for c in at(pl, s)["p"]] for s in where]


def write_activities(path: str = ACTIVITIES) -> None:
    """Deja en la ficha de Arcade lo que sale del trazado (lo demás, como estaba)."""
    pl = plan()
    data = json.load(open(path, encoding="utf-8"))
    a = data["arcade"]
    own = lambda e: e.get("circuit")  # noqa: E731  (lo que pone esta función lleva su marca)
    a["props"] = [e for e in a.get("props", []) if e.get("piece") != "arcade_circuit"] + [
        {"piece": "arcade_circuit", "p": [32, 0, 32], "yaw": 0, "half": [0, 0, 0], "mesh_collider": True}]
    a["races"] = [r for r in a.get("races", []) if r["id"] != RACE] + [{
        "id": RACE, "vehicle": "car", "mode": "grid", "laps": LAPS, "radius": CP_RADIUS,
        "start": {"p": [START[0], BASE, START[1]], "radius": CP_RADIUS, "yaw": _heading_yaw((1.0, 0.0, 0.0))},
        "grid": [[gx, BASE, gz] for gx in GRID_X[::-1] for gz in GRID_Z],
        "lights": [round(c, 2) for c in lights_at()],
        "cps": checkpoints(pl),
        "finish": {"p": [FINISH_X, BASE, Z_IN], "radius": CP_RADIUS},
    }]
    turbos = []
    for s in pl["turbos"]:
        f = at(pl, s)
        turbos.append({"p": [round(f["p"][0], 2), round(f["p"][1] + 0.03, 2), round(f["p"][2], 2)], "yaw": _heading_yaw(f["t"]), "radius": 4.2, "speed": 12, "seconds": 1, "circuit": True})
    a["boosts"] = [e for e in a.get("boosts", []) if not own(e)] + turbos
    bz = Z_IN + W / 2 + 2.6
    boards = [
        # (Con el nombre de la carrera: en el panel de xenxo.io salen junto a los del Circuito Neón, que es a pie.)
        {"kind": "race", "id": RACE, "period": "week", "p": [START[0] - 4.2, 3.0, bz], "yaw": 180, "size": [4.6, 3.2],
         "title": {"es": "GRAN PREMIO · SEMANA", "en": "GRAND PRIX · WEEK"}, "title_size": 0.4, "circuit": True},
        {"kind": "race", "id": RACE, "period": "all", "p": [START[0] + 4.2, 3.0, bz], "yaw": 180, "size": [4.6, 3.2],
         "title": {"es": "GRAN PREMIO · SIEMPRE", "en": "GRAND PRIX · ALL TIME"}, "title_size": 0.4, "circuit": True},
    ]
    a["boards"] = [e for e in a.get("boards", []) if not own(e)] + boards
    lx, lz = loop_mid()
    labels = [
        {"text": {"es": "GRAN PREMIO NEÓN", "en": "NEON GRAND PRIX"}, "p": [GANTRY_X - 0.5, GANTRY_H + 2.1, Z_IN], "yaw": 270, "size": 0.9, "circuit": True},
        {"text": {"es": "PARRILLA", "en": "GRID"}, "p": [GRID_X[0] - 3.0, BASE + 0.03, Z_IN], "yaw": 270, "size": 0.7, "flat": True, "circuit": True},
        {"text": {"es": "Súbete al coche (C) y párate en la parrilla: la carrera sale sola.", "en": "Get in your car (C) and stop on the grid: the race starts by itself."},
         "p": [START[0], 5.3, bz], "yaw": 180, "size": 0.34, "width": 9, "max_distance": 60, "circuit": True},
    ]
    a["labels"] = [e for e in a.get("labels", []) if not own(e)] + labels
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    write_line(pl)
    print(f"[forja] circuito de Arcade: {pl['length']:.0f} m, {len(a['races'][-1]['cps'])} puntos, {len(turbos)} placas de turbo")


def write_line(pl: dict, path: str = LINE) -> None:
    """La línea central (un punto por sección, con sus metros desde la meta y su tramo) y las marcas."""
    line = [[round(f["p"][0], 2), round(f["p"][1], 2), round(f["p"][2], 2), round(f["s"], 1), f["zone"]] for f in pl["frames"]]
    out = {"length": round(pl["length"], 2), "marks": {k: round(v, 1) for k, v in pl["marks"].items()}, "turbos": [round(t, 1) for t in pl["turbos"]], "line": line}
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(out, separators=(",", ":")) + "\n")


def dump(path: str) -> None:
    """Vuelca la pista (triángulos y línea central) para las pruebas del coche."""
    pl = plan()
    pos: list[float] = []
    idx: list[int] = []
    for st in strips(pl):
        base = len(pos) // 3
        for v in st["q"]:
            pos.extend(round(c, 4) for c in v)
        idx.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    line = [{"p": [round(c, 3) for c in f["p"]], "s": round(f["s"], 2), "zone": f["zone"], "w": f["w"]} for f in pl["frames"]]
    json.dump({"positions": pos, "index": idx, "line": line, "length": round(pl["length"], 2), "marks": pl["marks"], "loop": pl["loop"], "turbos": pl["turbos"]}, open(path, "w"))
    print(f"circuito: {pl['length']:.0f} m, {len(pl['frames'])} secciones, {len(idx) // 3} triángulos; looping de {pl['loop']['top']:.1f} m de alto")


if __name__ == "__main__":
    dump(sys.argv[1] if len(sys.argv) > 1 else "/dev/stdout")
