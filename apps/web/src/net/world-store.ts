/**
 * Estado del mundo en el cliente.
 *
 * Regla de rendimiento: la red escribe aquí (estructuras mutables) y el render
 * lee en useFrame. React solo se entera de cambios ESTRUCTURALES (entra/sale
 * una entidad o un avatar), nunca de cada pose.
 */
import { useSyncExternalStore } from "react";
import type { AvatarPose, Entity, Peer, ServerMessage } from "@xenxo/protocol";
import type { ConnectionStatus } from "./NetworkAdapter";

export interface PoseSample {
  t: number; // hora del servidor (ms)
  head: AvatarPose["head"];
}

const BUFFER = 20;

class WorldStore {
  entities = new Map<string, Entity>();
  peers = new Map<string, Peer>();
  /** Poses por sesión, ordenadas por tiempo del servidor. */
  poseBuffers = new Map<string, PoseSample[]>();
  sessionId: string | null = null;
  canBuild = false;
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

  apply(m: ServerMessage) {
    switch (m.type) {
      case "WELCOME":
        this.sessionId = m.payload.session_id;
        this.canBuild = m.payload.principal.scopes.includes("build");
        this.clockOffset = m.payload.server_time - Date.now();
        this.bump();
        break;
      case "SNAPSHOT":
        this.entities = new Map(m.payload.entities.map((e) => [e.entity_id, e]));
        this.peers = new Map(m.payload.peers.filter((p) => p.session_id !== this.sessionId).map((p) => [p.session_id, p]));
        for (const p of m.payload.poses) this.pushPose(p.session_id, this.serverNow(), p.head);
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
          if (p.session_id !== this.sessionId) this.pushPose(p.session_id, m.payload.t, p.head);
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
      case "ERROR":
        this.lastError = `${m.payload.code}: ${m.payload.message}`;
        console.warn("[xenxo]", this.lastError, m.payload.detail ?? "");
        this.bump();
        break;
      default:
        break;
    }
  }

  private pushPose(id: string, t: number, head: AvatarPose["head"]) {
    const buf = this.poseBuffers.get(id) ?? [];
    buf.push({ t, head });
    if (buf.length > BUFFER) buf.shift();
    this.poseBuffers.set(id, buf);
  }
}

export const world = new WorldStore();

/** Re-renderiza solo ante cambios estructurales. */
export function useWorldVersion() {
  return useSyncExternalStore(world.subscribe, world.getVersion);
}
