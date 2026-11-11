/**
 * Mucha gente a la vez: a quién se dibuja a cada frame y a quién no.
 *
 * Cada persona con su personaje cuesta lo suyo en cada frame (animar su esqueleto, recalcular sus
 * matrices, recorrerla para dibujarla): con veinte alrededor es más que todo el resto del lugar.
 * Aquí se decide, una vez por frame y antes de que nadie se anime:
 *
 *  - Quien no entra en la vista de la cámara no se toca: ni se anima ni se recalcula (lo normal en
 *    un corro es tener a media gente a la espalda).
 *  - De los que se ven, los `full` más cercanos van a cada frame; los `full` siguientes, a uno de
 *    cada dos; el resto, a uno de cada tres (repartidos, para que no les toque a todos a la vez).
 *    El frame que no les toca se quedan como estaban: no cuestan más que sus llamadas de dibujo.
 *    Quien pelea o está cayendo va siempre a cada frame.
 *
 * Los avatares se apuntan aquí (`joinCrowd`) y cada frame dicen dónde están. La decisión no
 * depende de Three.js salvo por la vista de la cámara (`crowdView`): se prueba en Node.
 */
import * as THREE from "three";

export interface CrowdEntry {
  /** Dónde está (su cabeza) y a qué distancia² de quien juega: lo escribe su avatar cada frame. */
  x: number;
  y: number;
  z: number;
  d2: number;
  /** Se le dibuja (ni lejos ni sin noticias): lo escribe su avatar. */
  shown: boolean;
  /** Pelea o está cayendo: siempre a cada frame. */
  lively: boolean;
  /** Lo que se decide aquí para este frame: entra en la vista y no le toca este frame. */
  inView: boolean;
  skip: boolean;
  /** Para repartir a quién le toca cada frame. */
  slot: number;
  /** Su estado de movimiento: aquí se le apunta si este frame no le toca (lo lee quien lo anima). */
  motion: { skip?: boolean };
}

const entries = new Set<CrowdEntry>();
let nextSlot = 0;

export function joinCrowd(motion: { skip?: boolean }): CrowdEntry {
  const e: CrowdEntry = { x: 0, y: 0, z: 0, d2: Infinity, shown: false, lively: false, inView: true, skip: false, slot: nextSlot++, motion };
  entries.add(e);
  return e;
}
export function leaveCrowd(e: CrowdEntry) {
  entries.delete(e);
  e.motion.skip = false;
}

/** Radio (m) de la esfera con que se mira si alguien entra en la vista: holgada, para que al girar ya esté animado. */
const VIEW_RADIUS = 2.4;
/** Con sombras del sol, más: la sombra de quien queda justo fuera sí se ve. */
const VIEW_RADIUS_SHADOW = 6;

const MAX = 256;
const dist = new Float32Array(MAX);
const _proj = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();
let frame = 0;

/** La vista de la cámara de este frame (sus matrices son las del último dibujo: de ahí la holgura). */
export function crowdView(camera: THREE.Camera) {
  _frustum.setFromProjectionMatrix(_proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
}

/**
 * Una vez por frame, antes de animar a nadie. `full`: a cuántos se dibuja a cada frame
 * (FEATURES.crowd). `shadows`: hay sombras del sol. `culled` = false: sin mirar la vista (pruebas).
 */
export function crowdFrame(full: number, shadows = false, culled = true) {
  frame++;
  const r = shadows ? VIEW_RADIUS_SHADOW : VIEW_RADIUS;
  let n = 0;
  for (const e of entries) {
    if (culled) {
      _sphere.center.set(e.x, e.y - 0.7, e.z);
      _sphere.radius = r;
      e.inView = _frustum.intersectsSphere(_sphere);
    } else e.inView = true;
    if (e.inView && e.shown && n < MAX) dist[n++] = e.d2;
  }
  let near = Infinity, mid = Infinity;
  if (n > full && full > 0) {
    dist.fill(Infinity, n);
    dist.sort();
    near = dist[full - 1]!;
    if (n > full * 2) mid = dist[full * 2 - 1]!;
  }
  for (const e of entries) {
    const rate = e.lively || e.d2 <= near ? 1 : e.d2 <= mid ? 2 : 3;
    e.skip = e.inView && e.shown && rate > 1 && (frame + e.slot) % rate !== 0;
    e.motion.skip = e.skip;
  }
}
