/**
 * Iconos de línea del HUD (24 px, trazo de 1,75): blanco frío de base y cian cuando están
 * activos, como los de cámara y pantalla completa. Sin emojis: se ven igual en todos los equipos.
 */
const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Mano saludando. */
export function WaveIcon() {
  return (
    <svg aria-hidden className="h-5 w-5" {...svg}>
      <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14 11V6a1.5 1.5 0 0 1 3 0v7.5a6 6 0 0 1-6 6h-.6a5.5 5.5 0 0 1-4.3-2.1L3.6 14.2a1.5 1.5 0 0 1 2.2-2L8 14" />
      <path d="M19.5 3.5c.9.7 1.5 1.7 1.6 2.9M3 5.5c.4-1 1.1-1.8 2-2.3" />
    </svg>
  );
}

/** Nota musical (bailar). */
export function DanceIcon() {
  return (
    <svg aria-hidden className="h-5 w-5" {...svg}>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </svg>
  );
}

/** Silla (sentarse). */
export function SitIcon() {
  return (
    <svg aria-hidden className="h-5 w-5" {...svg}>
      <path d="M7 3v18" />
      <path d="M7 13h10v8" />
      <path d="M7 8h3" />
    </svg>
  );
}

/** Destellos (celebrar). */
export function CheerIcon() {
  return (
    <svg aria-hidden className="h-5 w-5" {...svg}>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8zM5 15.5l.6 1.4 1.4.6-1.4.6L5 19.5l-.6-1.4-1.4-.6 1.4-.6z" />
    </svg>
  );
}

/** Ojo (ver en primera persona). */
export function EyeIcon() {
  return (
    <svg aria-hidden className="h-5 w-5" {...svg}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Persona (volver a tercera persona). */
export function PersonIcon() {
  return (
    <svg aria-hidden className="h-5 w-5" {...svg}>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 8v7M8 10.5l4-1.5 4 1.5M12 15l-3 6M12 15l3 6" />
    </svg>
  );
}

/** Flecha hacia arriba (saltar). */
export function JumpIcon() {
  return (
    <svg aria-hidden className="h-5 w-5" {...svg}>
      <path d="M12 20V7M6.5 12.5 12 7l5.5 5.5M5 4h14" />
    </svg>
  );
}

/** Estilo común de los botones de icono del HUD. */
export const hudIconButton =
  "grid h-11 w-11 place-items-center rounded-xl border border-cal/10 bg-noche/70 text-[#f4f7ff] backdrop-blur transition hover:border-neon/50 hover:text-neon aria-pressed:border-neon/60 aria-pressed:text-neon active:scale-95";

/** Altavoz: con ondas (sonido ambiente activo) o tachado. */
export function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg aria-hidden className="h-5 w-5" {...svg}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      {on ? (
        <>
          <path d="M15.5 9a4 4 0 0 1 0 6" />
          <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
        </>
      ) : (
        <path d="M16 9.5l5 5M21 9.5l-5 5" />
      )}
    </svg>
  );
}
