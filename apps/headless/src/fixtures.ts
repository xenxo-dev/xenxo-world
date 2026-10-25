/**
 * Modelos de prueba generados en código (sin archivos binarios en el repo).
 */
import { Document, WebIO } from "@gltf-transform/core";

/** Caja de colores con `segments`² caras por lado (para controlar los triángulos). */
export async function makeBoxGlb(opts: { segments?: number; height?: number; color?: [number, number, number, number] } = {}) {
  const n = opts.segments ?? 1;
  const h = opts.height ?? 1;
  const positions: number[] = [];
  const indices: number[] = [];
  // Seis caras de una caja de 1 × h × 1 con la base en y = 0, subdivididas n × n.
  const faces: [number[], number[], number[]][] = [
    [[-0.5, 0, 0.5], [1, 0, 0], [0, 1, 0]],
    [[0.5, 0, -0.5], [-1, 0, 0], [0, 1, 0]],
    [[0.5, 0, 0.5], [0, 0, -1], [0, 1, 0]],
    [[-0.5, 0, -0.5], [0, 0, 1], [0, 1, 0]],
    [[-0.5, 1, 0.5], [1, 0, 0], [0, 0, -1]],
    [[-0.5, 0, -0.5], [1, 0, 0], [0, 0, 1]],
  ];
  for (const [o, u, v] of faces) {
    const base = positions.length / 3;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const a = i / n;
        const b = j / n;
        positions.push(o[0]! + u[0]! * a + v[0]! * b, (o[1]! + u[1]! * a + v[1]! * b) * h, o[2]! + u[2]! * a + v[2]! * b);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = base + j * (n + 1) + i;
        indices.push(k, k + 1, k + n + 1, k + 1, k + n + 2, k + n + 1);
      }
    }
  }

  const doc = new Document();
  const buffer = doc.createBuffer();
  const pos = doc.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buffer);
  const idx = doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(indices)).setBuffer(buffer);
  const mat = doc
    .createMaterial("xenxo")
    .setBaseColorFactor(opts.color ?? [0.78, 0.33, 0.24, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.8);
  const prim = doc.createPrimitive().setAttribute("POSITION", pos).setIndices(idx).setMaterial(mat);
  const mesh = doc.createMesh("box").addPrimitive(prim);
  doc.createScene().addChild(doc.createNode("box").setMesh(mesh));
  return new WebIO().writeBinary(doc);
}

/** Toma un GLB válido y le añade una referencia externa (debe rechazarse). */
export function withExternalImage(glb: Uint8Array): Uint8Array {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
  json.images = [{ uri: "https://example.com/tracker.png" }];
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const jsonBytes = new TextEncoder().encode(text);
  const rest = glb.subarray(20 + jsonLen);
  const out = new Uint8Array(12 + 8 + jsonBytes.length + rest.length);
  const o = new DataView(out.buffer);
  out.set(glb.subarray(0, 12));
  o.setUint32(8, out.length, true);
  o.setUint32(12, jsonBytes.length, true);
  o.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.set(rest, 20 + jsonBytes.length);
  return out;
}
