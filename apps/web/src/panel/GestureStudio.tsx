/**
 * El estudio de gestos (Crear → «Gestos desde un vídeo»): de un vídeo de una persona, su movimiento en
 * un personaje. Todo en el navegador: MediaPipe saca los puntos del cuerpo y de las manos de cada
 * fotograma (capture/mediapipe.ts), se pasan al esqueleto (capture/retarget.ts) y se ven con un
 * personaje, al lado del vídeo o tal como iría en el juego (el mismo animador del mundo: el clip se le
 * da en memoria, animation.ts → provideClip). Se descarga en .vrma (con su ficha de gesto dentro, que
 * lee `npm run gesture:add`) y en .bvh. El vídeo no se envía ni se guarda; al cerrar, se suelta.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMAnimationLoaderPlugin, type VRMAnimation } from "@pixiv/three-vrm-animation";
import { EMOTES } from "@xenxo/protocol";
import { t, useLang, type Key } from "../i18n";
import { assetUrl } from "../config";
import { useAccount } from "../net/account";
import { AVATAR_PRESETS } from "../world/presets";
import { loadAvatar, type LoadedAvatar } from "../world/avatar-model";
import { createMotion } from "../world/motion";
import { EMOTE_CLIPS, forgetClip, provideClip } from "../world/animation";
import { coverWorld } from "../world/cover";
import { retarget, type CaptureFrame, type Motion, type RestBone } from "../capture/retarget";
import { restOf } from "../capture/rest";
import { GESTURE_ID, writeBvh, writeVrma, type GestureMeta } from "../capture/files";
import { captureVideo, handsSeen, legsSeen, loadDetectors, MAX_SECONDS } from "../capture/mediapipe";
import { Button, Notice, Segmented } from "./ui";
import { Chip, Section } from "./funda-ui";

/** Fotogramas por segundo que se analizan (y los del clip). */
const FPS = 30;
const range = "mt-1 w-full touch-pan-y accent-[var(--color-neon)] pointer-coarse:h-9";
const field = "w-full rounded-xl border border-cal/10 bg-cal/5 px-3 py-2 text-cal outline-none focus:border-neon";

/** El nombre en el juego a partir del nombre en español: «Saludo militar» → saludo_militar. */
function slug(s: string): string {
  const out = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24)
    .replace(/_+$/, "");
  return out || "gesto";
}

const fmt = (s: number) => `${s.toFixed(1).replace(".", t("gesture.decimal"))} s`;

interface Captured {
  frames: CaptureFrame[];
  /** Desde dónde del vídeo (s). */
  from: number;
}

interface Options {
  once: boolean;
  overlay: boolean;
  upper: boolean;
  ground: boolean;
  smooth: number;
}

export default function GestureStudio({ onClose }: { onClose: () => void }) {
  useLang();
  const user = useAccount();
  useEffect(() => coverWorld(), []);
  const video = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [badVideo, setBadVideo] = useState(false);
  const [duration, setDuration] = useState(0);
  const [mirror, setMirror] = useState(false);
  const [cut, setCut] = useState<[number, number]>([0, 0]);
  const [state, setState] = useState<"idle" | "models" | "working" | "done" | "none" | "error">("idle");
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [cap, setCap] = useState<Captured | null>(null);
  const [opts, setOpts] = useState<Options>({ once: true, overlay: false, upper: true, ground: true, smooth: 1.2 });
  const [es, setEs] = useState("");
  const [en, setEn] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [avatar, setAvatar] = useState<string>(AVATAR_PRESETS[0]!.hash);
  const [mode, setMode] = useState<"video" | "game">("video");
  const [walking, setWalking] = useState(false);
  const [rest, setRest] = useState<RestBone[] | null>(null);
  const [clip, setClip] = useState<{ name: string; motion: Motion; seconds: number; once: boolean } | null>(null);
  const clipName = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // El vídeo elegido: solo en este navegador (una URL blob:), que se suelta al cambiar o cerrar.
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  useEffect(() => () => abort.current?.abort(), []);
  // Los detectores, mientras se elige el trozo: la primera vez tardan.
  useEffect(() => {
    if (url) void loadDetectors().catch(() => {});
  }, [url]);

  const pick = (file: File | undefined) => {
    if (!file) return;
    abort.current?.abort();
    setUrl(URL.createObjectURL(file));
    setBadVideo(false);
    setCap(null);
    setClip(null);
    setState("idle");
    setDuration(0);
    setCut([0, 0]);
    if (!es) {
      const base = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 40);
      if (base) {
        setEs(base);
        if (!idEdited) setId(slug(base));
      }
    }
  };

  const analyze = async () => {
    const v = video.current;
    if (!v || !duration) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const [from, to] = cut;
    setCap(null);
    setClip(null);
    setState("models");
    try {
      await loadDetectors();
      setState("working");
      setProgress([0, Math.floor(Math.min(to - from, MAX_SECONDS) * FPS) + 1]);
      const frames = await captureVideo(v, { from, to, fps: FPS, signal: ctrl.signal, onFrame: (_, done, total) => setProgress([done, total]) });
      if (ctrl.signal.aborted) return;
      if (frames.filter((f) => f.pose).length < Math.max(3, frames.length * 0.3)) {
        setState("none");
        return;
      }
      const overlay = !legsSeen(frames);
      setOpts((o) => ({ ...o, overlay, upper: true, ground: !overlay }));
      setCap({ frames, from });
      setState("done");
      v.currentTime = from;
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return;
      console.warn("[xenxo] estudio de gestos", e);
      setState("error");
    }
  };

  // El trozo que se usa de lo analizado (s desde el principio de lo analizado).
  const capDur = cap ? (cap.frames.length - 1) / FPS : 0;
  const use = useMemo<[number, number] | null>(() => {
    if (!cap) return null;
    const a = Math.max(0, cut[0] - cap.from), b = Math.min(capDur, cut[1] - cap.from);
    return b - a >= 0.2 ? [a, b] : null;
  }, [cap, cut, capDur]);
  const outside = !!cap && (cut[0] < cap.from - 0.05 || cut[1] > cap.from + capDur + 0.05);
  const seen = useMemo<[number, number]>(() => (cap ? handsSeen(cap.frames) : [0, 0]), [cap]);
  const fingers = seen[0] > 0.3 || seen[1] > 0.3;

  const idTaken = !!id && ((EMOTES as readonly string[]).includes(id) || (!!EMOTE_CLIPS[id] && !id.startsWith("__")));
  const idOk = GESTURE_ID.test(id) && !id.startsWith("pk_");
  const meta: GestureMeta | null = idOk && es.trim() && en.trim() ? { id, es: es.trim(), en: en.trim(), once: opts.once, upper: opts.overlay || opts.upper, overlay: opts.overlay, fingers } : null;

  // El movimiento en el personaje elegido (cada vez que cambia algo, con un respiro) y su clip en memoria.
  useEffect(() => {
    if (!cap || !use || !rest) return;
    let alive = true;
    const id = window.setTimeout(() => {
      const frames = cap.frames.filter((f) => f.t >= use[0] - 1e-6 && f.t <= use[1] + 1e-6);
      const motion = retarget(frames, rest, { fps: FPS, mirror, upper: opts.overlay, ground: opts.ground && !opts.overlay, smooth: opts.smooth, loop: !opts.once });
      void toClip(motion).then((anim) => {
        if (!alive || !anim) return;
        const name = `__studio_${++studioClips}`;
        provideClip(name, anim, { once: opts.once, upper: opts.overlay || opts.upper, overlay: opts.overlay }, fingers);
        // El de antes, cuando el personaje ya haya pasado al nuevo.
        const old = clipName.current;
        clipName.current = name;
        if (old) window.setTimeout(() => forgetClip(old), 2000);
        setClip({ name, motion, seconds: anim.duration, once: opts.once });
      });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [cap, use, rest, mirror, opts, fingers]);
  useEffect(
    () => () => {
      if (clipName.current) forgetClip(clipName.current);
    },
    [],
  );

  const download = (kind: "vrma" | "bvh") => {
    if (!clip || !meta) return;
    const blob = kind === "vrma" ? new Blob([writeVrma(clip.motion, meta, meta.id)], { type: "model/gltf-binary" }) : new Blob([writeBvh(clip.motion)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${meta.id}.${kind}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const mine = user?.avatar_hash && user.avatar_format === "vrm" ? user.avatar_hash : null;
  const working = state === "models" || state === "working";

  const body = (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-noche pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] text-cal"
      role="dialog"
      aria-modal="true"
      aria-label={t("gesture.title")}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-cal/10 px-4 py-3 tight:py-1">
        <h2 className="display min-w-0 truncate text-base font-semibold sm:text-lg">{t("gesture.title")}</h2>
        <button onClick={onClose} className="ml-auto shrink-0 rounded-lg px-3 py-2 text-sm text-cal/70 hover:bg-cal/10 hover:text-cal">
          {t("gesture.close")}
        </button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(14rem,48%)_minmax(0,1fr)] duo:grid-cols-[minmax(40%,1fr)_minmax(17rem,26rem)] duo:grid-rows-[minmax(0,1fr)]">
        {/* El vídeo y el personaje, lado a lado (o uno encima del otro si no caben). */}
        <div className="grid min-h-0 min-w-0 grid-cols-2 gap-px bg-cal/10 duo:grid-cols-1 duo:grid-rows-2 lg:duo:grid-cols-2 lg:duo:grid-rows-1">
          <div className="relative min-h-0 min-w-0 bg-noche">
            {url ? (
              <>
                <video
                  ref={video}
                  src={url}
                  className="absolute inset-0 h-full w-full object-contain"
                  playsInline
                  muted
                  controls
                  preload="auto"
                  onLoadedMetadata={(e) => {
                    const d = e.currentTarget.duration;
                    if (!Number.isFinite(d) || d <= 0) return setBadVideo(true);
                    setDuration(d);
                    setCut([0, Math.min(d, MAX_SECONDS)]);
                  }}
                  onError={() => setBadVideo(true)}
                />
                <Overlay video={video} cap={cap} />
              </>
            ) : (
              <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-cal/45">{t("gesture.empty")}</p>
            )}
          </div>
          <div className="relative min-h-0 min-w-0 bg-[radial-gradient(circle_at_50%_70%,rgb(62_230_255/0.12),transparent_65%)]">
            <Preview url={assetUrl(avatar)} clip={clip} video={video} use={use} offset={cap?.from ?? 0} mode={mode} walking={walking} onRest={setRest} />
            {!clip && <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-cal/45">{t("gesture.emptyAvatar")}</p>}
          </div>
        </div>

        {/* Los pasos */}
        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain border-t border-cal/10 p-4 duo:border-l duo:border-t-0 tight:p-3">
          <Section title={t("gesture.step.video")}>
            <p className="mb-2 text-xs leading-relaxed text-cal/60">{t("gesture.intro")}</p>
            <label className="btn-ghost inline-flex cursor-pointer items-center rounded-xl px-4 py-2 text-sm">
              {url ? t("gesture.change") : t("gesture.pick")}
              <input type="file" accept="video/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            <p className="mt-2 text-[11px] text-cal/45">{t("gesture.privacy")}</p>
            {badVideo && <Notice tone="error">{t("gesture.badVideo")}</Notice>}
            <label className="mt-3 flex items-start gap-2 text-sm text-cal/80">
              <input type="checkbox" className="mt-1 accent-[var(--color-neon)]" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
              {t("gesture.mirror")}
            </label>
          </Section>

          {duration > 0 && (
            <Section title={t("gesture.trim")} note={t("gesture.trimNote")}>
              <div className="flex flex-wrap gap-2">
                <Button className="!py-1.5 text-xs" onClick={() => video.current && setCut(([, b]) => [Math.min(video.current!.currentTime, b - 0.2), b])}>
                  {t("gesture.from")}
                </Button>
                <Button className="!py-1.5 text-xs" onClick={() => video.current && setCut(([a]) => [a, Math.max(video.current!.currentTime, a + 0.2)])}>
                  {t("gesture.to")}
                </Button>
              </div>
              <p className="meta mt-2 text-xs text-cal/60">{t("gesture.range", { from: fmt(cut[0]), to: fmt(cut[1]), len: fmt(cut[1] - cut[0]) })}</p>
              {cut[1] - cut[0] > MAX_SECONDS && <Notice>{t("gesture.tooLong", { max: MAX_SECONDS })}</Notice>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {working ? (
                  <Button onClick={() => abort.current?.abort()}>{t("gesture.cancel")}</Button>
                ) : (
                  <Button variant="primary" disabled={badVideo || cut[1] - cut[0] < 0.2} onClick={() => void analyze()}>
                    {cap ? t("gesture.again") : t("gesture.analyze")}
                  </Button>
                )}
              </div>
              <div aria-live="polite">
                {state === "models" && <p className="mt-2 text-xs text-cal/60">{t("gesture.models")}</p>}
                {state === "working" && (
                  <div className="mt-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-cal/10">
                      <div className="h-full bg-neon transition-[width]" style={{ width: `${progress[1] ? (progress[0] / progress[1]) * 100 : 0}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-cal/60">{t("gesture.working", { done: progress[0], total: progress[1] })}</p>
                  </div>
                )}
                {state === "none" && <Notice tone="error">{t("gesture.noPerson")}</Notice>}
                {state === "error" && <Notice tone="error">{t("gesture.error")}</Notice>}
                {cap && <p className="mt-2 text-xs text-cal/60">{t("gesture.found", { frames: cap.frames.length, left: Math.round(seen[0] * 100), right: Math.round(seen[1] * 100) })}</p>}
                {outside && <Notice>{t("gesture.outside")}</Notice>}
              </div>
            </Section>
          )}

          {cap && (
            <>
              <Section title={t("gesture.how")}>
                <Segmented
                  value={opts.once ? "once" : "loop"}
                  onChange={(v) => setOpts((o) => ({ ...o, once: v === "once" }))}
                  options={[
                    { id: "once", label: t("gesture.once") },
                    { id: "loop", label: t("gesture.loop") },
                  ]}
                />
                <Check on={opts.overlay} set={(v) => setOpts((o) => ({ ...o, overlay: v, ground: !v }))} label={t("gesture.overlay")} hint={t("gesture.overlayHint")} />
                <Check on={opts.overlay || opts.upper} disabled={opts.overlay} set={(v) => setOpts((o) => ({ ...o, upper: v }))} label={t("gesture.walk")} />
                <Check on={opts.ground && !opts.overlay} disabled={opts.overlay} set={(v) => setOpts((o) => ({ ...o, ground: v }))} label={t("gesture.ground")} />
                <label className="mt-3 block">
                  <span className="flex justify-between text-xs text-cal/70">
                    {t("gesture.smooth")}
                    <span className="meta text-cal/40">{opts.smooth.toFixed(1)}</span>
                  </span>
                  <input type="range" min={0} max={3} step={0.1} value={opts.smooth} onChange={(e) => setOpts((o) => ({ ...o, smooth: Number(e.target.value) }))} className={range} />
                </label>
              </Section>

              <Section title={t("gesture.preview")}>
                <Segmented
                  value={mode}
                  onChange={setMode}
                  options={[
                    { id: "video", label: t("gesture.withVideo") },
                    { id: "game", label: t("gesture.inGame") },
                  ]}
                />
                {mode === "game" && <Check on={walking} set={setWalking} label={t("gesture.walking")} />}
                <div className="mt-3 flex flex-wrap gap-1">
                  {mine && (
                    <Chip on={avatar === mine} onClick={() => setAvatar(mine)}>
                      {t("gesture.yours")}
                    </Chip>
                  )}
                  {AVATAR_PRESETS.map((p) => (
                    <Chip key={p.id} on={avatar === p.hash} onClick={() => setAvatar(p.hash)}>
                      {p.name}
                    </Chip>
                  ))}
                </div>
              </Section>

              <Section title={t("gesture.sheet")}>
                <label className="block text-xs text-cal/70" htmlFor="gesture-es">
                  {t("gesture.nameEs")}
                </label>
                <input
                  id="gesture-es"
                  className={`${field} mt-1`}
                  maxLength={40}
                  value={es}
                  onChange={(e) => {
                    setEs(e.target.value);
                    if (!idEdited) setId(slug(e.target.value));
                  }}
                />
                <label className="mt-3 block text-xs text-cal/70" htmlFor="gesture-en">
                  {t("gesture.nameEn")}
                </label>
                <input id="gesture-en" className={`${field} mt-1`} maxLength={40} value={en} onChange={(e) => setEn(e.target.value)} />
                <label className="mt-3 block text-xs text-cal/70" htmlFor="gesture-id">
                  {t("gesture.id")}
                </label>
                <input
                  id="gesture-id"
                  className={`${field} meta mt-1`}
                  maxLength={24}
                  value={id}
                  spellCheck={false}
                  autoCapitalize="off"
                  onChange={(e) => {
                    setId(e.target.value.toLowerCase());
                    setIdEdited(true);
                  }}
                />
                <p className="mt-1 text-[11px] text-cal/45">{t("gesture.idHint")}</p>
                {!idOk && id && <Notice tone="error">{t("gesture.idBad")}</Notice>}
                {idOk && idTaken && <Notice tone="error">{t("gesture.idTaken")}</Notice>}
              </Section>

              <Section title={t("gesture.download")}>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" disabled={!clip || !meta || idTaken} onClick={() => download("vrma")}>
                    {t("gesture.vrma")}
                  </Button>
                  <Button disabled={!clip || !meta || idTaken} onClick={() => download("bvh")}>
                    {t("gesture.bvh")}
                  </Button>
                </div>
                {!meta && <p className="mt-2 text-xs text-cal/50">{t("gesture.needSheet")}</p>}
                <p className="mt-4 text-xs leading-relaxed text-cal/60">{t("gesture.add")}</p>
                <code className="meta mt-2 block select-all rounded-lg bg-cal/5 px-3 py-2 text-xs text-cal/80">npm run gesture:add -- {meta?.id ?? "gesto"}.vrma</code>
              </Section>
            </>
          )}
          <p className="mt-2 text-[11px] text-cal/35">{t("gesture.credit")}</p>
        </div>
      </div>
    </div>
  );
  return createPortal(body, document.body);
}

let studioClips = 0;
let vrmaLoader: GLTFLoader | null = null;
/** El .vrma del movimiento, leído como lo leería el juego (lo que se ve es lo que se descarga). */
async function toClip(m: Motion): Promise<VRMAnimation | null> {
  vrmaLoader ??= new GLTFLoader().register((p) => new VRMAnimationLoaderPlugin(p));
  const bytes = writeVrma(m);
  try {
    const g = await vrmaLoader.parseAsync(bytes.buffer as ArrayBuffer, "");
    return (g.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0] ?? null;
  } catch (e) {
    console.warn("[xenxo] estudio de gestos: clip", e);
    return null;
  }
}

function Check({ on, set, label, hint, disabled }: { on: boolean; set: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`mt-3 flex items-start gap-2 text-sm ${disabled ? "text-cal/40" : "text-cal/80"}`}>
      <input type="checkbox" className="mt-1 accent-[var(--color-neon)]" checked={on} disabled={disabled} onChange={(e) => set(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="mt-0.5 block text-xs text-cal/45">{hint}</span>}
      </span>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Los puntos encima del vídeo                                          */
/* ------------------------------------------------------------------ */

/** Los tramos del cuerpo que se dibujan (de la persona: los de su izquierda, de un color; los de su derecha, de otro). */
const BONES: [number, number, 0 | 1 | 2][] = [
  [11, 12, 2], [23, 24, 2], [11, 23, 0], [12, 24, 1],
  [11, 13, 0], [13, 15, 0], [12, 14, 1], [14, 16, 1],
  [23, 25, 0], [25, 27, 0], [27, 29, 0], [29, 31, 0], [27, 31, 0],
  [24, 26, 1], [26, 28, 1], [28, 30, 1], [30, 32, 1], [28, 32, 1],
];
const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

function Overlay({ video, cap }: { video: RefObject<HTMLVideoElement | null>; cap: Captured | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!cap) return;
    const css = getComputedStyle(document.documentElement);
    const colors = [css.getPropertyValue("--color-neon").trim() || "#36d9ff", css.getPropertyValue("--color-rosa").trim() || "#ff4fd8", css.getPropertyValue("--color-cal").trim() || "#f6f1e7"];
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current, v = video.current;
      if (!c || !v) return;
      const box = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(box.width * dpr), H = Math.round(box.height * dpr);
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const g = c.getContext("2d");
      if (!g) return;
      g.clearRect(0, 0, W, H);
      const i = Math.round((v.currentTime - cap.from) * FPS);
      const f = cap.frames[i];
      if (!f?.view || !v.videoWidth) return;
      // Donde queda la imagen dentro de la caja (object-contain).
      const s = Math.min(W / v.videoWidth, H / v.videoHeight);
      const w = v.videoWidth * s, h = v.videoHeight * s, ox = (W - w) / 2, oy = (H - h) / 2;
      const at = (p: [number, number]) => [ox + p[0] * w, oy + p[1] * h] as const;
      g.lineWidth = 2.5 * dpr;
      g.lineCap = "round";
      for (const [a, b, side] of BONES) {
        if (f.view.vis[a]! < 0.4 || f.view.vis[b]! < 0.4) continue;
        const [x1, y1] = at(f.view.pose[a]!), [x2, y2] = at(f.view.pose[b]!);
        g.strokeStyle = colors[side]!;
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
      }
      g.lineWidth = 1.5 * dpr;
      for (const hand of f.view.hands) {
        g.strokeStyle = colors[hand.side]!;
        for (const [a, b] of HAND_BONES) {
          const [x1, y1] = at(hand.pts[a]!), [x2, y2] = at(hand.pts[b]!);
          g.beginPath();
          g.moveTo(x1, y1);
          g.lineTo(x2, y2);
          g.stroke();
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [cap, video]);
  return <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}

/* ------------------------------------------------------------------ */
/* El personaje                                                          */
/* ------------------------------------------------------------------ */

interface PreviewProps {
  url: string;
  clip: { name: string; seconds: number; once: boolean } | null;
  video: RefObject<HTMLVideoElement | null>;
  /** El trozo del clip dentro de lo analizado (s) y desde dónde del vídeo se analizó. */
  use: [number, number] | null;
  offset: number;
  mode: "video" | "game";
  walking: boolean;
  onRest: (bones: RestBone[] | null) => void;
}

function Preview(p: PreviewProps) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  return (
    <>
      {/* Los avatares miran a −z: la cámara, delante, con sitio para la mano en alto y los pies. */}
      <Canvas dpr={[1, 1.5]} camera={{ position: [0, 1.0, -4.4], fov: 30 }} gl={{ antialias: true, alpha: true, powerPreference: "low-power" }} onCreated={({ camera }) => camera.lookAt(0, 0.9, 0)}>
        <hemisphereLight args={["#cfe8ff", "#1a1030", 1.1]} />
        <directionalLight position={[-2, 3, -2.5]} intensity={1.6} />
        <directionalLight position={[2.5, 1.5, 2]} intensity={1.2} color="#9beaff" />
        <Suspense fallback={null}>
          <Model {...p} onState={setState} />
        </Suspense>
        <mesh rotation-x={-Math.PI / 2} position-y={0.002}>
          <ringGeometry args={[0.62, 0.66, 64]} />
          <meshBasicMaterial color="#3ee6ff" toneMapped={false} />
        </mesh>
        <OrbitControls target={[0, 0.9, 0]} enablePan={false} minDistance={1.2} maxDistance={6} minPolarAngle={Math.PI / 3.2} maxPolarAngle={Math.PI / 1.8} />
      </Canvas>
      {state === "loading" && <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-xs text-cal/50">{t("gesture.loadingAvatar")}</p>}
      {state === "error" && <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-xs text-red-200">{t("gesture.avatarError")}</p>}
    </>
  );
}

function Model({ url, clip, video, use, offset, mode, walking, onRest, onState }: PreviewProps & { onState: (s: "loading" | "ready" | "error") => void }) {
  const [avatar, setAvatar] = useState<LoadedAvatar | null>(null);
  const motion = useRef(createMotion()).current;
  const replay = useRef(0);
  useEffect(() => {
    let alive = true;
    let loaded: LoadedAvatar | null = null;
    onState("loading");
    loadAvatar(url)
      .then((a) => {
        if (!alive) return a.dispose();
        loaded = a;
        setAvatar(a);
        onRest(a.vrm ? restOf(a.vrm) : null);
        onState(a.vrm ? "ready" : "error");
      })
      .catch(() => alive && onState("error"));
    return () => {
      alive = false;
      setAvatar(null);
      loaded?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    if (!avatar) return;
    if (!clip || !use) {
      motion.emote = null;
      motion.emoteAt = undefined;
      motion.speed = 0;
    } else if (mode === "video") {
      // Al lado del vídeo: el momento del clip que corresponde a lo que enseña el vídeo.
      const v = video.current;
      const at = v ? v.currentTime - offset - use[0] : 0;
      motion.emote = clip.name;
      motion.emoteAt = Math.max(0, Math.min(clip.seconds, at));
      motion.speed = 0;
    } else {
      // Como en el juego: el gesto pedido (los de una vez, otra vez cada poco), quieto o andando.
      motion.emoteAt = undefined;
      motion.speed = walking ? 1.25 : 0;
      replay.current += dt;
      if (motion.emote !== clip.name) {
        motion.emote = clip.name;
        replay.current = 0;
      } else if (clip.once && replay.current > clip.seconds + 1.2) {
        // Un frame sin gesto: así vuelve a empezar.
        motion.emote = null;
      }
    }
    avatar.update(dt, motion);
  });
  return avatar ? <primitive object={avatar.object} /> : null;
}
