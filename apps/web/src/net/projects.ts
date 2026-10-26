/**
 * Proyectos de la comunidad (lectura pública), compartidos por el nexo 2D y las fichas de los
 * portales. Una sola petición cada 30 s como mucho: el servidor ya los cachea 10 s.
 */
import { useSyncExternalStore } from "react";
import { listProjects, type Project } from "./account";

let cache: Project[] | null = null;
let loadedAt = 0;
let pending: Promise<Project[]> | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  for (const fn of listeners) fn();
}

export function refreshProjects(force = false): Promise<Project[]> {
  if (!force && cache && Date.now() - loadedAt < 30_000) return Promise.resolve(cache);
  pending ??= listProjects()
    .then((list) => {
      cache = list;
      loadedAt = Date.now();
      emit();
      return list;
    })
    .catch(() => cache ?? [])
    .finally(() => {
      pending = null;
    });
  return pending;
}

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
