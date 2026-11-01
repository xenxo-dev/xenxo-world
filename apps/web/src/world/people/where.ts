/**
 * Dónde se dibuja ahora a cada persona (pies, ya interpolado): lo escriben los avatares de los demás
 * (Avatars.tsx) y lo leen los efectos de la gente (reacciones, golpes, parejas, la marca del modo
 * pelea) para salir justo donde se ve a cada uno.
 */
import type * as THREE from "three";

export const remoteFeet = new Map<string, THREE.Vector3>();
