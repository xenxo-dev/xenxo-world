/**
 * Avatares de serie: personas realistas generadas con MakeHuman (CC0) y animadas con VRMA.
 * Quien no elige uno lleva siempre el mismo (según su sesión); se puede elegir en el panel.
 */
import { useSyncExternalStore } from "react";
import { loadPref, savePref } from "../config";
import PRESETS from "./avatar-presets.json";

export type Preset = (typeof PRESETS)[number];
export const AVATAR_PRESETS: Preset[] = PRESETS;

export function presetFor(seed: string): Preset {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_PRESETS[h % AVATAR_PRESETS.length]!;
}

export function presetByHash(hash: string | null | undefined): Preset | undefined {
  return hash ? AVATAR_PRESETS.find((p) => p.hash === hash) : undefined;
}

/* Elección de un invitado (en este navegador). */
let chosen: string | null = loadPref<string | null>("avatar_preset", null);
const listeners = new Set<() => void>();

export function chosenPreset(): Preset | undefined {
  return AVATAR_PRESETS.find((p) => p.id === chosen);
}

export function setChosenPreset(id: string | null) {
  chosen = id;
  savePref("avatar_preset", id);
  for (const fn of listeners) fn();
}

export function useChosenPreset(): Preset | undefined {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => chosen,
  );
  return chosenPreset();
}
