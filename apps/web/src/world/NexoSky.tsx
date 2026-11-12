/**
 * El cielo del nexo: de noche, su cúpula (el resplandor de la megaciudad en el horizonte, estrellas,
 * una aurora hacia el norte y la Vía Láctea), y de día y de noche, su planeta con anillos, colgado
 * sobre la ciudad. Todo sale
 * del shader (sin imágenes) y es decorado del cliente. De día el cielo es la foto de nubes de todo
 * el mundo (World.tsx); el planeta se ve pálido, como la luna de día, y por detrás de las nubes.
 *
 * - La cúpula se pinta la última de lo opaco y al fondo del todo (z = w): solo los píxeles que no
 *   tapa nada. Su horizonte es el tono del aire (city-air.ts): las torres lejanas se pierden en él.
 * - El planeta y sus anillos son dos mallas que van con quien mira (están en el infinito: no se
 *   acercan al andar; las coloca el shader, sin nada por frame), por detrás de las torres. La sombra del planeta sobre los anillos, la de los
 *   anillos sobre el planeta y la parte de los anillos que queda detrás se calculan en el shader.
 *
 * Los colores son «como se ven» (display.ts).
 */
import { useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { AIR_GLSL, air, SUN } from "./city-air";
import type { Ambience } from "./graphics";

const NOISE = /* glsl */ `
  float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(h13(i), h13(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h13(i + vec3(0.0, 1.0, 0.0)), h13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(h13(i + vec3(0.0, 0.0, 1.0)), h13(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h13(i + vec3(0.0, 1.0, 1.0)), h13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
`;

/* ------------------------------------------------------------------ */
/* La cúpula de noche                                                   */
/* ------------------------------------------------------------------ */

const DOME_FS = /* glsl */ `
  uniform float uTime; uniform vec3 uZenith;
  varying vec3 vDir;
  ${AIR_GLSL}
  ${NOISE}
  // Estrellas redondas: una por celda (pocas), con su brillo y su parpadeo.
  float stars(vec3 d, float scale, float amount) {
    vec3 p = d * scale;
    vec3 i = floor(p), f = fract(p) - 0.5;
    float h = h13(i);
    float tw = 0.78 + 0.22 * sin(uTime * (0.8 + h * 2.5) + h * 97.0);
    return step(1.0 - amount, h) * smoothstep(0.42, 0.06, length(f)) * tw * (0.35 + 0.65 * fract(h * 57.0));
  }
  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, 0.0, 1.0);
    // Del resplandor de la ciudad en el horizonte (el tono del aire, en cada dirección) a lo alto,
    // pasando por un azul profundo.
    vec3 glowC = texture2D(uRing, vec2(atan(d.z, d.x) * 0.15915494 + 0.5, 0.5)).rgb;
    vec3 c = mix(glowC, mix(uZenith, vec3(0.03, 0.05, 0.16), 0.7), smoothstep(0.0, 0.2, up));
    c = mix(c, uZenith, smoothstep(0.1, 0.7, up));
    float clear = smoothstep(0.03, 0.3, d.y);
    float s = stars(d, 300.0, 0.0022) * 1.3;
    #ifdef RICH
      s += stars(d.zxy, 520.0, 0.0045) * 0.55;
    #endif
    #ifdef DEEP
      // La Vía Láctea: una franja que cruza el cielo, con sus nubes de polvo y más estrellas.
      float band = exp(-pow(dot(d, normalize(vec3(0.46, 0.5, 0.73))) / 0.13, 2.0));
      if (band > 0.02) {
        float n = vnoise(d * 7.0 + 3.0) * 0.55 + vnoise(d * 19.0) * 0.3 + vnoise(d * 41.0) * 0.15;
        float dust = smoothstep(0.4, 0.7, vnoise(d * 11.0 + 11.0) * 0.7 + vnoise(d * 29.0) * 0.3);
        c += mix(vec3(0.014, 0.022, 0.052), vec3(0.04, 0.03, 0.058), n) * band * (0.25 + 1.3 * n * n) * (1.0 - 0.7 * dust) * clear;
        s += stars(d.yzx, 460.0, 0.02 * band * (1.0 - 0.6 * dust)) * 0.45;
      }
    #endif
    #ifdef RICH
      // Una aurora hacia el norte: cortinas verde agua que ondean despacio, más claras donde se
      // pliegan. Solo se calcula en su trozo de cielo.
      float az = atan(d.x, -d.z);
      float window = exp(-pow(az / 0.95, 2.0)) * smoothstep(0.07, 0.12, d.y) * (1.0 - smoothstep(0.75, 0.95, d.y));
      if (window > 0.01) {
        float fold = vnoise(vec3(az * 4.0 + uTime * 0.02, uTime * 0.015, 3.0));
        float rays = 0.55 + 0.45 * vnoise(vec3(az * 26.0 + fold * 3.0, 0.0, uTime * 0.03));
        float hgt = 0.2 + 0.22 * fold;
        float curtain = smoothstep(0.07, hgt, d.y) * (1.0 - smoothstep(hgt, hgt + 0.36, d.y)) * window * (0.25 + 0.75 * smoothstep(0.3, 0.7, fold));
        c += mix(vec3(0.03, 0.2, 0.15), vec3(0.1, 0.07, 0.24), smoothstep(hgt, hgt + 0.3, d.y)) * curtain * rays * 0.55;
      }
    #endif
    vec3 light = vec3(0.9, 0.94, 1.0) * s * clear;
    gl_FragColor = vec4(xenxoShown(c + light), 1.0);
    // Con post-proceso, las más brillantes pasan de 1: el resplandor (bloom) las recoge.
    if (xenxoLinearOut()) gl_FragColor.rgb += light * 0.5;
    #include <colorspace_fragment>
  }`;

/** `rich`: con la aurora (niveles con materiales reales); `deep`: además, la Vía Láctea (escritorio). */
function NightDome({ rich, deep }: { rich: boolean; deep: boolean }) {
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(100, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: air,
        defines: { ...(rich ? { RICH: "" } : {}), ...(deep ? { DEEP: "" } : {}) },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        // Centrada en quien mira (solo el giro de la vista: vale para cada ojo en las gafas y para
        // la foto de los reflejos) y al fondo del todo (z = w): solo se pinta donde no hay nada delante.
        vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = (projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0)).xyww; }`,
        fragmentShader: DOME_FS,
      }),
    );
    m.frustumCulled = false;
    // Lo último de lo opaco.
    m.renderOrder = 10;
    return m;
  }, [rich, deep]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    },
    [mesh],
  );
  return <primitive object={mesh} />;
}

/* ------------------------------------------------------------------ */
/* El planeta                                                           */
/* ------------------------------------------------------------------ */

/**
 * Dónde está: rumbo (grados; 0 = norte, 90 = este), altura sobre el horizonte y radio aparente. La
 * distancia solo decide qué lo tapa: más lejos que cualquier torre (las últimas, a unos 1850 m) y
 * con los anillos enteros antes de donde deja de ver la cámara (`NEXO_FAR`; su punto más lejano
 * queda a 1,29 veces esta distancia).
 */
const PLANET = { bearing: -40, elevation: 26, size: 7.6, distance: 1980 };
/** Sus anillos, en radios del planeta. */
const RING_IN = 1.36, RING_OUT = 2.24;
const DIR = (() => {
  const b = (PLANET.bearing * Math.PI) / 180, e = (PLANET.elevation * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e));
})();
/** El eje del planeta (sus anillos van en el plano perpendicular): inclinado hacia quien mira. */
const AXIS = new THREE.Vector3(0.3, 0.9, -0.1).normalize();
/** De noche, el sol que lo ilumina está bajo el horizonte, al suroeste. */
const NIGHT_SUN = new THREE.Vector3(-0.62, -0.3, 0.72).normalize();

const planetUniforms = {
  uAxis: { value: AXIS },
  uLight: { value: SUN.clone() },
  /** De quien mira al centro del planeta: va con la cámara (está en el infinito: no se acerca al andar). */
  uOff: { value: DIR.clone().multiplyScalar(PLANET.distance) },
  uRadius: { value: 1 },
};

const PLANET_GLSL = /* glsl */ `
  uniform vec3 uAxis; uniform vec3 uLight; uniform vec3 uOff; uniform float uRadius;
  uniform sampler2D uSky; uniform float uSkyOn;
  ${AIR_GLSL}
  // Cuánto anillo hay a esa distancia del centro (en radios del planeta): bandas y huecos.
  float ringAt(float r) {
    float body = smoothstep(${RING_IN.toFixed(2)}, ${(RING_IN + 0.05).toFixed(2)}, r) * (1.0 - smoothstep(${(RING_OUT - 0.05).toFixed(2)}, ${RING_OUT.toFixed(2)}, r));
    float bands = 0.62 + 0.24 * sin(r * 46.0) + 0.14 * sin(r * 113.0 + 1.0);
    float gap = 1.0 - (1.0 - smoothstep(0.012, 0.03, abs(r - 1.9))) * 0.85;
    return body * bands * gap * (0.55 + 0.45 * smoothstep(${RING_IN.toFixed(2)}, 1.7, r));
  }
  // Lo que deja ver el aire de algo que está en el infinito, según lo alto que se mire.
  float through(vec3 dir) {
    return exp(-uDensity * exp(-uFall * cameraPosition.y) / (max(uFall, 0.0001) * max(dir.y, 0.03)));
  }
  // De día: cuánta nube de la foto del cielo hay delante (lo claro y sin color).
  float cloud(vec3 dir) {
    if (uSkyOn < 0.5) return 0.0;
    vec3 c = textureLod(uSky, vec2(atan(dir.z, dir.x) * 0.15915494 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5), 1.0).rgb;
    return smoothstep(0.34, 0.7, min(c.r, min(c.g, c.b)));
  }
  // Lo último: de día, pálido y por detrás de las nubes; de noche, entero, con el aire de abajo.
  vec4 placed(vec3 lit, float light, float alpha, vec3 dir) {
    float t = through(dir);
    if (uNight > 0.5) return vec4(mix(airTone(cameraPosition + dir * 1000.0), lit, t), alpha);
    vec3 pale = mix(lit, vec3(0.88, 0.92, 0.98), 0.5);
    return vec4(pale, alpha * light * 0.5 * t * (1.0 - 0.95 * cloud(dir)));
  }
`;

/** `vP`: desde el centro del planeta. La malla no se mueve: la lleva el shader con quien mira. */
const PLANET_VS = /* glsl */ `
  uniform vec3 uOff;
  varying vec3 vP;
  void main() { vP = mat3(modelMatrix) * position; gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (uOff + vP), 1.0); }`;

const PLANET_FS = /* glsl */ `
  varying vec3 vP;
  ${PLANET_GLSL}
  void main() {
    vec3 n = normalize(vP);
    vec3 dir = normalize(uOff + vP);
    float ndv = max(dot(n, -dir), 0.0);
    // Un gigante de gas: bandas por latitud, onduladas, en violeta, verde agua y crema.
    vec3 e1 = normalize(cross(uAxis, vec3(0.0, 0.0, 1.0)));
    vec3 e2 = cross(uAxis, e1);
    float lat = dot(n, uAxis);
    float lon = atan(dot(n, e2), dot(n, e1));
    float b = lat + sin(lon * 3.0 + lat * 9.0) * 0.014 + sin(lon * 7.0 - lat * 21.0 + 1.7) * 0.007;
    // Bandas anchas y suaves (lila y crema), con algún cinturón verde agua y vetas finas.
    float k1 = 0.5 + 0.5 * sin(b * 17.0 + 0.6 + 1.2 * sin(b * 7.0)), k2 = 0.5 + 0.5 * sin(b * 53.0 + 2.1), k3 = smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(b * 9.0 - 0.8));
    vec3 col = mix(vec3(0.42, 0.34, 0.72), vec3(0.74, 0.7, 0.9), k1 * 0.82 + k2 * 0.18);
    col = mix(col, vec3(0.3, 0.64, 0.74), k3 * 0.55);
    col *= 1.0 - 0.35 * smoothstep(0.6, 1.0, abs(lat));
    // La luz: el terminador suave, el borde más oscuro y un filo de atmósfera en el lado iluminado.
    float l = smoothstep(-0.08, 0.42, dot(n, uLight));
    // La sombra de los anillos sobre el planeta.
    float t = -lat / (dot(uLight, uAxis) + 1.0e-4);
    if (t > 0.0) l *= 1.0 - 0.6 * ringAt(length(n + uLight * t));
    vec3 lit = col * (l * mix(0.32, 0.86, pow(ndv, 0.6)) + 0.01) + vec3(0.45, 0.62, 1.0) * pow(1.0 - ndv, 3.5) * l * 0.4;
    float edge = smoothstep(0.0, fwidth(ndv) * 1.5 + 0.004, ndv);
    gl_FragColor = placed(lit, l, edge, dir);
    gl_FragColor.rgb = xenxoShown(gl_FragColor.rgb);
    #include <colorspace_fragment>
  }`;

const RING_FS = /* glsl */ `
  varying vec3 vP;
  ${PLANET_GLSL}
  void main() {
    // En radios del planeta, desde su centro: el punto del anillo y quien mira.
    vec3 p = vP / uRadius;
    vec3 o = -uOff / uRadius;
    vec3 dir = normalize(p - o);
    float a = ringAt(length(p));
    // Lo que queda detrás del planeta no se ve.
    float bo = dot(o, dir), disc = bo * bo - (dot(o, o) - 1.0);
    if (disc > 0.0 && -bo - sqrt(disc) < length(p - o)) a *= 1.0 - smoothstep(0.0, 0.004, disc);
    // La sombra del planeta sobre los anillos.
    float bl = dot(p, uLight), dl = bl * bl - (dot(p, p) - 1.0);
    float l = bl < 0.0 ? 1.0 - smoothstep(0.0, 0.02, dl) : 1.0;
    // Por la cara que da al sol brillan más; por la otra se ven al trasluz.
    l *= dot(uLight, uAxis) * dot(-dir, uAxis) > 0.0 ? 1.0 : 0.5;
    vec3 col = mix(vec3(0.8, 0.74, 0.9), vec3(0.62, 0.8, 0.86), 0.5 + 0.5 * sin(length(p) * 19.0));
    gl_FragColor = placed(col * (l + 0.01), mix(0.25, 1.0, l), a * mix(0.9, 1.0, uNight), dir);
    gl_FragColor.rgb = xenxoShown(gl_FragColor.rgb);
    #include <colorspace_fragment>
  }`;

const UP = new THREE.Vector3(0, 0, 1);

/** El planeta con anillos del cielo del nexo. */
export function NexoPlanet({ ambience }: { ambience: Ambience }) {
  const meshes = useMemo(() => {
    const uniforms = { ...air, ...planetUniforms };
    const radius = PLANET.distance * Math.tan((PLANET.size * Math.PI) / 180);
    planetUniforms.uRadius.value = radius;
    const base = { uniforms, transparent: true, depthWrite: false, fog: false, vertexShader: PLANET_VS } as const;
    const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), new THREE.ShaderMaterial({ ...base, fragmentShader: PLANET_FS }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(RING_IN, RING_OUT, 128, 1), new THREE.ShaderMaterial({ ...base, side: THREE.DoubleSide, fragmentShader: RING_FS }));
    ring.quaternion.setFromUnitVectors(UP, AXIS);
    for (const m of [planet, ring]) {
      m.scale.setScalar(radius);
      m.frustumCulled = false;
    }
    // Detrás de todo lo transparente del mundo, y delante del aire del horizonte (−3).
    planet.renderOrder = -2;
    ring.renderOrder = -1;
    return [planet, ring];
  }, []);
  useLayoutEffect(() => {
    planetUniforms.uLight.value.copy(ambience === "night" ? NIGHT_SUN : SUN);
  }, [ambience]);
  useEffect(
    () => () => {
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
    [meshes],
  );
  return (
    <>
      <primitive object={meshes[0]!} />
      <primitive object={meshes[1]!} />
    </>
  );
}

/** El cielo del nexo de noche. */
export function NexoSky({ rich, deep }: { rich: boolean; deep: boolean }) {
  return <NightDome rich={rich} deep={deep} />;
}
