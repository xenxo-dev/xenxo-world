import { useEffect, useState } from "react";
import { assetUrl } from "../config";
import { errorText, getLang, t, type Key } from "../i18n";
import { avatarMode, type Project } from "../net/account";
import { modHide, modLog, modQueue, modReport, modReview, modSyncShowcase, myRoles, type LogEntry, type Report } from "../net/games";
import { gameName, openGame } from "../games/state";
import { Button, card, input, Notice } from "./ui";

/** ¿Modera esta persona? (el fundador siempre). */
export function useRoles(userId: string | undefined): { moderator: boolean; founder: boolean } {
  const [roles, setRoles] = useState({ moderator: false, founder: false });
  useEffect(() => {
    let alive = true;
    if (!userId) return setRoles({ moderator: false, founder: false });
    myRoles()
      .then((r) => alive && setRoles({ moderator: r.moderator, founder: !!r.founder }))
      .catch(() => alive && setRoles({ moderator: false, founder: false }));
    return () => {
      alive = false;
    };
  }, [userId]);
  return roles;
}

export function useModerator(userId: string | undefined): boolean {
  return useRoles(userId).moderator;
}

/**
 * Moderación (DSA): revisar lo publicado antes de que salga en el catálogo, ocultar lo que no
 * cumple (con su motivo, que ve su autor) y resolver denuncias. Cada decisión queda registrada.
 */
export function Moderation() {
  const [pending, setPending] = useState<Project[] | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    modQueue()
      .then((q) => {
        setPending(q.pending);
        setReports(q.reports);
      })
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      if (log) setLog((await modLog()).log);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const note = (k: string) => notes[k] ?? "";
  const noteInput = (k: string) => (
    <textarea
      rows={2}
      value={note(k)}
      maxLength={500}
      placeholder={t("mod.notePlaceholder")}
      onChange={(e) => setNotes({ ...notes, [k]: e.target.value })}
      className={`${input} mt-2 text-sm`}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-cal/65">{t("mod.intro")}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={() => void run(modSyncShowcase)}>
          {t("mod.syncCabinets")}
        </Button>
        <span className="text-xs text-cal/55">{t("mod.syncCabinetsHint")}</span>
      </div>

      <h3 className="text-sm font-medium text-cal/80">{t("mod.pending", { n: pending?.length ?? 0 })}</h3>
      {pending?.length === 0 && <p className="text-sm text-cal/45">{t("mod.nothing")}</p>}
      {pending?.map((p) => (
        <div key={p.id} className={`${card} overflow-hidden`}>
          <div className="flex gap-3 p-3">
            {p.cover_hash && <img src={assetUrl(p.cover_hash)} alt="" className="aspect-video w-32 shrink-0 rounded-lg object-cover" />}
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-cal">{gameName(p, getLang())}</p>
              <p className="text-xs text-cal/50">
                {t("projects.by", { name: p.author })} · {p.district}/{p.parcel}
              </p>
              {p.url && (
                <a href={p.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all text-xs text-azulejo-claro underline">
                  {p.url}
                </a>
              )}
              {p.game ? (
                <p className="mt-1 text-xs text-cal/60">
                  {t(p.game.ageRating === "all" ? "gate.age.all" : "gate.age.14")}
                  {p.game.monetization.hasAds ? ` · ${t("gate.ads")}` : ""}
                  {p.game.monetization.hasPurchases ? ` · ${t("gate.purchases")}` : ""} · {p.game.devices.join(", ")}
                </p>
              ) : null}
              {p.game ? (
                <p className="mt-1 text-xs text-sky-100/80">{t(`mod.avatar.${avatarMode(p.game)}` as Key)}</p>
              ) : (
                <p className="mt-1 text-xs text-cal/45">{t("mod.noGame")}</p>
              )}
              {p.summary && <p className="mt-1 text-xs text-cal/60">{p.summary}</p>}
            </div>
          </div>
          <div className="border-t border-cal/10 p-3">
            {noteInput(`p:${p.id}`)}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy} onClick={() => void run(() => modReview(p.id, "approved", note(`p:${p.id}`)))}>
                {t("mod.approve")}
              </Button>
              <Button disabled={busy} onClick={() => void run(() => modReview(p.id, "rejected", note(`p:${p.id}`)))}>
                {t("mod.reject")}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void run(() => modHide(p.id, note(`p:${p.id}`)))}>
                {t("mod.hide")}
              </Button>
              {p.game && (
                <Button variant="ghost" onClick={() => openGame(p)}>
                  {t("mod.try")}
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}

      <h3 className="mt-2 text-sm font-medium text-cal/80">{t("mod.reports", { n: reports.length })}</h3>
      {reports.length === 0 && <p className="text-sm text-cal/45">{t("mod.nothing")}</p>}
      {reports.map((r) => (
        <div key={r.id} className={`${card} p-3 text-sm`}>
          <p className="text-cal/85">
            <span className="font-mono text-xs text-cal/50">#{r.id}</span> {r.target_type} <span className="font-mono text-xs">{r.target_id}</span> ·{" "}
            <strong>{r.reason}</strong>
          </p>
          <p className="text-xs text-cal/45">{new Date(r.ts).toLocaleString()}</p>
          {r.details && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-cal/70">{r.details}</p>}
          {noteInput(`r:${r.id}`)}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void run(() => modReport(r.id, "dismissed", note(`r:${r.id}`)))}>
              {t("mod.dismiss")}
            </Button>
            <Button disabled={busy} onClick={() => void run(() => modReport(r.id, "actioned", note(`r:${r.id}`)))}>
              {t("mod.actioned")}
            </Button>
            {r.target_type === "project" && (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await modHide(r.target_id, note(`r:${r.id}`));
                    await modReport(r.id, "actioned", note(`r:${r.id}`));
                  })
                }
              >
                {t("mod.hideProject")}
              </Button>
            )}
          </div>
        </div>
      ))}

      <details
        className="text-sm"
        onToggle={(e) => {
          if ((e.target as HTMLDetailsElement).open && !log) void modLog().then((r) => setLog(r.log)).catch(() => setLog([]));
        }}
      >
        <summary className="cursor-pointer text-cal/70">{t("mod.log")}</summary>
        <ul className="mt-2 flex flex-col gap-1 text-xs text-cal/60">
          {log?.map((l) => (
            <li key={l.id}>
              {new Date(l.ts).toLocaleString()} · {l.moderator} · <strong>{l.action}</strong> {l.target_type} {l.target_id}
              {l.note ? ` — ${l.note}` : ""}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
