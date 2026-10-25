/**
 * Almacén de assets direccionado por contenido, sobre R2 (10 GB gratis, sin coste de descarga).
 *
 *   POST /assets?kind=avatar|model   (Bearer token con scope "upload")
 *   GET  /assets/<sha256-hex>        (público, inmutable, cacheable para siempre)
 *
 * El servidor no se fía de nada del cliente: vuelve a inspeccionar el GLB,
 * calcula el hash, aplica el presupuesto y guarda lo que midió.
 */
import { ASSET_BUDGETS, checkBudget, GLB_MEDIA, GlbError, inspectGlb, sha256Hash, type AssetKind } from "@xenxo/assets";
import type { Principal } from "./auth";

export function assetKey(hash: string): string {
  return `assets/${hash.replace(/^sha256:/, "")}`;
}

export interface UploadResult {
  hash: string;
  kind: AssetKind;
  format: "glb" | "vrm";
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
  if (kindParam !== "avatar" && kindParam !== "model") {
    return { ok: false, status: 400, error: "bad_kind", message: "kind debe ser avatar o model" };
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
  if (kind === "model" && report.isVrm) {
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
      triangles: report.triangles,
      bytes: report.bytes,
      bounds: report.bounds,
      existed,
    },
  };
}

export async function handleGet(hex: string, bucket: R2Bucket, req: Request): Promise<Response> {
  if (!/^[0-9a-f]{64}$/.test(hex)) return new Response("not found", { status: 404 });
  const etag = `"${hex}"`;
  const common = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
  };
  if (req.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: common });
  const obj = await bucket.get(`assets/${hex}`);
  if (!obj) return new Response("not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  return new Response(obj.body, { headers: { ...common, "Content-Type": GLB_MEDIA } });
}

/** Metadatos guardados al subir (los usa el Directory para validar avatares y proyectos). */
export async function assetMeta(bucket: R2Bucket, hash: string) {
  const head = await bucket.head(assetKey(hash));
  if (!head) return null;
  const m = head.customMetadata ?? {};
  return {
    kind: m.kind as AssetKind,
    format: (m.format ?? "glb") as "glb" | "vrm",
    triangles: Number(m.tris ?? 0),
    bounds: m.bounds ? (JSON.parse(m.bounds) as { min: number[]; max: number[] } | null) : null,
  };
}
