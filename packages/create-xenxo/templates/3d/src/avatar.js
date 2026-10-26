/**
 * El personaje del jugador: su VRM de xenxo (o una cápsula si no tiene o no carga), animado a mano
 * con sus huesos: brazos abajo, respiración al estar quieto y paso al andar. Sin archivos de
 * animación, para que la plantilla sea ligera; si quieres más, mira VRMA en AGENTS.md.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

function capsula() {
  const g = new THREE.Group();
  const cuerpo = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1, 4, 12), new THREE.MeshStandardMaterial({ color: "#4fa3ff", roughness: 0.4 }));
  cuerpo.position.y = 0.8;
  g.add(cuerpo);
  let fase = 0;
  return {
    object: g,
    update(dt, ritmo) {
      fase += dt * (2 + ritmo * 8);
      cuerpo.position.y = 0.8 + Math.abs(Math.sin(fase)) * 0.08 * ritmo;
    },
  };
}

/** Carga el avatar (VRM o GLB). `update(dt, ritmo)`: ritmo 0 = quieto, 1 = andando. */
export async function cargarAvatar(url) {
  if (!url) return capsula();
  try {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm;
    if (!vrm) {
      // Un GLB sin VRM: se enseña tal cual, sin animar.
      const g = new THREE.Group();
      g.add(gltf.scene);
      return { object: g, update() {} };
    }
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm); // los VRM 0.x miran al revés: así todos miran a +Z
    vrm.scene.traverse((o) => (o.frustumCulled = false));

    const g = new THREE.Group();
    g.add(vrm.scene);
    const hueso = (n) => vrm.humanoid.getNormalizedBoneNode(n);
    const [bi, bd, ai, ad, pi, pd, ri, rd, pecho] = [
      "leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm",
      "leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg", "chest",
    ].map(hueso);
    let fase = 0;
    let t = 0;
    return {
      object: g,
      update(dt, ritmo) {
        t += dt;
        fase += dt * 9 * ritmo;
        const paso = Math.sin(fase) * 0.6 * ritmo;
        // Brazos abajo (sin pose en T) y balanceo al andar.
        if (bi) bi.rotation.set(paso * 0.8, 0, -1.2);
        if (bd) bd.rotation.set(-paso * 0.8, 0, 1.2);
        if (ai) ai.rotation.set(0, 0, -0.15);
        if (ad) ad.rotation.set(0, 0, 0.15);
        if (pi) pi.rotation.x = -paso;
        if (pd) pd.rotation.x = paso;
        if (ri) ri.rotation.x = Math.max(0, -Math.sin(fase - 1)) * 0.9 * ritmo;
        if (rd) rd.rotation.x = Math.max(0, Math.sin(fase - 1)) * 0.9 * ritmo;
        if (pecho) pecho.rotation.x = Math.sin(t * 1.6) * 0.02; // respiración
        g.children[0].position.y = Math.abs(Math.cos(fase)) * 0.04 * ritmo;
        vrm.update(dt);
      },
    };
  } catch (e) {
    console.warn("[avatar] no se pudo cargar el personaje, uso una cápsula", e);
    return capsula();
  }
}
