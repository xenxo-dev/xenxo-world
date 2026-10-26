/**
 * Ajustes de los controles (Personalizar → Controles). Se guardan solo en este navegador.
 * Un objeto mutable que leen la entrada y el HUD, y un gancho para que React se entere.
 */
import { useSyncExternalStore } from "react";
import { loadPref, savePref } from "./config";

export type Hand = "left" | "right";
export type ControlSize = "s" | "m" | "l";

export interface Controls {
  /** Lado del joystick; el botón de saltar va en el otro. */
  hand: Hand;
  size: ControlSize;
  /** Opacidad de los controles en pantalla (0,3 a 1). */
  opacity: number;
  /** Botón grande de saltar junto al pulgar (en táctil). */
  jumpButton: boolean;
  /** Joystick a tope = correr. */
  autoRun: boolean;
  /** Sensibilidad al mirar arrastrando (0,5 a 2). */
  lookSpeed: number;
  invertY: boolean;
  showEmotes: boolean;
  showCamera: boolean;
  /** Pasar a pantalla completa al entrar al mundo (si el navegador lo permite). */
  autoFullscreen: boolean;
}

export const CONTROL_DEFAULTS: Controls = {
  hand: "left",
  size: "m",
  opacity: 0.85,
  jumpButton: true,
  autoRun: true,
  lookSpeed: 1,
  invertY: false,
  showEmotes: true,
  showCamera: true,
  autoFullscreen: false,
};

/** Tamaño en píxeles del joystick y del botón de saltar según el ajuste. */
export const CONTROL_PX: Record<ControlSize, { stick: number; jump: number }> = {
  s: { stick: 104, jump: 64 },
  m: { stick: 128, jump: 76 },
  l: { stick: 156, jump: 92 },
};

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

function sanitize(raw: Partial<Controls> | null): Controls {
  const r = raw && typeof raw === "object" ? raw : {};
  const d = CONTROL_DEFAULTS;
  return {
    hand: r.hand === "right" ? "right" : "left",
    size: r.size === "s" || r.size === "l" ? r.size : "m",
    opacity: clamp(r.opacity, 0.3, 1, d.opacity),
    jumpButton: typeof r.jumpButton === "boolean" ? r.jumpButton : d.jumpButton,
    autoRun: typeof r.autoRun === "boolean" ? r.autoRun : d.autoRun,
    lookSpeed: clamp(r.lookSpeed, 0.5, 2, d.lookSpeed),
    invertY: typeof r.invertY === "boolean" ? r.invertY : d.invertY,
    showEmotes: typeof r.showEmotes === "boolean" ? r.showEmotes : d.showEmotes,
    showCamera: typeof r.showCamera === "boolean" ? r.showCamera : d.showCamera,
    autoFullscreen: typeof r.autoFullscreen === "boolean" ? r.autoFullscreen : d.autoFullscreen,
  };
}

export let controls: Controls = sanitize(loadPref<Partial<Controls> | null>("controls", null));
const listeners = new Set<() => void>();

export function setControls(patch: Partial<Controls>) {
  controls = sanitize({ ...controls, ...patch });
  savePref("controls", controls);
  for (const fn of listeners) fn();
}

export function resetControls() {
  setControls(CONTROL_DEFAULTS);
}

export function useControls(): Controls {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => controls,
  );
}
