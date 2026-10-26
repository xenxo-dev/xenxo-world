/**
 * Pantalla completa (API Fullscreen) e instalación como app (PWA).
 * En iPhone no hay pantalla completa para páginas: ahí la alternativa es instalar la app, que se
 * abre sin barras del navegador.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

type Doc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenEnabled?: boolean };
type El = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function fullscreenSupported(): boolean {
  const d = document as Doc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const d = document as Doc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Tiene que llamarse desde un gesto (clic, toque o tecla). */
export async function enterFullscreen() {
  if (isFullscreen() || !fullscreenSupported()) return;
  const el = document.documentElement as El;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
    else await el.webkitRequestFullscreen?.();
  } catch {
    /* el navegador lo ha denegado: seguimos sin pantalla completa */
  }
}

export async function exitFullscreen() {
  const d = document as Doc;
  try {
    if (d.exitFullscreen) await d.exitFullscreen();
    else await d.webkitExitFullscreen?.();
  } catch {
    /* nada */
  }
}

export function toggleFullscreen() {
  return isFullscreen() ? exitFullscreen() : enterFullscreen();
}

export function useFullscreen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      document.addEventListener("fullscreenchange", fn);
      document.addEventListener("webkitfullscreenchange", fn);
      return () => {
        document.removeEventListener("fullscreenchange", fn);
        document.removeEventListener("webkitfullscreenchange", fn);
      };
    },
    isFullscreen,
  );
}

/* ------------------------------------------------------------------ */
/* Instalar como app                                                    */
/* ------------------------------------------------------------------ */

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

// Chrome, Edge y Android avisan de que se puede instalar; guardamos el aviso para el botón.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as InstallPrompt;
  notify();
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  notify();
});

export function isInstalled(): boolean {
  return matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export type InstallState = "installed" | "prompt" | "ios" | "unavailable";

export function useInstall(): { state: InstallState; install: () => Promise<void> } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  const state: InstallState = isInstalled() ? "installed" : deferred ? "prompt" : isIOS() ? "ios" : "unavailable";
  return {
    state,
    install: async () => {
      if (!deferred) return;
      const d = deferred;
      deferred = null;
      await d.prompt();
      await d.userChoice.catch(() => null);
      notify();
    },
  };
}
