/**
 * Disparar (§9 octies ter), del lado del propio jugador. Donde hay armas (Distrito Cero) y con el modo
 * pelea, la Z (mantenida, en las de ráfaga) o el botón del HUD dispara el arma que llevas
 * (net/weapons.ts; la T la cambia). Al disparar se saca el arma (las manos apuntan con el IK:
 * arms.ts), el personaje se gira hacia donde apuntas y el rayo va a quien tengas delante en el modo
 * pelea o, si no, a alguien de la ciudad (con un poco de ayuda para apuntar, si se le ve); si no hay
 * nadie, hasta la primera pared. Unos segundos sin disparar y se guarda. El servidor decide lo que
 * llega a las personas; a la gente de la ciudad le llega como un golpe (collision.ts → crowd.hit).
 * Sin objetos nuevos por frame (un disparo crea su aviso, nada más).
 */
import { SHOT_MAX_DY, WEAPONS, type WeaponId } from "@xenxo/protocol";
import { people } from "../../net/people-store";
import { sendShoot, weapons } from "../../net/weapons";
import { world } from "../../net/world-store";
import { crowd, npcs, NPC_CITY, rayReach } from "../collision";
import { input, view } from "../input";
import type { Motion } from "../motion";
import { aimHands, muzzles } from "./arms";
import { zap } from "./fight-audio";
import { camKick, knockedOut, peopleBusy, selfFx, striking } from "./selfPeople";
import { remoteFeet } from "./where";

/** Se guarda el arma tras esto sin disparar (s). */
const HOLSTER_S = 3.5;
/** Ayuda para apuntar: hasta este ángulo (rad) de donde miras. */
const AIM_CONE = 0.42;
/** Un disparo pedido justo antes de poder salir (s): sale en cuanto se pueda. */
const BUFFER_S = 0.18;
/** Mientras se dispara a alguien, el cuerpo sigue girado hacia él esto (ms). */
const LOCK_MS = 700;
/** La clave de tu arma en `muzzles` (HeldWeapon del jugador). */
export const SELF_GUN = "self";

export const gun = {
  /** Sacada (se ve en la mano, apuntando). */
  drawn: false,
  /** Segundos sin disparar. */
  idle: 0,
  /** Último disparo (performance.now, ms). */
  last: -1e9,
  /** Pedido y aún sin salir (s que le quedan). */
  queued: 0,
  /** Las manos las lleva el arma (para soltarlas una sola vez). */
  hands: false,
  /** Hacia dónde apunta (giro): mientras está sacada, Player gira el cuerpo hacia ahí. */
  yaw: 0,
  lockYaw: 0,
  lockAt: -1e9,
};

export interface GunCtx {
  body: { x: number; y: number; z: number };
  motion: Motion;
  bodyYaw: { current: number };
  look: { yaw: number; pitch: number };
}

/** Al cambiar de lugar o aparecer en otro sitio: guardada. */
export function resetGun(motion: Motion) {
  holster(motion);
  gun.queued = 0;
  gun.last = -1e9;
}

function holster(motion: Motion) {
  gun.drawn = false;
  gun.idle = 0;
  motion.weapon = null;
  if (gun.hands) {
    selfFx.reachL.w = selfFx.reachR.w = 0;
    gun.hands = false;
  }
}

/**
 * Un frame. `free`: el personaje es tuyo (ni en coche ni en el suelo, ni en pareja). Pone en
 * `motion.weapon` la que se ve en la mano y, sacada, las manos apuntando.
 */
export function gunFrame(dt: number, c: GunCtx, free: boolean) {
  const here = weapons.here;
  const armed = !!here && people.fightOn && !!people.style && free && !knockedOut() && world.status === "open";
  if (input.nextWeapon) {
    input.nextWeapon = false;
    if (armed && here.length > 1) {
      weapons.next();
      draw();
    }
  }
  if (input.firePressed) {
    input.firePressed = false;
    if (armed) gun.queued = BUFFER_S;
    else if (here && !people.fightOn && free) people.setNotice("weapons.needFight");
    else if (!here && people.fightOn && people.style && free) people.setNotice("weapons.notHere");
  }
  // Golpeando, en pareja o cayendo, las manos son de la gente; sin poder disparar, guardada.
  if (!armed || peopleBusy() || striking()) {
    if (gun.drawn || gun.hands) holster(c.motion);
    gun.queued = 0;
    return;
  }
  const id = weapons.current;
  const spec = WEAPONS[id];
  const now = performance.now();
  const wants = gun.queued > 0 || (spec.auto && input.fire);
  gun.queued = Math.max(0, gun.queued - dt);
  if (wants && now - gun.last >= spec.gapMs) {
    gun.queued = 0;
    fire(c, id, now);
  }
  if (gun.drawn) {
    gun.idle += dt;
    if (gun.idle > HOLSTER_S && !input.fire) return holster(c.motion);
    gun.yaw = now - gun.lockAt < LOCK_MS ? gun.lockYaw : c.look.yaw;
    c.motion.weapon = id;
    aimHands(selfFx, c.body.x, c.body.y, c.body.z, c.bodyYaw.current, id);
    gun.hands = true;
    // La cabeza, hacia donde apunta.
    selfFx.look.x = c.body.x - Math.sin(gun.yaw) * 6;
    selfFx.look.y = c.body.y + 1.5;
    selfFx.look.z = c.body.z - Math.cos(gun.yaw) * 6;
    selfFx.look.w = 0.7;
  }
}

function draw() {
  gun.drawn = true;
  gun.idle = 0;
}

const _n = { x: 0, y: 0, z: 0 };
/** Hueco (collision.ts) de la persona k de la gente de decorado. */
const slotOf = (k: number) => (k < npcs.count ? k : NPC_CITY + k - npcs.count);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A quién va el disparo: una persona en el modo pelea (`id`), alguien de la ciudad (`npc`) o nadie. */
const target = { id: "", npc: -1, x: 0, y: 0, z: 0 };

/**
 * La ayuda para apuntar: de quien esté en el modo pelea delante (dentro del cono, a su alcance y a la
 * vista), el más centrado; si no hay nadie, de la gente de la ciudad. Desde el pecho (fx, fy, fz).
 */
function pickTarget(fx: number, fy: number, fz: number, yaw: number, range: number) {
  target.id = "";
  target.npc = -1;
  let best = Infinity;
  for (const id of people.fighters) {
    if (id === world.sessionId || people.downUntil(id)) continue;
    const p = remoteFeet.get(id);
    if (!p) continue;
    const dx = p.x - fx, dz = p.z - fz, d = Math.hypot(dx, dz);
    if (d > range || d < 0.3 || Math.abs(p.y - (fy - 1.4)) > SHOT_MAX_DY) continue;
    const ang = Math.abs(wrap(Math.atan2(-dx, -dz) - yaw));
    if (ang > AIM_CONE) continue;
    const score = ang + d * 0.01;
    if (score >= best || rayReach(fx, fy, fz, p.x, p.y + 1.15, p.z) < 0.97) continue;
    best = score;
    target.id = id;
    target.x = p.x;
    target.y = p.y + 1.15;
    target.z = p.z;
  }
  if (target.id) return;
  for (let k = 0; k < crowd.count; k++) {
    if (npcs.down[slotOf(k)]) continue;
    crowd.at(k, _n);
    const dx = _n.x - fx, dz = _n.z - fz, d = Math.hypot(dx, dz);
    if (d > range || d < 0.3 || Math.abs(_n.y - (fy - 1.4)) > SHOT_MAX_DY) continue;
    const ang = Math.abs(wrap(Math.atan2(-dx, -dz) - yaw));
    if (ang > AIM_CONE) continue;
    const score = ang + d * 0.01;
    if (score >= best || rayReach(fx, fy, fz, _n.x, _n.y + 1.1, _n.z) < 0.97) continue;
    best = score;
    target.npc = k;
    target.x = _n.x;
    target.y = _n.y + 1.1;
    target.z = _n.z;
  }
}

function fire(c: GunCtx, id: WeaponId, now: number) {
  const spec = WEAPONS[id];
  draw();
  gun.last = now;
  const { body } = c;
  const yaw = c.look.yaw;
  // Desde el pecho se elige a quién; el rayo sale de la boca del cañón (si ya se ve el arma).
  const cx = body.x, cy = body.y + 1.4, cz = body.z;
  pickTarget(cx, cy, cz, yaw, spec.range);
  let ax: number, ay: number, az: number;
  if (target.id || target.npc >= 0) {
    ax = target.x;
    ay = target.y;
    az = target.z;
    gun.lockYaw = Math.atan2(-(ax - cx), -(az - cz));
    gun.lockAt = now;
  } else {
    // Al frente (en primera persona, también hacia arriba o abajo), hasta su alcance.
    const pitch = view.firstPerson ? c.look.pitch : 0;
    const h = Math.cos(pitch) * spec.range;
    ax = cx - Math.sin(yaw) * h;
    ay = cy + Math.sin(pitch) * spec.range;
    az = cz - Math.cos(yaw) * h;
  }
  const m = muzzles.get(SELF_GUN);
  const fresh = !!m && now - m.t < 250 && gun.hands;
  const sx = fresh ? m!.x : cx - Math.sin(yaw) * 0.45, sy = fresh ? m!.y : cy, sz = fresh ? m!.z : cz - Math.cos(yaw) * 0.45;
  // La primera pared lo para (y entonces no le da a nadie).
  const k = rayReach(sx, sy, sz, ax, ay, az);
  let hit = target.id !== "" || target.npc >= 0;
  if (k < 0.97) {
    ax = sx + (ax - sx) * k;
    ay = sy + (ay - sy) * k;
    az = sz + (az - sz) * k;
    hit = false;
  }
  sendShoot(id, [ax, ay, az], hit && target.id ? target.id : undefined);
  weapons.push({ from: world.sessionId ?? SELF_GUN, weapon: id, at: [ax, ay, az], p: [sx, sy, sz], hit, t: now });
  zap(body.x, body.z, Math.min(1, spec.damage / 40));
  // La gente de la ciudad: lo encaja o, con las que tumban, cae (y lo ven todos: §9 nonies).
  if (hit && target.npc >= 0) {
    const dx = target.x - cx, dz = target.z - cz, d = Math.hypot(dx, dz) || 1;
    crowd.hit(target.npc, dx / d, dz / d, spec.knock ? 3.4 : 1.7, false, true);
  }
  // Retroceso: la cámara acusa un poco el disparo.
  const kick = 0.012 + spec.power * 0.02;
  camKick.x = Math.sin(yaw) * kick;
  camKick.z = Math.cos(yaw) * kick;
  camKick.y = kick * 0.3;
  camKick.t = 0;
}
