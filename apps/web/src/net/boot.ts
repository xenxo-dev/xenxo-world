/**
 * El arranque del panel en una sola petición (GET /boot): los distritos, los proyectos, las jams,
 * los marcadores, cuánta gente hay y lo que moderación tiene cerrado ahora. Antes eran seis
 * peticiones y dos más cada 30 s; en el plan gratuito cada una cuenta (docs/LIMITES-CLOUDFLARE.md).
 *
 * Cada almacén (districts.ts, projects.ts, jams.ts, scores.ts) toma de aquí su parte; sus rutas
 * propias (/districts, /projects…) siguen para cuando hace falta lo de ahora mismo (tras publicar).
 * El panel la vuelve a pedir cada minuto mientras está a la vista; dentro del mundo, no.
 *
 * La primera de cada pestaña lleva `first=1` y la etiqueta del enlace (campaign.ts): así el servidor
 * suma una visita al contador del día (una suma: no sabe de quién).
 */
import { useSyncExternalStore } from "react";
import { REALTIME_URL } from "../config";
import type { Project } from "./account";
import { withCampaign } from "./campaign";
import type { DistrictInfo } from "./districts";
import type { Jam } from "./jams";
import { checkOutage, noteFull } from "./outage";
import type { DistrictBoards } from "./scores";

/** Interruptores de emergencia: true = abierto (lo normal). */
export interface Flags {
  signups: boolean;
  chat: boolean;
  sandbox: boolean;
}

export interface LiveState {
  online: number;
  agents_online: number;
  entities: number;
  recent_events: { ts: number; actor: string; op: string; entity_id: string }[];
}

export interface Boot {
  districts: DistrictInfo[];
  projects: Project[];
  jams: Jam[];
  scores: { districts: DistrictBoards[]; at: number };
  live: LiveState | null;
  flags: Flags;
  at: number;
}

const ALL_OPEN: Flags = { signups: true, chat: true, sandbox: true };
const VISIT = "xenxo:visit";

let last: Boot | null = null;
let loadedAt = 0;
let pending: Promise<Boot | null> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const takers = new Set<(b: Boot) => void>();

/** ¿La primera petición de esta visita? Una por pestaña: recargar no cuenta otra. */
function firstOfVisit(): boolean {
  try {
    if (sessionStorage.getItem(VISIT)) return false;
    sessionStorage.setItem(VISIT, "1");
    return true;
  } catch {
    return false;
  }
}

async function fetchBoot(): Promise<Boot | null> {
  const url = new URL("/boot", REALTIME_URL);
  const first = firstOfVisit();
  if (first) {
    url.searchParams.set("first", "1");
    withCampaign(url);
  }
  try {
    const r = await fetch(url);
    if (!r.ok) {
      const body = (await r.json().catch(() => null)) as { error?: string } | null;
      // El plan gratuito ha cortado por hoy: el panel lo dice (hud/Capacity.tsx).
      if (body?.error === "over_capacity") noteFull();
      throw new Error(String(r.status));
    }
    const b = (await r.json()) as Boot;
    last = b;
    loadedAt = Date.now();
    version++;
    for (const fn of takers) fn(b);
    for (const fn of listeners) fn();
    return b;
  } catch (e) {
    // No ha llegado: la visita no se ha contado (se intentará con la siguiente).
    if (first) {
      try {
        sessionStorage.removeItem(VISIT);
      } catch {
        /* sin almacenamiento */
      }
    }
    // ¿El corte del día o este dispositivo sin red? (solo cuando no hubo respuesta que leer)
    if (e instanceof TypeError) void checkOutage();
    return null;
  }
}

/** Lo del arranque; si lo que hay tiene menos de `maxAgeMs`, vale. null si el servidor no contesta. */
export function loadBoot(maxAgeMs = 60_000): Promise<Boot | null> {
  if (last && Date.now() - loadedAt < maxAgeMs) return Promise.resolve(last);
  pending ??= fetchBoot().finally(() => {
    pending = null;
  });
  return pending;
}

/** Para los almacenes: recibir su parte cada vez que llega un arranque nuevo. */
export function onBoot(fn: (b: Boot) => void): void {
  takers.add(fn);
  if (last) fn(last);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function useBoot(): Boot | null {
  useSyncExternalStore(subscribe, () => version);
  return last;
}

/** Lo que moderación tiene cerrado ahora (según el último arranque; sin él, todo abierto). */
export function useFlags(): Flags {
  return useBoot()?.flags ?? ALL_OPEN;
}
