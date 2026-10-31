/**
 * Las cuentas de una funda, sin dibujar nada (lo mismo que hace MakeHuman, en el navegador):
 *
 * 1. la jaula: forma neutra de la base + ajustes del cuerpo y de la cara;
 * 2. el esqueleto: cada articulación es la media de unos vértices de la jaula;
 * 3. cada pieza: sus vértices atados a la jaula (tres vértices, pesos y un desplazamiento escalado);
 * 4. sus pesos de piel, mezclando los de esos tres vértices;
 * 5. la pose T que pide VRM: brazos en horizontal (MakeHuman los tiene caídos), aplicada a todo.
 *
 * Unidades: metros, Y arriba, mirando a +Z (como VRM), los pies en y = 0.
 */
import * as THREE from "three";
import { type Bin, type Kit, type KitPart } from "./kit";
import type { Recipe } from "./recipe";

export interface KitData {
  kit: Kit;
  base: Record<"f" | "m", Bin>;
  face: Bin;
  rig: Bin;
  parts: Map<string, Bin>;
}

/** Jaula (n × 3) y articulaciones (cabeza y cola de cada hueso), ya en el suelo. */
export interface Shape {
  cage: Float32Array;
  heads: Float32Array;
  tails: Float32Array;
}

export function computeShape(d: KitData, r: Recipe, out?: Shape): Shape {
  const { kit } = d;
  const n = kit.cage;
  const q = kit.q;
  const cage = out?.cage ?? new Float32Array(n * 3);
  const base = d.base[r.base];
  const neutral = base.get<Int32Array>("neutral");
  for (let i = 0; i < n * 3; i++) cage[i] = neutral[i]! * q;
  const add = (bin: Bin, name: string, k: number) => {
    if (!k) return;
    const idx = bin.get<Uint16Array>(`${name}.i`);
    const dd = bin.get<Int16Array>(`${name}.d`);
    const s = k * q;
    for (let j = 0; j < idx.length; j++) {
      const o = idx[j]! * 3;
      cage[o] = cage[o]! + dd[j * 3]! * s;
      cage[o + 1] = cage[o + 1]! + dd[j * 3 + 1]! * s;
      cage[o + 2] = cage[o + 2]! + dd[j * 3 + 2]! * s;
    }
  };
  for (const k of kit.body) {
    const v = r.body[k] ?? 0;
    if (v < 0) add(base, `${k}.lo`, -v);
    else if (v > 0) add(base, `${k}.hi`, v);
  }
  for (const k of kit.face) {
    const v = r.face[k] ?? 0;
    if (v < 0) add(d.face, `${k}.lo`, -v);
    else if (v > 0) add(d.face, `${k}.hi`, v);
  }
  // Articulaciones y suelo (la cabeza de Root es el suelo entre los pies).
  const bones = kit.rig.bones;
  const heads = out?.heads ?? new Float32Array(bones.length * 3);
  const tails = out?.tails ?? new Float32Array(bones.length * 3);
  const mean = (ids: Uint16Array, dst: Float32Array, o: number) => {
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < ids.length; j++) {
      const v = ids[j]! * 3;
      x += cage[v]!;
      y += cage[v + 1]!;
      z += cage[v + 2]!;
    }
    dst[o] = x / ids.length;
    dst[o + 1] = y / ids.length;
    dst[o + 2] = z / ids.length;
  };
  for (let b = 0; b < bones.length; b++) {
    mean(d.rig.get<Uint16Array>(`${bones[b]!.name}.head`), heads, b * 3);
    mean(d.rig.get<Uint16Array>(`${bones[b]!.name}.tail`), tails, b * 3);
  }
  const ground = heads[1]!;
  for (let i = 1; i < n * 3; i += 3) cage[i] = cage[i]! - ground;
  for (let i = 1; i < bones.length * 3; i += 3) {
    heads[i] = heads[i]! - ground;
    tails[i] = tails[i]! - ground;
  }
  return { cage, heads, tails };
}

/** Posiciones de una pieza atada a la jaula. */
export function fitPart(part: KitPart, bin: Bin, kit: Kit, cage: Float32Array, out?: Float32Array): Float32Array {
  const refs = bin.get<Uint16Array>("refs");
  const w = bin.get<Float32Array>("w");
  const off = bin.get<Int16Array>("off");
  const nv = refs.length / 3;
  const pos = out && out.length === nv * 3 ? out : new Float32Array(nv * 3);
  const sx = scaleOf(part, cage, kit, "x", 0);
  const sy = scaleOf(part, cage, kit, "y", 1);
  const sz = scaleOf(part, cage, kit, "z", 2);
  const q = kit.q;
  for (let i = 0; i < nv; i++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) {
      const r = refs[i * 3 + k]! * 3;
      const ww = w[i * 3 + k]!;
      x += cage[r]! * ww;
      y += cage[r + 1]! * ww;
      z += cage[r + 2]! * ww;
    }
    pos[i * 3] = x + off[i * 3]! * q * sx;
    pos[i * 3 + 1] = y + off[i * 3 + 1]! * q * sy;
    pos[i * 3 + 2] = z + off[i * 3 + 2]! * q * sz;
  }
  return pos;
}

function scaleOf(part: KitPart, cage: Float32Array, kit: Kit, axis: "x" | "y" | "z", c: number): number {
  const s = (part.scale as Record<string, [number, number, number]>)[axis];
  if (!s) return 1;
  return Math.abs(cage[s[0] * 3 + c]! - cage[s[1] * 3 + c]!) / (s[2] * kit.unit);
}

/** Pesos de piel de una pieza (hasta 4 huesos por vértice), mezclando los de su atadura. */
export function partSkin(bin: Bin, rig: Bin): { index: Uint16Array; weight: Float32Array } {
  const refs = bin.get<Uint16Array>("refs");
  const w = bin.get<Float32Array>("w");
  const si = rig.get<Uint8Array>("skin.i");
  const sw = rig.get<Uint8Array>("skin.w");
  const nv = refs.length / 3;
  const index = new Uint16Array(nv * 4);
  const weight = new Float32Array(nv * 4);
  const bones = new Int32Array(12);
  const ws = new Float32Array(12);
  for (let i = 0; i < nv; i++) {
    let m = 0;
    for (let k = 0; k < 3; k++) {
      const ww = w[i * 3 + k]!;
      if (ww <= 0) continue;
      const r = refs[i * 3 + k]!;
      for (let j = 0; j < 4; j++) {
        const bw = sw[r * 4 + j]! / 255;
        if (!bw) continue;
        const b = si[r * 4 + j]!;
        let f = -1;
        for (let t = 0; t < m; t++) if (bones[t] === b) f = t;
        if (f >= 0) ws[f] = ws[f]! + ww * bw;
        else {
          bones[m] = b;
          ws[m] = ww * bw;
          m++;
        }
      }
    }
    // Los 4 de más peso, normalizados.
    let total = 0;
    for (let s = 0; s < 4; s++) {
      let best = -1;
      for (let t = 0; t < m; t++) if (ws[t]! > 0 && (best < 0 || ws[t]! > ws[best]!)) best = t;
      if (best < 0) break;
      index[i * 4 + s] = bones[best]!;
      weight[i * 4 + s] = ws[best]!;
      total += ws[best]!;
      ws[best] = 0;
    }
    if (total > 0) for (let s = 0; s < 4; s++) weight[i * 4 + s] = weight[i * 4 + s]! / total;
    else weight[i * 4] = 1; // sin pesos: al hueso 0 (Root)
  }
  return { index, weight };
}

/**
 * Pose T: gira brazo y antebrazo de cada lado hasta la horizontal (±X) y devuelve, por hueso, su giro
 * en el mundo y dónde queda su cabeza. Con eso se recolocan vértices (`poseVertices`) y huesos.
 */
export function tPose(kit: Kit, s: Shape): { rot: THREE.Quaternion[]; heads: Float32Array } {
  const bones = kit.rig.bones;
  const local = bones.map(() => new THREE.Quaternion());
  const idx = (name: string) => bones.findIndex((b) => b.name === name);
  const v = (arr: Float32Array, i: number) => new THREE.Vector3(arr[i * 3]!, arr[i * 3 + 1]!, arr[i * 3 + 2]!);
  for (const [side, sign] of [["l", 1], ["r", -1]] as const) {
    const up = idx(`upperarm_${side}`), low = idx(`lowerarm_${side}`), hand = idx(`hand_${side}`);
    const target = new THREE.Vector3(sign, 0, 0);
    const d1 = v(s.heads, low).sub(v(s.heads, up)).normalize();
    const rUp = new THREE.Quaternion().setFromUnitVectors(d1, target);
    const d2 = v(s.heads, hand).sub(v(s.heads, low)).normalize().applyQuaternion(rUp);
    const fix = new THREE.Quaternion().setFromUnitVectors(d2, target);
    local[up]!.copy(rUp);
    // Giro local del antebrazo para que, compuesto con el del brazo, quede en horizontal.
    local[low]!.copy(rUp).invert().multiply(fix).multiply(rUp);
  }
  const rot = bones.map(() => new THREE.Quaternion());
  const heads = new Float32Array(s.heads.length);
  const tmp = new THREE.Vector3();
  for (let b = 0; b < bones.length; b++) {
    const p = bones[b]!.parent;
    if (p < 0) {
      rot[b]!.copy(local[b]!);
      heads.set(s.heads.subarray(b * 3, b * 3 + 3), b * 3);
      continue;
    }
    rot[b]!.copy(rot[p]!).multiply(local[b]!);
    tmp.set(s.heads[b * 3]! - s.heads[p * 3]!, s.heads[b * 3 + 1]! - s.heads[p * 3 + 1]!, s.heads[b * 3 + 2]! - s.heads[p * 3 + 2]!).applyQuaternion(rot[p]!);
    heads[b * 3] = heads[p * 3]! + tmp.x;
    heads[b * 3 + 1] = heads[p * 3 + 1]! + tmp.y;
    heads[b * 3 + 2] = heads[p * 3 + 2]! + tmp.z;
  }
  return { rot, heads };
}

/** Lleva los vértices de una pieza a la pose (piel lineal: suma de cada hueso por su peso). */
export function poseVertices(pos: Float32Array, skin: { index: Uint16Array; weight: Float32Array }, rest: Float32Array, pose: { rot: THREE.Quaternion[]; heads: Float32Array }): Float32Array {
  const out = new Float32Array(pos.length);
  const t = new THREE.Vector3();
  for (let i = 0; i < pos.length / 3; i++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = skin.weight[i * 4 + k]!;
      if (!w) continue;
      const b = skin.index[i * 4 + k]!;
      t.set(pos[i * 3]! - rest[b * 3]!, pos[i * 3 + 1]! - rest[b * 3 + 1]!, pos[i * 3 + 2]! - rest[b * 3 + 2]!).applyQuaternion(pose.rot[b]!);
      x += (pose.heads[b * 3]! + t.x) * w;
      y += (pose.heads[b * 3 + 1]! + t.y) * w;
      z += (pose.heads[b * 3 + 2]! + t.z) * w;
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

/** Normales suaves, también a través de las costuras de UV (vértices en el mismo sitio). */
export function smoothNormals(pos: Float32Array, idx: Uint16Array | Uint32Array, out?: Float32Array): Float32Array {
  const nv = pos.length / 3;
  const nrm = out && out.length === pos.length ? out.fill(0) : new Float32Array(pos.length);
  const key = new Map<string, number>();
  const rep = new Int32Array(nv);
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(pos[i * 3]! * 2e4)},${Math.round(pos[i * 3 + 1]! * 2e4)},${Math.round(pos[i * 3 + 2]! * 2e4)}`;
    const r = key.get(k);
    if (r === undefined) {
      key.set(k, i);
      rep[i] = i;
    } else rep[i] = r;
  }
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f]!, b = idx[f + 1]!, c = idx[f + 2]!;
    const ax = pos[a * 3]!, ay = pos[a * 3 + 1]!, az = pos[a * 3 + 2]!;
    const ux = pos[b * 3]! - ax, uy = pos[b * 3 + 1]! - ay, uz = pos[b * 3 + 2]! - az;
    const vx = pos[c * 3]! - ax, vy = pos[c * 3 + 1]! - ay, vz = pos[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [rep[a]!, rep[b]!, rep[c]!]) {
      nrm[v * 3] = nrm[v * 3]! + nx;
      nrm[v * 3 + 1] = nrm[v * 3 + 1]! + ny;
      nrm[v * 3 + 2] = nrm[v * 3 + 2]! + nz;
    }
  }
  for (let i = 0; i < nv; i++) {
    const r = rep[i]!;
    const x = nrm[r * 3]!, y = nrm[r * 3 + 1]!, z = nrm[r * 3 + 2]!;
    const l = Math.hypot(x, y, z) || 1;
    nrm[i * 3] = x / l;
    nrm[i * 3 + 1] = y / l;
    nrm[i * 3 + 2] = z / l;
  }
  return nrm;
}

/**
 * Índices del cuerpo sin lo que tapa la ropa: un vértice del cuerpo se esconde si su vértice de la
 * jaula principal está en la lista de borrado de alguna prenda; un triángulo, si tiene alguno.
 */
export function bodyIndex(body: Bin, hidden: Set<number> | null): Uint16Array | Uint32Array {
  const idx = body.get<Uint16Array | Uint32Array>("idx");
  if (!hidden || !hidden.size) return idx;
  const refs = body.get<Uint16Array>("refs");
  const w = body.get<Float32Array>("w");
  const nv = refs.length / 3;
  const gone = new Uint8Array(nv);
  for (let i = 0; i < nv; i++) {
    let best = 0;
    for (let k = 1; k < 3; k++) if (w[i * 3 + k]! > w[i * 3 + best]!) best = k;
    if (hidden.has(refs[i * 3 + best]!)) gone[i] = 1;
  }
  const keep: number[] = [];
  for (let f = 0; f < idx.length; f += 3) {
    if (gone[idx[f]!] || gone[idx[f + 1]!] || gone[idx[f + 2]!]) continue;
    keep.push(idx[f]!, idx[f + 1]!, idx[f + 2]!);
  }
  return idx instanceof Uint32Array ? new Uint32Array(keep) : new Uint16Array(keep);
}
