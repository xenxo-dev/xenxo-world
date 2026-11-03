/**
 * Los cofres de las carreras con botín (§9 octies ter; `loot` en districts.json: los niveles para
 * tryhards de Vertical): flotan sobre la meta, girando despacio, para que se vea desde lejos adónde
 * hay que llegar. Al llegar (RACE.loot), el tuyo se abre con un destello del color del arma que ha
 * salido y el arma sube de dentro unos segundos. Es decorado del cliente: no choca ni cuenta nada (la
 * meta y el botín son del servidor).
 */
import { Suspense, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { WEAPONS } from "@xenxo/protocol";
import districts from "../../../realtime/src/districts.json";
import activities from "../../../realtime/src/district-activities.json";
import { SEED_ASSETS } from "../../../realtime/src/seed-assets";
import { assetUrl } from "../config";
import { useWeapons } from "../net/weapons";
import { usePlace } from "../net/world-store";
import { useGraphics } from "./graphics";
import { lightweight } from "./materials";
import { ARMS } from "./people/arms";
import { WeaponModel } from "./people/HeldWeapon";

/** Dónde va la bisagra de la tapa respecto a la caja (m; la imprime tools/models/library/blasters.mjs). */
const LID_HINGE: [number, number, number] = [0.229, 0.189, 0];
/** Altura del cofre sobre la meta (m): por encima de la cabeza, para no tapar nada. */
const LIFT = 2.4;
/** Cuánto se ve abierto con el arma encima (s). */
const OPEN_S = 7;

interface Chest {
  race: string;
  p: [number, number, number];
}

type Races = { id: string; finish: { p: number[] } }[];

/** Los cofres del lugar: los de las carreras con botín de su distrito, en su meta. */
function chestsOf(place: string): Chest[] {
  const d = (districts.districts as { id: string; chunk: string; loot?: Record<string, string> }[]).find((x) => x.chunk === place);
  if (!d?.loot) return [];
  const races = ((activities as unknown as Record<string, { races?: Races }>)[d.id]?.races ?? []) as Races;
  return Object.keys(d.loot).flatMap((race) => {
    const r = races.find((x) => x.id === race);
    return r ? [{ race, p: [r.finish.p[0]!, r.finish.p[1]!, r.finish.p[2]!] as [number, number, number] }] : [];
  });
}

export function LootChests() {
  const place = usePlace();
  const chests = useMemo(() => chestsOf(place), [place]);
  if (!chests.length) return null;
  return (
    <Suspense fallback={null}>
      {chests.map((c) => (
        <LootChest key={c.race} chest={c} />
      ))}
    </Suspense>
  );
}

function usePiece(name: string, pbr: boolean, light: boolean) {
  const entry = SEED_ASSETS[name];
  const lod = entry?.lods[light ? entry.lods.length - 1 : 0];
  const gltf = useGLTF(lod ? assetUrl(lod.hash) : "data:,", false, true);
  return useMemo(() => {
    const c = gltf.scene.clone(true);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !pbr && !Array.isArray(m.material)) m.material = lightweight(m.material);
    });
    return c;
  }, [gltf, pbr]);
}

function LootChest({ chest }: { chest: Chest }) {
  const f = useGraphics().features;
  const w = useWeapons();
  const body = usePiece("loot_crate", f.pbr, f.lod === "light");
  const lid = usePiece("loot_crate_lid", f.pbr, f.lod === "light");
  const root = useRef<THREE.Group>(null);
  const lidRef = useRef<THREE.Group>(null);
  const prize = useRef<THREE.Group>(null);
  const flash = useRef<THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>>(null);
  const open = useRef(0);
  // El botín de esta carrera (el último), mientras se enseña.
  const loot = w.loot && w.loot.race === chest.race ? w.loot : null;
  const [x, y, z] = chest.p;

  useFrame((state, dt) => {
    const g = root.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const age = loot ? (performance.now() - loot.at) / 1000 : Infinity;
    const showing = age < OPEN_S;
    g.position.set(x, y + LIFT + Math.sin(t * 1.6) * 0.08, z);
    g.rotation.y += dt * (showing ? 0.25 : 0.6);
    open.current += ((showing ? 1 : 0) - open.current) * Math.min(1, dt * (showing ? 5 : 2));
    if (lidRef.current) lidRef.current.rotation.z = -1.9 * open.current;
    if (prize.current) {
      prize.current.visible = showing;
      prize.current.position.y = 0.25 + Math.min(1, age / 0.8) * 0.75;
      prize.current.rotation.y = t * 1.8;
    }
    const fl = flash.current;
    if (fl) {
      const k = Math.max(0, 1 - age / 1.4);
      fl.visible = showing && k > 0;
      if (fl.visible && loot) {
        fl.scale.setScalar(0.4 + (1 - k) * 2.6);
        fl.material.opacity = k * 0.8;
        fl.material.color.set(WEAPONS[loot.weapon].color);
      }
    }
  });

  return (
    <group ref={root} position={[x, y + LIFT, z]}>
      <primitive object={body} />
      <group ref={lidRef} position={LID_HINGE}>
        <primitive object={lid} />
      </group>
      <group ref={prize} visible={false}>
        {loot && (
          // Centrada (gira sobre sí misma) y de un metro más o menos, sea cual sea.
          <group scale={Math.min(1.8, 0.9 / (ARMS[loot.weapon].muzzle[1] + 0.08))}>
            <Suspense fallback={null}>
              <group position={[0, 0, -ARMS[loot.weapon].muzzle[1] / 2]}>
                <WeaponModel id={loot.weapon} shadow={false} />
              </group>
            </Suspense>
          </group>
        )}
      </group>
      <mesh ref={flash} visible={false} position={[0, 0.3, 0]} renderOrder={3}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

