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
  /**
   * Bordes suavizados con MSAA (×4): en el post-proceso, si lo hay (si no, SMAA); sin post-proceso,
   * en el propio canvas. Si el canvas lleva MSAA lo decide el equipo, no el nivel (`canvasAA`).
   */
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
  /** Triángulos de cada coche volador del nexo (el modelo, simplificado al cargar). */
  flyerTris: number;
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
  /**
   * Ciudadanos que se dibujan a la vez en las ciudades de los distritos, los más cercanos (personajes
   * de serie con su física y su vida, city/citizens.ts; 0 = nadie). Los demás siguen su día sin dibujarse.
   */
  pedestrians: number;
  /** Coches voladores y drones por las calles de las ciudades de los distritos (instanciados). */
  traffic: number;
  /**
   * Gente de los interiores (sentada, charlando, bailando, en su sitio): cuántos se dibujan a la vez,
   * los más cercanos, y solo con el jugador dentro de su sala.
   */
  residents: number;
  /**
   * Gotas de lluvia en los lugares donde llueve (Distrito Cero; 0 = sin lluvia dibujada). Son
   * líneas que caen en el shader alrededor de la cámara. Los charcos van en todos los niveles.
   */
  rain: number;
  /**
   * Personas que caen a la vez con física de verdad (cuerpo articulado de Rapier: modo pelea y
   * atropellos). Las demás caen con la animación.
   */
  ragdolls: number;
  /**
   * Pelo con física (huesos con muelles, springs.ts): hasta qué distancia de la cámara se
   * mueven (m; la gente de decorado, la mitad; 0 = nadie). Más lejos se quedan como en reposo.
   */
  springs: number;
  /**
   * Disparos a la vez (armas de Distrito Cero, world/people/ShotFx.tsx): cuántos rayos con su
   * destello se dibujan como mucho (los más viejos dejan sitio a los nuevos).
   */
  shots: number;
  /**
   * Grabar vídeo del mundo (los clips del HUD y el modo cine, world/cine): fotogramas por segundo
   * de la grabación (0 = este equipo no graba). Grabar cuesta: en los niveles bajos, menos.
   */
  clipFps: number;
}

export const FEATURES: Record<Tier, Features> = {
  low: { dpr: [0.75, 1], antialias: false, pbr: false, post: false, bloom: false, ao: false, shadows: 0, probe: 0, pointLights: false, lightPools: true, skyline: 48, flyerTris: 500, lod: "light", textures: 512, normalMaps: false, avatarFill: true, nexoCity: 0.5, pedestrians: 3, traffic: 8, residents: 2, rain: 900, ragdolls: 2, springs: 5, shots: 8, clipFps: 24 },
  medium: { dpr: [1, 1.5], antialias: true, pbr: true, post: true, bloom: true, ao: false, shadows: 0, probe: 0, pointLights: false, lightPools: true, skyline: 96, flyerTris: 900, lod: "light", textures: 512, normalMaps: true, avatarFill: true, nexoCity: 0.75, pedestrians: 5, traffic: 14, residents: 3, rain: 1600, ragdolls: 3, springs: 12, shots: 12, clipFps: 30 },
  high: { dpr: [1, 2], antialias: false, pbr: true, post: true, bloom: true, ao: false, shadows: 1024, probe: 128, pointLights: true, lightPools: false, skyline: 150, flyerTris: 1800, lod: "detailed", textures: 1024, normalMaps: true, avatarFill: true, nexoCity: 1, pedestrians: 7, traffic: 22, residents: 4, rain: 3200, ragdolls: 5, springs: 25, shots: 20, clipFps: 30 },
  ultra: { dpr: [1, 2], antialias: false, pbr: true, post: true, bloom: true, ao: true, shadows: 2048, probe: 256, pointLights: true, lightPools: false, skyline: 220, flyerTris: 2700, lod: "detailed", textures: 1024, normalMaps: true, avatarFill: true, nexoCity: 1, pedestrians: 9, traffic: 30, residents: 6, rain: 4800, ragdolls: 8, springs: 40, shots: 28, clipFps: 60 },
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
    // Sus GPU dibujan por teselas: el MSAA les sale casi gratis y, sin post-proceso, es lo único que
    // quita los dientes de sierra (en las gafas, lo que más se nota).
    antialias: true,
    post: false,
    bloom: false,
    ao: false,
    shadows: 0,
    probe: 0,
    pointLights: false,
    lightPools: true,
    skyline: Math.min(f.skyline, 96),
    flyerTris: Math.min(f.flyerTris, xr ? 500 : 900),
    nexoCity: Math.min(f.nexoCity, 0.75),
    pedestrians: Math.min(f.pedestrians, xr ? 3 : 5),
    traffic: Math.min(f.traffic, 14),
    residents: Math.min(f.residents, xr ? 2 : 3),
    // En las gafas, solo los charcos (las gotas cruzan la vista y marean); en el móvil, poca.
    rain: xr ? 0 : Math.min(f.rain, 900),
    ragdolls: Math.min(f.ragdolls, xr ? 2 : 3),
    // En las gafas, el pelo de quien tienes cerca; en el móvil, algo más.
    springs: Math.min(f.springs, xr ? 6 : 10),
    shots: Math.min(f.shots, 12),
    // En las gafas no hay canvas que grabar; en el móvil, a 24 como mucho.
    clipFps: xr ? 0 : Math.min(f.clipFps, 24),
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
  /** Este equipo puede entrar en VR (lo dice el navegador al arrancar: `setXrCapable`). */
  private xrCapable = false;
  /** Lo que da `portableClamp` para cada nivel (el mismo objeto cada vez: ver `features`). */
  private clamped = new Map<string, Features>();
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

  /**
   * Lo que se dibuja en este equipo. Siempre el mismo objeto mientras no cambie el nivel: media
   * escena lo lleva en sus dependencias (cada modelo, cada entidad), y uno nuevo en cada lectura la
   * rehacía entera cada vez que algo volvía a pintar la escena (en gafas y móviles, cada minuto).
   */
  get features(): Features {
    const tier = this.tier;
    const f = FEATURES[tier];
    if (!detectGpu().portable && !this.inXR) return f;
    const key = `${tier}|${this.inXR}`;
    let c = this.clamped.get(key);
    if (!c) this.clamped.set(key, (c = portableClamp(f, this.inXR)));
    return c;
  }

  /**
   * ¿El canvas se crea con MSAA? No se puede cambiar en caliente (habría que recrearlo, y con él todo
   * lo que hay en la GPU), así que lo decide el equipo y no el nivel: gafas y móviles, siempre (no
   * tienen post-proceso); un escritorio, solo si puede entrar en VR (dentro de las gafas no hay
   * post-proceso y el MSAA del canvas es el único suavizado; fuera, el suyo lo pone el post-proceso).
   */
  get canvasAA(): boolean {
    return detectGpu().portable || this.xrCapable;
  }

  setXrCapable(on: boolean) {
    if (this.xrCapable === on) return;
    this.xrCapable = on;
    this.bump();
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
