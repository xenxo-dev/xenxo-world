/**
 * El mundo no contesta (net/outage.ts): el plan gratuito ha cortado por hoy, o no hay red. Se dice
 * qué pasa y cuándo vuelve, y se sigue intentando solo. En el mundo, una tarjeta en el centro; en el
 * panel, una banda arriba.
 */
import { SOURCE_URL } from "../content";
import { t, useLang } from "../i18n";
import { checkOutage, resetTime, useOutage, type Outage } from "../net/outage";
import { retryNow } from "../net/session";

function texts(o: Outage, lang: string): { title: string; text: string } {
  const time = resetTime(lang);
  if (o === "full") return { title: t("capacity.full.title"), text: t("capacity.full.text", { time }) };
  if (o === "maybe") return { title: t("capacity.maybe.title"), text: t("capacity.maybe.text", { time }) };
  return { title: t("capacity.offline.title"), text: t("capacity.offline.text") };
}

function retry() {
  retryNow();
  void checkOutage();
}

function Links({ lang }: { lang: string }) {
  const link = "text-azulejo-claro underline-offset-2 hover:underline";
  return (
    <p className="mt-3 text-xs text-muted">
      {t("capacity.meanwhile")}:{" "}
      <a className={link} href={lang === "en" ? "/docs/en/" : "/docs/"} target="_blank" rel="noreferrer">
        {t("create.docs")}
      </a>{" "}
      ·{" "}
      <a className={link} href={SOURCE_URL} target="_blank" rel="noreferrer">
        {t("create.source")}
      </a>
    </p>
  );
}

/** Dentro del mundo: en el centro, como el aviso de un distrito que no responde. */
export function Capacity() {
  const lang = useLang();
  const o = useOutage();
  if (!o) return null;
  const x = texts(o, lang);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-4">
      <div className="pointer-events-auto max-w-sm rounded-2xl border border-cal/10 bg-noche-2/95 p-5 text-center shadow-xl backdrop-blur">
        <p className="display text-lg font-semibold text-cal">{x.title}</p>
        <p className="mt-2 text-sm leading-relaxed text-soft">{x.text}</p>
        <button className="btn-ghost mt-4 rounded-xl px-4 py-2 text-sm" onClick={retry}>
          {t("capacity.retry")}
        </button>
        {o !== "offline" && <Links lang={lang} />}
      </div>
    </div>
  );
}

/** En el panel: una banda arriba del contenido. */
export function CapacityBanner() {
  const lang = useLang();
  const o = useOutage();
  if (!o) return null;
  const x = texts(o, lang);
  return (
    <div role="status" aria-live="polite" className="mb-6 rounded-2xl border border-ocre/40 bg-ocre/10 px-4 py-3">
      <p className="display text-[15px] font-semibold text-cal">{x.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-amber-100">{x.text}</p>
      <button className="btn-ghost mt-3 rounded-xl px-4 py-2 text-sm" onClick={retry}>
        {t("capacity.retry")}
      </button>
      {o !== "offline" && <Links lang={lang} />}
    </div>
  );
}
