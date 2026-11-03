/**
 * Prepara las armas de Distrito Cero (blásteres de neón de juguete) y el cofre del botín a partir del
 * Blaster Kit de Kenney (CC0, tools/kits/kenney/blaster-kit):
 *
 *   node tools/models/library/blasters.mjs
 *
 * - Cada arma, un GLB con el cañón hacia +Z y arriba +Y, a su largo (m) y con la empuñadura (donde
 *   va la palma) en el origen (`keep_origin`): el cliente lo pone en la mano. Sin la extensión de
 *   transformar texturas (eran todas la identidad) y con la textura dentro.
 * - El cofre (crate-medium), en dos piezas: la caja (apoyada en Y = 0 y centrada) y la tapa (con su
 *   bisagra en el origen).
 *
 * Imprime dónde quedan la boca del cañón y el guardamanos de cada arma, y la bisagra de la tapa
 * (m): van en apps/web/src/world/people/arms.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds, prune, transformMesh } from "@gltf-transform/functions";

const here = dirname(fileURLToPath(import.meta.url));
const kit = resolve(here, "..", "..", "kits", "kenney", "blaster-kit", "models");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));
const DATE = "2026-11-03";

/**
 * Las armas: de qué modelo del kit sale cada una, su largo (m) y, en el marco del kit (el cañón hacia
 * −Z), dónde va la palma (`grip`), la boca del cañón (`muzzle`) y, a dos manos, el guardamanos (`fore`):
 * (z, y). Medido sobre vistas laterales con rejilla.
 */
const WEAPONS = [
  { id: "pipa", src: "blaster-b", length: 0.3, grip: [0.074, -0.09], muzzle: [-0.262, 0.013] },
  { id: "chispa", src: "blaster-k", length: 0.3, grip: [0.137, -0.045], muzzle: [-0.228, 0.07] },
  { id: "canon", src: "blaster-c", length: 0.36, grip: [0.141, -0.035], muzzle: [-0.238, 0.017] },
  { id: "rafaga", src: "blaster-a", length: 0.46, grip: [0.2, -0.14], muzzle: [-0.37, 0.06] },
  { id: "trueno", src: "blaster-l", length: 0.56, grip: [0.172, -0.032], muzzle: [-0.275, 0.04], fore: [-0.115, -0.075] },
  { id: "tormenta", src: "blaster-p", length: 0.82, grip: [0.225, -0.022], muzzle: [-0.432, 0.036], fore: [-0.22, -0.01] },
  { id: "halcon", src: "blaster-e", length: 1.02, grip: [0.97, -0.06], muzzle: [0, 0.03], fore: [0.52, -0.02] },
];
const CRATE = { src: "crate-medium", length: 0.9 };

const r3 = (v) => Math.round(v * 1000) / 1000;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Producto de matrices 4 × 4 en columnas (a · b). */
function multiply4(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

async function load(src) {
  const doc = await io.read(join(kit, `${src}.glb`));
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  // KHR_texture_transform: todas son la identidad (solo dicen el canal de UV); fuera.
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === "KHR_texture_transform") ext.dispose();
  return doc;
}

/**
 * Aplica `m` (y la transformación de cada nodo en el mundo) a los vértices de los nodos que pasen
 * `keep` y quita los demás: todo queda en la escena, sin transformaciones en los nodos.
 */
function bake(doc, m, keep = () => true) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const nodes = doc.getRoot().listNodes();
  const world = new Map(nodes.map((n) => [n, n.getWorldMatrix()]));
  for (const n of nodes) {
    if (!n.getMesh()) continue;
    if (!keep(n)) {
      n.setMesh(null);
      continue;
    }
    transformMesh(n.getMesh(), multiply4(m, world.get(n)));
  }
  for (const n of nodes) {
    n.setMatrix(IDENTITY);
    for (const p of n.listParents()) if (p !== scene && p.propertyType === "Node") p.removeChild(n);
    if (!n.listParents().includes(scene)) scene.addChild(n);
  }
  return scene;
}

async function write(name, doc, meta) {
  await doc.transform(prune());
  const dir = join(here, name);
  mkdirSync(dir, { recursive: true });
  await io.write(join(dir, "model.glb"), doc);
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ name, ...meta }, null, 2) + "\n");
  const b = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
  return { min: b.min.map(r3), max: b.max.map(r3) };
}

const out = { weapons: {}, crate: {} };
for (const w of WEAPONS) {
  const doc = await load(w.src);
  const b = getBounds(doc.getRoot().getDefaultScene());
  const s = w.length / (b.max[2] - b.min[2]);
  const [gz, gy] = w.grip;
  // Media vuelta en Y (el cañón a +Z), a su tamaño y con la palma en el origen.
  bake(doc, [-s, 0, 0, 0, 0, s, 0, 0, 0, 0, -s, 0, 0, -s * gy, s * gz, 1]);
  const at = ([z, y]) => [0, r3(s * (y - gy)), r3(-s * (z - gz))];
  const bounds = await write(`weapon_${w.id}`, doc, {
    platform: "Kenney",
    source: `Blaster Kit 2.1 (${w.src}.glb), https://kenney.nl/assets/blaster-kit; preparado con blasters.mjs: el cañón hacia +Z, a su tamaño y con la empuñadura en el origen.`,
    license: "CC0-1.0",
    attribution: "Kenney (kenney.nl), CC0",
    date: DATE,
    keep_origin: true,
    lod1_ratio: 0.75,
    lod1_error: 0.002,
    tex: [256, 128],
  });
  out.weapons[w.id] = { muzzle: at(w.muzzle), ...(w.fore ? { fore: at(w.fore) } : {}), bounds };
}

// El cofre: la caja (sin la tapa) y la tapa, con la bisagra en el origen.
{
  const probe = await load(CRATE.src);
  const b = getBounds(probe.getRoot().getDefaultScene());
  const s = CRATE.length / (b.max[2] - b.min[2]);
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  const lidNode = probe.getRoot().listNodes().find((n) => n.getName() === "lid");
  const hw = lidNode.getWorldMatrix();
  const hinge = [hw[12], hw[13], hw[14]];
  const body = await load(CRATE.src);
  bake(body, [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -cx * s, -b.min[1] * s, -cz * s, 1], (n) => n.getName() !== "lid");
  const meta = {
    platform: "Kenney",
    source: `Blaster Kit 2.1 (${CRATE.src}.glb), https://kenney.nl/assets/blaster-kit; preparado con blasters.mjs: la caja y la tapa por separado.`,
    license: "CC0-1.0",
    attribution: "Kenney (kenney.nl), CC0",
    date: DATE,
    keep_origin: true,
    lod1_ratio: 0.75,
    lod1_error: 0.002,
    tex: [256, 128],
  };
  out.crate.body = await write("loot_crate", body, meta);
  const lid = await load(CRATE.src);
  bake(lid, [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -hinge[0] * s, -hinge[1] * s, -hinge[2] * s, 1], (n) => n.getName() === "lid");
  out.crate.lid = await write("loot_crate_lid", lid, meta);
  out.crate.hinge = [r3((hinge[0] - cx) * s), r3((hinge[1] - b.min[1]) * s), r3((hinge[2] - cz) * s)];
}
console.log(JSON.stringify(out, null, 1));
