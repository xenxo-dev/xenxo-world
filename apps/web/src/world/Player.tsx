import { Suspense, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { XROrigin, useXR, useXRControllerLocomotion } from "@react-three/xr";
import * as THREE from "three";
import { CHUNK_SIZE, msg, type ClientMessage } from "@xenxo/protocol";
import { net, spawn } from "../net/session";
import { world } from "../net/world-store";
import type { AvatarRef } from "@xenxo/protocol";
import { useAccount } from "../net/account";
import { AvatarBody, ChatBubble } from "./Avatars";
import { createMotion, smoothSpeed } from "./motion";
import { cameraReach, findSeat } from "./collision";
import { boost } from "../net/activity-store";
import { STEP_UP, createBody, placeBody, requestJump, stepBody } from "./locomotion";
import { VRMenu } from "./xr/VRMenu";
import { placeOrigin, vr, vrFollowGround, vrStick, VR_SNAP, VR_WALK } from "./xr/vr-move";
import { guestPreset, useAccountPreset, useChosenPreset } from "./presets";
import { input, setFirstPerson, view } from "./input";
import { self } from "./self";
import { controls } from "../controls";
import { carForPose, carFrame, carPose, drive, dropCar, requestCar, seated } from "./vehicle/drive";
import { useDrive } from "./vehicle/drive-state";
import { applyCarPose, CarModel, createCarHandle } from "./vehicle/CarModel";
import { CAR, paintFor } from "./vehicle/car";
import { bumpNpcs, camKick, parkourFall, peopleBusy, peopleFrame, prepareFights, resetPeople, selfFx, startStrike, striking } from "./people/selfPeople";
import { cancelSlide, slideDir, slideEmote, slideP, slideStep, sliding, startSlide } from "./people/slide";
import { people } from "../net/people-store";
import { preloadParkour, UPPER_EMOTES } from "./animation";
import { createParkour, parkourStep, resetParkour } from "./parkour/moves";

const WALK = 2.1; // m/s
const RUN = 5.4;
/** Corriendo donde hay parkour (Vertical): algo más, para coger impulso. */
const PK_RUN = 6.0;
const EYE = 1.6;
/** Distancia de la cámara en tercera persona: por defecto, mínima y máxima (rueda o pellizco). */
const CAM_DIST = 3.4;
const CAM_MIN = 1.3;
const CAM_MAX = 9;
/**
 * Gestos que terminan solos (segundos); los demás duran hasta que te mueves. Los de brazos siguen
 * al andar (UPPER_EMOTES) hasta que acaban.
 */
const EMOTE_SECONDS: Record<string, number> = {
  wave: 2.2, cheer: 1.65, clap: 2.6, point: 1.9, beckon: 2.2, laugh: 2.6, shrug: 1.45, bow: 1.85,
  fold_arms: 8, nod: 2.5, shake_head: 2.5, phone: 12, talk: 8,
};
/** Lo que devuelve la gente cada frame (people/selfPeople.ts), sin crear objetos. */
const _pf = { lock: false, wantX: 0, wantZ: 0, drawn: false };
// 5 Hz: el movimiento se suaviza al otro lado (interpolación). Cada pose es 1/20 de petición del plan
// gratuito de Durable Objects (docs/LIMITES-CLOUDFLARE.md): a 8 Hz costaba un 60 % más.
const SEND_EVERY_MS = 200;
const HEARTBEAT_MS = 1000;
/** Dónde está el jugador ahora (lo leen los portales; se copia cada frame, sin crear objetos). */
export const playerPos = new THREE.Vector3(...spawn.p);
/** Hacia dónde mira (giro en radianes; adelante = (−sin, −cos)). Lo lee la zona de pruebas. */
export const playerLook = { yaw: 0 };

// Objetos reutilizados: nada de `new` dentro de useFrame (evita tirones del GC en Quest).
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _camWant = new THREE.Vector3();
const _headP = new THREE.Vector3();
const _headQ = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _lastP = new THREE.Vector3(Infinity, 0, 0);
const _lastQ = new THREE.Quaternion();
const _yawE = new THREE.Euler();
const _carQ = new THREE.Quaternion();
const _seat = new THREE.Vector3();
const _pkIn = { wantX: 0, wantZ: 0, jump: false, crouch: false, crouchPressed: false, yaw: 0 };
/** Lo del parkour (clips y física de las caídas) ya está pedido. */
let pkReady = false;
/** Ojos de quien conduce, respecto al origen del coche. */
const DRIVER_EYE = new THREE.Vector3(CAR.eye.x, CAR.eye.y, CAR.eye.z);
/** Bulto del jugador para los peatones que le ceden el paso (radio, m): mayor en coche. */
export const playerBulk = { r: 0.3 };

export function Player({ active }: { active: boolean }) {
  const user = useAccount();
  const chosen = useChosenPreset();
  const accountDefault = useAccountPreset(user && !user.avatar_hash ? user.id : undefined);
  // El propio personaje nunca depende de la sesión (cambiaría al ir de un lugar a otro).
  const guest = useMemo(() => guestPreset(), [chosen]); // eslint-disable-line react-hooks/exhaustive-deps
  const myAvatar: AvatarRef | null = user?.avatar_hash
    ? { hash: user.avatar_hash, format: user.avatar_format ?? "glb" }
    : user
      ? accountDefault
        ? { hash: accountDefault.hash, format: "vrm" }
        : null // aún calculándolo: el muñeco de respaldo, nunca uno al azar
      : { hash: guest.hash, format: "vrm" };
  const origin = useRef<THREE.Group>(null!);
  const avatar = useRef<THREE.Group>(null!);
  const body = useRef(createBody(...spawn.p)).current;
  const look = useRef({ yaw: spawn.yaw, pitch: -0.12 });
  const spawnSeq = useRef(spawn.seq);
  const motion = useRef(createMotion()).current;
  motion.fx ??= selfFx;
  /** Parkour (donde el lugar lo dice: WELCOME.parkour). */
  const pk = useRef(createParkour()).current;
  /** Las manos del parkour estaban puestas (para soltarlas una vez, sin pisar las de la gente). */
  const pkHands = useRef(false);
  /** Colgado: lo que se sube el dibujo para que las manos lleguen al borde (m). */
  const pkLift = useRef(0);
  const lastSend = useRef(0);
  const camReach = useRef(1);
  const cam3 = useRef({ dist: CAM_DIST, y: spawn.p[1] });
  /** Altura a la que se dibuja el cuerpo: sube y baja los escalones con suavidad (la física salta). */
  const visY = useRef(spawn.p[1]);
  const bodyYaw = useRef(0);
  const emoteUntil = useRef(0);
  const lastEmote = useRef<string | null>(null);
  const inXR = useXR((s) => s.session != null);
  const driving = useDrive();
  const carHandle = useRef(createCarHandle()).current;
  const lastPhase = useRef("none");
  const seqCtx = useRef({ body, motion, bodyYaw }).current;
  const peopleCtx = useRef({ body, motion, bodyYaw, avatar: null as unknown as THREE.Group }).current;

  /**
   * Cámara al volante: sigue al coche por detrás y se pone detrás de él cuando se mueve (parado, se
   * puede mirar alrededor); en primera persona, desde el asiento.
   */
  function chaseCamera(dt: number, cam: THREE.Camera, l: { yaw: number; pitch: number }, c3: { dist: number; y: number }) {
    const q = carPose.q;
    const carYaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    const ground = carPose.p.y;
    c3.y = ground;
    playerBulk.r = CAR.length / 2;
    const speed = drive.sim?.state.speed ?? 0;
    if (Math.abs(speed) > 1.5) {
      let d = carYaw + Math.PI - l.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      l.yaw += d * Math.min(1, dt * 2.4);
    }
    playerLook.yaw = l.yaw;
    if (view.firstPerson) {
      _seat.copy(DRIVER_EYE).applyQuaternion(q).add(carPose.p);
      cam.position.copy(_seat);
      _carQ.setFromEuler(_euler.set(l.pitch, l.yaw - carYaw, 0));
      cam.quaternion.copy(q).multiply(_carQ);
      return;
    }
    const dist = Math.max(4.2, c3.dist * 1.75);
    _camTarget.set(carPose.p.x, ground + 1.7, carPose.p.z);
    _camWant.set(
      _camTarget.x + Math.sin(l.yaw) * dist * Math.cos(l.pitch),
      _camTarget.y + 0.9 - Math.sin(l.pitch) * dist,
      _camTarget.z + Math.cos(l.yaw) * dist * Math.cos(l.pitch),
    );
    const reach = cameraReach(_camTarget.x, _camTarget.y, _camTarget.z, _camWant.x, _camWant.y, _camWant.z);
    camReach.current = reach < camReach.current ? reach : camReach.current + (reach - camReach.current) * Math.min(1, dt * 3);
    cam.position.lerpVectors(_camTarget, _camWant, camReach.current);
    cam.lookAt(_camTarget);
  }

  // En VR: joystick izquierdo para moverse, derecho para girar (giro por pasos alrededor de la cabeza,
  // menos mareo) y, hacia delante, el teletransporte (xr/VRTeleport.tsx).
  useXRControllerLocomotion(
    (velocity, yRot, dt: number, state: { camera: THREE.Camera }) => vrStick(velocity, yRot, dt, state.camera),
    { speed: VR_WALK },
    { type: "snap", degrees: (VR_SNAP * 180) / Math.PI },
  );

  useFrame((state, dt) => {
    const cam = state.camera;
    const l = look.current;
    /** Quién manda este frame: el personaje, la secuencia del coche o el volante (vehicle/drive.ts). */
    let mode: ReturnType<typeof carFrame> = "free";

    // Aparecer donde manda un portal (o el nexo 2D).
    if (spawn.seq !== spawnSeq.current) {
      spawnSeq.current = spawn.seq;
      placeBody(body, spawn.p[0], spawn.p[1], spawn.p[2]);
      cam3.current.y = spawn.p[1];
      l.yaw = spawn.yaw;
      bodyYaw.current = spawn.yaw;
      resetPeople(motion);
      resetParkour(pk, body);
      cancelSlide();
      if (inXR) {
        placeOrigin(spawn.p[0], spawn.p[1], spawn.p[2]);
        origin.current.rotation.set(0, spawn.yaw, 0);
      }
      // Al ir a otro lugar, el coche se queda.
      if (drive.phase !== "none") {
        dropCar();
        applyCarPose(carHandle, carPose);
      }
    }

    if (inXR) {
      vr.origin = origin.current;
      // Paredes y suelo de verdad (escaleras, pasarelas, interiores): xr/vr-move.ts.
      const feet = vrFollowGround(cam, dt);
      cam.getWorldPosition(_headP);
      cam.getWorldQuaternion(_headQ);
      body.x = _headP.x;
      body.y = feet;
      body.z = _headP.z;
      playerPos.set(body.x, feet, body.z);
      self.x = body.x;
      self.y = feet;
      self.z = body.z;
      // En VR el propio cuerpo no se dibuja (la cabeza es la de la persona).
      avatar.current.visible = false;
      // Gestos desde el panel de la VR (los ven los demás); moverse los cancela.
      if (input.emote) {
        motion.emote = input.emote;
        emoteUntil.current = state.clock.elapsedTime + (EMOTE_SECONDS[input.emote] ?? Infinity);
        input.emote = null;
      }
      if (motion.emote && (vr.moved || state.clock.elapsedTime > emoteUntil.current)) motion.emote = null;
      vr.moved = false;
      // Hacia dónde miras (para quien te tenga delante: saludos, parejas).
      self.yaw = Math.atan2(2 * (_headQ.w * _headQ.y + _headQ.x * _headQ.z), 1 - 2 * (_headQ.y * _headQ.y + _headQ.x * _headQ.x));
      self.vx = self.vz = self.wx = self.wz = 0;
      self.emote = motion.emote;
      self.driving = false;
      self.fight = false;
    } else {
      // Mantén el origen XR donde está el jugador, para entrar en VR en el mismo sitio.
      origin.current.position.set(body.x, body.y, body.z);
      origin.current.rotation.set(0, look.current.yaw, 0);
      const fp = view.firstPerson;

      if (active) {
        l.yaw += input.yawDelta;
        l.pitch = THREE.MathUtils.clamp(l.pitch + input.pitchDelta, fp ? -1.35 : -0.9, fp ? 1.35 : 0.5);
        input.yawDelta = 0;
        input.pitchDelta = 0;

        // Zoom: rueda o pellizco. Acercarse del todo pasa a primera persona; alejarse, vuelve.
        const c3 = cam3.current;
        if (input.zoomDelta) {
          if (fp) {
            if (input.zoomDelta > 0) {
              setFirstPerson(false);
              c3.dist = CAM_MIN + 0.4;
            }
          } else {
            c3.dist *= Math.exp(input.zoomDelta);
            if (c3.dist < CAM_MIN) {
              c3.dist = CAM_MIN;
              if (input.zoomDelta < 0) setFirstPerson(true);
            }
            c3.dist = Math.min(CAM_MAX, c3.dist);
          }
          input.zoomDelta = 0;
        }
        if (input.toggleView) {
          setFirstPerson(!view.firstPerson);
          if (!view.firstPerson && c3.dist < CAM_MIN + 0.4) c3.dist = CAM_DIST;
          input.toggleView = false;
        }

        // Coche: sacarlo, subir o bajar (tecla C o el HUD). Mientras sube o baja, manda la secuencia.
        if (input.car) {
          input.car = false;
          // En el suelo, en pareja o fuera de combate, no.
          if (!peopleBusy()) requestCar(body.x, body.y, body.z, l.yaw, inXR);
        }
        mode = carFrame(dt, seqCtx);
        applyCarPose(carHandle, carPose);
        const free = mode === "free";
        if (mode === "drive") {
          chaseCamera(dt, cam, l, c3);
        } else {
        playerBulk.r = 0.3;
        _fwd.set(-Math.sin(l.yaw), 0, -Math.cos(l.yaw));
        playerLook.yaw = l.yaw;
        _right.set(-_fwd.z, 0, _fwd.x);
        const amount = Math.min(1, Math.hypot(input.move.x, input.move.y));
        // En móvil, el joystick a tope también corre.
        let speed = input.run || (controls.autoRun && amount > 0.92) ? (world.parkour ? PK_RUN : RUN) : WALK;
        // Placa de impulso (boost@1): más rápido unos segundos, mientras te muevas.
        if (boost.until > performance.now()) speed = Math.max(speed, boost.speed);
        let wantX = (_fwd.x * input.move.y + _right.x * input.move.x) * speed;
        let wantZ = (_fwd.z * input.move.y + _right.z * input.move.x) * speed;

        // Modo pelea (Q, E, R o el HUD): combinaciones de golpes; llegan a quien esté en modo pelea a
        // tu alcance o, si no hay nadie, a la gente de decorado que tengas delante (selfPeople.ts).
        motion.fight = !!people.fightOn && !!people.style;
        if (input.attack) {
          const m = input.attack;
          input.attack = null;
          if (free && !peopleBusy()) startStrike(m, peopleCtx);
        }
        // La gente: golpes recibidos (traspié o caída con física), acciones en pareja.
        peopleCtx.avatar = avatar.current;
        if (free) peopleFrame(dt, peopleCtx, _pf);
        else _pf.lock = _pf.drawn = false;
        if (_pf.lock) {
          wantX = _pf.wantX;
          wantZ = _pf.wantZ;
          input.jump = false;
        }
        // Deslizarse en el modo pelea: corriendo, agacharse (people/slide.ts). Un golpe, una caída o
        // salir del modo pelea lo cortan.
        if (!motion.fight || !free || _pf.lock) cancelSlide();
        else if (input.crouchPressed && !striking() && !peopleBusy() && startSlide(body)) motion.emote = null;
        // Lo que pides (contra alguien de la ciudad, es lo que le empuja: city/citizens.ts).
        self.wx = free ? wantX : 0;
        self.wz = free ? wantZ : 0;

        // Parkour (Vertical): saltar, trepar, colgarse, correr por las paredes, deslizarse y rodar, con
        // los mismos botones (parkour/moves.ts). Nunca en el modo pelea ni en pareja.
        const parkour = world.parkour && free && !_pf.lock && !motion.fight;
        if (world.parkour && !pkReady) {
          // Los clips del parkour y la física de las caídas, antes del primer salto.
          pkReady = true;
          preloadParkour();
          prepareFights();
        }
        if (!parkour && pk.move !== "none") resetParkour(pk, body);
        if (input.jump && free && !parkour) {
          requestJump(body);
          motion.emote = null; // saltar también levanta del banco
          input.jump = false;
        }
        // Sentado no hay físicas: el banco es una caja y nos subiría encima.
        // En el nexo (en solitario) se camina más allá del chunk: por las pasarelas hasta las islas.
        // Mientras se viaja (aún sin WELCOME ni suelo del lugar nuevo) el cuerpo espera quieto: si
        // diera pasos, los límites y el suelo del lugar anterior lo dejarían fuera de lo caminable.
        if (free && !_pf.drawn && motion.emote !== "sit" && world.status === "open") {
          if (parkour) {
            _pkIn.wantX = wantX;
            _pkIn.wantZ = wantZ;
            _pkIn.jump = input.jump;
            _pkIn.crouch = input.crouch;
            _pkIn.crouchPressed = input.crouchPressed;
            _pkIn.yaw = bodyYaw.current;
            if (input.jump) motion.emote = null;
            parkourStep(pk, body, _pkIn, dt, world.walk[0], world.walk[1]);
            // Una caída de verdad (de muy alto sin rodar, o contra una pared corriendo): la gente.
            if (pk.fall) {
              parkourFall(pk.fall, pk.fallX, pk.fallZ, pk.fallV);
              pk.fall = "";
            }
          } else if (sliding()) slideStep(body, dt, world.walk[0], world.walk[1]);
          else stepBody(body, wantX, wantZ, dt, world.walk[0], world.walk[1]);
        }
        input.jump = false;
        input.crouchPressed = false;
        if (free && !_pf.lock) bumpNpcs(body, bodyYaw.current);
        if (free) smoothSpeed(motion, Math.hypot(body.vx, body.vz), dt);
        motion.airborne = free && !body.grounded && pk.move === "none";
        motion.pk = parkour ? pk.emote : slideEmote();
        motion.pkP = parkour ? pk.p : slideP();
        // Las manos en el borde o en la valla (IK del esqueleto, people/rig.ts).
        const fx = motion.fx;
        if (fx && parkour && pk.hand.w > 0.01) {
          fx.reachL.x = pk.hand.lx;
          fx.reachL.y = pk.hand.ly;
          fx.reachL.z = pk.hand.lz;
          fx.reachL.w = pk.hand.w;
          fx.reachR.x = pk.hand.rx;
          fx.reachR.y = pk.hand.ry;
          fx.reachR.z = pk.hand.rz;
          fx.reachR.w = pk.hand.w;
          pkHands.current = true;
        } else if (fx && pkHands.current) {
          fx.reachL.w = fx.reachR.w = 0;
          pkHands.current = false;
        }
        // Colgado o trepando: el dibujo sube lo que les falte a sus brazos para llegar al borde (cada
        // avatar mide lo suyo: people/rig.ts → reachLift) y vuelve a su sitio al soltarse.
        const rigNow = fx?.rig;
        if (parkour && (pk.move === "hang" || pk.move === "climb") && pk.hand.w > 0.5 && rigNow) {
          pkLift.current = THREE.MathUtils.clamp(pkLift.current + rigNow.reachLift * Math.min(1, dt * 14), 0, 0.6);
        } else pkLift.current *= 1 - Math.min(1, dt * 8);

        // El cuerpo gira hacia donde camina (la cámara puede mirar a otro lado); en primera
        // persona, hacia donde miras.
        if (!free || _pf.lock) {
          // Lo mueve la secuencia del coche (o la gente: un golpe, una pareja).
        } else if (parkour && !Number.isNaN(pk.yaw)) {
          // Lo que se está haciendo manda (de cara a la pared, a lo largo de ella…).
          let d = pk.yaw - bodyYaw.current;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          bodyYaw.current += d * Math.min(1, dt * 16);
        } else if (sliding()) {
          // Deslizándose: de cara a donde va.
          const sd = slideDir();
          let d = Math.atan2(-sd.x, -sd.z) - bodyYaw.current;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          bodyYaw.current += d * Math.min(1, dt * 16);
        } else if (fp) bodyYaw.current = l.yaw;
        else if (amount > 0.05) {
          const want = Math.atan2(-wantX, -wantZ);
          let d = want - bodyYaw.current;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          bodyYaw.current += d * Math.min(1, dt * 10);
        }

        // Gestos: se piden con el teclado (1-4) o el HUD; moverse los cancela.
        if (input.emote && free && !_pf.lock) {
          let emote = input.emote;
          if (emote === "sit") {
            // Sentarse en el banco más cercano; sin banco, en cuclillas.
            const seat = findSeat(body.x, body.z);
            if (seat) {
              placeBody(body, seat.x, body.y, seat.z);
              bodyYaw.current = seat.yaw + Math.PI;
            } else emote = "crouch";
          }
          motion.emote = emote;
          emoteUntil.current = state.clock.elapsedTime + (EMOTE_SECONDS[emote] ?? Infinity);
          input.emote = null;
        }
        if (free && !_pf.lock && !striking() && motion.emote && ((amount > 0.05 && !UPPER_EMOTES.has(motion.emote)) || motion.airborne || state.clock.elapsedTime > emoteUntil.current)) motion.emote = null;

        // La altura de la cámara sigue al cuerpo con suavidad (al subir un escalón no da un tirón).
        c3.y += (body.y - c3.y) * Math.min(1, dt * (body.grounded ? 10 : 25));
        if (view.firstPerson) {
          cam.position.set(body.x + _fwd.x * 0.12, c3.y + EYE + 0.05, body.z + _fwd.z * 0.12);
          cam.quaternion.setFromEuler(_euler.set(l.pitch, l.yaw, 0));
        } else {
          // Cámara en tercera persona detrás del avatar, a la altura del hombro; se acerca si una
          // pared se interpone.
          const dist = c3.dist;
          _camTarget.set(body.x, 1.45 + c3.y, body.z);
          _camWant.set(
            _camTarget.x + Math.sin(l.yaw) * dist * Math.cos(l.pitch),
            _camTarget.y + 0.55 * Math.min(1, dist / CAM_DIST) - Math.sin(l.pitch) * dist,
            _camTarget.z + Math.cos(l.yaw) * dist * Math.cos(l.pitch),
          );
          const reach = cameraReach(_camTarget.x, _camTarget.y, _camTarget.z, _camWant.x, _camWant.y, _camWant.z);
          // Acercarse al instante (no atravesar), alejarse con suavidad.
          camReach.current = reach < camReach.current ? reach : camReach.current + (reach - camReach.current) * Math.min(1, dt * 3);
          cam.position.lerpVectors(_camTarget, _camWant, camReach.current);
          cam.lookAt(_camTarget);
        }
        // Al recibir un golpe, la cámara lo acusa un instante (people/selfPeople.ts).
        if (camKick.t < 0.3) {
          const k = (1 - camKick.t / 0.3) ** 2;
          cam.position.x += camKick.x * k;
          cam.position.y += camKick.y * k;
          cam.position.z += camKick.z * k;
        }
        }
      } else {
        // Detrás del panel 2D: paseo lento de cámara por dentro de la plaza, alrededor de la fuente.
        const t = state.clock.elapsedTime * 0.035 + 0.6;
        const c = CHUNK_SIZE / 2;
        cam.position.set(c + Math.sin(t) * 14, 4.2 + Math.sin(t * 0.7) * 0.8, 30 + Math.cos(t) * 14);
        cam.lookAt(c - Math.cos(t) * 4, 5.5, 30 + Math.sin(t) * 4);
      }

      const dy = body.y - visY.current;
      if (body.grounded && Math.abs(dy) < STEP_UP + 0.1) visY.current += dy * Math.min(1, dt * 16);
      else visY.current = body.y;
      if (mode === "seated" || mode === "drive") {
        // Sentado en el coche (o subiendo y bajando): va con él, con su inclinación.
        avatar.current.position.copy(seated.pos);
        avatar.current.quaternion.copy(seated.q);
        visY.current = body.y;
      } else if (!_pf.drawn) {
        // Con parkour, el cuerpo entero se inclina (correr por la pared) y los pies van contra ella.
        avatar.current.position.set(body.x + pk.ox, visY.current + pkLift.current, body.z + pk.oz);
        avatar.current.rotation.set(pk.pitch, bodyYaw.current, -pk.lean, "YXZ");
      }
      playerPos.set(body.x, body.y, body.z);
      self.x = body.x;
      self.y = body.y;
      self.z = body.z;
      self.yaw = bodyYaw.current;
      self.vx = body.vx;
      self.vz = body.vz;
      self.emote = motion.emote;
      self.driving = mode === "drive" || mode === "seated";
      self.fight = !!motion.fight;
      if (mode === "drive") self.wx = self.wz = 0;
      // En primera persona no se dibuja el propio cuerpo (taparía la vista); en coche, tampoco.
      avatar.current.visible = active && !view.firstPerson;

      if (mode === "seated" || mode === "drive") {
        // Los pies (más la altura de los ojos) donde está sentado; el coche va aparte (`car`).
        _headP.set(seated.pos.x, seated.pos.y + EYE, seated.pos.z);
        _headQ.setFromEuler(_euler.set(0, _yawE.setFromQuaternion(seated.q, "YXZ").y, 0));
      } else {
        _headP.set(body.x, EYE + body.y, body.z);
        _headQ.setFromEuler(_euler.set(l.pitch, bodyYaw.current, 0));
      }
    }

    // Envío de pose: 8 Hz solo si hay cambio real, latido cada segundo. Detrás del panel no se envía.
    if ((!active && !inXR) || world.status !== "open" || !world.sessionId || world.solo) return;
    const now = performance.now();
    if (now - lastSend.current < SEND_EVERY_MS) return;
    // Lo que se ve de la persona: el parkour que esté haciendo, o su gesto.
    const shown = motion.pk ?? motion.emote;
    const moved = _headP.distanceToSquared(_lastP) > 1e-4 || _headQ.angleTo(_lastQ) > 0.01 || shown !== lastEmote.current || drive.phase !== lastPhase.current;
    if (!moved && now - lastSend.current < HEARTBEAT_MS) return;
    lastSend.current = now;
    _lastP.copy(_headP);
    _lastQ.copy(_headQ);
    lastEmote.current = shown;
    lastPhase.current = drive.phase;
    net.send(
      msg("POSE", {
        t: world.serverNow(),
        head: { p: [_headP.x, _headP.y, _headP.z], r: [_headQ.x, _headQ.y, _headQ.z, _headQ.w] },
        ...(shown ? { emote: shown } : {}),
        ...carForPose(),
      }) as ClientMessage,
    );
  });

  return (
    <>
      <XROrigin ref={origin}>{inXR && <VRMenu />}</XROrigin>
      {driving.phase !== "none" && (
        <Suspense fallback={null}>
          <CarModel handle={carHandle} paint={paintFor(user?.player_no != null ? `n${user.player_no}` : (world.sessionId ?? "local"))} />
        </Suspense>
      )}
      <group ref={avatar}>
        <AvatarBody avatar={myAvatar} seed={world.sessionId ?? "local"} motion={motion} />
        <Suspense fallback={null}>
          <ChatBubble self />
        </Suspense>
      </group>
    </>
  );
}
