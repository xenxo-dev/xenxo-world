import { useEffect, useState } from "react";
import { errorText, t } from "../i18n";
import { myCard, setCardPublic, type CardState } from "../net/account";
import { cardLink } from "../net/card";
import { Button, card, Notice } from "./ui";

/**
 * Tu carné (xenxo.io/p/<número>): privado por defecto. Al hacerlo público, cualquiera con el
 * enlace ve tu número, nombre, personaje, fecha de alta y proyectos publicados.
 */
export function CardSettings() {
  const [state, setState] = useState<CardState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    myCard()
      .then((s) => alive && setState(s))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = async (on: boolean) => {
    setBusy(true);
    setError("");
    try {
      setState(await setCardPublic(on));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!state) return error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-cal/50">{t("card.loading")}</p>;
  if (state.player_no === null) return null;
  const link = cardLink(state.player_no);

  return (
    <div className={`${card} p-4`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="display text-3xl font-bold text-neon-suave">#{state.player_no}</span>
        <span className={`rounded-md px-2 py-0.5 text-xs ${state.public ? "bg-huerta/20 text-lime-100" : "bg-cal/10 text-cal/60"}`}>
          {state.public ? t("card.isPublic") : t("card.isPrivate")}
        </span>
      </div>
      <p className="mt-3 text-sm text-cal/70">{state.public ? t("card.publicOn") : t("card.publicOff")}</p>
      {state.public && (
        <p className="mt-3 break-all rounded-lg border border-cal/10 bg-noche/70 px-3 py-2 font-mono text-xs text-cal/85">{link}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {state.public ? (
          <>
            <a href={link} target="_blank" rel="noopener" className="rounded-xl bg-neon px-4 py-2 text-sm font-medium text-noche hover:bg-neon-suave">
              {t("card.view")}
            </a>
            <Button
              variant="secondary"
              onClick={() =>
                void navigator.clipboard?.writeText(link).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? t("card.copied") : t("card.copyLink")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void toggle(false)}>
              {t("card.makePrivate")}
            </Button>
          </>
        ) : (
          <Button variant="primary" disabled={busy} onClick={() => void toggle(true)}>
            {t("card.makePublic")}
          </Button>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
