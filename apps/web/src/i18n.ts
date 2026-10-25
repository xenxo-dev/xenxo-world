/**
 * Traducciones del cliente, sin dependencias. Añadir un idioma = añadir un diccionario.
 * Los textos del MUNDO (carteles) no van aquí: viajan como datos en label@1.i18n.
 */
import { useSyncExternalStore } from "react";
import { loadPref, savePref } from "./config";

const es = {
  "nav.solutions": "Soluciones",
  "nav.repos": "Repos",
  "nav.agents": "Agentes",
  "nav.customize": "Personalizar",
  "enter.world": "Entrar al mundo",
  "enter.vr": "Entrar en VR",
  "online.title": "Personas y agentes en la plaza",
  "repos.loading": "Cargando…",
  "repos.empty": "Aún no hay repos públicos que mostrar en",
  "repos.noDescription": "Sin descripción",
  "agents.online": "Online",
  "agents.agents": "Agentes",
  "agents.entities": "Entidades",
  "agents.recent": "Últimos cambios en la plaza",
  "agents.offline": "Sin conexión con el mundo ahora mismo.",
  "agents.none": "Nadie ha construido todavía. ¿Serás tú, o un agente?",
  "agents.agentPrefix": "agente",
  "customize.name": "Nombre visible",
  "customize.quality": "Calidad gráfica",
  "customize.low": "Ahorro",
  "customize.high": "Alta",
  "customize.language": "Idioma",
  "customize.nameNote": "Los cambios de nombre se aplican la próxima vez que entres.",
  "hud.back": "← Panel",
  "hud.backLabel": "Volver al panel",
  "hud.inPlaza": "{n} en la plaza",
  "hud.connecting": "conectando…",
  "hud.desktopHint": "WASD para moverte · arrastra para mirar",
  "hud.joystick": "Joystick de movimiento",
  "ago.s": "hace {n} s",
  "ago.m": "hace {n} min",
  "ago.h": "hace {n} h",
  "ago.d": "hace {n} d",
  "guest": "visitante",
} as const;

export type Key = keyof typeof es;

const en: Record<Key, string> = {
  "nav.solutions": "Solutions",
  "nav.repos": "Repos",
  "nav.agents": "Agents",
  "nav.customize": "Customize",
  "enter.world": "Enter world",
  "enter.vr": "Enter VR",
  "online.title": "People and agents in the plaza",
  "repos.loading": "Loading…",
  "repos.empty": "No public repos to show yet at",
  "repos.noDescription": "No description",
  "agents.online": "Online",
  "agents.agents": "Agents",
  "agents.entities": "Entities",
  "agents.recent": "Latest changes in the plaza",
  "agents.offline": "Can't reach the world right now.",
  "agents.none": "Nobody has built anything yet. Will it be you, or an agent?",
  "agents.agentPrefix": "agent",
  "customize.name": "Display name",
  "customize.quality": "Graphics quality",
  "customize.low": "Battery saver",
  "customize.high": "High",
  "customize.language": "Language",
  "customize.nameNote": "Name changes apply the next time you enter.",
  "hud.back": "← Panel",
  "hud.backLabel": "Back to the panel",
  "hud.inPlaza": "{n} in the plaza",
  "hud.connecting": "connecting…",
  "hud.desktopHint": "WASD to move · drag to look",
  "hud.joystick": "Movement joystick",
  "ago.s": "{n}s ago",
  "ago.m": "{n} min ago",
  "ago.h": "{n}h ago",
  "ago.d": "{n}d ago",
  "guest": "visitor",
};

const DICTS = { es, en } satisfies Record<string, Record<Key, string>>;
export type Lang = keyof typeof DICTS;
export const LANGS: { id: Lang; label: string }[] = [
  { id: "es", label: "Español" },
  { id: "en", label: "English" },
];

function detect(): Lang {
  const saved = loadPref<string | null>("lang", null);
  if (saved && saved in DICTS) return saved as Lang;
  const nav = (navigator.languages?.[0] ?? navigator.language ?? "es").slice(0, 2).toLowerCase();
  return nav in DICTS ? (nav as Lang) : "en";
}

let lang: Lang = detect();
const listeners = new Set<() => void>();
document.documentElement.lang = lang;

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang) {
  lang = l;
  savePref("lang", l);
  document.documentElement.lang = l;
  for (const fn of listeners) fn();
}

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  let s: string = DICTS[lang][key];
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Re-renderiza el componente cuando cambia el idioma. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => lang,
  );
}
