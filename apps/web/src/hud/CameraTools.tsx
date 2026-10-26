import { useEffect, useState, useSyncExternalStore } from "react";
import { t } from "../i18n";
import { input, onPhoto, subscribeView, view } from "../world/input";

const btn =
  "grid h-11 w-11 place-items-center rounded-xl border border-cal/10 bg-noche/70 text-xl backdrop-blur transition hover:border-cal/30 hover:bg-noche/85 active:scale-95";

/** Foto (P), primera o tercera persona (V) y, en táctil, saltar. */
export function CameraTools({ className = "", touch }: { className?: string; touch: boolean }) {
  const firstPerson = useSyncExternalStore(subscribeView, () => view.firstPerson);
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
      <div role="toolbar" aria-label={t("tools.bar")} className={`flex gap-1.5 ${className}`}>
        {touch && (
          <button title={t("tools.jump")} aria-label={t("tools.jump")} onClick={() => (input.jump = true)} className={btn}>
            <span aria-hidden>⤒</span>
          </button>
        )}
        <button
          title={`${t(firstPerson ? "tools.thirdPerson" : "tools.firstPerson")} (V)`}
          aria-label={t(firstPerson ? "tools.thirdPerson" : "tools.firstPerson")}
          aria-pressed={firstPerson}
          onClick={() => (input.toggleView = true)}
          className={btn}
        >
          <span aria-hidden>{firstPerson ? "🧍" : "👁️"}</span>
        </button>
        <button title={`${t("tools.photo")} (P)`} aria-label={t("tools.photo")} onClick={() => (input.photo = true)} className={btn}>
          <span aria-hidden>📷</span>
        </button>
      </div>
    </>
  );
}
