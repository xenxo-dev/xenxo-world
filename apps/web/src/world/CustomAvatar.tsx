import { useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { loadAvatar, withoutShadows, type LoadedAvatar } from "./avatar-model";
import type { Motion } from "./motion";

/**
 * Personaje propio. Mientras carga (o si falla), devuelve `fallback`:
 * el avatar por defecto nunca deja de verse.
 */
export function CustomAvatar({ url, fallback, motion, extra = false }: { url: string | null; fallback: React.ReactNode; motion: Motion; extra?: boolean }) {
  const [avatar, setAvatar] = useState<LoadedAvatar | null>(null);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    let loaded: LoadedAvatar | null = null;
    loadAvatar(url)
      .then((a) => {
        if (alive) {
          if (extra) withoutShadows(a.object);
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
  }, [url, extra]);

  useFrame((_, dt) => avatar?.update(Math.min(dt, 0.1), motion));

  if (!url || !avatar) return <>{fallback}</>;
  return <primitive object={avatar.object} />;
}
