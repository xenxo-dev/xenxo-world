/**
 * Empaqueta lo que sale de la forja para que el servidor lo siembre:
 *   - añade a cada material su mapa de oclusión horneado (segundo canal UV),
 *   - cuantiza y comprime con meshopt,
 *   - comprueba el presupuesto con el mismo inspector que usa el servidor,
 *   - escribe los GLB en apps/realtime/seed-assets/s/ con un índice (hash, triángulos, límites).
 *
 *   node tools/forge/pack.mjs [carpeta-de-la-forja] [--keep]
 *
 * Con --keep (forja parcial, `--only=`), las piezas que no vienen en esta forja se conservan
 * tal cual del índice actual en lugar de borrarse.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, flatten, getBounds, join as join_, meshopt, prune, quantize, simplify, textureCompress, transformMesh, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { checkBudget, inspectGlb } from "../../packages/assets/src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const src = resolve(args.find((a) => !a.startsWith("--")) ?? join(here, "out"));
const dest = join(root, "apps", "realtime", "seed-assets", "s");
const indexFile = join(root, "apps", "realtime", "src", "seed-assets.ts");

/** Materiales que no llevan oclusión: emiten luz o son superficies que el cliente anima. */
const NO_AO = /^xenxo:(neon|farol|agua|pantalla)\b/;

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);

/** Producto de matrices 4 × 4 en columnas (a · b). */
function multiply4(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.decoder": MeshoptDecoder,
  "meshopt.encoder": MeshoptEncoder,
});

const forge = JSON.parse(readFileSync(join(src, "forge.json"), "utf8"));
mkdirSync(dest, { recursive: true });
const index = {};
const previous = existsSync(indexFile) ? (await import(indexFile)).SEED_ASSETS : {};
// Borra solo los modelos de la forja anterior que se rehacen (en la misma carpeta viven los avatares de serie).
// Los modelos de tools/models/ que ya no tienen carpeta, fuera (los demás se rehacen abajo).
const modelFolders = new Set(
  ["generated", "library"].flatMap((d) => {
    const dir = join(root, "tools", "models", d);
    return existsSync(dir) ? readdirSync(dir).filter((f) => existsSync(join(dir, f, "meta.json"))).map((f) => JSON.parse(readFileSync(join(dir, f, "meta.json"), "utf8")).name) : [];
  }),
);
for (const [name, entry] of Object.entries(previous)) {
  const gone = (entry.kind === "generated" || entry.kind === "library") && !modelFolders.has(name);
  if (keep && !(name in forge) && !gone) {
    index[name] = { kind: entry.kind, lods: entry.lods.map((l) => ({ ...l, file: `${l.hash.slice(7)}.glb` })) };
    continue;
  }
  for (const l of entry.lods) rmSync(join(dest, `${l.hash.slice(7)}.glb`), { force: true });
}

let total = 0;
for (const name of Object.keys(forge).sort()) {
  const lods = [];
  for (let lod = 0; lod < 2; lod++) {
    const doc = await io.read(join(src, `${name}.lod${lod}.glb`));
    doc.setLogger(new Logger(Logger.Verbosity.WARN));
    const ao = readFileSync(join(src, `${name}.lod${lod}.ao.webp`));
    doc.createExtension(EXTTextureWebP).setRequired(true);
    const tex = doc.createTexture(`${name}_ao`).setImage(new Uint8Array(ao)).setMimeType("image/webp");
    for (const mat of doc.getRoot().listMaterials()) {
      if (NO_AO.test(mat.getName())) continue;
      mat.setOcclusionTexture(tex);
      mat.getOcclusionTextureInfo().setTexCoord(1);
      mat.setOcclusionStrength(1);
    }
    // Piezas grandes (suelos de distrito, ciudades, nexo): posiciones a 16 bits. Con 14 bits en
    // 256 m el paso es de 1,6 cm y las capas del suelo (separadas milímetros) acababan a la misma
    // altura: parpadeaban al andar (z-fighting). Con 16, 4 mm (las capas van a 6 mm o más).
    // meshopt() vuelve a cuantizar por su cuenta: hay que decírselo a él también.
    const ext = (() => {
      const b = getBounds(doc.getRoot().listScenes()[0]);
      return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    })();
    await doc.transform(
      dedup(),
      // keepAttributes: las UV en metros (TEXCOORD_0) no las usa ningún material del GLB, pero sí la biblioteca del cliente.
      prune({ keepAttributes: true }),
      // Las UV van en metros (fuera de 0..1): no se cuantizan, para que las texturas de biblioteca repitan bien.
      quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: ext > 16 ? 16 : 14, quantizeNormal: 10 }),
      meshopt({ encoder: MeshoptEncoder, level: "medium", quantizePosition: ext > 16 ? 16 : 14 }),
    );
    const bytes = await io.writeBinary(doc);
    const report = inspectGlb(bytes);
    const problems = checkBudget(report, "model");
    if (problems.length) throw new Error(`${name} lod${lod} supera el presupuesto: ${JSON.stringify(problems)}`);
    const hash = "sha256:" + createHash("sha256").update(bytes).digest("hex");
    const file = `${hash.slice(7)}.glb`;
    writeFileSync(join(dest, file), bytes);
    total += bytes.byteLength;
    lods.push({ file, hash, tris: report.triangles, bytes: report.bytes, bounds: report.bounds });
    console.log(`${(name + ".lod" + lod).padEnd(18)} ${String(report.triangles).padStart(6)} tri  ${(bytes.byteLength / 1024).toFixed(0).padStart(5)} KB`);
  }
  index[name] = { kind: forge[name].kind, lods };
}
// Modelos generados con IA (tools/models/generated/<carpeta>/: model.glb + meta.json, ver su README):
// se ponen a su tamaño real (`fit`), de pie en Y = 0 y mirando a +Z (`yaw`), con dos niveles de
// detalle (texturas a 1024 y 512 px en WebP; el ligero, simplificado) y el mismo presupuesto.
// Igual con los de bibliotecas libres que hay que preparar antes (tools/models/library/, CC0).
const MODEL_DIRS = [
  [join(root, "tools", "models", "generated"), "generated"],
  [join(root, "tools", "models", "library"), "library"],
];
for (const [generatedDir, modelKind] of MODEL_DIRS)
for (const folder of existsSync(generatedDir) ? readdirSync(generatedDir).sort() : []) {
  const metaFile = join(generatedDir, folder, "meta.json");
  if (!existsSync(metaFile)) continue;
  const meta = JSON.parse(readFileSync(metaFile, "utf8"));
  const lods = [];
  for (let lod = 0; lod < 2; lod++) {
    const doc = await io.read(join(generatedDir, folder, "model.glb"));
    doc.setLogger(new Logger(Logger.Verbosity.WARN));
    await doc.transform(flatten(), join_(), weld());
    // Pista de render: las luces pintadas en la textura brillan (apps/web: paintedLights).
    if (meta.glow) for (const mat of doc.getRoot().listMaterials()) mat.setName("xenxo-glow");
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
    // Girar, escalar y apoyar en el suelo: se aplica a los vértices (sin nodos con transformación).
    const yaw = ((meta.yaw ?? 0) * Math.PI) / 180;
    const rot = [Math.cos(yaw), 0, -Math.sin(yaw), 0, 0, 1, 0, 0, Math.sin(yaw), 0, Math.cos(yaw), 0, 0, 0, 0, 1];
    for (const node of scene.listChildren()) {
      if (node.getMesh()) transformMesh(node.getMesh(), multiply4(rot, node.getMatrix()));
      node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    }
    // Piezas que van juntas (el coche: carrocería, puertas y ruedas, cada una con su pivote en el
    // origen): `keep_origin` las deja donde están, a su tamaño real.
    if (!meta.keep_origin) {
      const b = getBounds(scene);
      const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
      const s = meta.fit.size / (meta.fit.along === "height" ? size[1] : Math.max(size[0], size[2]));
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      const m = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -cx * s, -b.min[1] * s, -cz * s, 1];
      for (const node of scene.listChildren()) if (node.getMesh()) transformMesh(node.getMesh(), m);
    }
    await doc.transform(
      // Nivel detallado: tal cual (o reducido con `lod0_ratio` si el original es muy denso); ligero: `lod1_ratio`.
      ...(lod === 1 || meta.lod0_ratio
        ? [simplify({ simplifier: MeshoptSimplifier, ratio: lod === 1 ? (meta.lod1_ratio ?? 0.5) : meta.lod0_ratio, error: lod === 1 ? (meta.lod1_error ?? 0.004) : 0.002 })]
        : []),
      textureCompress({ encoder: sharp, targetFormat: "webp", resize: [meta.tex?.[lod] ?? (lod === 0 ? 1024 : 512), meta.tex?.[lod] ?? (lod === 0 ? 1024 : 512)], quality: 82 }),
      dedup(),
      prune(),
      quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
      meshopt({ encoder: MeshoptEncoder, level: "medium" }),
    );
    const bytes = await io.writeBinary(doc);
    const report = inspectGlb(bytes);
    const problems = checkBudget(report, "model");
    if (problems.length) throw new Error(`${meta.name} lod${lod} supera el presupuesto: ${JSON.stringify(problems)}`);
    const hash = "sha256:" + createHash("sha256").update(bytes).digest("hex");
    const file = `${hash.slice(7)}.glb`;
    writeFileSync(join(dest, file), bytes);
    total += bytes.byteLength;
    lods.push({ file, hash, tris: report.triangles, bytes: report.bytes, bounds: report.bounds });
    console.log(`${(meta.name + ".lod" + lod).padEnd(18)} ${String(report.triangles).padStart(6)} tri  ${(bytes.byteLength / 1024).toFixed(0).padStart(5)} KB  (${modelKind === "generated" ? `IA: ${meta.platform} ${meta.model}` : `${meta.platform}, ${meta.license}`})`);
  }
  // Los archivos de la versión anterior que ya no se usan (nunca uno que acabamos de escribir).
  const fresh = new Set(lods.map((l) => l.file));
  for (const l of index[meta.name]?.lods ?? []) if (!fresh.has(l.file)) rmSync(join(dest, l.file), { force: true });
  index[meta.name] = { kind: modelKind, lods };
}

// Comprobación final: cada archivo del índice tiene que estar en disco.
const missing = Object.entries(index).flatMap(([n, e]) => e.lods.filter((l) => !existsSync(join(dest, l.file))).map((l) => `${n}: ${l.file}`));
if (missing.length) throw new Error(`faltan archivos empaquetados:\n${missing.join("\n")}`);

if (keep) console.log(`(conservadas sin tocar: ${Object.keys(index).filter((n) => !(n in forge) && index[n].kind !== "generated" && index[n].kind !== "library").join(", ") || "ninguna"})`);

// Índice tipado: el servidor siembra entidades con estos hashes y sirve los archivos
// desde sus recursos estáticos (apps/realtime/seed-assets/s, nombrados por hash).
const names = Object.keys(index).sort();
const lines = [
  "// Generado por tools/forge/pack.mjs. No lo edites a mano: vuelve a forjar (npm run forge).",
  "",
  "export interface SeedAssetLod { hash: string; tris: number; bytes: number; bounds: { min: number[]; max: number[] } | null }",
  "",
  "export const SEED_ASSETS: Record<string, { kind: string; lods: SeedAssetLod[] }> = {",
  ...names.map((n) => {
    const lods = index[n].lods
      .map((l) => `{ hash: "${l.hash}", tris: ${l.tris}, bytes: ${l.bytes}, bounds: ${JSON.stringify(l.bounds)} }`)
      .join(", ");
    return `  ${JSON.stringify(n)}: { kind: ${JSON.stringify(index[n].kind)}, lods: [${lods}] },`;
  }),
  "};",
  "",
];
writeFileSync(indexFile, lines.join("\n"));
console.log(`\n${names.length} piezas, ${(total / 1048576).toFixed(2)} MB en total → ${dest}`);
