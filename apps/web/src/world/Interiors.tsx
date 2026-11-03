/**
 * Vida de los interiores: puertas correderas que se abren al acercarse alguien y gente en su sitio
 * haciendo su vida (sentada, charlando, bailando, trabajando), que se da cuenta de ti. Todo sale de
 * la forja (`district-interiors.json`, tools/forge/interiors.py y cero.py): dónde están las salas,
 * sus puertas y la gente. Los sitios de la gente de la calle de Distrito Cero son ahora de los
 * ciudadanos (city/nav.ts). No son personas ni entidades del mundo: están en el mismo sitio para
 * todos (salen de la forja) y lo que se les hace se reparte a los de cerca (§9 nonies, `res`).
 *
 * Rendimiento (Quest 3): solo se dibujan los `FEATURES.residents` más cercanos, en huecos fijos (cada
 * hueco, siempre el mismo personaje de serie), y solo cuando el jugador está dentro de su sala o en su
 * puerta. Las puertas son dos cajas por sala; nada nuevo por frame.
 */
import { memo, Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import districts from "../../../realtime/src/districts.json";
import lives from "../../../realtime/src/district-interiors.json";
import type { Ambience } from "./graphics";
import { neonGlow } from "./materials";
import { AvatarBody } from "./Avatars";
import type { Motion } from "./motion";
import { playerPos } from "./Player";
import { floorAt, NPC_CITY, npcs } from "./collision";
import { knockApply, knockReset, npcMotion } from "./knock";
import { self } from "./self";
import { REPLY } from "./city/citizens";
import { npc, sendResHit } from "../net/npc-store";
import { Speech, type Speaker } from "./city/Speech";

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
  /** Sala donde está (-1: en la calle; esos sitios son ahora de los ciudadanos, city/nav.ts). */
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
const REASSIGN_MS = 500;
/** Cuánto antes de cruzar la puerta se ve ya a la gente de dentro (m). */
const ROOM_MARGIN = 4;

/** ¿Hay alguien (el jugador o un ciudadano) cerca de la puerta? */
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
/* Gente de los interiores                                              */
/* ------------------------------------------------------------------ */

interface Slot extends Speaker {
  who: number;
  motion: Motion;
  group: THREE.Group | null;
  /** Su sitio y su giro (para volver a él si le dan: knock.ts). */
  bx: number;
  by: number;
  bz: number;
  yaw: number;
  knocked: boolean;
  /** El golpe de este frame llega de otro (npc-store): no se vuelve a contar. */
  injected: boolean;
  /** Mirándote hasta `glance`; no vuelve a mirarte antes de `glanceNext`. */
  glance: number;
  glanceNext: number;
  /** Gesto pendiente de contestar y cuándo; hasta cuándo dura el que hace; hasta cuándo habla. */
  reply: string | null;
  replyAt: number;
  gestUntil: number;
  speechUntil: number;
}

const Body = memo(function Body({ slot, seed }: { slot: Slot; seed: string }) {
  return (
    <group ref={(g) => void (slot.group = g)} visible={false}>
      <AvatarBody seed={seed} motion={slot.motion} extra />
      <Suspense fallback={null}>
        <Speech who={slot} />
      </Suspense>
    </group>
  );
});

/** ¿Se ve a la gente de esta sala (el jugador dentro o junto a su puerta)? */
function roomInView(r: Room) {
  const [x0, z0, x1, z1] = r.rect;
  const m = ROOM_MARGIN;
  return playerPos.x > x0 - m && playerPos.x < x1 + m && playerPos.z > z0 - m && playerPos.z < z1 + m && playerPos.y < r.y1;
}

/** Contestan a tus gestos los que estén a menos de esto (m) y te miran si pasas a menos de esto. */
const ANSWER_AT = 7;
const LOOK_AT = 3.5;

/**
 * La gente de las salas (bares, club, mercado…): quieta en su sitio haciendo lo suyo, pero se da
 * cuenta de ti: te mira si te acercas, contesta a tus gestos con los brazos (sin levantarse) y dice
 * algo; si le das, se queja. Las calles son de los ciudadanos (city/citizens.ts).
 */
export function Residents({ chunk, count }: { chunk: string; count: number }) {
  const d = BY_CHUNK.get(chunk);
  const life = d ? LIFE[d.id] : undefined;
  const people = useMemo(() => (life?.npcs ?? []).filter((p) => p.room >= 0), [life]);
  const n = Math.min(count, NPC_CITY);
  const slots = useMemo<Slot[]>(
    () =>
      Array.from({ length: n }, () => ({
        who: -1,
        motion: npcMotion(),
        group: null,
        bx: 0,
        by: 0,
        bz: 0,
        yaw: 0,
        knocked: false,
        injected: false,
        glance: 0,
        glanceNext: 0,
        reply: null,
        replyAt: 0,
        gestUntil: 0,
        speech: null,
        speechUntil: 0,
        said: 0,
        dist: Infinity,
      })),
    [n],
  );
  const dist = useMemo(() => new Float32Array(people.length), [people]);
  const order = useMemo(() => Array.from({ length: people.length }, (_, k) => k), [people]);
  const inView = useMemo(() => new Uint8Array(life?.rooms.length ?? 0), [life]);
  const last = useRef(0);
  const lastEmote = useRef<string | null>(null);
  useEffect(() => {
    last.current = 0;
    for (const s of slots) {
      s.who = -1;
      s.knocked = false;
      knockReset(s.motion);
    }
  }, [chunk, slots]);

  useFrame((state) => {
    if (!people.length || !life) return;
    const now = performance.now();
    const clock = state.clock.elapsedTime;
    if (now - last.current > REASSIGN_MS) {
      last.current = now;
      for (let r = 0; r < life.rooms.length; r++) inView[r] = roomInView(life.rooms[r]!) ? 1 : 0;
      for (let k = 0; k < people.length; k++) {
        const p = people[k]!;
        const dx = p.x - playerPos.x, dz = p.z - playerPos.z, dy = p.y - playerPos.y;
        dist[k] = inView[p.room] ? dx * dx + dz * dz + dy * dy * 4 : Infinity;
      }
      order.sort((a, b) => dist[a]! - dist[b]!);
      // Un hueco se queda con quien ya tenía si sigue entre los más cercanos (no se recarga nada).
      let keep = 0;
      for (const s of slots) {
        if (s.who < 0) continue;
        let ok = false;
        for (let k = 0; k < slots.length && k < order.length; k++) if (order[k] === s.who && dist[s.who]! < Infinity) ok = true;
        if (!ok) {
          s.who = -1;
          s.knocked = false;
          s.speech = null;
          s.motion.gesture = null;
          knockReset(s.motion);
        } else keep++;
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
        s.bx = p.x;
        s.by = floorAt(p.x, p.z, p.y + 0.4);
        s.bz = p.z;
        // El frente de los personajes es su −Z: media vuelta respecto a hacia dónde mira.
        s.yaw = (p.yaw * Math.PI) / 180 + Math.PI;
        if (!s.knocked) {
          s.group.position.set(s.bx, s.by, s.bz);
          s.group.rotation.set(0, s.yaw, 0);
        }
      }
    }
    // Un gesto tuyo nuevo: te contesta quien esté más cerca (y a veces otro más).
    const emote = self.driving ? null : self.emote;
    let answer: Slot | null = null, second: Slot | null = null;
    if (emote !== lastEmote.current) {
      lastEmote.current = emote;
      if (emote && (REPLY[emote] || emote === "beckon" || emote === "dance")) {
        let da = ANSWER_AT, db = ANSWER_AT;
        for (const s of slots) {
          if (s.who < 0 || s.knocked || !s.group) continue;
          const dd = Math.hypot(s.bx - self.x, s.bz - self.z);
          if (Math.abs(s.by - self.y) > 1.5) continue;
          if (dd < da) (second = answer), (db = da), (answer = s), (da = dd);
          else if (dd < db) (second = s), (db = dd);
        }
      }
    }
    // Dibujados y sólidos (collision.ts: detrás de los ciudadanos).
    let e = 0;
    for (const s of slots) {
      const g = s.group;
      if (!g) continue;
      g.visible = s.who >= 0;
      if (s.who < 0) continue;
      s.dist = Math.hypot(s.bx - self.x, s.bz - self.z, (s.by - self.y) * 2);
      if (s.speech && clock > s.speechUntil) s.speech = null;
      if (s.motion.gesture && clock > s.gestUntil) s.motion.gesture = null;
      // Lo que le hacen los demás (§9 nonies: se reparte a los de cerca) y lo que le haces tú (se cuenta).
      const i = NPC_CITY + e;
      for (const h of npc.resHits) {
        if (h.res !== s.who || s.knocked || npcs.knock[i * 4]) continue;
        npcs.knock[i * 4] = now;
        npcs.knock[i * 4 + 1] = h.dir[0];
        npcs.knock[i * 4 + 2] = h.dir[1];
        npcs.knock[i * 4 + 3] = h.power;
        npcs.knockHead[i] = h.head ? 1 : 0;
        s.injected = true;
      }
      if (npcs.knock[i * 4]) {
        if (s.injected) s.injected = false;
        else sendResHit(s.who, npcs.knock[i * 4 + 1]!, npcs.knock[i * 4 + 2]!, npcs.knock[i * 4 + 3]!, npcs.knockHead[i] === 1, self.driving ? "car" : self.fight ? "hit" : "bump");
      }
      // Si le dan, lo encaja o cae y se levanta (knock.ts); después, a su sitio, a lo suyo y se queja.
      const k = knockApply(i, g, s.bx, s.by, s.bz, s.yaw, s.motion);
      if (!k && s.knocked) {
        g.position.set(s.bx, s.by, s.bz);
        g.rotation.set(0, s.yaw, 0);
        const pose = people[s.who]!.pose;
        s.motion.emote = pose === "idle" ? null : pose;
        say(s, Math.random() < 0.5 ? "npc.ouch" : "npc.leave", clock);
        s.glanceNext = clock + 20;
      }
      s.knocked = k;
      if (!k) attend(s, s === answer || (s === second && Math.random() < 0.5), s === answer, emote, clock);
      npcs.pos[i * 3] = g.position.x;
      npcs.pos[i * 3 + 1] = g.position.y;
      npcs.pos[i * 3 + 2] = g.position.z;
      e++;
    }
    npcs.extra = e;
    // Los golpes a quien no se ve aquí, se pierden (no hay nada que dibujar).
    npc.resHits.length = 0;
  }, -0.5);
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

function say(s: Slot, key: string, clock: number) {
  s.speech = key;
  s.speechUntil = clock + 2.6;
  s.said++;
}

/**
 * Lo que hace con su atención: contestar a tu gesto (si es a quien le toca), mirarte un momento si
 * pasas por delante, o mirar a lo suyo. Sin levantarse: con los brazos y la cabeza (Motion.gesture).
 */
function attend(s: Slot, answers: boolean, first: boolean, emote: string | null, clock: number) {
  const fx = s.motion.fx!;
  if (answers && emote) {
    const r = REPLY[emote];
    // Llamarle con la mano: está a lo suyo; bailar: aplaude.
    s.reply = emote === "beckon" ? "shake_head" : emote === "dance" ? "clap" : r ? (r.full ? "nod" : r.g) : null;
    s.replyAt = clock + 0.3 + Math.random() * 0.4;
    s.glance = s.replyAt + 2.6;
    if (first) {
      if (emote === "beckon") say(s, "npc.busy", clock);
      else if (r?.say) say(s, r.say[Math.floor(Math.random() * r.say.length)]!, clock);
    }
  }
  if (s.reply && clock >= s.replyAt) {
    s.motion.gesture = s.reply;
    s.gestUntil = clock + 2.6;
    s.reply = null;
  }
  const dx = self.x - s.bx, dz = self.z - s.bz, d = Math.hypot(dx, dz);
  const front = d > 0.1 ? (dx * -Math.sin(s.yaw) + dz * -Math.cos(s.yaw)) / d : 1;
  if (clock > s.glanceNext && clock > s.glance && d < LOOK_AT && front > -0.1 && Math.abs(self.y - s.by) < 1.5) {
    s.glance = clock + 1.5 + Math.random() * 1.5;
    s.glanceNext = s.glance + 5 + Math.random() * 5;
  }
  if (clock < s.glance && d < ANSWER_AT + 2) {
    fx.look.x = self.x;
    fx.look.y = self.y + 1.55;
    fx.look.z = self.z;
    fx.look.w = 0.7;
  } else fx.look.w = 0;
}
