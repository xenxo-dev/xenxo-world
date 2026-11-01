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
};

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
      .then((g) => ((g.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0] ?? null))
      .catch((e) => {
        console.warn("[xenxo] animación no disponible", name, e);
        return null;
      });
  }
  cache.set(name, p);
  return p;
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
  /** Lo que no es de clip: mirar, encajar golpes, parejas y caídas (people/rig.ts). */
  readonly rig: Rig;
  /** ¿Ya hay al menos el reposo cargado? (si no, el avatar usa su pose de respaldo). */
  ready = false;

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
  update(dt: number, speed: number, airborne: boolean, emote: string | null, fight = false, fx?: PersonFx | null) {
    const target: Record<string, number> = {};
    const known = emote ? EMOTE_CLIPS[emote] : undefined;

    // La guardia se carga al entrar en el modo pelea.
    if (fight && !this.wantGuard) {
      this.wantGuard = true;
      void this.ensure("guard");
    }

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
    if (full) {
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

    // Suavizado y normalización de pesos (más rápido al entrar en un golpe o una reacción).
    const fade = live ? (known!.fade ?? 0.15) : 0.15;
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
    this.mixer.update(dt);

    // Capas de arriba: los puños en guardia al andar y el gesto que sigue al moverse.
    this.guardUpperW += ((guard && moving && !full ? 0.9 : 0) - this.guardUpperW) * Math.min(1, dt / 0.15);
    const g = this.actions.get("guard");
    if (g) this.applyLayer("guard", g.time, this.guardUpperW);
    this.upperW += ((upper ? 1 : 0) - this.upperW) * Math.min(1, dt / (upper ? fade : 0.15));
    if (this.emoteAction && known) this.applyLayer(known.clip, this.emoteAction.time, this.upperW);

    this.rig.apply(dt, fx ?? null);
  }

  dispose() {
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.vrm.scene);
  }
}
