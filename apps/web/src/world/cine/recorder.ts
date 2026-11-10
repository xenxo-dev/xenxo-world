/**
 * Grabar lo que dibuja el mundo, en el navegador y sin enviarlo a ningún sitio: el modo cine
 * (state.ts) y los clips de cualquier visitante (el botón de vídeo del HUD).
 *
 * Se graba el canvas del mundo (el HUD es HTML: no sale). Los clips llevan la marca
 * «xenxo.io · lugar»: para eso cada frame se copia a un canvas 2D con el texto encima, y lo que se
 * graba es ese. El archivo se descarga al terminar (MP4 donde el navegador sabe; si no, WebM).
 *
 * El HUD pide (`requestRecording`, `stopRecording`); quien graba es `Recorder.tsx`, dentro de la
 * escena, justo después de dibujar cada frame.
 */
import { useSyncExternalStore } from "react";

export type RecKind = "cine" | "clip";
/** `early`: se paró antes de que el navegador llegase a empezar a grabar (no hay vídeo que guardar). */
export type RecResult = "saved" | "failed" | "unsupported" | "early";

/** Lo más que dura una toma (se corta sola): la grabación se guarda en memoria hasta el final. */
export const REC_MAX_MS: Record<RecKind, number> = { cine: 90_000, clip: 30_000 };
/** Los clips, como mucho con este lado largo (los móviles no pueden con más mientras juegan). */
export const CLIP_MAX_SIDE = 1280;

/** Si el navegador tarda más que esto en empezar a grabar, se da por fallida. */
export const REC_START_MS = 20_000;

export const rec = {
  on: false,
  kind: "clip" as RecKind,
  /**
   * El navegador ya está grabando. Entre pedirlo y que empiece pasa un momento (arranca el
   * codificador; en un equipo sin tarjeta gráfica, varios segundos): hasta entonces no hay vídeo.
   */
  ready: false,
  /** Cuándo empezó de verdad (performance.now), para el contador. */
  since: 0,
  /** Lo que pide el HUD; lo consume la escena. */
  want: null as RecKind | "stop" | null,
  /** Cómo acabó la última (el HUD lo enseña un momento). */
  last: null as { result: RecResult; n: number } | null,
};

let version = 0;
const listeners = new Set<() => void>();
export function bumpRec() {
  version++;
  for (const fn of listeners) fn();
}

export function useRec() {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => version,
  );
  return rec;
}

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;
}

export function requestRecording(kind: RecKind) {
  if (rec.on) return;
  if (!recordingSupported()) return finishRec("unsupported");
  rec.want = kind;
  bumpRec();
}

export function stopRecording() {
  if (!rec.on) return;
  rec.want = "stop";
  bumpRec();
}

export function toggleRecording(kind: RecKind) {
  if (rec.on) stopRecording();
  else requestRecording(kind);
}

export function finishRec(result: RecResult) {
  rec.on = false;
  rec.ready = false;
  rec.want = null;
  rec.last = { result, n: (rec.last?.n ?? 0) + 1 };
  bumpRec();
}

/** El primer formato que este navegador sabe grabar (MP4 se abre en cualquier sitio; WebM, casi). */
export function pickMime(): { mime: string; ext: "mp4" | "webm" } | null {
  const options: [string, "mp4" | "webm"][] = [
    ["video/mp4;codecs=avc1.640028", "mp4"],
    ["video/mp4;codecs=avc1.42E01E", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9", "webm"],
    ["video/webm;codecs=vp8", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mime, ext] of options) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return null;
}
