/**
 * Operar sin desplegar (solo moderación): los interruptores de emergencia y cuánta gente viene.
 * Lo que hace cada cosa en el servidor está en apps/realtime/src/ops.ts.
 */
import { useEffect, useState } from "react";
import { errorText, t, useLang, type Key } from "../i18n";
import { loadBoot } from "../net/boot";
import { districtOf } from "../net/districts";
import { FLAG_NAMES, modFlags, modSetFlag, modStats, type FlagName, type FlagsInfo, type StatEvent, type StatRow } from "../net/ops";
import { timeAgo } from "../net/scores";
import { Button, card, input, Notice, Segmented } from "./ui";

/** Cerrar al momento las altas, el chat o la zona de pruebas, y volver a abrir. */
export function EmergencySwitches() {
  useLang();
  const [info, setInfo] = useState<FlagsInfo | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    modFlags()
      .then(setInfo)
      .catch((e) => setError(errorText(e)));
  }, []);

  const set = async (name: FlagName, open: boolean) => {
    setBusy(true);
    setError("");
    try {
      setInfo(await modSetFlag(name, open, note));
      setNote("");
      // Que este panel (y el formulario de alta) lo sepan ya.
      void loadBoot(0);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${card} p-4`}>
      <h3 className="display text-[15px] font-semibold text-cal">{t("ops.flags.title")}</h3>
      <p className="mt-1 text-sm text-cal/65">{t("ops.flags.intro")}</p>
      {error && <Notice tone="error">{error}</Notice>}
      {info?.failed?.length ? <Notice tone="error">{t("ops.flags.failed", { list: info.failed.join(", ") })}</Notice> : null}
      <ul className="mt-3 flex flex-col divide-y divide-cal/10">
        {FLAG_NAMES.map((name) => {
          const open = info ? info.flags[name] : true;
          const since = info?.closed_at[name];
          return (
            <li key={name} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-cal">
                  {t(`ops.flags.${name}` as Key)}{" "}
                  <span className={`meta ml-1 text-xs ${open ? "text-lime-200" : "text-ocre"}`}>
                    {open ? t("ops.flags.open") : t("ops.flags.closed", { when: since ? timeAgo(since) : "" })}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-cal/55">{t(`ops.flags.${name}.text` as Key)}</p>
              </div>
              <Button variant={open ? "danger" : "primary"} disabled={busy || !info} onClick={() => void set(name, !open)}>
                {open ? t("ops.flags.close") : t("ops.flags.reopen")}
              </Button>
            </li>
          );
        })}
      </ul>
      <input
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("ops.flags.note")}
        aria-label={t("ops.flags.note")}
        className={`${input} mt-1 text-sm`}
      />
    </section>
  );
}

const PERIODS = ["7", "30", "90"] as const;
const COUNTED: StatEvent[] = ["visit", "enter", "signup", "project"];

/** Nombre de un lugar del contador: el nexo, la plaza, un distrito o «los de la comunidad». */
function placeLabel(tag: string, lang: string): string {
  if (tag === "nexo") return t("nav.nexo");
  if (tag === "plaza") return t("nexo.plaza");
  if (tag === "comunidad") return t("ops.stats.community");
  const d = districtOf(tag);
  return d ? (d.name[lang] ?? d.name.en ?? tag) : tag;
}

function tagLabel(tag: string): string {
  return tag === "-" ? t("ops.stats.noTag") : tag === "otros" ? t("ops.stats.other") : tag;
}

const th = "meta px-2 py-1 text-left text-[11px] font-normal uppercase tracking-[0.1em] text-muted";
const td = "px-2 py-1 text-sm tabular-nums text-cal/85";

/** Cuánta gente viene: sumas por día, por enlace (?v=) y por lugar. Nunca quién. */
export function VisitStats() {
  const lang = useLang();
  const [days, setDays] = useState<(typeof PERIODS)[number]>("7");
  const [rows, setRows] = useState<StatRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setRows(null);
    modStats(Number(days))
      .then((r) => alive && setRows(r.rows))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [days]);

  const sum = (pick: (r: StatRow) => boolean) => (rows ?? []).reduce((n, r) => (pick(r) ? n + r.n : n), 0);
  const tags = [...new Set((rows ?? []).filter((r) => r.event !== "place").map((r) => r.tag))]
    .map((tag) => ({ tag, n: COUNTED.map((e) => sum((r) => r.event === e && r.tag === tag)) }))
    .sort((a, b) => b.n[0]! - a.n[0]! || b.n[1]! - a.n[1]!);
  const places = [...new Set((rows ?? []).filter((r) => r.event === "place").map((r) => r.tag))]
    .map((tag) => ({ tag, n: sum((r) => r.event === "place" && r.tag === tag) }))
    .sort((a, b) => b.n - a.n);
  const dayList = [...new Set((rows ?? []).map((r) => r.day))].sort().reverse().slice(0, 14);

  return (
    <section className={`${card} p-4`}>
      <h3 className="display text-[15px] font-semibold text-cal">{t("ops.stats.title")}</h3>
      <p className="mt-1 text-sm text-cal/65">{t("ops.stats.intro")}</p>
      <Segmented value={days} onChange={setDays} options={PERIODS.map((p) => ({ id: p, label: t("ops.stats.days", { n: p }) }))} />
      {error && <Notice tone="error">{error}</Notice>}
      {rows && rows.length === 0 && <p className="mt-3 text-sm text-cal/45">{t("ops.stats.empty")}</p>}
      {rows && rows.length > 0 && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {COUNTED.map((e) => (
              <div key={e} className="rounded-xl border border-cal/10 px-3 py-2">
                <dt className="meta text-[11px] uppercase tracking-[0.1em] text-muted">{t(`ops.stats.${e}` as Key)}</dt>
                <dd className="display mt-0.5 text-xl font-semibold tabular-nums text-cal">{sum((r) => r.event === e)}</dd>
              </div>
            ))}
          </dl>

          <h4 className="mt-5 text-sm font-medium text-cal/80">{t("ops.stats.byTag")}</h4>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[26rem] border-collapse">
              <thead>
                <tr>
                  <th className={th}>{t("ops.stats.tag")}</th>
                  {COUNTED.map((e) => (
                    <th key={e} className={th}>
                      {t(`ops.stats.${e}` as Key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tags.map((x) => (
                  <tr key={x.tag} className="border-t border-cal/10">
                    <td className={`${td} ${x.tag === "-" || x.tag === "otros" ? "text-cal/55" : "font-mono text-xs"}`}>{tagLabel(x.tag)}</td>
                    {x.n.map((n, i) => (
                      <td key={i} className={td}>
                        {n}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {places.length > 0 && (
            <>
              <h4 className="mt-5 text-sm font-medium text-cal/80">{t("ops.stats.byPlace")}</h4>
              <ul className="mt-1 flex flex-wrap gap-2">
                {places.map((p) => (
                  <li key={p.tag} className="rounded-lg border border-cal/10 px-2.5 py-1 text-sm text-cal/85">
                    {placeLabel(p.tag, lang)} <span className="ml-1 tabular-nums text-cal">{p.n}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <details className="mt-5 text-sm">
            <summary className="cursor-pointer text-cal/70">{t("ops.stats.byDay")}</summary>
            <div className="mt-1 overflow-x-auto">
              <table className="w-full min-w-[26rem] border-collapse">
                <thead>
                  <tr>
                    <th className={th}>{t("ops.stats.day")}</th>
                    {COUNTED.map((e) => (
                      <th key={e} className={th}>
                        {t(`ops.stats.${e}` as Key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayList.map((d) => (
                    <tr key={d} className="border-t border-cal/10">
                      <td className={`${td} font-mono text-xs`}>{d}</td>
                      {COUNTED.map((e) => (
                        <td key={e} className={td}>
                          {sum((r) => r.day === d && r.event === e)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
