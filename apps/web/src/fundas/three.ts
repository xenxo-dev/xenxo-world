/**
 * La funda en Three.js: carga lo que hace falta del kit, monta las mallas (vista previa sin
 * esqueleto, en la pose de MakeHuman) y la versión con esqueleto en pose T que se exporta a VRM.
 * Los colores se hornean en la textura (tono medio de la prenda → color elegido, con su sombreado).
 */
import * as THREE from "three";
import { bodyIndex, bodyRefs, computeShape, fitPart, partSkin, poseVertices, pushIn, smoothNormals, tPose, type KitData, type Shape } from "./build";
import { KIT_BASE, loadBin, loadKit, partById, type Bin, type Kit, type KitPart } from "./kit";
import { fancyCloth, isRobotHead, paintCloth, paintEyes, paintSkin, plainSkin } from "./paint";
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

/** Piezas que lleva una receta (cuerpo y ojos siempre; pestañas, salvo con cabeza de robot). */
export function partsOf(kit: Kit, r: Recipe): KitPart[] {
  const ids = [`body_${r.base}`, "eyes", ...(isRobotHead(r) ? [] : ["lashes"]), ...SLOTS.map((s) => r.parts[s]).filter((x): x is string => !!x)];
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

async function materialFor(d: KitData, p: KitPart, r: Recipe): Promise<THREE.MeshStandardMaterial> {
  const kit = d.kit;
  const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
  m.name = p.id;
  if (p.cat === "body") {
    m.roughness = 0.62;
    if (plainSkin(r)) {
      const skin = kit.skins.find((s) => s.id === r.skin) ?? kit.skins[0]!;
      m.map = await texture(skin.tex, null, false);
    } else {
      // Tono libre, maquillaje o acabados sintéticos y robóticos: textura compuesta (paint.ts).
      const sp = await paintSkin(kit, r);
      m.map = sp.map;
      if (sp.mr) {
        m.roughnessMap = sp.mr;
        m.metalnessMap = sp.mr;
        m.roughness = 1;
        m.metalness = 1;
      }
      if (sp.glow) {
        m.emissiveMap = sp.glow;
        m.emissive.set("#ffffff");
        m.emissiveIntensity = 1.4;
      }
    }
  } else if (p.cat === "eyes") {
    m.roughness = 0.25;
    if (r.iris || r.synth?.eyes) {
      const e = await paintEyes(kit, r);
      m.map = e.map;
      if (e.glow) {
        m.emissiveMap = e.glow;
        m.emissive.set("#ffffff");
        m.emissiveIntensity = 1.6;
      }
    } else m.map = await texture(`tex/eye_${r.eyes}.webp`, null, false);
  } else if (p.cat === "implant") {
    m.map = await texture(p.tex!, null, false);
    m.metalness = 0.85;
    m.roughness = 0.3;
    if (r.synth?.glow && p.glow) {
      m.emissiveMap = await texture(p.glow, null, false);
      m.emissive.set(r.synth.glow);
      m.emissiveIntensity = 1.6;
    }
  } else if (p.tex) {
    const tint = p.tint === "hair" ? r.hair : p.tint === "cloth" ? (r.colors[p.id] ?? null) : null;
    m.map = fancyCloth(p, r) ? await paintCloth(d, p, d.parts.get(p.id)!, r) : await texture(p.tex, tint, !!p.alpha);
    if (p.alpha) {
      m.alphaTest = 0.4;
      m.side = THREE.DoubleSide;
    }
    // La ropa por las dos caras: por el cuello o las mangas se ve su interior.
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
/** Botas altas: el pantalón va por dentro. */
const BOOTS = new Set(["sh_boots", "sh_overknee"]);
/** Cuánto se mete hacia dentro la prenda de debajo donde la cubre otra (m). */
const LAYER_GAP = 0.01;
/** La piel tapada queda al menos a esto de la prenda (m): si va más pegada, se mete entre 3 mm y 2 cm. */
const CLEAR = 0.01;
const PUSH_MIN = 0.003;
const PUSH_MAX = 0.02;

interface Layers {
  /** Piel que se quita: bien tapada y lejos de los bordes (vértices de la base). */
  gone: Set<number>;
  /** Cuánto se mete hacia dentro la piel tapada (m). */
  shrink: Map<number, number>;
  /** Pieza de dentro → piel que cubre la de fuera y a cuánto queda esta de ella (m). */
  inner: Map<string, Map<number, number>>;
  /** Pieza de dentro → piel bien tapada por la de fuera: ahí la de dentro no se dibuja. */
  hidden: Map<string, Set<number>>;
}

/**
 * Capas, con lo que calcula la forja para cada prenda (`under`: piel tapada; `gap`: a cuánto queda;
 * `cover`: la tapada lejos de los bordes): qué piel se quita, cuánto se mete la que queda tapada y qué
 * prenda va por dentro de otra (la de dentro se mete un poco donde la cubre la de fuera).
 */
function layersOf(d: KitData, parts: KitPart[]): Layers {
  const gone = new Set<number>();
  const shrink = new Map<number, number>();
  const covers = new Map<string, Set<number>>();
  const gaps = new Map<string, Map<number, number>>();
  const deepOf = new Map<string, Set<number>>();
  for (const p of parts) {
    if (p.cat === "body") continue;
    const b = d.parts.get(p.id)!;
    if (!b.has("under")) {
      if (b.has("delete")) for (const v of b.get<Uint16Array>("delete")) gone.add(v);
      continue;
    }
    const under = b.get<Uint16Array>("under");
    const gap = b.get<Uint8Array>("gap");
    const set = new Set<number>();
    const gm = new Map<number, number>();
    for (let i = 0; i < under.length; i++) {
      const v = under[i]!;
      set.add(v);
      const g = gap[i]! / 1000;
      gm.set(v, g);
      const push = g < CLEAR ? Math.min(PUSH_MAX, Math.max(PUSH_MIN, CLEAR - g)) : 0;
      if (push && (shrink.get(v) ?? 0) < push) shrink.set(v, push);
    }
    const deep = new Set<number>();
    for (const v of b.get<Uint16Array>("cover")) {
      gone.add(v);
      deep.add(v);
    }
    deepOf.set(p.id, deep);
    // La lista de borrado de MakeHuman, solo donde la prenda tapa de verdad.
    if (b.has("delete")) for (const v of b.get<Uint16Array>("delete")) if (set.has(v)) gone.add(v);
    if (COVERS.has(p.cat)) {
      covers.set(p.id, set);
      gaps.set(p.id, gm);
    }
  }
  const by = (cat: string) => parts.find((p) => p.cat === cat);
  const top = by("top") ?? by("outfit"), bottom = by("bottom"), shoes = by("shoes");
  const inner = new Map<string, Map<number, number>>();
  const hidden = new Map<string, Set<number>>();
  const under = (inside: KitPart | undefined, outside: KitPart | undefined) => {
    if (!inside || !outside || inside === outside) return;
    const c = covers.get(outside.id);
    if (!c) return;
    // La piel bajo la prenda de dentro, también donde esta se mete: más adentro todavía (y, donde la
    // tapan las dos, se quita).
    const ci = covers.get(inside.id);
    const deeper = LAYER_GAP + PUSH_MIN * 2;
    const tuck = (v: number) => {
      if (!c.has(v)) return;
      if ((shrink.get(v) ?? 0) < deeper) shrink.set(v, deeper);
    };
    if (ci) for (const v of ci) if (c.has(v)) {
      gone.add(v);
      tuck(v);
    }
    for (const v of bodyRefs(d.parts.get(inside.id)!)) tuck(v);
    const g = gaps.get(outside.id)!;
    const had = inner.get(inside.id);
    if (!had) inner.set(inside.id, new Map(g));
    else for (const [v, x] of g) had.set(v, Math.min(x, had.get(v) ?? Infinity));
    // Lo de dentro que queda bien tapado por la de fuera ni se ve ni hace falta (así no asoma).
    const deep = deepOf.get(outside.id);
    if (deep) {
      const h = hidden.get(inside.id);
      hidden.set(inside.id, h ? new Set([...h, ...deep]) : deep);
    }
  };
  const legs = bottom ?? (top?.cat === "outfit" ? top : undefined);
  if (top && bottom) TUCKED.has(top.id) ? under(top, bottom) : under(bottom, top);
  if (shoes && BOOTS.has(shoes.id)) under(legs, shoes);
  else under(shoes, legs);
  return { gone, shrink, inner, hidden };
}

/**
 * Reparte un valor por vértice a sus vecinos de la malla (cada anillo, `decay` veces el anterior), sin
 * bajar nunca el de nadie. Los vértices repetidos por las costuras de UV cuentan como uno.
 */
function spreadOnMesh(pos: Float32Array, idx: Uint16Array | Uint32Array, values: Float32Array, rounds: number, decay: number): Float32Array {
  const nv = values.length;
  const rep = new Int32Array(nv);
  const seen = new Map<string, number>();
  for (let i = 0; i < nv; i++) {
    const key = `${Math.round(pos[i * 3]! * 2e4)},${Math.round(pos[i * 3 + 1]! * 2e4)},${Math.round(pos[i * 3 + 2]! * 2e4)}`;
    const r = seen.get(key);
    rep[i] = r ?? i;
    if (r === undefined) seen.set(key, i);
  }
  let v = new Float32Array(nv);
  for (let i = 0; i < nv; i++) v[rep[i]!] = Math.max(v[rep[i]!]!, values[i]!);
  for (let round = 0; round < rounds; round++) {
    const next = v.slice();
    for (let f = 0; f < idx.length; f += 3) {
      const a = rep[idx[f]!]!, b = rep[idx[f + 1]!]!, c = rep[idx[f + 2]!]!;
      const m = Math.max(v[a]!, v[b]!, v[c]!) * decay;
      if (next[a]! < m) next[a] = m;
      if (next[b]! < m) next[b] = m;
      if (next[c]! < m) next[c] = m;
    }
    v = next;
  }
  const out = new Float32Array(nv);
  for (let i = 0; i < nv; i++) out[i] = v[rep[i]!]!;
  return out;
}

/**
 * Pelo bajo un sombrero: desde el centro de la cabeza hacia cada punto del pelo; si por el camino se
 * cruza el sombrero, el pelo se queda justo por dentro (lo que asoma por debajo del ala no se toca).
 * Lo que se mete se reparte un poco a los vecinos, para que no queden mechones estirados en el borde.
 */
function hatHair(pos: Float32Array, idx: Uint16Array | Uint32Array, hat: { pos: Float32Array; idx: Uint16Array | Uint32Array }, shape: Shape, kit: Kit) {
  const hb = kit.rig.bones.findIndex((b) => b.name === "head");
  const cx = (shape.heads[hb * 3]! + shape.tails[hb * 3]!) / 2;
  const cy = (shape.heads[hb * 3 + 1]! + shape.tails[hb * 3 + 1]!) / 2;
  const cz = (shape.heads[hb * 3 + 2]! + shape.tails[hb * 3 + 2]!) / 2;
  const hp = hat.pos, hi = hat.idx;
  const nt = hi.length / 3;
  // Triángulos del sombrero relativos al centro.
  const A = new Float32Array(nt * 3), E1 = new Float32Array(nt * 3), E2 = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = hi[t * 3]! * 3, b = hi[t * 3 + 1]! * 3, c = hi[t * 3 + 2]! * 3;
    for (let k = 0; k < 3; k++) {
      const ctr = k === 0 ? cx : k === 1 ? cy : cz;
      A[t * 3 + k] = hp[a + k]! - ctr;
      E1[t * 3 + k] = hp[b + k]! - hp[a + k]!;
      E2[t * 3 + k] = hp[c + k]! - hp[a + k]!;
    }
  }
  const MARGIN = 0.006;
  const nv = pos.length / 3;
  const pull = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    const px = pos[i * 3]! - cx, py = pos[i * 3 + 1]! - cy, pz = pos[i * 3 + 2]! - cz;
    const len = Math.hypot(px, py, pz);
    if (len < 1e-6) continue;
    const dx = px / len, dy = py / len, dz = pz / len;
    let near = Infinity;
    for (let t = 0; t < nt; t++) {
      const o = t * 3;
      const e1x = E1[o]!, e1y = E1[o + 1]!, e1z = E1[o + 2]!;
      const e2x = E2[o]!, e2y = E2[o + 1]!, e2z = E2[o + 2]!;
      const qx = dy * e2z - dz * e2y, qy = dz * e2x - dx * e2z, qz = dx * e2y - dy * e2x;
      const det = e1x * qx + e1y * qy + e1z * qz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const sx = -A[o]!, sy = -A[o + 1]!, sz = -A[o + 2]!;
      const u = (sx * qx + sy * qy + sz * qz) * inv;
      if (u < 0 || u > 1) continue;
      const rx = sy * e1z - sz * e1y, ry = sz * e1x - sx * e1z, rz = sx * e1y - sy * e1x;
      const v = (dx * rx + dy * ry + dz * rz) * inv;
      if (v < 0 || u + v > 1) continue;
      const d = (e2x * rx + e2y * ry + e2z * rz) * inv;
      if (d > 0 && d < near) near = d;
    }
    if (near !== Infinity && len > near - MARGIN) pull[i] = len - Math.max(0, near - MARGIN);
  }
  // Repartir a los vecinos (cada anillo, algo menos).
  const spread = spreadOnMesh(pos, idx, pull, 4, 0.6);
  for (let i = 0; i < nv; i++) {
    const k = spread[i]!;
    if (!k) continue;
    const px = pos[i * 3]! - cx, py = pos[i * 3 + 1]! - cy, pz = pos[i * 3 + 2]! - cz;
    const len = Math.hypot(px, py, pz);
    const s = Math.max(0.55, (len - k) / len);
    pos[i * 3] = cx + px * s;
    pos[i * 3 + 1] = cy + py * s;
    pos[i * 3 + 2] = cz + pz * s;
  }
}

/** El sombrero colocado (si lo hay), para meter el pelo por dentro. */
function hatOf(d: KitData, parts: KitPart[], cage: Float32Array) {
  const p = parts.find((x) => x.cat === "hat");
  const b = p && d.parts.get(p.id);
  if (!p || !b) return null;
  return { pos: fitPart(p, b, d.kit, cage), idx: b.get<Uint16Array | Uint32Array>("idx") };
}

/**
 * Coloca una pieza: el cuerpo, con la piel tapada metida hacia dentro; la prenda de dentro, por debajo
 * de la de fuera (cada punto se acerca a la piel que tiene debajo hasta quedar al menos 5 mm por dentro
 * de la de fuera, y siempre algo), y sin lo que queda del todo tapado.
 */
function placePart(p: KitPart, bin: Bin, pos: Float32Array, layers: Layers, cage: Float32Array) {
  const full = bin.get<Uint16Array | Uint32Array>("idx");
  if (p.cat === "body") {
    if (layers.shrink.size) pushIn(pos, bin, full, (v) => layers.shrink.get(v) ?? 0);
    return bodyIndex(bin, layers.gone);
  }
  const outer = layers.inner.get(p.id);
  if (outer) {
    const refs = bodyRefs(bin);
    const n = refs.length;
    // Cuánto se acerca cada punto a su piel; junto al borde de la de fuera, también algo los vecinos
    // (así un triángulo que cruza el bajo no asoma por encima).
    const amount = new Float32Array(n);
    const dist = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = refs[i]! * 3;
      dist[i] = Math.hypot(pos[i * 3]! - cage[v]!, pos[i * 3 + 1]! - cage[v + 1]!, pos[i * 3 + 2]! - cage[v + 2]!);
      const g = outer.get(refs[i]!);
      if (g === undefined) continue;
      const want = Math.max(0.002, Math.min(dist[i]! - LAYER_GAP * 0.4, g - 0.005));
      amount[i] = Math.max(0, dist[i]! - want);
    }
    const spread = spreadOnMesh(pos, full, amount, 3, 0.7);
    for (let i = 0; i < n; i++) {
      const a = spread[i]!;
      if (!a || dist[i]! < 1e-6) continue;
      const v = refs[i]! * 3;
      const k = Math.max(0.002, dist[i]! - a) / dist[i]!;
      if (k >= 1) continue;
      pos[i * 3] = cage[v]! + (pos[i * 3]! - cage[v]!) * k;
      pos[i * 3 + 1] = cage[v + 1]! + (pos[i * 3 + 1]! - cage[v + 1]!) * k;
      pos[i * 3 + 2] = cage[v + 2]! + (pos[i * 3 + 2]! - cage[v + 2]!) * k;
    }
  }
  const hide = layers.hidden.get(p.id);
  if (!hide?.size) return full;
  const under = bodyRefs(bin);
  const keep: number[] = [];
  for (let f = 0; f < full.length; f += 3) {
    const a = full[f]!, b = full[f + 1]!, c = full[f + 2]!;
    if (hide.has(under[a]!) && hide.has(under[b]!) && hide.has(under[c]!)) continue;
    keep.push(a, b, c);
  }
  return full instanceof Uint32Array ? new Uint32Array(keep) : new Uint16Array(keep);
}

/** Vista previa: mallas sin esqueleto en la pose de MakeHuman (brazos caídos). */
export async function buildPreview(r: Recipe): Promise<{ group: THREE.Group; shape: Shape; tris: number; top: number }> {
  const d = await kitData();
  const parts = partsOf(d.kit, r);
  await loadParts(d, parts);
  const shape = computeShape(d, r);
  const layers = layersOf(d, parts);
  const hat = hatOf(d, parts, shape.cage);
  const group = new THREE.Group();
  let tris = 0;
  let top = 1.7;
  const mats = await Promise.all(parts.map((p) => materialFor(d, p, r)));
  parts.forEach((p, i) => {
    const bin = d.parts.get(p.id)!;
    const pos = fitPart(p, bin, d.kit, shape.cage);
    const idx = placePart(p, bin, pos, layers, shape.cage);
    if (p.cat === "hair" && hat) hatHair(pos, idx, hat, shape, d.kit);
    tris += idx.length / 3;
    const mesh = new THREE.Mesh(geometry(pos, bin, idx), mats[i]);
    mesh.name = p.id;
    mesh.renderOrder = p.z;
    mesh.castShadow = true;
    group.add(mesh);
    // Lo alto de la cabeza (sin pelo ni gorro): para encuadrar la cara a la altura de cada funda.
    if (p.cat === "body") {
      mesh.geometry.computeBoundingBox();
      top = mesh.geometry.boundingBox!.max.y;
    }
  });
  return { group, shape, tris, top };
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
  const hat = hatOf(d, parts, shape.cage);
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
  const mats = await Promise.all(parts.map((p) => materialFor(d, p, r)));
  const meshes: THREE.SkinnedMesh[] = [];
  let tris = 0;
  parts.forEach((p, i) => {
    const bin = d.parts.get(p.id)!;
    const rest = fitPart(p, bin, kit, shape.cage);
    const idx = placePart(p, bin, rest, layers, shape.cage);
    if (p.cat === "hair" && hat) hatHair(rest, idx, hat, shape, kit);
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
