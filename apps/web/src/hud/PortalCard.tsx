import { useEffect, useState } from "react";
import { assetUrl } from "../config";
import { getLang, placeName, t, useLang, type Key } from "../i18n";
import { usePlace } from "../net/world-store";
import { districtOf } from "../net/districts";
import { projectById, refreshProjects, useProjects } from "../net/projects";
import { ReportButton } from "../panel/ReportButton";
import { categoryColor, usePortalHud } from "../world/portals-state";

const box = "rounded-2xl border border-cal/10 bg-noche/85 backdrop-blur";

/**
 * Ficha del proyecto delante de cuyo portal estás: portada, autor, descripción y el enlace.
 * El enlace sale del Directory (no del portal) y solo se abre si la persona pulsa.
 */
export function PortalCard() {
  useLang();
  const hud = usePortalHud();
  useProjects();
  const card = hud.card;
  useEffect(() => {
    if (card) void refreshProjects();
  }, [card]);
  if (!card) return null;
  const p = projectById(card.projectId);
  const cover = card.cover ?? p?.cover_hash ?? null;
  const cat = p?.category ?? card.category ?? "other";
  const d = districtOf(p?.district);
  const chipColor = d?.color ?? categoryColor(cat);
  const chipText = d ? `${d.name[getLang()] ?? d.name.en} · ${p?.parcel}` : t(`cat.${cat}` as Key);
  return (
    <div
      role="dialog"
      aria-label={p?.title ?? card.title}
      className={`pointer-events-auto absolute left-1/2 top-[max(4.5rem,env(safe-area-inset-top))] w-[min(92vw,420px)] -translate-x-1/2 overflow-hidden ${box}`}
    >
      {cover && <img src={assetUrl(cover)} alt="" className="aspect-video w-full object-cover" />}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <span
              className="mb-1 inline-block rounded-md border px-2 py-0.5 text-xs"
              style={{ borderColor: `${chipColor}66`, color: chipColor }}
            >
              {chipText}
            </span>
            <p className="display truncate text-lg font-semibold text-cal">{p?.title ?? card.title}</p>
            {p && <p className="text-xs text-cal/50">{t("projects.by", { name: p.author })}</p>}
          </div>
          <button onClick={() => hud.close()} className="text-cal/50 hover:text-cal" aria-label={t("portal.close")}>
            ✕
          </button>
        </div>
        {p?.summary && <p className="mt-2 text-sm leading-relaxed text-cal/70">{p.summary}</p>}
        {p?.url && (
          <>
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer noopener nofollow ugc"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-neon px-4 py-3 text-base font-medium text-noche hover:bg-neon-suave"
            >
              {t("portal.open")} ↗
            </a>
            <p className="mt-2 text-center text-xs text-cal/45">{t("portal.external")}</p>
          </>
        )}
        <div className="mt-3 flex justify-end">
          <ReportButton targetType="project" targetId={card.projectId} />
        </div>
      </div>
    </div>
  );
}

/** Aviso breve al cruzar un portal hacia otro lugar. */
export function TravelToast() {
  const hud = usePortalHud();
  const place = usePlace();
  const [, tick] = useState(0);
  const tr = hud.travelling;
  useEffect(() => {
    if (!tr) return;
    const id = setTimeout(() => tick((n) => n + 1), 2200);
    return () => clearTimeout(id);
  }, [tr]);
  if (!tr || Date.now() - tr.at > 2000) return null;
  const name = tr.title || placeName(place);
  return (
    <div className={`pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 px-5 py-3 text-lg text-cal ${box}`}>
      {t("hud.travel", { place: name })}
    </div>
  );
}
