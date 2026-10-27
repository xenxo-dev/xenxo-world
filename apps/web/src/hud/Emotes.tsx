import type { ReactNode } from "react";
import { t, type Key } from "../i18n";
import { input } from "../world/input";
import { CheerIcon, DanceIcon, hudIconButton, SitIcon, WaveIcon } from "./icons";

/** Gestos del avatar (también con las teclas 1-4). Se ven en la plaza para todos. */
const EMOTES: { id: string; icon: ReactNode; label: Key; key: string }[] = [
  { id: "wave", icon: <WaveIcon />, label: "emote.wave", key: "1" },
  { id: "dance", icon: <DanceIcon />, label: "emote.dance", key: "2" },
  { id: "sit", icon: <SitIcon />, label: "emote.sit", key: "3" },
  { id: "cheer", icon: <CheerIcon />, label: "emote.cheer", key: "4" },
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
          className={hudIconButton}
        >
          {e.icon}
        </button>
      ))}
    </div>
  );
}
