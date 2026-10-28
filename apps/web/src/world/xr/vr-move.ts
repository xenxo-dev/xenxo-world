/**
 * Moverse en VR (gafas): joystick izquierdo para andar, derecho a los lados para girar a saltos de
 * 30° (alrededor de la cabeza, no del centro de la habitación) y hacia delante para el arco del
 * teletransporte. El suelo es el de verdad: escaleras, la pasarela de Distrito Cero e interiores
 * (las mismas cajas y mallas que el personaje en pantalla, collision.ts), y las paredes frenan.
 *
 * El «origen» XR (la habitación de la persona) es lo que se mueve: su altura son los pies.
 * Sin objetos nuevos por frame.
 */
import * as THREE from "three";
import { cameraReach, ceilingHeight, floorAt, groundHeight, resolveCircle } from "../collision";
import { BODY_HEIGHT, STEP_UP } from "../locomotion";

/** Velocidad andando con el joystick (m/s). */
export const VR_WALK = 3;
/** Giro por pasos (menos mareo que el giro continuo). */
export const VR_SNAP = (30 * Math.PI) / 180;
/** Radio de la persona para las paredes (la cabeza; más estrecho que en pantalla: es su cuerpo real). */
const HEAD_R = 0.25;
/** Lo más que cuenta un frame al andar (s): a 3 m/s, 15 cm, menos que el radio de la cabeza y la pared más fina. */
const MAX_STEP_DT = 0.05;
/** Bajar más que esto es caer (en escaleras, se baja sin más). */
const STEP_DOWN = 0.5;
const GRAVITY = 15;

/** El arco del teletransporte: tiro parabólico desde el mando derecho. */
const ARC_SPEED = 8;
const ARC_GRAVITY = 9.8;
const ARC_DT = 0.04;
export const ARC_POINTS = 40;
/** Más cerca que esto no tiene sentido teletransportarse; más lejos, el arco ya no llega. */
const MIN_JUMP = 0.6;
/** Altura libre que hace falta en el destino. */
const HEADROOM = 1.9;

/** Lo que el resto de la VR necesita saber (el panel, el arco y el jugador). */
export const vr = {
  /** La habitación de la persona (XROrigin), la pone Player. */
  origin: null as THREE.Group | null,
  /** Velocidad vertical al caer de un borde. */
  vy: 0,
  /** Se ha movido (joystick o teletransporte) este frame: cancela los gestos. */
  moved: false,
  /** El arco: puntos (x, y, z) y cuántos se usan; destino y si vale. */
  arc: new Float32Array(ARC_POINTS * 3),
  arcCount: 0,
  aiming: false,
  valid: false,
  target: new THREE.Vector3(),
};

const _head = new THREE.Vector3();
const _p = { x: 0, z: 0 };
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _v = new THREE.Vector3();

/** Pone la habitación en un sitio (aparecer por un portal o al entrar en VR): los pies en `y`. */
export function placeOrigin(x: number, y: number, z: number) {
  const o = vr.origin;
  if (!o) return;
  o.position.set(x, y, z);
  vr.vy = 0;
}

/**
 * El joystick (lo llama useXRControllerLocomotion con la velocidad ya girada hacia donde mira la
 * cabeza y el giro por pasos). El giro es alrededor de la cabeza: la persona no se desplaza al girar.
 */
export function vrStick(velocity: THREE.Vector3, yRot: number, dt: number, camera: THREE.Camera) {
  const o = vr.origin;
  if (!o) return;
  if (velocity.x || velocity.z) {
    // Con un frame largo (un tirón), se avanza menos en vez de saltarse una pared: las paredes se
    // resuelven una vez por frame (vrFollowGround) y un paso grande las atravesaría.
    const h = Math.min(dt, MAX_STEP_DT);
    o.position.x += velocity.x * h;
    o.position.z += velocity.z * h;
    vr.moved = true;
  }
  if (yRot) {
    camera.getWorldPosition(_head);
    // Girar la habitación alrededor del eje vertical que pasa por la cabeza.
    const dx = o.position.x - _head.x, dz = o.position.z - _head.z;
    const c = Math.cos(yRot), s = Math.sin(yRot);
    o.position.x = _head.x + dx * c + dz * s;
    o.position.z = _head.z - dx * s + dz * c;
    o.rotation.y += yRot;
  }
}

/**
 * Cada frame, con la cabeza ya puesta: la saca de las paredes y lleva los pies al suelo que hay
 * debajo (sube escalones, baja escaleras, cae de los bordes). Devuelve la altura de los pies.
 */
export function vrFollowGround(camera: THREE.Camera, dt: number): number {
  const o = vr.origin;
  if (!o) return 0;
  camera.getWorldPosition(_head);
  const feet = o.position.y;
  _p.x = _head.x;
  _p.z = _head.z;
  resolveCircle(_p, HEAD_R, feet + STEP_UP, feet + BODY_HEIGHT);
  if (_p.x !== _head.x || _p.z !== _head.z) {
    o.position.x += _p.x - _head.x;
    o.position.z += _p.z - _head.z;
  }
  const ground = groundHeight(_p.x, _p.z, 0.15, feet + STEP_UP);
  const k = Math.min(1, dt * 12);
  if (ground >= feet - STEP_DOWN && vr.vy === 0) {
    // Pegado al suelo: escalones y escaleras con suavidad.
    o.position.y = feet + (ground - feet) * k;
    if (Math.abs(o.position.y - ground) < 0.002) o.position.y = ground;
  } else {
    // Al aire: cae hasta el suelo.
    vr.vy = Math.min(30, vr.vy + GRAVITY * dt);
    o.position.y = Math.max(ground, feet - vr.vy * dt);
    if (o.position.y <= ground) vr.vy = 0;
  }
  return o.position.y;
}

/**
 * El arco desde el mando (posición y dirección en el mundo). Rellena `vr.arc` y dice si el destino
 * vale: suelo debajo, sitio libre (sin pared) y altura para estar de pie.
 */
export function vrAim(from: THREE.Vector3, dir: THREE.Vector3) {
  vr.aiming = true;
  vr.valid = false;
  _a.copy(from);
  _v.copy(dir).normalize().multiplyScalar(ARC_SPEED);
  const feet = vr.origin?.position.y ?? 0;
  let n = 0;
  const put = (p: THREE.Vector3) => {
    vr.arc[n * 3] = p.x;
    vr.arc[n * 3 + 1] = p.y;
    vr.arc[n * 3 + 2] = p.z;
    n++;
  };
  put(_a);
  for (let i = 1; i < ARC_POINTS; i++) {
    _b.set(_a.x + _v.x * ARC_DT, _a.y + _v.y * ARC_DT - 0.5 * ARC_GRAVITY * ARC_DT * ARC_DT, _a.z + _v.z * ARC_DT);
    _v.y -= ARC_GRAVITY * ARC_DT;
    const floor = floorAt(_b.x, _b.z, _a.y);
    if (_b.y <= floor) {
      // Toca suelo: el punto exacto del cruce en este tramo.
      const k = (_a.y - floor) / Math.max(1e-4, _a.y - _b.y);
      _b.set(_a.x + (_b.x - _a.x) * k, floor, _a.z + (_b.z - _a.z) * k);
      put(_b);
      vr.target.copy(_b);
      vr.valid = landing(_b.x, floor, _b.z, feet);
      break;
    }
    // Algo en medio: si es el frente de un escalón (o un bordillo), se cae encima; si es una
    // pared, el arco se para ahí y no vale.
    if (cameraReach(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z) < 0.99) {
      const top = floorAt(_b.x, _b.z, _b.y + STEP_UP);
      if (top > _b.y && top - _b.y <= STEP_UP) {
        _b.y = top;
        put(_b);
        vr.target.copy(_b);
        vr.valid = landing(_b.x, top, _b.z, feet);
      } else put(_b);
      break;
    }
    put(_b);
    _a.copy(_b);
    if (_a.y < feet - 20) break;
  }
  vr.arcCount = n;
}

function landing(x: number, y: number, z: number, feet: number) {
  if (vr.origin && Math.hypot(x - _head.x, z - _head.z) < MIN_JUMP && Math.abs(y - feet) < 0.2) return false;
  _p.x = x;
  _p.z = z;
  resolveCircle(_p, 0.3, y + STEP_UP, y + BODY_HEIGHT);
  if (Math.abs(_p.x - x) > 0.02 || Math.abs(_p.z - z) > 0.02) return false;
  return ceilingHeight(x, z, 0.2, y + 0.1) - y >= HEADROOM;
}

/** Suelta el arco: si el destino vale, la cabeza aparece encima (misma orientación) y los pies en él. */
export function vrRelease(camera: THREE.Camera): boolean {
  const ok = vr.aiming && vr.valid;
  vr.aiming = false;
  vr.arcCount = 0;
  const o = vr.origin;
  if (!ok || !o) return false;
  camera.getWorldPosition(_head);
  o.position.x += vr.target.x - _head.x;
  o.position.z += vr.target.z - _head.z;
  o.position.y = vr.target.y;
  vr.vy = 0;
  vr.moved = true;
  return true;
}

/** Deja de apuntar sin moverse. */
export function vrCancelAim() {
  vr.aiming = false;
  vr.arcCount = 0;
}
