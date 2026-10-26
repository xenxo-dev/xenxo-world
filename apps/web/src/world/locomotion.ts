/**
 * Controlador del personaje en escritorio y móvil (en VR manda el casco).
 *
 * - Acelera y frena con suavidad (con poco control en el aire).
 * - Se desliza por las paredes en vez de pararse en seco.
 * - Sube escalones y bordillos (hasta STEP_UP) y baja escaleras pegado al suelo.
 * - Se puede caminar encima de cajas (bancos, bordes de fuente, muros bajos) llegando de un salto,
 *   y caerse de ellas; la cabeza choca con los techos.
 * - Salto con margen: vale pulsar un poco antes de tocar el suelo (buffer) o justo después de
 *   salir de un borde (coyote).
 * - Subpasos de 1/120 s: a cualquier tasa de frames no se atraviesan paredes finas.
 *
 * Sin objetos nuevos por frame: todo el estado vive en un objeto que se reutiliza.
 */
import { ceilingHeight, groundHeight, resolveCircle } from "./collision";

export const BODY_RADIUS = 0.32;
export const BODY_HEIGHT = 1.8;
/** Lo más alto que se sube andando, sin saltar (escalón, bordillo). */
export const STEP_UP = 0.45;
/** Lo más que se baja pegado al suelo (escaleras); más que esto y se cae. */
const STEP_DOWN = 0.35;
const GRAVITY = 15;
const JUMP_V = 5.2; // ≈ 0,9 m de salto
/** Rapidez con la que se alcanza la velocidad pedida (1/s): suelo, frenada y aire. */
const ACCEL = 11;
const BRAKE = 16;
const AIR = 2.2;
const COYOTE = 0.12; // s
const JUMP_BUFFER = 0.15; // s
const SUBSTEP = 1 / 120;
/** Caída máxima (no acelerar sin fin). */
const TERMINAL = 30;

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  /** Tiempo desde que dejó de pisar suelo (coyote). */
  airTime: number;
  /** Tiempo desde que se pidió saltar (buffer); Infinity si no hay salto pendiente. */
  jumpAge: number;
  /** El último salto se ha consumido (para no saltar dos veces con el mismo coyote). */
  jumped: boolean;
  /** Acaba de aterrizar con esta velocidad de caída (para la animación); 0 si no. */
  landed: number;
}

export function createBody(x: number, y: number, z: number): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, airTime: 0, jumpAge: Infinity, jumped: false, landed: 0 };
}

export function placeBody(b: Body, x: number, y: number, z: number) {
  b.x = x;
  b.y = y;
  b.z = z;
  b.vx = b.vy = b.vz = 0;
  b.grounded = true;
  b.airTime = 0;
  b.jumpAge = Infinity;
  b.jumped = false;
}

/** Pide un salto (se aplica en cuanto se pueda, dentro del margen). */
export function requestJump(b: Body) {
  b.jumpAge = 0;
}

const _p = { x: 0, z: 0 };

/**
 * Avanza el cuerpo `dt` segundos queriendo ir a (wantX, wantZ) m/s en el plano.
 * `bounds` limita el plano (el chunk), con un margen.
 */
export function stepBody(b: Body, wantX: number, wantZ: number, dt: number, min: number, max: number) {
  b.landed = 0;
  const total = Math.min(dt, 0.1);
  const n = Math.max(1, Math.ceil(total / SUBSTEP));
  const h = total / n;
  for (let i = 0; i < n; i++) substep(b, wantX, wantZ, h, min, max);
}

function substep(b: Body, wantX: number, wantZ: number, h: number, min: number, max: number) {
  // Horizontal: acercarse a la velocidad pedida (más rápido al frenar; poco en el aire).
  const wanting = wantX * wantX + wantZ * wantZ > 1e-4;
  const k = b.grounded ? (wanting ? ACCEL : BRAKE) : AIR;
  const a = Math.min(1, k * h);
  b.vx += (wantX - b.vx) * a;
  b.vz += (wantZ - b.vz) * a;

  const px = b.x;
  const pz = b.z;
  _p.x = b.x + b.vx * h;
  _p.z = b.z + b.vz * h;
  // Lo que queda por debajo de un paso no frena: se sube.
  resolveCircle(_p, BODY_RADIUS, b.y + STEP_UP, b.y + BODY_HEIGHT);
  _p.x = Math.min(max, Math.max(min, _p.x));
  _p.z = Math.min(max, Math.max(min, _p.z));
  b.x = _p.x;
  b.z = _p.z;
  // Contra una pared, la velocidad que no se pudo usar se pierde (desliza en vez de empujar).
  b.vx = (b.x - px) / h;
  b.vz = (b.z - pz) / h;

  // Salto: pedido hace poco y pisando suelo (o recién salido de un borde).
  b.jumpAge += h;
  if (b.jumpAge <= JUMP_BUFFER && !b.jumped && (b.grounded || b.airTime <= COYOTE)) {
    b.vy = JUMP_V;
    b.grounded = false;
    b.jumped = true;
    b.jumpAge = Infinity;
  }

  // Vertical
  const ground = groundHeight(b.x, b.z, BODY_RADIUS * 0.75, b.y + STEP_UP);
  if (b.grounded) {
    if (ground >= b.y - STEP_DOWN) {
      // Pegado al suelo: sube escalones y baja escaleras.
      b.y = ground;
      b.vy = 0;
    } else {
      b.grounded = false; // se acabó el suelo: a caer
      b.vy = 0;
    }
  }
  if (!b.grounded) {
    b.airTime += h;
    b.vy = Math.max(-TERMINAL, b.vy - GRAVITY * h);
    b.y += b.vy * h;
    if (b.vy > 0) {
      const ceil = ceilingHeight(b.x, b.z, BODY_RADIUS * 0.75, b.y + BODY_HEIGHT - b.vy * h - 0.01);
      if (b.y + BODY_HEIGHT > ceil) {
        b.y = ceil - BODY_HEIGHT;
        b.vy = 0;
      }
    }
    if (b.vy <= 0 && b.y <= ground) {
      b.landed = -b.vy;
      b.y = ground;
      b.vy = 0;
      b.grounded = true;
    }
  }
  if (b.grounded) {
    b.airTime = 0;
    b.jumped = false;
  }
}
