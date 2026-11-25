/**
 * Hablar con el cuerpo: quien escribe en el chat lo dice con los brazos, las manos, los hombros y la
 * cabeza mientras está su bocadillo (y la gente de las ciudades, sus frases), encima de lo que esté
 * haciendo: también andando, solo la parte de arriba. Sale todo del texto y de la id del mensaje, así
 * que cada cliente monta la misma actuación sin nada de red ni del servidor.
 *
 * Las posturas, cuándo se ponen y su «vida» vienen del pipeline de vídeo de Xen (bench/xen_toon/
 * mh_plano.py, afinado a mano con el dueño el 24 y el 25/11/2026). Su conclusión: los brazos copiados
 * de vídeos no sirven para conversar (salían cruzados, «sujetando una caja» o en garra, y quien
 * escuchaba gesticulaba igual), así que van por posturas hechas a mano: dónde va la muñeca respecto al
 * hombro, hacia dónde van los dedos y la palma, la forma de la mano y hacia dónde cae el codo. Sobre
 * la frase:
 * - se parte por sus pausas (. ! ? : ; … y la coma, si el trozo pasa de 1,6 s) y cada trozo lleva el
 *   gesto de lo que dice (cueOf: saludar, preguntar, reírse, dar las gracias…; si no, hablar), en una
 *   variante distinta de la del anterior;
 * - sube a la postura 0,4 s antes de hablar, cambia en las pausas y vuelve al acabar;
 * - golpes en las palabras con peso (la primera de cada trozo y las largas), con una cabezada;
 * - la vida: la muñeca va con un muelle detrás de su postura (se pasa un poco y se asienta), con un
 *   vaivén lento y distinto en cada mano; las manos suben en lo fuerte y se arrastran detrás del
 *   antebrazo al moverse deprisa; el hombro sube con la mano, y cada gesto tiene su movimiento
 *   (negar, regañar, rogar, saludar…).
 * Como aquí no hay voz, las palabras se reparten a un ritmo de habla (más deprisa si el mensaje es
 * largo) y la «voz» de cada una es un golpe suave sobre su duración.
 *
 * Sin Three.js ni nada del navegador (se prueba en Node: test/talk.mts). Los brazos los resuelve el
 * animador con la IK de people/gestures.ts (animation.ts → applySay); aquí solo se dice dónde va cada
 * cosa en cada momento.
 */
import type { Hand } from "./gestures";

export type V3 = [number, number, number];

/* ------------------------------------------------------------------ */
/* Posturas                                                             */
/* ------------------------------------------------------------------ */

/** El brazo de las posturas del pipeline (m, del hombro a la muñeca) y el de referencia de people/gestures.ts (ARM). */
const SRC_ARM = 0.55;
const REF_ARM = 0.49;
const K = REF_ARM / SRC_ARM;

interface Posture {
  ik: V3;
  fingers: V3;
  palm: V3;
  hand: Hand;
  pole: V3;
}
/** Hacia dónde cae el codo si la postura no dice otra cosa: hacia fuera, abajo y algo atrás. */
const POLE: V3 = [0.7, -0.35, -0.8];
const pose = (ik: V3, fingers: V3, palm: V3, hand: Hand, pole: V3 = POLE): Posture => ({ ik, fingers, palm, hand, pole });

/**
 * Las posturas, iguales a los dos lados, como en el pipeline: (fuera, delante, arriba), «fuera» hacia
 * su lado. La muñeca respecto al hombro (m, para un brazo de 55 cm), hacia dónde van los dedos, hacia
 * dónde mira la palma, la forma de la mano y hacia dónde cae el codo. Tal cual están en mh_plano.py
 * (POSES), salvo saludar, que es la mano del gesto «wave» de xenxo.
 */
const P = {
  explica: pose([-0.02, 0.32, -0.33], [-0.25, 1, 0.15], [-0.7, 0, 0.7], "relaxed"), // delante de la tripa
  pregunta: pose([0.05, 0.28, -0.33], [0, 1, 0.1], [-0.3, 0.05, 1], "open"),
  hombros: pose([0.11, 0.2, -0.36], [0.25, 1, 0.1], [0, 0, 1], "open"),
  senala: pose([0.02, 0.44, -0.17], [0, 1, 0.12], [-1, 0, -0.3], "point"),
  apunta: pose([-0.1, 0.42, -0.1], [-0.1, 1, 0.15], [-1, 0, -0.2], "point"), // a quien mira: el índice hacia delante
  // (algo más abierta que en el pipeline: con hombreras, el antebrazo rozaba el hombro)
  celebra: pose([0.13, 0.12, 0.02], [0, 0.2, 1], [-1, 0, 0], "fist"),
  niega: pose([-0.02, 0.33, -0.2], [0, 0.25, 1], [0, 1, 0], "open"),
  regana: pose([0, 0.36, -0.14], [-0.05, 0.5, 0.86], [-1, 0, 0], "point"),
  cuenta: pose([-0.05, 0.3, -0.24], [0.05, 0.35, 0.94], [0, -1, 0.3], "point"),
  ruega: pose([-0.075, 0.3, -0.3], [-0.3, 0.55, 0.78], [-1, 0, 0], "relaxed"),
  rie: pose([-0.1, 0.21, -0.42], [-0.9, 0.3, -0.1], [0, -1, 0], "relaxed"), // la mano a la tripa
  sorpresa: pose([0.08, 0.24, -0.12], [0.1, 0.3, 1], [0, 1, 0], "open"),
  // Las de la comedia: la mano a la frente («¡madre mía!»), al pecho («¿yo?», «gracias»).
  frente: pose([-0.13, 0.2, 0.27], [-0.55, 0.15, 0.82], [0, -1, 0.1], "relaxed", [1, 0.2, -0.3]),
  pecho: pose([-0.14, 0.13, -0.17], [-0.95, 0.1, 0.3], [0, -1, 0], "relaxed", [1, -0.2, -0.6]),
  exaspera: pose([0.14, 0.24, 0.02], [0.35, 0.4, 0.85], [0, 0.2, 1], "open", [1, -0.4, -0.5]), // «¡¿pero qué dices?!»
  manos_cabeza: pose([-0.07, 0.05, 0.37], [-0.35, 0.15, 0.92], [-0.85, 0, -0.5], "relaxed", [1, 0.1, 0.25]),
  mejillas: pose([-0.1, 0.13, 0.25], [-0.15, 0.1, 0.98], [-0.95, -0.25, 0], "relaxed", [0.45, 0.1, -1]), // «¡ay, madre!»
  toma: pose([0.05, 0.24, -0.22], [0, 0.45, 0.89], [-1, 0, 0], "fist", [0.9, -0.35, -0.6]),
  palmas: pose([-0.11, 0.3, -0.2], [-0.15, 0.6, 0.78], [-1, 0, 0], "open", [0.8, -0.3, -0.7]),
  anda_ya: pose([0.02, 0.28, -0.22], [0.3, 0.95, 0], [0, 0, -1], "open"),
  pulgares: pose([0.04, 0.3, -0.16], [0, 0.5, 0.86], [-1, 0, 0], "thumb"),
  barbilla: pose([-0.14, 0.22, 0.17], [-0.2, 0.3, 0.93], [-0.3, -0.95, 0], "curl", [0.4, -0.3, -1]), // pensando
  saluda: pose([0.124, 0.101, 0.225], [0.05, 0, 1], [-0.15, 1, 0], "open", [1, 0, -1]),
} satisfies Record<string, Posture>;
export type PostureName = keyof typeof P;
export const POSTURES: Readonly<Record<PostureName, Readonly<Posture>>> = P;

/**
 * Lo que puede hacer quien habla con todo el mensaje (o con un trozo), y sus variantes: qué postura
 * lleva cada brazo (izquierdo, derecho; null = lo que ya estuviera haciendo).
 */
type Form = readonly [PostureName | null, PostureName | null];
const FORMS = {
  habla: [["explica", "explica"], [null, "explica"], ["explica", null], [null, "pregunta"]],
  explica: [["explica", "explica"], [null, "explica"]],
  pregunta: [["pregunta", "pregunta"], [null, "pregunta"]],
  hombros: [["hombros", "hombros"]],
  senala: [[null, "senala"]],
  apunta: [[null, "apunta"]],
  celebra: [["celebra", "celebra"]],
  niega: [[null, "niega"]],
  regana: [[null, "regana"]],
  cuenta: [["explica", "cuenta"]],
  ruega: [["ruega", "ruega"]],
  rie: [[null, "rie"]],
  sorpresa: [["sorpresa", "sorpresa"]],
  frente: [[null, "frente"]],
  pecho: [[null, "pecho"]],
  exaspera: [["exaspera", "exaspera"]],
  manos_cabeza: [["manos_cabeza", "manos_cabeza"]],
  mejillas: [["mejillas", "mejillas"]],
  toma: [[null, "toma"], ["toma", "toma"]],
  palmas: [["palmas", "palmas"]],
  anda_ya: [[null, "anda_ya"]],
  pulgares: [[null, "pulgares"], ["pulgares", "pulgares"]],
  barbilla: [[null, "barbilla"]],
  saluda: [[null, "saluda"]],
  // Asentir: solo la cabeza.
  asiente: [[null, null]],
} as const satisfies Record<string, readonly Form[]>;
export type Gesture = keyof typeof FORMS;

/** Lo que es una acción seguida o una emoción que se sostiene: el mismo gesto todo el mensaje. */
const HELD = new Set<Gesture>(["celebra", "ruega", "niega", "regana", "sorpresa", "rie", "frente", "pecho", "exaspera", "manos_cabeza", "mejillas", "toma", "palmas", "anda_ya", "pulgares", "barbilla", "saluda", "asiente"]);
/** Las posturas que siguen a la voz (suben en lo fuerte). */
const LIVELY = new Set<PostureName>(["explica", "pregunta", "cuenta", "senala", "apunta", "hombros", "sorpresa", "exaspera", "niega", "regana", "ruega", "pulgares", "anda_ya", "toma", "saluda"]);

/* ------------------------------------------------------------------ */
/* Del texto al gesto                                                   */
/* ------------------------------------------------------------------ */

/** Sin mayúsculas ni tildes (las ñ se quedan: no cambian nada aquí), con los emojis tal cual. */
export function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const has = (n: string, words: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${words})(?=$|[^\\p{L}\\p{N}])`, "u").test(n);
const starts = (n: string, words: string) => new RegExp(`^[^\\p{L}\\p{N}]*(?:${words})(?=$|[^\\p{L}\\p{N}])`, "u").test(n);

/**
 * El gesto de un mensaje (castellano e inglés, y los emojis). El primero que encaja; si no, hablar.
 * `amp`: más amplio con exclamaciones o en mayúsculas.
 */
export function cueOf(text: string): { g: Gesture; amp: number; question: boolean } {
  const n = plain(text).trim();
  const words = n.match(/[\p{L}\p{N}']+/gu) ?? [];
  const few = words.length <= 4;
  const question = /\?\s*$/.test(text.trim()) || /^\s*¿/.test(text);
  const letters = text.replace(/[^\p{L}]/gu, "");
  const caps = letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  const amp = Math.min(1.4, 1 + (/!/.test(text) ? 0.2 : 0) + (caps ? 0.15 : 0));
  const g = ((): Gesture => {
    if (/[😂🤣😆😹]/u.test(text) || has(n, "(?:ja|je|ji|ha|he|hi){2,}|j+a+j+a*|lo+l|x+d+|lmf?ao|rofl")) return "rie";
    if (/👋/u.test(text) || starts(n, "hola+|holi+|buenas|buenos dias|hey+|ey+|hi+|hello|hiya|saludos|wenas|ola+|adios|chao+|chau|bye+|hasta luego|hasta manana|nos vemos|see you|cya")) return "saluda";
    if (/🙏/u.test(text) || has(n, "porfa+|por favor|porfis|please|pls|plz|te lo ruego|os lo ruego")) return "ruega";
    if (has(n, "gracias|grax|thx|thanks|thank you|ty|merci")) return "pecho";
    if (/👏/u.test(text) || has(n, "bravo|ole+|aplausos|clap")) return "palmas";
    // («toma» y «vamos» a secas son de todos los días: solo con exclamación)
    if (starts(n, "toma+ ya|chupate esa") || /^[\s¡]*toma+\s*!/u.test(n)) return "toma";
    if (/[🎉🥳🏆🙌]/u.test(text) || has(n, "gane|ganamos|hemos ganado|he ganado|yay+|wi{2,}|si{3,}|yes{2,}|let'?s go|lets go") || /(?:^|[^\p{L}])vamo+s*\s*!/u.test(n)) return "celebra";
    if (/👍/u.test(text) || (few && has(n, "genial|perfecto|top|guay|brutal|crack|bien hecho|ok|okey|okay|vale|gg|great|nice|cool|awesome|perfect|buenisimo"))) return "pulgares";
    if (/🤷/u.test(text) || has(n, "no se|ni idea|idk|quien sabe|me da igual|meh|whatever|who knows")) return "hombros";
    if (/🤯|😱/u.test(text) || has(n, "no puede ser|madre mia|dios mio|omg|oh my god|no me lo creo")) return "manos_cabeza";
    if (has(n, "ay+ madre|ay+|aw+|que mono|que mona|que bonito|que bonita") || /[😍🥰🥺]/u.test(text)) return "mejillas";
    if (has(n, "uf+|buf+|puf+|que calor|que cansancio|uff")) return "frente";
    if (has(n, "anda ya|venga ya|no me digas")) return "anda_ya";
    if (has(n, "en serio|pero que|pero bueno|seriously|come on|wtf")) return "exaspera";
    if (/[😮😲]/u.test(text) || has(n, "wow+|guau|hala+|ostras|increible|flipa|flipo|alucino|alucinante|que fuerte|whoa|amazing")) return "sorpresa";
    if (few && starts(n, "no+|nope|nah|nunca|jamas|never|para nada|ni de broma")) return "niega";
    if (few && starts(n, "si+|sip|sisi|claro|exacto|correcto|obvio|yes|yeah|yep|yup|sure|exactly")) return "asiente";
    if (has(n, "cuidado|ojo|no hagas eso|para ya|basta ya|careful|watch out|stop it")) return "regana";
    if (/🤔/u.test(text) || starts(n, "m{2,}|hm+|eh{2,}|a ver|creo que|quizas?|tal vez|maybe|i think|let me think")) return "barbilla";
    // (sin «esta», «estas» ni «esto»: sin tildes son «está», «estás»… y señalaría sin parar)
    if (has(n, "mira+|mirad|fijate|estos|aqui|look|these|here")) return "apunta";
    if (has(n, "alli|alla|ahi|over there")) return "senala";
    if (/\b[1-3]\s*[,.)-]\s*[2-3]\b/.test(n) || has(n, "uno,? dos|primero|segundo|first|second")) return "cuenta";
    if (question) return "pregunta";
    if (/\p{N}/u.test(n)) return "explica";
    return "habla";
  })();
  return { g, amp: g === "explica" && /\p{N}/u.test(n) ? Math.max(amp, 1.2) : amp, question };
}

/* ------------------------------------------------------------------ */
/* El plan de un mensaje                                                */
/* ------------------------------------------------------------------ */

/** Lo que tarda en empezar a «hablar» (s): antes, los brazos suben a su postura. */
const LEAD = 0.45;
/** Lo más que dura lo hablado (s): con el bocadillo a la vista (7 s), y que dé tiempo a bajar los brazos. */
const MAX_SPEECH = 5.2;
/** Lo más deprisa que se habla un mensaje largo (veces el ritmo normal); lo que no quepa, sin gestos. */
const MAX_RATE = 1.6;

interface Word {
  w: string;
  s: number;
  e: number;
  letters: number;
  /** Acaba frase (. ! ? : ; …) o coma. */
  stop: boolean;
  comma: boolean;
}
interface Key {
  t: number;
  p: PostureName | null;
}
interface Frase {
  a: number;
  b: number;
  g: Gesture;
  pos: Form;
  /** Lo amplio de sus golpes y de sus movimientos propios (1 = normal). */
  amp: number;
}
export interface SayPlan {
  /** Cuándo acaba todo (s desde el principio): después, nada. */
  end: number;
  /** El gesto del primer trozo. */
  g: Gesture;
  /** Cuándo empieza y acaba lo «hablado» (s). */
  t0: number;
  t1: number;
  /** Las posturas de cada brazo en el tiempo (izquierdo, derecho). */
  keys: [Key[], Key[]];
  frases: Frase[];
  beats: { t: number; pos: Form; amp: number }[];
  words: { s: number; e: number; beat: boolean }[];
}

/** Un generador sencillo y determinista (mulberry32): la misma id, las mismas variantes en todos los clientes. */
export function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** De un texto (la id de un mensaje) a una semilla (FNV-1a). */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Las palabras del mensaje con su tiempo, a ritmo de habla. */
function timed(text: string): Word[] {
  const raw = text.split(/\s+/).filter(Boolean);
  const out: Word[] = [];
  let t = 0;
  for (const w of raw) {
    const letters = (w.match(/[\p{L}\p{N}]/gu) ?? []).length;
    const pict = (w.match(/\p{Extended_Pictographic}/gu) ?? []).length;
    if (!letters && !pict) continue;
    const dur = letters ? Math.min(0.75, Math.max(0.14, 0.07 + 0.045 * letters)) : 0.3;
    const stop = /[.!?;:…]["»”')\]]*$/u.test(w);
    const comma = !stop && /,["»”')\]]*$/u.test(w);
    out.push({ w, s: t, e: t + dur, letters, stop, comma });
    t += dur + (stop ? 0.3 : comma ? 0.16 : 0.04);
  }
  // Más deprisa si no cabe; y lo que siga sin caber, fuera.
  const total = out.length ? out[out.length - 1]!.e : 0;
  const rate = Math.min(MAX_RATE, Math.max(1, total / MAX_SPEECH));
  const kept: Word[] = [];
  for (const w of out) {
    const s = LEAD + w.s / rate, e = LEAD + w.e / rate;
    if (e - LEAD > MAX_SPEECH && kept.length) break;
    kept.push({ ...w, s, e });
  }
  return kept;
}

/**
 * La actuación de un mensaje: qué postura lleva cada brazo en cada momento, los golpes y los trozos
 * (cada uno con el gesto de lo que dice: «¡Hola! ¿Qué tal?» saluda y luego pregunta), con el ritmo de
 * las palabras. `seed`: de la id del mensaje (las variantes).
 */
export function planSay(text: string, seed: number): SayPlan {
  const words = timed(text);
  const r = rand(seed);
  const keys: [Key[], Key[]] = [[{ t: 0, p: null }], [{ t: 0, p: null }]];
  const frases: Frase[] = [];
  const beats: { t: number; pos: Form; amp: number }[] = [];
  if (!words.length) return { end: 0, g: "habla", t0: 0, t1: 0, keys, frases, beats, words: [] };
  const t0 = words[0]!.s, t1 = words[words.length - 1]!.e;

  const key = (side: 0 | 1, t: number, p: PostureName | null) => {
    const list = keys[side];
    const last = list[list.length - 1]!;
    list.push({ t: Math.max(t, last.t + 0.06), p });
  };
  // Los trozos: por sus pausas (y la coma si el trozo ya pasa de 1,6 s).
  const trozos: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    if ((w.stop || (w.comma && w.e - cur[0]!.s > 1.6)) && w !== words[words.length - 1]) {
      trozos.push(cur);
      cur = [];
    }
  }
  if (cur.length) trozos.push(cur);

  let prev: Form | null = null;
  const beatW = new Set<Word>();
  trozos.forEach((tr, j) => {
    const lastTrozo = j === trozos.length - 1;
    const a = tr[0]!.s, b = tr[tr.length - 1]!.e;
    const { g, amp } = cueOf(tr.map((w) => w.w).join(" "));
    const all: readonly Form[] = FORMS[g];
    const options = all.filter((f) => !prev || f[0] !== prev[0] || f[1] !== prev[1]);
    const pick = (options.length ? options : all)[Math.floor(r() * (options.length || all.length))]!;
    prev = pick;
    for (const side of [0, 1] as const) {
      const p = pick[side];
      const before = keys[side][keys[side].length - 1]!;
      if (j === 0) {
        // De lo que hiciera, sube a la postura justo antes de hablar.
        key(side, a - 0.4, before.p);
        key(side, Math.max(a + 0.02, keys[side][keys[side].length - 1]!.t + 0.3), p);
      } else {
        // De un trozo al siguiente, en la pausa.
        key(side, a - 0.15, before.p);
        key(side, Math.max(a + 0.2, keys[side][keys[side].length - 1]!.t + 0.3), p);
      }
      key(side, b + (lastTrozo ? 0.25 : 0), p);
    }
    frases.push({ a, b, g, pos: pick, amp });
    // Golpes: la primera palabra del trozo y las que tienen peso, separados al menos 0,42 s (también
    // del último del trozo anterior). Lo que se sostiene (reírse, saludar…) ya se mueve solo: uno.
    let last = beats.length ? beats[beats.length - 1]!.t : -9;
    tr.forEach((w, k) => {
      if (HELD.has(g) && k > 0) return;
      if ((k === 0 || w.e - w.s >= 0.22 || w.letters >= 6) && w.s - last >= 0.42) {
        beats.push({ t: w.s, pos: pick, amp });
        beatW.add(w);
        last = w.s;
      }
    });
  });
  // Al acabar, los brazos vuelven a lo suyo.
  for (const side of [0, 1] as const) key(side, t1 + 0.85, null);
  const end = Math.max(keys[0][keys[0].length - 1]!.t, keys[1][keys[1].length - 1]!.t) + 0.05;
  return {
    end,
    g: frases[0]!.g,
    t0,
    t1,
    keys,
    frases,
    beats,
    words: words.map((w) => ({ s: w.s, e: w.e, beat: beatW.has(w) })),
  };
}

/* ------------------------------------------------------------------ */
/* Cada momento                                                         */
/* ------------------------------------------------------------------ */

/** Una actuación en curso: su plan, cuánto lleva (s; lo avanza quien la dibuja) y sus muelles. */
export interface SayRun {
  plan: SayPlan;
  t: number;
  /** Las muñecas (lo lleva `sampleSay`). */
  springs?: [Spring, Spring];
}
interface Spring {
  x: V3;
  v: V3;
  px: V3;
  pv: V3;
  /** Pasos dados (de `STEP` s). */
  n: number;
}

/** Un brazo en un momento, ya en los ejes de VRM de su lado y con el brazo de referencia (people/gestures.ts). */
export interface SayArm {
  /** Cuánto manda sobre lo que ya hubiera (0–1). */
  w: number;
  at: V3;
  pole: V3;
  palm: V3;
  fingers: V3;
  hand: Hand;
}
/** Lo que se hace en un momento: los brazos y lo que se suma al tronco (grados, como en people/gestures.ts). */
export interface SayFrame {
  L: SayArm;
  R: SayArm;
  /** Cabeza (x: hacia delante, y: a su izquierda, z: a su derecha). Se reparte con el cuello. */
  head: V3;
  chest: V3;
  /** Lo que suben los hombros (grados), izquierdo y derecho. */
  shoulders: [number, number];
}

const arm = (): SayArm => ({ w: 0, at: [0, 0, 0], pole: [0, -1, 0], palm: [0, -1, 0], fingers: [1, 0, 0], hand: "relaxed" });
export const newSayFrame = (): SayFrame => ({ L: arm(), R: arm(), head: [0, 0, 0], chest: [0, 0, 0], shoulders: [0, 0] });

/** Los muelles de las muñecas: frecuencia propia (Hz) y amortiguación (las del pipeline), a pasos fijos. */
const SPRING_HZ = 2.4;
const SPRING_ZETA = 0.62;
const STEP = 1 / 120;
const OMEGA = 2 * Math.PI * SPRING_HZ;

const quintic = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (6 * u - 15) + 10);
};
/** 0 → 1 → 0 en la ventana de un trozo, con 0,18 s de entrada y salida. */
const env = (t: number, a: number, b: number, r = 0.18) => Math.max(0, Math.min(1, (t - a) / r, (b - t) / r));
const pulse = (x: number) => (x >= 0 && x <= 1 ? Math.sin(Math.PI * x) ** 2 : 0);
const TAU = 2 * Math.PI;

/** Un temblor suave y distinto en cada mano (la suma de dos senos por eje, como `_ruido` del pipeline). */
function noise(t: number, side: 0 | 1, out: V3) {
  const k = side === 0 ? 0 : 3.7;
  out[0] = (Math.sin(TAU * 0.43 * t + k) + 0.5 * Math.sin(TAU * 1.13 * t + 1.3 * k)) / 1.5;
  out[1] = (Math.sin(TAU * 0.37 * t + 2.1 + k) + 0.5 * Math.sin(TAU * 0.91 * t + k)) / 1.5;
  out[2] = (Math.sin(TAU * 0.53 * t + 0.7 + k) + 0.5 * Math.sin(TAU * 1.27 * t + 2.2 * k)) / 1.5;
  return out;
}

/** El índice del último cambio de postura ya pasado. */
function keyAt(list: Key[], t: number): number {
  let i = 0;
  while (i < list.length - 1 && list[i + 1]!.t <= t) i++;
  return i;
}

interface Blend {
  w: number;
  ik: V3;
  fingers: V3;
  palm: V3;
  pole: V3;
  hand: Hand;
  /** La postura que manda ahora (la del último cambio), o null. */
  now: PostureName | null;
}
const blend = (): Blend => ({ w: 0, ik: [0, 0, 0], fingers: [0, 1, 0], palm: [0, 0, 1], pole: [...POLE], hand: "relaxed", now: null });
const lerp3 = (a: V3, b: V3, k: number, out: V3) => {
  out[0] = a[0] + (b[0] - a[0]) * k;
  out[1] = a[1] + (b[1] - a[1]) * k;
  out[2] = a[2] + (b[2] - a[2]) * k;
};
const copy3 = (a: V3, out: V3) => {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
};

/** La postura de un brazo en `t`: entre dos cambios, con la curva suave del pipeline (sin parada brusca). */
function postureAt(list: Key[], t: number, out: Blend) {
  const i = keyAt(list, t);
  const a = list[i]!, b = list[i + 1];
  out.now = a.p;
  const pa = a.p ? P[a.p] : null;
  if (!b) {
    out.w = pa ? 1 : 0;
    let j = i;
    while (j > 0 && !list[j]!.p) j--;
    const last = list[j]!.p;
    setFrom(last ? P[last] : P.explica, out);
    return out;
  }
  const k = quintic((t - a.t) / Math.max(1e-6, b.t - a.t));
  const pb = b.p ? P[b.p] : null;
  if (pa && pb) {
    lerp3(pa.ik, pb.ik, k, out.ik);
    lerp3(pa.fingers, pb.fingers, k, out.fingers);
    lerp3(pa.palm, pb.palm, k, out.palm);
    lerp3(pa.pole, pb.pole, k, out.pole);
    out.hand = k < 0.5 ? pa.hand : pb.hand;
    out.w = 1;
  } else if (pa) {
    setFrom(pa, out);
    out.w = 1 - k;
  } else if (pb) {
    setFrom(pb, out);
    out.w = k;
  } else {
    // Entre dos ratos sin postura: la que viene (o la última), para que el muelle ya esté allí
    // cuando el brazo empiece a subir (si no, saldría del hombro).
    out.w = 0;
    let j = i + 1;
    while (j < list.length && !list[j]!.p) j++;
    if (j >= list.length) for (j = i; j >= 0 && !list[j]!.p; j--);
    setFrom(j >= 0 && j < list.length && list[j]!.p ? P[list[j]!.p!] : P.explica, out);
  }
  return out;
}
function setFrom(p: Posture, out: Blend) {
  copy3(p.ik, out.ik);
  copy3(p.fingers, out.fingers);
  copy3(p.palm, out.palm);
  copy3(p.pole, out.pole);
  out.hand = p.hand;
}

/** Lo que suena en `t` (0–1): un golpe suave por palabra, más fuerte en las de golpe; y si se está hablando. */
function voice(plan: SayPlan, t: number): { e: number; h: number } {
  let e = 0;
  for (const w of plan.words) {
    if (t < w.s) break;
    if (t <= w.e) e = Math.max(e, Math.sin((Math.PI * (t - w.s)) / Math.max(0.05, w.e - w.s)) ** 2 * (w.beat ? 1 : 0.6));
  }
  const h = Math.min(1, Math.max(0, (t - (plan.t0 - 0.25)) / 0.15), Math.max(0, (plan.t1 + 0.3 - t) / 0.15));
  return { e, h };
}

const _bl: [Blend, Blend] = [blend(), blend()];
const _n: V3 = [0, 0, 0];

/**
 * Dónde quiere ir la muñeca de un brazo en `t` (ejes del pipeline, brazo de 55 cm): su postura, los
 * golpes, el movimiento propio de cada gesto, el vaivén, la voz y el temblor. Es lo que persigue el
 * muelle. Deja en `_bl[side]` la postura de ese momento.
 */
function wristTarget(plan: SayPlan, side: 0 | 1, t: number, out: V3): Blend {
  const b = postureAt(plan.keys[side], t, _bl[side]);
  copy3(b.ik, out);
  // La vida: un vaivén lento y distinto en cada mano.
  const f0 = side === 0 ? 0 : 1.7;
  out[0] += Math.sin(TAU * 0.31 * t + f0) * 0.009;
  out[1] += Math.sin(TAU * 0.23 * t + 2.1 + f0) * 0.009;
  out[2] += Math.sin(TAU * 0.41 * t + 0.6 + f0) * 0.009;
  // El movimiento propio de cada postura, mientras dura su trozo.
  let A = 1;
  for (const f of plan.frases) {
    const e = env(t, f.a, f.b);
    if (e <= 0) continue;
    A = f.amp;
    switch (f.pos[side]) {
      case "niega":
        out[0] += 0.05 * A * Math.sin(TAU * 2.4 * t) * e;
        break;
      case "regana":
        out[2] += 0.025 * A * Math.sin(TAU * 3.0 * t) * e;
        break;
      case "ruega":
        out[2] += 0.02 * Math.sin(TAU * 2.0 * t) * e;
        break;
      case "celebra":
        out[2] += 0.04 * A * Math.sin(TAU * 2.2 * t) * e;
        break;
      case "exaspera":
        out[2] += 0.03 * A * Math.sin(TAU * 2.2 * t) * e;
        break;
      case "palmas":
        // Aplaude: las manos se juntan y se separan.
        out[0] += 0.05 * (0.5 + 0.5 * Math.sin(TAU * 3.2 * t)) * e;
        break;
      case "anda_ya":
        out[0] += 0.05 * A * Math.sin(Math.PI * 1.6 * t) ** 2 * e;
        break;
      case "manos_cabeza":
      case "mejillas":
        out[2] += 0.006 * Math.sin(TAU * 1.1 * t) * e;
        break;
      case "saluda":
        // De lado a lado, como quien saluda de lejos.
        out[0] += 0.05 * A * Math.sin(TAU * 2.2 * (t - f.a)) * e;
        break;
      default:
        break;
    }
  }
  // Los golpes: la mano marca la palabra.
  for (const g of plan.beats) {
    const x = (t - (g.t - 0.1)) / 0.34;
    if (x < 0 || x > 1) continue;
    const k = pulse(x) * g.amp;
    switch (g.pos[side]) {
      case null:
        break;
      case "toma":
        out[1] -= 0.02 * k;
        out[2] -= 0.12 * k;
        break;
      case "senala":
        out[1] += 0.045 * k;
        out[2] -= 0.01 * k;
        break;
      case "celebra":
        out[2] += 0.05 * k;
        break;
      case "niega":
      case "regana":
        out[2] -= 0.015 * k;
        break;
      default:
        out[1] += 0.012 * k;
        out[2] -= 0.04 * k;
    }
  }
  // Con la «voz»: arriba en lo fuerte; y el temblor de quien habla (algo menos callado).
  const { e, h } = voice(plan, t);
  for (const f of plan.frases) if (t >= f.a - 0.4) A = f.amp;
  if (b.now && LIVELY.has(b.now)) {
    out[2] += 0.045 * A * (e - 0.4) * h;
    out[1] += 0.025 * (e - 0.4) * h;
  }
  noise(t, side, _n);
  const amt = 0.022 * h + 0.009;
  out[0] += _n[0] * amt;
  out[1] += _n[1] * amt;
  out[2] += _n[2] * amt;
  return b;
}

const _tgt: V3 = [0, 0, 0];
function springs(run: SayRun): [Spring, Spring] {
  if (!run.springs) {
    const mk = (side: 0 | 1): Spring => {
      wristTarget(run.plan, side, 0, _tgt);
      return { x: [..._tgt], v: [0, 0, 0], px: [..._tgt], pv: [0, 0, 0], n: 0 };
    };
    run.springs = [mk(0), mk(1)];
  }
  return run.springs;
}

/** Lleva el muelle de una muñeca hasta `t`, a pasos fijos (lo mismo a cualquier tasa de imágenes). */
function stepSpring(plan: SayPlan, side: 0 | 1, s: Spring, t: number) {
  // Mucho rato sin dibujarse: sin recorrer todo lo de en medio, desde donde toca ahora.
  if (t - s.n * STEP > 1) {
    s.n = Math.ceil(t / STEP);
    wristTarget(plan, side, s.n * STEP, _tgt);
    copy3(_tgt, s.x);
    copy3(_tgt, s.px);
    s.v[0] = s.v[1] = s.v[2] = s.pv[0] = s.pv[1] = s.pv[2] = 0;
  }
  while (s.n * STEP < t) {
    copy3(s.x, s.px);
    copy3(s.v, s.pv);
    s.n++;
    wristTarget(plan, side, s.n * STEP, _tgt);
    for (let i = 0; i < 3; i++) {
      const acc = (_tgt[i]! - s.x[i]!) * OMEGA * OMEGA - s.v[i]! * 2 * SPRING_ZETA * OMEGA;
      s.v[i] = s.v[i]! + acc * STEP;
      s.x[i] = s.x[i]! + s.v[i]! * STEP;
    }
  }
}

const _x: V3 = [0, 0, 0];
const _v: V3 = [0, 0, 0];
const _fing: V3 = [0, 0, 0];

/** Del pipeline (fuera, delante, arriba) a VRM (x a la izquierda de la persona, y arriba, z delante), en su lado. */
function toVrm(side: 0 | 1, v: V3, scale: number, out: V3) {
  out[0] = (side === 0 ? v[0] : -v[0]) * scale;
  out[1] = v[2] * scale;
  out[2] = v[1] * scale;
}

/**
 * Lo que hace en este momento (`run.t`) quien habla: los brazos (ya en los ejes de VRM de su lado y con
 * el brazo de referencia), la cabeza, el pecho y los hombros. Lleva sus muelles hasta ese momento.
 */
export function sampleSay(run: SayRun, out: SayFrame): SayFrame {
  const plan = run.plan;
  const t = Math.min(run.t, plan.end);
  const sp = springs(run);
  let hy = 0, hp = 0, hr = 0, cp = 0;
  let up = 0;
  for (const side of [0, 1] as const) {
    const s = sp[side];
    stepSpring(plan, side, s, t);
    // Entre los dos últimos pasos, lo que toca a este momento.
    const k = 1 - Math.min(1, Math.max(0, (s.n * STEP - t) / STEP));
    lerp3(s.px, s.x, k, _x);
    lerp3(s.pv, s.v, k, _v);
    const b = postureAt(plan.keys[side], t, _bl[side]);
    const a = side === 0 ? out.L : out.R;
    a.w = b.w;
    a.hand = b.hand;
    toVrm(side, _x, K, a.at);
    toVrm(side, b.pole, 1, a.pole);
    toVrm(side, b.palm, 1, a.palm);
    // La mano, arrastrada detrás del antebrazo cuando va deprisa.
    copy3(b.fingers, _fing);
    const speed = Math.hypot(_v[0], _v[1], _v[2]);
    if (speed > 0.05) {
      const pull = Math.min(0.4, speed * 0.45) / speed;
      const fl = Math.hypot(_fing[0], _fing[1], _fing[2]) || 1;
      for (let i = 0; i < 3; i++) _fing[i] = _fing[i]! / fl - _v[i]! * pull;
    }
    toVrm(side, _fing, 1, a.fingers);
    // El hombro sube cuando la mano sube (lo que pasa de 25 cm sobre la de colgar).
    const high = _x[2] + 0.525;
    out.shoulders[side] = Math.min(8, Math.max(0, (high - 0.25) * 14)) * b.w;
  }
  // La cabeza y los hombros, con lo que pide cada trozo.
  for (const f of plan.frases) {
    const e = env(t, f.a, f.b);
    if (e <= 0) continue;
    switch (f.g) {
      case "hombros":
        up += 9 * e;
        hr += 6 * e;
        hp -= 2 * e;
        break;
      case "celebra":
      case "sorpresa":
        up += 5 * e;
        hp -= 3 * e;
        break;
      case "rie":
        up += 3 * Math.sin(TAU * 4.5 * t) * e;
        hp -= 4 * e;
        break;
      case "niega":
        hy += 7 * Math.sin(TAU * 2.4 * t) * e;
        break;
      case "exaspera":
        hp -= 5 * e;
        up += 8 * e;
        hr += 4 * Math.sin(TAU * 1.1 * t) * e;
        break;
      case "manos_cabeza":
        hp += 6 * e;
        hy += 6 * Math.sin(TAU * 0.9 * t) * e;
        cp += 3 * e;
        break;
      case "mejillas":
        up += 7 * e;
        hy += 5 * Math.sin(TAU * 1.4 * t) * e;
        break;
      case "toma":
      case "palmas":
      case "pulgares":
        hp -= 3 * e;
        break;
      case "anda_ya":
        hy -= 9 * e;
        hp -= 3 * e;
        break;
      case "asiente":
        hp += 7 * Math.sin(TAU * 2.0 * (t - f.a)) * e;
        break;
      case "pecho":
        // Gracias: una pequeña inclinación.
        hp += 6 * e;
        cp += 4 * e;
        break;
      case "saluda":
        hr -= 4 * e;
        hp -= 2 * e;
        break;
      case "pregunta":
        // En las preguntas la cabeza se ladea (y algo hacia atrás).
        hr += 7 * e;
        hp -= 4 * e;
        break;
      default:
        break;
    }
  }
  // Cabezadas en los golpes.
  for (const g of plan.beats) {
    const x = (t - (g.t - 0.1)) / 0.34;
    if (x >= 0 && x <= 1) hp += 2.5 * g.amp * pulse(x);
  }
  // Coge aire antes de empezar (el pecho se abre y los hombros suben un poco).
  const inhale = pulse((t - (plan.t0 - 0.45)) / 0.6);
  cp -= 1.5 * inhale;
  up += 1.2 * inhale;
  out.head[0] = hp;
  out.head[1] = hy;
  out.head[2] = hr;
  out.chest[0] = cp;
  out.chest[1] = 0;
  out.chest[2] = 0;
  out.shoulders[0] += up;
  out.shoulders[1] += up;
  return out;
}

/** Si ya ha acabado. */
export const sayDone = (run: SayRun) => run.t >= run.plan.end;

/** El tronco por fuera alrededor de un hueso (m): hasta dónde llega por delante, por detrás y a cada lado. */
export interface TrunkBand {
  bone: "hips" | "spine" | "chest" | "upperChest";
  side: number;
  front: number;
  back: number;
}
/**
 * El tronco de un avatar (people/rig.ts → trunk): hacia dónde miran delante y su izquierda en el marco
 * del modelo (los VRM 0.x miran a −z), de cuánto es su brazo respecto al de referencia (`k`), lo que
 * miden su brazo, su antebrazo y su mano, y el tronco por fuera alrededor de sus huesos (de abajo arriba).
 */
export interface Trunk {
  fwd: V3;
  left: V3;
  k: number;
  arm: [number, number];
  hand: number;
  bands: TrunkBand[];
}
