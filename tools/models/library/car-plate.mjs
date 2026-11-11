/**
 * La matrícula del coche. En el «Car Concept» de Khronos lleva su logotipo, que la licencia CC BY no
 * cubre (es una marca): aquí se cambia por una de xenxo, dibujada con trazos (sin depender de
 * ninguna fuente instalada). El modelo usa además esa misma textura como luz de otros materiales
 * (plásticos, retrovisores, llantas): también se quita de ahí. Lo usa concept-car.mjs al preparar el
 * modelo; ejecutado a mano, arregla las cinco piezas del coche que ya están preparadas:
 *
 *   node tools/models/library/car-plate.mjs      (y después: npx tsx tools/forge/pack.mjs --keep)
 */
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import sharp from "sharp";

/** Material de la matrícula en el modelo de origen. */
const PLATE = /^license$/i;
/** El logotipo tal como quedó (512 × 128, WebP) en las piezas que ya estaban preparadas. */
const LOGO_SHA1 = "f55dd3d0c546af5fd0f920cd4d787c73b77ef28f";

/** La matrícula (512 × 128, como la textura que sustituye): «XENXO» en trazos claros sobre fondo oscuro. */
export async function plateImage() {
  const w = 44, gap = 18, y0 = 36, y1 = 92, ym = 64;
  const x0 = (512 - (5 * w + 4 * gap)) / 2;
  const at = (k) => x0 + k * (w + gap);
  const X = (x) => `M${x},${y0} L${x + w},${y1} M${x + w},${y0} L${x},${y1}`;
  const E = (x) => `M${x + w},${y0} L${x},${y0} L${x},${y1} L${x + w},${y1} M${x},${ym} L${x + w - 9},${ym}`;
  const N = (x) => `M${x},${y1} L${x},${y0} L${x + w},${y1} L${x + w},${y0}`;
  const O = (x) => `M${x + 15},${y0} L${x + w - 15},${y0} Q${x + w},${y0} ${x + w},${y0 + 15} L${x + w},${y1 - 15} Q${x + w},${y1} ${x + w - 15},${y1} L${x + 15},${y1} Q${x},${y1} ${x},${y1 - 15} L${x},${y0 + 15} Q${x},${y0} ${x + 15},${y0} Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="128" viewBox="0 0 512 128">
    <rect width="512" height="128" fill="#0b0f18"/>
    <rect x="7" y="7" width="498" height="114" rx="14" fill="none" stroke="#2c3654" stroke-width="3"/>
    <path d="${X(at(0))} ${E(at(1))} ${N(at(2))} ${X(at(3))} ${O(at(4))}" fill="none" stroke="#eef2f8" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).webp({ quality: 92 }).toBuffer());
}

const SLOTS = ["BaseColor", "Emissive", "MetallicRoughness", "Occlusion", "Normal"];

/**
 * Cambia la textura de la matrícula de `doc` por la de xenxo y quita el logotipo de donde más esté
 * (el modelo lo usa también como textura de luz de otros materiales). Devuelve cuántos huecos ha
 * tocado.
 */
export async function plate(doc) {
  const root = doc.getRoot();
  const mats = root.listMaterials().filter((m) => PLATE.test(m.getName()));
  // El logotipo: lo que lleva la matrícula (en el modelo de origen, la misma textura que usan los
  // demás materiales) y, en las piezas ya preparadas, la imagen que se sabe que es.
  const logos = new Set();
  for (const m of mats) {
    const t = m.getBaseColorTexture();
    if (t && t.getName() !== "xenxo-plate") logos.add(t);
  }
  for (const t of root.listTextures()) {
    const img = t.getImage();
    if (img && createHash("sha1").update(img).digest("hex") === LOGO_SHA1) logos.add(t);
  }
  let n = 0;
  for (const m of root.listMaterials()) {
    for (const slot of SLOTS) {
      if (!logos.has(m[`get${slot}Texture`]())) continue;
      m[`set${slot}Texture`](null);
      // Sin su textura, que no se quede encendido entero.
      if (slot === "Emissive") m.setEmissiveFactor([0, 0, 0]);
      n++;
    }
  }
  for (const m of mats) {
    if (m.getBaseColorTexture()?.getName() === "xenxo-plate") continue;
    m.setBaseColorTexture(doc.createTexture("xenxo-plate").setMimeType("image/webp").setImage(await plateImage()));
    m.setBaseColorFactor([1, 1, 1, 1]);
    n++;
  }
  return n;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const here = dirname(fileURLToPath(import.meta.url));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const piece of ["vehicle_car", "vehicle_car_door_l", "vehicle_car_door_r", "vehicle_car_wheel_l", "vehicle_car_wheel_r"]) {
    const file = join(here, piece, "model.glb");
    const doc = await io.read(file);
    const n = await plate(doc);
    if (!n) {
      console.log(`${piece}: nada que cambiar`);
      continue;
    }
    await doc.transform(prune());
    await io.write(file, doc);
    console.log(`${piece}: logotipo fuera de ${n} hueco(s)`);
  }
}
