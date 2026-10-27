/**
 * Cliente headless del protocolo v0. Lo usan las pruebas de conformidad y los agentes.
 * Si este cliente puede entrar, moverse y construir, el desacoplamiento es real.
 */
import { randomUUID } from "node:crypto";
import {
  msg,
  parseServerMessage,
  type MessageOf,
  type MutationOp,
  type ServerMessage,
} from "@xenxo/protocol";

type ServerType = ServerMessage["type"];

export interface ConnectOptions {
  baseUrl: string;
  chunkId?: string;
  /** Si se indica, se autentica como agente; si no, como invitado. */
  agentKey?: string;
  /** Token ya emitido (p. ej. de una persona registrada con passkey). Tiene prioridad. */
  token?: string;
  displayName?: string;
  /** Avatar de serie (solo invitados y agentes; el servidor ignora hashes que no publica). */
  avatar?: { hash: string; format: "vrm" };
}

export class XenxoClient {
  private ws!: WebSocket;
  private waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  readonly received: ServerMessage[] = [];
  private listeners = new Set<(m: ServerMessage) => void>();
  /** Tope de mensajes sin reclamar que se guardan (las poses llegan sin parar). */
  maxReceived = 2000;
  closed = false;
  welcome!: MessageOf<ServerMessage, "WELCOME">["payload"];
  snapshot!: MessageOf<ServerMessage, "SNAPSHOT">["payload"];

  static async connect(o: ConnectOptions): Promise<XenxoClient> {
    const c = new XenxoClient();
    await c.open(o);
    return c;
  }

  private async open(o: ConnectOptions) {
    let token = o.token;
    if (!token) {
      const path = o.agentKey ? "/auth/agent" : "/auth/guest";
      const res = await fetch(new URL(path, o.baseUrl), {
        method: "POST",
        headers: o.agentKey ? { Authorization: `Bearer ${o.agentKey}` } : {},
      });
      if (!res.ok) throw new Error(`auth ${path} → HTTP ${res.status}`);
      token = ((await res.json()) as { token: string }).token;
    }

    const chunkId = o.chunkId ?? "c_0_0";
    let url = new URL(`/chunk/${chunkId}/ws`, o.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);
    // Un distrito puede vivir en otro servidor: el pase dice dónde conectar (servidores antiguos no
    // tienen /ticket: entonces, aquí). La plaza y el nexo siempre están en el servidor principal.
    if (chunkId !== "c_0_0" && chunkId !== "c_0_-1000") {
      const t = await fetch(new URL(`/chunk/${chunkId}/ticket`, o.baseUrl), { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      if (t?.ok) url = new URL(((await t.json()) as { url: string }).url);
      else if (t && t.status !== 404) throw new Error(`ticket ${chunkId} → HTTP ${t.status}`);
    }

    this.ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("no se pudo abrir el WebSocket"));
    });
    this.ws.onmessage = (e) => {
      const m = parseServerMessage(String(e.data));
      if (!m) return;
      for (const fn of this.listeners) fn(m);
      const i = this.waiters.findIndex((w) => w.match(m));
      if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
      else {
        this.received.push(m);
        if (this.received.length > this.maxReceived) this.received.splice(0, this.received.length - this.maxReceived);
      }
    };
    this.ws.addEventListener("close", () => {
      this.closed = true;
    });

    const welcome = this.next("WELCOME");
    const snapshot = this.next("SNAPSHOT");
    this.sendRaw(
      msg("HELLO", {
        client_type: "headless",
        capabilities: { xr: false, hand_tracking: false, haptics: false, lod: "low" },
        display_name: o.displayName,
        ...(o.avatar ? { avatar: o.avatar } : {}),
      }),
    );
    this.welcome = (await welcome).payload;
    this.snapshot = (await snapshot).payload;
  }

  /** Espera el próximo mensaje de un tipo (o que cumpla una condición). */
  next<T extends ServerType>(type: T, where?: (m: MessageOf<ServerMessage, T>) => boolean, timeoutMs = 5000) {
    return this.either(
      (m) => m.type === type && (!where || where(m as MessageOf<ServerMessage, T>)),
      timeoutMs,
      `timeout esperando ${type}`,
    ) as Promise<MessageOf<ServerMessage, T>>;
  }

  /** Un único waiter para varias respuestas posibles: al resolverse no deja restos que roben mensajes. */
  private either(match: (m: ServerMessage) => boolean, timeoutMs = 5000, why = "timeout esperando respuesta"): Promise<ServerMessage> {
    const seen = this.received.find(match);
    if (seen) {
      this.received.splice(this.received.indexOf(seen), 1);
      return Promise.resolve(seen);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        match,
        resolve: (m: ServerMessage) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(why));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /** Escucha todos los mensajes del servidor (p. ej. para llevar el estado del mundo al día). */
  onMessage(fn: (m: ServerMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  sendRaw(m: unknown) {
    this.ws.send(typeof m === "string" ? m : JSON.stringify(m));
  }

  pose(p: [number, number, number], yaw = 0, emote?: string, car?: { p: [number, number, number]; inside: boolean }) {
    const r: [number, number, number, number] = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    this.sendRaw(msg("POSE", { t: Date.now(), head: { p, r }, ...(emote ? { emote } : {}), ...(car ? { car: { p: car.p, r }, ...(car.inside ? { vehicle: "car" as const } : {}) } : {}) }));
  }

  /** Envía una mutación y resuelve con su ACK o su ERROR. */
  async mutate(mutation: MutationOp, idempotency_key: string = randomUUID()) {
    const id = randomUUID();
    const reply = this.either(
      (m) => (m.type === "ACK" || m.type === "ERROR") && m.payload.ref === id,
    ) as Promise<MessageOf<ServerMessage, "ACK"> | MessageOf<ServerMessage, "ERROR">>;
    this.sendRaw(msg("MUTATE_WORLD", { idempotency_key, target: "commit", mutation }, { id }));
    return reply;
  }

  /**
   * Actividades: COLLECT, CHECKPOINT o SCORES_GET sobre una entidad; resuelve con su respuesta
   * (COLLECTED, RACE o SCORES) o con el ERROR. Un punto de carrera fuera de orden no responde nada.
   */
  async activity(type: "COLLECT" | "CHECKPOINT" | "SCORES_GET", entity_id: string, timeoutMs = 3000) {
    const id = randomUUID();
    const want = type === "COLLECT" ? "COLLECTED" : type === "CHECKPOINT" ? "RACE" : "SCORES";
    const reply = this.either((m) => m.type === want || (m.type === "ERROR" && m.payload.ref === id), timeoutMs, `timeout esperando ${want}`);
    this.sendRaw(msg(type, { entity_id }, { id }));
    return reply;
  }

  /** Envía un mensaje de chat y resuelve con el CHAT_MSG propio o con el ERROR. */
  async chat(text: string) {
    const id = randomUUID();
    // El eco propio se reconoce por la sesión y el texto ya limpio no se conoce: vale el primero propio.
    const reply = this.either(
      (m) => (m.type === "CHAT_MSG" && m.payload.session_id === this.welcome.session_id) || (m.type === "ERROR" && m.payload.ref === id),
    ) as Promise<MessageOf<ServerMessage, "CHAT_MSG"> | MessageOf<ServerMessage, "ERROR">>;
    this.sendRaw(msg("CHAT", { text }, { id }));
    return reply;
  }

  close() {
    this.ws.close();
  }
}
