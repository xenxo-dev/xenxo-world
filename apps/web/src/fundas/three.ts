/**
 * La funda en Three.js: carga lo que hace falta del kit, monta las mallas (vista previa sin
 * esqueleto, en la pose de MakeHuman) y la versión con esqueleto en pose T que se exporta a VRM.
 * Los colores se hornean en la textura (tono medio de la prenda → color elegido, con su sombreado).
 */
import * as THREE from "three";
import { bodyIndex, computeShape, fitPart, partSkin, poseVertices, smoothNormals, tPose, type KitData, type Shape } from "./build";
import { KIT_BASE, loadBin, loadKit, partById, type Bin, type Kit, type KitPart } from "./kit";
import { SLOTS, type Recipe } from "./recipe";

let data: Promise<KitData> | null = null;

/** Lo común del kit (jaula, cara y esqueleto), una vez. */
export function kitData(): Promise<KitData> {
  data ??= (async () => {
    const kit = await loadKit();
    const [f, m, face, rig] = await Promise.all([
      loadBin(kit.bases.f.file, kit.bases.f.index),
      loadBin(kit.bases.m.file, kit.bases.m.index),
      loadBin(kit.faceFile.file, kit.faceFile.index),
      loadBin(kit.rig.file, kit.rig.index),
    ]);
    return { kit, base: { f, m }, face, rig, parts: new Map() };
  })();
  data.catch(() => (data = null));
  return data;
}

/** Piezas que lleva una receta (cuerpo, ojos y pestañas siempre). */
export function partsOf(kit: Kit, r: Recipe): KitPart[] {
  const ids = [`body_${r.base}`, "eyes", "lashes", ...SLOTS.map((s) => r.parts[s]).filter((x): x is string => !!x)];
  return ids.map((id) => partById(kit, id)).filter((p): p is KitPart => !!p);
}

export async function loadParts(d: KitData, parts: KitPart[]) {
  await Promise.all(
    parts.map(async (p) => {
      if (!d.parts.has(p.id)) d.parts.set(p.id, await loadBin(p.file, p.index));
    }),
  );
}

// ---------- Texturas ----------
const images = new Map<string, Promise<HTMLImageElement>>();
function image(path: string): Promise<HTMLImageElement> {
  let p = images.get(path);
  if (!p) {
    p = new Promise((ok, ko) => {
      const im = new Image();
      im.decoding = "async";
      im.onload = () => ok(im);
      im.onerror = () => ko(new Error(`textura ${path}`));
      im.src = KIT_BASE + path;
    });
    images.set(path, p);
    p.catch(() => images.delete(path));
  }
  return p;
}

const textures = new Map<string, THREE.Texture>();

/** Textura, teñida si hace falta (cache por textura y color). */
export async function texture(path: string, tint: string | null, alpha: boolean): Promise<THREE.Texture> {
  const key = `${path}|${tint ?? ""}`;
  const had = textures.get(key);
  if (had) return had;
  const im = await image(path);
  const c = document.createElement("canvas");
  c.width = im.naturalWidth;
  c.height = im.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(im, 0, 0);
  if (tint) {
    const data = g.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    // Tono medio de lo que se ve (sin lo transparente) para que el color elegido sea el medio.
    let sum = 0, cnt = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (alpha && px[i + 3]! < 128) continue;
      sum += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
      cnt++;
    }
    const mean = Math.max(8, sum / Math.max(1, cnt));
    const col = new THREE.Color(tint);
    const r = col.r * 255, gg = col.g * 255, b = col.b * 255;
    for (let i = 0; i < px.length; i += 4) {
      const l = (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) / mean;
      // Algo de contraste para que no quede plano; nunca más de 1,6× el color.
      const k = Math.min(1.6, Math.pow(l, 0.85));
      px[i] = Math.min(255, r * k);
      px[i + 1] = Math.min(255, gg * k);
      px[i + 2] = Math.min(255, b * k);
    }
    g.putImageData(data, 0, 0);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 4;
  textures.set(key, t);
  return t;
}

async function materialFor(kit: Kit, p: KitPart, r: Recipe): Promise<THREE.MeshStandardMaterial> {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
  m.name = p.id;
  if (p.cat === "body") {
    const skin = kit.skins.find((s) => s.id === r.skin) ?? kit.skins[0]!;
    m.map = await texture(skin.tex, null, false);
    m.roughness = 0.62;
  } else if (p.cat === "eyes") {
    m.map = await texture(`tex/eye_${r.eyes}.webp`, null, false);
    m.roughness = 0.25;
  } else if (p.tex) {
    const tint = p.tint === "hair" ? r.hair : p.tint === "cloth" ? (r.colors[p.id] ?? null) : null;
    m.map = await texture(p.tex, tint, !!p.alpha);
    if (p.alpha) {
      m.alphaTest = 0.4;
      m.side = THREE.DoubleSide;
    }
    // La ropa por las dos caras: por el cuello o las mangas se ve su interior (la piel de debajo no está).
    if (COVERS.has(p.cat) || p.cat === "hat") m.side = THREE.DoubleSide;
    if (p.cat === "hair" || p.cat === "beard" || p.cat === "brows" || p.cat === "lashes") m.roughness = 0.55;
    if (p.cat === "glasses") {
      m.roughness = 0.3;
      m.metalness = 0.2;
    }
  } else m.color.set(p.tint === "cloth" ? (r.colors[p.id] ?? "#888888") : "#888888");
  return m;
}

function geometry(pos: Float32Array, bin: Bin, index: Uint16Array | Uint32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const uvq = bin.get<Uint16Array>("uv");
  const uv = new Float32Array(uvq.length);
  // MakeHuman tiene la V hacia arriba; las texturas van sin voltear (flipY = false).
  for (let i = 0; i < uvq.length; i += 2) {
    uv[i] = uvq[i]! / 65535;
    uv[i + 1] = 1 - uvq[i + 1]! / 65535;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.setAttribute("normal", new THREE.BufferAttribute(smoothNormals(pos, index), 3));
  return g;
}

/** Prendas que tapan la piel que tienen debajo (y entre las que hay que ordenar capas). */
const COVERS = new Set(["top", "bottom", "outfit", "shoes", "gloves"]);
/** Partes de arriba que van por dentro del pantalón. */
const TUCKED = new Set(["top_tucked", "top_bodice", "top_turtle"]);
/** Cuánto se mete hacia dentro la prenda de debajo donde la cubre otra (m). */
const LAYER_GAP = 0.01;

/** Vértice de la base más pesado de cada vértice de una pieza. */
function primaryRefs(bin: Bin): Uint16Array {
  const refs = bin.get<Uint16Array>("refs");
  const w = bin.get<Float32Array>("w");
  const out = new Uint16Array(refs.length / 3);
  for (let i = 0; i < out.length; i++) {
    let best = 0;
    for (let k = 1; k < 3; k++) if (w[i * 3 + k]! > w[i * 3 + best]!) best = k;
    out[i] = refs[i * 3 + best]!;
  }
  return out;
}

/** Vértices del cuerpo que quedan bajo una prenda (los calcula la forja: `cover`). */
function coverOf(bin: Bin, which: "cover" | "under" = "cover"): Set<number> {
  const set = new Set<number>();
  if (bin.has(which)) for (const v of bin.get<Uint16Array>(which)) set.add(v);
  else for (const v of primaryRefs(bin)) set.add(v);
  return set;
}

/**
 * Capas: qué piel se esconde (lo que borra cada prenda, y lo que queda del todo bajo una prenda) y qué
 * prenda va por dentro de otra (la de dentro se mete un poco donde la cubre la de fuera: sin piel ni
 * prenda que asome por los bordes).
 */
function layersOf(d: KitData, parts: KitPart[]) {
  const hard = new Set<number>();
  const soft = new Set<number>();
  const covers = new Map<string, Set<number>>();
  for (const p of parts) {
    const b = d.parts.get(p.id)!;
    if (p.cat === "body") continue;
    if (b.has("delete")) for (const v of b.get<Uint16Array>("delete")) hard.add(v);
    if (COVERS.has(p.cat)) {
      for (const v of coverOf(b)) soft.add(v);
      covers.set(p.id, coverOf(b, "under"));
    }
  }
  const by = (cat: string) => parts.find((p) => p.cat === cat);
  const top = by("top") ?? by("outfit"), bottom = by("bottom"), shoes = by("shoes");
  /** Pieza de dentro → conjunto de vértices de la base que cubre la de fuera. */
  const inner = new Map<string, Set<number>>();
  const under = (inside: KitPart | undefined, outside: KitPart | undefined) => {
    if (!inside || !outside || inside === outside) return;
    const c = covers.get(outside.id);
    if (!c) return;
    // Donde se solapan las dos, la piel queda tapada seguro (también junto a los bordes).
    const ci = covers.get(inside.id);
    if (ci) for (const v of ci) if (c.has(v)) soft.add(v);
    const had = inner.get(inside.id);
    inner.set(inside.id, had ? new Set([...had, ...c]) : c);
  };
  if (top && bottom) TUCKED.has(top.id) ? under(top, bottom) : under(bottom, top);
  under(shoes, bottom ?? (top?.cat === "outfit" ? top : undefined));
  return { hard, soft, inner };
}

/** Mete hacia dentro (contra su normal) los vértices de una prenda que quedan bajo otra. */
function tuckIn(pos: Float32Array, bin: Bin, idx: Uint16Array | Uint32Array, outer: Set<number> | undefined) {
  if (!outer) return;
  const prim = primaryRefs(bin);
  const n = smoothNormals(pos, idx);
  for (let i = 0; i < prim.length; i++) {
    if (!outer.has(prim[i]!)) continue;
    pos[i * 3] = pos[i * 3]! - n[i * 3]! * LAYER_GAP;
    pos[i * 3 + 1] = pos[i * 3 + 1]! - n[i * 3 + 1]! * LAYER_GAP;
    pos[i * 3 + 2] = pos[i * 3 + 2]! - n[i * 3 + 2]! * LAYER_GAP;
  }
}

/** Vista previa: mallas sin esqueleto en la pose de MakeHuman (brazos caídos). */
export async function buildPreview(r: Recipe): Promise<{ group: THREE.Group; shape: Shape; tris: number }> {
  const d = await kitData();
  const parts = partsOf(d.kit, r);
  await loadParts(d, parts);
  const shape = computeShape(d, r);
  const layers = layersOf(d, parts);
  const group = new THREE.Group();
  let tris = 0;
  const mats = await Promise.all(parts.map((p) => materialFor(d.kit, p, r)));
  parts.forEach((p, i) => {
    const bin = d.parts.get(p.id)!;
    const pos = fitPart(p, bin, d.kit, shape.cage);
    const idx = p.cat === "body" ? bodyIndex(bin, layers.hard, layers.soft) : bin.get<Uint16Array>("idx");
    tuckIn(pos, bin, idx, layers.inner.get(p.id));
    tris += idx.length / 3;
    const mesh = new THREE.Mesh(geometry(pos, bin, idx), mats[i]);
    mesh.name = p.id;
    mesh.renderOrder = p.z;
    mesh.castShadow = true;
    group.add(mesh);
  });
  return { group, shape, tris };
}

/**
 * La funda para exportar: esqueleto en pose T (giros nulos, como pide VRM) y una malla con piel por
 * pieza. `bones` va en el orden del kit.
 */
export async function buildSkinned(r: Recipe): Promise<{ root: THREE.Group; bones: THREE.Bone[]; meshes: THREE.SkinnedMesh[]; tris: number }> {
  const d = await kitData();
  const { kit } = d;
  const parts = partsOf(kit, r);
  await loadParts(d, parts);
  const shape = computeShape(d, r);
  const pose = tPose(kit, shape);
  const layers = layersOf(d, parts);
  const bones = kit.rig.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    return bone;
  });
  kit.rig.bones.forEach((b, i) => {
    const h = pose.heads;
    if (b.parent < 0) bones[i]!.position.set(h[i * 3]!, h[i * 3 + 1]!, h[i * 3 + 2]!);
    else {
      const p = b.parent;
      bones[i]!.position.set(h[i * 3]! - h[p * 3]!, h[i * 3 + 1]! - h[p * 3 + 1]!, h[i * 3 + 2]! - h[p * 3 + 2]!);
      bones[p]!.add(bones[i]!);
    }
  });
  const root = new THREE.Group();
  root.name = "funda";
  root.add(bones[0]!);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const mats = await Promise.all(parts.map((p) => materialFor(kit, p, r)));
  const meshes: THREE.SkinnedMesh[] = [];
  let tris = 0;
  parts.forEach((p, i) => {
    const bin = d.parts.get(p.id)!;
    const rest = fitPart(p, bin, kit, shape.cage);
    const idx = p.cat === "body" ? bodyIndex(bin, layers.hard, layers.soft) : bin.get<Uint16Array>("idx");
    tuckIn(rest, bin, idx, layers.inner.get(p.id));
    const skin = partSkin(bin, d.rig);
    const pos = poseVertices(rest, skin, shape.heads, pose);
    tris += idx.length / 3;
    const g = geometry(pos, bin, idx);
    g.setAttribute("skinIndex", new THREE.BufferAttribute(skin.index, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(skin.weight, 4));
    const mesh = new THREE.SkinnedMesh(g, mats[i]);
    mesh.name = p.id;
    mesh.renderOrder = p.z;
    root.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
    meshes.push(mesh);
  });
  return { root, bones, meshes, tris };
}
