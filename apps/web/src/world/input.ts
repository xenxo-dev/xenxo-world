/**
 * Entrada unificada de escritorio y móvil. Se escribe desde eventos del DOM
 * y se lee en useFrame: nada de estado de React aquí.
 */
export const input = {
  /** Movimiento en ejes locales: x = derecha, y = adelante. Rango -1..1. */
  move: { x: 0, y: 0 },
  /** Giro acumulado pendiente de aplicar (radianes). */
  yawDelta: 0,
  pitchDelta: 0,
  enabled: false,
};

const keys = new Set<string>();

function updateFromKeys() {
  const f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  const r = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  input.move.x = r;
  input.move.y = f;
}

let attached = false;

export function attachDesktopInput(el: HTMLElement) {
  if (attached) return () => {};
  attached = true;

  const down = (e: KeyboardEvent) => {
    if (!input.enabled || (e.target as HTMLElement)?.tagName === "INPUT") return;
    keys.add(e.code);
    updateFromKeys();
  };
  const up = (e: KeyboardEvent) => {
    keys.delete(e.code);
    updateFromKeys();
  };

  // Mirar arrastrando (sin pointer lock: funciona igual en ratón y en táctil).
  let dragging: number | null = null;
  let lastX = 0;
  let lastY = 0;
  const pDown = (e: PointerEvent) => {
    if (!input.enabled || dragging !== null) return;
    dragging = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const pMove = (e: PointerEvent) => {
    if (e.pointerId !== dragging) return;
    input.yawDelta -= (e.clientX - lastX) * 0.005;
    input.pitchDelta -= (e.clientY - lastY) * 0.003;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const pUp = (e: PointerEvent) => {
    if (e.pointerId === dragging) dragging = null;
  };

  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  el.addEventListener("pointerdown", pDown);
  window.addEventListener("pointermove", pMove);
  window.addEventListener("pointerup", pUp);
  window.addEventListener("pointercancel", pUp);

  return () => {
    attached = false;
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    el.removeEventListener("pointerdown", pDown);
    window.removeEventListener("pointermove", pMove);
    window.removeEventListener("pointerup", pUp);
    window.removeEventListener("pointercancel", pUp);
  };
}
