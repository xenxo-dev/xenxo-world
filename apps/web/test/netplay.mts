/**
 * Prueba de cómo se ve a los demás, sin navegador ni servidor: el viaje entero de una pose en un
 * reloj de mentira. Quien se mueve la manda como la web (net/pose-send.ts), una red con retraso y
 * rachas la lleva al servidor, que la fecha y la reparte como el de verdad (pose-clock.ts del
 * servidor: el reloj de cada sesión, el tope de frecuencia y los lotes), otra red la trae y aquí la
 * recibe el almacén de verdad (net/world-store.ts) y se dibuja como en world/Avatars.tsx
 * (net/playout.ts). Se mide lo que vería una persona: con cuánto retraso, si el otro anda a
 * velocidad uniforme, si se queda clavado o da saltos.
 *
 *   npm run test:netplay -w @xenxo/web
 */

/* --- El reloj de mentira (antes de cargar nada que lo lea) --- */
let vt = 0;
/** El reloj de este equipo no empieza donde el del servidor, ni donde el de quien manda. */
const LOCAL_ORIGIN = 123_456;
Object.defineProperty(globalThis, "performance", { value: { now: () => vt + LOCAL_ORIGIN, timeOrigin: 0 }, configurable: true });

const { world } = await import("../src/net/world-store");
const { Catchup, cursor, seek, ServerClock } = await import("../src/net/playout");
const { PoseSender, SEND_EVERY_MS, SEND_TIGHT_MS } = await import("../src/net/pose-send");
const { allowSample, batchGap, SAMPLE_MAX_AGE_MS, stampSample } = await import("../../realtime/src/pose-clock");
const { crowdFrame, joinCrowd, leaveCrowd } = await import("../src/world/crowd");
type PoseClock = import("../../realtime/src/pose-clock").PoseClock;

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};

/* --- Azar repetible --- */
let seed = 1;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

/* --- Simulador de sucesos --- */
class Sim {
  now = 0;
  private q: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;
  at(t: number, fn: () => void) {
    const e = { at: Math.max(t, this.now), seq: this.seq++, fn };
    let lo = 0, hi = this.q.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = this.q[mid]!;
      if (m.at < e.at || (m.at === e.at && m.seq < e.seq)) lo = mid + 1;
      else hi = mid;
    }
    this.q.splice(lo, 0, e);
  }
  run(until: number) {
    while (this.q.length && this.q[0]!.at <= until) {
      const e = this.q.shift()!;
      this.now = vt = e.at;
      e.fn();
    }
    this.now = vt = until;
  }
}

type Net = "lan" | "wifi" | "movil";
/** Lo que tarda un tramo (ms). */
function hop(net: Net): number {
  if (net === "lan") return 1;
  if (net === "movil") return Math.max(15, 60 + 30 * gauss()) + (rnd() < 0.02 ? 250 : 0);
  return Math.max(5, 20 + 5 * gauss());
}
/** Un enlace que entrega en orden (como TCP): lo que se retrasa, retrasa a lo que viene detrás. */
function link(sim: Sim, net: Net) {
  let last = 0;
  return (fn: () => void) => {
    last = Math.max(last, sim.now + hop(net));
    sim.at(last, fn);
  };
}

/* --- Por dónde va quien se mueve --- */
const SPEED = 5.4;
interface At { x: number; z: number; emote?: string }
type Path = (t: number) => At;
const circle = (r: number, ph = 0): Path => (t) => ({ x: 32 + r * Math.cos(ph + (SPEED / r) * (t / 1000)), z: 32 + r * Math.sin(ph + (SPEED / r) * (t / 1000)) });
/** Corre hacia +X y se para en seco en `stop` (ms). */
const runStop = (stop: number): Path => (t) => ({ x: 10 + (SPEED * Math.min(t, stop)) / 1000, z: 20 });
/** Quieta hasta `start` (ms) y entonces corre. */
const idleStart = (start: number): Path => (t) => ({ x: 10 + (SPEED * Math.max(0, t - start)) / 1000, z: 20 });

/* --- El servidor: lo mismo que chunk-room.ts con las piezas de pose-clock.ts --- */
interface Batch { t: number; poses: { session_id: string; age?: number; head: { p: [number, number, number]; r: [number, number, number, number] }; emote?: string }[] }
class Server {
  /** El reloj del servidor tampoco es el de nadie. */
  static SKEW = 7_000_000;
  private clocks = new Map<string, PoseClock>();
  private tats = new Map<string, number>();
  private poses = new Map<string, At>();
  private dirty = new Set<string>();
  private lastTick = 0;
  private timer = false;
  dropped = 0;
  stampErr: number[] = [];
  constructor(private sim: Sim, private senders: number, private out: (b: Batch) => void, private ages = true) {}
  get now() {
    return this.sim.now + Server.SKEW;
  }
  /** Llega una pose (`taken`: cuándo se tomó de verdad, para medir el error de la fecha que se le pone). */
  onPose(id: string, t: number, p: At, taken: number) {
    const now = this.now;
    const tat = allowSample(this.tats.get(id), now, 15);
    if (tat < 0) return void this.dropped++;
    this.tats.set(id, tat);
    const c = stampSample(this.clocks.get(id), t, now);
    this.clocks.set(id, c);
    this.stampErr.push(c.last - (taken + Server.SKEW));
    this.poses.set(id, p);
    this.dirty.add(id);
    this.schedule();
  }
  private schedule() {
    if (!this.dirty.size) return;
    const wait = this.lastTick + batchGap(this.senders, 105) - this.now;
    if (wait <= 0) return this.flush();
    if (!this.timer) {
      this.timer = true;
      this.sim.at(this.sim.now + wait, () => {
        this.timer = false;
        this.flush();
      });
    }
  }
  private flush() {
    if (!this.dirty.size) return;
    const now = this.now;
    this.lastTick = now;
    const poses: Batch["poses"] = [];
    for (const id of this.dirty) {
      const p = this.poses.get(id)!;
      const age = Math.max(0, Math.round(now - this.clocks.get(id)!.last));
      poses.push({ session_id: id, ...(this.ages && age > 0 ? { age } : {}), head: { p: [p.x, 1.6, p.z], r: [0, 0, 0, 1] }, ...(p.emote ? { emote: p.emote } : {}) });
    }
    this.dirty.clear();
    this.out({ t: now, poses });
  }
}

/* --- Un caso entero --- */
interface Opts {
  secs: number;
  net: Net;
  path: Path;
  /** Cuánta gente más manda poses a la vez (de eso salen los lotes). */
  others?: number;
  /** Quien manda es la web de antes: sin la pose de «me he parado». */
  oldSender?: boolean;
  /** El servidor es el de antes: sin `age` (cada muestra, con la hora de su lote). */
  oldServer?: boolean;
  /** La página de quien mira se atasca `stallMs` cada `stallEvery` ms. */
  stallEvery?: number;
  stallMs?: number;
  /** Frames por segundo de quien manda y de quien mira. */
  sendFps?: number;
  drawFps?: number;
  /** Desde cuándo se mide (ms). */
  from?: number;
  /** Cada cuánto manda (ms) si no es el de siempre. */
  every?: number;
}
interface Out {
  lagMs: number;
  lagP95: number;
  speedSd: number;
  over: number;
  frozen: number;
  maxJump: number;
  delay: number;
  delayMax: number;
  sent: number;
  stampSd: number;
  dropped: number;
  /** Lo dibujado en cada frame medido: hora, x, z y dónde estaba de verdad. */
  trace: { t: number; x: number; z: number; tx: number; tz: number }[];
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
const pct = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : NaN;
};

function run(o: Opts): Out {
  seed = 20261110;
  const sim = new Sim();
  vt = 0;
  // El almacén de verdad, recién llegado a un lugar.
  world.setStatus("open");
  world.beginTravel("c_0_0");
  const down = link(sim, o.net);
  let stalled = 0;
  const held: Batch[] = [];
  const deliver = (b: Batch) => world.apply({ v: 0, type: "POSES", payload: b } as never);
  const server = new Server(sim, 1 + (o.others ?? 0), (b) => down(() => (sim.now < stalled ? held.push(b) : deliver(b))), !o.oldServer);
  world.apply({ v: 0, type: "WELCOME", payload: { session_id: "yo", principal: { sub: "g_1", kind: "guest", scopes: [] }, chunk_id: "c_0_0", server_time: server.now, tick_hz: 8, budgets: {} } } as never);

  /** Alguien que manda su pose: cada frame mira si toca. */
  const sender = (id: string, path: Path, measured: boolean) => {
    const up = link(sim, o.net);
    const policy = new PoseSender();
    // Su reloj: otro origen y un pelín más rápido que el de verdad (100 partes por millón).
    const origin = 50_000 + rnd() * 1e6;
    const local = () => origin + sim.now * 1.0001;
    let last: At = { x: NaN, z: NaN }, lastOld = -Infinity, sent = 0;
    const frameMs = 1000 / (o.sendFps ?? 60);
    const tick = () => {
      const p = path(sim.now);
      const acted = p.emote !== last.emote;
      const moved = !(Math.hypot(p.x - last.x, p.z - last.z) <= 0.01);
      let go: boolean;
      if (o.oldSender && measured) {
        // La web de antes: cada 200 ms si hay cambio, y un latido por segundo.
        go = sim.now - lastOld >= 200 && (moved || acted || sim.now - lastOld >= 1000);
        if (go) lastOld = sim.now;
      } else go = policy.due(local(), moved, acted, o.every ?? SEND_EVERY_MS);
      if (go) {
        last = p;
        const taken = sim.now, t = Math.round(local());
        if (measured && sim.now >= (o.from ?? 4000)) sent++;
        up(() => server.onPose(id, t, p, taken));
      }
      sim.at(sim.now + frameMs + (rnd() - 0.5), tick);
    };
    sim.at(rnd() * 200, tick);
    return () => sent;
  };
  const sentOf = sender("ella", o.path, true);
  for (let i = 0; i < (o.others ?? 0); i++) sender(`otro${i}`, circle(6 + (i % 5) * 3, i), false);

  // Quien mira: cada frame, lo que hace world/Avatars.tsx con net/playout.ts.
  const cur = cursor(), catchup = new Catchup();
  const lag: number[] = [], speed: number[] = [], delays: number[] = [], trace: Out["trace"] = [];
  let over = 0, frozen = 0, frames = 0, maxJump = 0;
  let px = NaN, pz = NaN, pt = 0, nextStall = o.stallEvery ?? Infinity;
  const frameMs = 1000 / (o.drawFps ?? 60);
  const at = (buf: readonly { t: number; head: { p: readonly number[] } }[], rt: number): [number, number] => {
    seek(buf, rt, cur);
    const a = buf[cur.i0]!.head.p, b = buf[cur.i1]!.head.p;
    return [a[0]! + (b[0]! - a[0]!) * cur.k, a[2]! + (b[2]! - a[2]!) * cur.k];
  };
  const draw = () => {
    if (sim.now >= nextStall) {
      // La página se atasca: ni dibuja ni atiende a la red; al acabar, todo lo que esperaba, de golpe.
      stalled = sim.now + (o.stallMs ?? 400);
      nextStall = sim.now + (o.stallEvery ?? Infinity);
      sim.at(stalled, () => {
        for (const b of held.splice(0)) deliver(b);
        draw();
      });
      return;
    }
    world.frame();
    const buf = world.poseBuffers.get("ella");
    if (buf && buf.length) {
      const rt = world.playTime("ella");
      const newest = buf[buf.length - 1]!.t;
      const redo = catchup.redo(newest);
      if (!Number.isNaN(redo)) {
        const [ox, oz] = at(buf, redo);
        catchup.absorb(ox, 0, oz);
      }
      const [tx, tz] = at(buf, rt);
      const dt = (sim.now - pt) / 1000;
      catchup.frame(rt, newest, cur.over > 0, tx, 0, tz, dt);
      const x = tx + catchup.x, z = tz + catchup.z;
      if (sim.now >= (o.from ?? 4000)) {
        const real = o.path(sim.now), was = o.path(sim.now - 1);
        const moving = Math.hypot(real.x - was.x, real.z - was.z) > 1e-6;
        frames++;
        if (cur.over > 0) over++;
        lag.push(Math.hypot(x - real.x, z - real.z));
        delays.push(world.playDelay("ella"));
        trace.push({ t: sim.now, x, z, tx: real.x, tz: real.z });
        if (!Number.isNaN(px) && dt > 0 && dt < 0.06) {
          const v = Math.hypot(x - px, z - pz) / dt;
          maxJump = Math.max(maxJump, Math.hypot(x - px, z - pz));
          if (moving) {
            speed.push(v / SPEED);
            if (v < SPEED * 0.05) frozen++;
          }
        }
      }
      px = x;
      pz = z;
    }
    pt = sim.now;
    sim.at(sim.now + frameMs + (rnd() - 0.5), draw);
  };
  sim.at(5, draw);
  sim.run(o.secs * 1000);
  const secs = o.secs - (o.from ?? 4000) / 1000;
  return {
    lagMs: (mean(lag) / SPEED) * 1000,
    lagP95: (pct(lag, 0.95) / SPEED) * 1000,
    speedSd: sd(speed) * 100,
    over: (over / Math.max(1, frames)) * 100,
    frozen: (frozen / Math.max(1, speed.length)) * 100,
    maxJump,
    delay: mean(delays),
    delayMax: Math.max(...delays),
    sent: sentOf() / secs,
    stampSd: sd(server.stampErr),
    dropped: server.dropped,
    trace,
  };
}
const f0 = (v: number) => v.toFixed(0), f1 = (v: number) => v.toFixed(1);

/* ------------------------------------------------------------------ */

console.log("Dos personas, red buena");
{
  const r = run({ secs: 30, net: "wifi", path: circle(8) });
  check(r.speedSd < 4, `la otra persona anda a velocidad uniforme (se desvía un ${f1(r.speedSd)} %; antes, un 30 %)`);
  check(r.lagMs > 200 && r.lagMs < 290, `se la ve con ${f0(r.lagMs)} ms de retraso (antes, más de 400)`);
  check(r.frozen === 0 && r.maxJump < 0.14, `ni un frame clavada ni un salto (el mayor paso, ${(r.maxJump * 100).toFixed(0)} cm)`);
  check(r.sent > 4.5 && r.sent < 5.05, `mandando ${f1(r.sent)} poses por segundo: las del plan gratuito`);
  check(r.stampSd < 3.5, `el servidor fecha cada muestra como se tomó (error de ±${f1(r.stampSd)} ms con un reloj con otro origen y que se desvía)`);
}

console.log("Sin retraso de red (dos pestañas en el mismo equipo)");
{
  const r = run({ secs: 20, net: "lan", path: circle(8) });
  check(r.speedSd < 3 && r.lagMs < 245, `uniforme (${f1(r.speedSd)} %) y con ${f0(r.lagMs)} ms: el intervalo de envío y poco más`);
}

console.log("Mucha gente: las poses salen en lotes");
for (const others of [7, 19, 49]) {
  const r = run({ secs: 24, net: "wifi", path: circle(8), others });
  check(r.speedSd < 5 && r.frozen === 0, `con ${others + 1} personas, igual de uniforme (${f1(r.speedSd)} %; antes, hasta un 37 %)`);
  check(r.lagMs < (others < 10 ? 330 : others < 24 ? 365 : 400), `y con ${f0(r.lagMs)} ms de retraso`);
}

console.log("Red móvil (retraso irregular y picos)");
{
  const r = run({ secs: 60, net: "movil", path: circle(8) });
  check(r.speedSd < 13, `la velocidad se desvía un ${f1(r.speedSd)} % (antes, un 63 %)`);
  check(r.lagMs < 520, `con ${f0(r.lagMs)} ms de retraso de media (antes, 607)`);
  check(r.frozen < 0.5, `clavada el ${f1(r.frozen)} % de los frames: si una muestra tarda, se sigue con la velocidad que llevaba (${f1(r.over)} % de los frames)`);
  check(r.maxJump < 0.3, `y sin saltos al llegar la que faltaba (el mayor paso, ${(r.maxJump * 100).toFixed(0)} cm)`);
  check(r.dropped === 0, "las muestras que llegan juntas tras un atasco no se tiran");
}

console.log("La página de quien mira se atasca 400 ms cada 8 s");
{
  const r = run({ secs: 50, net: "wifi", path: circle(8), stallEvery: 8000, stallMs: 400 });
  const base = run({ secs: 50, net: "wifi", path: circle(8) });
  check(Math.abs(r.delay - base.delay) < 25 && r.delayMax < base.delayMax + 40, `no cambia el retraso (${f0(r.delay)} ms con atascos, ${f0(base.delay)} sin ellos; antes subía a más de 600 y tardaba 25 s en volver)`);
}

console.log("Pararse en seco");
{
  const STOP = 9000;
  const r = run({ secs: 13, net: "wifi", path: runStop(STOP), from: 6000 });
  const end = 10 + (SPEED * STOP) / 1000;
  const past = Math.max(...r.trace.map((s) => s.x)) - end;
  check(past < 0.06, `no se pasa de donde se paró (${(past * 100).toFixed(1)} cm): la pose de «me he parado» llega a tiempo`);
  const arrive = r.trace.find((s) => s.x > end - 0.03)!;
  check(!!arrive && arrive.t - STOP < 420, `y llega allí ${arrive ? f0(arrive.t - STOP) : "?"} ms después de pararse`);
  const o = run({ secs: 13, net: "wifi", path: runStop(STOP), from: 6000, oldSender: true });
  const pastOld = Math.max(...o.trace.map((s) => s.x)) - end;
  const still = o.trace.filter((s) => s.t > STOP + 2500);
  check(pastOld < 0.85 && o.maxJump < 0.14, `con una web de antes (sin esa pose) se pasa ${(pastOld * 100).toFixed(0)} cm y vuelve sin saltos (el mayor paso, ${(o.maxJump * 100).toFixed(0)} cm)`);
  check(Math.abs(still[still.length - 1]!.x - end) < 0.01, "y acaba donde se paró");
}

console.log("Arrancar tras estar quieta");
{
  const START = 8000;
  const r = run({ secs: 14, net: "wifi", path: idleStart(START), from: 6000 });
  check(r.delayMax < 300, `el retraso no se dispara al empezar a moverse (como mucho ${f0(r.delayMax)} ms)`);
  const moving = r.trace.find((s) => s.x > 10.05)!;
  check(!!moving && moving.t - START < 380, `se la ve arrancar ${moving ? f0(moving.t - START) : "?"} ms después`);
  const late = r.trace.filter((s) => s.t > START + 1500);
  const lagLate = mean(late.map((s) => s.tx - s.x)) / SPEED * 1000;
  check(lagLate < 300, `y ya en marcha va ${f0(lagLate)} ms por detrás`);
}

console.log("Un servidor de antes (sin la hora de cada muestra) y un equipo lento");
{
  const r = run({ secs: 24, net: "wifi", path: circle(8), others: 3, oldServer: true });
  check(Number.isFinite(r.lagMs) && r.lagMs < 420 && r.frozen < 1, `se dibuja igual, con la hora del lote (${f0(r.lagMs)} ms, clavada el ${f1(r.frozen)} %)`);
  const slow = run({ secs: 24, net: "wifi", path: circle(8), sendFps: 20, drawFps: 24 });
  check(slow.speedSd < 6 && slow.lagMs < 330, `quien manda a 20 fps y quien mira a 24: uniforme (${f1(slow.speedSd)} %) y con ${f0(slow.lagMs)} ms`);
}

console.log("En el modo pelea, con alguien al lado: el doble de seguido");
{
  const r = run({ secs: 24, net: "wifi", path: circle(8), every: SEND_TIGHT_MS });
  check(r.sent > 9 && r.sent < 10.1, `${f1(r.sent)} poses por segundo`);
  check(r.lagMs < 190 && r.speedSd < 5, `y se la ve con ${f0(r.lagMs)} ms de retraso`);
}

console.log("Cuándo se manda la pose");
{
  const s = new PoseSender();
  let n = 0;
  for (let t = 0; t < 10_000; t += 16.7) if (s.due(t, true, false)) n++;
  check(n === 50, `moviéndose sin parar, cinco por segundo (${n} en 10 s)`);
  n = 0;
  const times: number[] = [];
  for (let t = 10_000; t < 14_000; t += 16.7) if (s.due(t, false, false)) times.push(t);
  check(times.length === 4 && times[0]! - 10_000 < 220 && times[1]! - times[0]! > 950, `al pararse, una más enseguida y después un latido por segundo (${times.map((t) => Math.round(t - 10_000)).join(", ")} ms)`);
  // Quieta, un gesto: sale en el mismo frame.
  const g = new PoseSender();
  for (let t = 0; t < 3000; t += 16.7) g.due(t, false, false);
  const before = 3000 - 16.7 * 2;
  g.due(before, false, false);
  check(g.due(before + 80, false, true), "un gesto estando quieta sale al momento, sin esperar a su turno");
  // Gestos sin parar mientras corre: de media no se manda más.
  const m = new PoseSender();
  n = 0;
  for (let t = 0; t < 10_000; t += 16.7) if (m.due(t, true, true)) n++;
  check(n <= 52, `y cambiando de gesto sin parar mientras corre no se manda más (${n} en 10 s)`);
  const tight = new PoseSender();
  n = 0;
  for (let t = 0; t < 10_000; t += 16.7) if (tight.due(t, true, false, SEND_TIGHT_MS)) n++;
  check(n >= 95 && n <= 100, `en el modo pelea con alguien al lado, diez por segundo (${n} en 10 s)`);
  // Fuera de turno (justo antes de avisar de «estoy aquí», p. ej. un punto de carrera en coche): el
  // servidor tiene que tener una pose de hace nada. O sale una ya, o es que se acaba de mandar.
  const f = new PoseSender();
  n = 0;
  let forced = 0, asks = 0, old = 0, lastSent = -Infinity, nextAsk = 730;
  for (let t = 0; t < 20_000; t += 16.7) {
    if (f.due(t, true, false)) {
      n++;
      lastSent = t;
    }
    if (t < nextAsk) continue;
    nextAsk += 1370;
    asks++;
    if (f.force(t)) {
      forced++;
      lastSent = t;
    } else if (t - lastSent > 70) old++;
  }
  check(old === 0 && forced > asks / 2, `antes de cada aviso, una pose de hace menos de 70 ms (${forced} fuera de turno en ${asks} avisos; las demás, recién mandadas)`);
  check(n + forced <= 104, `y con ellas no se manda más de la cuenta (${n + forced} en 20 s)`);
  const q = new PoseSender();
  q.due(0, true, false);
  check(!q.force(40) && q.force(80), "ni antes de 70 ms de la anterior");
}

console.log("La hora de cada muestra (servidor)");
{
  // Un reloj con otro origen; las muestras, cada 200 ms, llegan con retraso irregular.
  let c: PoseClock | undefined;
  const err: number[] = [];
  let future = 0, back = 0, prev = -Infinity;
  seed = 7;
  let lastArr = 0;
  for (let i = 0; i < 400; i++) {
    const taken = i * 200;
    const arr = (lastArr = Math.max(lastArr, taken + Math.max(10, 60 + 30 * gauss()) + (rnd() < 0.03 ? 300 : 0)));
    c = stampSample(c, taken - 9_999_999, arr);
    if (c.last > arr) future++;
    if (c.last <= prev) back++;
    prev = c.last;
    if (i > 20) err.push(c.last - taken);
  }
  check(sd(err) < 4 && future === 0 && back === 0, `con la red a rachas, cada una queda donde se tomó (±${f1(sd(err))} ms), nunca en el futuro ni antes que la anterior`);
  // Tres que llegan juntas tras un atasco conservan su separación.
  let b: PoseClock | undefined;
  for (let i = 0; i < 10; i++) b = stampSample(b, i * 200, 1000 + i * 200 + 30);
  const t1 = (b = stampSample(b, 2000, 3600)).last, t2 = (b = stampSample(b, 2200, 3600)).last, t3 = (b = stampSample(b, 2400, 3600)).last;
  check(Math.abs(t2 - t1 - 200) < 2 && Math.abs(t3 - t2 - 200) < 2 && t3 <= 3600, "las que llegan juntas tras un atasco conservan sus 200 ms");
  // Un reloj roto no mueve a nadie al pasado ni al futuro.
  let k: PoseClock | undefined;
  let bad = 0;
  for (let i = 0; i < 50; i++) {
    const now = 5000 + i * 200;
    k = stampSample(k, i % 7 === 3 ? -1e12 : i % 5 === 2 ? 1e15 : i * 200, now);
    if (k.last > now || k.last < now - SAMPLE_MAX_AGE_MS) bad++;
  }
  check(bad === 0, `un reloj que salta no saca ninguna muestra de su sitio (como mucho ${SAMPLE_MAX_AGE_MS} ms antes de llegar)`);
  // El tope de frecuencia.
  let tat: number | undefined, ok = 0;
  for (let t = 0; t < 10_000; t += 200) if ((tat = allowSample(tat, t, 15)) >= 0) ok++; else tat = undefined;
  check(ok === 50, "a 5 Hz pasan todas");
  let tat2: number | undefined, pass = 0;
  for (let i = 0; i < 4; i++) {
    const r = allowSample(tat2, 1000, 15);
    if (r >= 0) {
      pass++;
      tat2 = r;
    }
  }
  check(pass === 4, "cuatro que llegan a la vez tras un atasco, también");
  let tat3: number | undefined, fast = 0;
  for (let t = 0; t < 10_000; t += 1000 / 60) {
    const r = allowSample(tat3, t, 15);
    if (r >= 0) {
      fast++;
      tat3 = r;
    }
  }
  check(fast >= 148 && fast <= 156, `y quien manda a 60 por segundo se queda en 15 (${fast} en 10 s)`);
  check(batchGap(2, 105) === 0 && batchGap(6, 105) === 0 && batchGap(8, 105) === 40 && batchGap(20, 105) === 70 && batchGap(60, 105) === 105, "con poca gente las poses salen al momento; con mucha, en lotes");
}

console.log("El reloj del servidor visto desde aquí");
{
  const TRUE = 5_000_000;
  const c = new ServerClock();
  seed = 11;
  c.reset(TRUE - 350, 0); // el primer mensaje llegó tarde (la página estaba cargando)
  let ahead = 0, worst = 0, maxStep = 0;
  let t = 0;
  for (let i = 0; i < 3000; i++) {
    t += 16.7;
    if (i % 6 === 0) {
      // Un mensaje: tarda 20±5 ms, y a veces la página lo atiende 400 ms tarde.
      const d = Math.max(5, 20 + 5 * gauss()) + (i % 480 === 0 ? 400 : 0);
      c.sample(TRUE + t - d, t);
    }
    const before = c.offset;
    c.step(16.7);
    maxStep = Math.max(maxStep, Math.abs(c.offset - before));
    if (c.offset > TRUE + 0.001) ahead++;
    if (i > 1200) worst = Math.max(worst, TRUE - c.offset);
  }
  check(ahead === 0, "nunca adelanta al servidor");
  check(worst < 22, `se queda con el viaje más rápido: va ${f1(worst)} ms por detrás como mucho, aunque el primero llegara 350 ms tarde y la página se atasque`);
  check(maxStep < 0.4, `y se corrige poco a poco (${maxStep.toFixed(2)} ms por frame como mucho)`);
}

console.log("Mucha gente a la vez: a quién le toca cada frame");
{
  // Treinta personas en fila, cada una un metro más lejos; se dibuja a cada frame a las 5 más cercanas.
  const people = Array.from({ length: 30 }, (_, i) => {
    const e = joinCrowd({});
    e.d2 = (i + 1) ** 2;
    e.shown = true;
    return e;
  });
  const done = people.map(() => 0);
  const FRAMES = 600;
  for (let f = 0; f < FRAMES; f++) {
    crowdFrame(5, false, false);
    people.forEach((e, i) => void (e.skip || done[i]!++));
  }
  const share = (a: number, b: number) => done.slice(a, b).reduce((x, y) => x + y, 0) / ((b - a) * FRAMES);
  check(share(0, 5) === 1, "las 5 más cercanas, a cada frame");
  check(Math.abs(share(5, 10) - 1 / 2) < 0.01 && Math.abs(share(10, 30) - 1 / 3) < 0.01, `las 5 siguientes, a uno de cada dos; el resto, a uno de cada tres (${f1(share(5, 10) * 100)} % y ${f1(share(10, 30) * 100)} %)`);
  const total = done.reduce((x, y) => x + y, 0) / (30 * FRAMES);
  check(total < 0.5, `en total se anima y recalcula el ${f0(total * 100)} % de lo que costaría animarlas a todas`);
  // No les toca a todas en el mismo frame: el trabajo va repartido.
  let worst = 0;
  for (let f = 0; f < 60; f++) {
    crowdFrame(5, false, false);
    worst = Math.max(worst, people.filter((e) => !e.skip).length);
  }
  check(worst <= 16, `repartidas: en un frame trabajan ${worst} como mucho, no las 30`);
  // Quien pelea o está cayendo, siempre; quien no se dibuja no cuenta entre las cercanas.
  people[29]!.lively = true;
  people[0]!.shown = false;
  let ok = true, sixth = 0;
  for (let f = 0; f < 60; f++) {
    crowdFrame(5, false, false);
    if (people[29]!.skip || people[0]!.skip) ok = false;
    if (!people[5]!.skip) sixth++;
  }
  check(ok && sixth === 60, "quien pelea va a cada frame aunque esté lejos, y si la más cercana deja de dibujarse, la sexta pasa a ir a cada frame");
  for (const e of people) leaveCrowd(e);
  const few = Array.from({ length: 4 }, (_, i) => {
    const e = joinCrowd({});
    e.d2 = i * 50;
    e.shown = true;
    return e;
  });
  let skipped = 0;
  for (let f = 0; f < 30; f++) {
    crowdFrame(5, false, false);
    skipped += few.filter((e) => e.skip).length;
  }
  check(skipped === 0, "con poca gente, todo el mundo a cada frame");
  for (const e of few) leaveCrowd(e);
}

console.log(fails ? `\n${fails} fallo(s)` : "\nmultijugador: todo bien");
process.exit(fails ? 1 : 0);
