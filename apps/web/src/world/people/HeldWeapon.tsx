/**
 * El arma en la mano de una persona (§9 octies ter): la que diga su `Motion` (la tuya, guns.ts; la
 * de los demás, su pose), en su mano derecha (la escribe el avatar después de animarse, con el IK
 * de apuntar: arms.ts) y mirando hacia donde mira. Apunta también dónde queda la boca del cañón
 * (arms.ts → muzzles): de ahí salen sus rayos. Va dentro del grupo del personaje.
 */
import { Suspense, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { isWeaponId, type WeaponId } from "@xenxo/protocol";
import { SEED_ASSETS } from "../../../../realtime/src/seed-assets";
import { assetUrl } from "../../config";
import { useGraphics } from "../graphics";
import { lightweight } from "../materials";
import type { Motion } from "../motion";
import { useWarmed } from "../useWarmed";
import { ARMS, NO_RIG_HAND, PALM, setMuzzle } from "./arms";

const _m = new THREE.Vector3();
/** Materiales ligeros (sin PBR) ya hechos, por material original: todos los clones los comparten. */
const light = new WeakMap<THREE.Material, THREE.Material>();

/** `who`: de quién es (su sesión): para saber de dónde salen sus rayos. */
export function HeldWeapon({ motion, who }: { motion: Motion; who: string }) {
  const [id, setId] = useState<WeaponId | null>(null);
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const w = isWeaponId(motion.weapon) ? motion.weapon : null;
    if (w !== id) setId(w); // cambio estructural (sacarla, cambiarla): poco frecuente
    const g = group.current;
    if (!g) return;
    g.visible = !!w && !motion.hidden;
    if (!w || !g.visible) return;
    const h = motion.hand;
    // En la palma (algo por delante de la muñeca) y mirando hacia delante del personaje (−Z).
    if (h?.ok) g.position.set(h.x, h.y - 0.01, h.z - PALM);
    else g.position.set(NO_RIG_HAND.x, NO_RIG_HAND.y, NO_RIG_HAND.z);
    g.rotation.set(0, Math.PI, 0);
    const a = ARMS[w];
    g.updateWorldMatrix(true, false);
    _m.set(0, a.muzzle[0], a.muzzle[1]);
    g.localToWorld(_m);
    setMuzzle(who, _m.x, _m.y, _m.z);
  });
  return (
    <group ref={group} visible={false}>
      {id && (
        <Suspense fallback={null}>
          <WeaponModel id={id} />
        </Suspense>
      )}
    </group>
  );
}

/** El modelo del arma (tools/models/library/weapon_*), en su nivel de detalle. */
export function WeaponModel({ id, shadow = true }: { id: WeaponId; shadow?: boolean }) {
  const f = useGraphics().features;
  const entry = SEED_ASSETS[`weapon_${id}`];
  const lod = entry?.lods[f.lod === "light" ? entry.lods.length - 1 : 0];
  const gltf = useGLTF(lod ? assetUrl(lod.hash) : "data:,", false, true);
  const scene = useMemo(() => {
    const c = gltf.scene.clone(true);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      m.castShadow = shadow;
      if (!f.pbr) {
        let l = light.get(m.material);
        if (!l) light.set(m.material, (l = lightweight(m.material)));
        m.material = l;
      }
    });
    return c;
  }, [gltf, f.pbr, shadow]);
  // Entra con sus shaders compilados (world/warm.ts): sacar el arma no congela la página.
  const shown = useWarmed(scene, f.post);
  return shown ? <primitive object={shown} /> : null;
}
