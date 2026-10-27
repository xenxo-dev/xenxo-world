/**
 * Almacén de assets direccionado por contenido, sobre R2 (10 GB gratis, sin coste de descarga).
 *
 *   POST /assets?kind=avatar|model|monument|cover   (Bearer token con scope "upload")
 *   GET  /assets/<sha256-hex>        (público, inmutable, cacheable para siempre)
 *
 * El servidor no se fía de nada del cliente: vuelve a inspeccionar el GLB,
 * calcula el hash, aplica el presupuesto y guarda lo que midió.
 */
import {
  ASSET_BUDGETS,
  checkBudget,
  COVER_BUDGET,
  PORTRAIT_BUDGET,
  GLB_MEDIA,
  GlbError,
  imageSize,
  inspectGlb,
  sha256Hash,
  sniffImage,
  type AssetKind,
} from "@xenxo/assets";
import type { Principal } from "./auth";
import { AVATAR_PRESETS } from "./avatar-presets";
import { SEED_ASSETS } from "./seed-assets";
import { SEED_COVERS } from "./seed-covers";

const SYSTEM_HASHES = new Set([
  ...Object.values(SEED_ASSETS).flatMap((a) => a.lods.map((l) => l.hash.slice(7))),
  ...AVATAR_PRESETS.map((a) => a.hash.slice(7)),
]);
/** Portadas del sistema (la de la plaza): imágenes servidas como recurso estático. */
const SYSTEM_COVERS = new Set(Object.values(SEED_COVERS).map((h) => h.slice(7)));

/** ¿Es un modelo generado por la forja y servido como recurso estático? */
export function isSystemAsset(hex: string): boolean {
  return SYSTEM_HASHES.has(hex) || SYSTEM_COVERS.has(hex);
}

export function assetKey(hash: string): string {
  return `assets/${hash.replace(/^sha256:/, "")}`;
}

export type UploadKind = AssetKind | "cover" | "portrait";

export interface UploadResult {
  hash: string;
  kind: UploadKind;
  format: "glb" | "vrm" | "image";
  /** Tipo de contenido con el que se sirve. */
  media: string;
  triangles: number;
  bytes: number;
  bounds: { min: number[]; max: number[] } | null;
  existed: boolean;
}

export type UploadOutcome =
  | { ok: true; data: UploadResult }
  | { ok: false; status: number; error: string; message: string; detail?: unknown };

export async function handleUpload(req: Request, principal: Principal, bucket: R2Bucket): Promise<UploadOutcome> {
  if (!principal.scopes.includes("upload")) {
    return { ok: false, status: 403, error: "forbidden", message: "crea una cuenta para subir modelos" };
  }
  const kindParam = new URL(req.url).searchParams.get("kind");
  if (kindParam === "cover" || kindParam === "portrait") return uploadImage(req, bucket, kindParam);
  if (kindParam !== "avatar" && kindParam !== "model" && kindParam !== "monument") {
    return { ok: false, status: 400, error: "bad_kind", message: "kind debe ser avatar, model, monument, cover o portrait" };
  }
  const kind: AssetKind = kindParam;
  const max = ASSET_BUDGETS[kind].maxBytes;
  const declared = Number(req.headers.get("Content-Length") ?? 0);
  if (declared > max) return { ok: false, status: 413, error: "too_large", message: `máximo ${Math.round(max / 1048576)} MB` };

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > max) return { ok: false, status: 413, error: "too_large", message: `máximo ${Math.round(max / 1048576)} MB` };

  let report;
  try {
    report = inspectGlb(bytes);
  } catch (e) {
    if (e instanceof GlbError) return { ok: false, status: 422, error: e.code, message: e.message, detail: e.detail };
    throw e;
  }
  const problems = checkBudget(report, kind);
  if (problems.length) {
    return { ok: false, status: 422, error: "budget_exceeded", message: "el modelo supera el presupuesto", detail: problems };
  }
  if (kind !== "avatar" && report.isVrm) {
    return { ok: false, status: 422, error: "bad_kind", message: "los VRM son avatares; súbelo como avatar" };
  }

  const hash = await sha256Hash(bytes);
  const key = assetKey(hash);
  const existed = (await bucket.head(key)) !== null;
  if (!existed) {
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: GLB_MEDIA, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: {
        kind,
        format: report.isVrm ? "vrm" : "glb",
        tris: String(report.triangles),
        bytes: String(report.bytes),
        bounds: JSON.stringify(report.bounds),
      },
    });
  }
  return {
    ok: true,
    data: {
      hash,
      kind,
      format: report.isVrm ? "vrm" : "glb",
      media: GLB_MEDIA,
      triangles: report.triangles,
      bytes: report.bytes,
      bounds: report.bounds,
      existed,
    },
  };
}

/**
 * Imágenes: la portada de un proyecto (16:9) o el retrato de un personaje (cuadrado). Solo WebP,
 * JPEG o PNG, comprobados por su firma y sus medidas reales.
 */
async function uploadImage(req: Request, bucket: R2Bucket, kind: "cover" | "portrait"): Promise<UploadOutcome> {
  const max = kind === "cover" ? COVER_BUDGET.maxBytes : PORTRAIT_BUDGET.maxBytes;
  const tooBig = { ok: false as const, status: 413, error: "too_large", message: `máximo ${Math.round(max / 1024)} KB` };
  if (Number(req.headers.get("Content-Length") ?? 0) > max) return tooBig;
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > max) return tooBig;
  const media = sniffImage(bytes);
  const dims = media ? imageSize(bytes) : null;
  if (!media || !dims) return { ok: false, status: 422, error: "bad_image", message: "debe ser una imagen WebP, JPEG o PNG" };
  const [w, h] = dims;
  const P = PORTRAIT_BUDGET;
  if (kind === "portrait" && (w !== h || w < P.minSide || w > P.maxSide)) {
    return { ok: false, status: 422, error: "bad_image", message: `el retrato debe ser cuadrado, de ${P.minSide} a ${P.maxSide} píxeles`, detail: { width: w, height: h } };
  }
  if (kind === "cover" && (w > COVER_BUDGET.maxWidth || h > COVER_BUDGET.maxHeight || w < 160 || h < 90)) {
    return {
      ok: false,
      status: 422,
      error: "bad_image",
      message: `la portada debe medir entre 160×90 y ${COVER_BUDGET.maxWidth}×${COVER_BUDGET.maxHeight} píxeles`,
      detail: { width: w, height: h },
    };
  }
  const hash = await sha256Hash(bytes);
  const key = assetKey(hash);
  const existed = (await bucket.head(key)) !== null;
  if (!existed) {
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: media, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { kind, format: "image", bytes: String(bytes.byteLength), width: String(w), height: String(h) },
    });
  }
  return {
    ok: true,
    data: { hash, kind, format: "image", media, triangles: 0, bytes: bytes.byteLength, bounds: null, existed },
  };
}

export async function handleGet(hex: string, bucket: R2Bucket, req: Request, ctx: ExecutionContext, statik?: Fetcher): Promise<Response> {
  if (!/^[0-9a-f]{64}$/.test(hex)) return new Response("not found", { status: 404 });
  const etag = `"${hex}"`;
  const common = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
  };
  if (req.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: common });
  // Modelos del sistema (la plaza y los avatares de serie): vienen con el propio Worker, no de R2.
  if (statik && isSystemAsset(hex)) {
    const cover = SYSTEM_COVERS.has(hex);
    const r = await statik.fetch(new Request(`https://static.local/s/${hex}.${cover ? "webp" : "glb"}`));
    if (r.ok) return new Response(r.body, { headers: { ...common, "Content-Type": cover ? "image/webp" : GLB_MEDIA } });
  }
  // Los de la gente, de R2 a través de la caché de Cloudflare: un mismo modelo se lee de R2
  // una vez por centro de datos, no una por visitante (lecturas de R2 dentro del plan gratuito).
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const cacheKey = new Request(new URL(`/assets/${hex}`, req.url).toString(), { method: "GET" });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return req.method === "HEAD" ? new Response(null, { headers: hit.headers }) : hit;
  }
  const obj = await bucket.get(`assets/${hex}`);
  if (!obj) return new Response("not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  const res = new Response(obj.body, { headers: { ...common, "Content-Type": obj.httpMetadata?.contentType ?? GLB_MEDIA } });
  if (cache) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return req.method === "HEAD" ? new Response(null, { headers: res.headers }) : res;
}

/**
 * Borra archivos de la gente: de R2 y de la caché de este centro de datos (en los demás caduca
 * sola; el enlace es un hash que nadie conoce si no lo tenía).
 */
export async function forgetAssets(bucket: R2Bucket, reqUrl: string, hashes: string[]) {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  for (const hash of hashes) {
    const hex = hash.replace(/^sha256:/, "");
    await bucket.delete(`assets/${hex}`);
    await cache?.delete(new Request(new URL(`/assets/${hex}`, reqUrl).toString(), { method: "GET" }));
  }
}

/** Metadatos guardados al subir (los usa el Directory para validar avatares y proyectos). */
export async function assetMeta(bucket: R2Bucket, hash: string) {
  const head = await bucket.head(assetKey(hash));
  if (!head) return null;
  const m = head.customMetadata ?? {};
  return {
    kind: m.kind as UploadKind,
    format: (m.format ?? "glb") as "glb" | "vrm" | "image",
    triangles: Number(m.tris ?? 0),
    bounds: m.bounds ? (JSON.parse(m.bounds) as { min: number[]; max: number[] } | null) : null,
  };
}
