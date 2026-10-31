/**
 * Dónde está tu personaje, en un objeto plano (sin Three.js) para que el HUD pueda leerlo sin
 * cargar el módulo 3D. Lo escribe el jugador cada frame. `yaw`: hacia dónde mira el cuerpo
 * (adelante = (−sin, −cos)), para apuntar las acciones en pareja y los golpes.
 */
export const self = { x: 0, y: 0, z: 0, yaw: 0 };
