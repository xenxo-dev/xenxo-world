/**
 * Biblioteca de materiales de xenxo.
 *
 * Los modelos pueden nombrar sus materiales "xenxo:<biblioteca>.<tinte>" (p. ej. "xenxo:teja.b5583a").
 * Este cliente los sustituye por materiales con texturas escaneadas reales (servidas desde
 * /materials, nunca desde terceros), según el nivel gráfico. Cualquier otro cliente puede
 * ignorar la convención: el GLB ya trae su color base y su oclusión horneada.
 *
 * Además, algunos materiales cambian con el ambiente:
 *   neon    → tubos que resplandecen (mucho más de noche)
 *   farol   → cristal de farolas y esferas: luz cálida de noche
 *   ventana → vidrio que refleja de día y se ilumina (no todas) de noche
 *   fachada → rascacielos: sus ventanas (lo cálido y claro del albedo) se encienden de noche
 *   agua    → superficie animada
 */
import * as THREE from "three";
import library from "./material-library.json";
import type { Ambience, Features } from "./graphics";

type LibInfo = { tile: number };
const LIB = library as Record<string, LibInfo>;

export interface LibraryRef {
  lib: string;
  tint: THREE.Color;
}

/** "xenxo:teja.b5583a" (o "xenxo:teja.b5583a.001", como lo deja Blender al duplicar) → { lib, tint }. */
export function parseLibraryName(name: string): LibraryRef | null {
  const m = /^xenxo:([a-z_]+)(?:\.([0-9a-f]{6}))?/.exec(name);
  if (!m) return null;
  return { lib: m[1]!, tint: new THREE.Color(`#${m[2] ?? "ffffff"}`) };
}

/* ------------------------------------------------------------------ */
/* Texturas compartidas                                                 */
/* ------------------------------------------------------------------ */

const loader = new THREE.TextureLoader();
const textures = new Map<string, THREE.Texture>();
let anisotropy = 4;

export function setMaxAnisotropy(n: number) {
  anisotropy = Math.min(8, n);
}

function tex(lib: string, map: "albedo" | "normal" | "rm", size: number): THREE.Texture | null {
  if (!LIB[lib]) return null;
  const key = `${lib}/${map}.${size}`;
  let t = textures.get(key);
  if (!t) {
    t = loader.load(`/materials/${lib}/${map}.${size}.webp`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    // Las UV de los modelos de la forja están en metros: la textura se repite según su tamaño real.
    t.repeat.setScalar(1 / LIB[lib]!.tile);
    t.colorSpace = map === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    t.channel = 0;
    textures.set(key, t);
  }
  return t;
}

/* ------------------------------------------------------------------ */
/* Agua: normales procedurales que se desplazan                         */
/* ------------------------------------------------------------------ */

let waterNormal: THREE.CanvasTexture | null = null;
function waterNormals(): THREE.CanvasTexture {
  if (waterNormal) return waterNormal;
  const n = 128;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const img = g.createImageData(n, n);
  const h = (x: number, y: number) =>
    Math.sin((x / n) * Math.PI * 2 * 3 + Math.sin((y / n) * Math.PI * 2 * 2) * 1.5) * 0.5 +
    Math.sin((y / n) * Math.PI * 2 * 4 + Math.cos((x / n) * Math.PI * 2 * 3)) * 0.35;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const i = (y * n + x) * 4;
      img.data[i] = 128 - dx * 90;
      img.data[i + 1] = 128 - dy * 90;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  waterNormal = new THREE.CanvasTexture(c);
  waterNormal.wrapS = waterNormal.wrapT = THREE.RepeatWrapping;
  waterNormal.repeat.setScalar(0.6);
  return waterNormal;
}

/** Llamar en cada frame: mueve el agua (una sola textura para todas las fuentes). */
export function tickMaterials(t: number) {
  if (waterNormal) waterNormal.offset.set(t * 0.03, t * 0.017);
}

/* ------------------------------------------------------------------ */
/* Ventanas: de noche se encienden unas sí y otras no                   */
/* ------------------------------------------------------------------ */

function litWindows(material: THREE.Material, strength: number) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLit = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPosW;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWorldPosW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPosW;\nuniform float uLit;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          vec3 cell = floor(vWorldPosW * vec3(0.7, 0.45, 0.7));
          float hsh = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float on = step(0.32, hsh);
          float warm = 0.55 + 0.45 * fract(hsh * 7.31);
          totalEmissiveRadiance *= uLit * on * warm;
        }`,
      );
  };
  material.customProgramCacheKey = () => `xenxo-window-${strength}`;
}

/* ------------------------------------------------------------------ */
/* Fachadas: las ventanas del propio escaneo se encienden               */
/* ------------------------------------------------------------------ */

/**
 * El mapa emisivo es el mismo albedo, pero solo emite lo que parece una ventana encendida
 * (colores cálidos o muy claros); la estructura gris y los cristales oscuros no.
 */
function facadeGlow(material: THREE.Material, strength: number) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uGlow;")
      .replace(
        "#include <emissivemap_fragment>",
        `#ifdef USE_EMISSIVEMAP
        {
          vec3 eC = texture2D(emissiveMap, vEmissiveMapUv).rgb;
          float sat = max(eC.r, max(eC.g, eC.b)) - min(eC.r, min(eC.g, eC.b));
          float lum = dot(eC, vec3(0.299, 0.587, 0.114));
          float m = max(smoothstep(0.08, 0.22, sat) * smoothstep(0.06, 0.25, lum), smoothstep(0.5, 0.75, lum));
          totalEmissiveRadiance *= eC * m * uGlow;
        }
        #endif`,
      );
  };
  material.customProgramCacheKey = () => `xenxo-facade-${strength}`;
}

/* ------------------------------------------------------------------ */
/* Construcción de materiales                                           */
/* ------------------------------------------------------------------ */

/** Brillo de los neones: por encima de 1 para que el bloom los haga resplandecer, sobre todo de noche. */
export function neonGlow(ambience: Ambience, bloom: boolean) {
  if (!bloom) return ambience === "night" ? 1 : 0.9;
  return ambience === "night" ? 4 : 1.15;
}

const ROUGH: Record<string, number> = { azulejo: 0.35, ventana: 0.06, agua: 0.04, fruta: 0.5, flor: 0.8, hoja: 0.85 };

/**
 * Material de biblioteca para un nivel y un ambiente. `ao` es el mapa de oclusión horneado
 * del propio modelo (segundo canal UV); se conserva.
 */
export function libraryMaterial(ref: LibraryRef, f: Features, ambience: Ambience, ao: THREE.Texture | null): THREE.Material {
  const { lib, tint } = ref;
  const night = ambience === "night";

  if (lib === "neon") {
    const glow = neonGlow(ambience, f.bloom);
    return new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(glow), toneMapped: glow <= 1 });
  }
  if (lib === "oscuro") return new THREE.MeshBasicMaterial({ color: tint });
  if (lib === "farol") {
    if (night) {
      const glow = f.bloom ? 2.6 : 1;
      return new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(glow), toneMapped: glow <= 1 });
    }
    return f.pbr
      ? new THREE.MeshStandardMaterial({ color: tint, roughness: 0.15, metalness: 0, emissive: tint, emissiveIntensity: 0.12 })
      : new THREE.MeshLambertMaterial({ color: tint });
  }
  if (lib === "ventana") {
    const lit = night ? (f.bloom ? 2.2 : 1) : 0;
    const m = f.pbr
      ? new THREE.MeshStandardMaterial({ color: tint, roughness: 0.06, metalness: 0.6, emissive: new THREE.Color("#ffb766"), envMapIntensity: 1.4 })
      : new THREE.MeshLambertMaterial({ color: tint, emissive: new THREE.Color("#ffb766") });
    litWindows(m, lit);
    if (lit > 1) m.toneMapped = true;
    return m;
  }
  if (lib === "agua") {
    if (!f.pbr) return new THREE.MeshLambertMaterial({ color: tint, transparent: true, opacity: 0.85 });
    return new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.04,
      metalness: 0.15,
      normalMap: waterNormals(),
      normalScale: new THREE.Vector2(0.6, 0.6),
      transparent: true,
      opacity: 0.86,
      envMapIntensity: 1.5,
    });
  }

  // Materiales con textura escaneada
  const size = f.textures;
  const map = size ? tex(lib, "albedo", size) : null;
  const metal = lib === "hierro" || lib === "metal";
  // Fachadas: de noche se encienden sus ventanas (por encima de 1 solo con bloom; en VR y móvil, 1).
  const glow = lib === "fachada" && map ? (night ? (f.bloom ? 2 : 1) : 0.12) : 0;
  const lit = glow ? { emissive: new THREE.Color(0xffffff), emissiveMap: map } : {};
  if (!f.pbr) {
    const m = new THREE.MeshLambertMaterial({ color: tint, map, aoMap: ao, aoMapIntensity: 1, ...lit });
    if (glow) facadeGlow(m, glow);
    return m;
  }
  const normalMap = size && f.normalMaps ? tex(lib, "normal", size) : null;
  const rm = size && f.normalMaps ? tex(lib, "rm", size) : null;
  const m = new THREE.MeshStandardMaterial({
    color: tint,
    map,
    normalMap,
    roughnessMap: rm,
    metalnessMap: metal ? rm : null,
    roughness: ROUGH[lib] ?? (rm ? 1 : 0.85),
    metalness: metal ? 1 : 0,
    aoMap: ao,
    aoMapIntensity: 1,
    ...lit,
  });
  if (glow) facadeGlow(m, glow);
  return m;
}

/** Para modelos sin convención (los de la gente): en equipos ligeros, Lambert conservando color y texturas. */
export function lightweight(m: THREE.Material): THREE.Material {
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial) return m;
  return new THREE.MeshLambertMaterial({
    color: s.color,
    map: s.map,
    aoMap: s.aoMap,
    emissive: s.emissive,
    emissiveMap: s.emissiveMap,
    emissiveIntensity: s.emissiveIntensity,
    transparent: s.transparent,
    opacity: s.opacity,
    alphaTest: s.alphaTest,
    side: s.side,
    vertexColors: s.vertexColors,
  });
}

/* ------------------------------------------------------------------ */
/* Halo de neón sin post-proceso (VR, móvil y equipos sin bloom)        */
/* ------------------------------------------------------------------ */

const halos = new Map<string, THREE.ShaderMaterial>();

/**
 * Funda transparente un poco más gruesa que el tubo, aditiva y más intensa en el centro:
 * da el resplandor del neón sin pasadas de pantalla completa (compatible con WebXR).
 */
export function haloMaterial(color: THREE.Color, ambience: Ambience): THREE.ShaderMaterial {
  const key = `${color.getHexString()}|${ambience}`;
  let m = halos.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: color.clone() },
        uStrength: { value: ambience === "night" ? 0.95 : 0.22 },
        uGrow: { value: 0.07 },
      },
      vertexShader: /* glsl */ `
        uniform float uGrow;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec3 p = position + normal * uGrow;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uStrength;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float facing = abs(dot(normalize(vN), normalize(vV)));
          float a = pow(facing, 2.2) * uStrength;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    halos.set(key, m);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* Holograma (hologram@1)                                               */
/* ------------------------------------------------------------------ */

/** Reloj compartido de todos los hologramas: lo avanza `tickHolograms` una vez por frame. */
const holoTime = { value: 0 };

export function tickHolograms(elapsed: number) {
  holoTime.value = elapsed;
}

const holoCache = new Map<string, THREE.ShaderMaterial>();

/**
 * Luz proyectada: aditiva, sin escribir profundidad y sin sombras. Brilla más en los bordes
 * (fresnel) y lleva líneas de barrido que suben despacio. Barata: sirve también en Quest y móvil.
 */
export function hologramMaterial(color: string, opacity: number): THREE.ShaderMaterial {
  const key = `${color}|${opacity.toFixed(2)}`;
  let m = holoCache.get(key);
  if (m) return m;
  m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uTime: holoTime },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vY = wp.y;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float scan = 0.7 + 0.3 * sin(vY * 38.0 - uTime * 2.6);
        float flick = 0.94 + 0.06 * sin(uTime * 11.0 + vY * 3.0);
        float a = (0.38 + 1.1 * rim) * scan * flick * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  holoCache.set(key, m);
  return m;
}
