/**
 * Medidas de una cara a partir de los 478 puntos de MediaPipe (Face Landmarker): proporciones que no
 * dependen del tamaño de la foto ni de la inclinación de la cabeza (se endereza por la línea de los
 * ojos). Las mismas medidas se toman de las fundas neutras (calibración, tools/avatars/kit/calibrate.mjs)
 * para pasar de una foto a los ajustes de la cara.
 */
export type Pt = { x: number; y: number };

export const MEASURES = [
  "face_ratio",
  "jaw",
  "eye_width",
  "eye_gap",
  "eye_y",
  "eye_tilt",
  "nose_width",
  "nose_length",
  "mouth_width",
  "mouth_y",
  "lip_upper",
  "lip_lower",
  "chin",
  "brow_gap",
] as const;

/**
 * Ajustes de la cara que se sacan de una foto: solo los que se miden bien con los puntos de la cara
 * (comprobado ida y vuelta con fundas al azar); el resto se deja como esté.
 */
export const PHOTO_SLIDERS = [
  "head_width",
  "eye_size",
  "eye_dist",
  "mouth_width",
  "chin_height",
  "brow_height",
];

const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * `lm`: puntos normalizados (0–1) de MediaPipe; `w`, `h`: tamaño de la imagen en píxeles.
 * Devuelve las medidas en el orden de MEASURES, o null si la cara está demasiado girada.
 */
export function measureFace(lm: { x: number; y: number; z?: number }[], w: number, h: number): Float64Array | null {
  if (lm.length < 468) return null;
  // A píxeles y enderezado por los ojos.
  const raw = lm.map((p) => ({ x: p.x * w, y: p.y * h }));
  const eyeR = mid(raw[33]!, raw[133]!), eyeL = mid(raw[362]!, raw[263]!);
  const ang = Math.atan2(eyeL.y - eyeR.y, eyeL.x - eyeR.x);
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const p = raw.map((q) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c }));
  const P = (i: number) => p[i]!;
  const W = d(P(234), P(454));
  const H = Math.abs(P(152).y - P(10).y);
  if (W < 1 || H < 1) return null;
  // Giro a un lado: la nariz se va hacia una mejilla.
  const yaw = (P(1).x - (P(234).x + P(454).x) / 2) / W;
  if (Math.abs(yaw) > 0.12) return null;
  const top = P(10).y;
  const eyes = mid(mid(P(33), P(133)), mid(P(362), P(263)));
  const tiltR = Math.atan2(P(133).y - P(33).y, Math.abs(P(133).x - P(33).x));
  const tiltL = Math.atan2(P(362).y - P(263).y, Math.abs(P(362).x - P(263).x));
  const lids = (P(159).y + P(386).y) / 2;
  const brows = (P(105).y + P(334).y) / 2;
  const out = new Float64Array(MEASURES.length);
  out[0] = W / H;
  out[1] = d(P(172), P(397)) / W;
  out[2] = (d(P(33), P(133)) + d(P(362), P(263))) / 2 / W;
  out[3] = d(P(133), P(362)) / W;
  out[4] = (eyes.y - top) / H;
  out[5] = (tiltR + tiltL) / 2;
  out[6] = d(P(129), P(358)) / W;
  out[7] = Math.abs(P(2).y - P(168).y) / H;
  out[8] = d(P(61), P(291)) / W;
  out[9] = ((P(13).y + P(14).y) / 2 - P(2).y) / H;
  out[10] = Math.abs(P(13).y - P(0).y) / H;
  out[11] = Math.abs(P(17).y - P(14).y) / H;
  out[12] = Math.abs(P(152).y - P(17).y) / H;
  out[13] = (lids - brows) / H;
  return out;
}

export interface Calibration {
  measures: string[];
  sliders: string[];
  /** Por base: medidas de la funda neutra y cuánto cambia cada medida por unidad de cada ajuste. */
  bases: Record<"f" | "m", { m0: number[]; jac: number[][] }>;
}

/**
 * De las medidas de una foto a los ajustes de la cara: mínimos cuadrados con freno (que nada se
 * vaya al extremo por una medida ruidosa), cada medida pesada por su tamaño.
 */
export function solveSliders(cal: Calibration, base: "f" | "m", m: Float64Array, strength = 0.85): Record<string, number> {
  const { m0, jac } = cal.bases[base];
  const nm = cal.measures.length, ns = cal.sliders.length;
  // Error relativo: un 6 % de cada medida (los ángulos, en absoluto).
  const sig = m0.map((v, i) => (cal.measures[i] === "eye_tilt" ? 0.05 : Math.max(1e-3, Math.abs(v) * 0.06)));
  const A = Array.from({ length: ns }, () => new Float64Array(ns));
  const b = new Float64Array(ns);
  const lambda = 0.35;
  for (let i = 0; i < nm; i++) {
    const r = (m[i]! - m0[i]!) / sig[i]!;
    for (let a = 0; a < ns; a++) {
      const ja = jac[i]![a]! / sig[i]!;
      b[a] = b[a]! + ja * r;
      const row = A[a]!;
      for (let c = 0; c < ns; c++) row[c] = row[c]! + ja * (jac[i]![c]! / sig[i]!);
    }
  }
  for (let a = 0; a < ns; a++) A[a]![a] = A[a]![a]! + lambda;
  const x = gauss(A, b);
  const out: Record<string, number> = {};
  cal.sliders.forEach((s, i) => (out[s] = Math.round(Math.max(-1, Math.min(1, x[i]! * strength)) * 100) / 100));
  return out;
}

function gauss(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const p = M[col]![col]! || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / p;
      const row = M[r]!, pr = M[col]!;
      for (let k = col; k <= n; k++) row[k] = row[k]! - f * pr[k]!;
    }
  }
  return Float64Array.from(M.map((row, i) => row[n]! / (row[i]! || 1e-9)));
}
