import { useEffect, useState } from "react";
import { REALTIME_URL } from "../config";
import { ACCENTS, SOLUTIONS } from "../content";
import { LANGS, legalPath, setLang, t, useLang, type Key } from "../i18n";
import { CustomizeSection, type CustomizeProps } from "./Account";
import { ProjectsSection } from "./Projects";
import { Block, card, Stat } from "./ui";

type Section = "solutions" | "projects" | "agents" | "customize";

interface LiveState {
  online: number;
  agents_online: number;
  entities: number;
  recent_events: { ts: number; actor: string; op: string; entity_id: string }[];
}

const SECTIONS: { id: Section; label: Key; icon: string }[] = [
  { id: "solutions", label: "nav.solutions", icon: "◇" },
  { id: "projects", label: "nav.projects", icon: "⌥" },
  { id: "agents", label: "nav.agents", icon: "◉" },
  { id: "customize", label: "nav.customize", icon: "✎" },
];

export interface PanelProps extends CustomizeProps {
  onEnter: () => void;
  onEnterVR: (() => void) | null;
}

function useLiveState() {
  const [state, setState] = useState<LiveState | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(new URL("/chunk/c_0_0/state", REALTIME_URL))
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => alive && setState(s as LiveState | null))
        .catch(() => alive && setState(null));
    load();
    const id = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return state;
}

function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return t("ago.s", { n: s });
  if (s < 3600) return t("ago.m", { n: Math.round(s / 60) });
  if (s < 86400) return t("ago.h", { n: Math.round(s / 3600) });
  return t("ago.d", { n: Math.round(s / 86400) });
}

export function Panel(props: PanelProps) {
  const [section, setSection] = useState<Section>("solutions");
  const lang = useLang();
  const live = useLiveState();

  return (
    <div className="pointer-events-auto absolute inset-0 flex items-end justify-center bg-noche/30 backdrop-blur-md sm:items-center sm:p-6">
      <div className="flex h-[min(90dvh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-cal/10 bg-noche/85 shadow-2xl sm:h-[min(84dvh,700px)] sm:flex-row sm:rounded-3xl">
        {/* Barra lateral (escritorio) */}
        <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-cal/10 p-5 sm:flex">
          <Brand live={live} />
          <nav className="mt-6 flex flex-col gap-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  section === s.id ? "bg-terracota/25 text-cal" : "text-cal/60 hover:bg-cal/5 hover:text-cal"
                }`}
              >
                <span aria-hidden className="w-4 text-center text-terracota-claro">{s.icon}</span>
                {t(s.label)}
              </button>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-3">
            <LangSwitch />
            <EnterButtons {...props} />
            <LegalLinks />
          </div>
        </aside>

        {/* Cabecera (móvil) */}
        <header className="flex items-center justify-between gap-3 border-b border-cal/10 px-5 py-4 sm:hidden">
          <Brand live={live} />
          <LangSwitch />
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
          {section === "solutions" && (
            <Block title={t("nav.solutions")}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {SOLUTIONS.map((s) => (
                  <a key={s.tag.en} href={s.href} className={`${card} block p-4 transition hover:border-cal/25`}>
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${ACCENTS[s.accent]}`}>{s.tag[lang]}</span>
                    <h3 className="mt-3 font-medium text-cal">{s.title[lang]}</h3>
                    <p className="mt-1 text-sm text-cal/60">{s.summary[lang]}</p>
                  </a>
                ))}
              </div>
            </Block>
          )}

          {section === "projects" && <ProjectsSection onGoToAccount={() => setSection("customize")} />}

          {section === "agents" && (
            <Block title={t("nav.agents")}>
              <div className="grid grid-cols-3 gap-3">
                <Stat label={t("agents.online")} value={live?.online} />
                <Stat label={t("agents.agents")} value={live?.agents_online} />
                <Stat label={t("agents.entities")} value={live?.entities} />
              </div>
              <h3 className="mt-6 text-sm font-medium text-cal/70">{t("agents.recent")}</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {!live && <li className="text-sm text-cal/50">{t("agents.offline")}</li>}
                {live?.recent_events.length === 0 && <li className="text-sm text-cal/50">{t("agents.none")}</li>}
                {live?.recent_events.map((e, i) => (
                  <li key={i} className={`${card} flex items-center gap-3 px-4 py-3 text-sm`}>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-huerta" />
                    <span className="truncate text-cal">
                      {e.actor.startsWith("agt_") ? e.actor.replace(/^agt_/, `${t("agents.agentPrefix")} `) : e.actor.startsWith("usr_") ? "👤" : e.actor}
                    </span>
                    <span className="truncate text-cal/60">{e.op.toLowerCase()} {e.entity_id}</span>
                    <span className="ml-auto shrink-0 text-cal/40">{ago(e.ts)}</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {section === "customize" && <CustomizeSection {...props} />}

          <div className="mt-8 sm:hidden">
            <LegalLinks />
          </div>
        </main>

        {/* Pie (móvil): botón principal + pestañas */}
        <div className="border-t border-cal/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:hidden">
          <EnterButtons {...props} />
          <nav className="mt-3 grid grid-cols-4 gap-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] ${section === s.id ? "text-terracota-claro" : "text-cal/50"}`}
              >
                <span aria-hidden className="text-base">{s.icon}</span>
                {t(s.label)}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

function Brand({ live }: { live: LiveState | null }) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <span className="text-xl font-semibold tracking-tight text-cal">xenxo<span className="text-terracota-claro">.io</span></span>
      <span className="flex items-center gap-1.5 text-xs text-cal/60" title={t("online.title")}>
        <span className={`h-2 w-2 rounded-full ${live ? "bg-huerta" : "bg-cal/30"}`} />
        {live ? live.online : "–"}
      </span>
    </div>
  );
}

function LangSwitch() {
  const lang = useLang();
  return (
    <div className="flex w-fit shrink-0 rounded-lg border border-cal/10 p-0.5 text-xs" role="group" aria-label={t("customize.language")}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          onClick={() => setLang(l.id)}
          aria-pressed={lang === l.id}
          className={`rounded-md px-2 py-1 uppercase ${lang === l.id ? "bg-cal/15 text-cal" : "text-cal/50"}`}
        >
          {l.id}
        </button>
      ))}
    </div>
  );
}

function LegalLinks() {
  return (
    <p className="flex gap-3 text-xs text-cal/40">
      <a href={legalPath("privacy")} target="_blank" rel="noreferrer" className="hover:text-cal/70">
        {t("legal.privacy")}
      </a>
      <a href={legalPath("terms")} target="_blank" rel="noreferrer" className="hover:text-cal/70">
        {t("legal.terms")}
      </a>
    </p>
  );
}

function EnterButtons({ onEnter, onEnterVR }: PanelProps) {
  return (
    <div className="flex flex-col gap-2">
      <button onClick={onEnter} className="w-full rounded-xl bg-terracota px-4 py-3 font-medium text-cal transition hover:bg-terracota-claro">
        {t("enter.world")}
      </button>
      {onEnterVR && (
        <button onClick={onEnterVR} className="w-full rounded-xl border border-azulejo-claro/40 px-4 py-2.5 text-sm text-azulejo-claro hover:bg-azulejo/20">
          {t("enter.vr")}
        </button>
      )}
    </div>
  );
}
