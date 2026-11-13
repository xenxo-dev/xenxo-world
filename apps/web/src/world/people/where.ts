/**
 * Dónde se dibuja ahora a cada persona (pies, ya interpolado): lo escriben los avatares de los demás
 * (Avatars.tsx) y lo leen los efectos de la gente (reacciones, golpes, parejas, la marca del modo
 * pelea) para salir justo donde se ve a cada uno.
 */
import type * as THREE from "three";
import type { PersonFx } from "./rig";

export const remoteFeet = new Map<string, THREE.Vector3>();

/**
 * Lo que la gente le pide al esqueleto de cada persona (y, cuando ha cargado su avatar, su esqueleto:
 * `rig.size`): para que en pareja cada uno sepa lo que mide la otra persona (pair.ts).
 */
export const remoteFx = new Map<string, PersonFx>();

/**
 * Lo tuyo (people/selfPeople.ts): `fx`, para quien hace contigo una acción en pareja; y esa acción,
 * con quién (`with`: su clave aquí, la sesión o el ciudadano; vacío si no hay) y por dónde va (`t`, s,
 * con tu reloj). Quien la hace contigo se dibuja con su pose, que llega con retraso: en tu pantalla,
 * sus manos van con tu reloj (remotePeople.ts, city/citizens.ts), o las vuestras no se encontraban.
 */
export const mine: { fx: PersonFx | null; with: string; t: number } = { fx: null, with: "", t: 0 };
