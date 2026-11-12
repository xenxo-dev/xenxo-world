/**
 * Prueba del pelo y la ropa con física sin navegador (world/springs.ts con los VRM de serie de verdad):
 * a quién le salen cadenas (coleta, trenza y melena sí; pelo corto no; la falda sí, a medias con las
 * piernas; pantalones y chaquetas no), que los pesos nuevos sumen uno y apunten a huesos que existen,
 * que el pelo y la falda se queden atrás al correr y vuelvan al reposo al pararse, que las piernas no
 * atraviesen la falda, sin NaN, y lo que cuesta.
 *
 *   npm run test:springs -w @xenxo/web
 */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { addSprings, springBodyOf } from "../src/world/springs.ts";

// Sin navegador no hay imágenes: el cargador avisa y sigue sin texturas (aquí no hacen falta).
const quiet = console.error;
console.error = (...a: unknown[]) => (String(a[0]).includes("Couldn't load texture") ? undefined : quiet(...a));
console.warn = () => {};

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};

const presets = JSON.parse(readFileSync(new URL("../src/world/avatar-presets.json", import.meta.url), "utf8")) as { id: string; hash: string }[];
const loader = new GLTFLoader();
loader.register((p) => new VRMLoaderPlugin(p));

/** El GLB sin imágenes ni texturas (en Node no se pueden decodificar y aquí no hacen falta). */
function withoutTextures(file: Buffer): ArrayBuffer {
  const jsonLen = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLen).toString("utf8"));
  const strip = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) if (!/texture$/i.test(k)) out[k] = strip(v);
      return out;
    }
    return o;
  };
  delete json.images;
  delete json.textures;
  delete json.samplers;
  json.materials = strip(json.materials);
  if (json.extensions) json.extensions = strip(json.extensions);
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((e: string) => !/texture/i.test(e));
  json.extensionsRequired = (json.extensionsRequired ?? []).filter((e: string) => !/texture/i.test(e));
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const jsonBuf = Buffer.from(text, "utf8");
  const rest = file.subarray(20 + jsonLen);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + jsonBuf.length + rest.length, 8);
  head.writeUInt32LE(jsonBuf.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, jsonBuf, rest]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

async function load(id: string): Promise<VRM> {
  const p = presets.find((x) => x.id === id)!;
  const file = readFileSync(new URL(`../../realtime/seed-assets/s/${p.hash.split(":")[1]}.glb`, import.meta.url));
  const ab = withoutTextures(file);
  const gltf = await new Promise<{ userData: { vrm: VRM }; scene: THREE.Group }>((ok, ko) => loader.parse(ab, "", ok as never, ko));
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  return vrm;
}

// Quién lleva pelo con física (pelo largo: coleta, trenza, melena por la barbilla).
const expect: Record<string, boolean> = { alba: true, iris: true, mar: true, nora: false, dani: false, kai: false, leo: false, sam: false };
// Quién lleva ropa suelta por debajo de la cadera (la falda de Mar; los trajes y pantalones, no).
const skirt: Record<string, boolean> = { mar: true };

console.log("Avatares de serie:");
for (const id of Object.keys(expect)) {
  const vrm = await load(id);
  const s = addSprings(vrm.scene, springBodyOf(vrm)!);
  const hair = s?.hair ?? 0, cloth = s?.cloth ?? 0;
  console.log(`  ${id}: ${hair} cadenas de pelo, ${cloth} de ropa, ${s?.joints ?? 0} huesos con muelle`);
  check(expect[id] === hair > 0, `${id}: pelo ${expect[id] ? "con" : "sin"} física`);
  check(!!skirt[id] === cloth > 0, `${id}: ${skirt[id] ? "la falda, con física" : "la ropa, sin muelles (nada suelto por debajo de la cadera)"}`);
  if (!s) continue;
  // Pesos: suman uno y apuntan a huesos del esqueleto.
  let bad = 0;
  vrm.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const si = m.geometry.getAttribute("skinIndex"), sw = m.geometry.getAttribute("skinWeight");
    for (let i = 0; i < si.count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += sw.getComponent(i, k);
        if (sw.getComponent(i, k) > 0 && si.getComponent(i, k) >= m.skeleton.bones.length) bad++;
      }
      if (Math.abs(sum - 1) > 0.02) bad++;
    }
  });
  check(bad === 0, `${id}: pesos que suman uno y a huesos que existen`);
}

// La coleta de Alba: corriendo se queda atrás; parada, vuelve al reposo.
{
  const vrm = await load("alba");
  const s = addSprings(vrm.scene, springBodyOf(vrm)!)!;
  const tips: THREE.Object3D[] = [];
  vrm.scene.traverse((o) => {
    if (o.name.startsWith("hair_") && o.children.every((c) => !c.name.startsWith("hair_"))) tips.push(o);
  });
  const tip = tips[0]!;
  const rest = new THREE.Vector3();
  const head = vrm.humanoid.getRawBoneNode("head")!;
  const rel = (out: THREE.Vector3) => {
    vrm.scene.updateMatrixWorld(true);
    return out.setFromMatrixPosition(tip.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(head.matrixWorld));
  };
  const dt = 1 / 60;
  for (let i = 0; i < 120; i++) s.update(dt);
  rel(rest);
  // Corre hacia +Z a 6 m/s medio segundo (el personaje mira a +Z): la punta se va hacia atrás (−Z).
  let lag = 0, nan = false;
  const t0 = performance.now();
  for (let i = 0; i < 30; i++) {
    vrm.scene.position.z += 6 * dt;
    s.update(dt);
    const r = rel(new THREE.Vector3());
    lag = Math.max(lag, rest.z - r.z);
    if (!Number.isFinite(r.x + r.y + r.z)) nan = true;
  }
  const ms = (performance.now() - t0) / 30;
  for (let i = 0; i < 180; i++) s.update(dt);
  const back = rel(new THREE.Vector3()).distanceTo(rest);
  console.log(`  coleta: se queda ${(lag * 100).toFixed(1)} cm atrás al correr; parada, a ${(back * 100).toFixed(1)} cm del reposo; ${ms.toFixed(3)} ms por frame (${s.joints} huesos)`);
  check(lag > 0.02, "corriendo, la coleta se queda atrás");
  check(back < 0.03, "parada, vuelve al reposo");
  check(!nan, "nada se vuelve NaN");
  check(ms < 0.5, "cuesta poco (menos de 0,5 ms por frame en Node)");
}

// La falda de Mar: va a medias con las piernas, corriendo se queda atrás, y las piernas no la atraviesan.
{
  const vrm = await load("mar");
  const s = addSprings(vrm.scene, springBodyOf(vrm)!)!;
  const tips: THREE.Object3D[] = [];
  vrm.scene.traverse((o) => {
    if (o.name.startsWith("cloth_") && o.children.every((c) => !c.name.startsWith("cloth_"))) tips.push(o);
  });
  // Lo más que va con la cadena un vértice de la falda (el resto, con las piernas, como estaba).
  let most = 0;
  vrm.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const si = m.geometry.getAttribute("skinIndex"), sw = m.geometry.getAttribute("skinWeight");
    for (let i = 0; i < si.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (m.skeleton.bones[si.getComponent(i, k)]?.name.startsWith("cloth_")) w += sw.getComponent(i, k);
      most = Math.max(most, w);
    }
  });
  check(most > 0.3 && most <= 0.51, `cada vértice de la falda va como mucho a medias con su cadena (${most.toFixed(2)}): el resto, con las piernas`);
  const hips = vrm.humanoid.getRawBoneNode("hips")!;
  const dt = 1 / 60;
  const tipZ = () => {
    vrm.scene.updateMatrixWorld(true);
    let z = 0;
    for (const t of tips) z += new THREE.Vector3().setFromMatrixPosition(t.matrixWorld).z - new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld).z;
    return z / tips.length;
  };
  for (let i = 0; i < 120; i++) s.update(dt);
  const rest = tipZ();
  let lag = 0, nan = false;
  for (let i = 0; i < 30; i++) {
    vrm.scene.position.z += 6 * dt;
    s.update(dt);
    const z = tipZ();
    if (!Number.isFinite(z)) nan = true;
    lag = Math.max(lag, rest - z);
  }
  for (let i = 0; i < 240; i++) s.update(dt);
  const back = Math.abs(tipZ() - rest);
  console.log(`  falda: ${tips.length} cadenas; se queda ${(lag * 100).toFixed(1)} cm atrás al correr; parada, a ${(back * 100).toFixed(1)} cm del reposo`);
  check(lag > 0.01, "corriendo, la falda se queda atrás");
  check(back < 0.03 && !nan, "parada, vuelve al reposo (y nada se vuelve NaN)");
  // Una zancada: el muslo izquierdo, 45° hacia delante. Las puntas de las cadenas no se quedan dentro de él.
  const leg = vrm.humanoid.getRawBoneNode("leftUpperLeg")!, knee = vrm.humanoid.getRawBoneNode("leftLowerLeg")!;
  const q0 = leg.quaternion.clone();
  let inside = 0;
  for (let i = 0; i < 40; i++) {
    const a = (Math.min(1, i / 15) * Math.PI) / 4;
    vrm.scene.updateMatrixWorld(true);
    // Hacia delante es hacia +Z (el personaje mira a +Z): el giro que lleva la rodilla hacia ahí.
    const hipW = new THREE.Vector3().setFromMatrixPosition(leg.matrixWorld);
    const axis = new THREE.Vector3(1, 0, 0);
    const parentQ = leg.parent!.getWorldQuaternion(new THREE.Quaternion());
    const localAxis = axis.clone().applyQuaternion(parentQ.clone().invert());
    leg.quaternion.copy(q0).premultiply(new THREE.Quaternion().setFromAxisAngle(localAxis, -a));
    s.update(dt);
    vrm.scene.updateMatrixWorld(true);
    const kneeW = new THREE.Vector3().setFromMatrixPosition(knee.matrixWorld);
    if (i === 39 && kneeW.z - hipW.z < 0.1) inside = -1; // la zancada no ha ido hacia delante: la prueba no vale
    for (const t of tips) {
      const p = new THREE.Vector3().setFromMatrixPosition(t.matrixWorld);
      const d = new THREE.Line3(hipW, kneeW).closestPointToPoint(p, true, new THREE.Vector3()).distanceTo(p);
      if (i === 39 && d < 0.07) inside++;
    }
  }
  check(inside === 0, inside < 0 ? "la zancada de la prueba no va hacia delante" : "con el muslo adelantado, ninguna cadena de la falda se queda dentro de él");
}

if (fails) {
  console.log(`\n${fails} fallo(s)`);
  process.exit(1);
}
console.log("\npelo y ropa: todo bien");
