/**
 * La pestaña «Crear»: los caminos para hacer algo en xenxo sin desplegar el mundo (publicar lo que
 * ya tienes, un juego web, tu agente en tu parcela, tu distrito) y, al final, montar tu propia copia
 * o un nodo. Los comandos se copian con un toque; el detalle está en la guía (xenxo.io/docs).
 */
import type { ReactNode } from "react";
import { NPM_PUBLISHED, SOURCE_URL } from "../content";
import { t, useLang } from "../i18n";
import { Block, Button, card, CopyBlock } from "./ui";

const MCP_URL = `${typeof location !== "undefined" ? location.origin : "https://xenxo.io"}/mcp/xenxo-mcp.mjs`;
const link = "text-sm text-azulejo-claro underline-offset-2 hover:underline";

function Path({ n, title, text, children }: { n: string; title: string; text: string; children?: ReactNode }) {
  return (
    <li className={`${card} flex gap-4 p-4 sm:p-5`}>
      <span aria-hidden className="meta mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-neon/40 text-xs text-neon">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="display text-[17px] font-semibold text-cal">{title}</h3>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-soft">{text}</p>
        {children}
      </div>
    </li>
  );
}

/** Mientras los paquetes no estén en npm: el aviso del 404 con los pasos desde el repositorio. */
export function Npm404() {
  if (NPM_PUBLISHED) return null;
  return (
    <p className="mt-2 text-xs text-muted">
      {t("create.npm404")}{" "}
      <a className="text-azulejo-claro underline-offset-2 hover:underline" target="_blank" rel="noreferrer" href={`${SOURCE_URL}/blob/main/packages/create-xenxo/README.md#mientras-no-est%C3%A9-en-npm`}>
        {t("create.npm404.link")}
      </a>
      .
    </p>
  );
}

export function CreateSection({ onProjects }: { onProjects: () => void }) {
  const lang = useLang();
  const docs = lang === "en" ? "/docs/en/" : "/docs/";
  const mcp = NPM_PUBLISHED
    ? "claude mcp add --scope user xenxo -e XENXO_KEY=xk_… -- npx -y @xenxo/mcp"
    : `curl -o ~/xenxo-mcp.mjs ${MCP_URL}\nclaude mcp add --scope user xenxo -e XENXO_KEY=xk_… -- node ~/xenxo-mcp.mjs`;
  return (
    <Block title={t("nav.create")}>
      <p className="-mt-2 mb-5 max-w-prose text-[15px] leading-relaxed text-soft">{t("create.intro")}</p>
      <ol className="flex flex-col gap-3">
        <Path n="0" title={t("create.publish.title")} text={t("create.publish.text")}>
          <div className="mt-3">
            <Button variant="primary" onClick={onProjects}>
              {t("create.publish.go")}
            </Button>
          </div>
        </Path>
        <Path n="1" title={t("create.game.title")} text={t("create.game.text")}>
          <div className="mt-3">
            <CopyBlock text="npm create xenxo@latest" />
          </div>
          <Npm404 />
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <a className={link} href="/sdk/ejemplo" target="_blank" rel="noreferrer">
              {t("create.game.example")} ↗
            </a>
            <a className={link} href={`${docs}crear`} target="_blank" rel="noreferrer">
              {t("create.docs")} ↗
            </a>
          </p>
        </Path>
        <Path n="2" title={t("create.agent.title")} text={t("create.agent.text")}>
          <div className="mt-3">
            <CopyBlock text={mcp} />
          </div>
          <div className="mt-3">
            <Button onClick={onProjects}>{t("create.agent.go")}</Button>
          </div>
        </Path>
        <Path n="3" title={t("create.district.title")} text={t("create.district.text")}>
          <div className="mt-3">
            <CopyBlock text="npm create xenxo@latest mi-distrito -- --district" />
          </div>
          <Npm404 />
        </Path>
        <Path n="∞" title={t("create.host.title")} text={t("create.host.text")}>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <a className={link} href={docs} target="_blank" rel="noreferrer">
              {t("create.docs")} ↗
            </a>
            <a className={link} href={SOURCE_URL} target="_blank" rel="noreferrer">
              {t("create.source")} ↗
            </a>
          </p>
        </Path>
      </ol>
    </Block>
  );
}
