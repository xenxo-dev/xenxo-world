/**
 * Aviso para quien llega desde el navegador integrado de una app (Instagram, TikTok…): crear cuenta
 * ahí suele fallar, así que se ofrece abrir xenxo en el navegador del sistema o copiar el enlace.
 */
import { useState } from "react";
import { t, useLang } from "../i18n";
import { inAppBrowser, openInBrowserUrl } from "../net/inapp";

export function InAppNotice() {
  useLang();
  const [copied, setCopied] = useState(false);
  const app = inAppBrowser();
  if (app === null) return null;
  const open = openInBrowserUrl();
  const link = `${location.origin}/`;
  return (
    <div role="status" className="mb-4 rounded-xl border border-ocre/40 bg-ocre/10 px-4 py-3 text-sm text-amber-100">
      <p className="font-medium text-cal">{t("inapp.title")}</p>
      <p className="mt-1 leading-relaxed">{t("inapp.text", { app: app || t("inapp.app") })}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {open && (
          <a href={open} className="rounded-xl bg-neon px-4 py-2 text-sm font-medium text-noche hover:bg-neon-suave">
            {t("inapp.open")}
          </a>
        )}
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="btn-ghost rounded-xl px-4 py-2 text-sm"
        >
          {copied ? t("inapp.copied") : t("inapp.copy")}
        </button>
      </div>
      <p className="mt-2 text-xs text-amber-100/80">{t("inapp.how")}</p>
    </div>
  );
}
