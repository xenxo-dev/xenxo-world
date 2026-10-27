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
  CHUNK_SIZE,
  ClientMessage,
  ComponentsStrict,
  ENTITY_SCHEMA,
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
import { DISTRICT_BOUNDS, districtByChunk, districtSeed, DISTRICT_SEED_VERSION, migrateParcelPose, migrateSlot, PARCEL_LAYOUT_VERSION, PARCELS, parcelIndex, parcelReserved, parcelSlot } from "./districts";
import { nexoArrival, NEXO_BOUNDS, NEXO_SEED_VERSION, nexoSeed, SHOWCASE_SLOTS } from "./nexo";
import { portalEntities, r3, type Seeded } from "./places";
import { isCommunityChunk, type CommunityMeta } from "./community";
import { fitsZone, localBox, worldBox, type Zone } from "./zone";
import { assetKey } from "./assets";
import { SEED_ASSETS } from "./seed-assets";
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
  /** Último reparto de poses (ms) y el temporizador corto que se deja solo si hace falta (ver `scheduleTick`). */
  private lastTick = 0;
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
        return;
      }
      case "CHAT":
        if (this.solo) return this.sendError(ws, m.id, "forbidden", "aquí no hay chat: en el nexo se va en solitario");
        return this.handleChat(ws, att, m.id, m.payload.text);
      case "PING":
        return this.send(ws, msg("PONG", { t: m.payload.t, server_time: Date.now() }));
      case "MUTATE_WORLD":
        return await this.handleMutation(ws, att, m.id, m.payload);
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
    try {
      // Los triángulos de un modelo NO se creen al cliente: se leen de lo que midió el servidor al subirlo.
      const resolved = await this.resolveAssets(p.mutation);
      p.mutation = resolved.mu;
      // Un PATCH en una parcela que no cambia el modelo: sus medidas, las del que ya lleva.
      if (zone && p.mutation.op === "PATCH" && !p.mutation.components["mesh@1"]) resolved.meshBounds = await this.boundsOfEntity(p.mutation.entity_id);
      if (!att.principal.scopes.includes("build")) throw new MutationError("forbidden", "esta sesión no tiene permiso de construcción");
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
        const r = this.applyMutation(actor, att.principal.scopes.includes("admin"), p.mutation, zone ? { ...zone, meshBounds: resolved.meshBounds } : null);
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
        const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM entities").one().n;
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

  async purgeOwner(owner: string): Promise<number> {
    this.ensureChunk(null);
    const ids = this.sql.exec<{ entity_id: string }>("SELECT entity_id FROM entities WHERE owner = ?", owner).toArray().map((r) => r.entity_id);
    const chatIds = this.sql.exec<{ id: string }>("SELECT id FROM chat WHERE sender = ?", owner).toArray().map((r) => r.id);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM entities WHERE owner = ?", owner);
      this.sql.exec("DELETE FROM chat WHERE sender = ?", owner);
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
