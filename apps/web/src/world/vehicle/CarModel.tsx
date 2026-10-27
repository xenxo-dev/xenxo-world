/**
 * El coche dibujado: la carrocería con su interior, dos puertas que se abren por la bisagra y cuatro
 * ruedas que giran, suben y bajan con la suspensión y tuercen las delanteras (Car Concept de
 * Khronos, CC BY 4.0). Cada coche lleva la pintura de quien lo conduce. Lo usan el coche propio (con
 * la física) y los de los demás (con su pose). Quien lo mueve aplica la pose en su propio useFrame
 * (`applyCarPose`), justo después de calcularla: coche, persona y cámara van en el mismo frame.
 */
import { memo, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { SEED_ASSETS } from "../../../../realtime/src/seed-assets";
import { assetUrl } from "../../config";
import { useGraphics } from "../graphics";
import { lightweight } from "../materials";
import { CAR } from "./car";

export interface CarPose {
  /** Origen del coche (en el suelo) y su giro completo. */
  p: THREE.Vector3;
  q: THREE.Quaternion;
  /** Giro de las ruedas delanteras (rad) y vueltas de las ruedas. */
  steer: number;
  spin: number;
  /** Altura de cada rueda (si la da la física; si no, la de reposo). */
  wheelY: Float32Array | null;
  /** Puertas abiertas (0 cerrada, 1 abierta del todo). */
  doorL: number;
  doorR: number;
  visible: boolean;
}

export function createCarPose(): CarPose {
  return { p: new THREE.Vector3(), q: new THREE.Quaternion(), steer: 0, spin: 0, wheelY: null, doorL: 0, doorR: 0, visible: false };
}

/** Los nodos que se mueven (los rellena CarModel al montarse). */
export interface CarHandle {
  root: THREE.Group | null;
  doorL: THREE.Group | null;
  doorR: THREE.Group | null;
  steer: (THREE.Group | null)[];
  spin: (THREE.Group | null)[];
}
export function createCarHandle(): CarHandle {
  return { root: null, doorL: null, doorR: null, steer: [], spin: [] };
}

/** Las puertas abren deprisa al principio y frenan al final (como una de verdad). */
const ease = (t: number) => 1 - (1 - t) * (1 - t);

export function applyCarPose(h: CarHandle, pose: CarPose) {
  const r = h.root;
  if (!r) return;
  r.visible = pose.visible;
  if (!pose.visible) return;
  r.position.copy(pose.p);
  r.quaternion.copy(pose.q);
  if (h.doorL) h.doorL.rotation.y = -ease(pose.doorL) * CAR.doorOpen;
  if (h.doorR) h.doorR.rotation.y = ease(pose.doorR) * CAR.doorOpen;
  for (let i = 0; i < 4; i++) {
    const w = CAR.wheels[i]!;
    const s = h.steer[i];
    if (s) {
      s.position.y = pose.wheelY ? pose.wheelY[i]! : w.y;
      s.rotation.y = w.front ? pose.steer : 0;
    }
    const sp = h.spin[i];
    if (sp) sp.rotation.x = pose.spin;
  }
}

const paints = new Map<string, THREE.Material>();
function paintOf(m: THREE.Material, color: string): THREE.Material {
  const k = `${m.uuid}|${color}`;
  let out = paints.get(k);
  if (!out) {
    out = m.clone();
    (out as THREE.MeshStandardMaterial).color.set(color);
    paints.set(k, out);
  }
  return out;
}

function useCarScene(name: string, light: boolean, pbr: boolean, paint?: string) {
  const entry = SEED_ASSETS[name];
  const lod = entry ? entry.lods[light ? entry.lods.length - 1 : 0] : undefined;
  const gltf = useGLTF(lod ? assetUrl(lod.hash) : "data:,", false, true);
  return useMemo(() => {
    const c = gltf.scene.clone(true);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      // La pintura principal, del color de cada coche (el resto, tal cual).
      let mat = paint && /^Paint 1/.test(m.material.name) ? paintOf(m.material, paint) : m.material;
      if (!pbr) mat = lightweight(mat);
      m.material = mat;
    });
    return c;
  }, [gltf, pbr, paint]);
}

export const CarModel = memo(function CarModel({ handle, paint }: { handle: CarHandle; paint: string }) {
  const g = useGraphics();
  const f = g.features;
  const light = f.lod === "light";
  const M = CAR.models;
  const body = useCarScene(M.body, light, f.pbr, paint);
  const doorL = useCarScene(M.doorL, light, f.pbr, paint);
  const doorR = useCarScene(M.doorR, light, f.pbr, paint);
  const wheelL = useCarScene(M.wheelL, light, f.pbr);
  const wheelR = useCarScene(M.wheelR, light, f.pbr);
  // Cuatro ruedas: dos de cada lado (clones de la misma geometría).
  const wheels = useMemo(() => CAR.wheels.map((w) => (w.left ? wheelL : wheelR).clone(true)), [wheelL, wheelR]);
  const hl = CAR.hingeL, hr = CAR.hingeR;

  return (
    <group ref={(o) => void (handle.root = o)} visible={false}>
      <primitive object={body} />
      <group ref={(o) => void (handle.doorL = o)} position={[hl.x, hl.y, hl.z]}>
        <primitive object={doorL} />
      </group>
      <group ref={(o) => void (handle.doorR = o)} position={[hr.x, hr.y, hr.z]}>
        <primitive object={doorR} />
      </group>
      {CAR.wheels.map((w, i) => (
        <group key={i} ref={(o) => void (handle.steer[i] = o)} position={[w.x, w.y, w.z]}>
          <group ref={(o) => void (handle.spin[i] = o)}>
            <primitive object={wheels[i]!} />
          </group>
        </group>
      ))}
    </group>
  );
});
