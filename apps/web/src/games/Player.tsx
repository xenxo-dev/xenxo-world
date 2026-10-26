/**
 * El juego abierto dentro de xenxo: un iframe aislado (sandbox) en su propio dominio, sin acceso a
 * la sesión ni al almacenamiento de xenxo. Solo se habla con él por postMessage, y solo con su
 * origen exacto:
 *
 *   juego → xenxo   xenxo:hello · xenxo:login { params } · xenxo:back
 *   xenxo → juego   xenxo:welcome { lang } · xenxo:authorization { params }
 *
 * «Entrar con xenxo» dentro: xenxo enseña el permiso encima del juego y le entrega el código por
 * postMessage al origen registrado (response_mode=web_message); el juego lo cambia por sus tokens.
 */
import { useEffect, useRef, useState } from "react";
import { getLang, t, useLang } from "../i18n";
import { oidcEmbedded } from "../net/account";
import { Consent } from "../panel/Consent";
import { ReportButton } from "../panel/ReportButton";
import { closeGame, gameName, gameSrc, type OpenGame } from "./state";

/** Qué deja hacer el iframe: nada de navegar xenxo, ni ventanas sin aislar de xenxo. */
const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals";
const ALLOW = "fullscreen; gamepad; autoplay; clipboard-write; accelerometer; gyroscope";

const LOGIN_KEYS = ["response_type", "client_id", "redirect_uri", "scope", "state", "nonce", "code_challenge", "code_challenge_method", "prompt"];

export function Player({ open }: { open: OpenGame }) {
  const lang = useLang();
  const p = open.project;
  const src = gameSrc(p, lang);
  const origin = new URL(src).origin;
  const frame = useRef<HTMLIFrameElement>(null);
  const [consent, setConsent] = useState<{ request: string; state: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const answered = useRef(false);

  const post = (msg: unknown) => frame.current?.contentWindow?.postMessage(msg, origin);
  const fail = (state: string, error: string, description: string) =>
    post({ type: "xenxo:authorization", params: { error, error_description: description, state } });

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Solo el juego que está abierto, y desde su propio origen.
      if (!frame.current || e.source !== frame.current.contentWindow || e.origin !== origin) return;
      const d = e.data as { type?: string; params?: Record<string, unknown> } | null;
      if (!d || typeof d.type !== "string") return;
      if (d.type === "xenxo:hello") {
        // Lo mínimo: el idioma. Nada de la persona sin que lo permita con «Entrar con xenxo».
        post({ type: "xenxo:welcome", v: 0, lang: getLang() });
      } else if (d.type === "xenxo:back") {
        closeGame();
      } else if (d.type === "xenxo:login" && d.params && typeof d.params === "object") {
        const params: Record<string, string> = {};
        for (const k of LOGIN_KEYS) if (typeof d.params[k] === "string") params[k] = (d.params[k] as string).slice(0, 600);
        const state = params.state ?? "";
        // La vuelta tiene que ser este mismo juego: el código solo se entrega a su origen.
        let back = "";
        try {
          back = new URL(params.redirect_uri ?? "").origin;
        } catch {
          /* no válida */
        }
        if (back !== origin) return fail(state, "invalid_request", "redirect_uri tiene que ser de este mismo juego");
        // Y el juego de «Entrar con xenxo» tiene que ser el que declara su ficha (xenxo.clientId).
        if (!p.game?.clientId || params.client_id !== p.game.clientId) return fail(state, "invalid_client", "este juego no es el de la ficha del proyecto");
        oidcEmbedded({ ...params, project_id: p.id })
          .then((request) => {
            answered.current = false;
            setConsent({ request, state });
          })
          .catch((err: { message?: string }) => fail(state, "invalid_request", err.message ?? "error"));
      }
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin]);

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col bg-noche">
      <div className="flex items-center gap-2 border-b border-cal/10 bg-noche-2/95 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sm">
        <button onClick={closeGame} className="rounded-lg px-2 py-1 text-cal/85 hover:bg-cal/5 hover:text-cal">
          {t("player.back")}
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-cal/80">
          {gameName(p, lang)} <span className="text-cal/40">· {p.game?.host}</span>
        </span>
        <a href={src} target="_blank" rel="noopener noreferrer nofollow ugc" className="hidden rounded-lg px-2 py-1 text-cal/60 hover:text-cal sm:inline">
          {t("player.openSite")}
        </a>
        <ReportButton targetType="project" targetId={p.id} />
      </div>
      <div className="relative flex-1">
        {!loaded && <p className="absolute inset-0 flex items-center justify-center text-sm text-cal/50">{t("player.loading", { name: gameName(p, lang) })}</p>}
        <iframe
          ref={frame}
          src={src}
          title={gameName(p, lang)}
          sandbox={SANDBOX}
          allow={ALLOW}
          referrerPolicy="strict-origin"
          onLoad={() => setLoaded(true)}
          className="absolute inset-0 h-full w-full border-0 bg-black"
        />
      </div>
      {consent && (
        <Consent
          request={consent.request}
          error={null}
          onWebMessage={(r) => {
            // Doble comprobación: el servidor dice a qué origen va, y tiene que ser este juego.
            if (r.origin !== origin) return;
            answered.current = true;
            post({ type: "xenxo:authorization", params: r.params });
          }}
          onClose={() => {
            // Cerrar sin decidir también contesta al juego (si no, se quedaría esperando).
            if (!answered.current) fail(consent.state, "access_denied", "la persona cerró la pantalla de permiso");
            setConsent(null);
          }}
        />
      )}
    </div>
  );
}
