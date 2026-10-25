import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Ambience } from "./graphics";

/**
 * Cielo: atardecer mediterráneo de día y cielo de neón con estrellas de noche.
 * Una esfera con un shader, un draw call y sin texturas: apto para Quest.
 * Es presentación del cliente, no datos del mundo.
 */
export const SKY = {
  day: { top: "#6f9fd6", horizon: "#f3c99b", ground: "#c9a77c", fog: "#f3c99b" },
  night: { top: "#04060f", horizon: "#3a1c5c", ground: "#06070d", fog: "#120d26" },
} as const;

export function Sky({ ambience }: { ambience: Ambience }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color() },
          horizon: { value: new THREE.Color() },
          ground: { value: new THREE.Color() },
          night: { value: 0 },
          time: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 ground;
          uniform float night; uniform float time;
          varying vec3 vDir;
          float hash(vec3 p) {
            p = fract(p * 0.3183099 + 0.1);
            p *= 17.0;
            return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
          }
          void main() {
            vec3 d = normalize(vDir);
            float y = d.y;
            vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.55)) : mix(horizon, ground, min(-y * 4.0, 1.0));
            // Resplandor de ciudad en el horizonte, solo de noche.
            c += night * vec3(0.55, 0.12, 0.45) * exp(-abs(y) * 9.0) * 0.35;
            // Estrellas: una por celda con probabilidad baja, parpadeo suave. Más brillantes que 1 para el bloom.
            vec3 cell = floor(d * 220.0);
            float h = hash(cell);
            float star = step(0.9965, h) * smoothstep(0.05, 0.35, y);
            star *= 0.6 + 0.4 * sin(time * 1.7 + h * 91.0);
            c += night * star * vec3(1.6, 1.6, 2.0);
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    [],
  );

  useEffect(() => {
    const k = SKY[ambience];
    material.uniforms.top!.value.set(k.top);
    material.uniforms.horizon!.value.set(k.horizon);
    material.uniforms.ground!.value.set(k.ground);
    material.uniforms.night!.value = ambience === "night" ? 1 : 0;
  }, [ambience, material]);

  useFrame((_, dt) => {
    material.uniforms.time!.value += dt;
  });

  return (
    <mesh material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[300, 32, 16]} />
    </mesh>
  );
}
