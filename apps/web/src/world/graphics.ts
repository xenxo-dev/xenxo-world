/**
 * Calidad gráfica según el equipo del visitante.
 *
 * El servidor no dibuja nada: manda el mismo mundo a todos y cada equipo lo pinta
 * con lo que puede. Aquí se decide el nivel (detección + preferencia) y se baja
 * solo si los FPS no aguantan. La VR siempre va en el nivel ligero.
 */
import { useSyncExternalStore } from "react";
import { loadPref, savePref } from "../config";

export type Tier = "low" | "medium" | "high" | "ultra";
export type QualityPref = "auto" | Tier;
export type Ambience = "day" | "night";
export type AmbiencePref = "auto" | Ambience;

export const TIERS: Tier[] = ["low", "medium", "high", "ultra"];

/** Qué hace cada nivel. Una sola tabla: si algo cambia, cambia aquí. */
export interface Features {
  dpr: [number, number];
  /** MSAA del propio canvas (solo cuando no hay post-proceso). */
  antialias: boolean;
  /** Materiales PBR (brillo, metal, reflejos). Si no, Lambert. */
  pbr: boolean;
  /** Post-proceso: resplandor de neones, SMAA, tono. */
  post: boolean;
  bloom: boolean;
  ao: boolean;
  shadows: 0 | 1024 | 2048;
  /** Resolución de la sonda de reflejos de la propia plaza (0 = sin sonda). */
  probe: 0 | 128 | 256;
  /** Luces puntuales de farolas y neones (light@1). */
  pointLights: boolean;
  /** Sin luces puntuales: charco de luz pintado en el suelo bajo cada light@1 (de noche). */
  lightPools: boolean;
  /** Edificios del horizonte. */
  skyline: number;
  /** Nivel de detalle de los modelos: el más detallado o el más ligero. */
  lod: "detailed" | "light";
  /** Texturas de la biblioteca de materiales (px; 0 = solo color y oclusión). */
  textures: 0 | 512 | 1024;
  /** Mapas de normales y rugosidad de la biblioteca (relieve y brillo reales). */
  normalMaps: boolean;
  /**
   * Luz de relleno que sigue a la cámara (una direccional sin sombras): separa a los personajes
   * oscuros del suelo oscuro de noche. Barata: en todos los niveles.
   */
  avatarFill: boolean;
  /**
   * Densidad de la megaciudad 3D del nexo (manzanas, megatorres y coches; 0 = sin ella). Todo va
   * instanciado y se mueve en el shader: en la Quest cabe la de «medium».
   */
  nexoCity: number;
  /** Gente que camina por las ciudades de los distritos (personajes de serie; 0 = nadie). */
  pedestrians: number;
  /** Coches voladores y drones por las calles de las ciudades de los distritos (instanciados). */
  traffic: number;
}

export const FEATURES: Record<Tier, Features> = {
  low: { dpr: [0.75, 1], antialias: false, pbr: false, post: false, bloom: false, ao: false, shadows: 0, probe: 0, pointLights: false, lightPools: true, skyline: 48, lod: "light", textures: 512, normalMaps: false, avatarFill: true, nexoCity: 0.5, pedestrians: 4, traffic: 8 },
  medium: { dpr: [1, 1.5], antialias: true, pbr: true, post: true, bloom: true, ao: false, shadows: 0, probe: 0, pointLights: false, lightPools: true, skyline: 96, lod: "light", textures: 512, normalMaps: true, avatarFill: true, nexoCity: 0.75, pedestrians: 8, traffic: 14 },
  high: { dpr: [1, 2], antialias: false, pbr: true, post: true, bloom: true, ao: false, shadows: 1024, probe: 128, pointLights: true, lightPools: false, skyline: 150, lod: "detailed", textures: 1024, normalMaps: true, avatarFill: true, nexoCity: 1, pedestrians: 14, traffic: 22 },
  ultra: { dpr: [1, 2], antialias: false, pbr: true, post: true, bloom: true, ao: true, shadows: 2048, probe: 256, pointLights: true, lightPools: false, skyline: 220, lod: "detailed", textures: 1024, normalMaps: true, avatarFill: true, nexoCity: 1, pedestrians: 20, traffic: 30 },
};

/* ------------------------------------------------------------------ */
/* Detección                                                            */
/* ------------------------------------------------------------------ */

export interface GpuInfo {
  renderer: string;
  memory: number;
  cores: number;
  tier: Tier;
  /** Motivo, como código (el texto lo pone el panel en su idioma). */
  reason: "vr" | "vr_strong" | "mobile" | "mobile_strong" | "nowebgl" | "software" | "integrated" | "dedicated_strong" | "dedicated" | "unknown";
  /** Gafas o pantalla táctil: sin efectos de pantalla completa ni sombras (ver `portable`). */
  portable: boolean;
}

let detected: GpuInfo | null = null;

/** Lee la GPU con un contexto WebGL de usar y tirar. No sale nada del navegador. */
export function detectGpu(): GpuInfo {
  if (detected) return detected;
  const ua = navigator.userAgent;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  let renderer = "";
  try {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    /* sin WebGL: se queda en ligero */
  }

  const vr = /OculusBrowser|Quest|Pico|Wolvic|VisionOS/i.test(ua);
  const touch = matchMedia("(pointer: coarse)").matches;
  const pick = (tier: Tier, reason: GpuInfo["reason"]): GpuInfo => (detected = { renderer, memory, cores, tier, reason, portable: vr || touch });
  // Gafas: Quest 3/3S/Pro y Vision Pro mueven materiales reales; Quest 2, Pico y el resto, el nivel ligero.
  if (vr) return /Quest 3|Quest Pro|VisionOS/i.test(ua) ? pick("medium", "vr_strong") : pick("low", "vr");
  if (touch) return strongMobileGpu(renderer, memory) ? pick("medium", "mobile_strong") : pick("low", "mobile");
  if (!renderer) return pick("low", "nowebgl");
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(renderer)) return pick("low", "software");
  if (/intel|uhd|iris|mali|adreno|powervr|vivante/i.test(renderer)) return pick(memory >= 8 ? "medium" : "low", "integrated");
  if (/rtx|radeon rx [6-9]\d{3}|rx [6-9]\d{3}|apple m[2-9]|arc a[57]/i.test(renderer)) {
    return pick(memory >= 8 && cores >= 8 ? "ultra" : "high", "dedicated_strong");
  }
  if (/nvidia|geforce|radeon|amd|apple/i.test(renderer)) return pick("high", "dedicated");
  return pick("medium", "unknown");
}

/** Móviles de gama media-alta de los últimos años (iPhone, Adreno 660+, Mali-G7x/G6xx, Immortalis, Xclipse). */
function strongMobileGpu(renderer: string, memory: number): boolean {
  if (memory < 4) return false;
  if (/apple gpu/i.test(renderer)) return true;
  const adreno = /adreno[^\d]*(\d{3})/i.exec(renderer);
  if (adreno) return Number(adreno[1]) >= 660;
  if (/immortalis|xclipse|mali-g7\d|mali-g6[1-9]\d|mali-g71\d/i.test(renderer)) return true;
  return false;
}

/**
 * Gafas y móviles: aunque el nivel sea «medio», nada de efectos de pantalla completa,
 * sombras, sondas de reflejo ni luces puntuales (lo que más caro sale en esas GPU).
 * Los neones brillan igual gracias al halo de sus materiales (no necesita bloom).
 */
function portableClamp(f: Features, xr: boolean): Features {
  return {
    ...f,
    dpr: [Math.min(f.dpr[0], 1), Math.min(f.dpr[1], xr ? 1 : 1.75)],
    post: false,
    bloom: false,
    ao: false,
    shadows: 0,
    probe: 0,
    pointLights: false,
    lightPools: true,
    skyline: Math.min(f.skyline, 96),
    nexoCity: Math.min(f.nexoCity, 0.75),
    pedestrians: Math.min(f.pedestrians, xr ? 4 : 6),
    traffic: Math.min(f.traffic, 14),
    lod: f.lod,
  };
}

/* ------------------------------------------------------------------ */
/* Estado: preferencia, nivel efectivo y ambiente                       */
/* ------------------------------------------------------------------ */

function migratePref(raw: string): QualityPref {
  if (raw === "auto" || TIERS.includes(raw as Tier)) return raw as QualityPref;
  return "auto"; // valores antiguos ("high"/"low" de v0.3) o rotos
}

class GraphicsStore {
  pref: QualityPref = migratePref(loadPref<string>("quality", "auto"));
  ambiencePref: AmbiencePref = loadPref<AmbiencePref>("ambience", "auto");
  /** Bajadas automáticas aplicadas por el monitor de rendimiento. */
  private declines = 0;
  /** La VR fuerza el nivel ligero mientras dura la sesión. */
  inXR = false;
  private version = 0;
  private listeners = new Set<() => void>();
  private clock: ReturnType<typeof setInterval> | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    this.clock ??= setInterval(() => this.bump(), 60_000); // el ambiente «auto» sigue la hora
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private bump() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  get tier(): Tier {
    const gpu = detectGpu();
    let t: Tier;
    if (this.pref !== "auto") t = this.pref;
    else t = TIERS[Math.max(0, TIERS.indexOf(gpu.tier) - this.declines)]!;
    // En VR, como mucho «medio» (y solo si las gafas lo aguantan).
    if (this.inXR) t = TIERS[Math.min(TIERS.indexOf(t), TIERS.indexOf(gpu.tier === "low" ? "low" : "medium"))]!;
    return t;
  }

  get features(): Features {
    const f = FEATURES[this.tier];
    return detectGpu().portable || this.inXR ? portableClamp(f, this.inXR) : f;
  }

  get ambience(): Ambience {
    if (this.ambiencePref !== "auto") return this.ambiencePref;
    const h = new Date().getHours();
    return h >= 20 || h < 7 ? "night" : "day";
  }

  setPref(p: QualityPref) {
    this.pref = p;
    this.declines = 0;
    savePref("quality", p);
    this.bump();
  }

  setAmbience(a: AmbiencePref) {
    this.ambiencePref = a;
    savePref("ambience", a);
    this.bump();
  }

  /** El monitor detecta FPS bajos: un escalón menos (solo en automático). */
  decline() {
    if (this.pref !== "auto" || this.tier === "low") return;
    this.declines++;
    console.info(`[xenxo] gráficos: bajando a «${this.tier}» para mantener la fluidez`);
    this.bump();
  }

  setXR(on: boolean) {
    if (this.inXR === on) return;
    this.inXR = on;
    this.bump();
  }
}

export const graphics = new GraphicsStore();

export function useGraphics() {
  useSyncExternalStore(graphics.subscribe, graphics.getVersion);
  return graphics;
}
