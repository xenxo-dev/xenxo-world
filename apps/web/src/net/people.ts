/**
 * Lo que una persona hace con la gente de alrededor (§9 octies): reaccionar, proponer o contestar
 * una acción en pareja, activar el modo pelea y golpear. Solo pide: el servidor comprueba la
 * cercanía, el ritmo y el consentimiento. Sin Three.js (lo usa el HUD).
 */
import { FIGHT_REACH, msg, PAIR_RANGE, type ClientMessage, type FightMove, type PairAction, type Reaction } from "@xenxo/protocol";
import { self } from "../world/self";
import { people, PEOPLE_REF } from "./people-store";
import { net } from "./session";
import { world } from "./world-store";

// Al entrar en un lugar con pelea, se vuelve a pedir el modo pelea si estaba activado.
net.onMessage((m) => {
  if (m.type === "WELCOME") resumeFight();
});

let seq = 0;
const ref = (action: string) => `${PEOPLE_REF}${action}-${++seq}`;
const send = (type: string, payload: unknown, action: string) => net.send(msg(type, payload, { id: ref(action) }) as unknown as ClientMessage);

/** Dónde está cada uno según su última pose (los pies). */
function latest(id: string): [number, number, number] | null {
  const buf = world.poseBuffers.get(id);
  const s = buf?.[buf.length - 1];
  if (!s || world.serverNow() - s.t > 3000) return null;
  return [s.head.p[0]!, s.head.p[1]! - 1.6, s.head.p[2]!];
}

/** ¿Hay alguien con el modo pelea a menos de `range` m? (Entonces la pose se manda más seguido.) Sin objetos nuevos. */
export function fighterNear(range: number): boolean {
  if (people.fighters.size === 0) return false;
  const now = world.serverNow();
  for (const id of people.fighters) {
    const buf = world.poseBuffers.get(id);
    const s = buf?.[buf.length - 1];
    if (!s || now - s.t > 3000) continue;
    const dx = s.head.p[0] - self.x, dz = s.head.p[2] - self.z;
    if (dx * dx + dz * dz < range * range) return true;
  }
  return false;
}

/**
 * La persona más cercana a menos de `range` m (y, si `cone`, delante: dentro de ese ángulo a cada
 * lado de hacia donde miras). `only` filtra quién vale.
 */
export function nearestPerson(range: number, cone = Math.PI, only?: (id: string) => boolean): { id: string; d: number } | null {
  const fx = -Math.sin(self.yaw), fz = -Math.cos(self.yaw);
  let best: { id: string; d: number } | null = null;
  for (const id of world.peers.keys()) {
    if (only && !only(id)) continue;
    const p = latest(id);
    if (!p) continue;
    const dx = p[0] - self.x, dz = p[2] - self.z;
    const d = Math.hypot(dx, dz);
    if (d > range || Math.abs(p[1] - self.y) > 1.2) continue;
    if (d > 0.3 && Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) > cone) continue;
    if (!best || d < best.d) best = { id, d };
  }
  return best;
}

export function displayName(id: string): string {
  return world.peers.get(id)?.display_name ?? "?";
}

export function react(kind: Reaction) {
  if (world.solo) return;
  send("REACT", { kind }, "react");
}

/**
 * La gente de las ciudades (world/city/citizens.ts) se apunta aquí: sin nadie cerca, la propuesta
 * va a quien tengas delante de ella (contesta en el momento). Así esto sigue sin Three.js.
 */
export const npcPair = { offer: null as ((kind: PairAction) => boolean) | null };

/** Propone `kind` a quien tengas más cerca (delante). Devuelve false si no hay nadie. */
export function offerPair(kind: PairAction): boolean {
  const who = nearestPerson(PAIR_RANGE, Math.PI * 0.75);
  if (!who) {
    if (npcPair.offer?.(kind)) return true;
    people.setNotice("people.err.nobody");
    return false;
  }
  send("PAIR", { to: who.id, kind }, "pair");
  people.setNotice("people.pair.sent");
  return true;
}

export function answerPair(from: string, kind: PairAction, yes: boolean) {
  people.dropOffer(from);
  send("PAIR", { to: from, kind, answer: yes }, "pair");
}

/** El modo pelea es tuyo: se mantiene al cambiar de distrito (donde se pueda) y nunca se guarda. */
export function setFight(on: boolean) {
  people.fightOn = on;
  if (people.style) send("FIGHT", { on }, "fight");
  people.setNotice(on ? "people.fight.on" : "people.fight.off");
}

/** Tras entrar en un lugar con pelea, se vuelve a pedir si estaba activado. */
export function resumeFight() {
  if (people.fightOn && people.style) send("FIGHT", { on: true }, "fight");
}

let lastAttack = 0;
/**
 * ¿Se puede golpear ahora con `move`? (modo pelea activo, el estilo del lugar lo permite y no muy
 * seguido). Si sí, cuenta como golpe dado (para el ritmo).
 */
export function canAttack(move: FightMove): boolean {
  if (!people.fightOn || !people.style || isDown()) return false;
  if (people.style === "shove" && move !== "shove") {
    people.setNotice("people.err.onlyShove");
    return false;
  }
  const now = performance.now();
  if (now - lastAttack < 650) return false;
  lastAttack = now;
  return true;
}

/** A quién va un golpe: quien esté en modo pelea más cerca, delante y a su alcance (con algo de margen para acercarse). */
export function fightTarget(move: FightMove, extra = 0.6): { id: string; d: number } | null {
  return nearestPerson(FIGHT_REACH[move] + extra, Math.PI * 0.42, (id) => people.fighters.has(id));
}

let lastHit = 0;
/**
 * ¿Se puede mandar ya un golpe? El servidor admite uno cada 600 ms; como cada golpe llega en un
 * momento distinto de su animación, dos seguidos pueden quedar más juntos que al pulsar.
 */
export function hitReady(): boolean {
  return performance.now() - lastHit >= 620;
}
/** El golpe llega: se manda al servidor (que comprueba alcance, ritmo y consentimiento). */
export function sendHit(to: string, move: FightMove) {
  lastHit = performance.now();
  send("HIT", { to, move }, "hit");
}

/** ¿Está esta persona fuera de combate? (la vida a 0, hasta que reaparece: después también, mientras espera). */
export function isDown(id: string | null = world.sessionId): boolean {
  return !!id && people.downUntil(id) > 0;
}

/** Tras quedar fuera de combate: volver con toda la vida (el servidor lo deja pasado su tiempo). */
export function sendRespawn() {
  send("RESPAWN", {}, "respawn");
}
