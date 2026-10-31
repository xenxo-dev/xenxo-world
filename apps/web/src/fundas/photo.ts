/**
 * Funda desde una foto, sin que la foto salga del dispositivo: MediaPipe (Face Landmarker, Apache-2.0)
 * corre aquí, en WebAssembly servido por xenxo (public/mediapipe/ y public/fundas/vision/), y saca
 * los puntos de la cara. Con ellos y los colores de la imagen se propone una receta: forma de la cara
 * (calibrada con las propias fundas: face-measure.ts), tono de piel, color de ojos y de pelo, y si
 * hay pelo largo o barba. No se guarda nada: la imagen se suelta al acabar. No se adivina ni el
 * sexo ni la edad ni el origen de nadie: la base, la edad y lo demás los elige la persona.
 */
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { measureFace, solveSliders, type Calibration } from "./face-measure";
import type { Kit } from "./kit";
import { EYE_SWATCH, HAIR_COLORS, type Recipe } from "./recipe";

const WASM = "/mediapipe";
const MODEL = "/fundas/vision/face_landmarker.task";
const CALIBRATION = "/fundas/vision/calibration.json";

let landmarker: Promise<FaceLandmarker> | null = null;

/** El detector (una vez): ~10 MB de WebAssembly y ~4 MB de modelo la primera vez. */
export function faceLandmarker(): Promise<FaceLandmarker> {
  landmarker ??= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const files = await FilesetResolver.forVisionTasks(WASM);
    return FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
      runningMode: "IMAGE",
      numFaces: 1,
    });
  })();
  landmarker.catch(() => (landmarker = null));
  return landmarker;
}

let calibration: Promise<Calibration | null> | null = null;
function loadCalibration(): Promise<Calibration | null> {
  calibration ??= fetch(CALIBRATION)
    .then((r) => (r.ok ? (r.json() as Promise<Calibration>) : null))
    .catch(() => null);
  return calibration;
}

export type PhotoResult =
  | { ok: true; patch: Pick<Recipe, "face" | "skin" | "eyes" | "hair"> & { parts: Partial<Recipe["parts"]> }; notes: string[] }
  | { ok: false; reason: "no_face" | "turned" | "error" };

/** Analiza una imagen (archivo o foto de la cámara) y propone cambios para la receta `r`. */
export async function fromPhoto(file: Blob, kit: Kit, r: Recipe): Promise<PhotoResult> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(bitmap, 0, 0, w, h);
    const [det, cal] = await Promise.all([faceLandmarker(), loadCalibration()]);
    // MediaPipe mide mejor en una imagen cuadrada: se centra en un lienzo cuadrado y se deshace.
    const side = Math.max(w, h);
    const sq = document.createElement("canvas");
    sq.width = sq.height = side;
    const ox = (side - w) / 2, oy = (side - h) / 2;
    sq.getContext("2d")!.drawImage(canvas, ox, oy);
    const res = det.detect(sq);
    sq.width = sq.height = 0;
    const lm = res.faceLandmarks[0]?.map((p) => ({ x: (p.x * side - ox) / w, y: (p.y * side - oy) / h, z: p.z }));
    if (!lm) return { ok: false, reason: "no_face" };
    const m = measureFace(lm, w, h);
    if (!m) return { ok: false, reason: "turned" };
    const px = g.getImageData(0, 0, w, h);
    const colors = readColors(px, lm, w, h);
    g.clearRect(0, 0, w, h);

    const face = { ...r.face, ...(cal ? solveSliders(cal, r.base, m) : {}) };
    const parts: Partial<Recipe["parts"]> = {};
    const notes: string[] = [];
    // Piel: el tono más parecido entre las de la misma base y la misma edad que ya tiene.
    const age = r.skin.split("_")[0];
    const skins = kit.skins.filter((s) => s.id.endsWith(`_${r.base}`) && s.id.startsWith(`${age}_`));
    const skin = nearest(colors.skin, skins.map((s) => ({ id: s.id, color: s.tone })))?.id ?? r.skin;
    const eyes = nearest(colors.iris, kit.eyes.map((e) => ({ id: e, color: EYE_SWATCH[e] ?? "#777777" })))?.id ?? r.eyes;
    let hair = r.hair;
    if (colors.hair) hair = nearest(colors.hair, HAIR_COLORS.map((c) => ({ id: c, color: c })))?.id ?? hair;
    // Peinado: solo si se ve claro (pelo muy corto o largo por los lados).
    const ids = new Set(kit.parts.map((p) => p.id));
    if (colors.hairAmount < 0.2) {
      if (ids.has("hair_short04")) parts.hair = "hair_short04";
      notes.push("short");
    } else if (colors.longHair) {
      const pick = ["hair_long", "hair_bob_long"].find((id) => ids.has(id));
      if (pick) parts.hair = pick;
      notes.push("long");
    }
    // Barba solo si la base elegida es la de hombre (nunca se deduce de la foto quién es quién).
    if (r.base !== "m") colors.beard = null;
    if (colors.beard === "full" && ids.has("beard_full")) parts.beard = "beard_full";
    else if (colors.beard === "moustache" && ids.has("beard_moustache")) parts.beard = "beard_moustache";
    return { ok: true, patch: { face, skin, eyes, hair, parts }, notes };
  } catch (e) {
    console.warn("[xenxo] funda desde foto", e);
    return { ok: false, reason: "error" };
  } finally {
    bitmap?.close();
  }
}

/* ---------------- Colores ---------------- */

type RGB = [number, number, number];

function readColors(img: ImageData, lm: { x: number; y: number }[], w: number, h: number) {
  const at = (i: number): [number, number] => [lm[i]!.x * w, lm[i]!.y * h];
  const sample = (x: number, y: number, r: number): RGB[] => {
    const out: RGB[] = [];
    const x0 = Math.max(0, Math.round(x - r)), x1 = Math.min(w - 1, Math.round(x + r));
    const y0 = Math.max(0, Math.round(y - r)), y1 = Math.min(h - 1, Math.round(y + r));
    for (let yy = y0; yy <= y1; yy++)
      for (let xx = x0; xx <= x1; xx++) {
        const o = (yy * w + xx) * 4;
        out.push([img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]);
      }
    return out;
  };
  const faceW = Math.hypot(at(454)[0] - at(234)[0], at(454)[1] - at(234)[1]);
  const faceH = Math.hypot(at(152)[0] - at(10)[0], at(152)[1] - at(10)[1]);
  const r = Math.max(2, faceW * 0.035);

  // Piel: mejillas y frente.
  const skinPx = [...sample(...at(50), r), ...sample(...at(280), r), ...sample(...at(151), r)];
  const skin = median(skinPx);

  // Iris: el anillo entre la pupila y el borde.
  const irisPx: RGB[] = [];
  for (const [c, ring] of [
    [468, [469, 470, 471, 472]],
    [473, [474, 475, 476, 477]],
  ] as const) {
    if (!lm[c]) continue;
    const [cx, cy] = at(c);
    const rad = ring.reduce((s, i) => s + Math.hypot(at(i)[0] - cx, at(i)[1] - cy), 0) / ring.length;
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      for (const k of [0.45, 0.6, 0.75]) irisPx.push(...sample(cx + Math.cos(t) * rad * k, cy + Math.sin(t) * rad * k, 0));
    }
  }
  const iris = irisPx.length ? median(irisPx.filter((p) => lum(p) > 18)) : ([90, 60, 40] as RGB);

  // Pelo: una franja por encima de la frente; lo que no se parece a la piel cuenta como pelo.
  const [tx, ty] = at(10);
  const hairPx: RGB[] = [];
  let total = 0;
  for (let k = 0; k < 40; k++) {
    const x = tx + ((k % 8) / 7 - 0.5) * faceW * 0.6;
    const y = ty - faceH * (0.04 + Math.floor(k / 8) * 0.03);
    if (y < 0) continue;
    total++;
    const p = sample(x, y, 1);
    const m = median(p);
    if (dist(m, skin) > 45) hairPx.push(m);
  }
  const hairAmount = total ? hairPx.length / total : 0.5;
  const hair = hairPx.length >= 6 ? median(hairPx) : null;

  // Pelo largo: color de pelo a los lados de la cara, de los pómulos a la mandíbula.
  let longHair = false;
  if (hair) {
    let hits = 0;
    for (const [edge, side] of [[234, -1], [454, 1]] as const) {
      const [ex] = at(edge);
      for (const lev of [172, 136, 150]) {
        const [, y] = at(lev);
        const m = median(sample(ex + side * faceW * 0.08, y, r));
        if (dist(m, hair) < 90 && dist(m, skin) > 35) hits++;
      }
    }
    longHair = hits >= 4;
  }

  // Barba y bigote: distinto de la piel de las mejillas y más cerca del pelo (o más oscuro).
  const chin = median([...sample(...at(199), r), ...sample(...at(208), r), ...sample(...at(428), r)]);
  const lipTop = median(sample(...at(164), r * 0.8));
  const hairRef = hair ?? ([30, 24, 20] as RGB);
  const hairy = (p: RGB) => dist(p, skin) > 38 && dist(p, hairRef) < dist(p, skin);
  const beard: "full" | "moustache" | null = hairy(chin) ? "full" : hairy(lipTop) ? "moustache" : null;

  return { skin: hex(skin), iris: hex(iris), hair: hair ? hex(hair) : null, hairAmount, longHair, beard };
}

const lum = (p: RGB) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function median(px: RGB[]): RGB {
  if (!px.length) return [128, 128, 128];
  const ch = (k: 0 | 1 | 2) => px.map((p) => p[k]).sort((a, b) => a - b)[Math.floor(px.length / 2)]!;
  return [ch(0), ch(1), ch(2)];
}
const hex = (p: RGB) => "#" + p.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function rgb(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** El color más cercano (distancia en un espacio con más peso para la luminosidad). */
function nearest<T extends { id: string; color: string }>(target: string, list: T[]): T | undefined {
  const a = rgb(target);
  let best: T | undefined, bd = Infinity;
  for (const c of list) {
    const b = rgb(c.color);
    const dl = lum(a) - lum(b);
    const dd = dl * dl * 2 + (a[0] - b[0]) ** 2 * 0.3 + (a[1] - b[1]) ** 2 * 0.3 + (a[2] - b[2]) ** 2 * 0.3;
    if (dd < bd) {
      bd = dd;
      best = c;
    }
  }
  return best;
}
