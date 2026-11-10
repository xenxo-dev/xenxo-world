/**
 * Quien graba de verdad (recorder.ts explica el qué): dentro de la escena, después de dibujar cada
 * frame. En VR no hay canvas que grabar (lo dibuja el casco).
 */
import { useEffect } from "react";
import { addAfterEffect, useThree } from "@react-three/fiber";
import { placeName } from "../../i18n";
import { world } from "../../net/world-store";
import { bumpRec, CLIP_MAX_SIDE, finishRec, pickMime, rec, REC_MAX_MS, REC_START_MS, type RecKind } from "./recorder";

function stamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function save(blob: Blob, ext: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `xenxo-${stamp(new Date())}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

interface Take {
  recorder: MediaRecorder;
  /** Los clips: el canvas 2D con la marca (lo que se graba) y lo necesario para pintarla. */
  mark: { out: HTMLCanvasElement; g: CanvasRenderingContext2D; text: string; font: string } | null;
  /** El navegador ya graba (evento `start`): antes no hay nada que guardar. */
  started: boolean;
  /** Se paró antes de empezar: al cerrarse no se guarda nada. */
  early: boolean;
  /** Hasta cuándo: para empezar (antes de `started`) o para acabar la toma (después). */
  deadline: number;
}

function start(src: HTMLCanvasElement, kind: RecKind, fps: number): Take | null {
  const pick = pickMime();
  if (!pick || !src.width || !src.height) return null;
  let mark: Take["mark"] = null;
  let stream: MediaStream;
  if (kind === "clip") {
    const k = Math.min(1, CLIP_MAX_SIDE / Math.max(src.width, src.height));
    const out = document.createElement("canvas");
    // Pares: los codificadores de vídeo no admiten lados impares.
    out.width = Math.round((src.width * k) / 2) * 2;
    out.height = Math.round((src.height * k) / 2) * 2;
    const g = out.getContext("2d");
    if (!g) return null;
    const place = placeName(world.chunkId);
    mark = { out, g, text: `xenxo.io · ${place.charAt(0).toUpperCase()}${place.slice(1)}`, font: getComputedStyle(document.body).fontFamily || "sans-serif" };
    stream = out.captureStream(fps);
  } else stream = src.captureStream(fps);

  const chunks: Blob[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: pick.mime, videoBitsPerSecond: kind === "cine" ? 14_000_000 : 6_000_000 });
  } catch {
    return null;
  }
  const take: Take = { recorder, mark, started: false, early: false, deadline: performance.now() + REC_START_MS };
  // Desde aquí hay vídeo: el contador y el tope de la toma cuentan desde este momento.
  const begin = () => {
    if (take.started) return;
    take.started = true;
    take.deadline = performance.now() + REC_MAX_MS[kind];
    rec.ready = true;
    rec.since = performance.now();
    bumpRec();
  };
  recorder.onstart = begin;
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return;
    chunks.push(e.data);
    // Por si algún navegador entrega vídeo sin haber avisado de que empezaba.
    begin();
  };
  recorder.onerror = () => finishRec("failed");
  recorder.onstop = () => {
    for (const t of stream.getTracks()) t.stop();
    if (take.early) return finishRec("early");
    const blob = new Blob(chunks, { type: pick.mime.split(";")[0] });
    // Algún navegador dice que sabe un formato y luego no entrega nada: eso no es un vídeo.
    if (blob.size < 2048) return finishRec("failed");
    save(blob, pick.ext);
    finishRec("saved");
  };
  recorder.start(1000);
  return take;
}

/** La marca discreta de los clips, abajo a la derecha (como la del modo foto). */
function drawMark(src: HTMLCanvasElement, m: NonNullable<Take["mark"]>) {
  const { out, g } = m;
  g.drawImage(src, 0, 0, out.width, out.height);
  const size = Math.max(14, Math.round(out.height * 0.022));
  const pad = Math.round(size * 0.9);
  g.font = `600 ${size}px ${m.font}`;
  g.textAlign = "right";
  g.textBaseline = "bottom";
  g.shadowColor = "rgba(0,0,0,0.65)";
  g.shadowBlur = size * 0.5;
  g.fillStyle = "rgba(255,255,255,0.88)";
  g.fillText(m.text, out.width - pad, out.height - pad);
}

export function Recorder({ fps }: { fps: number }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    let take: Take | null = null;
    const stop = () => {
      const t = take;
      take = null;
      if (t && t.recorder.state !== "inactive") t.recorder.stop();
    };
    const off = addAfterEffect(() => {
      if (rec.want && rec.want !== "stop" && !take) {
        const kind = rec.want;
        rec.want = null;
        // En las gafas no hay canvas que grabar; sin fotogramas por segundo, este equipo no graba.
        take = gl.xr.isPresenting || fps <= 0 ? null : start(gl.domElement, kind, fps);
        if (!take) return finishRec("unsupported");
        rec.on = true;
        rec.ready = false;
        rec.kind = kind;
        rec.since = performance.now();
        bumpRec();
      }
      if (!take) return;
      // El mismo frame que acaba de dibujarse: la copia es síncrona.
      if (take.mark) drawMark(gl.domElement, take.mark);
      const late = performance.now() > take.deadline;
      if (rec.want === "stop" || late || gl.xr.isPresenting) {
        // Parar antes de que el navegador empiece a grabar no deja vídeo: se dice (salvo que sea
        // el navegador el que no arranca: eso es un fallo).
        take.early = !take.started && !late;
        rec.want = null;
        stop();
      }
    });
    return () => {
      off();
      stop();
    };
  }, [gl, fps]);
  return null;
}
