/**
 * El humanoide en reposo de un personaje VRM, para pasarle un movimiento (capture/retarget.ts) y para
 * escribirlo (capture/files.ts): por hueso, su padre y dónde está respecto a él, en la convención de
 * VRM 1.0 (la pose en T mirando a +z, con su izquierda en +x). Un VRM 0.x mira hacia el otro lado:
 * sus medidas se giran media vuelta (x y z cambian de signo), como hace three-vrm con los clips.
 */
import type * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import type { RestBone, V3 } from "./retarget";

/** Los huesos del humanoide de `vrm`, cada padre antes que sus hijos (la cadera, el primero). */
export function restOf(vrm: VRM): RestBone[] {
  const h = vrm.humanoid;
  const v0 = vrm.meta?.metaVersion === "0";
  const rest = h.normalizedRestPose;
  const names = Object.keys(h.humanBones) as VRMHumanBoneName[];
  const nodeName = new Map<THREE.Object3D, string>();
  for (const n of names) {
    const node = h.getNormalizedBoneNode(n);
    if (node) nodeName.set(node, n);
  }
  const all: RestBone[] = [];
  for (const n of names) {
    const node = h.getNormalizedBoneNode(n);
    if (!node) continue;
    // Su padre: el primer hueso del humanoide hacia arriba (sin los que no tenga el personaje).
    let p: THREE.Object3D | null = node.parent, parent: string | null = null;
    while (p) {
      const hit = nodeName.get(p);
      if (hit) {
        parent = hit;
        break;
      }
      p = p.parent;
    }
    const at = rest[n]?.position ?? [0, 0, 0];
    const offset: V3 = v0 ? [-at[0]!, at[1]!, -at[2]!] : [at[0]!, at[1]!, at[2]!];
    all.push({ name: n, parent, offset });
  }
  return ordered(all);
}

/** Los huesos de modo que cada padre vaya antes que sus hijos. */
export function ordered(bones: RestBone[]): RestBone[] {
  const out: RestBone[] = [];
  const kids = new Map<string | null, RestBone[]>();
  for (const b of bones) {
    const list = kids.get(b.parent) ?? [];
    list.push(b);
    kids.set(b.parent, list);
  }
  const walk = (parent: string | null) => {
    for (const b of kids.get(parent) ?? []) {
      out.push(b);
      walk(b.name);
    }
  };
  walk(null);
  return out;
}
