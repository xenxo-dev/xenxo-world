/**
 * Proyectos de la comunidad (lectura pública), compartidos por el nexo 2D y las fichas de los
 * portales. Llegan con el arranque (GET /boot, net/boot.ts); tras publicar o borrar, de GET /projects.
 */
import { useSyncExternalStore } from "react";
import { listProjects, type Project } from "./account";
import { loadBoot, onBoot } from "./boot";

let cache: Project[] | null = null;
let loadedAt = 0;
let pending: Promise<Project[]> | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  for (const fn of listeners) fn();
}

function adopt(list: Project[]): Project[] {
  cache = list;
  loadedAt = Date.now();
  emit();
  return list;
}

/** Sin `force`, los del arranque (como mucho de hace un minuto); con `force`, los de ahora mismo. */
export function refreshProjects(force = false): Promise<Project[]> {
  if (!force) {
    if (cache && Date.now() - loadedAt < 60_000) return Promise.resolve(cache);
    return loadBoot().then((b) => (b ? (cache ?? adopt(b.projects)) : refreshProjects(true)));
  }
  pending ??= listProjects()
    .then(adopt)
    .catch(() => cache ?? [])
    .finally(() => {
      pending = null;
    });
  return pending;
}

onBoot((b) => void adopt(b.projects));

export function projectById(id: string): Project | null {
  return cache?.find((p) => p.id === id) ?? null;
}

/** Lista de proyectos (null mientras carga la primera vez). */
export function useProjects(): Project[] | null {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return cache;
}
