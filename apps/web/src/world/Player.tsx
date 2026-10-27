import { Suspense, useRef } from "react";
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
import { cameraReach, findSeat, resolveCircle } from "./collision";
import { BODY_HEIGHT, STEP_UP, createBody, placeBody, requestJump, stepBody } from "./locomotion";
import { useChosenPreset } from "./presets";
import { input, setFirstPerson, view } from "./input";
import { self } from "./self";
import { controls } from "../controls";

const WALK = 2.1; // m/s
const RUN = 5.4;
const EYE = 1.6;
/** Distancia de la cámara en tercera persona: por defecto, mínima y máxima (rueda o pellizco). */
const CAM_DIST = 3.4;
const CAM_MIN = 1.3;
const CAM_MAX = 9;
/** Gestos que terminan solos (segundos); los demás duran hasta que te mueves. */
const EMOTE_SECONDS: Record<string, number> = { wave: 2.6, cheer: 1.5 };
const SEND_EVERY_MS = 125; // 8 Hz: el movimiento se suaviza al otro lado (interpolación)
const HEARTBEAT_MS = 1000;
/** Dónde está el jugador ahora (lo leen los portales; se copia cada frame, sin crear objetos). */
export const playerPos = new THREE.Vector3(...spawn.p);

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
const _xr = { x: 0, z: 0 };

export function Player({ active }: { active: boolean }) {
  const user = useAccount();
  const chosen = useChosenPreset();
  const myAvatar: AvatarRef | undefined = user?.avatar_hash
    ? { hash: user.avatar_hash, format: user.avatar_format ?? "glb" }
    : chosen
      ? { hash: chosen.hash, format: "vrm" }
      : undefined;
  const origin = useRef<THREE.Group>(null!);
  const avatar = useRef<THREE.Group>(null!);
  const body = useRef(createBody(...spawn.p)).current;
  const look = useRef({ yaw: spawn.yaw, pitch: -0.12 });
  const spawnSeq = useRef(spawn.seq);
  const motion = useRef(createMotion()).current;
  const lastSend = useRef(0);
  const camReach = useRef(1);
  const cam3 = useRef({ dist: CAM_DIST, y: spawn.p[1] });
  const bodyYaw = useRef(0);
  const emoteUntil = useRef(0);
  const lastEmote = useRef<string | null>(null);
  const inXR = useXR((s) => s.session != null);

  // En VR: joystick izquierdo para moverse, derecho para girar (giro por pasos, menos mareo).
  useXRControllerLocomotion(origin, { speed: 3 }, { type: "snap", degrees: 30 });

  useFrame((state, dt) => {
    const cam = state.camera;
    const l = look.current;

    // Aparecer donde manda un portal (o el nexo 2D).
    if (spawn.seq !== spawnSeq.current) {
      spawnSeq.current = spawn.seq;
      placeBody(body, spawn.p[0], spawn.p[1], spawn.p[2]);
      cam3.current.y = spawn.p[1];
      l.yaw = spawn.yaw;
      bodyYaw.current = spawn.yaw;
      motion.emote = null;
      if (inXR) origin.current.position.set(spawn.p[0], 0, spawn.p[2]);
    }

    if (inXR) {
      cam.getWorldPosition(_headP);
      cam.getWorldQuaternion(_headQ);
      // Las paredes también cuentan en VR: si la cabeza se mete en una, el mundo la saca.
      _xr.x = _headP.x;
      _xr.z = _headP.z;
      resolveCircle(_xr, 0.25, STEP_UP, BODY_HEIGHT);
      if (_xr.x !== _headP.x || _xr.z !== _headP.z) {
        origin.current.position.x += _xr.x - _headP.x;
        origin.current.position.z += _xr.z - _headP.z;
        _headP.x = _xr.x;
        _headP.z = _xr.z;
      }
      body.x = _headP.x;
      body.y = 0;
      body.z = _headP.z;
      playerPos.set(body.x, 0, body.z);
      self.x = body.x;
      self.y = 0;
      self.z = body.z;
    } else {
      // Mantén el origen XR donde está el jugador, para entrar en VR en el mismo sitio.
      origin.current.position.set(body.x, body.y, body.z);
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

        _fwd.set(-Math.sin(l.yaw), 0, -Math.cos(l.yaw));
        _right.set(-_fwd.z, 0, _fwd.x);
        const amount = Math.min(1, Math.hypot(input.move.x, input.move.y));
        // En móvil, el joystick a tope también corre.
        const speed = input.run || (controls.autoRun && amount > 0.92) ? RUN : WALK;
        const wantX = (_fwd.x * input.move.y + _right.x * input.move.x) * speed;
        const wantZ = (_fwd.z * input.move.y + _right.z * input.move.x) * speed;

        if (input.jump) {
          requestJump(body);
          motion.emote = null; // saltar también levanta del banco
          input.jump = false;
        }
        // Sentado no hay físicas: el banco es una caja y nos subiría encima.
        // En el nexo (en solitario) se camina más allá del chunk: por las pasarelas hasta las islas.
        // Mientras se viaja (aún sin WELCOME ni suelo del lugar nuevo) el cuerpo espera quieto: si
        // diera pasos, los límites y el suelo del lugar anterior lo dejarían fuera de lo caminable.
        if (motion.emote !== "sit" && world.status === "open") stepBody(body, wantX, wantZ, dt, world.walk[0], world.walk[1]);
        smoothSpeed(motion, Math.hypot(body.vx, body.vz), dt);
        motion.airborne = !body.grounded;

        // El cuerpo gira hacia donde camina (la cámara puede mirar a otro lado); en primera
        // persona, hacia donde miras.
        if (fp) bodyYaw.current = l.yaw;
        else if (amount > 0.05) {
          const want = Math.atan2(-wantX, -wantZ);
          let d = want - bodyYaw.current;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          bodyYaw.current += d * Math.min(1, dt * 10);
        }

        // Gestos: se piden con el teclado (1-4) o el HUD; moverse los cancela.
        if (input.emote) {
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
        if (motion.emote && (amount > 0.05 || motion.airborne || state.clock.elapsedTime > emoteUntil.current)) motion.emote = null;

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
      } else {
        // Detrás del panel 2D: paseo lento de cámara por dentro de la plaza, alrededor de la fuente.
        const t = state.clock.elapsedTime * 0.035 + 0.6;
        const c = CHUNK_SIZE / 2;
        cam.position.set(c + Math.sin(t) * 14, 4.2 + Math.sin(t * 0.7) * 0.8, 30 + Math.cos(t) * 14);
        cam.lookAt(c - Math.cos(t) * 4, 5.5, 30 + Math.sin(t) * 4);
      }

      avatar.current.position.set(body.x, body.y, body.z);
      avatar.current.rotation.y = bodyYaw.current;
      playerPos.set(body.x, body.y, body.z);
      self.x = body.x;
      self.y = body.y;
      self.z = body.z;
      // En primera persona no se dibuja el propio cuerpo (taparía la vista).
      avatar.current.visible = active && !view.firstPerson;

      _headP.set(body.x, EYE + body.y, body.z);
      _headQ.setFromEuler(_euler.set(l.pitch, bodyYaw.current, 0));
    }

    // Envío de pose: 8 Hz solo si hay cambio real, latido cada segundo. Detrás del panel no se envía.
    if ((!active && !inXR) || world.status !== "open" || !world.sessionId || world.solo) return;
    const now = performance.now();
    if (now - lastSend.current < SEND_EVERY_MS) return;
    const moved = _headP.distanceToSquared(_lastP) > 1e-4 || _headQ.angleTo(_lastQ) > 0.01 || motion.emote !== lastEmote.current;
    if (!moved && now - lastSend.current < HEARTBEAT_MS) return;
    lastSend.current = now;
    _lastP.copy(_headP);
    _lastQ.copy(_headQ);
    lastEmote.current = motion.emote;
    net.send(
      msg("POSE", {
        t: world.serverNow(),
        head: { p: [_headP.x, _headP.y, _headP.z], r: [_headQ.x, _headQ.y, _headQ.z, _headQ.w] },
        ...(motion.emote ? { emote: motion.emote } : {}),
      }) as ClientMessage,
    );
  });

  return (
    <>
      <XROrigin ref={origin} />
      <group ref={avatar}>
        <AvatarBody avatar={myAvatar} seed={world.sessionId ?? "local"} motion={motion} />
        <Suspense fallback={null}>
          <ChatBubble self />
        </Suspense>
      </group>
    </>
  );
}
