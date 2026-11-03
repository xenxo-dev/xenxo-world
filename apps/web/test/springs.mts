/**
 * Prueba del pelo y la ropa con física sin navegador (world/springs.ts con los VRM de serie de
 * verdad): a quién le salen cadenas (coleta, trenza, melena y falda sí; pelo corto y pantalones no),
 * que los pesos nuevos sumen uno y apunten a huesos que existen, que el pelo se quede atrás al correr
 * y vuelva al reposo al pararse, sin NaN, y lo que cuesta.
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

// Quién debe tener qué (pelo largo: coleta, trenza, melena por la barbilla; falda: el traje de Mar).
const expect: Record<string, { hair: boolean; cloth: boolean }> = {
  alba: { hair: true, cloth: false },
  iris: { hair: true, cloth: false },
  mar: { hair: true, cloth: true },
  nora: { hair: false, cloth: false },
  dani: { hair: false, cloth: false },
  kai: { hair: false, cloth: false },
  leo: { hair: false, cloth: false },
  sam: { hair: false, cloth: false },
};

console.log("Avatares de serie:");
for (const id of Object.keys(expect)) {
  const vrm = await load(id);
  const s = addSprings(vrm.scene, springBodyOf(vrm)!);
  const hair = s?.hair ?? 0, cloth = s?.cloth ?? 0;
  console.log(`  ${id}: ${hair} cadenas de pelo, ${cloth} de ropa, ${s?.joints ?? 0} huesos con muelle`);
  check(expect[id]!.hair === hair > 0, `${id}: pelo ${expect[id]!.hair ? "con" : "sin"} física`);
  check(expect[id]!.cloth === cloth > 0, `${id}: ropa ${expect[id]!.cloth ? "con" : "sin"} física`);
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

if (fails) {
  console.log(`\n${fails} fallo(s)`);
  process.exit(1);
}
console.log("\npelo y ropa: todo bien");
