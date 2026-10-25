/**
 * Mapa de entorno compartido, solo para los modelos glTF con materiales PBR.
 * La plaza (Lambert) no lo usa: así sus colores no se lavan y no paga el coste.
 */
import * as THREE from "three";

let env: THREE.Texture | null = null;

export function setEnvironment(t: THREE.Texture | null) {
  env = t;
}

export function applyEnvironment(root: THREE.Object3D, intensity = 0.8) {
  if (!env) return;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial && !std.envMap) {
        std.envMap = env;
        std.envMapIntensity = intensity;
        std.needsUpdate = true;
      }
    }
  });
}
