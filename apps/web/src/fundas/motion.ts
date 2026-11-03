/**
 * La funda en movimiento, dentro del configurador. Se monta con su esqueleto en pose T (la misma que
 * se exporta: three.ts → buildSkinned), se arma un VRM en memoria (sin exportar ni volver a cargar) y
 * se anima con lo mismo que en el mundo (world/animation.ts): reposo, andar, trotar, correr, saltar,
 * los gestos y la guardia con sus golpes. Así se ve cómo se moverá esa funda antes de guardarla.
 */
import * as THREE from "three";
import { VRM, VRMHumanoid, type VRM1Meta, type VRMHumanBones } from "@pixiv/three-vrm";
import { VrmAnimator } from "../world/animation";
import { addSprings, springBodyOf } from "../world/springs";
import type { Recipe } from "./recipe";
import { buildSkinned, kitData } from "./three";

/** Lo que se puede ver hacer a la funda. */
export type Act = "idle" | "walk" | "jog" | "sprint" | "jump" | "dance" | "wave" | "clap" | "gestures" | "fight";
export const ACTS: Act[] = ["idle", "walk", "jog", "sprint", "jump", "dance", "wave", "clap", "gestures", "fight"];

/** Velocidad (m/s) de cada desplazamiento, en el sitio (como en una cinta). */
const SPEED: Partial<Record<Act, number>> = { walk: 1.25, jog: 3.0, sprint: 5.8 };
/** Gesto de cada acción (los que van una vez se repiten cada poco). */
const EMOTE: Partial<Record<Act, { name: string; every?: number }>> = {
  dance: { name: "dance" },
  wave: { name: "wave", every: 3.2 },
  clap: { name: "clap" },
};
/**
 * Secuencias: varios gestos seguidos (con un respiro entre uno y otro) y, en la pelea, la guardia con
 * sus combinaciones (jab, directo y gancho; patada frontal y circular). [gesto, desde, hasta] en s.
 */
const SEQ: Partial<Record<Act, { cycle: number; steps: [string, number, number][] }>> = {
  gestures: {
    cycle: 15.3,
    steps: [
      ["point", 0, 1.9],
      ["beckon", 2.3, 4.5],
      ["shrug", 4.9, 6.35],
      ["laugh", 6.75, 9.35],
      ["nod", 9.75, 12.25],
      ["bow", 12.65, 14.5],
    ],
  },
  fight: {
    cycle: 7,
    steps: [
      ["punch", 0.8, 1.42],
      ["cross", 1.42, 2.2],
      ["hook", 2.2, 2.95],
      ["kick", 4.2, 4.86],
      ["roundhouse", 4.86, 5.64],
    ],
  },
};
/** Salto: ciclo de 1,6 s, en el aire de 0,15 a 0,85 s, hasta 40 cm. */
const JUMP = { cycle: 1.6, from: 0.15, air: 0.7, height: 0.4 };

export interface MovingFunda {
  root: THREE.Group;
  /** ¿Han llegado ya las animaciones? (hasta entonces estaría en pose T). */
  ready(): boolean;
  update(dt: number, act: Act): void;
  dispose(): void;
}

export async function buildMoving(r: Recipe): Promise<MovingFunda> {
  const { kit } = await kitData();
  const { root, bones, meshes } = await buildSkinned(r);
  const humanBones: Record<string, { node: THREE.Object3D }> = {};
  kit.rig.bones.forEach((b, i) => {
    const name = kit.humanoid[b.name];
    if (name) humanBones[name] = { node: bones[i]! };
  });
  const humanoid = new VRMHumanoid(humanBones as unknown as VRMHumanBones);
  root.add(humanoid.normalizedHumanBonesRoot);
  const meta: VRM1Meta = { metaVersion: "1", name: "funda", authors: ["xenxo.io"], licenseUrl: "https://vrm.dev/licenses/1.0/" };
  const vrm = new VRM({ scene: root, meta, humanoid });
  // Recorte con una esfera holgada (cabe cualquier gesto), como los personajes del mundo.
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    const sphere = m.geometry.boundingBox!.clone().expandByScalar(0.6).getBoundingSphere(new THREE.Sphere());
    m.boundingSphere = sphere;
    m.geometry.boundingSphere = sphere.clone();
  }
  // El pelo con muelles, como en el mundo (world/springs.ts).
  const body = springBodyOf(vrm);
  let springs: ReturnType<typeof addSprings> = null;
  try {
    springs = body ? addSprings(root, body) : null;
  } catch (e) {
    console.warn("[xenxo] sin física en el pelo", e);
  }
  const animator = new VrmAnimator(vrm);
  let t = 0;
  let last: Act | null = null;
  return {
    root,
    ready: () => animator.ready,
    update(dt, act) {
      if (act !== last) {
        t = 0;
        last = act;
      }
      t += dt;
      let airborne = false;
      root.position.y = 0;
      if (act === "jump") {
        const u = ((t % JUMP.cycle) - JUMP.from) / JUMP.air;
        if (u > 0 && u < 1) {
          airborne = true;
          root.position.y = 4 * JUMP.height * u * (1 - u);
        }
      }
      const e = EMOTE[act];
      // Un gesto que va una vez: se suelta un momento para que vuelva a empezar.
      let emote = e && !(e.every && t % e.every < 0.12) ? e.name : null;
      const seq = SEQ[act];
      if (seq) {
        const u = t % seq.cycle;
        for (const [name, from, to] of seq.steps) if (u >= from && u < to) emote = name;
      }
      animator.update(dt, SPEED[act] ?? 0, airborne, emote, act === "fight");
      vrm.update(dt);
      springs?.update(dt);
    },
    dispose() {
      animator.dispose();
      root.removeFromParent();
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose(); // las texturas quedan en su caché (three.ts, paint.ts)
      }
    },
  };
}
