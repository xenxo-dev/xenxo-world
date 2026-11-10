/**
 * La barra del modo cine (world/cine): qué cámara, qué encuadre, con o sin personaje, y grabar.
 * Sustituye al HUD mientras se rueda; no sale en el vídeo (se graba el canvas, y esto es HTML).
 * También el botón de clip de cualquier visitante y el aviso de cómo acabó la grabación.
 */
import { useEffect, useState } from "react";
import { t, useLang, type Key } from "../i18n";
import { recordingSupported, toggleRecording, useRec } from "../world/cine/recorder";
import { CINE_CAMS, CINE_FRAMES, setCine, useCine } from "../world/cine/state";

const box = "rounded-2xl border border-cal/15 bg-noche/85 backdrop-blur";
const chip = (on: boolean) => `rounded-lg px-2.5 py-1 text-xs transition ${on ? "bg-neon/20 text-neon" : "text-cal/75 hover:bg-cal/10"}`;

/** «0:07» mientras se graba (se refresca dos veces por segundo, no por frame). */
function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((performance.now() - since) / 1000));
  return (
    <span className="meta tabular-nums">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

/** Cómo acabó la última grabación, un momento (también para los clips). */
export function RecNotice() {
  useLang();
  const r = useRec();
  const [shown, setShown] = useState(0);
  const n = r.last?.n ?? 0;
  useEffect(() => {
    if (!n) return;
    setShown(n);
    const id = setTimeout(() => setShown(0), 4000);
    return () => clearTimeout(id);
  }, [n]);
  if (!r.last || shown !== n) return null;
  return (
    <p role="status" className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 rounded-xl border border-cal/10 bg-noche/80 px-3 py-1.5 text-sm text-cal/85 backdrop-blur">
      {t(`clip.${r.last.result}` as Key)}
    </p>
  );
}

export function CineBar() {
  useLang();
  const c = useCine();
  const r = useRec();
  if (!c.on) return null;
  if (!c.bar) {
    // Escondida: solo la luz de grabando (fuera del encuadre no hay nada más).
    return r.on ? <span aria-hidden className={`pointer-events-none absolute right-4 top-4 h-3 w-3 rounded-full bg-red-500 ${r.ready ? "animate-pulse" : "opacity-50"}`} /> : null;
  }
  // Con un encuadre estrecho (vertical o cuadrado) queda sitio a los lados: la barra va ahí, sin
  // tapar la imagen. Con la pantalla entera o en horizontal, abajo en el centro (H la esconde).
  const side = c.frame === "9:16" || c.frame === "1:1";
  const place = side ? "bottom-4 left-4 w-[min(92vw,26rem)]" : "bottom-4 left-1/2 w-[min(96vw,640px)] -translate-x-1/2";
  return (
    <div className={`${box} pointer-events-auto absolute flex flex-col gap-2 p-3 text-sm text-cal ${place}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="display text-neon">{t("cine.title")}</span>
        <button className="btn-ghost rounded-lg px-2.5 py-1 text-xs" onClick={() => setCine({ on: false })}>
          {t("cine.exit")}
        </button>
      </div>
      <p className="-mt-1 text-[11px] text-cal/50">{t("cine.keys")}</p>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("cine.camera")}>
        <span className="mr-1 text-xs text-cal/55">{t("cine.camera")}</span>
        {CINE_CAMS.map((cam) => (
          <button key={cam} className={chip(c.cam === cam)} aria-pressed={c.cam === cam} onClick={() => setCine({ cam })}>
            {t(`cine.cam.${cam}` as Key)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("cine.frame")}>
        <span className="mr-1 text-xs text-cal/55">{t("cine.frame")}</span>
        {CINE_FRAMES.map((f) => (
          // Con la grabación en marcha no se cambia el tamaño del vídeo.
          <button key={f} className={chip(c.frame === f)} aria-pressed={c.frame === f} disabled={r.on} onClick={() => setCine({ frame: f })}>
            {f === "free" ? t("cine.frame.free") : f}
          </button>
        ))}
        <button className={`${chip(c.hideSelf)} ml-auto`} aria-pressed={c.hideSelf} onClick={() => setCine({ hideSelf: !c.hideSelf })}>
          {t("cine.noSelf")}
        </button>
      </div>
      <div className="flex items-center gap-3">
        <button
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ${r.on ? "bg-red-500/20 text-red-100" : "neon-tube"}`}
          disabled={!recordingSupported()}
          onClick={() => toggleRecording("cine")}
        >
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full bg-red-500 ${r.on && r.ready ? "animate-pulse" : ""}`} />
          {r.on ? (r.ready ? t("cine.stop") : t("cine.preparing")) : t("cine.record")}
          {r.on && r.ready && <Elapsed since={r.since} />}
        </button>
        <span className="text-xs text-cal/55">{recordingSupported() ? t("cine.note") : t("clip.unsupported")}</span>
      </div>
    </div>
  );
}

/** El botón de clip del HUD (arriba, junto a la foto): graba hasta 30 s con la marca de xenxo. */
export function ClipButton({ className }: { className: string }) {
  useLang();
  const r = useRec();
  if (!recordingSupported()) return null;
  const on = r.on && r.kind === "clip";
  return (
    <button title={t(on ? "clip.stop" : "clip.start")} aria-label={t(on ? "clip.stop" : "clip.start")} aria-pressed={on} onClick={() => toggleRecording("clip")} className={className}>
      {on ? (
        // Parpadea cuando ya graba de verdad; mientras el navegador arranca, quieto y apagado.
        <span aria-hidden className={`h-3 w-3 rounded-sm bg-red-500 ${r.ready ? "animate-pulse" : "opacity-50"}`} />
      ) : (
        <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="7" width="12" height="10" rx="2" />
          <path d="M15 10.5 21 7.5v9l-6-3z" />
        </svg>
      )}
    </button>
  );
}
