/**
 * Prueba del Circuito Vértigo (la pista del cielo de Arcade, sin quitamiedos), sin navegador, con el
 * coche de verdad (Rapier) sobre la pista tal como se sirve —el GLB empaquetado, en su nivel
 * ligero— y las reglas del servidor para las puertas:
 *
 *  1. La ficha: parrilla, puntos con su rumbo, la placa de turbo y las puertas del suelo.
 *  2. Tres vueltas limpias con un piloto que frena donde toca: no se cae, salta el hueco, pasa por
 *     todas las puertas y nadie lo devuelve a la pista sin haberse caído.
 *  3. Caerse: pasarse de frenada en la curva llana, salirse de la viga y quedarse corto en el salto.
 *     El coche vuelve solo al último punto, a un ritmo que el servidor da por bueno, queda sobre
 *     sus ruedas mirando hacia donde sigue la pista, y desde ahí se puede seguir (también el salto).
 *
 *   npm run test:race -w @xenxo/web
 */
import { readFileSync, writeFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { near } from "../../realtime/src/activities.ts";
import { minRoundMs, nextGate, passGate, startRound, type Round } from "../../realtime/src/rounds.ts";
import { SEED_ASSETS } from "../../realtime/src/seed-assets.ts";
import { CAR } from "../src/world/vehicle/car.ts";
import { CarSim, loadRapier, type StaticSource } from "../src/world/vehicle/physics.ts";
import { fallen, RESCUE_REST_S, type Gate } from "../src/world/vehicle/rescue.ts";

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};
const r1 = (v: number) => Math.round(v * 10) / 10;
const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

interface Race { id: string; radius: number; laps: number; vehicle?: string; mode?: string; start: { p: number[]; radius: number; yaw: number }; grid: number[][]; cps: number[][]; finish: { p: number[]; radius: number; yaw?: number } }
const acts = json("../../realtime/src/district-activities.json").arcade;
const race: Race = acts.races.find((r: Race) => r.id === "vertigo");
const gp: Race = acts.races.find((r: Race) => r.id === "gp");
const prop = acts.props.find((p: { piece: string }) => p.piece === "arcade_vertigo");
const track: { length: number; marks: Record<string, number>; turbos: number[]; line: [number, number, number, number, string, number][] } = json("./vertigo-line.json");
const H = race.start.p[1]!;

console.log("El Circuito Vértigo: la ficha");
{
  check(race.vehicle === "car" && race.mode === "grid" && race.laps === 3, "en coche, de salida conjunta, a tres vueltas");
  const far = Math.max(...race.grid.map((g) => Math.hypot(g[0]! - race.start.p[0]!, g[2]! - race.start.p[2]!)));
  check(race.grid.length === 8 && far <= race.start.radius, `ocho cajones, todos dentro del círculo de salida (el más lejano, a ${r1(far)} m)`);
  check(H > 20 && race.grid.every((g) => g[1] === H), `la parrilla está en el cielo (a ${H} m): desde el suelo no se entra en la carrera (el servidor mira también la altura)`);
  check(!near([race.start.p[0]!, 1.6, race.start.p[2]!], race.start.p, race.start.radius), "ni aparcando justo debajo");
  check(race.cps.every((c) => c.length === 4) && race.finish.yaw !== undefined, "cada punto (y la meta) lleva su rumbo: ahí vuelve el coche de quien se cae");
  // Ninguna puerta del Gran Premio cae cerca de las de Vértigo (ni al revés): no se pisan.
  const clash = race.cps.some((c) => gp.cps.some((g) => near(c, g, 8)));
  check(!clash, "sus puertas no se pisan con las del Gran Premio");
  const turbo = acts.boosts.filter((b: { vertigo?: boolean }) => b.vertigo);
  check(turbo.length === 1 && turbo[0].radius <= 5 && turbo[0].p[1] > H, "una placa de turbo, al empezar la rampa del salto");
  const doors = acts.portals as { p: number[]; to: { p: number[] }; size: number[] }[];
  check(doors.length === 2 && doors[0]!.p[1]! < 3 && doors[0]!.to.p[1] === H && doors[1]!.p[1]! > H && doors[1]!.to.p[1] === 0, "dos puertas: del suelo a la plataforma y de la plataforma al suelo");
  // Quien llega por una no aparece dentro de la otra (volvería a cruzarla).
  const apart = Math.hypot(doors[0]!.to.p[0]! - doors[1]!.p[0]!, doors[0]!.to.p[2]! - doors[1]!.p[2]!) > 4 && Math.hypot(doors[1]!.to.p[0]! - doors[0]!.p[0]!, doors[1]!.to.p[2]! - doors[0]!.p[2]!) > 4;
  check(apart, "y se aparece lejos de la de vuelta");
}

/** La malla de la pista como la carga el juego: el nivel más ligero de su modelo, en metros del lugar. */
async function trackMesh(): Promise<Float32Array> {
  const lods = SEED_ASSETS["arcade_vertigo"]!.lods;
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

console.log("El Circuito Vértigo, con el coche de verdad:");
const positions = await trackMesh();
check(positions.length / 9 > 3000 && positions.length / 9 < 20_000, `la pista se carga como malla de colisión (${positions.length / 9} triángulos, menos de 20 000)`);
const source: StaticSource = {
  version: () => 1,
  boxes: (cb) => cb({ x: 32, y: -0.3, z: 32, hx: 128, hy: 0.3, hz: 128, c: 1, s: 0 }),
  meshes: (cb) => cb("pista", positions, null),
  bounds: () => [-96, 160],
};
const R = await loadRapier();
const sim = new CarSim(R, source);
const st = sim.state;
const L = track.length;

/** Punto de la línea central a `s` metros de la meta. */
function at(s: number): [number, number, number] {
  s = ((s % L) + L) % L;
  let lo = 0, hi = track.line.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (track.line[m]![3] < s) lo = m + 1;
    else hi = m;
  }
  const b = track.line[lo]!, a = track.line[Math.max(0, lo - 1)]!;
  // (Del final de la línea a la meta: el último tramo cierra la vuelta.)
  if (s > b[3]) {
    const f = track.line[0]!, k = (s - b[3]) / Math.max(1e-6, L - b[3]);
    return [b[0] + (f[0] - b[0]) * k, b[1] + (f[1] - b[1]) * k, b[2] + (f[2] - b[2]) * k];
  }
  const k = b[3] > a[3] ? (s - a[3]) / (b[3] - a[3]) : 0;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
function zoneAt(s: number): string {
  s = ((s % L) + L) % L;
  for (const f of track.line) if (f[3] >= s) return f[4];
  return "bank";
}
function progress(prev: number): number {
  let best = prev, bd = Infinity;
  for (let d = -6; d <= 30; d += 0.5) {
    const p = at(prev + d);
    const dd = (p[0] - st.x) ** 2 + (p[1] - st.y) ** 2 * 0.2 + (p[2] - st.z) ** 2;
    if (dd < bd) {
      bd = dd;
      best = prev + d;
    }
  }
  return best;
}
function nearestS(x: number, y: number, z: number): number {
  let best = 0, bd = Infinity;
  for (const f of track.line) {
    const dd = (f[0] - x) ** 2 + (f[1] - y) ** 2 + (f[2] - z) ** 2;
    if (dd < bd) {
      bd = dd;
      best = f[3];
    }
  }
  return best;
}
/** A cuánto va cada tramo un piloto que frena donde toca (m/s). */
const PACE: Record<string, number> = { curve: 23, flat: 15, beam: 25, canyon: 27, ramp: 23 };
/**
 * `keys`: conduce como con el teclado: el volante, todo a un lado, todo al otro o suelto (nada de
 * medias tintas), y con lo que tarda una persona en reaccionar (`keys` segundos). `taps`: da
 * toques cortos a la tecla, más o menos seguidos según cuánto quiere girar (como quien sabe); sin
 * ello la deja pisada hasta que el coche apunta a donde quiere.
 */
interface Pilot { pace?: Record<string, number>; turbo?: boolean; brake?: number; keys?: number; taps?: boolean }
const turboAt = { t: -9 };
/** Cada cuánto da un toque a la tecla quien conduce a toques (s). */
const TAP_S = 0.1;
const queue: { at: number; steer: number; throttle: number }[] = [];
let held = { steer: 0, throttle: 0 };
/** Un paso del piloto: sigue la línea, frena para lo que viene y, si quiere, pisa la placa de turbo. */
function pilot(s: number, t: number, o: Pilot = {}) {
  const v = Math.abs(st.speed);
  const look = at(s + 6 + v * 0.4);
  const dx = look[0] - st.x, dy = look[1] - st.y, dz = look[2] - st.z;
  const { qx, qy, qz, qw } = st;
  const lx = 1 - 2 * (qy * qy + qz * qz), ly = 2 * (qx * qy + qw * qz), lz = 2 * (qx * qz - qw * qy);
  const fx = 2 * (qx * qz + qw * qy), fy = 2 * (qy * qz - qw * qx), fz = 1 - 2 * (qx * qx + qy * qy);
  const side = dx * lx + dy * ly + dz * lz, ahead = dx * fx + dy * fy + dz * fz;
  const steer = Math.max(-1, Math.min(1, -Math.atan2(side, Math.max(1, ahead)) * 2.4));
  const pace = o.pace ?? PACE;
  // Lo que viene en lo que tarda en frenar: de la velocidad de ahora a la de cada tramo.
  let want = 99;
  for (let d = 4; d <= 70; d += 3) {
    const cap = pace[zoneAt(s + d)];
    if (cap === undefined) continue;
    const room = Math.max(0, d - 6);
    want = Math.min(want, Math.sqrt(cap * cap + 2 * (o.brake ?? 9) * room));
  }
  const throttle = v > want + 0.8 ? -1 : v > want ? 0 : 1;
  const sl = ((s % L) + L) % L;
  if (o.turbo && sl >= track.turbos[0]! - 2 && sl <= track.turbos[0]! + 3 && t - turboAt.t > 3 && sim.turbo()) turboAt.t = t;
  if (o.keys === undefined) {
    sim.update(1 / 60, { throttle, steer, handbrake: false });
    return;
  }
  // Con el teclado: lo que decide ahora llega a las teclas un momento después.
  const press = o.taps ? (t % TAP_S) / TAP_S < Math.abs(steer) : Math.abs(steer) >= 0.1;
  queue.push({ at: t + o.keys, steer: press ? Math.sign(steer) : 0, throttle });
  while (queue.length && queue[0]!.at <= t) held = queue.shift()!;
  sim.update(1 / 60, { throttle: held.throttle, steer: held.steer, handbrake: false });
}
const keysReset = () => {
  queue.length = 0;
  held = { steer: 0, throttle: 0 };
};
const settle = (secs = 1) => {
  for (let i = 0; i < secs * 60; i++) sim.update(1 / 60, { throttle: 0, steer: 0, handbrake: true });
};
/** Las puertas como las tiene cada uno: el servidor (dónde y con qué radio) y el cliente (con su rumbo, para volver). */
const gates = [...race.cps.map((p) => ({ p, r: race.radius })), { p: race.finish.p, r: race.finish.radius }];
const gateOf = (i: number): Gate => {
  const c = i < 0 || i >= race.cps.length ? [...race.finish.p, race.finish.yaw ?? 0] : race.cps[i]!;
  return { x: c[0]!, y: c[1]!, z: c[2]!, yaw: (c[3]! * Math.PI) / 180 };
};
const startYaw = ((race.start.yaw + 180) * Math.PI) / 180;
const yawOf = () => Math.atan2(2 * (st.qw * st.qy + st.qx * st.qz), 1 - 2 * (st.qy * st.qy + st.qx * st.qx));
const upOf = () => 1 - 2 * (st.qx * st.qx + st.qz * st.qz);

// a) Tres vueltas limpias desde la pole.
{
  const round: Round = {
    id: 1, key: "system:vertigo", race: "vertigo", owner: "system", state: "countdown", openedAt: 0, goAt: 0, laps: race.laps, perLap: gates.length,
    minMs: minRoundMs(gates.map((g) => g.p), race.laps), slots: race.grid.length, entrants: new Map([["yo", { session_id: "yo", sub: "u", ranked: true, name: "yo", slot: 0, gates: 0 }]]),
  };
  const pole = race.grid[0]!;
  sim.spawn(pole[0]!, pole[1]! + 0.05, pole[2]!, startYaw);
  settle();
  const head = () => [st.x, st.y + 1.6, st.z];
  check(st.contacts === 4 && Math.abs(st.y - H) < 0.1, "el coche se apoya en la pista, a su altura");
  check(startRound(round, () => near(head(), race.start.p, race.start.radius)), "desde su cajón, el servidor lo da por bien colocado en la salida");
  let s = nearestS(pole[0]!, pole[1]!, pole[2]!), t = 0, air = 0, airMax = 0, airAt = "", low = 99, missed = "", lapMs: number[] = [], false_ = "", offMax = 0, impact = 0, lip = 0;
  let tight = { ratio: Infinity, gate: 0 };
  const speeds: Record<string, number> = {};
  const marks = Object.entries(track.marks).sort((a, b) => a[1] - b[1]);
  while (round.entrants.get("yo")!.ms === undefined && t < 300) {
    const v = Math.abs(st.speed);
    pilot(s, t);
    t += 1 / 60;
    const ns = progress(s);
    const lap0 = Math.floor(s / L) * L;
    for (const [name, ms] of marks) if (s - lap0 < ms && ns - lap0 >= ms) speeds[name] = r1(v);
    if (s - lap0 < track.marks.lip! && ns - lap0 >= track.marks.lip!) lip = v;
    s = ns;
    if (st.contacts === 0) {
      air += 1 / 60;
      if (air > airMax) {
        airMax = air;
        airAt = zoneAt(s);
      }
    } else air = 0;
    impact = Math.max(impact, st.impact);
    const c = at(s);
    low = Math.min(low, st.y - c[1]);
    if (st.contacts >= 2) offMax = Math.max(offMax, Math.hypot(st.x - c[0], st.z - c[2]) / (track.line.find((f) => f[3] >= ((s % L) + L) % L)?.[5] ?? 7));
    const e = round.entrants.get("yo")!;
    const g = nextGate(e.gates, round.perLap);
    const gi = g === "finish" ? gates.length - 1 : g;
    const gate = gates[gi]!;
    // Nadie lo devuelve a la pista sin haberse caído: ni en el salto ni al despegar en el cañón.
    if (fallen(st.y, gateOf(gi - 1), gateOf(gi))) false_ ||= `${zoneAt(s)} a los ${r1(t)} s`;
    const dx = st.x - gate.p[0]!, dz = st.z - gate.p[2]!;
    if (dx * dx + dz * dz <= gate.r * gate.r && Math.abs(st.y - gate.p[1]!) <= 4 + gate.r) {
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
  console.log(`  carrera: ${r1(t)} s (vueltas: ${lapMs.map((x, i) => r1((x - (lapMs[i - 1] ?? 0)) / 1000)).join(" + ")} s); en el aire ${airMax.toFixed(2)} s como mucho (${airAt}); despega a ${r1(lip)} m/s; golpe más fuerte ${r1(impact)} m/s`);
  console.log(`  velocidades (m/s): ${Object.entries(speeds).map(([k, v]) => `${k} ${v}`).join(", ")}; lo más que se va del centro: ${Math.round(offMax * 100)} % del ancho; lo más bajo: ${low.toFixed(2)} m`);
  check(e.ms !== undefined && !missed, `da las tres vueltas pasando por sus ${gates.length} puertas en orden${missed ? ` (falla: ${missed})` : ""}`);
  check(low > -1.2 && offMax < 0.5 - CAR.width / 2 / 4.6 + 0.24, "sin caerse ni sacar una rueda de la pista");
  check(!false_, `y nadie lo devuelve a la pista sin haberse caído${false_ ? ` (lo haría en ${false_})` : ""}`);
  check(!e.out && e.ms !== undefined && e.ms > round.minMs * 1.2 && tight.ratio > 1.3, `el servidor no lo echa por rápido (lo mínimo son ${r1(round.minMs / 1000)} s; la puerta más justa, a ${tight.ratio.toFixed(2)} veces)`);
  check(t > 60 && t < 130, "tres vueltas en poco más de un minuto");
  check(airMax > 0.3 && airMax < 1.5 && airAt === "ramp", "vuela en el salto, y solo en el salto");
  check(impact < 12, "sin golpes fuertes al caer");
}

/** Conduce hasta caerse (o hasta `secs`); después, lo que haría el cliente: devolverlo al último punto. */
function untilFall(s: number, secs: number, lastGate: number, drive: (s: number, t: number) => void) {
  let t = 0, fell = -1, left = -1;
  const last = gateOf(lastGate), next = gateOf(lastGate + 1);
  for (; t < secs; t += 1 / 60) {
    drive(s, t);
    s = progress(s);
    // (Cuándo deja la pista de verdad: sin ruedas en el suelo y ya por debajo de ella.)
    if (left < 0 && st.contacts === 0 && st.y < at(s)[1] - 1.5) left = t;
    if (fallen(st.y, last, next)) {
      fell = t;
      break;
    }
  }
  return { fell, wait: fell - left, s, y: st.y, last };
}
/** El coche vuelve solo: cuánto tarda y a qué velocidad va como mucho (lo que mira el servidor entre pose y pose). */
function carryBack(g: Gate) {
  sim.carry(g.x, g.y + 0.05, g.z, g.yaw + Math.PI);
  let t = 0, flat = 0, up = 0, px = st.x, py = st.y, pz = st.z;
  // Las poses salen cinco veces por segundo: el servidor mira lo que avanza entre una y otra.
  for (let n = 0; sim.carrying && t < 20; n++) {
    sim.update(1 / 60, { throttle: 1, steer: 0.4, handbrake: false });
    t += 1 / 60;
    if (n % 12 === 11) {
      flat = Math.max(flat, Math.hypot(st.x - px, st.z - pz) / 0.2);
      up = Math.max(up, Math.abs(st.y - py) / 0.2);
      px = st.x;
      py = st.y;
      pz = st.z;
    }
  }
  settle(RESCUE_REST_S);
  let dyaw = yawOf() - (g.yaw + Math.PI);
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  return { t, flat, up, off: Math.hypot(st.x - g.x, st.z - g.z), dy: st.y - g.y, dyaw };
}
const fromS = (s: number, v = 0) => {
  const p0 = at(s), p1 = at(s + 2);
  sim.spawn(p0[0], p0[1] + 0.05, p0[2], Math.atan2(p1[0] - p0[0], p1[2] - p0[2]));
  settle(0.6);
  // Lanzado: unos metros a fondo hasta coger la velocidad pedida.
  let t = 0;
  while (Math.abs(st.speed) < v && t < 12) {
    pilot(s, t, { pace: {} });
    s = progress(s);
    t += 1 / 60;
  }
  return s;
};

// b) Con el teclado. El coche agarra muchísimo (la curva llana, de 13 m de radio, se puede tomar a
//    100 km/h si se traza perfecta): lo difícil de Vértigo no es el agarre, es que no hay con qué
//    rozar, y con el teclado el volante va a tope o suelto. Un piloto de teclado que lleva el coche
//    a toques (con 150 ms de reacción) y frena donde toca da sus tres vueltas; el mismo, a fondo y
//    sin tocar el freno, se cae.
{
  const lapWith = (o: Pilot, secs: number) => {
    const pole = race.grid[0]!;
    sim.spawn(pole[0]!, pole[1]! + 0.05, pole[2]!, startYaw);
    settle();
    keysReset();
    turboAt.t = -9;
    let s = nearestS(pole[0]!, pole[1]!, pole[2]!), t = 0, where = "";
    const s0 = s;
    for (; t < secs && s - s0 < 3 * L && !where; t += 1 / 60) {
      pilot(s, t, o);
      s = progress(s);
      if (st.y < at(s)[1] - 6) where = zoneAt(s);
    }
    return { t, laps: (s - s0) / L, where };
  };
  const calm = lapWith({ keys: 0.15, taps: true, pace: { curve: 20, flat: 12, beam: 17, canyon: 22, ramp: 22, bank: 24 } }, 200);
  console.log(`  con el teclado, a toques y frenando donde toca: ${calm.where ? `se cae en «${calm.where}» tras ${r1(calm.laps)} vueltas` : `tres vueltas en ${r1(calm.t)} s`}`);
  check(!calm.where && calm.laps >= 3, "con el teclado y con cabeza se dan las tres vueltas sin caerse");
  const wild = lapWith({ keys: 0.15, taps: true, pace: {}, turbo: true }, 200);
  console.log(`  con el teclado, a fondo: ${wild.where ? `se cae en «${wild.where}» a los ${r1(wild.t)} s (${r1(wild.laps)} vueltas)` : `tres vueltas en ${r1(wild.t)} s`}`);
  check(!!wild.where, "a fondo y sin frenar, se cae: es más difícil que el Gran Premio, que se puede dar así");
}

// c) Pasarse de frenada en la curva llana del noreste: llega lanzado y sigue recto.
{
  const s0 = fromS(track.marks.ramp! - 34, 0);
  turboAt.t = -9;
  const r = untilFall(s0, 16, 1, (s, t) => {
    if (((s % L) + L) % L >= track.marks.ne! - 4) sim.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
    else pilot(s, t, { pace: {}, turbo: true });
  });
  console.log(`  de frente en la curva llana: ${r.fell < 0 ? "no se cae" : `se cae a los ${r1(r.fell)} s; se le da por caído ${r1(r.wait)} s después de dejar la pista`}`);
  check(r.fell > 0 && r.wait < 2.2, "quien llega a la curva llana y sigue recto se cae, y se le da por caído enseguida");
  const c = carryBack(r.last);
  console.log(`  vuelve en ${r1(c.t)} s, a ${r1(c.flat)} m/s de lado y ${r1(c.up)} m/s en vertical como mucho; queda a ${c.off.toFixed(2)} m del punto, ${c.dy.toFixed(2)} m sobre él, torcido ${Math.abs(c.dyaw).toFixed(3)} rad`);
  check(c.t < 8 && c.flat < 36 && c.up < 55, "el coche vuelve solo al último punto, sin pasar de lo que el servidor da por un movimiento posible");
  check(c.off < 0.6 && Math.abs(c.dy) < 0.3 && Math.abs(c.dyaw) < 0.05 && st.contacts === 4 && upOf() > 0.99 && Math.abs(st.speed) < 0.5, "y queda parado sobre sus ruedas, mirando hacia donde sigue la pista");
  // Desde ahí, con cabeza, se sigue: llega a la puerta siguiente sin caerse.
  let s = nearestS(st.x, st.y, st.z), t = 0, ok = false;
  const g = gates[2]!;
  for (; t < 20 && !ok; t += 1 / 60) {
    pilot(s, t);
    s = progress(s);
    ok = Math.hypot(st.x - g.p[0]!, st.z - g.p[2]!) < g.r && Math.abs(st.y - g.p[1]!) < 3;
  }
  check(ok, "y desde ahí se llega al punto siguiente");
}

// d) Salirse de la viga: un volantazo a media recta.
{
  const s0 = fromS(track.marks.north! - 2, 0);
  const r = untilFall(s0, 12, 2, (s, t) => {
    if (((s % L) + L) % L > track.marks.beam! + 12) sim.update(1 / 60, { throttle: 1, steer: -1, handbrake: false });
    else pilot(s, t, { pace: {} });
  });
  check(r.fell > 0, `quien se sale de la viga se cae (a los ${r1(r.fell)} s)`);
  const c = carryBack(r.last);
  check(c.t < 8 && c.flat < 36 && c.off < 0.6 && st.contacts === 4, `y vuelve al principio de la viga (en ${r1(c.t)} s)`);
}

// e) El salto. Despacio no se llega; saliendo de parado desde el punto de antes, sí (con la placa y sin ella).
{
  const s0 = fromS(track.marks.ramp! - 30, 0);
  const slow = untilFall(s0, 20, 0, (s, t) => pilot(s, t, { pace: { road: 11, ramp: 11, bank: 11 } }));
  check(slow.fell > 0, `a 40 km/h no se llega al otro lado (se cae a los ${r1(slow.fell)} s)`);
  const c = carryBack(slow.last);
  console.log(`  vuelve en ${r1(c.t)} s; queda a ${c.off.toFixed(2)} m del punto, ${c.dy.toFixed(2)} m sobre él, con ${st.contacts} ruedas en el suelo`);
  check(c.off < 0.6 && st.contacts === 4, `y vuelve al punto de antes del salto (en ${r1(c.t)} s)`);
  for (const turbo of [true, false]) {
    if (!turbo) carryBack(gateOf(0));
    let s = nearestS(st.x, st.y, st.z), t = 0, fell = false, lip = 0, over = false;
    turboAt.t = -9;
    for (; t < 12 && !over; t += 1 / 60) {
      const before = s;
      pilot(s, t, { pace: {}, turbo });
      s = progress(s);
      if (before < track.marks.lip! && s >= track.marks.lip!) lip = Math.abs(st.speed);
      if (fallen(st.y, gateOf(0), gateOf(1))) fell = true;
      over = st.z < at(track.marks.landed!)[2] + 6 && st.contacts >= 3;
    }
    console.log(`  salto saliendo de parado, ${turbo ? "pisando la placa" : "sin placa"}: despega a ${r1(lip)} m/s; ${over && !fell ? "llega al otro lado" : "se cae"}`);
    check(over && !fell, `saliendo de parado desde el punto de antes${turbo ? ", con la placa de turbo" : ", sin ella"}, se llega al otro lado`);
  }
}

// f) En el Gran Premio (a ras de suelo) nunca se da a nadie por caído: ni en lo alto del looping ni en el salto.
{
  const g = (c: number[]): Gate => ({ x: c[0]!, y: c[1]!, z: c[2]!, yaw: 0 });
  const pts = [...gp.cps, gp.finish.p];
  let never = true;
  for (let i = 0; i < pts.length; i++) {
    const a = g(pts[(i + pts.length - 1) % pts.length]!), b = g(pts[i]!);
    // (Ni hundido en el suelo del distrito, que está a cero.)
    for (const y of [-0.5, 0, 0.3, 2, 8, 20]) if (fallen(y, a, b)) never = false;
  }
  check(never, "en el Gran Premio no se da a nadie por caído: ni al pie del looping ni en el salto");
}

// El rival de la casa (src/world/vehicle/ghosts/vertigo.json): la misma carrera desde el segundo cajón,
// grabada a 10 por segundo con el coche de verdad. Quien corre solo la ve como un coche fantasma
// (world/vehicle/Ghost.tsx). Si cambian la pista, la física o el piloto: GHOSTS=write npm run test:race.
{
  const gates = [...race.cps.map((p) => ({ p, r: race.radius })), { p: race.finish.p, r: race.finish.radius }];
  const round: Round = {
    id: 9, key: "system:vertigo", race: "vertigo", owner: "system", state: "countdown", openedAt: 0, goAt: 0, laps: race.laps, perLap: gates.length,
    minMs: minRoundMs(gates.map((g) => g.p), race.laps), slots: race.grid.length, entrants: new Map([["casa", { session_id: "casa", sub: "casa", ranked: false, name: "casa", slot: 1, gates: 0 }]]),
  };
  const slot = race.grid[1]!;
  sim.spawn(slot[0]!, slot[1]! + 0.05, slot[2]!, startYaw);
  settle();
  const head = () => [st.x, st.y + 1.6, st.z];
  startRound(round, () => near(head(), race.start.p, race.start.radius));
  turboAt.t = -9;
  const r2 = (v: number) => Math.round(v * 100) / 100, r4 = (v: number) => Math.round(v * 10000) / 10000;
  const frames: number[] = [], at_: number[] = [];
  let s = nearestS(slot[0]!, slot[1]!, slot[2]!), t = 0, tick = 0, missed = "";
  while (round.entrants.get("casa")!.ms === undefined && t < 300) {
    if (tick++ % 6 === 0) frames.push(r2(st.x), r2(st.y), r2(st.z), r4(st.qx), r4(st.qy), r4(st.qz), r4(st.qw), Math.round(st.speed * 10) / 10);
    pilot(s, t);
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
  const rec = { race: "vertigo", hz: 10, ms, gates: at_, frames };
  const file = new URL("../src/world/vehicle/ghosts/vertigo.json", import.meta.url);
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
}

sim.dispose();
console.log(fails ? `\n${fails} fallos` : "\nTodo bien.");
process.exit(fails ? 1 : 0);
