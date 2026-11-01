/**
 * Texturas compuestas de una funda, en el navegador y sin nada nuevo que descargar:
 *
 * - la piel: tono libre, maquillaje, barba de tres días, pecas y acabados por zonas (piel sintética o
 *   carcasas de robot) con sus juntas y líneas de panel, que pueden brillar. Con los mapas de la forja
 *   (zonas, líneas y maquillaje en el espacio UV del cuerpo, que comparten todas las pieles);
 * - el iris: color libre y ojos que brillan (máscara del iris de la forja);
 * - la ropa: color, estampado (en 3D: las rayas van horizontales aunque la prenda esté cortada en
 *   piezas) e imágenes o textos en el pecho o la espalda, proyectados sobre la prenda puesta en un
 *   cuerpo neutro (así el dibujo va «impreso» en la tela y se estira con ella).
 *
 * Cada textura se guarda en caché por lo que la define; las que dejan de usarse se liberan.
 */
import * as THREE from "three";
import { computeShape, fitPart, smoothNormals, type KitData } from "./build";
import { KIT_BASE, type Bin, type Kit, type KitPart } from "./kit";
import { FINISHES, ZONES, isRobot, type Finish, type Pattern, type Print, type Recipe } from "./recipe";

type RGB = [number, number, number];

const rgb = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ---------- Imágenes como datos ----------

const datas = new Map<string, Promise<ImageData>>();

/** Píxeles de una imagen del kit o de una data URL, tal cual (sin gestión de color), a un tamaño. */
export function pixels(url: string, w?: number, h?: number): Promise<ImageData> {
  const key = `${url.length > 200 ? hash(url) : url}|${w ?? ""}x${h ?? ""}`;
  let p = datas.get(key);
  if (!p) {
    p = (async () => {
      const blob = await (await fetch(url.startsWith("data:") ? url : KIT_BASE + url)).blob();
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      const c = document.createElement("canvas");
      c.width = w ?? bmp.width;
      c.height = h ?? bmp.height;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.imageSmoothingQuality = "high";
      g.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      return g.getImageData(0, 0, c.width, c.height);
    })();
    datas.set(key, p);
    p.catch(() => datas.delete(key));
    // Las imágenes de la gente (data URL) no se acumulan.
    if (url.startsWith("data:") && datas.size > 40) {
      for (const k of datas.keys()) {
        if (k.includes("|") && !k.startsWith("tex/")) {
          datas.delete(k);
          break;
        }
      }
    }
  }
  return p;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 7) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `#${(h >>> 0).toString(36)}${s.length}`;
}

function canvasOf(img: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

function toTexture(img: ImageData, color: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvasOf(img));
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.flipY = false;
  t.anisotropy = 4;
  return t;
}

/** Caché pequeña de texturas: al salir una, se libera en la GPU. */
class Lru<T extends { dispose(): void }> {
  private m = new Map<string, Promise<T>>();
  constructor(private max: number) {}
  get(key: string, make: () => Promise<T>): Promise<T> {
    const had = this.m.get(key);
    if (had) {
      this.m.delete(key);
      this.m.set(key, had);
      return had;
    }
    const p = make();
    this.m.set(key, p);
    p.catch(() => this.m.delete(key));
    while (this.m.size > this.max) {
      const [k, old] = this.m.entries().next().value as [string, Promise<T>];
      this.m.delete(k);
      old.then((x) => x.dispose()).catch(() => {});
    }
    return p;
  }
}

// ---------- Piel ----------

export interface SkinPaint {
  map: THREE.Texture;
  /** Rugosidad (G) y metal (B) por píxel, si hay acabados que no son piel. */
  mr: THREE.Texture | null;
  /** Lo que brilla (líneas), si hay color de brillo. */
  glow: THREE.Texture | null;
  dispose(): void;
}

const skins = new Lru<SkinPaint>(3);

/** ¿La receta cambia algo de la piel tal cual viene? */
export function plainSkin(r: Recipe): boolean {
  return !r.skinTone && !r.looks && !r.synth?.zones;
}

export function paintSkin(kit: Kit, r: Recipe): Promise<SkinPaint> {
  const skin = kit.skins.find((s) => s.id === r.skin) ?? kit.skins[0]!;
  const key = JSON.stringify([skin.id, r.skinTone ?? "", r.looks ?? 0, r.synth?.zones ?? 0, r.synth?.glow ?? "", r.looks?.stubble ? r.hair : ""]);
  return skins.get(key, async () => {
    const base = await pixels(skin.tex);
    const W = base.width, H = base.height;
    const [B, F, K] = await Promise.all([pixels(kit.maps.body, W, H), pixels(kit.maps.face, W, H), pixels(kit.maps.skin, W, H)]);
    const zones = r.synth?.zones ?? {};
    const fin = ZONES.map((z) => FINISHES.indexOf((zones[z]?.finish ?? "skin") as Finish));
    const col = ZONES.map((z) => rgb(zones[z]?.color ?? "#808080"));
    const anySynth = fin.some((f) => f === 1);
    const anyHard = fin.some((f) => f > 0);
    // Tono libre: cada canal se escala hacia el color pedido (el detalle de la piel se mantiene).
    const tone = rgb(skin.tone);
    const want = r.skinTone ? rgb(r.skinTone) : tone;
    const tr = want[0] / Math.max(8, tone[0]), tg = want[1] / Math.max(8, tone[1]), tb = want[2] / Math.max(8, tone[2]);
    const meanL = Math.max(20, lum(...tone));
    const smooth = anySynth ? blurred(base, 96) : null;
    const lk = r.looks ?? {};
    const lips = lk.lips ? rgb(lk.lips.color) : null, lipsA = lk.lips?.amount ?? 0;
    const shadow = lk.shadow ? rgb(lk.shadow.color) : null, shadowA = lk.shadow?.amount ?? 0;
    const blush = lk.blush ? rgb(lk.blush.color) : null, blushA = lk.blush?.amount ?? 0;
    const stubbleA = lk.stubble ?? 0, frecklesA = lk.freckles ?? 0;
    const hair = rgb(r.hair);
    const beard: RGB = [hair[0] * 0.55, hair[1] * 0.55, hair[2] * 0.55];
    const glowC = r.synth?.glow ? rgb(r.synth.glow) : null;

    const out = new ImageData(W, H);
    const mr = anyHard ? new ImageData(W, H) : null;
    const em = glowC && anyHard ? new ImageData(W, H) : null;
    const S = base.data, D = out.data;
    const ROUGH = [0.62, 0.42, 0.22, 0.55, 0.35, 0.18];
    const METAL = [0, 0, 1, 0.05, 0.2, 0];
    const DARK = [0, 0.4, 0.75, 0.6, 0.55, 0.5];
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i += 4) {
        const z = Math.max(0, Math.min(4, Math.round((B.data[i]! - 25) / 50)));
        const f = fin[z]!;
        let r0 = S[i]! * tr, g0 = S[i + 1]! * tg, b0 = S[i + 2]! * tb;
        let rough = ROUGH[f]!, metal = METAL[f]!, glow = 0;
        if (f <= 1) {
          if (f === 1) {
            // Piel sintética: lisa (sin poros ni manchas) y hacia el color elegido.
            const sm = smooth!.data;
            const c = col[z]!;
            const ls = lum(sm[i]! * tr, sm[i + 1]! * tg, sm[i + 2]! * tb) / Math.max(20, lum(...c));
            const k = Math.pow(Math.min(1.5, ls), 0.6);
            r0 = sm[i]! * tr * 0.35 + c[0] * k * 0.65;
            g0 = sm[i + 1]! * tg * 0.35 + c[1] * k * 0.65;
            b0 = sm[i + 2]! * tb * 0.35 + c[2] * k * 0.65;
            const seam = B.data[i + 1]! / 255;
            const d = 1 - DARK[1]! * seam;
            r0 *= d;
            g0 *= d;
            b0 *= d;
            glow = seam;
          }
          // Maquillaje (y, en la piel natural, barba de tres días y pecas).
          const ml = F.data[i]!, ms = F.data[i + 1]!, mb = F.data[i + 2]!;
          if (ml + ms + mb > 0) {
            const l = lum(r0, g0, b0);
            if (lips && ml) [r0, g0, b0] = makeup(r0, g0, b0, l, lips, (ml / 255) * lipsA * 0.9);
            if (shadow && ms) [r0, g0, b0] = makeup(r0, g0, b0, l, shadow, (ms / 255) * shadowA * 0.85);
            if (blush && mb) [r0, g0, b0] = makeup(r0, g0, b0, l, blush, (mb / 255) * blushA * 0.5);
          }
          if (f === 0) {
            const s = (K.data[i]! / 255) * stubbleA * 0.92;
            if (s > 0) {
              r0 += (beard[0] - r0) * s;
              g0 += (beard[1] - g0) * s;
              b0 += (beard[2] - b0) * s;
            }
            const fr = (K.data[i + 1]! / 255) * frecklesA * 0.75;
            if (fr > 0) {
              r0 *= 1 - 0.3 * fr;
              g0 *= 1 - 0.45 * fr;
              b0 *= 1 - 0.58 * fr;
            }
          }
        } else {
          // Carcasa: el color elegido con un poco del relieve de la piel, y sus líneas.
          const c = col[z]!;
          const detail = 0.84 + 0.16 * Math.max(0.5, Math.min(1.4, lum(S[i]!, S[i + 1]!, S[i + 2]!) / meanL));
          let k = detail;
          if (f === 4) {
            // Fibra de carbono: tejido en diagonal.
            const cx = x >> 2, cy = y >> 2;
            k *= (cx + cy) & 1 ? 0.8 + 0.2 * ((x & 3) / 3) : 0.8 + 0.2 * ((y & 3) / 3);
          }
          const L = Math.max(B.data[i + 1]!, B.data[i + 2]!) / 255;
          const d = 1 - DARK[f]! * L;
          r0 = c[0] * k * d;
          g0 = c[1] * k * d;
          b0 = c[2] * k * d;
          rough += (0.7 - rough) * L;
          metal *= 1 - 0.7 * L;
          glow = L;
        }
        D[i] = r0;
        D[i + 1] = g0;
        D[i + 2] = b0;
        D[i + 3] = 255;
        if (mr) {
          mr.data[i] = 255;
          mr.data[i + 1] = rough * 255;
          mr.data[i + 2] = metal * 255;
          mr.data[i + 3] = 255;
        }
        if (em) {
          const gl = f === 0 ? 0 : glow;
          em.data[i] = glowC![0] * gl;
          em.data[i + 1] = glowC![1] * gl;
          em.data[i + 2] = glowC![2] * gl;
          em.data[i + 3] = 255;
        }
      }
    }
    const map = toTexture(out, true);
    const mrT = mr ? toTexture(mr, false) : null;
    const glowT = em ? toTexture(em, true) : null;
    return {
      map,
      mr: mrT,
      glow: glowT,
      dispose() {
        map.dispose();
        mrT?.dispose();
        glowT?.dispose();
      },
    };
  });
}

/** Mezcla de maquillaje: el color pedido con la luz y sombra de la piel de debajo. */
function makeup(r: number, g: number, b: number, l: number, c: RGB, a: number): RGB {
  if (a <= 0) return [r, g, b];
  const k = Math.pow(Math.max(0.2, Math.min(1.6, l / Math.max(25, lum(...c)))), 0.55);
  return [r + (c[0] * k - r) * a, g + (c[1] * k - g) * a, b + (c[2] * k - b) * a];
}

/** La piel desenfocada (reducida y vuelta a ampliar): para la piel sintética. */
function blurred(img: ImageData, small: number): ImageData {
  const c = canvasOf(img);
  const s = document.createElement("canvas");
  s.width = s.height = small;
  const sg = s.getContext("2d")!;
  sg.imageSmoothingQuality = "high";
  sg.drawImage(c, 0, 0, small, small);
  const o = document.createElement("canvas");
  o.width = img.width;
  o.height = img.height;
  const og = o.getContext("2d", { willReadFrequently: true })!;
  og.imageSmoothingQuality = "high";
  og.drawImage(s, 0, 0, img.width, img.height);
  return og.getImageData(0, 0, img.width, img.height);
}

// ---------- Ojos ----------

export interface EyePaint {
  map: THREE.Texture;
  glow: THREE.Texture | null;
  dispose(): void;
}
const eyes = new Lru<EyePaint>(3);

export function paintEyes(kit: Kit, r: Recipe): Promise<EyePaint> {
  const key = JSON.stringify([r.eyes, r.iris ?? "", r.synth?.eyes ?? ""]);
  return eyes.get(key, async () => {
    const base = await pixels(`tex/eye_${r.eyes}.webp`);
    const M = await pixels(kit.maps.iris, base.width, base.height);
    const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
    const glow = r.synth?.eyes ? new ImageData(base.width, base.height) : null;
    const want = r.iris ? rgb(r.iris) : null;
    const gc = r.synth?.eyes ? rgb(r.synth.eyes) : null;
    const D = out.data;
    for (let i = 0; i < D.length; i += 4) {
      const m = M.data[i]! / 255;
      if (want && m > 0) {
        const k = Math.pow(Math.max(0.15, Math.min(1.8, lum(D[i]!, D[i + 1]!, D[i + 2]!) / Math.max(30, lum(...want)))), 0.8);
        D[i] = D[i]! + (want[0] * k - D[i]!) * m;
        D[i + 1] = D[i + 1]! + (want[1] * k - D[i + 1]!) * m;
        D[i + 2] = D[i + 2]! + (want[2] * k - D[i + 2]!) * m;
      }
      if (glow && gc) {
        glow.data[i] = gc[0] * m;
        glow.data[i + 1] = gc[1] * m;
        glow.data[i + 2] = gc[2] * m;
        glow.data[i + 3] = 255;
      }
    }
    const map = toTexture(out, true);
    const glowT = glow ? toTexture(glow, true) : null;
    return {
      map,
      glow: glowT,
      dispose() {
        map.dispose();
        glowT?.dispose();
      },
    };
  });
}

// ---------- Ropa ----------

/** Dónde cae cada píxel de la textura de una prenda: posición y normal en 3D (cuerpo neutro). */
interface Surface {
  W: number;
  H: number;
  /** Posición en mm (x, y, z) y normal (x, z) × 127 de cada píxel. */
  P: Int16Array;
  N: Int8Array;
  M: Uint8Array;
  /** Altura de la prenda en mm (para el degradado) y centro del pecho y ancho de hombros en m (imágenes). */
  y0: number;
  y1: number;
  chest: { y: number; z: number; w: number };
}
const surfaces = new Map<string, Promise<Surface>>();

function surfaceOf(d: KitData, part: KitPart, bin: Bin, base: "f" | "m", W: number, H: number): Promise<Surface> {
  const key = `${part.id}|${base}|${W}`;
  let s = surfaces.get(key);
  if (!s) {
    s = Promise.resolve().then(() => {
      const shape = computeShape(d, { v: 1, base, body: {}, face: {}, skin: "", eyes: "", parts: {}, hair: "#000000", colors: {} });
      const pos = fitPart(part, bin, d.kit, shape.cage);
      const idx = bin.get<Uint16Array | Uint32Array>("idx");
      const nrm = smoothNormals(pos, idx);
      const uvq = bin.get<Uint16Array>("uv");
      const P = new Int16Array(W * H * 3), N = new Int8Array(W * H * 2), M = new Uint8Array(W * H);
      let y0 = Infinity, y1 = -Infinity;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
        const ax = (uvq[a * 2]! / 65535) * W, ay = (1 - uvq[a * 2 + 1]! / 65535) * H;
        const bx = (uvq[b * 2]! / 65535) * W, by = (1 - uvq[b * 2 + 1]! / 65535) * H;
        const cx = (uvq[c * 2]! / 65535) * W, cy = (1 - uvq[c * 2 + 1]! / 65535) * H;
        const den = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
        if (Math.abs(den) < 1e-9) continue;
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
        const yA = Math.max(0, Math.floor(Math.min(ay, by, cy))), yB = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
        for (let py = yA; py <= yB; py++) {
          for (let px = x0; px <= x1; px++) {
            const X = px + 0.5, Y = py + 0.5;
            const l1 = ((X - ax) * (cy - ay) - (Y - ay) * (cx - ax)) / den;
            const l2 = ((bx - ax) * (Y - ay) - (by - ay) * (X - ax)) / den;
            const l0 = 1 - l1 - l2;
            if (l0 < -0.02 || l1 < -0.02 || l2 < -0.02) continue;
            const o = py * W + px;
            for (let k = 0; k < 3; k++) P[o * 3 + k] = (pos[a * 3 + k]! * l0 + pos[b * 3 + k]! * l1 + pos[c * 3 + k]! * l2) * 1000;
            N[o * 2] = (nrm[a * 3]! * l0 + nrm[b * 3]! * l1 + nrm[c * 3]! * l2) * 127;
            N[o * 2 + 1] = (nrm[a * 3 + 2]! * l0 + nrm[b * 3 + 2]! * l1 + nrm[c * 3 + 2]! * l2) * 127;
            M[o] = 1;
          }
        }
      }
      for (let i = 1; i < pos.length; i += 3) {
        y0 = Math.min(y0, pos[i]! * 1000);
        y1 = Math.max(y1, pos[i]! * 1000);
      }
      // Pecho: un poco por debajo del arranque del cuello; ancho, el de los hombros.
      const bones = d.kit.rig.bones;
      const bi = (n: string) => bones.findIndex((b) => b.name === n);
      const neck = bi("neck_01"), ul = bi("upperarm_l"), ur = bi("upperarm_r"), sp = bi("spine_02");
      const shoulders = Math.abs(shape.heads[ul * 3]! - shape.heads[ur * 3]!);
      const chest = { y: shape.heads[neck * 3 + 1]! - shoulders * 0.48, z: shape.heads[sp * 3 + 2]!, w: shoulders };
      return { W, H, P, N, M, y0, y1, chest };
    });
    surfaces.set(key, s);
    s.catch(() => surfaces.delete(key));
    if (surfaces.size > 4) surfaces.delete(surfaces.keys().next().value as string);
  }
  return s;
}

const cloths = new Lru<{ map: THREE.Texture; dispose(): void }>(6);

/** ¿Lleva estampado o imágenes esta prenda? */
export function fancyCloth(part: KitPart, r: Recipe): boolean {
  return !!(part.tex && (r.patterns?.[part.id] || r.prints?.[part.id]));
}

/**
 * La textura de una prenda con su color, su estampado y sus imágenes (si no lleva nada de eso, basta
 * con la textura teñida de three.ts). La luz y sombra salen de la textura original.
 */
export function paintCloth(d: KitData, part: KitPart, bin: Bin, r: Recipe): Promise<THREE.Texture> {
  const pattern = r.patterns?.[part.id];
  const prints = r.prints?.[part.id];
  const key = JSON.stringify([part.id, r.base, r.colors[part.id] ?? "", pattern ?? 0, prints ? [hashPrint(prints.front), hashPrint(prints.back)] : 0]);
  return cloths
    .get(key, async () => {
      const original = await pixels(part.tex!);
      const W = prints ? Math.max(1024, original.width) : original.width;
      const H = prints ? Math.max(1024, original.height) : original.height;
      const S = (W === original.width ? original : scaled(original, W, H)).data;
      const surf = await surfaceOf(d, part, bin, r.base, W, H);
      const front = prints?.front ? await pixels(prints.front.img) : null;
      const back = prints?.back ? await pixels(prints.back.img) : null;
      const out = new ImageData(W, H);
      const D = out.data;
      // Luz y sombra de la tela: luminancia relativa a la media de lo que se ve.
      let sum = 0, cnt = 0;
      for (let i = 0; i < S.length; i += 4) {
        if (part.alpha && S[i + 3]! < 128) continue;
        sum += lum(S[i]!, S[i + 1]!, S[i + 2]!);
        cnt++;
      }
      const mean = Math.max(8, sum / Math.max(1, cnt));
      const tint = r.colors[part.id];
      const A: RGB = tint ? rgb(tint) : meanColor(S, part.alpha);
      const Bc: RGB | null = pattern ? rgb(pattern.color) : null;
      const per = pattern ? 0.035 + 0.1 * pattern.scale : 1;
      const { P, N, M } = surf;
      const span = Math.max(50, surf.y1 - surf.y0);
      const ch = surf.chest;
      for (let o = 0, i = 0; o < W * H; o++, i += 4) {
        const k = Math.min(1.6, Math.pow(lum(S[i]!, S[i + 1]!, S[i + 2]!) / mean, 0.85));
        let cr = tint ? A[0] * k : S[i]!, cg = tint ? A[1] * k : S[i + 1]!, cb = tint ? A[2] * k : S[i + 2]!;
        D[i + 3] = S[i + 3]!;
        if (M[o]) {
          const px = P[o * 3]! / 1000, py = P[o * 3 + 1]! / 1000, pz = P[o * 3 + 2]! / 1000;
          const nx = N[o * 2]! / 127, nz = N[o * 2 + 1]! / 127;
          if (pattern && Bc) {
            const p = patternAt(pattern.kind, px, py, pz, nx, nz, per, (P[o * 3 + 1]! - surf.y0) / span);
            cr = (A[0] + (Bc[0] - A[0]) * p) * k;
            cg = (A[1] + (Bc[1] - A[1]) * p) * k;
            cb = (A[2] + (Bc[2] - A[2]) * p) * k;
          }
          // Imágenes: delante (normal hacia +Z) o detrás, en un rectángulo centrado en el pecho.
          for (const [img, pr, sign] of [
            [front, prints?.front, 1],
            [back, prints?.back, -1],
          ] as const) {
            if (!img || !pr) continue;
            if (sign * nz < 0.15 || sign * (pz - ch.z) < 0) continue;
            const w = ch.w * 0.62 * pr.size;
            const h = (w * img.height) / img.width;
            const cy = ch.y + pr.y * 0.12;
            const s = (sign * px) / w + 0.5, t = (cy - py) / h + 0.5;
            if (s < 0 || s > 1 || t < 0 || t > 1) continue;
            const [ir, ig, ib, ia] = sample(img, s, t);
            if (ia <= 0) continue;
            const kk = 0.45 + 0.55 * k;
            const a = ia / 255;
            cr += (ir * kk - cr) * a;
            cg += (ig * kk - cg) * a;
            cb += (ib * kk - cb) * a;
          }
        }
        D[i] = cr;
        D[i + 1] = cg;
        D[i + 2] = cb;
      }
      dilate(out, M, 3);
      const map = toTexture(out, true);
      return { map, dispose: () => map.dispose() };
    })
    .then((x) => x.map);
}

function hashPrint(p: Print | undefined): string {
  return p ? `${hash(p.img)}|${p.size}|${p.y}` : "";
}

function meanColor(S: Uint8ClampedArray, alpha: boolean | undefined): RGB {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < S.length; i += 16) {
    if (alpha && S[i + 3]! < 128) continue;
    r += S[i]!;
    g += S[i + 1]!;
    b += S[i + 2]!;
    n++;
  }
  n = Math.max(1, n);
  return [r / n, g / n, b / n];
}

function scaled(img: ImageData, W: number, H: number): ImageData {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingQuality = "high";
  g.drawImage(canvasOf(img), 0, 0, W, H);
  return g.getImageData(0, 0, W, H);
}

/** Muestra bilineal de una imagen (s, t en 0…1). */
function sample(img: ImageData, s: number, t: number): [number, number, number, number] {
  const x = s * img.width - 0.5, y = t * img.height - 0.5;
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x))), y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
  const D = img.data;
  const o00 = (y0 * img.width + x0) * 4, o10 = (y0 * img.width + x1) * 4, o01 = (y1 * img.width + x0) * 4, o11 = (y1 * img.width + x1) * 4;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const a = D[o00 + k]! + (D[o10 + k]! - D[o00 + k]!) * fx;
    const b = D[o01 + k]! + (D[o11 + k]! - D[o01 + k]!) * fx;
    out[k] = a + (b - a) * fy;
  }
  return out;
}

/** Valor del estampado (0 = color de la prenda, 1 = el segundo) en un punto de la prenda (m). */
function patternAt(kind: Pattern["kind"], x: number, y: number, z: number, nx: number, nz: number, per: number, height: number): number {
  // En los costados, lo horizontal va con Z; delante y detrás, con X.
  const u = Math.abs(nx) > Math.abs(nz) ? z : x;
  switch (kind) {
    case "stripes":
      return wave(y / per);
    case "checks": {
      const a = wave(u / per), b = wave(y / per);
      return a * (1 - b) + b * (1 - a);
    }
    case "dots": {
      const du = fract(u / per) - 0.5, dv = fract(y / per + (Math.floor(u / per) & 1) * 0.5) - 0.5;
      const r = Math.hypot(du, dv);
      return Math.max(0, Math.min(1, (0.3 - r) / 0.04));
    }
    case "camo": {
      const n = noise3(x / (per * 1.7), y / (per * 1.7), z / (per * 1.7)) * 0.7 + noise3(x / (per * 0.7) + 9, y / (per * 0.7), z / (per * 0.7)) * 0.3;
      return n < 0.46 ? 0 : n < 0.6 ? 1 : 0.5;
    }
    case "gradient":
      return Math.max(0, Math.min(1, height));
  }
}

const fract = (v: number) => v - Math.floor(v);
/** Onda cuadrada suave (0/1) para rayas y cuadros. */
const wave = (v: number) => {
  const f = fract(v);
  return Math.max(0, Math.min(1, (Math.min(f, 1 - f) - 0.25) / 0.03 + 0.5));
};

function h3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  let v = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    const w = (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
    v += w * h3(xi + dx, yi + dy, zi + dz);
  }
  return v;
}

/** Extiende lo pintado unos píxeles fuera de cada isla (para que no se vean costuras al filtrar). */
function dilate(img: ImageData, mask: Uint8Array, steps: number) {
  const { width: W, height: H, data: D } = img;
  let m = mask.slice();
  for (let s = 0; s < steps; s++) {
    const next = m.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = y * W + x;
        if (m[o]) continue;
        const n = x > 0 && m[o - 1] ? o - 1 : x < W - 1 && m[o + 1] ? o + 1 : y > 0 && m[o - W] ? o - W : y < H - 1 && m[o + W] ? o + W : -1;
        if (n < 0) continue;
        D[o * 4] = D[n * 4]!;
        D[o * 4 + 1] = D[n * 4 + 1]!;
        D[o * 4 + 2] = D[n * 4 + 2]!;
        next[o] = 1;
      }
    }
    m = next;
  }
}

// ---------- Cabeza de robot ----------

/** Con la cabeza de carcasa no van pestañas (ni maquillaje). */
export function isRobotHead(r: Recipe): boolean {
  return isRobot(r.synth?.zones?.head?.finish);
}
