/**
 * El arco del teletransporte en VR: joystick derecho hacia delante para apuntar, se suelta para ir.
 * Verde-neón si el sitio vale; rosa si no (pared, sin suelo o sin altura para estar de pie).
 * Lo calcula vr-move.ts; aquí solo se lee el mando y se dibuja (una línea y un anillo, sin objetos
 * nuevos por frame).
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXRStore } from "@react-three/xr";
import * as THREE from "three";
import { ARC_POINTS, vr, vrAim, vrCancelAim, vrRelease } from "./vr-move";
import { XR_THEME } from "./theme";

/** Empujar el joystick más que esto hacia delante apunta; volver por debajo de RELEASE, salta. */
const AIM = 0.6;
const RELEASE = 0.25;

const _m = new THREE.Matrix4();
const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const VALID = new THREE.Color(XR_THEME.neon);
const INVALID = new THREE.Color(XR_THEME.rosa);

export function VRTeleport() {
  const store = useXRStore();
  const gl = useThree((s) => s.gl);
  const line = useRef<THREE.Line>(null);
  const ring = useRef<THREE.Mesh>(null);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(vr.arc, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: VALID, transparent: true, opacity: 0.9 }), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: VALID, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }), []);
  const ringGeom = useMemo(() => new THREE.RingGeometry(0.22, 0.3, 32).rotateX(-Math.PI / 2), []);
  useEffect(() => () => void (geom.dispose(), lineMat.dispose(), ringMat.dispose(), ringGeom.dispose(), vrCancelAim()), [geom, lineMat, ringMat, ringGeom]);
  const lineObj = useMemo(() => new THREE.Line(geom, lineMat), [geom, lineMat]);

  useFrame((state, _dt, frame?: XRFrame) => {
    const right = store.getState().inputSourceStates.find((s) => s.type === "controller" && s.inputSource.handedness === "right");
    const y = right && right.type === "controller" ? (right.gamepad["xr-standard-thumbstick"]?.yAxis ?? 0) : 0;
    const ref = gl.xr.getReferenceSpace();
    const pose = right && frame && ref ? frame.getPose(right.inputSource.targetRaySpace, ref) : undefined;
    if (pose && vr.origin && (y < -AIM || (vr.aiming && y <= -RELEASE))) {
      // Del espacio de la habitación al mundo: la habitación es el origen XR.
      _m.fromArray(pose.transform.matrix).premultiply(vr.origin.matrixWorld);
      _from.setFromMatrixPosition(_m);
      _q.setFromRotationMatrix(_m);
      _dir.set(0, 0, -1).applyQuaternion(_q);
      vrAim(_from, _dir);
    } else if (vr.aiming && y > -RELEASE) {
      vrRelease(state.camera);
    } else if (!pose && vr.aiming) vrCancelAim();

    const show = vr.aiming && vr.arcCount > 1;
    if (line.current) {
      line.current.visible = show;
      geom.setDrawRange(0, vr.arcCount);
      geom.attributes.position!.needsUpdate = true;
      lineMat.color.copy(vr.valid ? VALID : INVALID);
    }
    if (ring.current) {
      ring.current.visible = show && vr.valid;
      ring.current.position.copy(vr.target).setY(vr.target.y + 0.02);
    }
  });

  return (
    <>
      <primitive object={lineObj} ref={line} frustumCulled={false} />
      <mesh ref={ring} geometry={ringGeom} material={ringMat} visible={false} />
    </>
  );
}
