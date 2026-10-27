/**
 * Estado del coche propio, sin dependencias pesadas (lo lee también el HUD, que no carga el mundo
 * 3D): en qué fase está (sin coche, yendo hacia él, subiendo, conduciendo, bajando o aparcado), el
 * aviso corto y la velocidad para el velocímetro.
 */
import { useSyncExternalStore } from "react";
import districts from "../../../../realtime/src/districts.json";
import type { Key } from "../../i18n";
import type { CarSim } from "./physics";

/** Los distritos (donde hay calles para conducir). */
export const DISTRICT_CHUNKS = new Set((districts.districts as { chunk: string }[]).map((d) => d.chunk));

/**
 * Fases, como en GTA: ir hasta la puerta (`walk`), abrirla (`open`), sentarse (`in`), cerrarla
 * (`close`), conducir (`drive`), frenar para bajarse (`stop`), abrir (`open_out`), salir (`out`),
 * cerrar (`close_out`) y el coche aparcado (`parked`).
 */
export type Phase = "none" | "walk" | "open" | "in" | "close" | "drive" | "stop" | "open_out" | "out" | "close_out" | "parked";

/** Sentado dentro (los demás lo ven en el asiento). */
export const SEATED: ReadonlySet<Phase> = new Set(["close", "drive", "stop", "open_out"]);

export const drive = {
  phase: "none" as Phase,
  /** Segundos desde que empezó la fase. */
  t: 0,
  /** Lado de la puerta: 1 = izquierda (+X del coche), -1 = derecha. */
  side: 1 as 1 | -1,
  loading: false,
  sim: null as CarSim | null,
  /** Aviso corto para el HUD (no cabe, cargando…). */
  notice: null as Key | null,
};

const listeners = new Set<() => void>();
let snapshot = { phase: "none" as Phase, on: false, loading: false, notice: null as Key | null };
export function emitDrive() {
  snapshot = { phase: drive.phase, on: drive.phase === "drive" || drive.phase === "stop", loading: drive.loading, notice: drive.notice };
  for (const fn of listeners) fn();
}
export function useDrive() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => snapshot,
  );
}

export function setPhase(p: Phase) {
  drive.phase = p;
  drive.t = 0;
  emitDrive();
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;
export function driveNotice(k: Key | null) {
  drive.notice = k;
  emitDrive();
  if (noticeTimer) clearTimeout(noticeTimer);
  if (k) noticeTimer = setTimeout(() => driveNotice(null), 3500);
}

/** Velocidad del coche (m/s, hacia delante), para el velocímetro. */
export function carSpeed(): number {
  return drive.sim?.active ? drive.sim.state.speed : 0;
}
