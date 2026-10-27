/**
 * El coche propio, como en GTA: se pide con la tecla C (o el HUD) y aparece aparcado al lado; el
 * personaje va andando hasta la puerta, la abre, se sienta y la cierra; se conduce con física de
 * verdad; para bajarse, frena, abre, sale y cierra, y el coche se queda aparcado (otra C cerca de
 * él vuelve a subir; lejos, lo trae). Los demás lo ven todo por la pose (`car`, `vehicle` y los
 * gestos `car_open`, `car_in`, `car_out`).
 *
 * Solo en los distritos (las calles de sus ciudades) y nunca en las gafas: en VR manda el casco y un
 * coche en movimiento marea. La física (Rapier) se carga aparte la primera vez.
 */
import * as THREE from "three";
import { world } from "../../net/world-store";
import { ceilingHeight, crowd, forEachSolidBox, forEachSolidMesh, groundHeight, resolveCircle, setVehicleBox, solidsVersion } from "../collision";
import { placeBody, stepBody, type Body } from "../locomotion";
import { smoothSpeed, type Motion } from "../motion";
import { input } from "../input";
import { CAR } from "./car";
import { createCarPose } from "./CarModel";
import { carSound, carSoundStop } from "./audio";
import { DISTRICT_CHUNKS, drive, driveNotice, emitDrive, SEATED, setPhase, type Phase } from "./drive-state";
import type { StaticSource } from "./physics";

export { drive };

/** La pose del coche propio (la dibuja CarModel y viaja en POSE). */
export const carPose = createCarPose();

/** Duración de cada paso de subir y bajar (s): las de los clips de animación. */
const DUR: Partial<Record<Phase, number>> = { open: 0.5, in: 1.3, close: 0.5, open_out: 0.5, out: 1.05, close_out: 0.55 };
const WALK = 2.1;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);
const _p = { x: 0, z: 0 };

/** ¿Se puede sacar el coche aquí? (un distrito, el lugar ya abierto y fuera de las gafas). */
export function carAllowed(inXR: boolean) {
  return !inXR && world.status === "open" && DISTRICT_CHUNKS.has(world.chunkId);
}

const source: StaticSource = {
  version: solidsVersion,
  boxes: forEachSolidBox,
  meshes: forEachSolidMesh,
  bounds: () => world.walk,
};

/** Punto del coche (en sus ejes) → lugar. */
function toWorld(x: number, y: number, z: number, out: THREE.Vector3) {
  return out.set(x, y, z).applyQuaternion(carPose.q).add(carPose.p);
}
function carYaw() {
  const q = carPose.q;
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
}
/** Giro de un personaje (adelante = −Z del modelo) para mirar hacia (dx, dz). */
const faceYaw = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/** La caja del coche quieto, para que el personaje lo rodee. */
function parkBox(on: boolean) {
  if (!on) return setVehicleBox(null);
  const yaw = carYaw();
  toWorld(0, CAR.height / 2, CAR.centerZ, _v);
  setVehicleBox({ x: _v.x, y: _v.y, z: _v.z, hx: CAR.width / 2, hy: CAR.height / 2, hz: CAR.length / 2, c: Math.cos(yaw), s: Math.sin(yaw) });
}

/** ¿Hay sitio para el coche en (x, z) mirando a `yaw`? Ni paredes ni techo encima (interiores). */
function fits(x: number, z: number, yaw: number, y: number) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (const k of [-1.4, 0, 1.6]) {
    _p.x = x + fx * k;
    _p.z = z + fz * k;
    const ox = _p.x, oz = _p.z;
    resolveCircle(_p, CAR.width / 2, y + 0.25, y + CAR.height);
    if (Math.abs(_p.x - ox) > 1e-3 || Math.abs(_p.z - oz) > 1e-3) return false;
    if (ceilingHeight(ox, oz, 0.8, y + 0.3) < y + 3) return false;
  }
  return true;
}

/** ¿Cabe una persona de pie en (x, z)? */
function standFree(x: number, z: number, y: number) {
  _p.x = x;
  _p.z = z;
  resolveCircle(_p, 0.3, y + 0.4, y + 1.7);
  return Math.abs(_p.x - x) < 1e-3 && Math.abs(_p.z - z) < 1e-3;
}

/** Saca (o trae) el coche aparcado junto al personaje, con la puerta del conductor hacia él. */
async function summon(x: number, y: number, z: number, look: number) {
  const fx = -Math.sin(look), fz = -Math.cos(look); // hacia donde mira
  const rx = -fz, rz = fx; // su derecha
  const along = Math.atan2(fx, fz); // el coche mirando hacia donde mira el personaje
  // A su derecha (la puerta izquierda del coche queda hacia él), a su izquierda (girado) o delante.
  const tries: [number, number, number][] = [
    [x + rx * 2.5 + fx * 0.4, z + rz * 2.5 + fz * 0.4, along],
    [x - rx * 2.5 + fx * 0.4, z - rz * 2.5 + fz * 0.4, along + Math.PI],
    [x + fx * 3.6, z + fz * 3.6, along + Math.PI / 2],
  ];
  const at = tries.find(([cx, cz, yaw]) => fits(cx, cz, yaw, y));
  if (!at) {
    driveNotice("car.noRoom");
    return;
  }
  drive.loading = true;
  driveNotice("car.loading");
  try {
    const { CarSim, loadRapier } = await import("./physics");
    const R = await loadRapier();
    drive.sim ??= new CarSim(R, source, crowd);
    const gy = groundHeight(at[0], at[1], 0.6, y + 0.6);
    drive.sim.spawn(at[0], gy + CAR.wheelRadius - CAR.wheels[0]!.y + 0.02, at[1], at[2]);
    // Unos pasos de física para que se asiente en sus muelles antes de verlo.
    for (let i = 0; i < 40; i++) drive.sim.update(1 / 60, { throttle: 0, steer: 0, handbrake: true });
    readSim();
    carPose.visible = true;
    carPose.doorL = carPose.doorR = 0;
    parkBox(true);
    setPhase("walk");
  } catch (e) {
    console.warn("[xenxo] el coche no ha podido salir", e);
  } finally {
    drive.loading = false;
    driveNotice(null);
  }
}

function readSim() {
  const s = drive.sim!.state;
  carPose.p.set(s.x, s.y, s.z);
  carPose.q.set(s.qx, s.qy, s.qz, s.qw);
  carPose.steer = s.steer;
  carPose.spin = s.wheelSpin[2]!;
  carPose.wheelY = s.wheelY;
}

/** La puerta que se usa: la del lado del personaje (la izquierda si da igual) y con sitio para salir. */
function pickSide(px: number, pz: number) {
  toWorld(CAR.entry.x, 0, CAR.entry.z, _v);
  const dl = Math.hypot(_v.x - px, _v.z - pz);
  const okL = standFree(_v.x, _v.z, carPose.p.y);
  toWorld(-CAR.entry.x, 0, CAR.entry.z, _v);
  const dr = Math.hypot(_v.x - px, _v.z - pz);
  const okR = standFree(_v.x, _v.z, carPose.p.y);
  drive.side = okL && (!okR || dl <= dr + 1.5) ? 1 : okR ? -1 : 1;
}

/** La tecla C (o el HUD): subir, bajar, o traer el coche. */
export function requestCar(x: number, y: number, z: number, look: number, inXR: boolean) {
  switch (drive.phase) {
    case "drive":
      setPhase("stop");
      return;
    case "none":
      if (carAllowed(inXR) && !drive.loading) void summon(x, y, z, look);
      return;
    case "parked": {
      toWorld(0, 0, CAR.centerZ, _v);
      if (Math.hypot(_v.x - x, _v.z - z) < 12) {
        pickSide(x, z);
        setPhase("walk");
      } else if (carAllowed(inXR) && !drive.loading) {
        drive.sim?.despawn();
        void summon(x, y, z, look);
      }
      return;
    }
    default:
      return; // subiendo o bajando: espera
  }
}

/** Al irse del lugar (portal o viaje): el coche se queda allí. */
export function dropCar() {
  if (drive.phase === "none") return;
  drive.sim?.despawn();
  carSoundStop();
  carPose.visible = false;
  parkBox(false);
  setPhase("none");
}

/** Dónde dibujar al personaje mientras sube, va dentro o baja (raíz y giro completos). */
export const seated = { pos: new THREE.Vector3(), q: new THREE.Quaternion() };

function placeSeated(lx: number, ly: number, lz: number, localYaw: number) {
  toWorld(lx, ly, lz, seated.pos);
  seated.q.copy(carPose.q).multiply(_q.setFromAxisAngle(_y, localYaw));
}

export interface SeqCtx {
  body: Body;
  motion: Motion;
  bodyYaw: { current: number };
}

/**
 * Un frame del coche. Devuelve quién manda:
 * - `free`: el personaje anda como siempre (también con el coche aparcado o cerrando la puerta).
 * - `walking`: va solo hasta la puerta o la abre (se dibuja en su sitio, con su giro).
 * - `seated`: sube, va dentro o baja (se dibuja en `seated`, pegado al coche).
 * - `drive`: conduce (la cámara sigue al coche).
 */
export function carFrame(dt: number, ctx: SeqCtx): "free" | "walking" | "seated" | "drive" {
  const ph = drive.phase;
  if (ph === "none") return "free";
  drive.t += dt;
  const t = drive.t;
  const k = Math.min(1, t / (DUR[ph] ?? 1));
  const side = drive.side;
  const door = (v: number) => {
    if (side > 0) carPose.doorL = v;
    else carPose.doorR = v;
  };
  const { body, motion } = ctx;
  const ex = CAR.entry.x * side, ez = CAR.entry.z;
  const faceCar = Math.PI / 2 * side; // mirando hacia el coche (−X del coche si está a su izquierda)
  switch (ph) {
    case "walk": {
      // Si la persona se mueve, deja de ir hacia el coche.
      if (Math.hypot(input.move.x, input.move.y) > 0.2) {
        setPhase("parked");
        return "free";
      }
      toWorld(ex, 0, ez, _v);
      const dx = _v.x - body.x, dz = _v.z - body.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.18 || t > 5) {
        placeBody(body, _v.x, carPose.p.y, _v.z);
        setPhase("open");
        return "walking";
      }
      const sp = Math.min(WALK, d * 3);
      stepBody(body, (dx / d) * sp, (dz / d) * sp, dt, world.walk[0], world.walk[1]);
      smoothSpeed(motion, Math.hypot(body.vx, body.vz), dt);
      turn(ctx, faceYaw(dx, dz), dt);
      motion.emote = null;
      return "walking";
    }
    case "open": {
      door(k);
      motion.speed = 0;
      motion.emote = "car_open";
      turn(ctx, carYaw() + faceCar, dt * 2);
      if (k >= 1) setPhase("in");
      return "walking";
    }
    case "in": {
      // De cara al coche, se da la vuelta (de espaldas al asiento), se sienta y mete las piernas
      // girando hacia delante; mientras, se desliza de la puerta al asiento del centro.
      const e = k * k * (3 - 2 * k);
      const ey = Math.min(1, k * 1.6);
      const back = faceCar + Math.PI;
      const yaw = k < 0.3 ? faceCar + Math.PI * (k / 0.3) : back + (Math.PI - back) * ((k - 0.3) / 0.7);
      placeSeated(ex + (CAR.seat.x - ex) * e, CAR.seat.y * ey, ez + (CAR.seat.z - ez) * e, yaw);
      motion.speed = 0;
      motion.emote = "car_in";
      follow(body);
      if (k >= 1) setPhase("close");
      return "seated";
    }
    case "close": {
      door(1 - k);
      placeSeated(CAR.seat.x, CAR.seat.y, CAR.seat.z, Math.PI);
      motion.emote = "sit";
      follow(body);
      if (k >= 1) {
        door(0);
        parkBox(false);
        setPhase("drive");
      }
      return "seated";
    }
    case "drive":
    case "stop": {
      const sim = drive.sim!;
      const stopping = ph === "stop";
      const handbrake = stopping || input.brake || input.jump;
      input.jump = false;
      input.emote = null;
      sim.update(Math.min(dt, 0.1), { throttle: stopping ? 0 : input.move.y, steer: stopping ? 0 : input.move.x, handbrake });
      readSim();
      const st = sim.state;
      carSound(st.speed, stopping ? 0 : input.move.y, st.slip, st.impact);
      placeSeated(CAR.seat.x, CAR.seat.y, CAR.seat.z, Math.PI);
      motion.speed = 0;
      motion.emote = "sit";
      follow(body);
      if (stopping && (Math.abs(st.speed) < 0.8 || t > 5)) {
        carSoundStop();
        parkBox(true);
        // Bajar por el lado que tenga sitio (la izquierda si cabe).
        toWorld(CAR.entry.x, 0, CAR.entry.z, _v);
        drive.side = standFree(_v.x, _v.z, carPose.p.y) ? 1 : -1;
        setPhase("open_out");
      }
      return "drive";
    }
    case "open_out": {
      door(k);
      placeSeated(CAR.seat.x, CAR.seat.y, CAR.seat.z, Math.PI);
      motion.emote = "sit";
      follow(body);
      if (k >= 1) setPhase("out");
      return "seated";
    }
    case "out": {
      // Sentado → de pie fuera, mirando hacia fuera del coche.
      const e = k * k * (3 - 2 * k);
      const ey = Math.max(0, (k - 0.35) / 0.65);
      const away = faceCar + Math.PI; // de espaldas al coche
      placeSeated(CAR.seat.x + (ex - CAR.seat.x) * e, CAR.seat.y * (1 - ey), CAR.seat.z + (ez - CAR.seat.z) * e, Math.PI + (away - Math.PI) * e);
      motion.speed = 0;
      motion.emote = "car_out";
      follow(body);
      if (k >= 1) {
        toWorld(ex, 0, ez, _v);
        placeBody(body, _v.x, carPose.p.y, _v.z);
        ctx.bodyYaw.current = carYaw() + away;
        motion.emote = null;
        setPhase("close_out");
      }
      return "seated";
    }
    case "close_out": {
      door(1 - k);
      if (k >= 1) {
        door(0);
        setPhase("parked");
      }
      return "free";
    }
    case "parked":
      return "free";
  }
  return "free";
}

/** El cuerpo (cámara, portales, peatones) va donde está el personaje sentado. */
function follow(body: Body) {
  body.x = seated.pos.x;
  body.z = seated.pos.z;
  body.y = carPose.p.y;
  body.vx = 0;
  body.vz = 0;
}

function turn(ctx: SeqCtx, want: number, rate: number) {
  let d = want - ctx.bodyYaw.current;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  ctx.bodyYaw.current += d * Math.min(1, rate * 8);
}

/** Lo que va en POSE: dónde está el coche (si lo hay) y si se va dentro. */
export function carForPose(): { car?: { p: [number, number, number]; r: [number, number, number, number] }; vehicle?: "car" } {
  if (drive.phase === "none" || !carPose.visible) return {};
  const q = carPose.q;
  return { car: { p: [carPose.p.x, carPose.p.y, carPose.p.z], r: [q.x, q.y, q.z, q.w] }, ...(SEATED.has(drive.phase) ? { vehicle: "car" as const } : {}) };
}

export function emitCar() {
  emitDrive();
}
