/**
 * Calentar un modelo antes de enseñarlo.
 *
 * La primera vez que algo se dibuja, Three.js compila su shader y espera a que acabe. En Windows (ANGLE
 * sobre Direct3D) cada variante de un material con luces tarda unos 300 ms, con la página congelada; y
 * como lo que no entra en la vista no se dibuja, esos parones salían al mirar alrededor por primera
 * vez en cada lugar (medido en un PC con una RX 5700 XT: de 0,25 a 0,45 s cada uno, tres seguidos al
 * entrar en un interior). Lo mismo con las texturas: suben a la gráfica en la imagen en que hacen falta,
 * todas las del modelo a la vez (una de 2048² son de 15 a 40 ms).
 *
 * Aquí el modelo se prepara antes de entrar en la escena: sus shaders se compilan en segundo plano
 * (`compileAsync`, con KHR_parallel_shader_compile: sin esperar) y sus texturas suben de una en una,
 * en ratos libres. Cuando está todo, se enseña. Lo que no está a la vista queda listo igual: al girarse
 * ya no hay nada que compilar.
 *
 * - Un modelo cuyos materiales ya están compilados (casi todos: se comparten) entra al momento.
 * - Mientras se prepara el modelo nuevo se sigue viendo el de antes (al cambiar de día a noche o de
 *   nivel gráfico, el mundo no desaparece ni un instante).
 * - Si algo se tuerce o tarda de más (`MAX_WAIT_MS`), se enseña igualmente: como antes de existir esto.
 * - Nunca en las gafas: allí la escena se pinta en otro tipo de búfer (otra variante del shader) y no
 *   está medido. El modelo se enseña tal cual.
 *
 * Sin React (los ganchos, en useWarmed.ts): lo prueba test/warm.mts.
 */
import * as THREE from "three";

/** Lo más que un modelo espera a estar preparado (ms). */
export const MAX_WAIT_MS = 4000;
/** Lo que se dedica a subir texturas en cada imagen (ms): pasado esto, la siguiente espera a la próxima. */
export const UPLOAD_BUDGET_MS = 4;

/** Lo que hace falta del renderizador (así la prueba no necesita una gráfica). */
export interface WarmRenderer {
  xr: { isPresenting: boolean };
  extensions: { has(name: string): boolean };
  compile(object: THREE.Object3D, camera: THREE.Camera, scene?: THREE.Scene | null): unknown;
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  setRenderTarget(target: THREE.WebGLRenderTarget | null, face?: number, mip?: number): void;
  compileAsync(object: THREE.Object3D, camera: THREE.Camera, scene?: THREE.Scene | null): Promise<unknown>;
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

/** ¿Se sube como una textura normal? (Las de un búfer de dibujo, de vídeo o de cubo, no.) */
function plain(t: THREE.Texture): boolean {
  const x = t as THREE.Texture & { isRenderTargetTexture?: boolean; isVideoTexture?: boolean; isCubeTexture?: boolean };
  return !x.isRenderTargetTexture && !x.isVideoTexture && !x.isCubeTexture;
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
 * En cada imagen: sube texturas de la cola mientras quede tiempo (`UPLOAD_BUDGET_MS`); siempre una,
 * para que la cola avance aunque una sola se lo coma entero. `now` es el reloj (para la prueba).
 */
export function tickWarm(now: () => number = () => performance.now()) {
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
  } while (queue.length && now() - t0 < UPLOAD_BUDGET_MS);
}

/** Cuántas texturas esperan (para la prueba). */
export function warmQueued(): number {
  return queue.length;
}

/**
 * ¿Queda algo preparándose? (Modelos que aún no se enseñan o texturas por subir.) Mientras tanto la
 * pantalla de carga no se quita y la fluidez no se mide (World.tsx): no es que el equipo no aguante.
 */
export function warmBusy(): boolean {
  return preparing > 0 || (renderer !== null && queue.length > 0);
}

let linear: THREE.WebGLRenderTarget | null = null;

/**
 * Compila los shaders de `object` sin bloquear. `post`: la escena se pinta en el búfer del
 * post-proceso (lineal y sin mapeo de tonos), que es otra variante de cada shader que pintando
 * directamente en el lienzo: hay que compilar la que se va a usar.
 */
function compile(gl: WarmRenderer, object: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene, post: boolean): Promise<unknown> {
  const prev = gl.getRenderTarget();
  const face = gl.getActiveCubeFace();
  const mip = gl.getActiveMipmapLevel();
  if (post) gl.setRenderTarget((linear ??= new THREE.WebGLRenderTarget(1, 1)));
  try {
    if (gl.extensions.has("KHR_parallel_shader_compile")) return gl.compileAsync(object, camera, scene);
    // Sin esa extensión no se puede saber cuándo acaban: se lanzan ya (la gráfica los va compilando) y
    // se sigue. Lo que no esté al dibujarlo esperará, como antes; lo que tarde en verse, ya estará.
    gl.compile(object, camera, scene);
    return Promise.resolve();
  } catch {
    return Promise.resolve();
  } finally {
    if (post) gl.setRenderTarget(prev, face, mip);
  }
}

/**
 * Prepara `objects` (que aún no hace falta que estén en la escena `scene`): compila sus shaders y
 * sube sus texturas. Llama a `ready` una vez, cuando está todo o tras `maxWait` ms (nunca dentro de
 * esta llamada: siempre después). Devuelve cómo dejarlo: ya no avisará.
 */
export function prepare(gl: WarmRenderer, objects: readonly THREE.Object3D[], camera: THREE.Camera, scene: THREE.Scene, post: boolean, ready: () => void, maxWait = MAX_WAIT_MS): () => void {
  let waiting = true;
  let pending = 1;
  preparing++;
  const finish = () => {
    if (!waiting) return;
    waiting = false;
    preparing--;
    clearTimeout(timer);
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
  Promise.all(objects.map((o) => compile(gl, o, camera, scene, post))).then(one, one);
  return () => {
    if (!waiting) return;
    waiting = false;
    preparing--;
    clearTimeout(timer);
  };
}
