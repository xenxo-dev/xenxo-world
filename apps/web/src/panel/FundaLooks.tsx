/**
 * Lo que se pinta en una funda: maquillaje, barba de tres días y pecas (pestaña Piel); acabados
 * sintéticos y robóticos por zonas, lo que brilla y los implantes (pestaña Sintética); y el estampado,
 * las imágenes o textos y los colores copiados de una foto de cada prenda (Ropa → Personalizar).
 * Todo se queda en la receta y se dibuja en el navegador (fundas/paint.ts).
 */
import { useEffect, useRef, useState } from "react";
import { t, type Key } from "../i18n";
import type { Kit, KitPart } from "../fundas/kit";
import { garmentColors, imageToPrint, pastedImage, textToPrint } from "../fundas/prints";
import {
  BLUSH_COLORS,
  CLOTH_COLORS,
  FINISHES,
  FINISH_COLOR,
  FINISH_PALETTE,
  GLOW_COLORS,
  LIP_COLORS,
  PATTERNS,
  PRINT_FONTS,
  PRINTABLE,
  SHADOW_COLORS,
  ZONES,
  type Finish,
  type Pattern,
  type Print,
  type PrintFont,
  type Recipe,
  type Synth,
  type Zone,
} from "../fundas/recipe";
import { Button, input as inputClass, Notice } from "./ui";
import { Amount, Chip, Offset, PartGrid, Section, Swatches, type Setter } from "./funda-ui";

/* ---------------- Piel ---------------- */

export function SkinTab({ r, set }: { r: Recipe; set: Setter }) {
  const look = (k: "lips" | "shadow" | "blush", palette: string[]) => {
    const v = r.looks?.[k];
    const put = (color: string, amount: number) => set((x) => ({ ...x, looks: { ...x.looks, [k]: { color, amount } } }));
    return (
      <Section key={k} title={t(`funda.looks.${k}` as Key)}>
        <Amount value={v?.amount ?? 0} onChange={(a) => put(v?.color ?? palette[0]!, a)} />
        <Swatches colors={palette.map((c) => ({ id: c, color: c }))} value={v?.color ?? null} onPick={(c) => put(c, v?.amount || 0.6)} custom={(c) => put(c, v?.amount || 0.6)} />
      </Section>
    );
  };
  const amount = (k: "stubble" | "freckles") => (
    <Section key={k} title={t(`funda.looks.${k}` as Key)}>
      <Amount value={r.looks?.[k] ?? 0} onChange={(a) => set((x) => ({ ...x, looks: { ...x.looks, [k]: a } }))} />
    </Section>
  );
  return (
    <>
      <p className="mb-4 text-xs text-cal/55">{t("funda.looks.note")}</p>
      {look("lips", LIP_COLORS)}
      {look("shadow", SHADOW_COLORS)}
      {look("blush", BLUSH_COLORS)}
      {amount("stubble")}
      {amount("freckles")}
    </>
  );
}

/* ---------------- Sintética ---------------- */

type ZonePick = Zone | "all";

/** Color de partida de un acabado: la piel sintética, del tono de la piel elegida. */
function startColor(f: Exclude<Finish, "skin">, r: Recipe, kit: Kit): string {
  if (f === "synth") return r.skinTone ?? kit.skins.find((s) => s.id === r.skin)?.tone ?? FINISH_COLOR.synth;
  return FINISH_COLOR[f];
}

function withZones(r: Recipe, zones: NonNullable<Synth["zones"]>): Recipe {
  return { ...r, synth: { ...r.synth, zones } };
}

export const PRESETS = ["natural", "synth", "android", "chrome", "cyborg"] as const;

export function preset(id: (typeof PRESETS)[number], r: Recipe, kit: Kit): Recipe {
  const all = (f: Exclude<Finish, "skin">, color?: string) => Object.fromEntries(ZONES.map((z) => [z, { finish: f, color: color ?? startColor(f, r, kit) }]));
  const has = (id: string) => kit.parts.some((p) => p.id === id);
  const implant = (id: string | undefined) => ({ ...r.parts, implant: id && has(id) ? id : undefined });
  switch (id) {
    case "natural":
      return { ...r, synth: undefined, parts: implant(undefined) };
    case "synth":
      return { ...r, synth: { zones: all("synth") }, parts: implant("imp_nape") };
    case "android":
      return { ...r, synth: { zones: all("porcelain"), glow: "#36d9ff", eyes: "#36d9ff" }, parts: implant("imp_nape") };
    case "chrome":
      return { ...r, synth: { zones: all("chrome"), glow: "#36d9ff" }, parts: implant("imp_spine") };
    case "cyborg":
      return { ...r, synth: { zones: { arm_l: { finish: "chrome", color: "#c9ced6" } }, glow: "#ff5a3a", eyes: "#ff5a3a" }, parts: implant("imp_temples") };
  }
}

export function SynthTab({ kit, r, set }: { kit: Kit; r: Recipe; set: Setter }) {
  const [zone, setZone] = useState<ZonePick>("all");
  const zones = r.synth?.zones ?? {};
  const targets: Zone[] = zone === "all" ? ZONES : [zone];
  // El acabado de lo elegido (si toda la funda va igual).
  const finishes = new Set(targets.map((z) => zones[z]?.finish ?? "skin"));
  const finish: Finish | null = finishes.size === 1 ? ([...finishes][0] as Finish) : null;
  const colors = new Set(targets.map((z) => zones[z]?.color ?? ""));
  const color = colors.size === 1 ? [...colors][0]! : null;
  const setFinish = (f: Finish) =>
    set((x) => {
      const zs = { ...x.synth?.zones };
      for (const z of targets) {
        if (f === "skin") delete zs[z];
        else zs[z] = { finish: f, color: zs[z]?.finish === f ? zs[z]!.color : startColor(f, x, kit) };
      }
      return withZones(x, zs);
    });
  const setColor = (c: string) =>
    set((x) => {
      const zs = { ...x.synth?.zones };
      for (const z of targets) if (zs[z]) zs[z] = { ...zs[z]!, color: c };
      return withZones(x, zs);
    });
  const setSynth = (k: "glow" | "eyes", c: string) => set((x) => ({ ...x, synth: { ...x.synth, [k]: c || undefined } }));
  return (
    <>
      <p className="mb-4 text-xs text-cal/55">{t("funda.synth.intro")}</p>
      <Section title={t("funda.synth.presets")}>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Chip key={p} on={false} onClick={() => set((x) => preset(p, x, kit))}>
              {t(`funda.preset.${p}` as Key)}
            </Chip>
          ))}
        </div>
      </Section>
      <Section title={t("funda.synth.finish")}>
        <div className="mb-3 flex flex-wrap gap-1">
          {(["all", ...ZONES] as ZonePick[]).map((z) => (
            <Chip key={z} on={zone === z} onClick={() => setZone(z)}>
              {t(`funda.zone.${z}` as Key)}
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {FINISHES.map((f) => (
            <button
              key={f}
              onClick={() => setFinish(f)}
              aria-pressed={finish === f}
              className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-xs ${finish === f ? "border-neon text-neon ring-2 ring-neon/30" : "border-cal/10 text-cal/75 hover:border-cal/35"}`}
            >
              <span className={`finish-${f} h-9 w-9 rounded-full border border-cal/15`} />
              {t(`funda.finish.${f}` as Key)}
            </button>
          ))}
        </div>
        {finish && finish !== "skin" && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-cal/55">{t("funda.synth.color")}</p>
            <Swatches colors={FINISH_PALETTE[finish].map((c) => ({ id: c, color: c }))} value={color} onPick={setColor} custom={setColor} />
          </div>
        )}
      </Section>
      <Section title={t("funda.synth.glow")} note={t("funda.synth.glowNote")}>
        <Swatches colors={[{ id: "", color: "transparent", label: t("funda.synth.noGlow") }, ...GLOW_COLORS.map((c) => ({ id: c, color: c }))]} value={r.synth?.glow ?? ""} onPick={(c) => setSynth("glow", c)} custom={(c) => setSynth("glow", c)} />
      </Section>
      <Section title={t("funda.synth.eyes")}>
        <Swatches colors={[{ id: "", color: "transparent", label: t("funda.synth.noGlow") }, ...GLOW_COLORS.map((c) => ({ id: c, color: c }))]} value={r.synth?.eyes ?? ""} onPick={(c) => setSynth("eyes", c)} custom={(c) => setSynth("eyes", c)} />
      </Section>
      <Section title={t("funda.slot.implant")} note={t("funda.synth.implantNote")}>
        <PartGrid parts={kit.parts.filter((p) => p.cat === "implant")} value={r.parts.implant} onPick={(id) => set((x) => ({ ...x, parts: { ...x.parts, implant: id ?? undefined } }))} none />
      </Section>
    </>
  );
}

/* ---------------- Ropa: personalizar una prenda ---------------- */

/** Un segundo color que se vea sobre el de la prenda (sin color elegido, la mayoría son claras). */
function contrast(base: string | undefined): string {
  if (!base) return "#1e2f55";
  const n = parseInt(base.slice(1), 16);
  const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return l > 120 ? "#1e2f55" : "#f6f1e7";
}

export function Customize({ part, r, set }: { part: KitPart; r: Recipe; set: Setter }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-xl border border-cal/10">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-2 text-xs text-cal/75 hover:text-cal">
        {t("funda.customize")}
        <span aria-hidden className={`transition ${open ? "rotate-90" : ""}`}>
          ›
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-cal/10 p-3">
          <PatternEditor part={part} r={r} set={set} />
          {PRINTABLE.has(part.cat) && <PrintEditor part={part} r={r} set={set} />}
          <CopyColors part={part} set={set} />
        </div>
      )}
    </div>
  );
}

function PatternEditor({ part, r, set }: { part: KitPart; r: Recipe; set: Setter }) {
  const p = r.patterns?.[part.id];
  const put = (np: Pattern | null) =>
    set((x) => {
      const patterns = { ...x.patterns };
      if (np) patterns[part.id] = np;
      else delete patterns[part.id];
      return { ...x, patterns };
    });
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-medium text-cal/70">{t("funda.pattern")}</h4>
      <div className="flex flex-wrap gap-1">
        <Chip on={!p} onClick={() => put(null)}>
          {t("funda.pattern.none")}
        </Chip>
        {PATTERNS.map((k) => (
          <Chip key={k} on={p?.kind === k} onClick={() => put({ kind: k, color: p?.color ?? contrast(r.colors[part.id]), scale: p?.scale ?? 0.4 })}>
            {t(`funda.pattern.${k}` as Key)}
          </Chip>
        ))}
      </div>
      {p && (
        <div className="mt-2">
          <p className="mb-1.5 text-xs text-cal/55">{t("funda.pattern.color")}</p>
          <Swatches colors={CLOTH_COLORS.map((c) => ({ id: c, color: c }))} value={p.color} onPick={(c) => put({ ...p, color: c })} custom={(c) => put({ ...p, color: c })} />
          <div className="mt-2">
            <Amount label={t("funda.pattern.scale")} value={p.scale} onChange={(v) => put({ ...p, scale: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

function PrintEditor({ part, r, set }: { part: KitPart; r: Recipe; set: Setter }) {
  const [side, setSide] = useState<"front" | "back">("front");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bg, setBg] = useState(true);
  const [text, setText] = useState("");
  const [font, setFont] = useState<PrintFont>("display");
  const [ink, setInk] = useState(() => contrast(r.colors[part.id]));
  const file = useRef<HTMLInputElement>(null);
  const cur = r.prints?.[part.id]?.[side];
  const put = (p: Print | null) =>
    set((x) => {
      const prints = { ...x.prints };
      const mine = { ...prints[part.id] };
      if (p) mine[side] = p;
      else delete mine[side];
      if (mine.front || mine.back) prints[part.id] = mine;
      else delete prints[part.id];
      return { ...x, prints };
    });
  const latest = useRef({ cur, bg, put });
  latest.current = { cur, bg, put };
  const fromImage = async (f: Blob) => {
    setBusy(true);
    setError("");
    try {
      const img = await imageToPrint(f, latest.current.bg);
      const c = latest.current.cur;
      latest.current.put({ img, size: c?.size ?? 0.6, y: c?.y ?? 0 });
    } catch {
      setError(t("funda.print.error"));
    } finally {
      setBusy(false);
    }
  };
  const fromText = async () => {
    setBusy(true);
    setError("");
    try {
      const img = await textToPrint(text, font, ink);
      put({ img, size: cur?.size ?? 0.7, y: cur?.y ?? 0, text: text.trim(), font });
    } catch {
      setError(t("funda.print.error"));
    } finally {
      setBusy(false);
    }
  };
  // Pegar una imagen (Ctrl+V / Cmd+V) mientras está abierto.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = pastedImage(e);
      if (!f) return;
      e.preventDefault();
      void fromImage(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // fromImage lee lo último de `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-medium text-cal/70">{t("funda.print.title")}</h4>
      <div className="mb-2 inline-flex rounded-xl border border-cal/10 p-0.5">
        {(["front", "back"] as const).map((s) => (
          <button key={s} onClick={() => setSide(s)} aria-pressed={side === s} className={`rounded-lg px-3 py-1 text-xs ${side === s ? "bg-neon/15 text-neon" : "text-cal/60"}`}>
            {t(`funda.print.${s}` as Key)}
            {r.prints?.[part.id]?.[s] ? " ·" : ""}
          </button>
        ))}
      </div>
      {cur ? (
        <div className="flex gap-3">
          <img src={cur.img} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-cal/10 bg-cal/[0.06] object-contain p-1" />
          <div className="min-w-0 flex-1">
            <Amount label={t("funda.print.size")} min={0.2} value={cur.size} onChange={(v) => put({ ...cur, size: Math.max(0.2, v) })} />
            <Offset label={t("funda.print.height")} value={cur.y} onChange={(v) => put({ ...cur, y: v })} />
            <Button onClick={() => put(null)} className="!py-1 text-xs">
              {t("funda.print.remove")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => file.current?.click()} disabled={busy} className="!py-1.5 text-xs">
              {t("funda.print.upload")}
            </Button>
            <span className="text-[11px] text-cal/45">{t("funda.print.paste")}</span>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-cal/65">
            <input type="checkbox" checked={bg} onChange={(e) => setBg(e.target.checked)} className="accent-[var(--color-neon)]" />
            {t("funda.print.bg")}
          </label>
          <input
            ref={file}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void fromImage(f);
              e.target.value = "";
            }}
          />
          <div className="mt-3">
            <label className="mb-1 block text-xs text-cal/60" htmlFor={`print-text-${part.id}`}>
              {t("funda.print.text")}
            </label>
            <div className="flex gap-2">
              <input id={`print-text-${part.id}`} value={text} maxLength={40} onChange={(e) => setText(e.target.value)} placeholder={t("funda.print.textPlaceholder")} className={inputClass} />
              <Button onClick={() => void fromText()} disabled={busy || !text.trim()} className="!py-1.5 text-xs">
                {t("funda.print.add")}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {PRINT_FONTS.map((f) => (
                <Chip key={f} on={font === f} onClick={() => setFont(f)} className={f === "display" ? "display" : f === "mono" ? "meta" : ""}>
                  {t(`funda.print.font.${f}` as Key)}
                </Chip>
              ))}
            </div>
            <div className="mt-2">
              <Swatches colors={CLOTH_COLORS.map((c) => ({ id: c, color: c }))} value={ink} onPick={setInk} custom={setInk} />
            </div>
          </div>
        </>
      )}
      {busy && <p className="mt-2 text-xs text-neon-suave">{t("funda.print.working")}</p>}
      {error && <Notice tone="error">{error}</Notice>}
      <p className="mt-2 text-[11px] leading-snug text-cal/45">{t("funda.print.rules")}</p>
    </div>
  );
}

function CopyColors({ part, set }: { part: KitPart; set: Setter }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const file = useRef<HTMLInputElement>(null);
  const run = async (f: Blob) => {
    setState("working");
    try {
      const cols = await garmentColors(f);
      set((x) => {
        const colors = { ...x.colors, [part.id]: cols[0]! };
        const pat = x.patterns?.[part.id];
        const patterns = { ...x.patterns };
        if (pat && cols[1]) patterns[part.id] = { ...pat, color: cols[1] };
        return { ...x, colors, patterns };
      });
      setState("done");
    } catch {
      setState("error");
    }
  };
  return (
    <div>
      <h4 className="mb-1 text-xs font-medium text-cal/70">{t("funda.copy.title")}</h4>
      <p className="mb-2 text-xs text-cal/50">{t("funda.copy.note")}</p>
      <Button onClick={() => file.current?.click()} disabled={state === "working"} className="!py-1.5 text-xs">
        {t("funda.copy.pick")}
      </Button>
      <input
        ref={file}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void run(f);
          e.target.value = "";
        }}
      />
      {state === "done" && <p className="mt-1.5 text-xs text-neon-suave">{t("funda.copy.done")}</p>}
      {state === "error" && <p className="mt-1.5 text-xs text-red-200">{t("funda.copy.error")}</p>}
    </div>
  );
}
