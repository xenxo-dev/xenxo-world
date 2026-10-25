/**
 * Carga de personajes propios (GLB de Blender o VRM de VRoid y similares)
 * y su normalización: misma altura, pies en el suelo y mirando hacia delante (-Z).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { VRMLookAtQuaternionProxy } from "@pixiv/three-vrm-animation";
import { VrmAnimator } from "./animation";
import type { Motion } from "./motion";

export const AVATAR_HEIGHT = 1.75;

export interface LoadedAvatar {
  object: THREE.Object3D;
  /**
   * Llamar en cada frame con el estado de movimiento (velocidad, fase del paso,
   * si está en el aire y el gesto en curso).
   */
  update(dt: number, motion: Motion): void;
  dispose(): void;
}

/** 0 parado → 1 andando a paso normal. */
export function walkAmount(speed: number) {
  return Math.min(1, Math.max(0, (speed - 0.15) / 2.5));
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

/**
 * Ajusta altura, apoya los pies en y = 0 y centra en x/z.
 * Con `keepRealScale` (VRM, que va en metros) respeta la estatura si es creíble.
 */
function normalize(root: THREE.Object3D, keepRealScale = false) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const plausible = keepRealScale && size.y > 1.3 && size.y < 2.2;
  const scale = plausible ? 1 : size.y > 0.01 ? AVATAR_HEIGHT / size.y : 1;
  const wrapper = new THREE.Group();
  root.scale.multiplyScalar(scale);
  root.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
  wrapper.add(root);
  return wrapper;
}

/**
 * Los personajes proyectan sombra (solo se ve en equipos con sombras activadas)
 * y las mallas con huesos no se recortan por error al moverse.
 */
function tune(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = false;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
    }
  });
}

export async function loadAvatar(url: string): Promise<LoadedAvatar> {
  const gltf = await getLoader().loadAsync(url);
  const vrm = gltf.userData.vrm as VRM | undefined;
  return vrm ? fromVrm(vrm, gltf.scene) : fromGltf(gltf.scene, gltf.animations);
}

/* ------------------------------------------------------------------ */
/* VRM: huesos humanoides estándar → andar procedural y parpadeo        */
/* ------------------------------------------------------------------ */

function fromVrm(vrm: VRM, scene: THREE.Group): LoadedAvatar {
  VRMUtils.removeUnnecessaryVertices(scene);
  VRMUtils.combineSkeletons(scene);
  VRMUtils.rotateVRM0(vrm); // los VRM 0.x miran hacia el otro lado
  tune(vrm.scene);

  const bone = (name: Parameters<NonNullable<VRM["humanoid"]>["getNormalizedBoneNode"]>[0]) =>
    vrm.humanoid?.getNormalizedBoneNode(name) ?? null;
  const b = {
    hips: bone("hips"),
    spine: bone("spine"),
    lUpperLeg: bone("leftUpperLeg"),
    rUpperLeg: bone("rightUpperLeg"),
    lLowerLeg: bone("leftLowerLeg"),
    rLowerLeg: bone("rightLowerLeg"),
    lUpperArm: bone("leftUpperArm"),
    rUpperArm: bone("rightUpperArm"),
    lLowerArm: bone("leftLowerArm"),
    rLowerArm: bone("rightLowerArm"),
  };
  const hipsY = b.hips?.position.y ?? 0;

  // Los VRM cargan en pose de T: se mide así y después se bajan los brazos
  // (pose de respaldo mientras llegan las animaciones).
  vrm.update(0);
  // Los VRM miran a +Z; nuestros avatares miran a -Z.
  vrm.scene.rotation.y += Math.PI;
  const object = normalize(vrm.scene, true);
  const ARMS_DOWN = 1.2;
  if (b.lUpperArm) b.lUpperArm.rotation.z = -ARMS_DOWN;
  if (b.rUpperArm) b.rUpperArm.rotation.z = ARMS_DOWN;

  // Proxy de mirada para las animaciones VRMA (evita que la librería lo cree con un aviso).
  if (vrm.lookAt) {
    const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
    proxy.name = "VRMLookAtQuaternionProxy";
    vrm.scene.add(proxy);
  }
  const animator = new VrmAnimator(vrm);
  let blinkIn = 2 + Math.random() * 3;
  let blinkT = -1;

  return {
    object,
    update: (dt, m) => {
      if (animator.ready) {
        animator.update(dt, m.speed, m.airborne, m.emote);
      } else {
        // Respaldo: paso procedural sencillo hasta que cargan los clips.
        const k = walkAmount(m.speed);
        const s = Math.sin(m.phase);
        if (b.lUpperLeg) b.lUpperLeg.rotation.x = s * 0.55 * k;
        if (b.rUpperLeg) b.rUpperLeg.rotation.x = -s * 0.55 * k;
        if (b.lLowerLeg) b.lLowerLeg.rotation.x = -Math.max(0, -s) * 0.8 * k;
        if (b.rLowerLeg) b.rLowerLeg.rotation.x = -Math.max(0, s) * 0.8 * k;
        if (b.lUpperArm) b.lUpperArm.rotation.x = -s * 0.45 * k;
        if (b.rUpperArm) b.rUpperArm.rotation.x = s * 0.45 * k;
        if (b.hips) b.hips.position.y = hipsY + Math.abs(Math.cos(m.phase)) * 0.025 * k;
      }

      // Parpadeo cada pocos segundos (si el VRM trae la expresión).
      const em = vrm.expressionManager;
      if (em) {
        blinkIn -= dt;
        if (blinkIn <= 0 && blinkT < 0) blinkT = 0;
        if (blinkT >= 0) {
          blinkT += dt;
          em.setValue("blink", Math.sin(Math.min(1, blinkT / 0.15) * Math.PI));
          if (blinkT > 0.15) {
            blinkT = -1;
            blinkIn = 2 + Math.random() * 4;
            em.setValue("blink", 0);
          }
        }
      }
      vrm.update(dt);
    },
    dispose: () => {
      animator.dispose();
      VRMUtils.deepDispose(vrm.scene);
    },
  };
}

/* ------------------------------------------------------------------ */
/* GLB: animaciones del archivo (idle / walk) o balanceo sencillo       */
/* ------------------------------------------------------------------ */

const IDLE = /idle|reposo|breath|stand/i;
const WALK = /walk|andar|caminar|run|correr/i;

function fromGltf(source: THREE.Group, clips: THREE.AnimationClip[]): LoadedAvatar {
  const scene = cloneSkinned(source);
  tune(scene);
  // glTF define el frente en +Z (así exporta Blender la vista frontal); nuestros avatares miran a -Z.
  scene.rotation.y += Math.PI;
  const object = normalize(scene);

  const mixer = clips.length ? new THREE.AnimationMixer(scene) : null;
  const walkClip = clips.find((c) => WALK.test(c.name));
  const idleClip = clips.find((c) => IDLE.test(c.name)) ?? clips.find((c) => c !== walkClip);
  const idle = mixer && idleClip ? mixer.clipAction(idleClip) : null;
  const walk = mixer && walkClip ? mixer.clipAction(walkClip) : null;
  idle?.play();
  if (walk) {
    walk.play();
    walk.setEffectiveWeight(0);
  }
  const baseY = scene.position.y;
  let blend = 0;

  return {
    object,
    update: (dt, m) => {
      const { speed, phase } = m;
      const k = walkAmount(speed);
      if (walk) {
        // Mezcla suave entre reposo y andar según la velocidad.
        blend += (k - blend) * Math.min(1, dt * 8);
        walk.setEffectiveWeight(blend);
        walk.timeScale = 0.6 + speed / 3;
        idle?.setEffectiveWeight(1 - blend);
      } else {
        // Sin animación de andar: un pequeño rebote y balanceo al moverse.
        scene.position.y = baseY + Math.abs(Math.sin(phase)) * 0.06 * k;
        scene.rotation.z = Math.sin(phase) * 0.04 * k;
      }
      mixer?.update(dt);
    },
    dispose: () => {
      mixer?.stopAllAction();
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
