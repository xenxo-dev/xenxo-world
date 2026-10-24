/**
 * Puerto de red. El resto del cliente solo conoce esta interfaz.
 * Hoy la implementa un WebSocket contra un Durable Object; mañana puede ser
 * un servidor dedicado o WebTransport sin tocar nada más.
 */
import { parseServerMessage, type ClientMessage, type ServerMessage } from "@xenxo/protocol";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";

export interface NetworkAdapter {
  connect(chunkId: string, token: string): void;
  send(m: ClientMessage): void;
  onMessage(fn: (m: ServerMessage) => void): () => void;
  onStatus(fn: (s: ConnectionStatus) => void): () => void;
  close(): void;
}

export class WebSocketAdapter implements NetworkAdapter {
  private ws: WebSocket | null = null;
  private msgFns = new Set<(m: ServerMessage) => void>();
  private statusFns = new Set<(s: ConnectionStatus) => void>();

  constructor(private baseUrl: string) {}

  connect(chunkId: string, token: string) {
    this.close();
    const url = new URL(`/chunk/${chunkId}/ws`, this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);
    this.emitStatus("connecting");
    const ws = new WebSocket(url);
    ws.onopen = () => this.emitStatus("open");
    ws.onclose = () => this.emitStatus("closed");
    ws.onmessage = (e) => {
      // Compatibilidad hacia delante: lo que no entendemos se ignora.
      const m = typeof e.data === "string" ? parseServerMessage(e.data) : null;
      if (m) for (const fn of this.msgFns) fn(m);
    };
    this.ws = ws;
  }

  send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  onMessage(fn: (m: ServerMessage) => void) {
    this.msgFns.add(fn);
    return () => this.msgFns.delete(fn);
  }

  onStatus(fn: (s: ConnectionStatus) => void) {
    this.statusFns.add(fn);
    return () => this.statusFns.delete(fn);
  }

  close() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
      this.emitStatus("closed");
    }
  }

  private emitStatus(s: ConnectionStatus) {
    for (const fn of this.statusFns) fn(s);
  }
}
