/**
 * Prueba de world/warm.ts sin navegador ni gráfica: lo que se va a ver se prepara antes (shaders
 * compilados, texturas subidas), cada modelo antes de entrar en la escena y la escena entera con el
 * repaso general.
 *
 * - La cola de texturas: solo las que ya tienen imagen, cada una una vez, y un tope de tiempo por
 *   imagen (una grande se lleva la imagen entera; varias pequeñas caben en la misma).
 * - `prepare`: avisa cuando están los shaders (todos los del renderizador: un material puede tener
 *   varios programas) Y las texturas, nunca dentro de la propia llamada; dos modelos que comparten
 *   textura la esperan los dos; si algo no llega, avisa al cabo del plazo; y quien se desmonta deja
 *   de esperar.
 * - Con post-proceso se compila la variante del búfer (y el renderizador queda como estaba).
 * - El repaso general: cuándo toca, que compila la escena entera y que hasta que acaba el lugar no
 *   está preparado.
 *
 *   npm run test:warm -w @xenxo/web
 */
import * as THREE from "three";
import { dropPass, MAX_WAIT_MS, passDue, POLL_MS, prepare, queueTexture, requestPass, runPass, setDirectTone, SETTLE_MS, setWarmRenderer, texturesOf, tickWarm, UPLOAD_BUDGET_MS, warmBusy, warmHold, warmPasses, warmQueued, warmSettled, type WarmRenderer } from "../src/world/warm";

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Lo que tarda en enterarse de que los shaders han acabado (se mira cada `POLL_MS`). */
const noticed = () => sleep(POLL_MS * 2 + 10);

/**
 * Un renderizador de mentira: apunta lo que se le pide y deja decidir cuándo acaba de compilar. Cada
 * material nuevo es un programa; con `parallel` (KHR_parallel_shader_compile) tarda hasta `finish()`,
 * sin ella se da por hecho al momento (no se puede saber).
 */
function fake() {
  const log: string[] = [];
  const uploads: THREE.Texture[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const compiles: { object: THREE.Object3D; target: THREE.WebGLRenderTarget | null; tone: THREE.ToneMapping }[] = [];
  const programs: { ready: boolean; isReady(): boolean }[] = [];
  const seen = new Set<THREE.Material>();
  const gl: WarmRenderer & { cost: number; clock: number; parallel: boolean } = {
    cost: 1,
    clock: 0,
    parallel: true,
    xr: { isPresenting: false },
    toneMapping: THREE.NoToneMapping,
    info: { programs },
    compile: (object) => {
      compiles.push({ object, target, tone: gl.toneMapping });
      object.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const mat of !m ? [] : Array.isArray(m) ? m : [m]) {
          if (seen.has(mat)) continue;
          seen.add(mat);
          const p = { ready: !gl.parallel, isReady: () => p.ready };
          programs.push(p);
        }
      });
    },
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: (t) => {
      target = t;
      log.push(t ? "búfer" : "lienzo");
    },
    initTexture: (t) => {
      uploads.push(t);
      gl.clock += gl.cost;
    },
  };
  /** La gráfica acaba de compilar lo que tenía (todo, o solo los `n` primeros que faltaban). */
  const finish = (n = Infinity) => {
    for (const p of programs) if (!p.ready && n-- > 0) p.ready = true;
  };
  return { gl, log, uploads, compiles, programs, finish, now: () => gl.clock };
}

/** Una textura ya cargada (o aún sin imagen). */
function tex(size = 1024, loaded = true): THREE.Texture {
  const t = new THREE.Texture();
  if (loaded) {
    t.image = { width: size, height: size };
    t.needsUpdate = true;
  }
  return t;
}
const model = (...maps: THREE.Texture[]) => {
  const g = new THREE.Group();
  for (const map of maps) g.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map })));
  return g;
};
const camera = new THREE.PerspectiveCamera();
const scene = new THREE.Scene();
/** Vacía la cola (entre casos). */
const drain = (f: ReturnType<typeof fake>) => {
  for (let i = 0; i < 200 && warmQueued(); i++) tickWarm(f.now);
};

console.log("Las texturas de un modelo");
{
  const a = tex(), n = tex(), u = tex();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: a, normalMap: n })));
  g.add(new THREE.Mesh(new THREE.BufferGeometry(), [new THREE.MeshBasicMaterial({ map: a }), new THREE.ShaderMaterial({ uniforms: { uMap: { value: u }, uTime: { value: 0 } } })]));
  const found = texturesOf(g);
  check(found.length === 3 && found.includes(a) && found.includes(n) && found.includes(u), "las de sus materiales y las de los uniformes de un shader propio, cada una una vez");
  check(texturesOf(new THREE.Group()).length === 0, "un objeto sin mallas no tiene ninguna");
}

console.log("La cola: de una en una");
{
  const f = fake();
  setWarmRenderer(f.gl);
  const pending = tex(1024, false);
  check(!queueTexture(pending) && warmQueued() === 0, "una textura que aún se descarga no entra");
  const rt = new THREE.WebGLRenderTarget(4, 4).texture;
  rt.image = { width: 4, height: 4 };
  rt.needsUpdate = true;
  check(!queueTexture(rt) && warmQueued() === 0, "ni la de un búfer de dibujo");
  const big = [tex(2048), tex(2048), tex(2048)];
  f.gl.cost = 20; // una de 2048² son 15–40 ms
  for (const t of big) queueTexture(t);
  queueTexture(big[0]!);
  check(warmQueued() === 3, "cada una entra una vez, aunque se pida dos");
  tickWarm(f.now);
  check(f.uploads.length === 1 && warmQueued() === 2, `una grande se lleva la imagen entera: la siguiente espera (tope de ${UPLOAD_BUDGET_MS} ms)`);
  tickWarm(f.now);
  tickWarm(f.now);
  check(f.uploads.length === 3 && warmQueued() === 0, "y en tres imágenes han subido las tres");
  tickWarm(f.now);
  check(f.uploads.length === 3, "con la cola vacía no hace nada");
  const small = [tex(256), tex(256), tex(256), tex(256), tex(256), tex(256)];
  f.gl.cost = 1;
  for (const t of small) queueTexture(t);
  tickWarm(f.now);
  check(f.uploads.length === 3 + UPLOAD_BUDGET_MS && warmQueued() === small.length - UPLOAD_BUDGET_MS, "las pequeñas van varias por imagen, hasta el tope");
  drain(f);
  check(!queueTexture(small[0]!) && warmQueued() === 0, "una ya subida no vuelve a entrar");
  small[0]!.needsUpdate = true;
  queueTexture(small[0]!);
  check(warmQueued() === 1, "…salvo que haya cambiado");
  drain(f);
  // Sin renderizador (antes de montar el mundo) la cola espera.
  setWarmRenderer(null);
  queueTexture(tex());
  tickWarm(f.now);
  check(warmQueued() === 1, "sin renderizador, la cola espera");
  setWarmRenderer(f.gl);
  drain(f);
  // Una subida que falla no atasca la cola.
  const bad = tex(), good = tex();
  const init = f.gl.initTexture;
  f.gl.initTexture = (t) => {
    if (t === bad) throw new Error("no sube");
    init(t);
  };
  queueTexture(bad);
  queueTexture(good);
  drain(f);
  check(warmQueued() === 0 && f.uploads.includes(good), "una subida que falla no atasca la cola");
}

console.log("Preparar un modelo");
{
  const f = fake();
  setWarmRenderer(f.gl);
  const t1 = tex(2048), t2 = tex(2048);
  f.gl.cost = 20;
  let ready = 0;
  prepare(f.gl, [model(t1, t2)], camera, scene, false, () => ready++);
  check(ready === 0, "nunca avisa dentro de la propia llamada");
  check(f.compiles.length === 1 && f.compiles[0]!.target === null && f.log.length === 0, "sin post-proceso compila la variante del lienzo, sin tocar el renderizador");
  f.finish();
  await noticed();
  check(ready === 0, "con los shaders listos pero sin sus texturas, aún no");
  tickWarm(f.now);
  await sleep(0);
  check(ready === 0, "con una de dos texturas, tampoco");
  tickWarm(f.now);
  await sleep(0);
  check(ready === 1, "con todo, avisa");
  tickWarm(f.now);
  await noticed();
  check(ready === 1, "y una sola vez");

  // Al revés: primero las texturas y después los shaders.
  ready = 0;
  prepare(f.gl, [model(tex(), tex())], camera, scene, false, () => ready++);
  drain(f);
  await noticed();
  check(ready === 0, "con las texturas subidas pero los shaders compilando, aún no");
  f.finish();
  await noticed();
  check(ready === 1, "al acabar de compilar, avisa");

  // Un material con dos programas (el mismo en una malla suelta y en una instanciada): Three.js solo
  // sabe esperar al último; aquí se espera a todos.
  ready = 0;
  prepare(f.gl, [model(tex(64), tex(64))], camera, scene, false, () => ready++);
  drain(f);
  f.finish(1);
  await noticed();
  check(ready === 0, "con uno de sus dos programas aún compilando, no se enseña");
  f.finish();
  await noticed();
  check(ready === 1, "con los dos, sí");

  // Un modelo cuyas texturas ya han subido y cuyos shaders ya existen: al momento (pero después).
  ready = 0;
  const again = model(t1);
  prepare(f.gl, [again], camera, scene, false, () => ready++);
  f.finish();
  check(ready === 0, "un modelo ya preparado tampoco avisa dentro de la llamada…");
  await noticed();
  check(ready === 1 && warmQueued() === 0, "…pero sí enseguida, sin esperar a ninguna imagen");

  // Dos modelos que comparten una textura que aún no ha subido.
  const shared = tex(2048);
  let a = 0, b = 0;
  prepare(f.gl, [model(shared)], camera, scene, false, () => a++);
  prepare(f.gl, [model(shared, tex(256))], camera, scene, false, () => b++);
  check(warmQueued() === 2, "la textura compartida está una vez en la cola");
  f.finish();
  await noticed();
  tickWarm(f.now);
  await sleep(0);
  check(a === 1 && b === 0, "al subir, avisa a quien solo esperaba esa…");
  tickWarm(f.now);
  await sleep(0);
  check(b === 1, "…y al otro cuando sube también la suya");

  // Varias piezas a la vez (un coche): una sola señal, cuando están todas.
  ready = 0;
  const n0 = f.compiles.length;
  prepare(f.gl, [model(tex(256)), model(tex(256)), model(tex(256))], camera, scene, false, () => ready++);
  check(f.compiles.length === n0 + 3, "las piezas se compilan todas a la vez");
  drain(f);
  f.finish(2);
  await noticed();
  check(ready === 0, "falta una pieza: aún no");
  f.finish();
  await noticed();
  check(ready === 1, "con todas, una señal");
}

console.log("Con post-proceso");
{
  const f = fake();
  setWarmRenderer(f.gl);
  prepare(f.gl, [model()], camera, scene, true, () => {});
  check(f.compiles[0]!.target !== null, "se compila la variante del búfer (lineal, sin mapeo de tonos)");
  check(f.log.join(",") === "búfer,lienzo" && f.gl.getRenderTarget() === null, "y el renderizador queda pintando donde pintaba");
  f.finish();
  await noticed();
  // Al bajar a un nivel sin post-proceso, este aún no ha repuesto el mapeo de tonos del lienzo
  // cuando se preparan los modelos del nivel nuevo.
  setDirectTone(THREE.ACESFilmicToneMapping);
  prepare(f.gl, [model()], camera, scene, false, () => {});
  check(f.compiles.at(-1)!.target === null && f.compiles.at(-1)!.tone === THREE.ACESFilmicToneMapping, "sin post-proceso se compila con el mapeo de tonos del lienzo, aunque el post-proceso aún no lo haya repuesto");
  check(f.gl.toneMapping === THREE.NoToneMapping, "y el renderizador queda con el que tenía");
  prepare(f.gl, [model()], camera, scene, true, () => {});
  check(f.gl.toneMapping === THREE.NoToneMapping && f.compiles.at(-1)!.target !== null, "con post-proceso no se toca (en el búfer no hay mapeo de tonos)");
  setDirectTone(null);
  await noticed();
}

console.log("Sin compilación en paralelo (KHR_parallel_shader_compile)");
{
  const f = fake();
  setWarmRenderer(f.gl);
  f.gl.parallel = false;
  let ready = 0;
  prepare(f.gl, [model(), model()], camera, scene, true, () => ready++);
  check(f.compiles.length === 2 && f.compiles[0]!.target !== null, "los shaders se lanzan igual, en su variante");
  check(ready === 0 && f.gl.getRenderTarget() === null, "tampoco avisa dentro de la llamada, y el renderizador queda como estaba");
  await noticed();
  check(ready === 1, "y se enseña enseguida: lo que falte esperará al dibujarlo, como antes");
}

console.log("Cuando algo no llega");
{
  const f = fake();
  setWarmRenderer(f.gl);
  // Los shaders no acaban nunca: se enseña al cabo del plazo.
  let ready = 0;
  prepare(f.gl, [model(tex(64))], camera, scene, false, () => ready++, 80);
  drain(f);
  await sleep(40);
  check(ready === 0, "antes del plazo, esperando");
  await sleep(90);
  check(ready === 1, `pasado el plazo (en el mundo, ${MAX_WAIT_MS / 1000} s), se enseña igualmente`);
  f.finish();
  await noticed();
  check(ready === 1, "y si luego acaba, no avisa otra vez");
  // compile que lanza: como si hubiera acabado.
  ready = 0;
  const compile = f.gl.compile;
  f.gl.compile = () => {
    throw new Error("sin contexto");
  };
  prepare(f.gl, [model()], camera, scene, true, () => ready++, 5000);
  await noticed();
  check(ready === 1 && f.gl.getRenderTarget() === null, "si la compilación lanza, se enseña (se compilará al dibujarlo, como antes) y el renderizador queda como estaba");
  f.gl.compile = compile;
  // Un renderizador que no deja preguntar por sus programas: no se espera.
  ready = 0;
  const h = fake();
  setWarmRenderer(h.gl);
  h.gl.info = { programs: null };
  prepare(h.gl, [model()], camera, scene, false, () => ready++, 5000);
  await noticed();
  check(ready === 1, "y si no se puede preguntar por los programas, tampoco se espera");
  // Quien se desmonta deja de esperar.
  ready = 0;
  const g = fake();
  setWarmRenderer(g.gl);
  const stop = prepare(g.gl, [model(tex())], camera, scene, false, () => ready++, 30);
  stop();
  g.finish();
  drain(g);
  await sleep(80);
  check(ready === 0, "quien se desmonta mientras se prepara ya no recibe el aviso (ni el del plazo)");
}

console.log("¿Queda algo preparándose? (la pantalla de carga espera; la fluidez no se mide)");
{
  const f = fake();
  setWarmRenderer(f.gl);
  drain(f);
  check(!warmBusy() && warmSettled(performance.now() + SETTLE_MS), "sin nada pendiente, no");
  let ready = 0;
  prepare(f.gl, [model(tex())], camera, scene, false, () => ready++, 5000);
  check(warmBusy() && !warmSettled(performance.now() + SETTLE_MS), "con un modelo preparándose, sí");
  f.finish();
  await noticed();
  check(warmBusy() && ready === 0, "mientras le falte una textura, también");
  drain(f);
  await sleep(0);
  check(!warmBusy() && ready === 1, "cuando se enseña, ya no");
  const stop = prepare(f.gl, [model()], camera, scene, false, () => ready++, 5000);
  stop();
  check(!warmBusy(), "ni cuando quien esperaba se desmonta");
  queueTexture(tex());
  check(warmBusy(), "con texturas por subir, sí");
  drain(f);
  check(!warmBusy(), "y con la cola vacía, no");
  // Lo que alguien dice que falta (el post-proceso, la primera foto de los reflejos).
  const done = warmHold();
  const other = warmHold();
  check(warmBusy(), "con algo más por llegar (warmHold), sí");
  done();
  done();
  check(warmBusy(), "soltarlo dos veces no suelta lo de otro");
  other();
  check(!warmBusy(), "y soltado todo, no");
}

console.log("El repaso general");
{
  const f = fake();
  setWarmRenderer(f.gl);
  drain(f);
  await noticed();
  const place = new THREE.Scene();
  const loose = tex(512);
  place.add(model(loose), model());
  const before = warmPasses();
  /** Pasado el momento que tarda en montarse lo recién preparado. */
  const later = () => performance.now() + SETTLE_MS;
  check(!passDue(later()), "sin pedirlo, no toca");
  // Al llegar a un lugar: hasta que se haga, el lugar no está preparado.
  requestPass();
  check(warmBusy() && !warmSettled(later()), "pedido (lugar nuevo, otro nivel, otro ambiente), el lugar no está preparado");
  check(passDue(later()), "y toca");
  let shown = 0;
  const stop = prepare(f.gl, [model(tex(64))], camera, place, false, () => shown++, 5000);
  check(!passDue(later()), "…salvo que quede algún modelo preparándose (aún no está en la escena)");
  f.finish();
  drain(f);
  await noticed();
  check(shown === 1 && !passDue(), `ni nada más prepararse el último: React aún tiene que montarlo (${SETTLE_MS} ms)`);
  check(passDue(later()), "pasado ese momento, toca");
  stop();
  const n0 = f.compiles.length, u0 = f.uploads.length;
  runPass(f.gl, place, camera, true);
  check(f.compiles.length === n0 + 1 && f.compiles.at(-1)!.object === place && f.compiles.at(-1)!.target !== null, "compila la escena entera, en la variante que se dibuja");
  check(f.gl.getRenderTarget() === null, "y el renderizador queda como estaba");
  check(warmBusy() && !passDue(later()) && warmPasses() === before, "mientras dura, el lugar sigue sin estar preparado (y no se lanza otro)");
  drain(f);
  check(f.uploads.length === u0 + 1 && f.uploads.includes(loose), "sube las texturas de lo que aún no se ha visto");
  await noticed();
  check(warmPasses() === before, "con shaders aún compilando, no ha acabado");
  f.finish();
  await noticed();
  check(warmPasses() === before + 1 && !warmBusy() && warmSettled(later()), "al acabar, el lugar está preparado");
  // Lo pedido mientras se hacía uno queda para el siguiente.
  requestPass();
  runPass(f.gl, place, camera, false);
  requestPass();
  await noticed();
  check(warmPasses() === before + 2 && warmBusy() && passDue(later()), "lo pedido mientras se hacía uno queda para el siguiente");
  // Un repaso que no acaba: a su plazo, se da por hecho.
  place.add(model(tex(64)));
  runPass(f.gl, place, camera, false, 60);
  drain(f);
  await sleep(120);
  check(warmPasses() === before + 3 && !warmBusy(), "un repaso que no acaba se da por hecho a su plazo");
  f.finish();
  // Al desmontar el mundo no queda nada pendiente.
  place.add(model(tex(64)));
  requestPass();
  runPass(f.gl, place, camera, false, 5000);
  requestPass();
  dropPass();
  drain(f);
  check(!warmBusy() && warmSettled(later()) && !passDue(later()), "al desmontar el mundo no queda ninguno pendiente ni en marcha");
  f.finish();
  await noticed();
  check(warmPasses() === before + 3, "y el que estaba en marcha ya no cuenta");
}

console.log("Con la pantalla de carga puesta, las texturas suben más deprisa");
{
  const f = fake();
  setWarmRenderer(f.gl);
  drain(f);
  f.gl.cost = 5;
  for (let i = 0; i < 12; i++) queueTexture(tex(1024));
  tickWarm(f.now);
  check(warmQueued() === 11, `en el mundo, lo justo por imagen (${UPLOAD_BUDGET_MS} ms: una de 5 ms)`);
  tickWarm(f.now, 24);
  check(warmQueued() === 6, "con más margen (nadie nota una imagen larga), cinco en la misma");
  drain(f);
}

setWarmRenderer(null);
console.log(fails ? `\n${fails} comprobación(es) fallida(s)` : "\nTodo bien: lo que se va a ver se prepara antes de enseñarlo.");
process.exit(fails ? 1 : 0);
