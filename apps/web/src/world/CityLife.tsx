/**
 * Vida de las ciudades de los distritos: su gente (city/citizens.ts: pocos, cada uno con su forma de
 * ser y su día, que se dan cuenta de ti, te contestan y tienen física de verdad) y el tráfico de
 * coches voladores y drones. No son personas ni entidades del mundo ni cuentan en «quién hay», pero
 * son los mismos para todos: a los ciudadanos los mueve uno de los que están y reparte su estado
 * (§9 nonies, net/npc-store.ts) y el tráfico va con la hora del servidor.
 *
 * Rendimiento (Quest 3): de la gente solo se dibujan los más cercanos (`FEATURES.pedestrians`), cada
 * uno siempre con el mismo personaje de serie (se monta la primera vez que se le ve y se queda, oculto
 * y sin animar, cuando se aleja); el tráfico va instanciado (un dibujo por modelo).
 */
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import districts from "../../../realtime/src/districts.json";
import { SEED_ASSETS } from "../../../realtime/src/seed-assets";
import { assetUrl } from "../config";
import { world } from "../net/world-store";
import { people } from "../net/people-store";
import { npcPair } from "../net/people";
import type { Ambience, Features } from "./graphics";
import { lightweight, paintedLights } from "./materials";
import { AvatarBody } from "./Avatars";
import { rng } from "./NexoCity";
import { self } from "./self";
import { AVATAR_PRESETS, presetFor } from "./presets";
import { remoteFeet } from "./people/where";
import { buildNav, districtOfChunk } from "./city/nav";
import { castFor, CitySim, type Citizen } from "./city/citizens";
import { cityEnv } from "./city/env";
import { Speech } from "./city/Speech";

const BY_CHUNK = new Map((districts.districts as { id: string; chunk: string }[]).map((d) => [d.chunk, d.id]));

/* ------------------------------------------------------------------ */
/* La gente                                                             */
/* ------------------------------------------------------------------ */

/** Cada ciudadano, siempre el mismo personaje de serie; los primeros ocho, todos distintos. */
function seedFor(district: string, i: number): string {
  const want = AVATAR_PRESETS[i % AVATAR_PRESETS.length];
  for (let k = 0; k < 64; k++) {
    const seed = `npc-${district}-${i}-${k}`;
    if (presetFor(seed) === want) return seed;
  }
  return `npc-${district}-${i}`;
}

const CitizenView = memo(function CitizenView({ c, seed }: { c: Citizen; seed: string }) {
  const onLoad = useCallback((ok: boolean) => void (c.ready = ok), [c]);
  return (
    <group ref={(g) => void (c.group = g)} visible={false}>
      <AvatarBody seed={seed} motion={c.motion} extra onLoad={onLoad} />
      <Suspense fallback={null}>
        <Speech who={c} />
      </Suspense>
    </group>
  );
});

export function Citizens({ chunk, count }: { chunk: string; count: number }) {
  const id = districtOfChunk(chunk);
  const sim = useMemo(() => {
    const nav = id ? buildNav(id) : null;
    return nav && id ? new CitySim(nav, cityEnv, castFor(id)) : null;
  }, [id]);
  // Los que ya tienen su personaje montado (de esta ciudad: al cambiar de distrito se empieza de cero).
  const [mounted, setMounted] = useState<{ sim: CitySim | null; ids: readonly number[] }>({ sim: null, ids: [] });
  const seen = useRef(-1);
  useEffect(() => {
    if (!sim) return;
    sim.attach();
    // Para mirar desde la consola en desarrollo (como __xenxoStats).
    if (import.meta.env.DEV) (globalThis as { __xenxoCity?: CitySim }).__xenxoCity = sim;
    // Las acciones en pareja de la rueda, si no hay ninguna persona delante; y las peleas de la gente.
    const offer = (kind: Parameters<CitySim["offerPair"]>[0]) => sim.offerPair(kind);
    npcPair.offer = offer;
    const off = people.onHit((h) => {
      const p = h.to === world.sessionId ? self : remoteFeet.get(h.to);
      if (p) sim.event("fight", p.x, p.z);
    });
    return () => {
      off();
      if (npcPair.offer === offer) npcPair.offer = null;
      sim.detach();
      seen.current = -1;
    };
  }, [sim]);
  useEffect(() => {
    if (sim) sim.drawnMax = count;
  }, [sim, count]);

  // Antes que los personajes (prioridad −0,5, después de las caídas de PeopleFx): así el esqueleto de
  // quien cae se coloca ya con su grupo donde toca este frame.
  useFrame((_, dt) => {
    if (!sim) return;
    sim.frame(dt);
    if (sim.version !== seen.current) {
      seen.current = sim.version;
      setMounted((prev) => {
        const ids = prev.sim === sim ? prev.ids : [];
        const add = sim.cast.filter((c) => c.wanted && !ids.includes(c.id)).map((c) => c.id);
        return add.length || prev.sim !== sim ? { sim, ids: [...ids, ...add] } : prev;
      });
    }
  }, -0.5);

  if (!sim || !id || count <= 0 || mounted.sim !== sim) return null;
  return (
    <>
      {mounted.ids.map((i) => (
        <CitizenView key={`${chunk}:${i}`} c={sim.cast[i]!} seed={seedFor(id, i)} />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Tráfico: coches voladores y drones por encima de las calles          */
/* ------------------------------------------------------------------ */

interface Lane {
  /** Eje por el que avanza: "x" (de oeste a este) o "z". */
  axis: "x" | "z";
  /** Coordenada fija (la otra) y altura. */
  at: number;
  y: number;
  dir: 1 | -1;
  speed: number;
  drone: boolean;
}

const LANE_MIN = -110, LANE_LEN = 290;

/**
 * Carriles sobre las calles de la ciudad (centros 13,5 y 50,5) y el primer anillo, a varias
 * alturas y en los dos sentidos. Los drones van más bajos y despacio; los coches, por encima de la
 * pasarela de Cero y de las cubiertas de las parcelas.
 */
function lanesFor(id: string, count: number): Lane[] {
  const r = rng(id.length * 104729 + 17);
  const lines = [13.5, 50.5, -23, 87];
  const out: Lane[] = [];
  for (let n = 0; n < count; n++) {
    const drone = n % 4 === 3;
    const axis = r() < 0.5 ? "x" : "z";
    const dir = r() < 0.5 ? 1 : -1;
    const line = lines[Math.floor(r() * (drone ? 2 : lines.length))]!;
    out.push({
      axis,
      at: line + dir * (drone ? 1.2 : 2.2),
      y: drone ? 11 + r() * 3 : [18, 24, 31, 39][Math.floor(r() * 4)]! + r() * 1.5,
      dir,
      speed: drone ? 5 + r() * 2 : 11 + r() * 9,
      drone,
    });
  }
  return out;
}

/** El tráfico va con la hora del servidor (igual para todos), contada desde aquí (s, sin perder precisión). */
const TRAFFIC_EPOCH = Date.UTC(2026, 0, 1);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e2 = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

function useFirstMesh(name: string, light: boolean) {
  const entry = SEED_ASSETS[name];
  const lod = entry ? entry.lods[light ? entry.lods.length - 1 : 0] : undefined;
  const gltf = useGLTF(lod ? assetUrl(lod.hash) : "data:,", false, true);
  return useMemo(() => {
    let found: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
    });
    return found as THREE.Mesh | null;
  }, [gltf]);
}

function Fleet({ mesh, lanes, features, ambience, offsets }: { mesh: THREE.Mesh; lanes: Lane[]; features: Features; ambience: Ambience; offsets: Float32Array }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const material = useMemo(() => {
    const base = mesh.material as THREE.Material;
    return paintedLights(features.pbr ? base : lightweight(base), ambience);
  }, [mesh, features.pbr, ambience]);
  useFrame(() => {
    const im = ref.current;
    if (!im) return;
    const t = (world.serverNow() - TRAFFIC_EPOCH) / 1000;
    for (let n = 0; n < lanes.length; n++) {
      const l = lanes[n]!;
      const d = (((offsets[n]! + l.dir * l.speed * t - LANE_MIN) % LANE_LEN) + LANE_LEN) % LANE_LEN + LANE_MIN;
      const bob = l.drone ? Math.sin(t * 2.1 + n) * 0.25 : Math.sin(t * 0.7 + n) * 0.12;
      if (l.axis === "x") _v.set(d, l.y + bob, l.at);
      else _v.set(l.at, l.y + bob, d);
      // El frente del modelo mira a +Z: se gira hacia donde avanza, con algo de alabeo.
      const heading = l.axis === "z" ? (l.dir > 0 ? 0 : Math.PI) : l.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      _e2.set(l.drone ? 0.08 : 0, heading, l.drone ? Math.sin(t + n) * 0.05 : Math.sin(t * 0.5 + n) * 0.04);
      _q.setFromEuler(_e2);
      _m.compose(_v, _q, _s);
      im.setMatrixAt(n, _m);
    }
    im.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[mesh.geometry, material, lanes.length]} frustumCulled={false} />;
}

export function Traffic({ chunk, count, features, ambience }: { chunk: string; count: number; features: Features; ambience: Ambience }) {
  const id = BY_CHUNK.get(chunk);
  const light = features.lod === "light";
  const car = useFirstMesh("life_car", light);
  const drone = useFirstMesh("life_drone", light);
  const all = useMemo(() => (id ? lanesFor(id, count) : []), [id, count]);
  const cars = useMemo(() => all.filter((l) => !l.drone), [all]);
  const drones = useMemo(() => all.filter((l) => l.drone), [all]);
  const offsets = useMemo(() => {
    const r = rng(7 + count);
    return Float32Array.from({ length: count }, () => r() * LANE_LEN);
  }, [count]);
  if (!id || count <= 0) return null;
  return (
    <>
      {car && cars.length > 0 && <Fleet mesh={car} lanes={cars} features={features} ambience={ambience} offsets={offsets} />}
      {drone && drones.length > 0 && <Fleet mesh={drone} lanes={drones} features={features} ambience={ambience} offsets={offsets.subarray(cars.length)} />}
    </>
  );
}
