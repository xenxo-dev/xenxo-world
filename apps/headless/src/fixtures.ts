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

/* ------------------------------------------------------------------ */
/* Maniquí VRM 1.0 con esqueleto humanoide (para probar avatares VRM)   */
/* ------------------------------------------------------------------ */

type V3 = [number, number, number];

/** Huesos en el espacio del VRM: Y arriba, mirando a +Z, la izquierda del personaje en +X. Pose de T. */
const BONES: { name: string; parent: string | null; world: V3 }[] = [
  { name: "hips", parent: null, world: [0, 0.95, 0] },
  { name: "spine", parent: "hips", world: [0, 1.1, 0] },
  { name: "head", parent: "spine", world: [0, 1.55, 0] },
  { name: "leftUpperArm", parent: "spine", world: [0.22, 1.42, 0] },
  { name: "leftLowerArm", parent: "leftUpperArm", world: [0.5, 1.42, 0] },
  { name: "leftHand", parent: "leftLowerArm", world: [0.76, 1.42, 0] },
  { name: "rightUpperArm", parent: "spine", world: [-0.22, 1.42, 0] },
  { name: "rightLowerArm", parent: "rightUpperArm", world: [-0.5, 1.42, 0] },
  { name: "rightHand", parent: "rightLowerArm", world: [-0.76, 1.42, 0] },
  { name: "leftUpperLeg", parent: "hips", world: [0.1, 0.9, 0] },
  { name: "leftLowerLeg", parent: "leftUpperLeg", world: [0.1, 0.48, 0] },
  { name: "leftFoot", parent: "leftLowerLeg", world: [0.1, 0.08, 0] },
  { name: "rightUpperLeg", parent: "hips", world: [-0.1, 0.9, 0] },
  { name: "rightLowerLeg", parent: "rightUpperLeg", world: [-0.1, 0.48, 0] },
  { name: "rightFoot", parent: "rightLowerLeg", world: [-0.1, 0.08, 0] },
];

/** Cajas del cuerpo: [hueso, centro, tamaño, color]. */
const PARTS: [string, V3, V3, [number, number, number, number]][] = [
  ["hips", [0, 0.95, 0], [0.34, 0.16, 0.2], [0.2, 0.25, 0.4, 1]],
  ["spine", [0, 1.25, 0], [0.38, 0.5, 0.22], [0.84, 0.33, 0.24, 1]],
  ["head", [0, 1.68, 0], [0.24, 0.26, 0.24], [0.95, 0.82, 0.7, 1]],
  ["head", [0, 1.66, 0.13], [0.06, 0.06, 0.06], [0.75, 0.2, 0.2, 1]], // nariz: marca el frente (+Z)
  ["head", [0, 1.8, -0.01], [0.26, 0.06, 0.26], [0.2, 0.12, 0.08, 1]], // pelo
  ["leftUpperArm", [0.36, 1.42, 0], [0.28, 0.09, 0.09], [0.84, 0.33, 0.24, 1]],
  ["leftLowerArm", [0.63, 1.42, 0], [0.26, 0.08, 0.08], [0.95, 0.82, 0.7, 1]],
  ["leftHand", [0.8, 1.42, 0], [0.08, 0.08, 0.08], [0.95, 0.82, 0.7, 1]],
  ["rightUpperArm", [-0.36, 1.42, 0], [0.28, 0.09, 0.09], [0.84, 0.33, 0.24, 1]],
  ["rightLowerArm", [-0.63, 1.42, 0], [0.26, 0.08, 0.08], [0.95, 0.82, 0.7, 1]],
  ["rightHand", [-0.8, 1.42, 0], [0.08, 0.08, 0.08], [0.95, 0.82, 0.7, 1]],
  ["leftUpperLeg", [0.1, 0.69, 0], [0.13, 0.42, 0.13], [0.2, 0.25, 0.4, 1]],
  ["leftLowerLeg", [0.1, 0.28, 0], [0.12, 0.4, 0.12], [0.2, 0.25, 0.4, 1]],
  ["leftFoot", [0.1, 0.04, 0.05], [0.12, 0.08, 0.22], [0.25, 0.18, 0.12, 1]],
  ["rightUpperLeg", [-0.1, 0.69, 0], [0.13, 0.42, 0.13], [0.2, 0.25, 0.4, 1]],
  ["rightLowerLeg", [-0.1, 0.28, 0], [0.12, 0.4, 0.12], [0.2, 0.25, 0.4, 1]],
  ["rightFoot", [-0.1, 0.04, 0.05], [0.12, 0.08, 0.22], [0.25, 0.18, 0.12, 1]],
];

function boxVerts(c: V3, s: V3) {
  const [x, y, z] = c;
  const [w, h, d] = s.map((v) => v / 2) as V3;
  const p: number[] = [];
  const idx: number[] = [];
  const faces: [V3, V3, V3][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, v] of faces) {
    const base = p.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      p.push(
        x + (n[0] + u[0] * a + v[0] * b) * w,
        y + (n[1] + u[1] * a + v[1] * b) * h,
        z + (n[2] + u[2] * a + v[2] * b) * d,
      );
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { p, idx };
}

export async function makeVrmMannequin(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const nodes = new Map<string, ReturnType<Document["createNode"]>>();
  for (const b of BONES) {
    const parent = b.parent ? BONES.find((x) => x.name === b.parent)!.world : ([0, 0, 0] as V3);
    nodes.set(b.name, doc.createNode(b.name).setTranslation([b.world[0] - parent[0], b.world[1] - parent[1], b.world[2] - parent[2]]));
  }
  for (const b of BONES) if (b.parent) nodes.get(b.parent)!.addChild(nodes.get(b.name)!);

  const skin = doc.createSkin("skin");
  const ibm: number[] = [];
  BONES.forEach((b) => {
    skin.addJoint(nodes.get(b.name)!);
    ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.world[0], -b.world[1], -b.world[2], 1);
  });
  skin.setInverseBindMatrices(doc.createAccessor().setType("MAT4").setArray(new Float32Array(ibm)).setBuffer(buffer));
  skin.setSkeleton(nodes.get("hips")!);

  const mesh = doc.createMesh("body");
  for (const [bone, c, s, color] of PARTS) {
    const { p, idx } = boxVerts(c, s);
    const j = BONES.findIndex((b) => b.name === bone);
    const n = p.length / 3;
    const joints = new Uint16Array(n * 4);
    const weights = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      joints[i * 4] = j;
      weights[i * 4] = 1;
    }
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(p)).setBuffer(buffer))
        .setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(joints).setBuffer(buffer))
        .setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(weights).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(idx)).setBuffer(buffer))
        .setMaterial(doc.createMaterial().setBaseColorFactor(color).setMetallicFactor(0).setRoughnessFactor(0.85)),
    );
  }
  const scene = doc.createScene();
  scene.addChild(nodes.get("hips")!);
  scene.addChild(doc.createNode("body").setMesh(mesh).setSkin(skin));

  // gltf-transform no conoce VRMC_vrm: se añade al JSON del GLB ya escrito.
  const glb = await new WebIO().writeBinary(doc);
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
  const index = (name: string) => (json.nodes as { name?: string }[]).findIndex((n) => n.name === name);
  json.extensionsUsed = [...(json.extensionsUsed ?? []), "VRMC_vrm"];
  json.extensions = {
    ...(json.extensions ?? {}),
    VRMC_vrm: {
      specVersion: "1.0",
      meta: {
        name: "Maniquí xenxo",
        version: "1",
        authors: ["xenxo.io"],
        licenseUrl: "https://vrm.dev/licenses/1.0/",
        avatarPermission: "everyone",
        commercialUsage: "personalNonProfit",
        creditNotation: "unnecessary",
        allowRedistribution: true,
        modification: "allowModification",
      },
      humanoid: { humanBones: Object.fromEntries(BONES.map((b) => [b.name, { node: index(b.name) }])) },
    },
  };
  return rewriteJson(glb, json);
}

function rewriteJson(glb: Uint8Array, json: unknown): Uint8Array {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLen = dv.getUint32(12, true);
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const jsonBytes = new TextEncoder().encode(text);
  const rest = glb.subarray(20 + jsonLen);
  const out = new Uint8Array(20 + jsonBytes.length + rest.length);
  const o = new DataView(out.buffer);
  out.set(glb.subarray(0, 12));
  o.setUint32(8, out.length, true);
  o.setUint32(12, jsonBytes.length, true);
  o.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.set(rest, 20 + jsonBytes.length);
  return out;
}
