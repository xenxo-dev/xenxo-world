import { getLang, t } from "../i18n";
import type { BadgeInfo } from "../net/badges";

/** Insignia: hexágono de línea en su color, con el nombre debajo y la explicación al pasar. */
export function BadgeChip({ b }: { b: BadgeInfo }) {
  const lang = getLang();
  const name = b.name[lang] ?? b.name.en ?? b.id;
  const desc = b.desc[lang] ?? b.desc.en ?? "";
  return (
    <li className="flex w-24 flex-col items-center gap-1 text-center" title={desc}>
      <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden>
        <polygon points="24,3 42,13.5 42,34.5 24,45 6,34.5 6,13.5" fill="none" stroke={b.color} strokeWidth="2.5" />
        <polygon points="24,11 35,17.5 35,30.5 24,37 13,30.5 13,17.5" fill={b.color} opacity="0.25" />
        <circle cx="24" cy="24" r="4" fill={b.color} />
      </svg>
      <span className="text-xs leading-tight text-cal">{name}</span>
    </li>
  );
}

export function BadgeList({ badges, empty }: { badges: BadgeInfo[]; empty?: string }) {
  if (!badges.length) return <p className="mt-2 text-sm text-cal/45">{empty ?? t("badges.none")}</p>;
  return (
    <ul className="mt-3 flex flex-wrap gap-3">
      {badges.map((b) => (
        <BadgeChip key={b.id} b={b} />
      ))}
    </ul>
  );
}
