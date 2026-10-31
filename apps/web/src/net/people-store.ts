/**
 * Gente (§9 octies del protocolo): reacciones, acciones en pareja y modo pelea, del lado del
 * cliente. Lo escribe la red (world-store reenvía aquí sus mensajes) y lo leen el mundo 3D (en
 * useFrame, sin re-renderizar) y el HUD (con `usePeople`, solo ante cambios estructurales).
 */
import { useSyncExternalStore } from "react";
import type { FightMove, FightStyle, PairAction, Reaction, ServerMessage } from "@xenxo/protocol";

/** Ref de los mensajes de gente: sus errores van al aviso del HUD, no al chat. */
export const PEOPLE_REF = "people-";

export interface ReactionEvent {
  session_id: string;
  kind: Reaction;
  /** performance.now() al llegar. */
  at: number;
}

export interface HitEvent {
  from: string;
  to: string;
  move: FightMove;
  style: FightStyle;
  dir: [number, number];
  power: number;
  fall: boolean;
  ko: boolean;
  at: number;
}

export interface PairEvent {
  a: string;
  b: string;
  kind: PairAction;
  at: number;
}

/** Cuánto duran en pantalla (ms). */
export const REACTION_MS = 2200;
export const HIT_MS = 1400;
/** Cuánto vale una propuesta en el HUD (lo mismo que en el servidor). */
export const OFFER_MS = 20_000;

class PeopleStore {
  /** Estilo de pelea del lugar (WELCOME.fight); null = aquí no se pelea. */
  style: FightStyle | null = null;
  /** El modo pelea pedido por esta persona (se mantiene al cambiar de distrito, nunca se guarda). */
  fightOn = false;
  /** Quién más tiene el modo pelea (de las poses). */
  fighters = new Set<string>();
  reactions: ReactionEvent[] = [];
  hits: HitEvent[] = [];
  pairs: PairEvent[] = [];
  /** Propuestas recibidas: de quién, qué y cuándo. */
  offers: { from: string; kind: PairAction; at: number }[] = [];
  /** Aviso corto para el HUD (clave de i18n) y cuándo. */
  notice: { key: string; at: number } | null = null;
  /** Último golpe recibido por cada sesión (para dibujar su caída). */
  lastHit = new Map<string, HitEvent>();
  /** Esta sesión (de WELCOME). */
  me: string | null = null;

  private version = 0;
  private listeners = new Set<() => void>();
  private hitListeners = new Set<(h: HitEvent) => void>();
  private pairListeners = new Set<(p: PairEvent) => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private bump() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
  onHit(fn: (h: HitEvent) => void) {
    this.hitListeners.add(fn);
    return () => void this.hitListeners.delete(fn);
  }
  onPair(fn: (p: PairEvent) => void) {
    this.pairListeners.add(fn);
    return () => void this.pairListeners.delete(fn);
  }

  setNotice(key: string) {
    this.notice = { key, at: Date.now() };
    this.bump();
  }

  /** Mensajes de la red que tocan a la gente (los demás se ignoran). */
  apply(m: ServerMessage) {
    const now = performance.now();
    switch (m.type) {
      case "WELCOME":
        this.style = m.payload.fight ?? null;
        this.me = m.payload.session_id;
        this.fighters.clear();
        this.reactions = [];
        this.hits = [];
        this.pairs = [];
        this.offers = [];
        this.lastHit.clear();
        this.bump();
        break;
      case "SNAPSHOT":
      case "POSES": {
        let changed = false;
        for (const p of m.payload.poses) {
          const had = this.fighters.has(p.session_id);
          if (p.fight && !had) {
            this.fighters.add(p.session_id);
            changed = true;
          } else if (!p.fight && had) {
            this.fighters.delete(p.session_id);
            changed = true;
          }
        }
        if (changed) this.bump();
        break;
      }
      case "PEER_LEAVE":
        if (this.fighters.delete(m.payload.session_id)) this.bump();
        break;
      case "REACTION":
        this.reactions = [...this.reactions.filter((r) => now - r.at < REACTION_MS), { ...m.payload, at: now }].slice(-24);
        break;
      case "PAIR_OFFER":
        this.offers = [...this.offers.filter((o) => o.from !== m.payload.from && Date.now() - o.at < OFFER_MS), { ...m.payload, at: Date.now() }];
        this.bump();
        break;
      case "PAIR_START": {
        const ev = { ...m.payload, at: now };
        this.pairs = [...this.pairs.filter((p) => now - p.at < 4000), ev];
        this.offers = this.offers.filter((o) => o.from !== m.payload.a);
        for (const fn of this.pairListeners) fn(ev);
        this.bump();
        break;
      }
      case "PAIR_END":
        this.offers = this.offers.filter((o) => o.from !== m.payload.a);
        // El aviso es para quien propuso (a quien contestó no le hace falta).
        if (m.payload.a === this.me || m.payload.reason === "far") this.setNotice(`people.pair.${m.payload.reason}`);
        else this.bump();
        break;
      case "HIT_EVENT": {
        const ev: HitEvent = { ...m.payload, ko: !!m.payload.ko, at: now };
        this.hits = [...this.hits.filter((h) => now - h.at < HIT_MS), ev].slice(-16);
        this.lastHit.set(ev.to, ev);
        for (const fn of this.hitListeners) fn(ev);
        break;
      }
      case "ERROR": {
        // ref = people-<acción>-<n>: el aviso es por acción (los textos del servidor no se traducen).
        const ref = m.payload.ref;
        if (!ref?.startsWith(PEOPLE_REF)) break;
        const action = ref.slice(PEOPLE_REF.length).split("-")[0];
        this.setNotice(m.payload.code === "rate_limited" ? "people.err.slow" : `people.err.${action}`);
        break;
      }
      default:
        break;
    }
  }

  /** La propuesta ya contestada (o caducada) deja de verse. */
  dropOffer(from: string) {
    this.offers = this.offers.filter((o) => o.from !== from);
    this.bump();
  }
}

export const people = new PeopleStore();

/** Re-renderiza ante cambios estructurales (estilo, modo pelea, propuestas, avisos). */
export function usePeople() {
  useSyncExternalStore(people.subscribe, people.getVersion);
  return people;
}
