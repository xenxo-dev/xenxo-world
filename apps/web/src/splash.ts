/**
 * Pantalla de carga (#splash en index.html, estilos en index.css).
 *
 * Se ve desde el primer pintado, antes de que llegue el JavaScript, y tapa el momento en que el
 * mundo se monta detrás del panel: descargar los modelos y compilar los shaders bloquea el hilo
 * principal unos segundos y, sin ella, el panel parecía colgado. La barra avanza por etapas
 * (código, módulo 3D, modelos) y se va cuando el mundo ya se dibuja. Pase lo que pase, a los
 * MAX_MS se quita: nunca deja a nadie sin panel.
 */
const MAX_MS = 15_000;

const el = document.getElementById("splash");
const fill = el?.querySelector<HTMLElement>(".splash-fill") ?? null;
let shown = 0;
let gone = !el;

/** Avanza la barra (0–1). Nunca retrocede ni llega al final: el final es splashDone(). */
export function splashProgress(p: number): void {
  if (gone || !fill || !el) return;
  const next = Math.min(Math.max(p, shown), 0.95);
  if (next === shown) return;
  shown = next;
  fill.style.transform = `scaleX(${next.toFixed(3)})`;
  el.setAttribute("aria-valuenow", String(Math.round(next * 100)));
}

/** Quita la pantalla de carga con un fundido. */
export function splashDone(): void {
  if (gone || !el) return;
  gone = true;
  if (fill) fill.style.transform = "scaleX(1)";
  el.setAttribute("aria-busy", "false");
  el.classList.add("splash-out");
  window.setTimeout(() => el.remove(), 600);
}

export function splashActive(): boolean {
  return !gone;
}

window.setTimeout(splashDone, MAX_MS);
splashProgress(0.15);
