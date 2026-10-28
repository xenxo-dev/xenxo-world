/**
 * Cuenta → Nodos (solo el fundador): servidores de distritos de la comunidad. Darlos de alta, ver si
 * responden, apagarlos y llevar cada distrito a un nodo o de vuelta a Cloudflare. Si un nodo cae, el
 * servidor pasa solo sus distritos a Cloudflare con la última copia; volver al nodo es a mano, aquí.
 */
import { useEffect, useState } from "react";
import { REALTIME_URL } from "../config";
import { errorText, getLang, t } from "../i18n";
import { ApiError } from "../net/account";
import { addNode, checkNodes, listNodes, moveDistrict, removeNode, rotateNodeKey, setNodeEnabled, type ChunkHostRow, type NodePlace, type NodeRow } from "../net/nodes";
import { Button, input, Label, Notice } from "./ui";

const FAILS_TO_FALLBACK = 3;

export function NodesAdmin() {
  const [data, setData] = useState<{ nodes: NodeRow[]; hosts: ChunkHostRow[]; districts: NodePlace[] } | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ id: "", name: "", url: "" });
  const [target, setTarget] = useState<Record<string, string>>({});

  const load = () =>
    listNodes()
      .then(setData)
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError("");
    setDone("");
    try {
      await fn();
      if (ok) setDone(ok);
    } catch (e) {
      setError(errorText(e));
    } finally {
      await load();
      setBusy(false);
    }
  };

  const lang = getLang();
  const placeName = (p: NodePlace) => (typeof p.name === "string" ? p.name : (p.name[lang] ?? p.name.es));
  const when = (ms: number) => new Date(ms).toLocaleString(lang === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const nodeName = (id: string) => data?.nodes.find((n) => n.id === id)?.name ?? id;
  const state = (n: NodeRow) => (n.disabled ? t("nodes.state.off") : n.fails >= FAILS_TO_FALLBACK ? t("nodes.state.down") : n.last_ok ? t("nodes.state.ok") : t("nodes.state.unknown"));

  return (
    <div className="space-y-5">
      <p className="text-sm text-soft">{t("nodes.intro")}</p>

      <ul className="divide-y divide-cal/10 rounded-2xl border border-cal/10">
        {data && data.nodes.length === 0 && <li className="px-4 py-3 text-sm text-muted">{t("nodes.none")}</li>}
        {(data?.nodes ?? []).map((n) => {
          const carries = (data?.hosts ?? []).filter((h) => h.node_id === n.id);
          return (
            <li key={n.id} className="space-y-2 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-cal">
                  {n.name} <span className="meta text-muted">{n.id}</span>
                </span>
                <span className={n.disabled || n.fails >= FAILS_TO_FALLBACK ? "text-terracota-claro" : "text-neon-suave"}>{state(n)}</span>
              </div>
              <p className="meta break-all text-xs text-muted">{n.url}</p>
              <p className="text-xs text-muted">
                {n.last_ok ? t("nodes.lastOk", { time: when(n.last_ok) }) : ""}
                {n.fails > 0 && n.last_fail ? ` ${t("nodes.fails", { n: n.fails, time: when(n.last_fail) })}` : ""}
              </p>
              {carries.length > 0 && (
                <p className="text-xs text-soft">
                  {t("nodes.carries")}{" "}
                  {carries
                    .map((h) => {
                      const p = data?.districts.find((d) => d.chunk_id === h.chunk_id);
                      const name = p ? placeName(p) : h.chunk_id;
                      return h.state === "fallback" ? t("nodes.inFallback", { name }) : name;
                    })
                    .join(", ")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => void act(() => setNodeEnabled(n.id, !!n.disabled), t(n.disabled ? "nodes.enabled" : "nodes.disabled", { name: n.name }))}>
                  {n.disabled ? t("nodes.enable") : t("nodes.disable")}
                </Button>
                {carries.length === 0 && (
                  <Button variant="ghost" disabled={busy} onClick={() => void act(() => removeNode(n.id), t("nodes.removed", { name: n.name }))}>
                    {t("nodes.remove")}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2">
        <p className="text-sm font-medium text-cal">{t("nodes.addTitle")}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <Label htmlFor="node-id">{t("nodes.id")}</Label>
            <input id="node-id" value={form.id} placeholder="casa-1" onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) })} className={input} />
          </div>
          <div>
            <Label htmlFor="node-name">{t("nodes.name")}</Label>
            <input id="node-name" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          </div>
          <div>
            <Label htmlFor="node-url">{t("nodes.url")}</Label>
            <input id="node-url" value={form.url} placeholder="https://distritos.ejemplo.com" onChange={(e) => setForm({ ...form, url: e.target.value.trim() })} className={input} />
          </div>
        </div>
        <p className="text-xs text-muted">{t("nodes.keyHint", { url: new URL("/nodes/key", REALTIME_URL).toString() })}</p>
        <Button
          variant="primary"
          disabled={busy || form.id.length < 3 || form.name.trim().length < 2 || !form.url}
          onClick={() =>
            void act(async () => {
              const r = await addNode(form.id, form.name.trim(), form.url);
              setForm({ id: "", name: "", url: "" });
              if (!r.alive) throw new ApiError("node_unreachable", t("nodes.addedOffline", { name: r.node.name }));
            }, t("nodes.added", { name: form.name.trim() }))
          }
        >
          {t("nodes.add")}
        </Button>
      </div>

      {data && data.nodes.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-cal">{t("nodes.where")}</p>
          <ul className="divide-y divide-cal/10 rounded-2xl border border-cal/10">
            {data.districts.map((p) => {
              const h = data.hosts.find((x) => x.chunk_id === p.chunk_id);
              const now = !h ? "cloudflare" : h.state === "node" ? h.node_id : "cloudflare";
              const pick = target[p.chunk_id] ?? now;
              return (
                <li key={p.chunk_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="text-cal">
                    {placeName(p)}{" "}
                    <span className="text-xs text-muted">
                      {!h ? t("nodes.onCloudflare") : h.state === "node" ? t("nodes.onNode", { name: nodeName(h.node_id) }) : t("nodes.onFallback", { name: nodeName(h.node_id) })}
                      {h?.snapshot_at ? ` · ${t("nodes.copy", { time: when(h.snapshot_at) })}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <select
                      aria-label={t("nodes.moveTo", { name: placeName(p) })}
                      value={pick}
                      onChange={(e) => setTarget({ ...target, [p.chunk_id]: e.target.value })}
                      className={`${input} w-auto py-1.5`}
                    >
                      <option value="cloudflare">Cloudflare</option>
                      {data.nodes
                        .filter((n) => !n.disabled)
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name}
                          </option>
                        ))}
                    </select>
                    <Button
                      variant="ghost"
                      disabled={busy || (pick === now && h?.state !== "fallback")}
                      onClick={() => void act(() => moveDistrict(p.chunk_id, pick), t("nodes.moved", { name: placeName(p) }))}
                    >
                      {t("nodes.move")}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const r = await checkNodes();
                setDone(t("nodes.checked", { n: r.checked, copies: r.snapshots.length }));
              }, "")
            }
          >
            {t("nodes.check")}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(t("nodes.rotateConfirm"))) return;
              void act(() => rotateNodeKey(), t("nodes.rotated"));
            }}
          >
            {t("nodes.rotate")}
          </Button>
        </div>
      )}

      {done && <Notice tone="ok">{done}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
