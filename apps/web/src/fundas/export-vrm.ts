/**
 * Exporta una funda a VRM 1.0 en el navegador: la escena con esqueleto en pose T (three.ts) pasa por
 * el GLTFExporter de Three.js y se le añade `VRMC_vrm` (huesos humanoides y metadatos). Las texturas
 * van en WebP. La receta viaja dentro del archivo (`extras` de la raíz, «xenxo:funda») para volver a
 * editarla: no hace falta guardar nada aparte.
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { kitData, buildSkinned } from "./three";
import { RECIPE_KEY, type Recipe } from "./recipe";

export interface FundaFile {
  bytes: Uint8Array;
  tris: number;
}

/**
 * Sin datos de la persona dentro del archivo (se sirve por su huella a quien lo pida): ni su nombre ni
 * el de la funda; solo la receta.
 */
export async function exportFunda(r: Recipe): Promise<FundaFile> {
  const { kit } = await kitData();
  const { root, bones, tris } = await buildSkinned(r);
  // WebP si el navegador sabe hacerlo (Safari no): si no, JPEG o PNG (con transparencia).
  const webp = canWebp();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.map) m.map.userData.mimeType = webp ? "image/webp" : m.alphaTest > 0 ? "image/png" : "image/jpeg";
  });
  const exporter = new GLTFExporter();
  exporter.register((writer) => ({
    afterParse() {
      const w = writer as unknown as { nodeMap: Map<THREE.Object3D, number>; extensionsUsed: Record<string, boolean>; json: Record<string, unknown> };
      const humanBones: Record<string, { node: number }> = {};
      kit.rig.bones.forEach((b, i) => {
        const vrm = kit.humanoid[b.name];
        const node = w.nodeMap.get(bones[i]!);
        if (vrm && node !== undefined) humanBones[vrm] = { node };
      });
      w.extensionsUsed["VRMC_vrm"] = true;
      const json = w.json as { extensions?: Record<string, unknown>; extras?: Record<string, unknown> };
      json.extensions = {
        ...(json.extensions ?? {}),
        VRMC_vrm: {
          specVersion: "1.0",
          meta: {
            name: "Funda de xenxo",
            version: "1",
            authors: ["xenxo.io"],
            copyrightInformation: "Hecha en el configurador de fundas de xenxo.io con recursos CC0 de MakeHuman",
            licenseUrl: "https://vrm.dev/licenses/1.0/",
            avatarPermission: "onlyAuthor",
            allowExcessivelyViolentUsage: false,
            allowExcessivelySexualUsage: false,
            commercialUsage: "personalNonProfit",
            allowPoliticalOrReligiousUsage: false,
            allowAntisocialOrHateUsage: false,
            creditNotation: "unnecessary",
            allowRedistribution: false,
            modification: "prohibited",
          },
          humanoid: { humanBones },
        },
      };
      json.extras = { ...(json.extras ?? {}), [RECIPE_KEY]: r };
    },
  }));
  const out = (await exporter.parseAsync(root, { binary: true, onlyVisible: true, maxTextureSize: 1024 })) as ArrayBuffer;
  // Liberar lo que se ha creado para exportar.
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) m.geometry.dispose();
  });
  return { bytes: new Uint8Array(out), tris };
}

let webpOk: boolean | null = null;
function canWebp(): boolean {
  if (webpOk === null) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    webpOk = c.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpOk;
}
