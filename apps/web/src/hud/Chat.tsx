import { useEffect, useRef, useState } from "react";
import { BUDGETS } from "@xenxo/protocol";
import { placeName, t, type Key } from "../i18n";
import { useAccount } from "../net/account";
import { sendChat } from "../net/session";
import { chat, useChatVersion, world } from "../net/world-store";
import { ReportForm } from "../panel/ReportButton";

const box = "rounded-xl border border-cal/10 bg-noche/75 backdrop-blur";
const NOTICE_MS = 4000;

/**
 * Chat de la plaza. Los invitados lo leen; para escribir hace falta cuenta.
 * El texto de otras personas es DATO: se pinta como texto plano, sin enlaces clicables.
 */
export function Chat({ touch, onSignup }: { touch: boolean; onSignup: () => void }) {
  useChatVersion();
  const user = useAccount();
  const [open, setOpen] = useState(!touch);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [, setTick] = useState(0);
  const [reporting, setReporting] = useState<string | null>(null);

  // Enter abre el chat (escritorio). Esc lo suelta y devuelve el teclado al movimiento.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement === inputRef.current;
      if (e.key === "Enter" && !typing && user) {
        e.preventDefault();
        setOpen(true);
        // Si el chat ya está abierto, el foco es inmediato; si no, en cuanto se monte.
        inputRef.current?.focus();
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      if (e.key === "Escape" && typing) inputRef.current?.blur();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user]);

  // Desplaza al último mensaje.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.messages.length, open]);

  // Los avisos (límite, permiso) desaparecen solos.
  const notice = chat.lastNotice && Date.now() - chat.lastNotice.at < NOTICE_MS ? chat.lastNotice.code : null;
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setTick((n) => n + 1), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);

  const submit = () => {
    if (!text.trim()) return;
    sendChat(text);
    setText("");
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`pointer-events-auto absolute right-4 top-[max(4.25rem,calc(env(safe-area-inset-top)+3.25rem))] px-3 py-2 text-sm text-cal/85 ${box}`}
        aria-expanded={false}
      >
        {t("chat.open")}
        {chat.messages.length > 0 && <span className="ml-2 rounded-full bg-neon px-1.5 text-xs text-noche">{chat.messages.length}</span>}
      </button>
    );
  }

  const position = touch
    ? "left-3 right-3 top-[max(4.25rem,calc(env(safe-area-inset-top)+3.25rem))]"
    : "bottom-16 left-4 w-[22rem]";

  return (
    <section aria-label={t("chat.title", { place: placeName(world.chunkId) })} className={`pointer-events-auto absolute flex max-h-[45dvh] flex-col ${position} ${box}`}>
      <header className="flex items-center justify-between border-b border-cal/10 px-3 py-1.5">
        <h2 className="text-xs font-medium text-cal/70">{t("chat.title", { place: placeName(world.chunkId) })}</h2>
        <button onClick={() => setOpen(false)} className="text-xs text-cal/50 hover:text-cal" aria-label={t("chat.close")}>
          ✕
        </button>
      </header>
      <ul ref={listRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2 text-sm" aria-live="polite">
        {chat.messages.length === 0 && <li className="text-cal/45">{t("chat.empty")}</li>}
        {chat.messages.map((m) => {
          const mine = m.session_id === world.sessionId;
          return (
            <li key={m.id} className="group flex items-start gap-1.5">
              <p className="min-w-0 flex-1 break-words">
                <span className={m.sender.kind === "agent" ? "text-azulejo-claro" : mine ? "text-neon-suave" : "text-ocre"}>
                  {m.sender.kind === "agent" ? `${t("agents.agentPrefix")} · ` : ""}
                  {m.sender.display_name}
                </span>
                <span className="text-cal/90">: {m.text}</span>
              </p>
              {!mine && (
                <button
                  onClick={() => setReporting(m.id)}
                  title={t("chat.report")}
                  aria-label={t("chat.report")}
                  className={`shrink-0 text-xs text-cal/35 transition hover:text-cal/80 focus:opacity-100 ${touch ? "" : "opacity-0 group-hover:opacity-100"}`}
                >
                  ⚑
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {reporting && (
        <div className="px-2 pb-2">
          <ReportForm compact targetType="chat" targetId={reporting} chunkId={world.chunkId} onClose={() => setReporting(null)} />
        </div>
      )}
      {notice && <p className="px-3 pb-1 text-xs text-ocre">{t(`chat.notice.${notice}` as Key)}</p>}
      <div className="border-t border-cal/10 p-2">
        {user ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              ref={inputRef}
              value={text}
              maxLength={BUDGETS.maxChatChars}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("chat.placeholder")}
              aria-label={t("chat.placeholder")}
              enterKeyHint="send"
              className="min-w-0 flex-1 rounded-lg border border-cal/10 bg-cal/5 px-2.5 py-1.5 text-sm text-cal outline-none placeholder:text-cal/35 focus:border-neon"
            />
            <button type="submit" className="rounded-lg bg-neon px-3 text-sm font-medium text-noche hover:bg-neon-suave disabled:opacity-40" disabled={!text.trim()}>
              {t("chat.send")}
            </button>
          </form>
        ) : (
          <p className="flex items-center justify-between gap-2 text-xs text-cal/60">
            {t("chat.guest")}
            <button onClick={onSignup} className="rounded-lg border border-cal/15 px-2.5 py-1 text-cal/85 hover:bg-cal/5">
              {t("chat.signup")}
            </button>
          </p>
        )}
        {user && !touch && <p className="mt-1 text-[11px] text-cal/35">{t("chat.hint")}</p>}
      </div>
    </section>
  );
}
