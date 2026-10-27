/**
 * Estado de los portales que ve el HUD (sin React dentro del bucle de render):
 *  - la ficha del proyecto delante del que estás,
 *  - el aviso breve de viaje («→ La Plaza»).
 */
import { useSyncExternalStore } from "react";

export interface PortalCardState {
  projectId: string;
  title: string;
  cover: string | null;
  category: string | null;
}

class PortalHud {
  card: PortalCardState | null = null;
  travelling: { title: string; at: number; soon?: boolean } | null = null;
  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private bump() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  open(card: PortalCardState) {
    if (this.card?.projectId === card.projectId) return;
    this.card = card;
    this.bump();
  }
  close(projectId?: string) {
    if (!this.card || (projectId && this.card.projectId !== projectId)) return;
    this.card = null;
    this.bump();
  }
  /** Puerta cerrada («próximamente»): solo el aviso, sin viajar. */
  soon(title: string) {
    this.travelling = { title, at: Date.now(), soon: true };
    this.card = null;
    this.bump();
  }
  travel(title: string) {
    this.travelling = { title, at: Date.now() };
    this.card = null;
    this.bump();
  }
}

export const portalHud = new PortalHud();

export function usePortalHud() {
  useSyncExternalStore(portalHud.subscribe, portalHud.getVersion);
  return portalHud;
}

/** Colores de categoría (los mismos que usa el servidor para la banda del portal). */
export const CATEGORY_COLORS: Record<string, string> = {
  game3d: "#4fa3ff",
  game2d: "#ff4fd8",
  social: "#6dff8a",
  tool: "#ffd54f",
  other: "#b8c2d6",
  district: "#ff9e52",
};

export function categoryColor(c: string | null | undefined): string {
  return CATEGORY_COLORS[c ?? "other"] ?? CATEGORY_COLORS.other!;
}
