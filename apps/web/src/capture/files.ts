/**
 * Un movimiento (capture/retarget.ts) en archivos: un .vrma (VRM Animation 1.0, el formato de los
 * clips del juego, que también abren Blender con su complemento de VRM, Unity o three-vrm) y un .bvh
 * (para cualquier programa de animación). Sin nada del navegador: sirve igual en Node.
 *
 * En el .vrma va además su ficha de gesto (`asset.extras["xenxo:gesto"]`: el nombre del gesto, sus
 * textos y cómo se reproduce en el juego), que lee `npm run gesture:add` (tools/gestures/add.mjs) al
 * añadirlo a xenxo. Nada de quien lo grabó ni del vídeo.
 */
import type { Motion, Q4, RestBone } from "./retarget";

/** Cómo va el gesto en el juego (world/animation.ts → EmoteClip) y sus textos. */
export interface GestureMeta {
  /** Su nombre en el juego (`^[a-z][a-z_]{0,23}$`: el mismo que viaja por la red). */
  id: string;
  es: string;
  en: string;
  /** Se reproduce una vez (si no, en bucle mientras dure). */
  once: boolean;
  /** Al andar sigue en la parte de arriba del cuerpo. */
  upper: boolean;
  /** Siempre solo arriba: las piernas, las de quien lo hace (se grabó de cintura para arriba). */
  overlay: boolean;
  /** Trae sus dedos (se vieron las manos): el juego no le pone su mano de base. */
  fingers: boolean;
}

export const GESTURE_ID = /^[a-z][a-z_]{0,23}$/;
const EXTRAS_KEY = "xenxo:gesto";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** El movimiento como .vrma (glTF binario con VRMC_vrm_animation), con su ficha si la hay. */
export function writeVrma(m: Motion, meta?: GestureMeta | null, name = "gesto"): Uint8Array<ArrayBuffer> {
  const bones = m.bones;
  const index = new Map(bones.map((b, i) => [b.name, i]));
  const kids = (parent: string) => bones.filter((b) => b.parent === parent).map((b) => index.get(b.name)!);
  const nodes = bones.map((b) => {
    const node: { name: string; translation: number[]; children?: number[] } = { name: b.name, translation: [...b.offset] };
    const c = kids(b.name);
    if (c.length) node.children = c;
    return node;
  });
  const frames = m.frames;
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  const add = (arr: Float32Array, type: string, count: number, extra?: Record<string, unknown>) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    views.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length });
    chunks.push(bytes);
    byteLength += bytes.length;
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count, type, ...extra });
    return accessors.length - 1;
  };
  const times = new Float32Array(frames.map((f) => f.t));
  const tAcc = add(times, "SCALAR", times.length, { min: [times[0] ?? 0], max: [times[times.length - 1] ?? 0] });
  const samplers: { input: number; output: number; interpolation: string }[] = [];
  const channels: { sampler: number; target: { node: number; path: string } }[] = [];
  for (const b of bones) {
    const q = new Float32Array(frames.length * 4);
    frames.forEach((fr, i) => q.set(fr.rot[b.name] ?? [0, 0, 0, 1], i * 4));
    samplers.push({ input: tAcc, output: add(q, "VEC4", frames.length), interpolation: "LINEAR" });
    channels.push({ sampler: samplers.length - 1, target: { node: index.get(b.name)!, path: "rotation" } });
  }
  const hips = index.get("hips");
  if (hips !== undefined) {
    const hp = new Float32Array(frames.length * 3);
    frames.forEach((fr, i) => hp.set(fr.hips, i * 3));
    samplers.push({ input: tAcc, output: add(hp, "VEC3", frames.length), interpolation: "LINEAR" });
    channels.push({ sampler: samplers.length - 1, target: { node: hips, path: "translation" } });
  }
  const humanBones: Record<string, { node: number }> = {};
  for (const b of bones) humanBones[b.name] = { node: index.get(b.name)! };
  const json = {
    asset: { version: "2.0", generator: "xenxo · gestos desde un vídeo", ...(meta ? { extras: { [EXTRAS_KEY]: meta } } : {}) },
    scene: 0,
    scenes: [{ nodes: hips !== undefined ? [hips] : [] }],
    nodes,
    animations: [{ name, samplers, channels }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength }],
    extensionsUsed: ["VRMC_vrm_animation"],
    extensions: { VRMC_vrm_animation: { specVersion: "1.0", humanoid: { humanBones } } },
  };
  return glb(json, chunks, byteLength);
}

/** glTF binario: cabecera, el JSON y los datos (cada trozo, a múltiplo de 4). */
function glb(json: unknown, chunks: Uint8Array[], byteLength: number): Uint8Array<ArrayBuffer> {
  const text = enc.encode(JSON.stringify(json));
  const jsonLen = Math.ceil(text.length / 4) * 4;
  const binLen = Math.ceil(byteLength / 4) * 4;
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + jsonLen);
  dv.setUint32(20 + jsonLen, binLen, true);
  dv.setUint32(24 + jsonLen, 0x004e4942, true);
  let at = 28 + jsonLen;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** El JSON de un glTF binario (o null si no lo es). */
export function glbJson(bytes: Uint8Array): Record<string, unknown> | null {
  if (bytes.length < 20) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(16, true) !== 0x4e4f534a) return null;
  const len = dv.getUint32(12, true);
  if (20 + len > bytes.length) return null;
  try {
    return JSON.parse(dec.decode(bytes.subarray(20, 20 + len))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** La ficha de gesto de un .vrma (o null si no la trae o no vale). */
export function readMeta(bytes: Uint8Array): GestureMeta | null {
  const json = glbJson(bytes);
  const m = (json?.asset as { extras?: Record<string, unknown> } | undefined)?.extras?.[EXTRAS_KEY] as Partial<GestureMeta> | undefined;
  if (!m || typeof m.id !== "string" || !GESTURE_ID.test(m.id)) return null;
  const text = (s: unknown) => (typeof s === "string" ? s.trim().slice(0, 40) : "");
  const es = text(m.es), en = text(m.en);
  if (!es || !en) return null;
  return { id: m.id, es, en, once: !!m.once, upper: !!m.upper, overlay: !!m.overlay, fingers: !!m.fingers };
}

/* ------------------------------------------------------------------ */
/* BVH                                                                  */
/* ------------------------------------------------------------------ */

/** El giro como ángulos ZXY en grados (R = Rz · Rx · Ry, el orden de los canales del BVH). */
function eulerZXY([x, y, z, w]: Q4): [number, number, number] {
  const m12 = 2 * (x * y - w * z), m22 = 1 - 2 * (x * x + z * z);
  const m31 = 2 * (x * z - w * y), m32 = 2 * (y * z + w * x), m33 = 1 - 2 * (x * x + y * y);
  const m21 = 2 * (x * y + w * z), m11 = 1 - 2 * (y * y + z * z);
  const ex = Math.asin(Math.max(-1, Math.min(1, m32)));
  let ey: number, ez: number;
  if (Math.abs(m32) < 0.9999999) {
    ey = Math.atan2(-m31, m33);
    ez = Math.atan2(-m12, m22);
  } else {
    ey = 0;
    ez = Math.atan2(m21, m11);
  }
  const d = 180 / Math.PI;
  return [ez * d, ex * d, ey * d];
}

/**
 * El movimiento como .bvh: la jerarquía del humanoide en reposo (la pose en T, en metros, y arriba) y,
 * por fotograma, la posición de la cadera y el giro de cada hueso respecto a su padre.
 */
export function writeBvh(m: Motion): string {
  const bones = m.bones;
  const order: RestBone[] = [];
  const f = (n: number) => n.toFixed(6);
  const lines: string[] = ["HIERARCHY"];
  const write = (b: RestBone, depth: number) => {
    const pad = "  ".repeat(depth);
    order.push(b);
    const off = b.parent ? b.offset : [0, 0, 0];
    lines.push(`${pad}${b.parent ? "JOINT" : "ROOT"} ${b.name}`, `${pad}{`, `${pad}  OFFSET ${off.map(f).join(" ")}`);
    lines.push(`${pad}  CHANNELS ${b.parent ? "3" : "6 Xposition Yposition Zposition"} Zrotation Xrotation Yrotation`);
    const kids = bones.filter((k) => k.parent === b.name);
    if (!kids.length) {
      // La punta: un poco más allá, en la dirección del hueso.
      const len = Math.hypot(...b.offset);
      const tip = len > 1e-4 ? b.offset.map((x) => (x / len) * Math.min(0.08, len * 0.5)) : [0, 0.05, 0];
      lines.push(`${pad}  End Site`, `${pad}  {`, `${pad}    OFFSET ${tip.map(f).join(" ")}`, `${pad}  }`);
    }
    for (const k of kids) write(k, depth + 1);
    lines.push(`${pad}}`);
  };
  const root = bones.find((b) => !b.parent);
  if (root) write(root, 0);
  const dt = m.frames.length > 1 ? (m.frames[m.frames.length - 1]!.t - m.frames[0]!.t) / (m.frames.length - 1) : 1 / m.fps;
  lines.push("MOTION", `Frames: ${m.frames.length}`, `Frame Time: ${dt.toFixed(6)}`);
  for (const fr of m.frames) {
    const row: string[] = [];
    for (const b of order) {
      if (!b.parent) row.push(...fr.hips.map(f));
      row.push(...eulerZXY(fr.rot[b.name] ?? [0, 0, 0, 1]).map(f));
    }
    lines.push(row.join(" "));
  }
  return lines.join("\n") + "\n";
}
