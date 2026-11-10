/**
 * Errores a la vista, sin telemetría: los últimos fallos de la página se recuerdan solo en memoria
 * y, si la persona pulsa «Informar de un problema», se abre una issue de GitHub ya rellenada con su
 * navegador, dónde estaba y esos fallos. Nada sale del equipo hasta que ella la publica (y antes lo
 * ve y lo puede cambiar). Aquí no se envía nada a ningún servidor.
 */
import { SOURCE_URL } from "./content";

const MAX = 5;
const last: string[] = [];

/** Fuera lo que no debe acabar en una issue pública: tokens, claves y correos. */
function scrub(s: string): string {
  return s
    .replace(/([?&](?:token|code|key|state|ticket)=)[^&\s"']+/gi, "$1…")
    .replace(/\bxk_[A-Za-z0-9_-]+/g, "xk_…")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "…")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "…@…");
}

/** Apunta un fallo (el mensaje y el principio de la traza). */
export function noteError(e: unknown, where = ""): void {
  const err = e as { message?: unknown; stack?: unknown } | null;
  const msg = typeof err?.message === "string" ? err.message : String(e);
  const stack = typeof err?.stack === "string" ? err.stack.split("\n").slice(1, 4).map((l) => l.trim()).join(" | ") : "";
  const line = scrub(`${where ? `[${where}] ` : ""}${msg}${stack ? ` — ${stack}` : ""}`).slice(0, 420);
  if (last[last.length - 1] === line) return;
  last.push(line);
  if (last.length > MAX) last.shift();
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (ev) => noteError(ev.error ?? ev.message, "error"));
  window.addEventListener("unhandledrejection", (ev) => noteError(ev.reason, "promesa"));
}

/** Lo que ayuda a reproducirlo: navegador, pantalla, idioma, versión de la web y dónde estaba. */
function context(extra: Record<string, string>): string {
  const build = (document.querySelector('script[type="module"][src]') as HTMLScriptElement | null)?.src.split("/").pop() ?? "dev";
  const rows: Record<string, string> = {
    navegador: navigator.userAgent,
    pantalla: `${innerWidth}×${innerHeight} @${devicePixelRatio}`,
    idioma: document.documentElement.lang,
    web: build,
    ...extra,
  };
  return Object.entries(rows)
    .map(([k, v]) => `- ${k}: ${scrub(v)}`)
    .join("\n");
}

/** La dirección de una issue nueva ya rellenada (plantilla .github/ISSUE_TEMPLATE/problema.yml). */
export function issueUrl(extra: Record<string, string> = {}): string {
  const errors = last.length ? `\n\nÚltimos errores:\n${last.map((l) => `- ${l}`).join("\n")}` : "";
  const q = new URLSearchParams({ template: "problema.yml", equipo: `${context(extra)}${errors}`.slice(0, 3200) });
  return `${SOURCE_URL}/issues/new?${q}`;
}
