/**
 * Juegos de pillar en el cliente (§9 decies): lo último de cada corro del lugar, la ronda que enseña el
 * HUD (net/tag.ts elige), los avisos (empieza, te la han pasado, has pillado, te has quedado fuera) con
 * su sonido, y los toques que se mandan. Lo escribe la red (world-store) y lo leen el mundo
 * (world/TagGames.tsx y la marca sobre las cabezas, people/PeopleFx.tsx) y el HUD (hud/TagHud.tsx).
 * React solo se entera de cambios (no por frame).
 */
import { useSyncExternalStore } from "react";
import { msg, type ClientMessage } from "@xenxo/protocol";
import { activity, poseFlush } from "./activity-store";
import { checkBadgesSoon } from "./badges";
import { net } from "./session";
import { entryOf, nextTag, type TagPayload, type TagState } from "./tag";
import { remoteFeet } from "../world/people/where";
import { self } from "../world/self";
import { tagAlarm, tagEnd, tagTouch, tagWhistle } from "../world/tag-audio";

export type { TagState };

/** Los avisos de los toques llevan este prefijo en su id: sus rechazos (demasiado lejos…) no van al chat. */
export const TAG_REF = "tag_";

export type TagNotice =
  /** Empieza la ronda: la llevo (o soy de los infectados) o a correr. */
  | { kind: "start"; it: boolean; at: number }
  /** Me la han pasado (o me han infectado). */
  | { kind: "caught"; by: string; at: number }
  /** He pillado a alguien. */
  | { kind: "got"; who: string; at: number }
  /** Alguien de mi ronda ha pillado a otro. */
  | { kind: "seen"; from: string; to: string; at: number }
  /** Me he quedado fuera (salí de la zona). */
  | { kind: "out"; at: number };

class TagStore {
  /** Lo último de cada corro del lugar (por su entidad), mientras no esté vacío. */
  games = new Map<string, TagState>();
  /** La ronda que se enseña (la mía si juego, mi podio al acabar). */
  shown: TagState | null = null;
  notice: TagNotice | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private n = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private bump() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Al cambiar de lugar o de conexión: lo de antes no vale (al llegar, el servidor manda lo que está en juego). */
  reset() {
    this.games = new Map();
    this.shown = null;
    this.notice = null;
    this.bump();
  }

  /** Llega cómo va un juego. `me`: mi sesión. */
  apply(p: TagPayload, me: string | null) {
    const now = performance.now();
    const prev = this.games.get(p.entity_id);
    const same = prev && prev.round === p.round ? prev : undefined;
    const next = new Map(this.games);
    if (p.state === "idle") next.delete(p.entity_id);
    else next.set(p.entity_id, { ...p, at: now });
    this.games = next;
    this.shown = nextTag(this.shown, p, me, now);
    const mine = entryOf(p, me);
    const was = entryOf(same ?? null, me);
    if (mine) {
      if (p.state === "running" && same?.state !== "running") {
        this.notice = { kind: "start", it: mine.role === "it", at: now };
        tagWhistle();
      } else if (p.state === "running" && was && was.role !== "out" && mine.role === "out") this.notice = { kind: "out", at: now };
    }
    // Un toque nuevo: a quién, quién, y su sonido donde ha sido.
    if (p.tag && p.tag.at !== same?.tag?.at) {
      const { from, to } = p.tag;
      // Dónde ha sido (para el sonido): donde se ve a quien pillan.
      const at = to === me ? self : (remoteFeet.get(to) ?? null);
      if (to === me) {
        this.notice = { kind: "caught", by: from, at: now };
        tagAlarm();
      } else if (from === me) {
        this.notice = { kind: "got", who: to, at: now };
        if (at) tagTouch(at.x, at.z, true);
      } else {
        if (mine && mine.role !== "out") this.notice = { kind: "seen", from, to, at: now };
        if (at) tagTouch(at.x, at.z, false);
      }
    }
    // El final: si he jugado, cómo me ha ido (y, si he ganado, puede haber insignia).
    if (p.state === "done" && same && same.state !== "done" && mine) {
      const won = (p.winners ?? []).includes(mine.session_id);
      tagEnd(won);
      if (won) {
        checkBadgesSoon((fresh) => {
          for (const [k, b] of fresh.entries()) setTimeout(() => activity.notice({ kind: "badge", name: b.name, at: performance.now() }), 4000 + k * 3500);
        });
      }
    }
    this.bump();
  }

  /**
   * Qué es ahora alguien en las rondas en juego del lugar ("it": la lleva o está infectado), para su
   * marca. Recorre unos pocos corros con unas pocas personas: se puede llamar en cada frame.
   */
  roleOf(id: string): { role: "it" | "runner"; mode: "tag" | "infection"; ready: number } | null {
    for (const g of this.games.values()) {
      if (g.state !== "running") continue;
      for (const p of g.players) if (p.session_id === id) return p.role === "out" ? null : { role: p.role, mode: g.mode, ready: p.ready_at ?? 0 };
    }
    return null;
  }

  /** Le he tocado (lo comprueba el servidor con las poses: antes sale la mía de ahora). */
  send(to: string) {
    poseFlush.now?.();
    net.send(msg("TAG", { to }, { id: `${TAG_REF}${++this.n}` }) as ClientMessage);
  }
}

export const tag = new TagStore();

/**
 * Quieto al empezar: quien la lleva espera en el corro mientras los demás se dispersan. Lo escribe el
 * mundo en cada frame (world/TagGames.tsx) y lo lee el jugador (Player.tsx), sin React.
 */
export const tagHold = { on: false };

export function useTag() {
  useSyncExternalStore(tag.subscribe, tag.getVersion);
  return tag;
}
