/**
 * «Qué hacer aquí»: al llegar por primera vez a un distrito, una tarjeta con lo que hay (sus
 * actividades, de world/guide.ts) y un botón «Ir» que te deja en cada sitio: las ciudades están a
 * más de 60 m de la entrada y nada decía qué había. Se vuelve a abrir con el botón «Qué hacer aquí»,
 * bajo la fila de arriba. En el nexo, la primera vez, una nota: cada puerta lleva a un distrito. Y en táctil, las
 * primeras veces, cómo se mueve uno. Todo se recuerda en este navegador; nada va al servidor.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { loadPref, savePref } from "../config";
import { hasKey, placeName, t, useLang } from "../i18n";
import { teleport } from "../net/session";
import { usePlace, useWorldVersion, world } from "../net/world-store";
import { placeLink } from "../routes";
import { districtIdOfChunk, guideOf, type GuideSpot } from "../world/guide";
import { useDrive } from "../world/vehicle/drive-state";
import { GuideIcon, ShareIcon } from "./icons";

const box = "rounded-2xl border border-cal/10 bg-noche/85 shadow-[0_18px_50px_-18px_rgb(0_0_0/0.8)] backdrop-blur";
/** Debajo de la fila de arriba, a la derecha (en móvil ocupa casi todo el ancho). */
const place = "pointer-events-auto absolute right-4 top-[calc(max(1rem,env(safe-area-inset-top))+3.6rem)] w-[min(21rem,calc(100vw-2rem))]";

let open = false;
const listeners = new Set<() => void>();
function setOpen(v: boolean) {
  if (open === v) return;
  open = v;
  for (const fn of listeners) fn();
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** El distrito para el que ya se decidió si abrirla sola. */
let decided: string | null = null;

function useGuideOpen() {
  return useSyncExternalStore(subscribe, () => open);
}

/** El botón que la vuelve a abrir: bajo la fila de arriba, a la izquierda (donde hay guía y está cerrada). */
export function GuideButton() {
  useLang();
  const chunk = usePlace();
  const isOpen = useGuideOpen();
  if (isOpen || !guideOf(districtIdOfChunk(chunk)).length) return null;
  return (
    <button
      onClick={() => setOpen(true)}
      className="pointer-events-auto absolute left-4 top-[calc(max(1rem,env(safe-area-inset-top))+3.25rem)] flex items-center gap-1.5 rounded-xl border border-cal/10 bg-noche/70 px-3 py-1.5 text-sm text-cal/80 backdrop-blur hover:text-cal"
    >
      <GuideIcon className="h-4 w-4 text-neon" />
      {t("guide.open")}
    </button>
  );
}

function seen(id: string): boolean {
  return loadPref<string[]>("guide.seen", []).includes(id);
}
function markSeen(id: string) {
  const list = loadPref<string[]>("guide.seen", []);
  if (!list.includes(id)) savePref("guide.seen", [...list, id].slice(-40));
}

/** Los niveles van de fácil a tryhard de dos en dos (verde, ocre, rosa). */
const LEVEL_TONE = ["border-huerta/50 text-lime-100", "border-ocre/50 text-amber-100", "border-rosa/50 text-rosa"];

const text = (key: string) => (hasKey(key) ? t(key) : "");

export function GuideCard() {
  const lang = useLang();
  const chunk = usePlace();
  useWorldVersion();
  const isOpen = useGuideOpen();
  const district = districtIdOfChunk(chunk);
  const entries = guideOf(district);
  const [note, setNote] = useState("");

  // La primera vez en cada distrito se abre sola; al cambiar de lugar, se cierra. Se decide una vez
  // por llegada (`decided`): el efecto puede repetirse sin que el lugar haya cambiado.
  useEffect(() => {
    if (!district || !entries.length) {
      decided = null;
      return setOpen(false);
    }
    if (decided === district) return;
    decided = district;
    if (seen(district)) return setOpen(false);
    markSeen(district);
    setOpen(true);
  }, [district, entries.length]);

  // Al ir a por el coche se quita de en medio: en pantallas pequeñas tapa la cuenta atrás de la parrilla.
  const d = useDrive();
  const toCar = d.phase !== "none" && d.phase !== "parked";
  useEffect(() => {
    if (toCar) setOpen(false);
  }, [toCar]);

  if (!district || !entries.length || !isOpen) return null;
  const go = (s: GuideSpot) => {
    teleport(s.p, s.yaw);
    setOpen(false);
  };
  const share = async () => {
    const url = placeLink(district, null, lang);
    try {
      if (navigator.share) return void (await navigator.share({ title: `xenxo · ${placeName(chunk)}`, url }));
      await navigator.clipboard.writeText(url);
      setNote(t("share.copied"));
      setTimeout(() => setNote(""), 2200);
    } catch {
      /* se canceló o no hay portapapeles: no pasa nada */
    }
  };
  const tip = text(`guide.${district}.tip`);

  return (
    <section aria-label={t("guide.open")} className={`${place} ${box} flex max-h-[min(70dvh,34rem)] flex-col`}>
      <header className="flex items-center justify-between gap-3 border-b border-cal/10 px-4 py-3">
        <h2 className="display text-[15px] font-semibold text-cal">{t("guide.title", { place: placeName(chunk) })}</h2>
        <button onClick={() => setOpen(false)} aria-label={t("guide.close")} className="grid h-7 w-7 place-items-center rounded-lg text-cal/60 hover:bg-cal/10 hover:text-cal">
          ✕
        </button>
      </header>
      <ul className="min-h-0 flex-1 divide-y divide-cal/[0.07] overflow-y-auto px-4">
        {entries.map((e) => (
          <li key={e.id} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-cal">{text(`guide.${district}.${e.id}`)}</p>
              <p className="mt-0.5 text-xs leading-snug text-soft">{text(`guide.${district}.${e.id}.text`)}</p>
              {e.levels.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {e.levels.map((l, i) => (
                    <button
                      key={l.id}
                      onClick={() => go(l)}
                      title={t("guide.level", { n: i + 1 })}
                      aria-label={t("guide.level", { n: i + 1 })}
                      className={`meta grid h-8 w-8 place-items-center rounded-lg border text-sm transition hover:bg-cal/10 ${LEVEL_TONE[Math.min(LEVEL_TONE.length - 1, Math.floor(i / 2))]}`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {e.spot && (
              <button onClick={() => go(e.spot!)} className="btn-ghost shrink-0 rounded-lg px-3 py-1.5 text-sm">
                {t("guide.go")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <footer className="border-t border-cal/10 px-4 py-3">
        {tip && <p className="text-xs leading-snug text-soft">{tip}</p>}
        <p className="mt-1 text-xs leading-snug text-muted">{t("guide.parcels")}</p>
        <button onClick={() => void share()} className="mt-2.5 flex items-center gap-1.5 text-xs text-azulejo-claro hover:text-cal">
          <ShareIcon />
          {note || t("share.place")}
        </button>
      </footer>
    </section>
  );
}

/** En el nexo, la primera vez: qué son las puertas. */
export function NexoTip() {
  useLang();
  useWorldVersion();
  const [gone, setGone] = useState(() => seen("nexo"));
  if (gone || !world.solo || world.status !== "open") return null;
  return (
    <section role="status" className={`${place} ${box} px-4 py-3`}>
      <h2 className="display text-[15px] font-semibold text-cal">{t("guide.nexo.title")}</h2>
      <p className="mt-1 text-sm leading-snug text-soft">{t("guide.nexo.text")}</p>
      <button
        onClick={() => {
          markSeen("nexo");
          setGone(true);
        }}
        className="btn-ghost mt-3 rounded-lg px-3 py-1.5 text-sm"
      >
        {t("guide.nexo.ok")}
      </button>
    </section>
  );
}

/** En táctil, las dos primeras veces: cómo se mueve uno (se va sola a los 12 s). */
export function TouchHint() {
  useLang();
  const [show, setShow] = useState(() => loadPref<number>("touchHint", 0) < 2);
  useEffect(() => {
    if (!show) return;
    savePref("touchHint", loadPref<number>("touchHint", 0) + 1);
    const id = window.setTimeout(() => setShow(false), 12_000);
    return () => window.clearTimeout(id);
  }, [show]);
  if (!show) return null;
  return (
    <p role="status" className="pointer-events-none absolute bottom-[calc(max(1.5rem,env(safe-area-inset-bottom))+11rem)] left-1/2 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-cal/10 bg-noche/75 px-3 py-2 text-center text-xs text-cal/80 backdrop-blur">
      {t("hud.touchHint")}
    </p>
  );
}
