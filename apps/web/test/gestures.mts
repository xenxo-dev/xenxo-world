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
 * - el teléfono queda en la mano derecha, junto a la oreja y con la pantalla hacia la cara;
 * - colgado de un canto (parkour), cada mano agarrada a él con los dedos por encima y la muñeca casi
 *   recta, sin que el antebrazo ni los dedos se metan en el bloque.
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
  const { PAIR, pairGap, pairLeave, pairStep, pairTargets } = await import("../src/world/people/pair.ts");
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
      const until = kind === "high_five" ? 0.62 : kind === "handshake" ? 0.9 : 1.65;
      // Los brazos no atraviesan el tronco de la otra persona (de su cintura a sus hombros, en su óvalo a
      // cada altura, tal como está ahora: rig.ts → torsoAt): del hombro al codo y del codo a la muñeca.
      const inside = (p: Posed, rig: InstanceType<typeof Rig>) => {
        let worst = 0;
        const c = new THREE.Vector3(), f = new THREE.Vector3(), l = new THREE.Vector3(), sh = new THREE.Vector3();
        const band = { front: 0, back: 0, side: 0 };
        rig.torsoAt(0, c, f, l, band);
        const y0 = c.y;
        rig.torsoAt(1, c, f, l, band);
        const y1 = c.y;
        rig.shoulderAt(0, sh);
        const top = sh.y - 0.05;
        for (const side of ["left", "right"] as const) {
          const S = p.joint(`${side}UpperArm`), E = p.joint(`${side}LowerArm`), W = p.joint(`${side}Hand`);
          for (const [a, b] of [[S, E], [E, W]] as const)
            for (let i = 0; i <= 10; i++) {
              const q = a.clone().lerp(b, i / 10);
              if (q.y < y0 - 0.1 || q.y > top) continue;
              rig.torsoAt((q.y - y0) / (y1 - y0), c, f, l, band);
              // Lo que abulta (con la ropa: un brazo apoyado puede hundirse un poco, `soft`).
              const ex = band.side, ez = (band.front + band.back) / 2;
              c.addScaledVector(f, (band.front - band.back) / 2);
              const d = q.clone().sub(c);
              const e = Math.hypot(d.dot(l) / ex, d.dot(f) / ez);
              if (e < 1 && (1 - e) * Math.min(ex, ez) > worst) {
                worst = (1 - e) * Math.min(ex, ez);
                if (PRINT) console.log(`    ${side} ${a === S ? "brazo" : "antebrazo"} ${i / 10}: ${cm(worst)} dentro a ${cm(q.y)}`);
              }
            }
        }
        return worst;
      };
      // Como en el juego: las manos se buscan con la otra persona como quedó en el frame anterior
      // (la gente, antes de animar a nadie) y después cada uno se anima y su esqueleto las lleva; al
      // soltarse del abrazo, A (quien se acercó) da medio paso atrás (pairLeave).
      const frame = (t: number) => {
        if (kind === "hug") {
          posA.z -= pairLeave(kind, t, posB.z - posA.z, gap, 1 / 60);
          A.scene.position.copy(posA);
          A.scene.updateMatrixWorld(true);
        }
        pairTargets(kind, t, posA.x, 0, posA.z, posB, fxA, fxB);
        pairTargets(kind, t, posB.x, 0, posB.z, posA, fxB, fxA);
        pa.at(t);
        pb.at(t);
        feet.length = 0;
        for (const p of [pa, pb]) for (const f of ["leftFoot", "rightFoot"]) feet.push(p.joint(f));
        fxA.rig.apply(1 / 60, fxA);
        fxB.rig.apply(1 / 60, fxB);
        A.humanoid.normalizedHumanBonesRoot.updateMatrixWorld(true);
        B.humanoid.normalizedHumanBonesRoot.updateMatrixWorld(true);
      };
      // Dónde deja los pies la animación (en el último frame), para ver que el abrazo no los mueve.
      const feet: THREE.Vector3[] = [];
      // Mientras las manos rodean a la otra persona (desde delante de su costado hasta su espalda), ningún
      // brazo la atraviesa.
      let wrapThrough = 0;
      let t = 0;
      for (; t <= until + 1e-6; t += 1 / 60) {
        frame(t);
        if (kind === "hug" && t > 0.8 && t < 1.25) wrapThrough = Math.max(wrapThrough, inside(pa, fxB.rig), inside(pb, fxA.rig));
      }
      if (kind === "hug") check(wrapThrough < 0.04, `${aId} y ${bId}, abrazo: al rodearla, ningún brazo atraviesa a la otra persona (${cm(wrapThrough)} dentro, como mucho)`);
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
      // (Abrazando, se aprieta: un antebrazo o una muñeca apoyados en su espalda hunden algo la ropa; y por
      // sus omóplatos el óvalo es el de su pecho, algo más grueso que su espalda de verdad.)
      const through = Math.max(inside(pa, fxB.rig), inside(pb, fxA.rig));
      check(through < (kind === "hug" ? 0.04 : 0.015), `${who}, ${kind}: ningún brazo atraviesa a la otra persona (${cm(through)} dentro)`);
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
          rig.torsoAt(Math.min(3, Math.max(-0.5, (h.palm.y - y0) / (c.y - y0))), c, f, l, band);
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
        // A cada lado, un brazo encima del otro: ningún brazo de uno atraviesa uno del otro (entre sus huesos,
        // del hombro al codo y del codo a la muñeca, como poco lo que abultan dos antebrazos que se aprietan).
        const bones = (p: Posed) =>
          (["left", "right"] as const).flatMap((side) => {
            const S = p.joint(`${side}UpperArm`), E = p.joint(`${side}LowerArm`), W = p.joint(`${side}Hand`);
            return [[S, E], [E, W]] as [THREE.Vector3, THREE.Vector3][];
          });
        let near = Infinity, where = "";
        const names = ["izq. brazo", "izq. antebrazo", "der. brazo", "der. antebrazo"];
        bones(pa).forEach(([a0, a1], ia) =>
          bones(pb).forEach(([b0, b1], ib) => {
            for (let i = 0; i <= 20; i++)
              for (let j = 0; j <= 20; j++) {
                const d = a0.clone().lerp(a1, i / 20).distanceTo(b0.clone().lerp(b1, j / 20));
                if (d < near) [near, where] = [d, `${aId} ${names[ia]} ${i / 20} y ${bId} ${names[ib]} ${j / 20}`];
              }
          }),
        );
        if (PRINT) console.log(`    lo más cerca: ${where}`);
        check(near > 0.05, `${who}, abrazo: ningún brazo atraviesa uno de la otra persona (a ${cm(near)}, como poco, de hueso a hueso)`);
        // La de arriba de cada uno, en la espalda de la otra persona (no en su costado).
        check(hands[0]!.v > 0.4 && hands[2]!.v > 0.4, `${who}, abrazo: la mano de arriba, en su espalda (${hands[0]!.v.toFixed(2)} y ${hands[2]!.v.toFixed(2)}; 1 es la columna)`);
        // Pecho con pecho: entre los dos troncos por delante (en horizontal, a cada altura entre la cintura
        // y el pecho de cada uno), donde más cerca están, ni un hueco ni metidos uno en otro.
        const front = (rig: InstanceType<typeof Rig>) => {
          const c = new THREE.Vector3(), f = new THREE.Vector3(), l = new THREE.Vector3(), band = { front: 0, back: 0, side: 0 };
          const at = (level: number) => {
            rig.torsoAt(level, c, f, l, band);
            const k = Math.hypot(f.x, f.z);
            return c.clone().addScaledVector(f.setY(0).normalize(), band.front / Math.max(0.6, k));
          };
          const lo = at(0), hi = at(1);
          const sh = new THREE.Vector3();
          rig.shoulderAt(0, sh);
          return { lo, hi, top: sh.y, z: (y: number) => (y >= hi.y ? hi.z : lo.z + ((hi.z - lo.z) * Math.max(0, y - lo.y)) / Math.max(0.02, hi.y - lo.y)) };
        };
        const fa = front(fxA.rig), fb = front(fxB.rig);
        const lo = Math.max(fa.lo.y, fb.lo.y), hi = Math.min(fa.hi.y, fb.hi.y);
        let touch = Infinity;
        for (const y of [fa.lo.y, fa.hi.y, fb.lo.y, fb.hi.y]) {
          const at = hi > lo ? Math.min(hi, Math.max(lo, y)) : (lo + hi) / 2;
          touch = Math.min(touch, fb.z(at) - fa.z(at));
        }
        const tall = Math.abs(sa.shoulder - sb.shoulder) > 0.2;
        check(touch > -0.04 && touch < (tall ? 0.09 : 0.03), `${who}, abrazo: pecho con pecho, sin meterse uno en otro (${cm(touch)} entre los dos troncos)`);
        // Las cabezas: no se meten una en otra, cada una a su izquierda (por encima del hombro derecho de la
        // otra persona) y la de quien queda por debajo de los hombros del otro, delante de su pecho.
        const ha = new THREE.Vector3(), hb = new THREE.Vector3();
        fxA.rig.headAt(ha);
        fxB.rig.headAt(hb);
        const radii = fxA.rig.headRadius + fxB.rig.headRadius;
        check(ha.distanceTo(hb) > radii * 0.95, `${who}, abrazo: las cabezas no se meten una en otra (${cm(ha.distanceTo(hb))} entre los centros; ${cm(radii)}, las dos)`);
        check(ha.x - hb.x > 0.05, `${who}, abrazo: cada cabeza a su izquierda, por encima del hombro derecho de la otra persona (${cm(ha.x - hb.x)} de lado)`);
        const chestA = ha.y < fb.top ? fb.z(ha.y) - ha.z - fxA.rig.headRadius : Infinity;
        const chestB = hb.y < fa.top ? hb.z - fa.z(hb.y) - fxB.rig.headRadius : Infinity;
        check(Math.min(chestA, chestB) > -0.04, `${who}, abrazo: ninguna cabeza se mete en el pecho de la otra persona (${Number.isFinite(Math.min(chestA, chestB)) ? cm(Math.min(chestA, chestB)) : "por encima de sus hombros"})`);
        // Los pies, donde los dejó la animación (la cadera va hacia la otra persona sin moverlos).
        let slid = 0;
        [pa, pb].forEach((p, i) => ["leftFoot", "rightFoot"].forEach((f, j) => (slid = Math.max(slid, p.joint(f).distanceTo(feet[i * 2 + j]!)))));
        check(slid < 0.012, `${who}, abrazo: los pies no se mueven (${cm(slid)})`);
        // Al soltarse, como en la grabación: las manos resbalan de su espalda a sus brazos (sin atravesarla)
        // mientras A da medio paso atrás, y se quedan un momento así: la de arriba de cada uno por fuera de
        // su brazo, entre el hombro y el codo, mirándolo; la de abajo, por debajo de su antebrazo, con la
        // palma hacia arriba.
        let slideThrough = 0;
        for (t += 1 / 60; t <= 3.25 + 1e-6; t += 1 / 60) {
          frame(t);
          if (t > 2.6 && t < 2.95) slideThrough = Math.max(slideThrough, inside(pa, fxB.rig), inside(pb, fxA.rig));
        }
        check(slideThrough < 0.04, `${who}, abrazo: al resbalar a sus brazos, ningún brazo atraviesa a la otra persona (${cm(slideThrough)} dentro, como mucho)`);
        const onArm = (h: HandAt, a: THREE.Vector3, b: THREE.Vector3) => {
          const ab = b.clone().sub(a);
          const k = Math.min(1, Math.max(0, h.palm.clone().sub(a).dot(ab) / ab.lengthSq()));
          const to = a.clone().addScaledVector(ab, k).sub(h.palm);
          return { d: to.length(), up: to.clone().normalize().y, faces: h.normal.dot(to.normalize()), k };
        };
        // La de arriba, en su brazo (entre el hombro y el codo o, con alguien mucho más alto, junto al codo).
        const upper = (h: HandAt, p: Posed) => {
          const a = onArm(h, p.joint("leftUpperArm"), p.joint("leftLowerArm")), b = onArm(h, p.joint("leftLowerArm"), p.joint("leftHand"));
          return b.d < a.d && b.k < 0.4 ? { ...b, k: 0.5 } : a;
        };
        const arms = [upper(pa.hand("right"), pb), upper(pb.hand("right"), pa)];
        const fmt = (x: { d: number; faces: number; up: number }) => `${cm(x.d)}/${x.faces.toFixed(2)}`;
        check(arms.every((x) => x.d > 0.02 && x.d < 0.1 && x.faces > 0.6 && x.k > 0.2), `${who}, abrazo: al soltarse, la mano de arriba en su brazo, por fuera y mirándolo (${arms.map(fmt).join(" ")})`);
        const flanks = [on(pa.hand("left"), fxB.rig), on(pb.hand("left"), fxA.rig)];
        check(flanks.every((h) => h.e > 0.95 && h.e < 1.45 && h.faces > 0.6 && h.v < 0.3), `${who}, abrazo: y la de abajo, en su costado (${flanks.map((h) => `${h.e.toFixed(2)}/${h.v.toFixed(2)}/${h.faces.toFixed(2)}`).join(" ")})`);
        const apart = posB.z - posA.z - gap;
        check(apart > 0.18 && apart < 0.26, `${who}, abrazo: al soltarse, medio paso atrás (${cm(apart)} más lejos que abrazados)`);
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
          const step = pairStep(kind, t, d, gap, 1 / hz);
          d -= step;
          // Y, al soltarse del abrazo, el paso atrás.
          if (step === 0) d += pairLeave(kind, t, d, gap, 1 / hz);
          closest = Math.min(closest, d);
          t += 1 / hz;
          if (arrived === Infinity && d <= gap + 0.03) arrived = t;
        }
        check(closest >= gap - 1e-6 && arrived <= Math.max((i0 + i1) / 2 + 0.25, 0.6), `${kind}, de ${d0} m a ${hz} Hz: llega a su distancia a tiempo (${arrived.toFixed(2)} s) y sin pasarse (${cm(closest - gap)})`);
        // Al acabar el abrazo, nadie dentro de nadie (collision.ts: dos personas ocupan 0,62 m).
        if (kind === "hug") check(d >= 0.62, `${kind}, de ${d0} m a ${hz} Hz: al acabar, cada uno en su sitio (${cm(d)} entre los dos)`);
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

/* ------------------------------------------------------------------ */
/* Colgado de un borde (parkour)                                        */
/* ------------------------------------------------------------------ */

// Colgado de un canto como en el juego (el cuerpo donde lo pone parkour/moves.ts, las manos con
// parkour/ledge.ts y el dibujo subido lo que les falte a los brazos, como en Player.tsx): cada mano,
// agarrada al canto con la palma contra la pared y los dedos por encima; ni los dedos ni el antebrazo
// se meten en el bloque, y la muñeca va casi recta.
{
  // parkour/moves.ts no se puede cargar aquí (sin Vite no hay import.meta.env): sus medidas de colgado,
  // tal cual (HANG_DROP; HANG_OFF − HANG_IN, de BODY_RADIUS + 0.05 − 0.18).
  const HANG_DROP = 2.05, HANG_GAP = 0.32 + 0.05 - 0.18;
  const { ledgeHands } = await import("../src/world/parkour/ledge.ts");
  const { createFx } = await import("../src/world/people/rig.ts");
  type Pk = Parameters<typeof ledgeHands>[0];
  // La pared en z = WALL (el bloque, por detrás: z > WALL y por debajo de TOP), de cara a quien
  // cuelga (que mira hacia +z): n = (0, 0, −1). El dibujo, a HANG_GAP de la pared.
  const TOP = HANG_DROP, WALL = HANG_GAP;
  const inBlock = (v: THREE.Vector3) => Math.min(v.z - WALL, TOP - v.y);
  for (const p of presets) {
    const vrm = await vrmOf(p.hash);
    if (vrm.humanoid.normalizedHumanBonesRoot.parent !== vrm.scene) vrm.scene.add(vrm.humanoid.normalizedHumanBonesRoot);
    const fx = createFx();
    fx.rig = new Rig(vrm, async () => null);
    const posed = new Posed(vrm);
    posed.inWorld = true;
    posed.play("pk_hang");
    // Lo que lee parkour/ledge.ts de quien cuelga: cada mano en el canto, a ±21 cm (como placeHands).
    const pk = { move: "hang", p: 0, nx: 0, nz: -1, hand: { lx: 0.21, ly: TOP, lz: WALL, rx: -0.21, ry: TOP, rz: WALL, w: 1 } } as unknown as Pk;
    let lift = 0;
    for (let i = 0; i < 90; i++) {
      vrm.scene.position.y = lift;
      vrm.scene.updateMatrixWorld(true);
      posed.at((i / 60) % 1.6);
      ledgeHands(pk, fx);
      fx.rig.apply(1 / 60, fx);
      vrm.scene.updateMatrixWorld(true);
      // Como Player.tsx: colgado, el dibujo sube lo que les falte a los brazos o baja (hasta 30 cm) lo
      // que les sobre (aquí, el suelo lejos).
      lift = Math.min(0.6, Math.max(-0.3, lift + fx.rig.reachLift * Math.min(1, (1 / 60) * 14)));
    }
    const node = (b: string) => vrm.humanoid.getNormalizedBoneNode(b as VRMHumanBoneName)!;
    const at = (b: string) => node(b).getWorldPosition(new THREE.Vector3());
    let worst = 0, bend = 0, where = "";
    const hands = (["left", "right"] as const).map((side) => {
      const h = posed.hand(side);
      // Lo que se mete en el bloque: el antebrazo (del codo a la muñeca, punto a punto), la muñeca, la
      // palma y las articulaciones de los dedos.
      const E = at(`${side}LowerArm`), W = at(`${side}Hand`);
      const pts = [...Array.from({ length: 11 }, (_, k) => E.clone().lerp(W, k / 10)), h.palm];
      for (const f of ["Index", "Middle", "Ring", "Little"]) for (const j of ["Proximal", "Intermediate", "Distal"]) pts.push(at(`${side}${f}${j}`));
      for (const v of pts) {
        const d = inBlock(v);
        if (d > worst) [worst, where] = [d, side];
      }
      bend = Math.max(bend, armOf(posed, side).wrist);
      // ¿Por encima del canto? La segunda articulación de los dedos (donde se doblan sobre él).
      const over = Math.min(...["Index", "Middle", "Ring", "Little"].map((f) => at(`${side}${f}Distal`).y)) - TOP;
      return { h, over };
    });
    if (PRINT) for (const { h, over } of hands) console.log(`    ${p.id}: palma ${f3(h.palm)} normal ${f3(h.normal)} dedos ${f3(h.fingers)} · puntas a ${cm(over)} del canto · subido ${cm(lift)}`);
    const onWall = hands.every(({ h }) => h.palm.z > WALL - 0.045 && h.palm.z < WALL && h.normal.z > 0.8 && h.fingers.y > 0.7);
    check(onWall, `${p.id}, colgado: cada mano agarrada al canto, con la palma contra la pared y los dedos hacia arriba`);
    check(hands.every(({ over }) => over > -0.03 && over < 0.04), `${p.id}, colgado: los dedos, doblados por encima del canto (${hands.map(({ over }) => cm(over)).join(" y ")})`);
    check(worst < 0.012, `${p.id}, colgado: ni el antebrazo ni la mano se meten en el bloque (${cm(worst)}${where ? `, la ${where === "left" ? "izquierda" : "derecha"}` : ""})`);
    check(bend < 45 * DEG, `${p.id}, colgado: la muñeca, casi recta (${deg(bend)})`);
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
