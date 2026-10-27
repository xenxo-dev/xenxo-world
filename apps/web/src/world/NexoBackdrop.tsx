/**
 * Fondo lejano del nexo (lo cercano es 3D: NexoCity): una panorámica realista de la megaciudad cyberpunk y el espacio (planeta con
 * anillos, luna, estación orbital) que da la vuelta entera alrededor de la plataforma, de día o de
 * noche. Son imágenes generadas con IA, guardadas en el repo y servidas desde xenxo
 * (tools/materials/generated/nexo-panorama, CREDITS.md). Decorado del cliente, no datos del mundo.
 *
 * Un cilindro abierto con una textura (un draw call, sin luces): arriba funde con el cielo y por
 * debajo del horizonte desaparece (ahí se ve la ciudad en 3D). 4096 px en gafas y móvil; 8192 en escritorio.
 */
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { CHUNK_SIZE } from "@xenxo/protocol";
import type { Ambience } from "./graphics";

const RADIUS = 240;
/** Fila del horizonte en cada franja (0 arriba, 1 abajo), medida en las imágenes. */
const HORIZON: Record<Ambience, number> = { night: 0.49, day: 0.445 };

const cache = new Map<string, Promise<THREE.Texture>>();
function load(url: string) {
  let p = cache.get(url);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(url).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = 4;
      return t;
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

const material = () =>
  new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: { map: { value: null as THREE.Texture | null }, gain: { value: 1 }, cut: { value: 0.5 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float gain; uniform float cut;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(map, vec2(1.0 - vUv.x, vUv.y));
        // Por debajo del horizonte no hay imagen: ahí está la ciudad en 3D (NexoCity), entre la bruma.
        float a = smoothstep(cut - 0.01, cut + 0.05, vUv.y) * smoothstep(1.0, 0.86, vUv.y);
        gl_FragColor = vec4(c.rgb * gain, a);
        #include <colorspace_fragment>
      }`,
  });

export function NexoBackdrop({ ambience, hd }: { ambience: Ambience; hd: boolean }) {
  const mat = useMemo(material, []);
  const [aspect, setAspect] = useState(0);
  const url = `/sky/nexo-${ambience}-${hd ? 8 : 4}k.webp`;
  useEffect(() => {
    let alive = true;
    void load(url)
      .then((t) => {
        if (!alive) return;
        mat.uniforms.map!.value = t;
        mat.uniforms.gain!.value = ambience === "night" ? 1.15 : 1;
        mat.uniforms.cut!.value = 1 - HORIZON[ambience];
        const img = t.image as { width: number; height: number };
        setAspect(img.width / img.height);
      })
      .catch(() => alive && setAspect(0));
    return () => {
      alive = false;
    };
  }, [url, ambience, mat]);
  useEffect(() => () => mat.dispose(), [mat]);

  // Alto del cilindro para que la imagen no se deforme; el horizonte, a la altura de los ojos.
  if (!aspect) return null;
  const height = (2 * Math.PI * RADIUS) / aspect;
  // El cilindro va de arriba (v=1) a abajo: el horizonte de la imagen, a la altura de los ojos.
  const y = 1.6 + (HORIZON[ambience] - 0.5) * height;
  return (
    <mesh position={[CHUNK_SIZE / 2, y, CHUNK_SIZE / 2]} material={mat} renderOrder={-1} frustumCulled={false}>
      <cylinderGeometry args={[RADIUS, RADIUS, height, 96, 1, true]} />
    </mesh>
  );
}
