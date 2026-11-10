import { useEffect } from "react";
import { SOURCE_URL } from "../content";
import { issueUrl } from "../errors";
import { loadBoot, useBoot, type LiveState } from "../net/boot";
import { world } from "../net/world-store";
import { LANGS, legalPath, setLang, t, useLang, type Key } from "../i18n";
import { AccountSection, CustomizeSection, type CustomizeProps } from "./Account";
import { CreateSection } from "./Create";
import { CapacityBanner } from "../hud/Capacity";
import { NexoSection } from "./Nexo";
import { ProjectsSection } from "./Projects";
import { Block, card, Stat } from "./ui";

export type Section = "nexo" | "create" | "projects" | "agents" | "account" | "customize";

const SECTIONS: { id: Section; label: Key; icon: string }[] = [
  { id: "nexo", label: "nav.nexo", icon: "◎" },
  { id: "create", label: "nav.create", icon: "◇" },
  { id: "projects", label: "nav.projects", icon: "⌥" },
  { id: "agents", label: "nav.agents", icon: "◉" },
  { id: "account", label: "nav.account", icon: "◈" },
  { id: "customize", label: "nav.customize", icon: "✎" },
];

export interface PanelProps extends CustomizeProps {
  section: Section;
  onSection: (s: Section) => void;
  onEnter: () => void;
  onEnterVR: (() => void) | null;
}

/**
 * Cuánta gente hay en el mundo (el nexo y la plaza juntos) y qué ha cambiado: llega con el arranque
 * (GET /boot), que el panel vuelve a pedir cada minuto mientras está a la vista. Es una petición del
 * plan gratuito por minuto y panel abierto; dentro del mundo (sin panel) no se pide nada.
 */
function useLiveState(): LiveState | null {
  const boot = useBoot();
  useEffect(() => {
    void loadBoot();
    const id = setInterval(() => {
      if (!document.hidden) void loadBoot(30_000);
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  return boot?.live ?? null;
}

function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return t("ago.s", { n: s });
  if (s < 3600) return t("ago.m", { n: Math.round(s / 60) });
  if (s < 86400) return t("ago.h", { n: Math.round(s / 3600) });
  return t("ago.d", { n: Math.round(s / 86400) });
}

export function Panel(props: PanelProps) {
  const { section, onSection: setSection } = props;
  useLang();
  const live = useLiveState();

  return (
    <div className="pointer-events-auto absolute inset-0 flex items-end justify-center bg-gradient-to-t from-noche/70 via-noche/20 to-transparent sm:items-center sm:p-6 lg:justify-start lg:pl-[5vw]">
      <div className="flex h-[min(90dvh,760px)] w-full max-w-5xl flex-col lg:max-w-[880px] overflow-hidden rounded-t-[28px] border border-neon-suave/15 bg-noche/80 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.7)] backdrop-blur-xl sm:h-[min(84dvh,700px)] sm:flex-row sm:rounded-[28px]">
        {/* Barra lateral (escritorio) */}
        <aside className="azulejo hidden w-60 shrink-0 flex-col gap-1 border-r border-neon-suave/10 bg-noche-2/60 p-6 sm:flex">
          <Brand live={live} />
          <nav className="mt-6 flex flex-col gap-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? "page" : undefined}
                className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] transition ${
                  section === s.id
                    ? "bg-neon/10 text-cal before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-neon before:shadow-[0_0_10px_var(--color-neon)]"
                    : "text-soft/80 hover:bg-cal/5 hover:text-cal"
                }`}
              >
                <span aria-hidden className={`w-4 text-center ${section === s.id ? "text-neon" : "text-muted"}`}>{s.icon}</span>
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
          <CapacityBanner />
          {section === "nexo" && <NexoSection onEnter={props.onEnter} onCreate={() => setSection("create")} />}
          {section === "create" && <CreateSection onProjects={() => setSection("projects")} />}

          {section === "projects" && <ProjectsSection onGoToAccount={() => setSection("account")} />}

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

          {section === "account" && <AccountSection {...props} />}
          {section === "customize" && <CustomizeSection />}

          <div className="mt-8 sm:hidden">
            <LegalLinks />
          </div>
        </main>

        {/* Pie (móvil): botón principal + pestañas */}
        <div className="border-t border-cal/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:hidden">
          <EnterButtons {...props} />
          <nav className="mt-3 grid grid-cols-6 gap-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] ${section === s.id ? "text-neon" : "text-muted"}`}
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
      <span className="display neon-sign text-[26px] font-bold leading-none" translate="no">
        xenxo<span className="dot">.io</span>
      </span>
      <span className="meta flex items-center gap-1.5 text-xs text-soft" title={t("online.title")}>
        <span className={`h-2 w-2 rounded-full ${live ? "bg-[#6dff8a] shadow-[0_0_8px_#6dff8a]" : "bg-cal/30"}`} />
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
  const lang = useLang();
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      <a href={legalPath("privacy")} target="_blank" rel="noreferrer" className="hover:text-cal/70">
        {t("legal.privacy")}
      </a>
      <a href={legalPath("terms")} target="_blank" rel="noreferrer" className="hover:text-cal/70">
        {t("legal.terms")}
      </a>
      {/* Guía para desarrolladores: desplegar xenxo en local, en Cloudflare o en un servidor propio. */}
      <a href={lang === "en" ? "/docs/en/" : "/docs/"} target="_blank" rel="noreferrer" className="hover:text-cal/70">
        {t("legal.docs")}
      </a>
      {/* AGPL §13: quien usa xenxo por la red puede llegar a su código. */}
      <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="hover:text-cal/70">
        {t("legal.source")}
      </a>
      {/* Atribución de lo que no es CC0 (el coche, CC BY 4.0) y del resto de recursos. */}
      <a href={`${SOURCE_URL}/blob/main/CREDITS.md`} target="_blank" rel="noreferrer" className="hover:text-cal/70">
        {t("legal.credits")}
      </a>
      {/* Sin telemetría: quien ve un fallo lo cuenta en una issue ya rellenada (errors.ts). */}
      <a
        href={issueUrl({ lugar: world.chunkId })}
        // La dirección se rehace al pulsar: lleva los errores que haya habido hasta ese momento.
        onClick={(e) => (e.currentTarget.href = issueUrl({ lugar: world.chunkId }))}
        target="_blank"
        rel="noreferrer"
        title={t("report.note")}
        className="hover:text-cal/70"
      >
        {t("report.problem")}
      </a>
    </p>
  );
}

function EnterButtons({ onEnter, onEnterVR }: PanelProps) {
  return (
    <div className="flex flex-col gap-2">
      <button onClick={onEnter} className="neon-tube display w-full rounded-full px-4 py-3 text-[15px] font-semibold">
        {t("enter.world")}
      </button>
      {onEnterVR && (
        <button onClick={onEnterVR} className="w-full rounded-full border border-cal/15 px-4 py-2.5 text-sm text-cal/80 hover:border-neon-suave/50 hover:text-cal">
          {t("enter.vr")}
        </button>
      )}
    </div>
  );
}
