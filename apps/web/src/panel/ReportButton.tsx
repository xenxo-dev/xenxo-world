import { useState } from "react";
import { errorText, t, type Key } from "../i18n";
import { REPORT_REASONS, report } from "../net/account";
import { Button, Notice, input } from "./ui";

type Target = "project" | "avatar" | "user" | "chat";

/** Formulario de denuncia (Ley de Servicios Digitales, art. 16). */
export function ReportForm({
  targetType,
  targetId,
  onClose,
  compact,
}: {
  targetType: Target;
  targetId: string;
  onClose: () => void;
  compact?: boolean;
}) {
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>(targetType === "chat" ? "harassment" : "spam");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  if (state === "sent") {
    return (
      <p className="flex items-center justify-between gap-2 text-xs text-lime-200">
        {t("report.sent")}
        <button className="text-cal/50 hover:text-cal" onClick={onClose} aria-label={t("common.cancel")}>
          ✕
        </button>
      </p>
    );
  }

  return (
    <div className={`w-full rounded-xl border border-cal/10 bg-noche-2/80 ${compact ? "p-2" : "mt-3 p-3"}`}>
      <p className="mb-2 text-sm font-medium text-cal">{t("report.title")}</p>
      <label className="text-xs text-cal/60" htmlFor={`r-${targetId}`}>
        {t("report.reason")}
      </label>
      <select
        id={`r-${targetId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value as (typeof REPORT_REASONS)[number])}
        className={`${input} mt-1`}
      >
        {REPORT_REASONS.map((r) => (
          <option key={r} value={r} className="bg-noche">
            {t(`report.reason.${r}` as Key)}
          </option>
        ))}
      </select>
      {!compact && (
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder={t("report.details")}
          className={`${input} mt-2`}
        />
      )}
      <div className="mt-2 flex gap-2">
        <Button
          variant="primary"
          disabled={state === "sending"}
          onClick={async () => {
            setState("sending");
            try {
              await report(targetType, targetId, reason, details);
              setState("sent");
            } catch (e) {
              setError(errorText(e));
              setState("error");
            }
          }}
        >
          {t("report.send")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
      {state === "error" && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

/** Botón «Denunciar» que abre el formulario en el sitio. */
export function ReportButton({ targetType, targetId, label }: { targetType: Target; targetId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  if (open) return <ReportForm targetType={targetType} targetId={targetId} onClose={() => setOpen(false)} />;
  return (
    <button onClick={() => setOpen(true)} className="text-xs text-cal/45 underline-offset-2 hover:text-cal/80 hover:underline">
      {label ?? t("projects.report")}
    </button>
  );
}
