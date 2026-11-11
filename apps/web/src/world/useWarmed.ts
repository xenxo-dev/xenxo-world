/**
 * Los ganchos de world/warm.ts: un modelo entra en la escena cuando sus shaders están compilados y
 * sus texturas subidas.
 */
import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useState } from "react";
import type * as THREE from "three";
import { prepare, type WarmRenderer } from "./warm";

/**
 * ¿Están preparados estos modelos? Mientras no, quien lo usa sigue enseñando lo que tuviera (o nada).
 * `post`: hay post-proceso (`features.post`). En las gafas, siempre preparados.
 */
function useReady(objects: readonly THREE.Object3D[], post: boolean): readonly THREE.Object3D[] | null {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const get = useThree((s) => s.get);
  const [ready, setReady] = useState<readonly THREE.Object3D[] | null>(null);
  useLayoutEffect(() => {
    const w = gl as unknown as WarmRenderer;
    if (w.xr.isPresenting) {
      setReady(objects);
      return;
    }
    return prepare(w, objects, get().camera, scene, post, () => setReady(objects));
  }, [gl, scene, get, objects, post]);
  return ready;
}

/**
 * El modelo que toca enseñar: `object` cuando está preparado; hasta entonces, el anterior que lo
 * estuvo (o null la primera vez).
 */
export function useWarmed<T extends THREE.Object3D>(object: T, post: boolean): T | null {
  const list = useMemo(() => [object], [object]);
  return (useReady(list, post)?.[0] as T | undefined) ?? null;
}

/**
 * Varias piezas que se enseñan a la vez (un coche): true cuando están todas preparadas. `objects`
 * tiene que ser la misma lista mientras no cambien las piezas (useMemo).
 */
export function useWarmedAll(objects: readonly THREE.Object3D[], post: boolean): boolean {
  return useReady(objects, post) === objects;
}
