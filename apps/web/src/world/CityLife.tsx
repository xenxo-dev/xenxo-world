/**
 * Vida de las ciudades de los distritos: gente que camina por las calles (y por la pasarela de
 * Distrito Cero). Es decorado del cliente, como el horizonte: no son personas ni entidades del
 * mundo, no cuentan en «quién hay» y no viajan por la red.
 *
 * Rendimiento (Quest 3): se simula una población entera con fórmulas (posición = función del
 * tiempo, sin estado por frame) y solo se dibujan los N más cercanos (`FEATURES.pedestrians`) en
 * huecos fijos (y el tráfico, instanciado: un dibujo por modelo). Cada hueco tiene siempre el mismo personaje de serie: cambiar a quién sigue no
 * vuelve a cargar nada; solo se reasigna cuando el anterior se aleja, fuera de la vista.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import districts from "../../../realtime/src/districts.json";
import { SEED_ASSETS } from "../../../realtime/src/seed-assets";
import { assetUrl } from "../config";
import type { Ambience, Features } from "./graphics";
import { lightweight, paintedLights } from "./materials";
import { AvatarBody } from "./Avatars";
import { createMotion, type Motion } from "./motion";
import { rng } from "./NexoCity";
import { playerPos } from "./Player";
import { npcs } from "./collision";

interface Loop {
  /** Esquinas en orden (x, z), a la altura `y`. */
  pts: [number, number][];
  y: number;
  len: number;
}

interface Walker {
  loop: number;
  dir: 1 | -1;
  speed: number;
  offset: number;
}

const POPULATION = 44;
/** Más allá, nadie: la niebla de noche empieza a 45 m. */
const RANGE = 55;
const REASSIGN_MS = 600;
/** Cada peatón va 0,45 m a la derecha de su recorrido (los que se cruzan no se pisan). */
const LANE = 0.45;

type City = { x0: number; z0: number; block: number; street: number };
const CITY = (districts as unknown as { city: City }).city;
const BY_CHUNK = new Map((districts.districts as { id: string; chunk: string }[]).map((d) => [d.chunk, d.id]));

function rect(x0: number, z0: number, x1: number, z1: number, y = 0): Loop {
  const pts: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  return { pts, y, len: 2 * (x1 - x0 + z1 - z0) };
}

/** Recorridos: alrededor de cada manzana (a 1 m del bordillo, ya en la calzada) y la pasarela de Cero. */
function loopsFor(id: string): Loop[] {
  const out: Loop[] = [];
  const { x0, z0, block, street } = CITY;
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) {
      const bx = x0 + i * (block + street), bz = z0 + j * (block + street);
      out.push(rect(bx - 1, bz - 1, bx + block + 1, bz + block + 1));
    }
  if (id === "cero") out.push(rect(13.5, 13.5, 50.5, 50.5, 8)); // la pasarela (tools/forge/cero.py)
  return out;
}

const _p = { x: 0, z: 0, dx: 0, dz: 0 };
/** Punto y sentido a `s` metros del principio de un recorrido. */
function along(l: Loop, s: number) {
  let d = ((s % l.len) + l.len) % l.len;
  for (let k = 0; k < 4; k++) {
    const a = l.pts[k]!, b = l.pts[(k + 1) % 4]!;
    const seg = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (d <= seg) {
      const ux = Math.sign(b[0] - a[0]), uz = Math.sign(b[1] - a[1]);
      _p.x = a[0] + ux * d;
      _p.z = a[1] + uz * d;
      _p.dx = ux;
      _p.dz = uz;
      return _p;
    }
    d -= seg;
  }
  return _p;
}

interface Slot {
  walker: number;
  motion: Motion;
  group: THREE.Group | null;
  /** Hacia dónde mira (se gira poco a poco en las esquinas). */
  yaw: number;
}

const Pedestrian = memo(function Pedestrian({ slot, seed }: { slot: Slot; seed: string }) {
  return (
    <group ref={(g) => void (slot.group = g)} visible={false}>
      <AvatarBody seed={seed} motion={slot.motion} />
    </group>
  );
});

export function Pedestrians({ chunk, count }: { chunk: string; count: number }) {
  const id = BY_CHUNK.get(chunk);
  const loops = useMemo(() => (id ? loopsFor(id) : []), [id]);
  const walkers = useMemo<Walker[]>(() => {
    if (!id) return [];
    const r = rng(id.length * 7919 + id.charCodeAt(0));
    return Array.from({ length: POPULATION }, (_, n) => ({
      // La pasarela (último recorrido de Cero) lleva una de cada seis personas.
      loop: id === "cero" && n % 6 === 0 ? loops.length - 1 : Math.floor(r() * 9),
      dir: r() < 0.5 ? 1 : -1,
      speed: 1.05 + r() * 0.5,
      offset: r() * 400,
    }));
  }, [id, loops]);
  const slots = useMemo<Slot[]>(() => Array.from({ length: count }, () => ({ walker: -1, motion: createMotion(), group: null, yaw: 0 })), [count]);
  const last = useRef(0);
  const dist = useMemo(() => new Float32Array(POPULATION), []);
  const order = useMemo(() => Array.from({ length: POPULATION }, (_, n) => n), []);
  useEffect(() => {
    last.current = 0;
  }, [chunk]);

  useFrame((state, dt) => {
    if (!walkers.length) return;
    const t = state.clock.elapsedTime;
    const now = performance.now();
    if (now - last.current > REASSIGN_MS) {
      last.current = now;
      // Los más cercanos; un hueco se queda con quien ya seguía si sigue entre ellos.
      for (let n = 0; n < POPULATION; n++) {
        const w = walkers[n]!;
        const l = loops[w.loop]!;
        const p = along(l, w.offset + w.dir * w.speed * t);
        const dx = p.x - playerPos.x, dz = p.z - playerPos.z, dy = l.y - playerPos.y;
        dist[n] = dx * dx + dz * dz + dy * dy * 4;
      }
      order.sort((a, b) => dist[a]! - dist[b]!);
      const near = new Set<number>();
      for (let k = 0; k < slots.length && k < POPULATION; k++) if (dist[order[k]!]! < RANGE * RANGE) near.add(order[k]!);
      for (const s of slots) if (s.walker >= 0 && !near.has(s.walker)) s.walker = -1;
      for (const s of slots) if (s.walker >= 0) near.delete(s.walker);
      for (const s of slots) {
        if (s.walker >= 0) continue;
        const next = near.values().next();
        if (next.done) break;
        s.walker = next.value;
        near.delete(next.value);
      }
    }
    let n = 0;
    for (const s of slots) {
      const g = s.group;
      if (!g) continue;
      if (s.walker < 0) {
        g.visible = false;
        s.motion.speed = 0;
        continue;
      }
      const w = walkers[s.walker]!;
      const l = loops[w.loop]!;
      let p = along(l, w.offset + w.dir * w.speed * t);
      // Cada uno por su derecha (los que se cruzan no se atraviesan) y, si el jugador está justo
      // delante, se espera: su avance se descuenta mientras no se aparte.
      const hx = p.dx * w.dir, hz = p.dz * w.dir;
      const lx = p.x - hz * LANE, lz = p.z + hx * LANE;
      const ax = playerPos.x - lx, az = playerPos.z - lz;
      const ahead = ax * hx + az * hz;
      const side = Math.abs(ax * hz - az * hx);
      const blocked = ahead > 0 && ahead < 1.3 && side < 0.75 && Math.abs(playerPos.y - l.y) < 1.2;
      if (blocked) {
        w.offset -= w.dir * w.speed * dt;
        p = along(l, w.offset + w.dir * w.speed * t);
      }
      const want = Math.atan2(-p.dx * w.dir, -p.dz * w.dir);
      if (!g.visible) s.yaw = want;
      else {
        const d = Math.atan2(Math.sin(want - s.yaw), Math.cos(want - s.yaw));
        s.yaw += d * Math.min(1, dt * 6);
      }
      g.visible = true;
      const px = p.x - p.dz * w.dir * LANE, pz = p.z + p.dx * w.dir * LANE;
      g.position.set(px, l.y, pz);
      g.rotation.y = s.yaw;
      s.motion.speed = blocked ? 0 : w.speed;
      // Para las colisiones del jugador (collision.ts): no se atraviesan.
      if (n < npcs.pos.length / 3) {
        npcs.pos[n * 3] = px;
        npcs.pos[n * 3 + 1] = l.y;
        npcs.pos[n * 3 + 2] = pz;
        n++;
      }
    }
    npcs.count = n;
  });
  // Al irse del lugar, nadie con quien chocar.
  useEffect(() => () => void (npcs.count = 0), []);

  if (!id || count <= 0) return null;
  return (
    <>
      {slots.map((s, k) => (
        <Pedestrian key={`${chunk}:${k}`} slot={s} seed={`npc-${id}-${k}`} />
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
  useFrame((state) => {
    const im = ref.current;
    if (!im) return;
    const t = state.clock.elapsedTime;
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
