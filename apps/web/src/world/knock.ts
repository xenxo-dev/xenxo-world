/**
 * La gente de decorado (ciudadanos y residentes) cuando le dan: un coche (vehicle/physics.ts) o un
 * golpe del modo pelea (people/selfPeople.ts) dejan el aviso en `npcs.knock` (collision.ts) y aquí,
 * desde CityLife e Interiors al colocar a cada persona, se convierte en lo que se ve:
 *
 *   - Un golpe flojo: lo encaja (el tronco y la cabeza ceden, people/rig.ts), con el gesto según de
 *     dónde le viene, da un traspié, mira un momento a quien ha sido y vuelve a su sitio.
 *   - Uno fuerte o un atropello: cae con física (people/ragdoll.ts, la misma que las personas), se
 *     queda un momento en el suelo, se da la vuelta si quedó boca abajo, se levanta desde la pose en
 *     que quedó y vuelve andando a su sitio y a lo suyo (los ciudadanos, `free`, siguen desde donde
 *     han caído: city/citizens.ts).
 *   - Sin física libre (las caídas a la vez tienen tope, `FEATURES.ragdolls`, y siempre queda una para
 *     las personas) cae con la animación; sin esqueleto (el muñeco de respaldo), se inclina.
 *
 * Sin violencia ni sangre. Nada viaja por la red: cada cliente tira a su gente de decorado. Sin
 * objetos nuevos por frame.
 */
import * as THREE from "three";
import { floorAt, npcs } from "./collision";
import { graphics } from "./graphics";
import { createMotion, type Motion } from "./motion";
import { self } from "./self";
import { FALL_MAX, hitSide, npcFallFor, RISE, RUN_OVER } from "./people/fight";
import { thud } from "./people/fight-audio";
import { loadRagdolls, ragdolls } from "./people/ragdoll";
import { createFx, type Lying, type Rig } from "./people/rig";

/** Por encima de esta velocidad (m/s), cae; por debajo, lo encaja y da un traspié. */
export const FALL_SPEED = 2.5;
/** En el suelo antes de levantarse (s, desde que se para); atropellada, algo más. */
const LIE = 1.1, LIE_RUN = 1.9;
/** Encajar un golpe flojo (s). */
const REACT = 0.6;
/** Vuelta a su sitio andando (m/s) y lo más que puede tardar (s). */
const WALK_BACK = 1.3, BACK_MAX = 9;
/** Sin física: lo que tarda en caer redondo con la animación (ko_fall). */
const CLIP_DOWN = 2.2;
/** Cuánto mira a quien le ha dado (s). */
const GLARE = 3;
/** Si se levanta a otra altura (se ha caído de la pasarela), vuelve a su sitio sin más. */
const STEP_MAX = 1.2;
/** Gestos de cuerpo entero bajos: con un golpe flojo no se levanta (solo lo encaja). */
const LOW_POSES = new Set(["sit", "crouch"]);
// Respaldo sin esqueleto: inclinarse sobre los pies.
const FLY = 0.45, TILT_LIE = 1.7, TILT_UP = 2.6, TILT_BACK = 4.2, STUMBLE = 0.8, STUMBLE_BACK = 2;

type Phase = "none" | "react" | "fall" | "ground" | "roll" | "rise" | "clipfall" | "cliprise" | "back" | "tilt";

interface Knock {
  phase: Phase;
  /** Segundos en la fase y última vez que se miró (performance.now). */
  t: number;
  last: number;
  nx: number;
  nz: number;
  speed: number;
  /** Atropello (no un golpe). */
  run: boolean;
  /** Dónde está respecto a su sitio (m) y hacia dónde mira. */
  ox: number;
  oy: number;
  oz: number;
  yaw: number;
  /** Traspié o resbalón: velocidad al empezar (m/s). */
  vx: number;
  vz: number;
  rolled: boolean;
  lastY: number;
  lastVy: number;
  glare: number;
  /** De la gente que anda libre (ciudadanos): al acabar no vuelve a ningún sitio, sigue desde ahí. */
  free: boolean;
}

const states = new WeakMap<Motion, Knock>();
/** Por hueco: ¿está ahora en manos de esto? (lo escribe knockApply cada frame; en el suelo, `npcs.down`). */
const busy = new Uint8Array(npcs.knockHead.length);
const DOWN: ReadonlySet<Phase> = new Set(["fall", "ground", "roll", "clipfall"]);

const _l: Lying = { x: 0, y: 0, z: 0, hx: 0, hz: 1, face: 0 };
const _align = { x: 0, z: 0, yaw: 0 };
const _dir: [number, number] = [0, 0];
const _tilt = new THREE.Quaternion();
const _yaw = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const ease = (k: number) => 1 - (1 - k) * (1 - k);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** El `Motion` de un hueco de gente de decorado (con su esqueleto, para encajar golpes y caer). */
export function npcMotion(): Motion {
  const m = createMotion();
  m.fx = createFx();
  return m;
}

/**
 * Si a la persona del hueco `i` le han dado (o aún se está recuperando), la coloca desde su sitio
 * de siempre (`x, y, z` y su giro `yaw`) donde toque y devuelve true mientras no puede seguir con lo
 * suyo. Si no, no toca nada y devuelve false. Con `free` (los ciudadanos, que andan por la ciudad),
 * al levantarse no vuelve a su sitio: el grupo se queda donde acabó y desde ahí sigue con su vida.
 */
export function knockApply(i: number, g: THREE.Object3D, x: number, y: number, z: number, yaw: number, motion: Motion, free = false): boolean {
  const now = performance.now();
  let st = states.get(motion);
  if (npcs.knock[i * 4]) {
    const nx = npcs.knock[i * 4 + 1]!, nz = npcs.knock[i * 4 + 2]!, speed = npcs.knock[i * 4 + 3]!;
    npcs.knock[i * 4] = 0;
    if (!st) states.set(motion, (st = fresh()));
    st.free = free;
    hit(st, g, x, y, z, yaw, motion, nx, nz, speed, npcs.knockHead[i] === 1, now);
  }
  if (!st || st.phase === "none") {
    busy[i] = npcs.down[i] = 0;
    return false;
  }
  const dt = Math.min(0.1, Math.max(0, (now - st.last) / 1000));
  st.last = now;
  st.t += dt;
  const on = frame(st, dt, g, x, y, z, yaw, motion);
  busy[i] = on ? 1 : 0;
  npcs.down[i] = on && (DOWN.has(st.phase) || (st.phase === "tilt" && st.speed >= FALL_SPEED && st.t < TILT_UP)) ? 1 : 0;
  return on;
}

/** ¿Sigue sin poder andar la persona del hueco `i`? (para que no avance mientras tanto) */
export function knockPaused(i: number): boolean {
  return busy[i] === 1 || npcs.knock[i * 4] !== 0;
}

/** ¿Se puede volver a empujar a la del hueco `i`? (no, si ya está tropezando o en el suelo) */
export const knockBusy = knockPaused;

/** Al dejar de seguir a esa persona (se aleja o se cambia de lugar): todo como estaba. */
export function knockReset(motion: Motion) {
  const st = states.get(motion);
  if (!st || st.phase === "none") return;
  motion.fx?.rig?.cancelFall();
  if (motion.fx) motion.fx.look.w = 0;
  st.phase = "none";
  motion.emote = null;
}

function fresh(): Knock {
  return { phase: "none", t: 0, last: 0, nx: 0, nz: 1, speed: 0, run: false, ox: 0, oy: 0, oz: 0, yaw: 0, vx: 0, vz: 0, rolled: false, lastY: 0, lastVy: 0, glare: 0, free: false };
}

/** Le acaban de dar. */
function hit(st: Knock, g: THREE.Object3D, x: number, y: number, z: number, yaw: number, motion: Motion, nx: number, nz: number, speed: number, head: boolean, now: number) {
  // Ya en el suelo (o cayendo): nada más.
  if (DOWN.has(st.phase) || st.phase === "tilt") return;
  if (st.phase === "none") {
    st.ox = st.oy = st.oz = 0;
    st.yaw = yaw;
  }
  // La velocidad que llevaba (andando hacia donde mira).
  const walk = st.phase === "none" || st.phase === "back" ? motion.speed : 0;
  const vx = -Math.sin(st.yaw) * walk, vz = -Math.cos(st.yaw) * walk;
  st.nx = nx;
  st.nz = nz;
  st.speed = speed;
  st.run = speed >= RUN_OVER;
  st.t = 0;
  st.last = now;
  st.rolled = false;
  st.glare = st.run ? 0 : GLARE;
  const rig = motion.fx?.rig ?? null;
  const pose = motion.emote;
  motion.speed = 0;
  place(g, x, y, z, st);
  if (speed >= FALL_SPEED) {
    const sim = ragdolls();
    if (!sim) void loadRagdolls();
    // Con física, si queda sitio (siempre una libre para las personas).
    if (rig && sim && sim.active < graphics.features.ragdolls - 1 && rig.startFall(sim, npcFallFor(nx, nz, speed, head, vx, vz))) {
      st.phase = "fall";
      motion.emote = "hit_down";
      rig.lying(_l);
      st.lastY = _l.y;
      st.lastVy = 0;
      return;
    }
    if (!rig) {
      st.phase = "tilt";
      return;
    }
    // Sin física: cae redondo hacia atrás con la animación, de espaldas hacia donde le empujan.
    st.phase = "clipfall";
    st.yaw = Math.atan2(nx, nz);
    const slide = Math.min(3, 0.8 + speed * 0.25);
    st.vx = nx * slide;
    st.vz = nz * slide;
    motion.emote = "hit_down";
    return;
  }
  if (!rig) {
    st.phase = "tilt";
    return;
  }
  // Lo encaja: el tronco y la cabeza ceden, el gesto según de dónde le viene y un traspié (sentada o
  // agachada, sin moverse de su sitio).
  st.phase = "react";
  const low = !!pose && LOW_POSES.has(pose);
  _dir[0] = nx;
  _dir[1] = nz;
  if (!low) motion.emote = hitSide(_dir, st.yaw).back < -0.45 ? "hit_back" : head ? "hit_head" : "hit_body";
  const push = low ? 0 : speed * 0.9;
  st.vx = nx * push;
  st.vz = nz * push;
  rig.flinch(nx, nz, Math.min(1, speed / 3), head);
}

/** Un frame de lo que le está pasando. Devuelve false cuando ya puede seguir con lo suyo. */
function frame(st: Knock, dt: number, g: THREE.Object3D, x: number, y: number, z: number, yaw: number, motion: Motion): boolean {
  const rig = motion.fx?.rig ?? null;
  const fx = motion.fx;
  // Mira a quien le ha dado (de pie), un momento.
  if (fx) {
    st.glare -= dt;
    if (st.glare > 0 && (st.phase === "react" || st.phase === "back" || st.phase === "rise")) {
      fx.look.x = self.x;
      fx.look.y = self.y + 1.5;
      fx.look.z = self.z;
      fx.look.w = 0.8;
    } else fx.look.w = 0;
  }
  switch (st.phase) {
    case "react": {
      const k = Math.max(0, 1 - st.t / REACT);
      st.ox += st.vx * k * k * dt;
      st.oz += st.vz * k * k * dt;
      motion.speed = 0;
      place(g, x, y, z, st);
      if (st.t >= REACT) {
        if (motion.emote === "hit_back" || motion.emote === "hit_head" || motion.emote === "hit_body") motion.emote = null;
        if (st.free) return finish(st, motion);
        next(st, "back");
      }
      return true;
    }
    case "fall":
    case "ground":
    case "roll": {
      if (!rig?.falling) {
        // Sin la física (el avatar ha cambiado): se levanta como pueda.
        next(st, "cliprise");
        motion.emote = "get_up";
        place(g, x, y, z, st);
        return true;
      }
      rig.lying(_l);
      // El grupo va con la cadera: el recorte de la vista y lo que choca con el jugador.
      const fl = floorAt(_l.x, _l.z, _l.y + 0.5);
      g.position.set(_l.x, Number.isFinite(fl) ? fl : y, _l.z);
      motion.speed = 0;
      motion.emote = "hit_down";
      if (st.phase === "fall") {
        // El golpe contra el suelo: la cadera deja de caer de golpe.
        const vy = (_l.y - st.lastY) / Math.max(dt, 1e-3);
        if (st.lastVy < -1.6 && vy > -0.4) thud(_l.x, _l.z, -st.lastVy);
        st.lastY = _l.y;
        st.lastVy = vy;
        if ((rig.fallStill > 0.3 && rig.fallAge > 0.7) || rig.fallAge > FALL_MAX) next(st, "ground");
      } else if (st.phase === "ground") {
        if (st.t >= (st.run ? LIE_RUN : LIE)) {
          if (_l.face < -0.3 && !st.rolled) {
            // Boca abajo: primero se da la vuelta.
            next(st, "roll");
            st.rolled = true;
            rig.rollOver(st.nx * st.nz >= 0 ? 1 : -1);
          } else rise(st, g, x, y, z, rig, motion);
        }
      } else if (_l.face > 0.35 || st.t > 1.3) {
        rig.rollOver(0);
        next(st, "ground");
        st.t = Math.max(0, (st.run ? LIE_RUN : LIE) - 0.35);
      }
      return true;
    }
    case "rise":
    case "cliprise":
      motion.emote = "get_up";
      motion.speed = 0;
      place(g, x, y, z, st);
      if (st.t >= RISE) {
        motion.emote = null;
        if (st.free) return finish(st, motion);
        // Se ha caído a otra altura (de la pasarela a la calle): vuelve a su sitio sin más.
        if (Math.abs(st.oy) > STEP_MAX) st.ox = st.oy = st.oz = 0;
        next(st, "back");
      }
      return true;
    case "clipfall": {
      motion.emote = "hit_down";
      motion.speed = 0;
      const k = Math.max(0, 1 - st.t / 0.5);
      st.ox += st.vx * k * dt;
      st.oz += st.vz * k * dt;
      place(g, x, y, z, st);
      if (st.t >= CLIP_DOWN + (st.run ? LIE_RUN : LIE)) {
        next(st, "cliprise");
        motion.emote = "get_up";
      }
      return true;
    }
    case "back":
      return walkBack(st, dt, g, x, y, z, yaw, motion);
    case "tilt":
      return tilt(st, g, x, y, z, yaw, motion);
  }
  return false;
}

function next(st: Knock, phase: Phase) {
  st.phase = phase;
  st.t = 0;
}

/** Se acabó para quien anda libre: queda donde está (el grupo ya está colocado). */
function finish(st: Knock, motion: Motion): false {
  st.phase = "none";
  motion.speed = 0;
  if (motion.fx) motion.fx.look.w = 0;
  return false;
}

function done(st: Knock, motion: Motion) {
  st.phase = "none";
  st.ox = st.oy = st.oz = 0;
  motion.speed = 0;
  if (motion.fx) motion.fx.look.w = 0;
}

/** En su sitio más lo que se ha movido, sobre el suelo de verdad, mirando a `st.yaw`. */
function place(g: THREE.Object3D, x: number, y: number, z: number, st: Knock) {
  const px = x + st.ox, pz = z + st.oz;
  const fl = st.ox || st.oz ? floorAt(px, pz, y + 0.5) : y;
  const py = Number.isFinite(fl) ? fl : y;
  st.oy = py - y;
  g.position.set(px, py, pz);
  g.rotation.set(0, st.yaw, 0);
}

/** Deja la física y se levanta desde la pose en que quedó. */
function rise(st: Knock, g: THREE.Object3D, x: number, y: number, z: number, rig: Rig, motion: Motion) {
  next(st, "rise");
  motion.emote = "get_up";
  if (!rig.endFall(_align)) {
    place(g, x, y, z, st);
    return;
  }
  st.ox = _align.x - x;
  st.oz = _align.z - z;
  st.yaw = _align.yaw;
  place(g, x, y, z, st);
}

/** De pie: se gira hacia su sitio, vuelve andando y se pone como estaba. */
function walkBack(st: Knock, dt: number, g: THREE.Object3D, x: number, y: number, z: number, yaw: number, motion: Motion): boolean {
  const d = Math.hypot(st.ox, st.oz);
  if (d < 0.03 || st.t > BACK_MAX) {
    // En su sitio: se gira hacia donde miraba y sigue.
    st.ox = st.oz = 0;
    const diff = wrap(yaw - st.yaw);
    st.yaw += THREE.MathUtils.clamp(diff, -dt * 4, dt * 4);
    motion.speed = 0;
    place(g, x, y, z, st);
    if (Math.abs(diff) < 0.12 || st.t > BACK_MAX + 1.5) {
      done(st, motion);
      return false;
    }
    return true;
  }
  // Hacia su sitio (adelante es (−sin, −cos)): primero se gira y después anda.
  const want = Math.atan2(st.ox, st.oz);
  const diff = wrap(want - st.yaw);
  st.yaw += THREE.MathUtils.clamp(diff, -dt * 5, dt * 5);
  const facing = Math.max(0, 1 - Math.abs(diff) / 1.1);
  const v = WALK_BACK * facing * Math.min(1, 0.35 + d / 0.6);
  const step = Math.min(d, v * dt);
  st.ox -= (st.ox / d) * step;
  st.oz -= (st.oz / d) * step;
  motion.speed = v;
  place(g, x, y, z, st);
  return true;
}

/** Sin esqueleto (el muñeco de respaldo): se inclina sobre los pies, cae de espaldas y se levanta. */
function tilt(st: Knock, g: THREE.Object3D, x: number, y: number, z: number, yaw: number, motion: Motion): boolean {
  const t = st.t, nx = st.nx, nz = st.nz, speed = st.speed;
  const fall = speed >= FALL_SPEED;
  // Quien anda libre se queda donde ha caído (ya de pie); los demás vuelven a su sitio.
  if (st.free && t > (fall ? TILT_UP : STUMBLE)) return finish(st, motion);
  if (t > (fall ? TILT_BACK : STUMBLE_BACK)) {
    done(st, motion);
    return false;
  }
  let push: number, lean: number, lift = 0;
  const dist = fall ? Math.min(4, 0.6 + speed * 0.32) : Math.min(0.8, 0.25 + speed * 0.2);
  if (fall) {
    if (t < FLY) {
      const k = t / FLY;
      push = dist * ease(k);
      lift = Math.min(0.9, speed * 0.07) * Math.sin(Math.PI * k);
      lean = 1.5 * ease(k);
    } else if (t < TILT_LIE) {
      push = dist;
      lean = 1.5;
    } else if (t < TILT_UP) {
      push = dist;
      lean = 1.5 * (1 - ease((t - TILT_LIE) / (TILT_UP - TILT_LIE)));
    } else {
      push = dist * (1 - (t - TILT_UP) / (TILT_BACK - TILT_UP));
      lean = 0;
    }
    motion.emote = t > TILT_LIE && t < TILT_UP ? "crouch" : null;
  } else {
    const k = Math.min(1, t / 0.3);
    push = t < STUMBLE ? dist * ease(k) : dist * (1 - (t - STUMBLE) / (STUMBLE_BACK - STUMBLE));
    lean = t < STUMBLE ? 0.3 * Math.sin(Math.PI * Math.min(1, t / STUMBLE)) : 0;
  }
  motion.speed = 0;
  g.position.set(x + nx * push, y + lift, z + nz * push);
  // Se inclina hacia donde sale despedida (eje horizontal perpendicular al golpe), sobre los pies.
  _axis.set(nz, 0, -nx);
  _tilt.setFromAxisAngle(_axis, lean);
  _yaw.setFromAxisAngle(_up, yaw);
  g.quaternion.copy(_tilt).multiply(_yaw);
  return true;
}
