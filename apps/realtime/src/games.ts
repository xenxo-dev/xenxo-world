/**
 * Juegos de terceros: leer y comprobar su ficha (`xenxo.json`) desde el servidor. El navegador del
 * visitante nunca la pide: la lee el Worker al registrar el juego y xenxo guarda una copia.
 *
 * Defensas al leer una web ajena: solo https a un nombre de dominio público (nada de IPs,
 * localhost ni nombres internos), sin seguir redirecciones, 5 s como mucho y 32 KB como mucho.
 */
import { GameManifest, PROJECT_CATEGORIES } from "@xenxo/protocol";
import { DISTRICTS } from "./districts";

export const MANIFEST_MAX_BYTES = 32 * 1024;
const FETCH_TIMEOUT_MS = 5000;

export type GameInfo = {
  name: Record<string, string>;
  description: Record<string, string>;
  category: (typeof PROJECT_CATEGORIES)[number];
  devices: ("pc" | "mobile" | "vr")[];
  multiplayer: boolean;
  ageRating: "all" | "+14";
  monetization: { hasAds: boolean; hasPurchases: boolean };
  author: string;
  contact: string;
  privacy: string;
  /** Se puede abrir dentro de xenxo (el servidor lo apaga si el juego vive en xenxo.io). */
  embed: boolean;
  /** Dónde está alojado (lo que se enseña en el aviso previo). */
  host: string;
  /** Dirección del juego (la del proyecto). */
  url: string;
};

type Problem = { ok: false; error: string; message: string; detail?: unknown };

const bad = (error: string, message: string, detail?: unknown): Problem => ({ ok: false, error, message, detail });

/** ¿Es un nombre de dominio público? (no una IP, ni localhost, ni un nombre interno). */
export function publicHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (!h.includes(".") || h.startsWith("[") || /^[\d.]+$/.test(h)) return false;
  if (h === "localhost" || /\.(localhost|local|internal|lan|home|test|invalid|example)$/.test(h)) return false;
  return /^[a-z0-9.-]+$/.test(h);
}

/** ¿Vive en xenxo? Entonces no se incrusta: compartiría origen con la web de xenxo. */
export function xenxoHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "xenxo.io" || h.endsWith(".xenxo.io");
}

/** Dónde se busca la ficha: junto a la página del juego (sirve también en GitHub Pages con subcarpeta). */
export function manifestUrl(gameUrl: string): URL {
  const u = new URL(gameUrl);
  u.search = "";
  u.hash = "";
  return new URL("xenxo.json", u);
}

/** Lee y comprueba el xenxo.json de un juego. */
export async function fetchManifest(gameUrl: string): Promise<{ ok: true; manifest: GameManifest; at: string } | Problem> {
  let target: URL;
  try {
    target = manifestUrl(gameUrl);
  } catch {
    return bad("bad_url", "la dirección del proyecto no es válida");
  }
  if (target.protocol !== "https:" || !publicHostname(target.hostname) || target.port) {
    return bad("bad_url", "el juego tiene que estar en https y en un dominio público (sin IPs ni puertos)");
  }
  let res: Response;
  try {
    res = await fetch(target.toString(), {
      redirect: "manual",
      headers: { Accept: "application/json", "User-Agent": "xenxo.io (registro de juegos; https://xenxo.io)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return bad("manifest_unreachable", `no se pudo leer ${target} (¿está publicado?)`);
  }
  if (res.status >= 300 && res.status < 400) {
    return bad("manifest_redirect", `${target} redirige a otra dirección: pon en el proyecto la dirección final del juego`);
  }
  if (!res.ok) return bad("manifest_unreachable", `${target} respondió ${res.status}: ¿está en la misma carpeta que el juego?`);
  const declared = Number(res.headers.get("Content-Length") ?? 0);
  if (declared > MANIFEST_MAX_BYTES) return bad("manifest_too_big", "el xenxo.json no puede pasar de 32 KB");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MANIFEST_MAX_BYTES) return bad("manifest_too_big", "el xenxo.json no puede pasar de 32 KB");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return bad("manifest_invalid", "el xenxo.json no es JSON válido");
  }
  const parsed = GameManifest.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`);
    return bad("manifest_invalid", "el xenxo.json no cumple el esquema xenxo.game/0", { issues });
  }
  return { ok: true, manifest: parsed.data, at: target.toString() };
}

/** Solo en local (RP_ID=localhost, pruebas): la ficha de un servidor de pruebas en localhost. */
export async function fetchDevManifest(raw: string): Promise<{ ok: true; manifest: GameManifest; at: string } | Problem> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return bad("bad_url", "manifest_url no válida");
  }
  if (!["localhost", "127.0.0.1"].includes(u.hostname)) return bad("bad_url", "en local, manifest_url tiene que ser de localhost");
  const res = await fetch(u.toString(), { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => null);
  if (!res?.ok) return bad("manifest_unreachable", `no se pudo leer ${u}`);
  let rawJson: unknown;
  try {
    rawJson = await res.json();
  } catch {
    return bad("manifest_invalid", "el xenxo.json no es JSON válido");
  }
  const parsed = GameManifest.safeParse(rawJson);
  if (!parsed.success) {
    return bad("manifest_invalid", "el xenxo.json no cumple el esquema xenxo.game/0", {
      issues: parsed.error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`),
    });
  }
  return { ok: true, manifest: parsed.data, at: u.toString() };
}

/** Nombres que no puede llevar un juego en xenxo.io/j/<nombre>. */
const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "auth", "cuenta", "account", "games", "juegos", "j", "p", "mcp", "sdk", "nexo",
  "plaza", "legal", "moderacion", "moderation", "oidc", "xenxo", "help", "ayuda", "soporte", "support",
  ...DISTRICTS.map((d) => d.id),
]);

export function validSlug(raw: unknown, founder = false): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(s) || s.includes("--")) return null;
  if (RESERVED_SLUGS.has(s) || (!founder && s.includes("xenxo"))) return null;
  return s;
}

/** Nombre corto a partir del título: «Neón Runner!» → «neon-runner». */
export function slugFrom(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** Lo que se guarda y se enseña de la ficha (más lo que decide el servidor). */
export function gameInfo(m: GameManifest, projectUrl: string): GameInfo {
  const u = new URL(projectUrl);
  return {
    name: m.name,
    description: m.description,
    category: m.category,
    devices: m.devices,
    multiplayer: m.multiplayer,
    ageRating: m.ageRating,
    monetization: m.monetization,
    author: m.author,
    contact: m.contact,
    privacy: m.privacy!,
    embed: m.embed && !xenxoHost(u.hostname),
    host: u.host,
    url: projectUrl,
  };
}
