/**
 * El juego que se está abriendo: primero el aviso previo (gate) y luego, si se juega aquí, el
 * reproductor (iframe aislado). Un solo juego a la vez.
 */
import { useSyncExternalStore } from "react";
import type { Project } from "../net/account";

export type OpenGame = { project: Project; stage: "gate" | "play" };

let open: OpenGame | null = null;
const listeners = new Set<() => void>();
function emit() {
  for (const fn of listeners) fn();
}

export function openGame(project: Project) {
  open = { project, stage: "gate" };
  emit();
}

export function playHere() {
  if (open) open = { ...open, stage: "play" };
  emit();
}

export function closeGame() {
  open = null;
  emit();
}

export function useOpenGame(): OpenGame | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => open,
  );
}

/** Nombre del juego en el idioma de la persona (la ficha trae es y en como mínimo). */
export function gameName(p: Project, lang: string): string {
  return p.game?.name[lang] ?? p.game?.name.en ?? p.title;
}

/** Dirección para abrir el juego: con el idioma y, en desarrollo, quién es xenxo. */
export function gameSrc(p: Project, lang: string): string {
  const u = new URL(p.game?.url ?? p.url ?? "about:blank");
  u.searchParams.set("xenxo_lang", lang);
  // En producción el SDK ya sabe que xenxo es https://xenxo.io; en local hay que decírselo.
  if (location.origin !== "https://xenxo.io") u.searchParams.set("xenxo_origin", location.origin);
  return u.toString();
}
