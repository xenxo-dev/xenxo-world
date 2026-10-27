import { useEffect, useRef, useState } from "react";
import { DISTRICT_AREA } from "@xenxo/protocol";
import { errorText, registerPlaceName, t, useLang, type Key } from "../i18n";
import { ApiError } from "../net/account";
import {
  deleteDistrict,
  modDistricts,
  myDistrict,
  reviewDistrict,
  submitDistrict,
  uploadDistrictFolder,
  type CommunityDistrict,
  type DistrictStatus,
  type UploadStep,
} from "../net/community";
import { travel } from "../net/session";
import { Button, card, input, Notice } from "./ui";

const STATUS_KEY: Record<DistrictStatus, Key> = {
  draft: "district.status.draft",
  pending: "district.status.pending",
  approved: "district.status.approved",
  rejected: "district.status.rejected",
  hidden: "district.status.hidden",
};

type Problem = { at: string; message: string };

/** Lo que devolvió el servidor si la ficha tenía problemas (cada uno con su explicación). */
function serverProblems(e: unknown, lang: string): Problem[] | null {
  if (!(e instanceof ApiError) || e.code !== "district_problems" || !Array.isArray(e.detail)) return null;
  return (e.detail as { at: string; es: string; en: string }[]).map((p) => {
    const text = lang === "es" ? p.es : p.en;
    const i = text.indexOf(": ");
    return { at: p.at, message: i >= 0 ? text.slice(i + 2) : text };
  });
}

function goInto(d: CommunityDistrict, onEnter?: () => void) {
  // Un borrador no sale en /districts: su nombre para el HUD, desde aquí.
  registerPlaceName(d.chunk_id, d.manifest.name);
  travel(d.chunk_id, DISTRICT_AREA.spawn, 0);
  onEnter?.();
}

/** Tu distrito de la comunidad: subir la carpeta del kit, entrar en el borrador y enviarlo a revisión. */
export function MyDistrict({ onEnter }: { onEnter?: () => void }) {
  const lang = useLang();
  const [d, setD] = useState<CommunityDistrict | null | undefined>(undefined);
  const [step, setStep] = useState<UploadStep | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [warnings, setWarnings] = useState<Problem[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    myDistrict().then(setD, () => setD(null));
  }, []);
  // Elegir carpetas (no archivos sueltos): atributo no estándar que React no tipa.
  useEffect(() => {
    picker.current?.setAttribute("webkitdirectory", "");
    picker.current?.setAttribute("directory", "");
  }, []);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setProblems([]);
    setWarnings([]);
    setError("");
    setSaved(false);
    try {
      const r = await uploadDistrictFolder(files, lang === "es" ? "es" : "en", setStep, d ?? null);
      setWarnings(r.warnings);
      if (!r.ok) setProblems(r.problems);
      else {
        setD(r.district);
        setSaved(true);
      }
    } catch (e) {
      const p = serverProblems(e, lang);
      if (p) setProblems(p);
      else setError(errorText(e));
    } finally {
      setStep(null);
      if (picker.current) picker.current.value = "";
    }
  };

  const run = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const busy = step !== null;
  const stepText =
    step?.phase === "check" ? t("district.checking") : step?.phase === "upload" ? t("district.uploading", { done: step.done, total: step.total }) : step?.phase === "save" ? t("district.saving") : "";
  const m = d?.manifest;

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-prose text-sm leading-relaxed text-soft">{t("district.intro")}</p>
      <pre className="overflow-x-auto rounded-lg border border-cal/10 bg-noche/70 p-3 font-mono text-xs text-cal/85">
        {`npm create xenxo@latest ${lang === "es" ? "mi-distrito" : "my-district"} -- --district${lang === "es" ? "" : " --lang en"}\nnpm run validate`}
      </pre>

      {d && m && (
        <div className={`${card} p-4`} style={{ borderColor: `${m.color}55` }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="display text-lg font-semibold" style={{ color: m.color }}>
              {m.name[lang] ?? m.name.en}
            </p>
            <span className="meta text-xs uppercase tracking-[0.14em] text-muted">{t(STATUS_KEY[d.status])}</span>
          </div>
          <p className="mt-1 text-sm text-soft">{m.description[lang] ?? m.description.en}</p>
          <p className="meta mt-2 text-xs text-muted">
            {t("district.counts", { pieces: m.pieces.length, models: Object.keys(m.models).length, portals: m.portals.length, rev: d.rev })}
          </p>
          {d.review_note && (d.status === "rejected" || d.status === "hidden") && <Notice tone="error">{t("district.reason", { note: d.review_note })}</Notice>}
          {d.status === "draft" && <Notice>{t("district.draftHint")}</Notice>}
          {d.status === "pending" && <Notice>{t("district.pendingHint")}</Notice>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => goInto(d, onEnter)}>
              {t("district.enter")} →
            </Button>
            {(d.status === "draft" || d.status === "rejected") && (
              <Button onClick={() => void run(async () => setD(await submitDistrict()))}>{t("district.submit")}</Button>
            )}
            {confirmDelete ? (
              <Button
                variant="danger"
                onClick={() =>
                  void run(async () => {
                    await deleteDistrict();
                    setD(null);
                    setConfirmDelete(false);
                  })
                }
              >
                {t("district.deleteSure")}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                {t("district.delete")}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input ref={picker} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
        <Button variant={d ? "secondary" : "primary"} disabled={busy || d === undefined} onClick={() => picker.current?.click()}>
          {d ? t("district.uploadAgain") : t("district.upload")}
        </Button>
        {busy && <span className="text-sm text-muted">{stepText}</span>}
      </div>
      {d?.status === "approved" && <p className="text-xs text-muted">{t("district.editWarning")}</p>}

      {saved && <Notice tone="ok">{t("district.saved")}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {problems.length > 0 && <ProblemList title={t("district.problems", { n: problems.length })} items={problems} tone="error" />}
      {warnings.length > 0 && <ProblemList title={t("district.warnings")} items={warnings} tone="info" />}
    </div>
  );
}

function ProblemList({ title, items, tone }: { title: string; items: Problem[]; tone: "error" | "info" }) {
  return (
    <div className={`rounded-xl border px-3 py-2 text-sm ${tone === "error" ? "border-red-400/40 bg-red-500/10 text-red-100" : "border-azulejo/40 bg-azulejo/10 text-sky-100"}`} role={tone === "error" ? "alert" : "status"}>
      <p className="font-medium">{title}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {items.slice(0, 40).map((p, i) => (
          <li key={i}>
            <span className="meta text-xs opacity-80">{p.at}</span> — {p.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Moderación: distritos de la comunidad pendientes (entrar, aprobar, rechazar u ocultar con motivo). */
export function ModDistricts({ onEnter }: { onEnter?: () => void }) {
  const lang = useLang();
  const [list, setList] = useState<CommunityDistrict[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const load = () => modDistricts().then(setList, (e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);

  const decide = async (d: CommunityDistrict, decision: "approved" | "rejected" | "hidden") => {
    setError("");
    try {
      await reviewDistrict(d.id, decision, notes[d.id] ?? "");
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!list) return null;
  if (list.length === 0) return <p className="text-sm text-muted">{t("district.modEmpty")}</p>;
  return (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="error">{error}</Notice>}
      {list.map((d) => (
        <div key={d.id} className={`${card} p-4`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="display font-semibold" style={{ color: d.manifest.color }}>
              {d.manifest.name[lang] ?? d.manifest.name.en} <span className="meta text-xs text-muted">/{d.slug}</span>
            </p>
            <span className="meta text-xs uppercase tracking-[0.14em] text-muted">{t(STATUS_KEY[d.status])}</span>
          </div>
          <p className="mt-1 text-sm text-soft">{d.manifest.description[lang] ?? d.manifest.description.en}</p>
          <p className="meta mt-1 text-xs text-muted">
            {t("district.byline", { name: d.author.display_name, no: d.author.player_no ?? "?", contact: d.manifest.contact })}
          </p>
          <input
            className={`${input} mt-3`}
            placeholder={t("district.notePlaceholder")}
            maxLength={500}
            value={notes[d.id] ?? ""}
            onChange={(e) => setNotes({ ...notes, [d.id]: e.target.value })}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => goInto(d, onEnter)}>{t("district.enter")} →</Button>
            {d.status === "pending" && (
              <Button variant="primary" onClick={() => void decide(d, "approved")}>
                {t("district.approve")}
              </Button>
            )}
            {d.status === "pending" && (
              <Button variant="danger" onClick={() => void decide(d, "rejected")}>
                {t("district.reject")}
              </Button>
            )}
            {d.status === "approved" && (
              <Button variant="danger" onClick={() => void decide(d, "hidden")}>
                {t("district.hide")}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
