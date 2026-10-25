import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { XROrigin, useXR, useXRControllerLocomotion } from "@react-three/xr";
import * as THREE from "three";
import { CHUNK_SIZE, msg, type ClientMessage } from "@xenxo/protocol";
import { net } from "../net/session";
import { world } from "../net/world-store";
import type { AvatarRef } from "@xenxo/protocol";
import { useAccount } from "../net/account";
import { AvatarBody } from "./Avatars";
import { input } from "./input";

const SPEED = 4.5; // m/s
const EYE = 1.6;
const SEND_EVERY_MS = 100; // 10 Hz
const HEARTBEAT_MS = 1000;
export const SPAWN = new THREE.Vector3(CHUNK_SIZE / 2, 0, CHUNK_SIZE / 2 + 11);

// Objetos reutilizados: nada de `new` dentro de useFrame (evita tirones del GC en Quest).
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _headP = new THREE.Vector3();
const _headQ = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _lastP = new THREE.Vector3(Infinity, 0, 0);
const _lastQ = new THREE.Quaternion();

export function Player({ active }: { active: boolean }) {
  const user = useAccount();
  const myAvatar: AvatarRef | undefined = user?.avatar_hash
    ? { hash: user.avatar_hash, format: user.avatar_format ?? "glb" }
    : undefined;
  const origin = useRef<THREE.Group>(null!);
  const avatar = useRef<THREE.Group>(null!);
  const pos = useRef(SPAWN.clone());
  const look = useRef({ yaw: 0, pitch: -0.12 });
  const lastSend = useRef(0);
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
        const step = SPEED * Math.min(dt, 0.05);
        pos.current.addScaledVector(_fwd, input.move.y * step).addScaledVector(_right, input.move.x * step);
        pos.current.x = THREE.MathUtils.clamp(pos.current.x, 1, CHUNK_SIZE - 1);
        pos.current.z = THREE.MathUtils.clamp(pos.current.z, 1, CHUNK_SIZE - 1);

        // Cámara en tercera persona detrás del avatar.
        _camTarget.set(pos.current.x, EYE, pos.current.z);
        cam.position.set(
          _camTarget.x + Math.sin(l.yaw) * 4.5 * Math.cos(l.pitch),
          _camTarget.y + 1.2 - Math.sin(l.pitch) * 4.5,
          _camTarget.z + Math.cos(l.yaw) * 4.5 * Math.cos(l.pitch),
        );
        cam.lookAt(_camTarget);
      } else {
        // Detrás del panel 2D: órbita lenta y tranquila alrededor de la plaza.
        const t = state.clock.elapsedTime * 0.05;
        const c = CHUNK_SIZE / 2;
        cam.position.set(c + Math.sin(t) * 34, 14, c + Math.cos(t) * 34);
        cam.lookAt(c, 5, c);
      }

      avatar.current.position.copy(pos.current);
      avatar.current.rotation.y = l.yaw;
      avatar.current.visible = active;

      _headP.set(pos.current.x, EYE, pos.current.z);
      _headQ.setFromEuler(_euler.set(l.pitch, l.yaw, 0));
    }

    // Envío de pose: 10 Hz solo si hay cambio real, latido cada segundo. Detrás del panel no se envía.
    if ((!active && !inXR) || world.status !== "open" || !world.sessionId) return;
    const now = performance.now();
    if (now - lastSend.current < SEND_EVERY_MS) return;
    const moved = _headP.distanceToSquared(_lastP) > 1e-4 || _headQ.angleTo(_lastQ) > 0.01;
    if (!moved && now - lastSend.current < HEARTBEAT_MS) return;
    lastSend.current = now;
    _lastP.copy(_headP);
    _lastQ.copy(_headQ);
    net.send(
      msg("POSE", {
        t: world.serverNow(),
        head: { p: [_headP.x, _headP.y, _headP.z], r: [_headQ.x, _headQ.y, _headQ.z, _headQ.w] },
      }) as ClientMessage,
    );
  });

  return (
    <>
      <XROrigin ref={origin} />
      <group ref={avatar}>
        <AvatarBody avatar={myAvatar} color="#f6f1e7" />
      </group>
    </>
  );
}
