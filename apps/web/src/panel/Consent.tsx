import { useEffect, useState } from "react";
import { errorText, t, type Key } from "../i18n";
import { oidcDecide, oidcRequest, useAccount, type OidcRequestInfo } from "../net/account";
import { SignedOut } from "./Account";
import { Button, card, Notice } from "./ui";

/** Qué es cada permiso, en palabras de la persona (con su dato real cuando se conoce). */
function scopeLine(scope: string, user: { display_name: string; player_no?: number | null } | null): string {
  if (scope === "profile") return t("consent.scope.profile", { name: user?.display_name ?? "…" });
  if (scope === "player") return t("consent.scope.player", { n: user?.player_no != null ? String(user.player_no) : "…" });
  return t(`consent.scope.${scope}` as Key);
}

/**
 * Si la persona sale a entrar con Google en mitad del permiso, la petición se recuerda (10 min,
 * solo en esta pestaña) para seguir al volver.
 */
const PENDING = "xenxo:autorizar";
export function pendingConsent(): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING);
    const p = raw ? (JSON.parse(raw) as { id: string; at: number }) : null;
    return p && Date.now() - p.at < 10 * 60_000 && /^ar_[A-Za-z0-9_-]{10,40}$/.test(p.id) ? p.id : null;
  } catch {
    return null;
  }
}
function rememberConsent(id: string | null) {
  try {
    if (id) sessionStorage.setItem(PENDING, JSON.stringify({ id, at: Date.now() }));
    else sessionStorage.removeItem(PENDING);
  } catch {
    /* sin almacenamiento: al volver de Google habría que pulsar otra vez en el juego */
  }
}

/** Quita ?autorizar=… de la dirección para que recargar no repita nada. */
function clearQuery() {
  rememberConsent(null);
  const u = new URL(location.href);
  u.searchParams.delete("autorizar");
  u.searchParams.delete("autorizar_error");
  history.replaceState(null, "", u.pathname + (u.search ? u.search : "") + u.hash);
}

/**
 * «Entrar con xenxo»: un juego pide la identidad de la persona. Se enseña qué juego es, de quién,
 * a qué dominio vuelve y qué pide; nada se comparte sin pulsar «Permitir» (salvo que ya lo
 * hubiera permitido antes, y entonces se vuelve al juego sin preguntar).
 */
export function Consent({ request, error, onClose }: { request: string | null; error: string | null; onClose: () => void }) {
  const user = useAccount();
  const [info, setInfo] = useState<OidcRequestInfo | null>(null);
  const [problem, setProblem] = useState<string>(error ? errorText({ code: error }) : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!request) return;
    rememberConsent(request);
    let alive = true;
    oidcRequest(request)
      .then((r) => alive && setInfo(r))
      .catch((e) => alive && setProblem(errorText(e)));
    return () => {
      alive = false;
    };
  }, [request, user?.id]);

  const decide = async (approve: boolean) => {
    if (!request) return;
    setBusy(true);
    try {
      const to = await oidcDecide(request, approve);
      clearQuery();
      location.assign(to);
    } catch (e) {
      setProblem(errorText(e));
      setBusy(false);
    }
  };

  // Ya lo permitió (y lo usó hace poco): se vuelve al juego sin preguntar. Nada más es automático:
  // ni los errores ni un «no» llevan a otra web sin que la persona pulse.
  useEffect(() => {
    if (!info || busy || !request || info.error) return;
    if (user && info.granted && info.prompt !== "consent") void decide(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, user?.id]);

  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-noche/80 p-4 backdrop-blur-md">
      <div className={`${card} max-h-[90dvh] w-full max-w-md overflow-y-auto bg-noche-2/95 p-6`} role="dialog" aria-modal="true" aria-labelledby="consent-title">
        <p className="display neon-sign mb-4 text-xl font-bold" translate="no">
          xenxo<span className="dot">.io</span>
        </p>
        {problem && (
          <>
            <Notice tone="error">{problem}</Notice>
            <Button
              className="mt-4"
              onClick={() => {
                clearQuery();
                onClose();
              }}
            >
              {t("consent.close")}
            </Button>
          </>
        )}
        {!problem && !info && <p className="text-sm text-cal/60">{t("repos.loading")}</p>}
        {!problem && info?.error && (
          <>
            <h2 id="consent-title" className="display text-lg font-semibold text-cal">
              {t("consent.errorTitle", { game: info.client.name })}
            </h2>
            <Notice tone="error">{errorText({ code: info.error })}</Notice>
            <p className="mt-3 text-sm text-cal/60">{t("consent.errorBack", { host: info.client.host })}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void decide(false)}>
                {t("consent.back", { host: info.client.host })}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  clearQuery();
                  onClose();
                }}
              >
                {t("consent.close")}
              </Button>
            </div>
          </>
        )}
        {!problem && info && !info.error && (
          <>
            <h2 id="consent-title" className="display text-lg font-semibold text-cal">
              {t("consent.title", { game: info.client.name })}
            </h2>
            <p className="mt-1 text-sm text-cal/60">{t("consent.by", { owner: info.client.owner })}</p>
            <p className="mt-3 rounded-lg border border-ocre/30 bg-ocre/10 px-3 py-2 text-sm text-amber-100">
              {t("consent.returnTo")} <strong className="font-mono">{info.client.host}</strong>
            </p>
            {!user ? (
              <div className="mt-4">
                <p className="mb-2 text-sm text-cal/75">{t("consent.login")}</p>
                <SignedOut />
              </div>
            ) : info.granted && info.prompt !== "consent" ? (
              <p className="mt-4 text-sm text-cal/70">{t("consent.returning", { game: info.client.name })}</p>
            ) : (
              <>
                <p className="mt-4 text-sm text-cal/80">{t("consent.wants")}</p>
                <ul className="mt-2 space-y-1.5 text-sm text-cal/85">
                  {info.scopes.map((s) => (
                    <li key={s} className="flex gap-2">
                      <span aria-hidden className="text-neon-suave">✓</span>
                      {scopeLine(s, user)}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-cal/45">{t("consent.note")}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => void decide(true)}>
                    {t("consent.allow")}
                  </Button>
                  <Button disabled={busy} onClick={() => void decide(false)}>
                    {t("consent.deny")}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
