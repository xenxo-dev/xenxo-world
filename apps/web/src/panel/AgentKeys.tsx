import { useEffect, useState } from "react";
import { REALTIME_URL } from "../config";
import { errorText, t } from "../i18n";
import { createAgentKey, listAgentKeys, revokeAgentKey, type AgentKey } from "../net/account";
import { Button, card, input, Label, Notice } from "./ui";

/** Dónde se descarga el servidor MCP (un solo archivo, servido por la propia web). */
const MCP_URL = `${typeof location !== "undefined" ? location.origin : "https://xenxo.io"}/mcp/xenxo-mcp.mjs`;
/** Solo hace falta decir el servidor si no es el de producción. */
const URL_ENV = REALTIME_URL === "https://api.xenxo.io" ? null : REALTIME_URL;

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-1">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-cal/10 bg-noche/70 p-3 pr-16 font-mono text-xs text-cal/85">{text}</pre>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute right-2 top-2 rounded-md bg-cal/10 px-2 py-0.5 text-xs text-cal/70 hover:text-cal"
      >
        {copied ? t("agentKeys.copied") : t("agentKeys.copy")}
      </button>
    </div>
  );
}

/**
 * «Construir con tu agente»: claves de parcela de un proyecto (crear, ver cómo conectarla con
 * Claude Code o Cursor, revocar). La clave en claro solo se enseña al crearla.
 */
export function AgentKeys({ projectId }: { projectId: string }) {
  const [keys, setKeys] = useState<AgentKey[] | null>(null);
  const [max, setMax] = useState(3);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () =>
    listAgentKeys()
      .then((r) => {
        setKeys(r.keys.filter((k) => k.project_id === projectId));
        setMax(r.max_per_project);
      })
      .catch(() => setKeys([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const key = fresh ?? "xk_…";
  const env = URL_ENV ? ` -e XENXO_URL=${URL_ENV}` : "";
  const cursorEnv = URL_ENV ? `, "XENXO_URL": "${URL_ENV}"` : "";

  return (
    <div className={`${card} mt-3 p-4`}>
      <p className="text-sm text-cal/75">{t("agentKeys.intro")}</p>

      {keys && keys.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-cal/10 px-3 py-2">
              <span className="font-mono text-xs text-neon-suave">{k.id}</span>
              <span className="text-cal/80">{k.label ?? t("agentKeys.unnamed")}</span>
              <span className="text-xs text-cal/45">
                {k.last_used ? t("agentKeys.lastUsed", { date: new Date(k.last_used).toLocaleString() }) : t("agentKeys.neverUsed")}
              </span>
              <button className="ml-auto text-xs text-red-200/70 hover:text-red-200" disabled={busy} onClick={() => void run(() => revokeAgentKey(k.id))}>
                {t("agentKeys.revoke")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {keys && keys.length < max && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await createAgentKey(projectId, label.trim());
              setFresh(r.key);
              setLabel("");
            });
          }}
        >
          <div>
            <Label htmlFor={`key-label-${projectId}`}>{t("agentKeys.label")}</Label>
            <input id={`key-label-${projectId}`} value={label} maxLength={40} placeholder="Claude Code" onChange={(e) => setLabel(e.target.value)} className={`${input} max-w-[14rem]`} />
          </div>
          <Button type="submit" variant="primary" disabled={busy}>
            {t("agentKeys.create")}
          </Button>
        </form>
      )}
      {keys && keys.length >= max && <p className="mt-3 text-xs text-cal/45">{t("agentKeys.full", { n: max })}</p>}

      {fresh && (
        <div role="status" className="mt-3 rounded-xl border border-huerta/30 bg-huerta/10 p-3 text-sm text-lime-50">
          {t("agentKeys.once")}
          <CopyBlock text={fresh} />
        </div>
      )}

      <details className="mt-4 text-sm text-cal/75" open={!!fresh}>
        <summary className="cursor-pointer text-cal/85">{t("agentKeys.howto")}</summary>
        <ol className="mt-2 list-inside list-decimal space-y-3">
          <li>
            {t("agentKeys.step1")}
            <CopyBlock text={`curl -o ~/xenxo-mcp.mjs ${MCP_URL}`} />
          </li>
          <li>
            {t("agentKeys.step2claude")}
            <CopyBlock text={`claude mcp add xenxo -e XENXO_KEY=${key}${env} -- node ~/xenxo-mcp.mjs`} />
            <span className="mt-2 block">{t("agentKeys.step2cursor")}</span>
            <CopyBlock
              text={`{\n  "mcpServers": {\n    "xenxo": { "command": "node", "args": ["/ruta/a/xenxo-mcp.mjs"], "env": { "XENXO_KEY": "${key}"${cursorEnv} } }\n  }\n}`}
            />
          </li>
          <li>{t("agentKeys.step3")}</li>
        </ol>
        <p className="mt-3 text-xs text-cal/45">{t("agentKeys.rules")}</p>
      </details>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
