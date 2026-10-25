import { useState } from "react";
import { errorText, LANGS, legalPath, setLang, t, useLang, type Key } from "../i18n";
import { detectGpu, TIERS, useGraphics, type Tier } from "../world/graphics";
import {
  deleteAccount,
  exportData,
  login,
  logout,
  passkeysSupported,
  register,
  rename,
  setAvatar,
  uploadModel,
  useAccount,
  type PreparedModel,
} from "../net/account";
import { reconnect } from "../net/session";
import { AVATAR_PRESETS, setChosenPreset, useChosenPreset } from "../world/presets";
import { ModelPicker } from "./ModelPicker";
import { Block, Button, card, input, Label, Notice, Segmented } from "./ui";

export interface CustomizeProps {
  guestName: string;
  setGuestName: (n: string) => void;
}

/** Personalizar: cuenta, personaje propio, nombre, calidad e idioma. */
export function CustomizeSection(props: CustomizeProps) {
  const lang = useLang();
  const user = useAccount();

  return (
    <>
      <Block title={t("account.title")}>{user ? <SignedIn /> : <SignedOut />}</Block>

      <Block title={t("avatar.title")}>
        <AvatarPresets />
        <AvatarUploader />
      </Block>

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

      <Block title={t("customize.quality")}>
        <GraphicsSettings />
        <p className="mb-1 mt-6 text-sm text-cal/70">{t("customize.language")}</p>
        <Segmented value={lang} onChange={setLang} options={LANGS} />
      </Block>
    </>
  );
}

/**
 * Personajes de serie (realistas y animados). Con cuenta se guardan en ella; sin cuenta,
 * en este navegador, y la plaza los ve igual.
 */
function AvatarPresets() {
  const user = useAccount();
  const chosen = useChosenPreset();
  const [busy, setBusy] = useState<string | null>(null);
  const current = user ? user.avatar_hash : chosen?.hash;
  const pick = async (id: string, hash: string) => {
    setBusy(id);
    try {
      if (user) await setAvatar(hash);
      else {
        setChosenPreset(id);
        reconnect();
      }
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mb-4">
      <p className="mb-3 text-sm text-cal/70">{t("avatar.presetsIntro")}</p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {AVATAR_PRESETS.map((p) => {
          const on = current === p.hash;
          return (
            <button
              key={p.id}
              onClick={() => void pick(p.id, p.hash)}
              disabled={busy !== null}
              aria-pressed={on}
              className={`group relative overflow-hidden rounded-xl border bg-gradient-to-b from-cal/[0.08] to-transparent transition ${
                on ? "border-neon ring-2 ring-neon/40" : "border-cal/10 hover:border-cal/30"
              }`}
            >
              <img src={`/avatars/${p.id}.webp`} alt="" loading="lazy" className="aspect-square w-full object-cover object-top transition group-hover:scale-105" />
              <span className="absolute inset-x-0 bottom-0 bg-noche/70 py-0.5 text-center text-xs text-cal/90">{busy === p.id ? "…" : p.name}</span>
            </button>
          );
        })}
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

function SignedOut() {
  const [name, setName] = useState("");
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!passkeysSupported()) return <Notice tone="error">{t("account.noPasskeys")}</Notice>;

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
        <Button type="submit" variant="primary" className="mt-4" disabled={busy || !age || !terms || name.trim().length < 2}>
          {t("account.create")}
        </Button>
      </form>
      <div className="mt-5 border-t border-cal/10 pt-4">
        <p className="text-sm text-cal/60">{t("account.haveOne")}</p>
        <Button className="mt-2" disabled={busy} onClick={() => void run(login)}>
          {t("account.login")}
        </Button>
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
      <p className="text-sm text-cal/80">{t("account.signedAs", { name: user.display_name })}</p>
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

function AvatarUploader() {
  const user = useAccount();
  const [model, setModel] = useState<PreparedModel | null>(null);
  const [state, setState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [error, setError] = useState("");

  return (
    <div className={`${card} p-4`}>
      <p className="text-sm text-cal/70">{t("avatar.intro")}</p>
      <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-cal/60">
        <li>{t("avatar.blender")}</li>
        <li>{t("avatar.vroid")}</li>
        <li>{t("avatar.other")}</li>
      </ul>
      <p className="mt-2 text-xs text-cal/40">{t("avatar.budget")}</p>

      {!user ? (
        <Notice>{t("avatar.needAccount")}</Notice>
      ) : (
        <div className="mt-4">
          {user.avatar_hash && !AVATAR_PRESETS.some((p) => p.hash === user.avatar_hash) && state !== "done" && (
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-cal/70">
              {t("avatar.current")}
              <Button variant="ghost" onClick={() => void setAvatar(null)}>
                {t("avatar.remove")}
              </Button>
            </div>
          )}
          <ModelPicker kind="avatar" accept=".glb,.vrm" onReady={setModel} />
          {model && (
            <Button
              variant="primary"
              className="mt-3"
              disabled={state === "uploading"}
              onClick={async () => {
                setState("uploading");
                try {
                  const up = await uploadModel(model, "avatar");
                  await setAvatar(up.hash);
                  setState("done");
                  setModel(null);
                } catch (e) {
                  setState("error");
                  setError(errorText(e));
                }
              }}
            >
              {state === "uploading" ? t("avatar.uploading") : t("avatar.upload")}
            </Button>
          )}
          {state === "done" && <Notice tone="ok">{t("avatar.done")}</Notice>}
          {state === "error" && <Notice tone="error">{error}</Notice>}
        </div>
      )}
    </div>
  );
}
