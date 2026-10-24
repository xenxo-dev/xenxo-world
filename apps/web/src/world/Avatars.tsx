import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import { useWorldVersion, world } from "../net/world-store";
import { FONT_URL } from "./font";

/** Retraso de interpolación: mostramos a los demás ~100 ms en el pasado, entre dos poses reales. */
const INTERP_DELAY_MS = 100;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _e = new THREE.Euler();

function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.6);
}

function RemoteAvatar({ sessionId, name }: { sessionId: string; name: string }) {
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const color = useRef(colorFor(sessionId)).current;

  useFrame(() => {
    const buf = world.poseBuffers.get(sessionId);
    if (!buf || buf.length === 0 || !body.current || !head.current) return;
    const rt = world.serverNow() - INTERP_DELAY_MS;

    let i = buf.length - 1;
    while (i > 0 && buf[i - 1]!.t > rt) i--;
    const s1 = buf[i]!;
    const s0 = buf[Math.max(0, i - 1)]!;
    const span = s1.t - s0.t;
    const k = span > 0 ? THREE.MathUtils.clamp((rt - s0.t) / span, 0, 1) : 1;

    _a.fromArray(s0.head.p).lerp(_b.fromArray(s1.head.p), k);
    _qa.fromArray(s0.head.r).slerp(_qb.fromArray(s1.head.r), k);

    body.current.position.set(_a.x, _a.y - 1.6, _a.z);
    head.current.position.copy(_a);
    head.current.quaternion.copy(_qa);
    // El cuerpo solo sigue el giro horizontal de la cabeza.
    body.current.rotation.set(0, _e.setFromQuaternion(_qa, "YXZ").y, 0);
  });

  return (
    <>
      <group ref={body}>
        <mesh position={[0, 0.75, 0]}>
          <capsuleGeometry args={[0.28, 0.9, 4, 12]} />
          <meshLambertMaterial color={color} />
        </mesh>
        <Billboard position={[0, 2.15, 0]}>
          <Text font={FONT_URL} fontSize={0.22} color="#ffffff" outlineWidth={0.02} outlineColor="#000000">
            {name}
          </Text>
        </Billboard>
      </group>
      <group ref={head}>
        <mesh>
          <sphereGeometry args={[0.2, 16, 12]} />
          <meshLambertMaterial color={color} />
        </mesh>
        <mesh position={[0, 0.02, -0.19]}>
          <boxGeometry args={[0.24, 0.07, 0.04]} />
          <meshBasicMaterial color="#22d3ee" />
        </mesh>
      </group>
    </>
  );
}

export function Avatars() {
  useWorldVersion();
  return (
    <>
      {[...world.peers.values()].map((p) => (
        <RemoteAvatar key={p.session_id} sessionId={p.session_id} name={p.kind === "agent" ? `agente · ${p.display_name}` : p.display_name} />
      ))}
    </>
  );
}
