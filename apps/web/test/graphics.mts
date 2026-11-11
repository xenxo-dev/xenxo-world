/**
 * Prueba de lo que decide los gráficos, sin navegador: cuándo se baja un nivel porque el equipo no
 * aguanta (world/perf.ts) y qué se dibuja en cada equipo (world/graphics.ts).
 *
 *   npm run test:graphics -w @xenxo/web
 *
 * Lo de cada equipo se prueba en un proceso aparte por equipo (la detección se hace una vez).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};

const DEVICE = process.env.XENXO_TEST_DEVICE;

if (!DEVICE) {
  const { FpsWatch, slowBelow } = await import("../src/world/perf.ts");
  type Watch = InstanceType<typeof FpsWatch>;
  /** `secs` segundos a `fps`. Devuelve cuántas veces ha pedido bajar y el reloj al acabar. */
  const run = (w: Watch, t: number, secs: number, fps: number, busy = false): [number, number] => {
    let asked = 0;
    const end = t + secs * 1000;
    for (; t < end; t += 1000 / fps) if (w.frame(t, busy)) asked++;
    return [asked, t];
  };

  console.log("Cuándo se baja un nivel");
  {
    // Lo que fallaba: tras unos segundos yendo bien, el vigilante de antes dejaba de mirar para siempre.
    const w = new FpsWatch();
    let [a, t] = run(w, 0, 600, 60);
    check(a === 0, "diez minutos a 60 no bajan nada");
    const t0 = t;
    let when = -1;
    for (; t < t0 + 30_000 && when < 0; t += 1000 / 28) if (w.frame(t, false)) when = t - t0;
    check(when > 4000 && when < 9000, `y si después cae a 28 (un distrito pesado), baja a los ${(when / 1000).toFixed(1)} s`);
    [a, t] = run(w, t, 5, 28);
    check(a === 0, "tras bajar deja unos segundos para que el nivel nuevo se asiente");
    [a, t] = run(w, t, 10, 28);
    check(a === 1, "y si sigue sin llegar, baja otro");
  }
  {
    const w = new FpsWatch();
    let [a, t] = run(w, 0, 25, 6, true);
    check(a === 0, "mientras el lugar carga (a 6 por segundo durante 25 s) no baja");
    [a, t] = run(w, t, 60, 60);
    check(a === 0, "y al acabar de cargar, yendo bien, tampoco");
  }
  {
    // Tirones sueltos: un frame de 700 ms cada cinco segundos (un shader, el recolector de basura).
    const w = new FpsWatch();
    let t = 0, asked = 0;
    for (let k = 0; k < 24; k++) {
      const [a, t2] = run(w, t, 4.3, 60);
      asked += a;
      t = t2 + 700;
      if (w.frame(t, false)) asked++;
    }
    check(asked === 0, "los tirones sueltos no son un equipo que no aguanta");
  }
  {
    // La pestaña escondida un minuto y, al volver, todo bien.
    const w = new FpsWatch();
    let [a, t] = run(w, 0, 20, 60);
    t += 60_000;
    const [b] = run(w, t, 20, 60);
    check(a + b === 0, "volver de tener la pestaña escondida no cuenta");
  }
  {
    const cases: [string, number, number, boolean][] = [
      ["pantalla de 60 Hz a 50", 60, 50, false],
      ["pantalla de 60 Hz a 40", 60, 40, true],
      ["pantalla de 144 Hz a 100", 144, 100, false],
      ["pantalla de 144 Hz a 50", 144, 50, true],
      ["gafas a 72 Hz que se quedan en la mitad (36)", 72, 36, true],
      ["gafas a 90 Hz que se quedan en la mitad (45)", 90, 45, true],
      ["gafas a 90 Hz que van a 72", 90, 72, false],
    ];
    for (const [name, hz, fps, down] of cases) {
      const w = new FpsWatch();
      const [, t] = run(w, 0, 20, hz);
      const [a] = run(w, t, 12, fps);
      check(a > 0 === down, `${name}: ${down ? "baja" : "se queda"}`);
    }
    check(slowBelow(60) === 45 && slowBelow(72) === 50 && slowBelow(90) === 50 && slowBelow(120) === 60, "lo que pide cada pantalla");
  }
  {
    // Un equipo que nunca llega: no sabe cuánto da la pantalla, pero 30 es poco en todas.
    const w = new FpsWatch();
    const [a] = run(w, 0, 20, 30);
    check(a >= 1, "un equipo que va a 30 desde el principio baja");
  }

  for (const device of ["phone", "quest", "desktop"]) {
    const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, XENXO_TEST_DEVICE: device }, encoding: "utf8" });
    process.stdout.write(out);
    fails += (out.match(/✗/g) ?? []).length;
  }
  console.log(fails ? `\n${fails} fallo(s)` : "\ngráficos: todo bien");
  process.exit(fails ? 1 : 0);
} else {
  /* --- Un equipo de mentira: lo justo que mira detectGpu() --- */
  const UA = {
    phone: "Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    quest: "Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/36.0 Chrome/130.0.0.0 VR Safari/537.36",
    desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  }[DEVICE]!;
  const RENDERER = { phone: "Mali-G68 MC4", quest: "Adreno (TM) 740", desktop: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)" }[DEVICE]!;
  const g = globalThis as Record<string, unknown>;
  Object.defineProperty(g, "navigator", { value: { userAgent: UA, deviceMemory: 8, hardwareConcurrency: 8 }, configurable: true });
  g.matchMedia = (q: string) => ({ matches: DEVICE === "phone" && q.includes("coarse") });
  g.document = {
    createElement: () => ({
      getContext: () => ({ getExtension: (n: string) => (n === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 1 } : null), getParameter: () => RENDERER }),
    }),
  };
  const { FEATURES, graphics, detectGpu, TIERS } = await import("../src/world/graphics.ts");

  const gpu = detectGpu();
  console.log(`Qué se dibuja: ${DEVICE} (${gpu.tier}, ${gpu.reason})`);
  const first = graphics.features;
  check(graphics.features === first && graphics.features === graphics.features, "leer lo que se dibuja da siempre el mismo objeto (si no, la escena entera se rehacía)");
  if (DEVICE === "desktop") {
    check(first === FEATURES[gpu.tier], "un escritorio lleva la tabla tal cual");
    check(TIERS.every((t, i) => i === 0 || FEATURES[t].crowd >= FEATURES[TIERS[i - 1]!].crowd) && FEATURES.low.crowd >= 4, "a más nivel, a más gente se dibuja a cada frame");
    check(!graphics.canvasAA, "el canvas va sin MSAA (el suavizado lo pone el post-proceso)");
    graphics.setXrCapable(true);
    check(graphics.canvasAA, "salvo que el equipo pueda entrar en VR: dentro de las gafas es el único suavizado");
    graphics.setXR(true);
    const xr = graphics.features;
    check(xr.antialias && !xr.post && !xr.bloom && xr.shadows === 0 && xr.rain === 0, "en VR: MSAA, sin post-proceso, sin sombras y sin gotas");
    check(graphics.features === xr, "y el mismo objeto cada vez");
    check(TIERS.indexOf(graphics.tier) <= TIERS.indexOf("medium"), "en VR, como mucho el nivel medio");
    graphics.setXR(false);
    check(graphics.features === first, "al salir de la VR vuelve lo de antes");
  } else {
    check(gpu.portable, "es un equipo de los que van sin efectos de pantalla completa");
    check(graphics.canvasAA, "el canvas va con MSAA en todos los niveles (no se recrea al bajar de nivel)");
    for (const tier of TIERS) {
      graphics.setPref(tier);
      const f = graphics.features;
      check(f === graphics.features && f.antialias && !f.post && !f.bloom && f.shadows === 0 && !f.pointLights && f.lightPools, `«${tier}»: MSAA, sin post-proceso ni sombras ni luces puntuales, y el mismo objeto cada vez`);
    }
    graphics.setPref("auto");
    check(graphics.features === first, "y de vuelta en automático, el objeto de antes");
    check(first.crowd >= 3 && first.crowd <= 6, `entre mucha gente, a cada frame solo las ${first.crowd} personas más cercanas`);
    if (DEVICE === "quest") {
      graphics.setXR(true);
      const xr = graphics.features;
      check(xr === graphics.features && xr.rain === 0 && xr.clipFps === 0 && xr.dpr[1] === 1, "dentro de las gafas: sin gotas, sin grabar, a resolución nativa, y el mismo objeto cada vez");
      graphics.setXR(false);
    }
  }
  process.exit(0);
}
