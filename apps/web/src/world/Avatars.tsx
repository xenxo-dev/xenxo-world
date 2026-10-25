import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import type { AvatarRef } from "@xenxo/protocol";
import { assetUrl } from "../config";
import { t } from "../i18n";
import { useWorldVersion, world } from "../net/world-store";
import { CustomAvatar } from "./CustomAvatar";
import { FONT_URL } from "./font";

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

/** Personaje por defecto: cápsula y cabeza con visor de azulejo. Los pies en y = 0, mirando a -Z. */
export function DefaultAvatar({ color }: { color: THREE.ColorRepresentation }) {
  return (
    <>
      <mesh position={[0, 0.75, 0]}>
        <capsuleGeometry args={[0.28, 0.9, 4, 12]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <mesh position={[0, EYE_HEIGHT, 0]}>
        <sphereGeometry args={[0.2, 16, 12]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <mesh position={[0, EYE_HEIGHT + 0.02, -0.19]}>
        <boxGeometry args={[0.24, 0.07, 0.04]} />
        <meshBasicMaterial color="#2f6fb0" />
      </mesh>
    </>
  );
}

/** Personaje de alguien: el suyo propio si lo tiene, si no el de por defecto. */
export function AvatarBody({ avatar, color }: { avatar?: AvatarRef; color: THREE.ColorRepresentation }) {
  const fallback = <DefaultAvatar color={color} />;
  return <CustomAvatar url={avatar ? assetUrl(avatar.hash) : null} fallback={fallback} />;
}

function RemoteAvatar({ sessionId, name, avatar }: { sessionId: string; name: string; avatar?: AvatarRef }) {
  const body = useRef<THREE.Group>(null);
  const color = useRef(colorFor(sessionId)).current;

  useFrame(() => {
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

    // Pies bajo la cabeza; el cuerpo solo sigue el giro horizontal.
    body.current.position.set(_a.x, Math.max(0, _a.y - EYE_HEIGHT), _a.z);
    body.current.rotation.set(0, _e.setFromQuaternion(_qa, "YXZ").y, 0);
  });

  return (
    <group ref={body}>
      <AvatarBody avatar={avatar} color={color} />
      <Billboard position={[0, 2.15, 0]}>
        <Text font={FONT_URL} fontSize={0.22} color="#ffffff" outlineWidth={0.02} outlineColor="#000000">
          {name}
        </Text>
      </Billboard>
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
