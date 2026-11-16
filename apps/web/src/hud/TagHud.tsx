/**
 * El HUD de los juegos de pillar (§9 decies): en el corro, si se puede entrar y cuánta gente hay; la
 * cuenta atrás; jugando, qué eres (la llevas, infectado o corres), el reloj, los avisos (te la han
 * pasado, has pillado…) y si te sales de la zona; y al acabar, quién gana. Lo cuenta el servidor
 * (TAG_ROUND, net/tag-store.ts); aquí solo se lee.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { t, useLang } from "../i18n";
import { accountToken } from "../net/account";
import { formatRaceTime } from "../net/activity-store";
import { entryOf, itMsNow, itsOf, playing, tagClock, tagFresh, type TagEntry, type TagState } from "../net/tag";
import { useTag, type TagNotice } from "../net/tag-store";
import { useWorldVersion, world } from "../net/world-store";
import { self } from "../world/self";
import { inLobby, insideMyArea, lobbiesOf } from "../world/tag-lobbies";
import { PeopleIcon } from "./people-icons";

const box = "rounded-2xl border border-cal/15 bg-noche/80 backdrop-blur";
/** Los avisos, en varias líneas antes que anchos (al lado, a la derecha, puede estar la guía). */
const line = `${box} max-w-[min(24rem,calc(100vw-2rem))] px-4 py-2 text-center text-sm text-cal`;
/** El color de cada juego (el mismo que su corro y su marca en el mundo: world/tag-lobbies.ts). */
const TONE = { tag: "text-rosa", infection: "text-lime-300" } as const;
/** Cuánto se queda un aviso (ms). */
const NOTICE_MS = 3200;

const nameOf = (g: TagState, id: string) => g.players.find((p) => p.session_id === id)?.name ?? "?";

function noticeText(n: TagNotice, g: TagState): string {
  const inf = g.mode === "infection";
  switch (n.kind) {
    case "start":
      return t(n.it ? (inf ? "tag.notice.startInfected" : "tag.notice.startIt") : "tag.notice.startRun");
    case "caught":
      return t(inf ? "tag.notice.infected" : "tag.notice.caught", { name: nameOf(g, n.by) });
    case "got":
      return t(inf ? "tag.notice.gotInfected" : "tag.notice.got", { name: nameOf(g, n.who) });
    case "seen":
      return t(inf ? "tag.notice.seenInfected" : "tag.notice.seen", { a: nameOf(g, n.from), b: nameOf(g, n.to) });
    case "out":
      return t("tag.notice.out");
  }
}

/** Qué soy: el icono, el texto y su color. */
function RoleChip({ g, me }: { g: TagState; me: TagEntry }) {
  const inf = g.mode === "infection";
  const [icon, key, tone] =
    me.role === "it" ? [inf ? "infected" : "tag_it", inf ? "tag.role.infected" : "tag.role.it", TONE[g.mode]] : me.role === "runner" ? ["tag_runner", "tag.role.runner", "text-neon"] : ["tag_runner", "tag.role.out", "text-muted"];
  return (
    <span className={`display flex items-center gap-1.5 text-lg ${tone}`}>
      <PeopleIcon name={icon} className="h-5 w-5" />
      {t(key as "tag.role.it")}
    </span>
  );
}

/** La ronda en juego: qué eres, el reloj y lo que toca (quedarte quieto, esperar para pillar, volver a la zona). */
function Running({ g, me, outside, notice }: { g: TagState; me: TagEntry; outside: boolean; notice: string | null }) {
  const st = world.serverNow();
  const left = (g.end_at ?? st) - st;
  const its = itsOf(g);
  const runners = g.players.filter((p) => p.role === "runner").length;
  const ready = (me.ready_at ?? 0) - st;
  const held = me.role === "it" && !g.tag && ready > 0;
  let extra = "";
  if (g.mode === "tag") extra = me.role === "it" || me.it_ms > 0 ? t("tag.itTime", { time: tagClock(itMsNow(g, me, st)) }) : its[0] ? t("tag.chase", { name: its[0].name }) : "";
  else extra = `${t("tag.left", { n: runners })} · ${t("tag.chaseMany", { n: its.length })}`;
  return (
    <>
      <div className={`${box} flex items-center gap-3 px-4 py-1.5`}>
        <RoleChip g={g} me={me} />
        <span className="display text-lg tabular-nums text-cal">{tagClock(left)}</span>
      </div>
      {extra && <div className={`${box} meta px-3 py-1 text-xs text-cal/80`}>{extra}</div>}
      {held && <div className={`display text-6xl tabular-nums drop-shadow-[0_0_18px_rgba(0,0,0,0.9)] ${TONE[g.mode]}`}>{Math.ceil(ready / 1000)}</div>}
      {held && <div className={line}>{t("tag.hold", { s: Math.ceil(ready / 1000) })}</div>}
      {!held && me.role === "it" && ready > 0 && <div className={line}>{t("tag.ready", { s: Math.ceil(ready / 1000) })}</div>}
      {outside && me.role !== "out" && <div className="max-w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-rosa/60 bg-noche/85 px-4 py-2 text-center text-sm text-rosa backdrop-blur">{t("tag.outside")}</div>}
      {notice && <div className={line}>{notice}</div>}
    </>
  );
}

/** Al acabar (si he jugado): por qué, quién gana y cómo me ha ido. */
function Results({ g, me }: { g: TagState; me: TagEntry }) {
  const won = (g.winners ?? []).includes(me.session_id);
  const rows = g.players.slice(0, 8);
  if (!rows.includes(me)) rows.push(me);
  const value = (p: TagEntry) => (p.role === "out" ? t("tag.out") : g.mode === "tag" ? formatRaceTime(p.it_ms) : p.role === "runner" ? t("tag.survived") : t("tag.tags", { n: p.tags }));
  return (
    <div className={`${box} min-w-64 px-4 py-3 text-sm`}>
      <p className={`display text-center text-base ${TONE[g.mode]}`}>
        {t("tag.results")}
      </p>
      <p className="meta mb-2 text-center text-xs text-soft">{t(g.end === "caught" ? "tag.end.caught" : g.end === "few" ? "tag.end.few" : "tag.end.time")}</p>
      <ol className="space-y-0.5">
        {rows.map((p) => (
          <li key={p.session_id} className={`flex justify-between gap-4 tabular-nums ${p.session_id === me.session_id ? "text-neon" : "text-cal"}`}>
            <span className="flex items-center gap-1 truncate">
              {(g.winners ?? []).includes(p.session_id) && <PeopleIcon name="star" className="h-3.5 w-3.5 text-ocre" />}
              {p.name}
              {p.player_no !== undefined ? <span className="meta ml-1 text-xs text-soft">#{p.player_no}</span> : null}
            </span>
            <span className="text-soft">{value(p)}</span>
          </li>
        ))}
      </ol>
      {g.end !== "few" && <p className={`display mt-2 text-center text-base ${won ? "text-neon" : "text-cal/80"}`}>{t(won ? "tag.won" : "tag.lost")}</p>}
      {won && <p className="meta text-center text-xs text-soft">{t(accountToken() ? "tag.point" : "tag.guest")}</p>}
    </div>
  );
}

export function TagHud() {
  const tg = useTag();
  useLang();
  useWorldVersion();
  const key = world.getEntitiesVersion();
  const lobbies = useMemo(() => lobbiesOf(world.entities.values()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, tick] = useState(0);
  // Se repinta 4 veces por segundo donde hay corros (los relojes, y si estás en uno: el cuerpo no avisa a React).
  useEffect(() => {
    if (!lobbies.length) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [lobbies.length]);
  if (!lobbies.length || world.solo) return null;
  const now = performance.now();
  const st = world.serverNow();
  const me = world.sessionId;
  const g = tg.shown && tagFresh(tg.shown, now) ? tg.shown : null;
  const mine = entryOf(g, me);
  const notice = g && tg.notice && now - tg.notice.at < NOTICE_MS ? noticeText(tg.notice, g) : null;
  let body: ReactNode = null;
  if (g && mine && g.state === "done") body = <Results g={g} me={mine} />;
  else if (g && mine && g.state === "running") body = <Running g={g} me={mine} outside={!insideMyArea(lobbies, g)} notice={notice} />;
  else if (g && playing(g, me) && g.state === "countdown") {
    const left = Math.max(0, Math.ceil(((g.go_at ?? st) - st) / 1000));
    body = (
      <>
        <div className={`display text-7xl tabular-nums drop-shadow-[0_0_18px_rgba(0,0,0,0.9)] ${TONE[g.mode]}`}>
          {left}
        </div>
        <div className={line}>{t("tag.hud.count", { n: g.players.length })}</div>
      </>
    );
  } else if (g && playing(g, me) && g.state === "open") {
    body = <div className={line}>{t("tag.hud.waiting", { n: g.players.length, min: g.min })}</div>;
  } else {
    // En un corro sin jugar aún: que se sepa qué es y cómo se entra (o que hay que esperar).
    const here = lobbies.find((l) => inLobby(l, self));
    if (here) {
      const busy = tg.games.get(here.id)?.state === "running";
      body = <div className={line}>{busy ? t("tag.hud.busy") : t("tag.hud.join", { game: t(here.mode === "tag" ? "tag.mode.tag" : "tag.mode.infection") })}</div>;
    }
  }
  if (!body) return null;
  return <div className="pointer-events-none absolute left-1/2 top-20 flex -translate-x-1/2 flex-col items-center gap-2">{body}</div>;
}
