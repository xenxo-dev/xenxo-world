/**
 * Prueba de hablar con el cuerpo (world/people/talk.ts y talk-pose.ts) sin navegador:
 *
 * - del texto al gesto: los saludos saludan, las preguntas acaban con las palmas arriba, la risa se ríe,
 *   las gracias van al pecho… y lo de todos los días no dispara nada raro («está», «estás», «toma, para
 *   ti» o «vamos a la plaza» no señalan, ni dan un puñetazo al aire, ni lo celebran);
 * - el mismo mensaje da la misma actuación en todos los clientes (la misma id, las mismas variantes);
 * - cabe en el bocadillo (7 s) aunque el mensaje sea largo, y empieza a hablar con los brazos ya arriba;
 * - en un mensaje largo, cada trozo con una variante distinta de la anterior, y una pregunta la cierra
 *   con las palmas arriba;
 * - lo mismo a 24, 60 y 144 imágenes por segundo (los muelles de las muñecas van a pasos fijos);
 * - las posturas, las formas y los conjuntos son los que se trajeron del pipeline de vídeo
 *   (tools/talk/mh_plano.json), salvo lo que es de xenxo y lo que no se trae (OWN_* y LEFT_*);
 * - con los personajes de serie de verdad y su reposo de verdad, en todos los gestos y en todo momento:
 *   ninguna mano, muñeca ni antebrazo se mete en su propio tronco ni en su cabeza (lo que ocupa con la
 *   ropa: shape.ts), la muñeca no se dobla más de 30°, ningún antebrazo se retuerce, nada sale NaN y,
 *   al acabar, todo queda como estaba.
 *
 *   npm run test:talk -w @xenxo/web          (PRINT=1: además, lo peor de cada gesto)
 */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, type VRMAnimation } from "@pixiv/three-vrm-animation";
import { cueOf, FORMS, HELD, LIVELY, newSayFrame, planSay, POSTURES, sampleSay, seedOf, type PostureName, type SayRun } from "../src/world/people/talk.ts";
import { poseSay, sayBones } from "../src/world/people/talk-pose.ts";

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
/* Del texto al gesto                                                   */
/* ------------------------------------------------------------------ */

console.log("Del texto al gesto");
const CUES: [string, string][] = [
  ["¡Hola a todos!", "saluda"],
  ["hello everyone", "saluda"],
  ["Hasta luego, chicos", "saluda"],
  ["jajaja qué bueno", "rie"],
  ["lol", "rie"],
  ["¡Gracias!", "pecho"],
  ["thanks!", "pecho"],
  ["Porfa, ven a la plaza", "ruega"],
  ["¡Bravo!", "palmas"],
  ["¡Toma ya!", "toma"],
  ["¡Hemos ganado!", "celebra"],
  ["¡Vamos!", "celebra"],
  ["¡Genial!", "pulgares"],
  ["👍", "pulgares"],
  ["No sé, la verdad", "hombros"],
  ["¡No puede ser!", "manos_cabeza"],
  ["¡Ay, qué mono!", "mejillas"],
  ["Uf, qué calor", "frente"],
  ["¡Anda ya!", "anda_ya"],
  ["¿En serio?", "exaspera"],
  ["¡Wow!", "sorpresa"],
  ["No", "niega"],
  ["Sí", "asiente"],
  ["¡Cuidado con eso!", "regana"],
  ["Mmm, a ver…", "barbilla"],
  ["Mira esto", "apunta"],
  ["La puerta está allí", "senala"],
  ["1, 2, 3", "cuenta"],
  ["¿Vienes a la carrera de esta noche?", "pregunta"],
  ["Tengo 3 coches y 12 motos", "explica"],
  ["Estoy probando el metaverso con mis amigos de clase", "habla"],
  // Lo de todos los días no dispara nada: sin tildes, «está» es «esta»; «toma» y «vamos» a secas.
  ["Está muy bien", "habla"],
  ["estas bien o que", "habla"],
  ["¿Estás bien?", "pregunta"],
  ["Toma, para ti", "habla"],
  ["Vamos a la plaza", "habla"],
  ["Hijo mío, qué tarde", "habla"],
];
const wrong = CUES.filter(([text, g]) => cueOf(text).g !== g).map(([text, g]) => `«${text}» → ${cueOf(text).g} (y era ${g})`);
check(!wrong.length, `cada mensaje, su gesto (${CUES.length} frases en castellano e inglés)${wrong.length ? ": " + wrong.join("; ") : ""}`);
check(cueOf("¡Increíble!").amp > cueOf("increíble").amp && cueOf("TENGO 3 COCHES").amp >= 1.2, "más amplio con exclamaciones, en mayúsculas y con cifras");

/* ------------------------------------------------------------------ */
/* El plan                                                              */
/* ------------------------------------------------------------------ */

console.log("El plan");
const LONG =
  "Hoy he estado en el distrito Cero, he corrido el Gran Premio, he perdido dos veces, luego he ganado la carrera de Vértigo. Después he ido a la plaza a ver a todo el mundo, y he bailado un rato con la gente. ¿Os venís mañana?";
{
  const a = JSON.stringify(planSay(LONG, seedOf("msg-1")));
  const b = JSON.stringify(planSay(LONG, seedOf("msg-1")));
  check(a === b, "el mismo mensaje (la misma id) da la misma actuación");
  const variants = new Set(["m-1", "m-2", "m-3", "m-4", "m-5", "m-6"].map((id) => JSON.stringify(planSay(LONG, seedOf(id)).frases.map((f) => f.pos))));
  check(variants.size > 1, `con otra id, otras variantes (${variants.size} distintas en 6)`);
  const p = planSay(LONG, seedOf("msg-1"));
  check(p.end <= 7 && p.t1 <= 0.45 + 5.2 + 1e-6, `un mensaje largo cabe en el bocadillo (acaba a los ${p.end.toFixed(2)} s; habla hasta los ${p.t1.toFixed(2)} s)`);
  const repeats = p.frases.filter((f, i) => i > 0 && f.pos[0] === p.frases[i - 1]!.pos[0] && f.pos[1] === p.frases[i - 1]!.pos[1]).length;
  check(p.frases.length >= 3 && repeats === 0, `partido por sus pausas (${p.frases.length} trozos), cada uno con una variante distinta de la anterior`);
  check(p.beats.length >= 4 && p.beats.every((b, i) => i === 0 || b.t - p.beats[i - 1]!.t >= 0.42 - 1e-9), `golpes en las palabras con peso, separados (${p.beats.length})`);
  const mixed = planSay("Hola, ¿qué tal? Hoy he ganado la carrera de Vértigo. ¿Venís mañana a la plaza?", seedOf("mix"));
  const gs = mixed.frases.map((f) => f.g).join(", ");
  check(gs === "saluda, celebra, pregunta", `cada trozo, con el gesto de lo que dice: saluda, lo celebra y acaba preguntando con las palmas arriba (${gs})`);
  const short = planSay("¡Hola!", seedOf("x"));
  const run: SayRun = { plan: short, t: short.t0 + 0.03 };
  const f = sampleSay(run, newSayFrame());
  check(short.t0 >= 0.4 && f.R.w > 0.99, `empieza a «hablar» con el brazo ya arriba (a los ${short.t0.toFixed(2)} s, el derecho a ${f.R.w.toFixed(2)})`);
  const done = sampleSay({ plan: short, t: short.end + 1 }, newSayFrame());
  check(done.L.w === 0 && done.R.w === 0 && Math.abs(done.head[0]) + Math.abs(done.head[1]) + Math.abs(done.head[2]) < 1e-6 && done.shoulders[0] < 1e-6, "al acabar, todo como estaba");
  check(planSay("", 1).end === 0 && planSay("   ...  ", 1).end === 0, "sin palabras, nada");
}

/* ------------------------------------------------------------------ */
/* Lo que se trajo del pipeline                                         */
/* ------------------------------------------------------------------ */

// tools/talk/mh_plano.json es lo que se trajo la última vez de mh_plano.py (tools/talk/README.md): las
// posturas, las formas y los conjuntos de talk.ts tienen que ser esos, salvo lo que es de xenxo y lo que
// no se trae. Al traer cambios, si algo se queda sin pasar, esto dice qué.
console.log("Lo que se trajo del pipeline (tools/talk/mh_plano.json)");
{
  interface Src {
    ik: number[];
    y: number[];
    z: number[];
    dedos: string | Record<string, number>;
    polo: number[] | null;
  }
  const src = JSON.parse(readFileSync(new URL("../../../tools/talk/mh_plano.json", import.meta.url), "utf8")) as {
    datos: { POSES: Record<string, Src>; FORMAS: Record<string, [string, string][]>; VIVAS: string[]; SEGUIDOS: string[]; POLO_BRAZO: number[] | { si_no: number[] } };
  };
  /** Las manos del pipeline, en xenxo (people/hands.ts). */
  const MANO: Record<string, string> = { SUELTA: "relaxed", MEDIA: "relaxed", ABIERTA: "open", INDICE: "point", PUNO: "fist", PULGAR: "thumb" };
  /** Lo que es de xenxo (README → «Lo que es de xenxo»): qué tiene cada postura propio ("*": toda ella). */
  const OWN_POSE: Record<string, readonly string[]> = { celebra: ["ik"], barbilla: ["hand"], saluda: ["*"] };
  const OWN_FORM = ["barbilla", "saluda", "asiente"];
  const OWN_LIVELY = ["saluda"];
  const OWN_HELD = ["barbilla", "saluda", "asiente"];
  /** Lo que el pipeline tiene y aquí no (README → «Lo que no se trae»). */
  const LEFT_POSE = ["cuelga", "frota", "mando", "jarras", "amenaza", "rabia", "manos_juntas", "bolsillo", "rasca"];
  const LEFT_FORM = ["frota", "mando", "cabeza", "jarras", "amenaza", "rabia", "salta"];

  const { POSES, FORMAS, VIVAS, SEGUIDOS, POLO_BRAZO } = src.datos;
  const poleBase = Array.isArray(POLO_BRAZO) ? POLO_BRAZO : POLO_BRAZO.si_no;
  const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) < 1e-9);
  const ours = POSTURES as Readonly<Record<string, (typeof POSTURES)[PostureName]>>;
  const bad: string[] = [];
  for (const [name, s] of Object.entries(POSES)) {
    const p = ours[name];
    if (LEFT_POSE.includes(name)) {
      if (p) bad.push(`${name} está en LEFT_POSE, pero talk.ts la tiene`);
      continue;
    }
    if (!p) {
      bad.push(`${name} es nueva en el pipeline (pásala a talk.ts o apúntala en LEFT_POSE)`);
      continue;
    }
    const own = OWN_POSE[name] ?? [];
    if (own.includes("*")) {
      bad.push(`${name} ya está en el pipeline: no es solo de xenxo`);
      continue;
    }
    const diff: string[] = [];
    if (!own.includes("ik") && !same(p.ik, s.ik)) diff.push(`ik ${JSON.stringify(p.ik)} ≠ ${JSON.stringify(s.ik)}`);
    if (!own.includes("fingers") && !same(p.fingers, s.y)) diff.push(`fingers ≠ y ${JSON.stringify(s.y)}`);
    if (!own.includes("palm") && !same(p.palm, s.z)) diff.push(`palm ≠ z ${JSON.stringify(s.z)}`);
    if (!own.includes("hand") && p.hand !== (typeof s.dedos === "string" ? MANO[s.dedos] : undefined)) diff.push(`hand ≠ ${JSON.stringify(s.dedos)}`);
    if (!own.includes("pole") && !same(p.pole, s.polo ?? poleBase)) diff.push(`pole ≠ ${JSON.stringify(s.polo ?? poleBase)}`);
    if (diff.length) bad.push(`${name}: ${diff.join(", ")}`);
  }
  for (const name of Object.keys(ours)) if (!POSES[name] && !OWN_POSE[name]?.includes("*")) bad.push(`${name} no está en el pipeline ni es de xenxo (OWN_POSE)`);
  check(!bad.length, `las posturas son las del pipeline, salvo lo de xenxo${bad.length ? `: ${bad.join("; ")}` : ""}`);

  const forms = FORMS as Readonly<Record<string, readonly (readonly [string | null, string | null])[]>>;
  const badForm: string[] = [];
  for (const [g, variants] of Object.entries(FORMAS)) {
    if (LEFT_FORM.includes(g)) {
      if (forms[g]) badForm.push(`${g} está en LEFT_FORM, pero talk.ts la tiene`);
      continue;
    }
    if (!forms[g]) {
      badForm.push(`${g} es nueva en el pipeline (pásala a FORMS, con sus palabras en cueOf, o apúntala en LEFT_FORM)`);
      continue;
    }
    const want = variants.map((v) => v.map((n) => (n === "cuelga" ? null : n)));
    if (JSON.stringify(want) !== JSON.stringify(forms[g])) badForm.push(`${g}: ${JSON.stringify(forms[g])} ≠ ${JSON.stringify(want)}`);
  }
  for (const g of Object.keys(forms)) if (!FORMAS[g] && !OWN_FORM.includes(g)) badForm.push(`${g} no está en el pipeline ni es de xenxo (OWN_FORM)`);
  check(!badForm.length, `las formas (y sus variantes) son las del pipeline, con «cuelga» como null${badForm.length ? `: ${badForm.join("; ")}` : ""}`);

  const sameSet = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
  const lively = [...VIVAS.filter((n) => !LEFT_POSE.includes(n)), ...OWN_LIVELY];
  check(sameSet(LIVELY, lively), `las que siguen a la voz (LIVELY) son las VIVAS del pipeline${sameSet(LIVELY, lively) ? "" : `: ${[...LIVELY].sort().join(", ")} ≠ ${lively.sort().join(", ")}`}`);
  const held = [...SEGUIDOS.filter((g) => !LEFT_FORM.includes(g)), ...OWN_HELD];
  check(sameSet(HELD, held), `las que se sostienen todo el mensaje (HELD) son los SEGUIDOS del pipeline${sameSet(HELD, held) ? "" : `: ${[...HELD].sort().join(", ")} ≠ ${held.sort().join(", ")}`}`);
}

/* ------------------------------------------------------------------ */
/* Lo mismo a cualquier tasa de imágenes                                */
/* ------------------------------------------------------------------ */

console.log("A cualquier tasa de imágenes");
{
  const plan = planSay(LONG, seedOf("hz"));
  const at = (hz: number) => {
    const run: SayRun = { plan, t: 0 };
    const out = new Map<number, number[]>();
    for (let i = 0; i / hz <= plan.end; i++) {
      run.t = i / hz;
      const f = sampleSay(run, newSayFrame());
      // En los momentos que comparten las tres (cada doceavo de segundo).
      const k = Math.round(run.t * 12);
      if (Math.abs(k / 12 - run.t) < 1e-9) out.set(k, [...f.L.at, ...f.R.at, ...f.head, f.shoulders[0], f.shoulders[1]]);
    }
    return out;
  };
  const a = at(24), b = at(60), c = at(144);
  let worst = 0;
  for (const [k, v] of a) for (const other of [b, c]) {
    const w = other.get(k);
    if (w) for (let i = 0; i < v.length; i++) worst = Math.max(worst, Math.abs(v[i]! - w[i]!));
  }
  check(a.size > 50 && worst < 1e-6, `a 24, 60 y 144 Hz, lo mismo en cada momento (como mucho ${worst.toExponential(1)} de diferencia)`);
}

/* ------------------------------------------------------------------ */
/* Con los personajes de serie                                          */
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

/** Un mensaje por gesto: así salen todas las posturas, con sus variantes, sus golpes y sus movimientos. */
const SAMPLES = CUES.slice(0, 31).map(([text]) => text).concat([LONG]);

const presets = JSON.parse(readFileSync(new URL("../src/world/avatar-presets.json", import.meta.url), "utf8")) as { id: string; hash: string }[];
const idle = await clip("idle");
const { Rig } = await import("../src/world/people/rig.ts");
const { SHAPE } = await import("../src/world/people/shape.ts");

console.log("Con los personajes de serie");
const STEP = 1 / 15;
for (const pr of presets) {
  const vrm = await vrmOf(pr.hash);
  const h = vrm.humanoid;
  const node = (b: string) => h.getNormalizedBoneNode(b as VRMHumanBoneName)!;
  const mixer = new THREE.AnimationMixer(vrm.scene);
  const action = mixer.clipAction(createVRMAnimationClip(idle, vrm));
  action.play();
  const rig = new Rig(vrm, async () => null);
  const shape = rig.shape;
  check(!!shape, `${pr.id}: se mide lo que ocupa (shape.ts)`);
  if (!shape) continue;
  const bones = sayBones(vrm);
  const v0 = vrm.meta?.metaVersion === "0";
  /** Lo peor: lo más metido en su cuerpo (m, por dentro de su superficie), de qué gesto y dónde. */
  let worstIn = -Infinity, worstAt = "", worstWrist = 0, worstTwist = 0, nan = false, restBack = 0;
  const P = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), Q = new THREE.Quaternion();
  const twistOf = (q: THREE.Quaternion) => {
    const w = q.w < 0 ? -q.w : q.w, x = q.w < 0 ? -q.x : q.x;
    return 2 * Math.atan2(x, w);
  };
  const base = (t: number) => {
    action.time = t % idle.duration;
    mixer.update(0);
  };
  for (const text of SAMPLES) {
    const plan = planSay(text, seedOf(`${pr.id}:${text}`));
    const run: SayRun = { plan, t: 0 };
    const frame = newSayFrame();
    for (let t = 0; t <= plan.end + STEP; t += STEP) {
      run.t = t;
      base(t);
      sampleSay(run, frame);
      poseSay(bones, frame, 1, 1, v0, STEP, rig.trunk);
      h.normalizedHumanBonesRoot.updateMatrixWorld(true);
      shape.begin();
      for (const [side, a] of [["left", frame.L], ["right", frame.R]] as const) {
        for (const b of [`${side}UpperArm`, `${side}LowerArm`, `${side}Hand`]) {
          const q = node(b).quaternion;
          if (![q.x, q.y, q.z, q.w].every(Number.isFinite)) nan = true;
        }
        if (a.w < 0.5) continue;
        const s = side === "left" ? 0 : 1;
        // La muñeca y el antebrazo (con lo que abulta), y la palma y la punta del dedo corazón.
        node(`${side}LowerArm`).getWorldPosition(A);
        node(`${side}Hand`).getWorldPosition(B);
        for (const k of [0.4, 0.7, 1]) {
          P.copy(A).lerp(B, k);
          const d = shape.distance(P.x, P.y, P.z, SHAPE.torso | SHAPE.head) - shape.limb(s, 1, k) + 0.015;
          if (-d > worstIn) [worstIn, worstAt] = [-d, `${text.slice(0, 24)} ${t.toFixed(2)} s, antebrazo ${side}`];
        }
        const mids = ["Index", "Middle", "Ring", "Little"].map((f) => node(`${side}${f}Proximal`).getWorldPosition(new THREE.Vector3()));
        const knuckles = mids.reduce((x, y) => x.add(y), new THREE.Vector3()).multiplyScalar(1 / 4);
        P.copy(B).lerp(knuckles, 0.55);
        let d = shape.distance(P.x, P.y, P.z, SHAPE.torso | SHAPE.head) + 0.01;
        if (-d > worstIn) [worstIn, worstAt] = [-d, `${text.slice(0, 24)} ${t.toFixed(2)} s, palma ${side}`];
        node(`${side}MiddleDistal`).getWorldPosition(P);
        d = shape.distance(P.x, P.y, P.z, SHAPE.torso | SHAPE.head) + 0.012;
        if (-d > worstIn) [worstIn, worstAt] = [-d, `${text.slice(0, 24)} ${t.toFixed(2)} s, dedos ${side}`];
        // La muñeca (lo que se dobla la mano sobre el antebrazo) y lo que gira el antebrazo con la mano.
        const hand = node(`${side}Hand`).quaternion;
        const tw = twistOf(hand);
        Q.copy(hand).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -tw));
        worstWrist = Math.max(worstWrist, 2 * Math.acos(Math.min(1, Math.abs(Q.w))));
        worstTwist = Math.max(worstTwist, Math.abs(twistOf(node(`${side}LowerArm`).quaternion) + tw));
      }
    }
    // Al acabar, como el reposo (lo que se suma es cero): el brazo derecho donde lo deja el reposo.
    run.t = plan.end + 0.5;
    base(0);
    const restQ = node("rightUpperArm").quaternion.clone();
    sampleSay(run, frame);
    poseSay(bones, frame, 1, 1, v0, STEP, rig.trunk);
    restBack = Math.max(restBack, node("rightUpperArm").quaternion.angleTo(restQ));
  }
  if (PRINT) console.log(`    ${pr.id}: lo más metido ${cm(Math.max(0, worstIn))} (${worstAt}); muñeca ${deg(worstWrist)}; antebrazo ${deg(worstTwist)}`);
  check(worstIn < 0.012, `${pr.id}: ninguna mano, muñeca ni antebrazo se mete en su tronco ni en su cabeza (lo peor, ${cm(Math.max(0, worstIn))} dentro: ${worstAt})`);
  check(worstWrist <= 31 * DEG && worstTwist < 150 * DEG && !nan, `${pr.id}: la muñeca no pasa de 30° (${deg(worstWrist)}), ningún antebrazo se retuerce (${deg(worstTwist)}) y nada sale NaN`);
  check(restBack < 1e-6, `${pr.id}: al acabar, el brazo vuelve a lo suyo`);
}

if (fails) {
  console.log(`\n${fails} comprobaciones fallan`);
  process.exit(1);
}
console.log("\nHablar con el cuerpo: todo bien");
