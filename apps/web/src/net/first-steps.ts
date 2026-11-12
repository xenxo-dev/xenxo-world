/**
 * Primeros pasos: la lista de lo primero que hacer en xenxo (cruzar una puerta del nexo, usar la
 * rueda de acciones, tener cuenta, encontrar algo escondido y terminar una carrera). Se marca sola
 * con lo que pasa en el cliente y se recuerda en este navegador; la insignia «Primeros pasos» no la
 * da esto, la da el servidor con lo que guardan los distritos (badges.ts, `earnedAcross`).
 */
import { useSyncExternalStore } from "react";
import { loadPref, savePref } from "../config";

export const FIRST_STEPS = ["door", "wheel", "account", "find", "race"] as const;
export type FirstStep = (typeof FIRST_STEPS)[number];

interface State {
  done: FirstStep[];
  /** La quitó con su ✕ (o la terminó y la cerró): no vuelve a salir. */
  closed: boolean;
}

let state: State = loadPref<State>("firstSteps", { done: [], closed: false });
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  savePref("firstSteps", state);
  for (const fn of listeners) fn();
}

export const firstSteps = {
  mark(step: FirstStep) {
    if (state.done.includes(step)) return;
    set({ ...state, done: [...state.done, step] });
  },
  close() {
    if (!state.closed) set({ ...state, closed: true });
  },
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};

export function useFirstSteps(): State {
  return useSyncExternalStore(firstSteps.subscribe, firstSteps.get);
}
