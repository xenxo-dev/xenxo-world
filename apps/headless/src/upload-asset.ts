/**
 * Optimiza y sube un modelo .glb (o .vrm) y devuelve el componente mesh@1 listo para usar.
 *
 *   XENXO_URL=... XENXO_AGENT_KEY=... npm run upload-asset -w @xenxo/headless -- ruta/al/modelo.glb [model|avatar]
 *
 * Sirve para ti (assets de la plaza: packs CC0, Blender, escaneos…) y para cualquier agente.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkBudget, inspectGlb } from "@xenxo/assets";
import { optimizeGlb } from "@xenxo/assets/optimize";
import { Api } from "./http";

const [file, kindArg = "model"] = process.argv.slice(2);
const baseUrl = process.env.XENXO_URL ?? "http://localhost:8787";
const agentKey = process.env.XENXO_AGENT_KEY;
if (!file || (kindArg !== "model" && kindArg !== "avatar") || !agentKey) {
  console.error("Uso: XENXO_AGENT_KEY=… npm run upload-asset -w @xenxo/headless -- <archivo.glb> [model|avatar]");
  process.exit(1);
}
const kind = kindArg;

// `npm run -w` ejecuta dentro de apps/headless: las rutas relativas son desde donde lo lanzaste.
const input = new Uint8Array(await readFile(resolve(process.env.INIT_CWD ?? process.cwd(), file)));
const before = inspectGlb(input);
console.log(
  `Original: ${before.triangles} triángulos, ${(before.bytes / 1024).toFixed(0)} KB` +
    (before.images ? `, ${before.images} texturas de hasta ${before.maxTextureSize}px` : ", sin texturas"),
);

const { lods, notes } = await optimizeGlb(input, { kind, makeLod: kind === "model" });
for (const n of notes) console.log(`  · ${n}`);
const problems = checkBudget(lods[0]!.report, kind);
if (problems.length) {
  console.error("Sigue superando el presupuesto:", problems);
  if (problems.some((p) => p.what === "texture")) console.error("Reduce las texturas (por ejemplo a 1024 px) antes de subirlo.");
  process.exit(1);
}

const api = new Api(baseUrl);
await api.agentToken(agentKey);
const uploaded = [];
for (const lod of lods) {
  const r = await api.upload(lod.bytes, kind);
  if (!r.ok) {
    console.error(`El servidor rechazó el archivo: ${r.error} — ${r.message ?? ""}`, r.detail ?? "");
    process.exit(1);
  }
  uploaded.push({ hash: r.data.hash, media: "model/gltf-binary", tris: r.data.triangles });
  console.log(`Subido ${r.data.hash} (${r.data.triangles} triángulos${r.data.existed ? ", ya existía" : ""})`);
}

console.log("\nComponente listo para MUTATE_WORLD:");
console.log(JSON.stringify({ "mesh@1": { lods: uploaded } }, null, 2));
