import { useEffect, useState } from "react";
import { GITHUB_OWNER, REALTIME_URL } from "../config";
import { ACCENTS, SOLUTIONS } from "../content";

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

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "solutions", label: "Solutions", icon: "◇" },
  { id: "repos", label: "Repos", icon: "⌥" },
  { id: "agents", label: "Agents", icon: "◉" },
  { id: "customize", label: "Customize", icon: "✎" },
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
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

const card = "rounded-2xl border border-white/10 bg-white/[0.04]";

export function Panel(props: PanelProps) {
  const [section, setSection] = useState<Section>("solutions");
  const live = useLiveState();
  const repos = useRepos();

  return (
    <div className="pointer-events-auto absolute inset-0 flex items-end justify-center bg-[#0b0d1f]/40 backdrop-blur-md sm:items-center sm:p-6">
      <div className="flex h-[min(88dvh,720px)] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#11142b]/85 shadow-2xl sm:h-[min(80dvh,640px)] sm:flex-row sm:rounded-3xl">
        {/* Barra lateral (escritorio) */}
        <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-white/10 p-5 sm:flex">
          <Brand live={live} />
          <nav className="mt-6 flex flex-col gap-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  section === s.id ? "bg-violet-500/20 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span aria-hidden className="w-4 text-center text-violet-300">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto">
            <EnterButtons {...props} />
          </div>
        </aside>

        {/* Cabecera (móvil) */}
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:hidden">
          <Brand live={live} />
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
          {section === "solutions" && (
            <Block title="Solutions">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {SOLUTIONS.map((s) => (
                  <a key={s.title} href={s.href} className={`${card} block p-4 transition hover:border-white/20`}>
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${ACCENTS[s.accent]}`}>{s.tag}</span>
                    <h3 className="mt-3 font-medium text-white">{s.title}</h3>
                    <p className="mt-1 text-sm text-white/60">{s.summary}</p>
                  </a>
                ))}
              </div>
            </Block>
          )}

          {section === "repos" && (
            <Block title="Repos">
              {repos === null && <p className="text-sm text-white/50">Cargando…</p>}
              {repos?.length === 0 && (
                <p className="text-sm text-white/50">
                  Aún no hay repos públicos que mostrar en{" "}
                  <a className="text-cyan-300 underline" href={`https://github.com/${GITHUB_OWNER}`}>github.com/{GITHUB_OWNER}</a>.
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {repos?.map((r) => (
                  <li key={r.name}>
                    <a href={r.html_url} target="_blank" rel="noreferrer" className={`${card} flex items-center gap-4 p-4 transition hover:border-white/20`}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-white">{r.name}</p>
                        <p className="truncate text-sm text-white/55">{r.description ?? "Sin descripción"}</p>
                      </div>
                      <span className="shrink-0 text-xs text-white/50">{r.language ?? ""}</span>
                      <span className="shrink-0 text-xs text-amber-300">★ {r.stargazers_count}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {section === "agents" && (
            <Block title="Agents">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Online" value={live?.online} />
                <Stat label="Agentes" value={live?.agents_online} />
                <Stat label="Entidades" value={live?.entities} />
              </div>
              <h3 className="mt-6 text-sm font-medium text-white/70">Últimos cambios en la plaza</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {!live && <li className="text-sm text-white/50">Sin conexión con el mundo ahora mismo.</li>}
                {live?.recent_events.length === 0 && <li className="text-sm text-white/50">Nadie ha construido todavía. ¿Serás tú, o un agente?</li>}
                {live?.recent_events.map((e, i) => (
                  <li key={i} className={`${card} flex items-center gap-3 px-4 py-3 text-sm`}>
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-white">{e.actor.replace(/^agt_/, "agente ")}</span>
                    <span className="text-white/60">{e.op.toLowerCase()} {e.entity_id}</span>
                    <span className="ml-auto text-white/40">{ago(e.ts)}</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {section === "customize" && (
            <Block title="Customize">
              <label className="block text-sm text-white/70" htmlFor="name">Nombre visible</label>
              <input
                id="name"
                value={props.name}
                maxLength={32}
                onChange={(e) => props.setName(e.target.value)}
                className="mt-2 w-full max-w-sm rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-violet-400"
              />
              <p className="mt-6 text-sm text-white/70">Calidad gráfica</p>
              <div className="mt-2 inline-flex rounded-xl border border-white/10 p-1">
                {(["low", "high"] as const).map((q) => (
                  <button
                    key={q}
                    onClick={() => props.setQuality(q)}
                    className={`rounded-lg px-4 py-1.5 text-sm ${props.quality === q ? "bg-violet-500/30 text-white" : "text-white/60"}`}
                  >
                    {q === "low" ? "Ahorro" : "Alta"}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/40">Los cambios de nombre se aplican la próxima vez que entres.</p>
            </Block>
          )}
        </main>

        {/* Pie (móvil): botón principal + pestañas */}
        <div className="border-t border-white/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:hidden">
          <EnterButtons {...props} />
          <nav className="mt-3 grid grid-cols-4 gap-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] ${section === s.id ? "text-violet-300" : "text-white/50"}`}
              >
                <span aria-hidden className="text-base">{s.icon}</span>
                {s.label}
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
      <span className="text-xl font-semibold tracking-tight text-white">xenxo<span className="text-cyan-300">.io</span></span>
      <span className="flex items-center gap-1.5 text-xs text-white/60" title="Personas y agentes en la plaza">
        <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-400" : "bg-white/30"}`} />
        {live ? live.online : "–"}
      </span>
    </div>
  );
}

function EnterButtons({ onEnter, onEnterVR }: PanelProps) {
  return (
    <div className="flex flex-col gap-2">
      <button onClick={onEnter} className="w-full rounded-xl bg-violet-500 px-4 py-3 font-medium text-white transition hover:bg-violet-400">
        Enter world
      </button>
      {onEnterVR && (
        <button onClick={onEnterVR} className="w-full rounded-xl border border-cyan-300/30 px-4 py-2.5 text-sm text-cyan-200 hover:bg-cyan-300/10">
          Entrar en VR
        </button>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-medium text-white">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className={`${card} p-4`}>
      <p className="text-2xl font-semibold text-white">{value ?? "–"}</p>
      <p className="text-xs text-white/50">{label}</p>
    </div>
  );
}
