/**
 * Vida de los interiores (y de las calles de Distrito Cero): puertas correderas que se abren al
 * acercarse alguien y gente quieta haciendo su vida (sentada, charlando, bailando, trabajando).
 * Todo sale de la forja (`district-interiors.json`, tools/forge/interiors.py y cero.py): dónde están
 * las salas, sus puertas y la gente. Es decorado del cliente, como los peatones: no son personas ni
 * entidades del mundo y no viajan por la red.
 *
 * Rendimiento (Quest 3): solo se dibujan los `FEATURES.residents` más cercanos, en huecos fijos (cada
 * hueco, siempre el mismo personaje de serie); los de una sala solo cuando el jugador está dentro o en
 * su puerta. Las puertas son dos cajas por sala; nada nuevo por frame.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import districts from "../../../realtime/src/districts.json";
import lives from "../../../realtime/src/district-interiors.json";
import type { Ambience } from "./graphics";
import { neonGlow } from "./materials";
import { AvatarBody } from "./Avatars";
import { createMotion, type Motion } from "./motion";
import { playerPos } from "./Player";
import { floorAt, NPC_CITY, npcs } from "./collision";

interface Door {
  x: number;
  z: number;
  /** Eje a lo largo del que se abre la puerta. */
  axis: "x" | "z";
  w: number;
  h: number;
  y: number;
}
interface Room {
  rect: [number, number, number, number];
  y1: number;
  door: Door;
}
interface Resident {
  x: number;
  y: number;
  z: number;
  /** Hacia dónde mira, en grados (0 = +Z). */
  yaw: number;
  pose: string;
  /** Sala donde está (-1: en la calle). */
  room: number;
}
interface Life {
  rooms: Room[];
  npcs: Resident[];
}

const BY_CHUNK = new Map((districts.districts as { id: string; chunk: string; color: string }[]).map((d) => [d.chunk, d]));
const LIFE = (lives as unknown as { districts: Record<string, Life> }).districts;

/** Distancia a la que se abre una puerta (m). */
const OPEN_AT = 2.6;
/** Más allá, nadie de la calle se dibuja. */
const RANGE = 34;
const REASSIGN_MS = 500;
/** Cuánto antes de cruzar la puerta se ve ya a la gente de dentro (m). */
const ROOM_MARGIN = 4;

/** ¿Hay alguien (el jugador o un peatón) cerca de la puerta? */
function someoneNear(x: number, y: number, z: number) {
  const dx = playerPos.x - x, dz = playerPos.z - z;
  if (dx * dx + dz * dz < OPEN_AT * OPEN_AT && Math.abs(playerPos.y - y) < 2.5) return true;
  for (let i = 0; i < npcs.count; i++) {
    const ex = npcs.pos[i * 3]! - x, ez = npcs.pos[i * 3 + 2]! - z;
    if (ex * ex + ez * ez < 2.2 * 2.2 && Math.abs(npcs.pos[i * 3 + 1]! - y) < 2.5) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Puertas correderas                                                   */
/* ------------------------------------------------------------------ */

const _box = new THREE.BoxGeometry(1, 1, 1);

export function SlidingDoors({ chunk, ambience, bloom }: { chunk: string; ambience: Ambience; bloom: boolean }) {
  const d = BY_CHUNK.get(chunk);
  const rooms = d ? LIFE[d.id]?.rooms ?? [] : [];
  const glass = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#16202e", metalness: 0.7, roughness: 0.12, transparent: true, opacity: 0.55, depthWrite: false }),
    [],
  );
  const edge = useMemo(() => {
    const c = new THREE.Color(d?.color ?? "#36d9ff");
    return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: neonGlow(ambience, bloom), toneMapped: !bloom });
  }, [d?.color, ambience, bloom]);
  useEffect(() => () => void (glass.dispose(), edge.dispose()), [glass, edge]);
  const open = useMemo(() => new Float32Array(rooms.length), [rooms]);
  const leaves = useRef<(THREE.Group | null)[]>([]);

  useFrame((_, dt) => {
    const k = Math.min(1, dt * 4);
    for (let n = 0; n < rooms.length; n++) {
      const door = rooms[n]!.door;
      const want = someoneNear(door.x, door.y, door.z) ? 1 : 0;
      open[n]! += (want - open[n]!) * k;
      const half = door.w / 2;
      // Cada hoja, de su mitad del hueco hacia dentro del muro.
      const a = leaves.current[n * 2], b = leaves.current[n * 2 + 1];
      if (a) a.position.x = -half / 2 - open[n]! * half * 0.96;
      if (b) b.position.x = half / 2 + open[n]! * half * 0.96;
    }
  });

  if (!rooms.length) return null;
  return (
    <>
      {rooms.map((r, n) => {
        const door = r.door;
        const half = door.w / 2;
        return (
          <group key={`${chunk}:${n}`} position={[door.x, door.y, door.z]} rotation-y={door.axis === "x" ? 0 : Math.PI / 2}>
            {[0, 1].map((side) => (
              <group key={side} ref={(g) => void (leaves.current[n * 2 + side] = g)} position-x={side ? half / 2 : -half / 2}>
                <mesh geometry={_box} material={glass} position-y={door.h / 2} scale={[half, door.h - 0.02, 0.06]} />
                {/* Filo de luz en el borde que se junta con la otra hoja. */}
                <mesh geometry={_box} material={edge} position={[side ? -half / 2 + 0.03 : half / 2 - 0.03, door.h / 2, 0]} scale={[0.05, door.h - 0.04, 0.08]} />
              </group>
            ))}
          </group>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Gente de los interiores y de la calle                                */
/* ------------------------------------------------------------------ */

interface Slot {
  who: number;
  motion: Motion;
  group: THREE.Group | null;
}

const Body = memo(function Body({ slot, seed }: { slot: Slot; seed: string }) {
  return (
    <group ref={(g) => void (slot.group = g)} visible={false}>
      <AvatarBody seed={seed} motion={slot.motion} extra />
    </group>
  );
});

/** ¿Se ve a la gente de esta sala (el jugador dentro o junto a su puerta)? */
function roomInView(r: Room) {
  const [x0, z0, x1, z1] = r.rect;
  const m = ROOM_MARGIN;
  return playerPos.x > x0 - m && playerPos.x < x1 + m && playerPos.z > z0 - m && playerPos.z < z1 + m && playerPos.y < r.y1;
}

export function Residents({ chunk, count }: { chunk: string; count: number }) {
  const d = BY_CHUNK.get(chunk);
  const life = d ? LIFE[d.id] : undefined;
  const people = life?.npcs ?? [];
  const n = Math.min(count, NPC_CITY);
  const slots = useMemo<Slot[]>(() => Array.from({ length: n }, () => ({ who: -1, motion: createMotion(), group: null })), [n]);
  const dist = useMemo(() => new Float32Array(people.length), [people]);
  const order = useMemo(() => Array.from({ length: people.length }, (_, k) => k), [people]);
  const inView = useMemo(() => new Uint8Array(life?.rooms.length ?? 0), [life]);
  const last = useRef(0);
  useEffect(() => {
    last.current = 0;
    for (const s of slots) s.who = -1;
  }, [chunk, slots]);

  useFrame(() => {
    if (!people.length || !life) return;
    const now = performance.now();
    if (now - last.current > REASSIGN_MS) {
      last.current = now;
      for (let r = 0; r < life.rooms.length; r++) inView[r] = roomInView(life.rooms[r]!) ? 1 : 0;
      for (let k = 0; k < people.length; k++) {
        const p = people[k]!;
        const dx = p.x - playerPos.x, dz = p.z - playerPos.z, dy = p.y - playerPos.y;
        const d2 = dx * dx + dz * dz + dy * dy * 4;
        dist[k] = p.room >= 0 ? (inView[p.room] ? d2 : Infinity) : d2 < RANGE * RANGE ? d2 : Infinity;
      }
      order.sort((a, b) => dist[a]! - dist[b]!);
      // Un hueco se queda con quien ya tenía si sigue entre los más cercanos (no se recarga nada).
      let keep = 0;
      for (const s of slots) {
        if (s.who < 0) continue;
        let ok = false;
        for (let k = 0; k < slots.length && k < order.length; k++) if (order[k] === s.who && dist[s.who]! < Infinity) ok = true;
        if (!ok) s.who = -1;
        else keep++;
      }
      for (let k = 0, put = keep; k < order.length && put < slots.length; k++) {
        const who = order[k]!;
        if (dist[who] === Infinity) break;
        if (slots.some((s) => s.who === who)) continue;
        const free = slots.find((s) => s.who < 0);
        if (!free) break;
        free.who = who;
        put++;
        free.motion.speed = 0;
        free.motion.emote = people[who]!.pose === "idle" ? null : people[who]!.pose;
      }
      // Colocados sobre el suelo de verdad (por si las colisiones del lugar llegaron después).
      for (const s of slots) {
        if (s.who < 0 || !s.group) continue;
        const p = people[s.who]!;
        s.group.position.set(p.x, floorAt(p.x, p.z, p.y + 0.4), p.z);
        // El frente de los personajes es su −Z: media vuelta respecto a hacia dónde mira.
        s.group.rotation.y = (p.yaw * Math.PI) / 180 + Math.PI;
      }
    }
    // Dibujados y sólidos (collision.ts: detrás de los peatones).
    let e = 0;
    for (const s of slots) {
      const g = s.group;
      if (!g) continue;
      g.visible = s.who >= 0;
      if (s.who < 0) continue;
      npcs.pos[(NPC_CITY + e) * 3] = g.position.x;
      npcs.pos[(NPC_CITY + e) * 3 + 1] = g.position.y;
      npcs.pos[(NPC_CITY + e) * 3 + 2] = g.position.z;
      e++;
    }
    npcs.extra = e;
  });
  useEffect(() => () => void (npcs.extra = 0), []);

  if (!d || !people.length || n <= 0) return null;
  return (
    <>
      {slots.map((s, k) => (
        <Body key={`${chunk}:${k}`} slot={s} seed={`res-${d.id}-${k}`} />
      ))}
    </>
  );
}
