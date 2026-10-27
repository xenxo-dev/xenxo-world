/**
 * Marcadores de los distritos en el panel: lo mismo que se ve en las plazas (puntos del día y de la
 * semana, carreras, búsquedas y lo que construyen los agentes), sin tener que entrar.
 */
import { useState } from "react";
import { t, useLang } from "../i18n";
import { boardTitle, scoreValue, useScores } from "../net/scores";
import { Block, card } from "./ui";

export function ScoresBlock() {
  const lang = useLang();
  const data = useScores();
  const [open, setOpen] = useState<string | null>(null);
  if (data === null) return null;
  return (
    <Block title={t("scores.title")}>
      <p className="-mt-2 mb-5 max-w-prose text-[15px] leading-relaxed text-soft">{t("scores.intro")}</p>
      {data === "error" && <p className="text-sm text-muted">{t("scores.offline")}</p>}
      {data !== "error" && (
        <div className="flex flex-col gap-4">
          {data.map((d) => {
            const shown = open === d.id ? d.boards : d.boards.slice(0, 2);
            return (
              <section key={d.id} className={`${card} p-4`}>
                <h3 className="display mb-3 flex items-center gap-2 text-[15px] font-semibold text-cal">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                  {d.name[lang] ?? d.name.en}
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {shown.map((b) => (
                    <div key={b.entity_id}>
                      <p className="meta mb-1.5 text-xs uppercase tracking-[0.12em] text-muted">{b.title?.[lang] ?? b.title?.en ?? boardTitle(b.kind, b.period)}</p>
                      {b.rows.length === 0 ? (
                        <p className="text-sm text-cal/45">{t("scores.empty")}</p>
                      ) : (
                        <ol className="flex flex-col gap-1 text-sm">
                          {b.rows.slice(0, 5).map((r, i) => (
                            <li key={i} className="flex items-baseline gap-2">
                              <span className="meta w-5 shrink-0 text-cal/45">{i + 1}</span>
                              <span className="truncate text-cal">
                                {r.name}
                                {r.player_no !== undefined && <span className="meta ml-1 text-xs text-muted">#{r.player_no}</span>}
                              </span>
                              <span className="meta ml-auto shrink-0 text-xs text-soft">{scoreValue(b.kind, r.value, r.ts)}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  ))}
                </div>
                {d.boards.length > 2 && (
                  <button className="btn-ghost mt-3 rounded-lg px-3 py-1 text-xs" onClick={() => setOpen(open === d.id ? null : d.id)}>
                    {open === d.id ? t("scores.less") : t("scores.more", { n: d.boards.length - 2 })}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Block>
  );
}
