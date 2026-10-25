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
  "nav.projects": "Proyectos",
  "projects.community": "De la comunidad",
  "projects.xenxo": "Repos de xenxo",
  "projects.publish": "Publicar el mío",
  "projects.empty": "Todavía no hay proyectos. ¡Publica el primero!",
  "projects.by": "por {name}",
  "projects.inWorld": "En la plaza",
  "projects.visit": "Visitar",
  "projects.report": "Denunciar",
  "projects.delete": "Borrar",
  "projects.loginToPublish": "Crea una cuenta o entra para publicar tu proyecto.",
  "projects.title": "Título",
  "projects.summary": "Descripción (opcional)",
  "projects.url": "Enlace (https://…, opcional)",
  "projects.model": "Modelo 3D para tu stand (.glb, opcional)",
  "projects.modelHint": "Se optimiza en tu navegador antes de subirlo. Máx. 50.000 triángulos y 6 MB.",
  "projects.submit": "Publicar",
  "projects.publishing": "Publicando…",
  "projects.published": "¡Publicado! Tu stand ya está en la exposición, delante de Proyectos.",
  "projects.publishedNoStand": "Publicado. No queda sitio en la exposición; tu proyecto aparece en la lista.",
  "account.title": "Tu cuenta",
  "account.intro": "Sin email ni contraseña: entras con una passkey (huella, cara o PIN de tu dispositivo).",
  "account.age": "Tengo 14 años o más",
  "account.termsPrefix": "Acepto las",
  "account.termsLink": "condiciones",
  "account.and": "y la",
  "account.privacyLink": "política de privacidad",
  "account.create": "Crear cuenta con passkey",
  "account.haveOne": "¿Ya tienes cuenta?",
  "account.login": "Entrar con passkey",
  "account.noPasskeys": "Este navegador no admite passkeys. Prueba con uno actualizado.",
  "account.logout": "Cerrar sesión",
  "account.export": "Descargar mis datos",
  "account.delete": "Borrar mi cuenta",
  "account.deleteConfirm": "¿Seguro? Se borrarán tu cuenta, tu personaje y tus proyectos. No se puede deshacer.",
  "account.signedAs": "Has entrado como {name}",
  "account.save": "Guardar",
  "account.saved": "Guardado",
  "avatar.title": "Tu personaje",
  "avatar.intro": "Créalo con lo que quieras y súbelo en .glb o .vrm:",
  "avatar.blender": "Blender: Archivo → Exportar → glTF 2.0, formato binario (.glb). Personaje de pie sobre el suelo y mirando hacia ti en la vista frontal.",
  "avatar.vroid": "VRoid Studio u otras apps de avatares: exporta en VRM.",
  "avatar.other": "Cualquier otro .glb propio o con licencia CC0 también vale.",
  "avatar.budget": "Máx. 30.000 triángulos y 4 MB. Las texturas grandes se reducen solas a 1024 px.",
  "avatar.choose": "Elegir archivo",
  "avatar.preparing": "Preparando el modelo…",
  "avatar.ready": "{tris} triángulos · {kb} KB",
  "avatar.upload": "Usar como mi personaje",
  "avatar.uploading": "Subiendo…",
  "avatar.current": "Ya usas un personaje propio.",
  "avatar.remove": "Volver al personaje por defecto",
  "avatar.done": "¡Listo! Así te verán en la plaza.",
  "avatar.needAccount": "Crea una cuenta para usar tu propio personaje.",
  "budget.bytes": "Pesa {value} KB (máx. {max} KB)",
  "budget.triangles": "Tiene {value} triángulos (máx. {max})",
  "budget.texture": "Tiene texturas de {value} px (máx. {max} px)",
  "report.title": "Denunciar contenido",
  "report.reason": "Motivo",
  "report.reason.illegal": "Contenido ilegal",
  "report.reason.hate": "Odio o discriminación",
  "report.reason.harassment": "Acoso",
  "report.reason.sexual": "Contenido sexual",
  "report.reason.minors": "Riesgo para menores",
  "report.reason.violence": "Violencia",
  "report.reason.spam": "Spam o engaño",
  "report.reason.ip": "Derechos de autor o marca",
  "report.reason.other": "Otro",
  "report.details": "Detalles (opcional)",
  "report.send": "Enviar denuncia",
  "report.sent": "Gracias. Lo revisaremos lo antes posible.",
  "common.cancel": "Cancelar",
  "common.error": "Algo ha fallado: {msg}",
  "legal.privacy": "Privacidad",
  "legal.terms": "Condiciones",
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
  "nav.projects": "Projects",
  "projects.community": "From the community",
  "projects.xenxo": "xenxo repos",
  "projects.publish": "Publish mine",
  "projects.empty": "No projects yet. Be the first to publish one!",
  "projects.by": "by {name}",
  "projects.inWorld": "In the plaza",
  "projects.visit": "Visit",
  "projects.report": "Report",
  "projects.delete": "Delete",
  "projects.loginToPublish": "Create an account or sign in to publish your project.",
  "projects.title": "Title",
  "projects.summary": "Description (optional)",
  "projects.url": "Link (https://…, optional)",
  "projects.model": "3D model for your stand (.glb, optional)",
  "projects.modelHint": "It's optimised in your browser before uploading. Max 50,000 triangles and 6 MB.",
  "projects.submit": "Publish",
  "projects.publishing": "Publishing…",
  "projects.published": "Published! Your stand is now in the expo, in front of Projects.",
  "projects.publishedNoStand": "Published. The expo is full, so your project shows up in the list.",
  "account.title": "Your account",
  "account.intro": "No email, no password: you sign in with a passkey (your device's fingerprint, face or PIN).",
  "account.age": "I am 14 or older",
  "account.termsPrefix": "I accept the",
  "account.termsLink": "terms",
  "account.and": "and the",
  "account.privacyLink": "privacy policy",
  "account.create": "Create account with a passkey",
  "account.haveOne": "Already have an account?",
  "account.login": "Sign in with a passkey",
  "account.noPasskeys": "This browser doesn't support passkeys. Try an up-to-date one.",
  "account.logout": "Sign out",
  "account.export": "Download my data",
  "account.delete": "Delete my account",
  "account.deleteConfirm": "Are you sure? Your account, character and projects will be deleted. This can't be undone.",
  "account.signedAs": "Signed in as {name}",
  "account.save": "Save",
  "account.saved": "Saved",
  "avatar.title": "Your character",
  "avatar.intro": "Make it with whatever you like and upload it as .glb or .vrm:",
  "avatar.blender": "Blender: File → Export → glTF 2.0, binary format (.glb). Character standing on the ground and facing you in the front view.",
  "avatar.vroid": "VRoid Studio or other avatar apps: export as VRM.",
  "avatar.other": "Any other .glb of your own or under a CC0 licence works too.",
  "avatar.budget": "Max 30,000 triangles and 4 MB. Large textures are shrunk to 1024 px automatically.",
  "avatar.choose": "Choose file",
  "avatar.preparing": "Preparing the model…",
  "avatar.ready": "{tris} triangles · {kb} KB",
  "avatar.upload": "Use as my character",
  "avatar.uploading": "Uploading…",
  "avatar.current": "You're using your own character.",
  "avatar.remove": "Go back to the default character",
  "avatar.done": "Done! This is how others will see you in the plaza.",
  "avatar.needAccount": "Create an account to use your own character.",
  "budget.bytes": "It's {value} KB (max {max} KB)",
  "budget.triangles": "It has {value} triangles (max {max})",
  "budget.texture": "It has {value} px textures (max {max} px)",
  "report.title": "Report content",
  "report.reason": "Reason",
  "report.reason.illegal": "Illegal content",
  "report.reason.hate": "Hate or discrimination",
  "report.reason.harassment": "Harassment",
  "report.reason.sexual": "Sexual content",
  "report.reason.minors": "Risk to minors",
  "report.reason.violence": "Violence",
  "report.reason.spam": "Spam or scam",
  "report.reason.ip": "Copyright or trademark",
  "report.reason.other": "Other",
  "report.details": "Details (optional)",
  "report.send": "Send report",
  "report.sent": "Thank you. We'll review it as soon as possible.",
  "common.cancel": "Cancel",
  "common.error": "Something went wrong: {msg}",
  "legal.privacy": "Privacy",
  "legal.terms": "Terms",
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
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(`{${k}}`, typeof v === "number" ? v.toLocaleString(lang === "es" ? "es-ES" : "en-GB") : v);
  }
  return s;
}

/** Ruta de las páginas legales en el idioma actual. */
export function legalPath(doc: "privacy" | "terms"): string {
  if (lang === "es") return doc === "privacy" ? "/legal/privacidad.html" : "/legal/condiciones.html";
  return doc === "privacy" ? "/legal/privacy.html" : "/legal/terms.html";
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
