import { useMemo } from "react";
import * as THREE from "three";

/**
 * Cielo de atardecer mediterráneo: una esfera con degradado vertical.
 * Un solo draw call y sin texturas, apto para Quest.
 * Es presentación del cliente, no datos del mundo.
 */
export const HORIZON = "#f3c99b";

export function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color("#6f9fd6") },
          horizon: { value: new THREE.Color(HORIZON) },
          ground: { value: new THREE.Color("#c9a77c") },
        },
        vertexShader: /* glsl */ `
          varying float vY;
          void main() {
            vY = normalize(position).y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 ground;
          varying float vY;
          void main() {
            vec3 c = vY > 0.0 ? mix(horizon, top, pow(vY, 0.6)) : mix(horizon, ground, min(-vY * 4.0, 1.0));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    [],
  );

  return (
    <mesh material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[300, 24, 12]} />
    </mesh>
  );
}
