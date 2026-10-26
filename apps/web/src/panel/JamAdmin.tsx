/**
 * Moderación → Jams: crear una convocatoria (tema y fechas en ES y EN), cambiar sus fechas,
 * cancelarla y sacar un juego (con motivo, que ve su autor). Todo queda en el registro.
 */
import { useEffect, useState } from "react";
import { errorText, getLang, t, type Key } from "../i18n";
import { jamDetail, listJams, modCreateJam, modRemoveJamEntry, modUpdateJam, type Jam, type JamDetail } from "../net/jams";
import { gameName } from "../games/state";
import { Button, card, input, Label, Notice } from "./ui";

/** datetime-local ↔ milisegundos (hora local de quien modera). */
const toLocal = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
const fromLocal = (v: string) => new Date(v).getTime();

const DAY = 86_400_000;
const blank = () => {
  const start = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
  return { slug: "", titleEs: "", titleEn: "", themeEs: "", themeEn: "", aboutEs: "", aboutEn: "", starts: toLocal(start), ends: toLocal(start + 14 * DAY), voting: toLocal(start + 21 * DAY) };
};

export function JamAdmin() {
  const [jams, setJams] = useState<Jam[] | null>(null);
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState<JamDetail | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => listJams().then(setJams).catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<unknown>, ok = "") => {
    setBusy(true);
    setError("");
    setDone("");
    try {
      await fn();
      await load();
      if (open) setOpen(await jamDetail(open.jam.slug).catch(() => null));
      setDone(ok);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof ReturnType<typeof blank>) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const field = (id: keyof ReturnType<typeof blank>, label: string, max: number, area = false) => (
    <div>
      <Label htmlFor={`jam-${id}`}>{label}</Label>
      {area ? (
        <textarea id={`jam-${id}`} rows={3} maxLength={max} value={f[id]} onChange={set(id)} className={`${input} text-sm`} />
      ) : (
        <input id={`jam-${id}`} maxLength={max} value={f[id]} onChange={set(id)} className={`${input} text-sm`} />
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-cal/65">{t("jamAdmin.intro")}</p>
      {jams?.length === 0 && <p className="text-sm text-cal/45">{t("jamAdmin.none")}</p>}
      {jams?.map((j) => (
        <div key={j.slug} className={`${card} p-3 text-sm`}>
          <p className="text-cal">
            <strong>{j.title[getLang()]}</strong> <span className="font-mono text-xs text-cal/50">{j.slug}</span> · {t(`jamAdmin.phase.${j.phase}` as Key)} ·{" "}
            {t("jam.entries", { n: j.entries })}
          </p>
          <p className="text-xs text-cal/45">
            {new Date(j.starts_at).toLocaleString()} → {new Date(j.ends_at).toLocaleString()} → {new Date(j.voting_ends_at).toLocaleString()}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void jamDetail(j.slug).then(setOpen).catch((e) => setError(errorText(e)))}>
              {t("jamAdmin.entries")}
            </Button>
            {j.phase === "submissions" && (
              <Button disabled={busy} onClick={() => void run(() => modUpdateJam(j.slug, { ends_at: Date.now() }), t("jamAdmin.saved"))}>
                {t("jamAdmin.closeNow")}
              </Button>
            )}
            {j.phase === "voting" && (
              <Button disabled={busy} onClick={() => void run(() => modUpdateJam(j.slug, { voting_ends_at: Date.now() }), t("jamAdmin.saved"))}>
                {t("jamAdmin.endVoting")}
              </Button>
            )}
            <Button variant="danger" disabled={busy} onClick={() => void run(() => modUpdateJam(j.slug, { cancelled: true }), t("jamAdmin.saved"))}>
              {t("jamAdmin.cancel")}
            </Button>
          </div>
          {open?.jam.slug === j.slug && (
            <ul className="mt-3 flex flex-col gap-2 border-t border-cal/10 pt-3">
              {open.entries.length === 0 && <li className="text-xs text-cal/45">{t("jam.empty")}</li>}
              {open.entries.map((p) => (
                <li key={p.id} className="text-xs">
                  <span className="text-cal/85">{gameName(p, getLang())}</span> · {t("projects.by", { name: p.author })}
                  <div className="mt-1 flex gap-2">
                    <input
                      value={notes[p.id] ?? ""}
                      maxLength={500}
                      placeholder={t("mod.notePlaceholder")}
                      onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })}
                      className={`${input} py-1 text-xs`}
                    />
                    <Button variant="danger" disabled={busy} onClick={() => void run(() => modRemoveJamEntry(j.slug, p.id, notes[p.id] ?? ""), t("jamAdmin.saved"))}>
                      {t("jamAdmin.remove")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <details className={`${card} p-3`}>
        <summary className="cursor-pointer text-sm text-cal/80">{t("jamAdmin.new")}</summary>
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                modCreateJam({
                  slug: f.slug.trim(),
                  title: { es: f.titleEs, en: f.titleEn },
                  theme: { es: f.themeEs, en: f.themeEn },
                  about: { es: f.aboutEs, en: f.aboutEn },
                  starts_at: fromLocal(f.starts),
                  ends_at: fromLocal(f.ends),
                  voting_ends_at: fromLocal(f.voting),
                }).then(() => setF(blank())),
              t("jamAdmin.created"),
            );
          }}
        >
          {field("slug", t("jamAdmin.slug"), 40)}
          <div className="grid gap-x-3 sm:grid-cols-2">
            {field("titleEs", t("jamAdmin.titleEs"), 80)}
            {field("titleEn", t("jamAdmin.titleEn"), 80)}
            {field("themeEs", t("jamAdmin.themeEs"), 80)}
            {field("themeEn", t("jamAdmin.themeEn"), 80)}
            {field("aboutEs", t("jamAdmin.aboutEs"), 1000, true)}
            {field("aboutEn", t("jamAdmin.aboutEn"), 1000, true)}
          </div>
          <div className="grid gap-x-3 sm:grid-cols-3">
            {(
              [
                ["starts", "jamAdmin.starts"],
                ["ends", "jamAdmin.ends"],
                ["voting", "jamAdmin.votingEnds"],
              ] as const
            ).map(([k, label]) => (
              <div key={k}>
                <Label htmlFor={`jam-${k}`}>{t(label)}</Label>
                <input id={`jam-${k}`} type="datetime-local" value={f[k]} onChange={set(k)} className={`${input} text-sm`} />
              </div>
            ))}
          </div>
          <Button type="submit" variant="primary" disabled={busy} className="mt-4">
            {t("jamAdmin.create")}
          </Button>
        </form>
      </details>
      {error && <Notice tone="error">{error}</Notice>}
      {done && <Notice tone="ok">{done}</Notice>}
    </div>
  );
}
