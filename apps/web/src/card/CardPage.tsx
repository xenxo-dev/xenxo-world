/**
 * xenxo.io/p/<número>: el carné de jugador público (número, nombre, personaje, fecha de alta y
 * proyectos). Página ligera: no carga el mundo ni la cuenta; la vista previa 3D llega aparte.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { assetUrl } from "../config";
import { getLang, LANGS, setLang, t, useLang, type Key } from "../i18n";
import { cardLink, fetchPlayerCard, type PlayerCard } from "../net/card";
import { BadgeList } from "./Badges";
import { refreshDistricts, type DistrictInfo } from "../net/districts";
import type { PreviewPose } from "../panel/AvatarPreview";
import { Button, card as cardBox } from "../panel/ui";
import { AVATAR_PRESETS } from "../world/presets";
import { renderCardImage } from "./image";

const AvatarPreview = lazy(() => import("../panel/AvatarPreview"));

type State = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; card: PlayerCard };

function longDate(ms: number): string {
  return new Intl.DateTimeFormat(getLang(), { dateStyle: "long" }).format(new Date(ms));
}

function projectsLine(n: number): string {
  return n === 0 ? "" : n === 1 ? t("card.projectsOne") : t("card.projectsMany", { n });
}

export function CardPage({ no }: { no: number }) {
  const lang = useLang();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [districts, setDistricts] = useState<DistrictInfo[]>([]);
  const [pose, setPose] = useState<PreviewPose>("wave");
  const [view, setView] = useState<"loading" | "ready" | "error">("loading");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPlayerCard(no)
      .then((c) => alive && setState(c ? { kind: "ready", card: c } : { kind: "missing" }))
      .catch(() => alive && setState({ kind: "error" }));
    refreshDistricts()
      .then((d) => alive && setDistricts(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [no]);

  useEffect(() => {
    document.title = state.kind === "ready" ? `#${state.card.player_no} · ${state.card.name} — xenxo` : `${t("card.title")} — xenxo`;
  }, [state, lang]);

  const flash = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(""), 2200);
  };

  const share = async () => {
    const url = cardLink(no);
    try {
      if (navigator.share) return void (await navigator.share({ title: `xenxo #${no}`, url }));
      await navigator.clipboard.writeText(url);
      flash(t("card.copied"));
    } catch {
      /* compartir cancelado */
    }
  };

  const download = async (c: PlayerCard) => {
    setBusy(true);
    try {
      const blob = await renderCardImage(
        c,
        {
          title: c.player_no === 0 ? `${t("card.title")} · ${t("card.founder")}` : t("card.title"),
          since: t("card.since", { date: longDate(c.joined) }),
          projects: projectsLine(c.projects.length),
          link: cardLink(no).replace(/^https?:\/\//, ""),
        },
        view === "ready" ? canvas.current : null,
      );
      const file = new File([blob], `xenxo-${c.player_no}.png`, { type: "image/png" });
      // En el móvil, al menú de compartir; si no, se descarga.
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `xenxo #${c.player_no}` });
          return;
        } catch {
          /* cancelado: se descarga */
        }
      }
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: url, download: file.name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      flash(t("card.imageError"));
    } finally {
      setBusy(false);
    }
  };

  const districtName = (id: string | null) => {
    const d = id ? districts.find((x) => x.id === id) : undefined;
    return d ? (d.name[lang] ?? d.name.es ?? d.id) : null;
  };

  return (
    <main className="min-h-dvh w-full overflow-y-auto bg-noche bg-[radial-gradient(circle_at_20%_85%,rgb(62_230_255/0.12),transparent_45%),radial-gradient(circle_at_85%_10%,rgb(255_79_216/0.12),transparent_50%)] px-4 py-6 text-cal sm:py-10">
      <header className="mx-auto flex max-w-4xl items-center justify-between">
        <a href="/" className="display neon-sign text-[26px] font-bold leading-none" translate="no">
          xenxo<span className="dot">.</span>io
        </a>
        <div className="flex gap-1 text-xs">
          {LANGS.map((l) => (
            <button
              key={l.id}
              onClick={() => setLang(l.id)}
              aria-pressed={lang === l.id}
              className={`rounded-md px-2 py-1 ${lang === l.id ? "bg-cal/10 text-cal" : "text-cal/50 hover:text-cal"}`}
            >
              {l.id.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <section className={`${cardBox} mx-auto mt-6 max-w-4xl overflow-hidden bg-noche/60 backdrop-blur`}>
        {state.kind === "loading" && <p className="p-10 text-center text-cal/60">{t("card.loading")}</p>}
        {(state.kind === "missing" || state.kind === "error") && (
          <div className="p-10 text-center">
            <p className="meta text-5xl text-neon-suave">#{no}</p>
            <p className="mt-4 text-cal/70">{t(state.kind === "missing" ? "card.notFound" : "card.error")}</p>
            <a href="/" className="mt-6 inline-block rounded-xl bg-neon px-4 py-2 font-medium text-noche hover:bg-neon-suave">
              {t("card.enter")}
            </a>
          </div>
        )}
        {state.kind === "ready" && (
          <div className="grid md:grid-cols-[minmax(0,22rem)_1fr]">
            <div className="flex flex-col border-b border-cal/10 md:border-b-0 md:border-r">
              <div className="relative aspect-[4/5] w-full bg-[radial-gradient(circle_at_50%_75%,rgb(62_230_255/0.16),transparent_65%)] md:aspect-auto md:min-h-[26rem] md:flex-1">
                <Suspense fallback={null}>
                  <AvatarPreview
                    url={assetUrl(state.card.avatar?.hash ?? AVATAR_PRESETS[0]!.hash)}
                    pose={pose}
                    onState={setView}
                    onCanvas={(c) => (canvas.current = c)}
                  />
                </Suspense>
                {view !== "ready" && (
                  <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-cal/50">
                    {view === "error" ? t("wardrobe.previewError") : t("wardrobe.loading")}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap justify-center gap-1 border-t border-cal/10 p-2" role="group" aria-label={t("wardrobe.poses")}>
                {(["idle", "walk", "dance", "wave"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPose(p)}
                    aria-pressed={pose === p}
                    className={`rounded-lg px-2 py-1 text-xs ${pose === p ? "bg-neon/15 text-cal" : "text-cal/55 hover:text-cal"}`}
                  >
                    {t(`wardrobe.pose.${p}` as Key)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col p-6 sm:p-8">
              <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-cal/50">
                {t("card.title")}
                {/* El 0 solo lo puede tener la cuenta fundadora (lo decide el servidor): no se falsifica. */}
                {state.card.player_no === 0 && (
                  <span className="rounded-md border border-rosa/40 bg-rosa/15 px-2 py-0.5 tracking-[0.15em] text-[#ffc2f1]">{t("card.founder")}</span>
                )}
              </p>
              <p className="display mt-2 text-7xl font-bold leading-none text-neon-suave [text-shadow:0_0_18px_rgb(79_163_255/0.6)] sm:text-8xl">
                #{state.card.player_no}
              </p>
              <h1 className="display mt-3 break-words text-4xl font-bold text-cal">{state.card.name}</h1>
              <p className="mt-2 text-cal/70">{t("card.since", { date: longDate(state.card.joined) })}</p>

              <h2 className="mt-8 text-sm font-medium text-cal/80">{t("card.badges")}</h2>
              <BadgeList badges={state.card.badges ?? []} empty={t("card.noBadges")} />

              <h2 className="mt-8 text-sm font-medium text-cal/80">{t("card.projects")}</h2>
              {state.card.projects.length === 0 ? (
                <p className="mt-2 text-sm text-cal/45">{t("card.noProjects")}</p>
              ) : (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {state.card.projects.map((p) => {
                    const where = districtName(p.district);
                    const body = (
                      <>
                        {p.cover_hash ? (
                          <img src={assetUrl(p.cover_hash)} alt="" loading="lazy" className="aspect-video w-full rounded-lg object-cover" />
                        ) : (
                          <div className="aspect-video w-full rounded-lg bg-cal/5" />
                        )}
                        <p className="mt-2 font-medium text-cal">{p.title}</p>
                        <p className="line-clamp-2 text-xs text-cal/55">{p.summary}</p>
                        {where && <p className="mt-1 text-xs text-neon-suave/80">{t("card.inDistrict", { district: where })}</p>}
                      </>
                    );
                    return (
                      <li key={p.id} className="rounded-xl border border-cal/10 p-2">
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="block hover:opacity-90">
                            {body}
                          </a>
                        ) : (
                          body
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-8 flex flex-wrap gap-2">
                <a href="/" className="rounded-xl bg-neon px-4 py-2 text-sm font-medium text-noche hover:bg-neon-suave">
                  {t("card.enter")}
                </a>
                <Button variant="secondary" onClick={() => void share()}>
                  {t("card.share")}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => void download(state.card)}>
                  {t("card.download")}
                </Button>
              </div>
              <p className="mt-2 min-h-5 text-xs text-neon-suave" role="status">
                {note}
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
