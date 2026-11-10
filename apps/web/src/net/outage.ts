/**
 * Cuando el mundo no contesta: se averigua por qué y se dice claro, en vez de un «conectando…» sin fin.
 *
 * xenxo va en el plan gratuito de Cloudflare, que al pasar un límite diario corta hasta las 00:00 UTC
 * (docs/LIMITES-CLOUDFLARE.md). Hay tres casos:
 *  - "full": el servidor dice que se ha agotado el cupo de hoy (`capacity` en /health, o un 503
 *    `over_capacity`).
 *  - "maybe": la API responde con una página de error de Cloudflare (sin CORS, así que no se ve cuál):
 *    casi siempre es ese mismo corte, pero no se puede asegurar.
 *  - "offline": no se llega a la API de ninguna forma (sin red en este dispositivo).
 * Se comprueba solo cuando algo ya ha fallado (nunca en una visita normal: no gasta peticiones).
 */
import { useSyncExternalStore } from "react";
import { REALTIME_URL } from "../config";

export type Outage = "full" | "maybe" | "offline";

let state: Outage | null = null;
let checking: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(v: Outage | null) {
  if (state === v) return;
  state = v;
  for (const fn of listeners) fn();
}

async function probe(): Promise<Outage | null> {
  if (navigator.onLine === false) return "offline";
  const url = new URL("/health", REALTIME_URL);
  try {
    const r = await fetch(url, { cache: "no-store" });
    const body = (await r.json().catch(() => null)) as { capacity?: string; error?: string } | null;
    if (body?.capacity === "full" || body?.error === "over_capacity") return "full";
    return r.ok ? null : "maybe";
  } catch {
    // Sin CORS no se puede leer la respuesta, pero sí saber si alguien contesta.
    try {
      await fetch(url, { mode: "no-cors", cache: "no-store" });
      return "maybe";
    } catch {
      return "offline";
    }
  }
}

/** Mira por qué no hay mundo (una comprobación a la vez). */
export function checkOutage(): Promise<void> {
  checking ??= probe()
    .then(set)
    .finally(() => {
      checking = null;
    });
  return checking;
}

/** El servidor lo ha dicho en una respuesta (503 `over_capacity`). */
export function noteFull() {
  set("full");
}

/** Hay conexión otra vez. */
export function clearOutage() {
  set(null);
}

export function useOutage(): Outage | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => state,
  );
}

/** La próxima medianoche UTC (cuando se reinician los cupos), en la hora local de quien mira. */
export function resetTime(lang: string): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toLocaleTimeString(lang === "es" ? "es-ES" : "en-GB", { hour: "2-digit", minute: "2-digit" });
}
