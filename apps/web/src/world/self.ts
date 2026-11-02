/**
 * Dónde está tu personaje, en un objeto plano (sin Three.js) para que el HUD pueda leerlo sin
 * cargar el módulo 3D. Lo escribe el jugador cada frame. `yaw`: hacia dónde mira el cuerpo
 * (adelante = (−sin, −cos)), para apuntar las acciones en pareja y los golpes. `vx, vz`: su
 * velocidad (m/s) y `wx, wz` la que pide (el joystick: contra alguien, la de empujarle), `emote` el
 * gesto que hace ahora (o null), `driving` si va al volante y `fight` si está en modo pelea. Lo leen
 * también los ciudadanos (city/citizens.ts) para darse cuenta de lo que haces.
 */
export const self = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, wx: 0, wz: 0, emote: null as string | null, driving: false, fight: false };
