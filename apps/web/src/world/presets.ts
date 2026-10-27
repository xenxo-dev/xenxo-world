/**
 * Avatares de serie: personas realistas generadas con MakeHuman (CC0) y animadas con VRMA.
 * Quien no elige uno lleva siempre el mismo: un invitado, el que le tocó la primera vez en este
 * navegador (se guarda); una cuenta sin personaje propio, el que le da el servidor según su id
 * (`effectiveAvatar`). Nunca según la sesión: cambiaría al ir de un lugar a otro.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
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

/** Invitado sin elección: uno al azar la primera vez y el mismo desde entonces (en este navegador). */
let auto: string | null = loadPref<string | null>("avatar_preset_auto", null);
export function guestPreset(): Preset {
  const c = chosenPreset();
  if (c) return c;
  let p = AVATAR_PRESETS.find((x) => x.id === auto);
  if (!p) {
    p = AVATAR_PRESETS[Math.floor(Math.random() * AVATAR_PRESETS.length)]!;
    auto = p.id;
    savePref("avatar_preset_auto", auto);
  }
  return p;
}

/** El de serie de una cuenta sin personaje propio: el mismo cálculo que el servidor (directory.ts → effectiveAvatar). */
async function accountPreset(userId: string): Promise<Preset> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId)));
  let s = "";
  for (const b of d) s += String.fromCharCode(b);
  const b64 = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const i = parseInt(b64.replace(/[^0-9]/g, "").slice(0, 6) || "0", 10) % AVATAR_PRESETS.length;
  return AVATAR_PRESETS[i]!;
}
const accountCache = new Map<string, Preset>();
export function useAccountPreset(userId: string | undefined): Preset | undefined {
  const [p, setP] = useState(() => (userId ? accountCache.get(userId) : undefined));
  useEffect(() => {
    if (!userId) return setP(undefined);
    const hit = accountCache.get(userId);
    if (hit) return setP(hit);
    let alive = true;
    void accountPreset(userId).then((x) => {
      accountCache.set(userId, x);
      if (alive) setP(x);
    });
    return () => {
      alive = false;
    };
  }, [userId]);
  return p;
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
