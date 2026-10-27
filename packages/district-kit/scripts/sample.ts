/**
 * Genera los archivos de ejemplo de la plantilla de distritos (create-xenxo --district): una torre,
 * un quiosco, una farola, el emblema y la portada. Se ejecuta a mano (npm run sample -w
 * @xenxo/district-kit) y los archivos se guardan en la plantilla. MIT, como el kit.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { Document, NodeIO, type Material, type Mesh } from "@gltf-transform/core";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "create-xenxo", "templates", "district");
mkdirSync(join(out, "models"), { recursive: true });

type V3 = [number, number, number];

/** Añade una caja (min..max, en metros, Y arriba) como una primitiva con su material. */
function box(doc: Document, mesh: Mesh, min: V3, max: V3, mat: Material) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const faces: [V3, V3[]][] = [
    [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
    [[-1, 0, 0], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]],
    [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]]],
    [[0, 0, 1], [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]]],
    [[0, 0, -1], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]],
  ];
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (const [n, q] of faces) {
    const b = pos.length / 3;
    for (const v of q) { pos.push(...v); nor.push(...n); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const buf = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(nor)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(idx)).setBuffer(buf))
    .setMaterial(mat);
  mesh.addPrimitive(prim);
}

function model(name: string, build: (doc: Document, mesh: Mesh, mat: (hex: string, glow?: boolean) => Material) => void) {
  const doc = new Document();
  doc.createBuffer();
  const mesh = doc.createMesh(name);
  const cache = new Map<string, Material>();
  const mat = (hex: string, glow = false) => {
    const key = `${hex}${glow}`;
    if (!cache.has(key)) {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as V3;
      const m = doc.createMaterial(`${name}_${hex.slice(1)}${glow ? "_luz" : ""}`).setBaseColorFactor([...c, 1]).setRoughnessFactor(glow ? 1 : 0.6).setMetallicFactor(glow ? 0 : 0.3);
      if (glow) m.setEmissiveFactor(c);
      cache.set(key, m);
    }
    return cache.get(key)!;
  };
  build(doc, mesh, mat);
  doc.createScene().addChild(doc.createNode(name).setMesh(mesh));
  return new NodeIO().writeBinary(doc);
}

const save = async (file: string, bytes: Promise<Uint8Array> | Uint8Array) => {
  writeFileSync(join(out, file), await bytes);
  console.log("  ", file);
};

// Torre: cuerpo oscuro de 8 × 30 × 8 m con franjas de luz cada 4 m y una antena.
await save("models/torre.glb", model("torre", (doc, mesh, mat) => {
  box(doc, mesh, [-4, 0, -4], [4, 30, 4], mat("#1c2230"));
  for (let y = 4; y < 30; y += 4) box(doc, mesh, [-4.05, y, -4.05], [4.05, y + 0.25, 4.05], mat("#33ddff", true));
  box(doc, mesh, [-0.15, 30, -0.15], [0.15, 36, 0.15], mat("#ff4fd8", true));
}));
// Quiosco: 4 × 3 × 3 m con marquesina de luz.
await save("models/quiosco.glb", model("quiosco", (doc, mesh, mat) => {
  box(doc, mesh, [-2, 0, -1.5], [2, 2.6, 1.5], mat("#2a3140"));
  box(doc, mesh, [-2.4, 2.6, -1.9], [2.4, 2.8, 1.9], mat("#ffd54f", true));
  box(doc, mesh, [-1.6, 0.9, 1.5], [1.6, 2.2, 1.55], mat("#33ddff", true));
}));
// Farola: poste y luz.
await save("models/farola.glb", model("farola", (doc, mesh, mat) => {
  box(doc, mesh, [-0.1, 0, -0.1], [0.1, 4, 0.1], mat("#1c2230"));
  box(doc, mesh, [-0.35, 4, -0.35], [0.35, 4.3, 0.35], mat("#fff2c8", true));
}));
// Emblema (monumento en el nexo): un rombo de luz sobre una peana, 1 m.
await save("emblema.glb", model("emblema", (doc, mesh, mat) => {
  box(doc, mesh, [-0.4, 0, -0.4], [0.4, 0.15, 0.4], mat("#1c2230"));
  box(doc, mesh, [-0.22, 0.25, -0.22], [0.22, 0.95, 0.22], mat("#33ddff", true));
}));

// Portada 640 × 360: degradado de noche con franjas de neón (PNG sin dependencias).
function png(w: number, h: number, pixel: (x: number, y: number) => V3): Uint8Array {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}
await save("portada.png", png(640, 360, (x, y) => {
  const t = y / 360;
  const base: V3 = [Math.round(10 + 30 * t), Math.round(12 + 10 * t), Math.round(30 + 40 * t)];
  // Siluetas de torres con franjas.
  const col = Math.floor(x / 64), towerTop = 140 + ((col * 53) % 120);
  if (y > towerTop && x % 64 > 12 && x % 64 < 52) return (y - towerTop) % 24 < 3 ? [51, 221, 255] : [22, 28, 42];
  return base;
}));
console.log(`\n  Ejemplos en ${out}\n`);
