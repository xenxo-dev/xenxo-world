/**
 * Caídas del modo pelea con física de verdad: Rapier (dimforge, Apache-2.0, el mismo motor que el
 * coche) mueve una cápsula del tamaño de una persona con el impulso del golpe; rueda, choca con las
 * paredes y la gente y se para en el suelo. Se carga aparte, al activar el modo pelea.
 */
import { forEachSolidBox, forEachSolidMesh, solidsVersion } from "../collision";
import { world } from "../../net/world-store";
import type { StaticSource, TumbleSim } from "../vehicle/physics";

const source: StaticSource = {
  version: solidsVersion,
  boxes: forEachSolidBox,
  meshes: forEachSolidMesh,
  bounds: () => world.walk,
};

let sim: TumbleSim | null = null;
let loading: Promise<TumbleSim | null> | null = null;

/** Carga Rapier y prepara la simulación (una vez). Devuelve null si no se puede (y se cae sin física). */
export function loadTumble(): Promise<TumbleSim | null> {
  loading ??= import("../vehicle/physics")
    .then(async ({ loadRapier, TumbleSim }) => {
      sim = new TumbleSim(await loadRapier(), source);
      return sim;
    })
    .catch((e) => {
      console.warn("[xenxo] sin física para las caídas", e);
      return null;
    });
  return loading;
}

/** La simulación, si ya está cargada. */
export function tumbleSim(): TumbleSim | null {
  return sim;
}
