import { useEffect, useState } from "react";
import { t, useLang } from "../i18n";
import { accountToken } from "../net/account";
import { formatRaceTime, useActivity, type RoundState } from "../net/activity-store";
import { myRun, roundFresh } from "../net/round";
import { world } from "../net/world-store";
import { self } from "../world/self";

const box = "rounded-2xl border border-cal/15 bg-noche/80 backdrop-blur";

/**
 * Una carrera de salida conjunta (ROUND): la cuenta atrás en la parrilla, el puesto y la vuelta
 * mientras se corre, y la clasificación al llegar. Quien va en coche sin correr ve que se está
 * formando una, para apuntarse.
 */
function RoundPanel({ r }: { r: RoundState }) {
  const me = world.sessionId;
  const left = r.go_at - world.serverNow();
  if (!r.mine) {
    if (r.state !== "countdown" || left <= 0 || !self.driving) return null;
    return <div className={`${box} px-4 py-2 text-sm text-cal`}>{t("round.forming", { s: Math.ceil(left / 1000) })}</div>;
  }
  if (r.live && r.state === "countdown") {
    if (left <= 0) return null;
    return (
      <>
        <div className="display text-7xl tabular-nums text-neon drop-shadow-[0_0_18px_rgba(0,0,0,0.9)]">{Math.ceil(left / 1000)}</div>
        <div className={`${box} px-4 py-2 text-sm text-cal`}>{t("round.grid", { n: r.entrants.length })}</div>
      </>
    );
  }
  const run = myRun(r, me);
  if (run) {
    return (
      <>
        {left > -1500 && <div className="display text-7xl text-neon drop-shadow-[0_0_18px_rgba(0,0,0,0.9)]">{t("round.go")}</div>}
        <div className={`${box} display px-4 py-1.5 text-lg tabular-nums text-cal`}>
          {t("round.place", { place: run.place, of: run.of })} · {t("round.lap", { lap: run.lap, laps: r.laps })}
        </div>
      </>
    );
  }
  // He llegado (o me he quedado fuera): cómo van los demás y, al acabar, la clasificación.
  const mine = r.entrants.find((e) => e.session_id === me);
  const rows = r.entrants.slice(0, 6);
  if (mine && !rows.includes(mine)) rows.push(mine);
  return (
    <div className={`${box} min-w-64 px-4 py-3 text-sm`}>
      <p className="display mb-1.5 text-center text-base text-neon">{t(r.state === "done" ? "round.results" : "round.standings")}</p>
      <ol className="space-y-0.5">
        {rows.map((e) => (
          <li key={e.session_id} className={`flex justify-between gap-4 tabular-nums ${e.session_id === me ? "text-neon" : "text-cal"}`}>
            <span className="truncate">
              {r.entrants.indexOf(e) + 1}. {e.name}
              {e.player_no !== undefined ? <span className="meta ml-1 text-xs text-soft">#{e.player_no}</span> : null}
            </span>
            <span className={e.ms === undefined ? "text-soft" : ""}>{e.ms !== undefined ? formatRaceTime(e.ms) : t(e.out ? "round.out" : "round.racing")}</span>
          </li>
        ))}
      </ol>
      {mine?.ms !== undefined && !accountToken() && <p className="meta mt-2 max-w-64 text-center text-xs text-soft">{t("round.guest")}</p>}
    </div>
  );
}

/** Avisos de las actividades (lo recogido y la carrera) y el cronómetro mientras se corre. */
export function ActivityHud() {
  const a = useActivity();
  const lang = useLang();
  const [, tick] = useState(0);
  // El cronómetro se repinta 10 veces por segundo solo mientras hay carrera; el aviso, hasta que caduca.
  const round = [...a.tiles.values()].find((x) => x.state === "show");
  useEffect(() => {
    if (!a.race && !a.toast && !round && !a.round) return;
    const id = setInterval(() => tick((n) => n + 1), a.race || round || a.round ? 100 : 500);
    return () => clearInterval(id);
  }, [a.race, a.toast, round, a.round]);
  const now = performance.now();
  // La carrera de salida conjunta de la que se sabe algo (mientras valga: round.ts).
  const grid = a.round && roundFresh(a.round, now) ? a.round : null;
  // Lo que cuenta un objeto (y el final de una carrera) se queda más tiempo: hay que leerlo.
  const long = (a.toast?.kind === "race" && a.toast.state === "finish") || (a.toast?.kind === "collected" && !!a.toast.note) || a.toast?.kind === "badge";
  const toast = a.toast && now - a.toast.at < (long ? 8000 : 3200) ? a.toast : null;
  const note = toast?.kind === "collected" && toast.note ? (toast.note[lang] ?? toast.note.en ?? Object.values(toast.note)[0]) : null;
  let text = "";
  if (toast?.kind === "collected") text = toast.complete ? t("activity.complete", { total: toast.total }) : t("activity.collected", { count: toast.count, total: toast.total });
  else if (toast?.kind === "guest") text = t("activity.guest");
  else if (toast?.kind === "needCar") text = t("activity.needCar");
  else if (toast?.kind === "gridFull") text = t("activity.gridFull");
  else if (toast?.kind === "rescue") text = t("activity.rescue");
  else if (toast?.kind === "wait") text = t("activity.wait");
  else if (toast?.kind === "badge") text = t("activity.badge", { name: toast.name[lang] ?? toast.name.en ?? "" });
  else if (toast?.kind === "tiles") text = toast.state === "won" ? t(accountToken() ? "activity.tilesWon" : "activity.tilesWonGuest") : t("activity.tilesLost");
  else if (toast?.kind === "race") {
    if (toast.state === "start") text = toast.total ? t("activity.raceStart", { total: toast.total }) : t("activity.raceStartFinish");
    else if (toast.state === "cp") text = (toast.next ?? 0) > (toast.total ?? 0) ? t("activity.raceToFinish") : t("activity.raceCp", { done: (toast.next ?? 1) - 1, total: toast.total ?? 0 });
    else if (toast.state === "finish") text = t("activity.raceFinish", { time: formatRaceTime(toast.ms ?? 0), best: formatRaceTime(toast.best ?? 0), rank: toast.rank ?? "?" });
    else text = t("activity.raceReset");
  }
  // Ronda del tablero en juego: cuántas baldosas quedan y cuánto tiempo.
  const left = round ? Math.max(0, (round.ms_left ?? 0) - (now - round.at)) : 0;
  const roundText = round ? t("activity.tilesGo", { done: round.done.length, total: round.lit.length, s: Math.ceil(left / 1000) }) : "";
  if (!text && !a.race && !roundText && !grid) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-20 flex -translate-x-1/2 flex-col items-center gap-2">
      {a.race && <div className={`${box} display px-4 py-1.5 text-2xl tabular-nums text-neon`}>{formatRaceTime(Math.max(0, now - a.race.t0))}</div>}
      {grid && <RoundPanel r={grid} />}
      {roundText && <div className={`${box} display px-4 py-1.5 text-lg tabular-nums text-neon`}>{roundText}</div>}
      {text && <div className={`${box} px-4 py-2 text-sm text-cal`}>{text}</div>}
      {note && <div className={`${box} meta max-w-md px-4 py-3 text-center text-sm leading-relaxed text-soft`}>{note}</div>}
    </div>
  );
}
