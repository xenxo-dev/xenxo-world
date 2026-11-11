/**
 * Actividades en el mundo: avisa al servidor al llegar a un objeto de una búsqueda o a un punto de
 * una carrera, dibuja los puntos de carrera (aro en el suelo y columna de luz) y los marcadores.
 * El servidor decide todo (cercanía, orden, tiempo); aquí solo se avisa y se enseña.
 *
 * Rendimiento: un bucle por frame sin objetos nuevos (listas precalculadas al cambiar el mundo),
 * materiales y geometrías compartidos, y los marcadores se piden solo de cerca y cada 30 s.
 */
import { memo, Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { BoostV1, CheckpointV1, CollectibleV1, ScoreboardV1, TilesV1, TransformV1, type Entity } from "@xenxo/protocol";
import { t } from "../i18n";
import { accountToken } from "../net/account";
import { activity, boost, sendActivity, useActivity } from "../net/activity-store";
import { startLights } from "../net/round";
import { boardTitle, scoreValue } from "../net/scores";
import { useWorldVersion, world } from "../net/world-store";
import { SIGN_FONT_URL, FONT_URL } from "./font";
import { playerPos } from "./Player";
import { raceBeep, turboSound } from "./vehicle/audio";
import { carSpeed, drive, gridSpot } from "./vehicle/drive-state";

interface Zone {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
  kind: "collect" | "checkpoint" | "boost";
  role?: "start" | "cp" | "finish";
  race?: string;
  owner?: string;
  order?: number;
  /** Puesto de este punto entre los de su carrera (1 = el primero). */
  nth?: number;
  /** Cómo es su carrera (lo dice su salida): en coche y con parrilla (salida conjunta, por rondas). */
  vehicle?: "car";
  mode?: "grid";
  /** En la salida de una carrera con parrilla: sus cajones, su semáforo y hacia dónde se sale. */
  grid?: number[][];
  lights?: number[];
  /** Placas de impulso: velocidad, segundos y hacia dónde apuntan las flechas (giro en Y). */
  speed?: number;
  seconds?: number;
  yaw?: number;
}

const COLORS = { start: "#33ddff", cp: "#ffd54f", finish: "#ff4fd8" } as const;
const ringGeo = new THREE.RingGeometry(0.92, 1, 48);
ringGeo.rotateX(-Math.PI / 2);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
const MATS = new Map<string, THREE.MeshBasicMaterial>();
function glow(color: string, opacity: number) {
  const key = `${color}:${opacity}`;
  let m = MATS.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    MATS.set(key, m);
  }
  return m;
}

function zonesOf(list: Entity[]): Zone[] {
  const out: Zone[] = [];
  for (const e of list) {
    const tr = TransformV1.safeParse(e.components["transform@1"]);
    if (!tr.success) continue;
    const [ox, oz] = world.offsetOf(e.chunk_id);
    const [x, y, z] = tr.data.p;
    const col = CollectibleV1.safeParse(e.components["collectible@1"]);
    if (col.success) out.push({ id: e.entity_id, x: x + ox, y, z: z + oz, r: col.data.radius, kind: "collect" });
    const cp = CheckpointV1.safeParse(e.components["checkpoint@1"]);
    if (cp.success) {
      const zn: Zone = { id: e.entity_id, x: x + ox, y, z: z + oz, r: cp.data.radius, kind: "checkpoint", role: cp.data.role, race: cp.data.race, owner: e.owner, order: cp.data.order };
      if (cp.data.role === "start") {
        zn.vehicle = cp.data.vehicle;
        zn.mode = cp.data.mode;
        zn.grid = cp.data.grid?.map(([gx, gy, gz]) => [gx + ox, gy, gz + oz]);
        zn.lights = cp.data.lights && [cp.data.lights[0] + ox, cp.data.lights[1], cp.data.lights[2] + oz];
        const [qx, qy, qz, qw] = tr.data.r;
        zn.yaw = Math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qy * qy + qx * qx));
      }
      out.push(zn);
    }
    const bo = BoostV1.safeParse(e.components["boost@1"]);
    if (bo.success) {
      const [qx, qy, qz, qw] = tr.data.r;
      const yaw = Math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qy * qy + qx * qx));
      out.push({ id: e.entity_id, x: x + ox, y, z: z + oz, r: bo.data.radius, kind: "boost", speed: bo.data.speed, seconds: bo.data.seconds, yaw });
    }
  }
  // Cada punto sabe cómo es su carrera (lo dice la salida) y qué puesto ocupa entre los suyos.
  const same = (a: Zone, b: Zone) => a.race === b.race && a.owner === b.owner;
  for (const st of out) {
    if (st.kind !== "checkpoint" || st.role !== "start") continue;
    const cps = out.filter((z) => z.kind === "checkpoint" && z.role === "cp" && same(z, st)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    cps.forEach((z, i) => (z.nth = i + 1));
    for (const z of out) {
      if (z.kind !== "checkpoint" || !same(z, st)) continue;
      z.vehicle = st.vehicle;
      z.mode = st.mode;
    }
  }
  return out;
}

/** Parado en la parrilla: por debajo de esta velocidad (m/s) el coche entra en la carrera. */
const GRID_STOP = 2.5;
/** La parrilla llega un poco más allá de su círculo (m): quien aparca en el primer cajón también está en ella. */
const GRID_REACH = 1.5;

/**
 * Avisa al servidor al entrar en un círculo y, mientras sigas dentro, cada segundo (la pose que el
 * servidor tiene puede llegar un poco tarde, sobre todo tras un salto o un viaje). En la salida de
 * una carrera eso hace que el reloj empiece de verdad al salir del círculo.
 *
 * En las carreras con parrilla (salida conjunta): se entra parándose en la parrilla (pasar de largo
 * no apunta a nadie), corre cualquiera —también sin cuenta— y, en carrera, solo se avisa de la
 * puerta que toca. En coche, las placas de impulso son un turbo por pasada.
 */
function Sensor({ zones }: { zones: Zone[] }) {
  const inside = useRef(new Map<string, number>());
  const guestWarned = useRef(false);
  /** Corría en una ronda (y, al dejarla, toca moverse antes de entrar en otra: quien se queda parado en la parrilla no encadena carreras sin estar). */
  const wasLive = useRef(false);
  const needMove = useRef(false);
  useEffect(() => {
    inside.current.clear();
  }, [zones]);
  useFrame(() => {
    if (world.status !== "open" || zones.length === 0) return;
    const signed = !!accountToken();
    const now = performance.now();
    const driving = drive.phase === "drive";
    activity.expireRound(now);
    const live = !!activity.round?.live;
    if (wasLive.current && !live) needMove.current = true;
    wasLive.current = live;
    if (needMove.current && (!driving || Math.abs(carSpeed()) > GRID_STOP + 2)) needMove.current = false;
    for (const zn of zones) {
      const dx = playerPos.x - zn.x, dz = playerPos.z - zn.z;
      const gridStart = zn.mode === "grid" && zn.role === "start";
      const r = gridStart ? zn.r + GRID_REACH : zn.r;
      const isIn = dx * dx + dz * dz <= r * r && Math.abs(playerPos.y - zn.y) <= 4 + zn.r;
      if (!isIn) {
        inside.current.delete(zn.id);
        continue;
      }
      // Placa de impulso: solo en el cliente (no se avisa al servidor), también para invitados.
      if (zn.kind === "boost") {
        if (driving) {
          // Al volante: un turbo por pasada.
          if (!inside.current.has(zn.id)) {
            inside.current.set(zn.id, now);
            if (drive.sim?.turbo()) turboSound();
          }
        } else {
          boost.until = now + (zn.seconds ?? 2) * 1000;
          boost.speed = zn.speed ?? 9;
        }
        continue;
      }
      const last = inside.current.get(zn.id);
      if (last !== undefined && now - last < 1000) continue;
      if (zn.mode === "grid") {
        const rd = activity.round;
        const mine = !!rd && rd.live && rd.race === zn.race && rd.owner === zn.owner;
        if (zn.role === "start") {
          if (mine) continue; // ya estoy en la que se forma (o corriendo: paso por la parrilla)
          if (zn.vehicle === "car" && !driving) {
            // A pie en la parrilla: se dice una vez por visita que es en coche.
            if (last === undefined && drive.phase === "none") activity.notice({ kind: "needCar", at: now });
            inside.current.set(zn.id, now);
            continue;
          }
          if (zn.vehicle === "car" && (needMove.current || Math.abs(carSpeed()) > GRID_STOP)) continue;
        } else {
          const run = activity.race;
          if (!mine || !run || run.race !== zn.race) continue;
          if (run.next > run.total ? zn.role !== "finish" : zn.role !== "cp" || zn.nth !== run.next) continue;
        }
        inside.current.set(zn.id, now);
        sendActivity("CHECKPOINT", zn.id);
        continue;
      }
      inside.current.set(zn.id, now);
      if (zn.kind === "collect" && activity.collected.has(zn.id)) continue;
      if (!signed) {
        if (!guestWarned.current) {
          guestWarned.current = true;
          activity.notice({ kind: "guest", at: now });
        }
        continue;
      }
      sendActivity(zn.kind === "collect" ? "COLLECT" : "CHECKPOINT", zn.id);
    }
  });
  return null;
}

/** Aro en el suelo y columna de luz de un punto de carrera; el que toca, más brillante. */
const CheckpointMark = memo(function CheckpointMark({ zone, hot }: { zone: Zone; hot: boolean }) {
  const color = COLORS[zone.role ?? "cp"];
  const tall = zone.role === "cp" ? 2.5 : 4.5;
  return (
    <group position={[zone.x, zone.y + 0.03, zone.z]}>
      <mesh geometry={ringGeo} material={glow(color, hot ? 0.95 : 0.45)} scale={[zone.r, 1, zone.r]} />
      <mesh geometry={beamGeo} material={glow(color, hot ? 0.1 : 0.04)} scale={[zone.r * 0.98, tall, zone.r * 0.98]} position={[0, tall / 2, 0]} />
    </group>
  );
});

function Checkpoints({ zones }: { zones: Zone[] }) {
  const a = useActivity();
  const run = a.race;
  // Las carreras con parrilla van por un circuito cerrado: sus puntos no se pintan (RaceGrid pone
  // el semáforo y el cajón de cada cual).
  const cps = zones.filter((z) => z.kind === "checkpoint" && z.mode !== "grid");
  // Sin carrera se ven solo las salidas (en Vertical hay siete carreras: con todos sus puntos, las
  // Pilas se llenarían de columnas de luz); durante una, solo los de la tuya, con el que toca (o la
  // meta) más brillante y tu salida, por si quieres empezar otra vez.
  const shown = run ? cps.filter((z) => z.race === run.race) : cps.filter((z) => z.role === "start");
  const hot = (z: Zone) => {
    if (!run) return true;
    if (run.next > run.total) return z.role === "finish";
    return z.role === "cp" && z.order === cpOrder(cps, run.race, run.next);
  };
  return (
    <>
      {shown.map((z) => (
        <CheckpointMark key={z.id} zone={z} hot={hot(z)} />
      ))}
    </>
  );
}

/* --- Carreras con parrilla: el semáforo de la salida y el cajón que me ha tocado --- */

const lightGeo = new THREE.SphereGeometry(0.27, 16, 12);
const LIGHT_OFF = new THREE.MeshBasicMaterial({ color: "#3a1218" });
const LIGHT_RED = new THREE.MeshBasicMaterial({ color: "#ff2a3c", toneMapped: false });
const LIGHT_GREEN = new THREE.MeshBasicMaterial({ color: "#3dff7c", toneMapped: false });
const GLOW_RED = glow("#ff2a3c", 0.35);
const GLOW_GREEN = glow("#3dff7c", 0.4);
const slotGeo = new THREE.PlaneGeometry(2.7, 4.9).rotateX(-Math.PI / 2);
const SLOT_MAT = new THREE.MeshBasicMaterial({ color: "#36d9ff", transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
/** Separación entre luces del semáforo (m): la de la forja (checkpoint@1.lights). */
const LIGHT_GAP = 1.1;

/**
 * La salida de una carrera con parrilla. El semáforo (cinco luces sobre la pista: una roja más cada
 * segundo y verdes en la salida, con la hora del servidor) lo ve todo el mundo; a quien entra en la
 * ronda se le marca su cajón y su coche va solo hasta él (vehicle/drive.ts lee `gridSpot`).
 */
function RaceGrid({ zone }: { zone: Zone }) {
  const a = useActivity();
  const lamps = useRef<(THREE.Mesh | null)[]>([]);
  const halos = useRef<(THREE.Mesh | null)[]>([]);
  const slot = useRef<THREE.Mesh>(null);
  const shown = useRef(-1);
  const rd = a.round && a.round.race === zone.race && a.round.owner === zone.owner ? a.round : null;
  const me = rd?.live && rd.state === "countdown" ? rd.entrants.find((e) => e.session_id === world.sessionId) : undefined;
  const spot = me?.slot !== undefined ? zone.grid?.[me.slot] : undefined;
  // Hacia dónde se sale (adelante = −Z girado `yaw`) y, de lado a lado, la fila de luces.
  const yaw = zone.yaw ?? 0;
  const sx = Math.cos(yaw), sz = -Math.sin(yaw);
  useEffect(() => {
    if (!spot) return;
    gridSpot.on = true;
    gridSpot.x = spot[0]!;
    gridSpot.z = spot[2]!;
    gridSpot.yaw = yaw + Math.PI; // el coche mide su giro desde +Z
    return () => {
      gridSpot.on = false;
    };
  }, [spot, yaw]);
  useFrame((st) => {
    if (slot.current) SLOT_MAT.opacity = 0.2 + 0.14 * Math.sin(st.clock.elapsedTime * 6);
    if (!zone.lights) return;
    const l = startLights(rd, world.serverNow(), performance.now());
    const code = l.green ? 6 : l.red;
    if (code === shown.current) return;
    // Un pitido por luz y uno largo en la salida, para quien está cerca.
    const dx = playerPos.x - zone.x, dz = playerPos.z - zone.z;
    if (shown.current >= 0 && code > 0 && dx * dx + dz * dz < 70 * 70) raceBeep(l.green);
    shown.current = code;
    for (let k = 0; k < 5; k++) {
      const on = l.green || k < l.red;
      const lamp = lamps.current[k], halo = halos.current[k];
      if (lamp) lamp.material = l.green ? LIGHT_GREEN : on ? LIGHT_RED : LIGHT_OFF;
      if (halo) {
        halo.visible = on;
        halo.material = l.green ? GLOW_GREEN : GLOW_RED;
      }
    }
  });
  return (
    <>
      {zone.lights &&
        [0, 1, 2, 3, 4].map((k) => (
          <group key={k} position={[zone.lights![0]! + sx * (k - 2) * LIGHT_GAP, zone.lights![1]!, zone.lights![2]! + sz * (k - 2) * LIGHT_GAP]}>
            <mesh ref={(m) => void (lamps.current[k] = m)} geometry={lightGeo} material={LIGHT_OFF} />
            <mesh ref={(m) => void (halos.current[k] = m)} geometry={lightGeo} material={GLOW_RED} scale={1.9} visible={false} />
          </group>
        ))}
      {spot && <mesh ref={slot} geometry={slotGeo} material={SLOT_MAT} position={[spot[0]!, spot[1]! + 0.05, spot[2]!]} rotation={[0, yaw, 0]} renderOrder={2} />}
    </>
  );
}

/** El `order` del n-ésimo punto `cp` (por orden) de una carrera. */
function cpOrder(cps: Zone[], race: string, n: number): number | undefined {
  return cps
    .filter((z) => z.race === race && z.role === "cp")
    .map((z) => z.order ?? 0)
    .sort((a, b) => a - b)
    .at(n - 1);
}

/* --- Placas de impulso: tres flechas de luz que avanzan (un material para todas) --- */

const chevronGeo = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.15);
  shape.lineTo(0, 0.25);
  shape.lineTo(0.5, -0.15);
  shape.lineTo(0.5, 0.1);
  shape.lineTo(0, 0.5);
  shape.lineTo(-0.5, 0.1);
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2); // tumbada; la punta hacia −Z (adelante)
  return g;
})();
const CHEVRON_MATS = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: "#36d9ff", transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));

function BoostPads({ zones }: { zones: Zone[] }) {
  const pads = zones.filter((z) => z.kind === "boost");
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    // Una ola que recorre las flechas de atrás adelante: dice hacia dónde empuja.
    CHEVRON_MATS.forEach((m, k) => (m.opacity = 0.25 + 0.6 * Math.max(0, Math.sin(t * 6 - k * 1.1))));
  });
  return (
    <>
      {pads.map((z) => (
        <group key={z.id} position={[z.x, z.y + 0.04, z.z]} rotation={[0, z.yaw ?? 0, 0]}>
          <mesh geometry={ringGeo} material={glow("#36d9ff", 0.5)} scale={[z.r, 1, z.r]} />
          {CHEVRON_MATS.map((m, k) => (
            <mesh key={k} geometry={chevronGeo} material={m} scale={[z.r * 1.1, 1, z.r * 1.1]} position={[0, 0.01 * k, (0.55 - k * 0.55) * z.r]} />
          ))}
        </group>
      ))}
    </>
  );
}

/* --- Tablero de baldosas (tiles@1): lo que enciende el servidor, encima de las losas --- */

const TILE_TINTS = ["#ff4fd8", "#4fa3ff", "#ffd54f", "#6dff8a", "#ff7a45", "#a26bff"].map((c) => new THREE.Color(c));
const TILE_OFF = new THREE.Color("#0b0d16");
const TILE_DONE = new THREE.Color("#ffffff");
const TILE_WON = new THREE.Color("#6dff8a");
const tileGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const TILE_MAT = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
const _tm = new THREE.Matrix4();
const _tc = new THREE.Color();

function TileBoard({ entity }: { entity: Entity }) {
  const a = useActivity();
  const ref = useRef<THREE.InstancedMesh>(null!);
  const tr = TransformV1.safeParse(entity.components["transform@1"]);
  const tb = TilesV1.safeParse(entity.components["tiles@1"]);
  const st = a.tiles.get(entity.entity_id);
  const ok = tr.success && tb.success;
  const cols = tb.success ? tb.data.cols : 0, rows = tb.success ? tb.data.rows : 0, size = tb.success ? tb.data.size : 1;
  // Posiciones fijas (al montar); los colores cambian con cada TILES (pocas veces), no por frame.
  useEffect(() => {
    const im = ref.current;
    if (!im || !ok) return;
    const [ox, oz] = world.offsetOf(entity.chunk_id);
    const [x, y, z] = tr.data!.p;
    const x0 = x + ox - (cols * size) / 2, z0 = z + oz - (rows * size) / 2;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        _tm.makeScale(size * 0.92, 1, size * 0.92).setPosition(x0 + (c + 0.5) * size, y + 0.14, z0 + (r + 0.5) * size);
        im.setMatrixAt(r * cols + c, _tm);
      }
    im.instanceMatrix.needsUpdate = true;
  }, [ok, entity, cols, rows, size]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const im = ref.current;
    if (!im || !ok) return;
    const lit = new Set(st?.lit ?? []), done = new Set(st?.done ?? []);
    const tint = TILE_TINTS[(st?.round ?? 0) % TILE_TINTS.length]!;
    for (let i = 0; i < cols * rows; i++) {
      if (st?.state === "won" && lit.has(i)) _tc.copy(TILE_WON);
      else if (st?.state === "show" && done.has(i)) _tc.copy(TILE_DONE);
      else if (st?.state === "show" && lit.has(i)) _tc.copy(tint);
      else if (!st || st.state === "idle") _tc.copy(TILE_TINTS[(i + Math.floor(i / cols)) % TILE_TINTS.length]!).multiplyScalar(0.12); // en reposo: damero tenue
      else _tc.copy(TILE_OFF);
      im.setColorAt(i, _tc);
    }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, [st, ok, cols, rows]);
  if (!ok) return null;
  return <instancedMesh ref={ref} args={[tileGeo, TILE_MAT, cols * rows]} frustumCulled={false} renderOrder={2} />;
}

/* --- Marcadores --- */

const PANEL_MAT = new THREE.MeshBasicMaterial({ color: "#0b0f18", transparent: true, opacity: 0.86 });
const panelGeo = new THREE.PlaneGeometry(1, 1);

/** Título del marcador según lo que cuenta y de cuándo. */
function Scoreboard({ entity }: { entity: Entity }) {
  const a = useActivity();
  const tr = TransformV1.safeParse(entity.components["transform@1"]);
  const sb = ScoreboardV1.safeParse(entity.components["scoreboard@1"]);
  const last = useRef(0);
  const pos = useMemo(() => {
    if (!tr.success) return null;
    const [ox, oz] = world.offsetOf(entity.chunk_id);
    return new THREE.Vector3(tr.data.p[0] + ox, tr.data.p[1], tr.data.p[2] + oz);
  }, [entity, tr.success]); // eslint-disable-line react-hooks/exhaustive-deps
  // Se pide de cerca (40 m) y como mucho cada 30 s.
  useFrame(() => {
    if (!pos || world.status !== "open") return;
    const now = performance.now();
    if (now - last.current < 30_000) return;
    if (pos.distanceToSquared(playerPos) > 40 * 40) return;
    last.current = now;
    sendActivity("SCORES_GET", entity.entity_id);
  });
  if (!tr.success || !sb.success || !pos) return null;
  const [w, h] = sb.data.size;
  const rows = a.scores.get(entity.entity_id) ?? [];
  const line = h / 13;
  const value = (v: number, ts: number) => scoreValue(sb.data.kind, v, ts);
  return (
    <group position={pos} quaternion={tr.data.r}>
      <mesh geometry={panelGeo} material={PANEL_MAT} scale={[w, h, 1]} />
      <Text font={SIGN_FONT_URL} fontSize={line * 1.4} color="#33ddff" anchorX="center" anchorY="top" position={[0, h / 2 - line * 0.6, 0.01]}>
        {boardTitle(sb.data.kind, sb.data.period)}
      </Text>
      <Text font={FONT_URL} fontSize={line * 0.8} color="#e8edf7" anchorX="left" anchorY="top" lineHeight={1.35} position={[-w / 2 + line, h / 2 - line * 2.6, 0.01]} maxWidth={w - 2 * line}>
        {rows.length ? rows.map((r, i) => `${i + 1}. ${r.name}${r.player_no !== undefined ? ` #${r.player_no}` : ""} — ${value(r.value, r.ts)}`).join("\n") : t("activity.boardEmpty")}
      </Text>
    </group>
  );
}

export function Activities() {
  useWorldVersion();
  const list = [...world.entities.values()];
  const key = list.length + ":" + world.getEntitiesVersion();
  const zones = useMemo(() => zonesOf(list.filter((e) => e.components["collectible@1"] || e.components["checkpoint@1"] || e.components["boost@1"])), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const boards = list.filter((e) => e.components["scoreboard@1"]);
  const tileBoards = list.filter((e) => e.components["tiles@1"]);
  return (
    <>
      <Sensor zones={zones} />
      <Checkpoints zones={zones} />
      {zones.map((z) => (z.kind === "checkpoint" && z.role === "start" && z.mode === "grid" ? <RaceGrid key={z.id} zone={z} /> : null))}
      <BoostPads zones={zones} />
      {tileBoards.map((e) => (
        <TileBoard key={`${e.entity_id}:${e.rev}`} entity={e} />
      ))}
      <Suspense fallback={null}>
        {boards.map((e) => (
          <Scoreboard key={`${e.entity_id}:${e.rev}`} entity={e} />
        ))}
      </Suspense>
    </>
  );
}
