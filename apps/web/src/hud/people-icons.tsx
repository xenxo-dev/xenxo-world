/**
 * Iconos de la gente (gestos nuevos, reacciones, parejas y modo pelea): trazos de línea de 24 px,
 * como los demás del HUD (icons.tsx). Los mismos trazos sirven para el HUD (SVG) y para lo que
 * flota sobre las cabezas en el mundo (people/PeopleFx.tsx los pinta en un lienzo con Path2D).
 */
const CIRCLE = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const FIST = [
  "M7 11V8.2a1.4 1.4 0 0 1 2.8 0V10",
  "M9.8 9.6V7.4a1.4 1.4 0 0 1 2.8 0v2.2",
  "M12.6 9.6V7.9a1.4 1.4 0 0 1 2.8 0v2.3",
  "M15.4 10.2V9.4a1.4 1.4 0 0 1 2.8 0v4.1c0 3.6-2.6 6.5-6.2 6.5h-.6A4.9 4.9 0 0 1 6.5 15v-2.6a1.4 1.4 0 0 1 2.8 0",
];

export const PEOPLE_PATHS: Record<string, string[]> = {
  // Reacciones
  heart: ["M12 20.5s-7.5-4.6-7.5-10.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.5c0 5.8-7.5 10.4-7.5 10.4z"],
  laugh: [CIRCLE(12, 12, 8.5), "M8 13.5h8a4 4 0 0 1-8 0z", "M8.5 9.8l1.5-1.2 1.5 1.2", "M12.5 9.8l1.5-1.2 1.5 1.2"],
  wow: [CIRCLE(12, 12, 8.5), CIRCLE(12, 15.3, 1.8), "M9 9.5v.5", "M15 9.5v.5"],
  clap: [
    "M7.5 13.5l3.6-5.2a1.2 1.2 0 0 1 2 1.3l-1.6 2.4",
    "M10 15.5l4.4-6.4a1.2 1.2 0 0 1 2 1.3L14 14",
    "M6.5 12.5c-1.4 3.4.6 7 4.3 7 2.3 0 3.6-1 4.9-2.8l2.3-3.3",
    "M4 6l1.5 1.5M8 3.5v2M12 4l-1 1.6",
  ],
  fire: ["M12 21c-3.6 0-6.2-2.5-6.2-5.8 0-2.8 2-4.7 3.1-6.6.5 1.7 1.5 2.6 2.6 2.8-.2-2.8.9-5.6 3.3-7.9.5 3.5 3.4 5.6 3.4 11.2 0 3.9-2.6 6.3-6.2 6.3z"],
  thumbs_up: ["M7.5 10.5V20H4.5v-9.5h3z", "M7.5 10.5l3.7-6.3c1.4 0 2.4 1.1 2 2.7l-.8 3.4h5.1a2 2 0 0 1 2 2.4l-1.2 5.8A2.2 2.2 0 0 1 16.1 20H7.5"],
  // Gestos
  point: ["M3.5 12.5h11", "M10.5 8.5l4 4-4 4", "M18.5 7.5v10"],
  beckon: ["M15 6.5a5.5 5.5 0 1 1 0 11H8", "M11 14.5l-3 3 3 3"],
  shrug: [CIRCLE(12, 5.5, 2), "M12 9v6", "M4 9.5l3 2.5 5-1.5 5 1.5 3-2.5", "M9.5 21l2.5-6 2.5 6"],
  // En pareja
  high_five: [
    "M8.5 20.5v-4.8L6 12.3V7a1.3 1.3 0 0 1 2.6 0v4",
    "M8.6 11V4.8a1.3 1.3 0 0 1 2.6 0V11",
    "M11.2 11V4.2a1.3 1.3 0 0 1 2.6 0V11",
    "M13.8 11V5.6a1.3 1.3 0 0 1 2.6 0v8.2c0 3.8-2.2 6.7-5.6 6.7H8.5",
  ],
  hug: [CIRCLE(8, 5.5, 2), CIRCLE(16, 5.5, 2), "M5 20v-5.5a3 3 0 0 1 3-3h1.5l2.5 2 2.5-2H16a3 3 0 0 1 3 3V20", "M8.5 14.5L12 17l3.5-2.5"],
  handshake: ["M3 11.5l3-3 4 1 3-2 3 1.5 5 3", "M6 8.5l-3 3 5.5 5.5c.8.8 2 .8 2.8 0l5.7-5.7", "M10.5 13.5l2 2M12.5 11.5l2.5 2.5"],
  // Modo pelea
  fight: FIST,
  punch: [...FIST, "M2.5 9h2.5M2 12.5h3M2.5 16h2.5"],
  kick: ["M9 3.5v7.5l-4.5 6.5a1.6 1.6 0 0 0 1.3 2.5H14a3 3 0 0 0 3-3v-1h-5.5", "M13 3.5v7", "M19 8.5l2-1M19.5 12h2.5"],
  shove: [
    "M9 18v-6.5a1.4 1.4 0 0 1 2.8 0V9",
    "M11.8 12V6.6a1.4 1.4 0 0 1 2.8 0V12",
    "M14.6 12V7.8a1.4 1.4 0 0 1 2.8 0v6.4c0 2.9-2 5.3-5 5.3H9",
    "M3 9.5h3.5M2.5 13h4M3 16.5h3.5",
  ],
  // La rueda de acciones
  actions: ["M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z", "M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"],
  // Destellos (efecto al chocar los cinco, estrellas del fuera de combate)
  star: ["M12 3.5l2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.4l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z"],
};

export function PeopleIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {(PEOPLE_PATHS[name] ?? []).map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
