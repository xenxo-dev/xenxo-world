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
  /** Edificios del horizonte. */
  skyline: number;
  /** Nivel de detalle de los modelos: el más detallado o el más ligero. */
  lod: "detailed" | "light";
}

export const FEATURES: Record<Tier, Features> = {
  low: { dpr: [0.75, 1], antialias: false, pbr: false, post: false, bloom: false, ao: false, shadows: 0, probe: 0, pointLights: false, skyline: 48, lod: "light" },
  medium: { dpr: [1, 1.5], antialias: true, pbr: true, post: true, bloom: true, ao: false, shadows: 0, probe: 0, pointLights: false, skyline: 96, lod: "light" },
  high: { dpr: [1, 2], antialias: false, pbr: true, post: true, bloom: true, ao: false, shadows: 1024, probe: 128, pointLights: true, skyline: 150, lod: "detailed" },
  ultra: { dpr: [1, 2], antialias: false, pbr: true, post: true, bloom: true, ao: true, shadows: 2048, probe: 256, pointLights: true, skyline: 220, lod: "detailed" },
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
  reason: "vr" | "mobile" | "nowebgl" | "software" | "integrated" | "dedicated_strong" | "dedicated" | "unknown";
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

  const pick = (tier: Tier, reason: GpuInfo["reason"]): GpuInfo => (detected = { renderer, memory, cores, tier, reason });
  if (/OculusBrowser|Quest|Pico|Wolvic|VisionOS/i.test(ua)) return pick("low", "vr");
  if (matchMedia("(pointer: coarse)").matches) return pick("low", "mobile");
  if (!renderer) return pick("low", "nowebgl");
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(renderer)) return pick("low", "software");
  if (/intel|uhd|iris|mali|adreno|powervr|vivante/i.test(renderer)) return pick(memory >= 8 ? "medium" : "low", "integrated");
  if (/rtx|radeon rx [6-9]\d{3}|rx [6-9]\d{3}|apple m[2-9]|arc a[57]/i.test(renderer)) {
    return pick(memory >= 8 && cores >= 8 ? "ultra" : "high", "dedicated_strong");
  }
  if (/nvidia|geforce|radeon|amd|apple/i.test(renderer)) return pick("high", "dedicated");
  return pick("medium", "unknown");
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
    if (this.inXR) return "low";
    if (this.pref !== "auto") return this.pref;
    const base = TIERS.indexOf(detectGpu().tier);
    return TIERS[Math.max(0, base - this.declines)]!;
  }

  get features(): Features {
    return FEATURES[this.tier];
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
