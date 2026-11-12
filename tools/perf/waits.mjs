#!/usr/bin/env node
// ¿Se queda algo por compilar cuando el mundo ya se ve? Lo cuenta sin un PC con tarjeta gráfica.
//
// La primera vez que algo se dibuja, Three.js compila su shader y espera. En Windows (Direct3D) son
// unos 0,3 s por cada material con luces, con la página congelada; en la gráfica por software de un
// servidor no se nota, así que el fallo no se ve hasta medirlo en un PC de verdad. Aquí se simula esa
// gráfica dentro de la página: cada programa tarda (0,3 s los de luces, 60 ms el resto), se compilan
// de cuatro en cuatro en segundo plano (KHR_parallel_shader_compile) y quien pregunta por uno sin
// acabar espera, y se apunta. Lo que hace el mundo para que nadie espere está en
// apps/web/src/world/warm.ts.
//
//   npm run dev:realtime & npm run dev:web
//   node tools/perf/waits.mjs taller/zona --ambience=day
//   node tools/perf/waits.mjs arcade --portal           (cruza la puerta del distrito hacia el nexo)
//   node tools/perf/waits.mjs plaza --level=ultra --url=http://localhost:5173
//
// Opciones: --level=low|medium|high|ultra (high) · --ambience=day|night (night) · --wait=<s> tras
// quitarse la pantalla de carga (12) · --portal · --url (http://localhost:5173) · --all (lista también
// las esperas con la pantalla de carga puesta).
//
// Cuenta las esperas con la pantalla de carga puesta (nadie las ve), después sin tocar nada, al girar
// 360° y, con --portal, al cruzar la puerta. Acaba con código 1 si hay alguna cuando el mundo ya se
// ve, salvo las de fabricar un mapa de entorno, que se dibujan en el momento (el cielo de día al
// entrar en un distrito). La web de desarrollo carga despacio: si la pantalla de carga se quita por
// su plazo (15 s) antes de que el lugar esté preparado, saldrán esperas que con la web compilada no
// hay (`npm run build` y servir apps/web/dist en el 5173).
//
// Hace falta Playwright con su Chromium (como tools/cine/render.mjs): el del proyecto o
// PLAYWRIGHT_PATH=/ruta/a/node_modules/.
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const opt = (name, def) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${def}`).split("=").slice(1).join("=");
const flag = (name) => args.includes(`--${name}`);
const place = args.find((a) => !a.startsWith("--")) ?? "plaza";
const base = opt("url", "http://localhost:5173").replace(/\/+$/, "");
const level = opt("level", "high"), ambience = opt("ambience", "night"), waitS = Number(opt("wait", "12"));

let chromium;
try {
  ({ chromium } = createRequire(process.env.PLAYWRIGHT_PATH ?? import.meta.url)("playwright"));
} catch {
  console.error("no encuentro Playwright: instálalo (npm i -D playwright && npx playwright install chromium) o pon PLAYWRIGHT_PATH");
  process.exit(2);
}

/** Dentro de la página, antes que nada: la gráfica lenta. */
function slowGpu() {
  const STALLS = (globalThis.__waits = []);
  const SPLASH = (globalThis.__splash = { had: false, gone: 0 });
  const LIT = /SHADER_TYPE Mesh(Standard|Physical|Lambert|Phong|Toon)Material/;
  const label = (f) => {
    const type = (f.match(/#define SHADER_TYPE (\w+)/) || [])[1] || "?";
    const name = ((f.match(/#define SHADER_NAME ([^\n]*)/) || [])[1] || "").trim();
    return name ? `${type} «${name.slice(0, 30)}»` : type;
  };
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const gl = get.call(this, type, ...rest);
    if (!gl || type !== "webgl2" || gl.__slow) return gl;
    gl.__slow = true;
    const workers = [0, 0, 0, 0];
    const getExtension = gl.getExtension.bind(gl);
    gl.getExtension = (n) => (n === "KHR_parallel_shader_compile" ? {} : getExtension(n));
    const shaderSource = gl.shaderSource.bind(gl);
    gl.shaderSource = (s, src) => {
      s.__src = src;
      return shaderSource(s, src);
    };
    const attachShader = gl.attachShader.bind(gl);
    gl.attachShader = (p, s) => {
      if (s.__src && !/gl_Position/.test(s.__src)) p.__fs = s.__src;
      return attachShader(p, s);
    };
    const linkProgram = gl.linkProgram.bind(gl);
    gl.linkProgram = (p) => {
      globalThis.__links = (globalThis.__links || 0) + 1;
      let i = 0;
      for (let k = 1; k < workers.length; k++) if (workers[k] < workers[i]) i = k;
      p.__done = workers[i] = Math.max(performance.now(), workers[i]) + (LIT.test(p.__fs || "") ? 300 : 60);
      return linkProgram(p);
    };
    /** Quien necesita el programa ya, espera a que acabe (como la página de verdad). */
    const block = (p) => {
      if (!p || p.__done === undefined || p.__used) return;
      p.__used = true;
      const left = p.__done - performance.now();
      if (left <= 1) return;
      STALLS.push({ at: Math.round(performance.now()), ms: Math.round(left), what: label(p.__fs || "") });
      while (performance.now() < p.__done) {
        /* esperando */
      }
    };
    const getProgramParameter = gl.getProgramParameter.bind(gl);
    gl.getProgramParameter = (p, e) => {
      if (e === 0x91b1) return performance.now() >= (p.__done ?? 0); // COMPLETION_STATUS_KHR: sin esperar
      block(p);
      return getProgramParameter(p, e);
    };
    for (const name of ["getProgramInfoLog", "getUniformLocation", "getActiveUniform", "getActiveAttrib", "getAttribLocation", "useProgram"]) {
      const orig = gl[name].bind(gl);
      gl[name] = (p, ...a) => {
        block(p);
        return orig(p, ...a);
      };
    }
    return gl;
  };
  const watch = () => {
    if (document.querySelector("#splash")) SPLASH.had = true;
    else if (SPLASH.had && !SPLASH.gone) SPLASH.gone = Math.round(performance.now());
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
await ctx.addInitScript(`globalThis.__name = (f) => f; (${slowGpu.toString()})(); try { localStorage.setItem("xenxo:quality", ${JSON.stringify(JSON.stringify(level))}); localStorage.setItem("xenxo:ambience", ${JSON.stringify(JSON.stringify(ambience))}); } catch {}`);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
await page.goto(`${base}/d/${place}`, { waitUntil: "load", timeout: 180000 });
await page.waitForSelector("#splash", { state: "detached", timeout: 240000 }).catch(() => {});
await page.waitForTimeout(waitS * 1000);
const now = () => page.evaluate(() => Math.round(performance.now()));
const key = (code, ms) =>
  page.evaluate(
    ([code, ms]) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true })), ms);
    },
    [code, ms],
  );
/** Gira la cámara 360° (arrastrando el ratón), como quien mira alrededor al llegar. */
const spin = (secs) =>
  page.evaluate(
    (secs) =>
      new Promise((done) => {
        const el = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        el.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, pointerType: "mouse", clientX: 100, clientY: 100, bubbles: true }));
        const t0 = performance.now();
        const step = () => {
          const k = Math.min(1, (performance.now() - t0) / (secs * 1000));
          window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, pointerType: "mouse", clientX: 100 + k * 1257, clientY: 100, bubbles: true }));
          if (k < 1) return void requestAnimationFrame(step);
          window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, pointerType: "mouse", bubbles: true }));
          done();
        };
        requestAnimationFrame(step);
      }),
    secs,
  );

const tSpin = await now();
await spin(10);
await page.waitForTimeout(3000);
let tPortal = 0, tEnd = await now(), crossed = true;
if (flag("portal")) {
  // Se llega mirando hacia dentro: andando hacia atrás se cruza la puerta, hacia el nexo.
  tPortal = tEnd;
  const before = await page.evaluate(() => globalThis.__links || 0);
  await key("KeyS", 8000);
  await page.waitForTimeout(8000 + waitS * 1000);
  tEnd = await now();
  // Otro lugar son otros shaders: si no se ha compilado ninguno, no se ha cruzado nada.
  crossed = (await page.evaluate(() => globalThis.__links || 0)) > before;
}
const { waits, splash } = await page.evaluate(() => ({ waits: globalThis.__waits, splash: globalThis.__splash.gone || 1e12 }));
await browser.close();

/** Fabricar un mapa de entorno se dibuja en el momento (no se puede preparar antes). */
const OWN = /PMREM|Cubemap|EquirectangularToCubeUV|SphericalGaussianBlur/;
const groups = [
  ["con la pantalla de carga puesta", waits.filter((w) => w.at <= splash), false],
  ["después, sin tocar nada", waits.filter((w) => w.at > splash && w.at <= tSpin), true],
  ["al girar 360°", waits.filter((w) => w.at > tSpin && w.at <= (tPortal || tEnd)), true],
  ...(tPortal ? [["al cruzar la puerta", waits.filter((w) => w.at > tPortal), true]] : []),
];
console.log(`\n${place} · nivel ${level} · ${ambience === "day" ? "de día" : "de noche"} · pantalla de carga fuera a los ${splash > 1e11 ? "?" : (splash / 1000).toFixed(1)} s`);
let bad = 0;
for (const [title, rows, counts] of groups) {
  const ms = rows.reduce((a, r) => a + r.ms, 0);
  console.log(`  ${title}: ${rows.length ? `${rows.length} esperas, ${ms} ms` : "ninguna espera"}`);
  if (counts || flag("all")) for (const r of rows) console.log(`      ${String(r.ms).padStart(4)} ms  ${r.what}${OWN.test(r.what) ? "  (mapa de entorno)" : ""}`);
  if (counts) bad += rows.filter((r) => !OWN.test(r.what)).length;
}
if (errors.length) console.log("  errores de la página:", [...new Set(errors)].slice(0, 4).join(" | "));
if (!crossed) {
  console.log("\nNo se ha cruzado ninguna puerta (andando hacia atrás desde donde se llega no hay ninguna): prueba con la entrada de un distrito (arcade, cero, pixel…).");
  process.exit(2);
}
console.log(bad ? `\n${bad} espera(s) con el mundo a la vista: algo se compila al dibujarlo (apps/web/src/world/warm.ts).` : "\nNada espera con el mundo a la vista.");
process.exit(bad || errors.length ? 1 : 0);
