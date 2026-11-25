/**
 * Hablar con el cuerpo, sobre el esqueleto (people/talk.ts dice dónde va cada cosa; aquí se pone): lo que
 * se suma al tronco, los hombros, el cuello y la cabeza, y los brazos y las manos de la actuación, con su
 * peso, encima de lo que ya hubiera en los huesos normalizados del VRM. Los brazos, con la IK de los
 * gestos hechos en código (people/gestures.ts → solveArm), respecto a la clavícula tal como ha quedado,
 * y la muñeca no se dobla más de `SAY_WRIST` (el pipeline de vídeo la dejaba en 30° al conversar: con
 * el ruido de la postura se doblaba de más). Lo usan el animador (animation.ts) y su prueba (test/talk.mts).
 */
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { gestureHands, solveArm } from "./gestures";
import { FINGER_BONES, forVrm0 } from "./hands";
import type { SayFrame, Trunk, TrunkBand, V3 } from "./talk";

/** Lo más que se dobla la muñeca al hablar (rad). */
export const SAY_WRIST = 30 * (Math.PI / 180);

interface SayLimb {
  shoulder: THREE.Object3D | null;
  upper: THREE.Object3D | null;
  lower: THREE.Object3D | null;
  hand: THREE.Object3D | null;
  fingers: { node: THREE.Object3D; bone: string; now: THREE.Quaternion }[];
}
export interface SayBones {
  /** Los huesos del tronco (para sacar de él los brazos). */
  trunk: Record<"hips" | "spine" | "chest" | "upperChest", THREE.Object3D | null>;
  chest: THREE.Object3D | null;
  neck: THREE.Object3D | null;
  head: THREE.Object3D | null;
  lShoulder: THREE.Object3D | null;
  rShoulder: THREE.Object3D | null;
  left: SayLimb;
  right: SayLimb;
}

/** Los huesos normalizados que mueve hablar (una vez por avatar). */
export function sayBones(vrm: VRM): SayBones {
  const h = vrm.humanoid;
  const node = (n: string) => h.getNormalizedBoneNode(n as never) ?? null;
  const limb = (side: "left" | "right"): SayLimb => ({
    shoulder: node(`${side}Shoulder`),
    upper: node(`${side}UpperArm`),
    lower: node(`${side}LowerArm`),
    hand: node(`${side}Hand`),
    fingers: FINGER_BONES[side].flatMap((bone) => {
      const n = node(bone);
      return n ? [{ node: n, bone, now: n.quaternion.clone() }] : [];
    }),
  });
  return {
    trunk: { hips: node("hips"), spine: node("spine"), chest: node("chest"), upperChest: node("upperChest") },
    chest: node("upperChest") ?? node("chest"),
    neck: node("neck"),
    head: node("head"),
    lShoulder: node("leftShoulder"),
    rShoulder: node("rightShoulder"),
    left: limb("left"),
    right: limb("right"),
  };
}

const _eS = new THREE.Euler();
const _qS = new THREE.Quaternion();
/** Suma a un hueso un giro en grados (como los de people/gestures.ts), con peso `w`. */
function addDeg(node: THREE.Object3D | null, x: number, y: number, z: number, w: number, v0: boolean) {
  if (!node || (!x && !y && !z)) return;
  const D = (Math.PI / 180) * w;
  _qS.setFromEuler(_eS.set(x * D, y * D, z * D, "XYZ"));
  if (v0) forVrm0(_qS, _qS);
  node.quaternion.multiply(_qS);
}

const _tw = new THREE.Quaternion();
const _sw = new THREE.Quaternion();
const _ti = new THREE.Quaternion();
const _ID = new THREE.Quaternion();
/**
 * Lo que se dobla la mano respecto al antebrazo (sin contar lo que gira sobre él, su eje X), como
 * mucho `max`: el giro se parte en el de alrededor del eje y el resto, y el resto se acorta.
 */
export function limitSwing(q: THREE.Quaternion, max: number): THREE.Quaternion {
  const len = Math.hypot(q.x, q.w);
  if (len < 1e-6) _tw.identity();
  else _tw.set(q.x / len, 0, 0, q.w / len);
  _sw.copy(q).multiply(_ti.copy(_tw).invert());
  const ang = 2 * Math.acos(Math.min(1, Math.abs(_sw.w)));
  if (ang <= max) return q;
  _sw.copy(_ID.identity().slerp(_sw, max / ang));
  return q.copy(_sw).multiply(_tw);
}

const _sq = new THREE.Quaternion();
const _sv = new THREE.Vector3();
const _qu = new THREE.Quaternion();
const _ql = new THREE.Quaternion();
const _qh = new THREE.Quaternion();
const _at: V3 = [0, 0, 0];
const _pole: V3 = [0, 0, 0];
const _palm: V3 = [0, 0, 0];
const _fing: V3 = [0, 0, 0];
const _ZERO: V3 = [0, 0, 0];
const toArr = (v: THREE.Vector3, out: V3) => {
  out[0] = v.x;
  out[1] = v.y;
  out[2] = v.z;
};

/** Lo que tiene que quedar fuera del tronco cada punto de la mano (m): la muñeca (con la manga), el centro de la palma y los dedos. */
const CLEAR = [0.035, 0.022, 0.016];
/** Dónde va cada uno, a lo largo de la mano (veces lo que mide de la muñeca a los nudillos) y hacia donde mira la palma (m: los dedos se doblan hacia ella). */
const ALONG = [0, 0.55, 1.55];
const PALMWARD = [0, 0.01, 0.03];
/** Lo que abulta el antebrazo con la manga, más un poco (m). */
const FOREARM = 0.06;
/** Lo más que gira el codo alrededor de la línea del hombro a la muñeca para que el antebrazo no se meta (rad). */
const SWIVEL_MAX = 70 * (Math.PI / 180);
/** Media vuelta en Y: de los ejes de VRM 1.0 a los de los huesos normalizados de un VRM 0.x. */
const Y180 = new THREE.Quaternion(0, 1, 0, 0);

/** El tronco alrededor de un hueso, tal como está ahora (mundo): su centro, su izquierda y su delante. */
interface BandNow {
  c: THREE.Vector3;
  x: THREE.Vector3;
  z: THREE.Vector3;
  side: number;
  front: number;
  back: number;
}
/** El tronco de este frame (mundo): los hombros, el marco en que se piden los brazos y el tronco por fuera, de abajo arriba. */
interface TrunkNow {
  s: [THREE.Vector3, THREE.Vector3];
  q: THREE.Quaternion;
  qi: THREE.Quaternion;
  t: Trunk;
  bands: BandNow[];
  n: number;
  top: number;
}
const band = (): BandNow => ({ c: new THREE.Vector3(), x: new THREE.Vector3(), z: new THREE.Vector3(), side: 0, front: 0, back: 0 });
const TN: TrunkNow = { s: [new THREE.Vector3(), new THREE.Vector3()], q: new THREE.Quaternion(), qi: new THREE.Quaternion(), t: null as unknown as Trunk, bands: [band(), band(), band(), band()], n: 0, top: 0 };
const _bq = new THREE.Quaternion();
const _ax = new THREE.Vector3();
function placeBand(node: THREE.Object3D, t: Trunk, from: TrunkBand, out: BandNow) {
  node.getWorldPosition(out.c);
  node.getWorldQuaternion(_bq);
  out.x.fromArray(t.left).applyQuaternion(_bq);
  out.z.fromArray(t.fwd).applyQuaternion(_bq);
  out.side = from.side;
  out.front = from.front;
  out.back = from.back;
}
/** Dónde está el tronco ahora (con lo que haya hecho este frame todo lo de antes: se rehacen sus matrices). */
function trunkNow(b: SayBones, t: Trunk, v0: boolean): TrunkNow | null {
  const ul = b.left.upper, ur = b.right.upper, ch = b.chest;
  if (!ul || !ur || !ch || t.bands.length < 2) return null;
  ul.updateWorldMatrix(true, false);
  ur.updateWorldMatrix(true, false);
  ul.getWorldPosition(TN.s[0]);
  ur.getWorldPosition(TN.s[1]);
  // Los brazos se piden en el marco del padre de la clavícula (el pecho), en los ejes de VRM 1.0.
  (b.left.shoulder?.parent ?? ch).getWorldQuaternion(TN.q);
  if (v0) TN.q.multiply(Y180);
  TN.qi.copy(TN.q).invert();
  TN.t = t;
  TN.n = 0;
  for (const tb of t.bands) {
    const node = b.trunk[tb.bone];
    if (!node || TN.n >= TN.bands.length) continue;
    placeBand(node, t, tb, TN.bands[TN.n++]!);
  }
  if (TN.n < 2) return null;
  TN.top = Math.min(TN.s[0].y, TN.s[1].y) + 0.02;
  return TN;
}

const _rel = new THREE.Vector3(), _bc = new THREE.Vector3(), _bx = new THREE.Vector3(), _bz = new THREE.Vector3();
/** El punto `p` dentro del tronco, con `c` de margen: lo que habría que sacarlo (`push`) y cuánto (m); 0 si está fuera. */
function inTrunk(n: TrunkNow, p: THREE.Vector3, c: number, push: THREE.Vector3): number {
  const B = n.bands;
  if (p.y > n.top || p.y < B[0]!.c.y - 0.12) return 0;
  // Entre qué dos alturas (por encima de la última, la última; por debajo de la primera, la primera).
  let i = 0;
  while (i < n.n - 2 && p.y > B[i + 1]!.c.y) i++;
  const lo = B[i]!, hi = B[i + 1]!;
  _ax.subVectors(hi.c, lo.c);
  const l2 = _ax.lengthSq() || 1;
  const k = Math.min(1, Math.max(0, _rel.subVectors(p, lo.c).dot(_ax) / l2));
  _bc.lerpVectors(lo.c, hi.c, k);
  _bx.lerpVectors(lo.x, hi.x, k).normalize();
  _bz.lerpVectors(lo.z, hi.z, k).normalize();
  _rel.subVectors(p, _bc);
  const dx = _rel.dot(_bx), dz = _rel.dot(_bz);
  const ax = lo.side + (hi.side - lo.side) * k + c;
  const az = (dz >= 0 ? lo.front + (hi.front - lo.front) * k : lo.back + (hi.back - lo.back) * k) + c;
  // Una superelipse (exponente 3, como en el pipeline): el pecho y la tripa son anchos y planos por
  // delante, y con una elipse lo que pasaba junto a sus esquinas se metía.
  const q = Math.abs(dx / ax) ** 3 + Math.abs(dz / az) ** 3;
  if (q >= 1 || q < 1e-9) return 0;
  const grow = 1 / Math.cbrt(q) - 1;
  push.copy(_bx).multiplyScalar(dx * grow).addScaledVector(_bz, dz * grow);
  return Math.hypot(dx, dz) * grow;
}

const _S = new THREE.Vector3(), _W = new THREE.Vector3(), _E = new THREE.Vector3(), _P = new THREE.Vector3(), _P0 = new THREE.Vector3();
const _U = new THREE.Vector3(), _N = new THREE.Vector3(), _R = new THREE.Vector3(), _F = new THREE.Vector3(), _pt = new THREE.Vector3();
const _Fp = new THREE.Vector3(), _Pn = new THREE.Vector3(), _fa = new THREE.Vector3(), _qf = new THREE.Quaternion();
const _push = new THREE.Vector3(), _best = new THREE.Vector3();
const _qr = new THREE.Quaternion();
/** El codo (en `_E`) con el hombro en `_S`, la muñeca en `_W` y hacia `pole` (la IK de people/gestures.ts); devuelve dónde llega la muñeca. */
function elbow(la: number, lb: number, pole: THREE.Vector3) {
  _U.subVectors(_W, _S);
  let d = _U.length();
  _U.divideScalar(d || 1);
  d = Math.min((la + lb) * 0.999, Math.max(Math.abs(la - lb) + 0.01, d));
  _N.copy(pole).addScaledVector(_U, -pole.dot(_U));
  if (_N.lengthSq() < 1e-8) _N.set(0, -1, 0).addScaledVector(_U, _U.y);
  _N.normalize();
  const x = (la * la + d * d - lb * lb) / (2 * d);
  _E.copy(_S).addScaledVector(_U, x).addScaledVector(_N, Math.sqrt(Math.max(0, la * la - x * x)));
  return _R.copy(_S).addScaledVector(_U, d);
}
/** Lo más que se mete el antebrazo en el tronco (con lo que abulta), y hacia dónde sacarlo (en `_best`). */
function forearmIn(n: TrunkNow, pole: THREE.Vector3): number {
  const W = elbow(n.t.arm[0], n.t.arm[1], pole);
  let worst = 0;
  for (const k of [0.3, 0.55, 0.8]) {
    _pt.lerpVectors(_E, W, k);
    const d = inTrunk(n, _pt, FOREARM, _push);
    if (d > worst) {
      worst = d;
      _best.copy(_push);
    }
  }
  return worst;
}
const _turned = new THREE.Vector3();
function turned(a: number, sign: number) {
  _U.subVectors(_W, _S).normalize();
  return _turned.copy(_P0).applyQuaternion(_qr.setFromAxisAngle(_U, a * sign));
}

/**
 * El brazo fuera del propio tronco (como en el pipeline de vídeo: la persona del vídeo era delgada y el
 * cuñado tenía barriga; sin esto, la mano de «gracias» se metía hasta diez centímetros en el pecho de
 * algunos personajes de serie y el antebrazo de reírse, en la tripa). Con el tronco tal como está ahora
 * (`n`): si la muñeca, la palma o la punta de los dedos quedan dentro (el óvalo de su tronco a esa altura,
 * entre los de su cadera, su cintura y su pecho, más lo que abulta cada uno), la muñeca sale hasta la superficie por el camino más
 * corto (hacia fuera de su centro) y queda apoyada; y si el antebrazo atraviesa el tronco, el codo gira
 * hacia fuera alrededor de la línea del hombro a la muñeca, lo justo (el giro más pequeño: sigue a la
 * postura sin saltos), y si ni así, la muñeca se aparta. `at`, `pole` y `fingers`, como los da
 * people/talk.ts (brazo de referencia, ejes de VRM 1.0 del pecho); lo que sale, igual, en `outAt` y `outPole`.
 */
function fitArm(n: TrunkNow, side: 0 | 1, at: V3, pole: V3, fingers: V3, palm: V3, outAt: V3, outPole: V3) {
  const t = n.t;
  _S.copy(n.s[side]);
  _W.fromArray(at).applyQuaternion(n.q).multiplyScalar(t.k).add(_S);
  _P.fromArray(pole).applyQuaternion(n.q);
  _F.fromArray(fingers).applyQuaternion(n.q).normalize();
  _Pn.fromArray(palm).applyQuaternion(n.q);
  _Pn.addScaledVector(_F, -_Pn.dot(_F)).normalize();
  const out = side === 0 ? 1 : -1;
  for (let pass = 0; pass < 3; pass++) {
    // La mano, con los dedos hacia donde van de verdad: la muñeca no se dobla más de `SAY_WRIST` sobre el antebrazo.
    const W = elbow(t.arm[0], t.arm[1], _P);
    _fa.subVectors(W, _E).normalize();
    const bend = _fa.angleTo(_F);
    _Fp.copy(_F);
    if (bend > SAY_WRIST) _Fp.copy(_fa).applyQuaternion(_qf.setFromUnitVectors(_fa, _F).slerp(_ID.identity(), 1 - SAY_WRIST / bend));
    let best = 0;
    for (let i = 0; i < 3; i++) {
      _pt.copy(_W).addScaledVector(_Fp, ALONG[i]! * t.hand).addScaledVector(_Pn, PALMWARD[i]!);
      const d = inTrunk(n, _pt, CLEAR[i]!, _push);
      if (d > best) {
        best = d;
        _best.copy(_push);
      }
    }
    if (best > 1e-4) {
      _W.add(_best);
      continue;
    }
    // El antebrazo: el codo gira hacia fuera (hacia su lado) lo justo; si ni así, la muñeca se aparta.
    if (forearmIn(n, _P) < 1e-4) break;
    _P0.copy(_P);
    elbow(t.arm[0], t.arm[1], turned(0.1, 1));
    const side0 = n.bands[n.n - 1]!.x;
    const e1 = _E.dot(side0);
    elbow(t.arm[0], t.arm[1], _P0);
    const sign = (e1 - _E.dot(side0)) * out >= 0 ? 1 : -1;
    if (forearmIn(n, turned(SWIVEL_MAX, sign)) < 1e-4) {
      let lo = 0, hi = SWIVEL_MAX;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        if (forearmIn(n, turned(mid, sign)) < 1e-4) hi = mid;
        else lo = mid;
      }
      _P.copy(turned(hi, sign));
      break;
    }
    forearmIn(n, turned(SWIVEL_MAX, sign));
    _P.copy(_turned);
    _W.add(_best);
  }
  _W.sub(_S).divideScalar(t.k).applyQuaternion(n.qi);
  outAt[0] = _W.x;
  outAt[1] = _W.y;
  outAt[2] = _W.z;
  _P.applyQuaternion(n.qi);
  outPole[0] = _P.x;
  outPole[1] = _P.y;
  outPole[2] = _P.z;
}
const _fit: V3 = [0, 0, 0];
const _fitPole: V3 = [0, 0, 0];

/**
 * La actuación de este momento (`f`, de people/talk.ts → sampleSay) sobre los huesos: con peso `W`
 * (lo que se enciende y se apaga), los brazos además con `arms` (corriendo, menos). `v0`: un VRM 0.x
 * (sus ejes normalizados van girados media vuelta). Los dedos van hacia la forma de la postura en una
 * décima (`dt`). Con `trunk` (people/rig.ts → trunk), los brazos quedan fuera de su tronco (`fitArm`).
 */
export function poseSay(b: SayBones, f: SayFrame, W: number, arms: number, v0: boolean, dt: number, trunk: Trunk | null = null) {
  // El tronco y la cabeza primero (los brazos cuelgan de ahí).
  addDeg(b.chest, f.chest[0], f.chest[1], f.chest[2], W, v0);
  addDeg(b.neck, f.head[0] * 0.35, f.head[1] * 0.35, f.head[2] * 0.3, W, v0);
  addDeg(b.head, f.head[0] * 0.65, f.head[1] * 0.65, f.head[2] * 0.7, W, v0);
  addDeg(b.lShoulder, 0, 0, f.shoulders[0], W, v0);
  addDeg(b.rShoulder, 0, 0, -f.shoulders[1], W, v0);
  const k = Math.min(1, dt / 0.1);
  const shapes = gestureHands();
  // El tronco tal como ha quedado (para sacar de él los brazos), si hay brazos que poner.
  const now = trunk && W * arms > 0.002 && (f.L.w > 0.002 || f.R.w > 0.002) ? trunkNow(b, trunk, v0) : null;
  for (const side of [1, -1] as const) {
    const a = side > 0 ? f.L : f.R;
    const w = a.w * W * arms;
    const lim = side > 0 ? b.left : b.right;
    if (w < 0.002 || !lim.upper || !lim.lower || !lim.hand) continue;
    // La muñeca, el codo, la palma y los dedos se piden en el marco del tronco; se pasan al de la clavícula.
    if (lim.shoulder) {
      _sq.copy(lim.shoulder.quaternion);
      if (v0) forVrm0(_sq, _sq);
      _sq.invert();
    } else _sq.identity();
    // Fuera de su tronco (si se sabe cómo es), y del marco del tronco al de la clavícula.
    if (now) fitArm(now, side > 0 ? 0 : 1, a.at, a.pole, a.fingers, a.palm, _fit, _fitPole);
    toArr(_sv.fromArray(now ? _fit : a.at).applyQuaternion(_sq), _at);
    toArr(_sv.fromArray(now ? _fitPole : a.pole).applyQuaternion(_sq), _pole);
    toArr(_sv.fromArray(a.palm).applyQuaternion(_sq), _palm);
    toArr(_sv.fromArray(a.fingers).applyQuaternion(_sq), _fing);
    solveArm(side, { at: _at, pole: _pole, twist: 0, wrist: _ZERO, palm: _palm, fingers: _fing }, _qu, _ql, _qh);
    limitSwing(_qh, SAY_WRIST);
    if (v0) {
      forVrm0(_qu, _qu);
      forVrm0(_ql, _ql);
      forVrm0(_qh, _qh);
    }
    lim.upper.quaternion.slerp(_qu, w);
    lim.lower.quaternion.slerp(_ql, w);
    lim.hand.quaternion.slerp(_qh, w);
    // La forma de la mano, con el peso del brazo.
    const table = shapes[a.hand];
    for (const fg of lim.fingers) {
      const q = table.get(fg.bone);
      if (!q) continue;
      if (v0) forVrm0(q, _sq);
      else _sq.copy(q);
      fg.now.slerp(_sq, k);
      fg.node.quaternion.slerp(fg.now, w);
    }
  }
}
