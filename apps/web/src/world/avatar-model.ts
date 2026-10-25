/**
 * Carga de personajes propios (GLB de Blender o VRM de VRoid y similares)
 * y su normalización: misma altura, pies en el suelo y mirando hacia delante (-Z).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { applyEnvironment } from "./environment";

export const AVATAR_HEIGHT = 1.75;

export interface LoadedAvatar {
  object: THREE.Object3D;
  /** Llamar en cada frame (muelles del pelo y la ropa de los VRM). */
  update(dt: number): void;
  dispose(): void;
}

let loader: GLTFLoader | null = null;
function getLoader() {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.register((parser) => new VRMLoaderPlugin(parser));
  }
  return loader;
}

/** Ajusta altura, apoya los pies en y = 0 y centra en x/z. */
function normalize(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const scale = size.y > 0.01 ? AVATAR_HEIGHT / size.y : 1;
  const wrapper = new THREE.Group();
  root.scale.multiplyScalar(scale);
  root.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
  wrapper.add(root);
  return wrapper;
}

/** Materiales baratos para Quest: sin sombras y sin frustum culling erróneo en mallas con huesos. */
function tune(root: THREE.Object3D) {
  applyEnvironment(root);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.receiveShadow = false;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
    }
  });
}

export async function loadAvatar(url: string): Promise<LoadedAvatar> {
  const gltf = await getLoader().loadAsync(url);
  const vrm = gltf.userData.vrm as VRM | undefined;

  if (vrm) {
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm); // los VRM 0.x miran hacia el otro lado
    tune(vrm.scene);
    // Los VRM miran a +Z; nuestros avatares miran a -Z.
    vrm.scene.rotation.y += Math.PI;
    const object = normalize(vrm.scene);
    return {
      object,
      update: (dt) => vrm.update(dt),
      dispose: () => VRMUtils.deepDispose(vrm.scene),
    };
  }

  const scene = cloneSkinned(gltf.scene);
  tune(scene);
  // glTF define el frente en +Z (así exporta Blender la vista frontal); nuestros avatares miran a -Z.
  scene.rotation.y += Math.PI;
  const object = normalize(scene);
  const mixer = gltf.animations.length ? new THREE.AnimationMixer(scene) : null;
  // Si el modelo trae una animación en reposo (idle), se reproduce en bucle.
  const idle = gltf.animations.find((a) => /idle|reposo|breath/i.test(a.name)) ?? gltf.animations[0];
  if (mixer && idle) mixer.clipAction(idle).play();
  return {
    object,
    update: (dt) => mixer?.update(dt),
    dispose: () => {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) mat.dispose();
        }
      });
    },
  };
}
