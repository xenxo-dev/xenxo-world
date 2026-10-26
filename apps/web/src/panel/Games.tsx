import { useEffect, useState } from "react";
import { REALTIME_URL } from "../config";
import { errorText, t, type Key } from "../i18n";
import { deleteGame, myConnected, myGames, registerGame, revokeConnected, type ConnectedGame, type MyGame, type Project } from "../net/account";
import { Button, card, input, Label, Notice } from "./ui";

const SDK_URL = `${typeof location !== "undefined" ? location.origin : "https://xenxo.io"}/sdk/xenxo.mjs`;

/** Cuenta → Juegos conectados: a quién has dado tu identidad y quitárselo. */
export function ConnectedGames() {
  const [list, setList] = useState<ConnectedGame[] | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    myConnected()
      .then(setList)
      .catch(() => setList([]));
  useEffect(() => {
    void load();
  }, []);
  if (!list) return null;
  return (
    <div className={`${card} p-4`}>
      <p className="text-sm text-cal/70">{t("connected.intro")}</p>
      {list.length === 0 && <p className="mt-3 text-sm text-cal/45">{t("connected.none")}</p>}
      <ul className="mt-3 flex flex-col gap-2">
        {list.map((g) => (
          <li key={g.client_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-cal/10 px-3 py-2 text-sm">
            <span className="font-medium text-cal">{g.name}</span>
            <span className="font-mono text-xs text-cal/50">{g.host}</span>
            <span className="text-xs text-cal/50">{g.scopes.filter((s) => s !== "openid").map((s) => t(`connected.scope.${s}` as Key)).join(" · ") || t("connected.scope.openid")}</span>
            <button
              className="ml-auto text-xs text-red-200/70 hover:text-red-200"
              onClick={() =>
                void revokeConnected(g.client_id)
                  .then(load)
                  .catch((e) => setError(errorText(e)))
              }
            >
              {t("connected.revoke")}
            </button>
          </li>
        ))}
      </ul>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

/** Proyectos → «Entrar con xenxo» en tu juego: registrar juegos (clientes OpenID Connect). */
export function MyGames({ projects }: { projects: Project[] }) {
  const [games, setGames] = useState<MyGame[] | null>(null);
  const [name, setName] = useState("");
  const [uris, setUris] = useState("");
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () =>
    myGames()
      .then(setGames)
      .catch(() => setGames([]));
  useEffect(() => {
    void load();
  }, []);

  const snippet = (g: MyGame) =>
    `<script type="module">\n  import { xenxo } from "${SDK_URL}";\n  const jugador = await xenxo.connect({\n    clientId: "${g.client_id}",\n    redirectUri: "${g.redirect_uris[0]}",\n    scopes: ["profile", "player", "avatar"],${g.project_id ? `\n    project: "${g.project_id}", // xenxo.back() vuelve delante de su portal` : ""}${REALTIME_URL === "https://api.xenxo.io" ? "" : `\n    issuer: "${REALTIME_URL}",`}\n  });\n  // null = aún sin entrar: xenxo.login() lo manda a dar permiso.\n  if (!jugador) document.querySelector("#entrar").onclick = () => xenxo.login();\n  else console.log(jugador.name, jugador.playerNo, jugador.avatar?.url);\n</script>`;

  // Con la plantilla (npm create xenxo), basta con esto en public/xenxo.json.
  const manifest = (g: MyGame) =>
    `"xenxo": {\n  "clientId": "${g.client_id}"${g.project_id ? `,\n  "project": "${g.project_id}"` : ""}\n}`;

  return (
    <div className={`${card} p-4`}>
      <p className="text-sm text-cal/75">{t("games.intro")}</p>
      {games?.map((g) => (
        <div key={g.client_id} className="mt-4 rounded-lg border border-cal/10 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-cal">{g.name}</span>
            <span className="font-mono text-xs text-neon-suave">{g.client_id}</span>
            <button className="ml-auto text-xs text-red-200/70 hover:text-red-200" onClick={() => void deleteGame(g.client_id).then(load)}>
              {t("games.delete")}
            </button>
          </div>
          <p className="mt-1 break-all font-mono text-xs text-cal/50">{g.redirect_uris.join(" · ")}</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-cal/70">{t("games.howto")}</summary>
            <p className="mt-2 text-xs text-cal/60">{t("games.template")}</p>
            <pre className="mt-1 overflow-x-auto whitespace-pre rounded-lg border border-cal/10 bg-noche/70 p-3 font-mono text-xs text-cal/85">{manifest(g)}</pre>
            <p className="mt-3 text-xs text-cal/60">{t("games.script")}</p>
            <pre className="mt-1 overflow-x-auto whitespace-pre rounded-lg border border-cal/10 bg-noche/70 p-3 font-mono text-xs text-cal/85">{snippet(g)}</pre>
          </details>
        </div>
      ))}
      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const list = uris.split(/\s+/).map((u) => u.trim()).filter(Boolean);
          void registerGame(name.trim(), list, project || null)
            .then(() => {
              setName("");
              setUris("");
              return load();
            })
            .catch((err) => setError(errorText(err)))
            .finally(() => setBusy(false));
        }}
      >
        <div>
          <Label htmlFor="game-name">{t("games.name")}</Label>
          <input id="game-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className={`${input} max-w-sm`} />
        </div>
        <div>
          <Label htmlFor="game-uris">{t("games.uris")}</Label>
          <textarea id="game-uris" rows={2} value={uris} onChange={(e) => setUris(e.target.value)} placeholder="https://mijuego.example/" className={`${input} font-mono text-xs`} />
          <p className="mt-1 text-xs text-cal/40">{t("games.urisHint")}</p>
        </div>
        {projects.length > 0 && (
          <div>
            <Label htmlFor="game-project">{t("games.project")}</Label>
            <select id="game-project" value={project} onChange={(e) => setProject(e.target.value)} className={`${input} max-w-sm`}>
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <Button type="submit" variant="primary" disabled={busy || name.trim().length < 2 || !uris.trim()}>
            {t("games.register")}
          </Button>
        </div>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
