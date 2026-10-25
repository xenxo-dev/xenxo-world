/**
 * ChunkRoom — servidor autoritativo de un chunk del mundo.
 *
 * - Es la ÚNICA puerta de escritura del mundo: humanos y agentes pasan por aquí.
 * - Estado vivo en su SQLite (entidades, log de eventos, claves de idempotencia).
 * - Poses efímeras en memoria, repartidas en lotes a TICK_HZ.
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

const TICK_HZ = 10;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MIN_POSE_INTERVAL_MS = 1000 / BUDGETS.maxPoseHz - 5;

interface Attachment {
  session_id: string;
  principal: Principal;
  hello: boolean;
  client_type: Peer["client_type"];
  display_name: string;
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

export class ChunkRoom extends DurableObject<Env> {
  private sql: SqlStorage;
  private chunkId: string | null = null;
  private poses = new Map<string, AvatarPose>();
  private dirty = new Set<string>();
  private lastPoseAt = new Map<string, number>();
  private mutationLog = new Map<string, number[]>();
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
        display_name: principal.kind === "agent" ? principal.sub.replace(/^agt_/, "") : "guest",
      };
      server.serializeAttachment(att);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  private ensureChunk(id: string | null) {
    if (this.chunkId) return;
    const stored = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'chunk_id'").toArray()[0]?.v;
    this.chunkId = stored ?? id ?? "c_0_0";
    if (!stored) this.sql.exec("INSERT INTO meta (k, v) VALUES ('chunk_id', ?)", this.chunkId);

    if (this.chunkId === "c_0_0") this.applySeed();
  }

  /**
   * Siembra o actualiza la plaza del sistema. Si SEED_VERSION cambió, sustituye
   * las entidades con dueño "system" y conserva las de personas y agentes.
   */
  private applySeed() {
    const current = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'seed_version'").toArray()[0]?.v;
    if (current === String(SEED_VERSION)) return;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM entities WHERE owner = 'system'");
      for (const { id, components } of plazaSeed()) {
        // Si alguien ya usó ese id, la semilla no lo pisa.
        if (!this.getRow(id)) this.insertEntity(id, "system", components);
      }
      this.logEvent("system", "SEED", "plaza", SEED_VERSION, null);
      this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('seed_version', ?)", String(SEED_VERSION));
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
        if (m.payload.display_name && att.principal.kind !== "agent") att.display_name = m.payload.display_name;
        ws.serializeAttachment(att);
        this.send(ws, msg("WELCOME", {
          session_id: att.session_id,
          principal: { sub: att.principal.sub, kind: att.principal.kind, scopes: att.principal.scopes },
          chunk_id: this.chunkId!,
          server_time: Date.now(),
          tick_hz: TICK_HZ,
          budgets: { ...BUDGETS },
        }));
        this.send(ws, msg("SNAPSHOT", { entities: this.allEntities(), peers: this.peers(), poses: [...this.poses.values()] }));
        this.broadcast(msg("PEER_JOIN", this.peerOf(att)), ws);
        return;
      }
      case "POSE": {
        const now = Date.now();
        if (now - (this.lastPoseAt.get(att.session_id) ?? 0) < MIN_POSE_INTERVAL_MS) return; // descarta en silencio
        this.lastPoseAt.set(att.session_id, now);
        const { head, hand_l, hand_r } = m.payload;
        if (!this.inBounds(head.p)) return;
        this.poses.set(att.session_id, { session_id: att.session_id, head, hand_l, hand_r });
        this.dirty.add(att.session_id);
        this.scheduleTick();
        return;
      }
      case "PING":
        return this.send(ws, msg("PONG", { t: m.payload.t, server_time: Date.now() }));
      case "MUTATE_WORLD":
        return this.handleMutation(ws, att, m.id, m.payload);
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
    if (att.hello) this.broadcast(msg("PEER_LEAVE", { session_id: att.session_id }), ws);
  }

  /* ---------------------------------------------------------------- */
  /* Tick de poses                                                      */
  /* ---------------------------------------------------------------- */

  private scheduleTick() {
    if (this.tickTimer) return;
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      if (this.dirty.size === 0) return;
      const poses = [...this.dirty].map((id) => this.poses.get(id)).filter((p): p is AvatarPose => !!p);
      this.dirty.clear();
      this.broadcast(msg("POSES", { t: Date.now(), poses }));
    }, 1000 / TICK_HZ);
  }

  /* ---------------------------------------------------------------- */
  /* Mutaciones del mundo                                               */
  /* ---------------------------------------------------------------- */

  private handleMutation(
    ws: WebSocket,
    att: Attachment,
    ref: string | undefined,
    p: { idempotency_key: string; target: "commit" | "proposal"; mutation: MutationOp },
  ) {
    const actor = att.principal.sub;
    try {
      if (!att.principal.scopes.includes("build")) throw new MutationError("forbidden", "esta sesión no tiene permiso de construcción");
      if (p.target === "proposal") throw new MutationError("bad_message", "las propuestas (ramas) llegan en una versión futura; usa target: commit");

      const idemKey = `${actor}:${p.idempotency_key}`;
      const prior = this.sql.exec<{ result: string }>("SELECT result FROM idem WHERE key = ?", idemKey).toArray()[0];
      if (prior) {
        const r = JSON.parse(prior.result) as { entity_id: string; rev: number };
        return this.send(ws, msg("ACK", { ref, ...r, replayed: true }));
      }

      this.rateLimit(actor);
      const result = this.ctx.storage.transactionSync(() => {
        const r = this.applyMutation(actor, att.principal.scopes.includes("admin"), p.mutation);
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

  private applyMutation(actor: string, isAdmin: boolean, mu: MutationOp) {
    if (mu.op === "SPAWN") {
      const components = this.validateComponents(mu.components);
      const entity_id = mu.entity_id ?? randomId("e_");
      if (this.getRow(entity_id)) throw new MutationError("duplicate", "ya existe una entidad con ese id");
      const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM entities").one().n;
      if (count >= BUDGETS.maxEntitiesPerChunk) throw new MutationError("budget_exceeded", "chunk lleno de entidades", { max: BUDGETS.maxEntitiesPerChunk });
      this.checkTris(estimateTris(components), 0);
      const entity = this.insertEntity(entity_id, actor, components);
      this.logEvent(actor, "SPAWN", entity_id, 1, components);
      return { entity_id, rev: 1, change: { kind: "upsert" as const, entity } };
    }

    const row = this.getRow(mu.entity_id);
    if (!row) throw new MutationError("not_found", "la entidad no existe");
    if (row.owner !== actor && !isAdmin) throw new MutationError("forbidden", "solo el dueño puede modificar esta entidad");
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
    const tris = estimateTris(components);
    this.checkTris(tris, row.tris);
    const rev = row.rev + 1;
    const entity = this.entityOf(mu.entity_id, row.owner, rev, components);
    this.sql.exec("UPDATE entities SET rev = ?, tris = ?, data = ? WHERE entity_id = ?", rev, tris, JSON.stringify(entity), mu.entity_id);
    this.logEvent(actor, "PATCH", mu.entity_id, rev, mu.components);
    return { entity_id: mu.entity_id, rev, change: { kind: "upsert" as const, entity } };
  }

  private validateComponents(input: Record<string, unknown>): Components {
    const unknown = Object.keys(input).filter((k) => !(ACCEPTED_IN_V0 as readonly string[]).includes(k));
    if (unknown.length) throw new MutationError("unknown_component", "componentes no admitidos en v0", { unknown, accepted: ACCEPTED_IN_V0 });
    const r = ComponentsStrict.safeParse(input);
    if (!r.success) throw new MutationError("bad_message", "componentes no válidos", r.error.issues.slice(0, 5));
    const c = r.data;
    if (!this.inBounds(c["transform@1"].p)) {
      throw new MutationError("budget_exceeded", `la posición debe estar dentro del chunk (0..${CHUNK_SIZE} en x/z, -16..256 en y)`);
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
    return x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && y >= -16 && y <= 256;
  }

  private peerOf(att: Attachment): Peer {
    return { session_id: att.session_id, kind: att.principal.kind, display_name: att.display_name, client_type: att.client_type };
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
