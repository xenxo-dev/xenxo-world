#!/usr/bin/env node
// Rueda planos del mundo sin tiempo real: fotograma a fotograma, con el reloj de la página parado,
// y los monta con ffmpeg. Sirve para grabar los vídeos de xenxo en una máquina sin tarjeta gráfica
// (un servidor, CI): cada fotograma tarda lo que tarde, y el vídeo sale fluido igual.
//
//   npm run dev:realtime & npm run dev:web        (la web de desarrollo: permite colocar al personaje)
//   node tools/cine/render.mjs tools/cine/guion.example.json [nombre-del-plano]
//
// Hace falta Playwright con su Chromium (`npx playwright install chromium`) y ffmpeg. El formato del
// guion, en tools/cine/README.md. Con una tarjeta gráfica de verdad es más cómodo grabar a mano:
// tecla K dentro del mundo (modo cine).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const [file, only] = process.argv.slice(2);
if (!file) {
  console.error("uso: node tools/cine/render.mjs <guion.json> [nombre-del-plano]");
  process.exit(1);
}
const script = JSON.parse(readFileSync(file, "utf8"));
const base = (script.url ?? "http://localhost:5173").replace(/\/+$/, "");
const fps = script.fps ?? 30;
const outDir = resolve(dirname(file), script.out ?? "videos");
mkdirSync(outDir, { recursive: true });

// Playwright: el del proyecto o, si no está, uno global (PLAYWRIGHT_PATH=/ruta/a/node_modules/).
let chromium;
try {
  ({ chromium } = createRequire(process.env.PLAYWRIGHT_PATH ?? import.meta.url)("playwright"));
} catch {
  console.error("no encuentro Playwright: instálalo (npm i -D playwright && npx playwright install chromium) o pon PLAYWRIGHT_PATH");
  process.exit(1);
}

const FRAMES = { "9x16": [1080, 1920], "16x9": [1920, 1080], "1x1": [1080, 1080] };

/** En la página, antes que la web: sus preferencias y un reloj que solo avanza cuando se le pide. */
function prepare({ quality, ambience }) {
  localStorage.setItem("xenxo:quality", JSON.stringify(quality));
  localStorage.setItem("xenxo:ambience", JSON.stringify(ambience));
  // Sin la tarjeta de «qué hacer aquí» ni el consejo del nexo delante.
  localStorage.setItem("xenxo:guide.seen", JSON.stringify(["vertical", "arcade", "pixel", "cero", "taller", "nexo"]));
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  const base = Date.now() - realNow();
  let virtual = null;
  let queue = [];
  performance.now = () => virtual ?? realNow();
  Date.now = () => Math.round(base + (virtual ?? realNow()));
  window.requestAnimationFrame = (fn) => {
    if (virtual === null) return realRaf(fn);
    queue.push(fn);
    return queue.length;
  };
  window.__freeze = () => {
    virtual = realNow();
  };
  window.__step = (ms) => {
    virtual += ms;
    const q = queue;
    queue = [];
    for (const fn of q) fn(virtual);
  };
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
let failed = 0;

for (const shot of script.shots) {
  if (only && shot.name !== only) continue;
  const frame = shot.frame ?? script.frame ?? "9x16";
  const size = FRAMES[frame];
  if (!size) throw new Error(`${shot.name}: encuadre desconocido (${frame}); vale 9x16, 16x9 o 1x1`);
  const seconds = shot.seconds ?? 6;
  const total = Math.round(seconds * fps);
  const tmp = join(outDir, `.${shot.name}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const t0 = Date.now();
  console.log(`▶ ${shot.name}: ${shot.place} · ${shot.cam ?? "orbit"} · ${frame} · ${seconds} s (${total} fotogramas)`);

  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, locale: shot.lang === "en" ? "en-GB" : "es-ES" });
  await ctx.addInitScript(prepare, { quality: shot.quality ?? script.quality ?? "medium", ambience: shot.ambience ?? script.ambience ?? "night" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  (error de la página: ${e.message.slice(0, 160)})`));
  try {
    const q = new URLSearchParams({ cine: "follow", frame, bar: "0", ...(shot.self === false ? { self: "0" } : {}) });
    await page.goto(`${base}${shot.place}?${q}`, { waitUntil: "load", timeout: 180_000 });
    await page.waitForSelector("#splash", { state: "detached", timeout: 300_000 }).catch(() => {});
    // Que cargue el lugar (en tiempo real: los modelos y las texturas llegan a su ritmo).
    await page.waitForTimeout((shot.settle ?? script.settle ?? 30) * 1000);
    if (shot.at) {
      const ok = await page.evaluate(({ at, yaw }) => (globalThis.__xenxoTeleport ? (globalThis.__xenxoTeleport(at, yaw ?? 0), true) : false), { at: shot.at, yaw: shot.yaw });
      if (!ok) console.log("  («at» solo funciona con la web de desarrollo: se queda donde está)");
      await page.waitForTimeout(4000);
    }
    // Mirar: arrastrar el ratón [x, y] en píxeles (y < 0 sube la vista) y la rueda (zoom).
    if (shot.drag) {
      await page.mouse.move(size[0] / 2, size[1] / 2);
      await page.mouse.down();
      await page.mouse.move(size[0] / 2 + shot.drag[0], size[1] / 2 + shot.drag[1], { steps: 8 });
      await page.mouse.up();
    }
    if (shot.zoom) await page.mouse.wheel(0, shot.zoom);
    await page.waitForTimeout(1500);

    await page.evaluate(() => window.__freeze());
    // El plano empieza ahora, desde donde ha quedado la cámara.
    const cam = shot.cam ?? "orbit";
    const set = await page.evaluate((c) => (globalThis.__xenxoCine ? (globalThis.__xenxoCine({ cam: c }), true) : false), cam);
    if (!set && cam !== "follow") console.log("  (la cámara del plano solo se elige sola con la web de desarrollo: queda la de siempre)");

    // Lo que hace el personaje, en segundos del vídeo: { t, hold: "KeyW", for: 3 } o { t, press: "Digit2" }.
    const events = [];
    for (const a of shot.actions ?? []) {
      if (a.hold) events.push({ t: a.t, down: a.hold }, { t: a.t + (a.for ?? 1), up: a.hold });
      if (a.press) events.push({ t: a.t, down: a.press }, { t: a.t + 0.08, up: a.press });
    }
    events.sort((x, y) => x.t - y.t);

    for (let i = 0; i < total; i++) {
      const now = i / fps;
      while (events.length && events[0].t <= now) {
        const e = events.shift();
        if (e.down) await page.keyboard.down(e.down);
        else await page.keyboard.up(e.up);
      }
      await page.evaluate((ms) => window.__step(ms), 1000 / fps);
      writeFileSync(join(tmp, `${String(i).padStart(5, "0")}.jpg`), await page.screenshot({ type: "jpeg", quality: 95, timeout: 900_000 }));
      if (i === 0 || (i + 1) % fps === 0) console.log(`  ${i + 1}/${total} (${Math.round((Date.now() - t0) / 1000)} s)`);
    }

    const out = join(outDir, `${shot.name}.mp4`);
    const ff = spawnSync(
      "ffmpeg",
      ["-y", "-v", "error", "-framerate", String(fps), "-i", join(tmp, "%05d.jpg"), "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
      { stdio: "inherit" },
    );
    if (ff.status !== 0) throw new Error("ffmpeg no pudo montar el vídeo (¿está instalado?)");
    if (!script.keepFrames) rmSync(tmp, { recursive: true, force: true });
    console.log(`  ✓ ${out}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${shot.name}: ${e.message}`);
  }
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
