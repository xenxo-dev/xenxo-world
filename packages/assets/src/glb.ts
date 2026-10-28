/**
 * Inspección de archivos GLB (glTF 2.0 binario) SIN dependencias.
 *
 * Lo usa el servidor para decidir si acepta un modelo: es barato (solo lee la
 * cabecera, el JSON y las cabeceras de las imágenes) y no ejecuta nada del archivo.
 * El cliente lo usa también para avisar antes de subir.
 */

export interface GlbReport {
  bytes: number;
  triangles: number;
  vertices: number;
  meshes: number;
  images: number;
  /** Lado mayor de la textura más grande (px). 0 si no se pudo leer. */
  maxTextureSize: number;
  textureBytes: number;
  /** Píxeles de todas las texturas juntas (ancho × alto): lo que ocupan ya decodificadas. */
  texturePixels: number;
  animations: number;
  skinned: boolean;
  /** VRM 0.x o 1.0 (avatar humanoide estándar). */
  isVrm: boolean;
  extensions: string[];
  /** Altura aproximada (m) según los bounds de POSITION, sin transformaciones de nodo. */
  height: number;
  /** Caja envolvente aproximada (m), sin transformaciones de nodo. */
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
}

export class GlbError extends Error {
  constructor(
    public code: "not_glb" | "bad_structure" | "external_reference" | "forbidden_extension",
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

/** Extensiones que los clientes saben dibujar sin descargar nada externo. */
export const ALLOWED_EXTENSIONS = new Set([
  "KHR_materials_emissive_strength",
  "KHR_materials_unlit",
  "KHR_materials_transmission",
  "KHR_materials_ior",
  "KHR_materials_specular",
  "KHR_materials_clearcoat",
  "KHR_materials_sheen",
  "KHR_materials_volume",
  "KHR_texture_transform",
  "KHR_mesh_quantization",
  "KHR_texture_basisu",
  "EXT_meshopt_compression",
  "EXT_texture_webp",
  // Avatares VRM (VRoid Studio, UniVRM, Blender + VRM Add-on).
  "VRM",
  "VRMC_vrm",
  "VRMC_springBone",
  "VRMC_springBone_extended_collider",
  "VRMC_materials_mtoon",
  "VRMC_node_constraint",
  "VRMC_vrm_animation",
]);

/** Motivo legible para las extensiones rechazadas más habituales. */
const WHY_FORBIDDEN: Record<string, string> = {
  KHR_draco_mesh_compression: "exporta sin Draco (los clientes usan meshopt y no descargan decodificadores externos)",
  KHR_lights_punctual: "quita las luces del archivo: la iluminación la pone el mundo",
};

/**
 * Topes de estructura: lo que tiene sentido en un modelo de xenxo (un avatar VRM ronda los 300 nodos
 * y 1.500 accessors). Sin ellos, un GLB de 1 KB puede pedirle al navegador que reserve gigas.
 */
const LIMITS = {
  nodes: 20_000,
  meshes: 5_000,
  accessors: 50_000,
  bufferViews: 50_000,
  images: 128,
  materials: 2_000,
  animations: 500,
  /** Elementos por accessor (vértices, índices, fotogramas). */
  accessorCount: 4_000_000,
  /** Bytes descomprimidos por bufferView con meshopt, y en total. */
  meshoptView: 64 * 1024 ** 2,
  meshoptTotal: 256 * 1024 ** 2,
} as const;

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

const bad = (message: string) => new GlbError("bad_structure", message);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
function list<T>(v: unknown, name: string, max: number): T[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw bad(`${name} debe ser una lista`);
  if (v.length > max) throw bad(`${name}: demasiados (${v.length}; máximo ${max})`);
  for (const x of v) if (x === null || typeof x !== "object" || Array.isArray(x)) throw bad(`${name}: cada elemento debe ser un objeto`);
  return v as T[];
}

/**
 * Todas las extensiones que aparecen en el archivo (en la raíz, nodos, mallas, primitivas,
 * materiales, texturas, imágenes, bufferViews, accessors…), no solo las que declara
 * `extensionsUsed`: los cargadores activan sus plugins aunque no se declaren.
 */
function extensionsIn(root: unknown): Set<string> {
  const found = new Set<string>();
  const stack: unknown[] = [root];
  let seen = 0;
  while (stack.length) {
    const v = stack.pop();
    if (++seen > 2_000_000) throw bad("el JSON del GLB es demasiado grande");
    if (Array.isArray(v)) {
      for (const x of v) if (x !== null && typeof x === "object") stack.push(x);
    } else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Json)) {
        if (k === "extensions" && x !== null && typeof x === "object" && !Array.isArray(x)) for (const name of Object.keys(x)) found.add(name);
        if (x !== null && typeof x === "object") stack.push(x);
      }
    }
  }
  return found;
}

const MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

type Json = Record<string, unknown>;

interface GltfJson {
  asset?: { version?: string };
  extensionsUsed?: string[];
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; extensions?: Json }[];
  accessors?: {
    count: number;
    bufferView?: number;
    byteOffset?: number;
    type?: string;
    sparse?: { count: number; indices?: { bufferView: number }; values?: { bufferView: number } };
    min?: number[];
    max?: number[];
    normalized?: boolean;
    componentType?: number;
  }[];
  meshes?: { primitives: { mode?: number; indices?: number; attributes: Record<string, number> }[] }[];
  nodes?: {
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  animations?: unknown[];
  skins?: unknown[];
  extensions?: Json;
  materials?: unknown[];
}

export function inspectGlb(input: ArrayBuffer | Uint8Array): GlbReport {
  try {
    return inspect(input);
  } catch (e) {
    // Un archivo malformado (tipos que no son los del glTF) es un GLB que no vale, no un fallo del servidor.
    if (e instanceof GlbError) throw e;
    throw bad("el GLB no tiene la estructura de un glTF 2.0 válido");
  }
}

function inspect(input: ArrayBuffer | Uint8Array): GlbReport {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 20) throw new GlbError("not_glb", "el archivo es demasiado pequeño para ser un GLB");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (dv.getUint32(0, true) !== MAGIC) throw new GlbError("not_glb", "no es un GLB (exporta como glTF binario .glb o .vrm)");
  if (dv.getUint32(4, true) !== 2) throw new GlbError("not_glb", "solo se admite glTF 2.0");
  const declared = dv.getUint32(8, true);
  if (declared !== bytes.byteLength) throw new GlbError("bad_structure", "la longitud declarada no coincide con el archivo");

  // Chunks
  let offset = 12;
  let json: GltfJson | null = null;
  let bin: { start: number; length: number } | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const len = dv.getUint32(offset, true);
    const type = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + len > bytes.byteLength) throw new GlbError("bad_structure", "chunk truncado");
    if (type === CHUNK_JSON && !json) {
      try {
        json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + len))) as GltfJson;
      } catch {
        throw new GlbError("bad_structure", "el JSON del GLB no es válido");
      }
    } else if (type === CHUNK_BIN && !bin) {
      bin = { start, length: len };
    }
    offset = start + len;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new GlbError("bad_structure", "falta el chunk JSON");
  if (json.asset?.version !== "2.0") throw new GlbError("bad_structure", "asset.version debe ser 2.0");

  // Extensiones: las declaradas y todas las que aparecen en cualquier objeto del archivo.
  if (json.extensionsUsed !== undefined && (!Array.isArray(json.extensionsUsed) || json.extensionsUsed.some((e) => typeof e !== "string"))) {
    throw bad("extensionsUsed debe ser una lista de nombres");
  }
  const extensions = json.extensionsUsed ?? [];
  const present = extensionsIn(json);
  for (const e of extensions) present.add(e);
  const forbidden = [...present].filter((e) => !ALLOWED_EXTENSIONS.has(e));
  if (forbidden.length) {
    throw new GlbError(
      "forbidden_extension",
      `extensiones no admitidas: ${forbidden.join(", ")}`,
      { forbidden, hints: forbidden.map((e) => WHY_FORBIDDEN[e]).filter(Boolean) },
    );
  }

  // Nada externo: ni buffers ni imágenes con URI (ni siquiera data:).
  const buffers = json.buffers ?? [];
  if (buffers.some((b) => b.uri !== undefined)) {
    throw new GlbError("external_reference", "el GLB referencia buffers externos; exporta todo embebido en un único .glb");
  }
  const images = json.images ?? [];
  if (images.some((i) => i.uri !== undefined)) {
    throw new GlbError("external_reference", "el GLB referencia texturas externas; embébelas en el .glb");
  }

  // Listas con su tipo y su tope.
  list(json.nodes, "nodes", LIMITS.nodes);
  list(json.meshes, "meshes", LIMITS.meshes);
  list(json.materials as unknown, "materials", LIMITS.materials);
  list(json.animations, "animations", LIMITS.animations);
  list(json.images, "images", LIMITS.images);
  const binLength = bin?.length ?? 0;

  // bufferViews: dentro del chunk BIN (o, con meshopt, su versión comprimida dentro y la
  // descomprimida con un tamaño acotado).
  const viewList = list<NonNullable<GltfJson["bufferViews"]>[number]>(json.bufferViews, "bufferViews", LIMITS.bufferViews);
  let meshoptBytes = 0;
  viewList.forEach((v, i) => {
    const off = v.byteOffset ?? 0;
    if (!isInt(off, 0, 2 ** 31) || !isInt(v.byteLength, 0, 2 ** 31)) throw bad(`bufferView ${i}: tamaño no válido`);
    if (v.byteStride !== undefined && !isInt(v.byteStride, 4, 252)) throw bad(`bufferView ${i}: byteStride no válido`);
    const mo = v.extensions?.EXT_meshopt_compression as { buffer?: unknown; byteOffset?: unknown; byteLength?: unknown; byteStride?: unknown; count?: unknown } | undefined;
    if (mo) {
      const mOff = mo.byteOffset ?? 0;
      if (mo.buffer !== 0 || !isInt(mOff, 0, 2 ** 31) || !isInt(mo.byteLength, 0, 2 ** 31) || mOff + mo.byteLength > binLength) throw bad(`bufferView ${i}: datos comprimidos fuera del archivo`);
      if (!isInt(mo.byteStride, 1, 256) || !isInt(mo.count, 0, LIMITS.accessorCount)) throw bad(`bufferView ${i}: compresión no válida`);
      const out = mo.byteStride * mo.count;
      if (out > LIMITS.meshoptView || out > v.byteLength) throw bad(`bufferView ${i}: descomprimido demasiado grande`);
      meshoptBytes += out;
      if (meshoptBytes > LIMITS.meshoptTotal) throw bad("el modelo descomprimido es demasiado grande");
    } else if (v.buffer !== 0 || off + v.byteLength > binLength) {
      throw bad(`bufferView ${i} fuera del bloque binario del archivo`);
    } else if (v.byteLength > LIMITS.meshoptView * 2) {
      throw bad(`bufferView ${i} demasiado grande`);
    }
  });
  // El único buffer con datos es el BIN; los demás solo pueden ser el «respaldo» vacío de meshopt.
  buffers.forEach((b, i) => {
    if (i > 0 && !(b as { extensions?: Json }).extensions?.EXT_meshopt_compression) throw bad("solo se admite el bloque binario del propio GLB");
  });

  // Accessors: tipo, tamaño y que quepan en su bufferView (si no, el navegador reservaría
  // `count` elementos de la nada: un archivo de 1 KB puede pedir gigas).
  const accList = list<NonNullable<GltfJson["accessors"]>[number]>(json.accessors, "accessors", LIMITS.accessors);
  accList.forEach((a, i) => {
    const comp = COMPONENT_BYTES[a.componentType ?? -1];
    const size = TYPE_SIZE[a.type ?? ""];
    if (!comp || !size) throw bad(`accessor ${i}: tipo no válido`);
    if (!isInt(a.count, 0, LIMITS.accessorCount)) throw bad(`accessor ${i}: demasiados elementos`);
    if (a.bufferView === undefined) {
      if (!a.sparse) throw bad(`accessor ${i} sin datos`);
    } else {
      const view = isInt(a.bufferView, 0, viewList.length - 1) ? viewList[a.bufferView]! : null;
      if (!view) throw bad(`accessor ${i}: bufferView inexistente`);
      const off = a.byteOffset ?? 0;
      if (!isInt(off, 0, 2 ** 31)) throw bad(`accessor ${i}: desplazamiento no válido`);
      const elem = comp * size;
      const stride = view.byteStride ?? elem;
      if (a.count > 0 && off + (a.count - 1) * stride + elem > view.byteLength) throw bad(`accessor ${i} no cabe en su bufferView`);
    }
    if (a.sparse) {
      const sp = a.sparse;
      if (!isInt(sp.count, 1, a.count) || !isInt(sp.indices?.bufferView, 0, viewList.length - 1) || !isInt(sp.values?.bufferView, 0, viewList.length - 1)) {
        throw bad(`accessor ${i}: datos dispersos no válidos`);
      }
    }
  });

  // Nodos: un árbol (sin ciclos ni hijos compartidos) con índices válidos.
  {
    const nodeList = json.nodes ?? [];
    const parentOf = new Int32Array(nodeList.length).fill(-1);
    nodeList.forEach((n, i) => {
      if (n.mesh !== undefined && !isInt(n.mesh, 0, (json!.meshes ?? []).length - 1)) throw bad(`nodo ${i}: malla inexistente`);
      if (n.children !== undefined && !Array.isArray(n.children)) throw bad(`nodo ${i}: children no válido`);
      for (const c of n.children ?? []) {
        if (!isInt(c, 0, nodeList.length - 1) || c === i || parentOf[c] !== -1) throw bad(`nodo ${i}: jerarquía no válida`);
        parentOf[c] = i;
      }
    });
    // Sin ciclos: subiendo de padre en padre se llega a una raíz en menos pasos que nodos hay.
    for (let i = 0; i < nodeList.length; i++) {
      let p = parentOf[i]!, steps = 0;
      while (p !== -1) {
        if (++steps > nodeList.length) throw bad("la jerarquía de nodos tiene un ciclo");
        p = parentOf[p]!;
      }
    }
  }

  const accessors = json.accessors ?? [];
  const acc = (i: number | undefined) => {
    const a = i === undefined ? undefined : accessors[i];
    if (i !== undefined && !a) throw new GlbError("bad_structure", `accessor ${i} inexistente`);
    return a;
  };

  // Triángulos por malla
  const meshes = json.meshes ?? [];
  // Caja local de cada malla (en espacio de la malla, ya descuantizada).
  const meshBoxes: ({ min: number[]; max: number[] } | null)[] = [];
  let pendingBox: { min: number[]; max: number[] } | null = null;
  const meshStats = meshes.map((m) => {
    let tris = 0;
    let verts = 0;
    pendingBox = null;
    for (const p of m.primitives ?? []) {
      const pos = acc(p.attributes?.POSITION);
      if (!pos) continue;
      verts += pos.count;
      if (pos.min && pos.max) {
        const f = dequantizeFactor(pos);
        const box: { min: number[]; max: number[] } = pendingBox ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        for (let k = 0; k < 3; k++) {
          box.min[k] = Math.min(box.min[k]!, (pos.min[k] ?? Infinity) * f);
          box.max[k] = Math.max(box.max[k]!, (pos.max[k] ?? -Infinity) * f);
        }
        pendingBox = box;
      }
      const n = p.indices !== undefined ? acc(p.indices)!.count : pos.count;
      const mode = p.mode ?? 4;
      if (!isInt(mode, 0, 6)) throw bad("modo de primitiva no válido");
      if (mode === 4) tris += Math.floor(n / 3);
      else if (mode === 5 || mode === 6) tris += Math.max(0, n - 2);
      // puntos y líneas: 0 triángulos
    }
    meshBoxes.push(pendingBox);
    return { tris, verts };
  });

  // Cada nodo que instancia una malla cuenta (una malla usada 10 veces cuesta 10 veces).
  const nodes = json.nodes ?? [];
  const usesByMesh = new Array(meshes.length).fill(0) as number[];
  for (const n of nodes) if (n.mesh !== undefined && n.mesh < meshes.length) usesByMesh[n.mesh]!++;
  let triangles = 0;
  let vertices = 0;
  meshStats.forEach((s, i) => {
    const uses = Math.max(1, usesByMesh[i]!);
    triangles += s.tris * uses;
    vertices += s.verts * uses;
  });

  // Texturas: tamaño en bytes y dimensiones leídas de su cabecera.
  const views = json.bufferViews ?? [];
  let maxTextureSize = 0;
  let textureBytes = 0;
  let texturePixels = 0;
  images.forEach((img, i) => {
    // Cada imagen, dentro del archivo y en un formato cuyo tamaño se puede leer: si no, el navegador
    // la decodificaría sin que cuente en el presupuesto de texturas.
    const view = isInt(img.bufferView, 0, views.length - 1) ? views[img.bufferView] : undefined;
    if (!view || !bin || (view.extensions as Json | undefined)?.EXT_meshopt_compression) throw bad(`imagen ${i}: debe ir dentro del archivo`);
    textureBytes += view.byteLength;
    const start = bin.start + (view.byteOffset ?? 0);
    const data = bytes.subarray(start, start + view.byteLength);
    const dims = imageSize(data);
    if (!dims || !(dims[0] > 0 && dims[1] > 0)) throw bad(`imagen ${i}: formato no admitido (usa PNG, JPEG, WebP o KTX2)`);
    maxTextureSize = Math.max(maxTextureSize, dims[0], dims[1]);
    texturePixels += dims[0] * dims[1];
  });

  const isVrm = extensions.includes("VRMC_vrm") || extensions.includes("VRM");
  const { bmin, bmax } = sceneBounds(json, meshBoxes);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const hasBounds = bmin.every(Number.isFinite) && bmax.every(Number.isFinite);

  return {
    bytes: bytes.byteLength,
    triangles,
    vertices,
    meshes: meshes.length,
    images: images.length,
    maxTextureSize,
    textureBytes,
    texturePixels,
    animations: (json.animations ?? []).length,
    skinned: (json.skins ?? []).length > 0,
    isVrm,
    extensions,
    height: hasBounds ? round(bmax[1]! - bmin[1]!) : 0,
    bounds: hasBounds
      ? { min: bmin.map(round) as [number, number, number], max: bmax.map(round) as [number, number, number] }
      : null,
  };
}

/** Dimensiones de PNG, JPEG, WebP o KTX2 leyendo solo la cabecera. */
export function imageSize(d: Uint8Array): [number, number] | null {
  if (d.length < 32) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  // PNG
  if (d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) {
    return [dv.getUint32(16), dv.getUint32(20)];
  }
  // JPEG: buscar un marcador SOF
  if (d[0] === 0xff && d[1] === 0xd8) {
    let i = 2;
    while (i + 9 < d.length) {
      if (d[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = d[i + 1]!;
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return [dv.getUint16(i + 7), dv.getUint16(i + 5)];
      }
      i += 2 + len;
    }
    return null;
  }
  // WebP
  if (d[0] === 0x52 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x46 && d[8] === 0x57 && d[9] === 0x45) {
    const fourcc = String.fromCharCode(d[12]!, d[13]!, d[14]!, d[15]!);
    if (fourcc === "VP8X") return [1 + (d[24]! | (d[25]! << 8) | (d[26]! << 16)), 1 + (d[27]! | (d[28]! << 8) | (d[29]! << 16))];
    if (fourcc === "VP8 ") return [dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff];
    if (fourcc === "VP8L") {
      const b = dv.getUint32(21, true);
      return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1];
    }
    return null;
  }
  // KTX2: «KTX 20»
  if (d[0] === 0xab && d[1] === 0x4b && d[2] === 0x54 && d[3] === 0x58 && d[5] === 0x32) {
    return [dv.getUint32(20, true), dv.getUint32(24, true)];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Bounds con transformaciones de nodo y cuantización                   */
/* ------------------------------------------------------------------ */

/** Factor para pasar de enteros normalizados (KHR_mesh_quantization) a flotantes. */
function dequantizeFactor(a: { normalized?: boolean; componentType?: number }): number {
  if (!a.normalized) return 1;
  switch (a.componentType) {
    case 5120: return 1 / 127; // BYTE
    case 5121: return 1 / 255; // UNSIGNED_BYTE
    case 5122: return 1 / 32767; // SHORT
    case 5123: return 1 / 65535; // UNSIGNED_SHORT
    default: return 1;
  }
}

type Mat4 = number[]; // column-major, como glTF

function compose(t: number[] = [0, 0, 0], r: number[] = [0, 0, 0, 1], s: number[] = [1, 1, 1]): Mat4 {
  const [x = 0, y = 0, z = 0, w = 1] = r;
  const [sx = 1, sy = 1, sz = 1] = s;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    t[0] ?? 0, t[1] ?? 0, t[2] ?? 0, 1,
  ];
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0) as number[];
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = v;
    }
  return out;
}

function sceneBounds(json: GltfJson, meshBoxes: ({ min: number[]; max: number[] } | null)[]) {
  const bmin = [Infinity, Infinity, Infinity];
  const bmax = [-Infinity, -Infinity, -Infinity];
  const nodes = json.nodes ?? [];
  const visit = (i: number, parent: Mat4, depth: number) => {
    const n = nodes[i];
    if (!n || depth > 64) return;
    const local = n.matrix?.length === 16 ? n.matrix : compose(n.translation, n.rotation, n.scale);
    const world = multiply(parent, local);
    const box = n.mesh !== undefined ? meshBoxes[n.mesh] : null;
    if (box) {
      for (let c = 0; c < 8; c++) {
        const p = [c & 1 ? box.max[0]! : box.min[0]!, c & 2 ? box.max[1]! : box.min[1]!, c & 4 ? box.max[2]! : box.min[2]!];
        for (let k = 0; k < 3; k++) {
          const v = world[k]! * p[0]! + world[4 + k]! * p[1]! + world[8 + k]! * p[2]! + world[12 + k]!;
          bmin[k] = Math.min(bmin[k]!, v);
          bmax[k] = Math.max(bmax[k]!, v);
        }
      }
    }
    for (const ch of n.children ?? []) visit(ch, world, depth + 1);
  };
  const identity = compose();
  const sceneIndex = json.scene ?? 0;
  const roots = json.scenes?.[sceneIndex]?.nodes;
  if (roots) for (const r of roots) visit(r, identity, 0);
  else {
    // Sin escenas: se recorren los nodos que no son hijos de nadie.
    const children = new Set(nodes.flatMap((n) => n.children ?? []));
    nodes.forEach((_, i) => !children.has(i) && visit(i, identity, 0));
  }
  return { bmin, bmax };
}
