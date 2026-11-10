/**
 * Límite de errores de toda la aplicación: si algo revienta al dibujar, en vez de una página en
 * blanco se dice claro, se ofrece recargar y, si se repite, contarlo (errors.ts: una issue de GitHub
 * ya rellenada, que no se envía sola).
 */
import { Component, type ReactNode } from "react";
import { issueUrl, noteError } from "./errors";
import { t } from "./i18n";
import { splashDone } from "./splash";

export class Crash extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    noteError(e, "render");
    splashDone();
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="grid h-dvh w-full place-items-center bg-noche p-6 text-cal">
        <div className="max-w-sm rounded-2xl border border-cal/10 bg-noche-2/90 p-6 text-center">
          <p className="display neon-sign text-2xl font-bold" translate="no">
            xenxo<span className="dot">.io</span>
          </p>
          <h1 className="display mt-5 text-lg font-semibold">{t("crash.title")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-soft">{t("crash.text")}</p>
          <button onClick={() => location.reload()} className="neon-tube display mt-5 w-full rounded-full px-4 py-3 text-[15px] font-semibold">
            {t("crash.reload")}
          </button>
          <a href={issueUrl()} target="_blank" rel="noreferrer" className="mt-4 block text-sm text-azulejo-claro underline-offset-2 hover:underline">
            {t("report.problem")} ↗
          </a>
          <p className="mt-2 text-xs leading-snug text-muted">{t("report.note")}</p>
        </div>
      </div>
    );
  }
}
