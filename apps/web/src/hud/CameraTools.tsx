import { useEffect, useState, useSyncExternalStore } from "react";
import { useControls } from "../controls";
import { fullscreenSupported, toggleFullscreen, useFullscreen } from "../fullscreen";
import { t } from "../i18n";
import { input, onPhoto, subscribeView, view } from "../world/input";

const hudBox = "rounded-xl border border-cal/10 bg-noche/70 backdrop-blur";
const big =
  "grid h-11 w-11 place-items-center rounded-xl border border-cal/10 bg-noche/70 text-xl backdrop-blur transition hover:border-cal/30 hover:bg-noche/85 active:scale-95";
const small = "grid h-9 w-9 place-items-center rounded-lg text-cal/80 transition hover:bg-cal/10 hover:text-cal active:scale-95";

/**
 * Arriba a la derecha: VR (si hay gafas), foto (P) y pantalla completa (F). El destello y el aviso
 * de la foto también salen de aquí.
 */
export function TopTools({ onVR }: { onVR: (() => void) | null }) {
  const full = useFullscreen();
  const canFull = fullscreenSupported();
  const [notice, setNotice] = useState<{ ok: boolean; n: number } | null>(null);
  const [flash, setFlash] = useState(0);

  useEffect(
    () =>
      onPhoto((ok) => {
        if (ok) setFlash((n) => n + 1);
        setNotice((prev) => ({ ok, n: (prev?.n ?? 0) + 1 }));
      }),
    [],
  );
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(id);
  }, [notice]);

  return (
    <>
      {flash > 0 && <div key={flash} className="photo-flash pointer-events-none fixed inset-0 bg-white" aria-hidden />}
      {notice && (
        <p role="status" className="absolute left-1/2 top-16 -translate-x-1/2 rounded-xl border border-cal/10 bg-noche/80 px-3 py-1.5 text-sm text-cal/85 backdrop-blur">
          {t(notice.ok ? "tools.photoSaved" : "tools.photoFailed")}
        </p>
      )}
      <div
        role="toolbar"
        aria-label={t("tools.bar")}
        className={`pointer-events-auto absolute right-4 top-[max(1rem,env(safe-area-inset-top))] flex items-center gap-0.5 p-1 ${hudBox}`}
      >
        {onVR && (
          <button onClick={onVR} className="rounded-lg px-2.5 py-1.5 text-sm text-azulejo-claro hover:bg-cal/10">
            VR
          </button>
        )}
        <button title={`${t("tools.photo")} (P)`} aria-label={t("tools.photo")} onClick={() => (input.photo = true)} className={small}>
          <CameraIcon />
        </button>
        {canFull && (
          <button
            title={`${t(full ? "tools.exitFullscreen" : "tools.fullscreen")} (F)`}
            aria-label={t(full ? "tools.exitFullscreen" : "tools.fullscreen")}
            aria-pressed={full}
            onClick={() => void toggleFullscreen()}
            className={small}
          >
            <FullIcon exit={full} />
          </button>
        )}
      </div>
    </>
  );
}

/** Abajo, junto a los gestos: primera o tercera persona (V) y, en táctil sin botón grande, saltar. */
export function ViewTools({ touch }: { touch: boolean }) {
  const firstPerson = useSyncExternalStore(subscribeView, () => view.firstPerson);
  const c = useControls();
  const jump = touch && !c.jumpButton;
  if (!c.showCamera && !jump) return null;
  return (
    <div className="flex gap-1.5" style={touch ? { opacity: c.opacity } : undefined}>
      {jump && (
        <button title={t("tools.jump")} aria-label={t("tools.jump")} onPointerDown={() => (input.jump = true)} className={`${big} touch-none`}>
          <span aria-hidden>⤒</span>
        </button>
      )}
      {c.showCamera && (
        <button
          title={`${t(firstPerson ? "tools.thirdPerson" : "tools.firstPerson")} (V)`}
          aria-label={t(firstPerson ? "tools.thirdPerson" : "tools.firstPerson")}
          aria-pressed={firstPerson}
          onClick={() => (input.toggleView = true)}
          className={big}
        >
          <span aria-hidden>{firstPerson ? "🧍" : "👁️"}</span>
        </button>
      )}
    </div>
  );
}

const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Esquinas hacia fuera (entrar) o hacia dentro (salir): no depende de que haya un emoji. */
function FullIcon({ exit }: { exit: boolean }) {
  const d = exit ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5";
  return (
    <svg aria-hidden className="h-5 w-5" {...svg}>
      <path d={d} />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg aria-hidden className="h-5 w-5" {...svg}>
      <path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z" />
      <circle cx="12" cy="13.2" r="3.3" />
    </svg>
  );
}
