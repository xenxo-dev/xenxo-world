/**
 * Quedadas (net/meetups.ts). En la portada, la próxima: qué es, cuándo (en la hora de quien mira),
 * dónde, cuánto falta y, si va con una, su jam; con un botón para añadirla al calendario y, desde un
 * poco antes de la hora, otro para entrar justo allí. En Cuenta → Moderación, anunciarlas y
 * cancelarlas (queda en el registro).
 */
import { useEffect, useState } from "react";
import { errorText, getLang, t, useLang } from "../i18n";
import { useBoot } from "../net/boot";
import { useDistricts } from "../net/districts";
import { meetupIcs, meetupOn, modCancelMeetup, modCreateMeetup, nextMeetup, useMeetups, type Meetup } from "../net/meetups";
import { travel } from "../net/session";
import { placeLink } from "../routes";
import { directPlace } from "../world/guide";
import { Button, card, input, Label, Notice } from "./ui";

function usePlaceName() {
  const districts = useDistricts();
  return (place: string) => (place === "plaza" ? t("nexo.plaza") : (districts?.find((d) => d.id === place)?.name[getLang()] ?? place));
}

/** «sábado, 21 de noviembre, 19:00 CET» en la hora y el idioma de quien mira. */
const when = (ms: number, lang: string) =>
  new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(ms);

/** Cuánto falta, a grandes rasgos. */
function left(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return t("meetup.inMin", { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return t("meetup.inHours", { n: h });
  return t("meetup.inDays", { n: Math.round(h / 24) });
}

export function MeetupBlock({ onEnter }: { onEnter: () => void }) {
  const lang = useLang();
  const list = useMeetups();
  const boot = useBoot();
  const name = usePlaceName();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const m = nextMeetup(list, now);
  if (!m) return null;
  const on = meetupOn(m, now);
  const where = name(m.place);
  const link = placeLink(m.place, m.spot, lang);
  const jam = m.jam ? boot?.jams.find((j) => j.slug === m.jam) : undefined;

  const go = () => {
    const d = directPlace(m.place, m.spot);
    if (!d || d === "soon") return;
    travel(d.chunk, d.p, d.yaw);
    onEnter();
  };
  const calendar = () => {
    const url = URL.createObjectURL(new Blob([meetupIcs(m, lang === "en" ? "en" : "es", where, link)], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `xenxo-quedada-${m.id}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <section aria-label={t("meetup.title")} className={`${card} mb-8 border-neon/25 p-5`}>
      <p className="meta text-xs uppercase tracking-[0.14em] text-neon">{t(!on ? "meetup.title" : now < m.starts_at ? "meetup.soon" : "meetup.now")}</p>
      <h2 className="display mt-1 text-xl font-semibold text-cal">{m.title[lang === "en" ? "en" : "es"]}</h2>
      <p className="mt-1 text-sm text-cal/80">
        {when(m.starts_at, lang)} · {t("meetup.in", { place: where })}
        {now < m.starts_at && <span className="meta ml-2 text-xs text-soft">{left(m.starts_at - now)}</span>}
      </p>
      {m.about[lang === "en" ? "en" : "es"] && <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-soft">{m.about[lang === "en" ? "en" : "es"]}</p>}
      {jam && <p className="mt-2 text-sm text-cal/75">{t("meetup.withJam", { jam: jam.title[lang === "en" ? "en" : "es"] })}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {on && (
          <button onClick={go} className="neon-tube rounded-full px-4 py-2 text-sm font-semibold">
            {t("meetup.go", { place: where })}
          </button>
        )}
        <button onClick={calendar} className="btn-ghost rounded-full px-4 py-2 text-sm">
          {t("meetup.calendar")}
        </button>
      </div>
    </section>
  );
}

/** datetime-local ↔ milisegundos (hora local de quien modera). */
const toLocal = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const fromLocal = (v: string) => new Date(v).getTime();
const blank = () => {
  const start = Math.ceil((Date.now() + 2 * 86_400_000) / 3_600_000) * 3_600_000;
  return { starts: toLocal(start), hours: "2", place: "plaza", spot: "", titleEs: "", titleEn: "", aboutEs: "", aboutEn: "", jam: "" };
};

export function MeetupAdmin() {
  useLang();
  const list = useMeetups();
  const boot = useBoot();
  const name = usePlaceName();
  const districts = useDistricts();
  const [f, setF] = useState(blank);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const places = ["plaza", ...(districts ?? []).filter((d) => !d.soon && !d.community).map((d) => d.id)];

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError("");
    setDone("");
    try {
      await fn();
      setDone(ok);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof ReturnType<typeof blank>) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const text = (id: keyof ReturnType<typeof blank>, label: string, max: number, area = false) => (
    <div>
      <Label htmlFor={`meet-${id}`}>{label}</Label>
      {area ? (
        <textarea id={`meet-${id}`} rows={3} maxLength={max} value={f[id]} onChange={set(id)} className={`${input} text-sm`} />
      ) : (
        <input id={`meet-${id}`} maxLength={max} value={f[id]} onChange={set(id)} className={`${input} text-sm`} />
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-cal/65">{t("meetupAdmin.intro")}</p>
      {list.length === 0 && <p className="text-sm text-cal/45">{t("meetupAdmin.none")}</p>}
      {list.map((m: Meetup) => (
        <div key={m.id} className={`${card} flex flex-wrap items-center justify-between gap-2 p-3 text-sm`}>
          <div>
            <p className="text-cal">
              <strong>{m.title[getLang() === "en" ? "en" : "es"]}</strong> · {name(m.place)}
              {m.spot ? <span className="font-mono text-xs text-cal/50"> /{m.spot}</span> : null}
            </p>
            <p className="text-xs text-cal/45">
              {new Date(m.starts_at).toLocaleString()} → {new Date(m.ends_at).toLocaleTimeString()}
              {m.jam ? ` · jam ${m.jam}` : ""}
            </p>
          </div>
          <Button variant="danger" disabled={busy} onClick={() => void run(() => modCancelMeetup(m.id), t("meetupAdmin.cancelled"))}>
            {t("meetupAdmin.cancel")}
          </Button>
        </div>
      ))}
      <details className={`${card} p-3`}>
        <summary className="cursor-pointer text-sm text-cal/80">{t("meetupAdmin.new")}</summary>
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const starts = fromLocal(f.starts);
            void run(
              () =>
                modCreateMeetup({
                  starts_at: starts,
                  ends_at: starts + Math.max(0.5, Math.min(12, Number(f.hours) || 2)) * 3_600_000,
                  place: f.place,
                  spot: f.spot.trim() || null,
                  title: { es: f.titleEs, en: f.titleEn },
                  about: { es: f.aboutEs, en: f.aboutEn },
                  jam: f.jam || null,
                }).then(() => setF(blank())),
              t("meetupAdmin.created"),
            );
          }}
        >
          <div className="grid gap-x-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="meet-starts">{t("meetupAdmin.starts")}</Label>
              <input id="meet-starts" type="datetime-local" value={f.starts} onChange={set("starts")} className={`${input} text-sm`} />
            </div>
            <div>
              <Label htmlFor="meet-hours">{t("meetupAdmin.hours")}</Label>
              <input id="meet-hours" type="number" min={0.5} max={12} step={0.5} value={f.hours} onChange={set("hours")} className={`${input} text-sm`} />
            </div>
            <div>
              <Label htmlFor="meet-place">{t("meetupAdmin.place")}</Label>
              <select id="meet-place" value={f.place} onChange={set("place")} className={`${input} text-sm`}>
                {places.map((p) => (
                  <option key={p} value={p}>
                    {name(p)}
                  </option>
                ))}
              </select>
            </div>
            {text("spot", t("meetupAdmin.spot"), 32)}
            {text("titleEs", t("jamAdmin.titleEs"), 80)}
            {text("titleEn", t("jamAdmin.titleEn"), 80)}
            {text("aboutEs", t("jamAdmin.aboutEs"), 500, true)}
            {text("aboutEn", t("jamAdmin.aboutEn"), 500, true)}
            <div>
              <Label htmlFor="meet-jam">{t("meetupAdmin.jam")}</Label>
              <select id="meet-jam" value={f.jam} onChange={set("jam")} className={`${input} text-sm`}>
                <option value="">—</option>
                {(boot?.jams ?? []).map((j) => (
                  <option key={j.slug} value={j.slug}>
                    {j.title[getLang() === "en" ? "en" : "es"]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button type="submit" variant="primary" disabled={busy} className="mt-4">
            {t("meetupAdmin.create")}
          </Button>
        </form>
      </details>
      {error && <Notice tone="error">{error}</Notice>}
      {done && <Notice tone="ok">{done}</Notice>}
    </div>
  );
}
