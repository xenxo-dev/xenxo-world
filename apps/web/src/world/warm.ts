/**
 * Calentar lo que se va a ver antes de enseñarlo.
 *
 * La primera vez que algo se dibuja, Three.js compila su shader y espera a que acabe. En Windows (ANGLE
 * sobre Direct3D) cada variante de un material con luces tarda unos 300 ms, con la página congelada; y
 * como lo que no entra en la vista no se dibuja, esos parones salían al mirar alrededor por primera
 * vez en cada lugar (medido en un PC con una RX 5700 XT: de 0,25 a 0,45 s cada uno, tres seguidos al
 * entrar en un interior). Lo mismo con las texturas: suben a la gráfica en la imagen en que hacen falta,
 * todas las del modelo a la vez (una de 2048² son de 15 a 40 ms).
 *
 * Aquí se prepara antes: los shaders se compilan en segundo plano (con KHR_parallel_shader_compile la
 * gráfica los compila sin que nadie espere) y las texturas suben de una en una, en ratos libres.
 *
 * - **Cada modelo** (`prepare`, con los ganchos de useWarmed.ts) se prepara antes de entrar en la
 *   escena y entra cuando está. Mientras se prepara uno nuevo se sigue viendo el de antes (al cambiar
 *   de día a noche o de nivel gráfico, el mundo no desaparece ni un instante).
 * - **El repaso general** (`requestPass`, `runPass`): cuando un lugar ha acabado de llegar (o cambia
 *   el nivel o el ambiente), se compila la escena entera, con lo que no es un modelo (lo hecho en código: piezas, carteles, el tráfico) y
 *   con lo que aún no se ve. Hasta entonces el lugar no está preparado (`warmBusy`): la pantalla de
 *   carga no se quita y, mientras está puesta, ni se dibuja (World.tsx): así nada espera a nadie y al
 *   quitarla ya no queda nada por compilar, tampoco al girarse.
 *
 * Un shader se compila para lo que hay en ese momento: a dónde se pinta (lienzo o búfer del
 * post-proceso), cuántas luces, niebla, el tamaño del mapa de entorno. Si eso cambia después, lo
 * compilado no vale y se compila otra vez al dibujar, esperando: por eso el entorno tiene siempre el
 * mismo tamaño y está desde el principio, y no se dibuja antes de que llegue el post-proceso (World.tsx).
 *
 * - Si algo se tuerce o tarda de más (`MAX_WAIT_MS`), se enseña igualmente: como antes de existir esto.
 * - Nunca en las gafas: allí la escena se pinta en otro tipo de búfer (otra variante del shader) y no
 *   está medido. El modelo se enseña tal cual.
 *
 * Sin React (los ganchos, en useWarmed.ts): lo prueba test/warm.mts.
 */
import * as THREE from "three";

/** Lo más que un modelo (o el repaso) espera a estar preparado (ms). */
export const MAX_WAIT_MS = 4000;
/** Cada cuánto se mira si los shaders han acabado de compilar (ms). */
export const POLL_MS = 16;
/**
 * Lo que tarda en estar en la escena un modelo ya preparado (ms): se avisa a quien lo enseña y React
 * lo monta un momento después. El repaso general y la foto de los reflejos esperan a que pase.
 */
export const SETTLE_MS = 300;
/** Lo que se dedica a subir texturas en cada imagen (ms): pasado esto, la siguiente espera a la próxima. */
export const UPLOAD_BUDGET_MS = 4;

/** Lo que hace falta del renderizador (así la prueba no necesita una gráfica). */
export interface WarmRenderer {
  xr: { isPresenting: boolean };
  /** El mapeo de tonos con que pinta ahora en el lienzo (va dentro de cada shader). */
  toneMapping: THREE.ToneMapping;
  /** Todos los programas que tiene (`isReady`: ya compilado; sin la extensión, siempre). */
  info: { programs: { isReady(): boolean }[] | null };
  compile(object: THREE.Object3D, camera: THREE.Camera, scene?: THREE.Scene | null): unknown;
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  setRenderTarget(target: THREE.WebGLRenderTarget | null, face?: number, mip?: number): void;
  initTexture(texture: THREE.Texture): void;
}

/** Quien espera texturas: cuántas le faltan y a quién avisar. */
interface Waiter {
  n: number;
  done: () => void;
}
interface Sent {
  /** La versión que entró en la cola (o la que subió). */
  v: number;
  /** Ya ha subido. */
  up: boolean;
  /** Está en la cola. */
  queued: boolean;
  waiters: Waiter[];
}

const queue: THREE.Texture[] = [];
/** Cuántos `prepare` siguen en marcha (modelos que aún no se enseñan). */
let preparing = 0;
/** La última vez que un modelo empezó o acabó de prepararse (ms de `performance.now()`). */
let preparedAt = -1e9;
const state = new WeakMap<THREE.Texture, Sent>();
let renderer: WarmRenderer | null = null;

/** Quien tiene el renderizador lo dice aquí (World.tsx) y llama a `tickWarm` en cada imagen. */
export function setWarmRenderer(gl: WarmRenderer | null) {
  renderer = gl;
}

/** ¿Tiene ya su imagen? (Una textura que aún se descarga no se puede subir.) */
function loaded(t: THREE.Texture): boolean {
  const img = t.image as { complete?: boolean; width?: number; videoWidth?: number; data?: unknown } | null | undefined;
  if (!img || img.complete === false) return false;
  return (img.width ?? 0) > 0 || (img.videoWidth ?? 0) > 0 || img.data != null;
}

/** ¿Se sube como una textura normal? (Las de un búfer de dibujo, de profundidad, de vídeo o de cubo, no.) */
function plain(t: THREE.Texture): boolean {
  const x = t as THREE.Texture & { isRenderTargetTexture?: boolean; isVideoTexture?: boolean; isCubeTexture?: boolean; isDepthTexture?: boolean; isFramebufferTexture?: boolean };
  return !x.isRenderTargetTexture && !x.isVideoTexture && !x.isCubeTexture && !x.isDepthTexture && !x.isFramebufferTexture;
}

/**
 * Una textura ya cargada, a la cola: subirá a la gráfica en un rato libre en vez de en la imagen en
 * que haga falta. (Las de la biblioteca de materiales, al llegar: materials.ts.) Con `who`, devuelve
 * true si ese alguien tiene que esperarla (aún no ha subido).
 */
export function queueTexture(t: THREE.Texture, who: Waiter | null = null): boolean {
  if (!plain(t) || !loaded(t) || t.version === 0) return false;
  let s = state.get(t);
  if (!s) state.set(t, (s = { v: -1, up: false, queued: false, waiters: [] }));
  // Ya subida tal como está: nada que esperar.
  if (s.up && s.v === t.version) return false;
  // Nueva, o ha cambiado después de subir: a la cola (si ya esperaba en ella, subirá la de ahora).
  s.v = t.version;
  s.up = false;
  if (!s.queued) {
    s.queued = true;
    queue.push(t);
  }
  if (who) s.waiters.push(who);
  return !!who;
}

/** Las texturas que usa un objeto (las de sus materiales, también las de los uniformes de un shader propio). */
export function texturesOf(object: THREE.Object3D): THREE.Texture[] {
  const out = new Set<THREE.Texture>();
  const add = (v: unknown) => {
    if (v && (v as THREE.Texture).isTexture) out.add(v as THREE.Texture);
  };
  object.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      const rec = mat as unknown as Record<string, unknown>;
      for (const k in rec) add(rec[k]);
      const uniforms = (mat as THREE.ShaderMaterial).uniforms as Record<string, { value: unknown } | undefined> | undefined;
      if (uniforms) for (const k in uniforms) add(uniforms[k]?.value);
    }
  });
  return [...out];
}

/**
 * En cada imagen: sube texturas de la cola mientras quede tiempo (`budget` ms); siempre una, para
 * que la cola avance aunque una sola se lo coma entero. `now` es el reloj (para la prueba).
 */
export function tickWarm(now: () => number = () => performance.now(), budget = UPLOAD_BUDGET_MS) {
  const gl = renderer;
  if (!gl || !queue.length) return;
  const t0 = now();
  do {
    const t = queue.shift()!;
    if (loaded(t)) {
      try {
        gl.initTexture(t);
      } catch {
        /* se subirá al dibujarla, como antes */
      }
    }
    const s = state.get(t);
    if (!s) continue;
    // Si cambió mientras esperaba, ha subido la de ahora.
    s.v = t.version;
    s.up = true;
    s.queued = false;
    const waiters = s.waiters;
    s.waiters = [];
    for (const w of waiters) if (--w.n === 0) w.done();
  } while (queue.length && now() - t0 < budget);
}

/** Cuántas texturas esperan (para la prueba). */
export function warmQueued(): number {
  return queue.length;
}

/* ------------------------------------------------------------------ */
/* Shaders                                                              */
/* ------------------------------------------------------------------ */

let linear: THREE.WebGLRenderTarget | null = null;
let directTone: THREE.ToneMapping | null = null;

/**
 * El mapeo de tonos con que se pinta directamente en el lienzo (sin post-proceso): el del
 * renderizador recién creado. El post-proceso lo quita mientras está montado y lo repone al
 * desmontarse, un momento después de que se preparen los modelos del nivel nuevo: sin saberlo aquí,
 * al bajar a un nivel sin post-proceso se compilaba todo sin mapeo de tonos, para nada.
 */
export function setDirectTone(tone: THREE.ToneMapping | null) {
  directTone = tone;
}

/**
 * Crea los programas de `object` (sin esperarlos: la gráfica los compila aparte). `post`: la escena
 * se pinta en el búfer del post-proceso (lineal y sin mapeo de tonos), que es otra variante de cada
 * shader que pintando directamente en el lienzo: hay que compilar la que se va a usar.
 */
function compile(gl: WarmRenderer, object: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene, post: boolean) {
  const prev = gl.getRenderTarget();
  const face = gl.getActiveCubeFace();
  const mip = gl.getActiveMipmapLevel();
  const tone = gl.toneMapping;
  if (post) gl.setRenderTarget((linear ??= new THREE.WebGLRenderTarget(1, 1)));
  else if (directTone !== null) gl.toneMapping = directTone;
  try {
    gl.compile(object, camera, scene);
  } catch {
    /* se compilará al dibujarlo, como antes */
  } finally {
    if (post) gl.setRenderTarget(prev, face, mip);
    else gl.toneMapping = tone;
  }
}

/**
 * ¿Han acabado de compilar todos? Todos los del renderizador, no solo los de un modelo: un material
 * puede tener varios programas (el mismo en una malla suelta y en una instanciada) y Three.js solo
 * sabe esperar al último. Sin la extensión no se puede saber: se dan por hechos (lo que no lo esté
 * al dibujarlo esperará, como antes).
 */
function compiled(gl: WarmRenderer): boolean {
  try {
    const list = gl.info.programs;
    if (list) for (const p of list) if (!p.isReady()) return false;
  } catch {
    /* si no se puede preguntar, no se espera */
  }
  return true;
}

interface Compiling {
  gl: WarmRenderer;
  done: () => void;
}
const compiling: Compiling[] = [];
let poll: ReturnType<typeof setTimeout> | null = null;
function pollCompiling() {
  poll = null;
  for (let i = compiling.length - 1; i >= 0; i--) {
    const c = compiling[i]!;
    if (!compiled(c.gl)) continue;
    compiling.splice(i, 1);
    c.done();
  }
  if (compiling.length) poll = setTimeout(pollCompiling, POLL_MS);
}
/** Avisa (nunca dentro de la llamada) cuando todos los shaders han acabado de compilar. Devuelve cómo dejar de esperar. */
function whenCompiled(gl: WarmRenderer, done: () => void): () => void {
  const c: Compiling = { gl, done };
  compiling.push(c);
  poll ??= setTimeout(pollCompiling, 0);
  return () => {
    const i = compiling.indexOf(c);
    if (i >= 0) compiling.splice(i, 1);
  };
}

/* ------------------------------------------------------------------ */
/* Preparar                                                             */
/* ------------------------------------------------------------------ */

/** Lo de `prepare`, sin contarlo (el repaso general lleva su propia cuenta). */
function start(gl: WarmRenderer, objects: readonly THREE.Object3D[], camera: THREE.Camera, scene: THREE.Scene, post: boolean, ready: () => void, maxWait: number): () => void {
  let waiting = true;
  let pending = 1;
  const stop = () => {
    waiting = false;
    clearTimeout(timer);
    forget();
  };
  const finish = () => {
    if (!waiting) return;
    stop();
    ready();
  };
  const one = () => {
    if (--pending === 0) finish();
  };
  const timer = setTimeout(finish, maxWait);
  // Texturas: las que aún no han subido, a la cola; estos modelos esperan a las suyas.
  const who: Waiter = { n: 0, done: one };
  for (const o of objects) for (const t of texturesOf(o)) if (queueTexture(t, who)) who.n++;
  if (who.n > 0) pending++;
  // Shaders: todos a la vez (se compilan en paralelo).
  for (const o of objects) compile(gl, o, camera, scene, post);
  const forget = whenCompiled(gl, one);
  return () => {
    if (waiting) stop();
  };
}

/**
 * Prepara `objects` (que aún no hace falta que estén en la escena `scene`): compila sus shaders y
 * sube sus texturas. Llama a `ready` una vez, cuando está todo o tras `maxWait` ms (nunca dentro de
 * esta llamada: siempre después). Devuelve cómo dejarlo: ya no avisará.
 */
export function prepare(gl: WarmRenderer, objects: readonly THREE.Object3D[], camera: THREE.Camera, scene: THREE.Scene, post: boolean, ready: () => void, maxWait = MAX_WAIT_MS): () => void {
  let counted = true;
  const uncount = () => {
    if (!counted) return;
    counted = false;
    preparing--;
    preparedAt = performance.now();
  };
  preparing++;
  preparedAt = performance.now();
  const cancel = start(
    gl,
    objects,
    camera,
    scene,
    post,
    () => {
      uncount();
      ready();
    },
    maxWait,
  );
  return () => {
    cancel();
    uncount();
  };
}

/* ------------------------------------------------------------------ */
/* El repaso general                                                    */
/* ------------------------------------------------------------------ */

/** Hace falta un repaso (lugar nuevo, otro nivel, otro ambiente): hasta que se haga, el lugar no está preparado. */
let wanted = false;
let passing: (() => void) | null = null;
let passes = 0;

/** Pide un repaso general: el lugar no está preparado hasta que se haga. */
export function requestPass() {
  wanted = true;
}

/**
 * ¿Toca hacerlo ya? Cuando no queda ningún modelo preparándose y ha pasado un momento desde el
 * último (`SETTLE_MS`: así ya están todos en la escena). Quien llama mira además que el lugar haya
 * llegado y no quede nada descargándose (World.tsx).
 */
export function passDue(now = performance.now()): boolean {
  return wanted && !passing && preparing === 0 && now - preparedAt >= SETTLE_MS;
}

/**
 * El repaso: compila lo que haya en la escena sin compilar (también lo que aún no se ve) y sube sus
 * texturas. Lo ya compilado no cuesta nada: es recorrer la escena.
 */
export function runPass(gl: WarmRenderer, scene: THREE.Scene, camera: THREE.Camera, post: boolean, maxWait = MAX_WAIT_MS) {
  if (passing) return;
  wanted = false;
  let live = true;
  const cancel = start(
    gl,
    [scene],
    camera,
    scene,
    post,
    () => {
      if (!live) return;
      live = false;
      passing = null;
      passes++;
    },
    maxWait,
  );
  passing = () => {
    live = false;
    cancel();
  };
}

/** Deja el repaso (se desmonta el mundo): ni pendiente ni en marcha. */
export function dropPass() {
  passing?.();
  passing = null;
  wanted = false;
}

/** Cuántos repasos se han hecho (para saber si ya se ha hecho el primero). */
export function warmPasses(): number {
  return passes;
}

let holds = 0;
/**
 * Algo más que hace falta antes de dar el lugar por preparado (el post-proceso, la primera foto de
 * los reflejos): hasta que se llame a lo que devuelve.
 */
export function warmHold(): () => void {
  holds++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holds--;
  };
}

/**
 * ¿Queda algo preparándose? (Modelos que aún no se enseñan, texturas por subir, el repaso de un
 * lugar recién llegado o lo que alguien haya dicho con `warmHold`.) Mientras tanto la pantalla de
 * carga no se quita y la fluidez no se mide (World.tsx): no es que el equipo no aguante.
 */
export function warmBusy(): boolean {
  return preparing > 0 || (renderer !== null && queue.length > 0) || passing !== null || wanted || holds > 0;
}

/** ¿Está el lugar entero en la escena y compilado? (Para la foto de los reflejos: World.tsx.) */
export function warmSettled(now = performance.now()): boolean {
  return preparing === 0 && passing === null && !wanted && now - preparedAt >= SETTLE_MS;
}
