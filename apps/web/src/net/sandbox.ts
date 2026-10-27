/**
 * Zona de pruebas (Taller): lo que construye esta cuenta con piezas básicas. Las piezas son
 * entidades normales (MUTATE_WORLD, la misma puerta que todo); el servidor comprueba la zona,
 * las piezas permitidas y el tope por persona. Aquí solo se envían y se recuerda el aviso.
 */
import { useSyncExternalStore } from "react";
import { msg, type ClientMessage, type Components } from "@xenxo/protocol";
import activities from "../../../realtime/src/district-activities.json";
import districts from "../../../realtime/src/districts.json";
import { net } from "./session";
import { world } from "./world-store";

export interface SandboxRect { x0: number; z0: number; x1: number; z1: number; max_y: number; per_person: number; lights: number }

const BY_CHUNK = new Map((districts.districts as { id: string; chunk: string }[]).map((d) => [d.chunk, d.id]));
const RECTS = activities as unknown as Record<string, { sandbox?: SandboxRect } | undefined>;

/** La zona de pruebas del lugar actual, si la tiene. */
export function sandboxHere(): SandboxRect | null {
  const id = BY_CHUNK.get(world.chunkId);
  return (id && RECTS[id]?.sandbox) || null;
}

export function insideSandbox(z: SandboxRect, x: number, zz: number, margin = 0) {
  return x >= z.x0 - margin && x <= z.x1 + margin && zz >= z.z0 - margin && zz <= z.z1 + margin;
}

/** Las mutaciones de la zona llevan este prefijo: su respuesta va aquí y no al chat. */
export const SANDBOX_REF = "sbx_";

class SandboxStore {
  /** Lo colocado en esta visita, para deshacer (de lo último a lo primero). */
  placed: string[] = [];
  notice: { code: string; message: string; at: number } | null = null;
  private v = 0;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.v;
  private bump() {
    this.v++;
    for (const fn of this.listeners) fn();
  }
  ack(ref: string, entityId: string) {
    if (pending.get(ref) === "spawn") this.placed.push(entityId);
    pending.delete(ref);
    this.bump();
  }
  error(ref: string, code: string, message: string) {
    pending.delete(ref);
    this.notice = { code, message, at: performance.now() };
    this.bump();
  }
}

export const sandbox = new SandboxStore();
const pending = new Map<string, "spawn" | "despawn">();
let n = 0;

export function useSandbox() {
  useSyncExternalStore(sandbox.subscribe, sandbox.getVersion);
  return sandbox;
}

function key() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function placePiece(components: Components) {
  const id = `${SANDBOX_REF}${++n}`;
  pending.set(id, "spawn");
  net.send(msg("MUTATE_WORLD", { idempotency_key: key(), target: "commit", mutation: { op: "SPAWN", components } }, { id }) as ClientMessage);
}

export function removePiece(entityId: string, baseRev: number) {
  const id = `${SANDBOX_REF}${++n}`;
  pending.set(id, "despawn");
  sandbox.placed = sandbox.placed.filter((x) => x !== entityId);
  net.send(msg("MUTATE_WORLD", { idempotency_key: key(), target: "commit", mutation: { op: "DESPAWN", entity_id: entityId, base_rev: baseRev } }, { id }) as ClientMessage);
}
