/**
 * Aviso previo: antes de abrir un juego de fuera, quién lo hace, dónde está alojado, su edad, si
 * tiene anuncios o compras, si lo ha revisado xenxo y que a partir de ahí el navegador habla con
 * esa web. Sin cuenta solo se abren juegos «para todos» y revisados.
 */
import { assetUrl } from "../config";
import { t, useLang, type Key } from "../i18n";
import { useAccount } from "../net/account";
import { ReportButton } from "../panel/ReportButton";
import { Button, card } from "../panel/ui";
import { closeGame, gameName, gameSrc, playHere, type OpenGame } from "./state";

const chip = "rounded-md border px-2 py-0.5 text-xs";

export function Gate({ open, onSignIn }: { open: OpenGame; onSignIn: () => void }) {
  const lang = useLang();
  const user = useAccount();
  const p = open.project;
  const g = p.game!;
  const reviewed = p.review === "approved";
  // Las cuentas ya declaran tener 14 años o más al darse de alta.
  const blocked = !user && (g.ageRating !== "all" || !reviewed);
  const description = g.description[lang] ?? g.description.en ?? p.summary;

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-noche/80 p-4 backdrop-blur-md">
      <div className={`${card} max-h-[92dvh] w-full max-w-lg overflow-y-auto bg-noche-2/95`} role="dialog" aria-modal="true" aria-labelledby="gate-title">
        {p.cover_hash && <img src={assetUrl(p.cover_hash)} alt="" className="aspect-video w-full rounded-t-2xl object-cover" />}
        <div className="p-5">
          <div className="flex flex-wrap gap-1.5">
            {reviewed ? (
              <span className={`${chip} border-huerta/40 text-lime-100`}>✓ {t("gate.reviewed")}</span>
            ) : (
              <span className={`${chip} border-ocre/50 text-amber-100`}>{t("gate.unreviewed")}</span>
            )}
            <span className={`${chip} border-cal/20 text-cal/80`}>{t(g.ageRating === "all" ? "gate.age.all" : "gate.age.14")}</span>
            {g.multiplayer && <span className={`${chip} border-cal/20 text-cal/80`}>{t("gate.multiplayer")}</span>}
          </div>
          <h2 id="gate-title" className="display mt-3 text-2xl font-semibold text-cal">
            {gameName(p, lang)}
          </h2>
          <p className="mt-1 text-sm text-cal/60">{t("gate.by", { author: g.author, host: g.host })}</p>
          {description && <p className="mt-3 text-sm leading-relaxed text-cal/75">{description}</p>}
          <p className="mt-3 text-xs text-cal/55">
            {t("gate.devices", { list: g.devices.map((d) => t(`gate.device.${d}` as Key)).join(" · ") })}
          </p>

          {!reviewed && <p className="mt-4 rounded-lg border border-ocre/30 bg-ocre/10 px-3 py-2 text-sm text-amber-100">{t("gate.unreviewedNote")}</p>}
          {(g.monetization.hasAds || g.monetization.hasPurchases) && (
            <div className="mt-3 rounded-lg border border-cal/15 px-3 py-2 text-sm text-cal/80">
              {g.monetization.hasAds && <p>• {t("gate.ads")}</p>}
              {g.monetization.hasPurchases && <p>• {t("gate.purchases")}</p>}
              <p className="mt-1 text-xs text-cal/50">{t("gate.commercial")}</p>
            </div>
          )}
          <p className="mt-3 text-xs leading-relaxed text-cal/55">
            {t("gate.privacy", { host: g.host })}{" "}
            <a href={g.privacy} target="_blank" rel="noopener noreferrer nofollow" className="text-neon-suave underline">
              {t("gate.privacyLink")}
            </a>
          </p>

          {blocked ? (
            <div className="mt-5">
              <p className="text-sm text-cal/80">{t(g.ageRating !== "all" ? "gate.needAccount14" : "gate.needAccountReview")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" onClick={onSignIn}>
                  {t("gate.signIn")}
                </Button>
                <Button variant="ghost" onClick={closeGame}>
                  {t("gate.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap gap-2">
              {g.embed && (
                <Button variant="primary" onClick={playHere}>
                  {t("gate.playHere")}
                </Button>
              )}
              <a
                href={gameSrc(p, lang)}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
                onClick={closeGame}
                className={`rounded-xl px-4 py-2 text-sm ${g.embed ? "border border-cal/15 text-cal/85 hover:bg-cal/5" : "bg-neon font-medium text-noche hover:bg-neon-suave"}`}
              >
                {t("gate.openSite")}
              </a>
              <Button variant="ghost" onClick={closeGame}>
                {t("gate.cancel")}
              </Button>
            </div>
          )}
          {!g.embed && !blocked && <p className="mt-2 text-xs text-cal/45">{t("gate.noEmbed")}</p>}
          <div className="mt-4 flex justify-end">
            <ReportButton targetType="project" targetId={p.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
