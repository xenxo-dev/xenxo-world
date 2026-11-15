/**
 * Lo que ocupa un cuerpo, para que en pareja los brazos de una persona rodeen a la otra sin atravesarla
 * (around.ts, pair.ts): por cada hueso del tronco, del cuello y la cabeza, de los hombros, de los brazos
 * y de los muslos, su contorno alrededor del hueso, de la malla en reposo con la ropa (los vértices que
 * mueve ese hueso: los de dos huesos, en los dos), y que va con el hueso. Con óvalos (lo de antes) los
 * brazos se metían hasta diez centímetros en los hombros y el pecho de la otra persona: un hombro no es
 * un óvalo, y una chaqueta con hombreras tampoco.
 *
 * Cada parte es un tubo alrededor de su hueso: a lo largo de él, en franjas, y alrededor, en sectores,
 * lo más lejos del hueso que llega la malla. Se mide una vez por avatar (al primer abrazo: recorre sus
 * vértices) y en cada consulta solo se pasa el punto al marco del hueso y se mira su franja y su sector.
 */
import * as THREE from "three";
import { VRMHumanBoneParentMap, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";

type Bone = VRMHumanBoneName;

/** Grupos de partes (para preguntar solo por unas: los brazos de la otra persona, o no). */
export const SHAPE = { torso: 1, head: 2, shoulders: 4, leftArm: 8, rightArm: 16, legs: 32, all: 63 } as const;

/** Cada parte: su hueso, hacia dónde va su eje (el primero que tenga; sin ninguno, hacia arriba), en cuántas franjas y sectores, y su grupo. */
const SPEC: { bone: Bone; to: Bone[]; nt: number; na: number; group: number }[] = [
  { bone: "hips", to: ["spine"], nt: 12, na: 40, group: SHAPE.torso },
  { bone: "spine", to: ["chest"], nt: 8, na: 40, group: SHAPE.torso },
  { bone: "chest", to: ["upperChest", "neck"], nt: 8, na: 40, group: SHAPE.torso },
  { bone: "upperChest", to: ["neck"], nt: 18, na: 40, group: SHAPE.torso },
  { bone: "neck", to: ["head"], nt: 5, na: 20, group: SHAPE.head },
  { bone: "head", to: [], nt: 10, na: 24, group: SHAPE.head },
  { bone: "leftShoulder", to: ["leftUpperArm"], nt: 6, na: 24, group: SHAPE.shoulders },
  { bone: "rightShoulder", to: ["rightUpperArm"], nt: 6, na: 24, group: SHAPE.shoulders },
  { bone: "leftUpperArm", to: ["leftLowerArm"], nt: 8, na: 16, group: SHAPE.leftArm },
  { bone: "leftLowerArm", to: ["leftHand"], nt: 8, na: 16, group: SHAPE.leftArm },
  { bone: "leftHand", to: ["leftMiddleProximal"], nt: 6, na: 16, group: SHAPE.leftArm },
  { bone: "rightUpperArm", to: ["rightLowerArm"], nt: 8, na: 16, group: SHAPE.rightArm },
  { bone: "rightLowerArm", to: ["rightHand"], nt: 8, na: 16, group: SHAPE.rightArm },
  { bone: "rightHand", to: ["rightMiddleProximal"], nt: 6, na: 16, group: SHAPE.rightArm },
  { bone: "leftUpperLeg", to: ["leftLowerLeg"], nt: 10, na: 16, group: SHAPE.legs },
  { bone: "rightUpperLeg", to: ["rightLowerLeg"], nt: 10, na: 16, group: SHAPE.legs },
];
/** Cada cuánto se toma un punto de la superficie de cada triángulo (m, en un cuerpo de 1,62 m hasta la cabeza). */
const SAMPLE = 0.012;
/** Un vértice cuenta en cada hueso que lo mueva al menos esto (y siempre en el que más). */
const W_MIN = 0.45;
/**
 * El pelo, las cejas, las pestañas y la barba no cuentan (por el nombre de su malla: los de serie, los de
 * las fundas y los de casi cualquier VRM): un brazo que pasa por el pelo de alguien no le atraviesa la
 * cabeza, y con el pelo, la cabeza era el doble de grande.
 */
const HAIR = /hair|eyebrow|eyelash|brows|beard|ponytail|braid|afro|bob\d|short0\d|long0\d|bun\d/i;
/** La cabeza: sin lo que cuelga por debajo de la mandíbula ni lo que abulta más que esto (m, en una cabeza a 1,62 m del suelo). */
const HEAD_DOWN = 0.07;
const HEAD_MAX = 0.17;
/**
 * Donde se juntan dos partes (el tronco y un brazo, un hombro y el cuello), lo que se redondea la unión
 * (m): con la unión a secas, «hacia fuera» cambiaba de golpe de una parte a otra y lo que se apartaba
 * de ella (una mano al resbalar por su hombro) saltaba de un sitio a otro.
 */
const SMOOTH = 0.02;

interface Part {
  node: THREE.Object3D;
  group: number;
  /** El eje (unitario) y dos direcciones perpendiculares (en el marco del hueso, que en reposo es el del modelo). */
  ax: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  /** De dónde a dónde a lo largo del eje y hasta el hueso siguiente (en unidades del modelo). */
  t0: number;
  t1: number;
  len: number;
  nt: number;
  na: number;
  /** Lo más lejos del eje en cada franja y sector (unidades del modelo); y en cada franja, lo de media. */
  r: Float32Array;
  ring: Float32Array;
  /** Una esfera que la contiene (centro en el marco del hueso y radio, unidades del modelo). */
  mid: THREE.Vector3;
  bound: number;
  /** Este frame: del mundo al hueso (afín) y la esfera en el mundo. */
  inv: THREE.Matrix4;
  wc: THREE.Vector3;
  wr: number;
}

const _v = new THREE.Vector3();
const _l = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();
const _ws = new THREE.Vector3();
const TAU = Math.PI * 2;

export class BodyShape {
  private scale = 1;
  private constructor(
    private parts: Part[],
    private root: THREE.Object3D,
  ) {}

  /**
   * Lo mide de su malla en reposo (con la ropa). `fwd`: hacia dónde mira el modelo en reposo (para el
   * origen de los sectores; da igual cuál, mientras sea perpendicular a casi todos los ejes). Sin malla
   * o sin los huesos del tronco, null.
   */
  static measure(vrm: VRM, fwd: THREE.Vector3): BodyShape | null {
    const h = vrm.humanoid;
    const rest = h.normalizedRestPose;
    // Dónde está cada hueso en reposo (en el marco del modelo): lo suyo más lo de los que tiene encima.
    const at = (b: Bone) => {
      if (!rest[b]) return null;
      const out = new THREE.Vector3();
      for (let n: Bone | null = b; n; n = VRMHumanBoneParentMap[n] as Bone | null) {
        const p = rest[n]?.position;
        if (p) (out.x += p[0]!), (out.y += p[1]!), (out.z += p[2]!);
      }
      return out;
    };
    // De cada hueso de verdad (el del esqueleto de la malla), su hueso humano (el suyo o el de más arriba).
    const human = new Map<THREE.Object3D, Bone>();
    for (const [name, b] of Object.entries(h.humanBones)) if (b?.node) human.set(b.node, name as Bone);
    // De cada hueso humano, su parte (los dedos, de la mano; los ojos y la mandíbula, de la cabeza).
    const partOf = new Map<Bone, number>();
    const parts: Part[] = [];
    const origins: THREE.Vector3[] = [];
    const head = at("head");
    const k = head && head.y > 0.8 ? head.y / 1.62 : 1;
    for (const s of SPEC) {
      const node = h.getNormalizedBoneNode(s.bone), o = at(s.bone);
      if (!node || !o) continue;
      let to: THREE.Vector3 | null = null;
      for (const b of s.to) if ((to = at(b))) break;
      const ax = to ? to.sub(o) : new THREE.Vector3(0, 1, 0);
      if (ax.lengthSq() < 1e-8) ax.set(0, 1, 0);
      const len = to ? ax.length() : 0;
      ax.normalize();
      const u = fwd.clone().addScaledVector(ax, -fwd.dot(ax));
      if (u.lengthSq() < 0.05) u.set(0, 1, 0).addScaledVector(ax, -ax.y);
      u.normalize();
      const v = new THREE.Vector3().crossVectors(ax, u);
      partOf.set(s.bone, parts.length);
      origins.push(o);
      parts.push({ node, group: s.group, ax, u, v, t0: Infinity, t1: -Infinity, len, nt: s.nt, na: s.na, r: new Float32Array(s.nt * s.na), ring: new Float32Array(s.nt), mid: new THREE.Vector3(), bound: 0, inv: new THREE.Matrix4(), wc: new THREE.Vector3(), wr: 0 });
    }
    const torso = partOf.get("chest") ?? partOf.get("spine");
    if (torso === undefined) return null;
    const toPart = (b: Bone): number => {
      const p = partOf.get(b);
      if (p !== undefined) return p;
      if (/^(left|right)(Thumb|Index|Middle|Ring|Little)/.test(b)) return partOf.get(b.startsWith("left") ? "leftHand" : "rightHand") ?? -1;
      if (b === "leftEye" || b === "rightEye" || b === "jaw") return partOf.get("head") ?? -1;
      // Un hueso del tronco que no tenga su parte (sin pecho alto u hombros): el del que cuelga.
      if (b === "upperChest") return partOf.get("chest") ?? -1;
      if (b === "leftShoulder" || b === "rightShoulder") return partOf.get("upperChest") ?? partOf.get("chest") ?? -1;
      return -1;
    };
    const boneOf = (o: THREE.Object3D | null): Bone | null => {
      for (let n = o; n; n = n.parent) {
        const b = human.get(n);
        if (b) return b;
      }
      return null;
    };
    // La malla en reposo (en T, como sus huesos en reposo: puede estar atada a sus huesos en otra pose,
    // con los brazos abajo), así que se mide como queda de verdad con el esqueleto en reposo y después se
    // deja todo como estaba. De cada vértice, dónde queda y en qué partes cuenta (las de los huesos que lo
    // mueven); y de cada triángulo, puntos por toda su superficie (cada SAMPLE m), en las partes de sus
    // vértices: con solo los vértices, en una franja con pocos un sector con algo llenaba la vuelta entera.
    const scene = vrm.scene;
    const saved: [THREE.Object3D, THREE.Vector3, THREE.Quaternion][] = [];
    for (const name of Object.keys(h.humanBones)) {
      const n = h.getNormalizedBoneNode(name as Bone);
      if (n) saved.push([n, n.position.clone(), n.quaternion.clone()]);
    }
    h.resetNormalizedPose();
    h.update();
    scene.updateMatrixWorld(true);
    _m0.copy(scene.matrixWorld).invert();
    const headPart = partOf.get("head");
    const meshes: { pos: Float32Array; mask: Uint32Array; index: ArrayLike<number> | null }[] = [];
    scene.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.skeleton || HAIR.test(mesh.name)) return;
      const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      if (!pos || !si || !sw) return;
      mesh.skeleton.update();
      const map = mesh.skeleton.bones.map((b) => {
        const name = boneOf(b);
        return name ? toPart(name) : -1;
      });
      _m1.multiplyMatrices(_m0, mesh.matrixWorld);
      const at = new Float32Array(pos.count * 3), mask = new Uint32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        mesh.getVertexPosition(i, _v).applyMatrix4(_m1);
        at[i * 3] = _v.x;
        at[i * 3 + 1] = _v.y;
        at[i * 3 + 2] = _v.z;
        let top = 0, topW = -1;
        for (let j = 0; j < 4; j++) {
          const w = sw.getComponent(i, j);
          if (w > topW) (topW = w), (top = j);
        }
        for (let j = 0; j < 4; j++) {
          if (j !== top && sw.getComponent(i, j) < W_MIN) continue;
          const p = map[si.getComponent(i, j)] ?? -1;
          if (p >= 0) mask[i]! |= 1 << p;
        }
      }
      meshes.push({ pos: at, mask, index: g.index ? g.index.array : null });
    });
    for (const [n, p, q] of saved) {
      n.position.copy(p);
      n.quaternion.copy(q);
    }
    h.update();
    scene.updateMatrixWorld(true);
    scene.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).skeleton?.update());
    // Un punto (en _v) en las partes de `mask`: a lo largo de su eje, lejos de él y en qué dirección; en
    // la primera pasada, solo dónde empieza y acaba cada parte; en la segunda, a su franja y su sector.
    const count = new Uint32Array(parts.length);
    const put = (mask: number, bin: boolean) => {
      for (let p = 0; p < parts.length; p++) {
        if (!(mask & (1 << p))) continue;
        const part = parts[p]!;
        _l.copy(_v).sub(origins[p]!);
        const t = _l.dot(part.ax);
        _l.addScaledVector(part.ax, -t);
        const rho = _l.length();
        if (p === headPart && (t < -HEAD_DOWN * k || rho > HEAD_MAX * k)) continue;
        if (!bin) {
          if (t < part.t0) part.t0 = t;
          if (t > part.t1) part.t1 = t;
          count[p]!++;
          continue;
        }
        let a = Math.atan2(_l.dot(part.v), _l.dot(part.u));
        if (a < 0) a += TAU;
        const ti = Math.min(part.nt - 1, Math.max(0, Math.floor(((t - part.t0) / (part.t1 - part.t0)) * part.nt)));
        const c = ti * part.na + Math.min(part.na - 1, Math.floor((a / TAU) * part.na));
        if (rho > part.r[c]!) part.r[c] = rho;
      }
    };
    for (const m of meshes)
      for (let i = 0; i < m.mask.length; i++) {
        _v.fromArray(m.pos, i * 3);
        put(m.mask[i]!, false);
      }
    for (const part of parts) part.r.fill(-1);
    for (const m of meshes) {
      const idx = m.index, n = idx ? idx.length : m.mask.length;
      for (let f = 0; f + 2 < n; f += 3) {
        const a = idx ? idx[f]! : f, b = idx ? idx[f + 1]! : f + 1, c = idx ? idx[f + 2]! : f + 2;
        const mask = m.mask[a]! | m.mask[b]! | m.mask[c]!;
        if (!mask) continue;
        _a.fromArray(m.pos, a * 3);
        _b.fromArray(m.pos, b * 3);
        _c.fromArray(m.pos, c * 3);
        const steps = Math.max(1, Math.ceil(Math.max(_a.distanceTo(_b), _b.distanceTo(_c), _c.distanceTo(_a)) / (SAMPLE * k)));
        for (let i = 0; i <= steps; i++)
          for (let j = 0; j <= steps - i; j++) {
            _v.copy(_a).multiplyScalar(1 - (i + j) / steps).addScaledVector(_b, i / steps).addScaledVector(_c, j / steps);
            put(mask, true);
          }
      }
    }
    // Los sectores vacíos no llegan a nada (esa parte no tiene nada hacia ahí; lo tendrá otra), salvo un
    // hueco suelto entre dos con algo (los puntos no caen en todos); y lo más lejos de todos (para la
    // esfera) y, en cada franja, lo de media de los que tienen algo (lo que abulta un brazo hacia donde
    // sea: lo más, con el hombro y la axila, lo hacía el doble de gordo).
    const keep: Part[] = [];
    parts.forEach((part, p) => {
      if (count[p]! < 30 || part.t1 - part.t0 < 1e-4) return;
      const { nt, na, r } = part;
      for (let ti = 0; ti < nt; ti++) {
        const row = ti * na;
        for (let ai = 0; ai < na; ai++) {
          if (r[row + ai]! >= 0) continue;
          const before = r[row + ((ai + na - 1) % na)]!, after = r[row + ((ai + 1) % na)]!;
          if (before >= 0 && after >= 0) r[row + ai] = (before + after) / 2;
        }
      }
      let most = 0;
      for (let ti = 0; ti < nt; ti++) {
        let sum = 0, filled = 0;
        for (let ai = 0; ai < na; ai++) {
          const x = r[ti * na + ai]!;
          if (x < 0) {
            r[ti * na + ai] = 0;
            continue;
          }
          sum += x;
          filled++;
          if (x > most) most = x;
        }
        part.ring[ti] = filled ? sum / filled : 0;
      }
      part.mid.copy(part.ax).multiplyScalar((part.t0 + part.t1) / 2);
      part.bound = Math.hypot((part.t1 - part.t0) / 2, most);
      keep.push(part);
    });
    return keep.some((p) => p.group === SHAPE.torso) ? new BodyShape(keep, scene) : null;
  }

  /** Antes de preguntar en un frame: dónde está ahora cada parte (con los huesos como estén). */
  begin() {
    this.scale = this.root.getWorldScale(_ws).x || 1;
    for (const p of this.parts) {
      p.node.updateWorldMatrix(true, false);
      p.inv.copy(p.node.matrixWorld).invert();
      p.wc.copy(p.mid).applyMatrix4(p.node.matrixWorld);
      p.wr = p.bound * this.scale;
    }
  }

  /**
   * Lo que hay del punto (mundo) a la superficie de las partes de `mask` (m; negativo, dentro). No es la
   * distancia exacta (va por la dirección que sale del hueso, y donde se juntan dos partes se redondea:
   * `SMOOTH`), pero cerca de la superficie casi.
   */
  distance(x: number, y: number, z: number, mask: number = SHAPE.all): number {
    let best = Infinity;
    const sc = this.scale;
    for (const p of this.parts) {
      if (!(p.group & mask)) continue;
      const dx = x - p.wc.x, dy = y - p.wc.y, dz = z - p.wc.z;
      const far = Math.sqrt(dx * dx + dy * dy + dz * dz) - p.wr;
      if (far > best + SMOOTH) continue;
      const e = p.inv.elements;
      const lx = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      const ly = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      const lz = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
      const t = lx * p.ax.x + ly * p.ax.y + lz * p.ax.z;
      const rx = lx - t * p.ax.x, ry = ly - t * p.ax.y, rz = lz - t * p.ax.z;
      const rho = Math.sqrt(rx * rx + ry * ry + rz * rz);
      // La franja (entre los centros de dos) y el sector (entre los de dos), en interpolación bilineal.
      const { nt, na, r } = p;
      let ft = ((t - p.t0) / (p.t1 - p.t0)) * nt - 0.5;
      ft = ft < 0 ? 0 : ft > nt - 1 ? nt - 1 : ft;
      const t0 = Math.floor(ft), t1 = Math.min(nt - 1, t0 + 1), wt = ft - t0;
      let a = Math.atan2(rx * p.v.x + ry * p.v.y + rz * p.v.z, rx * p.u.x + ry * p.u.y + rz * p.u.z);
      if (a < 0) a += TAU;
      const fa = (a / TAU) * na - 0.5;
      const a0 = (Math.floor(fa) + na) % na, a1 = (a0 + 1) % na, wa = fa - Math.floor(fa);
      const R =
        (r[t0 * na + a0]! * (1 - wa) + r[t0 * na + a1]! * wa) * (1 - wt) + (r[t1 * na + a0]! * (1 - wa) + r[t1 * na + a1]! * wa) * wt;
      let d = rho - R;
      // Más allá de sus puntas, como una caja (por lo bajo: no se pasa).
      if (t < p.t0) d = Math.max(d, p.t0 - t);
      else if (t > p.t1) d = Math.max(d, t - p.t1);
      d *= sc;
      // La unión, redondeada (`SMOOTH`).
      const h = SMOOTH - Math.abs(d - best);
      best = (d < best ? d : best) - (h > 0 ? (h * h) / (4 * SMOOTH) : 0);
    }
    return best;
  }

  /** Hacia fuera de las partes de `mask` en un punto (mundo, unitario, en `out`): por diferencias. */
  outward(x: number, y: number, z: number, mask: number, out: THREE.Vector3): THREE.Vector3 {
    const h = 0.008;
    out.set(
      this.distance(x + h, y, z, mask) - this.distance(x - h, y, z, mask),
      this.distance(x, y + h, z, mask) - this.distance(x, y - h, z, mask),
      this.distance(x, y, z + h, mask) - this.distance(x, y, z - h, mask),
    );
    const n = out.length();
    return n > 1e-6 ? out.divideScalar(n) : out.set(0, 1, 0);
  }

  /**
   * Lo que abulta (m, de media alrededor) el brazo (0) o el antebrazo (1) del lado `side` (0 izquierdo,
   * 1 derecho) a `k` (0–1) de su hueso, del hombro al codo o del codo a la muñeca.
   */
  limb(side: 0 | 1, joint: 0 | 1, k: number): number {
    const g = side ? SHAPE.rightArm : SHAPE.leftArm;
    let n = 0;
    for (const p of this.parts) {
      if (p.group !== g || n++ !== joint) continue;
      const f = Math.min(p.nt - 1, Math.max(0, ((k * p.len - p.t0) / (p.t1 - p.t0)) * p.nt - 0.5));
      const i = Math.floor(f), j = Math.min(p.nt - 1, i + 1);
      return (p.ring[i]! * (1 - (f - i)) + p.ring[j]! * (f - i)) * this.scale;
    }
    return 0.05;
  }
}
