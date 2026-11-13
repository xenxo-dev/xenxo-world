/**
 * Prueba de las manos sin navegador (world/people/hands.ts y lo que hace con ellas el animador):
 *
 * - con los esqueletos de los personajes de serie de verdad: con cada forma, las puntas de los dedos
 *   van hacia la palma y no de lado (doblar no es barrer el dedo por el plano de la palma), el puño
 *   las lleva a la palma, la relajada se dobla más del índice al meñique, la estirada es la pose en T
 *   y la derecha es la izquierda en espejo; y su mano en reposo no necesita arreglo;
 * - con una mano como la de las fundas (los dedos algo doblados en reposo y el pulgar hacia abajo):
 *   el arreglo la deja recta, con el pulgar a 45°, y cada forma acaba igual que en una mano recta;
 * - con un VRM 0.x (que mira hacia el otro lado): lo mismo, en espejo;
 * - y con el animador: la mano de base y el arreglo, frame tras frame, sin acumularse.
 *
 *   npm run test:hands -w @xenxo/web
 */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMHumanoid, VRMLoaderPlugin, type VRM0Meta, type VRM1Meta, type VRMHumanBoneName, type VRMHumanBones } from "@pixiv/three-vrm";
import { FINGER_BONES, handTable, restFix, type BaseHand } from "../src/world/people/hands.ts";

// Sin navegador no hay imágenes ni clips: el cargador avisa y sigue (aquí no hacen falta).
const quiet = console.error;
console.error = (...a: unknown[]) => (String(a[0]).includes("Couldn't load texture") ? undefined : quiet(...a));
console.warn = () => {};

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};
const mm = (x: number) => `${(x * 1000).toFixed(1)} mm`;
const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Medir: las puntas de los dedos en el esqueleto normalizado           */
/* ------------------------------------------------------------------ */

const LONG = ["Index", "Middle", "Ring", "Little"] as const;
const SIDES = ["left", "right"] as const;
type Side = (typeof SIDES)[number];

interface Hand {
  humanoid: VRMHumanoid;
  vrm0: boolean;
  /** Las puntas (una más allá de la última falange, siguiendo a la de antes). */
  tips: Map<string, THREE.Object3D>;
}

function handOf(humanoid: VRMHumanoid, vrm0: boolean): Hand {
  const tips = new Map<string, THREE.Object3D>();
  const rest = humanoid.normalizedRestPose;
  for (const side of SIDES)
    for (const f of ["Thumb", ...LONG]) {
      const last = f === "Thumb" ? `${side}ThumbDistal` : `${side}${f}Distal`;
      const node = humanoid.getNormalizedBoneNode(last as VRMHumanBoneName);
      const off = rest[last as VRMHumanBoneName]?.position;
      if (!node || !off) continue;
      const tip = new THREE.Object3D();
      tip.position.fromArray(off).multiplyScalar(0.8);
      node.add(tip);
      tips.set(`${side}${f}`, tip);
    }
  return { humanoid, vrm0, tips };
}

/** Pone una forma (con el arreglo del modelo) y devuelve dónde quedan las puntas, respecto a cada mano. */
function pose(h: Hand, shape: BaseHand, fix = true): Map<string, THREE.Vector3> {
  const hu = h.humanoid;
  hu.resetNormalizedPose();
  for (const [bone, q] of handTable(shape, h.vrm0)) hu.getNormalizedBoneNode(bone as VRMHumanBoneName)?.quaternion.copy(q);
  if (fix) for (const f of restFix(hu, h.vrm0)) f.node.quaternion.premultiply(f.pre).multiply(f.post);
  hu.normalizedHumanBonesRoot.updateMatrixWorld(true);
  const out = new Map<string, THREE.Vector3>();
  for (const [name, tip] of h.tips) {
    const side = name.startsWith("left") ? "left" : "right";
    const hand = hu.getNormalizedBoneNode(`${side}Hand`)!;
    out.set(name, tip.getWorldPosition(new THREE.Vector3()).sub(hand.getWorldPosition(new THREE.Vector3())));
  }
  return out;
}

/** La mano en reposo: hacia dónde van los dedos, la palma (hacia fuera de ella) y de lado (del meñique al índice). */
function frame(h: Hand, side: Side) {
  const rest = h.humanoid.normalizedRestPose;
  const P = (b: string) => new THREE.Vector3().fromArray(rest[`${side}${b}` as VRMHumanBoneName]!.position!);
  const along = P("MiddleProximal").normalize();
  const across = P("IndexProximal").sub(P("LittleProximal")).normalize();
  const palm = along.clone().cross(across).normalize();
  if (side === "right") palm.negate();
  return { along, across, palm };
}

/* ------------------------------------------------------------------ */
/* Los personajes de serie                                              */
/* ------------------------------------------------------------------ */

const presets = JSON.parse(readFileSync(new URL("../src/world/avatar-presets.json", import.meta.url), "utf8")) as { id: string; hash: string }[];
const loader = new GLTFLoader();
loader.register((p) => new VRMLoaderPlugin(p));

/** El GLB sin imágenes ni texturas (en Node no se pueden decodificar y aquí no hacen falta). */
function withoutTextures(file: Buffer): ArrayBuffer {
  const jsonLen = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLen).toString("utf8"));
  const strip = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) if (!/texture$/i.test(k)) out[k] = strip(v);
      return out;
    }
    return o;
  };
  delete json.images;
  delete json.textures;
  delete json.samplers;
  json.materials = strip(json.materials);
  if (json.extensions) json.extensions = strip(json.extensions);
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((e: string) => !/texture/i.test(e));
  json.extensionsRequired = (json.extensionsRequired ?? []).filter((e: string) => !/texture/i.test(e));
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const jsonBuf = Buffer.from(text, "utf8");
  const rest = file.subarray(20 + jsonLen);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + jsonBuf.length + rest.length, 8);
  head.writeUInt32LE(jsonBuf.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, jsonBuf, rest]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

async function load(hash: string): Promise<VRM> {
  const file = readFileSync(new URL(`../../realtime/seed-assets/s/${hash.split(":")[1]}.glb`, import.meta.url));
  const gltf = await new Promise<{ userData: { vrm: VRM } }>((ok, ko) => loader.parse(withoutTextures(file), "", ok as never, ko));
  return gltf.userData.vrm;
}

/** Las comprobaciones de las formas sobre una mano (de un personaje de serie o hecha aquí). */
function shapesOn(h: Hand, who: string) {
  const flat = pose(h, "flat");
  const rest = pose(h, "flat", false);
  let still = 0;
  for (const [k, v] of flat) still = Math.max(still, v.distanceTo(rest.get(k)!));
  const anyFix = restFix(h.humanoid, h.vrm0).length > 0;
  if (!anyFix) check(still < 1e-6, `${who}: estirada, la pose en T (${mm(still)})`);
  for (const shape of ["relaxed", "grip", "fist"] as const) {
    const at = pose(h, shape);
    const hu = h.humanoid;
    let worstSide = 0, least = Infinity, side0 = "";
    const curl: Record<string, number> = {};
    for (const side of SIDES) {
      const fr = frame(h, side);
      const hand = hu.getNormalizedBoneNode(`${side}Hand`)!.getWorldPosition(new THREE.Vector3());
      for (const f of LONG) {
        const k = `${side}${f}`;
        const d = at.get(k)!.clone().sub(flat.get(k)!);
        // Lo que baja hacia la palma, y lo que se va de lado frente a todo lo que se mueve.
        least = Math.min(least, d.dot(fr.palm));
        const ratio = Math.abs(d.dot(fr.across)) / Math.max(1e-6, d.length());
        if (ratio > worstSide) [worstSide, side0] = [ratio, k];
        // Cuánto se dobla el dedo entero: de su base a la punta, frente a hacia donde va estirado.
        const base = hu.getNormalizedBoneNode(`${side}${f}Proximal` as VRMHumanBoneName)!.getWorldPosition(new THREE.Vector3()).sub(hand);
        const straightDir = flat.get(k)!.clone().sub(base).normalize();
        curl[k] = Math.acos(Math.min(1, at.get(k)!.clone().sub(base).normalize().dot(straightDir)));
      }
    }
    check(least > 0.003, `${who}, ${shape}: las puntas van hacia la palma (la que menos, ${mm(least)})`);
    check(worstSide < 0.3, `${who}, ${shape}: y no de lado (lo peor, ${side0}: ${(worstSide * 100).toFixed(0)} % de lo que se mueve)`);
    if (shape === "relaxed") {
      const ok = SIDES.every((s) => curl[`${s}Index`]! < curl[`${s}Middle`]! && curl[`${s}Middle`]! < curl[`${s}Ring`]! && curl[`${s}Ring`]! < curl[`${s}Little`]!);
      const deg = LONG.map((f) => (curl[`left${f}`]! / DEG).toFixed(0)).join(", ");
      check(ok, `${who}, relajada: cada dedo algo más doblado que el anterior, del índice al meñique (${deg}°)`);
    }
    if (shape === "fist") {
      // Cerrado: la punta, a la altura de la palma (no más allá de la base del dedo).
      let far = -Infinity;
      for (const side of SIDES) {
        const fr = frame(h, side);
        for (const f of LONG) {
          const base = h.humanoid.normalizedRestPose[`${side}${f}Proximal` as VRMHumanBoneName]!.position!;
          far = Math.max(far, at.get(`${side}${f}`)!.dot(fr.along) - new THREE.Vector3().fromArray(base).dot(fr.along));
        }
      }
      check(far < 0.01, `${who}, puño: las puntas no pasan de los nudillos (lo que más, ${mm(far)})`);
    }
    // La derecha, la izquierda en espejo (en x; en un VRM 0.x, igual: el espejo es el mismo).
    let mirror = 0;
    for (const [k, v] of at)
      if (k.startsWith("left")) {
        const r = at.get(k.replace("left", "right"));
        if (r) mirror = Math.max(mirror, Math.abs(v.x + r.x) + Math.abs(v.y - r.y) + Math.abs(v.z - r.z));
      }
    if (who.startsWith("serie")) check(mirror < 0.006, `${who}, ${shape}: la derecha, en espejo de la izquierda (${mm(mirror)})`);
  }
}

const seen = new Set<string>();
for (const p of presets) {
  if (seen.has(p.hash)) continue;
  seen.add(p.hash);
  let vrm: VRM;
  try {
    vrm = await load(p.hash);
  } catch {
    continue;
  }
  const h = handOf(vrm.humanoid, vrm.meta.metaVersion === "0");
  if (seen.size === 1 || p.id === "iris") shapesOn(h, `serie (${p.id})`);
  check(restFix(vrm.humanoid, h.vrm0).length === 0, `serie (${p.id}): su mano en reposo ya vale (sin arreglo)`);
}

/* ------------------------------------------------------------------ */
/* Una mano hecha aquí: recta (como pide VRM) o como la de las fundas    */
/* ------------------------------------------------------------------ */

/** Largo de cada falange (m) y dónde está la base de cada dedo, respecto a la muñeca (mano izquierda, VRM 1). */
const BASES: Record<string, [number, number, number]> = { Index: [0.09, 0, 0.024], Middle: [0.094, 0, 0.004], Ring: [0.088, 0, -0.015], Little: [0.078, 0, -0.032] };
const LEN = [0.042, 0.026, 0.02];
const THUMB_BASE: [number, number, number] = [0.022, -0.012, 0.024];
const THUMB_LEN = [0.04, 0.032, 0.025];
const PALM = new THREE.Vector3(0, -1, 0);

/**
 * Un esqueleto con las dos manos: `bend` (grados por articulación, hacia la palma) y `thumb` (hacia
 * dónde va el pulgar en reposo, mano izquierda en VRM 1); `vrm0`, girado media vuelta como un VRM 0.x.
 */
function rig(bend: [number, number], thumb: THREE.Vector3, vrm0: boolean): VRM {
  const root = new THREE.Group();
  const bones: Partial<Record<VRMHumanBoneName, { node: THREE.Object3D }>> = {};
  const flip = (v: THREE.Vector3) => (vrm0 ? v.set(-v.x, v.y, -v.z) : v);
  const bone = (name: VRMHumanBoneName, parent: THREE.Object3D, at: THREE.Vector3) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.copy(at);
    parent.add(b);
    bones[name] = { node: b };
    return b;
  };
  const hips = bone("hips", root, new THREE.Vector3(0, 1, 0));
  const spine = bone("spine", hips, new THREE.Vector3(0, 0.1, 0));
  const chest = bone("chest", spine, new THREE.Vector3(0, 0.15, 0));
  const neck = bone("neck", chest, new THREE.Vector3(0, 0.2, 0));
  bone("head", neck, new THREE.Vector3(0, 0.1, 0));
  for (const side of SIDES) {
    const s = side === "left" ? 1 : -1;
    const up = bone(`${side}UpperArm`, chest, flip(new THREE.Vector3(0.18 * s, 0.15, 0)));
    const low = bone(`${side}LowerArm`, up, flip(new THREE.Vector3(0.28 * s, 0, 0)));
    const hand = bone(`${side}Hand`, low, flip(new THREE.Vector3(0.25 * s, 0, 0)));
    for (const f of LONG) {
      const [x, y, z] = BASES[f]!;
      const base = new THREE.Vector3(x * s, y, z);
      let parent = bone(`${side}${f}Proximal` as VRMHumanBoneName, hand, flip(base.clone()));
      // Estirado, el dedo va a lo largo de ±X (como en los de serie); doblado, cada falange gira hacia
      // la palma (−Y) alrededor del eje que le corresponde (el de la de antes por la palma).
      let u = base.clone().normalize(), dir = new THREE.Vector3(s, 0, 0);
      for (let j = 0; j < 2; j++) {
        const axis = u.clone().cross(PALM).normalize();
        dir = dir.clone().applyAxisAngle(axis, bend[j]! * DEG * (f === "Little" ? 1.2 : 1));
        parent = bone(`${side}${f}${j === 0 ? "Intermediate" : "Distal"}` as VRMHumanBoneName, parent, flip(dir.clone().multiplyScalar(LEN[j]!)));
        u = dir;
      }
    }
    const t = thumb.clone().normalize();
    if (side === "right") t.x = -t.x;
    let p = bone(`${side}ThumbMetacarpal`, hand, flip(new THREE.Vector3(THUMB_BASE[0] * s, THUMB_BASE[1], THUMB_BASE[2])));
    p = bone(`${side}ThumbProximal`, p, flip(t.clone().multiplyScalar(THUMB_LEN[0]!)));
    bone(`${side}ThumbDistal`, p, flip(t.clone().multiplyScalar(THUMB_LEN[1]!)));
  }
  root.updateMatrixWorld(true);
  const humanoid = new VRMHumanoid(bones as VRMHumanBones);
  root.add(humanoid.normalizedHumanBonesRoot);
  const meta = vrm0
    ? ({ metaVersion: "0" } as VRM0Meta)
    : ({ metaVersion: "1", name: "x", authors: ["x"], licenseUrl: "https://vrm.dev/licenses/1.0/" } as VRM1Meta);
  return new VRM({ scene: root, meta, humanoid });
}

const STRAIGHT_THUMB = new THREE.Vector3(1, 0, 1);
const FUNDA_THUMB = new THREE.Vector3(0.28, -0.68, 0.68);
const straight = handOf(rig([0, 0], STRAIGHT_THUMB, false).humanoid, false);
const bent = handOf(rig([20, 18], FUNDA_THUMB, false).humanoid, false);
shapesOn(straight, "mano recta");
check(restFix(straight.humanoid, false).length === 0, "mano recta: sin arreglo");
const fixes = restFix(bent.humanoid, false);
check(fixes.length > 0, `mano de funda: con arreglo (${fixes.length} huesos)`);
{
  // Arreglada y estirada, cada falange sigue a la de antes y el pulgar va a 45°, en el plano de la palma.
  const hu = bent.humanoid;
  pose(bent, "flat");
  let worst = 0, thumbOff = 0;
  for (const side of SIDES) {
    const fr = frame(bent, side);
    for (const f of LONG) {
      const p = hu.getNormalizedBoneNode(`${side}${f}Proximal` as VRMHumanBoneName)!, d = hu.getNormalizedBoneNode(`${side}${f}Distal` as VRMHumanBoneName)!;
      const seg = d.getWorldPosition(new THREE.Vector3()).sub(p.getWorldPosition(new THREE.Vector3())).normalize();
      worst = Math.max(worst, Math.asin(Math.min(1, Math.abs(seg.dot(fr.palm)))) / DEG);
    }
    const m = hu.getNormalizedBoneNode(`${side}ThumbMetacarpal`)!, tip = bent.tips.get(`${side}Thumb`)!;
    const t = tip.getWorldPosition(new THREE.Vector3()).sub(m.getWorldPosition(new THREE.Vector3())).normalize();
    const want = new THREE.Vector3(side === "left" ? 1 : -1, 0, 1).normalize();
    thumbOff = Math.max(thumbOff, Math.acos(Math.min(1, t.dot(want))) / DEG);
  }
  check(worst < 1.5, `mano de funda, estirada: los dedos rectos, en el plano de la palma (lo peor, ${worst.toFixed(1)}°)`);
  check(thumbOff < 1.5, `mano de funda, estirada: el pulgar a 45° hacia delante (${thumbOff.toFixed(1)}° de diferencia)`);
}
shapesOn(bent, "mano de funda");
for (const shape of ["relaxed", "grip", "fist", "open"] as const) {
  // Con el arreglo, cada forma deja cada falange donde en la mano recta (los huesos miden lo mismo).
  const a = pose(straight, shape), b = pose(bent, shape);
  let d = 0;
  for (const [k, v] of a) d = Math.max(d, v.distanceTo(b.get(k)!));
  check(d < 0.001, `mano de funda, ${shape}: las puntas, donde en la mano recta (${mm(d)})`);
}
{
  // Sin el arreglo (como iban las fundas): el puño no cierra igual (el pulgar, por debajo).
  const a = pose(straight, "fist"), b = pose(bent, "fist", false);
  check(a.get("leftThumb")!.distanceTo(b.get("leftThumb")!) > 0.02, `mano de funda sin arreglo: el pulgar del puño, en otro sitio (${mm(a.get("leftThumb")!.distanceTo(b.get("leftThumb")!))})`);
}

/* ------------------------------------------------------------------ */
/* VRM 0.x: lo mismo, mirando hacia el otro lado                         */
/* ------------------------------------------------------------------ */

for (const [name, bend, thumb] of [["recta", [0, 0], STRAIGHT_THUMB], ["de funda", [20, 18], FUNDA_THUMB]] as const) {
  const v1 = handOf(rig(bend as [number, number], thumb, false).humanoid, false);
  const v0 = handOf(rig(bend as [number, number], thumb, true).humanoid, true);
  let d = 0;
  for (const shape of ["relaxed", "fist", "grip"] as const) {
    const a = pose(v1, shape), b = pose(v0, shape);
    // El de VRM 0.x, girado media vuelta, tiene que caer donde el de VRM 1.
    for (const [k, v] of a) {
      const w = b.get(k)!;
      d = Math.max(d, v.distanceTo(new THREE.Vector3(-w.x, w.y, -w.z)));
    }
  }
  check(d < 0.001, `VRM 0.x, mano ${name}: cada forma, como en VRM 1 girado media vuelta (${mm(d)})`);
}

/* ------------------------------------------------------------------ */
/* Con el animador: la mano de base y el arreglo, sin acumularse         */
/* ------------------------------------------------------------------ */

{
  const { VrmAnimator } = await import("../src/world/animation.ts");
  const vrm = rig([20, 18], FUNDA_THUMB, false);
  const anim = new VrmAnimator(vrm);
  // Sin clips (en Node no se cargan): solo la mano de base, que pasa a la relajada en una décima.
  for (let i = 0; i < 40; i++) anim.update(1 / 60, 0, false, null);
  const node = (b: string) => vrm.humanoid.getNormalizedBoneNode(b as VRMHumanBoneName)!;
  const want = new Map<string, THREE.Quaternion>();
  const fix = new Map(restFix(vrm.humanoid, false).map((f) => [f.node, f]));
  for (const b of FINGER_BONES.left) {
    const q = handTable("relaxed").get(b)!.clone(), f = fix.get(node(b));
    want.set(b, f ? q.premultiply(f.pre).multiply(f.post) : q);
  }
  const err = () => Math.max(...FINGER_BONES.left.map((b) => node(b).quaternion.angleTo(want.get(b)!) / DEG));
  const first = err();
  for (let i = 0; i < 120; i++) anim.update(1 / 60, 0, false, null);
  check(first < 0.5 && err() < 0.5, `animador: relajada y arreglada (${first.toFixed(2)}°) y, dos segundos después, igual (${err().toFixed(2)}°: no se acumula)`);
  anim.dispose();
}

console.log(fails ? `\n${fails} comprobaciones fallan` : "\nTodo bien");
process.exit(fails ? 1 : 0);
