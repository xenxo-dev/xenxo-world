import { useState } from "react";
import { t, type Key } from "../i18n";
import { REPORT_REASONS, report } from "../net/account";
import { Button, Notice, input } from "./ui";

/** Botón «Denunciar» con su formulario (Ley de Servicios Digitales, art. 16). */
export function ReportButton({ targetType, targetId }: { targetType: "project" | "avatar" | "user"; targetId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>("spam");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  if (state === "sent") return <span className="text-xs text-lime-200">{t("report.sent")}</span>;
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-cal/45 underline-offset-2 hover:text-cal/80 hover:underline">
        {t("projects.report")}
      </button>
    );
  }
  return (
    <div className="mt-3 w-full rounded-xl border border-cal/10 bg-noche-2/60 p-3">
      <p className="mb-2 text-sm font-medium text-cal">{t("report.title")}</p>
      <label className="text-xs text-cal/60" htmlFor={`r-${targetId}`}>{t("report.reason")}</label>
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
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        maxLength={1000}
        rows={2}
        placeholder={t("report.details")}
        className={`${input} mt-2`}
      />
      <div className="mt-2 flex gap-2">
        <Button
          variant="primary"
          disabled={state === "sending"}
          onClick={async () => {
            setState("sending");
            try {
              await report(targetType, targetId, reason, details);
              setState("sent");
            } catch {
              setState("error");
            }
          }}
        >
          {t("report.send")}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
      </div>
      {state === "error" && <Notice tone="error">{t("common.error", { msg: "report" })}</Notice>}
    </div>
  );
}
