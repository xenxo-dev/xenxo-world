/**
 * Pelo con física: huesos con muelles (los de VRMC_springBone, que mueve three-vrm) para los
 * personajes que no los traen, puestos al cargar. Sirve para todos: los de serie, las fundas y los
 * VRM que sube la gente (si el archivo ya trae los suyos, se usan esos y esto no hace nada).
 *
 *   - Pelo: las mallas que van con la cabeza y cuelgan por debajo de su articulación (coleta,
 *     trenza, melena). Alrededor de la cabeza, por sectores, una cadena de huesos que baja por donde
 *     va el pelo de cada sector; cada vértice pasa a ir con su cadena según lo que cuelga (y entre dos
 *     sectores, con los dos, para que no se abra).
 *   - Colisionadores: cabeza, cuello, hombros y pecho, a la medida de cada cuerpo.
 *   - La ropa que cuelga suelta por debajo de la cadera (faldas, vestidos, túnicas, faldones): un
 *     aro de cadenas desde la cadera, y cada vértice va **a medias**: con las piernas, como lo pesó
 *     MakeHuman, y con su cadena, más cuanto más abajo (hasta `CLOTH.share`). Así ondea al andar,
 *     se queda atrás al correr y se levanta al saltar, pero nunca se separa de las piernas: con
 *     muelles del todo se quedaba atrás y las piernas la atravesaban (y lejos de la cámara, donde
 *     los muelles no se mueven, peor). Las piernas la empujan (colisionadores en muslos y espinillas).
 *     Los pantalones y lo ceñido, nada: se reconoce lo suelto porque cruza por delante o por detrás
 *     entre las dos piernas (`looseHem`).
 *
 * Todo se mide en el espacio de la pose de enlace (la de los `boneInverses`), así que da igual cómo
 * esté colocado el personaje al cargarlo. Sin nada del navegador: se prueba en Node (test/springs.mts).
 */
import * as THREE from "three";
import {
  VRMSpringBoneCollider,
  VRMSpringBoneColliderShapeCapsule,
  VRMSpringBoneColliderShapeSphere,
  VRMSpringBoneJoint,
  VRMSpringBoneManager,
  type VRM,
  type VRMSpringBoneColliderGroup,
} from "@pixiv/three-vrm";

/** Los huesos del cuerpo que hacen falta (los de verdad, los que mueven las mallas). */
export interface SpringBody {
  head: THREE.Object3D;
  neck?: THREE.Object3D | null;
  upperChest?: THREE.Object3D | null;
  chest?: THREE.Object3D | null;
  hips: THREE.Object3D;
  leftUpperArm?: THREE.Object3D | null;
  rightUpperArm?: THREE.Object3D | null;
  leftUpperLeg?: THREE.Object3D | null;
  rightUpperLeg?: THREE.Object3D | null;
  leftLowerLeg?: THREE.Object3D | null;
  rightLowerLeg?: THREE.Object3D | null;
  leftFoot?: THREE.Object3D | null;
  rightFoot?: THREE.Object3D | null;
}

/** Los huesos de verdad (los que mueven las mallas) de un VRM, para `addSprings`. */
export function springBodyOf(vrm: VRM): SpringBody | null {
  const h = vrm.humanoid;
  const raw = (name: Parameters<typeof h.getRawBoneNode>[0]) => h.getRawBoneNode(name);
  const head = raw("head"), hips = raw("hips");
  if (!head || !hips) return null;
  return {
    head,
    hips,
    neck: raw("neck"),
    upperChest: raw("upperChest"),
    chest: raw("chest"),
    leftUpperArm: raw("leftUpperArm"),
    rightUpperArm: raw("rightUpperArm"),
    leftUpperLeg: raw("leftUpperLeg"),
    rightUpperLeg: raw("rightUpperLeg"),
    leftLowerLeg: raw("leftLowerLeg"),
    rightLowerLeg: raw("rightLowerLeg"),
    leftFoot: raw("leftFoot"),
    rightFoot: raw("rightFoot"),
  };
}

export interface Springs {
  manager: VRMSpringBoneManager;
  /** Cuántas cadenas de pelo y de ropa, y cuántos huesos con muelle en total. */
  hair: number;
  cloth: number;
  joints: number;
  /** Un frame (después de que la animación y vrm.update hayan colocado el cuerpo). */
  update(dt: number): void;
  /** Vuelta al reposo (al aparecer en otro sitio, o tras un rato sin moverse). */
  reset(): void;
}

/** Mallas que nunca se mueven solas: ojos, cejas, pestañas, barba, gafas, gorros, guantes, zapatos, el cuerpo… */
const SKIP = /eye|lash|brow|ceja|pesta|teeth|tongue|beard|moustache|mustache|barba|bigote|glass|gafa|^gl_|hat|hood|gorro|sombrero|helmet|casco|implant|^imp_|glove|^gv_|shoe|^sh_|boot|bota|body|base|low-poly|skin|piel/i;

const HAIR = { sectors: 6, seg: 0.085, maxJoints: 5, min: 0.06, stiffness: 1.35, gravity: 0.3, drag: 0.42, hit: 0.018 };
/**
 * La ropa suelta: más tiesa y frenada que el pelo (es tela, no mechones). `share`: lo más que va con
 * su cadena (el resto, con las piernas); `from`/`full`: desde dónde y hasta dónde por debajo de la
 * cadera crece esa parte (m, en el cuerpo de referencia).
 */
const CLOTH = { sectors: 8, seg: 0.12, maxJoints: 5, min: 0.15, stiffness: 2.2, gravity: 0.12, drag: 0.6, hit: 0.03, share: 0.5, from: 0.04, full: 0.32 };

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

interface Chain {
  /** Sector (ángulo del centro, rad) y posición de cada articulación (pose de enlace). */
  angle: number;
  pts: THREE.Vector3[];
  bones: THREE.Bone[];
  /** Índices de esos huesos en el esqueleto nuevo. */
  idx: number[];
}

/**
 * Pone el pelo con muelles en un personaje (sus mallas con huesos comparten un esqueleto: el de
 * VRMUtils.combineSkeletons). Devuelve null si no hay nada que mover.
 */
export function addSprings(root: THREE.Object3D, body: SpringBody): Springs | null {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });
  if (!meshes.length) return null;
  const skel = meshes[0]!.skeleton;
  if (meshes.some((m) => m.skeleton !== skel)) return null;
  const bindPos = (o: THREE.Object3D | null | undefined, out: THREE.Vector3): THREE.Vector3 | null => {
    const i = o ? skel.bones.indexOf(o as THREE.Bone) : -1;
    if (i < 0) return null;
    return out.setFromMatrixPosition(_m.copy(skel.boneInverses[i]!).invert());
  };
  const head = bindPos(body.head, new THREE.Vector3());
  const hips = bindPos(body.hips, new THREE.Vector3());
  if (!head || !hips) return null;
  // Escala del cuerpo: 0,62 m de la cadera a la cabeza en el de referencia (1,75 m).
  const s = THREE.MathUtils.clamp((head.y - hips.y) / 0.62, 0.6, 1.6);
  const plans: { mesh: THREE.SkinnedMesh; pos: Float32Array; cloth: boolean }[] = [];
  const knee = bindPos(body.leftLowerLeg, new THREE.Vector3());
  for (const mesh of meshes) {
    if (SKIP.test(mesh.name) || SKIP.test(materialName(mesh))) continue;
    const pos = bindPositions(mesh);
    const dom = dominant(mesh);
    const headIdx = skel.bones.indexOf(body.head as THREE.Bone);
    const neckIdx = body.neck ? skel.bones.indexOf(body.neck as THREE.Bone) : -1;
    let onHead = 0, below = 0, top = -Infinity;
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1]!;
      top = Math.max(top, y);
      if (dom[i] === headIdx || dom[i] === neckIdx) onHead++;
      if (y < head.y - HAIR.min * s) below++;
    }
    // Pelo: sube por encima de la cabeza (el cuero cabelludo), buena parte va con ella (en las trenzas,
    // el resto con el pecho), no baja de la cintura y algo cuelga por debajo de la articulación.
    const hairLike = top > head.y + 0.1 * s && onHead > n * 0.15 && minY(pos) > hips.y + 0.1 * s;
    if (hairLike && below >= 8) plans.push({ mesh, pos, cloth: false });
    else if (knee && looseHem(pos, hips, knee, s)) plans.push({ mesh, pos, cloth: true });
  }
  if (!plans.length) return null;

  const newBones: THREE.Bone[] = [];
  const newInverses: THREE.Matrix4[] = [];
  const base = skel.bones.length;
  const manager = new VRMSpringBoneManager();
  const groups = colliders(body, skel, s);
  const legs = plans.some((p) => p.cloth) ? legColliders(body, skel, s) : [];
  let hairChains = 0, clothChains = 0, joints = 0;
  // Cada malla, sus cadenas (dos mallas de pelo, p. ej. flequillo y coleta, van cada una con las suyas).
  const work: { mesh: THREE.SkinnedMesh; pos: Float32Array; chains: (Chain | null)[]; seg: number; cloth: boolean; rootY: number; center: THREE.Vector3 }[] = [];
  for (const p of plans) {
    const P = p.cloth ? CLOTH : HAIR;
    const seg = P.seg * s;
    // El pelo cuelga de la cabeza; la ropa, de un poco por debajo de la cadera.
    const center = p.cloth ? hips : head;
    const rootY = p.cloth ? hips.y - 0.05 * s : head.y;
    const chains = buildChains(p.pos, center, rootY, seg, P.sectors, P.maxJoints, P.min * s);
    const parent = p.cloth ? body.hips : body.head;
    for (const c of chains) {
      if (!c) continue;
      // Huesos: el primero cuelga de la cabeza (o de la cadera), cada uno del anterior; el último
      // es la punta (sin muelle propio).
      let prev: THREE.Object3D = parent;
      let prevBind = _m.copy(skel.boneInverses[skel.bones.indexOf(parent as THREE.Bone)]!).invert().clone();
      for (let k = 0; k < c.pts.length; k++) {
        const b = new THREE.Bone();
        b.name = `${p.cloth ? "cloth" : "hair"}_${p.mesh.name}_${c.angle.toFixed(2)}_${k}`;
        const world = new THREE.Matrix4().makeTranslation(c.pts[k]!.x, c.pts[k]!.y, c.pts[k]!.z);
        const local = prevBind.clone().invert().multiply(world);
        local.decompose(b.position, b.quaternion, b.scale);
        prev.add(b);
        c.bones.push(b);
        c.idx.push(base + newBones.length);
        newBones.push(b);
        newInverses.push(world.clone().invert());
        prev = b;
        prevBind = world;
      }
      for (let k = 0; k < c.bones.length - 1; k++) {
        manager.addJoint(
          new VRMSpringBoneJoint(c.bones[k]!, c.bones[k + 1]!, {
            hitRadius: P.hit * s,
            stiffness: P.stiffness * (1 + k * 0.1),
            gravityPower: P.gravity,
            gravityDir: new THREE.Vector3(0, -1, 0),
            dragForce: P.drag,
          }, p.cloth ? legs : groups),
        );
        joints++;
      }
      if (p.cloth) clothChains++;
      else hairChains++;
    }
    work.push({ ...p, chains, seg, rootY, center });
  }
  if (!joints) return null;

  // El esqueleto con los huesos nuevos; todas las mallas, enlazadas a él.
  const skeleton = new THREE.Skeleton([...skel.bones, ...newBones], [...skel.boneInverses, ...newInverses]);
  for (const mesh of meshes) mesh.bind(skeleton, mesh.bindMatrix);
  skel.dispose();
  for (const w of work) reweight(w.mesh, w.pos, w.chains, w.center, w.rootY, w.seg, w.cloth ? s : 0);

  root.updateMatrixWorld(true);
  manager.setInitState();
  return {
    manager,
    hair: hairChains,
    cloth: clothChains,
    joints,
    update: (dt) => manager.update(dt),
    reset: () => manager.reset(),
  };
}

function materialName(m: THREE.Mesh): string {
  const mat = Array.isArray(m.material) ? m.material[0] : m.material;
  return mat?.name ?? "";
}

/** Posiciones de los vértices en la pose de enlace (las de la geometría con su bindMatrix). */
function bindPositions(mesh: THREE.SkinnedMesh): Float32Array {
  const a = mesh.geometry.getAttribute("position");
  const out = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) {
    _v.fromBufferAttribute(a, i).applyMatrix4(mesh.bindMatrix);
    out[i * 3] = _v.x;
    out[i * 3 + 1] = _v.y;
    out[i * 3 + 2] = _v.z;
  }
  return out;
}

/** El hueso que más mueve cada vértice. */
function dominant(mesh: THREE.SkinnedMesh): Int32Array {
  const si = mesh.geometry.getAttribute("skinIndex");
  const sw = mesh.geometry.getAttribute("skinWeight");
  const out = new Int32Array(si.count);
  for (let i = 0; i < si.count; i++) {
    let best = -1, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bw) {
        bw = w;
        best = si.getComponent(i, k);
      }
    }
    out[i] = best;
  }
  return out;
}

function minY(pos: Float32Array): number {
  let m = Infinity;
  for (let i = 1; i < pos.length; i += 3) m = Math.min(m, pos[i]!);
  return m;
}

/**
 * Cadenas por sectores alrededor del eje vertical que pasa por `center`: en cada sector, lo que
 * cuelga por debajo de `rootY`; cada articulación, en el centro de lo que hay a su altura.
 */
function buildChains(pos: Float32Array, center: THREE.Vector3, rootY: number, seg: number, sectors: number, maxJoints: number, min: number): (Chain | null)[] {
  const n = pos.length / 3;
  const width = (Math.PI * 2) / sectors;
  const out: (Chain | null)[] = [];
  for (let s = 0; s < sectors; s++) {
    const angle = -Math.PI + width * (s + 0.5);
    // Lo de este sector: suma de x, z y cuántos por cada franja de altura (la 0, a la altura de la raíz).
    let deepest = 0;
    const bands = maxJoints + 1;
    const sx = new Float64Array(bands), sz = new Float64Array(bands), cnt = new Int32Array(bands);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
      const a = Math.atan2(x - center.x, z - center.z);
      if (Math.abs(wrap(a - angle)) > width / 2) continue;
      const hang = rootY - y;
      if (hang < -seg * 0.5) continue;
      const k = Math.min(bands - 1, Math.max(0, Math.round(hang / seg)));
      sx[k] = sx[k]! + x;
      sz[k] = sz[k]! + z;
      cnt[k] = cnt[k]! + 1;
      deepest = Math.max(deepest, hang);
    }
    if (deepest < min || cnt.reduce((a, b) => a + b, 0) < 12) {
      out.push(null);
      continue;
    }
    // Articulaciones: la raíz y una por franja hasta lo más hondo (más la punta).
    const last = Math.min(maxJoints, Math.ceil(deepest / seg));
    const pts: THREE.Vector3[] = [];
    let px = center.x + Math.sin(angle) * 0.06, pz = center.z + Math.cos(angle) * 0.06;
    for (let k = 0; k <= last; k++) {
      if (cnt[k]! > 0) {
        px = sx[k]! / cnt[k]!;
        pz = sz[k]! / cnt[k]!;
      }
      pts.push(new THREE.Vector3(px, rootY - k * seg, pz));
    }
    out.push({ angle, pts, bones: [], idx: [] });
  }
  return out;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth01 = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * ¿Cuelga suelta por debajo de la cadera (falda, vestido, túnica, faldón)? Lo suelto cruza entre las
 * dos piernas por delante o por detrás, entre la entrepierna y la rodilla; un pantalón (cada pernera
 * por su lado) o algo ceñido, no. En la pose de enlace.
 */
export function looseHem(pos: Float32Array, hips: THREE.Vector3, knee: THREE.Vector3, s: number): boolean {
  let across = 0, low = Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
    low = Math.min(low, y);
    if (y < hips.y - 0.12 * s && y > knee.y - 0.05 * s && Math.abs(x - hips.x) < 0.03 * s && Math.abs(z - hips.z) > 0.08 * s) across++;
  }
  return across >= 30 && hips.y - low > 0.2 * s;
}

/**
 * Pesos nuevos para lo que cuelga: a lo largo de su cadena (entre las dos articulaciones de su
 * altura) y, entre dos sectores, repartido con el de al lado. Lo que no cuelga, como estaba.
 * `cloth` (la escala del cuerpo, o 0 para el pelo): la ropa va a medias, con sus pesos de antes y
 * con la cadena, más con la cadena cuanto más abajo (`CLOTH`).
 */
function reweight(mesh: THREE.SkinnedMesh, pos: Float32Array, chains: (Chain | null)[], center: THREE.Vector3, rootY: number, seg: number, cloth = 0) {
  const g = mesh.geometry;
  const si = g.getAttribute("skinIndex");
  const sw = g.getAttribute("skinWeight");
  const n = si.count;
  const idx = new Uint16Array(n * 4);
  const wts = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) {
      idx[i * 4 + k] = si.getComponent(i, k);
      wts[i * 4 + k] = sw.getComponent(i, k);
    }
  }
  const sectors = chains.length;
  const width = (Math.PI * 2) / sectors;
  const tmpI = [0, 0, 0, 0];
  const tmpW = [0, 0, 0, 0];
  const mixI = [0, 0, 0, 0, 0, 0, 0, 0];
  const mixW = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    const hang = rootY - y;
    if (hang <= 0) continue;
    // Su sector y el de al lado (hacia donde cae el vértice), con su parte.
    const a = Math.atan2(x - center.x, z - center.z);
    const f = (wrap(a + Math.PI) / width + sectors) % sectors - 0.5;
    let s0 = ((Math.floor(f) % sectors) + sectors) % sectors;
    let s1 = (s0 + 1) % sectors;
    let t = f - Math.floor(f);
    if (!chains[s0] && !chains[s1]) continue;
    if (!chains[s0]) {
      s0 = s1;
      t = 0;
    } else if (!chains[s1]) {
      s1 = s0;
      t = 0;
    }
    let m = 0;
    const put = (c: Chain, share: number) => {
      const along = Math.min(c.pts.length - 1, hang / seg);
      const k = Math.min(c.pts.length - 2, Math.floor(along));
      const u = Math.min(1, along - k);
      tmpI[m] = c.idx[k]!;
      tmpW[m++] = share * (1 - u);
      tmpI[m] = c.idx[k + 1]!;
      tmpW[m++] = share * u;
    };
    put(chains[s0]!, 1 - t);
    if (t > 0) put(chains[s1]!, t);
    if (cloth > 0) {
      const share = CLOTH.share * smooth01((hang - CLOTH.from * cloth) / ((CLOTH.full - CLOTH.from) * cloth));
      if (share <= 0) continue;
      // Lo de antes (las piernas) y lo de la cadena, juntos; se quedan los cuatro que más pesan.
      for (let k = 0; k < 4; k++) {
        mixI[k] = idx[i * 4 + k]!;
        mixW[k] = wts[i * 4 + k]! * (1 - share);
      }
      for (let k = 0; k < m; k++) {
        mixI[4 + k] = tmpI[k]!;
        mixW[4 + k] = tmpW[k]! * share;
      }
      for (let k = m; k < 4; k++) mixW[4 + k] = 0;
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        let best = -1;
        for (let j = 0; j < 8; j++) if (mixW[j]! > 0 && (best < 0 || mixW[j]! > mixW[best]!)) best = j;
        idx[i * 4 + k] = best < 0 ? 0 : mixI[best]!;
        wts[i * 4 + k] = best < 0 ? 0 : mixW[best]!;
        sum += wts[i * 4 + k]!;
        if (best >= 0) mixW[best] = 0;
      }
      for (let k = 0; k < 4; k++) wts[i * 4 + k] = sum > 0 ? wts[i * 4 + k]! / sum : k === 0 ? 1 : 0;
      continue;
    }
    for (let k = 0; k < 4; k++) {
      idx[i * 4 + k] = k < m ? tmpI[k]! : 0;
      wts[i * 4 + k] = k < m ? tmpW[k]! : 0;
    }
  }
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(wts, 4));
}

/** Colisionadores del pelo (en la pose de enlace, pegados a sus huesos): cabeza, cuello, pecho y hombros. */
function colliders(body: SpringBody, skel: THREE.Skeleton, s: number): VRMSpringBoneColliderGroup[] {
  const P = (o: THREE.Object3D | null | undefined) => {
    const i = o ? skel.bones.indexOf(o as THREE.Bone) : -1;
    return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(_m.copy(skel.boneInverses[i]!).invert());
  };
  /** Un punto del mundo (pose de enlace) en el espacio de un hueso. */
  const local = (o: THREE.Object3D, w: THREE.Vector3) => w.clone().applyMatrix4(skel.boneInverses[skel.bones.indexOf(o as THREE.Bone)]!);
  const sphere = (bone: THREE.Object3D | null | undefined, at: THREE.Vector3 | null, r: number) => {
    if (!bone || !at || skel.bones.indexOf(bone as THREE.Bone) < 0) return null;
    const c = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeSphere({ offset: local(bone, at), radius: r }));
    bone.add(c);
    return c;
  };
  const capsule = (bone: THREE.Object3D | null | undefined, a: THREE.Vector3 | null, b: THREE.Vector3 | null, r: number) => {
    if (!bone || !a || !b || skel.bones.indexOf(bone as THREE.Bone) < 0) return null;
    const c = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeCapsule({ offset: local(bone, a), tail: local(bone, b), radius: r }));
    bone.add(c);
    return c;
  };
  const head = P(body.head)!, neck = P(body.neck), chestBone = body.upperChest ?? body.chest, chest = P(chestBone);
  const armL = P(body.leftUpperArm), armR = P(body.rightUpperArm);
  const up = (v: THREE.Vector3, dy: number, dz = 0) => _w.set(v.x, v.y + dy * s, v.z + dz * s).clone();
  const hair = [
    sphere(body.head, up(head, 0.075, -0.005), 0.098 * s),
    neck ? capsule(body.neck, neck, head, 0.055 * s) : null,
    chest ? sphere(chestBone, up(chest, 0.02, -0.02), 0.12 * s) : null,
    armL && armR && chestBone ? capsule(chestBone, armL, armR, 0.06 * s) : null,
  ].filter((c): c is VRMSpringBoneCollider => !!c);
  return [{ colliders: hair, name: "cuerpo (pelo)" }];
}

/** Colisionadores de la ropa: los muslos y las espinillas (las piernas empujan la falda; nunca la atraviesan). */
function legColliders(body: SpringBody, skel: THREE.Skeleton, s: number): VRMSpringBoneColliderGroup[] {
  const at = (o: THREE.Object3D | null | undefined) => {
    const i = o ? skel.bones.indexOf(o as THREE.Bone) : -1;
    return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(_m.copy(skel.boneInverses[i]!).invert());
  };
  const out: VRMSpringBoneCollider[] = [];
  const capsule = (bone: THREE.Object3D | null | undefined, a: THREE.Vector3 | null, b: THREE.Vector3 | null, r: number) => {
    const i = bone ? skel.bones.indexOf(bone as THREE.Bone) : -1;
    if (i < 0 || !a || !b) return;
    const inv = skel.boneInverses[i]!;
    const c = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeCapsule({ offset: a.clone().applyMatrix4(inv), tail: b.clone().applyMatrix4(inv), radius: r }));
    bone!.add(c);
    out.push(c);
  };
  for (const [up, low, foot] of [
    [body.leftUpperLeg, body.leftLowerLeg, body.leftFoot],
    [body.rightUpperLeg, body.rightLowerLeg, body.rightFoot],
  ] as const) {
    const hip = at(up), knee = at(low), ankle = at(foot);
    capsule(up, hip, knee, 0.085 * s);
    capsule(low, knee, ankle, 0.06 * s);
  }
  return out.length ? [{ colliders: out, name: "piernas (ropa)" }] : [];
}
