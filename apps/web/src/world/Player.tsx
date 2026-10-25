import { Suspense, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { XROrigin, useXR, useXRControllerLocomotion } from "@react-three/xr";
import * as THREE from "three";
import { CHUNK_SIZE, msg, type ClientMessage } from "@xenxo/protocol";
import { net } from "../net/session";
import { world } from "../net/world-store";
import type { AvatarRef } from "@xenxo/protocol";
import { useAccount } from "../net/account";
import { AvatarBody, ChatBubble } from "./Avatars";
import { createMotion, smoothSpeed } from "./motion";
import { cameraReach, findSeat, resolveCircle } from "./collision";
import { useChosenPreset } from "./presets";
import { input } from "./input";

const WALK = 2.1; // m/s
const RUN = 5.4;
const JUMP_V = 4.6; // m/s hacia arriba
const GRAVITY = 13;
const EYE = 1.6;
const CAM_DIST = 3.4;
/** Gestos que terminan solos (segundos); los demás duran hasta que te mueves. */
const EMOTE_SECONDS: Record<string, number> = { wave: 2.6, cheer: 1.5 };
const SEND_EVERY_MS = 100; // 10 Hz
const HEARTBEAT_MS = 1000;
export const SPAWN = new THREE.Vector3(CHUNK_SIZE / 2, 0, CHUNK_SIZE / 2 + 11);

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
  const pos = useRef(SPAWN.clone());
  const look = useRef({ yaw: 0, pitch: -0.12 });
  const motion = useRef(createMotion()).current;
  const lastSend = useRef(0);
  const camReach = useRef(1);
  const bodyYaw = useRef(0);
  const vy = useRef(0);
  const emoteUntil = useRef(0);
  const lastEmote = useRef<string | null>(null);
  const inXR = useXR((s) => s.session != null);

  // En VR: joystick izquierdo para moverse, derecho para girar (giro por pasos, menos mareo).
  useXRControllerLocomotion(origin, { speed: 3 }, { type: "snap", degrees: 30 });

  useFrame((state, dt) => {
    const cam = state.camera;
    const l = look.current;

    if (inXR) {
      cam.getWorldPosition(_headP);
      cam.getWorldQuaternion(_headQ);
      pos.current.set(_headP.x, 0, _headP.z);
    } else {
      // Mantén el origen XR donde está el jugador, para entrar en VR en el mismo sitio.
      origin.current.position.copy(pos.current);

      if (active) {
        l.yaw += input.yawDelta;
        l.pitch = THREE.MathUtils.clamp(l.pitch + input.pitchDelta, -0.9, 0.5);
        input.yawDelta = 0;
        input.pitchDelta = 0;

        _fwd.set(-Math.sin(l.yaw), 0, -Math.cos(l.yaw));
        _right.set(-_fwd.z, 0, _fwd.x);
        const amount = Math.min(1, Math.hypot(input.move.x, input.move.y));
        // En móvil, el joystick a tope también corre.
        const speed = input.run || amount > 0.92 ? RUN : WALK;
        const step = speed * Math.min(dt, 0.05);
        smoothSpeed(motion, amount * speed, dt);
        pos.current.addScaledVector(_fwd, input.move.y * step).addScaledVector(_right, input.move.x * step);
        if (motion.emote !== "sit") resolveCircle(pos.current, 0.32, 0.05 + pos.current.y, 1.8 + pos.current.y);
        pos.current.x = THREE.MathUtils.clamp(pos.current.x, 1, CHUNK_SIZE - 1);
        pos.current.z = THREE.MathUtils.clamp(pos.current.z, 1, CHUNK_SIZE - 1);

        // El cuerpo gira hacia donde camina (la cámara puede mirar a otro lado).
        if (amount > 0.05) {
          const want = Math.atan2(-(input.move.y * _fwd.x + input.move.x * _right.x), -(input.move.y * _fwd.z + input.move.x * _right.z));
          let d = want - bodyYaw.current;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          bodyYaw.current += d * Math.min(1, dt * 10);
        }

        // Salto
        if (input.jump && pos.current.y <= 0.001) vy.current = JUMP_V;
        input.jump = false;
        if (pos.current.y > 0 || vy.current > 0) {
          vy.current -= GRAVITY * dt;
          pos.current.y = Math.max(0, pos.current.y + vy.current * dt);
          if (pos.current.y === 0) vy.current = 0;
        }
        motion.airborne = pos.current.y > 0.05;

        // Gestos: se piden con el teclado (1-4) o el HUD; moverse los cancela.
        if (input.emote) {
          let emote = input.emote;
          if (emote === "sit") {
            // Sentarse en el banco más cercano; sin banco, en cuclillas.
            const seat = findSeat(pos.current.x, pos.current.z);
            if (seat) {
              pos.current.x = seat.x;
              pos.current.z = seat.z;
              bodyYaw.current = seat.yaw + Math.PI;
            } else emote = "crouch";
          }
          motion.emote = emote;
          emoteUntil.current = state.clock.elapsedTime + (EMOTE_SECONDS[emote] ?? Infinity);
          input.emote = null;
        }
        if (motion.emote && (amount > 0.05 || motion.airborne || state.clock.elapsedTime > emoteUntil.current)) motion.emote = null;

        // Cámara en tercera persona detrás del avatar; se acerca si una pared se interpone.
        // Cámara cercana, a la altura del hombro: se ve el personaje y la plaza a la vez.
        _camTarget.set(pos.current.x, 1.45 + pos.current.y * 0.5, pos.current.z);
        _camWant.set(
          _camTarget.x + Math.sin(l.yaw) * CAM_DIST * Math.cos(l.pitch),
          _camTarget.y + 0.55 - Math.sin(l.pitch) * CAM_DIST,
          _camTarget.z + Math.cos(l.yaw) * CAM_DIST * Math.cos(l.pitch),
        );
        const reach = cameraReach(_camTarget.x, _camTarget.y, _camTarget.z, _camWant.x, _camWant.y, _camWant.z);
        // Acercarse al instante (no atravesar), alejarse con suavidad.
        camReach.current = reach < camReach.current ? reach : camReach.current + (reach - camReach.current) * Math.min(1, dt * 3);
        cam.position.lerpVectors(_camTarget, _camWant, camReach.current);
        cam.lookAt(_camTarget);
      } else {
        // Detrás del panel 2D: paseo lento de cámara por dentro de la plaza, alrededor de la fuente.
        const t = state.clock.elapsedTime * 0.035 + 0.6;
        const c = CHUNK_SIZE / 2;
        cam.position.set(c + Math.sin(t) * 14, 4.2 + Math.sin(t * 0.7) * 0.8, 30 + Math.cos(t) * 14);
        cam.lookAt(c - Math.cos(t) * 4, 5.5, 30 + Math.sin(t) * 4);
      }

      avatar.current.position.copy(pos.current);
      avatar.current.rotation.y = bodyYaw.current;
      avatar.current.visible = active;

      _headP.set(pos.current.x, EYE + pos.current.y, pos.current.z);
      _headQ.setFromEuler(_euler.set(l.pitch, bodyYaw.current, 0));
    }

    // Envío de pose: 10 Hz solo si hay cambio real, latido cada segundo. Detrás del panel no se envía.
    if ((!active && !inXR) || world.status !== "open" || !world.sessionId) return;
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
