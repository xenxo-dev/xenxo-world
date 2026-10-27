/**
 * La jam del momento, arriba del nexo: tema y fechas, apuntar un juego propio mientras la
 * inscripción está abierta, votar con estrellas mientras dura la votación y el podio al final.
 */
import { useCallback, useEffect, useState } from "react";
import { assetUrl } from "../config";
import { errorText, t, useLang, type Key, type Lang } from "../i18n";
import { myProjects, useAccount, type Project } from "../net/account";
import { enterJam, featuredJam, jamDetail, jamMine, leaveJam, listJams, voteJam, type JamDetail, type JamMine, type JamText } from "../net/jams";
import { fitsHere, visitorDevice } from "../games/device";
import { gameName, openGame } from "../games/state";
import { Block, Button, card, Notice } from "./ui";

const txt = (x: JamText, lang: Lang) => x[lang] || x.en || x.es;

function when(ts: number, lang: Lang) {
  return new Date(ts).toLocaleString(lang === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function JamBlock() {
  const lang = useLang();
  const user = useAccount();
  const [detail, setDetail] = useState<JamDetail | null>(null);
  const [mine, setMine] = useState<JamMine | null>(null);
  const [own, setOwn] = useState<Project[]>([]);
  const [pick, setPick] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const j = featuredJam(await listJams().catch(() => []));
    if (!j) return setDetail(null);
    const [d, m] = await Promise.all([jamDetail(j.slug), jamMine(j.slug).catch(() => null)]);
    setDetail(d);
    setMine(m);
  }, []);

  useEffect(() => {
    void load().catch(() => setDetail(null));
  }, [load, user?.id]);

  // Tus juegos que se pueden apuntar: publicados, con ficha y no rechazados.
  const phase = detail?.jam.phase;
  useEffect(() => {
    if (!user || phase !== "submissions") return setOwn([]);
    myProjects()
      .then((ps) => setOwn(ps.filter((p) => p.game && p.status !== "hidden" && p.review !== "rejected")))
      .catch(() => setOwn([]));
  }, [user, phase]);

  if (!detail) return null;
  const { jam, entries, results } = detail;
  const slug = jam.slug;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const mineIds = new Set(mine?.entries.map((e) => e.project_id));
  const myEntry = mine?.entries[0];
  const myEntryProject = myEntry ? own.find((p) => p.id === myEntry.project_id) ?? entries.find((p) => p.id === myEntry.project_id) : undefined;
  const rankOf = new Map(results?.map((r) => [r.project_id, r]));
  const shown = results ? [...entries].sort((a, b) => (rankOf.get(a.id)?.rank ?? 99) - (rankOf.get(b.id)?.rank ?? 99)) : entries;

  const status: Record<typeof jam.phase, string> = {
    upcoming: t("jam.upcoming", { date: when(jam.starts_at, lang) }),
    submissions: t("jam.submissions", { date: when(jam.ends_at, lang) }),
    voting: t("jam.voting", { date: when(jam.voting_ends_at, lang) }),
    results: t("jam.results"),
  };

  return (
    <Block title={t("jam.title")}>
      <div className={`${card} overflow-hidden border-neon/30 bg-gradient-to-br from-neon/10 via-transparent to-transparent p-5`}>
        <p className="text-xs uppercase tracking-wide text-neon-suave">{status[jam.phase]}</p>
        <p className="display mt-1 text-2xl font-semibold text-cal">{txt(jam.title, lang)}</p>
        <p className="mt-2 text-sm text-cal/70">
          {t("jam.theme")} <strong className="text-cal">«{txt(jam.theme, lang)}»</strong>
        </p>
        {txt(jam.about, lang) && <p className="mt-3 max-w-prose whitespace-pre-line text-sm leading-relaxed text-cal/65">{txt(jam.about, lang)}</p>}
        <p className="mt-3 text-xs text-cal/45">{t("jam.rules")}</p>

        {jam.phase === "submissions" && (
          <div className="mt-4 border-t border-cal/10 pt-4">
            {!user && <p className="text-sm text-cal/60">{t("jam.signIn")}</p>}
            {user && myEntry && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {myEntry.removed_note ? (
                  <Notice tone="error">{t("jam.removed", { note: myEntry.removed_note })}</Notice>
                ) : (
                  <>
                    <span className="text-cal/80">{t("jam.yourEntry", { name: myEntryProject ? gameName(myEntryProject, lang) : myEntry.project_id })}</span>
                    <Button variant="ghost" disabled={busy} onClick={() => void run(() => leaveJam(slug, myEntry.project_id))}>
                      {t("jam.leave")}
                    </Button>
                  </>
                )}
              </div>
            )}
            {user && (!myEntry || myEntry.removed_note) && (
              <>
                {own.length === 0 ? (
                  <p className="text-sm text-cal/60">{t("jam.noGames")}</p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label htmlFor="jam-pick" className="sr-only">
                      {t("jam.pick")}
                    </label>
                    <select
                      id="jam-pick"
                      value={pick}
                      onChange={(e) => setPick(e.target.value)}
                      className="rounded-xl border border-cal/15 bg-noche px-3 py-2 text-sm text-cal"
                    >
                      <option value="">{t("jam.pick")}</option>
                      {own
                        .filter((p) => p.id !== myEntry?.project_id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {gameName(p, lang)}
                          </option>
                        ))}
                    </select>
                    <Button variant="primary" disabled={busy || !pick} onClick={() => void run(() => enterJam(slug, pick))}>
                      {t("jam.enter")}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {jam.phase === "voting" && (
          <p className="mt-4 border-t border-cal/10 pt-4 text-sm text-cal/65">
            {!user ? t("jam.signInVote") : mine?.can_vote === false ? t("jam.tooNew") : t("jam.howToVote")}
          </p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>

      {jam.phase !== "upcoming" && (
        <>
          <h3 className="mb-3 mt-5 text-sm font-medium uppercase tracking-wide text-cal/50">{t("jam.entries", { n: entries.length })}</h3>
          {entries.length === 0 && <p className="text-sm text-cal/50">{t("jam.empty")}</p>}
          <ul className="grid gap-3 sm:grid-cols-2">
            {shown.map((p) => {
              const r = rankOf.get(p.id);
              const isMine = mineIds.has(p.id);
              return (
                <li key={p.id} className={`${card} flex flex-col overflow-hidden`}>
                  <div className="relative">
                    {p.cover_hash ? (
                      <img src={assetUrl(p.cover_hash)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                    ) : (
                      <div className="aspect-video w-full bg-gradient-to-br from-noche-2 to-noche" />
                    )}
                    {r && r.rank <= 3 && r.votes > 0 && (
                      <span className="absolute left-2 top-2 rounded-full bg-noche/80 px-2 py-1 text-lg" aria-label={t("jam.rank", { n: r.rank })}>
                        {MEDALS[r.rank - 1]}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-4">
                    <p className="display text-[17px] font-semibold text-cal">
                      {r ? `${r.rank}. ` : ""}
                      {gameName(p, lang)}
                    </p>
                    <p className="text-xs text-cal/50">{t("projects.by", { name: p.author })}</p>
                    {r && <p className="text-sm text-cal/75">{r.votes ? t("jam.score", { avg: r.average.toFixed(2), n: r.votes }) : t("jam.noVotes")}</p>}
                    {jam.phase === "voting" && user && !isMine && mine?.can_vote && (
                      <Stars value={mine.votes[p.id] ?? 0} disabled={busy} onChange={(n) => void run(() => voteJam(slug, p.id, n))} />
                    )}
                    {jam.phase === "voting" && isMine && <p className="text-xs text-cal/45">{t("jam.ownEntry")}</p>}
                    <div className="mt-auto pt-3">
                      {p.game && fitsHere(p.game.devices) ? (
                        <button onClick={() => openGame(p)} className="w-full btn-play rounded-xl px-4 py-2.5 text-center text-sm font-medium">
                          {t("portal.play")}
                        </button>
                      ) : (
                        <p className="rounded-xl border border-cal/10 px-4 py-2.5 text-center text-sm text-cal/55">
                          {t("gate.unavailable", { device: t(`gate.device.${visitorDevice()}` as Key) })}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Block>
  );
}

/** Estrellas de 1 a 5. Pulsar la que ya está puesta retira el voto. */
function Stars({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled: boolean }) {
  return (
    <div role="group" aria-label={t("jam.yourVote")} className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          disabled={disabled}
          onClick={() => onChange(n === value ? 0 : n)}
          aria-pressed={n <= value}
          aria-label={t("jam.stars", { n })}
          className={`grid h-10 w-10 place-items-center rounded-lg text-2xl transition hover:bg-cal/10 disabled:opacity-50 ${n <= value ? "text-[#ffd25e]" : "text-cal/25"}`}
        >
          ★
        </button>
      ))}
      {value > 0 && <span className="ml-2 text-xs text-cal/45">{t("jam.voted")}</span>}
    </div>
  );
}
