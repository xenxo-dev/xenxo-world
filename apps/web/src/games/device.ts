/**
 * En qué equipo está la persona, con las mismas palabras que la ficha `xenxo.json` (`devices`):
 * "pc", "mobile" o "vr" (el navegador de unas gafas). Si un juego no dice que funciona en este
 * equipo, xenxo lo avisa y no lo abre (Gate, catálogo y portal).
 */
export type Device = "pc" | "mobile" | "vr";

let cached: Device | null = null;

export function visitorDevice(): Device {
  if (cached) return cached;
  const ua = navigator.userAgent;
  if (/OculusBrowser|Quest|Pico|Wolvic|VisionOS/i.test(ua)) cached = "vr";
  else if (matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|Mobile/i.test(ua)) cached = "mobile";
  else cached = "pc";
  return cached;
}

/** ¿Se puede jugar aquí? Sin ficha (un enlace sin más) no se sabe: no se limita. */
export function fitsHere(devices: Device[] | undefined): boolean {
  return !devices || devices.includes(visitorDevice());
}
