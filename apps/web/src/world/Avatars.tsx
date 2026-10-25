import { Suspense, useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import type { AvatarRef } from "@xenxo/protocol";
import { assetUrl } from "../config";
import { t } from "../i18n";
import { BUBBLE_MS, chat, useChatVersion, useWorldVersion, world } from "../net/world-store";
import { walkAmount } from "./avatar-model";
import { CustomAvatar } from "./CustomAvatar";
import { FONT_URL } from "./font";
import { advance, createMotion, smoothSpeed, type Motion } from "./motion";

/** Retraso de interpolación: mostramos a los demás ~100 ms en el pasado, entre dos poses reales. */
const INTERP_DELAY_MS = 100;
export const EYE_HEIGHT = 1.6;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _e = new THREE.Euler();

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
        <mesh position={[0, -0.41, 0]}>
          <capsuleGeometry args={[0.1, 0.62, 3, 8]} />
          <meshLambertMaterial color="#5a4a3f" />
        </mesh>
      </group>
      <group ref={legR} position={[0.12, 0.82, 0]}>
        <mesh position={[0, -0.41, 0]}>
          <capsuleGeometry args={[0.1, 0.62, 3, 8]} />
          <meshLambertMaterial color="#5a4a3f" />
        </mesh>
      </group>
      {/* Torso */}
      <mesh position={[0, 1.12, 0]}>
        <capsuleGeometry args={[0.24, 0.42, 4, 12]} />
        <meshLambertMaterial color={color} />
      </mesh>
      {/* Brazos: el pivote está en el hombro */}
      <group ref={armL} position={[-0.33, 1.36, 0]}>
        <mesh position={[0, -0.3, 0]}>
          <capsuleGeometry args={[0.075, 0.48, 3, 8]} />
          <meshLambertMaterial color={color} />
        </mesh>
      </group>
      <group ref={armR} position={[0.33, 1.36, 0]}>
        <mesh position={[0, -0.3, 0]}>
          <capsuleGeometry args={[0.075, 0.48, 3, 8]} />
          <meshLambertMaterial color={color} />
        </mesh>
      </group>
      {/* Cabeza con visor de azulejo */}
      <mesh position={[0, EYE_HEIGHT, 0]}>
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

/** Personaje de alguien: el suyo propio si lo tiene, si no el de por defecto. Avanza el ciclo de paso. */
export function AvatarBody({ avatar, color, motion }: { avatar?: AvatarRef; color: THREE.ColorRepresentation; motion: Motion }) {
  useFrame((_, dt) => advance(motion, Math.min(dt, 0.1)));
  const fallback = <DefaultAvatar color={color} motion={motion} />;
  return <CustomAvatar url={avatar ? assetUrl(avatar.hash) : null} fallback={fallback} motion={motion} />;
}

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
      <Text
        font={FONT_URL}
        fontSize={0.17}
        maxWidth={2.4}
        textAlign="center"
        anchorY="bottom"
        color="#2a211c"
        outlineWidth={0.05}
        outlineColor="#f6f1e7"
        lineHeight={1.25}
      >
        {text}
      </Text>
    </Billboard>
  );
}

function RemoteAvatar({ sessionId, name, avatar }: { sessionId: string; name: string; avatar?: AvatarRef }) {
  const body = useRef<THREE.Group>(null);
  const color = useRef(colorFor(sessionId)).current;
  const motion = useRef(createMotion()).current;
  const last = useRef(new THREE.Vector3(NaN, 0, 0)).current;

  useFrame((_, dt) => {
    const buf = world.poseBuffers.get(sessionId);
    if (!buf || buf.length === 0 || !body.current) return;
    const rt = world.serverNow() - INTERP_DELAY_MS;

    let i = buf.length - 1;
    while (i > 0 && buf[i - 1]!.t > rt) i--;
    const s1 = buf[i]!;
    const s0 = buf[Math.max(0, i - 1)]!;
    const span = s1.t - s0.t;
    const k = span > 0 ? THREE.MathUtils.clamp((rt - s0.t) / span, 0, 1) : 1;

    _a.fromArray(s0.head.p).lerp(_b.fromArray(s1.head.p), k);
    _qa.fromArray(s0.head.r).slerp(_qb.fromArray(s1.head.r), k);

    // Velocidad horizontal medida entre frames, suavizada: de ella sale el paso.
    const step = Number.isNaN(last.x) ? 0 : Math.hypot(_a.x - last.x, _a.z - last.z);
    last.copy(_a);
    if (dt > 0) smoothSpeed(motion, step / dt, dt);

    // Pies bajo la cabeza; el cuerpo solo sigue el giro horizontal.
    body.current.position.set(_a.x, Math.max(0, _a.y - EYE_HEIGHT), _a.z);
    body.current.rotation.set(0, _e.setFromQuaternion(_qa, "YXZ").y, 0);
  });

  return (
    <group ref={body}>
      <AvatarBody avatar={avatar} color={color} motion={motion} />
      <Suspense fallback={null}>
        <Billboard position={[0, 2.15, 0]}>
          <Text font={FONT_URL} fontSize={0.22} color="#ffffff" outlineWidth={0.02} outlineColor="#000000">
            {name}
          </Text>
        </Billboard>
        <ChatBubble sessionId={sessionId} />
      </Suspense>
    </group>
  );
}

export function Avatars() {
  useWorldVersion();
  return (
    <>
      {[...world.peers.values()].map((p) => (
        <RemoteAvatar
          key={`${p.session_id}:${p.avatar?.hash ?? ""}`}
          sessionId={p.session_id}
          avatar={p.avatar}
          name={p.kind === "agent" ? `${t("agents.agentPrefix")} · ${p.display_name}` : p.display_name}
        />
      ))}
    </>
  );
}
