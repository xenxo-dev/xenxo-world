/**
 * Acciones en pareja (chocar los cinco, abrazo, apretón de manos): cuánto duran, cuándo y dónde se
 * buscan las manos y a qué distancia se ponen. Lo usan el propio jugador (selfPeople.ts), quien mira
 * (remotePeople.ts) y la gente de las ciudades (city/citizens.ts), cada uno con la posición en que ve
 * a la otra persona y lo que miden las dos (rig.ts → `size`; de los demás, where.ts → `remoteFx`):
 * así, con avatares de tamaños distintos, cada cliente pone las dos manos en el mismo sitio.
 *
 * Todo sale de lo que mide cada uno (`meet`): a qué altura se encuentran las manos (la que les va bien
 * a los dos), cuánto adelanta cada uno la suya (lo cómodo para su brazo), a qué distancia se ponen
 * (`pairGap`) y por dónde cae el encuentro entre los dos (más cerca de quien tiene el brazo corto).
 * Las manos van a donde se encuentran las palmas (`palm`), no las muñecas, y giradas como toca (hacia
 * dónde mira la palma y apuntan los dedos, rig.ts): chocar los cinco, palma contra palma, de frente y
 * con los dedos arriba; darse la mano, las palmas de lado, una contra otra, los dedos hacia la otra
 * persona y el mismo vaivén para las dos; y el abrazo, cruzado (cada uno con la derecha por encima del
 * hombro de la otra persona y la izquierda por debajo de su brazo), las palmas en su espalda (quietas
 * donde quedan, con dos palmaditas) y los codos pegados a su cuerpo.
 *
 * El abrazo sigue una grabación de uno de verdad, en el mismo orden: los brazos van a su encuentro, las
 * manos la rodean desde delante de su costado hasta su espalda, se abrazan (aprietan y se mecen), las
 * manos resbalan a su brazo y a su cintura mientras se separan medio paso, se miran un momento y la
 * sueltan. Es además de cuerpo entero (`hugBody`; lo hace el esqueleto, rig.ts → `applyEmbrace`): pecho
 * con pecho y la cadera hacia la otra persona sin mover los pies, cada cabeza por encima del hombro
 * derecho de la otra (girada hacia fuera, ladeada hacia la otra, sin meterse una en otra ni en el pecho
 * del otro) y, si una es mucho más alta, inclinada sobre la otra. Antes se quedaban a 32 cm, inclinados
 * en «A» y con las caras una contra otra.
 *
 * Se acerca quien la propone (`pairStep`, selfPeople.ts) y quien acepta se queda quieto: así quien se
 * mueve ve a su pareja donde está de verdad (a quien se mueve, por la red, se le ve un poco tarde) y se
 * para justo a su distancia; al soltarse del abrazo, se aparta (`pairLeave`). Mientras dura, no se
 * chocan (collision.ts): un abrazo es más cerca que dos cuerpos.
 */
import * as THREE from "three";
import type { PairAction } from "@xenxo/protocol";
import { BODY, type BodySize, type PersonFx, type Rig, type Target, type TorsoBand } from "./rig";
import type { BaseHand } from "./hands";

/**
 * Cuánto dura cada una (s) y cuándo entran y salen las manos (s). En el abrazo, de la segunda a la
 * tercera, las manos rodean a la otra persona hasta su espalda, y de la tercera a la cuarta resbalan de
 * su espalda a sus brazos (`HUG_GO`: cuándo la sueltan del todo).
 */
export const PAIR: Record<PairAction, { s: number; reach: [number, number, number, number] }> = {
  high_five: { s: 1.55, reach: [0.22, 0.55, 0.78, 1.15] },
  hug: { s: 4.2, reach: [0.55, 1.25, 2.55, 2.95] },
  handshake: { s: 1.9, reach: [0.28, 0.6, 1.5, 1.85] },
};

/** El centro de la palma: hasta dónde de la muñeca a los nudillos (como en rig.ts). */
const PALM_AT = 0.55;
/** Entre los centros de dos palmas que se tocan, por lo que mide la mano (como al aplaudir, rig.ts). */
const PALM_GAP = 0.3;
/**
 * Chocar los cinco: a qué altura sobre el hombro (por lo que mide el brazo) le va bien a cada uno,
 * hasta dónde llega quien la tenga más baja y lo mínimo para quien la tenga más alta.
 */
const FIVE_UP = 0.55;
const FIVE_MAX = 0.85;
const FIVE_MIN = 0.2;
/** Darse la mano: cuánto por debajo del hombro (por el brazo) le va bien a cada uno y el vaivén (m, s). */
const SHAKE_DOWN = 0.45;
const SHAKE_LEAST = 0.25;
const SHAKE_PUMP = 0.026;
const SHAKE_BEAT = 0.42;
/**
 * Abrazo, la distancia: de pie, el pecho no queda sobre los pies sino algo detrás (el reposo descansa
 * sobre la pierna de atrás), por lo que mide el hombro desde el suelo (medido en los de serie); y lo que
 * se deja de más (m) para que cada uno se acerque con la cadera (`Embrace`) hasta tocarse.
 */
const HUG_TRUNK = 0.116;
const HUG_GAP = 0.03;
/**
 * Abrazo, el cuerpo: lo que se aprietan los pechos (m, la ropa y lo blando), lo más que se mueve la
 * cadera hacia la otra persona o hacia atrás (m), lo que se va cada uno a su izquierda (m en un cuerpo
 * con los hombros a 1,33 m: así las cabezas pasan una junto a la otra) y lo que baja la cadera por cada
 * metro que se mueve (con los pies quietos, la pierna de atrás no llegaba).
 */
const HUG_SQUEEZE = 0.015;
const HUG_FWD = 0.08;
const HUG_BACK = 0.05;
const HUG_SIDE = 0.045;
const HUG_DROP = 0.3;
/**
 * Abrazo con alguien mucho más bajo: desde cuánto más alto (m, de hombros), cuánto se inclina por cada
 * metro de más (rad/m) y hasta dónde, y cuánto dobla las rodillas por cada metro de más (m/m) y hasta
 * dónde (m).
 */
const HUG_TALL = 0.1;
const HUG_LEAN = 0.6;
const HUG_LEAN_MAX = 0.25;
const HUG_KNEES = 0.2;
const HUG_KNEES_MAX = 0.06;
/** Por la cabeza de quien es más bajo: lo más que echa atrás la cadera quien es más alto, y la cabeza quien es más bajo (m). */
const HUG_BACK_HEAD = 0.07;
const HEAD_BACK = 0.12;
/**
 * Abrazo, las cabezas: lo que queda entre las dos (m); y cuándo entra y sale el cuerpo (s): llega antes
 * que los brazos (las cabezas ya apartadas cuando quien se acerca llega) y se va mientras las manos
 * resbalan a sus brazos y quien se acercó se aparta.
 */
const HEAD_GAP = 0.025;
/**
 * Abrazo, la cabeza: quien es más alto la inclina hacia delante (rad por cada metro que le saca de pie, y
 * hasta dónde) y cada uno la ladea hacia la de la otra persona (rad, más rad por metro de diferencia, y
 * hasta dónde): como en la grabación, mejilla con mejilla y la barbilla de quien es más alto en su hombro.
 */
const HEAD_NOD = 2;
const HEAD_NOD_MAX = 0.35;
const HUG_NOD: [number, number] = [0.95, 1.4];
const HEAD_ROLL = 0.06;
const HEAD_ROLL_K = 1.2;
const HEAD_ROLL_MAX = 0.2;
const HUG_BODY: [number, number, number, number] = [0.45, 0.95, 2.55, 2.9];
/**
 * Abrazo, al soltarse (como en una grabación de un abrazo de verdad): las manos resbalan de su espalda
 * a sus brazos mientras quien se acercó da medio paso atrás (de cara a la otra persona: el paso, al
 * revés) hasta quedar HUG_ARMS m más lejos que abrazados; se quedan así un momento, mirándose; la
 * sueltan (`HUG_GO`, s) y da otro paso atrás (`HUG_LEAVE`, s) hasta HUG_AFTER m entre los dos (algo más
 * de lo que ocupan dos personas, collision.ts; así nadie empuja a nadie al acabar).
 */
const HUG_ARMS = 0.22;
const HUG_GO: [number, number] = [3.55, 3.95];
const HUG_LEAVE: [number, number] = [3.65, 4.15];
const HUG_AFTER = 0.66;
/** Abrazo: se miran a la cara hasta que cada cabeza va a su lado (s) y, al resbalar las manos, otra vez hasta soltarse. */
const HUG_LOOK: [number, number] = [0.85, 2.7];
/**
 * Abrazo, las manos al ir: en cuánto entran (s) y desde dónde empiezan a rodear a la otra persona: lo
 * que van por delante de su costado (rad, negativo), por encima de su hombro (la de arriba) o de donde
 * quedará (la de abajo) y por fuera de su cuerpo (m). Antes de eso las lleva el gesto (los brazos se
 * abren y van a su encuentro: la de arriba hacia su hombro, la de abajo hacia su cintura).
 */
const HUG_IN = 0.3;
/** Abrazo: la mano de arriba rodea por encima de su hombro hasta esta parte del camino y después baja a su sitio. */
const HUG_OVER_AT = 0.55;
const HUG_FROM_HIGH = { a: -0.35, up: 0.06, out: 0.08 };
const HUG_FROM_LOW = { a: -0.55, up: 0.02, out: 0.08 };
/**
 * Abrazo, las manos al soltarse: la de arriba, en la parte de fuera de su brazo (qué parte del hombro
 * al codo y lo que abulta el brazo en un cuerpo como `BODY`, m); al resbalar de su espalda a su brazo y
 * a su costado, la de abajo por fuera de su costado y la de arriba por encima de su hombro (m).
 */
const ARM_ALONG = 0.6;
const ARM_THICK = 0.045;
const SLIDE_OUT = 0.07;
const SLIDE_UP = 0.09;
/** Abrazo, al soltarse: lo que se estira tu brazo, como mucho, para llegar a su brazo (por lo que mide). */
const ARM_REACH = 0.95;
/** Abrazo, al soltarse: la mano de abajo en su costado, cuánto sobre su cintura (m, en un cuerpo como `BODY`) y por delante de su costado (rad). */
const FLANK_UP = 0.04;
const FLANK_A = -0.3;
/**
 * Abrazo, las manos: del centro de la palma a la espalda que toca (m); la de arriba, cuánto bajo su
 * hombro (m, en un cuerpo como `BODY`) y lo más por encima del tuyo; la de abajo, cuánto sobre su
 * cintura; y, sin su esqueleto, a qué altura bajo su hombro están su cintura y su pecho (por su brazo).
 */
const HUG_PALM = 0.018;
const HUG_HIGH_DOWN = 0.13;
const HUG_HIGH_OVER = 0.06;
const HUG_LOW_UP = 0.04;
const HUG_DOWN = 0.75;
const HUG_HIGH = 0.1;
const HUG_LOW = 0.6;
/**
 * Abrazo: hasta dónde rodea cada mano (de su costado, 0, hacia su columna, π/2, y algo más allá, en
 * radianes), en qué pasos y lo que se estira el brazo para llegar (por lo que mide); y lo que separa,
 * como poco, la altura de una mano de la otra a cada lado (m).
 */
const HUG_AROUND_HIGH = Math.PI / 2 + 0.12;
const HUG_AROUND_LOW = Math.PI / 2;
const HUG_STEP = 0.1;
const HUG_REACH = 0.86;
const HUG_APART = 0.08;
/**
 * Abrazo: el codo que va por encima de su hombro, cuánto por encima de su articulación y por fuera (m) y
 * cuánto por detrás (por lo que abulta de delante atrás): el brazo apoyado encima (y no metido en su
 * hombro) y el antebrazo, a lo largo de su espalda (no hacia dentro).
 */
const HUG_OVER_UP = 0.13;
const HUG_OVER_OUT = 0.07;
const HUG_OVER_BACK = 0.6;
/** Abrazo: el codo que va por su costado (no por encima de su hombro), algo por detrás (por lo que abulta de delante atrás): así el antebrazo rodea su espalda sin cortar la esquina. */
const HUG_ELBOW_BACK = 0.45;
/**
 * Abrazo: el codo del brazo de abajo, hacia abajo junto a tu costado (el brazo pegado al cuerpo, como en
 * la grabación) y algo por fuera y hacia atrás (por cada metro hacia abajo); el antebrazo rodea su
 * cintura. Antes iba por su costado y el brazo quedaba en horizontal, cruzado delante de su pecho.
 */
const HUG_LOW_OUT = 0.4;
const HUG_LOW_BACK = 0.15;
/** Abrazo: dos palmaditas en la espalda con la mano de arriba (cuándo, cuánto duran, cuánto se separa, m). */
const PATS = [1.8, 2.16];
const PAT_S = 0.24;
const PAT_LIFT = 0.035;
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _f = new THREE.Vector3();
const _l = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Vector3();
const _band: TorsoBand = { front: 0, back: 0, side: 0 };
const _a1 = new THREE.Vector3();
const _a2 = new THREE.Vector3();
const _q = new THREE.Vector3();
const _qn = new THREE.Vector3();
const _w = new THREE.Vector3();
const _pn = new THREE.Vector3();
const _pe = new THREE.Vector3();
const _pp = new THREE.Vector3();
/** Quien se acerca: a qué velocidad, como poco y como mucho (m/s). */
const STEP_MIN = 1.4;
const STEP_MAX = 5;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
};

/**
 * Lo que adelanta su palma (en horizontal, desde el hombro) con el centro de la palma a la altura `y`
 * (sobre sus pies) y su muñeca `side` m a un lado del hombro, con los dedos hacia delante (`fwd`) y
 * hacia arriba (`up`). Cuanto más alto respecto al hombro (`rise` de la muñeca, por lo que mide el
 * brazo), más estirado va el brazo: bajo, el codo se dobla y el antebrazo sube con la mano (con el
 * brazo estirado hacia delante y la mano de pie, la muñeca se doblaba en ángulo recto).
 */
function ahead(b: BodySize, y: number, side: number, fwd: number, up: number, bent: number, straight: number) {
  const off = b.hand * PALM_AT;
  const dy = y - off * up - b.shoulder;
  const r = b.arm * (bent + (straight - bent) * clamp01(Math.abs(dy) / (0.7 * b.arm)));
  return Math.sqrt(Math.max(0.15 * 0.15, r * r - dy * dy - side * side)) + off * fwd;
}

/** La mitad de lo que queda entre dos palmas que se tocan. */
const halfGap = (a: BodySize, b: BodySize) => (PALM_GAP / 2) * ((a.hand + b.hand) / 2);

/**
 * Dónde se encuentran `a` y `b` (con los pies de `b` a `dy` m sobre los de `a`): la altura del centro
 * de las palmas (sobre los pies de `a`), lo que adelanta cada uno la suya y a qué distancia les va bien
 * estar. Igual desde los dos lados: cada cliente lo calcula con lo que mide cada uno y sale lo mismo.
 */
const _g = { y: 0, ha: 0, hb: 0, gap: 0 };
function meet(kind: PairAction, a: BodySize, b: BodySize, dy: number) {
  const half = halfGap(a, b);
  if (kind === "high_five") {
    // Entre lo que le va bien a cada uno, sin pasar de lo que alcanza quien la tenga más baja ni quedar
    // bajo para quien la tenga más alta (si no hay hueco, en medio). Las palmas, en la línea entre los
    // dos, de frente y con los dedos arriba.
    const hi = Math.min(a.shoulder + FIVE_MAX * a.arm, dy + b.shoulder + FIVE_MAX * b.arm);
    const lo = Math.max(a.shoulder + FIVE_MIN * a.arm, dy + b.shoulder + FIVE_MIN * b.arm);
    const y = (a.shoulder + FIVE_UP * a.arm + dy + b.shoulder + FIVE_UP * b.arm) / 2;
    _g.y = lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, y));
    _g.ha = ahead(a, _g.y, a.width, 0, 1, 0.62, 0.92);
    _g.hb = ahead(b, _g.y - dy, b.width, 0, 1, 0.62, 0.92);
    _g.gap = _g.ha + _g.hb + 2 * half;
  } else if (kind === "handshake") {
    // A media altura entre lo que le va bien a cada uno, pero bajo los hombros de los dos; cada palma,
    // a su lado de la línea, con los dedos hacia la otra persona.
    const y = (a.shoulder - SHAKE_DOWN * a.arm + dy + b.shoulder - SHAKE_DOWN * b.arm) / 2;
    _g.y = Math.min(y, a.shoulder - SHAKE_LEAST * a.arm, dy + b.shoulder - SHAKE_LEAST * b.arm);
    _g.ha = ahead(a, _g.y, a.width - half, 0.99, -0.15, 0.72, 0.9);
    _g.hb = ahead(b, _g.y - dy, b.width - half, 0.99, -0.15, 0.72, 0.9);
    _g.gap = _g.ha + _g.hb;
  } else {
    // Pecho con pecho (lo que abulta cada uno por delante, con la ropa, desde donde queda su pecho de
    // pie), con algo de sitio para que cada uno se acerque con la cadera.
    _g.y = 0;
    _g.ha = a.front - HUG_TRUNK * a.shoulder;
    _g.hb = b.front - HUG_TRUNK * b.shoulder;
    _g.gap = Math.max(0.05, _g.ha + _g.hb + HUG_GAP);
  }
  return _g;
}

/** A qué distancia se ponen (m, entre los pies): la misma para los dos. */
export function pairGap(kind: PairAction, a: BodySize = BODY, b: BodySize = BODY): number {
  return meet(kind, a, b, 0).gap;
}

/**
 * Quien se acerca: cuánto este frame (m), hasta su distancia y a tiempo para que las manos se
 * encuentren (llega cuando van por la mitad de su camino). Solo se acerca: si ya está más cerca, se
 * queda donde está.
 */
export function pairStep(kind: PairAction, t: number, d: number, gap: number, dt: number): number {
  const [i0, i1, o0] = PAIR[kind].reach;
  if (t >= o0 || d <= gap + 0.02) return 0;
  const left = Math.max(0.12, (i0 + i1) / 2 - t);
  const v = Math.min(STEP_MAX, Math.max(STEP_MIN, (d - gap) / left));
  return Math.min(d - gap, v * dt);
}

/**
 * Al soltarse del abrazo, quien se acercó se aparta: cuánto este frame (m). Primero medio paso, mientras
 * las manos resbalan a los brazos de la otra persona (hasta HUG_ARMS m más que abrazados), y al
 * soltarla, otro hasta HUG_AFTER (en las otras acciones ya quedan a su distancia, 0). Solo se aparta: si
 * ya está más lejos, nada.
 */
export function pairLeave(kind: PairAction, t: number, d: number, gap: number, dt: number): number {
  const [, , o0, o1] = PAIR.hug.reach;
  if (kind !== "hug" || t <= o0) return 0;
  const near = gap + HUG_ARMS;
  let want = gap + (near - gap) * smooth((t - o0) / (o1 - o0));
  if (t > HUG_LEAVE[0]) want = near + (Math.max(near, HUG_AFTER) - near) * smooth((t - HUG_LEAVE[0]) / (HUG_LEAVE[1] - HUG_LEAVE[0]));
  return Math.max(0, Math.min(want - d, STEP_MAX * dt));
}

/** Una mano: el centro de su palma a (x, y, z), el codo hacia (px, py, pz), la palma hacia n, los dedos hacia u (mundo; a 0, siguiendo al antebrazo) y cómo van (sin `shape`, como los ponga el gesto). */
function put(t: Target, w: number, x: number, y: number, z: number, px: number, py: number, pz: number, nx: number, ny: number, nz: number, ux: number, uy: number, uz: number, shape: BaseHand | null = null) {
  t.x = x;
  t.y = y;
  t.z = z;
  t.w = w;
  t.px = px;
  t.py = py;
  t.pz = pz;
  t.palm = 1;
  t.nx = nx;
  t.ny = ny;
  t.nz = nz;
  t.ux = ux;
  t.uy = uy;
  t.uz = uz;
  t.shape = shape;
}

/**
 * Abrazo, a qué altura va cada mano de alguien de hombros a `sh` (m, ahora) en el tronco de alguien
 * con la cintura a `waist` y los hombros a `top` (lo que mide, `you`): la de arriba (`_hh.high`), por
 * sus omóplatos, sin pasar mucho de tu hombro; la de abajo (`_hh.low`), algo sobre su cintura y como
 * poco a HUG_APART de la de arriba, sin bajar más de lo que llega tu brazo (por debajo de tu hombro,
 * HUG_DOWN de lo que mide).
 */
const _hh = { high: 0, low: 0 };
function hugHeights(sh: number, me: BodySize, waist: number, top: number, you: BodySize) {
  const high = Math.max(waist + HUG_APART, Math.min(top - (HUG_HIGH_DOWN * you.shoulder) / BODY.shoulder, sh + HUG_HIGH_OVER));
  const reach = sh - HUG_DOWN * me.arm;
  _hh.high = high;
  // Si tu brazo no llega tan abajo (con alguien mucho más bajo), las dos por sus omóplatos.
  _hh.low = Math.max(Math.min(high - HUG_APART, Math.max(waist + HUG_LOW_UP, reach)), Math.min(reach, high));
}

/**
 * Por dónde va por delante el tronco de `rig` a la altura `y` (m, a lo largo de n desde a): entre lo
 * que midió en su cintura y en su pecho (rig.ts → `frontLow`, `frontHigh`), por debajo como en su
 * cintura y, por encima, siguiendo su inclinación hasta sus hombros.
 */
function frontAt(rig: Rig, y: number, ax: number, az: number, nx: number, nz: number) {
  const lo = rig.frontLow, hi = rig.frontHigh;
  if (y >= hi.y) {
    const up = Math.min(y, rig.hugTop) - hi.y;
    return (hi.x + rig.hugTiltX * up - ax) * nx + (hi.z + rig.hugTiltZ * up - az) * nz;
  }
  const k = hi.y - lo.y > 0.02 ? Math.max(0, (y - lo.y) / (hi.y - lo.y)) : 1;
  return (lo.x + (hi.x - lo.x) * k - ax) * nx + (lo.z + (hi.z - lo.z) * k - az) * nz;
}

/**
 * Abrazo, la otra mitad de cada uno (la de los brazos, en `pairTargets`): el cuerpo. Con lo que miden
 * los dos esqueletos de hace un frame antes de apoyarse (rig.ts → `frontLow`, `headCenter`…):
 *
 * - quien es mucho más alto se inclina hacia quien es más bajo (y dobla algo las rodillas);
 * - cada uno acerca la cadera la mitad de lo que queda entre los dos troncos (más lo que se aprietan)
 *   donde más cerca están: a la altura de la cintura y del pecho de cada uno (con alturas distintas, el
 *   pecho de uno va contra la tripa del otro);
 * - cada uno se va algo a su izquierda (las cabezas, cada una por encima del hombro derecho de la otra
 *   persona) y, si aun así las cabezas no caben, cada una se aparta la mitad de lo que falta, de lado;
 * - y la cabeza de quien queda por debajo de los hombros de la otra persona no se mete en su pecho
 *   (la mejilla en su pecho): la mitad la quita quien es más alto, echando atrás la cadera, y la otra
 *   mitad quien es más bajo, con la cabeza.
 *
 * Sin el esqueleto de la otra persona, su pecho donde estaría de pie.
 */
function hugBody(w: number, ax: number, ay: number, az: number, b: THREE.Vector3, nx: number, nz: number, rx: number, rz: number, fx: PersonFx, other: PersonFx | null, me: BodySize, you: BodySize) {
  const h = fx.hug, mine = fx.rig, rig = other?.rig;
  h.on = true;
  h.w = w;
  // Con alguien mucho más bajo, inclinado hacia él (y algo agachado): de pie, sus brazos le colgaban.
  const tall = Math.max(0, ay + me.shoulder - (b.y + you.shoulder) - HUG_TALL);
  h.lean = Math.min(HUG_LEAN_MAX, tall * HUG_LEAN);
  h.lx = -rx;
  h.lz = -rz;
  let fwd = 0;
  const both = !!mine?.hugMeasured && !!rig?.hugMeasured;
  // Lo que se mete la cabeza de cada uno en el pecho del otro (quien es más bajo, por debajo de sus
  // hombros): la mitad la quita el otro echando atrás la cadera (poco: si no, los brazos cortos ya no
  // le rodean) y la otra mitad, quien la mete, con la cabeza.
  let into = 0, intoYou = 0;
  if (both) {
    const hc = mine!.headCenter, yc = rig!.headCenter;
    if (hc.y < rig!.hugTop) into = Math.max(0, (hc.x - ax) * nx + (hc.z - az) * nz + mine!.headRadius + HEAD_GAP - frontAt(rig!, hc.y, ax, az, nx, nz));
    if (yc.y < mine!.hugTop) intoYou = Math.max(0, frontAt(mine!, yc.y, ax, az, nx, nz) - ((yc.x - ax) * nx + (yc.z - az) * nz - rig!.headRadius - HEAD_GAP));
  }
  if (mine?.hugMeasured) {
    let gap = Infinity;
    if (both) {
      // Donde más cerca están: a la altura de la cintura y del pecho de cada uno, entre los dos troncos.
      const lo = Math.max(mine.frontLow.y, rig!.frontLow.y), hi = Math.min(mine.frontHigh.y, rig!.frontHigh.y);
      for (let i = 0; i < 4; i++) {
        const y = (i & 2 ? rig! : mine)[i & 1 ? "frontHigh" : "frontLow"].y;
        const at = hi > lo ? Math.min(hi, Math.max(lo, y)) : (lo + hi) / 2;
        gap = Math.min(gap, frontAt(rig!, at, ax, az, nx, nz) - frontAt(mine, at, ax, az, nx, nz));
      }
    } else gap = (b.x - ax) * nx + (b.z - az) * nz - (you.front - HUG_TRUNK * you.shoulder) - frontAt(mine, mine.frontHigh.y, ax, az, nx, nz);
    fwd = Math.min(HUG_FWD, Math.max(-HUG_BACK, (gap + HUG_SQUEEZE) / 2));
    if (intoYou > 0) fwd = Math.max(-HUG_BACK_HEAD, Math.min(fwd, -intoYou / 2));
  }
  // Las cabezas, mejilla con mejilla: cada una se ladea hacia la otra (a su derecha) y quien es más alto
  // la inclina sobre la otra persona (por lo que le saca de pie); quien es más bajo no la levanta.
  const dh = ay + me.head - (b.y + you.head);
  h.nod = Math.min(HEAD_NOD_MAX, Math.max(0, dh * HEAD_NOD));
  h.roll = HEAD_ROLL + Math.min(HEAD_ROLL_MAX, Math.abs(dh) * HEAD_ROLL_K);
  const side = (HUG_SIDE * me.shoulder) / BODY.shoulder;
  h.x = nx * fwd - rx * side;
  h.z = nz * fwd - rz * side;
  h.y = -HUG_DROP * Math.hypot(fwd, side) - Math.min(HUG_KNEES_MAX, tall * HUG_KNEES);
  h.hx = -nx * Math.min(HEAD_BACK, into / 2);
  h.hz = -nz * Math.min(HEAD_BACK, into / 2);
  if (!both) return;
  const hc = mine!.headCenter, r = mine!.headRadius;
  // Las cabezas: lo que falta de lado (a tu izquierda, −r) para que quepan, la mitad cada uno.
  const dx = hc.x - rig!.headCenter.x, dy = hc.y - rig!.headCenter.y, dz = hc.z - rig!.headCenter.z;
  const lat = -(dx * rx + dz * rz), along = dx * nx + dz * nz;
  const need = r + rig!.headRadius + HEAD_GAP;
  const lack = Math.sqrt(Math.max(0, need * need - dy * dy - along * along)) - Math.abs(lat);
  if (lack > 0) {
    const push = (lack / 2) * (lat >= 0 ? 1 : -1);
    h.hx -= rx * push;
    h.hz -= rz * push;
  }
}

/**
 * Abrazo: el punto de su tronco (el óvalo de centro `_c`, hacia delante `_f` y a su izquierda `_l`, de
 * semiejes ex y ez) a `a` rad de su costado hacia su espalda (`sgn`: por su izquierda, 1, o por su
 * derecha, −1), donde va el centro de tu palma (algo por fuera), en `_p`; y hacia fuera de él, en `_n`.
 */
function around(a: number, sgn: number, ex: number, ez: number) {
  const cs = Math.cos(a), sn = Math.sin(a);
  _n.copy(_l).multiplyScalar((sgn * cs) / ex).addScaledVector(_f, -sn / ez).normalize();
  _p.copy(_c).addScaledVector(_l, sgn * ex * cs).addScaledVector(_f, -ez * sn).addScaledVector(_n, HUG_PALM);
}

/**
 * Abrazo: el tronco de la otra persona a la altura `y` (m; su cintura a `waist` y de su cintura a su
 * pecho, `span`), el óvalo de `around`: centro en `_c`, hacia delante `_f`, a su izquierda `_l` y sus
 * semiejes en `_ov`. Con su esqueleto, tal como está ahora (rig.ts → torsoAt: inclinado, también); sin
 * él, de pie frente a ti (en `b`, mirando hacia ti).
 */
const _ov = { ex: 0, ez: 0 };
function ovalAt(rig: Rig | null | undefined, y: number, waist: number, span: number, b: THREE.Vector3, nx: number, nz: number, rx: number, rz: number, you: BodySize, high: boolean) {
  if (!rig?.torsoAt((y - waist) / span, _c, _f, _l, _band)) {
    _c.set(b.x, y, b.z);
    _f.set(-nx, 0, -nz);
    _l.set(rx, 0, rz);
    _band.front = you.front;
    _band.back = high ? you.back : you.waist;
    _band.side = you.side;
  }
  _ov.ex = _band.side;
  _ov.ez = (_band.front + _band.back) / 2;
  _c.addScaledVector(_f, (_band.front - _band.back) / 2);
}

/**
 * Abrazo, al soltarse: dónde va tu mano (en `_q`, y hacia dónde mira tu palma en `_qn`). La de arriba (tu
 * derecha), en la parte de fuera de su brazo izquierdo, entre su hombro y su codo (lo más cerca del
 * hombro que llegue tu brazo); la de abajo (tu izquierda), en su costado derecho, a la altura de su
 * cintura y algo por delante: como en la grabación, una le sujeta el brazo y la otra la cintura. Su
 * brazo izquierdo es el que te sujeta a ti la cintura, así que no depende de tus brazos (si cada uno
 * buscara el brazo que busca el suyo, se perseguían). Con su esqueleto, en su cuerpo tal como está;
 * sin él, de pie frente a ti, con el brazo colgando.
 */
function armSpot(rig: Rig | null | undefined, high: boolean, b: THREE.Vector3, nx: number, nz: number, rx: number, rz: number, you: BodySize, s: THREE.Vector3, reach: number, waist: number, span: number) {
  if (!high) {
    ovalAt(rig, waist + FLANK_UP * (you.arm / BODY.arm), waist, span, b, nx, nz, rx, rz, you, false);
    around(FLANK_A, -1, _ov.ex, _ov.ez);
    _q.copy(_p);
    _qn.copy(_n).negate();
    return;
  }
  // Su izquierda es tu derecha (estáis de frente).
  if (rig?.armAt(0, 0, _a1) && rig.armAt(0, 1, _a2)) {
    let at = ARM_ALONG;
    for (; at < 1; at += 0.1) {
      _q.copy(_a1).lerp(_a2, at);
      if (_q.distanceTo(s) <= reach) break;
    }
    _q.copy(_a1).lerp(_a2, Math.min(1, at));
    _w.copy(_a2).sub(_a1).normalize();
  } else {
    _a1.set(b.x + rx * you.width, b.y + you.shoulder, b.z + rz * you.width);
    _w.set(-nx * 0.2, -1, -nz * 0.2).normalize();
    _q.copy(_a1).addScaledVector(_w, ARM_ALONG * 0.48 * you.arm);
  }
  // Hacia fuera de su brazo (sin lo que va a lo largo de él), y la palma por fuera, mirándolo.
  _qn.set(rx, 0, rz).addScaledVector(_w, -(rx * _w.x + rz * _w.z)).normalize();
  _q.addScaledVector(_qn, ARM_THICK * (you.arm / BODY.arm) + HUG_PALM);
  _qn.negate();
}

/**
 * Dónde se buscan las manos (mundo) en cada acción en pareja, entre `a` (quien hace el gesto, con su
 * `fx`) y `b` (la otra persona, con el suyo si se tiene: `other`), a los `t` s de empezar.
 */
export function pairTargets(kind: PairAction, t: number, ax: number, ay: number, az: number, b: THREE.Vector3, fx: PersonFx, other: PersonFx | null = null) {
  const me = fx.rig?.size ?? BODY, you = other?.rig?.size ?? BODY;
  const ux = b.x - ax, uz = b.z - az;
  const d = Math.hypot(ux, uz) || 1;
  const nx = ux / d, nz = uz / d;
  // A su derecha (mirando hacia la otra persona).
  const rx = -nz, rz = nx;
  const [i0, i1, o0, o1] = PAIR[kind].reach;
  const w = t < i0 ? 0 : t < i1 ? (t - i0) / (i1 - i0) : t < o0 ? 1 : t < o1 ? 1 - (t - o0) / (o1 - o0) : 0;
  const k = w * w * (3 - 2 * w);
  // Se miran a la cara (en el abrazo no: cada cabeza va por encima del hombro de la otra persona).
  fx.look.x = b.x;
  fx.look.y = b.y + you.head - 0.04;
  fx.look.z = b.z;
  fx.look.w = kind === "hug" ? 0 : t < o1 ? 1 : 0;
  fx.reachL.w = 0;
  fx.reachR.w = 0;
  const g = meet(kind, me, you, b.y - ay);
  const half = halfGap(me, you);
  if (kind === "high_five") {
    // Palma contra palma, de frente y con los dedos arriba; el codo, abajo y por fuera.
    const f = (d * (g.ha + half)) / g.gap - half;
    put(fx.reachR, k, ax + nx * f, ay + g.y, az + nz * f, rx * 0.7 - nx * 0.3, -1, rz * 0.7 - nz * 0.3, nx, 0, nz, 0, 1, 0);
  } else if (kind === "handshake") {
    // El vaivén, igual para las dos (sale del mismo reloj de la acción).
    const pump = t > i1 && t < o0 ? SHAKE_PUMP * Math.sin(((t - i1) / SHAKE_BEAT) * Math.PI * 2) * Math.min(1, (t - i1) / 0.15, (o0 - t) / 0.15) : 0;
    // La palma mira a su izquierda (hacia la otra mano), los dedos hacia la otra persona y algo hacia
    // abajo, y su centro queda a su derecha de donde se juntan.
    const f = (d * g.ha) / g.gap;
    put(fx.reachR, k, ax + nx * f + rx * half, ay + g.y + pump, az + nz * f + rz * half, rx * 0.5 - nx * 0.4, -1, rz * 0.5 - nz * 0.4, -rx, 0, -rz, nx, -0.15, nz);
  } else {
    // Abrazo, como en una grabación de uno de verdad. Al empezar, los brazos se abren y van a su
    // encuentro (los lleva el gesto) y, desde i0, las manos rodean a la otra persona por delante de su
    // costado hasta su espalda. Cruzado: tu derecha por encima de su hombro izquierdo y la palma en sus
    // omóplatos; tu izquierda por debajo de su brazo derecho y la palma algo sobre su cintura (a cada
    // lado, el brazo de uno encima del del otro). Cada palma, en su espalda todo lo que llegue el brazo
    // (con brazos cortos o un tronco grueso, más hacia su costado), mirándola y con los dedos siguiendo
    // al antebrazo; el codo, pegado a su cuerpo (el de arriba, sobre su hombro; el de abajo, por su
    // costado). Al soltarse (de o0 a o1), las manos resbalan por su costado hasta sus brazos (la de
    // arriba, por fuera de su brazo; la de abajo, por debajo de su antebrazo) y se quedan ahí, mirándose,
    // hasta soltarla (`HUG_GO`). Con su esqueleto, en su cuerpo tal como está ahora (rig.ts → torsoAt:
    // inclinado, también); sin él, donde estaría de pie. Y el cuerpo (`hugBody`): la cadera y la cabeza.
    const rig = other?.rig, mine = fx.rig;
    const [b0, b1, b2, b3] = HUG_BODY;
    const bw = t < b0 ? 0 : t < b1 ? (t - b0) / (b1 - b0) : t < b2 ? 1 : t < b3 ? 1 - (t - b2) / (b3 - b2) : 0;
    hugBody(bw * bw * (3 - 2 * bw), ax, ay, az, b, nx, nz, rx, rz, fx, other, me, you);
    // Quien es más alto apoya la cabeza cuando ya están abrazados (al llegar, mejilla con mejilla) y la
    // levanta al empezar a soltarse.
    fx.hug.nod *= smooth((t - HUG_NOD[0]) / (HUG_NOD[1] - HUG_NOD[0])) * (1 - smooth((t - o0) / (HUG_NOD[1] - HUG_NOD[0])));
    fx.look.w = t < HUG_LOOK[0] || (t > HUG_LOOK[1] && t < HUG_GO[1]) ? 1 : 0;
    // Las manos buscan su sitio mientras rodean; abrazados, se quedan en él (al mecerse, no resbalan).
    const spot = fx.hug;
    if (t < i0) spot.hr = spot.ha = spot.lr = spot.la = NaN;
    const hold = t >= i1 && !Number.isNaN(spot.ha) && !Number.isNaN(spot.la);
    if (t < i0 || t > HUG_GO[1]) return;
    // Cuánto pesan (entran en HUG_IN y se van al soltarla), cuánto llevan rodeado y cuánto resbalado.
    const kw = smooth(Math.min((t - i0) / HUG_IN, t < HUG_GO[0] ? 1 : 1 - (t - HUG_GO[0]) / (HUG_GO[1] - HUG_GO[0])));
    const wrap = t < i1 ? smooth((t - i0) / (i1 - i0)) : 1;
    const slide = t > o0 ? smooth((t - o0) / (o1 - o0)) : 0;
    // Su cintura y su pecho (rig.ts → torsoAt: 0 y 1), y por dónde va cada mano.
    const yourWaist = rig?.torsoAt(0, _c, _f, _l, _band) ? _c.y : b.y + you.shoulder - HUG_LOW * you.arm;
    const yourChest = rig?.torsoAt(1, _c, _f, _l, _band) ? _c.y : b.y + you.shoulder - HUG_HIGH * you.arm;
    const yourSpan = yourChest - yourWaist > 0.05 ? yourChest - yourWaist : 0.15;
    const yourTop = rig?.shoulderAt(0, _e) ? _e.y : b.y + you.shoulder;
    const myTop = mine?.shoulderAt(1, _s) ? _s.y : ay + me.shoulder;
    hugHeights(myTop, me, yourWaist, yourTop, you);
    const reach = HUG_REACH * (me.arm + me.hand * PALM_AT);
    for (let i = 0; i < 2; i++) {
      const high = i === 0;
      // La derecha va por su izquierda (que es tu derecha), la izquierda por su derecha.
      const sgn = high ? 1 : -1;
      if (!mine?.shoulderAt(high ? 1 : 0, _s)) _s.set(ax + rx * me.width * sgn, ay + me.shoulder, az + rz * me.width * sgn);
      const y = hold ? yourWaist + (high ? spot.hr : spot.lr) : high ? _hh.high : _hh.low;
      // Su tronco a esa altura, un óvalo (centro y semiejes), y de su costado hacia su columna (y algo
      // más allá), todo lo que llegue tu brazo (desde tu hombro, donde está ahora).
      ovalAt(rig, y, yourWaist, yourSpan, b, nx, nz, rx, rz, you, high);
      const ex = _ov.ex, ez = _ov.ez;
      // Lo más que llega: por pasos y, entre el último que no llega y el primero que sí, afinando. Abrazados,
      // desde donde quedó la mano: solo se corre hacia su costado, y solo si ya no llega bien.
      let a = hold ? (high ? spot.ha : spot.la) : high ? HUG_AROUND_HIGH : HUG_AROUND_LOW;
      around(a, sgn, ex, ez);
      if (_p.distanceTo(_s) > reach) {
        let far = a;
        while (a > 0) {
          a = Math.max(0, a - HUG_STEP);
          around(a, sgn, ex, ez);
          if (_p.distanceTo(_s) <= reach) break;
          far = a;
        }
        if (_p.distanceTo(_s) <= reach)
          for (let k = 0, near = a; k < 4; k++) {
            const mid = (near + far) / 2;
            around(mid, sgn, ex, ez);
            if (_p.distanceTo(_s) <= reach) near = a = mid;
            else far = mid;
          }
      }
      if (high) {
        spot.hr = y - yourWaist;
        spot.ha = a;
      } else {
        spot.lr = y - yourWaist;
        spot.la = a;
      }
      // El codo: el de arriba, sobre su hombro (o por su costado, si no llega); el de abajo, por su
      // costado, entre tu hombro y tu mano. Hacia donde se pide va el plano del brazo (rig.ts → reachArm).
      if (wrap < 1) {
        // Rodeándola: desde delante de su costado (la de arriba, por encima de su hombro) y algo por
        // fuera, hasta su sitio en su espalda.
        // La de arriba, por encima de su hombro: rodea arriba y baja a su sitio ya por detrás (por su
        // costado, el antebrazo le atravesaba el hombro).
        const from = high ? HUG_FROM_HIGH : HUG_FROM_LOW;
        const y0 = (high ? yourTop : y) + from.up;
        const yw = y0 + (y - y0) * (high ? smooth((wrap - HUG_OVER_AT) / (1 - HUG_OVER_AT)) : wrap);
        ovalAt(rig, yw, yourWaist, yourSpan, b, nx, nz, rx, rz, you, high);
        around(from.a + (a - from.a) * (high ? smooth(wrap / HUG_OVER_AT) : wrap), sgn, _ov.ex, _ov.ez);
        _p.addScaledVector(_n, from.out * (1 - wrap));
      } else {
        ovalAt(rig, y, yourWaist, yourSpan, b, nx, nz, rx, rz, you, high);
        around(a, sgn, ex, ez);
      }
      // Las palmaditas (la de arriba): se separa un poco y vuelve.
      if (high)
        for (const p0 of PATS) {
          const u = (t - p0) / PAT_S;
          if (u > 0 && u < 1) {
            const lift = PAT_LIFT * Math.sin(u * Math.PI);
            _p.addScaledVector(_n, lift);
            _p.y += lift * 0.4;
          }
        }
      const ey = high ? Math.min(yourTop + HUG_OVER_UP, _s.y + HUG_OVER_UP + 0.02) : (_s.y + _p.y) / 2 - 0.04;
      const over = high && ey > yourTop - 0.04;
      if (high || over) {
        _e.copy(_c).addScaledVector(_l, sgn * (over ? you.width + HUG_OVER_OUT : _band.side + 0.05)).addScaledVector(_f, -(over ? HUG_OVER_BACK : HUG_ELBOW_BACK) * ez);
        _e.y = ey;
        _e.sub(_s);
      } else _e.set(rx * sgn * HUG_LOW_OUT - nx * HUG_LOW_BACK, -1, rz * sgn * HUG_LOW_OUT - nz * HUG_LOW_BACK);
      // La palma, mirando su espalda.
      _pn.copy(_n).negate();
      if (slide > 0) {
        // Resbalando a sus brazos: de su espalda, por fuera de su costado (a media altura), hasta su
        // brazo (una curva: en línea recta, la mano le atravesaba). La palma gira de su espalda a su
        // brazo y el codo baja junto a tu costado.
        _pp.copy(_p);
        armSpot(rig, high, b, nx, nz, rx, rz, you, _s, ARM_REACH * (me.arm + me.hand * PALM_AT), yourWaist, yourSpan);
        _p.copy(_pp);
        const u = slide, v = 1 - slide;
        if (high) {
          // La de arriba vuelve por encima de su hombro (como fue): sube por detrás de su cuello, pasa por
          // encima del hombro y baja a su brazo.
          _a1.copy(_p);
          _a1.y = Math.max(_p.y, yourTop + SLIDE_UP);
          _a2.copy(_q).addScaledVector(_qn, -SLIDE_OUT);
          _a2.y = Math.max(_q.y, yourTop + SLIDE_UP);
          _p.multiplyScalar(v * v * v).addScaledVector(_a1, 3 * v * v * u).addScaledVector(_a2, 3 * v * u * u).addScaledVector(_q, u * u * u);
        } else {
          // La de abajo, por fuera de su costado (a media altura).
          ovalAt(rig, (_p.y + _q.y) / 2, yourWaist, yourSpan, b, nx, nz, rx, rz, you, high);
          _c.addScaledVector(_l, sgn * (_ov.ex + SLIDE_OUT));
          _p.multiplyScalar(v * v).addScaledVector(_c, 2 * u * v).addScaledVector(_q, u * u);
        }
        _pn.multiplyScalar(v).addScaledVector(_qn, u).normalize();
        // El codo, abajo, por fuera y algo hacia atrás.
        _pe.set(rx * sgn * 0.25 - nx * 0.05, -0.35, rz * sgn * 0.25 - nz * 0.05);
        _e.multiplyScalar(v).addScaledVector(_pe, u);
      }
      put(high ? fx.reachR : fx.reachL, kw * 0.97, _p.x, _p.y, _p.z, _e.x, _e.y, _e.z, _pn.x, _pn.y, _pn.z, 0, 0, 0, slide > 0.5 ? "relaxed" : "together");
    }
  }
}
