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
 * hombro de la otra persona y la izquierda por debajo de su brazo), las palmas en su espalda y los
 * codos por fuera de su cuerpo.
 *
 * Se acerca quien la propone (`pairStep`, selfPeople.ts) y quien acepta se queda quieto: así quien se
 * mueve ve a su pareja donde está de verdad (a quien se mueve, por la red, se le ve un poco tarde) y se
 * para justo a su distancia. Mientras dura, no se chocan (collision.ts): un abrazo es más cerca que
 * dos cuerpos.
 */
import * as THREE from "three";
import type { PairAction } from "@xenxo/protocol";
import { BODY, type BodySize, type PersonFx, type Target, type TorsoBand } from "./rig";

/** Cuánto dura cada una (s) y cuándo entran y salen las manos (s). */
export const PAIR: Record<PairAction, { s: number; reach: [number, number, number, number] }> = {
  high_five: { s: 1.55, reach: [0.22, 0.55, 0.78, 1.15] },
  hug: { s: 2.3, reach: [0.4, 0.9, 1.8, 2.2] },
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
 * Abrazo: entre los dos pechos (m), del centro de la palma a la espalda que toca (m) y, sin su
 * esqueleto, a qué altura bajo su hombro van las manos (por lo que mide su brazo).
 */
const HUG_GAP = 0.01;
const HUG_PALM = 0.018;
const HUG_HIGH = 0.1;
const HUG_LOW = 0.6;
/**
 * Abrazo: hasta dónde rodea (de su costado, 0, hacia su columna, en radianes), en qué pasos y lo que se
 * estira el brazo para llegar (por lo que mide); y lo que separa, como poco, la altura de una mano de
 * la otra (m).
 */
const HUG_AROUND = 1.3;
const HUG_STEP = 0.13;
const HUG_REACH = 0.84;
const HUG_APART = 0.08;
/** Abrazo: de dónde a dónde de su tronco (0, su cintura; 1, su pecho: rig.ts → torsoAt). */
const HUG_BOTTOM = -0.5;
const HUG_TOP = 1.25;
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _f = new THREE.Vector3();
const _l = new THREE.Vector3();
const _s = new THREE.Vector3();
const _band: TorsoBand = { front: 0, back: 0, side: 0 };
/** Quien se acerca: a qué velocidad, como poco y como mucho (m/s). */
const STEP_MIN = 1.4;
const STEP_MAX = 5;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

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
    // Pecho con pecho (lo que abulta cada uno por delante, con la ropa).
    _g.y = 0;
    _g.ha = a.front;
    _g.hb = b.front;
    _g.gap = a.front + b.front + HUG_GAP;
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

/** Una mano: el centro de su palma a (x, y, z), el codo hacia (px, py, pz), la palma hacia n y los dedos hacia u (mundo; a 0, siguiendo al antebrazo). */
function put(t: Target, w: number, x: number, y: number, z: number, px: number, py: number, pz: number, nx: number, ny: number, nz: number, ux: number, uy: number, uz: number) {
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
}

/**
 * Abrazo: a qué altura van tus manos (en su tronco), con tu cintura y tu pecho a `myWaist` y
 * `myWaist + mySpan` y los suyos a `yourWaist`… Cada mano va por donde se puede abrazar el tronco del
 * otro (de algo por debajo de su cintura a algo por encima de su pecho) y, a cada lado, un brazo
 * encima del otro: tu derecha sobre su izquierda y su derecha sobre tu izquierda (cruzado), a la
 * altura en que coinciden los dos troncos; con mucha diferencia de altura, los brazos de quien es más
 * alto van por encima de los del otro. Igual desde los dos lados (en `_hh`).
 */
const _hh = { right: 0, left: 0 };
function hugHeights(myWaist: number, mySpan: number, yourWaist: number, yourSpan: number) {
  // Por dónde pueden ir tus manos (en su tronco) y las suyas (en el tuyo).
  const aLo = yourWaist + HUG_BOTTOM * yourSpan, aHi = yourWaist + HUG_TOP * yourSpan;
  const bLo = myWaist + HUG_BOTTOM * mySpan, bHi = myWaist + HUG_TOP * mySpan;
  const lo = Math.max(aLo, bLo), hi = Math.min(aHi, bHi);
  const c = (lo + hi) / 2, d = Math.max(HUG_APART, (hi - lo) * 0.3);
  const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
  // A cada lado, el de encima (tu derecha; al otro lado, la suya) y el de debajo, como poco a
  // HUG_APART: se abren hasta donde se pueda y, si así no cabe, al revés.
  split(clamp(c + d, aLo, aHi), aLo, aHi, clamp(c - d, bLo, bHi), bLo, bHi);
  _hh.right = _sp.o;
  split(clamp(c + d, bLo, bHi), bLo, bHi, clamp(c - d, aLo, aHi), aLo, aHi);
  _hh.left = _sp.u;
}

/** Dos manos de un mismo lado (`o`, la que va encima, y `u`), cada una entre sus límites: separadas (en `_sp`). */
const _sp = { o: 0, u: 0 };
function split(o: number, oLo: number, oHi: number, u: number, uLo: number, uHi: number) {
  for (let k = 0; k < 2; k++) {
    const miss = HUG_APART - (o - u);
    if (miss <= 0) break;
    o = Math.min(oHi, o + (k ? miss : miss / 2));
    u = Math.max(uLo, u - (k ? miss : miss / 2));
  }
  if (o - u < HUG_APART - 1e-6) {
    // No cabe así: la otra encima.
    for (let k = 0; k < 2; k++) {
      const miss = HUG_APART - (u - o);
      if (miss <= 0) break;
      u = Math.min(uHi, u + (k ? miss : miss / 2));
      o = Math.max(oLo, o - (k ? miss : miss / 2));
    }
  }
  _sp.o = o;
  _sp.u = u;
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
    // Abrazo, cruzado: cada brazo rodea su tronco, la derecha por encima de la altura en que se cruzan
    // los brazos y la izquierda por debajo (así, a cada lado, el brazo de uno va encima del del otro),
    // y la palma se apoya en él, de lado y hacia la espalda todo lo que llegue el brazo (con brazos
    // cortos o un tronco grueso, más hacia su costado), mirándolo y con los dedos siguiendo al
    // antebrazo; el codo, por fuera. Con su esqueleto, en su tronco tal como está ahora (rig.ts →
    // torsoAt: inclinado en el abrazo, también); sin él, donde estaría de pie.
    const rig = other?.rig, mine = fx.rig;
    // Por dónde se puede abrazar cada tronco (de algo por debajo de su cintura a algo por encima de su
    // pecho: rig.ts → torsoAt) y dónde se cruzan los brazos: en medio de lo que tienen en común los dos.
    const myWaist = mine?.torsoAt(0, _c, _f, _l, _band) ? _c.y : ay + me.shoulder - HUG_LOW * me.arm;
    const myChest = mine?.torsoAt(1, _c, _f, _l, _band) ? _c.y : ay + me.shoulder - HUG_HIGH * me.arm;
    const yourWaist = rig?.torsoAt(0, _c, _f, _l, _band) ? _c.y : b.y + you.shoulder - HUG_LOW * you.arm;
    const yourChest = rig?.torsoAt(1, _c, _f, _l, _band) ? _c.y : b.y + you.shoulder - HUG_HIGH * you.arm;
    const yourSpan = yourChest - yourWaist || 0.2;
    hugHeights(myWaist, myChest - myWaist || 0.2, yourWaist, yourSpan);
    const reach = HUG_REACH * (me.arm + me.hand * PALM_AT);
    for (let i = 0; i < 2; i++) {
      const high = i === 0;
      // La derecha va por su izquierda (que es tu derecha), la izquierda por su derecha.
      const sgn = high ? 1 : -1;
      if (!mine?.shoulderAt(high ? 1 : 0, _s)) _s.set(ax + rx * me.width * sgn, ay + me.shoulder, az + rz * me.width * sgn);
      const y = high ? _hh.right : _hh.left;
      if (!rig?.torsoAt(Math.min(HUG_TOP, Math.max(HUG_BOTTOM, (y - yourWaist) / yourSpan)), _c, _f, _l, _band)) {
        // Sin su esqueleto: de pie, frente a ti.
        _c.set(b.x, y, b.z);
        _f.set(-nx, 0, -nz);
        _l.set(rx, 0, rz);
        _band.front = you.front;
        _band.back = (you.back + you.waist) / 2;
        _band.side = you.side;
      }
      // Su tronco a esa altura, un óvalo (centro y semiejes), y de su costado hacia su columna, todo lo
      // que llegue tu brazo (desde tu hombro, donde está ahora).
      const ex = _band.side, ez = (_band.front + _band.back) / 2;
      _c.addScaledVector(_f, (_band.front - _band.back) / 2);
      for (let a = HUG_AROUND; ; a -= HUG_STEP) {
        const cs = Math.cos(Math.max(0, a)), sn = Math.sin(Math.max(0, a));
        _n.copy(_l).multiplyScalar((sgn * cs) / ex).addScaledVector(_f, -sn / ez).normalize();
        _p.copy(_c).addScaledVector(_l, sgn * ex * cs).addScaledVector(_f, -ez * sn).addScaledVector(_n, HUG_PALM);
        if (a <= 0 || _p.distanceTo(_s) <= reach) break;
      }
      if (high) put(fx.reachR, k * 0.95, _p.x, _p.y, _p.z, rx * 0.6, 0.8, rz * 0.6, -_n.x, -_n.y, -_n.z, 0, 0, 0);
      else put(fx.reachL, k * 0.95, _p.x, _p.y, _p.z, -rx, -0.45, -rz, -_n.x, -_n.y, -_n.z, 0, 0, 0);
    }
  }
}
