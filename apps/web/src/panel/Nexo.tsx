import { useEffect, useState } from "react";
import { PLACES } from "@xenxo/protocol";
import { assetUrl } from "../config";
import { t, useLang, type Key } from "../i18n";
import { DISTRICT_SPAWN, districtOf, parcelArrival, refreshDistricts, useDistricts, type DistrictInfo } from "../net/districts";
import { avatarMode } from "../net/account";
import { refreshProjects, useProjects } from "../net/projects";
import { travel } from "../net/session";
import { fitsHere, visitorDevice } from "../games/device";
import { gameName, openGame } from "../games/state";
import { JamBlock } from "./Jam";
import { Block, card } from "./ui";

/** Viaja al distrito de un proyecto y aparece delante de su portal, mirándolo. */
function goToParcel(districtId: string | null, parcelId: string | null): boolean {
  const d = districtOf(districtId);
  const q = d?.parcels.find((p) => p.id === parcelId);
  if (!d || !q) return false;
  const a = parcelArrival(q);
  travel(d.chunk_id, a.p, a.yaw);
  return true;
}

export function NexoSection({ onEnter }: { onEnter: () => void }) {
  const lang = useLang();
  const projects = useProjects();
  const districts = useDistricts();
  const [filter, setFilter] = useState<string>("all");
  useEffect(() => {
    void refreshProjects(true);
    void refreshDistricts(true);
  }, []);
  const shown = (projects ?? []).filter((p) => filter === "all" || p.district === filter);
  const name = (d: DistrictInfo) => d.name[lang] ?? d.name.en!;

  return (
    <>
      <JamBlock />
      <Block title={t("nav.nexo")}>
        <p className="-mt-2 mb-5 max-w-prose text-[15px] leading-relaxed text-cal/65">{t("nexo.intro")}</p>
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-cal/50">{t("nexo.districts")}</h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          <DistrictCard
            cover="/covers/plaza.webp"
            color="#ff9e52"
            title={t("nexo.plaza")}
            desc={t("nexo.plazaDesc")}
            onGo={() => {
              travel(PLACES.plaza, [32, 0, 43], 0);
              onEnter();
            }}
          />
          {districts?.map((d) => (
            <DistrictCard
              key={d.id}
              cover={`/covers/${d.id}.webp`}
              color={d.color}
              title={name(d)}
              desc={d.desc[lang] ?? d.desc.en!}
              free={d.parcels.filter((q) => !q.project_id).length}
              onGo={() => {
                travel(d.chunk_id, DISTRICT_SPAWN, 0);
                onEnter();
              }}
            />
          ))}
        </ul>
      </Block>

      <Block title={t("nexo.projects")}>
        {projects && projects.length > 0 && districts && (
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t("projects.district")}>
            {[{ id: "all", label: t("nexo.all"), color: "" }, ...districts.map((d) => ({ id: d.id, label: name(d), color: d.color }))].map((c) => (
              <button
                key={c.id}
                onClick={() => setFilter(c.id)}
                aria-pressed={filter === c.id}
                className={`rounded-full border px-3 py-1.5 text-sm ${filter === c.id ? "border-neon bg-neon/15 text-cal" : "border-cal/15 text-cal/60 hover:text-cal"}`}
                style={filter === c.id && c.color ? { borderColor: c.color } : undefined}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {projects === null && <p className="text-sm text-cal/50">{t("repos.loading")}</p>}
        {projects?.length === 0 && <p className="text-sm text-cal/50">{t("nexo.empty")}</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((p) => {
            const d = districtOf(p.district);
            return (
              <li key={p.id} className={`${card} flex flex-col overflow-hidden`}>
                {p.cover_hash ? (
                  <img src={assetUrl(p.cover_hash)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                ) : (
                  <div className="aspect-video w-full bg-gradient-to-br from-noche-2 to-noche" />
                )}
                <div className="flex flex-1 flex-col gap-1.5 p-4">
                  {d && (
                    <span className="w-fit rounded-md border px-2 py-0.5 text-xs" style={{ borderColor: `${d.color}66`, color: d.color }}>
                      {name(d)} · {p.parcel}
                    </span>
                  )}
                  <p className="display text-[17px] font-semibold text-cal">{gameName(p, lang)}</p>
                  <p className="text-xs text-cal/50">{t("projects.by", { name: p.author })}</p>
                  {p.summary && <p className="line-clamp-3 text-sm leading-relaxed text-cal/65">{p.summary}</p>}
                  {p.game && (
                    <p className="text-xs text-cal/45">{t("gate.devices", { list: p.game.devices.map((d) => t(`gate.device.${d}` as Key)).join(" · ") })}</p>
                  )}
                  {p.game && avatarMode(p.game) === "character" && (
                    <span className="w-fit rounded-md border border-neon/40 px-2 py-0.5 text-xs text-sky-100">{t("gate.avatar.character")}</span>
                  )}
                  <div className="mt-auto flex flex-wrap gap-2 pt-3">
                    {p.game &&
                      (fitsHere(p.game.devices) ? (
                        <button
                          onClick={() => openGame(p)}
                          className="flex-1 rounded-xl bg-neon px-4 py-3 text-center text-base font-medium text-noche hover:bg-neon-suave"
                        >
                          {t("portal.play")}
                        </button>
                      ) : (
                        <p className="flex-1 rounded-xl border border-cal/10 px-4 py-3 text-center text-sm text-cal/55">
                          {t("gate.unavailable", { device: t(`gate.device.${visitorDevice()}` as Key) })}
                        </p>
                      ))}
                    {p.url && !p.game && (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer noopener nofollow ugc"
                        className="flex-1 rounded-xl bg-neon px-4 py-3 text-center text-base font-medium text-noche hover:bg-neon-suave"
                      >
                        {t("portal.open")} ↗
                      </a>
                    )}
                    {p.in_world && d && (
                      <button
                        onClick={() => {
                          if (goToParcel(p.district, p.parcel)) onEnter();
                        }}
                        className="flex-1 rounded-xl border border-cal/15 px-4 py-3 text-base text-cal/85 hover:bg-cal/5"
                      >
                        {t("nexo.seePortal")}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Block>
    </>
  );
}

function DistrictCard({ cover, color, title, desc, free, onGo }: { cover: string; color: string; title: string; desc: string; free?: number; onGo: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <li className={`${card} flex flex-col overflow-hidden`} style={{ borderColor: `${color}40` }}>
      {broken ? (
        <div className="aspect-video w-full" style={{ background: `radial-gradient(circle at 50% 70%, ${color}55, transparent 70%), #0b0f18` }} />
      ) : (
        <img src={cover} alt="" loading="lazy" onError={() => setBroken(true)} className="aspect-video w-full object-cover" />
      )}
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <p className="display text-lg font-semibold" style={{ color }}>
          {title}
        </p>
        <p className="text-sm leading-relaxed text-cal/65">{desc}</p>
        {free !== undefined && <p className="text-xs text-cal/45">{t("nexo.freeParcels", { n: free })}</p>}
        <div className="mt-auto pt-2">
          <button onClick={onGo} className="rounded-xl bg-neon px-5 py-3 text-base font-medium text-noche hover:bg-neon-suave">
            {t("nexo.go")} →
          </button>
        </div>
      </div>
    </li>
  );
}
