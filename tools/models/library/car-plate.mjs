/**
 * Las marcas del coche. En el «Car Concept» de Khronos la matrícula lleva su logotipo y el costado de
 * los neumáticos, el suyo y el de 3D Commerce, pintados y en relieve: la licencia CC BY no cubre las
 * marcas. Aquí la matrícula se cambia por una de xenxo, dibujada con trazos (sin depender de ninguna
 * fuente instalada), y los neumáticos se quedan con su goma y sus anillos, sin letreros de nadie. El
 * modelo usa además la textura del logotipo como luz de otros materiales (plásticos, retrovisores,
 * llantas): también se quita de ahí. Lo usa concept-car.mjs al preparar el modelo; ejecutado a mano,
 * arregla las cinco piezas del coche que ya están preparadas:
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

/** Material del costado del neumático en el modelo de origen. */
const TIRE = /^tireside$/i;

/**
 * El costado de los neumáticos, sin marcas. Su textura de color es goma lisa con los dos logotipos
 * pintados: se quita y queda el color de la goma. Su relieve (mapa de normales) lleva los mismos
 * logotipos entre anillos concéntricos y letreros de neumático cualquiera (medidas, «OUTSIDE»…):
 * donde estaban los logotipos se pone el relieve de los anillos solos, que sale de la mediana de
 * cada radio en toda la vuelta (los letreros ocupan poco de ella y no cuentan). Devuelve cuántas
 * texturas ha tocado.
 */
export async function tires(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMaterials()) {
    if (!TIRE.test(m.getName())) continue;
    const base = m.getBaseColorTexture();
    if (!base) continue;
    const { data, info } = await sharp(Buffer.from(base.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    // La goma: el color que más hay. Lo demás (a más de un poco de distancia) son los logotipos.
    const count = new Map();
    for (let i = 0; i < data.length; i += 3 * 97) {
      const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    const rubber = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const rr = rubber >> 16, rg = (rubber >> 8) & 255, rb = rubber & 255;
    const mask = new Uint8Array(w * h);
    let painted = 0;
    for (let i = 0, p = 0; i < data.length; i += 3, p++) {
      if (Math.abs(data[i] - rr) + Math.abs(data[i + 1] - rg) + Math.abs(data[i + 2] - rb) > 36) {
        mask[p] = 1;
        painted++;
      }
    }
    const lin = (c) => ((c / 255 + 0.055) / 1.055) ** 2.4;
    m.setBaseColorTexture(null);
    m.setBaseColorFactor([lin(rr), lin(rg), lin(rb), 1]);
    n++;
    const normal = m.getNormalTexture();
    if (!normal || !painted) continue;
    const nm = await sharp(Buffer.from(normal.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (nm.info.width !== w || nm.info.height !== h) continue;
    // La máscara, con margen (el relieve es algo más ancho que la pintura).
    const R = 9;
    const wide = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        for (let dy = -R; dy <= R; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -R; dx <= R; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < w) wide[yy * w + xx] = 1;
          }
        }
      }
    }
    const px = nm.data, cx = (w - 1) / 2, cy = (h - 1) / 2;
    // ¿El verde del mapa va con la y de la imagen o al revés? El que deje los anillos más «radiales».
    let tanA = 0, tanB = 0;
    for (let i = 0; i < w * h; i += 53) {
      const x = i % w, y = (i / w) | 0;
      const f = Math.atan2(y - cy, x - cx);
      const vx = px[i * 3] / 127.5 - 1, vy = px[i * 3 + 1] / 127.5 - 1;
      tanA += Math.abs(-vx * Math.sin(f) + vy * Math.cos(f));
      tanB += Math.abs(-vx * Math.sin(f) - vy * Math.cos(f));
    }
    const s = tanA <= tanB ? 1 : -1;
    // La mediana de cada radio (radial, tangencial y azul), fuera de la máscara.
    const bins = Math.ceil(Math.hypot(cx, cy)) + 2;
    const rad = Array.from({ length: bins }, () => []), tan = Array.from({ length: bins }, () => []), blue = Array.from({ length: bins }, () => []);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (wide[i]) continue;
        const dx = x - cx, dy = y - cy;
        const r = Math.round(Math.hypot(dx, dy)), f = Math.atan2(dy, dx);
        const vx = px[i * 3] / 127.5 - 1, vy = (px[i * 3 + 1] / 127.5 - 1) * s;
        rad[r].push(vx * Math.cos(f) + vy * Math.sin(f));
        tan[r].push(-vx * Math.sin(f) + vy * Math.cos(f));
        blue[r].push(px[i * 3 + 2]);
      }
    }
    const median = (a) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 0);
    const mr = rad.map(median), mt = tan.map(median), mb = blue.map((a) => (a.length ? median(a) : 255));
    const byte = (v) => Math.max(0, Math.min(255, Math.round((v + 1) * 127.5)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!wide[i]) continue;
        const dx = x - cx, dy = y - cy;
        const r = Math.round(Math.hypot(dx, dy)), f = Math.atan2(dy, dx);
        px[i * 3] = byte(mr[r] * Math.cos(f) - mt[r] * Math.sin(f));
        px[i * 3 + 1] = byte((mr[r] * Math.sin(f) + mt[r] * Math.cos(f)) * s);
        px[i * 3 + 2] = mb[r];
      }
    }
    normal.setImage(new Uint8Array(await sharp(px, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: 90 }).toBuffer())).setMimeType("image/webp");
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
    const t = await tires(doc);
    if (!n && !t) {
      console.log(`${piece}: nada que cambiar`);
      continue;
    }
    await doc.transform(prune());
    await io.write(file, doc);
    console.log(`${piece}: ${n ? `logotipo fuera de ${n} hueco(s)` : ""}${n && t ? "; " : ""}${t ? `neumático sin marcas (${t} textura(s))` : ""}`);
  }
}
