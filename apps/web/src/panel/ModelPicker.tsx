import { useState } from "react";
import type { AssetKind, BudgetProblem } from "@xenxo/assets";
import { errorText, t, type Key } from "../i18n";
import { prepareModel, type PreparedModel } from "../net/account";
import { Notice } from "./ui";

export function problemText(p: BudgetProblem): string {
  const kb = (n: number) => Math.round(n / 1024);
  return t(`budget.${p.what}` as Key, {
    value: p.what === "bytes" ? kb(p.value) : p.what === "texturePixels" ? (p.value / 1048576).toFixed(1) : p.value,
    max: p.what === "bytes" ? kb(p.max) : p.what === "texturePixels" ? Math.round(p.max / 1048576) : p.max,
  });
}

/**
 * Selector de archivo .glb/.vrm que valida y optimiza el modelo en el propio navegador
 * (nada sale de tu equipo hasta que pulsas subir).
 */
export function ModelPicker({
  kind,
  accept,
  onReady,
}: {
  kind: AssetKind;
  accept: string;
  /** El modelo listo para subir (o null) y el nombre del archivo, sin extensión. */
  onReady: (m: PreparedModel | null, name?: string) => void;
}) {
  const [state, setState] = useState<"idle" | "working" | "ready" | "error">("idle");
  const [model, setModel] = useState<PreparedModel | null>(null);
  const [error, setError] = useState("");

  return (
    <div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-cal/25 px-4 py-2.5 text-sm text-cal/80 hover:border-neon hover:text-cal">
        <span aria-hidden>⬆</span>
        {t("avatar.choose")}
        <input
          type="file"
          accept={accept}
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setState("working");
            setError("");
            onReady(null);
            try {
              const m = await prepareModel(file, kind);
              setModel(m);
              setState("ready");
              onReady(m.problems.length ? null : m, file.name.replace(/\.(glb|vrm)$/i, ""));
            } catch (err) {
              setError(errorText(err));
              setState("error");
            }
          }}
        />
      </label>
      {state === "working" && <Notice>{t("avatar.preparing")}</Notice>}
      {state === "error" && <Notice tone="error">{error}</Notice>}
      {state === "ready" && model && (
        <div className="mt-3 text-sm">
          <p className="text-cal/80">
            {t("avatar.ready", { tris: model.report.triangles, kb: Math.round(model.report.bytes / 1024) })}
            {model.report.isVrm ? " · VRM" : ""}
          </p>
          {model.notes.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-cal/50">
              {model.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {model.problems.map((p) => (
            <Notice key={p.what} tone="error">
              {problemText(p)}
            </Notice>
          ))}
        </div>
      )}
    </div>
  );
}
