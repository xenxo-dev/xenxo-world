import { assetPath } from "@xenxo/protocol";
import { staticAssetPath } from "./static-assets";

export const REALTIME_URL: string = import.meta.env.VITE_REALTIME_URL ?? "http://localhost:8787";

/** URL pública e inmutable de un asset ("sha256:…"). */
export function assetUrl(hash: string): string {
  return new URL(staticAssetPath(hash) ?? assetPath(hash), REALTIME_URL).toString();
}

/** Preferencias del visitante. localStorage puede fallar (modo privado): siempre con try/catch. */
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`xenxo:${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`xenxo:${key}`, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}
