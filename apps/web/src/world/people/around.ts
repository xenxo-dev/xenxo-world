/**
 * Un brazo alrededor de otra persona (el abrazo, pair.ts), con lo que ocupan los dos cuerpos
 * (shape.ts): con la mano donde va, por dónde va el codo (girando el brazo alrededor de la línea del
 * hombro a la muñeca) para que ni el brazo ni el antebrazo atraviesen a la otra persona ni a uno mismo,
 * y lo más cerca posible de donde se quiere el codo y de donde estaba el frame anterior (sin saltos).
 * Con solo un codo «hacia arriba y por fuera», el brazo se metía en sus hombros y en su pecho.
 */
import * as THREE from "three";
import type { Rig } from "./rig";
import { SHAPE, type BodyShape } from "./shape";

/** Hasta dónde de la muñeca a los nudillos cae el centro de la palma (como en rig.ts). */
const PALM_AT = 0.55;
/** Lo que se deja de más entre un brazo y lo que rodea (m). */
export const ARM_MARGIN = 0.008;
/**
 * Lo que cuesta apartarse del codo que se quiere y del de antes (por cada radián de giro, en m² de lo
 * que se metería el brazo: 90° del que se quiere valen lo que meterse algo más de un centímetro).
 */
const K_PREF = 1.5e-4;
const K_KEEP = 3e-4;
/** Lo deprisa que puede girar el codo alrededor de la línea del hombro a la muñeca (rad/s). */
const SWIVEL_SPEED = 12;
/** Los giros que se prueban: todos alrededor (sin uno de antes) o cerca del de antes (rad). */
const ALL = 16;
const NEAR = [0, 0.1, -0.1, 0.25, -0.25, 0.5, -0.5, 0.9, -0.9];
/** Sin su malla medida, lo que abultan un brazo y un antebrazo (m). */
const LIMB = [0.055, 0.045];
/**
 * Lo que puede girar el antebrazo, desde como queda la palma con el codo doblado sin girarlo (la de la
 * pose en T: de cara a la línea del codo), sin que cueste (rad) y lo que cuesta cada radián de más (en m²
 * de lo que se metería): por no meterse en nadie, el codo se iba por encima y la mano quedaba retorcida
 * (el antebrazo, girado más de media vuelta).
 */
const ROLL_FREE = 1.3;
const K_ROLL = 4e-3;
/** Por dónde se mira cada hueso: del brazo, desde el hombro (lo de antes ya toca el tronco); del antebrazo, todo. */
const UPPER = [0.15, 0.3, 0.45, 0.7, 1];
const LOWER = [0, 0.35, 0.7, 1];

/**
 * El codo que se eligió el frame anterior: su giro (rad, desde el que se quiere; NaN, ninguno aún) y dónde
 * quedó, desde el hombro (m, mundo): de un frame a otro se sigue desde ahí (mientras la mano rodea a la
 * otra persona, la línea del hombro a la muñeca gira y el mismo giro ya es otro codo).
 */
export interface Swivel {
  phi: number;
  ex?: number;
  ey?: number;
  ez?: number;
}

const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _W = new THREE.Vector3();
const _D = new THREE.Vector3();
const _C = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _f = new THREE.Vector3();
const _q = new THREE.Vector3();
const _bestE = new THREE.Vector3();
/**
 * Lo que dio el último `swivel`: lo que se mete el brazo (m; en uno mismo, `self`), lo que le falta a la
 * mano para llegar y dónde quedan el codo y la muñeca.
 */
export const armFit = { pen: 0, self: 0, short: 0, shoulder: new THREE.Vector3(), elbow: new THREE.Vector3(), wrist: new THREE.Vector3(), side: 0 as 0 | 1 };

/** El círculo de los codos posibles con la muñeca en _W (centro _C, radio el que devuelve, ejes _e1 hacia `pole` y _e2). */
function circle(la: number, lb: number, pole: THREE.Vector3): number {
  _D.copy(_W).sub(_S);
  let d = _D.length();
  const max = (la + lb) * 0.995, min = Math.abs(la - lb) + 0.01;
  armFit.short = Math.max(0, d - max);
  if (d > max) _D.multiplyScalar(max / d), (d = max);
  else if (d < min) _D.multiplyScalar(min / Math.max(d, 1e-4)), (d = min);
  const a = (la * la + d * d - lb * lb) / (2 * d);
  _D.divideScalar(d);
  _C.copy(_S).addScaledVector(_D, a);
  _e1.copy(pole).addScaledVector(_D, -pole.dot(_D));
  if (_e1.lengthSq() < 1e-8) _e1.set(0, -1, 0).addScaledVector(_D, _D.y);
  _e1.normalize();
  _e2.crossVectors(_D, _e1);
  _W.copy(_S).addScaledVector(_D, d);
  return Math.sqrt(Math.max(0, la * la - a * a));
}

/**
 * Lo que se meten (m, lo más; negativo, lo que sobra) y lo que cuesta un codo en _E con el hombro en
 * _S y la muñeca en _W: el brazo y el antebrazo en la otra persona y el antebrazo en uno mismo.
 */
function score(side: 0 | 1, mine: BodyShape | null, you: BodyShape | null, mask: number, out: { pen: number; cost: number; self: number }) {
  let pen = -Infinity, cost = 0, self = -Infinity;
  const hit = (e: number) => {
    if (e > pen) pen = e;
    if (e > -ARM_MARGIN) cost += (e + ARM_MARGIN) * (e + ARM_MARGIN);
  };
  for (const k of UPPER) {
    _q.copy(_S).lerp(_E, k);
    const r = mine ? mine.limb(side, 0, k) : LIMB[0]!;
    if (you) hit(r - you.distance(_q.x, _q.y, _q.z, mask));
  }
  for (const k of LOWER) {
    _q.copy(_E).lerp(_W, k);
    const r = mine ? mine.limb(side, 1, k) : LIMB[1]!;
    if (you) hit(r - you.distance(_q.x, _q.y, _q.z, mask));
    if (mine && k > 0) {
      const e = r - mine.distance(_q.x, _q.y, _q.z, SHAPE.torso | SHAPE.head | SHAPE.legs);
      if (e > self) self = e;
      hit(e);
    }
  }
  out.pen = pen;
  out.cost = cost;
  out.self = self;
}

const _sc = { pen: 0, cost: 0, self: 0 };
const _ua = new THREE.Vector3();
const _fa = new THREE.Vector3();
const _hg = new THREE.Vector3();
const _np = new THREE.Vector3();
const _cr = new THREE.Vector3();

/**
 * Lo que tendría que girar el antebrazo (rad) con el codo en _E (el hombro en _S y la muñeca en _W) para
 * que la palma mire hacia `n`: desde la palma de cara a la línea del codo (como en la pose en T), alrededor
 * del antebrazo. Con el brazo casi estirado no hay línea del codo: 0.
 */
function roll(side: 0 | 1, n: THREE.Vector3): number {
  _ua.copy(_E).sub(_S);
  _fa.copy(_W).sub(_E);
  const la = _ua.length(), lb = _fa.length();
  _hg.crossVectors(_ua, _fa);
  const h = _hg.length();
  if (h < 0.25 * la * lb) return 0;
  _hg.multiplyScalar((side ? -1 : 1) / h);
  _fa.divideScalar(lb);
  _np.copy(n).addScaledVector(_fa, -n.dot(_fa));
  if (_np.lengthSq() < 1e-6) return 0;
  _np.normalize();
  return Math.atan2(_cr.crossVectors(_hg, _np).dot(_fa), _hg.dot(_np));
}

/**
 * El codo de un brazo de `me` (`side`: 0 izquierdo, 1 derecho) con el centro de la palma en `p` y la
 * palma hacia `n` (mundo), alrededor de `you` (sus partes de `mask`; sin ella, solo uno mismo). `pole`
 * entra con hacia dónde se quiere el codo (desde el hombro, como `Target.px…`) y sale con hacia dónde
 * va; `memo`, el giro del frame anterior; `fingers`, hacia dónde apuntan los dedos si se piden (como
 * `Target.ux…`); `dt`, lo que ha pasado desde el frame anterior (s: el codo gira a su ritmo). Antes,
 * `begin()` de los dos cuerpos en este frame. Devuelve lo
 * que se mete el brazo, como mucho (m; negativo, lo que queda de sobra); en `armFit.short`, lo que le
 * falta a la mano para llegar.
 */
export function swivel(me: Rig, side: 0 | 1, you: BodyShape | null, mask: number, p: THREE.Vector3, n: THREE.Vector3, pole: THREE.Vector3, memo: Swivel, fingers: THREE.Vector3 | null = null, dt = 0): number {
  if (!me.armAt(side, 0, _S) || !me.armAt(side, 1, _E) || !me.armAt(side, 2, _W)) return (armFit.pen = 0);
  const la = _S.distanceTo(_E), lb = _E.distanceTo(_W);
  const po = me.size.hand * PALM_AT;
  const mine = me.shape;
  // La muñeca: desde el centro de la palma hacia atrás, por donde van los dedos (los que se piden o, si
  // no, siguiendo al antebrazo, en el plano de la palma: primero, como si fuera del hombro a la mano).
  const told = !!fingers && fingers.lengthSq() > 0.25;
  if (told) _f.copy(fingers!);
  else {
    _f.copy(p).sub(_S);
    _f.addScaledVector(n, -_f.dot(n));
    if (_f.lengthSq() < 1e-8) _f.copy(p).sub(_S);
  }
  _f.normalize();
  _W.copy(p).addScaledVector(_f, -po);
  let h = circle(la, lb, pole);
  // Los giros: cerca del de antes (donde quedó el codo, en este círculo) y, si no hay uno de antes (o
  // cerca de él no hay sitio), todos alrededor.
  let prev = memo.phi;
  if (!Number.isNaN(prev) && memo.ex !== undefined && !Number.isNaN(memo.ex)) {
    _q.set(_S.x + memo.ex - _C.x, _S.y + memo.ey! - _C.y, _S.z + memo.ez! - _C.z);
    const u = _q.dot(_e1), v = _q.dot(_e2);
    if (u * u + v * v > 1e-8) prev = Math.atan2(v, u);
  }
  const fresh = Number.isNaN(prev);
  let best = Infinity, bestPhi = 0, bestPen = Infinity;
  const near = fresh ? 0 : NEAR.length;
  for (let i = 0; i < near + ALL; i++) {
    if (i === near && !fresh && bestPen <= 0) break;
    const phi = i < near ? prev + NEAR[i]! : ((i - near) / ALL) * Math.PI * 2 - Math.PI;
    _E.copy(_C).addScaledVector(_e1, h * Math.cos(phi)).addScaledVector(_e2, h * Math.sin(phi));
    score(side, mine, you, mask, _sc);
    const twist = Math.abs(roll(side, n)) - ROLL_FREE;
    const c = _sc.cost + K_PREF * (1 - Math.cos(phi)) + (fresh ? 0 : K_KEEP * (1 - Math.cos(phi - prev))) + (twist > 0 ? K_ROLL * twist * twist : 0);
    if (c < best) (best = c), (bestPhi = phi), (bestPen = _sc.pen), _bestE.copy(_E);
  }
  // Sin saltos: el codo gira hacia el elegido a su ritmo (de un giro a otro lejano, de una vez, el brazo
  // saltaba un frame y volvía; y dos brazos que se apartan el uno del otro se perseguían).
  if (!fresh && dt > 0) {
    const d = Math.atan2(Math.sin(bestPhi - prev), Math.cos(bestPhi - prev));
    const most = SWIVEL_SPEED * dt;
    if (Math.abs(d) > most) {
      // Hacia el elegido por el lado que menos se mete (por el más corto, el codo podía pasar a través de
      // ella), y más deprisa si donde está se mete.
      let stepBest = Infinity, step = 0;
      for (const dir of [Math.sign(d), -Math.sign(d)]) {
        const phi = prev + dir * most;
        _E.copy(_C).addScaledVector(_e1, h * Math.cos(phi)).addScaledVector(_e2, h * Math.sin(phi));
        score(side, mine, you, mask, _sc);
        // (El largo, solo si es claramente mejor.)
        const c = _sc.cost + (dir === Math.sign(d) ? 0 : 1e-4);
        if (c < stepBest) (stepBest = c), (step = dir);
      }
      _E.copy(_C).addScaledVector(_e1, h * Math.cos(prev)).addScaledVector(_e2, h * Math.sin(prev));
      score(side, mine, you, mask, _sc);
      const fast = _sc.pen > 0.01 ? Math.min(3, 1 + _sc.pen / 0.02) : 1;
      bestPhi = prev + step * Math.min(most * fast, step === Math.sign(d) ? Math.abs(d) : Math.PI * 2 - Math.abs(d));
    }
    _bestE.copy(_C).addScaledVector(_e1, h * Math.cos(bestPhi)).addScaledVector(_e2, h * Math.sin(bestPhi));
  }
  // La muñeca, sin romperse (con los dedos que se piden): si se dobla de más o el antebrazo gira de más
  // con este codo, la mano entera se gira hacia el antebrazo (en `n` y `fingers`), y la muñeca y el
  // codo, otra vez con el mismo giro (si no, el brazo quedaba donde no se había mirado).
  if (told && wrist(side, n, fingers!)) {
    _f.copy(fingers!).normalize();
    _W.copy(p).addScaledVector(_f, -po);
    h = circle(la, lb, pole);
    _E.copy(_C).addScaledVector(_e1, h * Math.cos(bestPhi)).addScaledVector(_e2, h * Math.sin(bestPhi));
    score(side, mine, you, mask, _sc);
    bestPen = _sc.pen;
    _bestE.copy(_E);
  }
  // Con el antebrazo ya donde va, la muñeca otra vez (si los dedos lo siguen) y el codo con el mismo giro.
  _f.copy(_W).sub(_bestE);
  _f.addScaledVector(n, -_f.dot(n));
  if (!told && _f.lengthSq() > 1e-8) {
    _f.normalize();
    _W.copy(p).addScaledVector(_f, -po);
    h = circle(la, lb, pole);
    _E.copy(_C).addScaledVector(_e1, h * Math.cos(bestPhi)).addScaledVector(_e2, h * Math.sin(bestPhi));
    score(side, mine, you, mask, _sc);
    bestPen = _sc.pen;
    _bestE.copy(_E);
  } else {
    _E.copy(_bestE);
    score(side, mine, you, mask, _sc);
  }
  armFit.self = _sc.self;
  armFit.shoulder.copy(_S);
  armFit.elbow.copy(_bestE);
  armFit.wrist.copy(_W);
  armFit.side = side;
  memo.phi = Math.atan2(Math.sin(bestPhi), Math.cos(bestPhi));
  memo.ex = _bestE.x - _S.x;
  memo.ey = _bestE.y - _S.y;
  memo.ez = _bestE.z - _S.z;
  pole.copy(_bestE).sub(_S);
  return (armFit.pen = bestPen);
}

/**
 * Lleva `p` a `gap` m de la superficie de `you` (sus partes de `mask`), por donde sale de ella (en `out`,
 * hacia fuera): si está más cerca (o dentro), hacia fuera; si está más lejos y `pull`, hacia dentro
 * (hasta `pull` m como mucho). Para apoyar la palma en ella, o que no se meta al pasar.
 */
export function touch(you: BodyShape, mask: number, p: THREE.Vector3, gap: number, pull: number, out: THREE.Vector3): number {
  let d = you.distance(p.x, p.y, p.z, mask);
  for (let i = 0; i < 4; i++) {
    let move = gap - d;
    if (move < 0) {
      move = Math.max(move, -pull);
      pull += move;
    }
    if (Math.abs(move) < 0.002) break;
    you.outward(p.x, p.y, p.z, mask, out);
    p.addScaledVector(out, move);
    d = you.distance(p.x, p.y, p.z, mask);
  }
  you.outward(p.x, p.y, p.z, mask, out);
  return d;
}

/** La mano apoyada: lo que se hunde la manga en la ropa de la otra persona y lo que abultan las puntas de los dedos (m). */
const CUFF_SQUEEZE = 0.01;
const TIP = 0.011;
/** Del centro de la palma a las puntas de los dedos, por lo que mide la mano (de la muñeca a los nudillos). */
const TIP_AT = 1.3;
/** Dónde se mira si los dedos se meten (de las puntas, 1, a los nudillos, por lo que mide la mano) y lo más que se levantan (seno). */
const KNUCKLES = [1, 0.7, 0.4];
/** Dónde se mira si la mano entera está fuera (del centro de la palma, 0, a las puntas, 1). */
const CLEAR = [0, 0.4, 0.7, 1];
const LIFT_MAX = 0.35;
const _t = new THREE.Vector3();
const _c2 = new THREE.Vector3();
const _f3 = new THREE.Vector3();
/** Al buscar dónde se apoya la palma: desde cuánto fuera de su eje y a qué pasos (m). */
const REST_FAR = 0.45;
const REST_STEP = 0.02;
/** Lo que se prueba a girar la mano sobre la palma para que no se meta (rad). */
const TURNS = [0, 0.4, -0.4, 0.8, -0.8];
const _at = new THREE.Vector3();
/**
 * Lo que se prueba a girar los dedos sobre la palma, desde hacia donde se piden, si así se le meterían
 * (rad): con la mano encima de su hombro y los dedos hacia su cuello, o en su cintura y los dedos hacia
 * su cadera, la mano entera se levantaba hasta veinte centímetros. Lo que cuesta cada radián de giro y
 * apartarse del giro de antes (en m de lo que se meterían), lo deprisa que gira (rad/s) y lo más que se
 * levanta la mano entera (m; si aún se mete algo, clearHand la saca por donde se mete).
 */
const SPIN = [0, 0.35, -0.35, 0.7, -0.7];
const SPIN_COST = 0.01;
const SPIN_KEEP = 0.015;
const SPIN_SPEED = 4;
const LIFT_HAND = 0.03;

/** Lo que se giraron los dedos sobre la palma el frame anterior (rad; NaN, aún nada): sin saltos. */
export interface HandFit {
  spin: number;
}

/**
 * Una mano apoyada en alguien sin que la manga se le meta: la palma plana dejaba la muñeca a dos
 * centímetros de su ropa y el puño de una chaqueta abulta cinco. Así que la mano se inclina lo justo
 * (las puntas de los dedos tocan y la muñeca queda separada lo que abulta la manga en la muñeca, menos
 * lo que se hunde) y su centro sube lo que haga falta. Y sin que se le metan los dedos (donde su cuerpo
 * se curva hacia la mano, como entre el hombro y el cuello): si las puntas o los nudillos quedan dentro
 * de `you` (sus partes de `mask`), los dedos se levantan y, si ni así, la mano entera. `p`: el centro de
 * la palma a `gap` m de la superficie (hacia fuera, `out`); `along`: por dónde van los dedos sobre ella.
 * Sale en `p`, en `palm` (hacia dónde mira la palma) y en `fingers` (hacia dónde apuntan los dedos).
 */
export function restHand(me: Rig, side: 0 | 1, you: BodyShape | null, mask: number, p: THREE.Vector3, out: THREE.Vector3, gap: number, along: THREE.Vector3, palm: THREE.Vector3, fingers: THREE.Vector3, memo: HandFit | null = null, dt = 0) {
  _t.copy(along).addScaledVector(out, -along.dot(out));
  if (_t.lengthSq() < 1e-8) _t.set(0, -1, 0).addScaledVector(out, out.y);
  _t.normalize();
  const hand = me.size.hand, cuff = me.shape ? me.shape.limb(side, 1, 1) : LIMB[1]!, tip = hand * TIP_AT;
  let s = Math.min(0.45, Math.max(0, (cuff - CUFF_SQUEEZE - TIP) / (hand * (TIP_AT + PALM_AT))));
  p.addScaledVector(out, Math.max(0, TIP + tip * s - gap));
  if (you) {
    // Hacia dónde, los dedos: hacia donde se piden o, si así se le meterían, girados sobre la palma lo
    // justo (lo que se meten tal cual y lo que quedaría con los dedos levantados del todo, que obliga a
    // levantar la mano entera); y sin saltos, cerca del giro de antes y a su ritmo.
    const prev = memo ? memo.spin : NaN, had = !Number.isNaN(prev);
    let best = Infinity, spin = 0;
    for (const r of SPIN) {
      _f3.copy(_t).applyAxisAngle(out, r);
      const c = 0.3 * fingerLack(you, mask, p, out, _f3, s, tip) + fingerLack(you, mask, p, out, _f3, -LIFT_MAX, tip) + SPIN_COST * Math.abs(r) + (had ? SPIN_KEEP * Math.abs(r - prev) : 0);
      if (c < best) (best = c), (spin = r);
    }
    if (had && dt > 0) spin = prev + Math.max(-SPIN_SPEED * dt, Math.min(SPIN_SPEED * dt, spin - prev));
    if (memo) memo.spin = spin;
    if (spin) _t.applyAxisAngle(out, spin);
  }
  let lifted = 0;
  for (let i = 0; i < 4; i++) {
    const c = Math.sqrt(1 - s * s);
    fingers.copy(_t).multiplyScalar(c).addScaledVector(out, -s);
    if (!you) break;
    // Las puntas y los nudillos: lo que les falta para quedar fuera.
    const lack = fingerLack(you, mask, p, out, _t, s, tip);
    if (lack < 0.002) break;
    // Primero se levantan los dedos (hasta apuntar algo hacia fuera) y, si ni así, la mano entera (poco).
    const ds = lack / tip;
    if (s - ds >= -LIFT_MAX) s -= ds;
    else {
      const up = Math.min(lack, LIFT_HAND - lifted);
      if (up > 0) p.addScaledVector(out, up), (lifted += up);
      s = Math.max(-LIFT_MAX, s - ds);
    }
  }
  const c = Math.sqrt(1 - s * s);
  palm.copy(out).multiplyScalar(-c).addScaledVector(_t, -s);
  fingers.copy(_t).multiplyScalar(c).addScaledVector(out, -s);
}

/** Lo que les falta a las puntas y los nudillos para quedar fuera de `you`, con los dedos hacia `dir` (sobre la palma) y levantados `s` (seno; negativo, hacia fuera). */
function fingerLack(you: BodyShape, mask: number, p: THREE.Vector3, out: THREE.Vector3, dir: THREE.Vector3, s: number, tip: number): number {
  const c = Math.sqrt(1 - s * s);
  let lack = 0;
  for (const k of KNUCKLES) {
    const r = tip * k;
    _q.copy(p).addScaledVector(dir, c * r).addScaledVector(out, -s * r);
    lack = Math.max(lack, TIP - you.distance(_q.x, _q.y, _q.z, mask));
  }
  return lack;
}

/**
 * La mano entera fuera de `you` (sus partes de `mask`): el centro de la palma en `p`, mirando hacia
 * `palm`, y los dedos hacia `fingers`; si la palma, los nudillos, las puntas o el pulgar quedan dentro
 * (al ir hacia su espalda o al soltarla, con sus brazos también moviéndose; y el pulgar, con la mano
 * encima de su hombro, en su pecho), la mano sale por donde está lo que más se mete.
 */
export function clearHand(me: Rig, side: 0 | 1, you: BodyShape, mask: number, p: THREE.Vector3, palm: THREE.Vector3, fingers: THREE.Vector3, out: THREE.Vector3) {
  // Primero, girando la mano sobre la palma (los dedos hacia un lado u otro), la que menos se mete: con
  // la mano encima de su hombro, el pulgar se le clavaba en el cuello y había que levantarla entera.
  let best = Infinity, turn = 0;
  for (const r of TURNS) {
    _f3.copy(fingers).applyAxisAngle(palm, r);
    const lack = handLack(me, side, you, mask, p, palm, _f3);
    if (lack < best - 0.002) (best = lack), (turn = r);
    if (best < 0.002) break;
  }
  if (turn) fingers.applyAxisAngle(palm, turn);
  // Y, si aún se mete algo, la mano sale por donde está lo que más se mete.
  for (let i = 0; i < 3; i++) {
    const lack = handLack(me, side, you, mask, p, palm, fingers);
    if (lack < 0.002) return;
    you.outward(_at.x, _at.y, _at.z, mask, out);
    p.addScaledVector(out, lack);
  }
}

/** Lo más que se mete en `you` la mano (palma, nudillos, puntas y pulgar); dónde, en `_at`. */
function handLack(me: Rig, side: 0 | 1, you: BodyShape, mask: number, p: THREE.Vector3, palm: THREE.Vector3, fingers: THREE.Vector3): number {
  const tip = me.size.hand * TIP_AT, th = me.thumbTip(side);
  _c2.crossVectors(fingers, palm);
  let lack = 0;
  for (let j = 0; j < CLEAR.length + (th ? 2 : 0); j++) {
    // Los dedos (del centro de la palma a las puntas) y el pulgar (a medio camino y su punta).
    if (j < CLEAR.length) _q.copy(p).addScaledVector(fingers, tip * CLEAR[j]!);
    else {
      const k = j === CLEAR.length ? 0.5 : 1;
      _q.copy(p).addScaledVector(fingers, th!.a * k).addScaledVector(palm, th!.b * k).addScaledVector(_c2, th!.c * k);
    }
    const l = TIP - you.distance(_q.x, _q.y, _q.z, mask);
    if (l > lack) (lack = l), _at.copy(_q);
  }
  return lack;
}

/**
 * Dónde se apoya la palma en `you` (sus partes de `mask`) yendo desde fuera hacia `from` (el eje de su
 * tronco a esa altura) por `dir` (hacia fuera, unitario): lo primero que toca, más `gap` m (lo más de
 * fuera: su tronco, o su hombro o su brazo si están delante). En `p` y, hacia fuera de ella, en `out`.
 * Desde un óvalo y acercándose a lo que ocupa, la mano encima de su hombro se quedaba a cinco
 * centímetros en el aire. Sin nada en esa dirección, false.
 */
export function restOn(you: BodyShape, mask: number, from: THREE.Vector3, dir: THREE.Vector3, gap: number, p: THREE.Vector3, out: THREE.Vector3): boolean {
  let lo = 0, hi = REST_FAR;
  if (you.distance(from.x + dir.x * hi, from.y + dir.y * hi, from.z + dir.z * hi, mask) < gap) return false;
  // De fuera hacia dentro, a pasos, hasta quedar a menos de `gap`; y después, afinando entre los dos.
  let s = hi;
  for (; s > 0; s -= REST_STEP) if (you.distance(from.x + dir.x * s, from.y + dir.y * s, from.z + dir.z * s, mask) < gap) break;
  if (s <= 0) return false;
  lo = s;
  hi = s + REST_STEP;
  for (let i = 0; i < 5; i++) {
    const m = (lo + hi) / 2;
    if (you.distance(from.x + dir.x * m, from.y + dir.y * m, from.z + dir.z * m, mask) < gap) lo = m;
    else hi = m;
  }
  p.copy(from).addScaledVector(dir, hi);
  you.outward(p.x, p.y, p.z, mask, out);
  return true;
}

/**
 * Lo más que se dobla la muñeca (rad, de la línea del antebrazo a la de los dedos): con el codo donde no
 * atraviesa a nadie, a veces la mano tenía que doblarse en ángulo recto (o más) para quedar apoyada
 * mientras rodeaba a la otra persona.
 */
const WRIST_MAX = 1.1;
/** Y lo más que gira el antebrazo (rad, desde la palma de cara a la línea del codo: `roll`). */
const ROLL_MAX = 1.75;
const _fw = new THREE.Vector3();
const _ax2 = new THREE.Vector3();
const _qw = new THREE.Quaternion();

/**
 * La mano (hacia dónde mira la palma, `palm`, y hacia dónde apuntan los dedos, `fingers`), con el codo
 * en `_bestE` (el hombro en `_S` y la muñeca en `_W`): el antebrazo, girado como mucho ROLL_MAX, y la
 * muñeca, doblada como mucho WRIST_MAX; si se pasan, la mano entera se gira hacia el antebrazo lo que
 * sobra (la palma deja de estar del todo apoyada, pero la muñeca no se rompe). True si la ha girado.
 */
function wrist(side: 0 | 1, palm: THREE.Vector3, fingers: THREE.Vector3): boolean {
  _fw.copy(_W).sub(_bestE);
  if (_fw.lengthSq() < 1e-8 || fingers.lengthSq() < 1e-8) return false;
  _fw.normalize();
  let turned = false;
  _E.copy(_bestE);
  const r = roll(side, palm);
  if (Math.abs(r) > ROLL_MAX) {
    _qw.setFromAxisAngle(_fw, -Math.sign(r) * (Math.abs(r) - ROLL_MAX));
    fingers.applyQuaternion(_qw);
    palm.applyQuaternion(_qw);
    turned = true;
  }
  const bend = fingers.angleTo(_fw);
  if (bend > WRIST_MAX) {
    _ax2.crossVectors(fingers, _fw);
    if (_ax2.lengthSq() > 1e-10) {
      _qw.setFromAxisAngle(_ax2.normalize(), bend - WRIST_MAX);
      fingers.applyQuaternion(_qw);
      palm.applyQuaternion(_qw);
      turned = true;
    }
  }
  return turned;
}
