import { t, type Key } from "../i18n";
import { input } from "../world/input";

/** Gestos del avatar (también con las teclas 1-4). Se ven en la plaza para todos. */
const EMOTES: { id: string; icon: string; label: Key; key: string }[] = [
  { id: "wave", icon: "👋", label: "emote.wave", key: "1" },
  { id: "dance", icon: "💃", label: "emote.dance", key: "2" },
  { id: "sit", icon: "🪑", label: "emote.sit", key: "3" },
  { id: "cheer", icon: "🎉", label: "emote.cheer", key: "4" },
];

export function Emotes({ className = "" }: { className?: string }) {
  return (
    <div role="toolbar" aria-label={t("emote.bar")} className={`flex gap-1.5 ${className}`}>
      {EMOTES.map((e) => (
        <button
          key={e.id}
          title={`${t(e.label)} (${e.key})`}
          aria-label={t(e.label)}
          onClick={() => (input.emote = e.id)}
          className="grid h-11 w-11 place-items-center rounded-xl border border-cal/10 bg-noche/70 text-xl backdrop-blur transition hover:border-cal/30 hover:bg-noche/85 active:scale-95"
        >
          <span aria-hidden>{e.icon}</span>
        </button>
      ))}
    </div>
  );
}
