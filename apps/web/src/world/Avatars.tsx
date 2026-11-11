import { Suspense, useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import type { AvatarRef } from "@xenxo/protocol";
import { assetUrl } from "../config";
import { t } from "../i18n";
import { BUBBLE_MS, chat, useChatVersion, useWorldVersion, world, type PoseSample } from "../net/world-store";
import { Catchup, cursor, seek } from "../net/playout";
import { people } from "../net/people-store";
import { remoteFeet } from "./people/where";
import { self } from "./self";
import { RemotePeople, type RemoteDraw } from "./people/remotePeople";
import { freezable, walkAmount } from "./avatar-model";
import { crowdFrame, crowdView, joinCrowd, leaveCrowd, type CrowdEntry } from "./crowd";
import { graphics } from "./graphics";
import { groundHeight } from "./collision";
import { CustomAvatar } from "./CustomAvatar";
import { FONT_URL } from "./font";
import { advance, createMotion, smoothSpeed, type Motion } from "./motion";
import { HANG_DROP, HANG_IN, HANG_OFF } from "./parkour/moves";
import { presetFor } from "./presets";
import { applyCarPose, CarModel, createCarHandle, createCarPose } from "./vehicle/CarModel";
import { aimHands } from "./people/arms";
import { HeldWeapon } from "./people/HeldWeapon";
import { isWeaponId } from "@xenxo/protocol";
import { CAR, driverRoot, paintFor } from "./vehicle/car";
import { driverFx, driverLean, releaseDriver } from "./vehicle/driver";
import { dropRival, putRival } from "./vehicle/rivals";
import { CarPlayout } from "../net/car-playout";

/** Gestos con la puerta del coche abierta (subir y bajar). */
const DOOR_OPEN = new Set(["car_open", "car_in", "car_out"]);
const _cp = new THREE.Vector3();
const _cq = new THREE.Quaternion();
/** Quien conduce: recostado (lo que pida su estatura) y mirando adelante (vehicle/car.ts). */
const SEAT = driverRoot(CAR.lean);
const _seatQ = new THREE.Quaternion();
const _seatX = new THREE.Vector3(1, 0, 0);
const _halfTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/** Entre qué dos muestras de alguien toca dibujar (net/playout.ts): uno para todos, sin objetos nuevos por frame. */
const _cur = cursor();
const _old = new THREE.Vector3();
/** La cabeza de alguien en la hora `rt`, entre sus muestras (o siguiendo más allá de la última). */
function headAt(buf: readonly PoseSample[], rt: number, out: THREE.Vector3): THREE.Vector3 {
  seek(buf, rt, _cur);
  return out.fromArray(buf[_cur.i0]!.head.p).lerp(_b.fromArray(buf[_cur.i1]!.head.p), _cur.k);
}
/** Sin poses nuevas en este tiempo (lugares grandes), la persona está lejos: no se dibuja. */
const STALE_MS = 3500;
/** En los lugares grandes, más lejos de esto (m) no se dibuja a nadie (las poses llegan a menos de 70: AOI_RADIUS). */
const FAR = 75;
/** Más lejos de esto (m) no se dibuja el nombre de nadie: no se lee, y es una llamada de dibujo por persona. */
const NAME_FAR = 28;
export const EYE_HEIGHT = 1.6;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Caer al suelo sin esqueleto VRM (gesto hit_down): cuánto se tumba (rad) y hacia dónde, si no se sabe del golpe. */
const DOWN_TILT = 1.45;
const _draw: RemoteDraw = { x: 0, y: 0, z: 0, yaw: 0, emote: null, placed: false };
/** Tal cual llega la pose (antes de que haya nada de la gente montado). */
function plain(x: number, y: number, z: number, yaw: number, emote: string | null): RemoteDraw {
  _draw.x = x;
  _draw.y = y;
  _draw.z = z;
  _draw.yaw = yaw;
  _draw.emote = emote;
  _draw.placed = false;
  return _draw;
}
const _tq = new THREE.Quaternion();
const _ty = new THREE.Quaternion();
const _tAxis = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);

export function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.55, 0.62);
}

/**
 * Personaje por defecto, articulado para poder caminar: torso, cabeza con visor,
 * brazos y piernas que giran desde hombros y caderas. Pies en y = 0, mirando a -Z.
 */
export function DefaultAvatar({ color, motion }: { color: THREE.ColorRepresentation; motion: Motion }) {
  const root = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!root.current || !legL.current || !legR.current || !armL.current || !armR.current) return;
    const k = walkAmount(motion.speed);
    const s = Math.sin(motion.phase);
    legL.current.rotation.x = s * 0.6 * k;
    legR.current.rotation.x = -s * 0.6 * k;
    armL.current.rotation.x = -s * 0.5 * k;
    armR.current.rotation.x = s * 0.5 * k;
    root.current.position.y = Math.abs(Math.cos(motion.phase)) * 0.04 * k;
  });

  return (
    <group ref={root}>
      {/* Piernas: el pivote está en la cadera */}
      <group ref={legL} position={[-0.12, 0.82, 0]}>
        <mesh position={[0, -0.41, 0]} castShadow>
          <capsuleGeometry args={[0.1, 0.62, 3, 8]} />
          <meshLambertMaterial color="#5a4a3f" />
        </mesh>
      </group>
      <group ref={legR} position={[0.12, 0.82, 0]}>
        <mesh position={[0, -0.41, 0]} castShadow>
          <capsuleGeometry args={[0.1, 0.62, 3, 8]} />
          <meshLambertMaterial color="#5a4a3f" />
        </mesh>
      </group>
      {/* Torso */}
      <mesh position={[0, 1.12, 0]} castShadow>
        <capsuleGeometry args={[0.24, 0.42, 4, 12]} />
        <meshLambertMaterial color={color} />
      </mesh>
      {/* Brazos: el pivote está en el hombro */}
      <group ref={armL} position={[-0.33, 1.36, 0]}>
        <mesh position={[0, -0.3, 0]} castShadow>
          <capsuleGeometry args={[0.075, 0.48, 3, 8]} />
          <meshLambertMaterial color={color} />
        </mesh>
      </group>
      <group ref={armR} position={[0.33, 1.36, 0]}>
        <mesh position={[0, -0.3, 0]} castShadow>
          <capsuleGeometry args={[0.075, 0.48, 3, 8]} />
          <meshLambertMaterial color={color} />
        </mesh>
      </group>
      {/* Cabeza con visor de azulejo */}
      <mesh position={[0, EYE_HEIGHT, 0]} castShadow>
        <sphereGeometry args={[0.2, 16, 12]} />
        <meshLambertMaterial color="#f1d9c4" />
      </mesh>
      <mesh position={[0, EYE_HEIGHT + 0.02, -0.19]}>
        <boxGeometry args={[0.24, 0.07, 0.04]} />
        <meshBasicMaterial color="#2f6fb0" />
      </mesh>
    </group>
  );
}

/**
 * Personaje de alguien: el suyo propio si lo tiene; si no, uno de serie (realista, animado).
 * Mientras carga se ve el muñeco articulado de respaldo.
 */
/** `avatar`: el suyo; sin él, uno de serie según `seed`; `null`: aún no se sabe (solo el muñeco). */
/** `extra`: gente de decorado (peatones, residentes): sin sombra. */
/** `lite`: la versión ligera del avatar de serie (quien llega cuando ya hay mucha gente), con su sombra. */
export function AvatarBody({ avatar, seed, motion, extra = false, lite = false, onLoad }: { avatar?: AvatarRef | null; seed: string; motion: Motion; extra?: boolean; lite?: boolean; onLoad?: (loaded: boolean) => void }) {
  useFrame((_, dt) => advance(motion, Math.min(dt, 0.1)));
  const fallback = <DefaultAvatar color={colorFor(seed)} motion={motion} />;
  if (avatar === null) return fallback;
  const preset = avatar ? null : presetFor(seed);
  // La gente de decorado lleva la versión ligera del avatar de serie (un tercio de los triángulos).
  const url = avatar ? assetUrl(avatar.hash) : preset ? assetUrl((extra || lite) && preset.lite ? preset.lite : preset.hash) : null;
  return <CustomAvatar url={url} fallback={fallback} motion={motion} extra={extra} onLoad={onLoad} />;
}

/** Cómo se ven los bocadillos (el chat y lo que dice la gente de las ciudades, city/Speech.tsx). */
export const BUBBLE_STYLE = { fontSize: 0.17, maxWidth: 2.4, color: "#2a211c", outlineWidth: 0.05, outlineColor: "#f6f1e7", lineHeight: 1.25 } as const;

/** Bocadillo con el último mensaje del chat de esa sesión, durante unos segundos. */
export function ChatBubble({ sessionId, self }: { sessionId?: string; self?: boolean }) {
  useChatVersion();
  const [, setTick] = useState(0);
  const id = self ? world.sessionId : sessionId;
  const m = id ? chat.bubbleFor(id) : null;
  useEffect(() => {
    if (!m) return;
    const left = Math.max(0, BUBBLE_MS - (world.serverNow() - m.t));
    const timer = setTimeout(() => setTick((n) => n + 1), left + 50);
    return () => clearTimeout(timer);
  }, [m]);
  if (!m) return null;
  const text = m.text.length > 90 ? `${m.text.slice(0, 88)}…` : m.text;
  return (
    <Billboard position={[0, 2.5, 0]}>
      <Text font={FONT_URL} {...BUBBLE_STYLE} textAlign="center" anchorY="bottom">
        {text}
      </Text>
    </Billboard>
  );
}

/** ¿Hay ya `full` personas más cerca de quien juega que esta? (Al montarla: entonces lleva la versión ligera.) */
function crowdedFor(id: string, full: number): boolean {
  if (world.peers.size <= full) return false;
  const mine = world.poseBuffers.get(id);
  const me = mine?.[mine.length - 1]?.head.p;
  if (!me) return true;
  const d = (me[0] - self.x) ** 2 + (me[2] - self.z) ** 2;
  let nearer = 0;
  for (const [other, buf] of world.poseBuffers) {
    const p = other === id ? null : buf[buf.length - 1]?.head.p;
    if (p && (p[0] - self.x) ** 2 + (p[2] - self.z) ** 2 < d && ++nearer >= full) return true;
  }
  return false;
}

function RemoteAvatar({ sessionId, name, avatar, paint }: { sessionId: string; name: string; avatar?: AvatarRef; paint: string }) {
  const body = useRef<THREE.Group>(null);
  const person = useRef<THREE.Group>(null);
  const motion = useRef(createMotion()).current;
  // Golpes, parejas y caídas de esta persona, dibujados aquí (people/remotePeople.ts). Se crea en un
  // efecto (con su limpieza): así no se queda nada escuchando si el componente no llega a montarse.
  const rp = useRef<RemotePeople | null>(null);
  useEffect(() => {
    const r = new RemotePeople(sessionId);
    rp.current = r;
    motion.fx = r.fx;
    return () => {
      r.dispose();
      if (rp.current === r) rp.current = null;
    };
  }, [sessionId, motion]);
  const last = useRef(new THREE.Vector3(NaN, 0, 0)).current;
  // Su coche (en marcha o aparcado), con su giro completo; si va dentro, sentado en él.
  const car = useRef(createCarPose()).current;
  const carHandle = useRef(createCarHandle()).current;
  const [hasCar, setHasCar] = useState(false);
  const tilt = useRef(0);
  /** Parkour: inclinado de lado (correr por la pared) y hacia atrás (subir por ella), suavizado. */
  const pkTilt = useRef({ lean: 0, pitch: 0 }).current;
  /** Parkour, colgado: el borde (reconstruido con las reglas del parkour), las manos y el dibujo. */
  const pkHang = useRef({ x: 0, y: 0, z: 0, fx: 0, fz: 1, t: 0, on: false, hands: false, sh: 0, off: 0, lift: 0 }).current;
  /** Con el arma sacada, las manos apuntan (§9 octies ter): para soltarlas una sola vez. */
  const gunHands = useRef(false);
  /** Al volante, la cadera y las manos las lleva el coche (vehicle/driver.ts): para soltarlas al bajar. */
  const seatedFx = useRef(false);
  /** Conduciendo, su coche cuenta para el mío (vehicle/rivals.ts): para dejar de apuntarlo al bajarse. */
  const rival = useRef(false);
  /** Y se dibuja donde está ahora, no donde estaba cuando mandó su última pose (net/car-playout.ts). */
  const carNow = useRef(new CarPlayout()).current;
  const feetAt = useRef(new THREE.Vector3()).current;
  useEffect(() => {
    remoteFeet.set(sessionId, feetAt);
    return () => {
      remoteFeet.delete(sessionId);
      dropRival(sessionId);
    };
  }, [sessionId, feetAt]);
  /** Lo que queda por deshacer cuando la muestra que se esperaba llega y no cae donde se la suponía (net/playout.ts). */
  const catchup = useRef(new Catchup()).current;
  // Entre mucha gente (crowd.ts): quien no se ve no se toca y a los de más lejos no les toca a cada
  // frame. Y quien llega cuando ya hay mucha lleva la versión ligera de su avatar de serie.
  const crowd = useRef<CrowdEntry | null>(null);
  const lite = useRef(crowdedFor(sessionId, graphics.features.crowd)).current;
  const label = useRef<THREE.Group>(null);
  const placed = useRef(false);
  useEffect(() => {
    const e = joinCrowd(motion);
    crowd.current = e;
    if (body.current) freezable(body.current);
    return () => {
      leaveCrowd(e);
      crowd.current = null;
    };
  }, [motion]);

  useFrame((_, dt) => {
    const buf = world.poseBuffers.get(sessionId);
    if (!buf || buf.length === 0 || !body.current) return;
    const rt = world.playTime(sessionId);
    const newest = buf[buf.length - 1]!.t;
    // En los lugares grandes solo llegan las poses de quien está cerca: quien se aleja deja de
    // actualizarse y se oculta (no se queda congelado donde se le vio por última vez).
    body.current.visible = !world.big || rt - newest < STALE_MS;

    // Se iba siguiendo más allá de su última muestra y ha llegado la siguiente: en vez de saltar a
    // donde cae con ella, la diferencia se deshace en un momento.
    const redo = catchup.redo(newest);
    if (!Number.isNaN(redo)) {
      headAt(buf, redo, _old);
      catchup.absorb(_old.x, _old.y, _old.z);
    }
    headAt(buf, rt, _a);
    const s0 = buf[_cur.i0]!, s1 = buf[_cur.i1]!;
    const k = _cur.k;
    _qa.fromArray(s0.head.r).slerp(_qb.fromArray(s1.head.r), _cur.kr).normalize();
    catchup.frame(rt, newest, _cur.over > 0, _a.x, _a.y, _a.z, dt);
    // La velocidad del paso sale de lo que dan las muestras solas; lo que se dibuja lleva además el desajuste.
    const step = Number.isNaN(last.x) ? 0 : Math.hypot(_a.x - last.x, _a.z - last.z);
    last.copy(_a);
    _a.x += catchup.x;
    _a.y += catchup.y;
    _a.z += catchup.z;
    // Quien lleva a los ciudadanos recibe las poses de todo el lugar (§9 nonies): se dibuja (y se
    // anima) solo a quien está tan cerca como para que le llegaran sin eso.
    const far2 = (_a.x - self.x) ** 2 + (_a.z - self.z) ** 2;
    if (world.big && far2 > FAR * FAR) body.current.visible = false;
    // Dónde está, para la cuenta del frame que viene; y lo decidido para este: fuera de la vista no
    // se dibuja ni se anima, y si no le toca se queda como estaba.
    const ce = crowd.current;
    const shown = body.current.visible;
    if (ce) {
      ce.x = _a.x;
      ce.y = _a.y;
      ce.z = _a.z;
      ce.d2 = far2;
      ce.shown = shown;
      ce.lively = placed.current || people.fighters.has(sessionId);
      if (!ce.inView) body.current.visible = false;
    }
    motion.hidden = !body.current.visible;
    body.current.userData.frozen = motion.hidden || !!motion.skip;
    if (label.current) label.current.visible = far2 < NAME_FAR * NAME_FAR;

    // Velocidad horizontal medida entre frames, suavizada: de ella sale el paso.
    if (dt > 0) smoothSpeed(motion, step / dt, dt);

    // El coche. Aparcado, donde lo dejó (entre sus dos poses, como la persona). Con ella al volante
    // (lo dice su última pose), donde está ahora: a esas velocidades, dibujado con el retraso de las
    // poses iría metros por detrás, y cada uno chocaría con un coche que el otro no lleva ahí.
    const c1 = s1.car;
    if (c1 && !hasCar) setHasCar(true);
    // (Su coche puede estar aparcado en otro sitio: se ve aunque ella quede fuera de la vista.)
    car.visible = !!c1 && shown;
    if (c1) {
      const was = _cp.copy(car.p);
      const latest = buf[buf.length - 1]!;
      if (latest.vehicle === "car" && latest.car && carNow.frame(buf, world.serverNow(), dt)) {
        car.p.set(carNow.x, carNow.y, carNow.z);
        car.q.set(carNow.qx, carNow.qy, carNow.qz, carNow.qw);
        // Y cuenta para el mío, que choca con él tal como se dibuja; si mi golpe lo ha desplazado, se
        // ve ya (vehicle/rivals.ts), hasta que su propia pose diga qué le ha pasado.
        if (shown) {
          const hit = putRival(sessionId, car.p, car.q);
          car.p.x += hit.ox;
          car.p.y += hit.oy;
          car.p.z += hit.oz;
          rival.current = true;
        } else if (rival.current) {
          dropRival(sessionId);
          rival.current = false;
        }
      } else {
        carNow.reset();
        if (rival.current) {
          dropRival(sessionId);
          rival.current = false;
        }
        const c0 = s0.car ?? c1;
        car.p.fromArray(c0.p).lerp(_b.fromArray(c1.p), k);
        car.q.fromArray(c0.r).slerp(_cq.fromArray(c1.r), _cur.kr).normalize();
      }
      // Las ruedas giran con lo que avanza (hacia delante o hacia atrás).
      const dz = was.sub(car.p).negate();
      _b.set(0, 0, 1).applyQuaternion(car.q);
      if (dz.lengthSq() < 4) car.spin += dz.dot(_b) / CAR.wheelRadius;
      const want = s1.emote && DOOR_OPEN.has(s1.emote) ? 1 : 0;
      car.doorL += Math.max(-dt * 2, Math.min(dt * 2, want - car.doorL));
    } else if (rival.current) {
      dropRival(sessionId);
      rival.current = false;
    }
    applyCarPose(carHandle, car);
    const driving = s1.vehicle === "car" && !!c1;
    // Pies bajo la cabeza; el cuerpo solo sigue el giro horizontal. Está en el aire si los pies
    // quedan por encima de lo que pisa (el suelo o una caja: se puede estar de pie en un banco).
    const feet = Math.max(-0.5, _a.y - EYE_HEIGHT);
    motion.airborne = !driving && feet - groundHeight(_a.x, _a.z, 0.24, feet + 0.1) > 0.05;
    motion.fight = people.fighters.has(sessionId);
    if (driving) {
      // Sentado al volante («sit» en su pose): la de conducir, con la cadera en el asiento y las manos en el aro.
      const atWheel = s1.emote === "sit";
      motion.emote = atWheel ? "drive" : (s1.emote ?? null);
      motion.weapon = null;
      // Sentado en el asiento, pegado al coche (sin el desfase entre las dos poses).
      const lean = driverLean(motion.fx);
      driverRoot(lean, SEAT);
      body.current.position.set(SEAT.x, SEAT.y, SEAT.z).applyQuaternion(car.q).add(car.p);
      body.current.quaternion.copy(car.q).multiply(_seatQ.setFromAxisAngle(_seatX, -lean)).multiply(_halfTurn);
      driverFx(motion.fx, car.p, car.q, 1, atWheel ? 1 : 0);
      seatedFx.current = true;
      feetAt.copy(body.current.position);
    } else {
      if (seatedFx.current) {
        releaseDriver(motion.fx);
        seatedFx.current = false;
      }
      const yaw = _e.setFromQuaternion(_qa, "YXZ").y;
      // Golpes, caídas y parejas (lo dibuja este cliente al llegar, sin esperar a su pose).
      const d = rp.current ? rp.current.frame(dt, body.current, _a.x, feet, _a.z, yaw, s1.emote ?? null, _draw) : plain(_a.x, feet, _a.z, yaw, s1.emote ?? null);
      placed.current = d.placed;
      // Parkour (world/parkour): lo que está haciendo lo dibuja la animación con su propio reloj.
      const pkE = d.emote?.startsWith("pk_") ? d.emote : null;
      motion.pk = pkE;
      motion.emote = pkE ? null : d.emote;
      const k = Math.min(1, dt * 10);
      pkTilt.lean += ((pkE === "pk_wallrun_r" ? 0.4 : pkE === "pk_wallrun_l" ? -0.4 : 0) - pkTilt.lean) * k;
      pkTilt.pitch += ((pkE === "pk_wallup" ? 0.3 : 0) - pkTilt.pitch) * k;
      // Colgado (o trepando desde ahí): el borde está HANG_DROP por encima de sus pies y HANG_OFF
      // delante (las reglas de world/parkour); las manos en él y el cuerpo contra la pared.
      const hangE = pkE === "pk_hang" || pkE === "pk_shimmy_l" || pkE === "pk_shimmy_r";
      if (hangE) {
        pkHang.fx = -Math.sin(d.yaw);
        pkHang.fz = -Math.cos(d.yaw);
        pkHang.x = d.x + pkHang.fx * (HANG_OFF + 0.06);
        pkHang.z = d.z + pkHang.fz * (HANG_OFF + 0.06);
        pkHang.y = d.y + HANG_DROP + 0.02;
        pkHang.t = 0;
        pkHang.on = true;
        if (pkE !== "pk_hang") pkHang.sh += dt * 0.9;
      } else if (pkE === "pk_climb" && pkHang.on) pkHang.t += dt;
      else pkHang.on = false;
      const handW = !pkHang.on ? 0 : hangE || pkHang.t < 0.79 ? 1 : Math.max(0, 1 - (pkHang.t - 0.79) / 0.16);
      const fxr = motion.fx;
      if (fxr && handW > 0.01) {
        const rx = -pkHang.fz, rz = pkHang.fx;
        const step = pkE === "pk_shimmy_r" ? Math.sin(pkHang.sh * 12) : pkE === "pk_shimmy_l" ? -Math.sin(pkHang.sh * 12) : 0;
        const sl = -0.21 + Math.max(0, -step) * 0.12, sr = 0.21 + Math.max(0, step) * 0.12;
        fxr.reachL.x = pkHang.x + rx * sl;
        fxr.reachL.y = pkHang.y;
        fxr.reachL.z = pkHang.z + rz * sl;
        fxr.reachR.x = pkHang.x + rx * sr;
        fxr.reachR.y = pkHang.y;
        fxr.reachR.z = pkHang.z + rz * sr;
        fxr.reachL.w = fxr.reachR.w = handW;
        pkHang.hands = true;
      } else if (fxr && pkHang.hands) {
        fxr.reachL.w = fxr.reachR.w = 0;
        pkHang.hands = false;
      }
      // Con el arma sacada (su pose lo dice): las manos apuntan hacia donde mira (people/arms.ts).
      const held = !d.placed && !pkHang.on && isWeaponId(s1.weapon) ? s1.weapon : null;
      motion.weapon = held;
      if (fxr && held) {
        aimHands(fxr, d.x, d.y, d.z, d.yaw, held);
        gunHands.current = true;
      } else if (fxr && gunHands.current) {
        fxr.reachL.w = fxr.reachR.w = 0;
        gunHands.current = false;
      }
      const inW = hangE ? 1 : pkHang.on ? Math.max(0, 1 - Math.max(0, pkHang.t - 0.44) / 0.5) : 0;
      pkHang.off += (inW - pkHang.off) * Math.min(1, dt * 12);
      const rigR = fxr?.rig;
      if (handW > 0.5 && rigR) pkHang.lift = THREE.MathUtils.clamp(pkHang.lift + rigR.reachLift * Math.min(1, dt * 14), 0, 0.6);
      else pkHang.lift *= 1 - Math.min(1, dt * 8);
      if (!d.placed) body.current.position.set(d.x + pkHang.fx * HANG_IN * pkHang.off, d.y + pkHang.lift, d.z + pkHang.fz * HANG_IN * pkHang.off);
      // Sin esqueleto VRM (un GLB o el muñeco): en el suelo se tumba entero hacia donde le dieron.
      const want = !motion.fx?.rig && d.emote === "hit_down" ? DOWN_TILT : 0;
      tilt.current += (want - tilt.current) * Math.min(1, dt * (want ? 9 : 3));
      if (tilt.current > 0.01) {
        const hit = people.lastHit.get(sessionId);
        const dx = hit?.dir[0] ?? Math.sin(d.yaw), dz = hit?.dir[1] ?? Math.cos(d.yaw);
        _tAxis.set(dz, 0, -dx).normalize();
        _tq.setFromAxisAngle(_tAxis, tilt.current);
        _ty.setFromAxisAngle(_Y, d.yaw);
        body.current.quaternion.copy(_tq).multiply(_ty);
        body.current.position.y = Math.max(d.y, groundHeight(d.x, d.z, 0.24, d.y + 1.8));
      } else if (!d.placed) body.current.rotation.set(pkTilt.pitch, d.yaw, pkTilt.lean, "YXZ");
      feetAt.set(body.current.position.x, d.placed ? body.current.position.y : d.y, body.current.position.z);
    }
  });

  return (
    <>
      {hasCar && (
        <Suspense fallback={null}>
          <CarModel handle={carHandle} paint={paint} />
        </Suspense>
      )}
      <group ref={body}>
        <group ref={person}>
          <AvatarBody avatar={avatar} seed={sessionId} motion={motion} lite={lite} />
        </group>
        <HeldWeapon motion={motion} who={sessionId} />
        <Suspense fallback={null}>
          <group ref={label}>
            <Billboard position={[0, 2.15, 0]}>
              <Text font={FONT_URL} fontSize={0.22} color="#ffffff" outlineWidth={0.02} outlineColor="#000000">
                {name}
              </Text>
            </Billboard>
          </group>
          <ChatBubble sessionId={sessionId} />
        </Suspense>
      </group>
    </>
  );
}

export function Avatars() {
  useWorldVersion();
  // Antes que nadie en cada frame: la hora con la que se dibuja a todos y el ajuste del reloj; y,
  // entre mucha gente, a quién le toca este frame (crowd.ts).
  useFrame((state) => {
    world.frame();
    crowdView(state.camera);
    const f = graphics.features;
    crowdFrame(f.crowd, f.shadows > 0);
  }, -1);
  return (
    <>
      {[...world.peers.values()].map((p) => (
        <RemoteAvatar
          key={`${p.session_id}:${p.avatar?.hash ?? ""}`}
          sessionId={p.session_id}
          avatar={p.avatar}
          paint={paintFor(p.player_no != null ? `n${p.player_no}` : p.session_id)}
          name={
            p.kind === "agent"
              ? `${t("agents.agentPrefix")} · ${p.display_name}`
              : p.player_no != null
                ? `#${p.player_no} · ${p.display_name}`
                : p.display_name
          }
        />
      ))}
    </>
  );
}
