/**
 * Carné de jugador público (GET /players/<n>). Módulo ligero: la página del carné no carga la
 * cuenta, las passkeys ni el mundo.
 */
import type { ProjectCategory } from "@xenxo/protocol";
import { REALTIME_URL } from "../config";
import type { BadgeInfo } from "./badges";

export interface PlayerCard {
  player_no: number;
  name: string;
  avatar: { hash: string; format: "glb" | "vrm" } | null;
  /** Fecha de alta (ms). */
  joined: number;
  /** Insignias de las actividades (las da el servidor). */
  badges?: BadgeInfo[];
  projects: {
    id: string;
    title: string;
    summary: string;
    url: string | null;
    cover_hash: string | null;
    category: ProjectCategory;
    district: string | null;
    parcel: string | null;
  }[];
}

/** El carné de un número, o `null` si no existe o su dueño no lo ha hecho público. */
export async function fetchPlayerCard(no: number): Promise<PlayerCard | null> {
  const res = await fetch(new URL(`/players/${no}`, REALTIME_URL));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`players ${res.status}`);
  return (await res.json()) as PlayerCard;
}

/** Dirección pública del carné, para copiar o compartir. */
export function cardLink(no: number): string {
  return `${location.origin}/p/${no}`;
}

/** /p/<n> → n (sin ceros a la izquierda, como en el servidor). */
export function cardRoute(pathname: string): number | null {
  const m = pathname.match(/^\/p\/(0|[1-9]\d{0,8})\/?$/);
  return m ? Number(m[1]) : null;
}
