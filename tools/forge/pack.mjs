/**
 * Empaqueta lo que sale de la forja para que el servidor lo siembre:
 *   - añade a cada material su mapa de oclusión horneado (segundo canal UV),
 *   - cuantiza y comprime con meshopt,
 *   - comprueba el presupuesto con el mismo inspector que usa el servidor,
 *   - escribe los GLB en apps/realtime/src/seed-assets/ con un índice (hash, triángulos, límites).
 *
 *   node tools/forge/pack.mjs [carpeta-de-la-forja]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { checkBudget, inspectGlb } from "../../packages/assets/src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const src = resolve(process.argv[2] ?? join(here, "out"));
const dest = join(root, "apps", "realtime", "seed-assets");
const indexFile = join(root, "apps", "realtime", "src", "seed-assets.ts");

/** Materiales que no llevan oclusión: emiten luz o son superficies que el cliente anima. */
const NO_AO = /^xenxo:(neon|farol|agua)\b/;

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.decoder": MeshoptDecoder,
  "meshopt.encoder": MeshoptEncoder,
});

const forge = JSON.parse(readFileSync(join(src, "forge.json"), "utf8"));
// Borra solo los modelos de la plaza de la forja anterior (en la misma carpeta viven los avatares de serie).
mkdirSync(dest, { recursive: true });
if (existsSync(indexFile)) {
  for (const m of readFileSync(indexFile, "utf8").matchAll(/sha256:([0-9a-f]{64})/g)) rmSync(join(dest, `${m[1]}.glb`), { force: true });
}

const index = {};
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
    await doc.transform(
      dedup(),
      // keepAttributes: las UV en metros (TEXCOORD_0) no las usa ningún material del GLB, pero sí la biblioteca del cliente.
      prune({ keepAttributes: true }),
      // Las UV van en metros (fuera de 0..1): no se cuantizan, para que las texturas de biblioteca repitan bien.
      quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: 14, quantizeNormal: 10 }),
      meshopt({ encoder: MeshoptEncoder, level: "medium" }),
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

// Índice tipado: el servidor siembra entidades con estos hashes y sirve los archivos
// desde sus recursos estáticos (apps/realtime/seed-assets, nombrados por hash).
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
