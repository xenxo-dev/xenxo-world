import { useState } from "react";
import { errorText, t } from "../i18n";
import { ApiError, type Project } from "../net/account";
import { clearGameCard, gameLink, registerGameCard } from "../net/games";
import { Button, card, input, Label, Notice } from "./ui";

/**
 * Ficha del juego de un proyecto propio: xenxo lee su xenxo.json (desde el servidor) y le da su
 * enlace xenxo.io/j/<nombre>. Cambiar la ficha la devuelve a revisión.
 */
export function GameCard({ project, onChange }: { project: Project; onChange: () => void }) {
  const [slug, setSlug] = useState(project.slug ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; issues: string[] } | null>(null);
  const [ok, setOk] = useState("");
  const [copied, setCopied] = useState(false);
  const g = project.game;

  const read = async () => {
    setBusy(true);
    setError(null);
    setOk("");
    try {
      const r = await registerGameCard(project.id, slug.trim() || undefined);
      setOk(t("gameCard.read", { url: r.manifest_url }));
      onChange();
    } catch (e) {
      const issues = e instanceof ApiError && e.detail && typeof e.detail === "object" && Array.isArray((e.detail as { issues?: unknown }).issues)
        ? ((e.detail as { issues: string[] }).issues)
        : [];
      setError({ text: e instanceof ApiError && e.code.startsWith("manifest_") ? e.message : errorText(e), issues });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${card} mt-3 p-4 text-sm`}>
      <p className="text-cal/75">{t("gameCard.intro")}</p>
      {g && project.slug && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="break-all rounded-lg border border-cal/10 bg-noche/70 px-3 py-1.5 font-mono text-xs text-cal/85">{gameLink(project.slug)}</span>
          <Button
            onClick={() =>
              void navigator.clipboard?.writeText(gameLink(project.slug!)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? t("card.copied") : t("card.copyLink")}
          </Button>
          <span className="text-xs text-cal/50">
            {g.host} · {t(g.ageRating === "all" ? "gate.age.all" : "gate.age.14")} · {g.embed ? t("gameCard.embed") : t("gameCard.noEmbed")}
          </span>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor={`slug-${project.id}`}>{t("gameCard.slug")}</Label>
          <div className="flex items-center gap-1 font-mono text-xs text-cal/60">
            xenxo.io/j/
            <input
              id={`slug-${project.id}`}
              value={slug}
              maxLength={40}
              placeholder={t("gameCard.slugAuto")}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              className={`${input} max-w-[13rem] py-1.5 font-mono text-xs`}
            />
          </div>
        </div>
        <Button variant="primary" disabled={busy} onClick={() => void read()}>
          {g ? t("gameCard.reread") : t("gameCard.register")}
        </Button>
        {g && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void clearGameCard(project.id)
                .then(onChange)
                .catch((e) => setError({ text: errorText(e), issues: [] }))
            }
          >
            {t("gameCard.remove")}
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-cal/45">{t("gameCard.where", { url: project.url ?? "" })}</p>
      {ok && <Notice tone="ok">{ok}</Notice>}
      {error && (
        <Notice tone="error">
          {error.text}
          {error.issues.length > 0 && (
            <span className="mt-1 block font-mono text-xs">
              {error.issues.map((i) => (
                <span key={i} className="block">
                  · {i}
                </span>
              ))}
            </span>
          )}
        </Notice>
      )}
    </div>
  );
}
