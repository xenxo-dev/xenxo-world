/**
 * El aire de las ciudades de decorado (la megaciudad del nexo y la de alrededor de cada distrito):
 * un reloj, el ambiente y la bruma, compartidos por todos sus shaders. Sin React ni escena.
 *
 * Alrededor de un distrito la bruma es de un color y se espesa con la distancia. En el nexo, que
 * flota sobre una ciudad que llega al horizonte, hace falta más:
 *  - su tono es el del cielo en el horizonte **en esa dirección** (`uRing`: una vuelta entera, medida
 *    en la foto del cielo de día o calculada para el de noche), así una torre lejana se pierde en el
 *    mismo color que tiene el cielo detrás de ella y no se nota dónde acaba la ciudad;
 *  - es más espesa abajo que arriba (`uFall`) y, pegada a las calles, a 110 m bajo la plataforma,
 *    hay una capa de niebla que brilla (`uMist`: clara de día; de noche, con la luz de la ciudad):
 *    las torres salen de ella con las coronas limpias, y las calles se ven a su través;
 *  - sus colores son «como se ven» (display.ts): iguales con y sin post-proceso, y a juego con la
 *    foto del cielo, que tampoco pasa por el mapeo de tonos.
 */
import * as THREE from "three";
import { DISPLAY_GLSL } from "./display";
import type { Ambience } from "./graphics";
import skyDay from "./sky-day.json";

/** Generador con semilla: la misma ciudad para todos. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NEON = ["#36d9ff", "#ff4fd8", "#a26bff", "#ff4f8b", "#4fa3ff", "#6dffd8"];

/** Hacia dónde está el sol de día: donde lo tiene la foto del cielo (sky-day.json). */
export const SUN = (() => {
  const theta = (skyDay.sunU - 0.5) * Math.PI * 2;
  const elev = (skyDay.sunElevationDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(theta) * Math.cos(elev), Math.sin(elev), Math.sin(theta) * Math.cos(elev));
})();

/* ------------------------------------------------------------------ */
/* El tono del horizonte, alrededor                                    */
/* ------------------------------------------------------------------ */

const COLS = 64;
const ringData = new Uint8Array(COLS * 4).fill(255);
/** Una fila: el color del cielo en el horizonte en cada dirección (la u de la foto del cielo). */
const ring = new THREE.DataTexture(ringData, COLS, 1, THREE.RGBAFormat);
ring.colorSpace = THREE.SRGBColorSpace;
ring.wrapS = THREE.RepeatWrapping;
ring.magFilter = THREE.LinearFilter;
ring.minFilter = THREE.LinearFilter;

const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
blank.colorSpace = THREE.SRGBColorSpace;
blank.needsUpdate = true;

/** El color de cada dirección (sRGB, 0–255), dado por una función de la vuelta (0–1). */
function fillRing(tone: (u: number) => readonly [number, number, number]) {
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < COLS; i++) {
    const c = tone((i + 0.5) / COLS);
    ringData.set([c[0], c[1], c[2], 255], i * 4);
    r += c[0];
    g += c[1];
    b += c[2];
  }
  ring.needsUpdate = true;
  air.uHaze.value.setRGB(r / COLS / 255, g / COLS / 255, b / COLS / 255, THREE.SRGBColorSpace);
}

/**
 * Mide el horizonte de la foto del cielo (de 1° a 7° de altura) en cada dirección. Un lienzo
 * pequeño, una vez por imagen. Si el navegador no deja leerla, se queda el tono que hubiera.
 */
function measureRing(image: CanvasImageSource): boolean {
  try {
    const H = 90;
    const canvas = document.createElement("canvas");
    canvas.width = COLS;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(image, 0, 0, COLS, H);
    const px = ctx.getImageData(0, 0, COLS, H).data;
    const row: [number, number, number][] = [];
    for (let x = 0; x < COLS; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      // La fila 45 es el horizonte; cada fila, 2°.
      for (let y = 41; y <= 44; y++) {
        const k = (y * COLS + x) * 4;
        r += px[k]!;
        g += px[k + 1]!;
        b += px[k + 2]!;
        n++;
      }
      row.push([r / n, g / n, b / n]);
    }
    // Un leve desenfoque alrededor: sin saltos de una dirección a la de al lado.
    fillRing((u) => {
      const x = Math.floor(u * COLS);
      const out: [number, number, number] = [0, 0, 0];
      for (let k = -2; k <= 2; k++) {
        const c = row[(((x + k) % COLS) + COLS) % COLS]!;
        out[0] += c[0] / 5;
        out[1] += c[1] / 5;
        out[2] += c[2] / 5;
      }
      return out;
    });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Uniformes compartidos                                                */
/* ------------------------------------------------------------------ */

export const air = {
  uTime: { value: 0 },
  uNight: { value: 1 },
  /** El tono de la bruma (en el nexo, la media de `uRing`). */
  uHaze: { value: new THREE.Color("#120d26") },
  /** Espesor a la altura de la cámara (por metro). */
  uDensity: { value: 0.0042 },
  /** Cuánto se espesa hacia abajo (por metro; 0 = igual a cualquier altura). */
  uFall: { value: 0 },
  /** A qué distancia ya no se ve nada, solo aire (m; 0 = sin tope: lo dice el espesor). */
  uEnd: { value: 0 },
  /** 1 en el nexo: el tono por dirección y los colores «como se ven». */
  uNexo: { value: 0 },
  uRing: { value: ring },
  /** Lo que la bruma de más abajo tiene de más (de noche, la luz de las calles). */
  uUnder: { value: new THREE.Color(0, 0, 0) },
  /** La niebla baja del nexo: espesor a ras de calle (por metro), su suelo y su color. */
  uMist: { value: 0 },
  uMistFloor: { value: -110 },
  uMistTone: { value: new THREE.Color(0, 0, 0) },
  uSunDir: { value: SUN.clone() },
  /** La foto del cielo de día (para lo que la refleja) y si la hay. */
  uSky: { value: blank as THREE.Texture },
  uSkyOn: { value: 0 },
  /** El cielo sin foto: lo alto (el horizonte sale de `uRing`). */
  uZenith: { value: new THREE.Color("#04060f") },
};

/** El cielo del nexo de noche: lo alto, y el resplandor de la ciudad en el horizonte, alrededor. */
export const NEXO_NIGHT = {
  zenith: "#060a1e",
  /** Dos tonos que se alternan alrededor: violeta y azul. */
  glow: [
    [88, 50, 140],
    [38, 76, 150],
  ],
} as const;

/** El resplandor del horizonte de noche en una dirección (0–1 alrededor). */
function nightGlow(u: number): [number, number, number] {
  const k = 0.5 + 0.5 * Math.sin(u * Math.PI * 4 + 1.1);
  const [a, b] = NEXO_NIGHT.glow;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** El cielo de día sin foto (mientras carga): el horizonte del cielo de siempre (Sky.tsx). */
const DAY_HORIZON = "#dfe6ee";

/**
 * Pone el aire de un lugar. `nexo`: el de la megaciudad (ver arriba); si no, el de alrededor de un
 * distrito. `sky`: la foto del cielo de día, cuando ya ha llegado.
 */
export function setAir(nexo: boolean, ambience: Ambience, sky: THREE.Texture | null = null) {
  const night = ambience === "night";
  air.uNight.value = night ? 1 : 0;
  air.uNexo.value = nexo ? 1 : 0;
  air.uSunDir.value.copy(SUN);
  if (!nexo) {
    air.uHaze.value.set(night ? "#120d26" : "#bcd0e2");
    air.uDensity.value = night ? 0.0042 : 0.0017;
    air.uFall.value = 0;
    air.uEnd.value = 0;
    air.uMist.value = 0;
    air.uUnder.value.setRGB(0, 0, 0);
    air.uSky.value = blank;
    air.uSkyOn.value = 0;
    return;
  }
  air.uDensity.value = night ? 0.00022 : 0.00026;
  air.uFall.value = night ? 0.005 : 0.0055;
  air.uEnd.value = 2350;
  air.uMist.value = night ? 0.005 : 0.0056;
  if (night) air.uMistTone.value.setRGB(0.13, 0.085, 0.27);
  else air.uMistTone.value.setRGB(0.72, 0.82, 0.95);
  air.uZenith.value.set(night ? NEXO_NIGHT.zenith : "#4f86cf");
  if (night) {
    fillRing(nightGlow);
    air.uUnder.value.setRGB(0.02, 0.012, 0.035);
  } else {
    const flat = hex(DAY_HORIZON);
    if (!sky || !measureRing(sky.image as CanvasImageSource)) fillRing(() => flat);
    air.uUnder.value.setRGB(0, 0, 0);
  }
  air.uSky.value = !night && sky ? sky : blank;
  air.uSkyOn.value = !night && sky ? 1 : 0;
}

/** Avanza el reloj (con un tope: al volver de otra pestaña los coches no dan un salto enorme). */
export function tickAir(dt: number) {
  air.uTime.value = (air.uTime.value + Math.min(dt, 0.1)) % 3600;
}

/* ------------------------------------------------------------------ */
/* GLSL                                                                 */
/* ------------------------------------------------------------------ */

export const AIR_GLSL = /* glsl */ `
  ${DISPLAY_GLSL}
  uniform vec3 uHaze; uniform float uDensity; uniform float uNight;
  uniform float uNexo; uniform float uFall; uniform float uEnd; uniform sampler2D uRing; uniform vec3 uUnder;
  uniform float uMist; uniform float uMistFloor; uniform vec3 uMistTone;
  // El tono del horizonte del cielo hacia un punto (la misma vuelta que la foto del cielo).
  vec3 ringTone(vec3 w) {
    vec2 d = w.xz - cameraPosition.xz;
    return texture2D(uRing, vec2(atan(d.y, d.x) * 0.15915494 + 0.5, 0.5)).rgb;
  }
  // El aire hasta un punto: su tono (rgb) y cuánto hay (a, de 0 a 1). La bruma se espesa hacia
  // abajo (uFall): la suma a lo largo del rayo de densidad · exp(-uFall · altura). En el nexo se le
  // suma la niebla baja, que se calcula igual desde su suelo, y el tono es el de las dos, cada una
  // por lo que pesa. ring: el tono del horizonte hacia ese punto (quien lo tenga ya calculado, por
  // vértice, se ahorra buscarlo en cada píxel).
  vec4 airWith(vec3 w, vec3 ring) {
    vec3 v = w - cameraPosition;
    float dist = length(v);
    float k = uFall * v.y;
    float t = abs(k) > 0.001 ? (1.0 - exp(-k)) / k : 1.0;
    float haze = dist * uDensity * exp(-uFall * cameraPosition.y) * t;
    if (uNexo < 0.5) return vec4(uHaze, 1.0 - exp(-haze));
    const float B = 0.038;
    float km = B * v.y;
    float tm = abs(km) > 0.001 ? (1.0 - exp(-km)) / km : 1.0;
    float mist = dist * uMist * exp(-B * (cameraPosition.y - uMistFloor)) * tm;
    // El color de la niebla es el suyo con algo del horizonte de esa dirección.
    vec3 tone = mix(ring, mix(ring, uMistTone, 0.7), mist / max(haze + mist, 1.0e-5)) + uUnder * smoothstep(30.0, -110.0, w.y);
    // Hacia el final de lo que se ve, todo es aire: la ciudad no se acaba en un borde.
    float far = dist / uEnd;
    far *= far;
    return vec4(tone, 1.0 - exp(-haze - mist - far * far * far * 5.0));
  }
  vec4 airTo(vec3 w) { return airWith(w, uNexo < 0.5 ? uHaze : ringTone(w)); }
  vec3 airTone(vec3 w) { return airTo(w).rgb; }
  float airAmount(vec3 w) { return airTo(w).a; }
  // Un color «como se ve», con su aire.
  vec3 airShown(vec3 shown, vec3 w) {
    vec4 a = airTo(w);
    return mix(shown, a.rgb, a.a);
  }
  // Un color de escena (con su luz, antes del mapeo de tonos), con su aire. En el nexo se pasa
  // antes a «como se ve» (el tono del aire lo es). mapped: ya viene con el mapeo de tonos hecho
  // (los materiales de three, como los coches voladores).
  vec3 hazeOf(vec3 col, vec3 w, bool mapped) {
    if (uNexo > 0.5) {
      #ifdef TONE_MAPPING
        if (!mapped) col = toneMapping(col);
      #else
        // Con post-proceso ningún material trae el mapeo hecho (se pasa al final): aquí, a mano.
        if (xenxoLinearOut()) col = xenxoAces(col);
      #endif
    }
    return airShown(col, w);
  }
  vec3 haze(vec3 col, vec3 w) { return hazeOf(col, w, false); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

/**
 * El final de un shader de ciudad: alrededor de los distritos, con el mapeo de tonos como el resto
 * de la escena; en el nexo el color ya es el que se tiene que ver, y con post-proceso se deja de
 * forma que el mapeo del final lo devuelva igual (display.ts).
 */
export const OUT_GLSL = /* glsl */ `
  #ifdef TONE_MAPPING
    if (uNexo < 0.5) gl_FragColor.rgb = toneMapping(gl_FragColor.rgb);
  #else
    if (uNexo > 0.5) gl_FragColor.rgb = xenxoShown(gl_FragColor.rgb);
  #endif
  #include <colorspace_fragment>
`;
