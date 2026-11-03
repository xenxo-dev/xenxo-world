/**
 * La gente de las ciudades, compartida (§9 nonies del protocolo): el servidor elige una sesión del
 * distrito (`NPC_HOST`) que mueve a los ciudadanos y reparte su estado (`NPC_STATE`); los demás los
 * dibujan con ese estado y le mandan lo que les hacen (golpes, atropellos, acciones en pareja). La
 * gente de las salas no se mueve: lo que se le hace se reparte a quien esté cerca.
 *
 * Aquí, la parte de la red (sin Three.js): quién los lleva, los estados que llegan, lo que hay que
 * contarle a quien los lleva y lo que se manda. La ciudad (world/city/citizens.ts) lo usa por
 * `npcLink`; la gente de las salas (world/Interiors.tsx), por `resHits` y `sendResHit`.
 */
import { msg, type ClientMessage, type NpcSnap, type PairAction } from "@xenxo/protocol";
import type { CityLink, NpcEvent, NpcStateIn } from "../world/city/citizens";
import { net } from "./session";
import { NPC_REF, world } from "./world-store";

/** Cuántos estados se guardan (a 4 por segundo, dos segundos: de sobra para dibujar con retraso). */
const MAX_STATES = 8;

/** Golpe de alguien a una persona de una sala (`res`: su índice en district-interiors.json). */
export interface ResHit {
  res: number;
  dir: [number, number];
  power: number;
  head: boolean;
}

export const npc = {
  /** Quién lleva ahora a los ciudadanos de este lugar (null: nadie). */
  host: null as string | null,
  states: [] as NpcStateIn[],
  events: [] as NpcEvent[],
  /** Golpes a la gente de las salas que han dado los demás (los recoge Interiors). */
  resHits: [] as ResHit[],
};

function reset() {
  npc.host = null;
  npc.states.length = 0;
  npc.events.length = 0;
  npc.resHits.length = 0;
}

let seq = 0;
const send = (type: string, payload: unknown) => net.send(msg(type, payload, { id: `${NPC_REF}${++seq}` }) as unknown as ClientMessage);

net.onMessage((m) => {
  switch (m.type) {
    case "WELCOME":
      reset();
      // Si esta pestaña ya está en segundo plano al entrar, que no la elijan.
      if (typeof document !== "undefined" && document.hidden) send("NPC_HOSTING", { on: false });
      break;
    case "NPC_HOST":
      npc.host = m.payload.session_id;
      break;
    case "NPC_STATE": {
      const list = npc.states;
      // En orden (llegan en orden; por si acaso, uno más viejo que el último se descarta).
      if (list.length && m.payload.t <= list[list.length - 1]!.t) break;
      list.push(m.payload);
      if (list.length > MAX_STATES) list.shift();
      break;
    }
    case "NPC_HIT_EVENT": {
      const p = m.payload;
      if (p.res !== undefined) npc.resHits.push({ res: p.res, dir: p.dir, power: p.power, head: !!p.head });
      else if (p.npc !== undefined) npc.events.push({ kind: "hit", from: p.from, npc: p.npc, dir: p.dir, power: p.power, head: !!p.head, hit: p.kind, pair: "high_five" });
      if (npc.resHits.length > 16) npc.resHits.shift();
      if (npc.events.length > 32) npc.events.shift();
      break;
    }
    case "NPC_PAIR_EVENT":
      npc.events.push({ kind: "pair", from: m.payload.from, npc: m.payload.npc, dir: [0, 0], power: 0, head: false, hit: "hit", pair: m.payload.kind });
      if (npc.events.length > 32) npc.events.shift();
      break;
  }
});
net.onStatus((s) => {
  if (s !== "open") reset();
});

// Una pestaña en segundo plano no anima (y no podría llevarlos): se aparta y el servidor elige a otra.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (world.status === "open" && world.sessionId && !world.solo) send("NPC_HOSTING", { on: !document.hidden });
  });
}

/** Le has dado a alguien de una sala (lo ven caer los de cerca). */
export function sendResHit(res: number, dx: number, dz: number, power: number, head: boolean, kind: "hit" | "car" | "bump") {
  if (world.status !== "open" || world.solo) return;
  send("NPC_HIT", { res, dir: [round(dx), round(dz)], power: round(Math.min(30, power)), ...(head ? { head: true } : {}), kind });
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Lo que la ciudad necesita de la red. */
export const npcLink: CityLink = {
  role() {
    if (world.status !== "open" || world.solo || !world.sessionId || !npc.host) return "local";
    return npc.host === world.sessionId ? "host" : "replica";
  },
  now: () => world.serverNow(),
  me: () => world.sessionId,
  others: () => world.peers.size,
  publish(cast: NpcSnap[]) {
    send("NPC_STATE", { t: world.serverNow(), cast });
  },
  nextEvent: () => npc.events.shift() ?? null,
  states: () => npc.states,
  hit(i: number, dx: number, dz: number, power: number, head: boolean, kind: "hit" | "car" | "bump") {
    send("NPC_HIT", { npc: i, dir: [round(dx), round(dz)], power: round(Math.min(30, power)), ...(head ? { head: true } : {}), kind });
  },
  pair(i: number, kind: PairAction) {
    send("NPC_PAIR", { npc: i, kind });
  },
};
