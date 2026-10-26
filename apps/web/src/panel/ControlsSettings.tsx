/**
 * Personalizar → Controles: joystick y botón de saltar (lado, tamaño, opacidad), qué botones se
 * ven, sensibilidad al mirar, pantalla completa e instalar la app. Todo se guarda en este navegador.
 */
import type { ReactNode } from "react";
import { CONTROL_DEFAULTS, CONTROL_PX, resetControls, setControls, useControls, type ControlSize, type Hand } from "../controls";
import { enterFullscreen, exitFullscreen, fullscreenSupported, useFullscreen, useInstall } from "../fullscreen";
import { t } from "../i18n";
import { Button, Segmented, card } from "./ui";

function Toggle({ id, checked, onChange, children, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 py-1.5">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-neon)]" />
      <span className="text-sm text-cal/80">
        {children}
        {hint && <span className="block text-xs text-cal/45">{hint}</span>}
      </span>
    </label>
  );
}

function Slider({ id, label, value, min, max, step, onChange, format }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <div className="mt-4">
      <label htmlFor={id} className="flex items-center justify-between text-sm text-cal/70">
        <span>{label}</span>
        <span className="tabular-nums text-cal/50">{format(value)}</span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1.5 w-full accent-[var(--color-neon)]" />
    </div>
  );
}

/** Un móvil en horizontal con los controles tal como quedarán (a escala). */
function Preview() {
  const c = useControls();
  const px = CONTROL_PX[c.size];
  const k = 0.42;
  const left = c.hand === "left";
  const stick = px.stick * k;
  const jump = px.jump * k;
  const side = (l: boolean) => (l ? { left: 10 } : { right: 10 });
  return (
    <div aria-hidden className="relative mx-auto aspect-[19.5/9] w-full max-w-[22rem] overflow-hidden rounded-[1.4rem] border-4 border-cal/15 bg-gradient-to-b from-[#1b2350] via-[#141a3a] to-[#0b0d1f]">
      <div className="absolute inset-x-0 bottom-[30%] h-px bg-neon/30" />
      <div className="absolute right-2 top-2 flex gap-0.5 rounded bg-noche/60 p-0.5">
        <span className="h-3 w-3 rounded-sm bg-cal/30" />
        <span className="h-3 w-3 rounded-sm bg-cal/30" />
      </div>
      <div className="absolute left-1/2 top-[38%] h-10 w-4 -translate-x-1/2 rounded-full bg-cal/35" />
      <div className="absolute rounded-full border border-cal/30 bg-noche/40" style={{ width: stick, height: stick, bottom: 10, opacity: c.opacity, ...side(left) }}>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neon/40" style={{ width: stick * 0.44, height: stick * 0.44 }} />
      </div>
      {c.jumpButton && (
        <div className="absolute grid place-items-center rounded-full border border-neon-suave/50 bg-neon/25 text-[10px] text-cal" style={{ width: jump, height: jump, bottom: 10, opacity: c.opacity, ...side(!left) }}>
          ⤒
        </div>
      )}
      <div className="absolute flex gap-1" style={{ bottom: 10 + stick + 6, opacity: c.opacity, ...side(!left) }}>
        {c.showCamera && <span className="h-4 w-4 rounded bg-cal/25" />}
        {c.showEmotes && [0, 1, 2, 3].map((i) => <span key={i} className="h-4 w-4 rounded bg-cal/25" />)}
      </div>
    </div>
  );
}

export function ControlsSettings() {
  const c = useControls();
  return (
    <>
      <p className="text-sm text-cal/60">{t("controls.intro")}</p>
      <div className={`${card} mt-4 p-4`}>
        <Preview />
        <p className="mt-2 text-center text-xs text-cal/40">{t("controls.preview")}</p>
      </div>

      <p className="mb-1 mt-6 text-sm text-cal/70">{t("controls.hand")}</p>
      <Segmented<Hand>
        value={c.hand}
        onChange={(hand) => setControls({ hand })}
        options={[
          { id: "left", label: t("controls.hand.left") },
          { id: "right", label: t("controls.hand.right") },
        ]}
      />
      <p className="mb-1 mt-4 text-sm text-cal/70">{t("controls.size")}</p>
      <Segmented<ControlSize>
        value={c.size}
        onChange={(size) => setControls({ size })}
        options={[
          { id: "s", label: t("controls.size.s") },
          { id: "m", label: t("controls.size.m") },
          { id: "l", label: t("controls.size.l") },
        ]}
      />
      <Slider id="ctl-opacity" label={t("controls.opacity")} value={c.opacity} min={0.3} max={1} step={0.05} onChange={(opacity) => setControls({ opacity })} format={(v) => `${Math.round(v * 100)} %`} />

      <div className="mt-4">
        <Toggle id="ctl-jump" checked={c.jumpButton} onChange={(jumpButton) => setControls({ jumpButton })} hint={t("controls.jumpButtonHint")}>
          {t("controls.jumpButton")}
        </Toggle>
        <Toggle id="ctl-run" checked={c.autoRun} onChange={(autoRun) => setControls({ autoRun })} hint={t("controls.autoRunHint")}>
          {t("controls.autoRun")}
        </Toggle>
        <Toggle id="ctl-emotes" checked={c.showEmotes} onChange={(showEmotes) => setControls({ showEmotes })}>
          {t("controls.showEmotes")}
        </Toggle>
        <Toggle id="ctl-camera" checked={c.showCamera} onChange={(showCamera) => setControls({ showCamera })}>
          {t("controls.showCamera")}
        </Toggle>
      </div>

      <p className="mt-6 text-sm font-medium text-cal/80">{t("controls.look")}</p>
      <Slider id="ctl-look" label={t("controls.lookSpeed")} value={c.lookSpeed} min={0.5} max={2} step={0.1} onChange={(lookSpeed) => setControls({ lookSpeed })} format={(v) => `×${v.toFixed(1)}`} />
      <div className="mt-2">
        <Toggle id="ctl-invert" checked={c.invertY} onChange={(invertY) => setControls({ invertY })}>
          {t("controls.invertY")}
        </Toggle>
      </div>

      <div className="mt-5">
        <Button variant="ghost" className="!px-0" onClick={resetControls} disabled={JSON.stringify(c) === JSON.stringify(CONTROL_DEFAULTS)}>
          {t("controls.reset")}
        </Button>
      </div>
    </>
  );
}

/** Pantalla completa e instalar xenxo como app. */
export function ScreenSettings() {
  const c = useControls();
  const full = useFullscreen();
  const canFull = fullscreenSupported();
  const { state, install } = useInstall();
  return (
    <>
      {canFull ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void (full ? exitFullscreen() : enterFullscreen())}>{t(full ? "tools.exitFullscreen" : "tools.fullscreen")}</Button>
            <span className="text-xs text-cal/45">{t("screen.fullscreenKey")}</span>
          </div>
          <div className="mt-2">
            <Toggle id="ctl-autofs" checked={c.autoFullscreen} onChange={(autoFullscreen) => setControls({ autoFullscreen })}>
              {t("screen.autoFullscreen")}
            </Toggle>
          </div>
        </>
      ) : (
        <p className="text-sm text-cal/60">{t("screen.noFullscreen")}</p>
      )}

      <p className="mt-6 text-sm font-medium text-cal/80">{t("screen.app")}</p>
      {state === "installed" && <p className="mt-1 text-sm text-cal/60">{t("screen.installed")}</p>}
      {state === "prompt" && (
        <>
          <p className="mt-1 text-sm text-cal/60">{t("screen.installIntro")}</p>
          <Button variant="primary" className="mt-3" onClick={() => void install()}>
            {t("screen.install")}
          </Button>
        </>
      )}
      {state === "ios" && <p className="mt-1 text-sm text-cal/60">{t("screen.installIOS")}</p>}
      {state === "unavailable" && <p className="mt-1 text-sm text-cal/60">{t("screen.installOther")}</p>}
    </>
  );
}
