/**
 * Códigos de recuperación (net/account.ts; servidor: recovery.ts). Sin email ni contraseña, son lo
 * que deja entrar si se pierde la passkey: ocho, de un solo uso, que se enseñan una vez.
 *
 * - `RecoveryNotice`: arriba de la cuenta, los códigos recién hechos (copiar, descargar, «ya los he
 *   guardado») o, si se acaba de entrar con uno, qué hacer ahora (añadir una passkey, hacer otros).
 * - `RecoveryRow`: en «Formas de entrar», cuántos quedan y hacer otros.
 * - `RecoverForm`: en «Ya tengo cuenta», entrar con uno.
 */
import { useState } from "react";
import { errorText, t } from "../i18n";
import { addPasskey, login, passkeysSupported, recoverWith, regenerateRecovery, useRecoveryNote, type Logins } from "../net/account";
import { Button, card, input, Label, Notice } from "./ui";

/** Los códigos como texto (para copiar o descargar). */
const asText = (codes: string[]) => `${t("recovery.fileTitle")}\n\n${codes.join("\n")}\n\n${t("recovery.fileNote")}\n`;

export function RecoveryNotice({ onDone }: { onDone?: () => void }) {
  const [note, close] = useRecoveryNote();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  if (!note) return null;

  if (note.codes) {
    const codes = note.codes;
    const download = () => {
      const url = URL.createObjectURL(new Blob([asText(codes)], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "xenxo-codigos-recuperacion.txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(asText(codes));
        setCopied(true);
      } catch {
        setCopied(false);
      }
    };
    return (
      <section aria-label={t("recovery.title")} className={`${card} mb-4 border-neon/30 p-4`}>
        <h3 className="display text-base font-semibold text-cal">{t("recovery.title")}</h3>
        <p className="mt-1 max-w-prose text-sm text-cal/75">{t("recovery.intro")}</p>
        <ol className="mt-3 grid max-w-md grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-[15px] tracking-wide text-cal">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-soft">{t("recovery.once")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={download}>{t("recovery.download")}</Button>
          <Button variant="ghost" onClick={() => void copy()}>
            {copied ? t("recovery.copied") : t("recovery.copy")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              close();
              onDone?.();
            }}
          >
            {t("recovery.saved")}
          </Button>
        </div>
      </section>
    );
  }

  const left = note.recovered?.left ?? 0;
  const run = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
      onDone?.();
    } catch (e) {
      if ((e as Error).name !== "NotAllowedError") setError(errorText(e));
    }
  };
  return (
    <section aria-label={t("recovery.inTitle")} className={`${card} mb-4 border-neon/30 p-4`}>
      <h3 className="display text-base font-semibold text-cal">{t("recovery.inTitle")}</h3>
      <p className="mt-1 max-w-prose text-sm text-cal/75">{t("recovery.inText", { n: left })}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {passkeysSupported() && (
          <Button variant="primary" onClick={() => void run(addPasskey)}>
            {t("recovery.addHere")}
          </Button>
        )}
        <Button onClick={() => void run(regenerateRecovery)}>{t("recovery.newSet")}</Button>
        <Button variant="ghost" onClick={close}>
          {t("recovery.later")}
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}

/** En «Formas de entrar»: cuántos quedan y hacer otros (si hace rato que se entró, primero volver a entrar). */
export function RecoveryRow({ info, onNote, reload }: { info: Logins; onNote: (n: { tone: "ok" | "error"; text: string } | null) => void; reload: () => void }) {
  const [reauth, setReauth] = useState(false);
  const r = info.recovery;
  const make = async () => {
    onNote(null);
    try {
      await regenerateRecovery();
      setReauth(false);
      reload();
    } catch (e) {
      if ((e as { code?: string }).code === "reauth_needed") setReauth(true);
      else onNote({ tone: "error", text: errorText(e) });
    }
  };
  const again = async () => {
    onNote(null);
    try {
      await login();
      await make();
    } catch (e) {
      if ((e as Error).name !== "NotAllowedError") onNote({ tone: "error", text: errorText(e) });
    }
  };
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-cal/70">{r ? t("recovery.left", { n: r.left, total: r.total }) : t("recovery.none")}</span>
        <Button variant="ghost" onClick={() => void make()}>
          {r ? t("recovery.newSet") : t("recovery.make")}
        </Button>
      </div>
      {r && r.left <= 2 && <p className="text-xs text-soft">{t("recovery.low")}</p>}
      {reauth && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-cal/70">
          {t("recovery.reauth")}
          {passkeysSupported() && (
            <Button variant="ghost" onClick={() => void again()}>
              {t("account.login")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** «¿Perdiste tu passkey?»: entrar con un código. */
export function RecoverForm() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="mt-3 text-xs text-neon hover:underline">
        {t("recovery.lost")}
      </button>
    );
  return (
    <form
      className="mt-3 max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        recoverWith(code)
          .catch((err) => setError(errorText(err)))
          .finally(() => setBusy(false));
      }}
    >
      <Label htmlFor="acc-recover">{t("recovery.codeLabel")}</Label>
      <input
        id="acc-recover"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="XXXX-XXXX-XXXX"
        maxLength={20}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className={`${input} font-mono`}
      />
      <Button type="submit" disabled={busy || code.replace(/[\s-]/g, "").length < 12} className="mt-2">
        {t("recovery.enter")}
      </Button>
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  );
}
