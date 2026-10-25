/**
 * @xenxo/assets — parte sin dependencias (válida en el servidor, el navegador y Node).
 * La optimización con gltf-transform está en "@xenxo/assets/optimize".
 */
export { ALLOWED_EXTENSIONS, GlbError, imageSize, inspectGlb, type GlbReport } from "./glb";

export type AssetKind = "avatar" | "model";

/**
 * Presupuestos de subida. Están pensados para la Quest 3: un avatar se dibuja
 * por cada persona cercana; un modelo, una vez por stand.
 */
export const ASSET_BUDGETS: Record<AssetKind, { maxBytes: number; maxTriangles: number; maxTexture: number }> = {
  avatar: { maxBytes: 4 * 1024 * 1024, maxTriangles: 30_000, maxTexture: 1024 },
  model: { maxBytes: 6 * 1024 * 1024, maxTriangles: 50_000, maxTexture: 2048 },
};

export interface BudgetProblem {
  what: "bytes" | "triangles" | "texture";
  value: number;
  max: number;
}

export function checkBudget(r: { bytes: number; triangles: number; maxTextureSize: number }, kind: AssetKind): BudgetProblem[] {
  const b = ASSET_BUDGETS[kind];
  const out: BudgetProblem[] = [];
  if (r.bytes > b.maxBytes) out.push({ what: "bytes", value: r.bytes, max: b.maxBytes });
  if (r.triangles > b.maxTriangles) out.push({ what: "triangles", value: r.triangles, max: b.maxTriangles });
  if (r.maxTextureSize > b.maxTexture) out.push({ what: "texture", value: r.maxTextureSize, max: b.maxTexture });
  return out;
}

/** "sha256:<hex>" de unos bytes, con WebCrypto (Workers, navegador y Node 22). */
export async function sha256Hash(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", view as Uint8Array<ArrayBuffer>));
  return "sha256:" + [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const GLB_MEDIA = "model/gltf-binary";
