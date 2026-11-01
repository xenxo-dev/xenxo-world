/**
 * Lo que la gente pone en su ropa, preparado en el navegador (nada sale del dispositivo hasta que se
 * guarda la funda, y entonces va dentro de ella): imágenes subidas o pegadas, con el fondo quitado
 * si se pide; textos con las fuentes de xenxo; y los colores de una prenda vista en una foto.
 * El resultado es una imagen pequeña (WebP, o PNG si el navegador no sabe hacer WebP) que cabe en la
 * receta (`PRINT_MAX`).
 */
import { PRINT_MAX, type PrintFont } from "./recipe";

const FONTS: Record<PrintFont, string> = {
  display: '700 160px "Space Grotesk"',
  body: '700 160px "Inter Variable"',
  mono: '500 160px "IBM Plex Mono"',
};

async function bitmapOf(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

/** Imagen → data URL lista para la receta (como mucho 512 px de lado). */
export async function imageToPrint(file: Blob, removeBg: boolean): Promise<string> {
  const bmp = await bitmapOf(file);
  try {
    for (const side of [512, 384, 256]) {
      const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.imageSmoothingQuality = "high";
      g.drawImage(bmp, 0, 0, w, h);
      if (removeBg) keyOut(g, w, h);
      const trimmed = trim(c);
      const url = encode(trimmed);
      if (url.length <= PRINT_MAX) return url;
    }
    throw new Error("too_big");
  } finally {
    bmp.close();
  }
}

/** Quita el fondo: el color más repetido en el borde se vuelve transparente (con el borde suave). */
function keyOut(g: CanvasRenderingContext2D, w: number, h: number) {
  const img = g.getImageData(0, 0, w, h);
  const D = img.data;
  const border: number[][] = [];
  const at = (x: number, y: number) => {
    const o = (y * w + x) * 4;
    border.push([D[o]!, D[o + 1]!, D[o + 2]!]);
  };
  for (let x = 0; x < w; x += 2) {
    at(x, 0);
    at(x, h - 1);
  }
  for (let y = 0; y < h; y += 2) {
    at(0, y);
    at(w - 1, y);
  }
  const med = [0, 1, 2].map((k) => border.map((p) => p[k]!).sort((a, b) => a - b)[border.length >> 1]!);
  for (let i = 0; i < D.length; i += 4) {
    const d = Math.hypot(D[i]! - med[0]!, D[i + 1]! - med[1]!, D[i + 2]! - med[2]!);
    const a = Math.max(0, Math.min(1, (d - 26) / 34));
    D[i + 3] = Math.min(D[i + 3]!, a * 255);
  }
  g.putImageData(img, 0, 0);
}

/** Recorta lo transparente de alrededor (para que el tamaño elegido sea el del dibujo). */
function trim(c: HTMLCanvasElement): HTMLCanvasElement {
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const { data: D, width: w, height: h } = g.getImageData(0, 0, c.width, c.height);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (D[(y * w + x) * 4 + 3]! > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error("empty");
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return c;
  const pad = 2;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const o = document.createElement("canvas");
  o.width = x1 - x0 + 1;
  o.height = y1 - y0 + 1;
  o.getContext("2d")!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

function encode(c: HTMLCanvasElement): string {
  const webp = c.toDataURL("image/webp", 0.88);
  return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/png");
}

/** Un texto dibujado con las fuentes de xenxo (una o dos líneas). */
export async function textToPrint(text: string, font: PrintFont, color: string): Promise<string> {
  const value = text.trim().slice(0, 40);
  if (!value) throw new Error("empty");
  await document.fonts.load(FONTS[font]).catch(() => {});
  const lines = value.length > 18 && value.includes(" ") ? split(value) : [value];
  const c = document.createElement("canvas");
  const g0 = c.getContext("2d")!;
  g0.font = FONTS[font];
  const wide = Math.max(...lines.map((l) => g0.measureText(l).width));
  c.width = Math.ceil(wide + 40);
  c.height = 190 * lines.length + 20;
  const g = c.getContext("2d")!;
  g.font = FONTS[font];
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((l, i) => g.fillText(l, c.width / 2, 105 + i * 190));
  const k = Math.min(1, 512 / Math.max(c.width, c.height));
  const o = document.createElement("canvas");
  o.width = Math.max(1, Math.round(c.width * k));
  o.height = Math.max(1, Math.round(c.height * k));
  const og = o.getContext("2d")!;
  og.imageSmoothingQuality = "high";
  og.drawImage(c, 0, 0, o.width, o.height);
  return encode(trim(o));
}

function split(s: string): string[] {
  const mid = s.length / 2;
  let best = -1;
  for (let i = 0; i < s.length; i++) if (s[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? [s] : [s.slice(0, best), s.slice(best + 1)];
}

/**
 * Los colores de una prenda en una foto: los dos más presentes en el centro de la imagen, sin contar
 * el fondo (lo que se parece al borde). Devuelve 1 o 2 colores (#rrggbb).
 */
export async function garmentColors(file: Blob): Promise<string[]> {
  const bmp = await bitmapOf(file);
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, S, S);
  bmp.close();
  const D = g.getImageData(0, 0, S, S).data;
  const px = (x: number, y: number) => {
    const o = (y * S + x) * 4;
    return [D[o]!, D[o + 1]!, D[o + 2]!];
  };
  const border: number[][] = [];
  for (let i = 0; i < S; i++) border.push(px(i, 0), px(i, S - 1), px(0, i), px(S - 1, i));
  const bg = [0, 1, 2].map((k) => border.map((p) => p[k]!).sort((a, b) => a - b)[border.length >> 1]!);
  const pts: number[][] = [];
  for (let y = 8; y < S - 8; y++) {
    for (let x = 8; x < S - 8; x++) {
      const p = px(x, y);
      if (Math.hypot(p[0]! - bg[0]!, p[1]! - bg[1]!, p[2]! - bg[2]!) > 40) pts.push(p);
    }
  }
  if (pts.length < 40) for (let y = 16; y < S - 16; y++) for (let x = 16; x < S - 16; x++) pts.push(px(x, y));
  // k-medias con 4 grupos, empezando por puntos repartidos.
  let cent = [0, 1, 2, 3].map((i) => pts[Math.floor(((i + 0.5) / 4) * pts.length)]!.slice());
  const lab = new Int32Array(pts.length);
  for (let it = 0; it < 10; it++) {
    pts.forEach((p, i) => {
      let b = 0, bd = Infinity;
      cent.forEach((c2, j) => {
        const d = (p[0]! - c2[0]!) ** 2 + (p[1]! - c2[1]!) ** 2 + (p[2]! - c2[2]!) ** 2;
        if (d < bd) {
          bd = d;
          b = j;
        }
      });
      lab[i] = b;
    });
    cent = cent.map((c2, j) => {
      const mine = pts.filter((_, i) => lab[i] === j);
      return mine.length ? [0, 1, 2].map((k) => mine.reduce((s, p) => s + p[k]!, 0) / mine.length) : c2;
    });
  }
  const sizes = cent.map((_, j) => lab.filter((l) => l === j).length);
  const order = [0, 1, 2, 3].sort((a, b) => sizes[b]! - sizes[a]!);
  const hex = (p: number[]) => "#" + p.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const out = [hex(cent[order[0]!]!)];
  const second = order.slice(1).find((j) => sizes[j]! > pts.length * 0.12 && Math.hypot(...[0, 1, 2].map((k) => cent[j]![k]! - cent[order[0]!]![k]!)) > 60);
  if (second !== undefined) out.push(hex(cent[second]!));
  return out;
}

/** La imagen del portapapeles (si la hay) de un evento de pegar. */
export function pastedImage(e: ClipboardEvent): File | null {
  const items = e.clipboardData?.items;
  if (!items) return null;
  for (const it of items) if (it.kind === "file" && it.type.startsWith("image/")) return it.getAsFile();
  return null;
}
