/**
 * Versión ligera de cada avatar de serie, para la gente de decorado (peatones y residentes de los
 * distritos): el cuerpo base (unos 22.000 triángulos, casi todo debajo de la ropa) se simplifica con
 * meshoptimizer, y la ropa y el pelo a la mitad (cejas, pestañas y ojos, igual). Huesos, pesos, materiales y extensiones
 * VRM no se tocan (se reescribe el GLB a mano, como pack_avatars.py, para no perder VRMC_*).
 *
 * Añade `lite` (hash) a cada entrada de apps/web/src/world/avatar-presets.json y guarda los GLB en
 * apps/realtime/seed-assets/s/. Lo llama pack_avatars.py al final; también se puede lanzar solo:
 *
 *   node tools/avatars/lite_avatars.mjs
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MeshoptSimplifier } from "meshoptimizer";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEST = join(ROOT, "apps", "realtime", "seed-assets", "s");
const CATALOG = join(ROOT, "apps", "web", "src", "world", "avatar-presets.json");
/** Triángulos que quedan del cuerpo base (de ~22.000, casi todo tapado) y de la ropa y el pelo. */
const BODY_RATIO = 0.2;
const REST_RATIO = 0.5;
/** Lo pequeño (cejas, pestañas, ojos, dientes) se queda como está. */
const KEEP = /eyebrow|eyelash|eye|teeth|tongue|low-poly/i;

await MeshoptSimplifier.ready;

function readGlb(buf) {
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
  const binLen = buf.readUInt32LE(20 + len);
  const bin = buf.subarray(28 + len, 28 + len + binLen);
  return { json, bin };
}

function writeGlb(json, bin) {
  let js = Buffer.from(JSON.stringify(json), "utf8");
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const b = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + b.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(js.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(b.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, js, bh, b]);
}

function view(json, bin, idx) {
  const v = json.bufferViews[idx];
  return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
}

function lite(buf) {
  const { json, bin } = readGlb(buf);
  let extra = Buffer.alloc(0);
  let before = 0, after = 0;
  for (const mesh of json.meshes) {
    const name = mesh.name ?? "";
    if (KEEP.test(name)) continue;
    const ratio = /^base/.test(name) ? BODY_RATIO : REST_RATIO;
    for (const prim of mesh.primitives) {
      if (prim.indices == null || prim.targets) continue;
      const ia = json.accessors[prim.indices];
      const pa = json.accessors[prim.attributes.POSITION];
      if (pa.componentType !== 5126 || ia.bufferView == null) continue;
      const iv = view(json, bin, ia.bufferView);
      const idx = ia.componentType === 5125 ? new Uint32Array(iv.buffer.slice(iv.byteOffset + (ia.byteOffset ?? 0), iv.byteOffset + (ia.byteOffset ?? 0) + ia.count * 4)) : Uint32Array.from(new Uint16Array(iv.buffer.slice(iv.byteOffset + (ia.byteOffset ?? 0), iv.byteOffset + (ia.byteOffset ?? 0) + ia.count * 2)));
      const pv = view(json, bin, pa.bufferView);
      const stride = json.bufferViews[pa.bufferView].byteStride ?? 12;
      const pos = new Float32Array(pa.count * 3);
      for (let i = 0; i < pa.count; i++)
        for (let k = 0; k < 3; k++) pos[i * 3 + k] = pv.readFloatLE((pa.byteOffset ?? 0) + i * stride + k * 4);
      if (idx.length < 900) continue;
      const target = Math.floor((idx.length * ratio) / 3) * 3;
      const [out] = MeshoptSimplifier.simplify(idx, pos, 3, target, 0.02, ["LockBorder"]);
      before += idx.length / 3;
      after += out.length / 3;
      // Índices nuevos en una vista nueva al final del buffer (16 bits si caben).
      const small = pa.count < 65536;
      const data = small ? Buffer.from(Uint16Array.from(out).buffer) : Buffer.from(out.buffer);
      const pad = Buffer.alloc((4 - ((bin.length + extra.length) % 4)) % 4);
      extra = Buffer.concat([extra, pad]);
      json.bufferViews.push({ buffer: 0, byteOffset: bin.length + extra.length, byteLength: data.length, target: 34963 });
      extra = Buffer.concat([extra, data]);
      json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: small ? 5123 : 5125, count: out.length, type: "SCALAR" });
      prim.indices = json.accessors.length - 1;
    }
  }
  const outBin = Buffer.concat([bin, extra]);
  json.buffers = [{ byteLength: outBin.length }];
  return { glb: writeGlb(json, outBin), before, after };
}

const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
for (const c of catalog) {
  if (c.lite) rmSync(join(DEST, `${c.lite.slice(7)}.glb`), { force: true });
  const src = join(DEST, `${c.hash.slice(7)}.glb`);
  if (!existsSync(src)) throw new Error(`falta ${src}`);
  const { glb, before, after } = lite(readFileSync(src));
  const h = createHash("sha256").update(glb).digest("hex");
  writeFileSync(join(DEST, `${h}.glb`), glb);
  c.lite = `sha256:${h}`;
  c.lite_tris = c.tris - before + after;
  console.log(`${c.id.padEnd(6)} ${before} → ${after} triángulos simplificados; en total ${c.tris} → ${c.lite_tris}`);
}
writeFileSync(CATALOG, JSON.stringify(catalog, null, 1) + "\n");
