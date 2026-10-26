/**
 * Fotos de la plaza para su portada en el nexo (cámara del paseo de fondo, sin panel ni HUD).
 * Necesita `npm run dev:realtime` y `npm run dev:web` en marcha.
 *
 *   node tools/covers/capture.cjs [carpeta]       → plaza_0.png … plaza_5.png
 *   python3 tools/covers/install.py <foto.png>   → la convierte e instala como portada
 */
const { chromium } = require("playwright");
const { mkdirSync } = require("node:fs");
const { join } = require("node:path");

(async () => {
  const out = process.argv[2] ?? join(__dirname, "out");
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    localStorage.setItem("xenxo:quality", JSON.stringify("medium"));
    localStorage.setItem("xenxo:ambience", JSON.stringify("night"));
    localStorage.setItem("xenxo:lang", JSON.stringify("es"));
  });
  const page = await ctx.newPage();
  await page.goto(process.env.XENXO_WEB ?? "http://localhost:5173/");
  await page.waitForTimeout(5000);
  await page.getByRole("button", { name: /^Ir/ }).first().click(); // nexo 2D → la plaza
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: /Volver al panel/ }).click();
  await page.addStyleTag({ content: ".pointer-events-auto.absolute.inset-0{display:none!important}" });
  await page.waitForTimeout(15000);
  for (let i = 0; i < 6; i++) {
    await page.screenshot({ path: join(out, `plaza_${i}.png`), timeout: 120000 });
    await page.waitForTimeout(6000);
  }
  await browser.close();
  console.log("fotos en", out);
})();
