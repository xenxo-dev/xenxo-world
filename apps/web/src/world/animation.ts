/**
 * Animaciones de los avatares humanoides (VRM): una sola biblioteca de clips VRMA
 * (Universal Animation Library 1 y 2 de Quaternius, CC0) que sirve para cualquier VRM:
 * los personajes de serie de xenxo y los que sube la gente.
 *
 * Cada avatar tiene su mezclador: reposo ↔ andar ↔ trotar ↔ correr según la velocidad,
 * salto en el aire, y gestos (bailar, saludar, sentarse…) que viajan por la red. Por capas:
 * los gestos de brazos (saludar, señalar, golpear…) siguen al andar sobre la parte de arriba del
 * cuerpo, y en el modo pelea la guardia sustituye al reposo (y sube los puños al andar). Después,
 * el esqueleto (people/rig.ts) pone lo que no es de clip: mirar, encajar golpes, la IK de las
 * parejas y las caídas con física.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, type VRMAnimation } from "@pixiv/three-vrm-animation";
import { buildGesture, buildGuard, interpolant, PROCEDURAL } from "./people/gestures";
import { Rig, type PersonFx } from "./people/rig";

/**
 * Gesto → clip. `once`: se reproduce una vez y vuelve al reposo; con `hold`, se queda en la última
 * pose (sentarse en el coche: el siguiente gesto, «sit», sigue desde ahí). `upper`: al andar sigue
 * en la parte de arriba del cuerpo; `overlay`: siempre solo arriba (las piernas, las de la base).
 * `fade`: segundos de transición al entrar; `speed`: velocidad del clip.
 */
export interface EmoteClip {
  clip: string;
  once?: boolean;
  hold?: boolean;
  upper?: boolean;
  overlay?: boolean;
  fade?: number;
  speed?: number;
}
export const EMOTE_CLIPS: Record<string, EmoteClip> = {
  dance: { clip: "dance" },
  wave: { clip: "wave", once: true, upper: true },
  talk: { clip: "talk", upper: true },
  sit: { clip: "sit_idle" },
  cheer: { clip: "cheer", once: true },
  crouch: { clip: "crouch_idle" },
  // Subir y bajar del coche (world/vehicle): abrir la puerta, sentarse dentro y levantarse.
  car_open: { clip: "interact", once: true, hold: true },
  car_in: { clip: "sit_enter", once: true, hold: true },
  car_out: { clip: "sit_exit", once: true, hold: true },
  // Al volante (people/gestures.ts). Por la red viaja como «sit»: quien lo dibuja sabe que conduce.
  drive: { clip: "drive" },
  // La gente de las ciudades (city/citizens.ts): jugar a una máquina y pulsar la expendedora.
  arcade: { clip: "arcade", upper: true },
  interact: { clip: "interact", once: true },
  // Gestos (people/gestures.ts y la librería 2).
  clap: { clip: "clap", upper: true },
  point: { clip: "point", once: true, upper: true },
  beckon: { clip: "beckon", upper: true },
  laugh: { clip: "laugh", upper: true },
  shrug: { clip: "shrug", once: true, upper: true },
  bow: { clip: "bow", once: true },
  fold_arms: { clip: "fold_arms", upper: true },
  nod: { clip: "nod", once: true, upper: true },
  shake_head: { clip: "shake_head", upper: true },
  phone: { clip: "phone", upper: true },
  // En pareja.
  high_five: { clip: "high_five", once: true, upper: true },
  hug: { clip: "hug", once: true, upper: true },
  handshake: { clip: "handshake", once: true, upper: true },
  // Modo pelea: golpes (jab, directo y gancho de la captura; patadas y empujones hechos aquí).
  punch: { clip: "punch_jab", once: true, upper: true, fade: 0.06, speed: 1.15 },
  cross: { clip: "punch_cross", once: true, upper: true, fade: 0.06, speed: 1.15 },
  hook: { clip: "hook", once: true, upper: true, fade: 0.06 },
  kick: { clip: "kick", once: true, fade: 0.06 },
  roundhouse: { clip: "roundhouse", once: true, fade: 0.06 },
  shove: { clip: "shove", once: true, upper: true, fade: 0.06 },
  push: { clip: "push", once: true, upper: true, fade: 0.06 },
  // Reacciones: en la parte de arriba, sobre la guardia o el reposo (las piernas, de la base).
  hit_head: { clip: "hit_head", once: true, overlay: true, fade: 0.04 },
  hit_body: { clip: "hit_chest", once: true, overlay: true, fade: 0.04 },
  hit_back: { clip: "hit_back", once: true, overlay: true, fade: 0.05 },
  hit_stagger: { clip: "hit_chest", once: true, overlay: true, fade: 0.04 },
  // En el suelo (si no hay física: caer redondo hacia atrás) y levantarse.
  hit_down: { clip: "ko_fall", once: true, hold: true, fade: 0.1 },
  get_up: { clip: "stand_up", once: true, hold: true, fade: 0.2 },
  // Parkour: el equilibrio sobre una viga va encima de andar (lo demás, en PK_SHOTS).
  pk_balance: { clip: "pk_balance", upper: true },
};

/**
 * Parkour (world/parkour/moves.ts): qué clip se ve en cada momento de cada movimiento y en qué
 * tiempo. De captura (Universal Animation Library 1 y 2, CC0): subir un borde (climb_up), deslizarse,
 * la voltereta y el salto encogido; hechos en código (people/gestures.ts): colgado, de lado colgado y
 * el equilibrio. `p` es el progreso del movimiento (0..1): el del propio jugador o, para los demás,
 * el que da el reloj con la duración típica (`dur`).
 */
interface PkShot {
  clip: string;
  time: number;
  /** Se reproduce solo (bucle) a este ritmo, en vez de ir al tiempo pedido. */
  rate?: number;
}
const PK_DUR: Record<string, number> = { pk_vault: 0.6, pk_mantle: 0.85, pk_climb: 1.05, pk_roll: 0.8, pk_slideup: 0.35, pk_land: 0.4 };
const CLIMB_UP_S = 0.667;
const _shot: PkShot = { clip: "idle", time: 0 };
function pkShot(emote: string, p: number, t: number, speed: number): PkShot | null {
  const s = _shot;
  s.rate = undefined;
  switch (emote) {
    case "pk_vault":
      // Las manos en la valla y las rodillas arriba (el principio de subir un borde) y, por encima,
      // encogido como en un salto ágil.
      if (p < 0.55) Object.assign(s, { clip: "climb_up", time: (p / 0.55) * 0.3 });
      else Object.assign(s, { clip: "ninja_loop", time: (p - 0.55) * 1.5 });
      return s;
    case "pk_mantle":
      return Object.assign(s, { clip: "climb_up", time: p * CLIMB_UP_S });
    case "pk_climb":
      // Tirando de los brazos (colgado, la IK dobla los codos) y después, encima del borde.
      if (p < 0.42) return Object.assign(s, { clip: "pk_hang", time: t, rate: 1 });
      return Object.assign(s, { clip: "climb_up", time: 0.13 + ((p - 0.42) / 0.58) * (CLIMB_UP_S - 0.13) });
    case "pk_hang":
      return Object.assign(s, { clip: "pk_hang", time: t, rate: 1 });
    case "pk_shimmy_l":
    case "pk_shimmy_r":
      return Object.assign(s, { clip: emote, time: t, rate: 1 });
    case "pk_wallrun_l":
    case "pk_wallrun_r":
      return Object.assign(s, { clip: "sprint", time: t, rate: 1.15 });
    case "pk_wallup":
      return Object.assign(s, { clip: "sprint", time: t, rate: 1.45 });
    case "pk_walljump":
      return Object.assign(s, { clip: "ninja_loop", time: t, rate: 1 });
    case "pk_slide":
      if (t < 0.5) return Object.assign(s, { clip: "slide_start", time: t * 1.66 });
      return Object.assign(s, { clip: "slide_loop", time: t, rate: 1 });
    case "pk_slideup":
      return Object.assign(s, { clip: "slide_exit", time: Math.min(0.5, p * 0.5) });
    case "pk_crouch":
      return speed < 0.3 ? Object.assign(s, { clip: "crouch_idle", time: t, rate: 1 }) : Object.assign(s, { clip: "crouch_walk", time: t, rate: THREE.MathUtils.clamp(speed / 1.2, 0.6, 1.4) });
    case "pk_roll":
      // La voltereta de la captura desde que las manos tocan el suelo.
      return Object.assign(s, { clip: "roll", time: 0.42 + p * 0.98 });
    case "pk_land":
      return Object.assign(s, { clip: "ninja_land", time: Math.min(0.9, p * 0.9) });
  }
  return null;
}

/**
 * Clips con desplazamiento (root motion): quien se mueve es el cuerpo (el parkour lo lleva por la
 * misma curva), así que la cadera se queda donde empieza.
 */
const IN_PLACE = new Set(["climb_up"]);

/** Deslizarse (también en el modo pelea, fuera de Vertical). */
const SLIDE_CLIPS = ["slide_start", "slide_loop", "slide_exit"];
/** Los clips del parkour, para tenerlos antes del primer salto (solo donde hay parkour). */
const PK_CLIPS = ["climb_up", "ninja_loop", "ninja_land", "slide_start", "slide_loop", "slide_exit", "roll", "crouch_idle", "crouch_walk", "pk_hang", "pk_shimmy_l", "pk_shimmy_r"];
let pkLoaded = false;
export function preloadParkour() {
  if (pkLoaded) return;
  pkLoaded = true;
  for (const name of PK_CLIPS) void loadVrma(name);
}

/** Gestos que siguen al andar (sobre la parte de arriba del cuerpo). */
export const UPPER_EMOTES = new Set(Object.entries(EMOTE_CLIPS).filter(([, c]) => c.upper || c.overlay).map(([n]) => n));

const LOCOMOTION = ["idle", "walk", "jog", "sprint", "jump_loop"] as const;

/** Clips montados aquí a partir de otros: la guardia, el gancho entero y los gestos procedurales. */
const DERIVED: Record<string, () => Promise<VRMAnimation | null>> = {
  guard: async () => {
    const [idle, jab] = await Promise.all([loadVrma("idle"), loadVrma("punch_jab")]);
    return idle && jab ? buildGuard(idle, jab) : null;
  },
};

let loader: GLTFLoader | null = null;
const cache = new Map<string, Promise<VRMAnimation | null>>();

export function loadVrma(name: string): Promise<VRMAnimation | null> {
  let p = cache.get(name);
  if (p) return p;
  const derived = DERIVED[name];
  if (derived) p = derived();
  else if (PROCEDURAL.has(name)) {
    p = Promise.all([loadVrma("idle"), loadVrma("guard"), loadVrma("punch_jab")]).then(([idle, guard, jab]) =>
      idle ? buildGesture(name, { idle, guard, jab }) : null,
    );
  } else {
    loader ??= new GLTFLoader().register((parser) => new VRMAnimationLoaderPlugin(parser));
    p = loader
      .loadAsync(`/anims/${name}.vrma`)
      .then((g) => {
        const a = (g.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0] ?? null;
        if (a && IN_PLACE.has(name)) inPlace(a);
        return a;
      })
      .catch((e) => {
        console.warn("[xenxo] animación no disponible", name, e);
        return null;
      });
  }
  cache.set(name, p);
  return p;
}

/** Deja la cadera de un clip donde está en su primer fotograma (sin desplazamiento). */
function inPlace(a: VRMAnimation) {
  const tr = a.humanoidTracks.translation.get("hips") as THREE.VectorKeyframeTrack | undefined;
  if (!tr) return;
  const v = tr.values;
  for (let i = 3; i < v.length; i += 3) {
    v[i] = v[0]!;
    v[i + 1] = v[1]!;
    v[i + 2] = v[2]!;
  }
}

/** Velocidad natural (m/s) de cada clip de desplazamiento: para que los pies no patinen. */
const NATURAL: Record<string, number> = { walk: 1.25, jog: 3.0, sprint: 5.8 };

/**
 * Peso de cada hueso en la capa de arriba (gestos al andar, guardia al andar, reacciones): la
 * columna a medias, de los hombros para arriba entero; la cadera y las piernas, nada.
 */
const UPPER_MASK: Record<string, number> = {
  spine: 0.45,
  chest: 0.8,
  upperChest: 1,
  neck: 1,
  head: 1,
  leftShoulder: 1,
  rightShoulder: 1,
  leftUpperArm: 1,
  rightUpperArm: 1,
  leftLowerArm: 1,
  rightLowerArm: 1,
  leftHand: 1,
  rightHand: 1,
};
/** La guardia al andar: los brazos enteros y el tronco y la cabeza solo un poco (que ande erguido). */
const GUARD_MASK: Record<string, number> = { ...UPPER_MASK, spine: 0.15, chest: 0.35, upperChest: 0.5, neck: 0.35, head: 0.35 };
const isFinger = (bone: string) => /^(left|right)(Thumb|Index|Middle|Ring|Little)/.test(bone);

/** Un gesto encima de la pose (Motion.gesture): su clip, si va una vez, su ritmo, cuánto lleva y su peso. */
interface Gest {
  clip: string | null;
  once: boolean;
  speed: number;
  t: number;
  w: number;
}

/** Una capa de arriba: el clip muestreado a mano sobre los huesos de la máscara. */
interface Layer {
  nodes: THREE.Object3D[];
  weights: number[];
  evals: THREE.Interpolant[];
}

const _q = new THREE.Quaternion();

export class VrmAnimator {
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private clips = new Map<string, THREE.AnimationClip>();
  private layers = new Map<string, Layer>();
  private weights = new Map<string, number>();
  private emoteAction: THREE.AnimationAction | null = null;
  private emoteName: string | null = null;
  private onceDone = false;
  private disposed = false;
  /** Peso de la capa de arriba del gesto y de la guardia (suavizados). */
  private upperW = 0;
  private guardUpperW = 0;
  private wantGuard = false;
  /** Gesto de brazos por encima de la pose (Motion.gesture): el pedido, el que se ve y el que se apaga. */
  private gestName: string | null = null;
  private gest: Gest = { clip: null, once: false, speed: 1, t: 0, w: 0 };
  private gestOut: Gest = { clip: null, once: false, speed: 1, t: 0, w: 0 };
  /** Lo que no es de clip: mirar, encajar golpes, parejas y caídas (people/rig.ts). */
  readonly rig: Rig;
  /** ¿Ya hay al menos el reposo cargado? (si no, el avatar usa su pose de respaldo). */
  ready = false;
  /** Parkour: el movimiento en curso y cuánto lleva (para los demás, el reloj es la única pista). */
  private pkName: string | null = null;
  private pkT = 0;

  constructor(private vrm: VRM) {
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.rig = new Rig(vrm, () => loadVrma("stand_up"));
    this.mixer.addEventListener("finished", (e) => {
      if (e.action === this.emoteAction && !(this.emoteName && EMOTE_CLIPS[this.emoteName]?.hold)) this.onceDone = true;
    });
    for (const name of LOCOMOTION) {
      void this.ensure(name).then((a) => {
        if (name === "idle" && a) this.ready = true;
      });
    }
  }

  private async ensure(name: string): Promise<THREE.AnimationAction | null> {
    const existing = this.actions.get(name);
    if (existing) return existing;
    const anim = await loadVrma(name);
    if (!anim || this.disposed) return null;
    const again = this.actions.get(name);
    if (again) return again;
    const clip = createVRMAnimationClip(anim, this.vrm);
    const action = this.mixer.clipAction(clip);
    action.play();
    action.setEffectiveWeight(0);
    this.actions.set(name, action);
    this.clips.set(name, clip);
    return action;
  }

  /** La capa de arriba de un clip (se monta la primera vez). */
  private layer(name: string): Layer | null {
    let l = this.layers.get(name);
    if (l) return l;
    const clip = this.clips.get(name);
    if (!clip) return null;
    l = { nodes: [], weights: [], evals: [] };
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf(".");
      const nodeName = track.name.slice(0, dot);
      if (track.name.slice(dot + 1) !== "quaternion") continue;
      const node = nodeName ? this.vrm.scene.getObjectByName(nodeName) : undefined;
      const bone = this.boneOf(node);
      if (!node || !bone) continue;
      const w = (name === "guard" ? GUARD_MASK : UPPER_MASK)[bone] ?? (isFinger(bone) ? 1 : 0);
      if (!w) continue;
      l.nodes.push(node);
      l.weights.push(w);
      l.evals.push(interpolant(track));
    }
    this.layers.set(name, l);
    return l;
  }

  private boneNames: Map<THREE.Object3D, string> | null = null;
  private boneOf(node: THREE.Object3D | undefined): string | null {
    if (!node) return null;
    if (!this.boneNames) {
      this.boneNames = new Map();
      const h = this.vrm.humanoid;
      for (const name of Object.keys(h.humanBones)) {
        const n = h.getNormalizedBoneNode(name as never);
        if (n) this.boneNames.set(n, name);
      }
    }
    return this.boneNames.get(node) ?? null;
  }

  /** Pone la capa `name` (en su tiempo `time`) sobre lo que ya hay, con peso `w`. */
  private applyLayer(name: string, time: number, w: number) {
    if (w < 0.001) return;
    const l = this.layer(name);
    if (!l) return;
    for (let i = 0; i < l.nodes.length; i++) {
      const r = l.evals[i]!.evaluate(time) as ArrayLike<number>;
      _q.set(r[0]!, r[1]!, r[2]!, r[3]!);
      l.nodes[i]!.quaternion.slerp(_q, w * l.weights[i]!);
    }
  }

  /**
   * `speed` en m/s, `airborne` si está en el aire, `emote` el gesto pedido (o null), `fight` si
   * está en modo pelea y `fx` lo que la gente le hace al esqueleto (golpes, parejas, caídas).
   * Los pesos se suavizan para que las transiciones no den saltos.
   */
  update(dt: number, speed: number, airborne: boolean, emote: string | null, fight = false, fx?: PersonFx | null, gesture?: string | null, pkP?: number) {
    const target: Record<string, number> = {};
    // Parkour: el equilibrio va encima de andar; lo demás manda sobre todo el cuerpo.
    if (emote === "pk_balance") {
      gesture = gesture ?? "pk_balance";
      emote = null;
    }
    if (emote !== this.pkName) {
      this.pkName = emote?.startsWith("pk_") ? emote : null;
      this.pkT = 0;
    } else this.pkT += dt;
    const shot = this.pkName ? pkShot(this.pkName, pkP ?? Math.min(1, this.pkT / (PK_DUR[this.pkName] ?? 1)), this.pkT, speed) : null;
    if (shot) emote = null;
    const known = emote ? EMOTE_CLIPS[emote] : undefined;

    // La guardia y el deslizarse (people/slide.ts) se cargan al entrar en el modo pelea.
    if (fight && !this.wantGuard) {
      this.wantGuard = true;
      void this.ensure("guard");
      for (const c of SLIDE_CLIPS) void this.ensure(c);
    }

    // Al sentarse en el coche, la pose de conducir ya tiene que estar: si no, mientras carga se pondría de pie.
    if (emote === "car_in") void this.ensure("drive");
    // Gesto: se carga bajo demanda la primera vez.
    if (known && emote !== this.emoteName) {
      this.emoteName = emote;
      this.onceDone = false;
      this.emoteAction = null;
      void this.ensure(known.clip).then((a) => {
        if (!a || this.emoteName !== emote) return;
        a.reset();
        a.setLoop(known.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        a.clampWhenFinished = true;
        a.timeScale = known.speed ?? 1;
        a.play();
        this.emoteAction = a;
      });
    } else if (!known) {
      this.emoteName = null;
      this.emoteAction = null;
    }

    const moving = speed >= 0.3 || airborne;
    const live = !!(known && this.emoteAction && !this.onceDone);
    const full = live && !known!.overlay && !moving;
    const upper = live && (known!.overlay || (moving && !!known!.upper));
    const guard = fight && this.actions.has("guard");
    const pkAction = shot ? this.actions.get(shot.clip) : undefined;
    if (shot && !pkAction) void this.ensure(shot.clip);
    if (pkAction) {
      target[shot!.clip] = 1;
    } else if (full) {
      target[known!.clip] = 1;
    } else if (airborne && this.actions.has("jump_loop")) {
      target.jump_loop = 1;
    } else {
      const s = speed;
      const walk = THREE.MathUtils.smoothstep(s, 0.12, 0.7);
      const jog = THREE.MathUtils.smoothstep(s, 1.9, 3.0);
      const sprint = THREE.MathUtils.smoothstep(s, 4.0, 5.4);
      // Parado en el modo pelea, la guardia en vez del reposo.
      target[guard ? "guard" : "idle"] = 1 - walk;
      target.walk = walk * (1 - jog);
      target.jog = jog * (1 - sprint);
      target.sprint = sprint;
      // Sin el clip aún: su peso pasa al anterior disponible.
      for (const [from, to] of [["sprint", "jog"], ["jog", "walk"], ["walk", "idle"]] as const) {
        if (!this.actions.has(from) && target[from]) {
          target[to] = (target[to] ?? 0) + target[from]!;
          target[from] = 0;
        }
      }
    }

    // Suavizado y normalización de pesos (más rápido al entrar en un golpe o una reacción, y en el parkour).
    const fade = pkAction ? 0.09 : live ? (known!.fade ?? 0.15) : 0.15;
    const k = Math.min(1, dt / fade);
    let sum = 0;
    for (const [name] of this.actions) {
      const w = (this.weights.get(name) ?? 0) + ((target[name] ?? 0) - (this.weights.get(name) ?? 0)) * k;
      this.weights.set(name, w);
      sum += w;
    }
    for (const [name, action] of this.actions) {
      const w = sum > 0.001 ? this.weights.get(name)! / sum : name === "idle" ? 1 : 0;
      action.setEffectiveWeight(w);
      const natural = NATURAL[name];
      if (natural) action.timeScale = THREE.MathUtils.clamp(speed / natural, 0.55, 1.6);
    }
    // El parkour va al tiempo que toca (los guionados) o a su ritmo (los bucles).
    if (pkAction && shot) {
      if (shot.rate !== undefined) pkAction.timeScale = shot.rate;
      else {
        pkAction.time = shot.time;
        pkAction.timeScale = 0;
      }
    }
    this.mixer.update(dt);

    // Capas de arriba: los puños en guardia al andar y el gesto que sigue al moverse.
    this.guardUpperW += ((guard && moving && !full && !pkAction ? 0.9 : 0) - this.guardUpperW) * Math.min(1, dt / 0.15);
    const g = this.actions.get("guard");
    if (g) this.applyLayer("guard", g.time, this.guardUpperW);
    this.upperW += ((upper ? 1 : 0) - this.upperW) * Math.min(1, dt / (upper ? fade : 0.15));
    if (this.emoteAction && known) this.applyLayer(known.clip, this.emoteAction.time, this.upperW);
    this.applyGesture(dt, gesture ?? null);

    this.rig.apply(dt, fx ?? null);
  }

  /**
   * Un gesto de brazos encima de lo que haya (sentado, jugando, charlando): la capa de arriba de su
   * clip, con su propio tiempo. Los que van una vez se apagan al acabar; al cambiar de gesto (o
   * quitarlo), el anterior se apaga poco a poco mientras entra el nuevo (sin saltos).
   */
  private applyGesture(dt: number, gesture: string | null) {
    const k = Math.min(1, dt / 0.18);
    if (gesture !== this.gestName) {
      this.gestName = gesture;
      const def = gesture ? EMOTE_CLIPS[gesture] : undefined;
      if (def) {
        // El que había pasa a apagarse (si había uno a la vista).
        if (this.gest.clip && this.gest.w > 0.02) Object.assign(this.gestOut, this.gest);
        this.gest.clip = def.clip;
        this.gest.once = !!def.once;
        this.gest.speed = def.speed ?? 1;
        this.gest.t = 0;
        this.gest.w = 0;
        void this.ensure(def.clip);
      }
    }
    this.gestFrame(this.gestOut, dt, 0, k);
    this.gestFrame(this.gest, dt, this.gestName ? 1 : 0, k);
  }

  private gestFrame(g: Gest, dt: number, on: number, k: number) {
    if (!g.clip) return;
    const clip = this.clips.get(g.clip);
    if (!clip) return;
    g.t += dt * g.speed;
    const want = on && (!g.once || g.t < clip.duration - 0.15) ? 1 : 0;
    g.w += (want - g.w) * k;
    if (g.w < 0.001 && !want) {
      g.clip = null;
      return;
    }
    this.applyLayer(g.clip, g.once ? Math.min(g.t, clip.duration) : g.t % clip.duration, g.w);
  }

  dispose() {
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.vrm.scene);
  }
}
