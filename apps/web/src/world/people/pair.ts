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
 * persona y el mismo vaivén para las dos; y el abrazo, a cada lado un brazo por encima del otro (cruzado
 * o, si uno es bastante más alto, ese con los dos por encima), las palmas apoyadas en su espalda
 * (quietas donde quedan, con dos palmaditas) y ningún brazo a través de nadie: lo que ocupa cada uno sale
 * de su malla (shape.ts) y el codo va por donde no la atraviesa (around.ts).
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
import { BODY, type BodySize, type Embrace, type PersonFx, type Rig, type Target, type TorsoBand } from "./rig";
import type { BaseHand } from "./hands";
import { armFit, clearHand, restHand, restOn, swivel, touch, type Swivel } from "./around";
import { SHAPE, type BodyShape } from "./shape";

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
 * Abrazo, los hombros (`hugBody`): dónde se mide lo que abulta el hombro (de su hueso, del hombro al
 * codo), lo que puede meterse en su ropa (m) y lo deprisa que se aparta la cadera si se meten los dos
 * (1/s) y hasta dónde (m).
 */
const SHOULDER_AT = 0.1;
/** Abrazo: lo deprisa que se aparta la cabeza (m/s): al cambiar de lado de golpe, el cuerpo entero saltaba. */
const HEAD_SPEED = 0.35;
const HUG_ROOM = 0.012;
const AWAY_GAIN = 6;
const AWAY_MAX = 0.06;
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
const HUG_IN = 0.06;
/** Abrazo: lo que tarda la mano en ir de donde la tiene el gesto al camino que rodea a la otra persona (s); y al soltarla, en qué parte del final deja de pesar. */
const HUG_START = 0.3;
const HUG_LET = 0.35;
/** Abrazo: de donde la tenía el gesto a su camino, cuánto se abomba la curva hacia fuera de ella (por lo que hay de uno a otro) y, la de arriba, hacia arriba (por cada metro hacia fuera). */
const START_ARC = 0.35;
const START_UP = 0.5;
/** Abrazo: lo deprisa que va una mano, como mucho (m/s, desde tu hombro), y lo deprisa que gira hacia donde queda de cara a ella (1/s). */
const HAND_SPEED = 3;
const NORMAL_RATE = 14;
const FINGERS_RATE = 12;
/** Abrazo, al soltarla: la mano junto a tu costado (lo que baja por lo que mide el brazo, y algo por fuera y delante, m). */
const REST_DOWN = 0.9;
const REST_OUT = 0.05;
const REST_FWD = 0.04;
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
/**
 * Al resbalar, la de arriba: lo que se separa primero de su espalda (m: subiendo pegada a ella, se le
 * metía donde se abomba, en los omóplatos y el hombro), a cuánto pasa por encima de su hombro (m, de lo
 * que ocupa: su articulación queda cinco centímetros por debajo y, por encima de ella, la mano le
 * atravesaba el hombro y el brazo) y lo que se adelanta la curva en lo alto (por lo que mide cada tramo).
 */
const SLIDE_CLEAR = 0.045;
/**
 * Al resbalar, la de arriba va primero por su espalda hasta detrás de su hombro: cuánto bajo su hombro
 * (m, en un cuerpo como `BODY`), por dónde (rad, desde su costado: detrás de su omóplato) y lo que se
 * separa de ella (m).
 */
const SLIDE_BEHIND = 0.06;
const SLIDE_A = 0.6;
const SLIDE_LIFT = 0.04;
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
 * radianes) y lo que separa, como poco, la altura de una mano de la otra a cada lado (m).
 */
const HUG_AROUND_HIGH = Math.PI / 2 + 0.12;
const HUG_AROUND_LOW = Math.PI / 2;
const HUG_APART = 0.08;
/**
 * Abrazo: desde cuánto más alto de hombros (m) quien es más alto va con los dos brazos por encima de los
 * hombros de la otra persona (y ella, con los dos por debajo de los suyos): un brazo por encima del
 * hombro de alguien bastante más alto no llega a rodearlo y se le mete en el pecho.
 */
const HUG_CROSS = 0.09;

/**
 * Abrazo: si tu mano derecha (`right`) o la izquierda va por encima del hombro de la otra persona o por
 * debajo de su brazo, con tus hombros `dh` m más altos que los suyos (de pie): a cada lado, un brazo por
 * encima del otro. Con alturas parecidas, cruzado (la derecha de cada uno por encima); si uno es bastante
 * más alto, ese, los dos por encima, y la otra persona, los dos por debajo.
 */
export function hugOver(dh: number, right: boolean): boolean {
  return dh > HUG_CROSS || (dh >= -HUG_CROSS && right);
}
/**
 * Abrazo, dónde va cada mano (`hugSpot`): los sitios que se prueban, de más hacia su columna a menos
 * (rad) y, en cada uno, de su altura a más arriba o más abajo (m, en un cuerpo como `BODY`); lo que
 * puede meterse un brazo en la ropa de la otra persona (m); cada cuánto se vuelve a elegir mientras se
 * acercan (s) y lo deprisa que va la mano al sitio nuevo (1/s).
 */
const OVER_A = [HUG_AROUND_HIGH, 1.25, 0.95, 0.75, 0.55, 0.35];
const UNDER_A = [HUG_AROUND_LOW, 1.2, 0.9, 0.6, 0.3];
/** La de arriba: de su sitio hacia arriba y, después, alrededor de lo alto de su hombro (m sobre sus hombros). */
const OVER_UP = [0, 0.05];
const OVER_TOP = [-0.05, -0.01, 0.03, 0.07, 0.11];
const UNDER_UP = [0, 0.05, -0.04];
/** Con los dos brazos por encima de sus hombros: lo más que rodea cada mano (rad; π/2 es su columna). */
const HUG_BOTH_A = 1.25;
const HUG_TOL = 0.01;
const HUG_SEARCH = 0.2;
const HUG_SETTLE = 7;
/**
 * Abrazo: la palma, apoyada en lo que ocupa la otra persona (en su tronco, sus hombros o sus brazos: lo
 * que esté más fuera; en la cabeza, no): hasta cuánto se acerca a ella si queda lejos (m).
 */
const HUG_PULL = 0.05;
const REST = SHAPE.all & ~SHAPE.head;
/** Su tronco, sus hombros y su cabeza (sin sus brazos): hacia dónde mira la palma al rodearla. */
const TRUNK = SHAPE.all & ~(SHAPE.leftArm | SHAPE.rightArm);
/** Abrazo: los dedos de la mano que va por encima de su hombro, hacia abajo por su espalda (lo que se suma hacia abajo a la dirección del antebrazo). */
const HUG_DRAPE = 0.8;
/**
 * Abrazo: el codo que va por encima de su hombro, por fuera de él y algo por encima (m, en un cuerpo
 * como `BODY`): el brazo rodea su hombro (por encima, el brazo corto de quien no es mucho más alto se
 * le metía en el hombro).
 */
const HUG_ELBOW_OUT = 0.12;
const HUG_ELBOW_UP = 0.04;
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
const _v2 = new THREE.Vector3();
const _f2 = new THREE.Vector3();
/** Su brazo, del hombro al codo (armSpot: no es `_w`, que lleva hacia dónde van tus dedos). */
const _aw = new THREE.Vector3();
/** Al resbalar la de arriba: detrás de su hombro (y hacia fuera de ella ahí), lo alto de su hombro y hacia dónde va la curva en cada punto. */
const _sP = new THREE.Vector3();
const _sN = new THREE.Vector3();
const _sT = new THREE.Vector3();
const _sD = new THREE.Vector3();
const _sE = new THREE.Vector3();

/** Una curva de `a` a `b` (Hermite): saliendo de `a` hacia `da` y llegando a `b` hacia `db` (unitarios), con la fuerza de lo que miden (`len`), a `w` (0–1) de ella. */
function hermite(a: THREE.Vector3, da: THREE.Vector3, b: THREE.Vector3, db: THREE.Vector3, len: number, w: number, out: THREE.Vector3) {
  const w2 = w * w, w3 = w2 * w;
  const h00 = 2 * w3 - 3 * w2 + 1, h10 = (w3 - 2 * w2 + w) * len, h01 = -2 * w3 + 3 * w2, h11 = (w3 - w2) * len;
  out.set(a.x * h00 + da.x * h10 + b.x * h01 + db.x * h11, a.y * h00 + da.y * h10 + b.y * h01 + db.y * h11, a.z * h00 + da.z * h10 + b.z * h01 + db.z * h11);
}
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
function put(t: Target, w: number, x: number, y: number, z: number, px: number, py: number, pz: number, nx: number, ny: number, nz: number, ux: number, uy: number, uz: number, shape: BaseHand | null = null, hinge = 0) {
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
  t.hinge = hinge;
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
function hugBody(w: number, t: number, ax: number, ay: number, az: number, b: THREE.Vector3, nx: number, nz: number, rx: number, rz: number, fx: PersonFx, other: PersonFx | null, me: BodySize, you: BodySize) {
  const h = fx.hug, mine = fx.rig, rig = other?.rig;
  h.on = true;
  h.w = w;
  // Los hombros: si los dos se te meten en su cuerpo (quien es bastante más bajo, con los hombros a la
  // altura de su pecho), la cadera se aparta poco a poco lo que haga falta; si no, vuelve.
  const dt = Number.isNaN(h.lt) || t < h.lt ? 0 : Math.min(0.1, t - h.lt);
  if (Number.isNaN(h.lt) || t < h.lt) h.away = h.px = h.pz = 0;
  h.lt = t;
  // Lo que se apartaba la cabeza el frame anterior: se va hacia lo nuevo a su ritmo.
  const hx0 = h.hx, hz0 = h.hz;
  const shape = rig?.shape;
  if (shape && mine && w > 0) {
    let lack = Infinity;
    for (let s = 0; s < 2; s++) {
      if (!mine.shoulderAt(s as 0 | 1, _v2)) continue;
      lack = Math.min(lack, (mine.shape ? mine.shape.limb(s as 0 | 1, 0, SHOULDER_AT) : 0.06) - shape.distance(_v2.x, _v2.y, _v2.z, SHAPE.torso | SHAPE.shoulders | SHAPE.head));
    }
    if (Number.isFinite(lack)) h.away = Math.min(AWAY_MAX, Math.max(0, h.away + (lack - HUG_ROOM) * AWAY_GAIN * dt));
  }
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
    fwd -= h.away;
  }
  // Las cabezas, mejilla con mejilla: cada una se ladea hacia la otra (a su derecha) y quien es más alto
  // la inclina sobre la otra persona (por lo que le saca de pie); quien es más bajo no la levanta.
  const dh = ay + me.head - (b.y + you.head);
  h.nod = Math.min(HEAD_NOD_MAX, Math.max(0, dh * HEAD_NOD));
  h.roll = HEAD_ROLL + Math.min(HEAD_ROLL_MAX, Math.abs(dh) * HEAD_ROLL_K);
  // A su izquierda solo con alturas parecidas: si uno es bastante más alto, sus dos brazos van por encima
  // de los hombros de la otra persona y su cabeza, en medio, no estorba a ninguno.
  const side = Math.abs(ay + me.shoulder - (b.y + you.shoulder)) > HUG_CROSS ? 0 : (HUG_SIDE * me.shoulder) / BODY.shoulder;
  h.x = nx * fwd - rx * side;
  h.z = nz * fwd - rz * side;
  h.y = -HUG_DROP * Math.hypot(fwd, side) - Math.min(HUG_KNEES_MAX, tall * HUG_KNEES);
  h.hx = -nx * Math.min(HEAD_BACK, into / 2);
  h.hz = -nz * Math.min(HEAD_BACK, into / 2);
  if (both) headClear(h, mine!, rig!, shape ?? null, rx, rz, nx, nz);
  // A su ritmo (al empezar, ya).
  if (dt > 0) {
    const most = HEAD_SPEED * dt;
    h.hx = hx0 + Math.max(-most, Math.min(most, h.hx - hx0));
    h.hz = hz0 + Math.max(-most, Math.min(most, h.hz - hz0));
  }
}

/**
 * Abrazo: tu cabeza, fuera de su cuerpo y de su cabeza (sumado a lo que ya se aparta, `h.hx`/`h.hz`).
 */
function headClear(h: Embrace, mine: Rig, rig: Rig, shape: BodyShape | null, rx: number, rz: number, nx: number, nz: number) {
  const hc = mine.headCenter, r = mine.headRadius;
  // Fuera de su cuerpo (su pecho y sus hombros; de sus brazos se apartan ellos, que si no se
  // perseguían): si se mete, se aparta en horizontal lo que le falta (la mejilla, apoyada en su hombro,
  // se le metía); hacia el mismo lado que el frame anterior si «hacia fuera» se da la vuelta.
  if (shape) {
    const lack = r - shape.distance(hc.x, hc.y, hc.z, SHAPE.torso | SHAPE.shoulders);
    if (lack > 0) {
      shape.outward(hc.x, hc.y, hc.z, SHAPE.torso | SHAPE.shoulders, _v2);
      _v2.y = 0;
      if (_v2.lengthSq() < 1e-6) _v2.set(-nx, 0, -nz);
      _v2.normalize();
      if (_v2.x * h.px + _v2.z * h.pz < 0) _v2.set(h.px, 0, h.pz);
      h.px = _v2.x;
      h.pz = _v2.z;
      h.hx += _v2.x * lack;
      h.hz += _v2.z * lack;
    }
  }
  // Las cabezas: lo que falta de lado (a tu izquierda, −r) para que quepan, la mitad cada uno.
  const dx = hc.x - rig.headCenter.x, dy = hc.y - rig.headCenter.y, dz = hc.z - rig.headCenter.z;
  const lat = -(dx * rx + dz * rz), along = dx * nx + dz * nz;
  const need = r + rig.headRadius + HEAD_GAP;
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
 * Abrazo: la palma apoyada en su espalda en el sitio (`y`, `a`): por la dirección del óvalo a esa altura
 * (rodeándola `a` rad desde su costado, por su izquierda si `sgn` es 1), en lo que ocupa de verdad (lo
 * primero que toca desde fuera, around.ts → restOn); sin su silueta, en el óvalo. En `_p` y `_n`.
 */
function spotOn(body: BodyShape | null, rig: Rig | null | undefined, y: number, a: number, sgn: number, waist: number, span: number, b: THREE.Vector3, nx: number, nz: number, rx: number, rz: number, you: BodySize, over: boolean) {
  ovalAt(rig, y, waist, span, b, nx, nz, rx, rz, you, over);
  around(a, sgn, _ov.ex, _ov.ez);
  if (!body) return;
  _ray.copy(_p).sub(_c);
  _ray.y = 0;
  if (_ray.lengthSq() < 1e-8) return;
  _ray.normalize();
  _from.copy(_c);
  _from.y = _p.y;
  if (!restOn(body, REST, _from, _ray, HUG_PALM, _p, _n)) touch(body, REST, _p, HUG_PALM, HUG_PULL, _n);
}
const _ray = new THREE.Vector3();
const _from = new THREE.Vector3();

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
 * Abrazo, al soltarse: dónde va tu mano (en `_q`, y hacia dónde mira tu palma en `_qn`; `sgn`: tu
 * derecha, 1, va por su izquierda, y tu izquierda, −1, por su derecha). La que iba por encima de su
 * hombro, en la parte de fuera de su brazo de ese lado, entre su hombro y su codo (lo más cerca del
 * hombro que llegue tu brazo); la que iba por debajo de su brazo, en su costado, a la altura de su
 * cintura y algo por delante: como en la grabación, una le sujeta el brazo y la otra la cintura. Su
 * brazo de ese lado va por debajo del tuyo, a tu cintura, así que no depende de tus brazos (si cada uno
 * buscara el brazo que busca el suyo, se perseguían). Con su esqueleto, en su cuerpo tal como está;
 * sin él, de pie frente a ti, con el brazo colgando.
 */
function armSpot(rig: Rig | null | undefined, over: boolean, sgn: number, b: THREE.Vector3, nx: number, nz: number, rx: number, rz: number, you: BodySize, s: THREE.Vector3, reach: number, waist: number, span: number) {
  if (!over) {
    ovalAt(rig, waist + FLANK_UP * (you.arm / BODY.arm), waist, span, b, nx, nz, rx, rz, you, false);
    around(FLANK_A, sgn, _ov.ex, _ov.ez);
    _q.copy(_p);
    _qn.copy(_n).negate();
    return;
  }
  // Su brazo de tu lado: su izquierdo es tu derecha (estáis de frente).
  if (rig?.armAt(sgn > 0 ? 0 : 1, 0, _a1) && rig.armAt(sgn > 0 ? 0 : 1, 1, _a2)) {
    let at = ARM_ALONG;
    for (; at < 1; at += 0.1) {
      _q.copy(_a1).lerp(_a2, at);
      if (_q.distanceTo(s) <= reach) break;
    }
    _q.copy(_a1).lerp(_a2, Math.min(1, at));
    _aw.copy(_a2).sub(_a1).normalize();
  } else {
    _a1.set(b.x + rx * sgn * you.width, b.y + you.shoulder, b.z + rz * sgn * you.width);
    _aw.set(-nx * 0.2, -1, -nz * 0.2).normalize();
    _q.copy(_a1).addScaledVector(_aw, ARM_ALONG * 0.48 * you.arm);
  }
  // Hacia fuera de su brazo (sin lo que va a lo largo de él), y la palma por fuera, mirándolo.
  _qn.set(rx * sgn, 0, rz * sgn).addScaledVector(_aw, -(rx * sgn * _aw.x + rz * sgn * _aw.z)).normalize();
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
    // costado hasta su espalda. A cada lado, un brazo por encima del otro: con alturas parecidas,
    // cruzado (tu derecha por encima de su hombro izquierdo, por fuera, y tu izquierda por debajo de su
    // brazo derecho); si uno es bastante más alto (`HUG_CROSS`), ese, los dos por encima de sus hombros y
    // la otra persona, los dos por debajo de sus brazos. Cada mano, en su espalda lo más hacia su columna
    // que se pueda sin que el brazo atraviese a nadie (`hugSpot`; el codo, por donde no la atraviese:
    // around.ts, con lo que ocupan los dos cuerpos, shape.ts), con la palma apoyada en ella. Abrazados,
    // se quedan ahí (con dos palmaditas). Al soltarse (de o0 a o1), las manos resbalan hasta su brazo y
    // su cintura y se quedan ahí, mirándose, hasta soltarla (`HUG_GO`). Sin el esqueleto de la otra
    // persona, donde estaría de pie. Y el cuerpo (`hugBody`): la cadera y la cabeza.
    const rig = other?.rig, mine = fx.rig;
    // Lo que ocupan los dos ahora (shape.ts): para que ni los cuerpos ni los brazos se metan en nadie.
    const body = rig?.shape ?? null;
    body?.begin();
    mine?.shape?.begin();
    const [b0, b1, b2, b3] = HUG_BODY;
    const bw = t < b0 ? 0 : t < b1 ? (t - b0) / (b1 - b0) : t < b2 ? 1 : t < b3 ? 1 - (t - b2) / (b3 - b2) : 0;
    hugBody(bw * bw * (3 - 2 * bw), t, ax, ay, az, b, nx, nz, rx, rz, fx, other, me, you);
    // Quien es más alto apoya la cabeza cuando ya están abrazados (al llegar, mejilla con mejilla) y la
    // levanta al empezar a soltarse.
    fx.hug.nod *= smooth((t - HUG_NOD[0]) / (HUG_NOD[1] - HUG_NOD[0])) * (1 - smooth((t - o0) / (HUG_NOD[1] - HUG_NOD[0])));
    fx.look.w = t < HUG_LOOK[0] || (t > HUG_LOOK[1] && t < HUG_GO[1]) ? 1 : 0;
    const arms = fx.hug.arms;
    if (t < i0)
      for (const h of arms) {
        h.y = h.a = h.ty = h.ta = h.phi = h.spin = h.lt = h.ox = h.oy = h.oz = h.hx = h.hy = h.hz = h.nx = h.ny = h.nz = h.wx = h.wy = h.wz = h.ex = h.ey = h.ez = NaN;
        h.at = -1;
      }
    if (t < i0 || t > HUG_GO[1]) return;
    // Cuánto pesan: entran deprisa (la mano sale de donde la tiene el gesto: `HUG_IN`) y, al soltarla, la
    // mano vuelve junto a tu costado (`rest`) y solo al final deja de pesar: a medio camino entre el
    // gesto y la otra persona, el brazo se le metía. Y cuánto llevan rodeado y cuánto resbalado.
    const go = t > HUG_GO[0] ? smooth((t - HUG_GO[0]) / (HUG_GO[1] - HUG_GO[0])) : 0;
    const kw = smooth(Math.min((t - i0) / HUG_IN, (1 - go) / HUG_LET));
    const start = smooth((t - i0) / HUG_START);
    const wrap = t < i1 ? smooth((t - i0) / (i1 - i0)) : 1;
    const slide = t > o0 ? smooth((t - o0) / (o1 - o0)) : 0;
    // Su cintura y su pecho (rig.ts → torsoAt: 0 y 1), y por dónde va cada mano.
    const yourWaist = rig?.torsoAt(0, _c, _f, _l, _band) ? _c.y : b.y + you.shoulder - HUG_LOW * you.arm;
    const yourChest = rig?.torsoAt(1, _c, _f, _l, _band) ? _c.y : b.y + you.shoulder - HUG_HIGH * you.arm;
    const yourSpan = yourChest - yourWaist > 0.05 ? yourChest - yourWaist : 0.15;
    const yourTop = rig?.shoulderAt(0, _e) ? _e.y : b.y + you.shoulder;
    const myTop = mine?.shoulderAt(1, _s) ? _s.y : ay + me.shoulder;
    hugHeights(myTop, me, yourWaist, yourTop, you);
    // Quién va por encima a cada lado (lo mismo desde los dos lados: sale de lo que miden los dos).
    const dh = ay + me.shoulder - (b.y + you.shoulder);
    const tall = dh > HUG_CROSS, short = dh < -HUG_CROSS;
    const k = you.shoulder / BODY.shoulder;
    for (let i = 0; i < 2; i++) {
      const right = i === 0, sgn = right ? 1 : -1, side = right ? 1 : 0;
      const arm = arms[i]!;
      // Por encima de su hombro, o por debajo de su brazo; y de qué se aparta: el de encima, también de sus brazos.
      const over = hugOver(dh, right);
      const mask = SHAPE.all;
      if (!mine?.shoulderAt(side, _s)) _s.set(ax + rx * me.width * sgn, ay + me.shoulder, az + rz * me.width * sgn);
      // Su sitio: se elige mientras la rodea (cada poco: aún se están acercando) y al abrazarse; después,
      // se queda. Del que había al elegido, sin saltos.
      const y0 = over ? (tall && !right ? _hh.high - HUG_APART : _hh.high) : short && right ? _hh.low + HUG_APART * 0.5 : _hh.low;
      if (Number.isNaN(arm.ta) || (t - arm.at > HUG_SEARCH && t < i1 + HUG_SEARCH)) {
        if (mine) hugSpot(mine, side, sgn, over, tall, y0, yourTop, k, body, mask, rig, yourWaist, yourSpan, b, nx, nz, rx, rz, you);
        else (_hs.y = y0), (_hs.a = over ? HUG_AROUND_HIGH : HUG_AROUND_LOW);
        arm.ty = _hs.y - yourWaist;
        arm.ta = _hs.a;
        arm.at = t;
        if (Number.isNaN(arm.a)) (arm.y = arm.ty), (arm.a = arm.ta);
      }
      const dt = Number.isNaN(arm.lt) ? 0 : Math.min(0.1, Math.max(0, t - arm.lt));
      arm.lt = t;
      const settle = 1 - Math.exp(-HUG_SETTLE * dt);
      arm.y += (arm.ty - arm.y) * settle;
      arm.a += (arm.ta - arm.a) * settle;
      const y = yourWaist + arm.y, a = arm.a;
      // Dónde va el centro de la palma (`_p`), hacia fuera de ella (`_n`) y a cuánto de ella (`gap`).
      let gap = HUG_PALM;
      if (wrap < 1) {
        // Rodeándola: desde delante de su costado (la de arriba, por encima de su hombro) y algo por
        // fuera, hasta su sitio en su espalda (la de arriba rodea arriba y baja a su sitio ya por detrás),
        // sin meterse en ella al pasar.
        const from = over ? HUG_FROM_HIGH : HUG_FROM_LOW;
        const yf = (over ? yourTop : y) + from.up;
        const yw = yf + (y - yf) * (over ? smooth((wrap - HUG_OVER_AT) / (1 - HUG_OVER_AT)) : wrap);
        ovalAt(rig, yw, yourWaist, yourSpan, b, nx, nz, rx, rz, you, over);
        around(from.a + (a - from.a) * (over ? smooth(wrap / HUG_OVER_AT) : wrap), sgn, _ov.ex, _ov.ez);
        gap += from.out * (1 - wrap);
        _p.addScaledVector(_n, gap - HUG_PALM);
        // Fuera de ella (y de sus brazos), con la palma de cara a su tronco o su hombro, no a su brazo: al
        // pasar por debajo de él, la palma miraba a su brazo un frame y a su costado el siguiente, y el
        // antebrazo se retorcía media vuelta.
        if (body) {
          touch(body, mask, _p, gap, 0, _n);
          body.outward(_p.x, _p.y, _p.z, TRUNK, _n);
        }
      } else {
        // La palma, apoyada en su espalda (en lo que ocupa de verdad, no en el óvalo).
        spotOn(body, rig, y, a, sgn, yourWaist, yourSpan, b, nx, nz, rx, rz, you, over);
      }
      // Las palmaditas (la de arriba): se separa un poco y vuelve.
      if (right)
        for (const p0 of PATS) {
          const u = (t - p0) / PAT_S;
          if (u > 0 && u < 1) {
            const lift = PAT_LIFT * Math.sin(u * Math.PI);
            _p.addScaledVector(_n, lift);
            _p.y += lift * 0.4;
            gap += lift;
          }
        }
      // Los dedos, siguiendo al antebrazo (como va ahora: con ellos hacia otro lado, la muñeca se doblaba
      // en ángulo recto; la de encima de su hombro, además, hacia abajo por su espalda); el codo, como se
      // quiere (por fuera de su hombro o junto a tu costado).
      if (mine?.armAt(side, 1, _a1) && mine.armAt(side, 2, _a2)) _w.copy(_a2).sub(_a1);
      else _w.copy(_p).sub(_s);
      if (over) _w.normalize().y -= HUG_DRAPE;
      wantPole(over, sgn, rig, b, nx, nz, rx, rz, you, k);
      if (slide > 0) {
        // Resbalando a sus brazos: de su espalda, por fuera de su costado (a media altura), hasta su
        // brazo (una curva: en línea recta, la mano le atravesaba), sin meterse en ella; y ahí, apoyada en
        // su brazo de verdad (o en su costado). Los dedos van girando hacia su espalda, rodeando su brazo o
        // su cintura (hacia su codo se le metían en el antebrazo, y hacia abajo, en la cadera). Y el codo
        // baja junto a tu costado.
        _pp.copy(_p);
        _pe.copy(_n);
        armSpot(rig, over, sgn, b, nx, nz, rx, rz, you, _s, ARM_REACH * (me.arm + me.hand * PALM_AT), yourWaist, yourSpan);
        if (body) touch(body, over ? (sgn > 0 ? SHAPE.leftArm : SHAPE.rightArm) | SHAPE.shoulders : SHAPE.torso, _q, HUG_PALM, HUG_PULL, _qn);
        else _qn.negate();
        _p.copy(_pp);
        const u = slide, v = 1 - slide;
        if (over) {
          // La de encima de su hombro vuelve por encima de él (como fue): se separa de su espalda, va por
          // ella hacia su hombro (detrás de su omóplato: desde su columna derecha hacia lo alto, pasaba por
          // su nuca), sube por detrás del hombro, pasa por encima (a SLIDE_CLEAR de lo que ocupa, sobre su
          // articulación) y baja por fuera de su brazo. Una curva por esos cuatro puntos (Hermite), con la
          // palma girando de uno a otro.
          spotOn(body, rig, Math.max(_pp.y, yourTop - SLIDE_BEHIND * k), SLIDE_A, sgn, yourWaist, yourSpan, b, nx, nz, rx, rz, you, true);
          _sN.copy(_n);
          _sP.copy(_p).addScaledVector(_n, SLIDE_LIFT);
          if (!rig?.armAt(sgn > 0 ? 0 : 1, 0, _sT)) _sT.set(b.x + rx * sgn * you.width, yourTop, b.z + rz * sgn * you.width);
          _sD.set(0, 1, 0);
          if (!body || !restOn(body, REST, _sT, _sD, SLIDE_CLEAR, _a1, _a2)) _a1.copy(_sT).addScaledVector(_sD, SLIDE_UP);
          _sT.copy(_a1);
          const l0 = _pp.distanceTo(_sP), l1 = _sP.distanceTo(_sT), l2 = _sT.distanceTo(_q), all = l0 + l1 + l2 || 1;
          let at = u * all;
          if (at < l0) {
            // De su espalda, separándose, hacia detrás de su hombro.
            const w = at / Math.max(1e-6, l0);
            _sD.copy(_sP).sub(_pp).normalize().add(_pe).normalize();
            _sE.copy(_sT).sub(_pp).normalize();
            hermite(_pp, _sD, _sP, _sE, l0, w, _p);
            _n.copy(_pe).multiplyScalar(1 - smooth(w)).addScaledVector(_sN, smooth(w)).normalize();
          } else if ((at -= l0) < l1) {
            // Subiendo por detrás de su hombro hasta lo alto.
            const w = at / Math.max(1e-6, l1);
            _sD.copy(_sT).sub(_pp).normalize();
            _sE.copy(_q).sub(_sP).normalize();
            hermite(_sP, _sD, _sT, _sE, l1, w, _p);
            _n.copy(_sN).multiplyScalar(1 - smooth(w)).addScaledVector(_a2.set(0, 1, 0), smooth(w)).normalize();
          } else {
            // Por encima de su hombro y por fuera de su brazo, hasta él (llegando desde fuera).
            const w = Math.min(1, (at - l1) / Math.max(1e-6, l2));
            _sD.copy(_q).sub(_sP).normalize();
            _sE.copy(_q).sub(_sT).normalize().sub(_qn).normalize();
            hermite(_sT, _sD, _q, _sE, l2, w, _p);
            _n.set(0, 1, 0).multiplyScalar(1 - smooth(w)).addScaledVector(_qn, smooth(w)).normalize();
          }
        } else {
          // La de debajo de su brazo, por fuera de su costado (a media altura), a su cintura.
          ovalAt(rig, (_p.y + _q.y) / 2, yourWaist, yourSpan, b, nx, nz, rx, rz, you, false);
          _c.addScaledVector(_l, sgn * (_ov.ex + SLIDE_OUT));
          _p.multiplyScalar(v * v).addScaledVector(_c, 2 * u * v).addScaledVector(_q, u * u);
          _n.copy(_pe).multiplyScalar(v).addScaledVector(_qn, u).normalize();
        }
        gap = HUG_PALM;
        if (body && u < 1) gap = Math.max(gap, touch(body, mask, _p, HUG_PALM, 0, _pe));
        _pe.set(rx * sgn * 0.25 - nx * 0.05, -0.35, rz * sgn * 0.25 - nz * 0.05);
        _e.normalize().multiplyScalar(v).addScaledVector(_pe.normalize(), u);
        // Los dedos, siguiendo al antebrazo sin más (con ellos ya hacia su espalda, la muñeca se le metía
        // en la espalda al subir por ella).
        if (over) _w.y += HUG_DRAPE * v;
      }
      // Hacia fuera de ella y hacia dónde van los dedos, sin saltos: al pasar por encima de su hombro, lo
      // de fuera pasa de su costado a arriba y a su espalda en un par de frames, y la palma giraba igual
      // de deprisa (el antebrazo, media vuelta de golpe); y los dedos, que siguen al antebrazo, que a su
      // vez sigue a la mano, iban y venían entre dos codos.
      _w.normalize();
      if (!Number.isNaN(arm.nx) && dt > 0) {
        const k = 1 - Math.exp(-NORMAL_RATE * dt), kf = 1 - Math.exp(-FINGERS_RATE * dt);
        _n.set(arm.nx + (_n.x - arm.nx) * k, arm.ny + (_n.y - arm.ny) * k, arm.nz + (_n.z - arm.nz) * k).normalize();
        _w.set(arm.wx + (_w.x - arm.wx) * kf, arm.wy + (_w.y - arm.wy) * kf, arm.wz + (_w.z - arm.wz) * kf);
        if (_w.lengthSq() < 1e-6) _w.set(arm.wx, arm.wy, arm.wz);
        _w.normalize();
      }
      arm.nx = _n.x;
      arm.ny = _n.y;
      arm.nz = _n.z;
      arm.wx = _w.x;
      arm.wy = _w.y;
      arm.wz = _w.z;
      // La mano apoyada sin que se le meta la manga (la palma, `_pn`; los dedos, `_f2`).
      if (mine) restHand(mine, side, body, mask, _p, _n, gap, _w, _pn, _f2, arm, dt);
      else _pn.copy(_n).negate(), _f2.set(0, 0, 0);
      // Al empezar, desde donde la tenía el gesto (desde tu hombro, como estaba entonces); al soltarla,
      // de vuelta junto a tu costado, con la palma hacia tu muslo y los dedos hacia abajo. Sin meterse en
      // ella por el camino.
      if (mine && Number.isNaN(arm.ox) && mine.armAt(side, 1, _a1) && mine.armAt(side, 2, _a2)) {
        _w.copy(_a2).sub(_a1).normalize();
        _a2.addScaledVector(_w, me.hand * PALM_AT).sub(_s);
        arm.ox = _a2.x;
        arm.oy = _a2.y;
        arm.oz = _a2.z;
      }
      if (start < 1 && !Number.isNaN(arm.ox)) {
        // En curva, por fuera de ella (y la de arriba, algo por encima): en línea recta, de donde la tenía
        // el gesto (con alturas distintas, la de arriba sale de abajo) a su camino, la atravesaba.
        _a1.set(_s.x + arm.ox, _s.y + arm.oy, _s.z + arm.oz);
        const far = _a1.distanceTo(_p);
        _a2.set(_p.x + _a1.x - 2 * b.x, 0, _p.z + _a1.z - 2 * b.z);
        if (_a2.lengthSq() > 1e-8) _a2.normalize();
        if (over) _a2.y = START_UP;
        _p.multiplyScalar(start).addScaledVector(_a1, 1 - start).addScaledVector(_a2, START_ARC * far * 4 * start * (1 - start));
      }
      if (go > 0) {
        _a1.set(_s.x + rx * sgn * REST_OUT + nx * REST_FWD, _s.y - REST_DOWN * (me.arm + me.hand * PALM_AT), _s.z + rz * sgn * REST_OUT + nz * REST_FWD);
        _p.multiplyScalar(1 - go).addScaledVector(_a1, go);
        _pn.multiplyScalar(1 - go).add(_a1.set(-rx * sgn * go, 0, -rz * sgn * go)).normalize();
        _f2.multiplyScalar(1 - go).add(_a1.set(0, -go, 0));
        _f2.addScaledVector(_pn, -_f2.dot(_pn)).normalize();
        _pe.set(rx * sgn * 0.25 - nx * 0.05, -1, rz * sgn * 0.25 - nz * 0.05);
        _e.normalize().multiplyScalar(1 - go).addScaledVector(_pe.normalize(), go);
      }
      if (body && (start < 1 || go > 0)) touch(body, mask, _p, HUG_PALM, 0, _a1);
      // Y la mano entera fuera de ella (los dedos también: al ir, se le clavaban en el brazo).
      if (body && mine) clearHand(mine, side, body, mask, _p, _pn, _f2, _a1);
      // Sin saltos (desde tu hombro, que va con el cuerpo): si algo de lo de arriba cambia de golpe (por
      // dónde la saca de ella, hacia dónde van los dedos), la mano va hacia ahí a su ritmo.
      if (!Number.isNaN(arm.hx) && dt > 0) {
        _a1.set(_s.x + arm.hx, _s.y + arm.hy, _s.z + arm.hz);
        const jump = _p.distanceTo(_a1), most = HAND_SPEED * dt;
        if (jump > most) _p.lerpVectors(_a1, _p, most / jump);
      }
      arm.hx = _p.x - _s.x;
      arm.hy = _p.y - _s.y;
      arm.hz = _p.z - _s.z;
      // El codo, por donde no atraviese a nadie (ni a uno mismo).
      if (mine) {
        swivel(mine, side, body, mask, _p, _pn, _e, arm, _f2, dt);
      }
      put(right ? fx.reachR : fx.reachL, kw, _p.x, _p.y, _p.z, _e.x, _e.y, _e.z, _pn.x, _pn.y, _pn.z, _f2.x, _f2.y, _f2.z, "flat", 1);
    }
  }
}

/**
 * Abrazo: el codo que se quiere (desde tu hombro, en `_s`, en `_e`): el que va por encima de su hombro,
 * por fuera de él y algo por encima (con el brazo rodeando su hombro, no metido en él); el que va por
 * debajo de su brazo, abajo junto a tu costado, algo por fuera y hacia atrás.
 */
function wantPole(over: boolean, sgn: number, rig: Rig | null | undefined, b: THREE.Vector3, nx: number, nz: number, rx: number, rz: number, you: BodySize, k: number) {
  if (!over) {
    _e.set(rx * sgn * HUG_LOW_OUT - nx * HUG_LOW_BACK, -1, rz * sgn * HUG_LOW_OUT - nz * HUG_LOW_BACK);
    return;
  }
  // Su hombro de tu lado (su izquierdo, para tu derecha); si es más bajo, a medio camino del tuyo: el
  // codo, por fuera y arriba, no colgando hacia donde pasan sus brazos.
  if (!rig?.shoulderAt(sgn > 0 ? 0 : 1, _e)) _e.set(b.x + rx * sgn * you.width, b.y + you.shoulder, b.z + rz * sgn * you.width);
  _e.x += rx * sgn * HUG_ELBOW_OUT * k;
  _e.z += rz * sgn * HUG_ELBOW_OUT * k;
  _e.y = Math.max(_e.y, (_e.y + _s.y) / 2) + HUG_ELBOW_UP * k;
  _e.sub(_s);
}

/**
 * Abrazo: dónde va una mano en su espalda (en `_hs`: la altura, m, y cuánto la rodea, rad): de los sitios
 * de la lista (de más hacia su columna a menos, y a cada uno de su altura hacia arriba o abajo), el
 * primero en que el brazo no atraviesa a nadie con el codo como mejor quede (around.ts); si no hay
 * ninguno, el que menos.
 */
const _hs = { y: 0, a: 0 };
const _memo: Swivel = { phi: NaN };
function hugSpot(mine: Rig, side: 0 | 1, sgn: number, over: boolean, both: boolean, y0: number, top: number, k: number, body: BodyShape | null, mask: number, rig: Rig | null | undefined, waist: number, span: number, b: THREE.Vector3, nx: number, nz: number, rx: number, rz: number, you: BodySize) {
  let best = Infinity;
  const ups = over ? OVER_UP : UNDER_UP;
  for (const a of over ? OVER_A : UNDER_A)
    for (let j = 0; j < ups.length + (over ? OVER_TOP.length : 0); j++) {
      // Con los dos brazos por encima, cada mano en su lado de su espalda (si no, se montaban una en otra).
      if (both && a > HUG_BOTH_A) break;
      const y = j < ups.length ? y0 + ups[j]! * k : top + OVER_TOP[j - ups.length]! * k;
      if (j >= ups.length && y < y0 + ups[ups.length - 1]! * k) continue;
      spotOn(body, rig, y, a, sgn, waist, span, b, nx, nz, rx, rz, you, over);
      _w.copy(_p).sub(_s);
      if (over) _w.normalize().y -= HUG_DRAPE;
      restHand(mine, side, body, mask, _p, _n, HUG_PALM, _w, _pn, _f2);
      wantPole(over, sgn, rig, b, nx, nz, rx, rz, you, k);
      _memo.phi = _memo.ex = NaN;
      const pen = swivel(mine, side, body, mask, _p, _pn, _e, _memo) + 2 * armFit.short;
      if (pen < best) {
        best = pen;
        _hs.y = y;
        _hs.a = a;
      }
      if (pen <= HUG_TOL) return;
    }
}
