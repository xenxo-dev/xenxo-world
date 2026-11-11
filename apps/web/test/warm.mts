/**
 * Prueba de world/warm.ts sin navegador ni gráfica: un modelo entra en la escena cuando sus shaders
 * están compilados y sus texturas subidas, y las texturas suben de una en una.
 *
 * - La cola de texturas: solo las que ya tienen imagen, cada una una vez, y un tope de tiempo por
 *   imagen (una grande se lleva la imagen entera; varias pequeñas caben en la misma).
 * - `prepare`: avisa cuando están los shaders Y las texturas, nunca dentro de la propia llamada; dos
 *   modelos que comparten textura la esperan los dos; si algo no llega, avisa al cabo del plazo; y
 *   quien se desmonta deja de esperar.
 * - Con post-proceso se compila la variante del búfer (y el renderizador queda como estaba).
 *
 *   npm run test:warm -w @xenxo/web
 */
import * as THREE from "three";
import { MAX_WAIT_MS, prepare, queueTexture, setWarmRenderer, texturesOf, tickWarm, UPLOAD_BUDGET_MS, warmBusy, warmQueued, type WarmRenderer } from "../src/world/warm";

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Un renderizador de mentira: apunta lo que se le pide y deja decidir cuándo acaba de compilar. */
function fake() {
  const log: string[] = [];
  const uploads: THREE.Texture[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const compiling: { object: THREE.Object3D; target: THREE.WebGLRenderTarget | null; done: () => void }[] = [];
  const gl: WarmRenderer & { cost: number; clock: number } = {
    cost: 1,
    clock: 0,
    xr: { isPresenting: false },
    extensions: { has: () => true },
    compile: (object) => void compiling.push({ object, target, done: () => {} }),
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: (t) => {
      target = t;
      log.push(t ? "búfer" : "lienzo");
    },
    compileAsync: (object) => new Promise<void>((done) => compiling.push({ object, target, done })),
    initTexture: (t) => {
      uploads.push(t);
      gl.clock += gl.cost;
    },
  };
  return { gl, log, uploads, compiling, now: () => gl.clock };
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
  check(f.compiling.length === 1 && f.compiling[0]!.target === null && f.log.length === 0, "sin post-proceso compila la variante del lienzo, sin tocar el renderizador");
  f.compiling[0]!.done();
  await sleep(0);
  check(ready === 0, "con los shaders listos pero sin sus texturas, aún no");
  tickWarm(f.now);
  await sleep(0);
  check(ready === 0, "con una de dos texturas, tampoco");
  tickWarm(f.now);
  await sleep(0);
  check(ready === 1, "con todo, avisa");
  tickWarm(f.now);
  await sleep(5);
  check(ready === 1, "y una sola vez");

  // Al revés: primero las texturas y después los shaders.
  ready = 0;
  prepare(f.gl, [model(tex(), tex())], camera, scene, false, () => ready++);
  drain(f);
  await sleep(0);
  check(ready === 0, "con las texturas subidas pero los shaders compilando, aún no");
  f.compiling.at(-1)!.done();
  await sleep(0);
  check(ready === 1, "al acabar de compilar, avisa");

  // Un modelo cuyas texturas ya han subido y cuyos shaders ya existen: al momento (pero después).
  ready = 0;
  prepare(f.gl, [model(t1)], camera, scene, false, () => ready++);
  f.compiling.at(-1)!.done();
  check(ready === 0, "un modelo ya preparado tampoco avisa dentro de la llamada…");
  await sleep(0);
  check(ready === 1 && warmQueued() === 0, "…pero sí enseguida, sin esperar a ninguna imagen");

  // Dos modelos que comparten una textura que aún no ha subido.
  const shared = tex(2048);
  let a = 0, b = 0;
  prepare(f.gl, [model(shared)], camera, scene, false, () => a++);
  prepare(f.gl, [model(shared, tex(256))], camera, scene, false, () => b++);
  check(warmQueued() === 2, "la textura compartida está una vez en la cola");
  for (const c of f.compiling) c.done();
  tickWarm(f.now);
  await sleep(0);
  check(a === 1 && b === 0, "al subir, avisa a quien solo esperaba esa…");
  tickWarm(f.now);
  await sleep(0);
  check(b === 1, "…y al otro cuando sube también la suya");

  // Varias piezas a la vez (un coche): una sola señal, cuando están todas.
  ready = 0;
  const n0 = f.compiling.length;
  prepare(f.gl, [model(tex(256)), model(tex(256)), model()], camera, scene, false, () => ready++);
  check(f.compiling.length === n0 + 3, "las piezas se compilan todas a la vez");
  drain(f);
  f.compiling[n0]!.done();
  f.compiling[n0 + 1]!.done();
  await sleep(0);
  check(ready === 0, "falta una pieza: aún no");
  f.compiling[n0 + 2]!.done();
  await sleep(0);
  check(ready === 1, "con todas, una señal");
}

console.log("Con post-proceso");
{
  const f = fake();
  setWarmRenderer(f.gl);
  prepare(f.gl, [model()], camera, scene, true, () => {});
  check(f.compiling[0]!.target !== null, "se compila la variante del búfer (lineal, sin mapeo de tonos)");
  check(f.log.join(",") === "búfer,lienzo" && f.gl.getRenderTarget() === null, "y el renderizador queda pintando donde pintaba");
  f.compiling[0]!.done();
}

console.log("Sin compilación en paralelo (KHR_parallel_shader_compile)");
{
  const f = fake();
  setWarmRenderer(f.gl);
  f.gl.extensions = { has: () => false };
  let asyncCalls = 0;
  f.gl.compileAsync = () => {
    asyncCalls++;
    return Promise.resolve();
  };
  let ready = 0;
  prepare(f.gl, [model()], camera, scene, true, () => ready++);
  check(f.compiling.length === 1 && f.compiling[0]!.target !== null && asyncCalls === 0, "los shaders se lanzan igual (en su variante), sin pedir lo que el navegador no tiene");
  check(ready === 0 && f.gl.getRenderTarget() === null, "tampoco avisa dentro de la llamada, y el renderizador queda como estaba");
  await sleep(0);
  check(ready === 1, "y se enseña enseguida: lo que falte esperará al dibujarlo, como antes");
}

console.log("Cuando algo no llega");
{
  const f = fake();
  setWarmRenderer(f.gl);
  // Los shaders no acaban nunca: se enseña al cabo del plazo.
  let ready = 0;
  prepare(f.gl, [model()], camera, scene, false, () => ready++, 40);
  await sleep(15);
  check(ready === 0, "antes del plazo, esperando");
  await sleep(60);
  check(ready === 1, `pasado el plazo (en el mundo, ${MAX_WAIT_MS / 1000} s), se enseña igualmente`);
  f.compiling[0]!.done();
  await sleep(0);
  check(ready === 1, "y si luego acaba, no avisa otra vez");
  // compileAsync que falla o que lanza: como si hubiera acabado.
  ready = 0;
  f.gl.compileAsync = () => Promise.reject(new Error("no compila"));
  prepare(f.gl, [model()], camera, scene, false, () => ready++, 5000);
  await sleep(0);
  check(ready === 1, "si la compilación falla, se enseña (se compilará al dibujarlo, como antes)");
  ready = 0;
  f.gl.compileAsync = () => {
    throw new Error("sin contexto");
  };
  prepare(f.gl, [model()], camera, scene, true, () => ready++, 5000);
  await sleep(0);
  check(ready === 1 && f.gl.getRenderTarget() === null, "y si lanza, también (y el renderizador queda como estaba)");
  // Quien se desmonta deja de esperar.
  ready = 0;
  const g = fake();
  setWarmRenderer(g.gl);
  const stop = prepare(g.gl, [model(tex())], camera, scene, false, () => ready++, 30);
  stop();
  g.compiling[0]!.done();
  drain(g);
  await sleep(50);
  check(ready === 0, "quien se desmonta mientras se prepara ya no recibe el aviso (ni el del plazo)");
}

console.log("¿Queda algo preparándose? (la pantalla de carga espera; la fluidez no se mide)");
{
  const f = fake();
  setWarmRenderer(f.gl);
  drain(f);
  check(!warmBusy(), "sin nada pendiente, no");
  let ready = 0;
  prepare(f.gl, [model(tex())], camera, scene, false, () => ready++, 5000);
  check(warmBusy(), "con un modelo preparándose, sí");
  f.compiling[0]!.done();
  await sleep(0);
  check(warmBusy() && ready === 0, "mientras le falte una textura, también");
  drain(f);
  await sleep(0);
  check(!warmBusy() && ready === 1, "cuando se enseña, ya no");
  const stop = prepare(f.gl, [model()], camera, scene, false, () => ready++, 5000);
  stop();
  stop();
  check(!warmBusy(), "ni cuando quien esperaba se desmonta (aunque lo diga dos veces)");
  prepare(f.gl, [model()], camera, scene, false, () => ready++, 30);
  await sleep(60);
  check(!warmBusy(), "ni cuando se acaba el plazo");
  // Sin renderizador nadie va a vaciar la cola: no puede dejar la pantalla de carga puesta.
  setWarmRenderer(null);
  queueTexture(tex());
  check(warmQueued() === 1 && !warmBusy(), "una cola que nadie va a vaciar (sin renderizador) no cuenta");
  setWarmRenderer(f.gl);
  check(warmBusy(), "con renderizador, la cola pendiente sí cuenta…");
  drain(f);
  check(!warmBusy(), "…hasta que se vacía");
}

setWarmRenderer(null);
console.log(fails ? `\n${fails} fallos` : "\nTodo bien");
process.exit(fails ? 1 : 0);
