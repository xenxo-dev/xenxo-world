/**
 * Modo foto: con la tecla P o el botón del HUD se guarda lo que se ve (sin el HUD) como PNG, con
 * una marca discreta «xenxo.io · lugar». Se copia justo después de dibujar el frame (con el
 * post-proceso incluido), así que no hace falta `preserveDrawingBuffer` ni dibujar dos veces.
 * Todo ocurre en el navegador: la foto no sale del equipo de la persona.
 */
import { useEffect } from "react";
import { addAfterEffect, useThree } from "@react-three/fiber";
import { placeName } from "../i18n";
import { world } from "../net/world-store";
import { emitPhoto, input } from "./input";

function stamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function capture(src: HTMLCanvasElement) {
  const w = src.width;
  const h = src.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const g = out.getContext("2d");
  if (!g || !w || !h) return emitPhoto(false);
  // Mismo frame que acaba de dibujarse: la copia es síncrona.
  g.drawImage(src, 0, 0);

  const size = Math.max(14, Math.round(h * 0.022));
  const pad = Math.round(size * 0.9);
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";
  const place = placeName(world.chunkId);
  const text = `xenxo.io · ${place.charAt(0).toUpperCase()}${place.slice(1)}`;
  g.font = `600 ${size}px ${font}`;
  g.textAlign = "right";
  g.textBaseline = "bottom";
  g.shadowColor = "rgba(0,0,0,0.65)";
  g.shadowBlur = size * 0.5;
  g.fillStyle = "rgba(255,255,255,0.88)";
  g.fillText(text, w - pad, h - pad);

  out.toBlob((blob) => {
    if (!blob) return emitPhoto(false);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `xenxo-${stamp(new Date())}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    emitPhoto(true);
  }, "image/png");
}

export function PhotoTaker() {
  const gl = useThree((s) => s.gl);
  useEffect(
    () =>
      addAfterEffect(() => {
        if (!input.photo) return;
        input.photo = false;
        // En VR no hay canvas que copiar (lo dibuja el casco).
        if (gl.xr.isPresenting) return;
        capture(gl.domElement);
      }),
    [gl],
  );
  return null;
}
