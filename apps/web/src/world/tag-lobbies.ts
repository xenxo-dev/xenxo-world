/**
 * Los corros de los juegos de pillar del lugar (tag@1, §9 decies), sacados de sus entidades: dónde
 * están (en metros de la escena), de qué tamaño y su zona. Sin Three.js: lo usan el mundo
 * (TagGames.tsx) y el HUD (hud/TagHud.tsx).
 */
import { TagV1, TransformV1, type Entity } from "@xenxo/protocol";
import { insideArea, type TagState } from "../net/tag";
import { world } from "../net/world-store";
import { self } from "./self";

export interface TagLobby {
  /** La entidad del corro. */
  id: string;
  game: string;
  mode: "tag" | "infection";
  x: number;
  y: number;
  z: number;
  radius: number;
  area: { x: number; z: number; r: number };
}

/** El color de cada juego: el rosa del tema (pilla-pilla) y un verde lima (infección); el HUD usa los mismos (hud/TagHud.tsx). */
export const TAG_COLORS = { tag: "#ff4fd8", infection: "#6dff8a" } as const;

/** Los corros de estas entidades. */
export function lobbiesOf(list: Iterable<Entity>): TagLobby[] {
  const out: TagLobby[] = [];
  for (const e of list) {
    if (!e.components["tag@1"]) continue;
    const tr = TransformV1.safeParse(e.components["transform@1"]);
    const tg = TagV1.safeParse(e.components["tag@1"]);
    if (!tr.success || !tg.success) continue;
    const [ox, oz] = world.offsetOf(e.chunk_id);
    const [x, y, z] = tr.data.p;
    const c = tg.data.area.c ?? tr.data.p;
    out.push({ id: e.entity_id, game: tg.data.id, mode: tg.data.mode, x: x + ox, y, z: z + oz, radius: tg.data.radius, area: { x: c[0] + ox, z: c[2] + oz, r: tg.data.area.r } });
  }
  return out;
}

/** ¿Están estos pies en el corro? (A su altura y dentro de su radio, como lo mira el servidor con la cabeza.) */
export function inLobby(l: TagLobby, p: { x: number; y: number; z: number }): boolean {
  const dy = p.y - l.y;
  return dy > -2.5 && dy < 2 && Math.hypot(p.x - l.x, p.z - l.z) <= l.radius;
}

/** ¿Estoy dentro de la zona de la ronda en que juego? (Sin ronda, sí.) */
export function insideMyArea(lobbies: TagLobby[], g: TagState | null): boolean {
  const l = g ? lobbies.find((x) => x.id === g.entity_id) : undefined;
  return !l || insideArea(l.area, self);
}
