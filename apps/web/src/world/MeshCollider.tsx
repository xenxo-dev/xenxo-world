/**
 * Colisión con la forma real de un modelo (collider@1.from_mesh): carga el nivel más ligero del
 * mesh@1, lo lleva a coordenadas del lugar y lo registra en collision.ts (three-mesh-bvh). Se hace
 * una vez al cargar (nunca por frame) y se quita al desmontar la entidad.
 */
import { useEffect } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { assetUrl } from "../config";
import { setMeshCollider } from "./collision";

/** Más triángulos que esto y se queda la caja de reserva (no se construye el árbol). */
export const MAX_COLLISION_TRIS = 20000;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

export function MeshCollider({ id, hash, x, y, z, r, s, rev }: { id: string; hash: string; x: number; y: number; z: number; r: number[]; s: number[]; rev: number }) {
  const gltf = useGLTF(assetUrl(hash), false, true);
  useEffect(() => {
    // Se rehace solo si cambia la entidad (rev) o el lugar la desplaza (x, z): nunca por frame.
    const root = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(r[0], r[1], r[2], r[3]), new THREE.Vector3(s[0], s[1], s[2]));
    gltf.scene.updateMatrixWorld(true);
    const pos: number[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry as THREE.BufferGeometry;
      const attr = g.getAttribute("position");
      if (!attr) return;
      _m.multiplyMatrices(root, mesh.matrixWorld);
      // Las posiciones pueden venir cuantizadas (enteros normalizados): se leen ya convertidas.
      const index = g.getIndex();
      const n = index ? index.count : attr.count;
      for (let i = 0; i < n; i++) {
        _v.fromBufferAttribute(attr, index ? index.getX(i) : i).applyMatrix4(_m);
        pos.push(_v.x, _v.y, _v.z);
      }
    });
    if (!pos.length || pos.length / 9 > MAX_COLLISION_TRIS) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    setMeshCollider(id, geo);
    return () => setMeshCollider(id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, id, rev, x, z]);
  return null;
}
