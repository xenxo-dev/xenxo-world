/**
 * ChunkRoom — servidor autoritativo de un chunk del mundo.
 *
 * - Es la ÚNICA puerta de escritura del mundo: humanos y agentes pasan por aquí.
 * - Estado vivo en su SQLite (entidades, log de eventos, claves de idempotencia).
 * - Poses efímeras en memoria, repartidas en lotes a TICK_HZ como mucho (casi sin temporizadores: el objeto hiberna).
 * - WebSocket Hibernation: cuando no hay mensajes, el objeto duerme y no factura duración.
 */
import { DurableObject } from "cloudflare:workers";
import {
  ACCEPTED_IN_V0,
  BUDGETS,
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
} from "@xenxo/protocol";
import type { Env } from "./index";
import { randomId, type Principal } from "./auth";
import { plazaSeed, SEED_VERSION } from "./seed";
import { billboardSlots, cabinetSlots, sandboxOf, type SandboxRect, DISTRICT_BOUNDS, districtByChunk, districtSeed, DISTRICT_SEED_VERSION, migrateParcelPose, migrateSlot, PARCEL_LAYOUT_VERSION, PARCELS, parcelIndex, parcelReserved, parcelSlot } from "./districts";
import { nexoArrival, NEXO_BOUNDS, NEXO_SEED_VERSION, nexoSeed, SHOWCASE_SLOTS } from "./nexo";
import { at, portalEntities, r3, yaw, type Seeded } from "./places";

/** Pantalla de la máquina recreativa (tools/models/generated/arcade_cabinet): centro y tamaño. */
const CABINET_SCREEN = { y: 1.18, z: 0.34, size: [0.56, 0.5] as [number, number] };
import { isCommunityChunk, type CommunityMeta } from "./community";
import { fitsZone, localBox, worldBox, type Zone } from "./zone";
import { assetKey } from "./assets";
import { ACTIVITY_SCHEMA, activityKey, isoWeek, weekStart, minRaceMs, near, POSE_MAX_AGE_MS, RACE_TIMEOUT_MS, SCORES_LIMIT, type RaceRun } from "./activities";
import { SEED_ASSETS } from "./seed-assets";
import { figureFor, pointsDay, TILES_IDLE_MS, TILES_PAUSE_MS, TILES_SCHEMA, TILES_START_MS, tileAt, tilesRoundMs, type TileBoard, type TileGame } from "./tiles";
import { isAvatarPreset } from "./avatar-presets-check";

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
const MAX_MESSAGE_BYTES = 64 * 1024;
const MIN_POSE_INTERVAL_MS = 1000 / BUDGETS.maxPoseHz - 5;

interface Attachment {
  session_id: string;
  principal: Principal;
  hello: boolean;
  client_type: Peer["client_type"];
  display_name: string;
  /** Avatar de serie elegido en HELLO (invitados y agentes). */
  preset?: { hash: string; format: "vrm" };
  /** Carrera en curso (activities.ts). */
  run?: RaceRun;
}

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
  activities?: { collected: Record<string, unknown>[]; hunts: Record<string, unknown>[]; races: Record<string, unknown>[]; points?: Record<string, unknown>[]; race_weeks?: Record<string, unknown>[] };
  /** Distrito de la comunidad: lo que es (con lo del sistema que lleva). Ausente en los demás. */
  community?: string | null;
}

export class ChunkRoom extends DurableObject<Env> {
  private sql: SqlStorage;
  private chunkId: string | null = null;
  /** Si es un distrito de la comunidad (community.ts): qué es. Se guarda en meta 'community'. */
  private community: CommunityMeta | null = null;
  private poses = new Map<string, AvatarPose>();
  private dirty = new Set<string>();
  private lastPoseAt = new Map<string, number>();
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
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
  }

  /* ---------------------------------------------------------------- */
  /* HTTP de entrada (desde el Worker)                                  */
  /* ---------------------------------------------------------------- */

  async fetch(req: Request): Promise<Response> {
    this.ensureChunk(req.headers.get("X-Chunk-Id"));
    const path = new URL(req.url).pathname;

    if (path === "/state") return Response.json(this.publicState());

    if (path === "/ws") {
      const principal = JSON.parse(req.headers.get("X-Principal") ?? "null") as Principal | null;
      if (!principal) return new Response("unauthorized", { status: 401 });
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      const session_id = randomId("s_", 6);
      this.ctx.acceptWebSocket(server, [session_id]);
      const att: Attachment = {
        session_id,
        principal,
        hello: false,
        client_type: "headless",
        display_name:
          principal.kind === "agent" ? principal.sub.replace(/^agt_/, "") : principal.kind === "user" ? principal.name ?? "user" : "guest",
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
      if (stored) this.sql.exec("DELETE FROM meta WHERE k = 'seed_version'");
    }

    if (this.chunkId === PLACES.plaza) this.applySeed("plaza", SEED_VERSION, plazaSeed());
    else if (this.chunkId === PLACES.nexo) {
      this.applySeed("nexo", NEXO_SEED_VERSION, nexoSeed());
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
        att.hello = true;
        att.client_type = m.payload.client_type;
        // Solo los invitados eligen nombre en HELLO; el de personas registradas y agentes lo fija el servidor.
        if (m.payload.display_name && att.principal.kind === "guest") att.display_name = m.payload.display_name.trim() || "guest";
        // Invitados y agentes pueden vestir un avatar de serie (nunca un archivo cualquiera).
        if (m.payload.avatar && !att.principal.avatar && isAvatarPreset(m.payload.avatar.hash)) {
          att.preset = { hash: m.payload.avatar.hash, format: "vrm" };
        }
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
        }));
        // En solitario (el nexo) nadie ve a nadie: ni gente, ni poses, ni chat.
        if (this.solo) {
          this.send(ws, msg("SNAPSHOT", { entities: this.allEntities(), peers: [], poses: [], chat: [] }));
          return;
        }
        this.send(
          ws,
          msg("SNAPSHOT", { entities: this.allEntities(), peers: this.peers(), poses: [...this.poses.values()], chat: this.recentChat() }),
        );
        this.broadcast(msg("PEER_JOIN", this.peerOf(att)), ws);
        if (att.principal.kind === "user") this.send(ws, msg("PROGRESS", this.progressOf(att.principal.sub)));
        for (const g of this.tileGames.values()) if (g.state === "show") this.send(ws, this.tilesMsg(g));
        return;
      }
      case "POSE": {
        if (this.solo) return; // en solitario no se reparten poses
        const now = Date.now();
        if (now - (this.lastPoseAt.get(att.session_id) ?? 0) < MIN_POSE_INTERVAL_MS) return; // descarta en silencio
        this.lastPoseAt.set(att.session_id, now);
        const { head, hand_l, hand_r, emote } = m.payload;
        if (!this.inBounds(head.p)) return;
        this.poses.set(att.session_id, { session_id: att.session_id, head, hand_l, hand_r, ...(emote ? { emote } : {}) });
        this.dirty.add(att.session_id);
        this.scheduleTick();
        this.tilesPose(att, head.p);
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
        return this.handleScores(ws, m.id, m.payload.entity_id);
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
    this.activityLog.delete(att.session_id);
    if (att.hello && !this.solo) this.broadcast(msg("PEER_LEAVE", { session_id: att.session_id }), ws);
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
   * Reparte las poses pendientes a TICK_HZ como mucho. Si ha pasado el intervalo, al momento (sin
   * temporizador); si no, deja uno corto para lo que falte. Un temporizador pendiente impide que el
   * objeto hiberne, y ese tiempo cuenta como duración (plan gratuito: 13.000 GB-s al día): así solo
   * lo hay cuando varias poses llegan dentro del mismo intervalo, no mientras haya alguien en el chunk.
   */
  private scheduleTick() {
    if (this.dirty.size === 0) return;
    const wait = this.lastTick + 1000 / TICK_HZ - 20 - Date.now();
    if (wait <= 0) return this.flushPoses();
    if (!this.tickTimer) {
      this.tickTimer = setTimeout(() => {
        this.tickTimer = null;
        this.flushPoses();
      }, wait);
    }
  }

  private flushPoses() {
    if (this.dirty.size === 0) return;
    const now = Date.now();
    this.lastTick = now;
    const poses = [...this.dirty].map((id) => this.poses.get(id)).filter((p): p is AvatarPose => !!p);
    this.dirty.clear();
    if (!this.big) return this.broadcast(msg("POSES", { t: now, poses }));
    // Lugar grande: a cada uno, solo las poses de quien tiene a menos de AOI_RADIUS (y todas si aún
    // no ha mandado la suya). Ahorra subida: con 100 personas repartidas, cada una recibe unas pocas.
    const R2 = AOI_RADIUS * AOI_RADIUS;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att?.hello) continue;
      const me = this.poses.get(att.session_id)?.head.p;
      const near = me
        ? poses.filter((q) => {
            const dx = q.head.p[0]! - me[0]!, dz = q.head.p[2]! - me[2]!;
            return dx * dx + dz * dz <= R2;
          })
        : poses;
      if (!near.length) continue;
      try {
        ws.send(JSON.stringify(msg("POSES", { t: now, poses: near })));
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
      // Los triángulos de un modelo NO se creen al cliente: se leen de lo que midió el servidor al subirlo.
      const resolved = await this.resolveAssets(p.mutation);
      p.mutation = resolved.mu;
      // Un PATCH en una parcela que no cambia el modelo: sus medidas, las del que ya lleva.
      if (zone && p.mutation.op === "PATCH" && !p.mutation.components["mesh@1"]) resolved.meshBounds = await this.boundsOfEntity(p.mutation.entity_id);
      if (!att.principal.scopes.includes("build") && !sandbox) throw new MutationError("forbidden", "esta sesión no tiene permiso de construcción");
      if (sandbox && p.mutation.op !== "DESPAWN" && p.mutation.components["mesh@1"]) throw new MutationError("forbidden", "en la zona de pruebas solo hay piezas básicas");
      if (zone && zone.chunk_id !== this.chunkId) {
        throw new MutationError("forbidden", `esta clave solo construye en su parcela (${zone.district} ${zone.parcel})`, { zone });
      }
      if (p.target === "proposal") throw new MutationError("bad_message", "las propuestas (ramas) llegan en una versión futura; usa target: commit");

      const idemKey = `${actor}:${p.idempotency_key}`;
      const prior = this.sql.exec<{ result: string }>("SELECT result FROM idem WHERE key = ?", idemKey).toArray()[0];
      if (prior) {
        const r = JSON.parse(prior.result) as { entity_id: string; rev: number };
        return this.send(ws, msg("ACK", { ref, ...r, replayed: true }));
      }

      this.rateLimit(actor);
      const result = this.ctx.storage.transactionSync(() => {
        const r = sandbox
          ? this.applySandbox(actor, p.mutation, sandbox)
          : this.applyMutation(actor, att.principal.scopes.includes("admin"), p.mutation, zone ? { ...zone, meshBounds: resolved.meshBounds } : null);
        this.sql.exec("INSERT INTO idem (key, result, ts) VALUES (?, ?, ?)", idemKey, JSON.stringify({ entity_id: r.entity_id, rev: r.rev }), Date.now());
        return r;
      });

      this.send(ws, msg("ACK", { ref, entity_id: result.entity_id, rev: result.rev, replayed: false }));
      this.broadcast(msg("DELTA", { changes: [result.change] }));
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
    const [x, y, zz] = c["transform@1"].p;
    const s = c["primitive@1"]?.size ?? [0.5, 0.5, 0.5];
    if (s.some((v) => v > 4)) throw new MutationError("budget_exceeded", "cada pieza mide como mucho 4 m");
    const hx = (s[0] / 2) * Math.max(...c["transform@1"].s), hz = (s[2] / 2) * Math.max(...c["transform@1"].s);
    if (x! - hx < z.x0 || x! + hx > z.x1 || zz! - hz < z.z0 || zz! + hz > z.z1 || y! < 0 || y! > z.max_y) {
      throw new MutationError("forbidden", "fuera de la zona de pruebas");
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
      const r = this.applyMutation(actor, false, { ...mu, components: c as Record<string, unknown> }, null);
      this.sql.exec("INSERT INTO sandbox (entity_id, owner, day, light) VALUES (?, ?, ?, ?)", r.entity_id, actor, pointsDay(), c["light@1"] ? 1 : 0);
      return r;
    }
    const mine = this.sql.exec("SELECT 1 FROM sandbox WHERE entity_id = ? AND owner = ?", mu.entity_id, actor).toArray().length > 0;
    if (!mine) throw new MutationError("forbidden", "solo puedes cambiar tus piezas de la zona de pruebas");
    const r = this.applyMutation(actor, false, mu, null);
    if (mu.op === "DESPAWN") this.sql.exec("DELETE FROM sandbox WHERE entity_id = ?", mu.entity_id);
    else if (r.change.kind === "upsert") this.checkSandbox(r.change.entity.components as Components, z);
    return r;
  }

  /**
   * Aplica una mutación ya validada en forma. Con `zone` (agente de una parcela), lo construido es
   * del proyecto (`zone.owner`), tiene que caber entero en la parcela y cuenta en el presupuesto
   * de la parcela, no en el del chunk.
   */
  private applyMutation(actor: string, isAdmin: boolean, mu: MutationOp, zone: (Zone & { meshBounds: { min: number[]; max: number[] } | null }) | null) {
    const owner = zone?.owner ?? actor;
    if (mu.op === "SPAWN") {
      const components = this.validateComponents(mu.components);
      const entity_id = mu.entity_id ?? randomId("e_");
      if (this.getRow(entity_id)) throw new MutationError("duplicate", "ya existe una entidad con ese id");
      if (zone) {
        this.checkZone(components, zone);
        this.checkParcel(zone.owner, { entities: 1, tris: estimateTris(components), lights: components["light@1"] ? 1 : 0 });
      } else {
        // Lo del sistema (la ciudad, sus colisiones y actividades) no gasta el presupuesto de lo construido.
        const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM entities WHERE owner != 'system'").one().n;
        if (count >= BUDGETS.maxEntitiesPerChunk) throw new MutationError("budget_exceeded", "chunk lleno de entidades", { max: BUDGETS.maxEntitiesPerChunk });
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
    } else {
      if (components["light@1"] && !hadLight) this.checkLights(1);
      this.checkTris(tris, row.tris);
    }
    const rev = row.rev + 1;
    const entity = this.entityOf(mu.entity_id, row.owner, rev, components);
    this.sql.exec("UPDATE entities SET rev = ?, tris = ?, data = ? WHERE entity_id = ?", rev, tris, JSON.stringify(entity), mu.entity_id);
    this.logEvent(actor, "PATCH", mu.entity_id, rev, mu.components);
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
    if (this.env.ASSETS) return this.env.ASSETS.head(assetKey(hash));
    const base = (this.env as unknown as { ASSETS_URL?: string }).ASSETS_URL;
    if (!base) return null;
    const r = await fetch(new URL(`/assets/${hash.replace(/^sha256:/, "")}/meta`, base));
    return r.ok ? ((await r.json()) as { customMetadata?: Record<string, string> }) : null;
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
      const out = resolved.map((op) => this.applyMutation(owner, false, op, null).change);
      also?.();
      return out;
    });
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
      activities: {
        collected: this.sql.exec("SELECT * FROM act_collected").toArray(),
        hunts: this.sql.exec("SELECT * FROM act_hunt_done").toArray(),
        races: this.sql.exec("SELECT * FROM act_race_best").toArray(),
        points: this.sql.exec("SELECT * FROM act_points").toArray(),
        race_weeks: this.sql.exec("SELECT * FROM act_race_week").toArray(),
      },
    };
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
          "transform@1": { p: at(sl.p[0], sl.p[2], sl.yaw, 0, CABINET_SCREEN.y, CABINET_SCREEN.z), r: yaw(sl.yaw), s: [1, 1, 1], parent: null },
          "portal@1": { to: { kind: "project", project_id: it.projectId }, size: CABINET_SCREEN.size, cover: it.cover, title: it.title, category: it.category },
        } as Components,
      };
    });
    const before = this.sql.exec<{ entity_id: string }>("SELECT entity_id FROM entities WHERE owner = ?", OWNER).toArray().map((r) => r.entity_id);
    const changes: ({ kind: "remove"; entity_id: string } | { kind: "upsert"; entity: Entity })[] = [];
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM entities WHERE owner = ?", OWNER);
      for (const id of before) if (!seed.some((x) => x.id === id)) changes.push({ kind: "remove", entity_id: id });
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
    const OWNER = "community_gates";
    const before = this.sql.exec<{ entity_id: string }>("SELECT entity_id FROM entities WHERE owner = ?", OWNER).toArray().map((r) => r.entity_id);
    const changes: ({ kind: "remove"; entity_id: string } | { kind: "upsert"; entity: Entity })[] = [];
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM entities WHERE owner = ?", OWNER);
      for (const id of before) if (!seed.some((s) => s.id === id)) changes.push({ kind: "remove", entity_id: id });
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
      this.sql.exec("DELETE FROM sandbox WHERE owner = ?", owner);
      this.sql.exec("UPDATE events SET actor = 'deleted' WHERE actor = ?", owner);
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
    // Sin caracteres de control ni espacios de más. Los enlaces se muestran como texto, nunca clicables.
    const text = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return this.sendError(ws, ref, "bad_message", "mensaje vacío");

    const sub = att.principal.sub;
    const now = Date.now();
    const recent = (this.chatLog.get(sub) ?? []).filter((t) => now - t < 10_000);
    if (recent.length >= BUDGETS.maxChatPer10s) return this.sendError(ws, ref, "rate_limited", "vas muy rápido; espera unos segundos");
    recent.push(now);
    this.chatLog.set(sub, recent);

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
    // Retención: 7 días y como mucho 2.000 mensajes por chunk.
    this.sql.exec("DELETE FROM chat WHERE ts < ?", now - CHAT_RETENTION_MS);
    this.sql.exec("DELETE FROM chat WHERE id IN (SELECT id FROM chat ORDER BY ts DESC LIMIT -1 OFFSET 2000)");
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
      sandbox_pieces: this.sql
        .exec<{ entity_id: string; day: string; data: string }>("SELECT s.entity_id, s.day, e.data FROM sandbox s JOIN entities e ON e.entity_id = s.entity_id WHERE s.owner = ?", sub)
        .toArray()
        .map((r) => ({ entity_id: r.entity_id, day: r.day, components: (JSON.parse(r.data) as Entity).components })),
    };
  }

  /** Entidades de actividad del lugar, ya leídas (componente y posición). */
  private activityEntities() {
    const out: { id: string; owner: string; p: number[]; col?: { set: string; radius: number; note?: Record<string, string> }; cp?: { race: string; role: "start" | "cp" | "finish"; order: number; radius: number } }[] = [];
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
    if (!this.sessionNear(att, it.p, it.col.radius)) return this.sendError(ws, ref, "forbidden", "estás demasiado lejos");
    const sub = att.principal.sub;
    const key = activityKey(it.owner, it.col.set);
    const ids = all.filter((a) => a.owner === it.owner && a.col?.set === it.col!.set).map((a) => a.id);
    this.sql.exec("INSERT OR IGNORE INTO act_collected (sub, entity_id, set_key, ts) VALUES (?, ?, ?, ?)", sub, entityId, key, Date.now());
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
    if (att.principal.kind !== "user") return this.sendError(ws, ref, "forbidden", "crea una cuenta para que cuenten tus tiempos");
    if (!this.activityAllowed(att)) return this.sendError(ws, ref, "rate_limited", "demasiados avisos; espera un poco");
    const all = this.activityEntities();
    const it = all.find((a) => a.id === entityId && a.cp);
    if (!it?.cp) return this.sendError(ws, ref, "not_found", "eso no es un punto de carrera");
    if (!this.sessionNear(att, it.p, it.cp.radius)) return this.sendError(ws, ref, "forbidden", "estás demasiado lejos");
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
    const best = Math.min(ms, prev ?? ms);
    const rank = 1 + this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM act_race_best WHERE race_key = ? AND ms < ?", key, best).one().n;
    this.send(ws, msg("RACE", { race, state: "finish", ms, best, rank }));
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

  private handleScores(ws: WebSocket, ref: string | undefined, entityId: string) {
    const row = this.getRow(entityId);
    const sb = row ? ScoreboardV1.safeParse((JSON.parse(row.data) as Entity).components["scoreboard@1"]) : null;
    if (!row || !sb?.success) return this.sendError(ws, ref, "not_found", "eso no es un marcador");
    const r = this.scoreRows(row.owner, sb.data);
    this.send(ws, msg("SCORES", { entity_id: entityId, kind: sb.data.kind, period: r.period, rows: r.rows }));
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
      const rows = this.scoreRows(r.owner, sb.data);
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
    if (!this.inBounds(c["transform@1"].p)) {
      const [lo, hi] = this.bounds;
      throw new MutationError("budget_exceeded", `la posición debe estar dentro del lugar (${lo}..${hi} en x/z, -16..256 en y)`);
    }
    const tris = estimateTris(c);
    if (tris > BUDGETS.maxTrisPerEntity) throw new MutationError("budget_exceeded", "demasiados triángulos para una entidad", { tris, max: BUDGETS.maxTrisPerEntity });
    return c;
  }

  private checkTris(add: number, remove: number) {
    const total = this.sql.exec<{ t: number | null }>("SELECT SUM(tris) AS t FROM entities").one().t ?? 0;
    if (total - remove + add > BUDGETS.maxTrisPerChunk) {
      throw new MutationError("budget_exceeded", "el chunk superaría su presupuesto de triángulos", { total, add, max: BUDGETS.maxTrisPerChunk });
    }
  }

  private checkLights(add: number) {
    const n = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM entities WHERE data LIKE '%\"light@1\"%'")
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
  }

  /* ---------------------------------------------------------------- */
  /* Persistencia                                                       */
  /* ---------------------------------------------------------------- */

  private entityOf(entity_id: string, owner: string, rev: number, components: Components): Entity {
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

  private allEntities(): Entity[] {
    return this.sql.exec<{ data: string }>("SELECT data FROM entities").toArray().map((r) => JSON.parse(r.data) as Entity);
  }

  private logEvent(actor: string, op: string, entity_id: string, rev: number, data: unknown) {
    this.sql.exec(
      "INSERT INTO events (ts, actor, op, entity_id, rev, data) VALUES (?, ?, ?, ?, ?, ?)",
      Date.now(),
      actor,
      op,
      entity_id,
      rev,
      data === null ? null : JSON.stringify(data),
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
      recent_events: events,
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
