/**
 * Lo que la gente le hace a tu personaje (y lo que tú le haces a la de decorado), cada frame desde
 * Player.tsx:
 *
 *   - un golpe flojo: traspié hacia donde te dan (`hit_stagger`);
 *   - uno fuerte: caes con física de verdad (people/tumble.ts, Rapier), te quedas un momento en el
 *     suelo (más si es fuera de combate) y te levantas (`hit_down` → `get_up`);
 *   - una acción en pareja: te acercas, miras a la otra persona y la hacéis a la vez;
 *   - correr contra la gente de decorado la hace tropezar, y en modo pelea, si no hay nadie en modo
 *     pelea a tu alcance, el golpe se lo lleva quien tengas delante (como con el coche, knock.ts).
 *
 * Mientras dura, manda esto y no el joystick. Sin objetos nuevos por frame.
 */
import * as THREE from "three";
import { FIGHT_REACH, type FightMove, type FightStyle, type PairAction } from "@xenxo/protocol";
import { people, type HitEvent, type PairEvent } from "../../net/people-store";
import { world } from "../../net/world-store";
import { crowd, floorAt, NPC_CITY, npcs } from "../collision";
import { placeBody, type Body } from "../locomotion";
import type { Motion } from "../motion";
import { loadTumble, tumbleSim } from "./tumble";

type Phase = "none" | "stagger" | "tumble" | "lie" | "rise" | "pair";

/** Lo que dura cada parte (s). */
const STAGGER = 0.6;
const TUMBLE_MAX = 2.2;
const LIE = 0.9;
const LIE_KO = 2.6;
const RISE = 0.9;
const PAIR: Record<PairAction, { s: number; gap: number }> = {
  high_five: { s: 1.6, gap: 0.85 },
  hug: { s: 2.3, gap: 0.5 },
  handshake: { s: 1.9, gap: 0.85 },
};
/** Cuánto sale despedido cada estilo (m/s por unidad de fuerza) y cuánto sube. */
const FLING: Record<FightStyle, { h: number; v: number; spin: number }> = {
  comic: { h: 5.5, v: 3.2, spin: 3.4 },
  pixel: { h: 6, v: 4.2, spin: 4.2 },
  duel: { h: 4, v: 1.6, spin: 2.6 },
  shove: { h: 4.5, v: 1.2, spin: 2.4 },
};
/** Velocidad con la que la gente de decorado sale (knock.ts: por encima de 2,5 cae). */
const NPC_HIT: Record<FightMove, number> = { punch: 3, kick: 4, shove: 2 };

const me = {
  phase: "none" as Phase,
  t: 0,
  vx: 0,
  vz: 0,
  ko: false,
  pair: "high_five" as PairAction,
  /** Dónde está la otra persona de la pareja y hacia dónde mirar. */
  px: 0,
  pz: 0,
  yaw: 0,
  /** Al levantarse: desde dónde y con qué giro. */
  from: new THREE.Quaternion(),
  fromY: 0,
};
const pending: { hit: HitEvent | null; pair: PairEvent | null } = { hit: null, pair: null };

people.onHit((h) => {
  if (h.to === world.sessionId) pending.hit = h;
});
people.onPair((p) => {
  if (p.a === world.sessionId || p.b === world.sessionId) pending.pair = p;
});

/** Al activar el modo pelea se carga la física (así la primera caída ya la tiene). */
export function prepareFights() {
  void loadTumble();
}

/** ¿Está ahora el personaje en manos de la gente (sin poder andar)? */
export function peopleBusy(): boolean {
  return me.phase !== "none";
}

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _yawQ = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);
const _p = { x: 0, y: 0, z: 0 };

function latest(id: string, out: { x: number; z: number }): boolean {
  const buf = world.poseBuffers.get(id);
  const s = buf?.[buf.length - 1];
  if (!s) return false;
  out.x = s.head.p[0]!;
  out.z = s.head.p[2]!;
  return true;
}
const _o = { x: 0, z: 0 };

export interface PeopleCtx {
  body: Body;
  motion: Motion;
  bodyYaw: { current: number };
  avatar: THREE.Group;
}

/**
 * Un frame. Devuelve `lock` (no hacer caso al joystick), la velocidad que quiere (`wantX/Z`) y si
 * ya ha colocado al personaje (`drawn`: en el suelo o levantándose; Player no lo toca).
 */
export function peopleFrame(dt: number, c: PeopleCtx, out: { lock: boolean; wantX: number; wantZ: number; drawn: boolean }) {
  out.lock = false;
  out.wantX = 0;
  out.wantZ = 0;
  out.drawn = false;
  const { body, motion } = c;

  // Un golpe recibido manda sobre todo (también sobre una pareja a medias).
  const hit = pending.hit;
  if (hit) {
    pending.hit = null;
    if (me.phase !== "tumble" && me.phase !== "lie" && me.phase !== "rise") startHit(hit, c);
  }
  const pair = pending.pair;
  if (pair && me.phase === "none") {
    pending.pair = null;
    const other = pair.a === world.sessionId ? pair.b : pair.a;
    if (latest(other, _o)) {
      me.phase = "pair";
      me.t = 0;
      me.pair = pair.kind;
      me.px = _o.x;
      me.pz = _o.z;
      me.yaw = Math.atan2(-(_o.x - body.x), -(_o.z - body.z));
    }
  } else if (pair) pending.pair = null;

  if (me.phase === "none") return;
  // Con frames muy largos, el tiempo de las fases va al paso de la física (que no avanza más de
  // 0,1 s por frame): si no, se saltaría la caída entera.
  dt = Math.min(dt, 0.1);
  me.t += dt;
  out.lock = true;

  switch (me.phase) {
    case "stagger": {
      const k = Math.max(0, 1 - me.t / STAGGER);
      out.wantX = me.vx * k;
      out.wantZ = me.vz * k;
      motion.emote = "hit_stagger";
      if (me.t >= STAGGER) end(motion);
      break;
    }
    case "tumble": {
      const sim = tumbleSim();
      if (!sim) {
        // Sin física (aún cargando o sin WASM): un traspié largo.
        me.phase = "stagger";
        me.t = 0;
        break;
      }
      sim.step(dt);
      placeFromSim(c);
      motion.emote = "hit_down";
      motion.speed = 0;
      out.drawn = true;
      const still = sim.state.speed < 0.25 && sim.state.spin < 0.5;
      if ((still && me.t > 0.5) || me.t > TUMBLE_MAX) {
        me.phase = "lie";
        me.t = 0;
      }
      break;
    }
    case "lie":
      placeFromSim(c);
      motion.emote = "hit_down";
      motion.speed = 0;
      out.drawn = true;
      if (me.t >= (me.ko ? LIE_KO : LIE)) {
        me.phase = "rise";
        me.t = 0;
        me.from.copy(c.avatar.quaternion);
        me.fromY = c.avatar.position.y;
        // De pie mirando hacia donde quedó la cabeza (lo natural al levantarse).
        _up.set(0, 1, 0).applyQuaternion(me.from);
        c.bodyYaw.current = Math.atan2(_up.x, _up.z) + Math.PI;
      }
      break;
    case "rise": {
      const k = Math.min(1, me.t / RISE);
      const e = k * k * (3 - 2 * k);
      _yawQ.setFromAxisAngle(_Y, c.bodyYaw.current);
      _q.copy(me.from).slerp(_yawQ, e);
      c.avatar.quaternion.copy(_q);
      c.avatar.position.set(body.x, me.fromY + (body.y - me.fromY) * e, body.z);
      motion.emote = "get_up";
      motion.speed = 0;
      out.drawn = true;
      if (k >= 1) end(motion);
      break;
    }
    case "pair": {
      const spec = PAIR[me.pair];
      // Ponerse a su distancia, mirándola, en el primer tercio de segundo.
      const dx = me.px - body.x, dz = me.pz - body.z;
      const d = Math.hypot(dx, dz);
      if (me.t < 0.4 && d > spec.gap + 0.05) {
        const step = Math.min(d - spec.gap, dt * 3);
        _p.x = body.x + (dx / d) * step;
        _p.z = body.z + (dz / d) * step;
        placeBody(body, _p.x, body.y, _p.z);
      }
      c.bodyYaw.current = me.yaw;
      motion.emote = me.pair;
      motion.speed = 0;
      if (me.t >= spec.s) end(motion);
      break;
    }
  }
}

function startHit(h: HitEvent, c: PeopleCtx) {
  const { body, motion } = c;
  const f = FLING[h.style];
  me.ko = h.ko;
  me.t = 0;
  // Mira hacia quien le dio (de espaldas a donde sale).
  c.bodyYaw.current = Math.atan2(h.dir[0], h.dir[1]);
  const sim = h.fall ? tumbleSim() : null;
  if (!sim) {
    me.phase = "stagger";
    me.vx = h.dir[0] * (2 + 4 * h.power);
    me.vz = h.dir[1] * (2 + 4 * h.power);
    if (h.fall) void loadTumble();
    return;
  }
  me.phase = "tumble";
  const p = h.power;
  sim.start(
    body.x,
    body.y,
    body.z,
    c.bodyYaw.current,
    { x: h.dir[0] * f.h * p, y: f.v * p, z: h.dir[1] * f.h * p },
    // Gira hacia donde sale: cae de espaldas.
    { x: h.dir[1] * f.spin * p, y: 0, z: -h.dir[0] * f.spin * p },
  );
  motion.emote = "hit_down";
}

/** Coloca al personaje donde está la cápsula: los pies en un extremo, con su giro. */
function placeFromSim(c: PeopleCtx) {
  const s = tumbleSim()!.state;
  _q.set(s.qx, s.qy, s.qz, s.qw);
  _up.set(0, 1, 0).applyQuaternion(_q);
  const h = 0.57 + 0.28;
  c.avatar.position.set(s.x - _up.x * h, s.y - _up.y * h, s.z - _up.z * h);
  c.avatar.quaternion.copy(_q);
  // El cuerpo que se ve en la red y sigue la cámara: en el suelo, bajo la cápsula.
  const floor = floorAt(s.x, s.z, s.y + 0.5);
  c.body.x = s.x;
  c.body.z = s.z;
  c.body.y = Number.isFinite(floor) ? floor : c.body.y;
  c.body.vx = 0;
  c.body.vz = 0;
}

function end(motion: Motion) {
  me.phase = "none";
  me.t = 0;
  motion.emote = null;
}

/* --- La gente de decorado --- */

const _n = { x: 0, y: 0, z: 0 };

/** Quién de la gente de decorado tienes delante, a menos de `reach` m (o -1). */
function npcAhead(x: number, y: number, z: number, yaw: number, reach: number): number {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let best = -1, bestD = reach;
  for (let k = 0; k < crowd.count; k++) {
    crowd.at(k, _n);
    const dx = _n.x - x, dz = _n.z - z;
    const d = Math.hypot(dx, dz);
    if (d > bestD || Math.abs(_n.y - y) > 1.2) continue;
    if (d > 0.2 && (dx * fx + dz * fz) / d < 0.5) continue;
    best = k;
    bestD = d;
  }
  return best;
}

/** Golpe al aire o a la gente de decorado (cuando no hay nadie en modo pelea a tu alcance). */
export function hitNpc(move: FightMove, body: Body, yaw: number) {
  const k = npcAhead(body.x, body.y, body.z, yaw, FIGHT_REACH[move]);
  if (k < 0) return;
  crowd.at(k, _n);
  const dx = _n.x - body.x, dz = _n.z - body.z;
  const d = Math.hypot(dx, dz) || 1;
  crowd.hit(k, dx / d, dz / d, NPC_HIT[move]);
}

/** Correr contra alguien de decorado lo hace tropezar (y a ti te frena un poco). */
export function bumpNpcs(body: Body, yaw: number) {
  const v = Math.hypot(body.vx, body.vz);
  if (v < 4.2) return;
  const k = npcAhead(body.x, body.y, body.z, yaw, 0.75);
  if (k < 0) return;
  // Ya en el suelo o tropezando: no se le vuelve a dar.
  const slot = k < npcs.count ? k : NPC_CITY + k - npcs.count;
  if (npcs.knock[slot * 4]) return;
  crowd.at(k, _n);
  const dx = _n.x - body.x, dz = _n.z - body.z;
  const d = Math.hypot(dx, dz) || 1;
  crowd.hit(k, dx / d, dz / d, v * 0.4);
  body.vx *= 0.6;
  body.vz *= 0.6;
}
