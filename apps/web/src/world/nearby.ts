/**
 * Contenido por cercanía en los lugares grandes (distritos de más de un chunk): lo que construye la
 * gente (portales, monumentos, piezas de las parcelas) solo se carga y se dibuja a menos de
 * LOAD_RADIUS, y se suelta a más de UNLOAD_RADIUS. Lo del sistema (la ciudad, el suelo) siempre.
 *
 * Se recalcula dos veces por segundo, no por frame, y React solo se entera si cambia el conjunto.
 */
import { useEffect, useSyncExternalStore } from "react";
import { world } from "../net/world-store";
import { self } from "./self";

const LOAD_RADIUS = 150;
const UNLOAD_RADIUS = 185;
const EVERY_MS = 500;

let near = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();

/**
 * ¿Es de quien hace el lugar (el sistema, o la ficha de un distrito de la comunidad)? Sus luces son
 * siempre las mismas mientras se está en él. Las de la gente (parcelas, zona de pruebas) van y vienen,
 * y cuántas luces puntuales hay va dentro de cada shader: con cada una que apareciera o se fuera se
 * recompilarían todos los materiales del lugar, con la página parada, a todo el que estuviera allí.
 * Por eso solo las del lugar son luces de verdad (Entities.tsx); las demás se pintan como un charco de
 * luz en el suelo, en todos los niveles.
 */
export function placeOwned(owner: string): boolean {
  return owner === "system" || owner.startsWith("dst_");
}

/** ¿Se dibuja esta entidad? En lugares pequeños, siempre. */
export function isNear(entityId: string): boolean {
  return !world.big || near.has(entityId);
}

function recompute() {
  if (!world.big) return;
  const next = new Set<string>();
  let changed = false;
  for (const e of world.entities.values()) {
    const t = e.components["transform@1"] as { p: number[]; parent: string | null } | undefined;
    // Lo del sistema, siempre; y las luces de la ficha de un distrito (si no, al alejarse cambiaría
    // cuántas hay: placeOwned).
    if (e.owner === "system" || !t || t.parent || !e.components["mesh@1"] || (e.components["light@1"] && placeOwned(e.owner))) {
      next.add(e.entity_id);
      continue;
    }
    const dx = t.p[0]! - self.x, dz = t.p[2]! - self.z;
    const d2 = dx * dx + dz * dz;
    const was = near.has(e.entity_id);
    if (d2 <= LOAD_RADIUS * LOAD_RADIUS || (was && d2 <= UNLOAD_RADIUS * UNLOAD_RADIUS)) next.add(e.entity_id);
    if (was !== next.has(e.entity_id)) changed = true;
  }
  if (!changed && next.size === near.size) return;
  near = next;
  version++;
  for (const fn of listeners) fn();
}

/** Monta el reloj de cercanía y re-renderiza quien lo use cuando cambia el conjunto. */
export function useNearby(): number {
  useEffect(() => {
    const id = setInterval(recompute, EVERY_MS);
    recompute();
    return () => clearInterval(id);
  }, []);
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
}
