import { useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { loadAvatar, type LoadedAvatar } from "./avatar-model";
import type { Motion } from "./motion";

/**
 * Personaje propio. Mientras carga (o si falla), devuelve `fallback`:
 * el avatar por defecto nunca deja de verse.
 */
export function CustomAvatar({ url, fallback, motion }: { url: string | null; fallback: React.ReactNode; motion: Motion }) {
  const [avatar, setAvatar] = useState<LoadedAvatar | null>(null);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    let loaded: LoadedAvatar | null = null;
    loadAvatar(url)
      .then((a) => {
        if (alive) {
          loaded = a;
          setAvatar(a);
        } else a.dispose();
      })
      .catch((e) => console.warn("[xenxo] no se pudo cargar el personaje", url, e));
    return () => {
      alive = false;
      setAvatar(null);
      loaded?.dispose();
    };
  }, [url]);

  useFrame((_, dt) => avatar?.update(Math.min(dt, 0.1), motion.speed, motion.phase));

  if (!url || !avatar) return <>{fallback}</>;
  return <primitive object={avatar.object} />;
}
