/**
 * ChunkRoom — servidor autoritativo de un chunk del mundo.
 *
 * - Es la ÚNICA puerta de escritura del mundo: humanos y agentes pasan por aquí.
 * - Estado vivo en su SQLite (entidades, log de eventos, claves de idempotencia).
 * - Poses efímeras en memoria, cada una con la hora en que se tomó (pose-clock.ts), repartidas al momento con
 *   poca gente y en lotes con más (casi sin temporizadores: el objeto hiberna).
 * - WebSocket Hibernation: cuando no hay mensajes, el objeto duerme y no factura duración.
 */
import { DurableObject } from "cloudflare:workers";
import {
  ACCEPTED_IN_V0,
  BUDGETS,
  FIGHT_HP,
  FIGHT_RESPAWN_MS,
  hpAt,
  CheckpointV1,
  CHUNK_SIZE,
  ClientMessage,
  CollectibleV1,
  ScoreboardV1,
  TilesV1,
  ComponentsStrict,
  ENTITY_SCHEMA,
  EntityId,
  estimateTris,
  MeshV1,
  msg,
  PARCEL_BUDGETS,
  PLACES,
  PROTOCOL_VERSION,
  type AvatarPose,
  type Components,
  type Entity,
  type ErrorCode,
  type MutationOp,
  type Peer,
  type FightMove,
  type FightStyle,
  type NpcHitKind,
  type NpcSnap,
  type PairAction,
  type Reaction,
  isLootTable,
  rollLoot,
  SHOT_MAX_DY,
  SHOT_MAX_RANGE,
  usableWeapons,
  WEAPONS,
  type WeaponId,
} from "@xenxo/protocol";
import type { Env } from "./index";
import { randomId, type Principal } from "./auth";
import { plazaSeed, SEED_VERSION } from "./seed";
import { billboardSlots, cabinetSlots, residentsOf, sandboxOf, type SandboxRect, DISTRICT_BOUNDS, districtByChunk, districtSeed, DISTRICT_SEED_VERSION, migrateParcelPose, migrateSlot, PARCEL_LAYOUT_VERSION, PARCELS, parcelIndex, parcelReserved, parcelSlot } from "./districts";
import { communityGates, nexoArrival, NEXO_BOUNDS, NEXO_SEED_VERSION, nexoSeed, SHOWCASE_SLOTS } from "./nexo";
import { at, portalEntities, r3, yaw, type Seeded } from "./places";

/** Pantalla de la máquina recreativa (tools/models/generated/arcade_cabinet): centro y tamaño. */
const CABINET_SCREEN = { y: 1.18, z: 0.34, size: [0.56, 0.5] as [number, number] };
import { isCommunityChunk, type CommunityMeta } from "./community";
import type { PlaceFlags } from "./ops";
import { fitsZone, localBox, worldBox, type Zone } from "./zone";
import { assetKey } from "./assets";
import { ACTIVITY_SCHEMA, activityKey, ARRIVALS_FREE, ARRIVALS_WINDOW_MS, isoWeek, JUMP_COOLDOWN_MS, weekStart, minRaceMs, MOVE_BURST, FOOT_BURST, near, POSE_MAX_AGE_MS, RACE_TIMEOUT_MS, SCORES_LIMIT, stepMove, unitQuat, MAX_SPEED, type Move, type RaceRun } from "./activities";
import { SEED_ASSETS } from "./seed-assets";
import { figureFor, pointsDay, TILES_IDLE_MS, TILES_PAUSE_MS, TILES_SCHEMA, TILES_START_MS, tileAt, tilesRoundMs, type TileBoard, type TileGame } from "./tiles";
import { isAvatarPreset } from "./avatar-presets-check";
import { allowSample, batchGap, roundP, roundR, stampSample, type PoseClock } from "./pose-clock";
import { CAR_SPEED, dropIdle, joinRound, minRoundMs, passGate, roundOver, standings, startRound, type Round } from "./rounds";
import { damageOf, dodges, DOWN_IMMUNE_MS, DUEL_WINDOW_MS, HIT_GAP_MS, HIT_MAX_DY, hitOutcome, moveAllowed, PAIR_OFFER_RANGE, PAIR_START_RANGE, PAIR_TTL_MS, REACH, REACT_GAP_MS, styleOf } from "./people";

const TICK_HZ = 8;
/** En lugares más grandes que un chunk, cada uno recibe las poses de quien tiene a menos de esto (m). */
const AOI_RADIUS = 70;

/** Triángulos de cada LOD de las piezas de la forja (para usarlas sin pasar por R2). */
const SYSTEM_LODS = new Map(Object.values(SEED_ASSETS).flatMap((a) => a.lods.map((l) => [l.hash, l.tris] as const)));
/** Medidas guardadas al subir un modelo (customMetadata.bounds), o null si no se pueden leer. */
function parseBounds(raw: string | undefined): { min: number[]; max: number[] } | null {
  try {
    const b = raw ? (JSON.parse(raw) as { min?: number[]; max?: number[] }) : null;
    return b && Array.isArray(b.min) && Array.isArray(b.max) && b.min.length === 3 && b.max.length === 3 ? { min: b.min, max: b.max } : null;
  } catch {
    return null;
  }
}

/** Medidas de las piezas del sistema (para comprobar que caben en una parcela). */
const SYSTEM_BOUNDS = new Map(Object.values(SEED_ASSETS).flatMap((a) => a.lods.map((l) => [l.hash, a.lods[0]!.bounds] as const)));

/** Ids de las entidades del portal de un proyecto en su parcela. */
function standIds(projectId: string) {
  return {
    portal: `stand_${projectId}`,
    band: `standb_${projectId}`,
    monument: `standm_${projectId}`,
    label: `standl_${projectId}`,
    frame: `standf_${projectId}`,
    pedestal: `standp_${projectId}`,
  };
}

/** Ids de las entidades de un proyecto en el escaparate del nexo. */
function showIds(projectId: string) {
  return { portal: `show_${projectId}`, band: `showb_${projectId}`, monument: `showm_${projectId}`, label: `showl_${projectId}` };
}

/** Lo que el escaparate del nexo necesita de cada proyecto (lo manda el Worker desde el Directory). */
export interface ShowcaseItem {
  projectId: string;
  title: string;
  category: string;
  cover: string;
  mesh: { hash: string; bounds: { min: number[]; max: number[] } | null } | null;
  chunk: string;
  spawn: [number, number, number];
  yaw: number;
}

/** Huella corta de un texto (FNV-1a de 32 bits). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
const CHAT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** El chat se recorta a sus últimos CHAT_KEEP mensajes cada CHAT_TRIM_EVERY (no en cada uno: cuesta filas leídas). */
const CHAT_KEEP = 2000;
const CHAT_TRIM_EVERY = 100;
const MAX_MESSAGE_BYTES = 64 * 1024;
/**
 * Mensajes por conexión (de cualquier tipo): un cubo de MSG_BURST que se rellena a MSG_RATE por
 * segundo; cada 8 KB cuentan uno más. Quien lo vacía se queda sin conexión (4008). Las poses a 15 Hz,
 * el chat y las actividades caben de sobra.
 */
const MSG_BURST = 120;
const MSG_RATE = 40;
/** Conexiones a la vez de la misma cuenta (o agente) en un chunk: al pasar, se cierra la más vieja. */
const MAX_CONN_PER_SUB = 8;
/** Las manos van con la cabeza: más lejos que esto (m), no se reparten. */
const HAND_REACH = 2.5;
/** Un marcador se lee de la base como mucho una vez cada esto (ms), salvo que cambie algo. */
const SCORES_CACHE_MS = 5000;
/** Registro de eventos e idempotencia: cuánto se guardan y cuánto se poda de una vez (sin alarmas). */
const IDEM_RETENTION_MS = 24 * 60 * 60 * 1000;
const EVENTS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const PRUNE_BATCH = 500;
/** Un evento guarda como mucho esto de datos (lo que pasa se resume). */
const EVENT_DATA_MAX = 4096;
/** Piezas en la zona de pruebas, entre todos (además del tope por persona). */
const SANDBOX_TOTAL = 240;
/** Ids que los clientes no pueden elegir: los ponen el sistema y el Worker (portales, máquinas, anuncios). */
const RESERVED_IDS = /^(stand[a-z]?|show[a-z]?|cabinet|billboard|nexo)_/i;
/**
 * Lo que gasta el presupuesto del chunk (BUDGETS): lo construido fuera de las parcelas (que tienen el
 * suyo), de la zona de pruebas (el suyo) y de los portales de los proyectos (uno por parcela).
 */
const CHUNK_BUDGET_WHERE =
  "owner NOT IN ('system', 'cabinets', 'billboards', 'community_gates') AND owner NOT LIKE 'prj!_%' ESCAPE '!' AND owner NOT LIKE 'dst!_%' ESCAPE '!'" +
  " AND entity_id NOT IN (SELECT entity_id FROM sandbox) AND NOT (entity_id GLOB 'stand_*' OR entity_id GLOB 'stand[a-z]_*' OR entity_id GLOB 'show_*' OR entity_id GLOB 'show[a-z]_*')";
/**
 * Servidor de distritos: medidas de los modelos que ya se le pidieron al Worker (los modelos van por
 * hash: lo que existe no cambia). Las de «no existe», poco tiempo.
 */
const REMOTE_META = new Map<string, { meta: { customMetadata?: Record<string, string> } | null; until: number }>();
const REMOTE_META_MAX = 2000;
const REMOTE_META_TTL_MS = 60 * 60 * 1000;
const REMOTE_META_MISS_MS = 60 * 1000;
/** Escritura en `entities` (para invalidar las cachés que salen de ella). */
const ENTITY_WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b[^]*?\bentities\b/i;

/**
 * Texto que viene de la gente (nombres y chat): NFKC, sin caracteres de control ni de formato
 * (bidi, anchura cero, guion invisible…), sin rellenos de Hangul ni pilas de marcas combinadas.
 */
function cleanText(raw: string, max: number): string {
  const s = raw
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}ᅟᅠㅤﾠ⠀]/gu, " ")
    .replace(/(\p{M}{3})\p{M}+/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return [...s].slice(0, max).join("").trim();
}

type CheckpointData = ReturnType<typeof CheckpointV1.parse>;
/** Una entidad de actividad del lugar (búsqueda o punto de carrera), como la da `activityEntities`. */
type ActivityItem = { id: string; owner: string; p: number[]; cp?: CheckpointData };

interface Attachment {
  session_id: string;
  principal: Principal;
  hello: boolean;
  client_type: Peer["client_type"];
  display_name: string;
  /** Cuándo se abrió (para cerrar la más vieja de una cuenta). */
  since?: number;
  /** Ya mandó alguna pose (si el objeto hiberna, la siguiente no es una llegada libre). */
  posed?: boolean;
  /** Avatar de serie elegido en HELLO (invitados y agentes). */
  preset?: { hash: string; format: "vrm" };
  /** Carrera en curso (activities.ts). */
  run?: RaceRun;
  /** Modo pelea activado (people.ts): solo con él se puede golpear y recibir golpes. */
  fight?: boolean;
  /** Sabe llevar a los ciudadanos (HELLO `capabilities.npc_host`, §9 nonies) y no ha dicho que no. */
  npc?: boolean;
}

/** Cada cuánto, como poco, manda su estado quien lleva a los ciudadanos (ms) y cuándo se le da por perdido. */
const NPC_STATE_GAP_MS = 120;
const NPC_STALE_MS = 4_000;
/** Golpes y propuestas a los ciudadanos por sesión: como mucho estos por segundo. */
const NPC_EVENTS_PER_S = 6;

class MutationError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

/** Lo que se lleva un chunk al cambiar de servidor (dumpState/loadState). */
export interface ChunkDump {
  chunk: string;
  parcel_layout: string | null;
  entities: { entity_id: string; owner: string; rev: number; tris: number; data: string }[];
  stands: { project_id: string; slot: number }[];
  chat: { id: string; ts: number; sender: string; kind: string; display_name: string; session_id: string; text: string; hidden: number }[];
  /** Actividades: lo recogido, las búsquedas completas y los mejores tiempos (activities.ts). */
  activities?: { collected: Record<string, unknown>[]; hunts: Record<string, unknown>[]; races: Record<string, unknown>[]; points?: Record<string, unknown>[]; race_weeks?: Record<string, unknown>[]; loot?: Record<string, unknown>[] };
  /** Distrito de la comunidad: lo que es (con lo del sistema que lleva). Ausente en los demás. */
  community?: string | null;
  /** Zona de pruebas: de quién es cada pieza y de qué día (sin esto no se vaciaría sola al cambiar de servidor). */
  sandbox?: { entity_id: string; owner: string; day: string; light: number }[];
}

export class ChunkRoom extends DurableObject<Env> {
  /** SQLite del objeto; cada escritura en `entities` invalida las cachés que salen de ella. */
  private sql: Pick<SqlStorage, "exec">;
  private chunkId: string | null = null;
  /** Ids de la semilla de este lugar (los clientes no pueden usarlos). */
  private seedIds = new Set<string>();
  /** Sube con cada escritura en `entities`: las cachés guardan la vuelta con la que se hicieron. */
  private entityEpoch = 1;
  private entitiesJsonCache: { epoch: number; json: string } | null = null;
  private activityCache: { epoch: number; list: ReturnType<ChunkRoom["readActivityEntities"]> } | null = null;
  private scoreCache = new Map<string, { at: number; value: ReturnType<ChunkRoom["scoreRows"]> }>();
  /** Mensajes que le quedan a cada conexión (ver MSG_BURST). */
  private buckets = new Map<string, { tokens: number; t: number }>();
  /** Movimiento de cada sesión (activities.ts → stepMove). */
  private moves = new Map<string, Move>();
  /** Llegadas recientes de cada cuenta (HELLO) y sesiones cuya llegada ya no es libre. */
  private arrivals = new Map<string, number[]>();
  private hotArrival = new Set<string>();
  private chatSinceTrim = 0;
  private lastPrune = 0;
  /** Si es un distrito de la comunidad (community.ts): qué es. Se guarda en meta 'community'. */
  private community: CommunityMeta | null = null;
  private poses = new Map<string, AvatarPose>();
  private dirty = new Set<string>();
  private lastPoseAt = new Map<string, number>();
  /** De cada sesión: su reloj (para fechar cada muestra como se tomó) y su tope de frecuencia (pose-clock.ts). */
  private poseClocks = new Map<string, PoseClock>();
  private poseTat = new Map<string, number>();
  /** Carreras de salida conjunta (rounds.ts): las rondas que se están formando o corriendo, y el temporizador de su salida. */
  private rounds: Round[] = [];
  private roundSeq = 0;
  private roundTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private mutationLog = new Map<string, number[]>();
  private chatLog = new Map<string, number[]>();
  private activityLog = new Map<string, number[]>();
  /** Último reparto de poses (ms) y el temporizador corto que se deja solo si hace falta (ver `scheduleTick`). */
  private lastTick = 0;
  /** Tableros de baldosas (tiles@1) del lugar, leídos como mucho cada 10 s, y sus partidas. */
  private tileBoardsAt = 0;
  private tileBoardsList: TileBoard[] = [];
  private tileGames = new Map<string, TileGame>();
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  /** Gente (people.ts): última reacción, propuestas en pareja, golpes y caídas de cada sesión. */
  private reactAt = new Map<string, number>();
  private pairOffers = new Map<string, { to: string; kind: PairAction; t: number }>();
  private hitAt = new Map<string, number>();
  /** Último disparo de cada sesión (armas, §9 octies ter). */
  private shotAt = new Map<string, number>();
  private downUntil = new Map<string, number>();
  private duelHits = new Map<string, number[]>();
  /** Vida en el modo pelea: la que tenía en `at` (se recupera sola: hpAt) y hasta cuándo está fuera de combate. */
  private health = new Map<string, { hp: number; at: number; downUntil?: number }>();
  /** Los ciudadanos (§9 nonies): quién los lleva, desde cuándo, su último estado y dónde estaba cada uno. */
  private npcHost: string | null = null;
  private npcHostSince = 0;
  private npcLastAt = 0;
  private npcPos = new Map<number, readonly [number, number, number]>();
  private npcEvents = new Map<string, number[]>();
  /** El último estado repartido (para quien llega: lo ve enseguida). */
  private npcLast: { t: number; cast: NpcSnap[] } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const raw = ctx.storage.sql;
    this.sql = {
      exec: ((query: string, ...bindings: unknown[]) => {
        if (ENTITY_WRITE.test(query)) this.entityEpoch++;
        return raw.exec(query, ...bindings);
      }) as SqlStorage["exec"],
    };
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entities (
        entity_id TEXT PRIMARY KEY, owner TEXT NOT NULL, rev INTEGER NOT NULL,
        tris INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor TEXT NOT NULL,
        op TEXT NOT NULL, entity_id TEXT NOT NULL, rev INTEGER NOT NULL, data TEXT);
      CREATE TABLE IF NOT EXISTS idem (key TEXT PRIMARY KEY, result TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stands (project_id TEXT PRIMARY KEY, slot INTEGER NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS showcase (project_id TEXT PRIMARY KEY, slot INTEGER NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS chat (
        id TEXT PRIMARY KEY, ts INTEGER NOT NULL, sender TEXT NOT NULL, kind TEXT NOT NULL,
        display_name TEXT NOT NULL, session_id TEXT NOT NULL, text TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS chat_ts ON chat (ts);
      ${ACTIVITY_SCHEMA}
      ${TILES_SCHEMA}
      CREATE TABLE IF NOT EXISTS sandbox (entity_id TEXT PRIMARY KEY, owner TEXT NOT NULL, day TEXT NOT NULL, light INTEGER NOT NULL DEFAULT 0);
    `);
    // Al despertar de la hibernación no llega ningún fetch: el chunk se lee de lo guardado antes de
    // atender ningún mensaje (sin esto, chunkId era null y las entidades nuevas salían sin chunk_id).
    void ctx.blockConcurrencyWhile(async () => {
      const stored = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'chunk_id'").toArray()[0]?.v;
      if (stored) this.ensureChunk(stored);
    });
  }

  /* ---------------------------------------------------------------- */
  /* HTTP de entrada (desde el Worker)                                  */
  /* ---------------------------------------------------------------- */

  async fetch(req: Request): Promise<Response> {
    this.ensureChunk(req.headers.get("X-Chunk-Id"));
    const path = new URL(req.url).pathname;

    if (path === "/state") return Response.json(this.publicState());
    // Los marcadores para el panel: por fetch (una sola petición al objeto, sin bind delante).
    if (path === "/boards") return Response.json(await this.boardsOf());

    if (path === "/ws") {
      const principal = JSON.parse(req.headers.get("X-Principal") ?? "null") as Principal | null;
      if (!principal) return new Response("unauthorized", { status: 401 });
      // Tope de conexiones de la misma cuenta aquí: la más vieja se cierra (suele ser una que se quedó colgada).
      const mine = this.ctx
        .getWebSockets()
        .map((w) => ({ w, a: w.deserializeAttachment() as Attachment | null }))
        .filter((x) => x.a?.principal.sub === principal.sub)
        .sort((x, y) => (x.a!.since ?? 0) - (y.a!.since ?? 0));
      for (const x of mine.slice(0, Math.max(0, mine.length - MAX_CONN_PER_SUB + 1))) {
        this.dropSession(x.w);
        try {
          x.w.close(4009, "demasiadas conexiones de la misma cuenta");
        } catch {
          /* ya cerrada */
        }
      }
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      const session_id = randomId("s_", 6);
      this.ctx.acceptWebSocket(server, [session_id]);
      const att: Attachment = {
        session_id,
        principal,
        hello: false,
        client_type: "headless",
        since: Date.now(),
        display_name:
          cleanText(
            principal.kind === "agent" ? principal.sub.replace(/^agt_/, "") : principal.kind === "user" ? (principal.name ?? "user") : "guest",
            64,
          ) || principal.kind,
      };
      server.serializeAttachment(att);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  /**
   * Fija qué chunk es este objeto. El nombre manda: el objeto se obtiene con idFromName(chunk_id),
   * así que si llega un id distinto del guardado (un objeto creado antes por una llamada que no lo
   * decía), se corrige y se vuelve a sembrar.
   */
  private ensureChunk(id: string | null) {
    if (this.chunkId && (!id || id === this.chunkId)) return;
    const stored = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'chunk_id'").toArray()[0]?.v;
    this.chunkId = id ?? stored ?? PLACES.plaza;
    if (stored !== this.chunkId) {
      this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('chunk_id', ?)", this.chunkId);
      if (stored) this.sql.exec("DELETE FROM meta WHERE k IN ('seed_version', 'chunk_id_fix')");
    }
    this.repairChunkIds();

    if (this.chunkId === PLACES.plaza) this.applySeed("plaza", SEED_VERSION, plazaSeed());
    else if (this.chunkId === PLACES.nexo) {
      this.applySeed("nexo", NEXO_SEED_VERSION, nexoSeed());
      // El segundo aro nace con sus carteles de «libre»; después los cambia el Worker (setCommunityGates).
      const gates = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM entities WHERE owner = 'community_gates'").toArray()[0]?.n ?? 0;
      if (!gates) this.writeCommunityGates(communityGates([]));
      // Sin escaparate: si quedaba alguno de antes, fuera (los proyectos están en sus distritos).
      if (SHOWCASE_SLOTS.length === 0) {
        for (const r of this.sql.exec<{ project_id: string }>("SELECT project_id FROM showcase").toArray()) {
          for (const id of Object.values(showIds(r.project_id))) this.sql.exec("DELETE FROM entities WHERE entity_id = ?", id);
        }
        this.sql.exec("DELETE FROM showcase");
      }
    }
    else {
      const d = districtByChunk(this.chunkId);
      if (d) {
        this.migrateParcelLayout();
        this.migrateMonumentColliders();
        // Ids de menos de 6 caracteres (las máquinas-portal se llamaron «cab_1»): el esquema de las
        // entidades no los admite y los clientes descartaban el SNAPSHOT entero. Fuera; se rellenan al recolocar.
        this.sql.exec("DELETE FROM entities WHERE owner IN ('cabinets', 'billboards') AND length(entity_id) < 6");
        this.applySeed(`district_${d.id}`, DISTRICT_SEED_VERSION, districtSeed(d, nexoArrival(d.id)));
      } else if (isCommunityChunk(this.chunkId)) {
        const raw = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'community'").toArray()[0]?.v;
        this.community = raw ? (JSON.parse(raw) as CommunityMeta) : null;
        if (this.community) this.applySeed(`community_${this.community.id}`, 1, this.community.system);
      }
    }
  }

  /**
   * Una vez: las entidades que se escribieron tras despertar de la hibernación sin saber el chunk
   * (chunk_id null) hacían que los clientes descartaran el SNAPSHOT entero. Se les pone el suyo.
   */
  private repairChunkIds() {
    if (this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'chunk_id_fix'").toArray()[0]?.v === "1") return;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE entities SET data = json_set(data, '$.chunk_id', ?) WHERE json_extract(data, '$.chunk_id') IS NOT ?", this.chunkId, this.chunkId);
      this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('chunk_id_fix', '1')");
    });
  }

  /**
   * Disposición v2 de los distritos (la ciudad en el centro y las parcelas alrededor): lo que la
   * gente tenía en una parcela de la v1 (el portal de su proyecto y lo que construyó su agente) se
   * lleva a la misma parcela en su sitio nuevo, girado como ella. Una sola vez por chunk.
   */
  /** Los monumentos de antes no chocaban: ahora llevan collider@1 con su forma (from_mesh). Una vez. */
  private migrateMonumentColliders() {
    if (this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'monument_colliders'").toArray()[0]?.v === "1") return;
    this.ctx.storage.transactionSync(() => {
      for (const row of this.sql.exec<{ entity_id: string; rev: number; data: string }>("SELECT entity_id, rev, data FROM entities WHERE entity_id LIKE 'standm_%'").toArray()) {
        const e = JSON.parse(row.data) as Entity;
        if (e.components["collider@1"] || !e.components["mesh@1"]) continue;
        // Caja de reserva: el monumento cabe en un cubo de 1,6 m (places.ts → portalEntities).
        const s = (e.components["transform@1"] as { s?: number[] } | undefined)?.s?.[0] ?? 1;
        const h = Math.max(0.05, Math.round((0.8 / Math.max(0.01, s)) * 1e6) / 1e6);
        e.components["collider@1"] = { shape: "box", half_extents: [h, h, h], trigger: false, from_mesh: true };
        e.rev = row.rev + 1;
        this.sql.exec("UPDATE entities SET rev = ?, data = ? WHERE entity_id = ?", e.rev, JSON.stringify(e), row.entity_id);
      }
      this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('monument_colliders', '1')");
    });
  }

  private migrateParcelLayout() {
    const done = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'parcel_layout'").toArray()[0]?.v;
    if (done === PARCEL_LAYOUT_VERSION) return;
    const from: 1 | 2 = done === "2" ? 2 : 1;
    this.ctx.storage.transactionSync(() => {
      const rows = this.sql.exec<{ entity_id: string; rev: number; data: string }>("SELECT entity_id, rev, data FROM entities WHERE owner != 'system'").toArray();
      for (const row of rows) {
        const e = JSON.parse(row.data) as Entity;
        const t = e.components["transform@1"] as { p: number[]; r: number[]; s: number[]; parent: string | null } | undefined;
        if (!t || t.parent) continue;
        const m = migrateParcelPose(t.p as [number, number, number], t.r as [number, number, number, number], from);
        if (!m) continue;
        (e.components as Record<string, unknown>)["transform@1"] = { ...t, p: m.p, r: m.r };
        e.rev = row.rev + 1;
        this.sql.exec("UPDATE entities SET rev = ?, data = ? WHERE entity_id = ?", e.rev, JSON.stringify(e), row.entity_id);
      }
      // Los portales de los proyectos: de su índice antiguo al de hoy (en dos pasos: es UNIQUE).
      const stands = this.sql.exec<{ project_id: string; slot: number }>("SELECT project_id, slot FROM stands").toArray();
      for (const s of stands) this.sql.exec("UPDATE stands SET slot = ? WHERE project_id = ?", -1 - s.slot, s.project_id);
      for (const s of stands) {
        const i = migrateSlot(s.slot, from);
        if (i >= 0) this.sql.exec("UPDATE stands SET slot = ? WHERE project_id = ?", i, s.project_id);
        else this.sql.exec("DELETE FROM stands WHERE project_id = ?", s.project_id);
      }
      this.logEvent("system", "MIGRATE", "parcel_layout", Number(PARCEL_LAYOUT_VERSION), null);
      this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('parcel_layout', ?)", PARCEL_LAYOUT_VERSION);
    });
  }


  /**
   * Siembra o actualiza un lugar del sistema (la plaza, el nexo). Si cambió la semilla (su versión
   * o su contenido, p. ej. al volver a forjar los modelos), sustituye las entidades con dueño
   * "system" y conserva las de personas y agentes.
   */
  private applySeed(name: string, version: number, seed: Seeded[]) {
    for (const s of seed) this.seedIds.add(s.id);
    const fingerprint = `${version}:${fnv1a(JSON.stringify(seed))}`;
    const current = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'seed_version'").toArray()[0]?.v;
    if (current === fingerprint) return;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM entities WHERE owner = 'system'");
      for (const { id, components } of seed) {
        // Si alguien ya usó ese id, la semilla no lo pisa.
        if (!this.getRow(id)) this.insertEntity(id, "system", components);
      }
      this.logEvent("system", "SEED", name, version, null);
      this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('seed_version', ?)", fingerprint);
    });
  }

  /* ---------------------------------------------------------------- */
  /* WebSocket (API de hibernación)                                     */
  /* ---------------------------------------------------------------- */

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const att = ws.deserializeAttachment() as Attachment;
    // Sin saber qué chunk es no se atiende nada (no debería pasar: el constructor lo lee de lo guardado).
    if (!this.chunkId) {
      ws.close(1011, "vuelve a entrar");
      return;
    }
    if (!this.takeToken(att.session_id, typeof data === "string" ? data.length : data.byteLength)) {
      this.sendError(ws, undefined, "rate_limited", "demasiados mensajes: conexión cerrada");
      this.dropSession(ws);
      try {
        ws.close(4008, "demasiados mensajes");
      } catch {
        /* ya cerrada */
      }
      return;
    }
    if (typeof data !== "string") return this.sendError(ws, undefined, "bad_message", "codificación binaria reservada para v1");
    if (data.length > MAX_MESSAGE_BYTES) return this.sendError(ws, undefined, "bad_message", "mensaje demasiado grande");

    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return this.sendError(ws, undefined, "bad_message", "JSON inválido");
    }
    if ((raw as { v?: unknown })?.v !== PROTOCOL_VERSION) {
      return this.sendError(ws, undefined, "unsupported_version", `este servidor habla el protocolo v${PROTOCOL_VERSION}`);
    }
    const parsed = ClientMessage.safeParse(raw);
    if (!parsed.success) {
      return this.sendError(ws, (raw as { id?: string }).id, "bad_message", "mensaje no válido", parsed.error.issues.slice(0, 5));
    }
    const m = parsed.data;

    if (m.type !== "HELLO" && !att.hello) return this.sendError(ws, m.id, "bad_message", "envía HELLO primero");

    switch (m.type) {
      case "HELLO": {
        // Uno por conexión: cada HELLO manda el SNAPSHOT entero y avisa a todos.
        if (att.hello) return this.sendError(ws, m.id, "bad_message", "HELLO ya enviado en esta conexión");
        att.hello = true;
        att.client_type = m.payload.client_type;
        // Solo los invitados eligen nombre en HELLO; el de personas registradas y agentes lo fija el servidor.
        if (m.payload.display_name && att.principal.kind === "guest") att.display_name = cleanText(m.payload.display_name, 32) || "guest";
        // Invitados y agentes pueden vestir un avatar de serie (nunca un archivo cualquiera).
        if (m.payload.avatar && !att.principal.avatar && isAvatarPreset(m.payload.avatar.hash)) {
          att.preset = { hash: m.payload.avatar.hash, format: "vrm" };
        }
        if (m.payload.capabilities.npc_host && this.npcPlace) att.npc = true;
        ws.serializeAttachment(att);
        this.send(ws, msg("WELCOME", {
          session_id: att.session_id,
          principal: { sub: att.principal.sub, kind: att.principal.kind, scopes: att.principal.scopes },
          chunk_id: this.chunkId!,
          server_time: Date.now(),
          tick_hz: TICK_HZ,
          budgets: { ...BUDGETS },
          ...(this.solo ? { solo: true, walk: NEXO_BOUNDS } : this.big ? { walk: this.bounds } : {}),
          ...this.themeHint(),
          ...(this.fightStyle ? { fight: this.fightStyle } : {}),
          ...(this.parkour ? { parkour: true } : {}),
          ...(this.carsHere ? { cars: true } : {}),
          ...(this.weaponsHere ? { weapons: this.weaponsOf(att) } : {}),
          ...(this.closedHere().length ? { closed: this.closedHere() } : {}),
        }));
        // En solitario (el nexo) nadie ve a nadie: ni gente, ni poses, ni chat.
        if (this.solo) {
          this.sendSnapshot(ws, [], [], []);
          return;
        }
        this.sendSnapshot(ws, this.peers(), [...this.poses.values()], this.recentChat());
        this.broadcast(msg("PEER_JOIN", this.peerOf(att)), ws);
        // Llegadas de la misma cuenta muy seguidas (reconectar para aparecer en otro sitio): la
        // siguiente pose ya no es una llegada libre.
        if (att.principal.kind === "user") {
          const now = Date.now();
          const list = (this.arrivals.get(att.principal.sub) ?? []).filter((t) => now - t < ARRIVALS_WINDOW_MS);
          if (list.length >= ARRIVALS_FREE) this.hotArrival.add(att.session_id);
          list.push(now);
          this.arrivals.set(att.principal.sub, list);
          this.pruneLog(this.arrivals, ARRIVALS_WINDOW_MS);
        }
        if (att.principal.kind === "user") this.send(ws, msg("PROGRESS", this.progressOf(att.principal.sub)));
        for (const g of this.tileGames.values()) if (g.state === "show") this.send(ws, this.tilesMsg(g));
        // Los ciudadanos: si nadie los lleva y esta sesión sabe, ella; si no, quién (a esta sesión).
        if (this.npcPlace) {
          if (att.npc && !this.npcHostAlive()) this.setNpcHost(att.session_id);
          else this.send(ws, msg("NPC_HOST", { session_id: this.npcHost }));
          if (this.npcHost && this.npcLast && Date.now() - this.npcLast.t < NPC_STALE_MS) this.send(ws, msg("NPC_STATE", this.npcLast));
        }
        return;
      }
      case "POSE": {
        if (this.solo) return; // en solitario no se reparten poses
        const now = Date.now();
        // De media, maxPoseHz como mucho; el exceso se descarta en silencio. Las que llegan juntas tras
        // un atasco de la red pasan (cada una con la hora en que se tomó).
        const tat = allowSample(this.poseTat.get(att.session_id), now, BUDGETS.maxPoseHz);
        if (tat < 0) return;
        const { emote, vehicle } = m.payload;
        // El arma en la mano: donde hay armas, en el modo pelea y una que pueda usar (si no, fuera).
        const weapon = m.payload.weapon && att.fight && this.weaponsHere && !vehicle && this.weaponsOf(att).includes(m.payload.weapon) ? m.payload.weapon : undefined;
        const headR = unitQuat(m.payload.head.r);
        if (!headR || !this.inBounds(m.payload.head.p)) return;
        this.poseTat.set(att.session_id, tat);
        this.lastPoseAt.set(att.session_id, now);
        // Cuándo se tomó (pose-clock.ts): con eso los demás la dibujan a velocidad uniforme.
        this.poseClocks.set(att.session_id, stampSample(this.poseClocks.get(att.session_id), m.payload.t, now));
        // Lo que viaja a los demás va con milímetros y diezmilésimas: un tercio menos de bytes.
        const trim = (q: { p: readonly number[]; r: readonly number[] }, r: readonly number[]) => ({
          p: [roundP(q.p[0]!), roundP(q.p[1]!), roundP(q.p[2]!)] as [number, number, number],
          r: [roundR(r[0]!), roundR(r[1]!), roundR(r[2]!), roundR(r[3]!)] as [number, number, number, number],
        });
        const head = trim(m.payload.head, headR);
        // Las manos, con la cabeza (y con su giro normalizado); si no, no se reparten.
        const hand = (h: typeof m.payload.hand_l) => {
          const r = h && unitQuat(h.r);
          return h && r && Math.hypot(h.p[0] - head.p[0], h.p[1] - head.p[1], h.p[2] - head.p[2]) <= HAND_REACH ? trim(h, r) : undefined;
        };
        const hand_l = hand(m.payload.hand_l), hand_r = hand(m.payload.hand_r);
        // Coches solo donde el distrito los tiene (`cars` en districts.json: Arcade) y dentro de sus límites.
        const roads = this.carsHere;
        const carR = m.payload.car && unitQuat(m.payload.car.r);
        const car = m.payload.car && carR ? trim(m.payload.car, carR) : undefined;
        const withCar = roads && car && this.inBounds(car.p) ? { car, ...(vehicle ? { vehicle } : {}) } : {};
        const jump = this.trackMove(ws, att, head.p, now);
        this.poses.set(att.session_id, { session_id: att.session_id, head, ...(hand_l ? { hand_l } : {}), ...(hand_r ? { hand_r } : {}), ...(emote ? { emote } : {}), ...withCar, ...(att.fight ? { fight: true } : {}), ...(weapon ? { weapon } : {}) });
        this.dirty.add(att.session_id);
        this.scheduleTick();
        // Una pose que llega de un salto no pisa baldosas.
        if (!jump) this.tilesPose(att, head.p);
        if (this.rounds.length) this.sweepRounds(now);
        // Quien lleva a los ciudadanos ha dejado de mandar su estado (pestaña dormida, conexión mala): otro.
        // Y si no los lleva nadie, quien sepa y se mueva.
        if (this.npcHost && !this.npcHostAlive(now)) this.electNpcHost(this.npcHost);
        else if (!this.npcHost && att.npc && this.npcPlace) this.setNpcHost(att.session_id);
        return;
      }
      case "CHAT":
        if (this.solo) return this.sendError(ws, m.id, "forbidden", "aquí no hay chat: en el nexo se va en solitario");
        return this.handleChat(ws, att, m.id, m.payload.text);
      case "PING":
        return this.send(ws, msg("PONG", { t: m.payload.t, server_time: Date.now() }));
      case "MUTATE_WORLD":
        return await this.handleMutation(ws, att, m.id, m.payload);
      case "COLLECT":
        return this.handleCollect(ws, att, m.id, m.payload.entity_id);
      case "CHECKPOINT":
        return this.handleCheckpoint(ws, att, m.id, m.payload.entity_id);
      case "SCORES_GET":
        return this.handleScores(ws, att, m.id, m.payload.entity_id);
      case "REACT":
        return this.handleReact(ws, att, m.id, m.payload.kind);
      case "PAIR":
        return this.handlePair(ws, att, m.id, m.payload.to, m.payload.kind, m.payload.answer);
      case "FIGHT":
        return this.handleFight(ws, att, m.id, m.payload.on);
      case "HIT":
        return this.handleHit(ws, att, m.id, m.payload.to, m.payload.move);
      case "RESPAWN":
        return this.handleRespawn(ws, att, m.id);
      case "SHOOT":
        return this.handleShoot(ws, att, m.id, m.payload);
      case "NPC_STATE":
        return this.handleNpcState(ws, att, m.id, m.payload.cast);
      case "NPC_HIT":
        return this.handleNpcHit(ws, att, m.id, m.payload);
      case "NPC_PAIR":
        return this.handleNpcPair(ws, att, m.id, m.payload.npc, m.payload.kind);
      case "NPC_HOSTING":
        return this.handleNpcHosting(ws, att, m.payload.on);
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.dropSession(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.dropSession(ws);
  }

  private dropSession(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    this.poses.delete(att.session_id);
    this.dirty.delete(att.session_id);
    this.lastPoseAt.delete(att.session_id);
    this.poseClocks.delete(att.session_id);
    this.poseTat.delete(att.session_id);
    if (this.rounds.length) this.leaveRounds(att.session_id, Date.now());
    this.activityLog.delete(att.session_id);
    this.buckets.delete(att.session_id);
    this.moves.delete(att.session_id);
    this.hotArrival.delete(att.session_id);
    this.reactAt.delete(att.session_id);
    this.pairOffers.delete(att.session_id);
    this.hitAt.delete(att.session_id);
    this.shotAt.delete(att.session_id);
    this.downUntil.delete(att.session_id);
    this.duelHits.delete(att.session_id);
    this.health.delete(att.session_id);
    this.npcEvents.delete(att.session_id);
    if (att.hello && !this.solo) this.broadcast(msg("PEER_LEAVE", { session_id: att.session_id }), ws);
    if (this.npcHost === att.session_id) this.electNpcHost(att.session_id, ws);
  }

  /** Cubo de mensajes de una conexión (ver MSG_BURST): false si se ha quedado sin. */
  private takeToken(sessionId: string, bytes: number): boolean {
    const now = Date.now();
    const b = this.buckets.get(sessionId) ?? { tokens: MSG_BURST, t: now };
    b.tokens = Math.min(MSG_BURST, b.tokens + ((now - b.t) / 1000) * MSG_RATE);
    b.t = now;
    b.tokens -= 1 + Math.floor(bytes / 8192);
    this.buckets.set(sessionId, b);
    return b.tokens >= 0;
  }

  /** Quita de un registro en memoria (por cuenta) lo que ya no cuenta, cuando crece. */
  private pruneLog(map: Map<string, number[]>, windowMs: number) {
    if (map.size < 256) return;
    const now = Date.now();
    for (const [k, list] of map) if (!list.length || now - list[list.length - 1]! >= windowMs) map.delete(k);
  }

  /**
   * Apunta el movimiento de una sesión (activities.ts → stepMove) y dice si esta pose ha sido un
   * salto. La primera pose de la conexión es la llegada: libre, salvo que la cuenta llegue una y otra
   * vez o que el objeto haya hibernado con la sesión ya en marcha (entonces cuenta como salto).
   * Un salto, o ir más rápido que a pie, anula la carrera en curso.
   */
  private trackMove(ws: WebSocket, att: Attachment, p: readonly number[], now: number): boolean {
    let m = this.moves.get(att.session_id);
    let jump = false, fast = false;
    if (!m) {
      jump = !!att.posed || this.hotArrival.has(att.session_id);
      m = { p: [p[0]!, p[1]!, p[2]!], t: now, budget: MOVE_BURST, foot: FOOT_BURST, jumpAt: jump ? now : 0 };
      this.moves.set(att.session_id, m);
      if (!att.posed) {
        att.posed = true;
        ws.serializeAttachment(att);
      }
    } else ({ jump, fast } = stepMove(m, p, now));
    if (jump && this.rounds.length) this.leaveRounds(att.session_id, now);
    if ((jump || fast) && att.run) {
      const race = att.run.race;
      att.run = undefined;
      ws.serializeAttachment(att);
      this.send(ws, msg("RACE", { race, state: "reset" }));
    }
    return jump;
  }

  /** ¿Acaba de llegar esta sesión de un salto? Entonces no cuentan las actividades. */
  private jumpedRecently(att: Attachment): boolean {
    const m = this.moves.get(att.session_id);
    return !!m && m.jumpAt > 0 && Date.now() - m.jumpAt < JUMP_COOLDOWN_MS;
  }

  /** El nexo se recorre en solitario: el multijugador es de los distritos, la plaza y los juegos. */
  private get solo(): boolean {
    return this.chunkId === PLACES.nexo;
  }

  /** Hasta dónde llega el lugar (X y Z): el nexo y los distritos pueden ser más grandes que su chunk. */
  private get bounds(): [number, number] {
    if (this.chunkId === PLACES.nexo) return NEXO_BOUNDS;
    if (this.chunkId && (districtByChunk(this.chunkId) || this.community)) return DISTRICT_BOUNDS;
    return [0, CHUNK_SIZE];
  }

  /** La ciudad de fondo de un distrito (el suyo, o el que eligió quien creó uno de la comunidad). */
  private themeHint(): { theme?: { id: string; color: string } } {
    if (this.community) return { theme: { id: this.community.theme, color: this.community.color } };
    const d = this.chunkId ? districtByChunk(this.chunkId) : null;
    return d ? { theme: { id: d.id, color: d.color } } : {};
  }

  /** Lugar compartido más grande que un chunk: las poses se reparten solo a quien está cerca. */
  private get big(): boolean {
    const [lo, hi] = this.bounds;
    return !this.solo && (lo < 0 || hi > CHUNK_SIZE);
  }

  /* ---------------------------------------------------------------- */
  /* Tick de poses                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Reparte las poses pendientes. Con poca gente mandándolas, al momento: lo que una pose espera
   * aquí es retraso con el que la ven los demás. Con más, en lotes (`batchGap`: a TICK_HZ como poco),
   * que es lo que mantiene a raya los mensajes que recibe cada uno: si ha pasado el intervalo, al
   * momento (sin temporizador); si no, se deja uno corto para lo que falte. Un temporizador
   * pendiente impide que el objeto hiberne, y ese tiempo cuenta como duración (plan gratuito:
   * 13.000 GB-s al día): así solo lo hay cuando varias poses llegan dentro del mismo intervalo, no
   * mientras haya alguien en el chunk.
   */
  private scheduleTick() {
    if (this.dirty.size === 0) return;
    const wait = this.lastTick + batchGap(this.poses.size, 1000 / TICK_HZ - 20) - Date.now();
    if (wait <= 0) return this.flushPoses();
    if (!this.tickTimer) {
      this.tickTimer = setTimeout(() => {
        this.tickTimer = null;
        this.flushPoses();
      }, wait);
    }
  }

  /**
   * El lote: `t` es la hora a la que sale y cada pose dice cuánto antes se tomó (`age`, ms). Nadie
   * recibe la suya. En un lugar grande, a cada uno solo las de quien tiene a menos de AOI_RADIUS (y
   * todas si aún no ha mandado la suya): con 100 personas repartidas, cada una recibe unas pocas.
   * Cada pose se escribe una vez y el mensaje de cada uno se monta con esos trozos.
   */
  private flushPoses() {
    if (this.dirty.size === 0) return;
    const now = Date.now();
    this.lastTick = now;
    const batch: { id: string; x: number; z: number; json: string }[] = [];
    for (const id of this.dirty) {
      const p = this.poses.get(id);
      if (!p) continue;
      const age = Math.max(0, Math.round(now - (this.poseClocks.get(id)?.last ?? now)));
      batch.push({ id, x: p.head.p[0]!, z: p.head.p[2]!, json: JSON.stringify(age > 0 ? { ...p, age } : p) });
    }
    this.dirty.clear();
    if (!batch.length) return;
    const [head, tail] = JSON.stringify(msg("POSES", { t: now, poses: [] })).split('"poses":[]') as [string, string];
    const R2 = AOI_RADIUS * AOI_RADIUS;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att?.hello) continue;
      // Quien lleva a los ciudadanos recibe todas: tiene que saber dónde está cada uno (§9 nonies).
      const me = this.big && att.session_id !== this.npcHost ? this.poses.get(att.session_id)?.head.p : undefined;
      let list = "";
      for (const b of batch) {
        if (b.id === att.session_id) continue;
        if (me && (b.x - me[0]!) ** 2 + (b.z - me[2]!) ** 2 > R2) continue;
        list += list ? `,${b.json}` : b.json;
      }
      if (!list) continue;
      try {
        ws.send(`${head}"poses":[${list}]${tail}`);
      } catch {
        /* socket cerrado */
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Mutaciones del mundo                                               */
  /* ---------------------------------------------------------------- */

  private async handleMutation(
    ws: WebSocket,
    att: Attachment,
    ref: string | undefined,
    p: { idempotency_key: string; target: "commit" | "proposal"; mutation: MutationOp },
  ) {
    const actor = att.principal.sub;
    const zone = att.principal.zone;
    // Zona de pruebas (Taller): cualquier cuenta construye allí con piezas básicas, sin clave.
    const sandbox = !zone && att.principal.kind === "user" && !att.principal.scopes.includes("build") ? this.sandboxRect() : null;
    try {
      // Primero quién puede y cuánto: nada de leer R2 (ni pedir medidas fuera) por quien no construye.
      if (!att.principal.scopes.includes("build") && !sandbox) throw new MutationError("forbidden", "esta sesión no tiene permiso de construcción");
      if (sandbox && p.mutation.op !== "DESPAWN" && p.mutation.components["mesh@1"]) throw new MutationError("forbidden", "en la zona de pruebas solo hay piezas básicas");
      // Cerrada por moderación: no se pone ni se cambia nada (quitar lo propio, sí).
      if (sandbox && p.mutation.op !== "DESPAWN" && this.isClosed("sandbox")) throw new MutationError("forbidden", "la zona de pruebas está cerrada por ahora", { reason: "closed" });
      if (zone && zone.chunk_id !== this.chunkId) {
        throw new MutationError("forbidden", `esta clave solo construye en su parcela (${zone.district} ${zone.parcel})`, { zone });
      }
      if (p.target === "proposal") throw new MutationError("bad_message", "las propuestas (ramas) llegan en una versión futura; usa target: commit");
      // Los ids del sistema (portales, máquinas, anuncios y la semilla del lugar) no se pueden elegir.
      if (p.mutation.op === "SPAWN" && p.mutation.entity_id && this.reservedId(p.mutation.entity_id)) {
        throw new MutationError("forbidden", "ese id está reservado para el sistema; elige otro o deja que lo ponga el servidor", { entity_id: p.mutation.entity_id });
      }
      // Un mesh@1 mal formado (hash que no es sha256, más de 4 LOD) se rechaza antes de buscar nada.
      if (p.mutation.op !== "DESPAWN" && p.mutation.components["mesh@1"] != null) {
        const mesh = MeshV1.safeParse(p.mutation.components["mesh@1"]);
        if (!mesh.success) throw new MutationError("bad_message", "componentes no válidos", mesh.error.issues.slice(0, 5));
      }

      const idemKey = `${actor}:${p.idempotency_key}`;
      const prior = this.sql.exec<{ result: string }>("SELECT result FROM idem WHERE key = ?", idemKey).toArray()[0];
      if (prior) {
        const r = JSON.parse(prior.result) as { entity_id: string; rev: number };
        return this.send(ws, msg("ACK", { ref, ...r, replayed: true }));
      }

      this.rateLimit(actor);
      // Los triángulos de un modelo NO se creen al cliente: se leen de lo que midió el servidor al subirlo.
      const resolved = await this.resolveAssets(p.mutation);
      p.mutation = resolved.mu;
      // Un PATCH en una parcela que no cambia el modelo: sus medidas, las del que ya lleva.
      if (zone && p.mutation.op === "PATCH" && !p.mutation.components["mesh@1"]) resolved.meshBounds = await this.boundsOfEntity(p.mutation.entity_id);
      const result = this.ctx.storage.transactionSync(() => {
        const r = sandbox
          ? this.applySandbox(actor, p.mutation, sandbox)
          : this.applyMutation(actor, att.principal.scopes.includes("admin"), p.mutation, zone ? { ...zone, meshBounds: resolved.meshBounds } : null);
        this.sql.exec("INSERT INTO idem (key, result, ts) VALUES (?, ?, ?)", idemKey, JSON.stringify({ entity_id: r.entity_id, rev: r.rev }), Date.now());
        return r;
      });

      this.send(ws, msg("ACK", { ref, entity_id: result.entity_id, rev: result.rev, replayed: false }));
      this.broadcast(msg("DELTA", { changes: [result.change] }));
      this.maybePrune();
    } catch (e) {
      if (e instanceof MutationError) return this.sendError(ws, ref, e.code, e.message, e.detail);
      console.error("mutation failed", e);
      return this.sendError(ws, ref, "bad_message", "error interno al aplicar la mutación");
    }
  }

  /* ---------------------------------------------------------------- */
  /* Zona de pruebas (Taller): piezas básicas, tope por persona, cada día limpia */
  /* ---------------------------------------------------------------- */

  private sandboxRect(): SandboxRect | null {
    const d = this.chunkId ? districtByChunk(this.chunkId) : null;
    return d ? sandboxOf(d.id) : null;
  }

  /** Lo de días anteriores se va (la primera vez que algo toca la zona cada día). */
  private sweepSandbox(): { kind: "remove"; entity_id: string }[] {
    const today = pointsDay();
    if (this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'sandbox_day'").toArray()[0]?.v === today) return [];
    const old = this.sql.exec<{ entity_id: string }>("SELECT entity_id FROM sandbox WHERE day != ?", today).toArray().map((r) => r.entity_id);
    const out = this.despawnIds(old, "sandbox_daily");
    this.sql.exec("DELETE FROM sandbox WHERE day != ?", today);
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('sandbox_day', ?)", today);
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Interruptores de emergencia (moderación; ops.ts)                   */
  /* ---------------------------------------------------------------- */

  /** Lo que moderación ha cerrado aquí (meta 'closed'); se lee una vez al despertar. */
  private closedMem: Set<string> | null = null;

  private isClosed(what: "chat" | "sandbox"): boolean {
    if (!this.closedMem) {
      const raw = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'closed'").toArray()[0]?.v;
      let list: unknown = [];
      try {
        list = raw ? JSON.parse(raw) : [];
      } catch {
        /* dato roto: nada cerrado */
      }
      this.closedMem = new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
    }
    return this.closedMem.has(what);
  }

  /** Lo cerrado que le importa a quien entra aquí (WELCOME.closed): sin chat en el nexo, sin zona de pruebas donde no la hay. */
  private closedHere(): ("chat" | "sandbox")[] {
    const out: ("chat" | "sandbox")[] = [];
    if (!this.solo && this.isClosed("chat")) out.push("chat");
    if (this.isClosed("sandbox") && this.sandboxRect()) out.push("sandbox");
    return out;
  }

  /**
   * Moderación cierra o abre el chat y la zona de pruebas de este lugar (true = abierto). Lo llama
   * el Worker al cambiar un interruptor (/mod/flags) y al traer el lugar de otro servidor.
   */
  async setFlags(f: PlaceFlags): Promise<{ closed: string[] }> {
    this.ensureChunk(null);
    const closed = [...(f.chat === false ? ["chat"] : []), ...(f.sandbox === false ? ["sandbox"] : [])];
    if (closed.length) this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('closed', ?)", JSON.stringify(closed));
    else this.sql.exec("DELETE FROM meta WHERE k = 'closed'");
    this.closedMem = new Set(closed);
    return { closed };
  }

  /** Vacía la zona de pruebas (moderación). */
  async clearSandbox(): Promise<{ removed: number }> {
    this.ensureChunk(null);
    const ids = this.sql.exec<{ entity_id: string }>("SELECT entity_id FROM sandbox").toArray().map((r) => r.entity_id);
    const changes = this.ctx.storage.transactionSync(() => {
      const out = this.despawnIds(ids, "sandbox_cleared");
      this.sql.exec("DELETE FROM sandbox");
      return out;
    });
    if (changes.length) this.broadcast(msg("DELTA", { changes }));
    return { removed: changes.length };
  }

  private checkSandbox(c: Components, z: SandboxRect) {
    const allowed = new Set(["transform@1", "primitive@1", "label@1", "light@1", "collider@1"]);
    const extra = Object.keys(c).filter((k) => !allowed.has(k));
    if (extra.length) throw new MutationError("forbidden", "en la zona de pruebas solo hay cajas, cilindros, esferas, carteles y luces", { extra });
    const t = c["transform@1"];
    if (t.parent) throw new MutationError("bad_message", "en la zona de pruebas, las piezas van sin padre (parent: null)");
    const s = c["primitive@1"]?.size ?? [0.5, 0.5, 0.5];
    if (s.some((v) => v > 4)) throw new MutationError("budget_exceeded", "cada pieza mide como mucho 4 m");
    if (t.s.some((v) => !(v >= 0.1 && v <= 4))) throw new MutationError("budget_exceeded", "en la zona de pruebas, la escala va de 0,1 a 4 en cada eje");
    // El colisionador, como mucho del tamaño de la pieza (sin pieza, el de una caja de 0,5 m).
    const col = c["collider@1"];
    if (col && col.half_extents.some((h, i) => h > s[i]! / 2 + 0.01)) {
      throw new MutationError("budget_exceeded", "en la zona de pruebas, el colisionador no puede ser más grande que la pieza");
    }
    // Todo lo que ocupa (pieza, colisionador y cartel), girado y escalado, dentro del rectángulo.
    const box = worldBox(t, localBox(c, null) ?? { min: [0, 0, 0], max: [0, 0, 0] });
    const e = 0.01;
    if (box.min[0] < z.x0 - e || box.max[0] > z.x1 + e || box.min[2] < z.z0 - e || box.max[2] > z.z1 + e || box.min[1] < -0.5 || box.max[1] > z.max_y + e) {
      throw new MutationError("forbidden", "fuera de la zona de pruebas", { box: { min: box.min.map(r3), max: box.max.map(r3) } });
    }
    const l = c["light@1"];
    if (l && (l.intensity > 3 || l.range > 10)) throw new MutationError("budget_exceeded", "en la zona de pruebas, luces de intensidad 3 y alcance 10 como mucho");
  }

  private applySandbox(actor: string, mu: MutationOp, z: SandboxRect) {
    const swept = this.sweepSandbox();
    if (swept.length) this.broadcast(msg("DELTA", { changes: swept }));
    if (mu.op === "SPAWN") {
      const c = this.validateComponents(mu.components);
      this.checkSandbox(c, z);
      const mine = this.sql.exec<{ n: number; l: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(light), 0) AS l FROM sandbox WHERE owner = ?", actor).one();
      if (mine.n >= z.per_person) throw new MutationError("budget_exceeded", `en la zona de pruebas, ${z.per_person} piezas por persona como mucho`, { max: z.per_person });
      if (c["light@1"] && mine.l >= z.lights) throw new MutationError("budget_exceeded", `en la zona de pruebas, ${z.lights} luces por persona como mucho`);
      const all = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM sandbox").one().n;
      if (all >= SANDBOX_TOTAL) throw new MutationError("budget_exceeded", "la zona de pruebas está llena por hoy", { max: SANDBOX_TOTAL });
      const r = this.applyMutation(actor, false, { ...mu, components: c as Record<string, unknown> }, null, "sandbox");
      this.sql.exec("INSERT INTO sandbox (entity_id, owner, day, light) VALUES (?, ?, ?, ?)", r.entity_id, actor, pointsDay(), c["light@1"] ? 1 : 0);
      return r;
    }
    const mine = this.sql.exec("SELECT 1 FROM sandbox WHERE entity_id = ? AND owner = ?", mu.entity_id, actor).toArray().length > 0;
    if (!mine) throw new MutationError("forbidden", "solo puedes cambiar tus piezas de la zona de pruebas");
    const r = this.applyMutation(actor, false, mu, null, "sandbox");
    if (mu.op === "DESPAWN") this.sql.exec("DELETE FROM sandbox WHERE entity_id = ?", mu.entity_id);
    else if (r.change.kind === "upsert") this.checkSandbox(r.change.entity.components as Components, z);
    return r;
  }

  /**
   * Aplica una mutación ya validada en forma. Con `zone` (agente de una parcela), lo construido es
   * del proyecto (`zone.owner`), tiene que caber entero en la parcela y cuenta en el presupuesto
   * de la parcela, no en el del chunk.
   *
   * `budget` dice de qué presupuesto sale lo que no es de una parcela: `chunk` (lo de siempre), `sandbox`
   * (la zona de pruebas: su tope lo mira applySandbox; aquí, luces y triángulos) o `stand` (los portales
   * de los proyectos: uno por parcela, con su monumento ya medido; no gastan el del chunk, así que ni
   * las parcelas ni la zona de pruebas llenas impiden publicar).
   */
  private applyMutation(
    actor: string,
    isAdmin: boolean,
    mu: MutationOp,
    zone: (Zone & { meshBounds: { min: number[]; max: number[] } | null }) | null,
    budget: "chunk" | "sandbox" | "stand" = "chunk",
  ) {
    const owner = zone?.owner ?? actor;
    if (mu.op === "SPAWN") {
      const components = this.validateComponents(mu.components);
      const entity_id = mu.entity_id ?? randomId("e_");
      if (this.getRow(entity_id)) throw new MutationError("duplicate", "ya existe una entidad con ese id");
      if (zone) {
        this.checkZone(components, zone);
        this.checkParcel(zone.owner, { entities: 1, tris: estimateTris(components), lights: components["light@1"] ? 1 : 0 });
      } else if (budget !== "stand") {
        if (budget === "chunk") {
          const count = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM entities WHERE ${CHUNK_BUDGET_WHERE}`).one().n;
          if (count >= BUDGETS.maxEntitiesPerChunk) throw new MutationError("budget_exceeded", "chunk lleno de entidades", { max: BUDGETS.maxEntitiesPerChunk });
        }
        if (components["light@1"]) this.checkLights(1);
        this.checkTris(estimateTris(components), 0);
      }
      const entity = this.insertEntity(entity_id, owner, components);
      this.logEvent(actor, "SPAWN", entity_id, 1, components);
      return { entity_id, rev: 1, change: { kind: "upsert" as const, entity } };
    }

    const row = this.getRow(mu.entity_id);
    if (!row) throw new MutationError("not_found", "la entidad no existe");
    if (row.owner !== owner && !isAdmin) throw new MutationError("forbidden", "solo el dueño puede modificar esta entidad");
    if (row.rev !== mu.base_rev) throw new MutationError("version_conflict", "la entidad cambió desde que la leíste", { current_rev: row.rev });

    if (mu.op === "DESPAWN") {
      this.sql.exec("DELETE FROM entities WHERE entity_id = ?", mu.entity_id);
      this.logEvent(actor, "DESPAWN", mu.entity_id, row.rev + 1, null);
      return { entity_id: mu.entity_id, rev: row.rev + 1, change: { kind: "remove" as const, entity_id: mu.entity_id } };
    }

    // PATCH: fusión superficial por componente; null elimina un componente (salvo transform).
    const current = (JSON.parse(row.data) as Entity).components;
    const merged: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(mu.components)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    const components = this.validateComponents(merged);
    const hadLight = !!(JSON.parse(row.data) as Entity).components["light@1"];
    const tris = estimateTris(components);
    if (zone) {
      // Un PATCH sin mesh@1 nuevo no trae medidas: se usan las del modelo que ya tiene.
      this.checkZone(components, zone);
      this.checkParcel(zone.owner, { entities: 0, tris: tris - row.tris, lights: components["light@1"] && !hadLight ? 1 : 0 });
    } else if (budget !== "stand") {
      if (components["light@1"] && !hadLight) this.checkLights(1);
      this.checkTris(tris, row.tris);
    }
    const rev = row.rev + 1;
    const entity = this.entityOf(mu.entity_id, row.owner, rev, components);
    this.sql.exec("UPDATE entities SET rev = ?, tris = ?, data = ? WHERE entity_id = ?", rev, tris, JSON.stringify(entity), mu.entity_id);
    // En el registro, lo cambiado tal como quedó tras validarlo (nunca lo que mandó el cliente sin más).
    const logged: Record<string, unknown> = {};
    for (const k of Object.keys(mu.components)) logged[k] = mu.components[k] === null ? null : ((components as Record<string, unknown>)[k] ?? null);
    this.logEvent(actor, "PATCH", mu.entity_id, rev, logged);
    return { entity_id: mu.entity_id, rev, change: { kind: "upsert" as const, entity } };
  }

  /**
   * Sustituye los datos de cada LOD de mesh@1 por los medidos al subirlo; falla si el asset no existe.
   * Devuelve también las medidas del modelo (del primer LOD), para comprobar que cabe en una parcela.
   */
  private async resolveAssets(mu: MutationOp): Promise<{ mu: MutationOp; meshBounds: { min: number[]; max: number[] } | null }> {
    if (mu.op === "DESPAWN") return { mu, meshBounds: null };
    const mesh = mu.components["mesh@1"] as { lods?: { hash?: unknown }[] } | null | undefined;
    if (!mesh || !Array.isArray(mesh.lods)) return { mu, meshBounds: null };
    let meshBounds: { min: number[]; max: number[] } | null = null;
    const lods = [];
    for (const lod of mesh.lods) {
      if (typeof lod?.hash !== "string") throw new MutationError("bad_message", "cada LOD necesita un hash");
      // Piezas del sistema (las de la forja): vienen con el Worker, no de R2. Cualquiera puede usarlas.
      const system = SYSTEM_LODS.get(lod.hash);
      if (system !== undefined) {
        lods.push({ hash: lod.hash, media: "model/gltf-binary", tris: system });
        if (lods.length === 1) meshBounds = SYSTEM_BOUNDS.get(lod.hash) ?? null;
        continue;
      }
      const meta = await this.assetHead(lod.hash);
      if (!meta) throw new MutationError("not_found", `el asset ${lod.hash} no existe; súbelo antes a /assets`);
      lods.push({ hash: lod.hash, media: "model/gltf-binary", tris: Number(meta.customMetadata?.tris ?? 0) });
      if (lods.length === 1) meshBounds = parseBounds(meta.customMetadata?.bounds);
    }
    return { mu: { ...mu, components: { ...mu.components, "mesh@1": { ...mesh, lods } } }, meshBounds };
  }

  /**
   * Medidas de un modelo de la gente (de R2). En el servidor de distritos no hay R2: se piden al
   * Worker de Cloudflare (`ASSETS_URL`/assets/<hash>/meta), que las guarda en su caché.
   */
  private async assetHead(hash: string): Promise<{ customMetadata?: Record<string, string> } | null> {
    if (!/^sha256:[0-9a-f]{64}$/.test(hash)) return null;
    if (this.env.ASSETS) return this.env.ASSETS.head(assetKey(hash));
    const base = (this.env as unknown as { ASSETS_URL?: string }).ASSETS_URL;
    if (!base) return null;
    // Cada pregunta es una petición al Worker (cuenta en su cupo diario): se recuerdan las respuestas,
    // también las de «no existe» (un rato corto: puede subirse después).
    const now = Date.now();
    const hit = REMOTE_META.get(hash);
    if (hit && now < hit.until) return hit.meta;
    const r = await fetch(new URL(`/assets/${hash.slice(7)}/meta`, base));
    const meta = r.ok ? ((await r.json()) as { customMetadata?: Record<string, string> }) : null;
    if (r.ok || r.status === 404) {
      if (REMOTE_META.size >= REMOTE_META_MAX) REMOTE_META.clear();
      REMOTE_META.set(hash, { meta, until: now + (meta ? REMOTE_META_TTL_MS : REMOTE_META_MISS_MS) });
    }
    return meta;
  }

  /** Medidas del modelo que ya lleva una entidad (para un PATCH en una parcela que solo la mueve). */
  private async boundsOfEntity(entityId: string): Promise<{ min: number[]; max: number[] } | null> {
    const row = this.getRow(entityId);
    const mesh = row ? ((JSON.parse(row.data) as Entity).components["mesh@1"] as { lods?: { hash?: string }[] } | undefined) : undefined;
    const hash = mesh?.lods?.[0]?.hash;
    if (!hash) return null;
    if (SYSTEM_BOUNDS.has(hash)) return SYSTEM_BOUNDS.get(hash) ?? null;
    const meta = await this.assetHead(hash);
    return parseBounds(meta?.customMetadata?.bounds);
  }

  /** Que lo de una parcela quepa entero en ella (sin padre: su posición es la del chunk). */
  private checkZone(c: Components, zone: Zone & { meshBounds: { min: number[]; max: number[] } | null }) {
    if (c["transform@1"].parent) throw new MutationError("bad_message", "en una parcela, las entidades van sin padre (parent: null) por ahora");
    const local = localBox(c, zone.meshBounds);
    if (!local) throw new MutationError("bad_message", "no se pudieron leer las medidas del modelo; vuelve a subirlo");
    const box = worldBox(c["transform@1"], local);
    if (!fitsZone(box, zone)) {
      throw new MutationError("budget_exceeded", "no cabe entero en tu parcela", {
        reason: "out_of_zone",
        parcel: { x0: zone.x0, z0: zone.z0, x1: zone.x1, z1: zone.z1, max_height: PARCEL_BUDGETS.maxHeight },
        box: { min: box.min.map(r3), max: box.max.map(r3) },
      });
    }
    // El portal del proyecto y la franja que abre su ficha quedan libres: si no, nadie llega a él.
    const i = parcelIndex(zone.parcel);
    const r = i >= 0 ? parcelReserved(i) : null;
    // Un suelo plano (hasta 10 cm) sí puede pasar por debajo.
    if (r && box.max[1] > 0.1 && box.min[0] < r.x1 && box.max[0] > r.x0 && box.min[2] < r.z1 && box.max[2] > r.z0 && box.min[1] < r.y1) {
      throw new MutationError("budget_exceeded", "eso tapa el portal de tu proyecto o el sitio para llegar a él", {
        reason: "portal_area",
        reserved: { x0: r3(r.x0), z0: r3(r.z0), x1: r3(r.x1), z1: r3(r.z1), max_y: r.y1 },
        box: { min: box.min.map(r3), max: box.max.map(r3) },
      });
    }
  }

  /** Presupuesto de una parcela: lo que ya tiene su proyecto más lo que se añade. */
  private checkParcel(owner: string, add: { entities: number; tris: number; lights: number }) {
    const now = this.sql
      .exec<{ n: number; t: number | null; l: number }>(
        `SELECT COUNT(*) AS n, SUM(tris) AS t, SUM(CASE WHEN data LIKE '%"light@1"%' THEN 1 ELSE 0 END) AS l FROM entities WHERE owner = ?`,
        owner,
      )
      .one();
    const B = PARCEL_BUDGETS;
    if (now.n + add.entities > B.maxEntities) throw new MutationError("budget_exceeded", "tu parcela ya tiene todas las piezas que caben", { max: B.maxEntities, used: now.n });
    if ((now.t ?? 0) + add.tris > B.maxTris) throw new MutationError("budget_exceeded", "tu parcela superaría su presupuesto de triángulos", { max: B.maxTris, used: now.t ?? 0, add: add.tris });
    if (now.l + add.lights > B.maxLights) throw new MutationError("budget_exceeded", "tu parcela ya tiene todas las luces que caben", { max: B.maxLights });
  }

  /* ---------------------------------------------------------------- */
  /* Stands de proyectos (los coloca el Directory con la misma puerta)  */
  /* ---------------------------------------------------------------- */

  /**
   * Coloca el portal de un proyecto en su parcela del distrito: marco, portada en la pantalla,
   * monumento en la peana, banda con el color del distrito y rótulo. Pasa por applyMutation:
   * mismos esquemas, presupuestos, log y DELTA que cualquier otra escritura.
   */
  /** Lo llama el Worker antes de cada RPC (ver chunk() en index.ts): dice qué chunk es este objeto. */
  async bind(id: string): Promise<void> {
    this.ensureChunk(id);
  }

  async placeStand(input: {
    projectId: string;
    owner: string;
    title: string;
    category: string;
    cover: string;
    parcel: number;
    mesh: { hash: string; bounds: { min: number[]; max: number[] } | null };
  }): Promise<{ ok: true; slot: number } | { ok: false; code: string; message: string }> {
    this.ensureChunk(null);
    const district = districtByChunk(this.chunkId!);
    if (!district) return { ok: false, code: "forbidden", message: "los proyectos van en una parcela de un distrito" };
    if (!PARCELS[input.parcel]) return { ok: false, code: "bad_parcel", message: "esa parcela no existe" };
    const taken = this.sql.exec("SELECT 1 FROM stands WHERE slot = ?", input.parcel).toArray().length > 0;
    if (taken) return { ok: false, code: "parcel_taken", message: "esa parcela ya está ocupada" };

    const entities = portalEntities(parcelSlot(input.parcel), standIds(input.projectId), {
      portal: {
        to: { kind: "project", project_id: input.projectId },
        size: [4, 2.25],
        cover: input.cover,
        title: input.title,
        category: input.category,
      },
      title: input.title,
      color: district.color,
      monument: { lods: [{ hash: input.mesh.hash, tris: 0 }], bounds: input.mesh.bounds },
    });
    try {
      const changes = await this.spawnAll(input.owner, entities, () =>
        this.sql.exec("INSERT INTO stands (project_id, slot) VALUES (?, ?)", input.projectId, input.parcel),
      );
      this.broadcast(msg("DELTA", { changes }));
      return { ok: true, slot: input.parcel };
    } catch (e) {
      if (e instanceof MutationError) return { ok: false, code: e.code, message: e.message };
      throw e;
    }
  }

  /** Crea varias entidades en una sola transacción (con la misma validación que MUTATE_WORLD). */
  private async spawnAll(owner: string, entities: Seeded[], also?: () => void) {
    const resolved: MutationOp[] = [];
    for (const e of entities) resolved.push((await this.resolveAssets({ op: "SPAWN", entity_id: e.id, components: e.components })).mu);
    return this.ctx.storage.transactionSync(() => {
      const out = resolved.map((op) => this.applyMutation(owner, false, op, null, "stand").change);
      also?.();
      return out;
    });
  }

  /**
   * Los ids que pone el sistema (máquinas, anuncios, puertas) son suyos: si otro los ocupa (de antes de
   * reservarlos), se quita lo suyo en vez de dejar de actualizar las pantallas para siempre.
   */
  private evictSquatters(ids: string[], owner: string) {
    const out: { kind: "remove"; entity_id: string }[] = [];
    for (const id of ids) {
      const row = this.getRow(id);
      if (!row || row.owner === owner) continue;
      this.sql.exec("DELETE FROM entities WHERE entity_id = ?", id);
      this.sql.exec("DELETE FROM sandbox WHERE entity_id = ?", id);
      this.logEvent("system", "DESPAWN", id, row.rev + 1, { reason: "reserved_id" });
      out.push({ kind: "remove", entity_id: id });
    }
    return out;
  }

  /** ¿Es un id que solo pone el sistema? (prefijos reservados, los del distrito y la semilla del lugar). */
  private reservedId(id: string): boolean {
    if (RESERVED_IDS.test(id) || this.seedIds.has(id)) return true;
    const d = this.chunkId ? districtByChunk(this.chunkId) : null;
    return !!d && id.toLowerCase().startsWith(`${d.id}_`);
  }

  /** Borra entidades por id sin pasar por el dueño (solo para el sistema: stands y escaparate). */
  private despawnIds(ids: string[], reason: string) {
    const out: { kind: "remove"; entity_id: string }[] = [];
    for (const id of ids) {
      const row = this.getRow(id);
      if (!row) continue;
      this.sql.exec("DELETE FROM entities WHERE entity_id = ?", id);
      this.logEvent("system", "DESPAWN", id, row.rev + 1, { reason });
      out.push({ kind: "remove", entity_id: id });
    }
    return out;
  }

  /**
   * Escaparate del nexo: los proyectos más nuevos, cada uno en un portal que lleva a su parcela.
   * Recibe la lista completa deseada (de más nuevo a más viejo) y deja el nexo igual que ella.
   */
  async syncShowcase(items: ShowcaseItem[]): Promise<{ shown: number }> {
    this.ensureChunk(null);
    if (this.chunkId !== PLACES.nexo) return { shown: 0 };
    const want = items.slice(0, SHOWCASE_SLOTS.length);
    const wantIds = new Set(want.map((i) => i.projectId));
    const rows = this.sql.exec<{ project_id: string; slot: number }>("SELECT project_id, slot FROM showcase").toArray();
    const changes: ({ kind: "remove"; entity_id: string } | { kind: "upsert"; entity: Entity })[] = [];
    for (const r of rows) {
      if (wantIds.has(r.project_id)) continue;
      changes.push(...this.ctx.storage.transactionSync(() => {
        const out = this.despawnIds(Object.values(showIds(r.project_id)), "showcase");
        this.sql.exec("DELETE FROM showcase WHERE project_id = ?", r.project_id);
        return out;
      }));
    }
    const present = new Map(this.sql.exec<{ project_id: string; slot: number }>("SELECT project_id, slot FROM showcase").toArray().map((r) => [r.project_id, r.slot]));
    const used = new Set(present.values());
    for (const item of want) {
      if (present.has(item.projectId)) continue;
      const slot = SHOWCASE_SLOTS.find((s) => !used.has(s.index));
      if (!slot) break;
      used.add(slot.index);
      const entities = portalEntities(slot, showIds(item.projectId), {
        portal: {
          to: { kind: "chunk", chunk_id: item.chunk, spawn: item.spawn, yaw: item.yaw },
          size: [4, 2.25],
          cover: item.cover,
          title: item.title,
          category: item.category,
        },
        title: item.title,
        ...(item.mesh ? { monument: { lods: [{ hash: item.mesh.hash, tris: 0 }], bounds: item.mesh.bounds } } : {}),
      });
      try {
        changes.push(
          ...(await this.spawnAll("system", entities, () =>
            this.sql.exec("INSERT INTO showcase (project_id, slot) VALUES (?, ?)", item.projectId, slot.index),
          )),
        );
      } catch (e) {
        if (!(e instanceof MutationError)) throw e;
        console.warn("escaparate: no se pudo colocar", item.projectId, e.message);
      }
    }
    if (changes.length) this.broadcast(msg("DELTA", { changes }));
    return { shown: this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM showcase").one().n };
  }

  /** Retira el stand de un proyecto (borrado por su dueño, moderación o baja de la cuenta). */
  async removeStand(projectId: string): Promise<void> {
    this.ensureChunk(null);
    const changes = this.ctx.storage.transactionSync(() => {
      const out = this.despawnIds(Object.values(standIds(projectId)), "stand_removed");
      this.sql.exec("DELETE FROM stands WHERE project_id = ?", projectId);
      return out;
    });
    if (changes.length) this.broadcast(msg("DELTA", { changes }));
  }

  /** Supresión (RGPD): elimina todo lo que pertenece a un actor en este chunk (entidades y chat). */
  /** Corta las conexiones de estos agentes (clave revocada o proyecto retirado). */
  async kick(subs: string[]): Promise<number> {
    let n = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att && subs.includes(att.principal.sub)) {
        this.sendError(ws, undefined, "unauthorized", "tu clave de agente ya no vale");
        ws.close(4001, "revoked");
        n++;
      }
    }
    return n;
  }

  /**
   * Para mover un chunk de servidor (Cloudflare ↔ servidor de distritos): todo lo que no es del
   * sistema (lo siembra cada servidor solo), los portales de los proyectos, el chat (que pueden
   * pedir las denuncias) y la versión de la disposición de las parcelas.
   */
  async dumpState(): Promise<ChunkDump> {
    this.ensureChunk(null);
    return {
      chunk: this.chunkId!,
      parcel_layout: this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'parcel_layout'").toArray()[0]?.v ?? null,
      entities: this.sql.exec<ChunkDump["entities"][number]>("SELECT entity_id, owner, rev, tris, data FROM entities WHERE owner != 'system'").toArray(),
      stands: this.sql.exec<ChunkDump["stands"][number]>("SELECT project_id, slot FROM stands").toArray(),
      chat: this.sql.exec<ChunkDump["chat"][number]>("SELECT id, ts, sender, kind, display_name, session_id, text, hidden FROM chat").toArray(),
      community: this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'community'").toArray()[0]?.v ?? null,
      sandbox: this.sql.exec<NonNullable<ChunkDump["sandbox"]>[number]>("SELECT entity_id, owner, day, light FROM sandbox").toArray(),
      activities: {
        collected: this.sql.exec("SELECT * FROM act_collected").toArray(),
        hunts: this.sql.exec("SELECT * FROM act_hunt_done").toArray(),
        races: this.sql.exec("SELECT * FROM act_race_best").toArray(),
        points: this.sql.exec("SELECT * FROM act_points").toArray(),
        race_weeks: this.sql.exec("SELECT * FROM act_race_week").toArray(),
        loot: this.sql.exec("SELECT * FROM act_loot").toArray(),
      },
    };
  }

  /**
   * Huella barata de lo que se lleva dumpState (sin el chat, que es efímero): el Worker solo guarda
   * una copia nueva de un distrito de otro nodo cuando cambia (nodes.ts).
   */
  async stateRev(): Promise<string> {
    this.ensureChunk(null);
    const one = (q: string) => JSON.stringify(this.sql.exec(q).toArray()[0] ?? null);
    return [
      one("SELECT COUNT(*) AS n, COALESCE(SUM(rev), 0) AS r, COALESCE(SUM(LENGTH(data)), 0) AS b FROM entities WHERE owner != 'system'"),
      one("SELECT COUNT(*) AS n, COALESCE(SUM(slot), 0) AS s FROM stands"),
      one("SELECT COUNT(*) AS n, COALESCE(MAX(ts), 0) AS t FROM act_collected"),
      one("SELECT COUNT(*) AS n, COALESCE(MAX(ts), 0) AS t FROM act_race_best"),
      one("SELECT COUNT(*) AS n, COALESCE(MAX(ts), 0) AS t FROM act_hunt_done"),
      one("SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS p FROM act_points"),
      one("SELECT COUNT(*) AS n, COALESCE(MAX(ts), 0) AS t FROM act_loot"),
      one("SELECT v FROM meta WHERE k = 'community'"),
    ].join("|");
  }

  /** Sustituye lo de la gente por lo de otro servidor (ver dumpState). Echa a quien esté dentro. */
  async loadState(d: ChunkDump): Promise<{ entities: number; stands: number; chat: number }> {
    this.ensureChunk(null);
    if (d.chunk !== this.chunkId) throw new Error("ese volcado es de otro chunk");
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM entities WHERE owner != 'system'");
      for (const e of d.entities) {
        this.sql.exec("INSERT OR REPLACE INTO entities (entity_id, owner, rev, tris, data) VALUES (?, ?, ?, ?, ?)", e.entity_id, e.owner, e.rev, e.tris, e.data);
      }
      this.sql.exec("DELETE FROM stands");
      for (const s of d.stands) this.sql.exec("INSERT INTO stands (project_id, slot) VALUES (?, ?)", s.project_id, s.slot);
      this.sql.exec("DELETE FROM chat");
      for (const c of d.chat) {
        this.sql.exec("INSERT INTO chat (id, ts, sender, kind, display_name, session_id, text, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", c.id, c.ts, c.sender, c.kind, c.display_name, c.session_id, c.text, c.hidden);
      }
      if (d.parcel_layout) this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('parcel_layout', ?)", d.parcel_layout);
      if (d.activities) {
        this.sql.exec("DELETE FROM act_collected");
        this.sql.exec("DELETE FROM act_hunt_done");
        this.sql.exec("DELETE FROM act_race_best");
        for (const r of d.activities.collected as { sub: string; entity_id: string; set_key: string; ts: number }[]) {
          this.sql.exec("INSERT OR IGNORE INTO act_collected (sub, entity_id, set_key, ts) VALUES (?, ?, ?, ?)", r.sub, r.entity_id, r.set_key, r.ts);
        }
        for (const r of d.activities.hunts as { set_key: string; sub: string; name: string; player_no: number | null; ts: number }[]) {
          this.sql.exec("INSERT OR IGNORE INTO act_hunt_done (set_key, sub, name, player_no, ts) VALUES (?, ?, ?, ?, ?)", r.set_key, r.sub, r.name, r.player_no, r.ts);
        }
        for (const r of d.activities.races as { race_key: string; sub: string; name: string; player_no: number | null; ms: number; ts: number }[]) {
          this.sql.exec("INSERT OR IGNORE INTO act_race_best (race_key, sub, name, player_no, ms, ts) VALUES (?, ?, ?, ?, ?, ?)", r.race_key, r.sub, r.name, r.player_no, r.ms, r.ts);
        }
        this.sql.exec("DELETE FROM act_race_week");
        for (const r of (d.activities.race_weeks ?? []) as { race_key: string; week: string; sub: string; name: string; player_no: number | null; ms: number; ts: number }[]) {
          this.sql.exec("INSERT OR IGNORE INTO act_race_week (race_key, week, sub, name, player_no, ms, ts) VALUES (?, ?, ?, ?, ?, ?, ?)", r.race_key, r.week, r.sub, r.name, r.player_no, r.ms, r.ts);
        }
        this.sql.exec("DELETE FROM act_points");
        for (const r of (d.activities.points ?? []) as { board_key: string; day: string; sub: string; name: string; player_no: number | null; points: number; ts: number }[]) {
          this.sql.exec("INSERT OR IGNORE INTO act_points (board_key, day, sub, name, player_no, points, ts) VALUES (?, ?, ?, ?, ?, ?, ?)", r.board_key, r.day, r.sub, r.name, r.player_no, r.points, r.ts);
        }
        this.sql.exec("DELETE FROM act_loot");
        for (const r of (d.activities.loot ?? []) as { sub: string; weapon: string; race_key: string; ts: number }[]) {
          this.sql.exec("INSERT INTO act_loot (sub, weapon, race_key, ts) VALUES (?, ?, ?, ?)", r.sub, r.weapon, r.race_key, r.ts);
        }
      }
      if (d.sandbox) {
        this.sql.exec("DELETE FROM sandbox");
        for (const r of d.sandbox) this.sql.exec("INSERT OR REPLACE INTO sandbox (entity_id, owner, day, light) VALUES (?, ?, ?, ?)", r.entity_id, r.owner, r.day, r.light);
      }
      if (d.community) {
        this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('community', ?)", d.community);
        this.community = JSON.parse(d.community) as CommunityMeta;
      }
      this.logEvent("system", "IMPORT", this.chunkId!, d.entities.length, null);
    });
    if (this.community) this.applySeed(`community_${this.community.id}`, 1, this.community.system);
    for (const ws of this.ctx.getWebSockets()) ws.close(1012, "el distrito se ha movido de servidor: vuelve a entrar");
    return { entities: d.entities.length, stands: d.stands.length, chat: d.chat.length };
  }

  /**
   * Distrito de la comunidad: pone lo de su ficha (de `dst_<id>`) y lo del sistema (suelo y puerta),
   * o lo quita todo (`null`). Lo llama el Worker al guardar la ficha. Quien esté dentro vuelve a
   * entrar solo (el cliente se reconecta) y ve el distrito nuevo.
   */
  async installDistrict(spec: { meta: CommunityMeta; content: Seeded[] } | null): Promise<{ entities: number }> {
    this.ensureChunk(null);
    if (!isCommunityChunk(this.chunkId!)) throw new Error("solo en los chunks de la comunidad");
    const owner = (id: string) => `dst_${id}`;
    this.ctx.storage.transactionSync(() => {
      if (this.community) this.sql.exec("DELETE FROM entities WHERE owner = ?", owner(this.community.id));
      if (!spec) {
        this.sql.exec("DELETE FROM entities WHERE owner = 'system'");
        this.sql.exec("DELETE FROM meta WHERE k IN ('community', 'seed_version')");
        this.sql.exec("DELETE FROM chat");
        this.community = null;
      } else {
        for (const e of spec.content) this.insertEntity(e.id, owner(spec.meta.id), e.components);
        this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('community', ?)", JSON.stringify(spec.meta));
        this.community = spec.meta;
      }
      this.logEvent("system", spec ? "INSTALL" : "UNINSTALL", this.chunkId!, spec?.content.length ?? 0, null);
    });
    if (spec) this.applySeed(`community_${spec.meta.id}`, 1, spec.meta.system);
    for (const ws of this.ctx.getWebSockets()) ws.close(1012, "el distrito ha cambiado: vuelve a entrar");
    return { entities: spec?.content.length ?? 0 };
  }

  /**
   * Máquinas-portal de la plaza de un distrito (district-activities.json → `cabinets`): en la
   * pantalla de cada máquina, la portada de uno de los juegos del distrito (los más nuevos), que
   * abre ese juego. Las máquinas son del sembrado; aquí solo van las pantallas (dueño `cabinets`).
   */
  async syncCabinets(items: { projectId: string; title: string; category: string; cover: string }[]): Promise<{ shown: number }> {
    this.ensureChunk(null);
    const district = districtByChunk(this.chunkId!);
    const slots = district ? cabinetSlots(district.id) : [];
    const OWNER = "cabinets";
    const seed: Seeded[] = items.slice(0, slots.length).map((it, n) => {
      const sl = slots[n]!;
      return {
        id: `cabinet_${n + 1}`,
        components: {
          "transform@1": { p: at(sl.p[0], sl.p[2], sl.yaw, 0, sl.p[1] + CABINET_SCREEN.y, CABINET_SCREEN.z), r: yaw(sl.yaw), s: [1, 1, 1], parent: null },
          "portal@1": { to: { kind: "project", project_id: it.projectId }, size: CABINET_SCREEN.size, cover: it.cover, title: it.title, category: it.category },
        } as Components,
      };
    });
    const before = this.sql.exec<{ entity_id: string }>("SELECT entity_id FROM entities WHERE owner = ?", OWNER).toArray().map((r) => r.entity_id);
    const changes: ({ kind: "remove"; entity_id: string } | { kind: "upsert"; entity: Entity })[] = [];
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM entities WHERE owner = ?", OWNER);
      for (const id of before) if (!seed.some((x) => x.id === id)) changes.push({ kind: "remove", entity_id: id });
      changes.push(...this.evictSquatters(seed.map((x) => x.id), OWNER));
      for (const e of seed) changes.push({ kind: "upsert", entity: this.insertEntity(e.id, OWNER, e.components) });
      this.logEvent("system", "CABINETS", this.chunkId!, seed.length, null);
    });
    if (changes.length) this.broadcast(msg("DELTA", { changes }));
    return { shown: seed.length };
  }

  /**
   * Anuncios de fachada (Distrito Cero): las portadas de los proyectos más nuevos de la comunidad en
   * los marcos de las torres. Son portales a su proyecto, pero altos: nadie los cruza andando.
   */
  async syncBillboards(items: { projectId: string; title: string; category: string; cover: string }[]): Promise<{ shown: number }> {
    this.ensureChunk(null);
    const district = districtByChunk(this.chunkId!);
    const slots = district ? billboardSlots(district.id) : [];
    const OWNER = "billboards";
    const seed: Seeded[] = items.slice(0, slots.length).map((it, n) => {
      const sl = slots[n]!;
      return {
        id: `billboard_${n + 1}`,
        components: {
          "transform@1": { p: at(sl.p[0], sl.p[2], sl.yaw, 0, sl.p[1], 0.26), r: yaw(sl.yaw), s: [1, 1, 1], parent: null },
          "portal@1": { to: { kind: "project", project_id: it.projectId }, size: sl.size, cover: it.cover, title: it.title, category: it.category },
        } as Components,
      };
    });
    const before = this.sql.exec<{ entity_id: string }>("SELECT entity_id FROM entities WHERE owner = ?", OWNER).toArray().map((r) => r.entity_id);
    const changes: ({ kind: "remove"; entity_id: string } | { kind: "upsert"; entity: Entity })[] = [];
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM entities WHERE owner = ?", OWNER);
      for (const id of before) if (!seed.some((x) => x.id === id)) changes.push({ kind: "remove", entity_id: id });
      changes.push(...this.evictSquatters(seed.map((x) => x.id), OWNER));
      for (const e of seed) changes.push({ kind: "upsert", entity: this.insertEntity(e.id, OWNER, e.components) });
      this.logEvent("system", "BILLBOARDS", this.chunkId!, seed.length, null);
    });
    if (changes.length) this.broadcast(msg("DELTA", { changes }));
    return { shown: seed.length };
  }

  /** Puertas de los distritos de la comunidad en el nexo (nexo.ts → communityGates). */
  async setCommunityGates(seed: Seeded[]): Promise<{ gates: number }> {
    this.ensureChunk(null);
    if (this.chunkId !== PLACES.nexo) throw new Error("solo en el nexo");
    return this.writeCommunityGates(seed);
  }

  private writeCommunityGates(seed: Seeded[]): { gates: number } {
    const OWNER = "community_gates";
    const before = this.sql.exec<{ entity_id: string }>("SELECT entity_id FROM entities WHERE owner = ?", OWNER).toArray().map((r) => r.entity_id);
    const changes: ({ kind: "remove"; entity_id: string } | { kind: "upsert"; entity: Entity })[] = [];
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM entities WHERE owner = ?", OWNER);
      for (const id of before) if (!seed.some((s) => s.id === id)) changes.push({ kind: "remove", entity_id: id });
      changes.push(...this.evictSquatters(seed.map((s) => s.id), OWNER));
      for (const e of seed) changes.push({ kind: "upsert", entity: this.insertEntity(e.id, OWNER, e.components) });
      this.logEvent("system", "COMMUNITY_GATES", "nexo", seed.length, null);
    });
    if (changes.length) this.broadcast(msg("DELTA", { changes }));
    return { gates: seed.length };
  }

  async purgeOwner(owner: string): Promise<number> {
    this.ensureChunk(null);
    const ids = this.sql.exec<{ entity_id: string }>("SELECT entity_id FROM entities WHERE owner = ?", owner).toArray().map((r) => r.entity_id);
    const chatIds = this.sql.exec<{ id: string }>("SELECT id FROM chat WHERE sender = ?", owner).toArray().map((r) => r.id);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM entities WHERE owner = ?", owner);
      this.sql.exec("DELETE FROM chat WHERE sender = ?", owner);
      this.sql.exec("DELETE FROM act_collected WHERE sub = ?", owner);
      this.sql.exec("DELETE FROM act_hunt_done WHERE sub = ?", owner);
      this.sql.exec("DELETE FROM act_race_best WHERE sub = ?", owner);
      this.sql.exec("DELETE FROM act_race_week WHERE sub = ?", owner);
      this.sql.exec("DELETE FROM act_points WHERE sub = ?", owner);
      this.sql.exec("DELETE FROM act_loot WHERE sub = ?", owner);
      this.sql.exec("DELETE FROM sandbox WHERE owner = ?", owner);
      // Del registro se va quién y lo que escribió (rótulos…); de la idempotencia, sus claves.
      this.sql.exec("UPDATE events SET actor = 'deleted', data = NULL WHERE actor = ?", owner);
      this.sql.exec("DELETE FROM idem WHERE substr(key, 1, ?) = ?", owner.length + 1, `${owner}:`);
      if (ids.length) this.logEvent("system", "PURGE", "owner", ids.length, null);
    });
    if (ids.length) this.broadcast(msg("DELTA", { changes: ids.map((entity_id) => ({ kind: "remove" as const, entity_id })) }));
    for (const id of chatIds) this.broadcast(msg("CHAT_REMOVED", { id }));
    return ids.length + chatIds.length;
  }

  /* ---------------------------------------------------------------- */
  /* Chat                                                               */
  /* ---------------------------------------------------------------- */

  private handleChat(ws: WebSocket, att: Attachment, ref: string | undefined, raw: string) {
    const kind = att.principal.kind;
    if (kind === "guest") return this.sendError(ws, ref, "forbidden", "crea una cuenta para escribir en el chat");
    if (this.isClosed("chat")) return this.sendError(ws, ref, "forbidden", "el chat está cerrado por ahora", { reason: "closed" });
    // Sin caracteres de control ni de formato ni espacios de más (cleanText). Los enlaces se muestran
    // como texto, nunca clicables.
    const text = cleanText(raw, BUDGETS.maxChatChars);
    if (!text) return this.sendError(ws, ref, "bad_message", "mensaje vacío");

    const sub = att.principal.sub;
    const now = Date.now();
    const recent = (this.chatLog.get(sub) ?? []).filter((t) => now - t < 10_000);
    if (recent.length >= BUDGETS.maxChatPer10s) return this.sendError(ws, ref, "rate_limited", "vas muy rápido; espera unos segundos");
    recent.push(now);
    this.chatLog.set(sub, recent);
    this.pruneLog(this.chatLog, 10_000);

    const message = {
      id: randomId("m_", 8),
      session_id: att.session_id,
      sender: { kind, display_name: att.display_name },
      text,
      t: now,
    };
    this.sql.exec(
      "INSERT INTO chat (id, ts, sender, kind, display_name, session_id, text) VALUES (?, ?, ?, ?, ?, ?, ?)",
      message.id,
      now,
      sub,
      kind,
      att.display_name,
      att.session_id,
      text,
    );
    // Retención: 7 días y unos 2.000 mensajes por chunk. Recortar lee CHAT_KEEP filas: se hace cada
    // CHAT_TRIM_EVERY mensajes, no en cada uno.
    if (++this.chatSinceTrim >= CHAT_TRIM_EVERY) {
      this.chatSinceTrim = 0;
      this.sql.exec("DELETE FROM chat WHERE ts < ?", now - CHAT_RETENTION_MS);
      this.sql.exec("DELETE FROM chat WHERE id IN (SELECT id FROM chat ORDER BY ts DESC LIMIT -1 OFFSET ?)", CHAT_KEEP);
    }
    this.broadcast(msg("CHAT_MSG", message));
  }

  private recentChat() {
    return this.sql
      .exec<{ id: string; ts: number; kind: string; display_name: string; session_id: string; text: string }>(
        "SELECT id, ts, kind, display_name, session_id, text FROM chat WHERE hidden = 0 AND ts > ? ORDER BY ts DESC LIMIT 30",
        Date.now() - CHAT_RETENTION_MS,
      )
      .toArray()
      .reverse()
      .map((r) => ({
        id: r.id,
        session_id: r.session_id,
        sender: { kind: r.kind as "guest" | "user" | "agent", display_name: r.display_name },
        text: r.text,
        t: r.ts,
      }));
  }

  /** Copia de un mensaje para adjuntarla a una denuncia (el chat caduca; la denuncia no). */
  async chatMessage(id: string) {
    this.ensureChunk(null);
    return (
      this.sql
        .exec<{ id: string; ts: number; sender: string; display_name: string; text: string }>(
          "SELECT id, ts, sender, display_name, text FROM chat WHERE id = ?",
          id,
        )
        .toArray()[0] ?? null
    );
  }

  /** Moderación: retira un mensaje para todos. */
  async hideChat(id: string): Promise<boolean> {
    this.ensureChunk(null);
    const changed = this.sql.exec("UPDATE chat SET hidden = 1 WHERE id = ?", id).rowsWritten > 0;
    if (changed) this.broadcast(msg("CHAT_REMOVED", { id }));
    return changed;
  }

  /** Para la exportación de datos (RGPD). */
  /* ---------------------------------------------------------------- */
  /* Actividades: búsquedas, carreras y marcadores (activities.ts)       */
  /* ---------------------------------------------------------------- */

  /** Lo de las actividades de una persona en este lugar (para exportar sus datos). */
  async activityOf(sub: string) {
    this.ensureChunk(null);
    return {
      chunk: this.chunkId,
      collected: this.sql.exec("SELECT entity_id, set_key, ts FROM act_collected WHERE sub = ? ORDER BY ts", sub).toArray(),
      hunts_completed: this.sql.exec("SELECT set_key, ts FROM act_hunt_done WHERE sub = ?", sub).toArray(),
      best_times: this.sql.exec("SELECT race_key, ms, ts FROM act_race_best WHERE sub = ?", sub).toArray(),
      weekly_times: this.sql.exec("SELECT race_key, week, ms, ts FROM act_race_week WHERE sub = ?", sub).toArray(),
      daily_points: this.sql.exec("SELECT board_key, day, points FROM act_points WHERE sub = ?", sub).toArray(),
      loot: this.sql.exec<{ weapon: string; race_key: string; ts: number }>("SELECT weapon, race_key, ts FROM act_loot WHERE sub = ? ORDER BY ts", sub).toArray(),
      sandbox_pieces: this.sql
        .exec<{ entity_id: string; day: string; data: string }>("SELECT s.entity_id, s.day, e.data FROM sandbox s JOIN entities e ON e.entity_id = s.entity_id WHERE s.owner = ?", sub)
        .toArray()
        .map((r) => ({ entity_id: r.entity_id, day: r.day, components: (JSON.parse(r.data) as Entity).components })),
    };
  }

  /** Entidades de actividad del lugar, ya leídas (en caché hasta que cambie alguna entidad). */
  private activityEntities() {
    if (this.activityCache?.epoch !== this.entityEpoch) this.activityCache = { epoch: this.entityEpoch, list: this.readActivityEntities() };
    return this.activityCache.list;
  }

  private readActivityEntities() {
    const out: { id: string; owner: string; p: number[]; col?: { set: string; radius: number; note?: Record<string, string> }; cp?: CheckpointData }[] = [];
    for (const r of this.sql.exec<{ entity_id: string; owner: string; data: string }>("SELECT entity_id, owner, data FROM entities").toArray()) {
      if (!r.data.includes("collectible@1") && !r.data.includes("checkpoint@1")) continue;
      const e = JSON.parse(r.data) as Entity;
      const p = (e.components["transform@1"] as { p?: number[] } | undefined)?.p;
      if (!p) continue;
      const col = CollectibleV1.safeParse(e.components["collectible@1"]);
      const cp = CheckpointV1.safeParse(e.components["checkpoint@1"]);
      out.push({ id: r.entity_id, owner: r.owner, p, ...(col.success ? { col: col.data } : {}), ...(cp.success ? { cp: cp.data } : {}) });
    }
    return out;
  }

  private progressOf(sub: string) {
    const collected = this.sql.exec<{ entity_id: string }>("SELECT entity_id FROM act_collected WHERE sub = ?", sub).toArray().map((r) => r.entity_id);
    const best: Record<string, number> = {};
    for (const a of this.activityEntities()) {
      if (a.cp?.role !== "start") continue;
      const row = this.sql.exec<{ ms: number }>("SELECT ms FROM act_race_best WHERE race_key = ? AND sub = ?", activityKey(a.owner, a.cp.race), sub).toArray()[0];
      if (row) best[a.id] = row.ms;
    }
    return { collected, best };
  }

  /** ¿Está esta sesión cerca de verdad (su última pose, reciente) de `p`? */
  private sessionNear(att: Attachment, p: number[], r: number): boolean {
    const pose = this.poses.get(att.session_id);
    const age = Date.now() - (this.lastPoseAt.get(att.session_id) ?? 0);
    return !!pose && age <= POSE_MAX_AGE_MS && near(pose.head.p, p, r);
  }

  /** Tope de mensajes de actividad por sesión (como el del chat): 40 cada 10 s. */
  private activityAllowed(att: Attachment): boolean {
    const now = Date.now();
    const log = (this.activityLog.get(att.session_id) ?? []).filter((t) => now - t < 10_000);
    if (log.length >= 40) return false;
    log.push(now);
    this.activityLog.set(att.session_id, log);
    return true;
  }

  private handleCollect(ws: WebSocket, att: Attachment, ref: string | undefined, entityId: string) {
    if (this.solo) return this.sendError(ws, ref, "forbidden", "en el nexo no hay actividades");
    if (att.principal.kind !== "user") return this.sendError(ws, ref, "forbidden", "crea una cuenta para guardar lo que encuentras");
    if (!this.activityAllowed(att)) return this.sendError(ws, ref, "rate_limited", "demasiados avisos; espera un poco");
    const all = this.activityEntities();
    const it = all.find((a) => a.id === entityId && a.col);
    if (!it?.col) return this.sendError(ws, ref, "not_found", "eso no se puede recoger");
    if (this.jumpedRecently(att)) return this.sendError(ws, ref, "forbidden", "acabas de llegar de un salto: espera unos segundos", { reason: "jump" });
    if (!this.sessionNear(att, it.p, it.col.radius)) return this.sendError(ws, ref, "forbidden", "estás demasiado lejos");
    const sub = att.principal.sub;
    const key = activityKey(it.owner, it.col.set);
    const ids = all.filter((a) => a.owner === it.owner && a.col?.set === it.col!.set).map((a) => a.id);
    this.sql.exec("INSERT OR IGNORE INTO act_collected (sub, entity_id, set_key, ts) VALUES (?, ?, ?, ?)", sub, entityId, key, Date.now());
    this.scoreCache.clear();
    const mine = new Set(this.sql.exec<{ entity_id: string }>("SELECT entity_id FROM act_collected WHERE sub = ? AND set_key = ?", sub, key).toArray().map((r) => r.entity_id));
    const count = ids.filter((id) => mine.has(id)).length;
    const complete = count >= ids.length;
    if (complete) {
      this.sql.exec(
        "INSERT OR IGNORE INTO act_hunt_done (set_key, sub, name, player_no, ts) VALUES (?, ?, ?, ?, ?)",
        key, sub, att.principal.name ?? att.display_name, att.principal.no ?? null, Date.now(),
      );
    }
    this.send(ws, msg("COLLECTED", { entity_id: entityId, set: it.col.set, count, total: ids.length, complete, ...(it.col.note ? { note: it.col.note } : {}) }));
  }

  private handleCheckpoint(ws: WebSocket, att: Attachment, ref: string | undefined, entityId: string) {
    if (this.solo) return this.sendError(ws, ref, "forbidden", "en el nexo no hay actividades");
    const all = this.activityEntities();
    const it = all.find((a) => a.id === entityId && a.cp);
    // Las carreras de salida conjunta (con parrilla) van por rondas, y en ellas corre cualquiera.
    const grid = it?.cp && all.find((a) => a.owner === it.owner && a.cp?.race === it.cp!.race && a.cp.role === "start" && a.cp.mode === "grid");
    if (it?.cp && grid) {
      if (!this.activityAllowed(att)) return this.sendError(ws, ref, "rate_limited", "demasiados avisos; espera un poco");
      return this.handleRoundGate(ws, att, ref, it, grid, all.filter((a) => a.owner === it.owner && a.cp?.race === it.cp!.race));
    }
    if (att.principal.kind !== "user") return this.sendError(ws, ref, "forbidden", "crea una cuenta para que cuenten tus tiempos");
    if (!this.activityAllowed(att)) return this.sendError(ws, ref, "rate_limited", "demasiados avisos; espera un poco");
    if (!it?.cp) return this.sendError(ws, ref, "not_found", "eso no es un punto de carrera");
    if (this.jumpedRecently(att)) return this.sendError(ws, ref, "forbidden", "acabas de llegar de un salto: espera unos segundos", { reason: "jump" });
    if (!this.sessionNear(att, it.p, it.cp.radius)) return this.sendError(ws, ref, "forbidden", "estás demasiado lejos");
    // Las carreras son a pie: en coche no cuenta (y la que estuviera en marcha se anula).
    if (this.poses.get(att.session_id)?.vehicle) {
      if (att.run) {
        att.run = undefined;
        ws.serializeAttachment(att);
      }
      return this.sendError(ws, ref, "forbidden", "las carreras son a pie: bájate del coche");
    }
    const now = Date.now();
    const race = it.cp.race;
    const key = activityKey(it.owner, race);
    const points = all.filter((a) => a.owner === it.owner && a.cp?.race === race);
    const cps = points.filter((a) => a.cp!.role === "cp").sort((a, b) => a.cp!.order - b.cp!.order);
    const save = (run: RaceRun | undefined) => {
      att.run = run;
      ws.serializeAttachment(att);
    };
    let run = att.run && att.run.key === key && now - att.run.t0 <= RACE_TIMEOUT_MS ? att.run : undefined;

    if (it.cp.role === "start") {
      save({ key, race, owner: it.owner, t0: now, next: 1, total: cps.length });
      return this.send(ws, msg("RACE", { race, state: "start", next: 1, total: cps.length }));
    }
    if (!run) return; // sin salida no hay carrera: se ignora en silencio (se puede pasar por un punto sin correr)
    if (it.cp.role === "cp") {
      if (cps.at(run.next - 1)?.id !== it.id) return; // no es el que toca (o ya pasó por él)
      run = { ...run, next: run.next + 1 };
      save(run);
      return this.send(ws, msg("RACE", { race, state: "cp", next: run.next, total: run.total }));
    }
    // Meta: con todos los puntos y sin ir más rápido de lo posible.
    if (run.next !== cps.length + 1) return;
    const start = points.find((a) => a.cp!.role === "start");
    const ms = now - run.t0;
    save(undefined);
    if (!start || ms < minRaceMs([start.p, ...cps.map((c) => c.p), it.p])) {
      return this.send(ws, msg("RACE", { race, state: "reset" }));
    }
    const { best, rank } = this.recordRace(att, key, ms, now);
    const loot = this.rollLootFor(att, it.owner, race, key, now);
    this.send(ws, msg("RACE", { race, state: "finish", ms, best, rank, ...(loot ? { loot } : {}) }));
  }

  /** Apunta el tiempo de una cuenta en una carrera (su mejor de siempre y el de la semana) y dice cómo queda. */
  private recordRace(att: Attachment, key: string, ms: number, now: number): { best: number; rank: number } {
    const sub = att.principal.sub;
    const prev = this.sql.exec<{ ms: number }>("SELECT ms FROM act_race_best WHERE race_key = ? AND sub = ?", key, sub).toArray()[0]?.ms;
    if (prev === undefined || ms < prev) {
      this.sql.exec(
        "INSERT OR REPLACE INTO act_race_best (race_key, sub, name, player_no, ms, ts) VALUES (?, ?, ?, ?, ?, ?)",
        key, sub, att.principal.name ?? att.display_name, att.principal.no ?? null, ms, now,
      );
    }
    // Y el de la semana (para el marcador semanal).
    const week = isoWeek(now);
    const prevWeek = this.sql.exec<{ ms: number }>("SELECT ms FROM act_race_week WHERE race_key = ? AND week = ? AND sub = ?", key, week, sub).toArray()[0]?.ms;
    if (prevWeek === undefined || ms < prevWeek) {
      this.sql.exec(
        "INSERT OR REPLACE INTO act_race_week (race_key, week, sub, name, player_no, ms, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
        key, week, sub, att.principal.name ?? att.display_name, att.principal.no ?? null, ms, now,
      );
    }
    this.scoreCache.clear();
    const best = Math.min(ms, prev ?? ms);
    const rank = 1 + this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM act_race_best WHERE race_key = ? AND ms < ?", key, best).one().n;
    return { best, rank };
  }

  /* ---------------------------------------------------------------- */
  /* Carreras de salida conjunta (rounds.ts): parrilla, salida y clasificación */
  /* ---------------------------------------------------------------- */

  /**
   * Un aviso de punto en una carrera con parrilla (§7). En la salida: se entra en la ronda que se
   * está formando (o se abre una). En un punto o en la meta: cuenta si es la puerta que le toca a esa
   * sesión en la ronda que corre. En coche si la carrera lo es, y siempre con la pose de verdad.
   */
  private handleRoundGate(ws: WebSocket, att: Attachment, ref: string | undefined, it: ActivityItem, start: ActivityItem, points: ActivityItem[]) {
    const now = Date.now();
    const sid = att.session_id;
    const cp = it.cp!, conf = start.cp!;
    const key = activityKey(it.owner, cp.race);
    if (this.jumpedRecently(att)) return this.sendError(ws, ref, "forbidden", "acabas de llegar de un salto: espera unos segundos", { reason: "jump" });
    if (conf.vehicle === "car" && this.poses.get(sid)?.vehicle !== "car") return this.sendError(ws, ref, "forbidden", "esta carrera es en coche", { reason: "vehicle" });
    if (!this.sessionNear(att, it.p, cp.radius)) return this.sendError(ws, ref, "forbidden", "estás demasiado lejos");
    const cps = points.filter((a) => a.cp!.role === "cp").sort((a, b) => a.cp!.order - b.cp!.order);
    const finish = points.find((a) => a.cp!.role === "finish");
    if (!finish) return;
    const mine = (r: Round) => {
      const e = r.entrants.get(sid);
      return r.key === key && r.state === "running" && !!e && !e.out && e.ms === undefined;
    };
    const running = this.rounds.find(mine);
    if (cp.role === "start") {
      if (running) return; // pasa por la parrilla en plena carrera
      // Ya está en la que se forma (su cliente insiste mientras sigue en la parrilla): solo a él.
      const waiting = this.rounds.find((r) => r.key === key && r.state === "countdown" && r.entrants.has(sid));
      if (waiting) return this.sendRound(waiting, now, ws);
      const laps = conf.laps ?? 1;
      const r = joinRound(
        this.rounds,
        () => ({
          id: this.roundSeq + 1, key, race: cp.race, owner: it.owner, laps, perLap: cps.length + 1,
          minMs: minRoundMs([...cps.map((c) => c.p), finish.p], laps, conf.vehicle === "car" ? CAR_SPEED : MAX_SPEED), slots: conf.grid?.length ?? 0,
        }),
        { session_id: sid, sub: att.principal.sub, ranked: att.principal.kind === "user", name: att.principal.name ?? att.display_name, ...(att.principal.no != null ? { no: att.principal.no } : {}) },
        now,
      );
      if (!r) return this.sendError(ws, ref, "forbidden", "la parrilla está llena: espera a la siguiente", { reason: "full" });
      this.roundSeq = Math.max(this.roundSeq, r.id);
      // La salida, a su hora (como mucho unos segundos: el objeto no se queda despierto por esto).
      const old = this.roundTimers.get(r.id);
      if (old) clearTimeout(old);
      this.roundTimers.set(r.id, setTimeout(() => this.goRound(r, start), Math.max(0, r.goAt - now)));
      return this.sendRound(r, now);
    }
    if (!running) return;
    const e = running.entrants.get(sid)!;
    const res = passGate(running, sid, cp.role === "finish" ? "finish" : cps.findIndex((c) => c.id === it.id), now);
    if (!res) {
      // No era su puerta (nada que contar) o iba imposible de rápido: entonces se queda fuera, y se dice.
      if (!e.out) return;
      return roundOver(running, now) ? this.endRound(running, now) : this.sendRound(running, now);
    }
    if (res === "finish" && e.ranked && e.ms !== undefined) {
      const { best, rank } = this.recordRace(att, key, e.ms, now);
      this.send(ws, msg("RACE", { race: cp.race, state: "finish", ms: e.ms, best, rank }));
    }
    if (roundOver(running, now)) this.endRound(running, now);
    else this.sendRound(running, now);
  }

  /** La salida: quien no está en la parrilla (o no va en coche, si toca) se queda fuera. */
  private goRound(r: Round, start: ActivityItem) {
    this.roundTimers.delete(r.id);
    if (r.state !== "countdown") return;
    const now = Date.now();
    const car = start.cp!.vehicle === "car";
    const alive = startRound(r, (sid) => {
      const pose = this.poses.get(sid);
      return !!pose && now - (this.lastPoseAt.get(sid) ?? 0) <= POSE_MAX_AGE_MS && (!car || pose.vehicle === "car") && near(pose.head.p, start.p, start.cp!.radius);
    });
    if (!alive) return this.endRound(r, now);
    this.sendRound(r, now);
  }

  /** Cómo va una ronda: a todo el lugar o, con `only`, a una sola sesión. */
  private sendRound(r: Round, now: number, only?: WebSocket) {
    const m = msg("ROUND", {
      race: r.race, owner: r.owner, round: r.id, state: r.state, now, go_at: r.goAt, laps: r.laps, per_lap: r.perLap,
      entrants: standings(r).map((e) => ({
        session_id: e.session_id, name: e.name, ...(e.no != null ? { player_no: e.no } : {}), ...(e.slot !== undefined ? { slot: e.slot } : {}), gates: e.gates,
        ...(e.at !== undefined ? { at: e.at } : {}), ...(e.ms !== undefined ? { ms: e.ms } : {}), ...(e.out ? { out: true } : {}),
      })),
    });
    if (only) this.send(only, m);
    else this.broadcast(m);
  }

  private endRound(r: Round, now: number) {
    r.state = "done";
    const t = this.roundTimers.get(r.id);
    if (t) clearTimeout(t);
    this.roundTimers.delete(r.id);
    this.rounds = this.rounds.filter((x) => x !== r);
    this.sendRound(r, now);
  }

  /** Las rondas que ya han acabado (todos han llegado, o se ha pasado el tiempo) y quien se ha quedado en la parrilla. */
  private sweepRounds(now: number) {
    for (const r of [...this.rounds]) {
      const idle = dropIdle(r, now);
      if (roundOver(r, now)) this.endRound(r, now);
      else if (idle) this.sendRound(r, now);
    }
  }

  /** Una sesión deja las rondas en las que estuviera (se va, o llega de un salto). */
  private leaveRounds(sid: string, now: number) {
    for (const r of [...this.rounds]) {
      const e = r.entrants.get(sid);
      if (!e || e.out || e.ms !== undefined) continue;
      if (r.state === "countdown") {
        r.entrants.delete(sid);
        if (r.entrants.size === 0) this.endRound(r, now);
        else this.sendRound(r, now);
      } else {
        e.out = true;
        if (roundOver(r, now)) this.endRound(r, now);
        else this.sendRound(r, now);
      }
    }
  }

  /**
   * Cofre al llegar a la meta (§9 octies ter): en las carreras del sistema con tabla de botín (`loot`
   * del distrito: los niveles para tryhards de Vertical), un arma al azar. Se guarda aquí; el Worker
   * la pasa a la cuenta. `fresh`: no la tenía (ni en su sesión ni en lo que ya le había salido aquí).
   */
  private rollLootFor(att: Attachment, owner: string, race: string, key: string, now: number): { weapon: WeaponId; fresh: boolean } | null {
    if (owner !== "system" || this.community || !this.chunkId) return null;
    const table = districtByChunk(this.chunkId)?.loot?.[race];
    if (!isLootTable(table)) return null;
    const rnd = new Uint32Array(2);
    crypto.getRandomValues(rnd);
    const weapon = rollLoot(table, rnd[0]! / 2 ** 32, rnd[1]! / 2 ** 32);
    const sub = att.principal.sub;
    const had = (att.principal.w ?? []).includes(weapon) || this.sql.exec("SELECT 1 FROM act_loot WHERE sub = ? AND weapon = ? LIMIT 1", sub, weapon).toArray().length > 0;
    this.sql.exec("INSERT INTO act_loot (sub, weapon, race_key, ts) VALUES (?, ?, ?, ?)", sub, weapon, key, now);
    return { weapon, fresh: !had };
  }

  /* ---------------------------------------------------------------- */
  /* Tablero de baldosas (tiles@1): rondas mientras hay alguien encima    */
  /* ---------------------------------------------------------------- */

  private tileBoards(): TileBoard[] {
    const now = Date.now();
    if (now - this.tileBoardsAt < 10_000) return this.tileBoardsList;
    this.tileBoardsAt = now;
    const out: TileBoard[] = [];
    for (const r of this.sql.exec<{ entity_id: string; owner: string; data: string }>("SELECT entity_id, owner, data FROM entities").toArray()) {
      if (!r.data.includes("tiles@1")) continue;
      const e = JSON.parse(r.data) as Entity;
      const t = TilesV1.safeParse(e.components["tiles@1"]);
      const p = (e.components["transform@1"] as { p?: number[] } | undefined)?.p;
      if (!t.success || !p) continue;
      out.push({ entity_id: r.entity_id, owner: r.owner, id: t.data.id, x: p[0]!, y: p[1]!, z: p[2]!, cols: t.data.cols, rows: t.data.rows, size: t.data.size });
    }
    this.tileBoardsList = out;
    return out;
  }

  private tilesMsg(g: TileGame) {
    return msg("TILES", {
      entity_id: g.board.entity_id,
      round: g.round,
      state: g.state,
      lit: g.lit,
      done: [...g.done],
      ...(g.state === "show" ? { ms_left: Math.max(0, g.endsAt - Date.now()) } : {}),
    });
  }

  /** La pose de una sesión: si está sobre un tablero, cuenta como presencia y pisa su baldosa. */
  private tilesPose(att: Attachment, p: number[]) {
    if (this.solo) return;
    for (const b of this.tileBoards()) {
      if (Math.abs((p[1] ?? 0) - b.y) > 4) continue;
      const idx = tileAt(b, p[0]!, p[2]!);
      if (idx < 0) continue;
      const now = Date.now();
      let g = this.tileGames.get(b.entity_id);
      if (!g) {
        g = { board: b, round: 0, state: "idle", lit: [], done: new Set(), players: new Map(), endsAt: 0, lastPresence: now, timer: null };
        this.tileGames.set(b.entity_id, g);
      }
      g.board = b;
      g.lastPresence = now;
      if (g.state !== "show") {
        if (!g.timer) g.timer = setTimeout(() => this.tilesStart(g!), TILES_START_MS);
        continue;
      }
      if (!g.lit.includes(idx) || g.done.has(idx)) {
        if (g.lit.includes(idx) && att.principal.kind === "user") g.players.set(att.principal.sub, { name: att.principal.name ?? att.display_name, no: att.principal.no ?? null });
        continue;
      }
      g.done.add(idx);
      if (att.principal.kind === "user") g.players.set(att.principal.sub, { name: att.principal.name ?? att.display_name, no: att.principal.no ?? null });
      if (g.done.size >= g.lit.length) this.tilesEnd(g, true);
      else this.broadcast(this.tilesMsg(g));
    }
  }

  private tilesStart(g: TileGame) {
    g.timer = null;
    if (Date.now() - g.lastPresence > TILES_IDLE_MS) {
      if (g.state !== "idle") {
        g.state = "idle";
        g.lit = [];
        g.done.clear();
        this.broadcast(this.tilesMsg(g));
      }
      return;
    }
    g.round++;
    g.state = "show";
    g.lit = figureFor(g.round, g.board.cols, g.board.rows, g.board.entity_id.length);
    g.done = new Set();
    g.players = new Map();
    const ms = tilesRoundMs(g.lit.length);
    g.endsAt = Date.now() + ms;
    this.broadcast(this.tilesMsg(g));
    g.timer = setTimeout(() => this.tilesEnd(g, false), ms);
  }

  private tilesEnd(g: TileGame, won: boolean) {
    if (g.timer) clearTimeout(g.timer);
    g.state = won ? "won" : "lost";
    if (won && g.players.size) {
      this.scoreCache.clear();
      const key = activityKey(g.board.owner, g.board.id);
      const day = pointsDay(), now = Date.now();
      for (const [sub, who] of g.players) {
        this.sql.exec(
          `INSERT INTO act_points (board_key, day, sub, name, player_no, points, ts) VALUES (?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT (board_key, day, sub) DO UPDATE SET points = points + 1, name = excluded.name, ts = excluded.ts`,
          key, day, sub, who.name, who.no, now,
        );
      }
    }
    this.broadcast(this.tilesMsg(g));
    g.timer = setTimeout(() => this.tilesStart(g), TILES_PAUSE_MS);
  }

  /** Las 10 primeras filas de un marcador (lo usan SCORES y la web). */
  private scoreRows(owner: string, sb: { kind: "race" | "hunt" | "points" | "builds"; id: string; period?: "all" | "week" | "day" }) {
    type Row = { name: string; player_no: number | null; value: number; ts: number };
    const key = activityKey(owner, sb.id);
    const period = sb.period ?? (sb.kind === "points" ? "day" : "all");
    const now = Date.now();
    let rows: Row[];
    if (sb.kind === "builds") return { period, rows: this.buildRows() };
    if (sb.kind === "points") {
      rows =
        period === "day"
          ? this.sql.exec<Row>("SELECT name, player_no, points AS value, ts FROM act_points WHERE board_key = ? AND day = ? ORDER BY points DESC, ts ASC LIMIT ?", key, pointsDay(now), SCORES_LIMIT).toArray()
          : this.sql
              .exec<Row>(
                `SELECT MAX(name) AS name, MAX(player_no) AS player_no, SUM(points) AS value, MAX(ts) AS ts FROM act_points
                 WHERE board_key = ? ${period === "week" ? "AND day >= ?" : ""} GROUP BY sub ORDER BY value DESC, ts ASC LIMIT ?`,
                ...(period === "week" ? [key, pointsDay(weekStart(now)), SCORES_LIMIT] : [key, SCORES_LIMIT]),
              )
              .toArray();
    } else if (sb.kind === "race") {
      rows =
        period === "week"
          ? this.sql.exec<Row>("SELECT name, player_no, ms AS value, ts FROM act_race_week WHERE race_key = ? AND week = ? ORDER BY ms ASC, ts ASC LIMIT ?", key, isoWeek(now), SCORES_LIMIT).toArray()
          : this.sql.exec<Row>("SELECT name, player_no, ms AS value, ts FROM act_race_best WHERE race_key = ? ORDER BY ms ASC, ts ASC LIMIT ?", key, SCORES_LIMIT).toArray();
    } else {
      rows = this.sql
        .exec<Row>(
          `SELECT name, player_no, ts AS value, ts FROM act_hunt_done WHERE set_key = ? ${period === "week" ? "AND ts >= ?" : period === "day" ? "AND ts >= ?" : ""} ORDER BY ts ASC LIMIT ?`,
          ...(period === "all" ? [key, SCORES_LIMIT] : [key, period === "week" ? weekStart(now) : Date.parse(pointsDay(now)), SCORES_LIMIT]),
        )
        .toArray();
    }
    return { period, rows: rows.map((r) => ({ name: r.name, ...(r.player_no !== null ? { player_no: r.player_no } : {}), value: r.value, ts: r.ts })) };
  }

  /**
   * Lo que han construido los agentes en las parcelas de este lugar la última semana: por
   * proyecto, cuántos cambios y el último (el nombre, el del portal de su parcela).
   */
  private buildRows() {
    const since = Date.now() - 7 * 86_400_000;
    const evs = this.sql
      .exec<{ entity_id: string; ts: number }>(
        "SELECT entity_id, ts FROM events WHERE ts > ? AND op IN ('SPAWN', 'PATCH') AND actor NOT LIKE 'usr_%' AND actor != 'system' ORDER BY ts DESC LIMIT 2000",
        since,
      )
      .toArray();
    const by = new Map<string, { value: number; ts: number }>();
    for (const ev of evs) {
      const owner = this.getRow(ev.entity_id)?.owner;
      if (!owner?.startsWith("prj_")) continue;
      const cur = by.get(owner) ?? { value: 0, ts: 0 };
      cur.value++;
      cur.ts = Math.max(cur.ts, ev.ts);
      by.set(owner, cur);
    }
    return [...by.entries()]
      .sort((a, b) => b[1].ts - a[1].ts)
      .slice(0, SCORES_LIMIT)
      .map(([owner, v]) => {
        const stand = this.getRow(`stand_${owner.slice(4)}`);
        const title = stand ? ((JSON.parse(stand.data) as Entity).components["portal@1"] as { title?: string } | undefined)?.title : undefined;
        return { name: title ?? owner.slice(4), value: v.value, ts: v.ts };
      });
  }

  private handleScores(ws: WebSocket, att: Attachment, ref: string | undefined, entityId: string) {
    if (!this.activityAllowed(att)) return this.sendError(ws, ref, "rate_limited", "demasiadas peticiones; espera un poco");
    const row = this.getRow(entityId);
    const sb = row ? ScoreboardV1.safeParse((JSON.parse(row.data) as Entity).components["scoreboard@1"]) : null;
    if (!row || !sb?.success) return this.sendError(ws, ref, "not_found", "eso no es un marcador");
    const r = this.cachedScoreRows(entityId, row.owner, sb.data);
    this.send(ws, msg("SCORES", { entity_id: entityId, kind: sb.data.kind, period: r.period, rows: r.rows }));
  }

  /**
   * Filas de un marcador, guardadas SCORES_CACHE_MS (los «builds» recorren el registro de eventos):
   * se vacía al apuntar algo nuevo (recoger, una meta, un punto).
   */
  private cachedScoreRows(entityId: string, owner: string, sb: Parameters<ChunkRoom["scoreRows"]>[1]) {
    const now = Date.now();
    const hit = this.scoreCache.get(entityId);
    if (hit && now - hit.at < SCORES_CACHE_MS) return hit.value;
    const value = this.scoreRows(owner, sb);
    if (this.scoreCache.size > 64) this.scoreCache.clear();
    this.scoreCache.set(entityId, { at: now, value });
    return value;
  }

  /** Los marcadores del sistema de este lugar, con sus filas (para la web: GET /scores). */
  async boardsOf() {
    this.ensureChunk(null);
    const out: { entity_id: string; kind: string; id: string; period: string; title: Record<string, string> | null; rows: unknown[] }[] = [];
    for (const r of this.sql.exec<{ entity_id: string; owner: string; data: string }>("SELECT entity_id, owner, data FROM entities WHERE owner = 'system'").toArray()) {
      if (!r.data.includes("scoreboard@1")) continue;
      const sb = ScoreboardV1.safeParse((JSON.parse(r.data) as Entity).components["scoreboard@1"]);
      if (!sb.success) continue;
      const title = this.getRow(`${r.entity_id}_title`);
      const label = title ? ((JSON.parse(title.data) as Entity).components["label@1"] as { i18n?: Record<string, string> } | undefined)?.i18n ?? null : null;
      const rows = this.cachedScoreRows(r.entity_id, r.owner, sb.data);
      out.push({ entity_id: r.entity_id, kind: sb.data.kind, id: sb.data.id, period: rows.period, title: label, rows: rows.rows });
    }
    return out;
  }

  async chatOf(sender: string) {
    this.ensureChunk(null);
    return this.sql.exec("SELECT id, ts, display_name, text, hidden FROM chat WHERE sender = ? ORDER BY ts", sender).toArray();
  }

  private validateComponents(input: Record<string, unknown>): Components {
    const unknown = Object.keys(input).filter((k) => !(ACCEPTED_IN_V0 as readonly string[]).includes(k));
    if (unknown.length) throw new MutationError("unknown_component", "componentes no admitidos en v0", { unknown, accepted: ACCEPTED_IN_V0 });
    const r = ComponentsStrict.safeParse(input);
    if (!r.success) throw new MutationError("bad_message", "componentes no válidos", r.error.issues.slice(0, 5));
    const c = r.data;
    // Giro: cuaternión unidad (uno sin normalizar escala el modelo en los clientes y burla las medidas).
    const q = unitQuat(c["transform@1"].r);
    if (!q) throw new MutationError("bad_message", "transform@1.r no es un giro válido (cuaternión nulo)");
    c["transform@1"].r = q;
    if (!this.inBounds(c["transform@1"].p)) {
      const [lo, hi] = this.bounds;
      throw new MutationError("budget_exceeded", `la posición debe estar dentro del lugar (${lo}..${hi} en x/z, -16..256 en y)`);
    }
    const tris = estimateTris(c);
    if (tris > BUDGETS.maxTrisPerEntity) throw new MutationError("budget_exceeded", "demasiados triángulos para una entidad", { tris, max: BUDGETS.maxTrisPerEntity });
    return c;
  }

  private checkTris(add: number, remove: number) {
    // Lo de las parcelas tiene su propio presupuesto (checkParcel).
    const total = this.sql.exec<{ t: number | null }>("SELECT SUM(tris) AS t FROM entities WHERE owner NOT LIKE 'prj!_%' ESCAPE '!'").one().t ?? 0;
    if (total - remove + add > BUDGETS.maxTrisPerChunk) {
      throw new MutationError("budget_exceeded", "el chunk superaría su presupuesto de triángulos", { total, add, max: BUDGETS.maxTrisPerChunk });
    }
  }

  private checkLights(add: number) {
    const n = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM entities WHERE data LIKE '%\"light@1\"%' AND owner NOT LIKE 'prj!_%' ESCAPE '!'")
      .one().n;
    if (n + add > BUDGETS.maxLightsPerChunk) {
      throw new MutationError("budget_exceeded", "demasiadas luces en este chunk", { max: BUDGETS.maxLightsPerChunk });
    }
  }

  private rateLimit(actor: string) {
    const now = Date.now();
    const recent = (this.mutationLog.get(actor) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= BUDGETS.maxMutationsPerMinute) {
      throw new MutationError("rate_limited", "demasiadas mutaciones; espera un poco", { per_minute: BUDGETS.maxMutationsPerMinute });
    }
    recent.push(now);
    this.mutationLog.set(actor, recent);
    this.pruneLog(this.mutationLog, 60_000);
  }

  /* ---------------------------------------------------------------- */
  /* Persistencia                                                       */
  /* ---------------------------------------------------------------- */

  private entityOf(entity_id: string, owner: string, rev: number, components: Components): Entity {
    // Sin chunk_id los clientes descartan el SNAPSHOT entero: mejor no escribir nada.
    if (!this.chunkId) throw new Error("el chunk no sabe qué es (chunkId null)");
    return { schema: ENTITY_SCHEMA, entity_id, chunk_id: this.chunkId!, owner, rev, components };
  }

  private insertEntity(entity_id: string, owner: string, components: Components): Entity {
    // Un id fuera del esquema hace que los clientes descarten el SNAPSHOT entero: mejor fallar aquí.
    if (!EntityId.safeParse(entity_id).success) throw new Error(`id de entidad no válido: ${entity_id}`);
    const entity = this.entityOf(entity_id, owner, 1, components);
    this.sql.exec(
      "INSERT INTO entities (entity_id, owner, rev, tris, data) VALUES (?, ?, 1, ?, ?)",
      entity_id,
      owner,
      estimateTris(components),
      JSON.stringify(entity),
    );
    return entity;
  }

  private getRow(entity_id: string) {
    return this.sql
      .exec<{ owner: string; rev: number; tris: number; data: string }>(
        "SELECT owner, rev, tris, data FROM entities WHERE entity_id = ?",
        entity_id,
      )
      .toArray()[0];
  }

  /** Las entidades del lugar ya en JSON (en caché hasta que cambie alguna): el grueso del SNAPSHOT. */
  private entitiesJson(): string {
    if (this.entitiesJsonCache?.epoch !== this.entityEpoch) {
      const rows = this.sql.exec<{ data: string }>("SELECT data FROM entities").toArray();
      this.entitiesJsonCache = { epoch: this.entityEpoch, json: `[${rows.map((r) => r.data).join(",")}]` };
    }
    return this.entitiesJsonCache.json;
  }

  private sendSnapshot(ws: WebSocket, peers: Peer[], poses: AvatarPose[], chat: unknown[]) {
    const rest = JSON.stringify(msg("SNAPSHOT", { peers, poses, chat }));
    // Mismo mensaje que msg("SNAPSHOT", { entities, … }), sin volver a leer ni a serializar las entidades.
    try {
      const entities = this.entitiesJson();
      ws.send(rest.replace('"payload":{', () => `"payload":{"entities":${entities},`));
    } catch {
      /* socket cerrado */
    }
  }

  /**
   * Poda el registro de eventos (más de EVENTS_RETENTION_MS) y las claves de idempotencia (más de un
   * día), como mucho una vez cada PRUNE_EVERY_MS y a trozos: lee las PRUNE_BATCH más viejas (por orden
   * de inserción) y borra las caducadas. Sin alarmas: lo dispara una mutación.
   */
  private maybePrune() {
    const now = Date.now();
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    this.sql.exec(
      "DELETE FROM events WHERE seq IN (SELECT seq FROM (SELECT seq, ts FROM events ORDER BY seq LIMIT ?) WHERE ts < ?)",
      PRUNE_BATCH,
      now - EVENTS_RETENTION_MS,
    );
    this.sql.exec(
      "DELETE FROM idem WHERE rowid IN (SELECT rowid FROM (SELECT rowid, ts FROM idem ORDER BY rowid LIMIT ?) WHERE ts < ?)",
      PRUNE_BATCH,
      now - IDEM_RETENTION_MS,
    );
  }

  private logEvent(actor: string, op: string, entity_id: string, rev: number, data: unknown) {
    let json = data === null ? null : JSON.stringify(data);
    if (json && json.length > EVENT_DATA_MAX) json = JSON.stringify({ truncated: true, bytes: json.length });
    this.sql.exec(
      "INSERT INTO events (ts, actor, op, entity_id, rev, data) VALUES (?, ?, ?, ?, ?, ?)",
      Date.now(),
      actor,
      op,
      entity_id,
      rev,
      json,
    );
  }

  /** Estado público para el panel 2D: sin poses ni datos de sesión. */
  private publicState() {
    const events = this.sql
      .exec<{ ts: number; actor: string; op: string; entity_id: string }>(
        "SELECT ts, actor, op, entity_id FROM events WHERE actor != 'system' ORDER BY seq DESC LIMIT 10",
      )
      .toArray();
    const entities = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM entities").one().n;
    const peers = this.peers();
    return {
      chunk_id: this.chunkId,
      online: peers.length,
      agents_online: peers.filter((p) => p.kind === "agent").length,
      entities,
      // Sin el id interno de las personas (es público): solo «usr_». Los agentes sí se nombran.
      recent_events: events.map((e) => ({ ...e, actor: e.actor.startsWith("usr_") ? "usr_" : e.actor })),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Utilidades                                                         */
  /* ---------------------------------------------------------------- */

  private inBounds(p: readonly number[]): boolean {
    const [x = NaN, y = NaN, z = NaN] = p;
    const [lo, hi] = this.bounds;
    return x >= lo && x < hi && z >= lo && z < hi && y >= -16 && y <= 256;
  }

  private peerOf(att: Attachment): Peer {
    return {
      session_id: att.session_id,
      kind: att.principal.kind,
      display_name: att.display_name,
      client_type: att.client_type,
      ...(att.principal.kind === "user" && typeof att.principal.no === "number" ? { player_no: att.principal.no } : {}),
      ...(att.principal.avatar
        ? { avatar: att.principal.avatar as Peer["avatar"] }
        : att.preset
          ? { avatar: att.preset }
          : {}),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Gente: reacciones, acciones en pareja y modo pelea (people.ts)      */
  /* ---------------------------------------------------------------- */

  /** Estilo de pelea de este lugar: el de su distrito, «comic» en los de la comunidad; nunca en el nexo ni la plaza. */
  private get fightStyle(): FightStyle | null {
    if (this.solo || !this.chunkId) return null;
    if (this.community) return "comic";
    const d = districtByChunk(this.chunkId);
    return d ? styleOf(d.fight) : null;
  }

  /** Parkour: solo en los distritos del sistema que lo dicen (Vertical); nunca en el nexo ni la plaza. */
  private get parkour(): boolean {
    if (this.solo || !this.chunkId || this.community) return false;
    return districtByChunk(this.chunkId)?.parkour === true;
  }

  /** Coches: solo en los distritos del sistema que lo dicen (Arcade, que tiene el circuito). */
  private get carsHere(): boolean {
    if (this.solo || !this.chunkId || this.community) return false;
    return districtByChunk(this.chunkId)?.cars === true;
  }

  /** Armas (§9 octies ter): solo en los distritos del sistema que lo dicen (Distrito Cero). */
  private get weaponsHere(): boolean {
    if (this.solo || !this.chunkId || this.community) return false;
    return districtByChunk(this.chunkId)?.weapons === true;
  }

  /** Con qué armas puede disparar una sesión: la pipa y, las cuentas, las de su inventario (en su sesión: `w`). */
  private weaponsOf(att: Attachment): WeaponId[] {
    return usableWeapons(att.principal.kind === "user" ? att.principal.w : null);
  }

  /** La conexión de una sesión de este lugar (si sigue). */
  private sessionById(id: string): { ws: WebSocket; att: Attachment } | null {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.hello && att.session_id === id) return { ws, att };
    }
    return null;
  }

  /** La cabeza de una sesión según su última pose, si es reciente. */
  private headOf(id: string): number[] | null {
    const pose = this.poses.get(id);
    const age = Date.now() - (this.lastPoseAt.get(id) ?? 0);
    return pose && age <= POSE_MAX_AGE_MS ? pose.head.p : null;
  }

  /**
   * A quien esté a menos de AOI_RADIUS de `p` (en los lugares grandes; si no, a todos), menos `except`.
   * Quien lleva a los ciudadanos lo recibe siempre: tiene que saber de todo el lugar (§9 nonies).
   */
  private broadcastNear(p: number[], m: unknown, except?: WebSocket) {
    if (!this.big) return this.broadcast(m, except);
    const data = JSON.stringify(m);
    const R2 = AOI_RADIUS * AOI_RADIUS;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att?.hello) continue;
      const me = this.poses.get(att.session_id)?.head.p;
      if (me && att.session_id !== this.npcHost && (me[0]! - p[0]!) ** 2 + (me[2]! - p[2]!) ** 2 > R2) continue;
      try {
        ws.send(data);
      } catch {
        /* socket cerrado */
      }
    }
  }

  private handleReact(ws: WebSocket, att: Attachment, ref: string | undefined, kind: Reaction) {
    if (this.solo) return this.sendError(ws, ref, "forbidden", "en el nexo se va en solitario");
    const now = Date.now();
    if (now - (this.reactAt.get(att.session_id) ?? 0) < REACT_GAP_MS) return this.sendError(ws, ref, "rate_limited", "más despacio");
    const me = this.headOf(att.session_id);
    if (!me) return this.sendError(ws, ref, "bad_message", "manda tu pose primero");
    this.reactAt.set(att.session_id, now);
    this.broadcastNear(me, msg("REACTION", { session_id: att.session_id, kind }));
  }

  private handlePair(ws: WebSocket, att: Attachment, ref: string | undefined, to: string, kind: PairAction, answer: boolean | undefined) {
    if (this.solo) return this.sendError(ws, ref, "forbidden", "en el nexo se va en solitario");
    if (to === att.session_id) return this.sendError(ws, ref, "bad_message", "contigo no");
    if (!this.activityAllowed(att)) return this.sendError(ws, ref, "rate_limited", "más despacio");
    const other = this.sessionById(to);
    const me = this.headOf(att.session_id), them = this.headOf(to);
    const now = Date.now();
    if (answer === undefined) {
      // Propuesta: a alguien que está aquí y cerca. Una por sesión (la nueva pisa la anterior).
      if (!other || !me || !them || !near(me, them, PAIR_OFFER_RANGE)) return this.sendError(ws, ref, "forbidden", "acércate más");
      this.pairOffers.set(att.session_id, { to, kind, t: now });
      return this.send(other.ws, msg("PAIR_OFFER", { from: att.session_id, kind }));
    }
    // Respuesta: a una propuesta de `to` para mí, de este tipo y aún vigente.
    const offer = this.pairOffers.get(to);
    if (!offer || offer.to !== att.session_id || offer.kind !== kind) return this.sendError(ws, ref, "not_found", "esa propuesta ya no está");
    this.pairOffers.delete(to);
    const end = (reason: "declined" | "expired" | "far") => {
      const m = msg("PAIR_END", { a: to, b: att.session_id, kind, reason });
      if (other) this.send(other.ws, m);
      this.send(ws, m);
    };
    if (now - offer.t > PAIR_TTL_MS) return end("expired");
    if (!answer) return end("declined");
    if (!other || !me || !them || !near(me, them, PAIR_START_RANGE)) return end("far");
    this.broadcastNear(me, msg("PAIR_START", { a: to, b: att.session_id, kind, t: now }));
  }

  private handleFight(ws: WebSocket, att: Attachment, ref: string | undefined, on: boolean) {
    if (on && !this.fightStyle) return this.sendError(ws, ref, "forbidden", "aquí no se puede pelear");
    if (!!att.fight === on) return;
    att.fight = on;
    ws.serializeAttachment(att);
    // Su vida (la que le quede: apagar y encender no la rellena), para ella y quien esté cerca.
    if (on) {
      this.healthOf(att.session_id, Date.now());
      this.sendHealth(att.session_id, ws);
    }
    // Los demás lo ven en su siguiente pose (con su marca encima).
    const pose = this.poses.get(att.session_id);
    if (pose) {
      // Sin el modo pelea, tampoco el arma en la mano.
      const { fight: _was, weapon: _gun, ...rest } = pose;
      this.poses.set(att.session_id, on ? { ...rest, fight: true } : rest);
      this.dirty.add(att.session_id);
      this.scheduleTick();
    }
  }

  private handleHit(ws: WebSocket, att: Attachment, ref: string | undefined, to: string, move: FightMove) {
    const style = this.fightStyle;
    if (!style) return this.sendError(ws, ref, "forbidden", "aquí no se puede pelear");
    if (!moveAllowed(style, move)) return this.sendError(ws, ref, "forbidden", "aquí solo se empuja");
    if (!att.fight) return this.sendError(ws, ref, "forbidden", "activa el modo pelea");
    const other = this.sessionById(to);
    // Consentimiento: solo a quien también tiene el modo pelea (sin decir quién lo tiene si no).
    if (!other || !other.att.fight || to === att.session_id) return this.sendError(ws, ref, "forbidden", "esa persona no está en modo pelea");
    const now = Date.now();
    if (now - (this.hitAt.get(att.session_id) ?? 0) < HIT_GAP_MS) return this.sendError(ws, ref, "rate_limited", "más despacio");
    // Fuera de combate (hasta reaparecer) no se golpea ni se recibe; quien acaba de caer tampoco.
    if (this.health.get(att.session_id)?.downUntil) return this.sendError(ws, ref, "forbidden", "estás fuera de combate");
    if (this.health.get(to)?.downUntil) return;
    if ((this.downUntil.get(to) ?? 0) > now || (this.downUntil.get(att.session_id) ?? 0) > now) return; // en el suelo: no cuenta
    const me = this.headOf(att.session_id), them = this.headOf(to);
    if (!me || !them) return this.sendError(ws, ref, "bad_message", "manda tu pose primero");
    if (this.poses.get(att.session_id)?.vehicle || this.poses.get(to)?.vehicle) return this.sendError(ws, ref, "forbidden", "en coche no");
    const dx = them[0]! - me[0]!, dz = them[2]! - me[2]!;
    const d = Math.hypot(dx, dz);
    if (d > REACH[move] || Math.abs(them[1]! - me[1]!) > HIT_MAX_DY) return this.sendError(ws, ref, "forbidden", "demasiado lejos");
    this.hitAt.set(att.session_id, now);
    // Deslizándose, los puñetazos le pasan por encima.
    if (dodges(move, this.poses.get(to)?.emote)) return this.sendError(ws, ref, "forbidden", "esquivado", { reason: "dodged" });
    const recent = (this.duelHits.get(to) ?? []).filter((t) => now - t < DUEL_WINDOW_MS);
    recent.push(now);
    const out = hitOutcome(style, move, recent.length);
    if (out.ko) this.duelHits.delete(to);
    else this.duelHits.set(to, recent);
    // La vida: a 0, fuera de combate hasta que pueda reaparecer (cae y no se levanta).
    const h = this.healthOf(to, now);
    h.hp = Math.max(0, hpAt(h.hp, h.at, now) - damageOf(style, move));
    h.at = now;
    const down = h.hp <= 0;
    if (down) {
      h.downUntil = now + FIGHT_RESPAWN_MS;
      this.duelHits.delete(to);
    }
    const fall = out.fall || down;
    if (fall) this.downUntil.set(to, down ? h.downUntil! : now + DOWN_IMMUNE_MS);
    const dir: [number, number] = d > 0.05 ? [dx / d, dz / d] : [0, 1];
    this.broadcastNear(them, msg("HIT_EVENT", { from: att.session_id, to, move, style, dir: [Math.round(dir[0] * 1000) / 1000, Math.round(dir[1] * 1000) / 1000], power: out.power, fall, ...(out.ko || down ? { ko: true } : {}) }));
    this.sendHealth(to);
  }

  /** La vida de una sesión (con la que se le haya recuperado sola hasta ahora); la crea entera si no tenía. */
  private healthOf(id: string, now: number): { hp: number; at: number; downUntil?: number } {
    let h = this.health.get(id);
    if (!h) {
      h = { hp: FIGHT_HP, at: now };
      this.health.set(id, h);
    }
    return h;
  }

  /** Reparte la vida de `id` a esa persona y a quien tenga cerca (para dibujar su barra). */
  private sendHealth(id: string, ws?: WebSocket) {
    const h = this.health.get(id);
    if (!h) return;
    const m = msg("HEALTH", { session_id: id, hp: Math.round(h.hp * 10) / 10, at: h.at, ...(h.downUntil ? { down_until: h.downUntil } : {}) });
    // Donde se la vio por última vez (aunque lleve un rato quieta: fuera de combate no se mueve).
    const head = this.poses.get(id)?.head.p;
    if (head) this.broadcastNear(head, m);
    else if (ws) this.send(ws, m);
    else {
      const s = this.sessionById(id);
      if (s) this.send(s.ws, m);
    }
  }

  /** Fuera de combate, pasado su tiempo: vuelve con toda la vida (el cliente se pone él mismo en la salida). */
  private handleRespawn(ws: WebSocket, att: Attachment, ref: string | undefined) {
    const h = this.health.get(att.session_id);
    const now = Date.now();
    if (!h?.downUntil) return this.sendError(ws, ref, "bad_message", "no estás fuera de combate");
    if (now < h.downUntil) return this.sendError(ws, ref, "forbidden", "aún no", { ms_left: h.downUntil - now });
    h.hp = FIGHT_HP;
    h.at = now;
    h.downUntil = undefined;
    this.downUntil.delete(att.session_id);
    // Aparece en la entrada: su siguiente pose llega de un salto (como al entrar; reinicia la carrera).
    this.moves.delete(att.session_id);
    this.sendHealth(att.session_id, ws);
  }

  /**
   * Un disparo (§9 octies ter): con un arma suya, en el modo pelea y a su ritmo. El rayo se reparte a
   * quien esté cerca (también a quien dispara: por si le dio). Si le da a alguien en el modo pelea a su
   * alcance, le quita vida como un golpe (sin la regla del duelo) y lo empuja o, con las que tumban, lo
   * tira. A la gente de la ciudad le llega por NPC_HIT (`shot`).
   */
  private handleShoot(ws: WebSocket, att: Attachment, ref: string | undefined, p: { weapon: WeaponId; at: [number, number, number]; to?: string }) {
    if (!this.weaponsHere) return this.sendError(ws, ref, "forbidden", "aquí no hay armas");
    if (!att.fight) return this.sendError(ws, ref, "forbidden", "activa el modo pelea");
    if (!this.weaponsOf(att).includes(p.weapon)) return this.sendError(ws, ref, "forbidden", "no tienes esa arma", { reason: "weapon" });
    const spec = WEAPONS[p.weapon];
    const now = Date.now();
    // A su ritmo (con margen por la red); lo que llega antes se descarta sin más.
    if (now - (this.shotAt.get(att.session_id) ?? 0) < spec.gapMs * 0.75) return;
    if (this.health.get(att.session_id)?.downUntil) return this.sendError(ws, ref, "forbidden", "estás fuera de combate");
    if ((this.downUntil.get(att.session_id) ?? 0) > now) return; // en el suelo
    const me = this.headOf(att.session_id);
    if (!me) return this.sendError(ws, ref, "bad_message", "manda tu pose primero");
    if (this.poses.get(att.session_id)?.vehicle) return this.sendError(ws, ref, "forbidden", "en coche no");
    this.shotAt.set(att.session_id, now);
    // El rayo, como mucho hasta su alcance (y dentro del lugar).
    const [ax, ay, az] = p.at;
    const len = Math.hypot(ax - me[0]!, ay - me[1]!, az - me[2]!);
    const k = len > spec.range ? spec.range / len : 1;
    const [lo, hi] = this.bounds;
    const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
    const at: [number, number, number] = [
      r3(clamp(me[0]! + (ax - me[0]!) * k, lo, hi)),
      r3(clamp(me[1]! + (ay - me[1]!) * k, -16, 256)),
      r3(clamp(me[2]! + (az - me[2]!) * k, lo, hi)),
    ];
    let hit: { to: string; dir: [number, number]; power: number; fall: boolean; ko?: true } | null = null;
    const to = p.to;
    if (to && to !== att.session_id) {
      const other = this.sessionById(to);
      const them = this.headOf(to);
      const free = !!other?.att.fight && !this.health.get(to)?.downUntil && !((this.downUntil.get(to) ?? 0) > now) && !this.poses.get(to)?.vehicle;
      if (free && them) {
        const dx = them[0]! - me[0]!, dz = them[2]! - me[2]!;
        const d = Math.hypot(dx, dz);
        if (d <= spec.range + 1.5 && Math.abs(them[1]! - me[1]!) <= SHOT_MAX_DY) {
          const h = this.healthOf(to, now);
          h.hp = Math.max(0, hpAt(h.hp, h.at, now) - spec.damage);
          h.at = now;
          const down = h.hp <= 0;
          if (down) {
            h.downUntil = now + FIGHT_RESPAWN_MS;
            this.duelHits.delete(to);
          }
          const fall = spec.knock || down;
          if (fall) this.downUntil.set(to, down ? h.downUntil! : now + DOWN_IMMUNE_MS);
          const dir: [number, number] = d > 0.05 ? [Math.round((dx / d) * 1000) / 1000, Math.round((dz / d) * 1000) / 1000] : [0, 1];
          hit = { to, dir, power: spec.power, fall, ...(down ? { ko: true as const } : {}) };
        }
      }
    }
    this.broadcastNear(me, msg("SHOT", { from: att.session_id, weapon: p.weapon, at, ...(hit ?? {}) }));
    if (hit) this.sendHealth(hit.to);
  }

  /* ---------------------------------------------------------------- */
  /* La gente de las ciudades, compartida (§9 nonies)                    */
  /* ---------------------------------------------------------------- */

  /** Solo en los distritos del sistema (los que tienen ciudadanos), nunca en el nexo, la plaza o los de la comunidad. */
  private get npcPlace(): boolean {
    return !this.solo && !!this.chunkId && !this.community && !!districtByChunk(this.chunkId);
  }

  /** ¿Sigue mandando su estado quien lleva a los ciudadanos? (al empezar tiene un margen). */
  private npcHostAlive(now = Date.now()): boolean {
    return !!this.npcHost && now - Math.max(this.npcLastAt, this.npcHostSince) <= NPC_STALE_MS;
  }

  private setNpcHost(id: string | null) {
    this.npcHost = id;
    this.npcHostSince = Date.now();
    this.broadcast(msg("NPC_HOST", { session_id: id }));
  }

  /**
   * Elige quién lleva a los ciudadanos en lugar de `exclude`: de las otras sesiones que saben, la que
   * lleva más tiempo y ha mandado pose hace poco (una pestaña dormida no). Si no hay otra y `exclude`
   * sigue aquí ofreciéndose (solo se ha retrasado), sigue ella; si no, nadie.
   */
  private electNpcHost(exclude: string | null, closing?: WebSocket) {
    const now = Date.now();
    let best: Attachment | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === closing) continue;
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att?.hello || !att.npc || att.session_id === exclude) continue;
      if (now - (this.lastPoseAt.get(att.session_id) ?? 0) > 5_000) continue;
      if (!best || (att.since ?? 0) < (best.since ?? 0)) best = att;
    }
    if (best) {
      if (best.session_id !== this.npcHost) this.setNpcHost(best.session_id);
      return;
    }
    if (exclude && this.npcHost === exclude && !closing && this.sessionById(exclude)?.att.npc) {
      this.npcHostSince = now;
      return;
    }
    if (this.npcHost !== null) this.setNpcHost(null);
  }

  /** Golpes y propuestas a los ciudadanos: como mucho NPC_EVENTS_PER_S por segundo y sesión. */
  private npcEventAllowed(id: string): boolean {
    const now = Date.now();
    const list = (this.npcEvents.get(id) ?? []).filter((t) => now - t < 1000);
    if (list.length >= NPC_EVENTS_PER_S) return false;
    list.push(now);
    this.npcEvents.set(id, list);
    return true;
  }

  /** El estado de los ciudadanos, de quien los lleva: se comprueba y se reparte a los demás. */
  private handleNpcState(ws: WebSocket, att: Attachment, ref: string | undefined, cast: NpcSnap[]) {
    if (!this.npcPlace) return this.sendError(ws, ref, "forbidden", "aquí no hay ciudadanos");
    if (this.npcHost !== att.session_id) return; // ya no los lleva (llegará NPC_HOST): se ignora sin error
    const now = Date.now();
    if (now - this.npcLastAt < NPC_STATE_GAP_MS) return; // descarta en silencio
    const [lo, hi] = this.bounds;
    for (const c of cast) {
      const [x, y, z] = c.p;
      if (!(x >= lo && x <= hi && z >= lo && z <= hi && y >= -16 && y <= 256)) return this.sendError(ws, ref, "bad_message", "un ciudadano fuera del lugar");
    }
    this.npcLastAt = now;
    for (const c of cast) this.npcPos.set(c.i, c.p);
    this.npcLast = { t: now, cast };
    this.broadcast(msg("NPC_STATE", this.npcLast), ws);
  }

  /**
   * Le han dado a un ciudadano (`npc`) o a alguien de una sala (`res`): si quien lo dice está cerca, el
   * del ciudadano se lo pasa a quien los lleva y el de la sala, a quien esté cerca (cada uno lo dibuja).
   */
  private handleNpcHit(ws: WebSocket, att: Attachment, ref: string | undefined, p: { npc?: number; res?: number; dir: [number, number]; power: number; head?: boolean; kind: NpcHitKind }) {
    if (!this.npcPlace) return;
    const shot = p.kind === "shot";
    if (shot && (!this.weaponsHere || !att.fight)) return this.sendError(ws, ref, "forbidden", "aquí no se dispara");
    if (p.npc !== undefined && (!this.npcHost || this.npcHost === att.session_id)) return;
    if (!this.npcEventAllowed(att.session_id)) return this.sendError(ws, ref, "rate_limited", "más despacio");
    const me = this.headOf(att.session_id);
    const at = p.npc !== undefined ? this.npcPos.get(p.npc) : residentsOf(districtByChunk(this.chunkId!)!.id)[p.res!];
    if (!me) return this.sendError(ws, ref, "bad_message", "manda tu pose primero");
    if (!at) return this.sendError(ws, ref, "bad_message", "no existe");
    const reach = shot ? SHOT_MAX_RANGE + 2 : p.kind === "car" ? 9 : 4.5;
    if (Math.hypot(at[0] - me[0]!, at[2] - me[2]!) > reach || Math.abs(at[1] - (me[1]! - 1.6)) > (shot ? SHOT_MAX_DY : 3)) return this.sendError(ws, ref, "forbidden", "demasiado lejos");
    const l = Math.hypot(p.dir[0], p.dir[1]) || 1;
    const ev = msg("NPC_HIT_EVENT", {
      from: att.session_id,
      ...(p.npc !== undefined ? { npc: p.npc } : { res: p.res! }),
      dir: [p.dir[0] / l, p.dir[1] / l] as [number, number],
      power: p.power,
      ...(p.head ? { head: true } : {}),
      kind: p.kind,
    });
    if (p.res !== undefined) return this.broadcastNear([at[0], at[1], at[2]], ev, ws);
    const host = this.sessionById(this.npcHost!);
    if (host) this.send(host.ws, ev);
  }

  /** Propuesta a un ciudadano: si está cerca, a quien los lleva (contesta en su estado). */
  private handleNpcPair(ws: WebSocket, att: Attachment, ref: string | undefined, npc: number, kind: PairAction) {
    if (!this.npcPlace || !this.npcHost || this.npcHost === att.session_id) return;
    if (!this.npcEventAllowed(att.session_id)) return this.sendError(ws, ref, "rate_limited", "más despacio");
    const me = this.headOf(att.session_id), at = this.npcPos.get(npc);
    if (!me || !at || Math.hypot(at[0] - me[0]!, at[2] - me[2]!) > PAIR_OFFER_RANGE + 1) return this.sendError(ws, ref, "forbidden", "acércate más");
    const host = this.sessionById(this.npcHost);
    if (host) this.send(host.ws, msg("NPC_PAIR_EVENT", { from: att.session_id, npc, kind }));
  }

  /** Ofrecerse a llevar a los ciudadanos o dejar de hacerlo (la pestaña se va a segundo plano). */
  private handleNpcHosting(ws: WebSocket, att: Attachment, on: boolean) {
    if (!this.npcPlace) return;
    att.npc = on;
    ws.serializeAttachment(att);
    if (!on && this.npcHost === att.session_id) this.electNpcHost(att.session_id);
    else if (on && !this.npcHostAlive()) this.setNpcHost(att.session_id);
  }

  private peers(): Peer[] {
    return this.ctx
      .getWebSockets()
      .map((ws) => ws.deserializeAttachment() as Attachment | null)
      .filter((a): a is Attachment => !!a && a.hello)
      .map((a) => this.peerOf(a));
  }

  private send(ws: WebSocket, m: unknown) {
    try {
      ws.send(JSON.stringify(m));
    } catch {
      /* socket cerrado */
    }
  }

  private broadcast(m: unknown, except?: WebSocket) {
    const data = JSON.stringify(m);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || !(ws.deserializeAttachment() as Attachment | null)?.hello) continue;
      try {
        ws.send(data);
      } catch {
        /* socket cerrado */
      }
    }
  }

  private sendError(ws: WebSocket, ref: string | undefined, code: ErrorCode, message: string, detail?: unknown) {
    this.send(ws, msg("ERROR", { ref, code, message, detail }));
  }
}
