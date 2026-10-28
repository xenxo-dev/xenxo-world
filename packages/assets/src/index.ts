/**
 * @xenxo/assets — parte sin dependencias (válida en el servidor, el navegador y Node).
 * La optimización con gltf-transform está en "@xenxo/assets/optimize".
 */
export { ALLOWED_EXTENSIONS, GlbError, imageSize, inspectGlb, type GlbReport } from "./glb";

export type AssetKind = "avatar" | "model" | "monument";

/**
 * Presupuestos de subida. Están pensados para la Quest 3: un avatar se dibuja
 * por cada persona cercana; un modelo, una vez por stand.
 */
export const ASSET_BUDGETS: Record<
  AssetKind,
  { maxBytes: number; maxTriangles: number; maxTexture: number; maxVertices: number; maxImages: number; maxTexturePixels: number }
> = {
  avatar: { maxBytes: 4 * 1024 * 1024, maxTriangles: 30_000, maxTexture: 1024, maxVertices: 90_000, maxImages: 24, maxTexturePixels: 24 * 1024 * 1024 },
  model: { maxBytes: 6 * 1024 * 1024, maxTriangles: 50_000, maxTexture: 2048, maxVertices: 150_000, maxImages: 32, maxTexturePixels: 8 * 2048 * 2048 },
  /** Monumento de un proyecto en el nexo: hay hasta 23 a la vez a la vista. */
  monument: { maxBytes: 2 * 1024 * 1024, maxTriangles: 10_000, maxTexture: 1024, maxVertices: 30_000, maxImages: 8, maxTexturePixels: 6 * 1024 * 1024 },
};

/**
 * Portada de un proyecto (imagen 16:9 que se ve en su portal del nexo y en el nexo 2D).
 * El navegador la recorta y la convierte a WebP antes de subirla.
 */
export const COVER_BUDGET = { maxBytes: 300 * 1024, maxWidth: 1600, maxHeight: 900 } as const;

/** Retrato del personaje (lo hace la web de xenxo en el navegador): cuadrado, de 128 a 512 px. */
export const PORTRAIT_BUDGET = { maxBytes: 120 * 1024, minSide: 128, maxSide: 512 } as const;

/** Tipo real de una imagen por su firma (no por lo que diga quien la sube). */
export function sniffImage(d: Uint8Array): "image/webp" | "image/jpeg" | "image/png" | null {
  if (d.length < 12) return null;
  if (d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return "image/png";
  if (d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return "image/jpeg";
  if (d[0] === 0x52 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x46 && d[8] === 0x57 && d[9] === 0x45 && d[10] === 0x42 && d[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

export interface BudgetProblem {
  what: "bytes" | "triangles" | "texture" | "vertices" | "images" | "texturePixels";
  value: number;
  max: number;
}

export function checkBudget(
  r: { bytes: number; triangles: number; maxTextureSize: number; vertices?: number; images?: number; texturePixels?: number },
  kind: AssetKind,
): BudgetProblem[] {
  const b = ASSET_BUDGETS[kind];
  const out: BudgetProblem[] = [];
  if (r.bytes > b.maxBytes) out.push({ what: "bytes", value: r.bytes, max: b.maxBytes });
  if (r.triangles > b.maxTriangles) out.push({ what: "triangles", value: r.triangles, max: b.maxTriangles });
  if (r.maxTextureSize > b.maxTexture) out.push({ what: "texture", value: r.maxTextureSize, max: b.maxTexture });
  // Vértices (los puntos y las líneas no tienen triángulos, pero también pesan), número de
  // texturas y píxeles de todas juntas: lo que cuesta de verdad en la memoria de las gafas.
  if ((r.vertices ?? 0) > b.maxVertices) out.push({ what: "vertices", value: r.vertices!, max: b.maxVertices });
  if ((r.images ?? 0) > b.maxImages) out.push({ what: "images", value: r.images!, max: b.maxImages });
  if ((r.texturePixels ?? 0) > b.maxTexturePixels) out.push({ what: "texturePixels", value: r.texturePixels!, max: b.maxTexturePixels });
  return out;
}

/** "sha256:<hex>" de unos bytes, con WebCrypto (Workers, navegador y Node 22). */
export async function sha256Hash(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", view as Uint8Array<ArrayBuffer>));
  return "sha256:" + [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const GLB_MEDIA = "model/gltf-binary";
