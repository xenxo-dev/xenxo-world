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
import type { Rig } from "./people/rig";
import type { Motion } from "./motion";
import { graphics } from "./graphics";
import { addSprings, SKIRT_STANCE, springBodyOf } from "./springs";

export const AVATAR_HEIGHT = 1.75;

export interface LoadedAvatar {
  object: THREE.Object3D;
  /**
   * Llamar en cada frame con el estado de movimiento (velocidad, fase del paso,
   * si está en el aire y el gesto en curso). `view`: dónde está la cámara (el pelo con
   * física solo se mueve cerca; sin ella, siempre).
   */
  update(dt: number, motion: Motion, view?: THREE.Vector3): void;
  /** El esqueleto (solo los VRM): golpes, miradas, parejas y caídas. */
  rig?: Rig;
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
 * Los personajes proyectan sombra (solo se ve en equipos con sombras activadas). Las mallas con
 * huesos se recortan con una esfera holgada (su caja en reposo más medio metro: cabe cualquier
 * gesto, sentado o bailando): sin recorte, cada personaje se dibujaba aunque estuviera detrás de la
 * cámara, y en una ciudad con gente era casi todo el trabajo de la tarjeta gráfica.
 */
function tune(root: THREE.Object3D) {
  // Los huesos no se dibujan, pero Three.js los recorre uno a uno en cada frame buscando qué
  // dibujar: si de un esqueleto no cuelga nada que se vea (lo normal: las mallas van aparte), se le
  // dice que no entre. Sus matrices se siguen calculando igual.
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone || (o.parent as THREE.Bone | null)?.isBone) return;
    let drawn = false;
    o.traverse((c) => {
      const d = c as THREE.Mesh & THREE.Light & THREE.Sprite;
      if (d.isMesh || d.isLight || d.isSprite || (c as THREE.Line).isLine || (c as THREE.Points).isPoints) drawn = true;
    });
    if (!drawn) o.visible = false;
  });
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = false;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
        const g = m.geometry;
        g.computeBoundingBox();
        const box = g.boundingBox!.clone().expandByScalar(0.5);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        // La esfera de la malla (la que usa el recorte) y la de la geometría, por si se recalcula.
        (m as THREE.SkinnedMesh).boundingSphere = sphere;
        g.boundingSphere = sphere.clone();
        m.frustumCulled = true;
      }
      // Pestañas y cejas: transparentes, de dos caras y sin escribir profundidad. Three.js las
      // dibujaba en dos pasadas (por detrás y por delante) recompilando el material en cada una, en
      // cada frame: con veinte personas, un 10 % del trabajo de dibujar. En una pasada se ven igual.
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (mat && mat.transparent && mat.side === THREE.DoubleSide && !mat.depthWrite) mat.forceSinglePass = true;
      }
    }
  });
}

/**
 * Mientras `held()` diga que sí, los esqueletos de este personaje no se recalculan ni se vuelven a
 * subir a la tarjeta: se dibuja tal como quedó (world/crowd.ts: el frame que no le toca).
 */
export function holdSkeletons(root: THREE.Object3D, held: () => boolean) {
  const seen = new Set<THREE.Skeleton>();
  root.traverse((o) => {
    const sk = (o as THREE.SkinnedMesh).isSkinnedMesh ? (o as THREE.SkinnedMesh).skeleton : null;
    if (!sk || seen.has(sk)) return;
    seen.add(sk);
    const update = sk.update;
    sk.update = function (this: THREE.Skeleton) {
      if (!held()) update.call(this);
    };
  });
}

/**
 * Lo que cuelga de `o` no recalcula sus matrices mientras `o.userData.frozen` (world/crowd.ts: quien
 * no se ve, o el frame que no le toca). Three.js recorre y recompone cada nodo en cada frame aunque
 * no se dibuje, y un personaje son más de cien.
 */
export function freezable(o: THREE.Object3D) {
  const update = o.updateMatrixWorld;
  o.updateMatrixWorld = function (this: THREE.Object3D, force?: boolean) {
    if (!this.userData.frozen) update.call(this, force);
  };
}

/** Personajes de decorado (peatones y residentes): sin sombra, que no se note su ausencia y cuesta otra pasada. */
export function withoutShadows(root: THREE.Object3D) {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false;
  });
}

/** `decor`: gente de decorado (ciudadanos, residentes): su pelo y su ropa, solo de más cerca. */
export async function loadAvatar(url: string, opts: { decor?: boolean } = {}): Promise<LoadedAvatar> {
  const gltf = await getLoader().loadAsync(url);
  const vrm = gltf.userData.vrm as VRM | undefined;
  return vrm ? fromVrm(vrm, gltf.scene, !!opts.decor) : fromGltf(gltf.scene, gltf.animations);
}

const _sp = new THREE.Vector3();
const _hand = new THREE.Vector3();

/* ------------------------------------------------------------------ */
/* VRM: huesos humanoides estándar → andar procedural y parpadeo        */
/* ------------------------------------------------------------------ */

function fromVrm(vrm: VRM, scene: THREE.Group, decor: boolean): LoadedAvatar {
  VRMUtils.removeUnnecessaryVertices(scene);
  VRMUtils.combineSkeletons(scene);
  // El pelo con muelles (springs.ts), si el archivo no trae los suyos.
  const own = (vrm.springBoneManager?.joints.size ?? 0) > 0;
  const sb = own ? null : springBodyOf(vrm);
  let springs: ReturnType<typeof addSprings> = null;
  try {
    springs = sb ? addSprings(vrm.scene, sb) : null;
  } catch (e) {
    console.warn("[xenxo] sin física en el pelo", e);
  }
  /** Tiempo sin moverlos y dónde estaba el personaje la última vez (para volver al reposo tras un salto). */
  let springIdle = 1;
  const springAt = new THREE.Vector3(NaN, 0, 0);
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
  const handR = bone("rightHand");

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
  // Con falda o túnica larga, de pie con los pies algo más juntos (animation.ts → narrow).
  if (springs?.cloth) animator.narrow = SKIRT_STANCE;
  let blinkIn = 2 + Math.random() * 3;
  let blinkT = -1;

  return {
    object,
    update: (dt, m, view) => {
      if (animator.ready) {
        if (m.fx) m.fx.rig = animator.rig;
        animator.update(dt, m.speed, m.airborne, m.pk ?? m.emote, !!m.fight, m.fx, m.gesture, m.pk ? m.pkP : undefined, m.vy);
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
      // Con el arma sacada: dónde ha quedado la mano derecha (ya con el IK), para ponerle el arma.
      if (m.weapon && handR) {
        handR.getWorldPosition(_hand);
        object.worldToLocal(_hand);
        const h = (m.hand ??= { x: 0, y: 0, z: 0, ok: false });
        h.x = _hand.x;
        h.y = _hand.y;
        h.z = _hand.z;
        h.ok = true;
      }
      if (springs) {
        // Solo cerca de la cámara; tras un rato sin moverlos o un salto de sitio, desde el reposo.
        const range = graphics.features.springs * (decor ? 0.5 : 1);
        object.getWorldPosition(_sp);
        const on = range > 0 && (!view || _sp.distanceToSquared(view) < range * range);
        if (on) {
          if (springIdle > 0.5 || !(springAt.distanceToSquared(_sp) < 9)) springs.reset();
          springs.update(dt);
          springIdle = 0;
        } else {
          // Al dejar de moverlos, en reposo (si no, el pelo o la ropa se quedaban a medio vaivén).
          if (springIdle === 0) springs.reset();
          springIdle += dt;
        }
        springAt.copy(_sp);
      }
    },
    rig: animator.rig,
    dispose: () => {
      animator.rig.cancelFall();
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
