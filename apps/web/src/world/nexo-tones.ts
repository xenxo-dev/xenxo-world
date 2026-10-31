/**
 * Los colores de la panorámica del nexo, para que la ciudad en 3D (NexoCity) y el cielo (Sky)
 * tengan los mismos que la foto y no se note dónde acaba cada cosa.
 *
 * - PANO_TONES: medidos a mano en las imágenes (el azul de arriba y el pie de la foto), para antes
 *   de que cargue y para el cielo.
 * - footTexture: al cargar la foto se mide su ciudad por debajo del horizonte columna a columna
 *   (128 franjas alrededor). La ciudad en 3D toma de ahí, según hacia dónde se mire, el tono de su
 *   bruma y de su gradación: delante de unos rascacielos violeta, violeta; delante del sol, dorado.
 */
import * as THREE from "three";
import type { Ambience } from "./graphics";

export const PANO_TONES: Record<Ambience, { top: string; foot: string }> = {
  day: { top: "#72a8de", foot: "#66748a" },
  night: { top: "#091432", foot: "#393c60" },
};

/** Fila del horizonte en cada imagen (0 arriba, 1 abajo), medida en las imágenes. */
export const HORIZON: Record<Ambience, number> = { night: 0.49, day: 0.445 };

const COLS = 128;
const data = new Uint8Array(COLS * 4);
export const footTexture = new THREE.DataTexture(data, COLS, 1, THREE.RGBAFormat);
footTexture.colorSpace = THREE.SRGBColorSpace;
footTexture.wrapS = THREE.RepeatWrapping;
footTexture.magFilter = THREE.LinearFilter;
footTexture.minFilter = THREE.LinearFilter;

/** Todo del mismo tono (antes de que cargue la foto o si no se puede leer). */
export function fillFoot(hex: string) {
  // La textura guarda sRGB (como la foto): el color tal cual, sin pasar a lineal.
  const n = parseInt(hex.slice(1), 16);
  for (let i = 0; i < COLS; i++) data.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], i * 4);
  footTexture.needsUpdate = true;
}

/**
 * Mide la ciudad de la foto (del 15 % bajo el horizonte al pie) en cada franja. Un lienzo pequeño:
 * unos milisegundos, una vez por imagen. Si el navegador no deja leerla, se queda el tono fijo.
 */
export function measureFoot(image: CanvasImageSource & { width: number; height: number }, ambience: Ambience) {
  try {
    const H = 48;
    const canvas = document.createElement("canvas");
    canvas.width = COLS;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2d");
    ctx.drawImage(image, 0, 0, COLS, H);
    const px = ctx.getImageData(0, 0, COLS, H).data;
    const y0 = Math.round((HORIZON[ambience] + 0.15) * H);
    const y1 = Math.round(0.97 * H);
    for (let x = 0; x < COLS; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        const k = (y * COLS + x) * 4;
        r += px[k]!;
        g += px[k + 1]!;
        b += px[k + 2]!;
        n++;
      }
      data.set([r / n, g / n, b / n, 255], x * 4);
    }
    // Un leve desenfoque alrededor: sin saltos de una franja a otra.
    const copy = data.slice();
    for (let x = 0; x < COLS; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) s += copy[(((x + k) % COLS) + COLS) % COLS * 4 + c]!;
        data[x * 4 + c] = s / 5;
      }
    }
    footTexture.needsUpdate = true;
  } catch {
    fillFoot(PANO_TONES[ambience].foot);
  }
}

fillFoot(PANO_TONES.night.foot);
