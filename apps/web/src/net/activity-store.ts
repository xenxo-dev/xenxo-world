/**
 * Actividades del lugar en el cliente (búsquedas, carreras y marcadores): lo que ya tiene esta
 * cuenta, la carrera en curso, los marcadores recibidos y el aviso del HUD. Lo escribe la red
 * (world-store) y lo leen el mundo (Activities.tsx, Entities.tsx) y el HUD (ActivityHud.tsx).
 * React solo se entera de cambios (no por frame).
 */
import { useSyncExternalStore } from "react";
import { msg, type ClientMessage, type MessageOf, type ServerMessage } from "@xenxo/protocol";
import { checkBadgesSoon } from "./badges";
import { firstSteps } from "./first-steps";
import { rivalGap, rivalLap } from "./house-rival";
import { gridHold, myRun, nextRound, roundFresh, type RoundPayload, type RoundState } from "./round";
import { net } from "./session";

export type { RoundState };

export type TilesState = MessageOf<ServerMessage, "TILES">["payload"] & { at: number };

export type ScoreRow = MessageOf<ServerMessage, "SCORES">["payload"]["rows"][number];

export type ActivityToast =
  | { kind: "collected"; count: number; total: number; complete: boolean; note?: Record<string, string>; at: number }
  | { kind: "race"; state: "start" | "cp" | "finish" | "reset"; next?: number; total?: number; ms?: number; best?: number; rank?: number; at: number }
  | { kind: "tiles"; state: "won" | "lost"; at: number }
  | { kind: "badge"; name: Record<string, string>; at: number }
  | { kind: "guest"; at: number }
  | { kind: "needCar"; at: number }
  | { kind: "gridFull"; at: number }
  /** Se ha caído de una pista en alto en plena carrera: su coche vuelve al último punto (vehicle/rescue.ts). */
  | { kind: "rescue"; at: number }
  | { kind: "far"; at: number }
  /** Acabas de llegar de un salto (un «Ir» de la guía, un viaje): las actividades tardan unos segundos en contar. */
  | { kind: "wait"; at: number };

class ActivityStore {
  /** Objetos ya recogidos por esta cuenta en este lugar (no se dibujan). */
  collected = new Set<string>();
  /** Mejor tiempo (ms) por la entidad de salida de cada carrera. */
  best: Record<string, number> = {};
  /** Carrera en curso: cuándo empezó en este reloj (para el cronómetro) y el punto que toca. */
  race: { race: string; t0: number; next: number; total: number } | null = null;
  scores = new Map<string, ScoreRow[]>();
  /** Estado de cada tablero de baldosas (TILES), por su entidad; `at` = cuándo llegó (reloj local). */
  tiles = new Map<string, TilesState>();
  /** La ronda en la que corro; si no corro en ninguna, la última de la que ha llegado aviso. */
  round: RoundState | null = null;
  toast: ActivityToast | null = null;
  /** Corriendo solo: lo que le saco (−) o me saca (+) el rival de la casa en la última puerta (ms). */
  rival: { gap: number; gates: number } | null = null;
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

  /** Al cambiar de lugar: nada de lo anterior vale. */
  reset() {
    this.collected = new Set();
    this.best = {};
    this.race = null;
    this.scores = new Map();
    this.tiles = new Map();
    this.round = null;
    this.toast = null;
    this.rival = null;
    this.bump();
  }

  /**
   * Llega cómo va una carrera de salida conjunta (round.ts elige cuál se enseña). `me`: mi sesión;
   * `serverNow`: la hora del servidor vista desde aquí. Mientras corro en ella, la carrera está en
   * marcha como una a pie (`race`: el cronómetro y la puerta que me toca).
   */
  applyRound(p: RoundPayload, me: string | null, serverNow: number) {
    const now = performance.now();
    this.round = nextRound(this.round, p, me, now);
    // El rival de la casa: en cada puerta mía, cuánto le saco (con la hora del servidor de la salida).
    // (También en el aviso del final, que puede traer mi última puerta: la meta.)
    const lap = this.round.mine && this.round.round === p.round && p.entrants.length === 1 ? rivalLap(p.race) : undefined;
    const mine = p.entrants.find((e) => e.session_id === me);
    if (!lap || !mine || p.state === "countdown") this.rival = null;
    else if (mine.gates > (this.rival?.gates ?? 0)) {
      const gap = rivalGap(lap, mine.gates, mine.ms ?? serverNow - p.go_at);
      if (gap !== null) this.rival = { gap, gates: mine.gates };
    }
    const run = this.round.round === p.round ? myRun(this.round, me) : null;
    if (run) this.race = { race: p.race, t0: now - (serverNow - p.go_at), next: run.next, total: run.total };
    else if (this.round.round === p.round && this.race?.race === p.race) this.race = null;
    this.bump();
  }

  /** Conexión nueva (otra sesión): la ronda en la que estuviera ya no es mía. */
  dropRound() {
    if (!this.round) return;
    if (this.race?.race === this.round.race) this.race = null;
    this.round = null;
    this.bump();
  }

  /** ¿Toca esperar en la parrilla? (Estoy en una ronda que aún no ha salido: el coche no arranca.) */
  gridHold(serverNow: number): boolean {
    return gridHold(this.round, serverNow, performance.now());
  }

  /**
   * Una ronda de la que ya no llega nada (el servidor se reinició, o su podio ya pasó) deja de
   * valer: si corría en ella, se para el cronómetro. Se llama cada frame; casi nunca hace nada.
   */
  expireRound(now: number) {
    if (this.round && !roundFresh(this.round, now)) this.dropRound();
  }

  /** Tras completar algo: ¿hay insignia nueva? (se enseña después del aviso de lo completado). */
  private badges() {
    checkBadgesSoon((fresh) => {
      for (const [k, b] of fresh.entries()) setTimeout(() => this.notice({ kind: "badge", name: b.name, at: performance.now() }), 3500 + k * 3500);
    });
  }

  notice(t: ActivityToast) {
    this.toast = t;
    this.bump();
  }

  apply(m: ServerMessage) {
    const now = performance.now();
    switch (m.type) {
      case "PROGRESS":
        this.collected = new Set(m.payload.collected);
        this.best = { ...m.payload.best };
        this.bump();
        return;
      case "COLLECTED":
        // Un conjunto nuevo: quien lo mira (Entities) se entera de que ha cambiado.
        this.collected = new Set(this.collected).add(m.payload.entity_id);
        this.toast = { kind: "collected", count: m.payload.count, total: m.payload.total, complete: m.payload.complete, note: m.payload.note, at: now };
        firstSteps.mark("find");
        // El primero de todos puede dar «Primeros pasos» (si ya terminó una carrera).
        if (m.payload.complete || m.payload.count === 1) this.badges();
        this.bump();
        return;
      case "RACE": {
        const p = m.payload;
        if (p.state === "start") this.race = { race: p.race, t0: now, next: p.next ?? 1, total: p.total ?? 0 };
        else if (p.state === "cp" && this.race) this.race = { ...this.race, next: p.next ?? this.race.next };
        else this.race = null;
        this.toast = { kind: "race", state: p.state, next: p.next, total: p.total, ms: p.ms, best: p.best, rank: p.rank, at: now };
        if (p.state === "finish") {
          firstSteps.mark("race");
          this.badges();
        }
        this.bump();
        return;
      }
      case "SCORES":
        this.scores.set(m.payload.entity_id, m.payload.rows);
        this.bump();
        return;
      case "ERROR": {
        // El servidor no deja empezar nada justo después de un salto (JUMP_COOLDOWN_MS): se dice,
        // para que quien acaba de llegar a una salida con «Ir» sepa que enseguida empieza.
        const reason = (m.payload.detail as { reason?: string } | undefined)?.reason;
        if (m.payload.ref?.startsWith(ACTIVITY_REF) && reason === "jump" && !this.race) {
          this.toast = { kind: "wait", at: now };
          this.bump();
        } else if (m.payload.ref?.startsWith(ACTIVITY_REF) && (reason === "vehicle" || reason === "full")) {
          this.toast = { kind: reason === "full" ? "gridFull" : "needCar", at: now };
          this.bump();
        }
        return;
      }
      case "TILES": {
        const prev = this.tiles.get(m.payload.entity_id);
        this.tiles = new Map(this.tiles).set(m.payload.entity_id, { ...m.payload, at: now });
        // Aviso solo al cerrar una ronda (lo de durante la ronda lo enseña el propio HUD).
        if ((m.payload.state === "won" || m.payload.state === "lost") && prev?.state === "show") this.toast = { kind: "tiles", state: m.payload.state, at: now };
        if (m.payload.state === "won" && prev?.state === "show") this.badges();
        this.bump();
        return;
      }
    }
  }
}

export const activity = new ActivityStore();

/** Solo lo recogido (cambia pocas veces): para dejar de dibujarlo. */
export function useCollected(): Set<string> {
  return useSyncExternalStore(activity.subscribe, () => activity.collected);
}

export function useActivity() {
  useSyncExternalStore(activity.subscribe, activity.getVersion);
  return activity;
}

/**
 * Impulso de una placa (boost@1): hasta cuándo (reloj de performance) y a qué velocidad. Lo
 * escribe el sensor de Activities y lo lee el movimiento del jugador; sin React ni red.
 */
export const boost = { until: 0, speed: 0 };

/** Los avisos de actividad llevan este prefijo en su id: sus errores no van al chat. */
export const ACTIVITY_REF = "act_";
let n = 0;
/**
 * Antes de avisar de «estoy aquí» se manda la pose de ahora (la pone el jugador: Player.tsx): el
 * servidor comprueba el aviso con la última pose que tiene, y en coche la de hace 200 ms está a seis
 * metros.
 */
export const poseFlush: { now: (() => void) | null } = { now: null };
export function sendActivity(type: "COLLECT" | "CHECKPOINT" | "SCORES_GET", entityId: string) {
  if (type !== "SCORES_GET") poseFlush.now?.();
  net.send(msg(type, { entity_id: entityId }, { id: `${ACTIVITY_REF}${++n}` }) as ClientMessage);
}

/** 83 450 ms → «1:23.4». */
export function formatRaceTime(ms: number): string {
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)} s`;
}
