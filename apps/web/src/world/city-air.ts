/**
 * El aire de las ciudades de decorado (la megaciudad del nexo y la de alrededor de cada distrito):
 * un reloj, el ambiente y la bruma, compartidos por todos sus shaders. Sin React ni escena.
 *
 * Las dos son ciudades que llegan al horizonte, y su aire es el mismo:
 *  - su tono es el del cielo en el horizonte **en esa dirección** (`uRing`: una vuelta entera, medida
 *    en la foto del cielo de día o calculada para el cielo que se esté pintando), así una torre
 *    lejana se pierde en el mismo color que tiene el cielo detrás de ella y no se nota dónde acaba
 *    la ciudad;
 *  - es más espesa abajo que arriba (`uFall`) y hacia el final de lo que se ve (`uEnd`) todo es aire;
 *  - sus colores son «como se ven» (display.ts): iguales con y sin post-proceso, y a juego con la
 *    foto del cielo, que tampoco pasa por el mapeo de tonos.
 * En el nexo, que flota a 110 m sobre sus calles, hay además una capa de niebla pegada a ellas que
 * brilla (`uMist`: clara de día; de noche, con la luz de la ciudad): las torres salen de ella con
 * las coronas limpias, y las calles se ven a su través.
 */
import * as THREE from "three";
import { DISPLAY_GLSL } from "./display";
import type { Ambience } from "./graphics";
import { SKY } from "./Sky";
import skyDay from "./sky-day.json";

/** Hasta dónde ve la cámara (`far`) y dónde ya todo es aire (`end`), en el nexo y en un distrito (m). */
export const NEXO_VIEW = { far: 2600, end: 2350, floor: -110 } as const;
export const DISTRICT_VIEW = { far: 1500, end: 1350, floor: -0.12 } as const;

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

type Tone = (u: number) => readonly [number, number, number];
const measured = new WeakMap<object, Tone | null>();

/**
 * El horizonte de la foto del cielo (de 1° a 7° de altura) en cada dirección. Un lienzo pequeño,
 * una vez por imagen. null si el navegador no deja leerla.
 */
function photoHorizon(image: CanvasImageSource): Tone | null {
  const known = measured.get(image as object);
  if (known !== undefined) return known;
  let tone: Tone | null = null;
  try {
    const H = 90;
    const canvas = document.createElement("canvas");
    canvas.width = COLS;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
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
      tone = (u) => {
        const x = Math.floor(u * COLS);
        const out: [number, number, number] = [0, 0, 0];
        for (let k = -2; k <= 2; k++) {
          const c = row[(((x + k) % COLS) + COLS) % COLS]!;
          out[0] += c[0] / 5;
          out[1] += c[1] / 5;
          out[2] += c[2] / 5;
        }
        return out;
      };
    }
  } catch {
    tone = null;
  }
  measured.set(image as object, tone);
  return tone;
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
  /**
   * 1 en el nexo. Allí los coches de luz, que se ven desde arriba y entre torres, son otros; y el
   * aire se mezcla con la luz (alrededor de un distrito, como la bruma de la escena: ver `airMix`).
   */
  uNexo: { value: 0 },
  uRing: { value: ring },
  /** Lo que la bruma de más abajo tiene de más (de noche, la luz de las calles). */
  uUnder: { value: new THREE.Color(0, 0, 0) },
  /** El suelo de la ciudad (m; el del lugar está en 0). */
  uFloor: { value: -110 },
  /** La niebla baja del nexo: espesor a ras de calle (por metro) y su color. */
  uMist: { value: 0 },
  uMistTone: { value: new THREE.Color(0, 0, 0) },
  uSunDir: { value: SUN.clone() },
  /** La foto del cielo de día (para lo que la refleja) y si la hay. */
  uSky: { value: blank as THREE.Texture },
  uSkyOn: { value: 0 },
  /** El cielo sin foto: lo alto (el horizonte sale de `uRing`). */
  uZenith: { value: new THREE.Color("#04060f") },
  /**
   * Lo que el cristal refleja del cielo sin foto: cuánto del resplandor del horizonte (`uMirror`) y
   * con qué rapidez se apaga hacia arriba (`uGlowK`; 0 = como el cielo del nexo o el de día).
   */
  uMirror: { value: 1 },
  uGlowK: { value: 0 },
  /** Hasta qué altura sobre la calle se nota que entre torres llega menos cielo (m). */
  uDeep: { value: 170 },
  /** La luz de las calles, de noche: la que sube por las fachadas. */
  uStreet: { value: new THREE.Color(0.1, 0.066, 0.045) },
  /** Cuánto neón y cuántas pantallas de más llevan las torres (0 = lo del nexo). */
  uNeon: { value: 0 },
  uScreen: { value: 0 },
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

/** El mapeo de tonos de Three.js (ACES, exposición 1): el de `xenxoAces` (display.ts), aquí. */
function aces(c: readonly [number, number, number]): [number, number, number] {
  const r = c[0] / 0.6, g = c[1] / 0.6, b = c[2] / 0.6;
  const v = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.076 * r + 0.90834 * g + 0.01566 * b, 0.0284 * r + 0.13383 * g + 0.83777 * b];
  const q = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081)) as [number, number, number];
  const o = [1.60475 * q[0] - 0.53108 * q[1] - 0.07367 * q[2], -0.10208 * q[0] + 1.10813 * q[1] - 0.00605 * q[2], -0.00327 * q[0] - 0.07276 * q[1] + 1.07602 * q[2]];
  return o.map((x) => Math.min(1, Math.max(0, x))) as [number, number, number];
}
const toSRGB = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/**
 * El cielo sin foto (el degradado de Sky.tsx) a la altura `y` (el seno), como llega a la pantalla
 * (sRGB, 0–255). Su shader escribe sus números tal cual: sin post-proceso son ya los de la pantalla;
 * con él van a un búfer lineal y pasan por el mapeo de tonos del final.
 */
function gradientShown(ambience: Ambience, y: number, post: boolean): [number, number, number] {
  const k = SKY[ambience];
  const h = new THREE.Color(k.horizon), t = new THREE.Color(k.top);
  const m = Math.pow(Math.max(y, 0), 0.55);
  const glow = ambience === "night" ? Math.exp(-Math.abs(y) * 9) * 0.35 : 0;
  const raw: [number, number, number] = [h.r + (t.r - h.r) * m + 0.55 * glow, h.g + (t.g - h.g) * m + 0.12 * glow, h.b + (t.b - h.b) * m + 0.45 * glow];
  const out = post ? aces(raw).map(toSRGB) : raw;
  return out.map((x) => Math.min(255, Math.max(0, x * 255))) as [number, number, number];
}

/** Su horizonte: la media de 1° a 7° de altura, como se mide en la foto. */
function gradientHorizon(ambience: Ambience, post: boolean): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let deg = 1; deg <= 7; deg += 2) {
    const c = gradientShown(ambience, Math.sin((deg * Math.PI) / 180), post);
    for (let i = 0; i < 3; i++) out[i]! += c[i]! / 4;
  }
  return out;
}

/** Lo que cada distrito le pide al aire y a la luz de su ciudad de alrededor. */
export interface AirLook {
  /** Por cuánto se multiplica el espesor de la bruma (1 = el de siempre). */
  thick?: number;
  /** La luz de sus calles de noche (la que sube por las fachadas): sodio, neón… */
  street?: readonly [number, number, number];
  /** Cuánto neón (coronaciones encendidas) y cuántas pantallas de más llevan sus torres (de 0 a 1). */
  neon?: number;
  screens?: number;
}

const STREET_LIGHT = [0.1, 0.066, 0.045] as const;

/** El espesor del aire de alrededor de un distrito, a ras de suelo (por metro). */
const districtDensity = (ambience: Ambience, look: AirLook) => (ambience === "night" ? 0.0013 : 0.0011) * (look.thick ?? 1);

/** El horizonte del cielo de un distrito, alrededor: el de la foto de nubes o el del degradado. */
function districtHorizon(ambience: Ambience, sky: THREE.Texture | null, post: boolean): Tone {
  const photo = ambience === "day" && sky ? photoHorizon(sky.image as CanvasImageSource) : null;
  if (photo) return photo;
  const flat = gradientHorizon(ambience, post);
  return () => flat;
}

/** Lo que hay que pintar en el búfer del post-proceso para que se vea ese color: `xenxoShown` (display.ts), aquí. */
function shownInBuffer(c: readonly [number, number, number]): [number, number, number] {
  let [r, g, b] = c;
  const peak = Math.max(r, g, b);
  if (peak > 0.6) {
    const k = (0.6 + 0.16 * (1 - Math.exp(-(peak - 0.6) / 0.16))) / peak;
    r *= k;
    g *= k;
    b *= k;
  }
  const y = [0.64304 * r + 0.31119 * g + 0.04578 * b, 0.05927 * r + 0.93144 * g + 0.00929 * b, 0.00596 * r + 0.06393 * g + 0.93012 * b].map((x) => Math.min(0.99, Math.max(0, x)));
  const v = y.map((x) => {
    const A = 1 - 0.983729 * x, B = 0.0245786 - 0.432951 * x, K = -(0.000090537 + 0.238081 * x);
    return (-B + Math.sqrt(Math.max(B * B - 4 * A * K, 0))) / (2 * A);
  }) as [number, number, number];
  const o = [1.76474 * v[0] - 0.67578 * v[1] - 0.08896 * v[2], -0.14703 * v[0] + 1.16025 * v[1] - 0.01322 * v[2], -0.03634 * v[0] - 0.16244 * v[1] + 1.19877 * v[2]];
  return o.map((x) => Math.min(1, Math.max(0, x) * 0.6)) as [number, number, number];
}

/**
 * La bruma de la escena en un distrito (la de los materiales de Three.js: lo de dentro del lugar):
 * el mismo aire que el de su ciudad de alrededor, o lo del fondo del distrito saldría más velado, o
 * menos, que las torres que tiene detrás. Su color es el tono medio del horizonte, y su espesor, el
 * del aire a ras de suelo. Se devuelve como los argumentos de `THREE.Fog`: con el primero negativo,
 * la bruma es exponencial y ese es su espesor (display.ts, `patchFog`).
 */
export function districtFog(ambience: Ambience, sky: THREE.Texture | null, post: boolean, look: AirLook = {}): [THREE.Color, number, number] {
  const tone = districtHorizon(ambience, sky, post);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < COLS; i++) {
    const c = tone((i + 0.5) / COLS);
    r += c[0] / COLS / 255;
    g += c[1] / COLS / 255;
    b += c[2] / COLS / 255;
  }
  const color = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  // Con post-proceso la bruma se pinta en su búfer y pasa después por el mapeo de tonos.
  if (post) color.setRGB(...shownInBuffer([color.r, color.g, color.b]));
  return [color, -districtDensity(ambience, look), 1];
}

/**
 * Pone el aire de un lugar: el de la megaciudad del nexo (`nexo`) o el de alrededor de un distrito.
 * `sky`: la foto del cielo de día, cuando ya ha llegado (si no la hay, el cielo es el degradado de
 * Sky.tsx). `post`: se pinta con post-proceso (el degradado llega a la pantalla con otros colores).
 */
export function setAir(nexo: boolean, ambience: Ambience, sky: THREE.Texture | null = null, post = false, look: AirLook = {}) {
  const night = ambience === "night";
  air.uNight.value = night ? 1 : 0;
  air.uNexo.value = nexo ? 1 : 0;
  air.uSunDir.value.copy(SUN);
  air.uSky.value = !night && sky ? sky : blank;
  air.uSkyOn.value = !night && sky ? 1 : 0;
  air.uMirror.value = 1;
  air.uGlowK.value = 0;
  air.uDeep.value = nexo ? 170 : 70;
  air.uStreet.value.setRGB(...((!nexo && look.street) || STREET_LIGHT));
  air.uNeon.value = nexo ? 0 : (look.neon ?? 0);
  air.uScreen.value = nexo ? 0 : (look.screens ?? 0);
  if (!nexo) {
    air.uDensity.value = districtDensity(ambience, look);
    air.uFall.value = 0.004;
    air.uEnd.value = DISTRICT_VIEW.end;
    air.uFloor.value = DISTRICT_VIEW.floor;
    air.uMist.value = 0;
    air.uUnder.value.setRGB(0, 0, 0);
    // El cielo de alrededor de un distrito: la foto de nubes o el degradado.
    const top = gradientShown(ambience, 1, post);
    if (!night && sky) air.uZenith.value.set("#4f86cf");
    else air.uZenith.value.setRGB(top[0] / 255, top[1] / 255, top[2] / 255, THREE.SRGBColorSpace);
    fillRing(districtHorizon(ambience, sky, post));
    if (night) {
      // De noche el degradado solo brilla pegado al horizonte, y con post-proceso llega muy claro a
      // la pantalla: el cristal lo refleja así de bajo y sin pasarse (una torre es oscura, con sus
      // ventanas y sus neones; no un espejo morado).
      const h = air.uHaze.value;
      air.uGlowK.value = 9;
      air.uMirror.value = Math.min(1, 0.02 / Math.max(1e-4, 0.2126 * h.r + 0.7152 * h.g + 0.0722 * h.b));
    }
    return;
  }
  air.uDensity.value = night ? 0.00022 : 0.00026;
  air.uFall.value = night ? 0.005 : 0.0055;
  air.uEnd.value = NEXO_VIEW.end;
  air.uFloor.value = NEXO_VIEW.floor;
  air.uMist.value = night ? 0.005 : 0.0056;
  if (night) air.uMistTone.value.setRGB(0.13, 0.085, 0.27);
  else air.uMistTone.value.setRGB(0.72, 0.82, 0.95);
  air.uZenith.value.set(night ? NEXO_NIGHT.zenith : "#4f86cf");
  if (night) {
    fillRing(nightGlow);
    air.uUnder.value.setRGB(0.02, 0.012, 0.035);
  } else {
    const flat = hex(DAY_HORIZON);
    fillRing((sky && photoHorizon(sky.image as CanvasImageSource)) || (() => flat));
    air.uUnder.value.setRGB(0, 0, 0);
  }
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
  uniform float uMist; uniform float uFloor; uniform vec3 uMistTone;
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
    const float B = 0.038;
    float km = B * v.y;
    float tm = abs(km) > 0.001 ? (1.0 - exp(-km)) / km : 1.0;
    float mist = dist * uMist * exp(-B * (cameraPosition.y - uFloor)) * tm;
    // El color de la niebla es el suyo con algo del horizonte de esa dirección.
    vec3 tone = mix(ring, mix(ring, uMistTone, 0.7), mist / max(haze + mist, 1.0e-5)) + uUnder * smoothstep(uFloor + 140.0, uFloor, w.y);
    // Hacia el final de lo que se ve, todo es aire: la ciudad no se acaba en un borde.
    float far = dist / uEnd;
    far *= far;
    return vec4(tone, 1.0 - exp(-haze - mist - far * far * far * 5.0));
  }
  vec4 airTo(vec3 w) { return airWith(w, ringTone(w)); }
  vec3 airTone(vec3 w) { return airTo(w).rgb; }
  float airAmount(vec3 w) { return airTo(w).a; }
  // Un color «como se ve» con el aire que le toca (el de airWith). En el nexo, donde todo lo que se
  // ve lejos es su megaciudad, se mezclan como luz. Alrededor de un distrito, como la bruma de la
  // escena, que se mezcla con los valores de la pantalla: lo de dentro del distrito la lleva, y con
  // otra cuenta la primera fila de la ciudad saldría más velada que lo que tiene delante.
  vec3 airMix(vec3 shown, vec4 a) {
    if (uNexo > 0.5) return mix(shown, a.rgb, a.a);
    return pow(mix(pow(max(shown, vec3(0.0)), vec3(0.4545)), pow(a.rgb, vec3(0.4545)), a.a), vec3(2.2));
  }
  // Un color «como se ve», con su aire.
  vec3 airShown(vec3 shown, vec3 w) { return airMix(shown, airTo(w)); }
  // Un color de escena (con su luz, antes del mapeo de tonos), con su aire: se pasa antes a «como
  // se ve» (el tono del aire lo es). mapped: ya viene con el mapeo de tonos hecho (los materiales
  // de three, como los coches voladores).
  vec3 hazeOf(vec3 col, vec3 w, bool mapped) {
    #ifdef TONE_MAPPING
      if (!mapped) col = toneMapping(col);
    #else
      // Con post-proceso ningún material trae el mapeo hecho (se pasa al final): aquí, a mano.
      if (xenxoLinearOut()) col = xenxoAces(col);
    #endif
    return airShown(col, w);
  }
  vec3 haze(vec3 col, vec3 w) { return hazeOf(col, w, false); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

/**
 * El final de un shader de ciudad: el color ya es el que se tiene que ver, y con post-proceso se
 * deja de forma que el mapeo del final lo devuelva igual (display.ts).
 */
export const OUT_GLSL = /* glsl */ `
  #ifndef TONE_MAPPING
    gl_FragColor.rgb = xenxoShown(gl_FragColor.rgb);
  #endif
  #include <colorspace_fragment>
`;
