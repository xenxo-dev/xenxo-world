/**
 * La receta de una funda: con qué base, ajustes, piel, ojos, piezas y colores se monta. Es lo que
 * se guarda para volver a editarla; el VRM que se sube se monta a partir de ella.
 */
import type { Kit, PartCat } from "./kit";

/** Dónde viaja la receta dentro del VRM (`extras` de la raíz del glTF). */
export const RECIPE_KEY = "xenxo:funda";

export type Slot = Exclude<PartCat, "body" | "eyes" | "lashes">;
export const SLOTS: Slot[] = ["hair", "brows", "beard", "top", "bottom", "outfit", "shoes", "hat", "glasses", "gloves"];

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
}

export const HAIR_COLORS = ["#1b1512", "#3b2a20", "#5a3b25", "#8a5a32", "#b8834c", "#d9b77a", "#e8d7a8", "#a33b20", "#c45a2c", "#9a9a9a", "#e8e8e8", "#3a5aa8", "#c04a8a", "#4aa86a"];
export const CLOTH_COLORS = ["#f6f1e7", "#d8d8d8", "#7a7a7a", "#2a2a2e", "#111114", "#1e2f55", "#2f6fb0", "#36d9ff", "#2e5a3a", "#5b8f3a", "#d9a441", "#c8553d", "#8a2a2a", "#ff4fd8", "#6a4a8a", "#8a6a4a"];

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
  out.hair = hex(r.hair) ?? "#3b2a20";
  for (const [k, v] of Object.entries(r.colors ?? {})) {
    const h = hex(v);
    if (h && kit.parts.some((p) => p.id === k)) out.colors[k] = h;
  }
  return out;
}

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
