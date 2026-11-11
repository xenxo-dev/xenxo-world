import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { XROrigin, useXR, useXRControllerLocomotion } from "@react-three/xr";
import * as THREE from "three";
import { CHUNK_SIZE, isWeaponId, msg, type ClientMessage } from "@xenxo/protocol";
import { net, spawn } from "../net/session";
import { world } from "../net/world-store";
import type { AvatarRef } from "@xenxo/protocol";
import { useAccount } from "../net/account";
import { AvatarBody, ChatBubble } from "./Avatars";
import { createMotion, smoothSpeed, type Motion } from "./motion";
import { cameraReach, findSeat } from "./collision";
import { boost, poseFlush } from "../net/activity-store";
import { STEP_UP, createBody, moveScale, placeBody, requestJump, stepBody } from "./locomotion";
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
import { fighterNear } from "../net/people";
import { PoseSender, SEND_EVERY_MS, SEND_TIGHT_MS, TIGHT_RANGE_M } from "../net/pose-send";
import { preloadParkour, UPPER_EMOTES } from "./animation";
import { createParkour, parkourStep, resetParkour } from "./parkour/moves";
import { gun, gunFrame, resetGun, SELF_GUN } from "./people/guns";
import { HeldWeapon } from "./people/HeldWeapon";
import { cineCamera } from "./cine/camera";
import { cine } from "./cine/state";

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
/** Cuándo se manda la pose (net/pose-send.ts): 5 Hz en marcha, lo que da el plan gratuito. */
const sender = new PoseSender();
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
/** El gesto, la fase del coche y el arma de la última pose enviada (cambiarlos también es moverse). */
let lastEmote: string | null = null;
let lastPhase = "none";
let lastWeapon: string | null = null;

/** Manda la pose de ahora (la cabeza de este frame, el gesto, el arma y el coche) y apunta lo mandado. */
function sendPose(now: number, motion: Motion) {
  // Lo que se ve de la persona: el parkour que esté haciendo, o su gesto.
  const shown = motion.pk ?? motion.emote;
  const held = motion.weapon ?? null;
  _lastP.copy(_headP);
  _lastQ.copy(_headQ);
  lastEmote = shown;
  lastPhase = drive.phase;
  lastWeapon = held;
  net.send(
    msg("POSE", {
      // La hora de este equipo en que se tomó (el servidor solo usa las diferencias): con ella
      // los demás ven el movimiento a velocidad uniforme aunque la red la entregue a rachas.
      t: Math.round(now),
      head: { p: [_headP.x, _headP.y, _headP.z], r: [_headQ.x, _headQ.y, _headQ.z, _headQ.w] },
      ...(shown ? { emote: shown } : {}),
      ...(held && isWeaponId(held) ? { weapon: held } : {}),
      ...carForPose(),
    }) as ClientMessage,
  );
}
const _yawE = new THREE.Euler();
const _carQ = new THREE.Quaternion();
const _seat = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _rigAt = new THREE.Vector3();
const _rigCam = new THREE.Vector3();
/** Al volante: cuánto va la cámara con el coche (0 = con el mundo; 1 = en el looping) y hacia dónde se mira respecto a él. */
let carTilt = 0;
let carRel = Math.PI;
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
  const camReach = useRef(1);
  const cam3 = useRef({ dist: CAM_DIST, y: spawn.p[1] });
  /** Altura a la que se dibuja el cuerpo: sube y baja los escalones con suavidad (la física salta). */
  const visY = useRef(spawn.p[1]);
  // Al llegar por un enlace directo (/d/<distrito>/<sitio>) ya se sabe hacia dónde se mira.
  const bodyYaw = useRef(spawn.yaw);
  const emoteUntil = useRef(0);
  const inXR = useXR((s) => s.session != null);
  const driving = useDrive();
  const carHandle = useRef(createCarHandle()).current;
  const seqCtx = useRef({ body, motion, bodyYaw }).current;
  // Justo antes de avisar al servidor de «estoy aquí» (un punto de carrera, algo que se recoge) sale
  // la pose de ahora, fuera de su turno: en coche, la de hace 200 ms está a seis metros.
  useEffect(() => {
    poseFlush.now = () => {
      if (world.status !== "open" || !world.sessionId || world.solo) return;
      const now = performance.now();
      if (sender.force(now)) sendPose(now, motion);
    };
    return () => {
      poseFlush.now = null;
    };
  }, [motion]);
  const peopleCtx = useRef({ body, motion, bodyYaw, avatar: null as unknown as THREE.Group }).current;
  const gunCtx = useRef({ body, motion, bodyYaw, look: look.current }).current;

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
    // En el looping (el suelo del coche deja de mirar hacia abajo) la cámara va con el coche: detrás
    // y encima suyos y con su horizonte, como en una montaña rusa. Con la cámara de siempre, arriba
    // del todo quedaba por encima de la pista, mirando el distrito, y el coche ni se veía.
    // (Solo rodando: volcado en el suelo o cayendo por el aire, la de siempre.)
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const rolling = (drive.sim?.state.contacts ?? 0) >= 2;
    carTilt += ((!rolling || upY > 0.86 ? 0 : upY < 0.55 ? 1 : (0.86 - upY) / 0.31) - carTilt) * Math.min(1, dt * 6);
    if (carTilt < 0.02) {
      if (Math.abs(speed) > 1.5) {
        let d = carYaw + Math.PI - l.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        l.yaw += d * Math.min(1, dt * 2.4);
      }
      // Hacia dónde se mira respecto al coche (π = desde detrás), para cuando se incline.
      carRel = l.yaw - carYaw;
    } else {
      // Inclinado, su rumbo de brújula no dice nada (del revés se da la vuelta): se mira respecto a él.
      carRel += Math.atan2(Math.sin(Math.PI - carRel), Math.cos(Math.PI - carRel)) * Math.min(1, dt * 2.4);
      l.yaw = carYaw + carRel;
    }
    playerLook.yaw = l.yaw;
    if (view.firstPerson) {
      _seat.copy(DRIVER_EYE).applyQuaternion(q).add(carPose.p);
      cam.position.copy(_seat);
      _carQ.setFromEuler(_euler.set(l.pitch, carRel, 0));
      cam.quaternion.copy(q).multiply(_carQ);
      return;
    }
    const dist = Math.max(4.2, c3.dist * 1.75);
    const cp = Math.cos(l.pitch), sp = Math.sin(l.pitch);
    _camTarget.set(carPose.p.x, ground + 1.7, carPose.p.z);
    _camWant.set(_camTarget.x + Math.sin(l.yaw) * dist * cp, _camTarget.y + 0.9 - sp * dist, _camTarget.z + Math.cos(l.yaw) * dist * cp);
    _camUp.set(0, 1, 0);
    if (carTilt > 0.001) {
      // Lo mismo, en los ejes del coche (algo más cerca y más alto: dentro del looping, la pista se
      // curva hacia la cámara por detrás).
      const d = Math.min(dist, 5);
      _rigAt.set(0, 1.25, 0.4).applyQuaternion(q).add(carPose.p);
      _rigCam.set(Math.sin(carRel) * d * cp, 2.4 - sp * d, Math.cos(carRel) * d * cp).applyQuaternion(q).add(_rigAt);
      _camTarget.lerp(_rigAt, carTilt);
      _camWant.lerp(_rigCam, carTilt);
      _camUp.lerp(_rigAt.set(0, 1, 0).applyQuaternion(q), carTilt).normalize();
    }
    // (Dentro del looping la cámara va por su hueco: no hay pared que se interponga, y la propia
    // pista, que se curva por detrás, la acercaba de golpe.)
    const reach = Math.max(carTilt, cameraReach(_camTarget.x, _camTarget.y, _camTarget.z, _camWant.x, _camWant.y, _camWant.z));
    camReach.current = reach < camReach.current ? reach : camReach.current + (reach - camReach.current) * Math.min(1, dt * 3);
    cam.position.lerpVectors(_camTarget, _camWant, camReach.current);
    // Con su horizonte solo para este cálculo: el resto de cámaras cuentan con el de siempre.
    cam.up.copy(_camUp);
    cam.lookAt(_camTarget);
    cam.up.set(0, 1, 0);
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
    /** ¿Lleva la cámara este frame un plano del modo cine? (world/cine) */
    let cineCam = false;
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
      resetGun(motion);
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
      // En las gafas no hay armas.
      if (gun.drawn) resetGun(motion);
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
        // En diagonal no se corre más (locomotion.ts → moveScale).
        const unit = moveScale(input.move.x, input.move.y);
        let wantX = (_fwd.x * input.move.y + _right.x * input.move.x) * unit * speed;
        let wantZ = (_fwd.z * input.move.y + _right.z * input.move.x) * unit * speed;

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
        // Armas (Distrito Cero, en el modo pelea): disparar con Z o el botón, cambiar con T
        // (people/guns.ts). Sacada, las manos apuntan y el cuerpo mira hacia donde apuntas.
        gunCtx.look = l;
        gunFrame(dt, gunCtx, free && !_pf.lock && !sliding());
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
        else if (gun.drawn) {
          // Con el arma sacada, de cara a donde apuntas (aunque se ande hacia otro lado).
          let d = gun.yaw - bodyYaw.current;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          bodyYaw.current += d * Math.min(1, dt * 14);
        } else if (amount > 0.05) {
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
        // Modo cine: la cámara del plano (órbita, grúa, trípode, travelling) manda sobre la de siempre.
        cineCam = cineCamera(cam as THREE.PerspectiveCamera, body.x, c3.y, body.z, l.yaw, state.clock.elapsedTime);
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
      // En primera persona no se dibuja el propio cuerpo (taparía la vista); en coche, tampoco. Con
      // una cámara de cine se ve desde fuera (salvo que el plano sea sin personaje).
      avatar.current.visible = active && (cine.on ? !cine.hideSelf && (cineCam || !view.firstPerson) : !view.firstPerson);

      if (mode === "seated" || mode === "drive") {
        // Los pies (más la altura de los ojos) donde está sentado; el coche va aparte (`car`).
        _headP.set(seated.pos.x, seated.pos.y + EYE, seated.pos.z);
        _headQ.setFromEuler(_euler.set(0, _yawE.setFromQuaternion(seated.q, "YXZ").y, 0));
      } else {
        _headP.set(body.x, EYE + body.y, body.z);
        _headQ.setFromEuler(_euler.set(l.pitch, bodyYaw.current, 0));
      }
    }

    // Envío de pose: solo si hay cambio real, y un latido cada segundo. Detrás del panel no se envía.
    if ((!active && !inXR) || world.status !== "open" || !world.sessionId || world.solo) return;
    const now = performance.now();
    const acted = (motion.pk ?? motion.emote) !== lastEmote || drive.phase !== lastPhase || (motion.weapon ?? null) !== lastWeapon;
    const moved = _headP.distanceToSquared(_lastP) > 1e-4 || _headQ.angleTo(_lastQ) > 0.01;
    if (!sender.due(now, moved, acted, people.fightOn && fighterNear(TIGHT_RANGE_M) ? SEND_TIGHT_MS : SEND_EVERY_MS)) return;
    sendPose(now, motion);
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
        <HeldWeapon motion={motion} who={SELF_GUN} />
        <Suspense fallback={null}>
          <ChatBubble self />
        </Suspense>
      </group>
    </>
  );
}
