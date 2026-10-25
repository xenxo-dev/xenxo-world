import { useCallback, useEffect, useState } from "react";
import { REALTIME_URL } from "../config";
import { t, useLang } from "../i18n";
import {
  createProject,
  currentUser,
  deleteProject,
  listProjects,
  myProjects,
  uploadModel,
  useAccount,
  type PreparedModel,
  type Project,
} from "../net/account";
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
  const [model, setModel] = useState<PreparedModel | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");

  return (
    <form
      className={`${card} mb-4 p-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        setState("sending");
        setMessage("");
        try {
          const mesh = model ? (await uploadModel(model, "model")).hash : null;
          const r = await createProject({ title, summary, url, mesh_hash: mesh });
          setMessage(r.stand.ok ? t("projects.published") : t("projects.publishedNoStand"));
          setTimeout(onDone, 1800);
          setState("idle");
        } catch (err) {
          setState("error");
          setMessage((err as Error).message);
        }
      }}
    >
      <Label htmlFor="pj-title">{t("projects.title")}</Label>
      <input id="pj-title" required minLength={3} maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
      <Label htmlFor="pj-summary">{t("projects.summary")}</Label>
      <textarea id="pj-summary" maxLength={280} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} className={input} />
      <Label htmlFor="pj-url">{t("projects.url")}</Label>
      <input id="pj-url" type="url" pattern="https://.*" maxLength={300} value={url} onChange={(e) => setUrl(e.target.value)} className={input} placeholder="https://github.com/…" />
      <p className="mb-1.5 mt-4 text-sm text-cal/70">{t("projects.model")}</p>
      <ModelPicker kind="model" accept=".glb" onReady={setModel} />
      <p className="mt-2 text-xs text-cal/40">{t("projects.modelHint")}</p>
      <div className="mt-4 flex gap-2">
        <Button type="submit" variant="primary" disabled={state === "sending" || title.trim().length < 3}>
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
