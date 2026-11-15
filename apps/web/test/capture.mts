/**
 * Prueba de los gestos desde un vídeo (src/capture/) sin navegador ni vídeo, con los esqueletos de los
 * personajes de serie y clips de verdad: de un personaje haciendo un clip se sacan los puntos que daría
 * MediaPipe de una persona haciéndolo (el cuerpo, en metros desde las caderas y con los ejes de la
 * imagen; y las manos, cada una sobre su centro), se pasan a otro personaje (capture/retarget.ts) y se
 * comprueba que hace lo mismo:
 *
 * - cada tramo del cuerpo (brazos, antebrazos, muslos, piernas, la línea de los hombros y la de las
 *   caderas) apunta adonde apuntaba, la cabeza mira adonde miraba y cada palma y cada falange de los
 *   dedos, también; en el mismo personaje y en otro de otras medidas;
 * - con la persona de lado respecto a la cámara (se pone de frente), con una cámara frontal (en
 *   espejo: sale igual), sin ver las manos (la palma, de los puntos del cuerpo; los dedos, relajados) y
 *   con ruido (lo suavizado tiembla menos y se acerca más);
 * - solo de cintura para arriba: las piernas, en reposo; pisa el suelo; en bucle, acaba como empieza;
 * - el .vrma lo lee el cargador del juego y da los mismos giros (y su ficha va y vuelve); el .bvh trae
 *   la jerarquía entera y, por fotograma, todos sus canales.
 *
 *   npm run test:capture -w @xenxo/web          (PRINT=1: además, los errores de cada caso)
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, type VRMAnimation } from "@pixiv/three-vrm-animation";
import { LM, retarget, twistAbout, type CaptureFrame, type Motion, type RetargetOptions, type V3 } from "../src/capture/retarget.ts";
import { buildGesture, buildGuard } from "../src/world/people/gestures.ts";
import { restOf } from "../src/capture/rest.ts";
import { readMeta, writeBvh, writeVrma, type GestureMeta } from "../src/capture/files.ts";

const quiet = console.error;
console.error = (...a: unknown[]) => (String(a[0]).includes("Couldn't load texture") ? undefined : quiet(...a));
console.warn = () => {};
const PRINT = !!process.env.PRINT;

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};
const DEG = Math.PI / 180;
const deg = (x: number) => `${(x / DEG).toFixed(1)}°`;

/* ------------------------------------------------------------------ */
/* Cargar                                                               */
/* ------------------------------------------------------------------ */

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
const asBuffer = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const vrmLoader = new GLTFLoader();
vrmLoader.register((p) => new VRMLoaderPlugin(p));
const animLoader = new GLTFLoader();
animLoader.register((p) => new VRMAnimationLoaderPlugin(p));

const presets = JSON.parse(readFileSync(new URL("../src/world/avatar-presets.json", import.meta.url), "utf8")) as { id: string; hash: string }[];
async function vrmOf(id: string): Promise<VRM> {
  const hash = presets.find((p) => p.id === id)!.hash;
  const file = readFileSync(new URL(`../../realtime/seed-assets/s/${hash.split(":")[1]}.glb`, import.meta.url));
  const g = await new Promise<{ userData: { vrm: VRM } }>((ok, ko) => vrmLoader.parse(withoutTextures(file), "", ok as never, ko));
  g.userData.vrm.scene.updateMatrixWorld(true);
  return g.userData.vrm;
}
async function parseVrma(bytes: ArrayBuffer): Promise<VRMAnimation> {
  const g = await new Promise<{ userData: { vrmAnimations: VRMAnimation[] } }>((ok, ko) => animLoader.parse(bytes, "", ok as never, ko));
  return g.userData.vrmAnimations[0]!;
}
const fromFile = (name: string) => parseVrma(asBuffer(readFileSync(new URL(`../public/anims/${name}.vrma`, import.meta.url))));
const idle = await fromFile("idle"), jab = await fromFile("punch_jab");
const sources = { idle, guard: buildGuard(idle, jab), jab };
/** Un clip de la biblioteca o un gesto hecho en código (people/gestures.ts: con sus manos de verdad). */
async function clip(name: string): Promise<VRMAnimation> {
  return name.startsWith("g:") ? buildGesture(name.slice(2), sources)! : fromFile(name);
}

/* ------------------------------------------------------------------ */
/* Lo que vería MediaPipe                                               */
/* ------------------------------------------------------------------ */

const node = (vrm: VRM, b: string) => vrm.humanoid.getNormalizedBoneNode(b as VRMHumanBoneName);
const wpos = (vrm: VRM, b: string) => node(vrm, b)!.getWorldPosition(new THREE.Vector3());
const wquat = (vrm: VRM, b: string) => node(vrm, b)!.getWorldQuaternion(new THREE.Quaternion());

/** Los puntos de la cara, sobre el hueso de la cabeza (m; la cabeza recta: los ojos algo por encima de las orejas). */
const HEAD_PTS: Record<number, V3> = {
  0: [0, 0.05, 0.11],
  1: [0.018, 0.075, 0.095], 2: [0.032, 0.075, 0.09], 3: [0.046, 0.075, 0.082],
  4: [-0.018, 0.075, 0.095], 5: [-0.032, 0.075, 0.09], 6: [-0.046, 0.075, 0.082],
  7: [0.075, 0.058, -0.005], 8: [-0.075, 0.058, -0.005],
  9: [0.025, 0.02, 0.1], 10: [-0.025, 0.02, 0.1],
};
/** Los del cuerpo que son un hueso. */
const BODY_PTS: Record<number, string> = {
  11: "leftUpperArm", 12: "rightUpperArm", 13: "leftLowerArm", 14: "rightLowerArm", 15: "leftHand", 16: "rightHand",
  17: "leftLittleProximal", 18: "rightLittleProximal", 19: "leftIndexProximal", 20: "rightIndexProximal", 21: "leftThumbProximal", 22: "rightThumbProximal",
  23: "leftUpperLeg", 24: "rightUpperLeg", 25: "leftLowerLeg", 26: "rightLowerLeg", 27: "leftFoot", 28: "rightFoot",
};
const FINGER_CHAINS: [string, string[]][] = [
  ["Thumb", ["Metacarpal", "Proximal", "Distal"]],
  ["Index", ["Proximal", "Intermediate", "Distal"]],
  ["Middle", ["Proximal", "Intermediate", "Distal"]],
  ["Ring", ["Proximal", "Intermediate", "Distal"]],
  ["Little", ["Proximal", "Intermediate", "Distal"]],
];
const PAIRS: [number, number][] = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
const SWAP = new Map<number, number>();
for (const [a, b] of PAIRS) SWAP.set(a, b), SWAP.set(b, a);

interface Watch {
  /** Sin ver las manos, el espejo de una cámara frontal y el ruido (m, por coordenada). */
  noHands?: boolean;
  mirror?: boolean;
  noise?: number;
}

/** Un ruido gaussiano que se repite (la misma prueba, los mismos números). */
function gauss(seed: number) {
  let s = seed >>> 0;
  const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 1) / 4294967297;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** Lo que daría MediaPipe del personaje tal como está ahora (las coordenadas de la imagen, desde las caderas). */
function watch(vrm: VRM, t: number, w: Watch, noise: () => number): CaptureFrame {
  vrm.scene.updateMatrixWorld(true);
  const rest = vrm.humanoid.normalizedRestPose;
  const at = (b: string) => new THREE.Vector3().fromArray(rest[b as VRMHumanBoneName]!.position!);
  const world: THREE.Vector3[] = new Array(33);
  const head = node(vrm, "head")!;
  for (const [k, p] of Object.entries(HEAD_PTS)) world[+k] = head.localToWorld(new THREE.Vector3(...p));
  for (const [k, b] of Object.entries(BODY_PTS)) world[+k] = wpos(vrm, b);
  // El talón y la punta del pie, en el suelo en reposo y a lo largo de la planta.
  for (const [side, heelK, tipK] of [["left", 29, 31], ["right", 30, 32]] as const) {
    const foot = at(`${side}Foot`), toes = at(`${side}Toes`);
    const sole = toes.clone().sub(foot).setY(0);
    const len = sole.length();
    sole.normalize();
    const heel = new THREE.Vector3(foot.x, 0, foot.z).addScaledVector(sole, -0.05);
    const tip = new THREE.Vector3(foot.x, 0, foot.z).addScaledVector(sole, len + 0.04);
    world[heelK] = node(vrm, `${side}Foot`)!.localToWorld(heel.sub(foot));
    world[tipK] = node(vrm, `${side}Toes`)!.localToWorld(tip.sub(toes));
  }
  const c = world[LM.lHip]!.clone().add(world[LM.rHip]!).multiplyScalar(0.5);
  const sx = w.mirror ? -1 : 1;
  const cam = (p: THREE.Vector3, at0: THREE.Vector3): V3 => [sx * (p.x - at0.x) + (w.noise ? noise() * w.noise : 0), -(p.y - at0.y) + (w.noise ? noise() * w.noise : 0), -(p.z - at0.z) + (w.noise ? noise() * w.noise : 0)];
  // En espejo, quien mira la imagen ve a la persona con los lados cambiados: MediaPipe también.
  const pose: V3[] = new Array(33);
  for (let k = 0; k < 33; k++) {
    const src = w.mirror ? (SWAP.get(k) ?? k) : k;
    pose[k] = world[src] ? cam(world[src]!, c) : [0, 0, 0];
  }
  const hands: CaptureFrame["hands"] = [];
  if (!w.noHands) {
    for (const side of [0, 1] as const) {
      const name = side ? "right" : "left";
      const pts: THREE.Vector3[] = [wpos(vrm, `${name}Hand`)];
      for (const [finger, parts] of FINGER_CHAINS) {
        for (const p of parts) pts.push(wpos(vrm, `${name}${finger}${p}`));
        // La punta: más allá de la última falange, como la anterior.
        const d = at(`${name}${finger}${parts[2]}`).sub(at(`${name}${finger}${parts[1]}`)).multiplyScalar(0.8);
        pts.push(node(vrm, `${name}${finger}${parts[2]}`)!.localToWorld(d));
      }
      const mid = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
      const k = (w.noise ?? 0) * 0.4;
      hands.push({ side: (w.mirror ? 1 - side : side) as 0 | 1, world: pts.map((p) => cam(p, mid).map((x) => x + (k ? noise() * k : 0)) as V3) });
    }
  }
  return { t, pose, hands };
}

/* ------------------------------------------------------------------ */
/* Medir                                                                */
/* ------------------------------------------------------------------ */

const LIMBS: [string, string][] = [
  ["leftUpperArm", "leftLowerArm"], ["leftLowerArm", "leftHand"], ["rightUpperArm", "rightLowerArm"], ["rightLowerArm", "rightHand"],
  ["leftUpperLeg", "leftLowerLeg"], ["leftLowerLeg", "leftFoot"], ["rightUpperLeg", "rightLowerLeg"], ["rightLowerLeg", "rightFoot"],
];
const LINES: [string, string][] = [["rightUpperArm", "leftUpperArm"], ["rightUpperLeg", "leftUpperLeg"]];

interface Look {
  arms: THREE.Vector3[];
  legs: THREE.Vector3[];
  lines: THREE.Vector3[];
  head: THREE.Vector3[];
  palms: THREE.Vector3[];
  fingers: THREE.Vector3[];
  /** Lo más bajo de los pies (m). */
  low: number;
}

/** Hacia dónde mira la palma de la mano en reposo (de su esqueleto). */
function restPalm(vrm: VRM, side: string) {
  const r = vrm.humanoid.normalizedRestPose;
  const v = (b: string) => new THREE.Vector3().fromArray(r[b as VRMHumanBoneName]!.position!);
  const fingers = v(`${side}MiddleProximal`).normalize();
  const across = v(`${side}IndexProximal`).sub(v(`${side}LittleProximal`));
  return side === "right" ? new THREE.Vector3().crossVectors(across, fingers).normalize() : new THREE.Vector3().crossVectors(fingers, across).normalize();
}

/** Cómo está el personaje: hacia dónde va cada tramo (girado `-yaw`: de frente). */
function look(vrm: VRM, yaw: number): Look {
  vrm.scene.updateMatrixWorld(true);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
  const dir = (a: string, b: string) => wpos(vrm, b).sub(wpos(vrm, a)).normalize().applyQuaternion(q);
  const out: Look = { arms: [], legs: [], lines: [], head: [], palms: [], fingers: [], low: Infinity };
  LIMBS.forEach(([a, b], i) => (i < 4 ? out.arms : out.legs).push(dir(a, b)));
  for (const [a, b] of LINES) out.lines.push(dir(a, b));
  const hq = wquat(vrm, "head").premultiply(q);
  out.head.push(new THREE.Vector3(0, 0, 1).applyQuaternion(hq), new THREE.Vector3(1, 0, 0).applyQuaternion(hq));
  for (const side of ["left", "right"]) {
    out.palms.push(restPalm(vrm, side).applyQuaternion(wquat(vrm, `${side}Hand`).premultiply(q)));
    for (const [finger, parts] of FINGER_CHAINS) for (let j = 0; j < 2; j++) out.fingers.push(dir(`${side}${finger}${parts[j]}`, `${side}${finger}${parts[j + 1]}`));
  }
  for (const b of ["leftFoot", "rightFoot", "leftToes", "rightToes"]) if (node(vrm, b)) out.low = Math.min(out.low, wpos(vrm, b).y);
  return out;
}

/** Hacia dónde mira de media la cadera en una serie de fotogramas (rad alrededor de y), como en retarget.ts. */
function facing(vrm: VRM, pose: (i: number) => void, n: number) {
  let sx = 0, sz = 0;
  for (let i = 0; i < n; i++) {
    pose(i);
    vrm.scene.updateMatrixWorld(true);
    const f = wpos(vrm, "leftUpperLeg").sub(wpos(vrm, "rightUpperLeg")).cross(new THREE.Vector3(0, 1, 0));
    if (f.lengthSq() > 1e-8) f.normalize(), (sx += f.x), (sz += f.z);
  }
  return Math.atan2(sx, sz);
}

/** Pone un fotograma del movimiento en el personaje (los huesos normalizados, como el clip del juego). */
function apply(vrm: VRM, fr: Motion["frames"][number]) {
  for (const [b, r] of Object.entries(fr.rot)) node(vrm, b)?.quaternion.set(...r);
  node(vrm, "hips")!.position.set(...fr.hips);
  vrm.scene.updateMatrixWorld(true);
}

interface Errors {
  arms: number[];
  legs: number[];
  lines: number[];
  head: number[];
  palms: number[];
  fingers: number[];
}
const angle = (a: THREE.Vector3, b: THREE.Vector3) => Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
function compare(a: Look, b: Look, e: Errors) {
  for (const k of ["arms", "legs", "lines", "head", "palms", "fingers"] as const) a[k].forEach((v, i) => e[k].push(angle(v, b[k][i]!)));
}
const worst = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/* ------------------------------------------------------------------ */
/* Un caso: un clip en un personaje, visto y pasado a otro               */
/* ------------------------------------------------------------------ */

const FPS = 30;

interface Case {
  clip: string;
  from: VRM;
  to: VRM;
  /** La persona girada respecto a la cámara (rad). */
  yaw?: number;
  watch?: Watch;
  opts?: Partial<RetargetOptions>;
  seconds?: number;
}

async function run(c: Case) {
  const anim = await clip(c.clip);
  const mixer = new THREE.AnimationMixer(c.from.scene);
  const action = mixer.clipAction(createVRMAnimationClip(anim, c.from));
  action.play();
  const n = Math.max(2, Math.floor(Math.min(c.seconds ?? 3, anim.duration) * FPS));
  c.from.scene.rotation.y = c.yaw ?? 0;
  const poseAt = (i: number) => {
    mixer.setTime(i / FPS);
    c.from.scene.updateMatrixWorld(true);
  };
  const noise = gauss(7);
  const frames: CaptureFrame[] = [];
  for (let i = 0; i < n; i++) {
    poseAt(i);
    frames.push(watch(c.from, i / FPS, c.watch ?? {}, noise));
  }
  const yaw = facing(c.from, poseAt, n);
  const truth: Look[] = [];
  for (let i = 0; i < n; i++) {
    poseAt(i);
    truth.push(look(c.from, yaw));
  }
  c.from.scene.rotation.y = 0;
  mixer.stopAllAction();
  mixer.uncacheRoot(c.from.scene);
  const motion = retarget(frames, restOf(c.to), { fps: FPS, smooth: 0, ...c.opts, mirror: !!c.watch?.mirror });
  const got: Look[] = motion.frames.map((fr) => {
    apply(c.to, fr);
    return look(c.to, 0);
  });
  c.to.humanoid.resetNormalizedPose();
  const e: Errors = { arms: [], legs: [], lines: [], head: [], palms: [], fingers: [] };
  for (let i = 0; i < n; i++) compare(truth[i]!, got[i]!, e);
  if (PRINT) console.log(`    ${c.clip}: brazos ${deg(worst(e.arms))}, piernas ${deg(worst(e.legs))}, hombros/caderas ${deg(worst(e.lines))}, cabeza ${deg(worst(e.head))}, palmas ${deg(worst(e.palms))}, dedos ${deg(worst(e.fingers))} (media ${deg(mean(e.fingers))})`);
  return { e, motion, truth, got };
}

/* ------------------------------------------------------------------ */
/* Las pruebas                                                          */
/* ------------------------------------------------------------------ */

const kai = await vrmOf("kai");
const mar = await vrmOf("mar");
const leo = await vrmOf("leo");
console.log(`personajes: kai, mar y leo (alturas de la cadera ${[kai, mar, leo].map((v) => v.humanoid.normalizedRestPose.hips!.position![1]!.toFixed(2)).join(", ")} m)`);

console.log("\nEl mismo movimiento, en el mismo personaje y en otro:");
for (const name of ["dance", "fold_arms", "punch_cross", "crouch_idle", "g:shrug", "g:wave", "g:beckon"]) {
  for (const [from, to, who] of [[kai, kai, "kai → kai"], [kai, mar, "kai → mar"], [leo, kai, "leo → kai"]] as const) {
    const { e } = await run({ clip: name, from, to });
    check(worst(e.arms) < 1 * DEG && worst(e.legs) < 1 * DEG, `${name}, ${who}: brazos y piernas, adonde iban (lo peor, ${deg(Math.max(worst(e.arms), worst(e.legs)))})`);
    check(worst(e.lines) < 1 * DEG && worst(e.head) < 1 * DEG, `${name}, ${who}: hombros, caderas y cabeza (${deg(Math.max(worst(e.lines), worst(e.head)))})`);
    check(worst(e.palms) < 1 * DEG && worst(e.fingers) < 1.5 * DEG, `${name}, ${who}: las palmas y los dedos (${deg(worst(e.palms))}, ${deg(worst(e.fingers))})`);
  }
}

console.log("\nEl antebrazo, sin retorcerse:");
for (const name of ["g:shrug", "g:beckon", "g:wave", "dance", "fold_arms"]) {
  const { motion } = await run({ clip: name, from: kai, to: mar, opts: { smooth: 1.2 } });
  let most = 0, step = 0, wrist = 0;
  const prev: number[] = [0, 0];
  motion.frames.forEach((fr, i) => {
    ["left", "right"].forEach((side, k) => {
      const ax = new THREE.Vector3(...motion.bones.find((b) => b.name === `${side}Hand`)!.offset).normalize();
      const lower = twistAbout(new THREE.Quaternion(...fr.rot[`${side}LowerArm`]!), ax);
      const hand = twistAbout(new THREE.Quaternion(...fr.rot[`${side}Hand`]!), ax);
      most = Math.max(most, Math.abs(lower));
      wrist = Math.max(wrist, Math.abs(hand));
      if (i) step = Math.max(step, Math.abs(lower - prev[k]!));
      prev[k] = lower;
    });
  });
  check(most < 125 * DEG && wrist < 85 * DEG && step < 25 * DEG, `${name}: lo que gira el antebrazo (hasta ${deg(most)}) y la muñeca (${deg(wrist)}), sin saltos (${deg(step)} en un fotograma)`);
}

console.log("\nDe lado, en espejo y sin ver las manos:");
{
  const { e } = await run({ clip: "dance", from: kai, to: mar, yaw: 50 * DEG });
  check(worst(e.arms) < 1 * DEG && worst(e.lines) < 1 * DEG && worst(e.palms) < 1 * DEG, `girada 50° respecto a la cámara: de frente y lo mismo (${deg(Math.max(worst(e.arms), worst(e.lines), worst(e.palms)))})`);
}
{
  const a = await run({ clip: "dance", from: kai, to: mar });
  const b = await run({ clip: "dance", from: kai, to: mar, watch: { mirror: true } });
  let d = 0;
  a.motion.frames.forEach((fr, i) => {
    for (const [k, r] of Object.entries(fr.rot)) d = Math.max(d, 2 * Math.acos(Math.min(1, Math.abs(new THREE.Quaternion(...r).dot(new THREE.Quaternion(...b.motion.frames[i]!.rot[k]!))))));
  });
  check(d < 0.2 * DEG, `con una cámara frontal (en espejo): el mismo movimiento (lo que más cambia un hueso, ${deg(d)})`);
}
{
  const { e } = await run({ clip: "fold_arms", from: kai, to: mar, watch: { noHands: true } });
  check(worst(e.arms) < 1 * DEG, `sin ver las manos: los brazos, igual (${deg(worst(e.arms))})`);
  check(worst(e.palms) < 25 * DEG, `y la palma, de los puntos del cuerpo (${deg(worst(e.palms))}, de media ${deg(mean(e.palms))})`);
}
{
  // Las manos se ven a ratos: los dedos van a la mano relajada y vuelven sin saltos.
  const anim = await clip("dance");
  const mixer = new THREE.AnimationMixer(kai.scene);
  mixer.clipAction(createVRMAnimationClip(anim, kai)).play();
  const noise = gauss(3);
  const frames: CaptureFrame[] = [];
  for (let i = 0; i < 90; i++) {
    mixer.setTime(i / FPS);
    frames.push(watch(kai, i / FPS, { noHands: i >= 30 && i < 60 }, noise));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(kai.scene);
  kai.humanoid.resetNormalizedPose();
  const m = retarget(frames, restOf(mar), { fps: FPS, smooth: 0 });
  // Lo que se mueve cada falange en un fotograma, frente a lo que va de la mano vista a la relajada.
  const turn = (a: number[], b: number[]) => 2 * Math.acos(Math.min(1, Math.abs(new THREE.Quaternion(...a).dot(new THREE.Quaternion(...b)))));
  let ratio = 0, total = 0;
  for (const b of ["leftIndexProximal", "leftIndexIntermediate", "rightMiddleProximal"]) {
    const all = turn(m.frames[25]!.rot[b]!, m.frames[45]!.rot[b]!);
    total = Math.max(total, all);
    for (let i = 1; i < m.frames.length; i++) ratio = Math.max(ratio, turn(m.frames[i - 1]!.rot[b]!, m.frames[i]!.rot[b]!) / Math.max(all, 10 * DEG));
  }
  check(total > 20 * DEG && ratio < 0.2, `las manos a ratos: los dedos pasan a relajados y vuelven poco a poco (en un fotograma, como mucho el ${(ratio * 100).toFixed(0)} % de los ${deg(total)})`);
}

console.log("\nCon ruido:");
{
  const raw = await run({ clip: "dance", from: kai, to: mar, watch: { noise: 0.012 }, opts: { smooth: 0 } });
  const soft = await run({ clip: "dance", from: kai, to: mar, watch: { noise: 0.012 }, opts: { smooth: 1.2 } });
  const shake = (r: typeof raw) => {
    let s = 0;
    for (let i = 2; i < r.got.length; i++)
      for (let k = 0; k < 4; k++) {
        const a = r.got[i - 2]!.arms[k]!, b = r.got[i - 1]!.arms[k]!, c = r.got[i]!.arms[k]!;
        s += b.clone().multiplyScalar(2).sub(a).sub(c).length();
      }
    return s / (r.got.length - 2);
  };
  check(shake(soft) < shake(raw) * 0.6, `suavizado, tiembla menos (${(shake(soft) * 1000).toFixed(1)} frente a ${(shake(raw) * 1000).toFixed(1)})`);
  check(mean(soft.e.arms) < mean(raw.e.arms), `y se acerca más a lo de verdad (de media ${deg(mean(soft.e.arms))} frente a ${deg(mean(raw.e.arms))})`);
}

console.log("\nDe cintura para arriba, el suelo y el bucle:");
{
  const { e, motion } = await run({ clip: "fold_arms", from: kai, to: mar, opts: { upper: true } });
  check(worst(e.arms) < 1 * DEG, `de cintura para arriba: los brazos, igual (${deg(worst(e.arms))})`);
  const still = motion.frames.every((fr) => ["hips", "leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg"].every((b) => Math.abs(fr.rot[b]![3]) > 0.99999));
  check(still, "y la cadera y las piernas, en reposo");
}
{
  const { motion, got } = await run({ clip: "crouch_idle", from: kai, to: mar, opts: { ground: true } });
  const restLow = Math.min(...["leftFoot", "rightFoot", "leftToes", "rightToes"].map((b) => {
    let y = 0;
    for (let n: string | null = b; n; n = motion.bones.find((x) => x.name === n)?.parent ?? null) y += motion.bones.find((x) => x.name === n)!.offset[1];
    return y;
  }));
  const off = Math.max(...got.map((g) => Math.abs(g.low - restLow)));
  check(off < 0.02, `agachado, pisa el suelo (lo que más se separa, ${(off * 100).toFixed(1)} cm)`);
  const hipsY = motion.frames.map((f) => f.hips[1]);
  check(Math.max(...hipsY) < mar.humanoid.normalizedRestPose.hips!.position![1]! - 0.1, `con la cadera abajo (${Math.min(...hipsY).toFixed(2)}-${Math.max(...hipsY).toFixed(2)} m)`);
}
{
  const { motion } = await run({ clip: "dance", from: kai, to: mar, opts: { loop: true } });
  const a = motion.frames[0]!, b = motion.frames[motion.frames.length - 1]!;
  let d = 0;
  for (const [k, r] of Object.entries(a.rot)) d = Math.max(d, 2 * Math.acos(Math.min(1, Math.abs(new THREE.Quaternion(...r).dot(new THREE.Quaternion(...b.rot[k]!))))));
  check(d < 0.5 * DEG, `en bucle, acaba como empieza (${deg(d)})`);
}

console.log("\nLos archivos:");
{
  const { motion } = await run({ clip: "dance", from: kai, to: mar, opts: { ground: true } });
  const meta: GestureMeta = { id: "baile_prueba", es: "Baile de prueba", en: "Test dance", once: false, upper: false, overlay: false, fingers: true };
  const bytes = writeVrma(motion, meta);
  const back = readMeta(bytes);
  check(JSON.stringify(back) === JSON.stringify(meta), "la ficha del gesto va y vuelve");
  check(readMeta(writeVrma(motion, { ...meta, id: "Mal Nombre" })) === null, "y un nombre que no vale no se lee");
  const anim = await parseVrma(asBuffer(bytes));
  let d = 0, dp = 0;
  for (const [bone, track] of anim.humanoidTracks.rotation) {
    const v = track.values;
    motion.frames.forEach((fr, i) => {
      const r = fr.rot[bone]!;
      d = Math.max(d, Math.abs(v[i * 4]! - r[0]) + Math.abs(v[i * 4 + 1]! - r[1]) + Math.abs(v[i * 4 + 2]! - r[2]) + Math.abs(v[i * 4 + 3]! - r[3]));
    });
  }
  const tr = anim.humanoidTracks.translation.get("hips")!;
  motion.frames.forEach((fr, i) => (dp = Math.max(dp, Math.abs(tr.values[i * 3 + 1]! - fr.hips[1]))));
  check(d < 1e-5 && dp < 1e-5 && anim.humanoidTracks.rotation.size === motion.bones.length, `el .vrma lo lee el cargador del juego con los mismos giros (${anim.humanoidTracks.rotation.size} huesos)`);
  check(Math.abs(anim.duration - motion.frames[motion.frames.length - 1]!.t) < 1e-4, `y dura lo mismo (${anim.duration.toFixed(2)} s)`);
  // En otro personaje, por el camino del juego (createVRMAnimationClip): lo mismo que puesto a mano en ese.
  const mixer = new THREE.AnimationMixer(leo.scene);
  const act = mixer.clipAction(createVRMAnimationClip(anim, leo));
  act.setLoop(THREE.LoopOnce, 1);
  act.clampWhenFinished = true;
  act.play();
  const last = motion.frames.length - 1;
  const at = [0, Math.round(last / 3), last];
  const viaClip = at.map((i) => {
    mixer.setTime(motion.frames[i]!.t);
    return look(leo, 0);
  });
  mixer.stopAllAction();
  mixer.uncacheRoot(leo.scene);
  let dd = 0;
  at.forEach((i, j) => {
    apply(leo, motion.frames[i]!);
    const byHand = look(leo, 0);
    for (const k of ["arms", "legs", "palms", "fingers"] as const) byHand[k].forEach((v, x) => (dd = Math.max(dd, angle(v, viaClip[j]![k][x]!))));
  });
  leo.humanoid.resetNormalizedPose();
  check(dd < 0.1 * DEG, `y en otro personaje, por el camino del juego, igual (${deg(dd)})`);
  const bvh = writeBvh(motion);
  const lines = bvh.trim().split("\n");
  const joints = lines.filter((l) => /^\s*(ROOT|JOINT) /.test(l)).length;
  const channels = lines.filter((l) => /CHANNELS/.test(l)).reduce((s, l) => s + Number(l.trim().split(/\s+/)[1]), 0);
  const start = lines.findIndex((l) => l.startsWith("Frame Time")) + 1;
  const rows = lines.slice(start);
  check(joints === motion.bones.length && channels === 6 + 3 * (motion.bones.length - 1), `el .bvh, con todos los huesos (${joints}) y sus canales (${channels})`);
  check(rows.length === motion.frames.length && rows.every((r) => r.trim().split(/\s+/).length === channels), `y un fotograma por línea con todos (${rows.length})`);

  // Lo que dice `npm run gesture:add -- … --check` (sin tocar nada) de uno bueno y de los que no valen.
  const add = fileURLToPath(new URL("../../../tools/gestures/add.mjs", import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), "gesto-"));
  const ask = (name: string, bytes: Uint8Array) => {
    const file = join(tmp, `${name}.vrma`);
    writeFileSync(file, bytes);
    return spawnSync(process.execPath, [add, file, "--check"], { encoding: "utf8" });
  };
  const ok = ask("bueno", bytes);
  check(ok.status === 0 && ok.stdout.includes("baile_prueba"), `gesture:add lo acepta (${ok.stdout.trim().split("\n")[0]})`);
  const taken = ask("ocupado", writeVrma(motion, { ...meta, id: "wave" }));
  const clipName = ask("clip", writeVrma(motion, { ...meta, id: "walk" }));
  const parkour = ask("parkour", writeVrma(motion, { ...meta, id: "pk_baile" }));
  const bare = ask("sin_ficha", writeVrma(motion));
  check(taken.status === 1 && clipName.status === 1 && parkour.status === 1 && bare.status === 1, "y no acepta un nombre que ya usa otro gesto o clip, ni uno del parkour, ni uno sin su ficha");
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fails ? `\n${fails} comprobaciones fallan` : "\nTodo bien");
process.exit(fails ? 1 : 0);
