import { lazy, Suspense, useEffect, useState } from "react";
import { ControlsSettings, ScreenSettings } from "./ControlsSettings";
import { assetUrl } from "../config";
import { errorText, LANGS, legalPath, setLang, t, useLang, type Key } from "../i18n";
import { detectGpu, TIERS, useGraphics, type Tier } from "../world/graphics";
import {
  addPasskey,
  authMethods,
  deleteAccount,
  exportData,
  googleLink,
  googleStart,
  googleUnlink,
  login,
  myLogins,
  type Logins,
  logout,
  mySkins,
  passkeysSupported,
  register,
  removeSkin,
  rename,
  setAvatar,
  type Skin,
  uploadModel,
  useAccount,
  useSkinsVersion,
  type PreparedModel,
} from "../net/account";
import { reconnect } from "../net/session";
import { AVATAR_PRESETS, presetByHash, setChosenPreset, useChosenPreset } from "../world/presets";
import type { PreviewPose } from "./AvatarPreview";
import { CardSettings } from "./CardSettings";
import { JamAdmin } from "./JamAdmin";
import { ModeratorsAdmin } from "./ModeratorsAdmin";
import { Moderation, useRoles } from "./Moderation";
import { ConnectedGames } from "./Games";
import { ModelPicker } from "./ModelPicker";
import { Block, Button, card, input, Label, Notice, Segmented } from "./ui";

export interface CustomizeProps {
  guestName: string;
  setGuestName: (n: string) => void;
  /** Aviso al volver de Google (error o vinculado). */
  authNotice?: { tone: "ok" | "error"; text: string } | null;
}

/** La vista previa 3D se descarga aparte (Three.js) y solo cuando se ve la sección Cuenta. */
const AvatarPreview = lazy(() => import("./AvatarPreview"));

/** Cuenta: quién eres (cuenta o invitado), tu personaje con su vista previa y tu armario. */
export function AccountSection(props: CustomizeProps) {
  const user = useAccount();
  const { moderator, founder } = useRoles(user?.id);
  return (
    <>
      <Block title={t("account.title")}>
        {props.authNotice && <Notice tone={props.authNotice.tone}>{props.authNotice.text}</Notice>}
        {user ? <SignedIn /> : <SignedOut />}
      </Block>

      <Block title={t("avatar.title")}>
        <Wardrobe />
      </Block>

      {moderator && (
        <Block title={t("mod.title")}>
          <Moderation />
        </Block>
      )}
      {moderator && (
        <Block title={t("jamAdmin.title")}>
          <JamAdmin />
        </Block>
      )}
      {moderator && (
        <Block title={t("modTeam.title")}>
          <ModeratorsAdmin founder={founder} />
        </Block>
      )}

      {user && (
        <Block title={t("card.mine")}>
          <CardSettings />
        </Block>
      )}

      {user && (
        <Block title={t("connected.title")}>
          <ConnectedGames />
        </Block>
      )}

      {!user && (
        <Block title={t("customize.name")}>
          <input
            id="guest-name"
            aria-label={t("customize.name")}
            value={props.guestName}
            maxLength={32}
            onChange={(e) => props.setGuestName(e.target.value)}
            className={`${input} max-w-sm`}
          />
          <p className="mt-2 text-xs text-cal/40">{t("customize.nameNote")}</p>
        </Block>
      )}
    </>
  );
}

/** Personalizar: cómo se ve y se oye xenxo en este equipo (calidad, ambiente e idioma). */
export function CustomizeSection() {
  const lang = useLang();
  return (
    <>
      <Block title={t("customize.quality")}>
        <GraphicsSettings />
        <p className="mb-1 mt-6 text-sm text-cal/70">{t("customize.language")}</p>
        <Segmented value={lang} onChange={setLang} options={LANGS} />
      </Block>
      <Block title={t("controls.title")}>
        <ControlsSettings />
      </Block>
      <Block title={t("screen.title")}>
        <ScreenSettings />
      </Block>
    </>
  );
}

type Look = { hash: string; name: string; own: boolean };

/**
 * Tu personaje: vista previa (girable, con gestos), tus personajes propios (hasta 3) y los de
 * serie. Pulsar uno lo enseña en la vista previa; «Ponérmelo» lo viste en todo el mundo.
 * Sin cuenta, solo los de serie (se guardan en este navegador).
 */
function Wardrobe() {
  const user = useAccount();
  const chosen = useChosenPreset();
  const version = useSkinsVersion();
  const [skins, setSkins] = useState<Skin[] | null>(null);
  const [max, setMax] = useState(3);
  const [selected, setSelected] = useState<string | null>(null);
  const [pose, setPose] = useState<PreviewPose>("idle");
  const [view, setView] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!user) return setSkins([]);
    let alive = true;
    mySkins()
      .then((r) => {
        if (!alive) return;
        setSkins(r.skins);
        setMax(r.max);
      })
      .catch(() => alive && setSkins([]));
    return () => {
      alive = false;
    };
  }, [user?.id, version]);

  const worn = user ? user.avatar_hash : (chosen?.hash ?? null);
  const own: Look[] = (skins ?? []).map((k, i) => ({ hash: k.hash, name: k.label || t("wardrobe.slot", { n: i + 1 }), own: true }));
  const presets: Look[] = AVATAR_PRESETS.map((p) => ({ hash: p.hash, name: p.name, own: false }));
  const all = [...own, ...presets];
  const shownHash = selected ?? worn ?? AVATAR_PRESETS[0]!.hash;
  const shown = all.find((l) => l.hash === shownHash) ?? { hash: shownHash, name: t("wardrobe.yours"), own: true };
  const isWorn = shown.hash === worn;

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      if (ok) setNote({ tone: "ok", text: ok });
    } catch (e) {
      setNote({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const wear = (look: Look) =>
    run(async () => {
      if (user) await setAvatar(look.hash);
      else {
        setChosenPreset(AVATAR_PRESETS.find((p) => p.hash === look.hash)?.id ?? null);
        reconnect();
      }
      setSelected(null);
    }, t("avatar.done"));

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,15rem)_1fr]">
      {/* Vista previa */}
      <div className={`${card} flex flex-col overflow-hidden`}>
        <div className="relative aspect-square w-full sm:aspect-[4/5] bg-[radial-gradient(circle_at_50%_75%,rgb(62_230_255/0.14),transparent_65%)]">
          <Suspense fallback={null}>
            <AvatarPreview url={assetUrl(shown.hash)} pose={pose} onState={setView} />
          </Suspense>
          {view !== "ready" && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-cal/50">
              {view === "error" ? t("wardrobe.previewError") : t("wardrobe.loading")}
            </p>
          )}
          <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-noche/70 px-2 py-0.5 text-xs text-cal/80">{shown.name}</span>
        </div>
        <div className="flex flex-wrap justify-center gap-1 border-t border-cal/10 p-2" role="group" aria-label={t("wardrobe.poses")}>
          {(["idle", "walk", "dance", "wave"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPose(p)}
              aria-pressed={pose === p}
              className={`rounded-lg px-2 py-1 text-xs ${pose === p ? "bg-neon/15 text-cal" : "text-cal/55 hover:text-cal"}`}
            >
              {t(`wardrobe.pose.${p}` as Key)}
            </button>
          ))}
        </div>
        <div className="border-t border-cal/10 p-3">
          {isWorn ? (
            <p className="text-center text-sm text-neon-suave">✓ {t("wardrobe.wearing")}</p>
          ) : (
            <Button variant="primary" className="w-full" disabled={busy || (shown.own && !user)} onClick={() => void wear(shown)}>
              {t("wardrobe.wear")}
            </Button>
          )}
          {!worn && <p className="mt-2 text-center text-xs text-cal/40">{t("wardrobe.randomNote")}</p>}
        </div>
      </div>

      <div className="min-w-0">
        {/* Tus personajes */}
        <p className="mb-2 text-sm font-medium text-cal/80">
          {t("wardrobe.mine")} <span className="font-normal text-cal/45">({own.length}/{max})</span>
        </p>
        {!user ? (
          <Notice>{t("avatar.needAccount")}</Notice>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {Array.from({ length: max }, (_, i) => {
              const look = own[i];
              if (!look) {
                return (
                  <li key={`free-${i}`}>
                    <button
                      onClick={() => setAdding(true)}
                      className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-cal/20 text-center text-xs text-cal/45 hover:border-neon hover:text-cal"
                    >
                      <span aria-hidden className="text-xl">+</span>
                      {t("wardrobe.add")}
                    </button>
                  </li>
                );
              }
              const on = look.hash === shown.hash;
              return (
                <li key={look.hash} className="relative">
                  <button
                    onClick={() => setSelected(look.hash)}
                    aria-pressed={on}
                    className={`flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border bg-gradient-to-b from-cal/[0.08] to-transparent p-2 text-center transition ${
                      on ? "border-neon ring-2 ring-neon/40" : "border-cal/10 hover:border-cal/30"
                    }`}
                  >
                    <span aria-hidden className="text-2xl text-neon-suave">◈</span>
                    <span className="line-clamp-2 break-all text-xs text-cal/85">{look.name}</span>
                    {look.hash === worn && <span className="text-[10px] uppercase tracking-wide text-neon-suave">{t("wardrobe.on")}</span>}
                  </button>
                  {removing === look.hash ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-noche/90 p-2 text-center text-xs text-cal/80">
                      {t("wardrobe.removeConfirm")}
                      <div className="flex gap-1">
                        <button
                          className="rounded-md bg-red-500/20 px-2 py-1 text-red-100 hover:bg-red-500/30"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await removeSkin(look.hash);
                              setRemoving(null);
                              if (selected === look.hash) setSelected(null);
                            }, t("wardrobe.removed"))
                          }
                        >
                          {t("wardrobe.remove")}
                        </button>
                        <button className="rounded-md px-2 py-1 text-cal/60 hover:text-cal" onClick={() => setRemoving(null)}>
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setRemoving(look.hash)}
                      aria-label={`${t("wardrobe.remove")} ${look.name}`}
                      className="absolute right-1 top-1 rounded-md px-1.5 text-sm text-cal/40 hover:bg-cal/10 hover:text-cal"
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {user && adding && (
          <SkinUploader
            full={own.length >= max}
            onSaved={(hash) => {
              setSelected(hash);
              setAdding(false);
            }}
            onClose={() => setAdding(false)}
          />
        )}

        {/* De serie */}
        <p className="mb-2 mt-6 text-sm font-medium text-cal/80">{t("wardrobe.presets")}</p>
        <div className="grid grid-cols-4 gap-2">
          {presets.map((look) => {
            const p = presetByHash(look.hash)!;
            const on = look.hash === shown.hash;
            return (
              <button
                key={p.id}
                onClick={() => setSelected(look.hash)}
                aria-pressed={on}
                className={`group relative overflow-hidden rounded-xl border bg-gradient-to-b from-cal/[0.08] to-transparent transition ${
                  on ? "border-neon ring-2 ring-neon/40" : "border-cal/10 hover:border-cal/30"
                }`}
              >
                <img src={`/avatars/${p.id}.webp`} alt="" loading="lazy" className="aspect-square w-full object-cover object-top transition group-hover:scale-105" />
                <span className="absolute inset-x-0 bottom-0 bg-noche/70 py-0.5 text-center text-xs text-cal/90">
                  {p.name}
                  {look.hash === worn ? " ✓" : ""}
                </span>
              </button>
            );
          })}
        </div>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
      </div>
    </div>
  );
}

/** Calidad gráfica según el equipo (automática o elegida) y ambiente día/noche. */
function GraphicsSettings() {
  const g = useGraphics();
  const gpu = detectGpu();
  const tierLabel = (tier: Tier) => t(`gfx.tier.${tier}` as Key);
  return (
    <>
      <Segmented
        value={g.pref}
        onChange={(v) => g.setPref(v)}
        options={[
          { id: "auto", label: t("gfx.auto") },
          ...TIERS.map((tier) => ({ id: tier, label: tierLabel(tier) })),
        ]}
      />
      <p className="mt-2 text-xs text-cal/45">
        {g.pref === "auto"
          ? t("gfx.autoNow", { tier: tierLabel(g.tier), reason: t(`gfx.reason.${gpu.reason}` as Key) })
          : t("gfx.manual", { tier: tierLabel(g.tier) })}
      </p>
      <p className="mt-1 text-xs text-cal/35">{t(`gfx.desc.${g.tier}` as Key)}</p>
      <p className="mb-1 mt-6 text-sm text-cal/70">{t("gfx.ambience")}</p>
      <Segmented
        value={g.ambiencePref}
        onChange={(v) => g.setAmbience(v)}
        options={[
          { id: "auto", label: t("gfx.ambience.auto") },
          { id: "day", label: t("gfx.ambience.day") },
          { id: "night", label: t("gfx.ambience.night") },
        ]}
      />
    </>
  );
}

export function SignedOut() {
  const [name, setName] = useState("");
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const google = useGoogleEnabled();
  const passkeys = passkeysSupported();
  if (!passkeys && !google) return <Notice tone="error">{t("account.noPasskeys")}</Notice>;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      // Cancelar el diálogo de la passkey no es un error que haya que enseñar.
      if ((e as Error).name !== "NotAllowedError") setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${card} p-4`}>
      <p className="text-sm text-cal/70">{t("account.intro")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => register(name, age, terms));
        }}
      >
        <Label htmlFor="acc-name">{t("customize.name")}</Label>
        <input id="acc-name" required minLength={2} maxLength={32} value={name} onChange={(e) => setName(e.target.value)} className={`${input} max-w-sm`} />
        <label className="mt-4 flex items-start gap-2 text-sm text-cal/80">
          <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} className="mt-1 accent-neon" />
          {t("account.age")}
        </label>
        <label className="mt-2 flex items-start gap-2 text-sm text-cal/80">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1 accent-neon" />
          <span>
            {t("account.termsPrefix")}{" "}
            <a href={legalPath("terms")} target="_blank" rel="noreferrer" className="text-azulejo-claro underline">
              {t("account.termsLink")}
            </a>{" "}
            {t("account.and")}{" "}
            <a href={legalPath("privacy")} target="_blank" rel="noreferrer" className="text-azulejo-claro underline">
              {t("account.privacyLink")}
            </a>
          </span>
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          {passkeys && (
            <Button type="submit" variant="primary" disabled={busy || !age || !terms || name.trim().length < 2}>
              {t("account.create")}
            </Button>
          )}
          {google && (
            <Button
              disabled={busy || !age || !terms || name.trim().length < 2}
              onClick={() => googleStart("register", { name: name.trim(), age, terms })}
            >
              {t("account.createGoogle")}
            </Button>
          )}
        </div>
      </form>
      <div className="mt-5 border-t border-cal/10 pt-4">
        <p className="text-sm text-cal/60">{t("account.haveOne")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {passkeys && (
            <Button disabled={busy} onClick={() => void run(login)}>
              {t("account.login")}
            </Button>
          )}
          {google && (
            <Button disabled={busy} onClick={() => googleStart("login")}>
              {t("account.loginGoogle")}
            </Button>
          )}
        </div>
        {google && <p className="mt-2 text-xs text-cal/40">{t("account.googleNote")}</p>}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function SignedIn() {
  const user = useAccount()!;
  const [name, setName] = useState(user.display_name);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const act = async (fn: () => Promise<void>, ok?: string) => {
    setNote(null);
    try {
      await fn();
      if (ok) setNote({ tone: "ok", text: ok });
    } catch (e) {
      setNote({ tone: "error", text: errorText(e) });
    }
  };

  return (
    <div className={`${card} p-4`}>
      <p className="text-sm text-cal/80">
        {t("account.signedAs", { name: user.display_name })}
        {user.player_no != null && (
          <span className="ml-2 rounded-md border border-neon/40 px-1.5 py-0.5 font-mono text-xs text-neon">
            {t("account.playerNo", { n: String(user.player_no) })}
          </span>
        )}
      </p>
      <form
        className="mt-3 flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => rename(name), t("account.saved"));
        }}
      >
        <input aria-label={t("customize.name")} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} className={input} />
        <Button type="submit" disabled={name.trim() === user.display_name || name.trim().length < 2}>
          {t("account.save")}
        </Button>
      </form>
      <LoginMethods onNote={setNote} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void act(exportData)}>{t("account.export")}</Button>
        <Button variant="ghost" onClick={logout}>
          {t("account.logout")}
        </Button>
        {!confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {t("account.delete")}
          </Button>
        ) : null}
      </div>
      {confirming && (
        <div className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
          <p>{t("account.deleteConfirm")}</p>
          <div className="mt-2 flex gap-2">
            <Button variant="danger" onClick={() => void act(deleteAccount)}>
              {t("account.delete")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
    </div>
  );
}

/** ¿Está activado «Entrar con Google» en el servidor? */
function useGoogleEnabled() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void authMethods().then((m) => alive && setOn(m.google));
    return () => {
      alive = false;
    };
  }, []);
  return on;
}

/** Formas de entrar de la cuenta: passkeys (añadir otra) y Google (vincular o quitar). */
function LoginMethods({ onNote }: { onNote: (n: { tone: "ok" | "error"; text: string } | null) => void }) {
  const [info, setInfo] = useState<Logins | null>(null);
  const load = () =>
    myLogins()
      .then(setInfo)
      .catch(() => setInfo(null));
  useEffect(() => {
    void load();
  }, []);
  if (!info) return null;
  const run = async (fn: () => Promise<void>, ok?: string) => {
    onNote(null);
    try {
      await fn();
      if (ok) onNote({ tone: "ok", text: ok });
      await load();
    } catch (e) {
      if ((e as Error).name !== "NotAllowedError") onNote({ tone: "error", text: errorText(e) });
    }
  };
  return (
    <div className="mt-5 border-t border-cal/10 pt-4">
      <p className="text-sm font-medium text-cal/80">{t("account.logins")}</p>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        <li className="flex flex-wrap items-center gap-3">
          <span className="text-cal/70">{t("account.passkeys", { n: info.passkeys.length })}</span>
          {passkeysSupported() && (
            <Button variant="ghost" onClick={() => void run(addPasskey, t("account.passkeyAdded"))}>
              {t("account.addPasskey")}
            </Button>
          )}
        </li>
        {(info.google_available || info.google) && (
          <li className="flex flex-wrap items-center gap-3">
            <span className="text-cal/70">{info.google ? t("account.googleLinked") : t("account.googleNotLinked")}</span>
            {info.google ? (
              <Button variant="ghost" disabled={info.passkeys.length === 0} onClick={() => void run(googleUnlink, t("account.googleUnlinked"))}>
                {t("account.unlinkGoogle")}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => void run(googleLink)}>
                {t("account.linkGoogle")}
              </Button>
            )}
          </li>
        )}
      </ul>
      {info.google && info.passkeys.length === 0 && <p className="mt-1 text-xs text-cal/40">{t("account.addPasskeyHint")}</p>}
    </div>
  );
}

/** Subir un personaje propio: se valida y optimiza en el navegador, entra en el armario y te lo pones. */
function SkinUploader({ full, onSaved, onClose }: { full: boolean; onSaved: (hash: string) => void; onClose: () => void }) {
  const [model, setModel] = useState<PreparedModel | null>(null);
  const [label, setLabel] = useState("");
  const [state, setState] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState("");

  return (
    <div className={`${card} relative mt-3 p-4`}>
      <button onClick={onClose} aria-label={t("common.cancel")} className="absolute right-2 top-2 rounded-md px-2 text-cal/40 hover:bg-cal/10 hover:text-cal">
        ×
      </button>
      <p className="pr-6 text-sm text-cal/70">{t("avatar.intro")}</p>
      <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-cal/60">
        <li>{t("avatar.blender")}</li>
        <li>{t("avatar.vroid")}</li>
        <li>{t("avatar.other")}</li>
      </ul>
      <p className="mt-2 text-xs text-cal/40">{t("avatar.budget")}</p>
      {full ? (
        <Notice>{t("wardrobe.full")}</Notice>
      ) : (
        <div className="mt-4">
          <ModelPicker
            kind="avatar"
            accept=".glb,.vrm"
            onReady={(m, name) => {
              setModel(m);
              if (name) setLabel(name.slice(0, 32));
            }}
          />
          {model && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="skin-label">{t("wardrobe.label")}</Label>
                <input id="skin-label" value={label} maxLength={32} onChange={(e) => setLabel(e.target.value)} className={`${input} max-w-[14rem]`} />
              </div>
              <Button
                variant="primary"
                disabled={state === "uploading"}
                onClick={async () => {
                  setState("uploading");
                  try {
                    const up = await uploadModel(model, "avatar");
                    await setAvatar(up.hash, label.trim() || undefined);
                    setState("idle");
                    setModel(null);
                    onSaved(up.hash);
                  } catch (e) {
                    setState("error");
                    setError(errorText(e));
                  }
                }}
              >
                {state === "uploading" ? t("avatar.uploading") : t("avatar.upload")}
              </Button>
            </div>
          )}
          {state === "error" && <Notice tone="error">{error}</Notice>}
        </div>
      )}
    </div>
  );
}
