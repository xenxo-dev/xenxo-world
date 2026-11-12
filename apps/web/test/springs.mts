/**
 * Prueba del pelo y la ropa con física sin navegador (world/springs.ts con los VRM de serie de verdad):
 * a quién le salen cadenas (coleta, trenza y melena sí; pelo corto no) y vaivén en la ropa (la falda
 * sí; pantalones y chaquetas no), que los pesos nuevos sumen uno y apunten a huesos que existen, que
 * en reposo la falda quede igual que sin física, que el pelo y la falda se queden atrás al correr y
 * vuelvan al reposo al pararse, sin NaN, y lo que cuesta.
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
  // Arranca a correr como el cuerpo (locomotion.ts: hasta 6 m/s en unas décimas).
  for (let i = 0; i < 30; i++) {
    vrm.scene.position.z += 6 * (1 - Math.exp(-11 * i * dt)) * dt;
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

// La falda de Mar: con su vaivén, pero en reposo igual que sin física (nada se rasga ni deja ver
// las piernas), corriendo se balancea hacia atrás y parada vuelve.
{
  const plain = await load("mar");
  const vrm = await load("mar");
  const s = addSprings(vrm.scene, springBodyOf(vrm)!)!;
  // Cada vértice, con los mismos pesos: solo la cadera pasa al péndulo.
  const hipsName = plain.humanoid.getRawBoneNode("hips")!.name;
  let changed = 0, moved = 0, total = 0;
  const meshes = (v: VRM) => {
    const out: THREE.SkinnedMesh[] = [];
    v.scene.traverse((o) => void ((o as THREE.SkinnedMesh).isSkinnedMesh && out.push(o as THREE.SkinnedMesh)));
    return out;
  };
  // Solo la prenda (el pelo tiene sus propias cadenas).
  const a: THREE.SkinnedMesh[] = [], b: THREE.SkinnedMesh[] = [];
  meshes(vrm).forEach((m, i) => {
    if (m.skeleton.bones.some((x) => x.name === "cloth_sway") && /suit|skirt|dress|robe/i.test(m.name)) {
      a.push(meshes(plain)[i]!);
      b.push(m);
    }
  });
  for (let m = 0; m < a.length; m++) {
    const sa = a[m]!.geometry.getAttribute("skinWeight"), sb = b[m]!.geometry.getAttribute("skinWeight");
    const ia = a[m]!.geometry.getAttribute("skinIndex"), ib = b[m]!.geometry.getAttribute("skinIndex");
    for (let i = 0; i < sa.count; i++)
      for (let k = 0; k < 4; k++) {
        if (Math.abs(sa.getComponent(i, k) - sb.getComponent(i, k)) > 1e-6) changed++;
        const na = a[m]!.skeleton.bones[ia.getComponent(i, k)]?.name, nb = b[m]!.skeleton.bones[ib.getComponent(i, k)]?.name;
        if (na !== nb) {
          moved++;
          if (nb !== "cloth_sway" || na !== hipsName) changed++;
        }
        total++;
      }
  }
  check(changed === 0 && moved > 0, `los pesos de la falda, los mismos: solo lo de la cadera pasa al péndulo (${moved} de ${total})`);
  // En reposo, cada vértice en el mismo sitio que sin física.
  const at = (m: THREE.SkinnedMesh, i: number) => m.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(m.matrixWorld);
  const dt = 1 / 60;
  for (let i = 0; i < 120; i++) s.update(dt);
  vrm.scene.updateMatrixWorld(true);
  plain.scene.updateMatrixWorld(true);
  let worst = 0;
  for (let m = 0; m < a.length; m++) {
    const n = a[m]!.geometry.getAttribute("position").count;
    for (let i = 0; i < n; i += 7) worst = Math.max(worst, at(a[m]!, i).distanceTo(at(b[m]!, i)));
  }
  check(worst < 0.002, `en reposo, la falda queda igual que sin física (lo más que se aparta: ${(worst * 1000).toFixed(2)} mm)`);
  // Corriendo: la punta del péndulo se queda atrás; parada, vuelve.
  let tip: THREE.Object3D | null = null;
  vrm.scene.traverse((o) => void (o.name === "cloth_sway_tip" && (tip = o)));
  const hips = vrm.humanoid.getRawBoneNode("hips")!;
  const rel = () => {
    vrm.scene.updateMatrixWorld(true);
    return new THREE.Vector3().setFromMatrixPosition(tip!.matrixWorld).z - new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld).z;
  };
  const rest = rel();
  let lag = 0, nan = false;
  // Arranca a correr como el cuerpo (locomotion.ts: hasta 6 m/s en unas décimas).
  for (let i = 0; i < 30; i++) {
    vrm.scene.position.z += 6 * (1 - Math.exp(-11 * i * dt)) * dt;
    s.update(dt);
    const z = rel();
    if (!Number.isFinite(z)) nan = true;
    lag = Math.max(lag, rest - z);
  }
  for (let i = 0; i < 240; i++) s.update(dt);
  const back = Math.abs(rel() - rest);
  console.log(`  falda: el bajo se va ${(lag * 100).toFixed(1)} cm atrás al arrancar a correr; parada, a ${(back * 100).toFixed(1)} cm del reposo`);
  check(lag > 0.02 && lag < 0.15, "al arrancar a correr se balancea hacia atrás, sin pasarse");
  check(back < 0.01 && !nan, "parada, vuelve al reposo (y nada se vuelve NaN)");
}

if (fails) {
  console.log(`\n${fails} fallo(s)`);
  process.exit(1);
}
console.log("\npelo y ropa: todo bien");
