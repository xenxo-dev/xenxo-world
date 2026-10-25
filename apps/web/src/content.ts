/**
 * Contenido editable del panel 2D, en español e inglés. Cambia esto sin tocar componentes.
 * TODO(pencho): sustituir las soluciones de ejemplo por las reales.
 */
import type { Lang } from "./i18n";

type Text = Record<Lang, string>;

export interface Solution {
  title: Text;
  summary: Text;
  tag: Text;
  accent: "terracota" | "azulejo" | "huerta" | "ocre";
  href?: string;
}

export const SOLUTIONS: Solution[] = [
  {
    title: { es: "Agentes de IA soberanos", en: "Sovereign AI agents" },
    summary: {
      es: "Stacks de agentes en Python sin frameworks, sobre modelos propios.",
      en: "Framework-free Python agent stacks running on self-hosted models.",
    },
    tag: { es: "IA", en: "AI" },
    accent: "terracota",
  },
  {
    title: { es: "Automatización de redes", en: "Network automation" },
    summary: {
      es: "Aprovisionamiento sin intervención para flotas de firewalls.",
      en: "Zero-touch provisioning for firewall fleets.",
    },
    tag: { es: "Infra", en: "Infra" },
    accent: "azulejo",
  },
  {
    title: { es: "Servidores MCP", en: "MCP servers" },
    summary: {
      es: "Herramientas para que los LLM operen sistemas reales con seguridad.",
      en: "Tools that let LLMs operate real systems safely.",
    },
    tag: { es: "MCP", en: "MCP" },
    accent: "huerta",
  },
  {
    title: { es: "Mundos 3D en la web", en: "3D worlds on the web" },
    summary: {
      es: "Esta plaza: escritorio, móvil y VR desde el navegador.",
      en: "This plaza: desktop, mobile and VR, straight from the browser.",
    },
    tag: { es: "WebXR", en: "WebXR" },
    accent: "ocre",
  },
];

export const ACCENTS: Record<Solution["accent"], string> = {
  terracota: "text-orange-200 bg-terracota/20 border-terracota/40",
  azulejo: "text-sky-200 bg-azulejo/25 border-azulejo/50",
  huerta: "text-lime-200 bg-huerta/25 border-huerta/50",
  ocre: "text-amber-200 bg-ocre/20 border-ocre/40",
};
