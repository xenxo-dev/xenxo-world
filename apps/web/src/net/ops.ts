/**
 * Operar xenxo desde el panel (solo moderación): los interruptores de emergencia y los contadores
 * de visitas. El servidor los explica en apps/realtime/src/ops.ts.
 */
import { authedApi } from "./account";
import type { Flags } from "./boot";

export type FlagName = keyof Flags;
export const FLAG_NAMES: FlagName[] = ["signups", "chat", "sandbox"];

export interface FlagsInfo {
  /** true = abierto. */
  flags: Flags;
  /** Desde cuándo está cerrado cada uno (ms). */
  closed_at: Partial<Record<FlagName, number>>;
  changed?: FlagName[];
  /** Lugares que no contestaron al cambiar el chat o la zona de pruebas (siguen como estaban). */
  failed?: string[];
}

export function modFlags(): Promise<FlagsInfo> {
  return authedApi<FlagsInfo>("GET", "/mod/flags");
}

/** Cierra (`open: false`) o abre un interruptor; el motivo, si lo hay, queda en el registro. */
export function modSetFlag(name: FlagName, open: boolean, note: string): Promise<FlagsInfo> {
  return authedApi<FlagsInfo>("PUT", "/mod/flags", { [name]: open, ...(note.trim() ? { note: note.trim() } : {}) });
}

export type StatEvent = "visit" | "enter" | "place" | "signup" | "project";
export interface StatRow {
  day: string;
  event: StatEvent;
  /** La etiqueta del enlace (?v=…), "-" sin etiqueta u "otros"; en `place`, el lugar. */
  tag: string;
  n: number;
}

export function modStats(days: number): Promise<{ from: string; to: string; rows: StatRow[] }> {
  return authedApi("GET", `/mod/stats?days=${days}`);
}
