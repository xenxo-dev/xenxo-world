/**
 * Prueba de las carreras de salida conjunta (el Gran Premio Neón de Arcade), sin navegador:
 *
 *  1. La cuenta del servidor (apps/realtime/src/rounds.ts): parrilla y cajones, la salida, las
 *     puertas en orden, las vueltas, la clasificación y cuándo se acaba.
 *  2. Lo que enseña el cliente (src/net/round.ts): qué ronda manda, la espera en la parrilla y el
 *     semáforo.
 *  3. Una carrera entera con el coche de verdad (Rapier) sobre la pista tal como se sirve —el GLB
 *     empaquetado, en su nivel ligero, que es con el que se choca— pasando por las puertas del
 *     servidor con sus reglas de cercanía. Y que el looping se da también entrando despacio o
 *     pegado a un lado, que el salto llega al otro lado y que el coche va solo a su cajón.
 *
 *   npm run test:race -w @xenxo/web
 */
import { readFileSync, writeFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { near, NEAR_SLACK } from "../../realtime/src/activities.ts";
import {
  dropIdle, joinRound, minRoundMs, nextGate, passGate, roundOver, standings, startRound,
  ROUND_AFTER_MS, ROUND_COUNTDOWN_MS, ROUND_IDLE_MS, ROUND_JOIN_MS, ROUND_MAX_MS, ROUND_OPEN_MAX_MS, type Round,
} from "../../realtime/src/rounds.ts";
import { SEED_ASSETS } from "../../realtime/src/seed-assets.ts";
import { crashWith, gridHold, myRun, nextRound, PODIUM_MS, startLights, stillRacing, type RoundPayload, type RoundState } from "../src/net/round.ts";
import { CarSim, loadRapier, type StaticSource } from "../src/world/vehicle/physics.ts";
import { ghostPose, rivalGap, setRivalLap, soloRival, type GhostLap } from "../src/net/house-rival.ts";

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};
const r1 = (v: number) => Math.round(v * 10) / 10;
const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

/* ------------------------------------------------------------------ */
/* 1) La cuenta del servidor                                           */
/* ------------------------------------------------------------------ */
console.log("Rondas (servidor):");
{
  const rounds: Round[] = [];
  let seq = 0;
  const make = (slots = 8) => () => ({ id: ++seq, key: "system:gp", race: "gp", owner: "system", laps: 2, perLap: 3, minMs: 6000, slots });
  const who = (n: number) => ({ session_id: `s${n}`, sub: `u${n}`, ranked: n % 2 === 0, name: `P${n}` });
  const t0 = 1_000_000;
  const a = joinRound(rounds, make(), who(1), t0)!;
  check(a.state === "countdown" && a.goAt === t0 + ROUND_COUNTDOWN_MS && a.entrants.get("s1")!.slot === 0, "el primero abre la ronda, con su cuenta atrás, y se queda la pole");
  const again = joinRound(rounds, make(), who(1), t0 + 500)!;
  check(again === a && a.entrants.size === 1 && a.goAt === t0 + ROUND_COUNTDOWN_MS, "volver a avisar desde la parrilla no cambia nada");
  joinRound(rounds, make(), who(2), t0 + 1000);
  check(a.entrants.get("s2")!.slot === 1 && a.goAt === t0 + ROUND_COUNTDOWN_MS, "el segundo, el cajón siguiente; con tiempo de sobra, la salida no se mueve");
  joinRound(rounds, make(), who(3), t0 + ROUND_COUNTDOWN_MS - 500);
  check(a.goAt === t0 + ROUND_COUNTDOWN_MS - 500 + ROUND_JOIN_MS, "quien llega justo retrasa la salida para verla venir");
  // Alguien se va de la parrilla: su cajón queda libre para el siguiente.
  a.entrants.delete("s2");
  joinRound(rounds, make(), who(4), t0 + ROUND_COUNTDOWN_MS);
  check(a.entrants.get("s4")!.slot === 1, "un cajón que queda libre se vuelve a dar");
  for (let n = 5; n <= 9; n++) joinRound(rounds, make(), who(n), t0 + ROUND_COUNTDOWN_MS + 100 * n);
  check(a.entrants.size === 8 && new Set([...a.entrants.values()].map((e) => e.slot)).size === 8, "ocho cajones, ocho coches, cada uno en el suyo");
  check(joinRound(rounds, make(), who(10), t0 + ROUND_COUNTDOWN_MS + 2000) === null && rounds.length === 1, "con la parrilla llena no cabe nadie más (ni se abre otra)");
  check(a.goAt <= a.openedAt + ROUND_OPEN_MAX_MS, "la salida nunca se retrasa más de lo que dice el tope");

  // La salida: quien no está en su sitio se queda fuera.
  const go = a.goAt;
  check(passGate(a, "s1", 0, go - 10) === null, "antes de la salida no cuenta ninguna puerta");
  check(startRound(a, (sid) => sid !== "s9") && a.state === "running" && a.entrants.get("s9")!.out === true, "en la salida, quien no está en la parrilla se queda fuera");
  // Con la ronda en marcha, la parrilla siguiente es otra ronda.
  const b = joinRound(rounds, make(), who(10), go + 100)!;
  check(b !== a && b.state === "countdown" && rounds.length === 2, "con una ronda en marcha, la parrilla forma la siguiente");

  // Puertas: en orden, dos vueltas de dos puntos y meta.
  check(nextGate(0, 3) === 0 && nextGate(1, 3) === 1 && nextGate(2, 3) === "finish" && nextGate(3, 3) === 0, "las puertas de cada vuelta: sus puntos y la meta");
  check(passGate(a, "s1", 1, go + 1500) === null && passGate(a, "s1", "finish", go + 1500) === null, "una puerta que no toca no cuenta");
  check(passGate(a, "s1", 0, go + 1500) === "pass" && a.entrants.get("s1")!.gates === 1, "la que toca, sí");
  check(passGate(a, "s9", 0, go + 1500) === null, "quien está fuera no pasa puertas");
  // Demasiado rápido: imposible (minMs = 6 s para 6 puertas → 1 s por puerta).
  check(passGate(a, "s3", 0, go + 200) === null && a.entrants.get("s3")!.out === true, "más rápido de lo posible: fuera");
  const lap = (sid: string, from: number, step: number) => {
    let t = from, last: string | null = null;
    for (;;) {
      const e = a.entrants.get(sid)!;
      if (e.ms !== undefined || e.out) return last;
      t += step;
      last = passGate(a, sid, nextGate(e.gates, a.perLap), t);
      if (last === null) return null;
    }
  };
  check(lap("s1", go + 1500, 1600) === "finish" && a.entrants.get("s1")!.ms === 1500 + 5 * 1600, "dos vueltas completas: llega, con su tiempo desde la salida");
  check(a.firstMs === 9500, "queda apuntado cuándo llegó el primero");
  passGate(a, "s4", 0, go + 2000);
  passGate(a, "s4", 1, go + 4000);
  passGate(a, "s5", 0, go + 1800);
  passGate(a, "s5", 1, go + 4200);
  passGate(a, "s6", 0, go + 3000);
  const order = standings(a).map((e) => e.session_id);
  check(order[0] === "s1" && order[1] === "s4" && order[2] === "s5" && order[3] === "s6", "clasificación: quien ha llegado, y después más puertas y antes");
  check(order.slice(-2).every((sid) => a.entrants.get(sid)!.out), "los que están fuera, al final");
  check(!roundOver(a, go + 12_000), "con gente corriendo, sigue");
  // Quien se queda en la parrilla (s7 y s8 no han pasado ni una puerta) acaba fuera; quien corre, no.
  check(!dropIdle(a, go + ROUND_IDLE_MS - 1) && dropIdle(a, go + ROUND_IDLE_MS + 1), "quien no sale de la parrilla en un buen rato se queda fuera");
  check(a.entrants.get("s7")!.out === true && a.entrants.get("s8")!.out === true && !a.entrants.get("s6")!.out && !dropIdle(a, go + ROUND_IDLE_MS + 2), "solo quien no ha pasado ni una puerta, y una vez");
  check(roundOver(a, go + 9500 + ROUND_AFTER_MS + 1), "tras llegar el primero, los demás tienen un tiempo y se acaba");
  const c: Round = { ...make()(), state: "running", openedAt: 0, goAt: 0, entrants: new Map([["x", { ...who(1), gates: 0 }]]) };
  check(!roundOver(c, ROUND_MAX_MS - 1) && roundOver(c, ROUND_MAX_MS + 1), "y ninguna dura más de su tope");
  c.entrants.get("x")!.out = true;
  check(roundOver(c, 10), "sin nadie corriendo, se acaba");
  check(minRoundMs([[0, 0, 0], [400, 0, 0], [400, 0, 400], [0, 0, 400]], 2) === 80_000, "lo mínimo que puede durar: las rectas entre puertas, a tope, por sus vueltas");
  check(minRoundMs([[0, 0, 0], [70, 0, 0]], 1, 14) === 10_000, "y a pie, a lo que se corre a pie");
}

/* ------------------------------------------------------------------ */
/* 2) Lo que enseña el cliente                                         */
/* ------------------------------------------------------------------ */
console.log("Rondas (cliente):");
{
  const ent = (id: string, gates = 0, extra: Partial<RoundPayload["entrants"][number]> = {}) => ({ session_id: id, name: id, gates, ...extra });
  const pay = (round: number, state: RoundPayload["state"], entrants: RoundPayload["entrants"], go_at = 10_000): RoundPayload =>
    ({ race: "gp", owner: "system", round, state, now: 0, go_at, laps: 2, per_lap: 12, entrants });
  let r: RoundState | null = null;
  r = nextRound(r, pay(1, "countdown", [ent("yo", 0, { slot: 0 }), ent("otro", 0, { slot: 1 })]), "yo", 100);
  check(r.mine && r.live, "estoy en la parrilla: es mi ronda");
  // Con qué coches choco: fuera de carrera, con cualquiera; en la parrilla, con nadie; corriendo, con quienes corren.
  check(crashWith(null) === "all" && crashWith(r) === "none", "los coches: fuera de carrera chocan todos; en la parrilla, ninguno");
  check(gridHold(r, 9_999, 200) && !gridHold(r, 10_000, 200), "el coche espera hasta la hora de salida, ni un momento más");
  check(startLights(r, 2_000, 200).red === 0 && startLights(r, 5_001, 200).red === 1 && startLights(r, 9_100, 200).red === 5, "semáforo: una roja más cada segundo; las cinco en el último");
  check(startLights(r, 10_500, 200).green && !startLights(r, 12_500, 200).green, "verde en la salida, un par de segundos");
  // Otra ronda (de otros) no me quita la mía.
  const other = nextRound(r, pay(2, "countdown", [ent("z")]), "yo", 300);
  check(other.round === 1, "la parrilla siguiente, de otros, no tapa la mía");
  r = nextRound(r, pay(1, "running", [ent("otro", 3), ent("yo", 2)]), "yo", 400);
  const run = myRun(r, "yo")!;
  check(run.next === 3 && run.total === 11 && run.lap === 1 && run.place === 2 && run.of === 2, "en carrera: la puerta que toca, la vuelta y el puesto");
  check(!gridHold(r, 20_000, 500), "en carrera no se espera");
  {
    const mid = nextRound(r, pay(1, "running", [ent("otro", 3), ent("yo", 2), ent("fuera", 0, { out: true }), ent("llegado", 24, { ms: 70_000 })]), "yo", 450);
    const who = crashWith(mid);
    check(Array.isArray(who) && stillRacing(who, "otro") && !stillRacing(who, "fuera") && !stillRacing(who, "llegado") && !stillRacing(who, "paseante"), "corriendo, solo choco con quienes siguen en mi carrera");
  }
  r = nextRound(r, pay(1, "running", [ent("otro", 13), ent("yo", 11)]), "yo", 500);
  check(myRun(r, "yo")!.next === 12 && myRun(r, "yo")!.lap === 1, "tras los puntos de la vuelta toca la meta");
  r = nextRound(r, pay(1, "running", [ent("otro", 14), ent("yo", 12)]), "yo", 600);
  check(myRun(r, "yo")!.next === 1 && myRun(r, "yo")!.lap === 2, "y después, la segunda vuelta");
  r = nextRound(r, pay(1, "running", [ent("yo", 24, { ms: 80_000 }), ent("otro", 20)]), "yo", 700);
  check(r.mine && !r.live && myRun(r, "yo") === null, "he llegado: ya no corro, pero la ronda sigue siendo la mía");
  check(crashWith(r) === "all", "y vuelvo a chocar con cualquiera");
  check(nextRound(r, pay(3, "countdown", [ent("z")]), "yo", 800).round === 1, "mientras los demás acaban, veo cómo van");
  const joined = nextRound(r, pay(3, "countdown", [ent("z"), ent("yo")]), "yo", 900);
  check(joined.round === 3 && joined.live, "si me pongo en la parrilla siguiente, manda esa");
  r = nextRound(r, pay(1, "done", [ent("yo", 24, { ms: 80_000 }), ent("otro", 24, { ms: 84_000 })]), "yo", 1000);
  check(nextRound(r, pay(4, "running", [ent("z", 5)]), "yo", 1000 + PODIUM_MS - 1).round === 1, "la clasificación se queda a la vista un rato");
  check(nextRound(r, pay(4, "running", [ent("z", 5)]), "yo", 1000 + PODIUM_MS + 1).round === 4, "y después deja sitio a lo que haya");
  // Mirando sin correr: la que se forma es a la que se puede entrar.
  let w: RoundState | null = nextRound(null, pay(7, "running", [ent("a", 3)]), "yo", 0);
  check(!w.mine && nextRound(w, pay(8, "countdown", [ent("b")]), "yo", 100).round === 8, "quien mira ve antes la parrilla que se forma que una carrera en marcha");
  w = nextRound(w, pay(8, "countdown", [ent("b")]), "yo", 100);
  check(nextRound(w, pay(7, "running", [ent("a", 4)]), "yo", 200).round === 8, "y no va saltando de una a otra");
  check(startLights(w, 9_500, 200).red === 5, "el semáforo lo ve todo el mundo");
  // Me sacan de la parrilla (llegué de un salto): dejo de esperar.
  let k: RoundState | null = nextRound(null, pay(9, "countdown", [ent("yo")]), "yo", 0);
  k = nextRound(k, pay(9, "countdown", [ent("b")]), "yo", 50);
  check(!k.mine && !gridHold(k, 0, 60), "si salgo de la parrilla, el coche deja de esperar");
}

/* ------------------------------------------------------------------ */
/* 3) Una carrera de verdad                                            */
/* ------------------------------------------------------------------ */
console.log("El Gran Premio Neón, con el coche de verdad:");

interface Race { id: string; radius: number; laps: number; start: { p: number[]; radius: number; yaw: number }; grid: number[][]; cps: number[][]; finish: { p: number[]; radius: number } }
const acts = json("../../realtime/src/district-activities.json").arcade;
const race: Race = acts.races.find((r: Race) => r.id === "gp");
const prop = acts.props.find((p: { piece: string }) => p.piece === "arcade_circuit");
const track: { length: number; marks: Record<string, number>; turbos: number[]; line: [number, number, number, number, string][] } = json("./circuit-line.json");

/** La malla de la pista como la carga el juego: el nivel más ligero de su modelo, en metros del lugar. */
async function trackMesh(): Promise<Float32Array> {
  const lods = SEED_ASSETS["arcade_circuit"]!.lods;
  const file = readFileSync(new URL(`../../realtime/seed-assets/s/${lods[lods.length - 1]!.hash.split(":")[1]}.glb`, import.meta.url));
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(file));
  const out: number[] = [];
  const v = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")!, idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i < n; i++) {
        pos.getElement(idx ? idx.getScalar(i) : i, v);
        out.push(
          m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]! + m[12]! + prop.p[0],
          m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]! + m[13]! + prop.p[1],
          m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]! + m[14]! + prop.p[2],
        );
      }
    }
  }
  return new Float32Array(out);
}

const positions = await trackMesh();
check(positions.length / 9 > 5000 && positions.length / 9 < 20_000, `la pista se carga como malla de colisión (${positions.length / 9} triángulos, menos de 20 000)`);
const source: StaticSource = {
  version: () => 1,
  // El suelo del distrito.
  boxes: (cb) => cb({ x: 32, y: -0.3, z: 32, hx: 128, hy: 0.3, hz: 128, c: 1, s: 0 }),
  meshes: (cb) => cb("pista", positions, null),
  bounds: () => [-96, 160],
};
const R = await loadRapier();
const sim = new CarSim(R, source);
const st = sim.state;
const L = track.length;

/** Punto de la línea central a `s` metros de la meta, y su tramo. */
function at(s: number): [number, number, number] {
  s = ((s % L) + L) % L;
  let lo = 0, hi = track.line.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (track.line[m]![3] < s) lo = m + 1;
    else hi = m;
  }
  const b = track.line[lo]!, a = track.line[Math.max(0, lo - 1)]!;
  const k = b[3] > a[3] ? (s - a[3]) / (b[3] - a[3]) : 0;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
function zoneAt(s: number): string {
  s = ((s % L) + L) % L;
  for (const f of track.line) if (f[3] >= s) return f[4];
  return "road";
}
/** Por dónde va el coche (metros de pista), buscando cerca de donde iba. */
function progress(prev: number): number {
  let best = prev, bd = Infinity;
  for (let d = -6; d <= 30; d += 0.5) {
    const p = at(prev + d);
    const dd = (p[0] - st.x) ** 2 + (p[1] - st.y) ** 2 + (p[2] - st.z) ** 2;
    if (dd < bd) {
      bd = dd;
      best = prev + d;
    }
  }
  return best;
}
/** El metro de pista más cercano a un punto (para saber dónde está la parrilla en la línea). */
function nearestS(x: number, z: number): number {
  let best = 0, bd = Infinity;
  for (const f of track.line) {
    const dd = (f[0] - x) ** 2 + (f[2] - z) ** 2 + f[1] * f[1] * 4;
    if (dd < bd) {
      bd = dd;
      best = f[3];
    }
  }
  return best;
}
/** Un paso del piloto automático: sigue la línea, frena para las curvas y pisa las placas de turbo. */
const turboAt = new Map<number, number>();
function autopilot(s: number, t: number, opts: { slow?: number } = {}) {
  const v = Math.abs(st.speed);
  const look = at(s + 7 + v * 0.45);
  const dx = look[0] - st.x, dy = look[1] - st.y, dz = look[2] - st.z;
  const { qx, qy, qz, qw } = st;
  const lx = 1 - 2 * (qy * qy + qz * qz), ly = 2 * (qx * qy + qw * qz), lz = 2 * (qx * qz - qw * qy);
  const fx = 2 * (qx * qz + qw * qy), fy = 2 * (qy * qz - qw * qx), fz = 1 - 2 * (qx * qx + qy * qy);
  const side = dx * lx + dy * ly + dz * lz, ahead = dx * fx + dy * fy + dz * fz;
  const steer = Math.max(-1, Math.min(1, -Math.atan2(side, Math.max(1, ahead)) * 2.2));
  const zn = [zoneAt(s + 8), zoneAt(s + 8 + v * 0.9), zoneAt(s + 8 + v * 1.6)];
  const want = Math.min(opts.slow ?? 99, zn.includes("curve") ? 23 : zn.includes("chicane") ? 25 : 99);
  const throttle = v > want + 1 ? -0.6 : v > want ? 0 : 1;
  const sl = ((s % L) + L) % L;
  if (!opts.slow) for (const ts of track.turbos) if (sl >= ts - 2 && sl <= ts + 4 && t - (turboAt.get(ts) ?? -9) > 3 && sim.turbo()) turboAt.set(ts, t);
  sim.update(1 / 60, { throttle, steer, handbrake: false });
}
const settle = (secs = 1) => {
  for (let i = 0; i < secs * 60; i++) sim.update(1 / 60, { throttle: 0, steer: 0, handbrake: true });
};

// a) La parrilla: cajones en llano, dentro del círculo de salida, y el coche va solo al suyo.
{
  const far = Math.max(...race.grid.map((g) => Math.hypot(g[0]! - race.start.p[0]!, g[2]! - race.start.p[2]!)));
  check(race.grid.length === 8 && far <= race.start.radius, `ocho cajones, todos dentro del círculo de salida (el más lejano, a ${r1(far)} m del centro)`);
  // Sale de un cajón de atrás, torcido, y va a la pole.
  const from = race.grid[7]!, to = race.grid[0]!;
  const yaw = ((race.start.yaw + 180) * Math.PI) / 180;
  sim.spawn(from[0]! - 2, from[1]! + 0.1, from[2]! + 0.8, yaw + 0.5);
  settle();
  let hop = 0, done = false, t = 0;
  for (; t < 4 && !done; t += 1 / 60) {
    const bx = st.x, bz = st.z;
    done = sim.slide(to[0]!, to[2]!, yaw, 1 / 60);
    sim.update(1 / 60, { throttle: 0, steer: 0, handbrake: true });
    hop = Math.max(hop, Math.hypot(st.x - bx, st.z - bz) * 60);
  }
  settle(0.5);
  const carYaw = Math.atan2(2 * (st.qw * st.qy + st.qx * st.qz), 1 - 2 * (st.qy * st.qy + st.qx * st.qx));
  const off = Math.hypot(st.x - to[0]!, st.z - to[2]!);
  let dyaw = carYaw - yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  console.log(`  parrilla: al cajón en ${r1(t)} s, a ${r1(hop)} m/s como mucho; queda a ${off.toFixed(2)} m y ${Math.abs(dyaw).toFixed(3)} rad; ruedas ${st.contacts}`);
  check(done && off < 0.15 && Math.abs(dyaw) < 0.05, "el coche va solo a su cajón y queda recto");
  check(hop < 40, "sin pasar de lo que el servidor da por un movimiento posible (40 m/s)");
  check(st.contacts === 4 && Math.abs(st.speed) < 0.3, "y se queda quieto sobre sus cuatro ruedas");
  // Con dos frames por segundo (un equipo que va a tirones): llega igual, mucho antes de la salida.
  sim.spawn(from[0]! - 2, from[1]! + 0.1, from[2]! + 0.8, yaw + 0.5);
  settle();
  let slow = 0, hop2 = 0, done2 = false;
  for (; slow < ROUND_JOIN_MS / 1000 && !done2; slow += 0.5) {
    const bx = st.x, bz = st.z;
    done2 = sim.slide(to[0]!, to[2]!, yaw, 0.5);
    for (let i = 0; i < 6; i++) sim.update(1 / 60, { throttle: 0, steer: 0, handbrake: true });
    hop2 = Math.max(hop2, Math.hypot(st.x - bx, st.z - bz) / 0.5);
  }
  settle(0.5);
  const off2 = Math.hypot(st.x - to[0]!, st.z - to[2]!);
  console.log(`  a 2 frames por segundo: en su cajón en ${r1(slow)} s, a ${r1(hop2)} m/s como mucho; queda a ${off2.toFixed(2)} m`);
  check(done2 && off2 < 0.15 && hop2 < 40 && st.contacts === 4, "con muy pocos frames por segundo también llega a su cajón antes de la salida, sin saltos imposibles");
}

// b) La carrera: dos vueltas desde la pole, pasando por las puertas como las comprueba el servidor.
{
  const gates = [...race.cps.map((p) => ({ p, r: race.radius })), { p: race.finish.p, r: race.finish.radius }];
  const round: Round = {
    id: 1, key: "system:gp", race: "gp", owner: "system", state: "countdown", openedAt: 0, goAt: 0, laps: race.laps, perLap: gates.length,
    minMs: minRoundMs(gates.map((g) => g.p), race.laps), slots: race.grid.length, entrants: new Map([["yo", { session_id: "yo", sub: "u", ranked: true, name: "yo", slot: 0, gates: 0 }]]),
  };
  const pole = race.grid[0]!;
  // Lo que ve el servidor: la cabeza de quien conduce (sobre el coche); el cliente avisa con su sitio.
  const head = () => [st.x, st.y + 1.6, st.z];
  check(startRound(round, () => near(head(), race.start.p, race.start.radius)), "desde su cajón, el servidor lo da por bien colocado en la salida");
  let s = nearestS(pole[0]!, pole[2]!), t = 0, air = 0, airMax = 0, impact = 0, top = { y: 0, v: 0 }, missed = "", lapMs: number[] = [];
  // Lo cerca que queda cada puerta del tope de velocidad del servidor (1 = justo en el tope).
  let tight = { ratio: Infinity, gate: 0 };
  const s0 = s;
  const speeds: Record<string, number> = {};
  const marks = Object.entries(track.marks).sort((a, b) => a[1] - b[1]);
  turboAt.clear();
  while (round.entrants.get("yo")!.ms === undefined && t < 240) {
    const v = Math.abs(st.speed);
    autopilot(s, t);
    t += 1 / 60;
    const ns = progress(s);
    for (const [name, ms] of marks) if (s - Math.floor(s / L) * L < ms && ns - Math.floor(s / L) * L >= ms) speeds[name] = r1(v);
    s = ns;
    if (st.contacts === 0) airMax = Math.max(airMax, (air += 1 / 60));
    else air = 0;
    impact = Math.max(impact, st.impact);
    if (st.y > top.y) top = { y: st.y, v };
    // El cliente avisa al entrar en el círculo de la puerta que le toca (como Activities.tsx)…
    const e = round.entrants.get("yo")!;
    const g = nextGate(e.gates, round.perLap);
    const gate = g === "finish" ? gates[gates.length - 1]! : gates[g]!;
    const dx = st.x - gate.p[0]!, dz = st.z - gate.p[2]!;
    if (dx * dx + dz * dz <= gate.r * gate.r && Math.abs(st.y - gate.p[1]!) <= 4 + gate.r) {
      // …y el servidor lo comprueba con la pose (aquí, la de ahora: sale justo antes del aviso).
      if (!near(head(), gate.p, gate.r)) missed ||= `puerta ${e.gates + 1}`;
      const res = passGate(round, "yo", g, t * 1000);
      if (res === null) missed ||= `puerta ${e.gates + 1} (${e.out ? "demasiado rápido" : "no cuenta"})`;
      else {
        const ratio = (t * 1000) / ((round.minMs * e.gates) / (round.laps * round.perLap));
        if (ratio < tight.ratio) tight = { ratio, gate: e.gates };
      }
      if (res && g === "finish") lapMs.push(t * 1000);
    }
  }
  const e = round.entrants.get("yo")!;
  console.log(`  carrera: ${r1(t)} s (vueltas: ${lapMs.map((x, i) => r1((x - (lapMs[i - 1] ?? 0)) / 1000)).join(" + ")} s), media ${Math.round(((s - s0) / t) * 3.6)} km/h; en el aire ${airMax.toFixed(2)} s como mucho; golpe más fuerte ${r1(impact)} m/s`);
  console.log(`  velocidades (m/s): ${Object.entries(speeds).map(([k, v]) => `${k} ${v}`).join(", ")}; en lo alto del looping (${r1(top.y)} m): ${r1(top.v)}`);
  check(e.ms !== undefined && !missed, `da las dos vueltas pasando por sus ${gates.length} puertas en orden${missed ? ` (falla: ${missed})` : ""}`);
  check(!e.out && e.ms !== undefined && e.ms > round.minMs * 1.2, `el servidor no lo echa por rápido (lo mínimo son ${r1(round.minMs / 1000)} s)`);
  check(tight.ratio > 1.3, `y ninguna puerta le queda cerca de ese tope (la más justa, la ${tight.gate}: tarda ${tight.ratio.toFixed(2)} veces lo mínimo hasta ella)`);
  check(t > 60 && t < 110, "dos vueltas en algo más de un minuto");
  check(top.y > 17 && top.v > 12, "pasa por lo alto del looping con velocidad para no caerse");
  check(airMax > 0.35 && airMax < 1.6, "vuela en el salto, y solo en el salto");
  check(impact < 12, "sin golpes fuertes (ni al pie del looping ni al caer del salto)");
  check(roundOver(round, t * 1000), "al llegar el único que corre, la ronda se acaba");
}

// c) El looping entrando despacio: la ayuda lo lleva hasta arriba y sale por el otro lado.
{
  const sFrom = track.marks.loop! - 22;
  const p0 = at(sFrom), p1 = at(sFrom + 2);
  sim.spawn(p0[0], p0[1], p0[2], Math.atan2(p1[0] - p0[0], p1[2] - p0[2]));
  settle();
  let s = sFrom, t = 0, top = 0, slowest = 99, climbed = false;
  turboAt.clear();
  while (s < track.marks.loop_end! + 4 && t < 30) {
    autopilot(s, t, { slow: 11 });
    t += 1 / 60;
    s = progress(s);
    top = Math.max(top, st.y);
    if (st.y > 6) climbed = true;
    if (climbed && st.y > 6) slowest = Math.min(slowest, Math.abs(st.speed));
  }
  console.log(`  looping despacio (a ${11} m/s): sale en ${r1(t)} s; llega a ${r1(top)} m; arriba no baja de ${r1(slowest)} m/s`);
  check(s >= track.marks.loop_end! && top > 17, "entrando a 40 km/h también da la vuelta entera");
  check(slowest > 10, "sin quedarse sin velocidad arriba (más de 9,4 m/s: no se cae)");
  check(st.contacts >= 3 && st.y < 1.5, "y sale rodando por el carril de dentro");
}

// d) Y después de ese looping lento, a fondo: pisando la placa de la rampa, el salto llega al otro lado.
{
  let s = track.marks.loop_end! + 4, t = 0, lip = 0, landed = false, sunk = false;
  const edge = at(track.marks.lip!)[0], land = at(track.marks.land! + 0.5)[0];
  const from = Math.abs(st.speed);
  turboAt.clear();
  while (s < track.marks.land! + 30 && t < 30) {
    const before = st.x;
    autopilot(s, t);
    t += 1 / 60;
    s = progress(s);
    if (before < edge && st.x >= edge) lip = Math.abs(st.speed);
    if (st.x > land + 4 && st.contacts >= 2 && st.y > 0.6) landed = true;
    if (st.x > edge + 1 && st.x < land - 0.5 && st.y < 0.9) sunk = true;
  }
  console.log(`  salto tras el looping lento: sale del looping a ${r1(from)} m/s y despega a ${r1(lip)} m/s; ${sunk ? "cae en la avenida" : "llega a la rampa de caída"}`);
  check(lip > 20 && landed && !sunk, "quien sale despacio del looping y acelera llega al otro lado del salto");
}

// e) Sin tocar el volante: entre por donde entre (pegado a un lado, por el centro), los quitamiedos
//    lo meten en el looping, lo llevan al otro carril y sale recto hacia el salto: cae al otro lado
//    y pasa por la meta y bajo el pórtico sin tocar nada. Con sus turbos, como en el juego. (Antes se
//    salía donde la pista se estrecha, o se enganchaba en un quitamiedos y se caía desde arriba; y
//    después salía del looping cruzado, rozaba el quitamiedos hasta el salto, caía sobre él y acababa
//    contra un poste de la meta.)
{
  const land = at(track.marks.land! + 6)[0];
  const lane = race.finish.p[2]!;
  const pads = (acts.boosts as { p: number[]; radius: number; circuit?: boolean }[]).filter((b) => b.circuit);
  const done: string[] = [], bad: string[] = [];
  let worst = { off: 0, yaw: 0, drop: 0 };
  for (const side of [1, 0.5, 0, -0.5, -1]) {
    const p0 = at(track.marks.loop! - 28);
    sim.spawn(p0[0], p0[1], p0[2] + side * 3.3, Math.PI / 2);
    settle();
    const inPad = new Set<number[]>();
    let t = 0, top = 0, slow = false, moving = false, landed = false, prev = 0, drop = 0, off = 0, wheels = 0;
    for (; t < 20 && st.x < 112; t += 1 / 60) {
      sim.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
      for (const b of pads) {
        const on = Math.hypot(st.x - b.p[0]!, st.z - b.p[2]!) <= b.radius && Math.abs(st.y - b.p[1]!) < 6;
        if (on && !inPad.has(b.p)) sim.turbo();
        if (on) inPad.add(b.p);
        else inPad.delete(b.p);
      }
      const v = Math.abs(st.speed);
      top = Math.max(top, st.y);
      if (v > 6) moving = true;
      if (moving && v < 3) slow = true;
      if (!landed && st.x >= land) landed = st.y > 0.5;
      // Del looping en adelante (ya abajo): ni un golpe, y por dentro de la pista.
      if (top > 17 && st.y < 6 && st.x > -6) {
        drop = Math.max(drop, prev - v);
        if (st.x > 0) off = Math.max(off, Math.abs(st.z - lane));
        if (st.x > race.finish.p[0]! - 1 && st.x < race.finish.p[0]! + 1) wheels = Math.max(wheels, st.contacts);
      }
      prev = v;
    }
    const yaw = Math.atan2(2 * (st.qw * st.qy + st.qx * st.qz), 1 - 2 * (st.qy * st.qy + st.qx * st.qx)) - Math.PI / 2;
    worst = { off: Math.max(worst.off, off), yaw: Math.max(worst.yaw, Math.abs(yaw)), drop: Math.max(worst.drop, drop) };
    const ok = top > 17 && !slow && landed && st.x >= 112 && drop < 3 && off < 3 && Math.abs(yaw) < 0.07 && wheels === 4;
    (ok ? done : bad).push(`${side > 0 ? "+" : ""}${side}: ${r1(t)} s`);
  }
  console.log(`  sin volante, entrando a ±3,3 m del centro: ${done.join(", ")}${bad.length ? `; fallan ${bad.join(", ")}` : ""}`);
  console.log(`  tras el looping: como mucho a ${r1(worst.off)} m del centro del carril y ${r1((worst.yaw * 180) / Math.PI)}° cruzado; el mayor frenazo, ${r1(worst.drop)} m/s`);
  check(bad.length === 0, "sin tocar el volante, entre por donde entre: da la vuelta al looping, sale recto por el otro carril, cae al otro lado del salto y pasa por la meta sin tocar nada");
}

// f) Sacar el coche otra vez (otro sitio, con el anterior recién quitado) no rompe la física: los
//    rayos de las ruedas no deben dar con lo que ya no está.
{
  let ok = true;
  for (const [x, y, z] of [[-51, 0.61, 150.5], [147, 0.3, 60], [-51, 0.61, 150.5]] as const) {
    sim.spawn(x, y, z, Math.PI / 2);
    for (let i = 0; i < 30; i++) sim.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
    ok &&= Number.isFinite(st.x + st.y + st.z + st.speed) && st.contacts >= 2;
  }
  check(ok, "sacar el coche varias veces seguidas: siempre queda apoyado y con números de verdad");
}

// El rival de la casa (src/world/vehicle/ghosts/gp.json): la misma carrera desde el segundo cajón,
// grabada a 10 por segundo con el coche de verdad. Quien corre solo la ve como un coche fantasma
// (world/vehicle/Ghost.tsx). Si cambian la pista, la física o el piloto: GHOSTS=write npm run test:race.
{
  const gates = [...race.cps.map((p) => ({ p, r: race.radius })), { p: race.finish.p, r: race.finish.radius }];
  const round: Round = {
    id: 9, key: "system:gp", race: "gp", owner: "system", state: "countdown", openedAt: 0, goAt: 0, laps: race.laps, perLap: gates.length,
    minMs: minRoundMs(gates.map((g) => g.p), race.laps), slots: race.grid.length, entrants: new Map([["casa", { session_id: "casa", sub: "casa", ranked: false, name: "casa", slot: 1, gates: 0 }]]),
  };
  const slot = race.grid[1]!;
  sim.spawn(slot[0]!, slot[1]! + 0.1, slot[2]!, ((race.start.yaw + 180) * Math.PI) / 180);
  settle();
  const head = () => [st.x, st.y + 1.6, st.z];
  startRound(round, () => near(head(), race.start.p, race.start.radius));
  turboAt.clear();
  const r2 = (v: number) => Math.round(v * 100) / 100, r4 = (v: number) => Math.round(v * 10000) / 10000;
  const frames: number[] = [], at_: number[] = [];
  let s = nearestS(slot[0]!, slot[2]!), t = 0, tick = 0, missed = "";
  while (round.entrants.get("casa")!.ms === undefined && t < 240) {
    if (tick++ % 6 === 0) frames.push(r2(st.x), r2(st.y), r2(st.z), r4(st.qx), r4(st.qy), r4(st.qz), r4(st.qw), Math.round(st.speed * 10) / 10);
    autopilot(s, t);
    t += 1 / 60;
    s = progress(s);
    const e = round.entrants.get("casa")!;
    const g = nextGate(e.gates, round.perLap);
    const gate = g === "finish" ? gates[gates.length - 1]! : gates[g]!;
    const dx = st.x - gate.p[0]!, dz = st.z - gate.p[2]!;
    if (dx * dx + dz * dz <= gate.r * gate.r && Math.abs(st.y - gate.p[1]!) <= 4 + gate.r) {
      if (passGate(round, "casa", g, t * 1000)) at_.push(Math.round(t * 1000));
      else missed ||= `puerta ${e.gates + 1}`;
    }
  }
  // Un segundo más, pasada la meta (frenando): el fantasma no se para en seco.
  for (let i = 0; i < 60; i++) {
    if (tick++ % 6 === 0) frames.push(r2(st.x), r2(st.y), r2(st.z), r4(st.qx), r4(st.qy), r4(st.qz), r4(st.qw), Math.round(st.speed * 10) / 10);
    sim.update(1 / 60, { throttle: -0.6, steer: 0, handbrake: false });
  }
  const ms = round.entrants.get("casa")!.ms;
  const rec = { race: "gp", hz: 10, ms, gates: at_, frames };
  const file = new URL("../src/world/vehicle/ghosts/gp.json", import.meta.url);
  if (process.env.GHOSTS === "write") writeFileSync(file, JSON.stringify(rec) + "\n");
  let saved: { ms?: number; gates?: number[] } = {};
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* sin grabar */
  }
  console.log(`  rival de la casa: ${r1((ms ?? 0) / 1000)} s desde el segundo cajón, ${frames.length / 8} posiciones grabadas (la guardada: ${r1((saved.ms ?? 0) / 1000)} s)`);
  check(ms !== undefined && !missed && at_.length === gates.length * race.laps, `el rival de la casa termina pasando por sus ${gates.length * race.laps} puertas${missed ? ` (falla: ${missed})` : ""}`);
  check(saved.ms !== undefined && Math.abs(saved.ms - (ms ?? 0)) < 1500 && saved.gates?.length === at_.length, "y su vuelta guardada está al día (si no: GHOSTS=write npm run test:race -w @xenxo/web)");
  // Lo que hace el cliente con ella (src/net/house-rival.ts).
  const lap = rec as GhostLap;
  setRivalLap(lap);
  const base = { round: 3, race: "gp", key: "system:gp", state: "running", laps: 2, per_lap: gates.length, slots: 8, go_at: 0, at: 0 };
  const one = { ...base, mine: true, live: true, entrants: [{ session_id: "yo", name: "yo", slot: 0, gates: 3 }] } as unknown as RoundState;
  const two = { ...one, entrants: [...one.entrants, { session_id: "otro", name: "otro", slot: 1, gates: 2 }] } as unknown as RoundState;
  check(soloRival(one) === lap && soloRival(two) === null && soloRival({ ...one, live: false } as RoundState) === null && soloRival({ ...one, state: "done" } as RoundState) === null, "el rival de la casa sale solo si corro (o espero) solo en la ronda");
  const p0 = ghostPose(lap, -5000, { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0 });
  const pEnd = ghostPose(lap, 9e6, { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0 });
  const nF = lap.frames.length / 8;
  check(Math.hypot(p0.x - slot[0]!, p0.z - slot[2]!) < 0.6 && Math.abs(pEnd.x - lap.frames[(nF - 1) * 8]!) < 1e-6, "antes de la salida espera en el segundo cajón, y al acabar se queda donde paró");
  let jump = 0;
  const pa = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0 }, pb = { ...pa };
  for (let tt = 0; tt < lap.ms; tt += 1000 / 60) {
    ghostPose(lap, tt, pa);
    ghostPose(lap, tt + 1000 / 60, pb);
    jump = Math.max(jump, Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z) * 60);
  }
  check(jump < 70, `entre dos frames no da saltos (lo más rápido: ${r1(jump)} m/s)`);
  check(rivalGap(lap, 1, lap.gates[0]! + 800) === 800 && rivalGap(lap, 1, lap.gates[0]! - 300) === -300 && rivalGap(lap, 0, 5000) === null, "y la diferencia en cada puerta: + si me saca, − si le saco");
}

console.log(fails ? `\n${fails} comprobaciones fallan` : "\nTodo bien.");
process.exit(fails ? 1 : 0);
