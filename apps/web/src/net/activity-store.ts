/**
 * Actividades del lugar en el cliente (búsquedas, carreras y marcadores): lo que ya tiene esta
 * cuenta, la carrera en curso, los marcadores recibidos y el aviso del HUD. Lo escribe la red
 * (world-store) y lo leen el mundo (Activities.tsx, Entities.tsx) y el HUD (ActivityHud.tsx).
 * React solo se entera de cambios (no por frame).
 */
import { useSyncExternalStore } from "react";
import { msg, type ClientMessage, type MessageOf, type ServerMessage } from "@xenxo/protocol";
import { net } from "./session";

export type ScoreRow = MessageOf<ServerMessage, "SCORES">["payload"]["rows"][number];

export type ActivityToast =
  | { kind: "collected"; count: number; total: number; complete: boolean; at: number }
  | { kind: "race"; state: "start" | "cp" | "finish" | "reset"; next?: number; total?: number; ms?: number; best?: number; rank?: number; at: number }
  | { kind: "guest"; at: number }
  | { kind: "far"; at: number };

class ActivityStore {
  /** Objetos ya recogidos por esta cuenta en este lugar (no se dibujan). */
  collected = new Set<string>();
  /** Mejor tiempo (ms) por la entidad de salida de cada carrera. */
  best: Record<string, number> = {};
  /** Carrera en curso: cuándo empezó en este reloj (para el cronómetro) y el punto que toca. */
  race: { race: string; t0: number; next: number; total: number } | null = null;
  scores = new Map<string, ScoreRow[]>();
  toast: ActivityToast | null = null;
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

  /** Al cambiar de lugar: nada de lo anterior vale. */
  reset() {
    this.collected = new Set();
    this.best = {};
    this.race = null;
    this.scores = new Map();
    this.toast = null;
    this.bump();
  }

  notice(t: ActivityToast) {
    this.toast = t;
    this.bump();
  }

  apply(m: ServerMessage) {
    const now = performance.now();
    switch (m.type) {
      case "PROGRESS":
        this.collected = new Set(m.payload.collected);
        this.best = { ...m.payload.best };
        this.bump();
        return;
      case "COLLECTED":
        // Un conjunto nuevo: quien lo mira (Entities) se entera de que ha cambiado.
        this.collected = new Set(this.collected).add(m.payload.entity_id);
        this.toast = { kind: "collected", count: m.payload.count, total: m.payload.total, complete: m.payload.complete, at: now };
        this.bump();
        return;
      case "RACE": {
        const p = m.payload;
        if (p.state === "start") this.race = { race: p.race, t0: now, next: p.next ?? 1, total: p.total ?? 0 };
        else if (p.state === "cp" && this.race) this.race = { ...this.race, next: p.next ?? this.race.next };
        else this.race = null;
        this.toast = { kind: "race", state: p.state, next: p.next, total: p.total, ms: p.ms, best: p.best, rank: p.rank, at: now };
        this.bump();
        return;
      }
      case "SCORES":
        this.scores.set(m.payload.entity_id, m.payload.rows);
        this.bump();
        return;
    }
  }
}

export const activity = new ActivityStore();

/** Solo lo recogido (cambia pocas veces): para dejar de dibujarlo. */
export function useCollected(): Set<string> {
  return useSyncExternalStore(activity.subscribe, () => activity.collected);
}

export function useActivity() {
  useSyncExternalStore(activity.subscribe, activity.getVersion);
  return activity;
}

/** Los avisos de actividad llevan este prefijo en su id: sus errores no van al chat. */
export const ACTIVITY_REF = "act_";
let n = 0;
export function sendActivity(type: "COLLECT" | "CHECKPOINT" | "SCORES_GET", entityId: string) {
  net.send(msg(type, { entity_id: entityId }, { id: `${ACTIVITY_REF}${++n}` }) as ClientMessage);
}

/** 83 450 ms → «1:23.4». */
export function formatRaceTime(ms: number): string {
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)} s`;
}
