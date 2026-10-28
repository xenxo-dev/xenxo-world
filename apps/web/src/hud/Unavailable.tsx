import { PLACES } from "@xenxo/protocol";
import { t } from "../i18n";
import { travel } from "../net/session";
import { useUnavailable } from "../net/world-store";

/**
 * El distrito vive en un nodo de la comunidad que ahora no responde (o no deja entrar). Se dice
 * claro y se sigue intentando solo: si el distrito vuelve a Cloudflare, el siguiente intento entra.
 */
export function Unavailable() {
  const down = useUnavailable();
  if (!down) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-4">
      <div className="pointer-events-auto max-w-sm rounded-2xl border border-cal/10 bg-noche-2/95 p-5 text-center shadow-xl backdrop-blur">
        <p className="display text-lg font-semibold text-cal">{t("unavailable.title")}</p>
        <p className="mt-2 text-sm leading-relaxed text-soft">{t("unavailable.body")}</p>
        <button className="btn-ghost mt-4" onClick={() => travel(PLACES.nexo)}>
          {t("unavailable.back")}
        </button>
      </div>
    </div>
  );
}
