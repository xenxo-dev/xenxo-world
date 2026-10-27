/**
 * Entrada unificada de escritorio y móvil. Se escribe desde eventos del DOM
 * y se lee en useFrame: nada de estado de React aquí.
 */
import { controls } from "../controls";
import { toggleFullscreen } from "../fullscreen";

export const input = {
  /** Movimiento en ejes locales: x = derecha, y = adelante. Rango -1..1. */
  move: { x: 0, y: 0 },
  /** Giro acumulado pendiente de aplicar (radianes). */
  yawDelta: 0,
  pitchDelta: 0,
  enabled: false,
  /** Correr (Mayús en escritorio). */
  run: false,
  /** Salto pedido (se consume al aplicarlo). */
  jump: false,
  /** Gesto pedido desde el teclado o el HUD (se consume al aplicarlo). */
  emote: null as string | null,
  /** Zoom pendiente de la cámara (rueda o pellizco): >0 aleja, <0 acerca. Se consume al aplicarlo. */
  zoomDelta: 0,
  /** Cambiar entre tercera y primera persona (tecla V o el HUD). Se consume al aplicarlo. */
  toggleView: false,
  /** Foto pedida (tecla P o el HUD). La consume la escena tras dibujar. */
  photo: false,
  /** Sacar o dejar el coche (tecla C o el HUD). Se consume al aplicarlo. */
  car: false,
  /** Freno de mano (Espacio mantenido) mientras se conduce. */
  brake: false,
};

/** Primera persona activa (lo cambia el jugador con `setFirstPerson`; el HUD se suscribe). */
export const view = { firstPerson: false };
const viewListeners = new Set<() => void>();
export function setFirstPerson(on: boolean) {
  if (view.firstPerson === on) return;
  view.firstPerson = on;
  for (const fn of viewListeners) fn();
}
export function subscribeView(fn: () => void) {
  viewListeners.add(fn);
  return () => void viewListeners.delete(fn);
}

/** El HUD se entera de cada foto (para el destello y el aviso). */
const photoListeners = new Set<(ok: boolean) => void>();
export function onPhoto(fn: (ok: boolean) => void) {
  photoListeners.add(fn);
  return () => void photoListeners.delete(fn);
}
export function emitPhoto(ok: boolean) {
  for (const fn of photoListeners) fn(ok);
}

/** Teclas de gestos: 1 saludar, 2 bailar, 3 sentarse, 4 animar. */
const EMOTE_KEYS: Record<string, string> = { Digit1: "wave", Digit2: "dance", Digit3: "sit", Digit4: "cheer" };

const keys = new Set<string>();

function updateFromKeys() {
  const f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  const r = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  input.move.x = r;
  input.move.y = f;
  input.run = keys.has("ShiftLeft") || keys.has("ShiftRight");
  input.brake = keys.has("Space");
}

let attached = false;

export function attachDesktopInput(el: HTMLElement) {
  if (attached) return () => {};
  attached = true;

  const down = (e: KeyboardEvent) => {
    if (!input.enabled || (e.target as HTMLElement)?.tagName === "INPUT") return;
    keys.add(e.code);
    if (e.code === "Space" && !e.repeat) {
      input.jump = true;
      e.preventDefault();
    }
    const emote = EMOTE_KEYS[e.code];
    if (emote && !e.repeat) input.emote = emote;
    if (e.code === "KeyV" && !e.repeat) input.toggleView = true;
    if (e.code === "KeyP" && !e.repeat) input.photo = true;
    if (e.code === "KeyC" && !e.repeat) input.car = true;
    if (e.code === "KeyF" && !e.repeat) void toggleFullscreen();
    updateFromKeys();
  };
  const up = (e: KeyboardEvent) => {
    keys.delete(e.code);
    updateFromKeys();
  };

  // Mirar arrastrando (sin pointer lock: funciona igual en ratón y en táctil).
  // Con dos dedos sobre la escena: pellizcar acerca o aleja la cámara.
  let dragging: number | null = null;
  let lastX = 0;
  let lastY = 0;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const spread = () => {
    const [a, b] = [...touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const pDown = (e: PointerEvent) => {
    if (!input.enabled) return;
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        dragging = null; // dos dedos: zoom, no giro
        pinch = spread();
        return;
      }
    }
    if (dragging !== null || touches.size > 1) return;
    dragging = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const pMove = (e: PointerEvent) => {
    const t = touches.get(e.pointerId);
    if (t) {
      t.x = e.clientX;
      t.y = e.clientY;
      if (touches.size === 2) {
        const d = spread();
        if (pinch > 0 && d > 0) input.zoomDelta += Math.log(pinch / d) * 1.6;
        pinch = d;
        return;
      }
    }
    if (e.pointerId !== dragging) return;
    const k = controls.lookSpeed;
    input.yawDelta -= (e.clientX - lastX) * 0.005 * k;
    input.pitchDelta -= (e.clientY - lastY) * 0.003 * k * (controls.invertY ? -1 : 1);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const pUp = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = 0;
    if (e.pointerId === dragging) dragging = null;
  };
  const wheel = (e: WheelEvent) => {
    if (!input.enabled) return;
    e.preventDefault();
    // Píxeles, líneas o páginas: lo normalizamos a «muescas» de rueda.
    const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    input.zoomDelta += Math.max(-3, Math.min(3, px / 100)) * 0.12;
  };

  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  el.addEventListener("pointerdown", pDown);
  el.addEventListener("wheel", wheel, { passive: false });
  window.addEventListener("pointermove", pMove);
  window.addEventListener("pointerup", pUp);
  window.addEventListener("pointercancel", pUp);

  return () => {
    attached = false;
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    el.removeEventListener("pointerdown", pDown);
    el.removeEventListener("wheel", wheel);
    window.removeEventListener("pointermove", pMove);
    window.removeEventListener("pointerup", pUp);
    window.removeEventListener("pointercancel", pUp);
  };
}
