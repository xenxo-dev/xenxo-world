import { useEffect, useState } from "react";
import { GITHUB_OWNER, REALTIME_URL } from "../config";
import { ACCENTS, SOLUTIONS } from "../content";
import { LANGS, setLang, t, useLang, type Key } from "../i18n";

type Section = "solutions" | "repos" | "agents" | "customize";

interface Repo {
  name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  fork: boolean;
}

interface LiveState {
  online: number;
  agents_online: number;
  entities: number;
  recent_events: { ts: number; actor: string; op: string; entity_id: string }[];
}

const SECTIONS: { id: Section; label: Key; icon: string }[] = [
  { id: "solutions", label: "nav.solutions", icon: "◇" },
  { id: "repos", label: "nav.repos", icon: "⌥" },
  { id: "agents", label: "nav.agents", icon: "◉" },
  { id: "customize", label: "nav.customize", icon: "✎" },
];

export interface PanelProps {
  onEnter: () => void;
  onEnterVR: (() => void) | null;
  name: string;
  setName: (n: string) => void;
  quality: "low" | "high";
  setQuality: (q: "low" | "high") => void;
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

function useRepos() {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  useEffect(() => {
    fetch(`https://api.github.com/users/${GITHUB_OWNER}/repos?sort=updated&per_page=12`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Repo[]) => setRepos(list.filter((r) => !r.fork)))
      .catch(() => setRepos([]));
  }, []);
  return repos;
}

function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return t("ago.s", { n: s });
  if (s < 3600) return t("ago.m", { n: Math.round(s / 60) });
  if (s < 86400) return t("ago.h", { n: Math.round(s / 3600) });
  return t("ago.d", { n: Math.round(s / 86400) });
}

const card = "rounded-2xl border border-cal/10 bg-cal/[0.04]";

export function Panel(props: PanelProps) {
  const [section, setSection] = useState<Section>("solutions");
  const lang = useLang();
  const live = useLiveState();
  const repos = useRepos();

  return (
    <div className="pointer-events-auto absolute inset-0 flex items-end justify-center bg-noche/30 backdrop-blur-md sm:items-center sm:p-6">
      <div className="flex h-[min(88dvh,720px)] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-cal/10 bg-noche/85 shadow-2xl sm:h-[min(80dvh,640px)] sm:flex-row sm:rounded-3xl">
        {/* Barra lateral (escritorio) */}
        <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-cal/10 p-5 sm:flex">
          <Brand live={live} />
          <nav className="mt-6 flex flex-col gap-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
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

          {section === "repos" && (
            <Block title={t("nav.repos")}>
              {repos === null && <p className="text-sm text-cal/50">{t("repos.loading")}</p>}
              {repos?.length === 0 && (
                <p className="text-sm text-cal/50">
                  {t("repos.empty")}{" "}
                  <a className="text-azulejo-claro underline" href={`https://github.com/${GITHUB_OWNER}`}>github.com/{GITHUB_OWNER}</a>.
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {repos?.map((r) => (
                  <li key={r.name}>
                    <a href={r.html_url} target="_blank" rel="noreferrer" className={`${card} flex items-center gap-4 p-4 transition hover:border-cal/25`}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-cal">{r.name}</p>
                        <p className="truncate text-sm text-cal/55">{r.description ?? t("repos.noDescription")}</p>
                      </div>
                      <span className="shrink-0 text-xs text-cal/50">{r.language ?? ""}</span>
                      <span className="shrink-0 text-xs text-ocre">★ {r.stargazers_count}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Block>
          )}

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
                    <span className="text-cal">{e.actor.replace(/^agt_/, `${t("agents.agentPrefix")} `)}</span>
                    <span className="truncate text-cal/60">{e.op.toLowerCase()} {e.entity_id}</span>
                    <span className="ml-auto shrink-0 text-cal/40">{ago(e.ts)}</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {section === "customize" && (
            <Block title={t("nav.customize")}>
              <label className="block text-sm text-cal/70" htmlFor="name">{t("customize.name")}</label>
              <input
                id="name"
                value={props.name}
                maxLength={32}
                onChange={(e) => props.setName(e.target.value)}
                className="mt-2 w-full max-w-sm rounded-xl border border-cal/10 bg-cal/5 px-3 py-2 text-cal outline-none focus:border-terracota"
              />
              <p className="mt-2 text-xs text-cal/40">{t("customize.nameNote")}</p>

              <p className="mt-6 text-sm text-cal/70">{t("customize.quality")}</p>
              <Segmented
                value={props.quality}
                onChange={props.setQuality}
                options={[
                  { id: "low", label: t("customize.low") },
                  { id: "high", label: t("customize.high") },
                ]}
              />

              <p className="mt-6 text-sm text-cal/70">{t("customize.language")}</p>
              <Segmented value={lang} onChange={setLang} options={LANGS} />
            </Block>
          )}
        </main>

        {/* Pie (móvil): botón principal + pestañas */}
        <div className="border-t border-cal/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:hidden">
          <EnterButtons {...props} />
          <nav className="mt-3 grid grid-cols-4 gap-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
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
    <div className="flex shrink-0 rounded-lg border border-cal/10 p-0.5 text-xs" role="group" aria-label={t("customize.language")}>
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

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div className="mt-2 inline-flex rounded-xl border border-cal/10 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-lg px-4 py-1.5 text-sm ${value === o.id ? "bg-terracota/30 text-cal" : "text-cal/60"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-medium text-cal">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className={`${card} p-4`}>
      <p className="text-2xl font-semibold text-cal">{value ?? "–"}</p>
      <p className="text-xs text-cal/50">{label}</p>
    </div>
  );
}
