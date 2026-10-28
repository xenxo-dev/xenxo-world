/**
 * Nodos de la comunidad (servidores de distritos): el registro que gestiona el fundador desde el
 * panel. El servidor guarda dónde vive cada distrito (apps/realtime/src/nodes.ts).
 */
import { authedApi } from "./account";

export interface NodeRow {
  id: string;
  name: string;
  url: string;
  created_at: number;
  disabled: number;
  fails: number;
  last_ok: number | null;
  last_fail: number | null;
}
export interface ChunkHostRow {
  chunk_id: string;
  node_id: string;
  state: "node" | "fallback";
  since: number;
  snapshot_rev: string | null;
  snapshot_at: number | null;
}
export interface NodePlace {
  chunk_id: string;
  id: string;
  name: { es: string; en: string } | string;
}

export const listNodes = () => authedApi<{ nodes: NodeRow[]; hosts: ChunkHostRow[]; districts: NodePlace[] }>("GET", "/mod/nodes");
export const addNode = (id: string, name: string, url: string) => authedApi<{ node: NodeRow; alive: boolean; chunks: string[] }>("POST", "/mod/nodes", { id, name, url });
export const setNodeEnabled = (id: string, on: boolean) => authedApi<{ fallback?: string[] }>("POST", `/mod/nodes/${id}/${on ? "enable" : "disable"}`, {});
export const removeNode = (id: string) => authedApi("DELETE", `/mod/nodes/${id}`);
export const checkNodes = () => authedApi<{ checked: number; down: string[]; snapshots: string[]; fallback: string[] }>("POST", "/mod/nodes/check", {});
export const moveDistrict = (chunkId: string, to: string) => authedApi("POST", `/mod/chunks/${chunkId}/move`, { to });
