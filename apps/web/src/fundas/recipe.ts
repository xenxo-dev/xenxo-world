/**
 * La receta de una funda: con qué base, ajustes, piel, ojos, piezas y colores se monta. Es lo que
 * se guarda para volver a editarla; el VRM que se sube se monta a partir de ella.
 */
import type { Kit, PartCat } from "./kit";

/** Dónde viaja la receta dentro del VRM (`extras` de la raíz del glTF). */
export const RECIPE_KEY = "xenxo:funda";

export type Slot = Exclude<PartCat, "body" | "eyes" | "lashes">;
export const SLOTS: Slot[] = ["hair", "brows", "beard", "top", "bottom", "outfit", "shoes", "hat", "glasses", "gloves", "implant"];

/** Zonas del cuerpo con su propio acabado (las de `maps.zones` del kit, en ese orden). */
export type Zone = "head" | "torso" | "arm_l" | "arm_r" | "legs";
export const ZONES: Zone[] = ["head", "torso", "arm_l", "arm_r", "legs"];
/** Acabados: piel natural, piel sintética o carcasas de robot. */
export type Finish = "skin" | "synth" | "chrome" | "matte" | "carbon" | "porcelain";
export const FINISHES: Finish[] = ["skin", "synth", "chrome", "matte", "carbon", "porcelain"];
export const FINISH_COLOR: Record<Exclude<Finish, "skin">, string> = {
  synth: "#e2c3ad",
  chrome: "#c9ced6",
  matte: "#e9e9ec",
  carbon: "#2b2f36",
  porcelain: "#f3f1eb",
};
/** Colores propuestos para cada acabado (además del color libre). */
export const FINISH_PALETTE: Record<Exclude<Finish, "skin">, string[]> = {
  synth: ["#f1d3bf", "#e2c3ad", "#c99a7a", "#8d5a3c", "#5b3a29", "#d8dde6", "#9fb4c8", "#b8a0d8"],
  chrome: ["#c9ced6", "#e8c77a", "#c27b4a", "#2a2d33", "#8fa8c8", "#d6a6c2"],
  matte: ["#e9e9ec", "#2b2f36", "#c8553d", "#2f6fb0", "#d9a441", "#36d9ff", "#5b8f3a", "#ff4fd8"],
  carbon: ["#2b2f36", "#1e2f55", "#3a2a2e", "#2e3a2a", "#4a4a52"],
  porcelain: ["#f3f1eb", "#e8e4dc", "#f0e4e6", "#e2eaf2", "#2a2a2e"],
};
export const isRobot = (f: Finish | undefined) => f === "chrome" || f === "matte" || f === "carbon" || f === "porcelain";

export type PatternKind = "stripes" | "checks" | "dots" | "camo" | "gradient";
export const PATTERNS: PatternKind[] = ["stripes", "checks", "dots", "camo", "gradient"];
/** Estampado de una prenda: dos colores (el de la prenda y este) y un tamaño (0 pequeño … 1 grande). */
export interface Pattern {
  kind: PatternKind;
  color: string;
  scale: number;
}
/** Imagen (o texto ya dibujado) en el pecho o la espalda: tamaño 0,2…1 y altura −1…1. */
export interface Print {
  img: string;
  size: number;
  y: number;
  text?: string;
  font?: PrintFont;
}
export type PrintFont = "display" | "body" | "mono";
export const PRINT_FONTS: PrintFont[] = ["display", "body", "mono"];
/** Las prendas que admiten imagen o texto. */
export const PRINTABLE = new Set<PartCat>(["top", "outfit"]);
/** Tamaño máximo de una imagen dentro de la receta (data URL). */
export const PRINT_MAX = 240_000;

export interface Tinted {
  color: string;
  amount: number;
}
export interface Looks {
  lips?: Tinted;
  shadow?: Tinted;
  blush?: Tinted;
  /** Barba de tres días (del color del pelo) y pecas: 0…1. */
  stubble?: number;
  freckles?: number;
}
export interface Synth {
  zones?: Partial<Record<Zone, { finish: Finish; color: string }>>;
  /** Color de las líneas que brillan (juntas e implantes); sin él, no brillan. */
  glow?: string;
  /** Ojos que brillan, de este color. */
  eyes?: string;
}

export interface Recipe {
  v: 1;
  base: "f" | "m";
  /** −1…1 por ajuste del cuerpo y de la cara (0 = neutro). */
  body: Record<string, number>;
  face: Record<string, number>;
  skin: string;
  eyes: string;
  /** Pieza elegida en cada hueco (o ninguna). */
  parts: Partial<Record<Slot, string>>;
  /** Color del pelo (cejas y barba lo siguen) y de cada prenda que se tiñe. */
  hair: string;
  colors: Record<string, string>;
  /** Tono libre de la piel (tiñe la piel elegida conservando su detalle). */
  skinTone?: string;
  /** Color libre del iris. */
  iris?: string;
  looks?: Looks;
  synth?: Synth;
  patterns?: Record<string, Pattern>;
  prints?: Record<string, { front?: Print; back?: Print }>;
}

export const LIP_COLORS = ["#b8323f", "#d2465a", "#8e2236", "#c86a6a", "#e08a7a", "#7a3a5a", "#5a2030", "#e04a8a"];
export const SHADOW_COLORS = ["#4a3a5a", "#6a4a3a", "#2a2a35", "#3a5a8a", "#6a8aa0", "#8a5aa0", "#b08a5a", "#2e6a5a"];
export const BLUSH_COLORS = ["#e07a7a", "#e8949a", "#d0705a", "#c8607a", "#b05a5a"];
export const GLOW_COLORS = ["#3ee6ff", "#7a5cff", "#ff4fd8", "#ff5a3a", "#ffd23e", "#58ff9a", "#ffffff"];

export const HAIR_COLORS = ["#1b1512", "#3b2a20", "#5a3b25", "#8a5a32", "#b8834c", "#d9b77a", "#e8d7a8", "#a33b20", "#c45a2c", "#9a9a9a", "#e8e8e8", "#3a5aa8", "#c04a8a", "#4aa86a"];
export const CLOTH_COLORS = ["#f6f1e7", "#d8d8d8", "#7a7a7a", "#2a2a2e", "#111114", "#1e2f55", "#2f6fb0", "#36d9ff", "#2e5a3a", "#5b8f3a", "#d9a441", "#c8553d", "#8a2a2a", "#ff4fd8", "#6a4a8a", "#8a6a4a"];

/** Color de muestra de cada textura de ojos (selector y funda desde una foto). */
export const EYE_SWATCH: Record<string, string> = {
  brown: "#4a2c1a", brownlight: "#7a5230", green: "#4f7a3a", bluegreen: "#3f7f7a", blue: "#3a6aa8",
  lightblue: "#7aa8d8", deepblue: "#24407a", grey: "#7a8088", ice: "#b8d4e8",
};

export function defaultRecipe(base: "f" | "m" = "f"): Recipe {
  return {
    v: 1,
    base,
    body: {},
    face: {},
    skin: base === "f" ? "young_caucasian_f" : "young_caucasian_m",
    eyes: "brown",
    parts:
      base === "f"
        ? { hair: "hair_ponytail", brows: "brows_10", top: "top_tee_f", bottom: "bot_cargo", shoes: "sh_03" }
        : { hair: "hair_short02", brows: "brows_01", top: "top_tee", bottom: "bot_cargo", shoes: "sh_03" },
    hair: "#3b2a20",
    colors: {},
  };
}

/** Deja la receta dentro de lo que el kit tiene (piezas que existen, valores en rango, ropa mínima). */
export function cleanRecipe(r: Recipe, kit: Kit): Recipe {
  const out: Recipe = { ...r, body: {}, face: {}, parts: {}, colors: {} };
  out.base = r.base === "m" ? "m" : "f";
  for (const k of kit.body) if (typeof r.body?.[k] === "number") out.body[k] = clamp(r.body[k]!);
  for (const k of kit.face) if (typeof r.face?.[k] === "number") out.face[k] = clamp(r.face[k]!);
  out.skin = kit.skins.some((s) => s.id === r.skin) ? r.skin : kit.skins[0]!.id;
  out.eyes = kit.eyes.includes(r.eyes) ? r.eyes : kit.eyes[0]!;
  for (const s of SLOTS) {
    const id = r.parts?.[s];
    if (id && kit.parts.some((p) => p.id === id && p.cat === s)) out.parts[s] = id;
  }
  // Un conjunto ocupa arriba y abajo; sin conjunto, siempre hay algo arriba y abajo.
  if (out.parts.outfit) {
    delete out.parts.top;
    delete out.parts.bottom;
  } else {
    out.parts.top ??= kit.parts.find((p) => p.cat === "top")?.id;
    out.parts.bottom ??= kit.parts.find((p) => p.cat === "bottom")?.id;
  }
  for (const k of kit.detail ?? []) if (typeof r.body?.[k] === "number") out.body[k] = clamp(r.body[k]!);
  out.hair = hex(r.hair) ?? "#3b2a20";
  const known = (id: string) => kit.parts.some((p) => p.id === id);
  for (const [k, v] of Object.entries(r.colors ?? {})) {
    const h = hex(v);
    if (h && known(k)) out.colors[k] = h;
  }
  delete out.skinTone;
  delete out.iris;
  delete out.looks;
  delete out.synth;
  delete out.patterns;
  delete out.prints;
  const tone = hex(r.skinTone);
  if (tone) out.skinTone = tone;
  const iris = hex(r.iris);
  if (iris) out.iris = iris;
  // Maquillaje y piel.
  const looks: Looks = {};
  for (const k of ["lips", "shadow", "blush"] as const) {
    const t = r.looks?.[k];
    const c = hex(t?.color);
    const a = unit(t?.amount);
    if (c && a > 0) looks[k] = { color: c, amount: a };
  }
  for (const k of ["stubble", "freckles"] as const) {
    const a = unit(r.looks?.[k]);
    if (a > 0) looks[k] = a;
  }
  if (Object.keys(looks).length) out.looks = looks;
  // Acabados sintéticos o robóticos.
  const synth: Synth = {};
  const zones: NonNullable<Synth["zones"]> = {};
  for (const z of ZONES) {
    const v = r.synth?.zones?.[z];
    if (!v || !FINISHES.includes(v.finish) || v.finish === "skin") continue;
    zones[z] = { finish: v.finish, color: hex(v.color) ?? FINISH_COLOR[v.finish] };
  }
  if (Object.keys(zones).length) synth.zones = zones;
  const glow = hex(r.synth?.glow);
  if (glow) synth.glow = glow;
  const eyes = hex(r.synth?.eyes);
  if (eyes) synth.eyes = eyes;
  if (Object.keys(synth).length) out.synth = synth;
  // Estampados (como los colores, se guardan aunque la prenda no se lleve ahora).
  const patterns: Record<string, Pattern> = {};
  for (const [k, v] of Object.entries(r.patterns ?? {})) {
    const c = hex(v?.color);
    if (c && known(k) && PATTERNS.includes(v.kind)) patterns[k] = { kind: v.kind, color: c, scale: unit(v.scale) };
  }
  if (Object.keys(patterns).length) out.patterns = patterns;
  // Imágenes y textos: solo en lo que se lleva puesto (pesan).
  const worn = new Set(Object.values(out.parts));
  const prints: NonNullable<Recipe["prints"]> = {};
  for (const [k, v] of Object.entries(r.prints ?? {})) {
    const part = kit.parts.find((p) => p.id === k);
    if (!part || !PRINTABLE.has(part.cat) || !worn.has(k)) continue;
    const front = cleanPrint(v?.front);
    const back = cleanPrint(v?.back);
    if (front || back) prints[k] = { ...(front ? { front } : {}), ...(back ? { back } : {}) };
  }
  if (Object.keys(prints).length) out.prints = prints;
  return out;
}

function cleanPrint(p: Print | undefined): Print | null {
  if (!p || typeof p.img !== "string" || p.img.length > PRINT_MAX) return null;
  if (!/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(p.img)) return null;
  const out: Print = { img: p.img, size: Math.max(0.2, Math.min(1, num(p.size, 0.6))), y: clamp(num(p.y, 0)) };
  if (typeof p.text === "string" && p.text.trim()) out.text = p.text.slice(0, 40);
  if (p.font && PRINT_FONTS.includes(p.font)) out.font = p.font;
  return out;
}

const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
const unit = (x: unknown) => Math.max(0, Math.min(1, num(x, 0)));
const clamp = (x: number) => Math.max(-1, Math.min(1, Number.isFinite(x) ? x : 0));
const hex = (s: unknown) => (typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null);

/** La receta de una funda (si la tiene), leída del JSON del GLB. */
export function recipeInGlb(bytes: Uint8Array): Recipe | null {
  if (bytes.length < 20) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) return null;
  const len = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a || 20 + len > bytes.length) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as { extras?: Record<string, unknown> };
    const r = json.extras?.[RECIPE_KEY] as Recipe | undefined;
    return r && typeof r === "object" && r.v === 1 ? r : null;
  } catch {
    return null;
  }
}
