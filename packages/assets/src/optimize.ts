/**
 * Optimización de modelos con gltf-transform + meshoptimizer (todo gratuito y local).
 * Funciona igual en el navegador (subida de avatares y proyectos) y en Node (CLI de agentes).
 *
 * Qué hace:
 *   1. Limpia: deduplica, elimina lo que no se usa y suelda vértices.
 *   2. Si pasa del presupuesto de triángulos, simplifica la malla hasta caber.
 *   3. Reduce las texturas al tamaño máximo (si se pasa un `resizeImage`).
 *   4. Comprime con EXT_meshopt_compression.
 *   5. Opcional: genera un LOD ligero (~30 %) para Quest y móvil.
 *
 * Los VRM no se tocan: gltf-transform no conoce sus extensiones y las perdería.
 */
import { Logger, WebIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, simplify, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { ASSET_BUDGETS, inspectGlb, type AssetKind, type GlbReport } from "./index";

export type ResizeImage = (data: Uint8Array, mime: string, maxSize: number) => Promise<{ data: Uint8Array; mime: string } | null>;

export interface OptimizeOptions {
  kind: AssetKind;
  /** Redimensionado de texturas (en el navegador, con canvas). Sin él, las texturas no se tocan. */
  resizeImage?: ResizeImage;
  /** Generar un segundo nivel de detalle más ligero. */
  makeLod?: boolean;
}

export interface OptimizedLod {
  bytes: Uint8Array;
  report: GlbReport;
}

export interface OptimizeResult {
  lods: OptimizedLod[];
  /** Avisos legibles: qué se hizo o por qué no se tocó algo. */
  notes: string[];
}

const quiet = new Logger(Logger.Verbosity.WARN);
let ready: Promise<WebIO> | null = null;
function io(): Promise<WebIO> {
  ready ??= Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]).then(() =>
    new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    }),
  );
  return ready;
}

async function resizeTextures(doc: Document, max: number, resize: ResizeImage, notes: string[]) {
  for (const tex of doc.getRoot().listTextures()) {
    const size = tex.getSize();
    const image = tex.getImage();
    const mime = tex.getMimeType();
    if (!size || !image || Math.max(size[0], size[1]) <= max) continue;
    const out = await resize(image, mime, max);
    if (out) {
      tex.setImage(out.data).setMimeType(out.mime);
      notes.push(`textura ${size[0]}×${size[1]} reducida a ${max}px`);
    }
  }
}

export async function optimizeGlb(input: Uint8Array, opts: OptimizeOptions): Promise<OptimizeResult> {
  const notes: string[] = [];
  const original = inspectGlb(input);
  const budget = ASSET_BUDGETS[opts.kind];

  if (original.isVrm) {
    notes.push("VRM detectado: se sube tal cual para no perder huesos ni expresiones");
    return { lods: [{ bytes: input, report: original }], notes };
  }

  const reader = await io();
  const doc = await reader.readBinary(input);
  doc.setLogger(quiet);
  await doc.transform(dedup(), prune(), weld());

  if (original.triangles > budget.maxTriangles) {
    const ratio = Math.max(0.02, (budget.maxTriangles / original.triangles) * 0.92);
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }));
    notes.push(`simplificado de ${original.triangles} triángulos para caber en ${budget.maxTriangles}`);
  }
  if (opts.resizeImage) await resizeTextures(doc, budget.maxTexture, opts.resizeImage, notes);

  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const full = await reader.writeBinary(doc);
  const lods: OptimizedLod[] = [{ bytes: full, report: inspectGlb(full) }];

  if (opts.makeLod && lods[0]!.report.triangles > 2_000) {
    const light = await reader.readBinary(full);
    light.setLogger(quiet);
    await light.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.3, error: 0.02 }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    const bytes = await reader.writeBinary(light);
    const report = inspectGlb(bytes);
    if (report.triangles < lods[0]!.report.triangles * 0.8) {
      lods.push({ bytes, report });
      notes.push(`LOD ligero generado: ${report.triangles} triángulos`);
    }
  }

  const saved = original.bytes - lods[0]!.report.bytes;
  if (saved > 0) notes.push(`tamaño reducido un ${Math.round((saved / original.bytes) * 100)} %`);
  return { lods, notes };
}
