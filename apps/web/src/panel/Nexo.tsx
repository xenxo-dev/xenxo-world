import { useEffect, useState } from "react";
import { PLACES, PORTAL_ZONE_DEPTH, PROJECT_CATEGORIES, TransformV1 } from "@xenxo/protocol";
import { assetUrl } from "../config";
import { t, useLang, type Key } from "../i18n";
import { refreshProjects, useProjects } from "../net/projects";
import { teleport, travel } from "../net/session";
import { world } from "../net/world-store";
import { categoryColor } from "../world/portals-state";
import { Block, card } from "./ui";

/** Portales del nexo para proyectos (24 en el anillo menos el de la plaza). */
const PROJECT_PORTALS = 23;

/**
 * Viaja al nexo y aparece delante del portal de un proyecto, mirándolo.
 * Si el nexo aún no ha llegado, espera a que llegue su foto (como mucho unos segundos).
 */
function goToPortal(projectId: string) {
  travel(PLACES.nexo);
  const id = `stand_${projectId}`;
  const place = () => {
    const e = world.entities.get(id);
    const tr = e && TransformV1.safeParse(e.components["transform@1"]);
    if (!tr?.success) return false;
    const [qx, qy, qz, qw] = tr.data.r;
    const yaw = Math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qy * qy + qx * qx));
    const d = PORTAL_ZONE_DEPTH + 1.2; // delante del portal, justo fuera de su franja: un paso y se abre la ficha
    teleport([tr.data.p[0] + Math.sin(yaw) * d, 0, tr.data.p[2] + Math.cos(yaw) * d], (yaw * 180) / Math.PI);
    return true;
  };
  if (place()) return;
  const stop = world.subscribe(() => {
    if (place()) stop();
  });
  setTimeout(stop, 8000);
}

export function NexoSection({ onEnter }: { onEnter: () => void }) {
  useLang();
  const projects = useProjects();
  const [filter, setFilter] = useState<string>("all");
  useEffect(() => {
    void refreshProjects(true);
  }, []);
  const shown = (projects ?? []).filter((p) => filter === "all" || p.category === filter);
  const used = new Set((projects ?? []).map((p) => p.category));

  return (
    <>
      <Block title={t("nav.nexo")}>
        <p className="-mt-2 mb-5 max-w-prose text-[15px] leading-relaxed text-cal/65">{t("nexo.intro")}</p>
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-cal/50">{t("nexo.districts")}</h3>
        <div className={`${card} overflow-hidden sm:flex`}>
          <img src="/covers/plaza.webp" alt="" className="aspect-video w-full object-cover sm:w-64" />
          <div className="flex flex-1 flex-col gap-2 p-4">
            <Chip category="district" />
            <p className="display text-lg font-semibold text-cal">{t("nexo.plaza")}</p>
            <p className="text-sm leading-relaxed text-cal/65">{t("nexo.plazaDesc")}</p>
            <div className="mt-auto pt-2">
              <BigButton
                onClick={() => {
                  travel(PLACES.plaza, [32, 0, 43], 0);
                  onEnter();
                }}
              >
                {t("nexo.go")} →
              </BigButton>
            </div>
          </div>
        </div>
      </Block>

      <Block title={t("nexo.projects")} aside={projects && <span className="text-xs text-cal/45">{t("nexo.free", { n: Math.max(0, PROJECT_PORTALS - projects.length) })}</span>}>
        {projects && projects.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t("projects.category")}>
            {["all", ...PROJECT_CATEGORIES.filter((c) => used.has(c))].map((c) => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                aria-pressed={filter === c}
                className={`rounded-full border px-3 py-1.5 text-sm ${filter === c ? "border-neon bg-neon/15 text-cal" : "border-cal/15 text-cal/60 hover:text-cal"}`}
              >
                {c === "all" ? t("nexo.all") : t(`cat.${c}` as Key)}
              </button>
            ))}
          </div>
        )}
        {projects === null && <p className="text-sm text-cal/50">{t("repos.loading")}</p>}
        {projects?.length === 0 && <p className="text-sm text-cal/50">{t("nexo.empty")}</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((p) => (
            <li key={p.id} className={`${card} flex flex-col overflow-hidden`}>
              {p.cover_hash ? (
                <img src={assetUrl(p.cover_hash)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
              ) : (
                <div className="aspect-video w-full bg-gradient-to-br from-noche-2 to-noche" />
              )}
              <div className="flex flex-1 flex-col gap-1.5 p-4">
                <Chip category={p.category} />
                <p className="display text-[17px] font-semibold text-cal">{p.title}</p>
                <p className="text-xs text-cal/50">{t("projects.by", { name: p.author })}</p>
                {p.summary && <p className="line-clamp-3 text-sm leading-relaxed text-cal/65">{p.summary}</p>}
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  {p.url && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer noopener nofollow ugc"
                      className="flex-1 rounded-xl bg-neon px-4 py-3 text-center text-base font-medium text-noche hover:bg-neon-suave"
                    >
                      {t("portal.open")} ↗
                    </a>
                  )}
                  {p.in_world && (
                    <button
                      onClick={() => {
                        goToPortal(p.id);
                        onEnter();
                      }}
                      className="flex-1 rounded-xl border border-cal/15 px-4 py-3 text-base text-cal/85 hover:bg-cal/5"
                    >
                      {t("nexo.seePortal")}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Block>
    </>
  );
}

function Chip({ category }: { category: string }) {
  const c = categoryColor(category);
  return (
    <span className="w-fit rounded-md border px-2 py-0.5 text-xs" style={{ borderColor: `${c}66`, color: c }}>
      {t(`cat.${category}` as Key)}
    </span>
  );
}

function BigButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-xl bg-neon px-5 py-3 text-base font-medium text-noche hover:bg-neon-suave">
      {children}
    </button>
  );
}
