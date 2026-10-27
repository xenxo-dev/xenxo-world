/**
 * Estado del mundo en el cliente.
 *
 * Regla de rendimiento: la red escribe aquí (estructuras mutables) y el render
 * lee en useFrame. React solo se entera de cambios ESTRUCTURALES (entra/sale
 * una entidad o un avatar), nunca de cada pose.
 */
import { useSyncExternalStore } from "react";
import { CHUNK_SIZE, PLACES, type AvatarPose, type ChatMessage, type Entity, type Peer, type ServerMessage } from "@xenxo/protocol";
import type { ConnectionStatus } from "./NetworkAdapter";

export interface PoseSample {
  t: number; // hora del servidor (ms)
  head: AvatarPose["head"];
  /** Gesto en curso ("dance", "wave", "sit"…), si lo hay. */
  emote?: string;
}

const BUFFER = 20;

class WorldStore {
  entities = new Map<string, Entity>();
  peers = new Map<string, Peer>();
  /** Poses por sesión, ordenadas por tiempo del servidor. */
  poseBuffers = new Map<string, PoseSample[]>();
  sessionId: string | null = null;
  /** Chunk en el que estamos (el nexo al entrar). Todo se dibuja relativo a él. */
  chunkId: string = PLACES.nexo;
  canBuild = false;
  /** Lugar en solitario (el nexo): sin más gente, sin poses y sin chat. */
  solo = false;
  /** Hasta dónde se camina (mín. y máx. en X y Z): lo dice el servidor; si no, el chunk. */
  walk: [number, number] = [1, CHUNK_SIZE - 1];
  /** Lugar compartido más grande que un chunk: poses y contenido de la gente, por cercanía. */
  big = false;
  /** Ciudad de fondo del distrito (WELCOME.theme): la de un distrito del sistema o la que eligió su autor. */
  theme: { id: string; color: string } | null = null;
  status: ConnectionStatus = "idle";
  lastError: string | null = null;
  /** serverTime ≈ Date.now() + clockOffset */
  clockOffset = 0;

  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  private bump() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  setStatus(s: ConnectionStatus) {
    this.status = s;
    if (s !== "open") {
      this.peers.clear();
      this.poseBuffers.clear();
    }
    this.bump();
  }

  serverNow() {
    return Date.now() + this.clockOffset;
  }

  /** Desplazamiento (x, z) de un chunk respecto al actual: el actual queda en 0..CHUNK_SIZE. */
  offsetOf(chunkId: string): [number, number] {
    const [, x = "0", z = "0"] = chunkId.split("_");
    const [, cx = "0", cz = "0"] = this.chunkId.split("_");
    return [(Number(x) - Number(cx)) * CHUNK_SIZE, (Number(z) - Number(cz)) * CHUNK_SIZE];
  }

  /** Cambio de lugar: se vacía el mundo hasta que llegue la foto del nuevo chunk. */
  beginTravel(chunkId: string) {
    this.chunkId = chunkId;
    this.solo = false;
    this.big = false;
    this.theme = null;
    // Sin límites hasta que el lugar diga los suyos en WELCOME: el punto de llegada (p. ej. una
    // isla del nexo) puede estar fuera del chunk.
    this.walk = [-Infinity, Infinity];
    this.entities = new Map();
    this.peers.clear();
    this.poseBuffers.clear();
    chat.reset([]);
    this.bump();
  }

  apply(m: ServerMessage) {
    switch (m.type) {
      case "WELCOME":
        this.sessionId = m.payload.session_id;
        this.chunkId = m.payload.chunk_id;
        this.canBuild = m.payload.principal.scopes.includes("build");
        this.solo = m.payload.solo === true;
        this.walk = m.payload.walk ?? [1, CHUNK_SIZE - 1];
        this.big = !this.solo && (this.walk[0] < 0 || this.walk[1] > CHUNK_SIZE);
        this.theme = m.payload.theme ?? null;
        this.clockOffset = m.payload.server_time - Date.now();
        this.bump();
        break;
      case "SNAPSHOT":
        chat.reset(m.payload.chat ?? []);
        this.entities = new Map(m.payload.entities.map((e) => [e.entity_id, e]));
        this.peers = new Map(m.payload.peers.filter((p) => p.session_id !== this.sessionId).map((p) => [p.session_id, p]));
        for (const p of m.payload.poses) this.pushPose(p.session_id, this.serverNow(), p.head, p.emote);
        this.bump();
        break;
      case "DELTA":
        for (const c of m.payload.changes) {
          if (c.kind === "upsert") this.entities.set(c.entity.entity_id, c.entity);
          else this.entities.delete(c.entity_id);
        }
        this.bump();
        break;
      case "POSES":
        // Ajuste suave del reloj: nunca adelantamos el servidor.
        this.clockOffset = Math.min(this.clockOffset + 2, m.payload.t - Date.now());
        for (const p of m.payload.poses) {
          if (p.session_id !== this.sessionId) this.pushPose(p.session_id, m.payload.t, p.head, p.emote);
        }
        break;
      case "PEER_JOIN":
        if (m.payload.session_id !== this.sessionId) {
          this.peers.set(m.payload.session_id, m.payload);
          this.bump();
        }
        break;
      case "PEER_LEAVE":
        this.peers.delete(m.payload.session_id);
        this.poseBuffers.delete(m.payload.session_id);
        this.bump();
        break;
      case "CHAT_MSG":
        chat.add(m.payload);
        break;
      case "CHAT_REMOVED":
        chat.remove(m.payload.id);
        break;
      case "ERROR":
        this.lastError = `${m.payload.code}: ${m.payload.message}`;
        console.warn("[xenxo]", this.lastError, m.payload.detail ?? "");
        if (m.payload.code === "rate_limited" || m.payload.code === "forbidden") chat.notice(m.payload.code);
        this.bump();
        break;
      default:
        break;
    }
  }

  private pushPose(id: string, t: number, head: AvatarPose["head"], emote?: string) {
    const buf = this.poseBuffers.get(id) ?? [];
    buf.push({ t, head, emote });
    if (buf.length > BUFFER) buf.shift();
    this.poseBuffers.set(id, buf);
  }
}

export const world = new WorldStore();

/* ------------------------------------------------------------------ */
/* Chat: suscripción propia para no re-renderizar la escena por cada mensaje */
/* ------------------------------------------------------------------ */

const CHAT_KEEP = 60;
/** Segundos que un bocadillo sigue sobre la cabeza de quien habla. */
export const BUBBLE_MS = 7000;

class ChatStore {
  messages: ChatMessage[] = [];
  /** Último aviso del servidor (límite de frecuencia, sin permiso). */
  lastNotice: { code: string; at: number } | null = null;
  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private bump() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  reset(list: ChatMessage[]) {
    this.messages = list.slice(-CHAT_KEEP);
    this.bump();
  }
  add(m: ChatMessage) {
    if (this.messages.some((x) => x.id === m.id)) return;
    this.messages = [...this.messages, m].slice(-CHAT_KEEP);
    this.bump();
  }
  remove(id: string) {
    this.messages = this.messages.filter((m) => m.id !== id);
    this.bump();
  }
  notice(code: string) {
    this.lastNotice = { code, at: Date.now() };
    this.bump();
  }
  /** Último mensaje reciente de una sesión (para el bocadillo). */
  bubbleFor(sessionId: string, now = world.serverNow()): ChatMessage | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      if (now - m.t > BUBBLE_MS) return null;
      if (m.session_id === sessionId) return m;
    }
    return null;
  }
}

export const chat = new ChatStore();

export function useChatVersion() {
  return useSyncExternalStore(chat.subscribe, chat.getVersion);
}

/** Re-renderiza solo cuando cambia de lugar (nexo, plaza…). */
export function usePlace(): string {
  return useSyncExternalStore(world.subscribe, () => world.chunkId);
}

/** La ciudad de fondo del lugar (cambia al llegar a un distrito). */
export function usePlaceTheme(): { id: string; color: string } | null {
  return useSyncExternalStore(world.subscribe, () => world.theme);
}

/** Re-renderiza solo ante cambios estructurales. */
export function useWorldVersion() {
  return useSyncExternalStore(world.subscribe, world.getVersion);
}
