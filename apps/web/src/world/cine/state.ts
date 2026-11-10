/**
 * Modo cine: una cámara de rodaje dentro del mundo para grabar los vídeos de xenxo (tecla K, solo
 * en escritorio). Quita el HUD, encuadra en vertical u horizontal a tamaño de vídeo y mueve la
 * cámara sola (órbita, grúa, trípode, travelling) mientras el personaje se sigue llevando igual.
 * Graba lo que dibuja el mundo, sin salir del navegador (recorder.ts).
 *
 * Los clips de cualquier visitante (el botón de vídeo del HUD) usan la misma grabación, sin este
 * modo y con la marca «xenxo.io · lugar».
 *
 * Aquí no hay React por frame: el jugador lee `cine` en su useFrame; la barra se suscribe.
 * Para rodar con un guion (tools/cine): ?cine=orbit&frame=9x16&self=0&bar=0 en la dirección.
 */
import { useSyncExternalStore } from "react";

export const CINE_CAMS = ["follow", "orbit", "crane", "tripod", "travel"] as const;
export type CineCam = (typeof CINE_CAMS)[number];
export const CINE_FRAMES = ["free", "9:16", "16:9", "1:1"] as const;
export type CineFrame = (typeof CINE_FRAMES)[number];

/** Píxeles del vídeo de cada encuadre (1080p). */
export const FRAME_PX: Record<Exclude<CineFrame, "free">, [number, number]> = {
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
  "1:1": [1080, 1080],
};

export const cine = {
  on: false,
  cam: "follow" as CineCam,
  frame: "free" as CineFrame,
  /** Sin el propio personaje (planos del lugar). */
  hideSelf: false,
  /** La barra de rodaje a la vista (H la esconde: no sale en el vídeo de todas formas, pero estorba al encuadrar). */
  bar: true,
  /** Sube cada vez que empieza un plano: el movimiento de cámara parte de donde esté en ese momento. */
  shot: 0,
};

let version = 0;
const listeners = new Set<() => void>();
function bump() {
  version++;
  for (const fn of listeners) fn();
}

export function setCine(patch: Partial<Pick<typeof cine, "on" | "cam" | "frame" | "hideSelf" | "bar">>) {
  const cam = patch.cam ?? cine.cam;
  // Elegir cámara (aunque sea la misma) empieza el plano de nuevo.
  if (patch.cam !== undefined || (patch.on && !cine.on)) cine.shot++;
  Object.assign(cine, patch, { cam });
  if (!cine.on) cine.bar = true;
  bump();
}

export function toggleCine() {
  setCine({ on: !cine.on });
}

export function nextCineCam() {
  setCine({ cam: CINE_CAMS[(CINE_CAMS.indexOf(cine.cam) + 1) % CINE_CAMS.length]! });
}

export function useCine() {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => version,
  );
  return cine;
}

// Solo en desarrollo: para que tools/cine/render.mjs elija la cámara al empezar cada plano.
if (import.meta.env.DEV) (globalThis as { __xenxoCine?: typeof setCine }).__xenxoCine = setCine;

// Rodar con un guion: la dirección dice cómo se arranca (y se limpia de la barra de direcciones).
try {
  const q = new URLSearchParams(location.search);
  const cam = q.get("cine");
  if (cam !== null) {
    const frame = (q.get("frame") ?? "").replace("x", ":");
    cine.on = true;
    if ((CINE_CAMS as readonly string[]).includes(cam)) cine.cam = cam as CineCam;
    if ((CINE_FRAMES as readonly string[]).includes(frame)) cine.frame = frame as CineFrame;
    cine.hideSelf = q.get("self") === "0";
    cine.bar = q.get("bar") !== "0";
    for (const k of ["cine", "frame", "self", "bar"]) q.delete(k);
    history.replaceState(history.state, "", `${location.pathname}${q.size ? `?${q}` : ""}${location.hash}`);
  }
} catch {
  /* sin dirección que leer: modo normal */
}
