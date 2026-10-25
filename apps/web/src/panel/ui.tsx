/** Piezas de interfaz compartidas por las secciones del panel. */
import type { ReactNode } from "react";

export const card = "rounded-2xl border border-cal/10 bg-cal/[0.04]";
export const input =
  "w-full rounded-xl border border-cal/10 bg-cal/5 px-3 py-2 text-cal outline-none placeholder:text-cal/35 focus:border-neon";

export function Block({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mb-8 last:mb-0">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="display text-xl font-semibold text-cal">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className={`${card} p-4`}>
      <p className="text-2xl font-semibold text-cal">{value ?? "–"}</p>
      <p className="text-xs text-cal/50">{label}</p>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div className="mt-2 inline-flex rounded-xl border border-cal/10 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`rounded-lg px-4 py-1.5 text-sm ${value === o.id ? "bg-neon/20 text-cal" : "text-cal/60"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-neon font-medium text-noche hover:bg-neon-suave disabled:bg-neon/25 disabled:text-cal/50",
  secondary: "border border-cal/15 text-cal/85 hover:bg-cal/5 disabled:text-cal/30",
  danger: "border border-red-400/30 text-red-200 hover:bg-red-500/10",
  ghost: "text-cal/60 hover:text-cal",
};

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-2 text-sm transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "ok" | "error"; children: ReactNode }) {
  const tones = {
    info: "border-azulejo/40 bg-azulejo/10 text-sky-100",
    ok: "border-huerta/40 bg-huerta/10 text-lime-100",
    error: "border-red-400/40 bg-red-500/10 text-red-100",
  };
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`mt-3 rounded-xl border px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </p>
  );
}

export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 mt-4 block text-sm text-cal/70 first:mt-0">
      {children}
    </label>
  );
}
