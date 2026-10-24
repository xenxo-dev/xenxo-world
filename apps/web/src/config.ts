export const REALTIME_URL: string = import.meta.env.VITE_REALTIME_URL ?? "http://localhost:8787";
export const GITHUB_OWNER: string = import.meta.env.VITE_GITHUB_OWNER ?? "xenxo-dev";

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
