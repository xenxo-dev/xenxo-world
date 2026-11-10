/**
 * Algo tapa el mundo entero (el configurador de fundas, a pantalla completa): mientras tanto el
 * mundo no se dibuja. En un móvil, dos escenas 3D a la vez se notan mucho; en cualquier equipo,
 * dibujar lo que nadie ve sobra.
 */
import { useSyncExternalStore } from "react";

let covers = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const fn of listeners) fn();
};

/** Tapa el mundo hasta que se llame a lo que devuelve. */
export function coverWorld(): () => void {
  covers++;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    covers--;
    emit();
  };
}

export function useCovered(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => covers > 0,
  );
}
