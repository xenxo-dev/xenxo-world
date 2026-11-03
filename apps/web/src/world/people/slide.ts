/**
 * Deslizarse en el modo pelea (en todos los distritos con pelea; en Vertical el parkour se apaga con
 * el modo pelea y esto es lo que queda de él): corriendo, agacharse (X o el botón) lanza el cuerpo por
 * el suelo unos metros. Mientras dura, los puñetazos le pasan por encima (lo comprueba el servidor con
 * la pose: `pk_slide`) y, si llega a las piernas de alguien en modo pelea, la barrida lo tira (HIT
 * `slide`); a la gente de las ciudades, también. Lo de la pose y la animación es lo del parkour
 * (`pk_slide`, `pk_slideup`): los demás lo dibujan igual. Sin objetos nuevos por frame.
 */
import { people } from "../../net/people-store";
import { fightTarget, hitReady, sendHit } from "../../net/people";
import { crowd } from "../collision";
import { stepBody, type Body } from "../locomotion";
import { impact, whoosh } from "./fight-audio";

/** A partir de esta velocidad (m/s, corriendo) agacharse es deslizarse. */
export const SLIDE_MIN = 3.8;
/** Velocidad al empezar (m/s), cuánto frena (m/s²) y por debajo de cuánto se acaba. */
const SLIDE_V = 7;
const SLIDE_BRAKE = 7.5;
const SLIDE_END = 2;
/** Levantarse (s). */
const UP_S = 0.35;
/** Durante cuánto puede barrer (s desde que empieza). */
const SWEEP_S = 0.7;
/** A la gente de decorado: a cuánto por delante (m) y con qué fuerza (m/s; por encima de 2,5 cae). */
const NPC_REACH = 1.15;
const NPC_SWEEP = 3.4;

const st = { t: -1, up: -1, dx: 0, dz: 0, v: 0, swept: false };
const _n = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, z: 0 };

/** ¿Deslizándose (o levantándose)? Mientras, manda esto y no el joystick. */
export function sliding(): boolean {
  return st.t >= 0 || st.up >= 0;
}

/** Lo que lleva la pose: deslizándose, levantándose o nada. */
export function slideEmote(): string | null {
  return st.t >= 0 ? "pk_slide" : st.up >= 0 ? "pk_slideup" : null;
}

/** Cómo va el levantarse (0–1), para la animación. */
export function slideP(): number {
  return st.up >= 0 ? Math.min(1, st.up / UP_S) : 0;
}

/** Hacia dónde se desliza (unitario), para girar el cuerpo (el mismo objeto cada vez). */
export function slideDir(): { readonly x: number; readonly z: number } {
  _dir.x = st.dx;
  _dir.z = st.dz;
  return _dir;
}

/** Al cambiar de lugar, al caer o al reaparecer: se acabó. */
export function cancelSlide() {
  st.t = st.up = -1;
}

/** Empieza si se puede: en el suelo y corriendo. */
export function startSlide(b: Body): boolean {
  const v = Math.hypot(b.vx, b.vz);
  if (!b.grounded || v < SLIDE_MIN || sliding()) return false;
  st.t = 0;
  st.up = -1;
  st.dx = b.vx / v;
  st.dz = b.vz / v;
  st.v = Math.max(v, SLIDE_V);
  st.swept = false;
  whoosh(b.x, b.z, true);
  return true;
}

/** Un paso: el cuerpo por el suelo (las mismas colisiones), la barrida y, al final, de pie. */
export function slideStep(b: Body, dt: number, min: number, max: number) {
  // Como stepBody: un frame largo no cuenta más de 0,1 s (si no, frenaría sin haber avanzado).
  dt = Math.min(dt, 0.1);
  if (st.t >= 0) {
    st.t += dt;
    st.v = Math.max(0, st.v - SLIDE_BRAKE * dt);
    stepBody(b, st.dx * st.v, st.dz * st.v, dt, min, max);
    if (!st.swept && st.t < SWEEP_S) sweep(b);
    if (st.v < SLIDE_END || !b.grounded || st.t > 1.2) {
      st.t = -1;
      st.up = 0;
    }
    return;
  }
  if (st.up < 0) return;
  st.up += dt;
  stepBody(b, st.dx * 0.8, st.dz * 0.8, dt, min, max);
  if (st.up >= UP_S) st.up = -1;
}

/** La barrida: a quien esté en modo pelea a sus piernas o, si no, a la gente de decorado. */
function sweep(b: Body) {
  // En los distritos de empujones solo se empuja: deslizarse sí, barrer no.
  if (people.style === "shove") return;
  const who = fightTarget("slide", 0);
  if (who) {
    if (!hitReady()) return;
    st.swept = true;
    sendHit(who.id, "slide");
    return;
  }
  for (let k = 0; k < crowd.count; k++) {
    crowd.at(k, _n);
    const dx = _n.x - b.x, dz = _n.z - b.z;
    const d = Math.hypot(dx, dz);
    if (d > NPC_REACH || Math.abs(_n.y - b.y) > 1 || (d > 0.2 && (dx * st.dx + dz * st.dz) / d < 0.4)) continue;
    // Ya en el suelo: no se le vuelve a dar (crowd.hit lo dice).
    if (crowd.hit(k, st.dx, st.dz, NPC_SWEEP, false)) {
      st.swept = true;
      impact(_n.x, _n.z, 0.6, false);
      return;
    }
  }
}
