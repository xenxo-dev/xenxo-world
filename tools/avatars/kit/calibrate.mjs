/**
 * Calibración de la funda desde una foto: renderiza las fundas neutras (mujer y hombre) de frente,
 * les pasa el mismo detector de caras que usa la web (MediaPipe) y mide cuánto cambia cada medida de
 * la cara al mover cada ajuste (face-measure.ts). Escribe apps/web/public/fundas/vision/calibration.json.
 *
 * Uso: con la web en marcha (`npm run dev -w @xenxo/web`), `node tools/avatars/kit/calibrate.mjs`.
 * Necesita Playwright (ya está en el entorno de desarrollo).
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const URL = process.env.XENXO_WEB ?? "http://localhost:5173/";
const STEP = 0.8;

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("error:", e.message));
page.on("requestfailed", (r) => console.log("failed:", r.url()));
page.on("response", (r) => r.status() >= 400 && console.log("http", r.status(), r.url()));
page.on("console", (m) => m.type() === "error" && console.log("console:", m.text().slice(0, 200)));
await page.goto(URL);
await page.waitForFunction(() => performance.getEntriesByType("resource").some((e) => e.name.includes("/deps/three.js")), null, { timeout: 120000 });
await page.waitForTimeout(4000);

const result = await page.evaluate(async (STEP) => {
  const url = (part) => performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes(part)) ?? part;
  const THREE = await import(url("/deps/three.js"));
  const { buildPreview } = await import("/src/fundas/three.ts");
  const { faceLandmarker } = await import("/src/fundas/photo.ts");
  const { measureFace, MEASURES, PHOTO_SLIDERS } = await import("/src/fundas/face-measure.ts");
  const { defaultRecipe } = await import("/src/fundas/recipe.ts");
  const det = await faceLandmarker();
  const W = 560, H = 560;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#8a8f99");
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(0.3, 2, 3);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(32, W / H, 0.05, 10);
  async function measure(r) {
    const { group } = await buildPreview(r);
    scene.add(group);
    const box = new THREE.Box3().setFromObject(group.getObjectByName(`body_${r.base}`));
    const y = box.max.y - 0.13;
    cam.position.set(0, y, 0.62);
    cam.lookAt(0, y, 0);
    renderer.render(scene, cam);
    scene.remove(group);
    const res = det.detect(canvas);
    const lm = res.faceLandmarks[0];
    return lm ? Array.from(measureFace(lm, W, H) ?? []) : null;
  }
  const bases = {};
  for (const base of ["f", "m"]) {
    const r0 = { ...defaultRecipe(base), parts: { brows: base === "f" ? "brows_10" : "brows_01", top: base === "f" ? "top_tee_f" : "top_tee", bottom: "bot_cargo" } };
    const m0 = await measure(r0);
    if (!m0?.length) throw new Error(`sin cara en la funda neutra ${base}`);
    const jac = MEASURES.map(() => PHOTO_SLIDERS.map(() => 0));
    for (let s = 0; s < PHOTO_SLIDERS.length; s++) {
      const id = PHOTO_SLIDERS[s];
      const hi = await measure({ ...r0, face: { [id]: STEP } });
      const lo = await measure({ ...r0, face: { [id]: -STEP } });
      if (!hi?.length || !lo?.length) continue;
      for (let i = 0; i < MEASURES.length; i++) jac[i][s] = (hi[i] - lo[i]) / (2 * STEP);
    }
    bases[base] = { m0, jac };
  }
  return { measures: [...MEASURES], sliders: [...PHOTO_SLIDERS], bases };
}, STEP);

const out = join(ROOT, "apps", "web", "public", "fundas", "vision", "calibration.json");
writeFileSync(out, JSON.stringify(result));
for (const b of ["f", "m"]) {
  console.log(b, "m0", result.bases[b].m0.map((v) => v.toFixed(3)).join(" "));
  result.sliders.forEach((s, j) => {
    const col = result.bases[b].jac.map((row) => row[j]);
    const top = col.map((v, i) => [Math.abs(v / (result.bases[b].m0[i] || 1)), result.measures[i]]).sort((a, c) => c[0] - a[0])[0];
    console.log(`  ${s.padEnd(14)} → ${top[1]} (${(top[0] * 100).toFixed(1)} %/unidad)`);
  });
}
console.log("escrito", out);
await browser.close();
