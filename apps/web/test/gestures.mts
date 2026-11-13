/**
 * Prueba de los gestos hechos en código sin navegador (world/people/gestures.ts), con los esqueletos
 * de los personajes de serie de verdad y los clips de verdad (el reposo, la guardia):
 *
 * - los que son en espejo (aplaudir, encogerse de hombros, animar…) dejan las dos manos en espejo: la
 *   misma orientación de la palma a los dos lados;
 * - aplaudir: las palmas se encuentran delante del pecho, una frente a la otra, sin atravesarse, con
 *   los dedos hacia delante y arriba, y se separan entre palmada y palmada; dónde se tocan lo ajusta
 *   el esqueleto a cada personaje (rig.ts → `touch`), y sin él la misma pose no vale para todos;
 * - cada mano mira hacia donde tiene que mirar: saludar, con la palma hacia delante; encogerse de
 *   hombros y llamar con la mano, con la palma hacia arriba; empujar, con la palma hacia delante…;
 * - ningún brazo se retuerce: lo que gira el antebrazo con la mano y lo que se dobla la muñeca, en
 *   todos los fotogramas de todos los gestos, dentro de lo que puede un brazo;
 * - en pareja (chocar los cinco, darse la mano, abrazarse), con dos personajes de tamaños distintos:
 *   la misma distancia desde los dos lados, las palmas que se tocan (de frente, sin atravesarse ni
 *   quedarse cortas), en el abrazo cada palma apoyada en el tronco de la otra persona y, a cada lado,
 *   un brazo encima del otro; ningún brazo atraviesa a la otra persona; y quien se acerca llega a su
 *   distancia a tiempo y sin pasarse, a cualquier tasa de imágenes;
 * - el teléfono queda en la mano derecha, junto a la oreja y con la pantalla hacia la cara.
 *
 *   npm run test:gestures -w @xenxo/web          (PRINT=1: además, dónde queda cada mano)
 */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, type VRMAnimation } from "@pixiv/three-vrm-animation";
import { buildGesture, buildGuard, GESTURES } from "../src/world/people/gestures.ts";

// Sin navegador no hay imágenes: el cargador avisa y sigue sin texturas (aquí no hacen falta).
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
const cm = (x: number) => `${(x * 100).toFixed(1)} cm`;
const deg = (x: number) => `${(x / DEG).toFixed(0)}°`;

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
const asBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const vrmLoader = new GLTFLoader();
vrmLoader.register((p) => new VRMLoaderPlugin(p));
const animLoader = new GLTFLoader();
animLoader.register((p) => new VRMAnimationLoaderPlugin(p));

async function vrmOf(hash: string): Promise<VRM> {
  const file = readFileSync(new URL(`../../realtime/seed-assets/s/${hash.split(":")[1]}.glb`, import.meta.url));
  const g = await new Promise<{ userData: { vrm: VRM } }>((ok, ko) => vrmLoader.parse(withoutTextures(file), "", ok as never, ko));
  return g.userData.vrm;
}
async function clip(name: string): Promise<VRMAnimation> {
  const file = readFileSync(new URL(`../public/anims/${name}.vrma`, import.meta.url));
  const g = await new Promise<{ userData: { vrmAnimations: VRMAnimation[] } }>((ok, ko) => animLoader.parse(asBuffer(file), "", ok as never, ko));
  return g.userData.vrmAnimations[0]!;
}

const presets = JSON.parse(readFileSync(new URL("../src/world/avatar-presets.json", import.meta.url), "utf8")) as { id: string; hash: string }[];
const idle = await clip("idle");
const jab = await clip("punch_jab");
const guard = buildGuard(idle, jab);
const sources = { idle, guard, jab };

/* ------------------------------------------------------------------ */
/* Medir una mano                                                       */
/* ------------------------------------------------------------------ */

interface HandAt {
  /** El centro de la palma (entre la muñeca y la base de los dedos) y la muñeca. */
  palm: THREE.Vector3;
  wrist: THREE.Vector3;
  /** Hacia fuera de la palma, hacia donde apuntan los dedos y hacia el pulgar (unitarios). */
  normal: THREE.Vector3;
  fingers: THREE.Vector3;
  thumb: THREE.Vector3;
  /** Lo que mide la mano de la muñeca a la base del dedo corazón. */
  size: number;
}

/** Un personaje con un gesto puesto: dónde quedan sus manos en cada momento (en el marco de su pecho). */
class Posed {
  private mixer: THREE.AnimationMixer;
  private action: THREE.AnimationAction | null = null;
  constructor(readonly vrm: VRM) {
    this.mixer = new THREE.AnimationMixer(vrm.scene);
  }
  play(name: string) {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.vrm.scene);
    const anim = buildGesture(name, sources);
    if (!anim) throw new Error(`sin gesto ${name}`);
    this.action = this.mixer.clipAction(createVRMAnimationClip(anim, this.vrm));
    this.action.play();
    return anim.duration;
  }
  at(t: number) {
    this.action!.time = t;
    this.mixer.update(0);
    this.vrm.humanoid.normalizedHumanBonesRoot.updateMatrixWorld(true);
  }
  private node(b: string) {
    return this.vrm.humanoid.getNormalizedBoneNode(b as VRMHumanBoneName)!;
  }
  /** En el mundo (las parejas) y no en el marco de su pecho. */
  inWorld = false;
  /** Un punto o una dirección del mundo, en el marco del pecho (x a su izquierda, y arriba, z delante). */
  private toChest(v: THREE.Vector3, dir: boolean) {
    if (this.inWorld) return v;
    const chest = this.node("upperChest") ?? this.node("chest");
    const q = chest.getWorldQuaternion(new THREE.Quaternion()).invert();
    if (!dir) v.sub(chest.getWorldPosition(new THREE.Vector3()));
    return v.applyQuaternion(q);
  }
  /** Dónde está una articulación (en el marco del pecho). */
  joint(b: string) {
    return this.toChest(this.node(b).getWorldPosition(new THREE.Vector3()), false);
  }
  hand(side: "left" | "right"): HandAt {
    const rest = this.vrm.humanoid.normalizedRestPose;
    const P = (b: string) => new THREE.Vector3().fromArray(rest[`${side}${b}` as VRMHumanBoneName]!.position!);
    const along = P("MiddleProximal"), across = P("IndexProximal").sub(P("LittleProximal")).normalize();
    const size = along.length();
    along.normalize();
    const normal = along.clone().cross(across).normalize();
    if (side === "right") normal.negate();
    const hand = this.node(`${side}Hand`);
    const q = hand.getWorldQuaternion(new THREE.Quaternion());
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const mids = ["Index", "Middle", "Ring", "Little"].map((f) => this.node(`${side}${f}Proximal`).getWorldPosition(new THREE.Vector3()));
    const knuckles = mids.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / mids.length);
    const palm = wrist.clone().lerp(knuckles, 0.55);
    return {
      palm: this.toChest(palm, false),
      wrist: this.toChest(wrist, false),
      normal: this.toChest(normal.applyQuaternion(q), true),
      fingers: this.toChest(along.applyQuaternion(q), true),
      thumb: this.toChest(across.applyQuaternion(q), true),
      size,
    };
  }
}

const f3 = (v: THREE.Vector3) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
const show = (who: string, name: string, t: number, p: Posed) => {
  if (!PRINT) return;
  const l = p.hand("left"), r = p.hand("right");
  console.log(`    ${who} ${name} ${t.toFixed(2)} s · izq: palma ${f3(l.palm)} normal ${f3(l.normal)} dedos ${f3(l.fingers)} · der: palma ${f3(r.palm)} normal ${f3(r.normal)} dedos ${f3(r.fingers)}`);
};

/** Las dos manos en espejo (en x): la misma orientación de la palma y de los dedos a los dos lados. */
function mirrored(p: Posed) {
  const l = p.hand("left"), r = p.hand("right");
  const m = (v: THREE.Vector3) => new THREE.Vector3(-v.x, v.y, v.z);
  return Math.max(l.normal.angleTo(m(r.normal)), l.fingers.angleTo(m(r.fingers)));
}

/** Lo que gira el antebrazo con la mano (alrededor del antebrazo) y lo que se dobla la muñeca, en un brazo. */
function armOf(p: Posed, side: "left" | "right") {
  const node = (b: string) => p.vrm.humanoid.getNormalizedBoneNode(b as VRMHumanBoneName)!;
  const twistOf = (q: THREE.Quaternion) => {
    const w = q.w < 0 ? -q.w : q.w, x = q.w < 0 ? -q.x : q.x;
    return 2 * Math.atan2(x, w);
  };
  const lower = node(`${side}LowerArm`).quaternion, hand = node(`${side}Hand`).quaternion;
  const tw = twistOf(hand);
  const swing = hand.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -tw));
  return { twist: twistOf(lower) + tw, wrist: 2 * Math.acos(Math.min(1, Math.abs(swing.w))) };
}

/* ------------------------------------------------------------------ */
/* Las comprobaciones                                                   */
/* ------------------------------------------------------------------ */

/** Los gestos en espejo (las dos manos con `both`), con los momentos en que están del todo. */
const MIRROR: Record<string, number[]> = { clap: [0.15, 0.32], shrug: [0.6], cheer: [0.26, 0.48], bow: [0.8], shove: [0.14, 0.27], pk_hang: [0.4] };

/**
 * Hacia dónde mira cada mano (la normal de la palma, en el marco del pecho: x a su izquierda, y arriba,
 * z delante) en los momentos que importan, y lo poco que puede faltar (el coseno mínimo).
 */
const FACING: { name: string; t: number; side: "left" | "right"; what: string; dir: [number, number, number]; part?: "normal" | "fingers"; min: number }[] = [
  { name: "wave", t: 0.6, side: "right", what: "saludar: la palma hacia delante", dir: [0, 0, 1], min: 0.85 },
  { name: "wave", t: 0.86, side: "right", what: "saludar: la palma hacia delante", dir: [0, 0, 1], min: 0.85 },
  { name: "wave", t: 0.6, side: "right", what: "saludar: los dedos hacia arriba", dir: [0, 1, 0], part: "fingers", min: 0.85 },
  { name: "high_five", t: 0.62, side: "right", what: "chocar los cinco: la palma hacia delante", dir: [0, 0, 1], min: 0.9 },
  { name: "shove", t: 0.27, side: "left", what: "empujar con las dos: la palma hacia delante", dir: [0, 0, 1], min: 0.85 },
  { name: "shove", t: 0.27, side: "right", what: "empujar con las dos: la palma hacia delante", dir: [0, 0, 1], min: 0.85 },
  { name: "push", t: 0.26, side: "right", what: "empujar: la palma hacia delante", dir: [0, 0, 1], min: 0.85 },
  { name: "shrug", t: 0.6, side: "left", what: "encogerse de hombros: la palma hacia arriba", dir: [0, 1, 0], min: 0.85 },
  { name: "shrug", t: 0.6, side: "right", what: "encogerse de hombros: la palma hacia arriba", dir: [0, 1, 0], min: 0.85 },
  { name: "beckon", t: 0, side: "right", what: "llamar con la mano: la palma hacia arriba", dir: [0, 1, 0], min: 0.85 },
  { name: "handshake", t: 0.7, side: "right", what: "dar la mano: la palma hacia la otra mano", dir: [1, 0, 0], min: 0.9 },
  { name: "handshake", t: 0.7, side: "right", what: "dar la mano: los dedos hacia delante", dir: [0, 0, 1], part: "fingers", min: 0.9 },
  { name: "point", t: 0.8, side: "right", what: "señalar: la mano hacia delante", dir: [0, 0, 1], part: "fingers", min: 0.75 },
  { name: "cheer", t: 0.48, side: "left", what: "animar: los puños arriba", dir: [0, 1, 0], part: "fingers", min: 0.7 },
];

const { Rig } = await import("../src/world/people/rig.ts");
const { touchAt } = await import("../src/world/people/gestures.ts");

// Cada brazo, con la palma y los dedos en todos sus fotogramas o en ninguno (se interpola entre ellos).
for (const [name, def] of Object.entries(GESTURES))
  for (const key of ["L", "R"] as const) {
    const keys = def.keys.filter((k) => k[key]);
    const withPalm = keys.filter((k) => k[key]!.palm && k[key]!.fingers).length;
    if (withPalm && withPalm !== keys.length) check(false, `${name}: el brazo ${key} lleva palma y dedos en ${withPalm} de ${keys.length} fotogramas`);
  }

for (const p of presets) {
  if (!["iris", "kai", "alba", "leo", "nora", "mar"].includes(p.id)) continue;
  const vrm = await vrmOf(p.hash);
  const posed = new Posed(vrm);
  const who = p.id;
  if (PRINT) {
    posed.play("clap");
    posed.at(0);
    console.log(`    ${who}: hombro izq. ${f3(posed.joint("leftUpperArm"))}, codo ${f3(posed.joint("leftLowerArm"))}, muñeca ${f3(posed.joint("leftHand"))}, cuello ${f3(posed.joint("neck"))}`);
  }
  for (const [name, times] of Object.entries(MIRROR)) {
    posed.play(name);
    let worst = 0;
    for (const t of times) {
      posed.at(t);
      show(who, name, t, posed);
      worst = Math.max(worst, mirrored(posed));
    }
    check(worst < 6 * DEG, `${who}, ${name}: las dos manos en espejo (${deg(worst)} de diferencia)`);
  }
  for (const f of FACING) {
    posed.play(f.name);
    posed.at(f.t);
    const h = posed.hand(f.side);
    const c = (f.part === "fingers" ? h.fingers : h.normal).dot(new THREE.Vector3(...f.dir));
    check(c >= f.min, `${who}, ${f.what} (${deg(Math.acos(Math.min(1, c)))} de lo pedido)`);
  }
  // Ningún brazo se retuerce: lo que gira el antebrazo y lo que se dobla la muñeca, dentro de lo que se puede.
  let twist = 0, wrist = 0, at = "";
  for (const name of Object.keys(GESTURES)) {
    const def = GESTURES[name]!;
    posed.play(name);
    for (const k of def.keys)
      for (const [key, side] of [["L", "left"], ["R", "right"]] as const) {
        if (!k[key]) continue;
        posed.at(k.t);
        const a = armOf(posed, side);
        if (Math.abs(a.twist) > twist) [twist, at] = [Math.abs(a.twist), `${name} ${k.t} ${side}`];
        wrist = Math.max(wrist, a.wrist);
      }
  }
  check(twist < 150 * DEG && wrist < 65 * DEG, `${who}: ningún brazo se retuerce (antebrazo y mano, como mucho ${deg(twist)}, en ${at}; la muñeca, ${deg(wrist)})`);

  // Aplaudir: con el esqueleto juntando las palmas a la medida de este personaje.
  const rig = new Rig(vrm, async () => null);
  posed.play("clap");
  const pose = (t: number) => {
    posed.at(t);
    rig.touch = touchAt("clap", t);
    rig.apply(1 / 60, null);
    vrm.humanoid.normalizedHumanBonesRoot.updateMatrixWorld(true);
    const l = posed.hand("left"), r = posed.hand("right");
    const axis = r.normal.clone().sub(l.normal).normalize();
    return { l, r, gap: l.palm.clone().sub(r.palm).dot(axis), size: (l.size + r.size) / 2 };
  };
  const shut = pose(0.15);
  const face = shut.l.normal.angleTo(shut.r.normal.clone().negate());
  const mid = shut.l.palm.clone().add(shut.r.palm).multiplyScalar(0.5);
  const shoulder = posed.joint("leftUpperArm"), neck = posed.joint("neck");
  check(Math.abs(shut.gap - 0.3 * shut.size) < 0.004, `${who}, aplaudir: las palmas se tocan (de centro a centro ${cm(shut.gap)}, con una mano de ${cm(shut.size)})`);
  check(face < 12 * DEG, `${who}, aplaudir: una frente a la otra (${deg(face)} de diferencia)`);
  check(Math.abs(mid.x) < 0.015 && mid.z > 0.15 && mid.y < shoulder.y && mid.y > shoulder.y - 0.25, `${who}, aplaudir: delante del pecho y en el centro (${f3(mid)}; hombro a ${cm(shoulder.y)}, cuello a ${cm(neck.y)})`);
  check(shut.l.fingers.z > 0.7 && shut.l.fingers.y > 0.2 && shut.l.thumb.y > 0.5, `${who}, aplaudir: los dedos hacia delante y algo arriba, el pulgar encima (dedos ${f3(shut.l.fingers)})`);
  // Entre palmada y palmada se separan, y en ningún momento se atraviesan.
  let least = Infinity, most = 0;
  for (let t = 0; t <= 0.42; t += 1 / 60) {
    const c = pose(t);
    least = Math.min(least, c.gap / c.size);
    most = Math.max(most, c.l.palm.distanceTo(c.r.palm));
  }
  check(least > 0.27, `${who}, aplaudir: nunca se atraviesan (lo más cerca, ${(least * 100).toFixed(0)} % de la mano entre los centros)`);
  check(most > 0.13, `${who}, aplaudir: y se separan entre palmada y palmada (hasta ${cm(most)})`);
  // Sin el esqueleto, la misma pose no vale para todos: a unos les quedaba un hueco y a otros se les cruzaban.
  posed.play("clap");
  posed.at(0.15);
  const l0 = posed.hand("left"), r0 = posed.hand("right");
  if (PRINT) console.log(`    ${who}: sin el esqueleto, de centro a centro ${cm(l0.palm.clone().sub(r0.palm).dot(r0.normal.clone().sub(l0.normal).normalize()))}`);
  // Y en lo que no se tocan las palmas, el esqueleto no mueve nada.
  rig.touch = touchAt("wave", 0.6);
  check(rig.touch === 0, `${who}: saludar no junta las palmas`);
}

/* ------------------------------------------------------------------ */
/* En pareja: chocar los cinco, darse la mano y abrazarse               */
/* ------------------------------------------------------------------ */

{
  const { PAIR, pairGap, pairStep, pairTargets } = await import("../src/world/people/pair.ts");
  const { BODY, createFx } = await import("../src/world/people/rig.ts");
  const hashOf = (id: string) => presets.find((p) => p.id === id)!.hash;
  // De tamaños distintos (iris es la más baja; leo y nora, de los más altos).
  const PAIRS: [string, string][] = [["iris", "kai"], ["kai", "leo"], ["mar", "nora"], ["iris", "leo"]];
  for (const [aId, bId] of PAIRS) {
    if (process.env.PAIR && !process.env.PAIR.includes(aId)) continue;
    for (const kind of ["high_five", "handshake", "hug"] as const) {
      const A = await vrmOf(hashOf(aId)), B = await vrmOf(hashOf(bId));
      for (const v of [A, B]) if (v.humanoid.normalizedHumanBonesRoot.parent !== v.scene) v.scene.add(v.humanoid.normalizedHumanBonesRoot);
      const fxA = createFx(), fxB = createFx();
      fxA.rig = new Rig(A, async () => null);
      fxB.rig = new Rig(B, async () => null);
      const sa = fxA.rig.size, sb = fxB.rig.size;
      // A cada uno le sale la misma distancia (con lo que mide cada uno).
      const gap = pairGap(kind, sa, sb);
      check(Math.abs(gap - pairGap(kind, sb, sa)) < 1e-9, `${aId} y ${bId}, ${kind}: la misma distancia desde los dos lados (${cm(gap)})`);
      B.scene.position.set(0, 0, gap);
      B.scene.rotation.y = Math.PI;
      A.scene.updateMatrixWorld(true);
      B.scene.updateMatrixWorld(true);
      const pa = new Posed(A), pb = new Posed(B);
      pa.inWorld = pb.inWorld = true;
      pa.play(kind);
      pb.play(kind);
      const posA = new THREE.Vector3(0, 0, 0), posB = new THREE.Vector3(0, 0, gap);
      const until = kind === "high_five" ? 0.62 : kind === "handshake" ? 0.9 : 1.3;
      for (let t = 0; t <= until + 1e-6; t += 1 / 60) {
        pa.at(t);
        pb.at(t);
        pairTargets(kind, t, 0, 0, 0, posB, fxA, fxB);
        pairTargets(kind, t, 0, 0, gap, posA, fxB, fxA);
        fxA.rig.apply(1 / 60, fxA);
        fxB.rig.apply(1 / 60, fxB);
        A.humanoid.normalizedHumanBonesRoot.updateMatrixWorld(true);
        B.humanoid.normalizedHumanBonesRoot.updateMatrixWorld(true);
      }
      const ra = pa.hand("right"), rb = pb.hand("right"), la = pa.hand("left"), lb = pb.hand("left");
      const who = `${aId} y ${bId}`;
      if (PRINT) {
        console.log(`    ${who} ${kind} (a ${cm(gap)}): A der. palma ${f3(ra.palm)} normal ${f3(ra.normal)} dedos ${f3(ra.fingers)} · B der. palma ${f3(rb.palm)} normal ${f3(rb.normal)} dedos ${f3(rb.fingers)}`);
        if (kind === "hug") console.log(`    ${who} hug: A izq. palma ${f3(la.palm)} normal ${f3(la.normal)} · B izq. palma ${f3(lb.palm)} normal ${f3(lb.normal)}`);
      }
      // Ningún brazo retorcido: lo que gira el antebrazo con la mano y lo que se dobla la muñeca.
      let twist = 0, wrist = 0;
      for (const [p, sides] of [[pa, kind === "hug" ? ["left", "right"] : ["right"]], [pb, kind === "hug" ? ["left", "right"] : ["right"]]] as const)
        for (const side of sides) {
          const a = armOf(p, side);
          twist = Math.max(twist, Math.abs(a.twist));
          wrist = Math.max(wrist, a.wrist);
        }
      check(twist < 150 * DEG && wrist < 70 * DEG, `${who}, ${kind}: ningún brazo se retuerce (antebrazo y mano ${deg(twist)}, muñeca ${deg(wrist)})`);
      // Los brazos no atraviesan el tronco de la otra persona (de los hombros a la cintura, un óvalo de
      // su ancho y de su grosor): del hombro al codo y del codo a la muñeca, punto a punto.
      const inside = (p: Posed, other: typeof sa, oz: number, dir: number) => {
        let worst = 0;
        // Su tronco (lo que abulta por delante y por detrás, con la ropa), algo por dentro.
        const ax = other.side * 0.9, az = ((other.front + other.back) / 2) * 0.85;
        oz += dir * ((other.front - other.back) / 2);
        for (const side of ["left", "right"] as const) {
          const S = p.joint(`${side}UpperArm`), E = p.joint(`${side}LowerArm`), W = p.joint(`${side}Hand`);
          for (const [a, b] of [[S, E], [E, W]] as const)
            for (let i = 0; i <= 10; i++) {
              const q = a.clone().lerp(b, i / 10);
              if (q.y < other.shoulder - 0.45 || q.y > other.shoulder - 0.05) continue;
              const e = Math.hypot(q.x / ax, (q.z - oz) / az);
              if (e < 1) worst = Math.max(worst, (1 - e) * Math.min(ax, az));
            }
        }
        return worst;
      };
      const through = Math.max(inside(pa, sb, gap, -1), inside(pb, sa, 0, 1));
      check(through < 0.01, `${who}, ${kind}: ningún brazo atraviesa a la otra persona (${cm(through)} dentro)`);
      if (kind === "high_five") {
        const face = ra.normal.angleTo(rb.normal.clone().negate());
        const axis = ra.normal.clone().sub(rb.normal).normalize();
        const gapC = rb.palm.clone().sub(ra.palm).dot(axis);
        const slide = rb.palm.clone().sub(ra.palm).addScaledVector(axis, -gapC).length();
        check(face < 15 * DEG, `${who}, chocar los cinco: las palmas, una frente a la otra (${deg(face)} de diferencia)`);
        check(gapC > 0.015 && gapC < 0.045 && slide < 0.03, `${who}, chocar los cinco: se tocan (de centro a centro ${cm(gapC)}, desplazadas ${cm(slide)})`);
        check(ra.fingers.y > 0.8 && rb.fingers.y > 0.8, `${who}, chocar los cinco: los dedos hacia arriba (${f3(ra.fingers)}, ${f3(rb.fingers)})`);
        const low = Math.min(sa.shoulder, sb.shoulder);
        check(ra.palm.y > low + 0.1, `${who}, chocar los cinco: por encima de los hombros (${cm(ra.palm.y - low)} sobre el más bajo)`);
      } else if (kind === "handshake") {
        const face = ra.normal.angleTo(rb.normal.clone().negate());
        const axis = ra.normal.clone().sub(rb.normal).normalize();
        const gapC = rb.palm.clone().sub(ra.palm).dot(axis);
        const slide = rb.palm.clone().sub(ra.palm).addScaledVector(axis, -gapC).length();
        check(face < 20 * DEG, `${who}, darse la mano: las palmas, una contra otra (${deg(face)} de diferencia)`);
        check(gapC > 0.012 && gapC < 0.045 && slide < 0.04, `${who}, darse la mano: juntas (de centro a centro ${cm(gapC)}, desplazadas ${cm(slide)})`);
        check(ra.fingers.z > 0.6 && rb.fingers.z < -0.6 && ra.thumb.y > 0.4 && rb.thumb.y > 0.4, `${who}, darse la mano: los dedos hacia la otra persona y el pulgar arriba`);
        const short = sa.shoulder < sb.shoulder ? sa : sb, tall = short === sa ? sb : sa;
        const below = short.shoulder - ra.palm.y;
        check(below > 0.2 * short.arm && tall.shoulder - ra.palm.y < 0.8 * tall.arm, `${who}, darse la mano: por debajo de los hombros (${cm(below)} bajo el más bajo, ${cm(tall.shoulder - ra.palm.y)} bajo el más alto)`);
        check(gap > sa.front + sb.front + 0.25, `${who}, darse la mano: a un brazo de distancia (${cm(gap)})`);
      } else {
        // Abrazo: cada palma apoyada en el tronco de la otra persona (en su óvalo a esa altura, de lado o
        // por detrás, nunca dentro ni en el aire) y mirándolo; la derecha más alta que la izquierda.
        const on = (h: HandAt, rig: InstanceType<typeof Rig>) => {
          const c = new THREE.Vector3(), f = new THREE.Vector3(), l = new THREE.Vector3();
          const band = { front: 0, back: 0, side: 0 };
          // A la altura de la palma (entre su cintura y su pecho).
          rig.torsoAt(0, c, f, l, band);
          const y0 = c.y;
          rig.torsoAt(1, c, f, l, band);
          rig.torsoAt(Math.min(1, Math.max(0, (h.palm.y - y0) / (c.y - y0))), c, f, l, band);
          const ex = band.side, ez = (band.front + band.back) / 2;
          c.addScaledVector(f, (band.front - band.back) / 2);
          const d = h.palm.clone().sub(c);
          const u = d.dot(l) / ex, v = -d.dot(f) / ez;
          const out = l.clone().multiplyScalar(u / ex).addScaledVector(f, -v / ez).normalize();
          return { e: Math.hypot(u, v), v, faces: -h.normal.dot(out) };
        };
        const hands = [on(ra, fxB.rig), on(la, fxB.rig), on(rb, fxA.rig), on(lb, fxA.rig)];
        const bad = hands.find((h) => h.e < 0.95 || h.e > 1.45 || h.v < -0.3 || h.faces < 0.6);
        check(!bad, `${who}, abrazo: las palmas apoyadas en el tronco de la otra persona (${hands.map((h) => `${h.e.toFixed(2)}/${h.v.toFixed(2)}/${h.faces.toFixed(2)}`).join(" ")})`);
        // A cada lado, un brazo encima del otro (la derecha de cada uno sobre la izquierda del otro, o los
        // del más alto por encima): que no se crucen a la misma altura.
        const side1 = ra.palm.y - lb.palm.y, side2 = rb.palm.y - la.palm.y;
        check(Math.abs(side1) > 0.05 && Math.abs(side2) > 0.05, `${who}, abrazo: a cada lado, un brazo encima del otro (${cm(side1)} y ${cm(side2)})`);
        check(gap >= sa.front + sb.front, `${who}, abrazo: pecho con pecho, sin meterse uno en otro (${cm(gap)})`);
      }
    }
  }

  // Quien la propone se acerca a su pareja (quieta) y llega a tiempo, sin pasarse: desde lejos (3 m,
  // el máximo para proponerla) y desde cerca, a 30 y a 144 imágenes por segundo.
  for (const kind of ["high_five", "handshake", "hug"] as const) {
    const gap = pairGap(kind, BODY, BODY);
    const [i0, i1] = PAIR[kind].reach;
    for (const d0 of [3, 1.2])
      for (const hz of [30, 144]) {
        let d = d0, t = 0, closest = d0, arrived = Infinity;
        while (t < PAIR[kind].s) {
          d -= pairStep(kind, t, d, gap, 1 / hz);
          closest = Math.min(closest, d);
          t += 1 / hz;
          if (arrived === Infinity && d <= gap + 0.03) arrived = t;
        }
        check(closest >= gap - 1e-6 && arrived <= Math.max((i0 + i1) / 2 + 0.25, 0.6), `${kind}, de ${d0} m a ${hz} Hz: llega a su distancia a tiempo (${arrived.toFixed(2)} s) y sin pasarse (${cm(closest - gap)})`);
      }
  }
}

/* ------------------------------------------------------------------ */
/* El teléfono en la mano                                               */
/* ------------------------------------------------------------------ */

// Con el gesto del teléfono (su clip de captura), el teléfono queda en la mano derecha, junto a la
// oreja y con la pantalla hacia la cara, en todos los personajes de serie (people/phone.ts).
{
  const { attachPhone } = await import("../src/world/people/phone.ts");
  const phoneClip = await clip("phone");
  for (const p of presets) {
    const vrm = await vrmOf(p.hash);
    if (vrm.humanoid.normalizedHumanBonesRoot.parent !== vrm.scene) vrm.scene.add(vrm.humanoid.normalizedHumanBonesRoot);
    const rig = new Rig(vrm, async () => null);
    const phone = attachPhone(vrm, rig, 1);
    if (!phone) {
      check(false, `${p.id}: el teléfono, en su mano`);
      continue;
    }
    const mixer = new THREE.AnimationMixer(vrm.scene);
    const action = mixer.clipAction(createVRMAnimationClip(phoneClip, vrm));
    action.play();
    // La pose del clip y, encima, el esqueleto llevando la mano a la oreja (rig.ts → phone).
    for (let i = 0; i < 40; i++) {
      action.time = 2;
      mixer.update(0);
      rig.phone = 1;
      rig.apply(1 / 60, null);
      vrm.scene.updateMatrixWorld(true);
    }
    const at = phone.getWorldPosition(new THREE.Vector3());
    // La cabeza a la altura de la oreja (algo por encima de su hueso), en su marco: a su derecha (−x
    // en reposo: miran hacia +z), arriba y delante.
    const hn = vrm.humanoid.getNormalizedBoneNode("head")!;
    const hq = hn.getWorldQuaternion(new THREE.Quaternion());
    const ear = hn.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0).applyQuaternion(hq));
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(hq);
    const screen = new THREE.Vector3(0, 0, 1).applyQuaternion(phone.getWorldQuaternion(new THREE.Quaternion()));
    const d = at.clone().sub(ear);
    const side = d.dot(right), dist = d.length(), faces = -screen.dot(right);
    if (PRINT) console.log(`    ${p.id}: teléfono a ${cm(dist)} de la oreja (${cm(side)} a su derecha), pantalla hacia la cabeza ${faces.toFixed(2)}`);
    check(dist < 0.13 && side > 0.06 && side < 0.12 && faces > 0.8, `${p.id}: el teléfono, en la oreja derecha y con la pantalla hacia la cara (a ${cm(dist)}, ${cm(side)} a su derecha; ${faces.toFixed(2)})`);
  }
}

if (PRINT && process.env.ALL) {
  const vrm = await vrmOf(presets.find((p) => p.id === "kai")!.hash);
  const posed = new Posed(vrm);
  const pick = process.env.ALL === "1" ? Object.keys(GESTURES) : process.env.ALL.split(",");
  for (const name of pick) {
    const dur = posed.play(name);
    const keys = GESTURES[name]!.keys.filter((k) => k.L || k.R).map((k) => k.t);
    for (const t of keys.length ? keys : [dur / 2]) {
      posed.at(t);
      const l = posed.hand("left"), r = posed.hand("right");
      const k = GESTURES[name]!.keys.find((x) => x.t === t);
      const line = (side: string, h: HandAt) => `${side}: normal ${f3(h.normal)} dedos ${f3(h.fingers)} pulgar ${f3(h.thumb)} palma ${f3(h.palm)}`;
      console.log(`  ${name} ${t.toFixed(2)} ${k?.L ? line("I", l) : ""} ${k?.R ? line("D", r) : ""}`);
    }
  }
}
console.log(fails ? `\n${fails} comprobaciones fallan` : "\nTodo bien");
process.exit(fails ? 1 : 0);
