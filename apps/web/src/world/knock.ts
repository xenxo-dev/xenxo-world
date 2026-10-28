/**
 * Atropellos de la gente de decorado (peatones y residentes), al estilo de los juegos de mundo
 * abierto pero sin violencia: con un golpe flojo, un traspié; con uno fuerte, sale despedida en arco,
 * cae de espaldas, se queda un momento en el suelo y se levanta. Lo dispara la física del coche
 * (`npcs.knock` en collision.ts) y lo aplican CityLife e Interiors al colocar a cada persona.
 * Sin objetos nuevos por frame.
 */
import * as THREE from "three";
import { npcs } from "./collision";
import type { Motion } from "./motion";

/** Por encima de esta velocidad (m/s), cae; por debajo, solo tropieza. */
const FALL_SPEED = 2.5;
const FLY = 0.45, LIE = 1.7, UP = 2.6, BACK = 4.2;
const STUMBLE = 0.8, STUMBLE_BACK = 2;

const _tilt = new THREE.Quaternion();
const _yaw = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const ease = (k: number) => 1 - (1 - k) * (1 - k);

/**
 * Si la persona del hueco `i` está atropellada, la coloca (desde su sitio de siempre `x, y, z` y
 * su giro `yaw`) despedida, en el suelo o levantándose, y devuelve true mientras no puede andar.
 * Si no, no toca nada y devuelve false.
 */
export function knockApply(i: number, g: THREE.Object3D, x: number, y: number, z: number, yaw: number, motion: Motion): boolean {
  const t0 = npcs.knock[i * 4]!;
  if (!t0) return false;
  const t = (performance.now() - t0) / 1000;
  const nx = npcs.knock[i * 4 + 1]!, nz = npcs.knock[i * 4 + 2]!, speed = npcs.knock[i * 4 + 3]!;
  const fall = speed >= FALL_SPEED;
  const end = fall ? BACK : STUMBLE_BACK;
  if (t > end) {
    npcs.knock[i * 4] = 0;
    return false;
  }
  // Cuánto sale despedida, cuánto se inclina y en qué fase está.
  let push: number, tilt: number, lift = 0, paused: boolean;
  const dist = fall ? Math.min(4, 0.6 + speed * 0.32) : Math.min(0.8, 0.25 + speed * 0.2);
  if (fall) {
    if (t < FLY) {
      const k = t / FLY;
      push = dist * ease(k);
      lift = Math.min(0.9, speed * 0.07) * Math.sin(Math.PI * k);
      tilt = 1.5 * ease(k);
    } else if (t < LIE) {
      push = dist;
      tilt = 1.5;
    } else if (t < UP) {
      const k = (t - LIE) / (UP - LIE);
      push = dist;
      tilt = 1.5 * (1 - ease(k));
    } else {
      // De pie: vuelve andando a su sitio.
      push = dist * (1 - (t - UP) / (BACK - UP));
      tilt = 0;
    }
    paused = t < UP;
    motion.emote = t > LIE && t < UP ? "crouch" : null;
  } else {
    const k = Math.min(1, t / 0.3);
    push = t < STUMBLE ? dist * ease(k) : dist * (1 - (t - STUMBLE) / (STUMBLE_BACK - STUMBLE));
    tilt = t < STUMBLE ? 0.3 * Math.sin(Math.PI * Math.min(1, t / STUMBLE)) : 0;
    paused = t < STUMBLE;
  }
  if (paused) motion.speed = 0;
  g.position.set(x + nx * push, y + lift, z + nz * push);
  // Se inclina hacia donde sale despedida (eje horizontal perpendicular al golpe), sobre los pies.
  _axis.set(nz, 0, -nx);
  _tilt.setFromAxisAngle(_axis, tilt);
  _yaw.setFromAxisAngle(_up, yaw);
  g.quaternion.copy(_tilt).multiply(_yaw);
  return paused;
}

/** ¿Sigue sin poder andar la persona del hueco `i`? (para que el peatón no avance mientras tanto) */
export function knockPaused(i: number): boolean {
  const t0 = npcs.knock[i * 4]!;
  if (!t0) return false;
  const t = (performance.now() - t0) / 1000;
  return t < (npcs.knock[i * 4 + 3]! >= FALL_SPEED ? UP : STUMBLE);
}
