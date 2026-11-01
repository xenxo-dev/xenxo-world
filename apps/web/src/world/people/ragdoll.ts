/**
 * Caídas del modo pelea con física de verdad: quien recibe un golpe fuerte (o se lo lleva el coche,
 * si es gente de decorado) pasa a ser un cuerpo articulado de Rapier (dimforge, Apache-2.0, el mismo
 * motor que el coche): doce sólidos (cadera, abdomen, pecho, cabeza, brazos, antebrazos, muslos y
 * piernas) unidos por articulaciones con sus límites (rótulas en hombros, caderas y cuello; bisagras
 * en codos y rodillas) y algo de tono muscular que se va soltando. Rueda, choca con las paredes y se
 * para en el suelo de verdad; después se levanta con la animación (people/rig.ts).
 *
 * Aquí solo los tipos, la carga (aparte, al activar el modo pelea o al primer golpe) y el paso de
 * la simulación, una vez por frame para todos (PeopleFx). Cada cliente simula a quien ve caer: no
 * viaja nada nuevo por la red.
 */
import { forEachSolidBox, forEachSolidMesh, solidsVersion } from "../collision";
import { world } from "../../net/world-store";
import { graphics } from "../graphics";
import type { StaticSource } from "../vehicle/physics";

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

/** Un sólido: dónde está su hueso y su giro (mundo), su cápsula (de `a` a `b`, en su marco) y su densidad. */
export interface RagdollPart {
  pos: V3;
  quat: Q4;
  a: V3;
  b: V3;
  r: number;
  density: number;
  /** Una esfera más (el pie en la pierna, para que no se hunda). */
  extra?: { at: V3; r: number };
}

/**
 * Una articulación entre `parent` y `child` en `anchor` (mundo). Los sólidos van orientados como sus
 * huesos normalizados (en T, sin giro), así que el giro de uno respecto al otro es el del hueso.
 * `hinge`: eje de la bisagra (el mismo en el marco de los dos) y `range` su recorrido (rad); en las
 * rótulas, `min` y `max`: ángulo en torno a cada eje del padre (rad). `frame`: el giro de los huesos
 * que no se simulan entre los dos (clavícula, cuello…); `target`: la pose del golpe (tono).
 */
export interface RagdollJoint {
  child: number;
  parent: number;
  anchor: V3;
  hinge?: V3;
  range?: [number, number];
  min?: V3;
  max?: V3;
  frame: Q4;
  target: Q4;
}

export interface RagdollSpec {
  parts: RagdollPart[];
  joints: RagdollJoint[];
  /** Velocidad de todo el cuerpo al empezar (la que llevaba). */
  vel: V3;
  /** Golpes: a qué sólido, en qué punto (mundo) y con qué impulso (N·s). */
  impulses: { part: number; point: V3; vec: V3 }[];
  /** Tono muscular al principio, el que queda y cuánto tarda en soltarse (s). */
  tone: number;
  toneMin: number;
  toneTau: number;
  /** Rebote (0 = nada; las caídas de 8 bits rebotan) y rozamiento. */
  bounce: number;
  friction: number;
}

export interface RagdollHandle {
  /** Posición (3 por sólido) y giro (4 por sólido), en el mundo, tras el último paso. */
  readonly pos: Float32Array;
  readonly quat: Float32Array;
  /** Lo más rápido que se mueve algún sólido (m/s) y su giro (rad/s). */
  speed: number;
  spin: number;
  /** Segundos desde que empezó y segundos que lleva casi quieto. */
  age: number;
  still: number;
  alive: boolean;
  /** Ayuda a darse la vuelta (boca abajo → boca arriba): 1 o −1 según el lado; 0, nada. */
  roll(dir: number): void;
  remove(): void;
}

export interface RagdollWorldApi {
  spawn(spec: RagdollSpec): RagdollHandle | null;
  step(dt: number): void;
  readonly active: number;
}

const source: StaticSource = {
  version: solidsVersion,
  boxes: forEachSolidBox,
  meshes: forEachSolidMesh,
  bounds: () => world.walk,
};

let sim: RagdollWorldApi | null = null;
let loading: Promise<RagdollWorldApi | null> | null = null;

/** Carga Rapier y el mundo de las caídas (una vez). Devuelve null si no se puede (se cae sin física). */
export function loadRagdolls(): Promise<RagdollWorldApi | null> {
  loading ??= import("./ragdoll-sim")
    .then(async ({ RagdollWorld }) => {
      const { loadRapier } = await import("../vehicle/physics");
      sim = new RagdollWorld(await loadRapier(), source, () => graphics.features.ragdolls);
      return sim;
    })
    .catch((e) => {
      console.warn("[xenxo] sin física para las caídas", e);
      return null;
    });
  return loading;
}

/** El mundo de las caídas, si ya está cargado. */
export function ragdolls(): RagdollWorldApi | null {
  return sim;
}

/** Un paso para todos (desde PeopleFx, antes de dibujar a nadie). */
export function stepRagdolls(dt: number) {
  if (sim?.active) sim.step(dt);
}
