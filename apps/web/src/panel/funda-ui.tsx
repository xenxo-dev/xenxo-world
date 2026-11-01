/**
 * Piezas de interfaz del configurador de fundas: secciones, deslizadores, muestras de color (con
 * color libre), chips y rejillas de piezas. Las comparten FundaStudio y FundaLooks.
 */
import type { ReactNode } from "react";
import { t, useLang } from "../i18n";
import { KIT_BASE, type KitPart } from "../fundas/kit";
import type { Recipe } from "../fundas/recipe";

export type Setter = (fn: (r: Recipe) => Recipe) => void;

export function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-sm font-medium text-cal/80">{title}</h3>
      {note && <p className="-mt-1 mb-2 text-xs text-cal/50">{note}</p>}
      {children}
    </section>
  );
}

export function Sliders({ ids, values, label, onChange }: { ids: string[]; values: Record<string, number>; label: (id: string) => string; onChange: (id: string, v: number) => void }) {
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

/** Deslizador de 0 a 100 (intensidad, tamaño…). */
export function Amount({ value, onChange, label, min = 0 }: { value: number; onChange: (v: number) => void; label?: string; min?: number }) {
  return (
    <label className="mb-2 block">
      <span className="flex justify-between text-xs text-cal/60">
        {label ?? t("funda.amount")}
        <span className="meta text-cal/40">{Math.round(value * 100)}</span>
      </span>
      <input type="range" min={min * 100} max={100} step={1} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} className="mt-1 w-full accent-[var(--color-neon)]" />
    </label>
  );
}

/** Deslizador de −100 a 100 (posición). */
export function Offset({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <label className="mb-2 block">
      <span className="flex justify-between text-xs text-cal/60">
        {label}
        <span className="meta text-cal/40">{Math.round(value * 100)}</span>
      </span>
      <input type="range" min={-100} max={100} step={1} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} onDoubleClick={() => onChange(0)} className="mt-1 w-full accent-[var(--color-neon)]" />
    </label>
  );
}

/** Color libre: un botón redondo que abre el selector de color del sistema. */
export function ColorPick({ value, onPick }: { value: string | null; onPick: (c: string) => void }) {
  return (
    <label
      title={t("funda.custom")}
      className={`relative h-8 w-8 shrink-0 cursor-pointer rounded-full border-2 transition ${value ? "scale-110 border-neon" : "swatch-any border-cal/15 hover:border-cal/40"}`}
      style={value ? { backgroundColor: value } : undefined}
    >
      <span className="sr-only">{t("funda.custom")}</span>
      <input type="color" value={value ?? "#808080"} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
    </label>
  );
}

/**
 * Muestras de color. Con `custom`, además, el color libre (que se ve marcado cuando el valor no es
 * ninguna de las muestras).
 */
export function Swatches({
  colors,
  value,
  onPick,
  custom,
}: {
  colors: { id: string; color: string; label?: string }[];
  value: string | null;
  onPick: (id: string) => void;
  custom?: (c: string) => void;
}) {
  const known = colors.some((c) => c.id === value);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((c) => (
        <button
          key={c.id}
          onClick={() => onPick(c.id)}
          aria-pressed={value === c.id}
          aria-label={c.label ?? c.color}
          title={c.label ?? c.color}
          className={`h-8 w-8 rounded-full border-2 transition ${value === c.id ? "scale-110 border-neon" : "border-cal/15 hover:border-cal/40"}`}
          style={{ backgroundColor: c.color }}
        />
      ))}
      {custom && <ColorPick value={!known && value ? value : null} onPick={custom} />}
    </div>
  );
}

export function Chip({ on, onClick, children, className = "" }: { on: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={`rounded-full border px-3 py-1 text-xs ${on ? "border-neon/60 text-neon" : "border-cal/15 text-cal/65 hover:text-cal"} ${className}`}>
      {children}
    </button>
  );
}

export function partName(p: KitPart, i: number, lang: string): string {
  return (lang === "en" ? p.en : p.es) ?? `${i + 1}`;
}

export function PartGrid({ parts, value, onPick, none }: { parts: KitPart[]; value: string | undefined; onPick: (id: string | null) => void; none: boolean }) {
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
