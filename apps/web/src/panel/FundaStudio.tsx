/**
 * El configurador de fundas: base, cuerpo, cara, pelo y ropa con vista 3D al momento. Monta la funda
 * en el navegador (fundas/), la exporta a VRM con su receta dentro y la sube como cualquier otra.
 * Se carga aparte (Three.js y el kit) y solo cuando se abre.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { checkBudget, inspectGlb } from "@xenxo/assets";
import { errorText, t, useLang, type Key } from "../i18n";
import { removeSkin, setAvatar, uploadModel, useAccount } from "../net/account";
import { KIT_BASE, loadKit, type Kit, type KitPart } from "../fundas/kit";
import { CLOTH_COLORS, cleanRecipe, defaultRecipe, HAIR_COLORS, type Recipe, type Slot } from "../fundas/recipe";
import { buildPreview } from "../fundas/three";
import { Button, input, Notice } from "./ui";

type Tab = "base" | "body" | "face" | "hair" | "clothes";
const TABS: Tab[] = ["base", "body", "face", "hair", "clothes"];
const FACE_GROUPS: Record<string, string[]> = {
  head: ["head_width", "head_height", "head_depth", "head_fat", "head_round", "head_oval", "forehead", "forehead_slope"],
  eyes: ["eye_size", "eye_height", "eye_dist", "eye_angle", "eye_fold", "brow_height", "brow_angle"],
  nose: ["nose_width", "nose_length", "nose_depth", "nose_bridge", "nose_tip", "nostrils"],
  mouth: ["mouth_width", "mouth_height", "lip_upper", "lip_lower", "mouth_corners"],
  jaw: ["cheekbones", "cheeks", "jaw_width", "jaw_angle", "chin_height", "chin_forward", "chin_cleft"],
  ears: ["ear_size", "ear_out", "ear_point", "neck_width"],
};
const CLOTH_SLOTS: Slot[] = ["outfit", "top", "bottom", "shoes", "hat", "glasses", "gloves"];
/** Color de muestra de cada textura de ojos (solo para el selector). */
const EYE_SWATCH: Record<string, string> = {
  brown: "#4a2c1a", brownlight: "#7a5230", green: "#4f7a3a", bluegreen: "#3f7f7a", blue: "#3a6aa8",
  lightblue: "#7aa8d8", deepblue: "#24407a", grey: "#7a8088", ice: "#b8d4e8",
};

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
  const [model, setModel] = useState<{ group: THREE.Group; tris: number } | null>(null);
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
  const face = tab === "face" || tab === "hair";

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
            <CameraRig face={face} />
          </Canvas>
          {!model && !failed && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-cal/50">{t("funda.loading")}</p>}
          {failed && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-200">{t("funda.error")}</p>}
          <p className="pointer-events-none absolute bottom-2 left-3 text-xs text-cal/40">{t("funda.dragHint")}</p>
        </div>
        {/* Controles */}
        <div className="flex min-h-0 flex-col border-t border-cal/10 md:border-l md:border-t-0">
          <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-cal/10 p-2">
            {TABS.map((id) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${tab === id ? "bg-neon/15 text-neon" : "text-cal/65 hover:text-cal"}`}
              >
                {t(`funda.tab.${id}` as Key)}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!kit ? null : tab === "base" ? (
              <BaseTab kit={kit} r={recipe} set={set} />
            ) : tab === "body" ? (
              <Sliders ids={kit.body} values={recipe.body} label={(id) => t(`funda.body.${id}` as Key)} onChange={(id, v) => set((r) => ({ ...r, body: { ...r.body, [id]: v } }))} />
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

/** Cámara: cuerpo entero o la cara (para la cara y el pelo), con un paso suave entre las dos. */
function CameraRig({ face }: { face: boolean }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const goal = useMemo(() => ({ target: new THREE.Vector3(), dist: 4.4 }), []);
  goal.target.set(0, face ? 1.58 : 0.92, 0);
  goal.dist = face ? 1.15 : 4.4;
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const k = Math.min(1, dt * 5);
    c.target.lerp(goal.target, k);
    const off = _off.copy(camera.position).sub(c.target);
    const d = off.length();
    off.setLength(d + (goal.dist - d) * k);
    camera.position.copy(c.target).add(off);
    c.update();
  });
  return <OrbitControls ref={controls} enablePan={false} enableZoom={false} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 1.85} />;
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-sm font-medium text-cal/80">{title}</h3>
      {children}
    </section>
  );
}

function Sliders({ ids, values, label, onChange }: { ids: string[]; values: Record<string, number>; label: (id: string) => string; onChange: (id: string, v: number) => void }) {
  return (
    <div className="space-y-3">
      {ids.map((id) => (
        <label key={id} className="block">
          <span className="flex justify-between text-xs text-cal/70">
            {label(id)}
            <span className="meta text-cal/40">{Math.round((values[id] ?? 0) * 100)}</span>
          </span>
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={Math.round((values[id] ?? 0) * 100)}
            onChange={(e) => onChange(id, Number(e.target.value) / 100)}
            onDoubleClick={() => onChange(id, 0)}
            className="mt-1 w-full accent-[var(--color-neon)]"
          />
        </label>
      ))}
    </div>
  );
}

function Swatches({ colors, value, onPick }: { colors: { id: string; color: string; label?: string }[]; value: string | null; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((c) => (
        <button
          key={c.id}
          onClick={() => onPick(c.id)}
          aria-pressed={value === c.id}
          aria-label={c.label ?? c.color}
          title={c.label ?? c.color}
          className={`h-8 w-8 rounded-full border-2 transition ${value === c.id ? "border-neon scale-110" : "border-cal/15 hover:border-cal/40"}`}
          style={{ backgroundColor: c.color }}
        />
      ))}
    </div>
  );
}

function partName(p: KitPart, i: number, lang: string): string {
  return (lang === "en" ? p.en : p.es) ?? `${i + 1}`;
}

function PartGrid({ parts, value, onPick, none }: { parts: KitPart[]; value: string | undefined; onPick: (id: string | null) => void; none: boolean }) {
  const lang = useLang();
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
      {none && (
        <button onClick={() => onPick(null)} aria-pressed={!value} className={`flex aspect-square items-center justify-center rounded-xl border text-xs ${!value ? "border-neon text-neon" : "border-cal/15 text-cal/55 hover:border-cal/40"}`}>
          {t("funda.none")}
        </button>
      )}
      {parts.map((p, i) => (
        <button
          key={p.id}
          onClick={() => onPick(p.id)}
          aria-pressed={value === p.id}
          title={partName(p, i, lang)}
          className={`relative aspect-square overflow-hidden rounded-xl border bg-cal/[0.06] ${value === p.id ? "border-neon ring-2 ring-neon/40" : "border-cal/10 hover:border-cal/35"}`}
        >
          {p.thumb ? <img src={KIT_BASE + p.thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
          <span className="absolute inset-x-0 bottom-0 truncate bg-noche/75 px-1 py-0.5 text-[10px] text-cal/85">{partName(p, i, lang)}</span>
        </button>
      ))}
    </div>
  );
}

type Setter = (fn: (r: Recipe) => Recipe) => void;

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
              onClick={() => set((x) => ({ ...defaultRecipe(b), body: x.body, face: x.face, hair: x.hair, skin: x.skin.replace(/_[fm]$/, `_${b}`), eyes: x.eyes }))}
              className={`rounded-lg px-4 py-1.5 text-sm ${r.base === b ? "bg-neon/20 text-cal" : "text-cal/60"}`}
            >
              {t(`funda.base.${b}` as Key)}
            </button>
          ))}
        </div>
      </Section>
      <Section title={t("funda.skin")}>
        <Swatches colors={skins.map((s) => ({ id: s.id, color: s.tone }))} value={r.skin} onPick={(id) => set((x) => ({ ...x, skin: id }))} />
      </Section>
      <Section title={t("funda.eyes")}>
        <Swatches colors={kit.eyes.map((e) => ({ id: e, color: EYE_SWATCH[e] ?? "#888888" }))} value={r.eyes} onPick={(id) => set((x) => ({ ...x, eyes: id }))} />
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
        <Swatches colors={HAIR_COLORS.map((c) => ({ id: c, color: c }))} value={r.hair} onPick={(c) => set((x) => ({ ...x, hair: c }))} />
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
                />
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
  return cleanRecipe(r, kit);
}
