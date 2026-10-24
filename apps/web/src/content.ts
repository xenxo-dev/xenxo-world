/**
 * Contenido editable del panel 2D. Cambia esto sin tocar componentes.
 * TODO(pencho): sustituir las soluciones de ejemplo por las reales.
 */
export interface Solution {
  title: string;
  summary: string;
  tag: string;
  accent: "cyan" | "violet" | "emerald" | "amber";
  href?: string;
}

export const SOLUTIONS: Solution[] = [
  { title: "Agentes de IA soberanos", summary: "Stacks de agentes en Python sin frameworks, sobre modelos propios.", tag: "IA", accent: "violet" },
  { title: "Automatización de redes", summary: "Aprovisionamiento sin intervención para flotas de firewalls.", tag: "Infra", accent: "cyan" },
  { title: "Servidores MCP", summary: "Herramientas para que los LLM operen sistemas reales con seguridad.", tag: "MCP", accent: "emerald" },
  { title: "Mundos 3D en la web", summary: "Este metaverso: escritorio, móvil y VR desde el navegador.", tag: "WebXR", accent: "amber" },
];

export const ACCENTS: Record<Solution["accent"], string> = {
  cyan: "text-cyan-300 bg-cyan-400/10 border-cyan-400/20",
  violet: "text-violet-300 bg-violet-400/10 border-violet-400/20",
  emerald: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20",
  amber: "text-amber-300 bg-amber-400/10 border-amber-400/20",
};
