/**
 * Colores de lo que se dibuja en 3D para la VR (panel, arco del teletransporte): los mismos tokens
 * del tema de `index.css` (allí, para la interfaz 2D). Si cambia el tema, cambia aquí también.
 */
export const XR_THEME = {
  noche: "#080d19",
  neon: "#36d9ff",
  neonSuave: "#9beaff",
  rosa: "#ff4fd8",
  soft: "#cbd5e1",
  muted: "#94a3b8",
  cal: "#f6f1e7",
  /** Botones del panel de la VR: reposo y «aquí estás» (la versión opaca del cristal de los paneles 2D). */
  boton: "#16233b",
  botonActivo: "#1d4a5e",
} as const;
