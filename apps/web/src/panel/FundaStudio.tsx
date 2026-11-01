/**
 * El configurador de fundas: base, cuerpo, cara, piel, pelo, ropa (con estampados e imágenes) y
 * acabados sintéticos o robóticos, con vista 3D al momento. Monta la funda en el navegador (fundas/),
 * la exporta a VRM con su receta dentro y la sube como cualquier otra.
 * Se carga aparte (Three.js y el kit) y solo cuando se abre.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { createPortal } from "react-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { checkBudget, inspectGlb } from "@xenxo/assets";
import { errorText, t, useLang, type Key } from "../i18n";
import { removeSkin, setAvatar, uploadModel, useAccount } from "../net/account";
import { loadKit, type Kit } from "../fundas/kit";
import { CLOTH_COLORS, cleanRecipe, defaultRecipe, EYE_SWATCH, HAIR_COLORS, PATTERNS, type Recipe, type Slot } from "../fundas/recipe";
import { buildPreview } from "../fundas/three";
import { Button, input, Notice } from "./ui";
import { PartGrid, Section, Sliders, Swatches, type Setter } from "./funda-ui";
import { Customize, preset, PRESETS, SkinTab, SynthTab } from "./FundaLooks";

type Tab = "base" | "body" | "face" | "skin" | "hair" | "clothes" | "synth";
const TABS: Tab[] = ["base", "body", "face", "skin", "hair", "clothes", "synth"];
const FACE_GROUPS: Record<string, string[]> = {
  head: ["head_width", "head_height", "head_depth", "head_fat", "head_round", "head_oval", "forehead", "forehead_slope"],
  eyes: ["eye_size", "eye_height", "eye_dist", "eye_angle", "eye_fold", "brow_height", "brow_angle"],
  nose: ["nose_width", "nose_length", "nose_depth", "nose_bridge", "nose_tip", "nostrils"],
  mouth: ["mouth_width", "mouth_height", "lip_upper", "lip_lower", "mouth_corners"],
  jaw: ["cheekbones", "cheeks", "jaw_width", "jaw_angle", "chin_height", "chin_forward", "chin_cleft"],
  ears: ["ear_size", "ear_out", "ear_point", "neck_width"],
};
const CLOTH_SLOTS: Slot[] = ["outfit", "top", "bottom", "shoes", "hat", "glasses", "gloves"];

export interface FundaEditing {
  hash: string;
  recipe: Recipe;
  label: string;
}

export default function FundaStudio({ onClose, onSaved, editing, full }: { onClose: () => void; onSaved: (hash: string) => void; editing?: FundaEditing | null; full: boolean }) {
  useLang();
  const user = useAccount();
  const [kit, setKit] = useState<Kit | null>(null);
  const [recipe, setRecipe] = useState<Recipe>(() => editing?.recipe ?? defaultRecipe("f"));
  const [tab, setTab] = useState<Tab>("base");
  const [group, setGroup] = useState<string>("head");
  const [name, setName] = useState(editing?.label ?? "");
  const [state, setState] = useState<"idle" | "saving" | "error" | "saved">("idle");
  const [error, setError] = useState("");
  const [model, setModel] = useState<{ group: THREE.Group; tris: number; top: number } | null>(null);
  const [cam, setCam] = useState<CamCmd>({ view: "body", n: 0, zoom: 1 });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadKit()
      .then((k) => {
        if (!alive) return;
        setKit(k);
        setRecipe((r) => cleanRecipe(r, k));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // La vista previa se rehace al cambiar la receta (con un respiro mientras se arrastra un ajuste).
  const latest = useRef(0);
  useEffect(() => {
    if (!kit) return;
    const n = ++latest.current;
    const id = window.setTimeout(() => {
      buildPreview(recipe)
        .then((m) => {
          if (n !== latest.current) return dispose(m.group);
          setModel((old) => {
            if (old) dispose(old.group);
            return m;
          });
        })
        .catch(() => setFailed(true));
    }, 70);
    return () => window.clearTimeout(id);
  }, [recipe, kit]);
  useEffect(() => () => setModel((old) => (old && dispose(old.group), null)), []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const set = (fn: (r: Recipe) => Recipe) => setRecipe((r) => (kit ? cleanRecipe(fn(r), kit) : fn(r)));
  // La pestaña elige la vista (cara para la cara y el pelo); los botones la cambian cuando se quiera.
  useEffect(() => setCam((c) => ({ ...c, view: tab === "face" || tab === "hair" || tab === "skin" ? "face" : "body" })), [tab]);
  const zoom = (f: number) => setCam((c) => ({ ...c, n: c.n + 1, zoom: f }));

  const save = async () => {
    if (!kit || !user) return;
    setState("saving");
    setError("");
    try {
      const { exportFunda } = await import("../fundas/export-vrm");
      const label = name.trim() || t("funda.title");
      const f = await exportFunda(recipe);
      const report = inspectGlb(f.bytes);
      const problems = checkBudget(report, "avatar");
      if (problems.length) throw new Error(t("funda.error"));
      const up = await uploadModel({ bytes: f.bytes, report, notes: [], problems }, "avatar");
      // Al editar, la nueva ocupa el sitio de la anterior.
      if (editing && editing.hash !== up.hash) await removeSkin(editing.hash);
      await setAvatar(up.hash, label.slice(0, 32));
      setState("saved");
      onSaved(up.hash);
    } catch (e) {
      setState("error");
      setError(errorText(e));
    }
  };

  const body = (
    <div className="fixed inset-0 z-50 flex flex-col bg-noche text-cal" role="dialog" aria-modal="true" aria-label={t("funda.title")}>
      <header className="flex items-center gap-3 border-b border-cal/10 px-4 py-3">
        <h2 className="display text-base font-semibold sm:text-lg">{t("funda.title")}</h2>
        {model && <span className="meta hidden text-xs text-cal/45 sm:inline">{t("funda.tris", { tris: model.tris })}</span>}
        <button onClick={onClose} className="ml-auto rounded-lg px-3 py-1 text-sm text-cal/70 hover:bg-cal/10 hover:text-cal">
          {t("funda.close")}
        </button>
      </header>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(14rem,42vh)_1fr] md:grid-cols-[minmax(0,1fr)_26rem] md:grid-rows-1">
        {/* Vista 3D */}
        <div className="relative min-h-0 bg-[radial-gradient(circle_at_50%_70%,rgb(62_230_255/0.12),transparent_65%)]">
          <Canvas dpr={[1, 1.75]} camera={{ position: [0, 1.0, 4.4], fov: 28 }} gl={{ antialias: true, alpha: true }}>
            <hemisphereLight args={["#dfe9ff", "#20182c", 1.2]} />
            <directionalLight position={[1.5, 3, 3]} intensity={2.1} />
            <directionalLight position={[-2.5, 1.6, -1.5]} intensity={1.2} color="#9beaff" />
            <Suspense fallback={null}>{model && <primitive object={model.group} />}</Suspense>
            <Floor />
            <CameraRig cmd={cam} top={model?.top ?? 1.7} />
          </Canvas>
          {!model && !failed && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-cal/50">{t("funda.loading")}</p>}
          {failed && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-200">{t("funda.error")}</p>}
          <p className="pointer-events-none absolute bottom-2 left-3 hidden text-xs text-cal/40 sm:block">{t("funda.dragHint")}</p>
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            <div className="flex overflow-hidden rounded-xl border border-cal/10 bg-noche/70 text-xs backdrop-blur">
              {(["body", "face"] as const).map((v) => (
                <button key={v} onClick={() => setCam((c) => ({ ...c, view: v }))} aria-pressed={cam.view === v} className={`px-3 py-1.5 ${cam.view === v ? "bg-neon/15 text-neon" : "text-cal/70 hover:text-cal"}`}>
                  {t(`funda.view.${v}` as Key)}
                </button>
              ))}
            </div>
            <div className="ml-auto flex gap-1.5">
              <button onClick={() => zoom(0.75)} aria-label={t("funda.zoomIn")} title={t("funda.zoomIn")} className="grid h-9 w-9 place-items-center rounded-xl border border-cal/10 bg-noche/70 text-lg text-cal/85 backdrop-blur hover:text-neon">
                +
              </button>
              <button onClick={() => zoom(1.33)} aria-label={t("funda.zoomOut")} title={t("funda.zoomOut")} className="grid h-9 w-9 place-items-center rounded-xl border border-cal/10 bg-noche/70 text-lg text-cal/85 backdrop-blur hover:text-neon">
                −
              </button>
            </div>
          </div>
        </div>
        {/* Controles */}
        <div className="flex min-h-0 flex-col border-t border-cal/10 md:border-l md:border-t-0">
          <div role="tablist" className="flex gap-0.5 overflow-x-auto border-b border-cal/10 p-2">
            {TABS.map((id) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm ${tab === id ? "bg-neon/15 text-neon" : "text-cal/65 hover:text-cal"}`}
              >
                {t(`funda.tab.${id}` as Key)}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!kit ? null : tab === "base" ? (
              <>
                <FromPhoto kit={kit} r={recipe} set={set} />
                <BaseTab kit={kit} r={recipe} set={set} />
              </>
            ) : tab === "body" ? (
              <>
                <Section title={t("funda.build")}>
                  <Sliders ids={kit.body} values={recipe.body} label={(id) => t(`funda.body.${id}` as Key)} onChange={(id, v) => set((r) => ({ ...r, body: { ...r.body, [id]: v } }))} />
                </Section>
                {kit.detail?.length ? (
                  <Section title={t("funda.detail")}>
                    <Sliders ids={kit.detail} values={recipe.body} label={(id) => t(`funda.body.${id}` as Key)} onChange={(id, v) => set((r) => ({ ...r, body: { ...r.body, [id]: v } }))} />
                  </Section>
                ) : null}
              </>
            ) : tab === "skin" ? (
              <SkinTab r={recipe} set={set} />
            ) : tab === "synth" ? (
              <SynthTab kit={kit} r={recipe} set={set} />
            ) : tab === "face" ? (
              <>
                <div className="mb-3 flex flex-wrap gap-1">
                  {Object.keys(FACE_GROUPS).map((g) => (
                    <button key={g} onClick={() => setGroup(g)} aria-pressed={group === g} className={`rounded-full border px-3 py-1 text-xs ${group === g ? "border-neon/60 text-neon" : "border-cal/15 text-cal/65 hover:text-cal"}`}>
                      {t(`funda.group.${g}` as Key)}
                    </button>
                  ))}
                </div>
                <Sliders ids={FACE_GROUPS[group]!.filter((id) => kit.face.includes(id))} values={recipe.face} label={(id) => t(`funda.face.${id}` as Key)} onChange={(id, v) => set((r) => ({ ...r, face: { ...r.face, [id]: v } }))} />
              </>
            ) : tab === "hair" ? (
              <HairTab kit={kit} r={recipe} set={set} />
            ) : (
              <ClothesTab kit={kit} r={recipe} set={set} />
            )}
          </div>
          <footer className="border-t border-cal/10 p-3">
            <div className="mb-2 flex gap-2">
              <Button onClick={() => kit && setRecipe(randomRecipe(kit, recipe.base))} className="flex-1 !py-1.5 text-xs">
                {t("funda.random")}
              </Button>
              <Button onClick={() => set((r) => ({ ...r, body: {}, face: {} }))} className="flex-1 !py-1.5 text-xs">
                {t("funda.reset")}
              </Button>
            </div>
            {user ? (
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor="funda-name" className="mb-1 block text-xs text-cal/60">
                    {t("funda.name")}
                  </label>
                  <input id="funda-name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} className={input} />
                </div>
                <Button variant="primary" disabled={!kit || !model || state === "saving" || (full && !editing)} onClick={() => void save()}>
                  {state === "saving" ? t("funda.saving") : t("funda.save")}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-cal/70">{t("funda.needAccount")}</p>
            )}
            {user && full && !editing && <Notice>{t("funda.full")}</Notice>}
            {state === "error" && <Notice tone="error">{error}</Notice>}
            {state === "saved" && <Notice tone="ok">{t("funda.saved")}</Notice>}
            <p className="mt-2 hidden text-[11px] text-cal/35 sm:block">{t("funda.credit")}</p>
          </footer>
        </div>
      </div>
    </div>
  );
  return createPortal(body, document.body);
}

function dispose(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    (m.material as THREE.Material).dispose(); // las texturas quedan en su caché (three.ts)
  });
}

const _off = new THREE.Vector3();
const _goal = new THREE.Vector3();

type View = "face" | "body";
/** Órdenes de la vista para la cámara (botones de zoom y de cara/cuerpo). */
export interface CamCmd {
  view: View;
  /** Se incrementa con cada pulsación de zoom; `zoom` es el factor de esa pulsación. */
  n: number;
  zoom: number;
}

/**
 * Cámara: va sola a la cara o al cuerpo entero (según la pestaña o los botones) a la altura real de
 * la funda; luego queda libre para girar, acercar o alejar (rueda, pellizco o botones) y desplazar.
 */
function CameraRig({ cmd, top }: { cmd: CamCmd; top: number }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const goal = useRef({ y: 0.9, dist: 4.4, active: true, level: true });
  const last = useRef({ view: "", top: 0, n: -1 });
  useEffect(() => {
    const c = controls.current;
    const g = goal.current;
    const l = last.current;
    if (cmd.view !== l.view || Math.abs(top - l.top) > 0.01) {
      // La cara: a la altura de los ojos (unos 11 cm bajo lo alto de la cabeza).
      g.y = cmd.view === "face" ? top - 0.11 : top * 0.52;
      g.dist = cmd.view === "face" ? 0.95 : Math.max(3, top * 2.65);
      g.active = true;
      g.level = true;
    } else if (cmd.n !== l.n && c) {
      g.y = c.target.y;
      g.dist = Math.min(7, Math.max(0.35, camera.position.distanceTo(c.target) * cmd.zoom));
      g.active = true;
      g.level = false;
    }
    last.current = { view: cmd.view, top, n: cmd.n };
  }, [cmd, top, camera]);
  useFrame((_, dt) => {
    const c = controls.current;
    const g = goal.current;
    if (!c || !g.active) return;
    const k = Math.min(1, dt * 6);
    _goal.set(0, g.y, 0);
    c.target.lerp(_goal, k);
    const off = _off.copy(camera.position).sub(c.target);
    const d = off.length();
    // Al cambiar de vista, la cámara vuelve a la altura de lo que mira (de frente, no desde arriba).
    if (g.level) off.y += (d * 0.06 - off.y) * k;
    off.setLength(d + (g.dist - d) * k);
    camera.position.copy(c.target).add(off);
    c.update();
    if (c.target.distanceTo(_goal) < 0.002 && Math.abs(d - g.dist) < 0.004 && (!g.level || Math.abs(off.y - d * 0.06) < 0.004)) g.active = false;
  });
  return (
    <OrbitControls
      ref={controls}
      enablePan
      screenSpacePanning
      enableZoom
      zoomSpeed={0.8}
      minDistance={0.35}
      maxDistance={7}
      minPolarAngle={Math.PI / 4}
      maxPolarAngle={Math.PI / 1.7}
      onStart={() => (goal.current.active = false)}
      onChange={() => {
        // Que el centro no se salga de la funda al desplazar.
        const c = controls.current;
        if (!c) return;
        c.target.x = Math.max(-0.6, Math.min(0.6, c.target.x));
        c.target.z = Math.max(-0.4, Math.min(0.4, c.target.z));
        c.target.y = Math.max(0.05, Math.min(top + 0.1, c.target.y));
      }}
    />
  );
}

/** Reflejos para los acabados de metal: un estudio neutro hecho en la GPU (como en el mundo). */
function StudioEnv() {
  const gl = useThree((st) => st.gl);
  const scene = useThree((st) => st.scene);
  const env = useMemo(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const tex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    return tex;
  }, [gl]);
  useEffect(() => {
    scene.environment = env;
    scene.environmentIntensity = 0.75;
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [scene, env]);
  return null;
}

function Floor() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.002}>
        <ringGeometry args={[0.62, 0.66, 64]} />
        <meshBasicMaterial color="#3ee6ff" toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.62, 64]} />
        <meshBasicMaterial color="#0b1220" transparent opacity={0.85} />
      </mesh>
    </group>
  );
}



/**
 * Funda desde una foto (opcional): se analiza en el dispositivo (fundas/photo.ts) y propone cara,
 * piel, ojos y pelo. La foto no se envía ni se guarda.
 */
function FromPhoto({ kit, r, set }: { kit: Kit; r: Recipe; set: Setter }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "no_face" | "turned" | "error">("idle");
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const run = async (file: File | undefined) => {
    if (!file) return;
    setState("working");
    const { fromPhoto } = await import("../fundas/photo");
    const res = await fromPhoto(file, kit, r);
    if (!res.ok) return setState(res.reason);
    set((x) => ({ ...x, ...res.patch, parts: { ...x.parts, ...res.patch.parts } }));
    setState("done");
  };
  const input = (ref: typeof camera, capture: boolean) => (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      {...(capture ? { capture: "user" as const } : {})}
      className="hidden"
      onChange={(e) => {
        void run(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );
  return (
    <Section title={t("funda.photo.title")}>
      <p className="mb-2 text-xs text-cal/60">{t("funda.photo.note")}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => camera.current?.click()} disabled={state === "working"} className="!py-1.5 text-xs">
          {t("funda.photo.take")}
        </Button>
        <Button onClick={() => gallery.current?.click()} disabled={state === "working"} className="!py-1.5 text-xs">
          {t("funda.photo.pick")}
        </Button>
      </div>
      {input(camera, true)}
      {input(gallery, false)}
      <p className="mt-2 text-[11px] text-cal/40">{state === "idle" ? `${t("funda.photo.tip")} ${t("funda.photo.size")}` : null}</p>
      {state === "working" && <p className="text-xs text-neon-suave">{t("funda.photo.working")}</p>}
      {state === "done" && <p className="text-xs text-neon-suave">{t("funda.photo.done")}</p>}
      {(state === "no_face" || state === "turned" || state === "error") && <p className="text-xs text-red-200">{t(`funda.photo.${state}` as Key)}</p>}
    </Section>
  );
}

function BaseTab({ kit, r, set }: { kit: Kit; r: Recipe; set: Setter }) {
  const skins = kit.skins.filter((s) => s.id.endsWith(`_${r.base}`));
  return (
    <>
      <Section title={t("funda.tab.base")}>
        <div className="inline-flex rounded-xl border border-cal/10 p-1">
          {(["f", "m"] as const).map((b) => (
            <button
              key={b}
              aria-pressed={r.base === b}
              onClick={() =>
                set((x) => ({
                  ...defaultRecipe(b),
                  body: x.body,
                  face: x.face,
                  hair: x.hair,
                  skin: x.skin.replace(/_[fm]$/, `_${b}`),
                  eyes: x.eyes,
                  skinTone: x.skinTone,
                  iris: x.iris,
                  looks: x.looks,
                  synth: x.synth,
                  parts: { ...defaultRecipe(b).parts, implant: x.parts.implant },
                }))
              }
              className={`rounded-lg px-4 py-1.5 text-sm ${r.base === b ? "bg-neon/20 text-cal" : "text-cal/60"}`}
            >
              {t(`funda.base.${b}` as Key)}
            </button>
          ))}
        </div>
      </Section>
      <Section title={t("funda.skin")}>
        <Swatches
          colors={skins.map((s) => ({ id: s.id, color: s.tone }))}
          value={r.skinTone ?? r.skin}
          onPick={(id) => set((x) => ({ ...x, skin: id, skinTone: undefined }))}
          custom={(c) => set((x) => ({ ...x, skinTone: c }))}
        />
      </Section>
      <Section title={t("funda.eyes")}>
        <Swatches
          colors={kit.eyes.map((e) => ({ id: e, color: EYE_SWATCH[e] ?? "#888888" }))}
          value={r.iris ?? r.eyes}
          onPick={(id) => set((x) => ({ ...x, eyes: id, iris: undefined }))}
          custom={(c) => set((x) => ({ ...x, iris: c }))}
        />
      </Section>
    </>
  );
}

function HairTab({ kit, r, set }: { kit: Kit; r: Recipe; set: Setter }) {
  const of = (cat: string) => kit.parts.filter((p) => p.cat === cat);
  const pick = (slot: Slot) => (id: string | null) => set((x) => ({ ...x, parts: { ...x.parts, [slot]: id ?? undefined } }));
  return (
    <>
      <Section title={t("funda.slot.hair")}>
        <PartGrid parts={of("hair")} value={r.parts.hair} onPick={pick("hair")} none />
      </Section>
      <Section title={t("funda.hairColor")}>
        <Swatches colors={HAIR_COLORS.map((c) => ({ id: c, color: c }))} value={r.hair} onPick={(c) => set((x) => ({ ...x, hair: c }))} custom={(c) => set((x) => ({ ...x, hair: c }))} />
      </Section>
      <Section title={t("funda.slot.brows")}>
        <PartGrid parts={of("brows")} value={r.parts.brows} onPick={pick("brows")} none />
      </Section>
      <Section title={t("funda.slot.beard")}>
        <PartGrid parts={of("beard")} value={r.parts.beard} onPick={pick("beard")} none />
      </Section>
    </>
  );
}

function ClothesTab({ kit, r, set }: { kit: Kit; r: Recipe; set: Setter }) {
  const pick = (slot: Slot) => (id: string | null) =>
    set((x) => {
      const parts = { ...x.parts, [slot]: id ?? undefined };
      // Conjunto o arriba/abajo: uno quita lo otro.
      if (slot === "outfit" && id) {
        delete parts.top;
        delete parts.bottom;
      }
      if ((slot === "top" || slot === "bottom") && id) delete parts.outfit;
      return { ...x, parts };
    });
  return (
    <>
      {CLOTH_SLOTS.map((slot) => {
        const parts = kit.parts.filter((p) => p.cat === slot);
        const chosen = r.parts[slot];
        const part = parts.find((p) => p.id === chosen);
        return (
          <Section key={slot} title={t(`funda.slot.${slot}` as Key)}>
            {slot === "outfit" && <p className="-mt-1 mb-2 text-xs text-cal/45">{t("funda.outfitNote")}</p>}
            <PartGrid parts={parts} value={chosen} onPick={pick(slot)} none={slot !== "top" && slot !== "bottom"} />
            {part?.tint === "cloth" && (
              <div className="mt-2">
                <Swatches
                  colors={[{ id: "", color: "transparent", label: t("funda.original") }, ...CLOTH_COLORS.map((c) => ({ id: c, color: c }))]}
                  value={r.colors[part.id] ?? ""}
                  onPick={(c) =>
                    set((x) => {
                      const colors = { ...x.colors };
                      if (c) colors[part.id] = c;
                      else delete colors[part.id];
                      return { ...x, colors };
                    })
                  }
                  custom={(c) => set((x) => ({ ...x, colors: { ...x.colors, [part.id]: c } }))}
                />
                {part.tex && <Customize part={part} r={r} set={set} />}
              </div>
            )}
          </Section>
        );
      })}
    </>
  );
}

/** Una funda al azar (dentro de lo razonable: ajustes suaves y ropa completa). */
export function randomRecipe(kit: Kit, base: "f" | "m"): Recipe {
  const rnd = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;
  const ids = (cat: string) => kit.parts.filter((p) => p.cat === cat).map((p) => p.id);
  const soft = (k: number) => Math.round((Math.random() * 2 - 1) * k * 100) / 100;
  const r = defaultRecipe(base);
  for (const id of kit.body) r.body[id] = soft(0.5);
  for (const id of kit.face) r.face[id] = soft(0.35);
  r.skin = rnd(kit.skins.filter((s) => s.id.endsWith(`_${base}`))).id;
  r.eyes = rnd(kit.eyes);
  r.hair = rnd(HAIR_COLORS.slice(0, 10));
  r.parts = { hair: rnd(ids("hair")), brows: rnd(ids("brows")), shoes: rnd(ids("shoes")) };
  if (base === "m" && Math.random() < 0.35) r.parts.beard = rnd(ids("beard"));
  if (Math.random() < 0.5) r.parts.outfit = rnd(ids("outfit"));
  else {
    r.parts.top = rnd(ids("top"));
    r.parts.bottom = rnd(ids("bottom"));
  }
  if (Math.random() < 0.15) r.parts.hat = rnd(ids("hat"));
  if (Math.random() < 0.25) r.parts.glasses = rnd(ids("glasses"));
  for (const s of ["outfit", "top", "bottom", "shoes", "hat"] as Slot[]) {
    const id = r.parts[s];
    if (id && Math.random() < 0.6) r.colors[id] = rnd(CLOTH_COLORS);
  }
  // A veces, un estampado arriba y una funda sintética o robótica.
  const up = r.parts.outfit ?? r.parts.top;
  if (up && Math.random() < 0.25) r.patterns = { [up]: { kind: rnd([...PATTERNS]), color: rnd(CLOTH_COLORS), scale: Math.random() } };
  if (Math.random() < 0.15) return cleanRecipe(preset(rnd(PRESETS.filter((p) => p !== "natural")), r, kit), kit);
  return cleanRecipe(r, kit);
}
