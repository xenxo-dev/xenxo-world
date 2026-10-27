/**
 * Animaciones de los avatares humanoides (VRM): una sola biblioteca de clips VRMA
 * (Universal Animation Library de Quaternius, CC0) que sirve para cualquier VRM:
 * los personajes de serie de xenxo y los que sube la gente.
 *
 * Cada avatar tiene su mezclador: reposo ↔ andar ↔ trotar ↔ correr según la velocidad,
 * salto en el aire, y gestos (bailar, saludar, sentarse…) que viajan por la red.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, type VRMAnimation } from "@pixiv/three-vrm-animation";

/**
 * Gesto → clip. `once`: se reproduce una vez y vuelve al reposo; con `hold`, se queda en la última
 * pose (sentarse en el coche: el siguiente gesto, «sit», sigue desde ahí).
 */
export const EMOTE_CLIPS: Record<string, { clip: string; once?: boolean; hold?: boolean }> = {
  dance: { clip: "dance" },
  wave: { clip: "interact", once: true },
  talk: { clip: "talk" },
  sit: { clip: "sit_idle" },
  cheer: { clip: "jump_land", once: true },
  crouch: { clip: "crouch_idle" },
  // Subir y bajar del coche (world/vehicle): abrir la puerta, sentarse dentro y levantarse.
  car_open: { clip: "interact", once: true, hold: true },
  car_in: { clip: "sit_enter", once: true, hold: true },
  car_out: { clip: "sit_exit", once: true, hold: true },
};

const LOCOMOTION = ["idle", "walk", "jog", "sprint", "jump_loop"] as const;

let loader: GLTFLoader | null = null;
const cache = new Map<string, Promise<VRMAnimation | null>>();

export function loadVrma(name: string): Promise<VRMAnimation | null> {
  let p = cache.get(name);
  if (!p) {
    loader ??= new GLTFLoader().register((parser) => new VRMAnimationLoaderPlugin(parser));
    p = loader
      .loadAsync(`/anims/${name}.vrma`)
      .then((g) => ((g.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0] ?? null))
      .catch((e) => {
        console.warn("[xenxo] animación no disponible", name, e);
        return null;
      });
    cache.set(name, p);
  }
  return p;
}

/** Velocidad natural (m/s) de cada clip de desplazamiento: para que los pies no patinen. */
const NATURAL: Record<string, number> = { walk: 1.25, jog: 3.0, sprint: 5.8 };

export class VrmAnimator {
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private weights = new Map<string, number>();
  private emoteAction: THREE.AnimationAction | null = null;
  private emoteName: string | null = null;
  private onceDone = false;
  private disposed = false;
  /** ¿Ya hay al menos el reposo cargado? (si no, el avatar usa su pose de respaldo). */
  ready = false;

  constructor(private vrm: VRM) {
    this.mixer = new THREE.AnimationMixer(vrm.scene);
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
    const clip = createVRMAnimationClip(anim, this.vrm);
    const action = this.mixer.clipAction(clip);
    action.play();
    action.setEffectiveWeight(0);
    this.actions.set(name, action);
    return action;
  }

  /**
   * `speed` en m/s, `airborne` si está en el aire, `emote` el gesto pedido (o null).
   * Los pesos se suavizan para que las transiciones no den saltos.
   */
  update(dt: number, speed: number, airborne: boolean, emote: string | null) {
    const target: Record<string, number> = {};
    const known = emote ? EMOTE_CLIPS[emote] : undefined;

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
        a.play();
        this.emoteAction = a;
      });
    } else if (!known) {
      this.emoteName = null;
      this.emoteAction = null;
    }

    const emoting = !!(known && this.emoteAction && !this.onceDone && speed < 0.3 && !airborne);
    if (emoting) {
      target[known!.clip] = 1;
    } else if (airborne && this.actions.has("jump_loop")) {
      target.jump_loop = 1;
    } else {
      const s = speed;
      const walk = THREE.MathUtils.smoothstep(s, 0.12, 0.7);
      const jog = THREE.MathUtils.smoothstep(s, 1.9, 3.0);
      const sprint = THREE.MathUtils.smoothstep(s, 4.0, 5.4);
      target.idle = 1 - walk;
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

    // Suavizado y normalización de pesos.
    const k = Math.min(1, dt * 7);
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
  }

  dispose() {
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.vrm.scene);
  }
}
