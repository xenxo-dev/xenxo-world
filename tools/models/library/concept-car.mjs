/**
 * Prepara el coche realista de xenxo a partir del «Car Concept» de los modelos de muestra de glTF
 * de Khronos (https://github.com/KhronosGroup/glTF-Sample-Assets, Models/CarConcept, CC BY 4.0;
 * hecho a partir de un modelo de dominio público de «Unity Fan» en Sketchfab).
 *
 *   tsx tools/models/library/concept-car.mjs <ruta>/CarConcept/glTF-Binary/CarConcept.glb
 *
 * - Quita los logotipos de Khronos (la licencia no cubre las marcas): la textura con el logo sale de
 *   todos los materiales y la matrícula queda lisa.
 * - Quita lo que no se ve desde fuera ni desde el asiento (motor, bajos del capó, pedales, ejes,
 *   pinzas de freno, limpiaparabrisas). Simplifica el interior y las llantas; la carrocería, solo
 *   donde es plana (medio milímetro de error: con más, la pintura se veía abollada).
 * - Cristal sin transmisión (cuesta una pasada de pantalla): transparente normal, oscuro.
 * - Lo separa en piezas, cada una con su pivote en el origen: carrocería (con el interior), las dos
 *   puertas (bisagra) y las ruedas izquierda y derecha (eje). Imprime dónde va cada pivote: esos
 *   números van en `apps/web/src/world/vehicle/car.ts`.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds, prune, simplifyPrimitive, textureCompress, weldPrimitive } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) throw new Error("falta CarConcept.glb");
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Piezas que no se ven (o casi) y pesan. */
const DROP = /^(Engine|BodyHoodInterior0[12]|BodyHoodUnder|Axles|InteriorPedal.*|Wheel.*BrakePad|InteriorRearHatch|InteriorFloormats|InteriorSteeringEmblem|BodyWindshieldWipers)$/;
/**
 * Qué se simplifica (y cuánto): solo lo que no luce. La carrocería (paneles, capó, techo, pilares,
 * puertas por fuera) va entera: la pintura brilla y cualquier simplificación se ve como abolladuras.
 */
const SIMPLIFY = [
  // Los paneles pintados, con un error de medio milímetro: se quitan triángulos solo donde es plano.
  [/^Body(PanelsColor2|Hood|RearPanelsColor1|Pillars|RoofPanel)$/, 0.5, 0.0004],
  [/^Body(Windshield|Rearwindow|WindowsRearSides|HoodTopgrill|TaillightsPanels)$/, 0.5, 0.001],
  [/^Interior/, 0.35, 0.004], // el habitáculo: se ve poco y a través del cristal
  [/Rim$/, 0.3, 0.003], // las llantas (12.000 triángulos cada una)
  [/BrakeDisc$/, 0.4, 0.004],
];
const DOORS = { door_l: "BodyDoorLColor1", door_r: "BodyDoorRColor1" };
// Las traseras: en el modelo, las delanteras vienen giradas unos 22° (la dirección torcida) y, usadas
// en las cuatro, asomaban por fuera de la carrocería.
const WHEELS = { wheel_l: "WheelRearL", wheel_r: "WheelRearR" };
const ALL_WHEELS = ["WheelFrontL", "WheelFrontR", "WheelRearL", "WheelRearR"];

async function load() {
  const doc = await io.read(file);
  const root = doc.getRoot();
  // Variantes de pintura fuera (se queda la de serie; el cliente tiñe la pintura de cada coche).
  for (const ext of root.listExtensionsUsed()) if (ext.extensionName === "KHR_materials_variants") ext.dispose();
  for (const m of root.listMaterials()) {
    // Sin logotipos: la textura del logo sale de cualquier hueco donde esté.
    for (const slot of ["BaseColor", "Emissive", "MetallicRoughness", "Occlusion", "Normal"]) {
      const tex = m[`get${slot}Texture`]();
      if (tex && /khronos/i.test(`${tex.getName()} ${tex.getURI()}`)) m[`set${slot}Texture`](null);
    }
    // Ni transmisión ni iridiscencia: el cristal, transparente de toda la vida.
    if (m.getExtension("KHR_materials_transmission")) {
      m.setExtension("KHR_materials_transmission", null);
      m.setAlphaMode("BLEND");
      m.setBaseColorFactor([0.04, 0.05, 0.07, 0.42]);
      m.setMetallicFactor(0.2);
      m.setRoughnessFactor(0.05);
      m.setName("Glass");
    }
    m.setExtension("KHR_materials_iridescence", null);
    m.setExtension("KHR_materials_volume", null);
  }
  for (const n of root.listNodes()) if (DROP.test(n.getName())) n.dispose();
  // Fuera también del archivo (el servidor no admite iridiscencia).
  for (const ext of root.listExtensionsUsed())
    if (["KHR_materials_iridescence", "KHR_materials_transmission", "KHR_materials_volume"].includes(ext.extensionName)) ext.dispose();
  return doc;
}

/** Quita de la escena todo menos el subárbol `keep`, y lo deja colgando de la escena con el pivote en el origen. */
function isolate(doc, keep) {
  const scene = doc.getRoot().getDefaultScene();
  const node = doc.getRoot().listNodes().find((n) => n.getName() === keep);
  if (!node) throw new Error(`no está ${keep}`);
  const w = node.getWorldMatrix();
  const pivot = [w[12], w[13], w[14]];
  // Solo el giro (y escala) del mundo: el pivote queda en el origen.
  node.setMatrix([w[0], w[1], w[2], 0, w[4], w[5], w[6], 0, w[8], w[9], w[10], 0, 0, 0, 0, 1]);
  for (const p of node.listParents()) if (p !== scene && p.propertyType === "Node") p.removeChild(node);
  for (const c of scene.listChildren()) if (c !== node) c.dispose();
  scene.addChild(node);
  return pivot;
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const weldPrim = (prim) => weldPrimitive(prim, {});
const tris = (doc) => doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);

async function write(name, doc) {
  // Simplificar pieza a pieza (por el nombre del nodo), nunca la carrocería.
  for (const node of doc.getRoot().listNodes()) {
    const rule = SIMPLIFY.find(([re]) => re.test(node.getName()));
    const mesh = node.getMesh();
    if (!rule || !mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      weldPrim(prim);
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: rule[1], error: rule[2] });
    }
  }
  await doc.transform(
    prune(),
    // Texturas a 1024 px en WebP ya aquí (pack.mjs las vuelve a preparar): el repo no guarda megas de PNG.
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 88 }),
  );
  mkdirSync(join(here, name), { recursive: true });
  await io.write(join(here, name, "model.glb"), doc);
  const b = getBounds(doc.getRoot().getDefaultScene());
  return { tris: tris(doc), min: b.min.map(r3), max: b.max.map(r3) };
}

const out = { pieces: {}, doors: {}, wheels: {} };

// Carrocería: sin puertas ni ruedas.
{
  const doc = await load();
  for (const n of doc.getRoot().listNodes()) if (Object.values(DOORS).includes(n.getName()) || ALL_WHEELS.includes(n.getName())) n.dispose();
  out.pieces.vehicle_car = await write("vehicle_car", doc);
}
for (const [k, name] of Object.entries(DOORS)) {
  const doc = await load();
  out.doors[k] = isolate(doc, name).map(r3);
  out.pieces[`vehicle_car_${k}`] = await write(`vehicle_car_${k}`, doc);
}
for (const [k, name] of Object.entries(WHEELS)) {
  const doc = await load();
  isolate(doc, name);
  out.pieces[`vehicle_car_${k}`] = await write(`vehicle_car_${k}`, doc);
}
// Dónde va cada rueda (su eje).
{
  const doc = await io.read(file);
  for (const n of doc.getRoot().listNodes()) if (ALL_WHEELS.includes(n.getName())) {
    const w = n.getWorldMatrix();
    out.wheels[n.getName()] = [w[12], w[13], w[14]].map(r3);
  }
}
console.log(JSON.stringify(out, null, 1));
