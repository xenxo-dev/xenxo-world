import { useEffect, useState } from "react";
import { t, useLang } from "../i18n";
import { formatRaceTime, useActivity } from "../net/activity-store";

const box = "rounded-2xl border border-cal/15 bg-noche/80 backdrop-blur";

/** Avisos de las actividades (lo recogido y la carrera) y el cronómetro mientras se corre. */
export function ActivityHud() {
  const a = useActivity();
  const lang = useLang();
  const [, tick] = useState(0);
  // El cronómetro se repinta 10 veces por segundo solo mientras hay carrera; el aviso, hasta que caduca.
  useEffect(() => {
    if (!a.race && !a.toast) return;
    const id = setInterval(() => tick((n) => n + 1), a.race ? 100 : 500);
    return () => clearInterval(id);
  }, [a.race, a.toast]);
  const now = performance.now();
  // Lo que cuenta un objeto (y el final de una carrera) se queda más tiempo: hay que leerlo.
  const long = (a.toast?.kind === "race" && a.toast.state === "finish") || (a.toast?.kind === "collected" && !!a.toast.note);
  const toast = a.toast && now - a.toast.at < (long ? 8000 : 3200) ? a.toast : null;
  const note = toast?.kind === "collected" && toast.note ? (toast.note[lang] ?? toast.note.en ?? Object.values(toast.note)[0]) : null;
  let text = "";
  if (toast?.kind === "collected") text = toast.complete ? t("activity.complete", { total: toast.total }) : t("activity.collected", { count: toast.count, total: toast.total });
  else if (toast?.kind === "guest") text = t("activity.guest");
  else if (toast?.kind === "race") {
    if (toast.state === "start") text = toast.total ? t("activity.raceStart", { total: toast.total }) : t("activity.raceStartFinish");
    else if (toast.state === "cp") text = (toast.next ?? 0) > (toast.total ?? 0) ? t("activity.raceToFinish") : t("activity.raceCp", { done: (toast.next ?? 1) - 1, total: toast.total ?? 0 });
    else if (toast.state === "finish") text = t("activity.raceFinish", { time: formatRaceTime(toast.ms ?? 0), best: formatRaceTime(toast.best ?? 0), rank: toast.rank ?? "?" });
    else text = t("activity.raceReset");
  }
  if (!text && !a.race) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-20 flex -translate-x-1/2 flex-col items-center gap-2">
      {a.race && <div className={`${box} display px-4 py-1.5 text-2xl tabular-nums text-neon`}>{formatRaceTime(now - a.race.t0)}</div>}
      {text && <div className={`${box} px-4 py-2 text-sm text-cal`}>{text}</div>}
      {note && <div className={`${box} meta max-w-md px-4 py-3 text-center text-sm leading-relaxed text-soft`}>{note}</div>}
    </div>
  );
}
