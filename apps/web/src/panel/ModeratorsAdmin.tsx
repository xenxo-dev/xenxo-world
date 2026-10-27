/**
 * Moderación → Equipo: quién modera. El fundador nombra o retira a alguien por su número de
 * jugador (público); cada cambio queda en el registro de decisiones (DSA).
 */
import { useEffect, useState } from "react";
import { errorText, getLang, t } from "../i18n";
import { modModerators, modSetModerator, type ModeratorRow } from "../net/games";
import { Button, input, Label, Notice } from "./ui";

export function ModeratorsAdmin({ founder }: { founder: boolean }) {
  const [rows, setRows] = useState<ModeratorRow[] | null>(null);
  const [no, setNo] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    modModerators()
      .then((r) => setRows(r.moderators))
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);

  const change = async (n: number, on: boolean) => {
    setBusy(true);
    setError("");
    setDone("");
    try {
      await modSetModerator(n, on);
      setDone(t(on ? "modTeam.added" : "modTeam.removed", { n }));
      setNo("");
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const date = (ms: number) => new Date(ms).toLocaleDateString(getLang() === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  const wanted = Number(no);

  return (
    <div className="space-y-4">
      <p className="text-sm text-soft">{t("modTeam.intro")}</p>
      <ul className="divide-y divide-cal/10 rounded-2xl border border-cal/10">
        {(rows ?? []).map((r) => (
          <li key={`${r.player_no}-${r.display_name}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="text-cal">
              <span className="meta text-muted">#{r.player_no ?? "—"}</span> {r.display_name}
              <span className="ml-2 text-xs text-muted">{r.founder ? t("modTeam.founder") : r.added_at ? t("modTeam.since", { date: date(r.added_at) }) : ""}</span>
            </span>
            {founder && !r.founder && r.player_no !== null && (
              <Button variant="ghost" disabled={busy} onClick={() => void change(r.player_no!, false)}>
                {t("modTeam.remove")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {founder && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="mod-team-no">{t("modTeam.number")}</Label>
            <input
              id="mod-team-no"
              inputMode="numeric"
              value={no}
              onChange={(e) => setNo(e.target.value.replace(/\D/g, "").slice(0, 9))}
              className={`${input} w-40`}
            />
          </div>
          <Button variant="primary" disabled={busy || !no || !Number.isInteger(wanted)} onClick={() => void change(wanted, true)}>
            {t("modTeam.add")}
          </Button>
        </div>
      )}
      {done && <Notice tone="ok">{done}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
