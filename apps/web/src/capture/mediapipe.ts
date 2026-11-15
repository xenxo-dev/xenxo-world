/**
 * Los puntos del cuerpo y de las manos de quien sale en un vídeo, fotograma a fotograma, con MediaPipe
 * (Pose Landmarker y Hand Landmarker, de Google, Apache-2.0) en el navegador: el vídeo no sale del
 * dispositivo y no se guarda nada. El motor (WebAssembly, public/mediapipe/) y los modelos
 * (public/gestos/vision/) se sirven desde xenxo, nunca de un CDN.
 *
 * El vídeo se recorre a saltos fijos (`fps`), parando en cada fotograma: así sale igual en un equipo
 * rápido y en uno lento, aunque tarde más que verlo. De cada uno: los 33 puntos del cuerpo en metros
 * (desde las caderas), los de cada mano (sobre su centro) y lo que se ve en la imagen, para dibujarlo
 * encima. Las manos se reparten por cercanía a las muñecas del cuerpo (la mano que dice MediaPipe
 * supone una cámara en espejo y no siempre acierta), y la que no está cerca de ninguna es de otra
 * persona y no cuenta.
 */
import type { HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import { LM, type CaptureFrame, type V3 } from "./retarget";

const WASM = "/mediapipe";
const POSE = "/gestos/vision/pose_landmarker_full.task";
const HANDS = "/gestos/vision/hand_landmarker.task";

/** Lo más largo que se analiza de una vez (s): un gesto es corto y cada segundo cuesta su tiempo. */
export const MAX_SECONDS = 20;
/** El lado más largo de la imagen que se analiza (px): MediaPipe la reduce mucho más por dentro. */
const MAX_SIDE = 960;
/** Una mano a más de esto de la muñeca del cuerpo (de la diagonal de la imagen) no es suya. */
const HAND_REACH = 0.12;

interface Detectors {
  pose: PoseLandmarker;
  hands: HandLandmarker;
}

let detectors: Promise<Detectors> | null = null;
/** Las marcas de tiempo de MediaPipe tienen que ir siempre hacia delante (también de un vídeo al siguiente). */
let clock = 0;

/**
 * Los detectores (una vez): unos 10 MB de WebAssembly y 17 MB de modelos la primera vez. Con la
 * gráfica si se puede (`cpu`: sin ella, para un navegador sin gráfica de verdad, donde sería más lento).
 */
export function loadDetectors(cpu = false): Promise<Detectors> {
  detectors ??= (async () => {
    const { FilesetResolver, HandLandmarker, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const files = await FilesetResolver.forVisionTasks(WASM);
    const make = async <T,>(create: (delegate: "GPU" | "CPU") => Promise<T>): Promise<T> => {
      if (cpu) return create("CPU");
      try {
        return await create("GPU");
      } catch {
        return create("CPU");
      }
    };
    const pose = await make((delegate) =>
      PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: POSE, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }),
    );
    const hands = await make((delegate) =>
      HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: HANDS, delegate },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }),
    );
    return { pose, hands };
  })();
  detectors.catch(() => (detectors = null));
  return detectors;
}

/** Lleva el vídeo a `t` (s) y espera a que esté ese fotograma. */
function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((ok, ko) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
      ok();
    };
    const fail = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
      ko(new Error("video"));
    };
    video.addEventListener("seeked", done);
    video.addEventListener("error", fail);
    video.currentTime = t;
  });
}

export interface CaptureOptions {
  /** El trozo (s del vídeo) y cuántos fotogramas por segundo se miran. */
  from: number;
  to: number;
  fps: number;
  signal?: AbortSignal;
  /** Cada fotograma, según sale (para ir dibujándolo y contar cuánto falta). */
  onFrame?: (f: CaptureFrame, done: number, total: number) => void;
}

/**
 * Los puntos de cada fotograma del trozo pedido. Se para (con un AbortError) si `signal` lo pide. Cada
 * fotograma va centrado en un lienzo cuadrado (MediaPipe proyecta mal los puntos de una imagen que no
 * lo es) y lo que se ve en la imagen se devuelve en las medidas del vídeo.
 */
export async function captureVideo(video: HTMLVideoElement, o: CaptureOptions): Promise<CaptureFrame[]> {
  const det = await loadDetectors();
  video.pause();
  const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.max(2, Math.round(video.videoWidth * scale)), h = Math.max(2, Math.round(video.videoHeight * scale));
  const side = Math.max(w, h), ox = (side - w) / 2, oy = (side - h) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  const g = canvas.getContext("2d", { willReadFrequently: false })!;
  const back = (p: { x: number; y: number }): [number, number] => [(p.x * side - ox) / w, (p.y * side - oy) / h];
  const to = Math.min(o.to, o.from + MAX_SECONDS, video.duration || o.to);
  const total = Math.max(1, Math.floor((to - o.from) * o.fps + 1e-6) + 1);
  const frames: CaptureFrame[] = [];
  const step = 1000 / o.fps;
  try {
    for (let i = 0; i < total; i++) {
      if (o.signal?.aborted) throw new DOMException("cancelado", "AbortError");
      const t = o.from + i / o.fps;
      // Un pelo después del fotograma, para no caer en el borde con el anterior.
      await seek(video, Math.min(t + 0.002, Math.max(0, (video.duration || t) - 0.001)));
      g.fillStyle = "#000";
      g.fillRect(0, 0, side, side);
      g.drawImage(video, ox, oy, w, h);
      clock += step;
      const pose = det.pose.detectForVideo(canvas, clock);
      const hands = det.hands.detectForVideo(canvas, clock);
      const f = frameOf(t - o.from, pose, hands, back);
      frames.push(f);
      o.onFrame?.(f, i + 1, total);
      // Un respiro para que la página no se quede parada mientras tanto.
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    canvas.width = canvas.height = 0;
  }
  return frames;
}

type PoseResult = ReturnType<PoseLandmarker["detectForVideo"]>;
type HandResult = ReturnType<HandLandmarker["detectForVideo"]>;

/**
 * Un fotograma: el cuerpo de la primera persona y sus manos (las que estén cerca de sus muñecas). Los
 * puntos de la imagen vienen del lienzo cuadrado; `back` los pasa a las medidas del vídeo.
 */
function frameOf(t: number, pose: PoseResult, hands: HandResult, back: (p: { x: number; y: number }) => [number, number]): CaptureFrame {
  const body = pose.worldLandmarks[0], img = pose.landmarks[0];
  if (!body || !img) return { t, pose: null, hands: [] };
  const v3 = (p: { x: number; y: number; z: number }): V3 => [p.x, p.y, p.z];
  const frame: CaptureFrame = {
    t,
    pose: body.map(v3),
    hands: [],
    view: { pose: img.map(back), vis: img.map((p) => p.visibility ?? 1), hands: [] },
  };
  // Cada mano, a la muñeca más cercana (las dos a la vez: la que mejor reparte las dos distancias),
  // medido en el lienzo cuadrado (igual en horizontal que en vertical; su diagonal, √2).
  const wrists = [img[LM.lWri]!, img[LM.rWri]!];
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) / Math.SQRT2;
  const found = hands.landmarks.map((pts, k) => ({ pts, world: hands.worldLandmarks[k], dist: wrists.map((wr) => d(pts[0]!, wr)) }));
  let pick: (0 | 1 | -1)[] = found.map(() => -1);
  if (found.length === 1) pick = [found[0]!.dist[0]! <= found[0]!.dist[1]! ? 0 : 1];
  else if (found.length >= 2) {
    const [a, b] = found as [(typeof found)[0], (typeof found)[0]];
    pick = a.dist[0]! + b.dist[1]! <= a.dist[1]! + b.dist[0]! ? [0, 1] : [1, 0];
  }
  found.forEach((hnd, k) => {
    const side = pick[k];
    if ((side !== 0 && side !== 1) || !hnd.world || hnd.dist[side]! > HAND_REACH) return;
    frame.hands.push({ side, world: hnd.world.map(v3) });
    frame.view!.hands.push({ side, pts: hnd.pts.map(back) });
  });
  return frame;
}

/**
 * ¿Se ven las piernas? (lo visible de rodillas y tobillos en la mayoría de los fotogramas). Si no, lo
 * suyo es de cintura para arriba: las piernas que da MediaPipe sin verlas son inventadas.
 */
export function legsSeen(frames: CaptureFrame[]): boolean {
  let seen = 0, all = 0;
  for (const f of frames) {
    const v = f.view?.vis;
    if (!v) continue;
    all++;
    if (Math.min(v[LM.lKnee]!, v[LM.rKnee]!, v[LM.lAnk]!, v[LM.rAnk]!) > 0.5) seen++;
  }
  return all > 0 && seen / all > 0.6;
}

/** ¿Se ven las manos? (en cuántos fotogramas, de 0 a 1, cada una). */
export function handsSeen(frames: CaptureFrame[]): [number, number] {
  const n = Math.max(1, frames.length);
  return [0, 1].map((s) => frames.filter((f) => f.hands.some((h) => h.side === s)).length / n) as [number, number];
}
