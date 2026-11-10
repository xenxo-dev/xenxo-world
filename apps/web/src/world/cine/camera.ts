/**
 * Las cámaras del modo cine (state.ts). Cada plano parte de donde estaba la cámara al elegirlo:
 *  - orbit: gira despacio alrededor del personaje.
 *  - crane: sube y se aleja desde detrás (grúa), y se queda arriba.
 *  - tripod: quieta donde estaba, siguiendo al personaje con la mirada.
 *  - travel: se desliza de lado, mirando a donde miraba.
 * `follow` es la cámara de siempre (aquí no se hace nada). Sin objetos nuevos por frame.
 */
import * as THREE from "three";
import { cameraReach } from "../collision";
import { cine } from "./state";

const _target = new THREE.Vector3();
const _want = new THREE.Vector3();
const _right = new THREE.Vector3();
const anchor = { shot: -1, t0: 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), yaw: 0 };

const ORBIT_SPEED = 0.22; // rad/s: una vuelta en medio minuto
const ORBIT_RADIUS = 5.5;
const CRANE_SECONDS = 9;
const TRAVEL_SPEED = 1.1; // m/s

const ease = (k: number) => k * k * (3 - 2 * k);

/**
 * Coloca la cámara del plano elegido alrededor del personaje (en `x, y, z`, los pies). Devuelve
 * false si manda la cámara normal. `lookYaw`: hacia dónde mira el jugador; `time`: el reloj del mundo.
 */
export function cineCamera(cam: THREE.PerspectiveCamera, x: number, y: number, z: number, lookYaw: number, time: number): boolean {
  if (!cine.on || cine.cam === "follow") return false;
  if (anchor.shot !== cine.shot) {
    anchor.shot = cine.shot;
    anchor.t0 = time;
    anchor.pos.copy(cam.position);
    anchor.quat.copy(cam.quaternion);
    anchor.yaw = lookYaw;
  }
  const u = Math.max(0, time - anchor.t0);
  _target.set(x, y + 1.35, z);

  if (cine.cam === "tripod") {
    cam.position.copy(anchor.pos);
    cam.lookAt(_target);
    return true;
  }
  if (cine.cam === "travel") {
    _right.set(1, 0, 0).applyQuaternion(anchor.quat);
    cam.position.copy(anchor.pos).addScaledVector(_right, u * TRAVEL_SPEED);
    cam.quaternion.copy(anchor.quat);
    return true;
  }
  if (cine.cam === "orbit") {
    const a = anchor.yaw + u * ORBIT_SPEED;
    _want.set(_target.x + Math.sin(a) * ORBIT_RADIUS, _target.y + 0.9, _target.z + Math.cos(a) * ORBIT_RADIUS);
  } else {
    // Grúa: desde detrás y a ras de suelo hasta arriba y lejos, con un cuarto de vuelta.
    const k = ease(Math.min(1, u / CRANE_SECONDS));
    const a = anchor.yaw + k * 0.8;
    const r = 3.5 + k * 13;
    _want.set(_target.x + Math.sin(a) * r, _target.y - 0.6 + k * 12, _target.z + Math.cos(a) * r);
  }
  // Como la cámara normal: si hay una pared en medio, se acerca en vez de atravesarla.
  cam.position.lerpVectors(_target, _want, cameraReach(_target.x, _target.y, _target.z, _want.x, _want.y, _want.z));
  cam.lookAt(_target);
  return true;
}
