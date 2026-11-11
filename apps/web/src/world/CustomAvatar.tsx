import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { holdSkeletons, loadAvatar, withoutShadows, type LoadedAvatar } from "./avatar-model";
import type { Motion } from "./motion";

/**
 * Personaje propio. Mientras carga (o si falla), devuelve `fallback`:
 * el avatar por defecto nunca deja de verse. `onLoad` avisa cuando ya está (y cuando deja de estar):
 * la gente de las ciudades no se enseña hasta tener su personaje.
 */
export function CustomAvatar({ url, fallback, motion, extra = false, onLoad }: { url: string | null; fallback: React.ReactNode; motion: Motion; extra?: boolean; onLoad?: (loaded: boolean) => void }) {
  const [avatar, setAvatar] = useState<LoadedAvatar | null>(null);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    let loaded: LoadedAvatar | null = null;
    loadAvatar(url, { decor: extra })
      .then((a) => {
        if (alive) {
          if (extra) withoutShadows(a.object);
          // El frame que no le toca (o sin verse), su esqueleto se queda como estaba.
          holdSkeletons(a.object, () => !!(motion.hidden || motion.skip));
          loaded = a;
          setAvatar(a);
          onLoad?.(true);
        } else a.dispose();
      })
      .catch((e) => console.warn("[xenxo] no se pudo cargar el personaje", url, e));
    return () => {
      alive = false;
      setAvatar(null);
      onLoad?.(false);
      if (loaded?.rig && motion.fx?.rig === loaded.rig) motion.fx.rig = null;
      loaded?.dispose();
    };
  }, [url, extra]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sin dibujar (gente lejos o fuera de la vista), sin animar: es lo que más cuesta de cada persona.
  // Y entre mucha gente, a los de más lejos no les toca a cada frame (world/crowd.ts): el tiempo de
  // los que se saltan se suma al del siguiente.
  const owed = useRef(0);
  useFrame((state, dt) => {
    if (motion.hidden || !avatar) return void (owed.current = 0);
    owed.current = Math.min(owed.current + Math.min(dt, 0.1), 0.2);
    if (motion.skip) return;
    avatar.update(owed.current, motion, state.camera.position);
    owed.current = 0;
  });

  if (!url || !avatar) return <>{fallback}</>;
  return <primitive object={avatar.object} />;
}
