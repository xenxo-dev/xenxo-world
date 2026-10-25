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
}

export class XenxoClient {
  private ws!: WebSocket;
  private waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  readonly received: ServerMessage[] = [];
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

    const url = new URL(`/chunk/${o.chunkId ?? "c_0_0"}/ws`, o.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);

    this.ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("no se pudo abrir el WebSocket"));
    });
    this.ws.onmessage = (e) => {
      const m = parseServerMessage(String(e.data));
      if (!m) return;
      const i = this.waiters.findIndex((w) => w.match(m));
      if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
      else this.received.push(m);
    };

    const welcome = this.next("WELCOME");
    const snapshot = this.next("SNAPSHOT");
    this.sendRaw(
      msg("HELLO", {
        client_type: "headless",
        capabilities: { xr: false, hand_tracking: false, haptics: false, lod: "low" },
        display_name: o.displayName,
      }),
    );
    this.welcome = (await welcome).payload;
    this.snapshot = (await snapshot).payload;
  }

  /** Espera el próximo mensaje de un tipo (o que cumpla una condición). */
  next<T extends ServerType>(type: T, where?: (m: MessageOf<ServerMessage, T>) => boolean, timeoutMs = 5000) {
    const seen = this.received.find((m) => m.type === type && (!where || where(m as MessageOf<ServerMessage, T>)));
    if (seen) {
      this.received.splice(this.received.indexOf(seen), 1);
      return Promise.resolve(seen as MessageOf<ServerMessage, T>);
    }
    return new Promise<MessageOf<ServerMessage, T>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout esperando ${type}`)), timeoutMs);
      this.waiters.push({
        match: (m) => m.type === type && (!where || where(m as MessageOf<ServerMessage, T>)),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as MessageOf<ServerMessage, T>);
        },
      });
    });
  }

  sendRaw(m: unknown) {
    this.ws.send(typeof m === "string" ? m : JSON.stringify(m));
  }

  pose(p: [number, number, number], yaw = 0) {
    this.sendRaw(msg("POSE", { t: Date.now(), head: { p, r: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] } }));
  }

  /** Envía una mutación y resuelve con su ACK o su ERROR. */
  async mutate(mutation: MutationOp, idempotency_key: string = randomUUID()) {
    const id = randomUUID();
    const reply = Promise.race([
      this.next("ACK", (m) => m.payload.ref === id),
      this.next("ERROR", (m) => m.payload.ref === id),
    ]);
    this.sendRaw(msg("MUTATE_WORLD", { idempotency_key, target: "commit", mutation }, { id }));
    return reply;
  }

  close() {
    this.ws.close();
  }
}
