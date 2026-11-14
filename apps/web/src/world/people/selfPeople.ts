/**
 * Lo que la gente le hace a tu personaje y lo que tú haces en el modo pelea, cada frame desde
 * Player.tsx (sin objetos nuevos por frame):
 *
 *   - Golpear: cada golpe del mismo tipo seguido saca el siguiente de la combinación (jab, directo y
 *     gancho; patada frontal y circular; empujón con las dos manos y con una). Te giras hacia quien
 *     tengas delante en modo pelea, das el paso que falte para llegar y el golpe se manda al servidor
 *     cuando llega el puño (no al pulsar). Sin nadie en modo pelea, se lo lleva la gente de decorado.
 *   - Encajar: los golpes ajenos se ven con el mismo retraso que la pose de quien golpea (así el puño
 *     llega antes de que lo notes). Uno flojo: el gesto según de dónde viene, el tronco y la cabeza
 *     que ceden (rig.ts) y un pequeño traspié. Uno fuerte: caes con física (ragdoll.ts), te quedas un
 *     momento en el suelo (más si es fuera de combate), te das la vuelta si caíste boca abajo y te
 *     levantas desde la pose en que quedaste.
 *   - En pareja: os acercáis, os miráis y las manos se encuentran (IK).
 *   - Correr contra la gente de decorado la hace tropezar.
 *   - Fuera de combate (la vida a 0, HEALTH.down_until): en el suelo hasta que se puede reaparecer y,
 *     entonces, a la entrada del distrito con toda la vida (RESPAWN).
 *
 * Mientras dura, manda esto y no el joystick.
 */
import * as THREE from "three";
import { FIGHT_REACH, type PairAction } from "@xenxo/protocol";
import { people, type HitEvent, type PairEvent } from "../../net/people-store";
import { canAttack, fightTarget, hitReady, sendHit, sendRespawn } from "../../net/people";
import { DISTRICT_SPAWN } from "../../net/districts";
import { teleport } from "../../net/session";
import { world } from "../../net/world-store";
import { mine, remoteFeet, remoteFx } from "./where";
import { crowd, floorAt, NPC_CITY, npcs, OTHER_RADIUS, resolveCircle } from "../collision";
import { knockBusy } from "../knock";
import { BODY_RADIUS, placeBody, STEP_UP, type Body } from "../locomotion";
import type { Motion } from "../motion";
import { impact, thud, whoosh } from "./fight-audio";
import { COMBO, COMBO_RESET, fallFor, FALL_MAX, HIT_AFTER_MS, LIE, LIE_KO, lightReaction, myStrike, parkourFallFor, RISE, STRIKES, strikeOf, type Strike, type StrikeMove } from "./fight";
import { loadRagdolls, ragdolls } from "./ragdoll";
import { PAIR, pairGap, pairLeave, pairStep, pairTargets } from "./pair";
import { BODY, createFx, type Lying } from "./rig";

type Phase = "none" | "react" | "fall" | "ground" | "roll" | "rise" | "clipfall" | "cliprise" | "pair";

/**
 * Con qué fuerza le llega a la gente de decorado (m/s; knock.ts: por encima de 2,5 cae): el jab, el
 * directo y los empujones los encaja; el gancho y las patadas la tiran.
 */
const NPC_HIT: Record<string, number> = { punch: 1.8, cross: 2.3, hook: 3.2, kick: 2.9, roundhouse: 3.8, shove: 2.3, push: 2 };

/** Lo que el esqueleto de tu personaje recibe de la gente (Player lo pone en su `Motion`). */
export const selfFx = createFx();
mine.fx = selfFx;

const me = {
  phase: "none" as Phase,
  t: 0,
  dur: 0,
  vx: 0,
  vz: 0,
  ko: false,
  rolled: false,
  pair: "high_five" as PairAction,
  partner: "",
  /** En pareja: se acerca (la ha propuesto, o es con alguien de la ciudad); quien acepta se queda quieto (pair.ts). */
  lead: false,
  /** Cadera el frame anterior (para el golpe contra el suelo). */
  lastY: 0,
  lastVy: 0,
  hit: null as HitEvent | null,
  /** Lo que ven los demás al empezar una caída del parkour (pk_fall, pk_crash): luego, hit_down. */
  fallEmote: "",
};
/** Una caída del parkour que empieza en el próximo frame (world/parkour: Player la pasa aquí). */
const pkFall = { kind: "" as "" | "land" | "crash", x: 0, z: 0, v: 0 };

/**
 * El parkour pide una caída de verdad: aterrizar de muy alto sin rodar (`x, z` = la velocidad que
 * llevaba) o estrellarse corriendo (`x, z` = la normal de la pared). `v`: la velocidad del golpe.
 */
export function parkourFall(kind: "land" | "crash", x: number, z: number, v: number) {
  pkFall.kind = kind;
  pkFall.x = x;
  pkFall.z = z;
  pkFall.v = v;
}
/** El golpe que estás dando. */
const strike = { name: "", def: null as Strike | null, t: 0, target: "", npc: -1, sent: false };
const combo = { move: "" as StrikeMove | "", i: 0, last: -1e9 };
const queue: { h: HitEvent; due: number }[] = [];
let pendingPair: PairEvent | null = null;
/** Sacudida de la cámara al recibir (la aplica Player). */
export const camKick = { x: 0, y: 0, z: 0, t: 1 };
/**
 * Fuera de combate: "down" (en el suelo hasta poder reaparecer) o "respawning" (ya en la entrada,
 * esperando a que el servidor lo confirme; si tarda, se vuelve a pedir). `at`: cuándo se pidió.
 */
const ko = { phase: "" as "" | "down" | "respawning", at: 0 };
/** Margen tras la hora de reaparecer (ms): el reloj del servidor aquí es una estimación. */
const RESPAWN_MARGIN_MS = 250;

/** ¿Fuera de combate? (sin golpear, sin andar; el HUD lo enseña). */
export function knockedOut(): boolean {
  return ko.phase !== "";
}

people.onHit((h) => {
  if (h.to !== world.sessionId) return;
  // Lo que pasa a quien golpeas lo ves con el mismo retraso que su golpe.
  queue.push({ h, due: performance.now() + (h.from === world.sessionId ? 0 : world.drawLag(h.from) + HIT_AFTER_MS) });
});
people.onPair((p) => {
  if (p.a === world.sessionId || p.b === world.sessionId) pendingPair = p;
});

/**
 * Acción en pareja con alguien de la ciudad (city/citizens.ts): como con una persona, pero sin red
 * (ya ha dicho que sí). `partner` es su clave en `remoteFeet` (where.ts).
 */
export function startLocalPair(kind: PairAction, partner: string) {
  pendingPair = { a: partner, b: partner, kind, at: performance.now() };
}

/** Al activar el modo pelea se carga la física (así la primera caída ya la tiene). */
export function prepareFights() {
  void loadRagdolls();
}

/** ¿Está ahora el personaje en manos de la gente (sin poder andar)? */
export function peopleBusy(): boolean {
  return me.phase !== "none";
}
/** ¿Está dando un golpe? (Player no le quita el gesto). */
export function striking(): boolean {
  return !!strike.def;
}

/** Al cambiar de lugar o aparecer en otro sitio: todo vuelve a empezar. */
export function resetPeople(motion: Motion) {
  selfFx.rig?.cancelFall();
  me.phase = "none";
  me.t = 0;
  strike.def = null;
  queue.length = 0;
  pendingPair = null;
  selfFx.look.w = selfFx.reachL.w = selfFx.reachR.w = 0;
  motion.emote = null;
  me.fallEmote = "";
  pkFall.kind = "";
}

const _o = new THREE.Vector3();
const _n = { x: 0, y: 0, z: 0 };
const _l: Lying = { x: 0, y: 0, z: 0, hx: 0, hz: 1, face: 0 };
const _align = { x: 0, z: 0, yaw: 0 };
const _back = { x: 0, z: 0 };
/** Tras una acción en pareja, hasta dónde (m entre los dos) sigue sin chocar con quien la hizo contigo. */
const APART = BODY_RADIUS + OTHER_RADIUS + 0.04;

export interface PeopleCtx {
  body: Body;
  motion: Motion;
  bodyYaw: { current: number };
  avatar: THREE.Group;
}

/** Dónde se ve ahora a otra persona (sus pies). */
function where(id: string, out: THREE.Vector3): boolean {
  const p = remoteFeet.get(id);
  if (!p) return false;
  out.copy(p);
  return true;
}

/** Hueco (collision.ts) de la persona k de la lista de gente de decorado. */
const slotOf = (k: number) => (k < npcs.count ? k : NPC_CITY + k - npcs.count);

/** La gente de decorado que tienes delante (de pie), a menos de `reach` m (o −1). */
function npcAhead(x: number, y: number, z: number, yaw: number, reach: number, cone = 0.5): number {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let best = -1, bestD = reach;
  for (let k = 0; k < crowd.count; k++) {
    if (npcs.down[slotOf(k)]) continue;
    crowd.at(k, _n);
    const dx = _n.x - x, dz = _n.z - z;
    const d = Math.hypot(dx, dz);
    if (d > bestD || Math.abs(_n.y - y) > 1.2) continue;
    if (d > 0.2 && (dx * fx + dz * fz) / d < cone) continue;
    best = k;
    bestD = d;
  }
  return best;
}

/**
 * Empieza un golpe (Q, E, R o el HUD). El gesto sale siempre que el modo pelea lo permita; a quién
 * le llega se decide al llegar el puño.
 */
export function startStrike(move: StrikeMove, c: PeopleCtx) {
  if ((me.phase !== "none" && me.phase !== "pair") || !canAttack(move)) return;
  const now = performance.now() / 1000;
  if (combo.move !== move || now - combo.last > COMBO_RESET) combo.i = 0;
  else combo.i = (combo.i + 1) % COMBO[move].length;
  combo.move = move;
  combo.last = now;
  const name = COMBO[move][combo.i]!;
  const def = STRIKES[name]!;
  const target = fightTarget(move);
  strike.name = name;
  strike.def = def;
  strike.t = 0;
  strike.sent = false;
  strike.target = target?.id ?? "";
  strike.npc = target ? -1 : npcAhead(c.body.x, c.body.y, c.body.z, c.bodyYaw.current, FIGHT_REACH[move] + 0.4, 0.35);
  c.motion.emote = name;
  myStrike.name = name;
  whoosh(c.body.x, c.body.z, move === "kick");
}

/**
 * Un frame. Devuelve `lock` (no hacer caso al joystick), la velocidad que quiere (`wantX/Z`) y si
 * ya ha colocado al personaje (`drawn`: en el suelo; Player no lo toca).
 */
export function peopleFrame(dt: number, c: PeopleCtx, out: { lock: boolean; wantX: number; wantZ: number; drawn: boolean }) {
  out.lock = false;
  out.wantX = 0;
  out.wantZ = 0;
  out.drawn = false;
  const { body, motion } = c;
  // Con frames muy largos, el tiempo va al paso de la física (que no avanza más de 0,1 s por frame).
  dt = Math.min(dt, 0.1);
  camKick.t += dt;

  // Golpes recibidos cuya hora ha llegado.
  const now = performance.now();
  while (queue.length && queue[0]!.due <= now) receive(queue.shift()!.h, c);
  koFrame(c);

  const pair = pendingPair;
  if (pair && me.phase === "none" && !strike.def) {
    pendingPair = null;
    me.partner = pair.a === world.sessionId ? pair.b : pair.a;
    me.lead = pair.a === world.sessionId || pair.a === pair.b;
    me.phase = "pair";
    me.t = 0;
    me.pair = pair.kind;
  } else if (pair && me.phase !== "none") pendingPair = null;
  // Con quién estás en pareja (where.ts): si algo la corta (un golpe), deja de serlo ya. Y con quien
  // acabas de estarlo, hasta que os separáis (al acabar un abrazo aún os tocáis: sin esto, la
  // colisión os apartaba de golpe).
  if (me.phase !== "pair") mine.with = "";
  if (mine.apart && (me.phase === "pair" || !where(mine.apart, _o) || Math.hypot(_o.x - c.body.x, _o.z - c.body.z) > APART)) mine.apart = "";

  lookAround(c);
  if (strike.def) strikeFrame(dt, c, out);
  if (pkFall.kind) {
    if (me.phase === "none") startParkourFall(c);
    pkFall.kind = "";
  }
  if (me.phase === "none") return;
  me.t += dt;
  out.lock = true;
  out.wantX = 0;
  out.wantZ = 0;
  const rig = selfFx.rig;

  switch (me.phase) {
    case "react": {
      const k = Math.max(0, 1 - me.t / me.dur);
      out.wantX = me.vx * k * k;
      out.wantZ = me.vz * k * k;
      if (me.t >= me.dur) end(motion);
      break;
    }
    case "fall":
    case "ground":
    case "roll": {
      if (!rig?.falling) {
        // Sin física (el avatar se ha ido): se levanta como pueda.
        me.phase = "cliprise";
        me.t = 0;
        motion.emote = "get_up";
        break;
      }
      placeFromDoll(c);
      out.drawn = true;
      // Al empezar una caída del parkour, los demás ven cuál (la hacen con su propia física). Solo al
      // empezar: en el suelo o dándose la vuelta el reloj vuelve a cero, y el gesto volvía a salir (los
      // demás veían a quien ya estaba tumbado estamparse otra vez).
      motion.emote = me.phase === "fall" && me.fallEmote && me.t < 0.6 ? me.fallEmote : "hit_down";
      motion.speed = 0;
      if (me.phase === "fall") {
        // El golpe contra el suelo: la cadera deja de caer de golpe.
        const vy = (_l.y - me.lastY) / Math.max(dt, 1e-3);
        if (me.lastVy < -1.6 && vy > -0.4) thud(_l.x, _l.z, -me.lastVy);
        me.lastY = _l.y;
        me.lastVy = vy;
        if ((rig.fallStill > 0.3 && rig.fallAge > 0.7) || rig.fallAge > FALL_MAX) {
          me.phase = "ground";
          me.t = 0;
        }
      } else if (me.phase === "ground") {
        // Fuera de combate no se levanta: reaparece en la entrada (koFrame).
        if (me.t >= (me.ko ? LIE_KO : LIE) && !ko.phase) {
          if (_l.face < -0.3 && !me.rolled) {
            // Boca abajo: primero se da la vuelta.
            me.phase = "roll";
            me.t = 0;
            me.rolled = true;
            rig.rollOver(1);
          } else rise(c);
        }
      } else if (_l.face > 0.35 || me.t > 1.3) {
        rig.rollOver(0);
        me.phase = "ground";
        me.t = Math.max(0, (me.ko ? LIE_KO : LIE) - 0.35);
      }
      break;
    }
    case "rise":
      motion.emote = "get_up";
      motion.speed = 0;
      if (me.t >= RISE) end(motion);
      break;
    case "clipfall": {
      // Sin física: cae redondo hacia atrás con la animación y se queda en el suelo.
      motion.emote = "hit_down";
      motion.speed = 0;
      const k = Math.max(0, 1 - me.t / 0.5);
      out.wantX = me.vx * k;
      out.wantZ = me.vz * k;
      if (me.t >= 2.2 + (me.ko ? LIE_KO : LIE) && !ko.phase) {
        me.phase = "cliprise";
        me.t = 0;
      }
      break;
    }
    case "cliprise":
      motion.emote = "get_up";
      motion.speed = 0;
      if (me.t >= RISE) end(motion);
      break;
    case "pair":
      pairFrame(dt, c);
      break;
  }
}

/**
 * Fuera de combate: si el golpe que lo dejó así no lo ha tirado (llegó levantándose), cae aquí; pasado
 * su tiempo, a la entrada del distrito (Player lo coloca allí al empezar el frame siguiente) y RESPAWN.
 */
function koFrame(c: PeopleCtx) {
  const id = world.sessionId;
  const until = id ? people.downUntil(id) : 0;
  if (!until) {
    ko.phase = "";
    return;
  }
  if (!ko.phase) ko.phase = "down";
  const now = performance.now();
  if (ko.phase === "down") {
    if (me.phase === "none" && !queue.length) koFall(c);
    if (world.serverNow() >= until + RESPAWN_MARGIN_MS) {
      ko.phase = "respawning";
      ko.at = now;
      teleport([DISTRICT_SPAWN[0], DISTRICT_SPAWN[1], DISTRICT_SPAWN[2]], 0);
      sendRespawn();
    }
  } else if (now - ko.at > 1500) {
    ko.at = now;
    sendRespawn();
  }
}

/** Cae fuera de combate sin un golpe que dibujar (de espaldas a quien le dio por última vez). */
function koFall(c: PeopleCtx) {
  const id = world.sessionId!;
  const last = people.lastHit.get(id);
  const dir: [number, number] = last ? last.dir : [Math.sin(c.bodyYaw.current), Math.cos(c.bodyYaw.current)];
  receive({ from: last?.from ?? "", to: id, move: last?.move ?? "punch", style: people.style ?? "comic", dir, power: 0.6, fall: true, ko: true, at: performance.now() }, c);
}

/** Caída del parkour: el cuerpo con física desde como iba (o, sin física aún, la de la animación). */
function startParkourFall(c: PeopleCtx) {
  const { body, motion } = c;
  strike.def = null;
  selfFx.reachL.w = selfFx.reachR.w = 0;
  me.hit = null;
  me.ko = false;
  me.t = 0;
  me.rolled = false;
  let dx = pkFall.x, dz = pkFall.z, vx = 0, vz = 0;
  if (pkFall.kind === "land") {
    vx = pkFall.x;
    vz = pkFall.z;
    const h = Math.hypot(vx, vz);
    if (h > 1) {
      dx = vx / h;
      dz = vz / h;
    } else {
      // Casi parado: se va de culo (hacia atrás de donde mira).
      dx = Math.sin(c.bodyYaw.current);
      dz = Math.cos(c.bodyYaw.current);
    }
  }
  thud(body.x, body.z, pkFall.v);
  camKick.x = dx * 0.05;
  camKick.z = dz * 0.05;
  camKick.y = -0.08;
  camKick.t = 0;
  me.fallEmote = pkFall.kind === "crash" ? "pk_crash" : "pk_fall";
  const rig = selfFx.rig;
  const sim = ragdolls();
  if (rig && sim && rig.startFall(sim, parkourFallFor(pkFall.kind as "land" | "crash", dx, dz, pkFall.v, vx, vz))) {
    me.phase = "fall";
    motion.emote = me.fallEmote;
    rig.lying(_l);
    me.lastY = _l.y;
    me.lastVy = 0;
    return;
  }
  if (!sim) void loadRagdolls();
  // Sin física (aún): la animación de caer de espaldas, girado hacia donde va a caer.
  me.phase = "clipfall";
  c.bodyYaw.current = Math.atan2(dx, dz);
  me.vx = dx * 1.2;
  me.vz = dz * 1.2;
  motion.emote = "hit_down";
}

/** Golpe recibido: flojo (gesto, sacudida y traspié) o fuerte (caída con física). */
function receive(h: HitEvent, c: PeopleCtx) {
  const { body, motion } = c;
  if (me.phase === "fall" || me.phase === "ground" || me.phase === "roll" || me.phase === "rise" || me.phase === "clipfall" || me.phase === "cliprise") return;
  // Un golpe recibido corta el tuyo y la pareja.
  strike.def = null;
  selfFx.reachL.w = selfFx.reachR.w = 0;
  me.hit = h;
  me.ko = h.ko;
  me.t = 0;
  me.rolled = false;
  me.fallEmote = "";
  // Qué golpe era (lo dice la pose de quien lo dio): en la cara o en el cuerpo. Un disparo, en el
  // cuerpo (suena en ShotFx).
  const s = h.move === "shot" ? null : (strikeOf(latestEmote(h.from)) ?? STRIKES[h.move === "punch" ? "punch" : h.move]!);
  const head = h.move === "punch" && !!s?.head;
  if (s) impact(body.x, body.z, h.power, head);
  kick(h, head);
  const rig = selfFx.rig;
  if (h.fall) {
    const sim = ragdolls();
    if (rig && sim && rig.startFall(sim, fallFor(h, head, body.vx, body.vz))) {
      me.phase = "fall";
      motion.emote = "hit_down";
      rig.lying(_l);
      me.lastY = _l.y;
      me.lastVy = 0;
      return;
    }
    if (!sim) void loadRagdolls();
    me.phase = "clipfall";
    // Cae de espaldas: se gira hacia quien le dio.
    c.bodyYaw.current = Math.atan2(h.dir[0], h.dir[1]);
    me.vx = h.dir[0] * 1.6;
    me.vz = h.dir[1] * 1.6;
    motion.emote = "hit_down";
    return;
  }
  const r = lightReaction(h, c.bodyYaw.current, head);
  me.phase = "react";
  me.dur = r.dur;
  me.vx = h.dir[0] * r.push;
  me.vz = h.dir[1] * r.push;
  motion.emote = r.emote;
  rig?.flinch(h.dir[0], h.dir[1], h.power, head, s?.twist ?? 0);
}

/** La cámara acusa el golpe (poco: un par de centímetros que vuelven en un momento). */
function kick(h: HitEvent, head: boolean) {
  const k = (head ? 0.05 : 0.035) * (0.5 + h.power);
  camKick.x = h.dir[0] * k;
  camKick.z = h.dir[1] * k;
  camKick.y = -k * 0.4;
  camKick.t = 0;
}

function latestEmote(id: string): string | null {
  const buf = world.poseBuffers.get(id);
  return buf?.[buf.length - 1]?.emote ?? null;
}

/** El cuerpo que cae manda: el personaje (y la cámara, y lo que ven los demás) van con su cadera. */
function placeFromDoll(c: PeopleCtx) {
  const rig = selfFx.rig!;
  rig.lying(_l);
  const floor = floorAt(_l.x, _l.z, _l.y + 0.5);
  const y = Number.isFinite(floor) ? floor : c.body.y;
  c.body.x = _l.x;
  c.body.z = _l.z;
  c.body.y = y;
  c.body.vx = 0;
  c.body.vz = 0;
  c.avatar.position.set(_l.x, y, _l.z);
}

/** Deja la física y se levanta desde la pose en que quedó. */
function rise(c: PeopleCtx) {
  const rig = selfFx.rig!;
  if (!rig.endFall(_align)) return end(c.motion);
  const floor = floorAt(_align.x, _align.z, c.body.y + 0.8);
  placeBody(c.body, _align.x, Number.isFinite(floor) ? floor : c.body.y, _align.z);
  c.bodyYaw.current = _align.yaw;
  c.avatar.position.set(c.body.x, c.body.y, c.body.z);
  c.avatar.rotation.set(0, _align.yaw, 0);
  me.phase = "rise";
  me.t = 0;
  c.motion.emote = "get_up";
}

function end(motion: Motion) {
  me.phase = "none";
  me.t = 0;
  me.fallEmote = "";
  motion.emote = null;
  selfFx.reachL.w = selfFx.reachR.w = 0;
}

/** El golpe que das: girarse, acercarse, y cuando llega el puño, mandarlo. */
function strikeFrame(dt: number, c: PeopleCtx, out: { lock: boolean; wantX: number; wantZ: number; drawn: boolean }) {
  const s = strike.def!;
  const { body, motion } = c;
  strike.t += dt;
  motion.emote = strike.name;
  let has = false;
  if (strike.target && where(strike.target, _o)) has = true;
  else if (strike.npc >= 0 && strike.npc < crowd.count) {
    crowd.at(strike.npc, _n);
    _o.set(_n.x, _n.y, _n.z);
    has = true;
  }
  const windup = strike.t < s.impact;
  if (has) {
    const dx = _o.x - body.x, dz = _o.z - body.z;
    const d = Math.hypot(dx, dz);
    // Girarse hacia el objetivo antes de que llegue el golpe.
    if (strike.t < s.impact + 0.05 && d > 0.05) {
      const want = Math.atan2(-dx, -dz);
      let diff = want - c.bodyYaw.current;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      c.bodyYaw.current += THREE.MathUtils.clamp(diff, -dt * 16, dt * 16);
    }
    // El paso que falta para llegar (sin pasarse de su alcance).
    if (windup && d > s.ideal + 0.04) {
      const v = Math.min(4.5, (d - s.ideal) / Math.max(0.06, s.impact - strike.t));
      out.wantX = (dx / d) * v;
      out.wantZ = (dz / d) * v;
    }
    selfFx.look.x = _o.x;
    selfFx.look.y = _o.y + 1.5;
    selfFx.look.z = _o.z;
    selfFx.look.w = 1;
  }
  // Mientras se arma el golpe (y en las patadas y el gancho, todo el rato) no se anda.
  if (windup || s.plant) out.lock = true;
  // Cuando llega el golpe (si el anterior aún está demasiado cerca para el servidor, un instante después).
  if (!strike.sent && strike.t >= s.impact && (!strike.target || hitReady() || strike.t > s.impact + 0.25)) {
    strike.sent = true;
    if (strike.target && has && Math.hypot(_o.x - body.x, _o.z - body.z) <= FIGHT_REACH[s.move] + 0.3) sendHit(strike.target, s.move);
    else if (strike.npc >= 0 && has && people.fightOn) hitNpc(strike.npc, body, strike.name, s);
  }
  if (strike.t >= s.dur) {
    strike.def = null;
    if (motion.emote === strike.name) motion.emote = null;
  }
}

/** En modo pelea se mira a quien tengas cerca en modo pelea; si no, a nada en especial. */
function lookAround(c: PeopleCtx) {
  if (me.phase === "pair" || strike.def) return;
  selfFx.look.w = 0;
  if (!people.fightOn || me.phase !== "none") return;
  let best = 25, found = false;
  for (const id of people.fighters) {
    if (!where(id, _o)) continue;
    const d2 = (_o.x - c.body.x) ** 2 + (_o.z - c.body.z) ** 2;
    if (d2 < best) {
      best = d2;
      found = true;
      selfFx.look.x = _o.x;
      selfFx.look.y = _o.y + 1.5;
      selfFx.look.z = _o.z;
    }
  }
  if (found) selfFx.look.w = 0.75;
}

/**
 * Acción en pareja: quien la propone se acerca a su distancia (pair.ts → pairStep), los dos se miran y
 * llevan las manos a donde se encuentran. Mientras dura, la pareja no es sólida (PeopleFx.tsx,
 * city/citizens.ts → `ghost`) y quien la dibuja mueve sus manos con tu reloj (where.ts → `mine`).
 */
function pairFrame(dt: number, c: PeopleCtx) {
  const spec = PAIR[me.pair];
  const { body, motion } = c;
  motion.emote = me.pair;
  motion.speed = 0;
  mine.with = me.partner;
  mine.t = me.t;
  if (!where(me.partner, _o)) {
    if (me.t >= spec.s) end(motion);
    return;
  }
  const dx = _o.x - body.x, dz = _o.z - body.z;
  const d = Math.hypot(dx, dz) || 1;
  const other = remoteFx.get(me.partner) ?? null;
  if (me.lead) {
    const gap = pairGap(me.pair, selfFx.rig?.size ?? BODY, other?.rig?.size ?? BODY);
    const step = pairStep(me.pair, me.t, d, gap, dt);
    const back = step > 0 ? 0 : pairLeave(me.pair, me.t, d, gap, dt);
    if (step > 0) {
      placeBody(body, body.x + (dx / d) * step, body.y, body.z + (dz / d) * step);
      // Las piernas, andando a ese paso (los brazos siguen con lo suyo).
      motion.speed = step / Math.max(dt, 1e-3);
    } else if (back > 0) {
      // Al soltarse del abrazo, un paso atrás de cara a la otra persona (las piernas, andando al revés:
      // velocidad negativa), sin meterse en una pared.
      _back.x = body.x - (dx / d) * back;
      _back.z = body.z - (dz / d) * back;
      resolveCircle(_back, BODY_RADIUS, body.y + STEP_UP, body.y + 1.2, false);
      const moved = Math.hypot(_back.x - body.x, _back.z - body.z);
      placeBody(body, _back.x, body.y, _back.z);
      motion.speed = -moved / Math.max(dt, 1e-3);
    }
  }
  c.bodyYaw.current = Math.atan2(-dx, -dz);
  pairTargets(me.pair, me.t, body.x, body.y, body.z, _o, selfFx, other);
  if (me.t >= spec.s) {
    mine.apart = me.partner;
    end(motion);
  }
}

/* --- La gente de decorado --- */

/** Golpe a la gente de decorado (cuando no hay nadie en modo pelea a tu alcance). */
function hitNpc(k: number, body: Body, name: string, s: Strike) {
  crowd.at(k, _n);
  const dx = _n.x - body.x, dz = _n.z - body.z;
  const d = Math.hypot(dx, dz) || 1;
  if (d > FIGHT_REACH[s.move] + 0.3) return;
  if (crowd.hit(k, dx / d, dz / d, NPC_HIT[name] ?? 2.5, s.head)) impact(_n.x, _n.z, 0.7, s.head);
}

/** Correr contra alguien de decorado lo hace tropezar (y a ti te frena un poco). */
export function bumpNpcs(body: Body, yaw: number) {
  const v = Math.hypot(body.vx, body.vz);
  if (v < 4.2) return;
  const k = npcAhead(body.x, body.y, body.z, yaw, 0.75);
  if (k < 0) return;
  // Ya en el suelo o tropezando: no se le vuelve a dar.
  if (knockBusy(slotOf(k))) return;
  crowd.at(k, _n);
  const dx = _n.x - body.x, dz = _n.z - body.z;
  const d = Math.hypot(dx, dz) || 1;
  crowd.hit(k, dx / d, dz / d, v * 0.4);
  body.vx *= 0.6;
  body.vz *= 0.6;
}
