/**
 * Estado del mundo en el cliente.
 *
 * Regla de rendimiento: la red escribe aquí (estructuras mutables) y el render
 * lee en useFrame. React solo se entera de cambios ESTRUCTURALES (entra/sale
 * una entidad o un avatar), nunca de cada pose.
 */
import { activity, ACTIVITY_REF } from "./activity-store";
import { people, PEOPLE_REF } from "./people-store";
import { sandbox, SANDBOX_REF } from "./sandbox";

/** Ref de los mensajes de la gente de las ciudades (npc-store.ts): sus errores no van al chat. */
export const NPC_REF = "npc-";
import { useSyncExternalStore } from "react";
import { CHUNK_SIZE, PLACES, type AvatarPose, type ChatMessage, type Entity, type Peer, type ServerMessage } from "@xenxo/protocol";
import type { ConnectionStatus } from "./NetworkAdapter";
import { PeerPlayout, ServerClock, START_DELAY_MS } from "./playout";

export interface PoseSample {
  /** Hora del servidor (ms) en que se tomó la muestra. */
  t: number;
  head: AvatarPose["head"];
  /** Gesto en curso ("dance", "wave", "sit"…), si lo hay. */
  emote?: string;
  /** En qué va ("car"), si no va a pie, y dónde está su coche (si lo tiene). */
  vehicle?: string;
  car?: AvatarPose["head"];
  /** El arma que lleva en la mano (§9 octies ter), si la ha sacado. */
  weapon?: string;
}

const BUFFER = 20;
/** Si la página lleva más que esto (ms) sin dibujar, lo que tarda en llegar una muestra no dice nada de la red. */
const STALLED_MS = 90;

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
  /** Aquí se hace parkour (WELCOME.parkour: Vertical): world/parkour. */
  parkour = false;
  /** Lo que moderación tiene cerrado aquí ahora (WELCOME.closed): "chat", "sandbox". */
  closed: readonly string[] = [];
  status: ConnectionStatus = "idle";
  lastError: string | null = null;
  /** El nodo que lleva este distrito no responde: se avisa y se sigue intentando (nodes.ts del servidor). */
  unavailable = false;
  /** Nombre del nodo de la comunidad que aloja el lugar actual (null = los servidores de xenxo). */
  host: string | null = null;
  /** Cuántas fotos completas del lugar (SNAPSHOT) han llegado: la pantalla de carga espera a la primera. */
  snapshots = 0;
  /** La hora del servidor vista desde aquí y el retraso con que se dibuja a cada persona (playout.ts). */
  private clock = new ServerClock();
  private playouts = new Map<string, PeerPlayout>();
  /** El reloj local de todo esto y la hora del último frame (ms). */
  private frameAt = performance.now();

  private version = 0;
  /**
   * Cambia solo cuando cambian las entidades del lugar, no cada vez que entra o sale alguien. Lo caro
   * que sale de ellas (las cajas de colisión, lo sólido de la física del coche y de las caídas, la
   * foto de los reflejos) se rehace con esta, no con `version`: si no, en un lugar con gente yendo y
   * viniendo había un tirón cada pocos segundos.
   */
  private entitiesVersion = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  getEntitiesVersion = () => this.entitiesVersion;

  private bump() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  setStatus(s: ConnectionStatus) {
    this.status = s;
    if (s !== "open") {
      this.peers.clear();
      this.poseBuffers.clear();
      this.playouts.clear();
    }
    this.bump();
  }

  setHost(h: string | null) {
    if (this.host === h) return;
    this.host = h;
    this.bump();
  }

  setUnavailable(v: boolean) {
    if (this.unavailable === v) return;
    this.unavailable = v;
    this.bump();
  }

  serverNow() {
    return performance.now() + this.clock.offset;
  }

  /** Una vez por frame, antes de dibujar a nadie: la hora de este frame y el ajuste suave del reloj. */
  frame() {
    const now = performance.now();
    this.clock.step(now - this.frameAt);
    this.frameAt = now;
  }

  /** La hora (del servidor) de la que toca dibujar a esta persona en este frame. */
  playTime(id: string): number {
    const p = this.playouts.get(id);
    return p ? p.time(this.frameAt, this.clock.offset) : this.frameAt + this.clock.offset - START_DELAY_MS;
  }

  /**
   * Cuánto hay que esperar (ms) para enseñar algo que acaba de llegar de esta persona y que no viaja
   * con sus poses (un golpe, un disparo), de modo que se vea a la vez que lo que hacía entonces.
   */
  drawLag(id: string): number {
    return this.playouts.get(id)?.lagMs() ?? START_DELAY_MS;
  }

  /** Con cuánto retraso se la está dibujando (ms): para medir. */
  playDelay(id: string): number {
    return this.playouts.get(id)?.delayMs(this.clock.offset) ?? START_DELAY_MS;
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
    this.parkour = false;
    this.closed = [];
    this.unavailable = false;
    this.host = null;
    // Sin límites hasta que el lugar diga los suyos en WELCOME: el punto de llegada (p. ej. una
    // isla del nexo) puede estar fuera del chunk.
    this.walk = [-Infinity, Infinity];
    this.entities = new Map();
    this.entitiesVersion++;
    this.peers.clear();
    this.poseBuffers.clear();
    this.playouts.clear();
    chat.reset([]);
    activity.reset();
    this.bump();
  }

  apply(m: ServerMessage) {
    people.apply(m);
    switch (m.type) {
      case "WELCOME":
        this.sessionId = m.payload.session_id;
        this.chunkId = m.payload.chunk_id;
        this.canBuild = m.payload.principal.scopes.includes("build");
        this.solo = m.payload.solo === true;
        this.walk = m.payload.walk ?? [1, CHUNK_SIZE - 1];
        this.big = !this.solo && (this.walk[0] < 0 || this.walk[1] > CHUNK_SIZE);
        this.theme = m.payload.theme ?? null;
        this.parkour = m.payload.parkour === true;
        this.closed = m.payload.closed ?? [];
        // Otro lugar puede ser otro servidor (un nodo de la comunidad), con otro reloj.
        this.clock.reset(m.payload.server_time, performance.now());
        // El lugar puede ser otro (las entidades se colocan respecto a él).
        this.entitiesVersion++;
        this.bump();
        break;
      case "SNAPSHOT":
        this.snapshots++;
        chat.reset(m.payload.chat ?? []);
        this.entities = new Map(m.payload.entities.map((e) => [e.entity_id, e]));
        this.entitiesVersion++;
        this.peers = new Map(m.payload.peers.filter((p) => p.session_id !== this.sessionId).map((p) => [p.session_id, p]));
        // Dónde estaba cada uno al llegar: una muestra de ahora, que no dice nada de cada cuánto manda.
        for (const p of m.payload.poses) this.pushPose(p, this.serverNow(), performance.now(), false);
        this.bump();
        break;
      case "DELTA":
        for (const c of m.payload.changes) {
          if (c.kind === "upsert") this.entities.set(c.entity.entity_id, c.entity);
          else this.entities.delete(c.entity_id);
        }
        this.entitiesVersion++;
        this.bump();
        break;
      case "POSES": {
        const now = performance.now();
        this.clock.sample(m.payload.t, now);
        // Con la página atascada (o sin dibujar: otra pestaña), lo que han tardado no es cosa de la red.
        const counts = now - this.frameAt < STALLED_MS;
        // Cada muestra, con la hora en que se tomó (`age` antes de la del lote; sin él, la del lote).
        for (const p of m.payload.poses) {
          if (p.session_id !== this.sessionId) this.pushPose(p, m.payload.t - (p.age ?? 0), now, counts);
        }
        break;
      }
      case "PEER_JOIN":
        if (m.payload.session_id !== this.sessionId) {
          this.peers.set(m.payload.session_id, m.payload);
          this.bump();
        }
        break;
      case "PEER_LEAVE":
        this.peers.delete(m.payload.session_id);
        this.poseBuffers.delete(m.payload.session_id);
        this.playouts.delete(m.payload.session_id);
        this.bump();
        break;
      case "CHAT_MSG":
        chat.add(m.payload);
        break;
      case "CHAT_REMOVED":
        chat.remove(m.payload.id);
        break;
      case "PROGRESS":
      case "COLLECTED":
      case "RACE":
      case "SCORES":
      case "TILES":
        activity.apply(m);
        break;
      case "ACK":
        if (m.payload.ref?.startsWith(SANDBOX_REF)) sandbox.ack(m.payload.ref, m.payload.entity_id);
        break;
      case "ERROR":
        // Los avisos de actividad (demasiado lejos, fuera de orden…), de gente y de la gente de las
        // ciudades (npc-store.ts) no son errores para el chat.
        if (m.payload.ref?.startsWith(ACTIVITY_REF)) {
          // Salvo el de «acabas de llegar»: ese lo enseña el HUD de actividades (activity-store.ts).
          activity.apply(m);
          break;
        }
        if (m.payload.ref?.startsWith(PEOPLE_REF) || m.payload.ref?.startsWith(NPC_REF)) break;
        // Cerrado por moderación mientras se estaba dentro (interruptores de emergencia): se apunta
        // para que el chat o la zona de pruebas lo enseñen sin esperar a volver a entrar.
        if ((m.payload.detail as { reason?: string } | undefined)?.reason === "closed") {
          const what = m.payload.ref?.startsWith(SANDBOX_REF) ? "sandbox" : "chat";
          if (!this.closed.includes(what)) this.closed = [...this.closed, what];
          if (what === "sandbox") sandbox.error(m.payload.ref!, "closed", m.payload.message);
          this.bump();
          break;
        }
        // Los de la zona de pruebas, a su panel.
        if (m.payload.ref?.startsWith(SANDBOX_REF)) {
          sandbox.error(m.payload.ref, m.payload.code, m.payload.message);
          break;
        }
        this.lastError = `${m.payload.code}: ${m.payload.message}`;
        console.warn("[xenxo]", this.lastError, m.payload.detail ?? "");
        if (m.payload.code === "rate_limited" || m.payload.code === "forbidden") chat.notice(m.payload.code);
        this.bump();
        break;
      default:
        break;
    }
  }

  private pushPose(p: AvatarPose, t: number, arrival: number, counts: boolean) {
    const id = p.session_id;
    let buf = this.poseBuffers.get(id);
    if (!buf) this.poseBuffers.set(id, (buf = []));
    const last = buf[buf.length - 1];
    // Las muestras de cada persona van en orden; una que no avanza (dos con la misma hora) sustituye a la anterior.
    if (last && t <= last.t) {
      if (t < last.t - 2000) {
        // Su hora ha vuelto atrás de verdad (otro reloj): se empieza de nuevo.
        buf.length = 0;
        this.playouts.delete(id);
      } else t = last.t + 1;
    }
    const moved = !last || last.emote !== p.emote || last.vehicle !== p.vehicle || changed(last.head, p.head) || (!!p.car && (!last.car || changed(last.car, p.car)));
    let play = this.playouts.get(id);
    if (!play) this.playouts.set(id, (play = new PeerPlayout()));
    play.push(t, arrival, moved, counts);
    buf.push({ t, head: p.head, emote: p.emote, vehicle: p.vehicle, car: p.car, weapon: p.weapon });
    if (buf.length > BUFFER) buf.shift();
  }
}

/** ¿Ha cambiado la pose de una muestra a otra (más de un centímetro o un giro que se vea)? */
function changed(a: AvatarPose["head"], b: AvatarPose["head"]): boolean {
  const dx = a.p[0] - b.p[0], dy = a.p[1] - b.p[1], dz = a.p[2] - b.p[2];
  if (dx * dx + dy * dy + dz * dz > 1e-4) return true;
  const dot = a.r[0] * b.r[0] + a.r[1] * b.r[1] + a.r[2] * b.r[2] + a.r[3] * b.r[3];
  // Los giros viajan con cuatro decimales: por debajo de un par de grados no se distingue de un redondeo.
  return Math.abs(dot) < 0.9998;
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
export function useUnavailable() {
  return useSyncExternalStore(world.subscribe, () => world.unavailable);
}

export function useWorldVersion() {
  return useSyncExternalStore(world.subscribe, world.getVersion);
}
