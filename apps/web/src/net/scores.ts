/**
 * Marcadores de los distritos: los textos (comunes al marcador del mundo y al panel) y los del
 * panel, que llegan con el arranque (GET /boot, net/boot.ts; el servidor los guarda cinco minutos).
 */
import { useEffect, useState } from "react";
import { t } from "../i18n";
import { formatRaceTime } from "./activity-store";
import { loadBoot } from "./boot";

export interface ScoreRow {
  name: string;
  player_no?: number;
  value: number;
  ts: number;
}
export interface DistrictBoards {
  id: string;
  name: Record<string, string>;
  color: string;
  boards: { entity_id: string; kind: string; id: string; period: string; title: Record<string, string> | null; rows: ScoreRow[] }[];
}

export function boardTitle(kind: string, period?: string) {
  if (kind === "builds") return t("activity.boardBuilds");
  if (kind === "points") return period === "week" ? t("activity.boardPointsWeek") : period === "all" ? t("activity.boardPointsAll") : t("activity.boardPoints");
  if (kind === "race") return period === "week" ? t("activity.boardRaceWeek") : t("activity.boardRace");
  return t("activity.boardHunt");
}

/** «hace 5 min», «hace 2 h», «hace 3 d». */
export function timeAgo(ts: number) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  return m < 60 ? t("time.min", { n: m }) : m < 1440 ? t("time.h", { n: Math.round(m / 60) }) : t("time.d", { n: Math.round(m / 1440) });
}

/** Valor de una fila según el tipo de marcador. */
export function scoreValue(kind: string, v: number, ts: number) {
  if (kind === "race") return formatRaceTime(v);
  if (kind === "points") return t("activity.points", { n: v });
  if (kind === "builds") return t("activity.builds", { n: v, ago: timeAgo(ts) });
  return new Date(ts).toLocaleDateString();
}

export function useScores() {
  const [data, setData] = useState<DistrictBoards[] | null | "error">(null);
  useEffect(() => {
    let alive = true;
    void loadBoot(5 * 60_000).then((b) => alive && setData(b ? b.scores.districts : "error"));
    return () => {
      alive = false;
    };
  }, []);
  return data;
}
