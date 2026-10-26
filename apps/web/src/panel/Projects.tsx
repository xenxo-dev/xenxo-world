import { useCallback, useEffect, useState } from "react";
import { REALTIME_URL } from "../config";
import { errorText, t, useLang } from "../i18n";
import { refreshDistricts, useDistricts, type DistrictInfo } from "../net/districts";
import {
  createProject,
  currentUser,
  deleteProject,
  listProjects,
  myProjects,
  prepareCover,
  uploadCover,
  uploadModel,
  type PreparedCover,
  useAccount,
  type PreparedModel,
  type Project,
} from "../net/account";
import { refreshProjects } from "../net/projects";
import { AgentKeys } from "./AgentKeys";
import { ModelPicker } from "./ModelPicker";
import { ReportButton } from "./ReportButton";
import { Block, Button, card, input, Label, Notice } from "./ui";

interface Repo {
  name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  language: string | null;
}

function useRepos() {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [owner, setOwner] = useState("");
  useEffect(() => {
    // A través del servidor: el navegador del visitante no habla con GitHub.
    fetch(new URL("/github/repos", REALTIME_URL))
      .then((r) => (r.ok ? r.json() : { repos: [], owner: "" }))
      .then((d: { repos: Repo[]; owner: string }) => {
        setRepos(d.repos);
        setOwner(d.owner);
      })
      .catch(() => setRepos([]));
  }, []);
  return { repos, owner };
}

export function ProjectsSection({ onGoToAccount }: { onGoToAccount: () => void }) {
  useLang();
  const user = useAccount();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const { repos, owner } = useRepos();

  const [mine, setMine] = useState<Set<string>>(new Set());
  const [building, setBuilding] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
    if (currentUser())
      myProjects()
        .then((list) => setMine(new Set(list.map((p) => p.id))))
        .catch(() => setMine(new Set()));
    else setMine(new Set());
  }, []);
  useEffect(refresh, [refresh, user?.id]);

  return (
    <>
      <Block
        title={t("projects.community")}
        aside={
          !publishing && (
            <Button variant="primary" onClick={() => (user ? setPublishing(true) : onGoToAccount())}>
              {t("projects.publish")}
            </Button>
          )
        }
      >
        {publishing && (
          <PublishForm
            onDone={() => {
              setPublishing(false);
              refresh();
            }}
          />
        )}
        {projects === null && <p className="text-sm text-cal/50">{t("repos.loading")}</p>}
        {projects?.length === 0 && !publishing && <p className="text-sm text-cal/50">{t("projects.empty")}</p>}
        <ul className="flex flex-col gap-2">
          {projects?.map((p) => (
            <li key={p.id} className={`${card} p-4`}>
              <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-cal">{p.title}</p>
                  <p className="text-xs text-cal/50">{t("projects.by", { name: p.author })}</p>
                  {p.summary && <p className="mt-1.5 text-sm text-cal/65">{p.summary}</p>}
                </div>
                {p.in_world && <span className="rounded-full border border-huerta/40 bg-huerta/15 px-2 py-0.5 text-xs text-lime-100">{t("projects.inWorld")}</span>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer noopener nofollow ugc" className="text-sm text-azulejo-claro underline-offset-2 hover:underline">
                    {t("projects.visit")} ↗
                  </a>
                )}
                {mine.has(p.id) && p.in_world && (
                  <Button variant={building === p.id ? "primary" : "secondary"} onClick={() => setBuilding(building === p.id ? null : p.id)}>
                    {t("agentKeys.open")}
                  </Button>
                )}
                {mine.has(p.id) ? (
                  <button
                    className="text-xs text-red-200/70 hover:text-red-200"
                    onClick={async () => {
                      await deleteProject(p.id);
                      refresh();
                    }}
                  >
                    {t("projects.delete")}
                  </button>
                ) : (
                  <ReportButton targetType="project" targetId={p.id} />
                )}
              </div>
              {building === p.id && mine.has(p.id) && <AgentKeys projectId={p.id} />}
            </li>
          ))}
        </ul>
        {!user && !publishing && <p className="mt-4 text-sm text-cal/50">{t("projects.loginToPublish")}</p>}
      </Block>

      <Block title={t("projects.xenxo")}>
        {repos === null && <p className="text-sm text-cal/50">{t("repos.loading")}</p>}
        {repos?.length === 0 && (
          <p className="text-sm text-cal/50">
            {t("repos.empty")}{" "}
            <a className="text-azulejo-claro underline" href={`https://github.com/${owner || "xenxo-dev"}`}>
              github.com/{owner || "xenxo-dev"}
            </a>
            .
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {repos?.map((r) => (
            <li key={r.name}>
              <a href={r.html_url} target="_blank" rel="noreferrer" className={`${card} flex items-center gap-4 p-4 transition hover:border-cal/25`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-cal">{r.name}</p>
                  <p className="truncate text-sm text-cal/55">{r.description ?? t("repos.noDescription")}</p>
                </div>
                <span className="shrink-0 text-xs text-cal/50">{r.language ?? ""}</span>
                <span className="shrink-0 text-xs text-ocre">★ {r.stargazers_count}</span>
              </a>
            </li>
          ))}
        </ul>
      </Block>
    </>
  );
}

function PublishForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [url, setUrl] = useState("");
  const lang = useLang();
  const districts = useDistricts();
  useEffect(() => {
    void refreshDistricts(true);
  }, []);
  const [districtId, setDistrictId] = useState("");
  const [parcel, setParcel] = useState("");
  const district = districts?.find((d) => d.id === districtId) ?? null;
  const [cover, setCover] = useState<PreparedCover | null>(null);
  const [coverError, setCoverError] = useState("");
  const [model, setModel] = useState<PreparedModel | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");
  useEffect(() => () => (cover ? URL.revokeObjectURL(cover.preview) : undefined), [cover]);
  const ready = title.trim().length >= 3 && /^https:\/\/.+/.test(url) && !!district && !!parcel && !!cover && !!model;

  return (
    <form
      className={`${card} mb-4 p-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready || !cover || !model || !district) return;
        setState("sending");
        setMessage("");
        try {
          const [c, m] = await Promise.all([uploadCover(cover), uploadModel(model, "monument")]);
          await createProject({ title, summary, url, district: district.id, parcel, cover_hash: c.hash, mesh_hash: m.hash });
          void refreshProjects(true);
          void refreshDistricts(true);
          setMessage(t("projects.published"));
          setTimeout(onDone, 1800);
          setState("idle");
        } catch (err) {
          setState("error");
          setMessage(errorText(err));
        }
      }}
    >
      <p className="mb-3 text-sm leading-relaxed text-cal/60">{t("projects.requirements")}</p>
      <Label htmlFor="pj-title">{t("projects.title")}</Label>
      <input id="pj-title" required minLength={3} maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
      <Label htmlFor="pj-url">{t("projects.url")}</Label>
      <input id="pj-url" required type="url" pattern="https://.*" maxLength={300} value={url} onChange={(e) => setUrl(e.target.value)} className={input} placeholder="https://…" />
      <p className="mb-1.5 mt-4 text-sm text-cal/70">{t("projects.district")}</p>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("projects.district")}>
        {districts?.map((d) => {
          const free = d.parcels.filter((q) => !q.project_id).length;
          const on = d.id === districtId;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={on}
              key={d.id}
              disabled={free === 0}
              onClick={() => {
                setDistrictId(d.id);
                setParcel("");
              }}
              className={`rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-40 ${on ? "bg-cal/[0.06]" : "border-cal/10 hover:border-cal/25"}`}
              style={on ? { borderColor: d.color } : undefined}
            >
              <span className="block font-medium" style={{ color: d.color }}>
                {d.name[lang] ?? d.name.en}
              </span>
              <span className="block text-xs text-cal/55">{d.desc[lang] ?? d.desc.en}</span>
              <span className="mt-1 block text-xs text-cal/40">{t("nexo.freeParcels", { n: free })}</span>
            </button>
          );
        })}
      </div>
      {district && (
        <>
          <p className="mb-1.5 mt-4 text-sm text-cal/70">{t("projects.parcel")}</p>
          <ParcelMap district={district} value={parcel} onChange={setParcel} />
          <p className="mt-2 text-xs text-cal/40">{t("projects.parcelHint")}</p>
        </>
      )}
      <Label htmlFor="pj-summary">{t("projects.summary")}</Label>
      <textarea id="pj-summary" maxLength={280} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} className={input} />

      <p className="mb-1.5 mt-4 text-sm text-cal/70">{t("projects.cover")}</p>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-cal/25 px-4 py-2.5 text-sm text-cal/80 hover:border-neon hover:text-cal">
        <span aria-hidden>🖼</span>
        {t("projects.coverChoose")}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setCoverError("");
            try {
              setCover(await prepareCover(file));
            } catch (err) {
              setCover(null);
              setCoverError(errorText(err));
            }
          }}
        />
      </label>
      {cover && <img src={cover.preview} alt="" className="mt-3 aspect-video w-full max-w-sm rounded-xl border border-cal/10 object-cover" />}
      {coverError && <Notice tone="error">{coverError}</Notice>}
      <p className="mt-2 text-xs text-cal/40">{t("projects.coverHint")}</p>

      <p className="mb-1.5 mt-4 text-sm text-cal/70">{t("projects.monument")}</p>
      <ModelPicker kind="monument" accept=".glb" onReady={setModel} />
      <p className="mt-2 text-xs text-cal/40">{t("projects.modelHint")}</p>
      <div className="mt-4 flex gap-2">
        <Button type="submit" variant="primary" disabled={state === "sending" || !ready}>
          {state === "sending" ? t("projects.publishing") : t("projects.submit")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
      {message && <Notice tone={state === "error" ? "error" : "ok"}>{message}</Notice>}
    </form>
  );
}

/**
 * Plano del distrito (visto desde arriba, el norte arriba): avenida, calles y las 16 parcelas.
 * Las ocupadas no se pueden elegir; la elegida se marca con el color del distrito.
 */
function ParcelMap({ district, value, onChange }: { district: DistrictInfo; value: string; onChange: (id: string) => void }) {
  const pct = (v: number) => `${(v / 64) * 100}%`;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-xl border border-cal/10 bg-[#0b0f18]">
      {/* Avenida y calles */}
      <div className="absolute bg-cal/[0.07]" style={{ left: pct(27), width: pct(10), top: 0, bottom: 0 }} />
      <div className="absolute bg-cal/[0.07]" style={{ top: pct(16), height: pct(4), left: 0, right: 0 }} />
      <div className="absolute bg-cal/[0.07]" style={{ top: pct(44), height: pct(4), left: 0, right: 0 }} />
      {/* Puerta al nexo */}
      <div className="absolute rounded-sm" style={{ left: pct(28), width: pct(8), top: pct(61), height: pct(1.2), background: district.color }} />
      <span className="absolute -translate-x-1/2 text-[10px] text-cal/45" style={{ left: "50%", top: pct(56.5) }}>
        {t("projects.gate")}
      </span>
      {district.parcels.map((q) => {
        const taken = !!q.project_id;
        const on = q.id === value;
        return (
          <button
            type="button"
            key={q.id}
            disabled={taken}
            title={taken ? (q.title ?? "") : q.id}
            aria-label={taken ? `${q.id}: ${q.title ?? ""}` : q.id}
            aria-pressed={on}
            onClick={() => onChange(q.id)}
            className="absolute flex flex-col items-center justify-center rounded-md border text-xs transition"
            style={{
              left: pct(q.x - 5),
              top: pct(q.z - 5),
              width: pct(10),
              height: pct(10),
              borderColor: on ? district.color : taken ? "transparent" : `${district.color}66`,
              background: on ? `${district.color}40` : taken ? "rgb(255 255 255 / 0.06)" : "transparent",
              color: taken ? "rgb(246 241 231 / 0.35)" : "rgb(246 241 231 / 0.85)",
            }}
          >
            <span className="font-medium">{q.id}</span>
            {taken && <span className="line-clamp-1 px-0.5 text-[9px]">{q.title}</span>}
            {/* La raya marca hacia dónde mira el portal (su calle) */}
            <span
              aria-hidden
              className="absolute left-1/2 h-0.5 w-1/2 -translate-x-1/2 rounded-full"
              style={{ background: district.color, opacity: taken ? 0.25 : 0.8, ...(q.facing === 0 ? { bottom: 3 } : { top: 3 }) }}
            />
          </button>
        );
      })}
    </div>
  );
}
