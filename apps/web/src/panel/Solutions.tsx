/** «Soluciones»: lo que Xen construye y comparte en abierto (content.ts). Va al final de Proyectos. */
import { ACCENTS, SOLUTIONS } from "../content";
import { t, useLang } from "../i18n";
import { Block } from "./ui";

export function SolutionsBlock() {
  const lang = useLang();
  return (
    <Block title={t("nav.solutions")}>
      <p className="-mt-2 mb-5 max-w-prose text-[15px] leading-relaxed text-soft">{t("solutions.intro")}</p>
      <ul className="divide-y divide-cal/[0.07] border-y border-cal/[0.07]">
        {SOLUTIONS.map((s) => (
          <li key={s.tag.en}>
            <a href={s.href} className="group flex flex-col gap-2 py-4 sm:grid sm:grid-cols-[6rem_1fr] sm:items-baseline sm:gap-4">
              <span className={`justify-self-start rounded-md border px-2 py-0.5 text-xs ${ACCENTS[s.accent]}`}>{s.tag[lang]}</span>
              <span>
                <span className="display block text-[17px] font-semibold text-cal transition group-hover:text-neon-suave">{s.title[lang]}</span>
                <span className="mt-1 block max-w-prose text-sm leading-relaxed text-muted">{s.summary[lang]}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Block>
  );
}
