/**
 * Prueba de la gente de las ciudades sin navegador (city/nav.ts y city/citizens.ts en Node, con un
 * mundo de mentira: cajas de la ciudad, suelo plano, golpes que duran un poco):
 *
 *   - el mapa de cada distrito: grande, unido y sin atravesar paredes (los caminos entre sitios);
 *   - contestan a un saludo, te siguen si los llamas con la mano, saltan a un lado si viene el coche,
 *     te tienen miedo y se van si les pegas (y después no quieren chocar los cinco), chocan los cinco
 *     si les apetece, se dejan empujar;
 *   - no se pisan entre ellos, no se quedan atascados, nada se vuelve NaN y van a sus sitios.
 *
 *   npm run test:citizens -w @xenxo/web
 */
import * as THREE from "three";
import { buildNav, clearLine, findPath, type Box2, type CityNav } from "../src/world/city/nav.ts";
import { CitySim, type CarInfo, type CityEnv, type Citizen, type Remote } from "../src/world/city/citizens.ts";
import type { Body } from "../src/world/locomotion.ts";

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};

/* --- El mapa --- */
console.log("Mapa de cada distrito:");
const rnd = (() => {
  let a = 12345;
  return () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
})();
for (const id of ["arcade", "pixel", "taller", "cero", "vertical"]) {
  const nav = buildNav(id)!;
  const linked = nav.nodes.filter((n) => n.links.length).length;
  let found = 0, clear = 0, total = 0;
  for (let k = 0; k < 80; k++) {
    const a = nav.pois[Math.floor(rnd() * nav.pois.length)]!, b = nav.pois[Math.floor(rnd() * nav.pois.length)]!;
    const path = findPath(nav, a.node, b.node);
    if (!path) continue;
    found++;
    let ok = true;
    let prev = nav.nodes[a.node]!;
    for (const i of path) {
      const n = nav.nodes[i]!;
      if (!(prev.stairs && n.stairs) && !clearLine(nav.boxes, prev.x, prev.z, n.x, n.z, Math.min(prev.y, n.y), 0.2)) ok = false;
      prev = n;
    }
    total++;
    if (ok) clear++;
  }
  check(linked > 100 && nav.pois.length >= 20, `${id}: ${linked} puntos unidos y ${nav.pois.length} sitios`);
  check(found === 80 && clear === total, `${id}: caminos entre sitios encontrados ${found}/80, sin atravesar paredes ${clear}/${total}`);
}

/* --- Un mundo de mentira --- */
interface Fake {
  env: CityEnv;
  sim: CitySim;
  nav: CityNav;
  car: CarInfo | null;
  pairs: string[];
  knockUntil: Float64Array;
}

function circleOut(boxes: readonly Box2[], p: { x: number; z: number }, r: number, y: number) {
  for (let pass = 0; pass < 2; pass++)
    for (const b of boxes) {
      if (b.y1 < y + 0.45 || b.y0 > y + 1.35) continue;
      const dx = p.x - b.x, dz = p.z - b.z;
      if (dx * dx + dz * dz > (b.r + r) ** 2) continue;
      const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
      const cx = Math.max(-b.hx, Math.min(b.hx, lx)), cz = Math.max(-b.hz, Math.min(b.hz, lz));
      let nx = lx - cx, nz = lz - cz;
      const d2 = nx * nx + nz * nz;
      if (d2 >= r * r) continue;
      let push: number;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        nx /= d;
        nz /= d;
        push = r - d;
      } else {
        const ex = b.hx - Math.abs(lx), ez = b.hz - Math.abs(lz);
        if (ex < ez) (nx = Math.sign(lx) || 1), (nz = 0), (push = ex + r);
        else (nx = 0), (nz = Math.sign(lz) || 1), (push = ez + r);
      }
      p.x += (nx * b.c + nz * b.s) * push;
      p.z += (-nx * b.s + nz * b.c) * push;
    }
}

function makeWorld(id: string, count?: number): Fake {
  const nav = buildNav(id)!;
  const npcs = { count: 0, pos: new Float32Array(64 * 3), knock: new Float32Array(64 * 4) };
  const f = { car: null as CarInfo | null, pairs: [] as string[], knockUntil: new Float64Array(64) } as Fake;
  const p = { x: 0, z: 0 };
  const env: CityEnv = {
    me: { x: -200, y: 0, z: -200, yaw: 0, vx: 0, vz: 0, wx: 0, wz: 0, emote: null, driving: false, fight: false },
    sync() {},
    remotes: (_out: Remote[]) => 0,
    car: () => f.car,
    step(b: Body, wantX: number, wantZ: number, dt: number) {
      // Como locomotion.stepBody (acelerar, paredes, gravedad), con el suelo plano.
      const a = Math.min(1, (b.grounded ? 11 : 2.2) * dt);
      b.vx += (wantX - b.vx) * a;
      b.vz += (wantZ - b.vz) * a;
      const px = b.x, pz = b.z;
      p.x = b.x + b.vx * dt;
      p.z = b.z + b.vz * dt;
      circleOut(nav.boxes, p, 0.32, b.y);
      b.x = p.x;
      b.z = p.z;
      b.vx = (b.x - px) / dt;
      b.vz = (b.z - pz) / dt;
      if (!b.grounded) {
        b.airTime += dt;
        b.vy -= 15 * dt;
        b.y += b.vy * dt;
        if (b.y <= 0) (b.y = 0), (b.vy = 0), (b.grounded = true), (b.airTime = 0);
      }
    },
    knock(i, g, x, y, z) {
      if (npcs.knock[i * 4]) {
        g.position.set(x + npcs.knock[i * 4 + 1]! * 0.8, y, z + npcs.knock[i * 4 + 2]! * 0.8);
        npcs.knock[i * 4] = 0;
        f.knockUntil[i] = f.sim.clock + 1.5;
      }
      return f.sim.clock < f.knockUntil[i]!;
    },
    knockReset() {},
    pair: (_kind, key) => void f.pairs.push(key),
    npcs,
  };
  f.env = env;
  f.nav = nav;
  f.sim = new CitySim(nav, env, count ?? (id === "cero" ? 14 : 10));
  f.sim.attach();
  f.sim.drawnMax = 8;
  for (const c of f.sim.cast) {
    c.group = new THREE.Object3D();
    c.ready = true;
  }
  return f;
}

const run = (f: Fake, seconds: number, each?: () => void) => {
  for (let k = 0; k < seconds * 60; k++) {
    f.sim.frame(1 / 60);
    each?.();
  }
};
/** Pone a un ciudadano en (x, z) mirando a `yaw`, quieto (sin camino) y a los demás lejos. */
function stage(f: Fake, c: Citizen, x: number, z: number, yaw: number) {
  for (const o of f.sim.cast) {
    if (o.poi && o.poi.taken === o.id) o.poi.taken = -1;
    o.poi = null;
    o.doing = "travel";
    o.arriving = false;
    o.path = [];
    o.pi = 0;
    o.motion.emote = null;
    o.fear = 0;
    o.grudge = -1;
    const far = o === c ? 0 : 70 + o.id * 3;
    o.body.x = x + far;
    o.body.z = z + far;
    o.body.y = 0;
    o.body.vx = o.body.vz = 0;
  }
  c.yaw = yaw;
}
const facing = (x: number, z: number) => Math.atan2(-x, -z);
const me = (f: Fake) => f.env.me;

/* --- Contestan --- */
console.log("Ciudadanos (Arcade):");
{
  const f = makeWorld("arcade");
  const nav = f.nav;
  // Una esquina de la calle con sitio alrededor: el punto del mapa más cercano a (13.5, -1).
  const spot = nav.nodes.reduce((a, n) => (n.links.length && Math.hypot(n.x - 13.5, n.z + 1) < Math.hypot(a.x - 13.5, a.z + 1) ? n : a));
  const c = f.sim.cast[0]!;
  c.social = 0.9;
  c.bold = 0.4;
  stage(f, c, spot.x, spot.z, 0);
  Object.assign(me(f), { x: spot.x, z: spot.z + 3, yaw: facing(0, -1) });
  c.yaw = facing(0, 1);
  run(f, 0.6);
  check(c.drawn, "se dibuja al tenerlo cerca");
  me(f).emote = "wave";
  run(f, 1.2);
  me(f).emote = null;
  check(c.motion.gesture === "wave" && (c.speech === "npc.hi" || c.speech === "npc.hey"), `saludas y te saluda (${c.motion.gesture}, ${c.speech})`);
  check(c.motion.fx!.look.w > 0.5 && Math.abs(c.motion.fx!.look.z - me(f).z) < 0.1, "y te mira");
  run(f, 3);

  // Llamarle con la mano: te sigue mientras andas.
  me(f).emote = "beckon";
  run(f, 0.3);
  me(f).emote = null;
  check(c.doing === "follow" && c.speech === "npc.coming", `le llamas con la mano y viene (${c.doing})`);
  const startD = Math.hypot(c.body.x - me(f).x, c.body.z - me(f).z);
  // Andas 9 m por la calle (sin cajas en medio).
  for (let k = 0; k < 9 * 60 / 1.8; k++) {
    const m = me(f);
    const step = 1.8 / 60;
    const nz = m.z - step;
    const ok = clearLine(nav.boxes, m.x, m.z, m.x, nz, 0, 0.3);
    if (ok) m.z = nz;
    m.vz = ok ? -1.8 : 0;
    m.yaw = facing(0, -1);
    f.sim.frame(1 / 60);
  }
  me(f).vz = 0;
  run(f, 2);
  const endD = Math.hypot(c.body.x - me(f).x, c.body.z - me(f).z);
  check(c.doing === "follow" && endD < 3, `te sigue al andar (a ${startD.toFixed(1)} m al llamarle, a ${endD.toFixed(1)} m al pararte)`);
  run(f, 14);
  check(c.doing !== "follow", `si te quedas parado, se cansa y sigue a lo suyo (${c.doing})`);

  // El coche: viene derecho hacia él.
  stage(f, c, spot.x, spot.z, 0);
  Object.assign(me(f), { x: spot.x + 30, z: spot.z + 30, driving: true });
  run(f, 0.5);
  const sx = c.body.x, sz = c.body.z;
  f.car = { x: spot.x - 12, z: spot.z, fx: 1, fz: 0, speed: 13 };
  let dodged = false, flew = false;
  for (let k = 0; k < 60; k++) {
    f.car.x += f.car.fx * f.car.speed / 60;
    f.sim.frame(1 / 60);
    if (c.doing === "dodge") dodged = true;
    if (!c.body.grounded) flew = true;
  }
  f.car = null;
  const lateral = Math.abs(c.body.z - sz);
  check(dodged && flew && lateral > 1, `viene el coche y salta a un lado (${lateral.toFixed(2)} m, ${Math.abs(c.body.x - sx).toFixed(2)} m a lo largo)`);
  run(f, 1.5);
  check(c.fear > 0.15 && (c.speech === "npc.careful" || c.speech === "npc.crazy" || c.motion.gesture === "shake_head"), `y se queja (miedo ${c.fear.toFixed(2)})`);
  me(f).driving = false;

  // Chocar los cinco.
  const d = f.sim.cast[1]!;
  d.social = 0.8;
  stage(f, d, spot.x, spot.z, facing(0, 1));
  Object.assign(me(f), { x: spot.x, z: spot.z + 1.4, yaw: facing(0, -1), fight: false });
  run(f, 0.5);
  const ok = f.sim.offerPair("high_five");
  check(ok && d.doing === "pair" && f.pairs.at(-1) === d.key, "le propones chocar los cinco y acepta");
  run(f, 2.2);
  check(d.doing !== "pair" && d.friend > f.sim.clock && d.speech === "npc.ok", `al acabar, contento (${d.speech})`);

  // Le pegas (modo pelea): miedo, rencor y se va.
  Object.assign(me(f), { fight: true });
  const i = d.slot;
  f.env.npcs.knock[i * 4] = 1;
  f.env.npcs.knock[i * 4 + 1] = 0;
  f.env.npcs.knock[i * 4 + 2] = -1;
  f.env.npcs.knock[i * 4 + 3] = 3.2;
  run(f, 0.2);
  check(d.knocked, "le das y cae (knock.ts manda)");
  run(f, 1.6);
  const d0 = Math.hypot(d.body.x - me(f).x, d.body.z - me(f).z);
  check(!d.knocked && d.fear > 0.35 && d.grudge > f.sim.clock, `se levanta con miedo (${d.fear.toFixed(2)}) y rencor`);
  run(f, 3);
  const d1 = Math.hypot(d.body.x - me(f).x, d.body.z - me(f).z);
  check(d1 > d0 + 2, `se va lejos de ti (de ${d0.toFixed(1)} a ${d1.toFixed(1)} m; ${d.doing})`);
  me(f).fight = false;
  // Y ya no quiere chocar los cinco.
  stage(f, d, spot.x, spot.z, facing(0, 1));
  d.grudge = f.sim.clock + 60;
  Object.assign(me(f), { x: spot.x, z: spot.z + 1.4, yaw: facing(0, -1) });
  run(f, 0.5);
  const before = f.pairs.length;
  f.sim.offerPair("high_five");
  run(f, 0.6);
  check(f.pairs.length === before && (d.speech === "npc.no" || d.speech === "npc.leave") && d.motion.gesture === "shake_head", `después no quiere (${d.speech})`);

  // Empujarle: te echas encima andando y se aparta a tu paso.
  const e = f.sim.cast[2]!;
  stage(f, e, spot.x, spot.z, 0);
  d.grudge = -1;
  Object.assign(me(f), { x: spot.x, z: spot.z + 0.66, yaw: facing(0, -1), wx: 0, wz: -2.1 });
  run(f, 0.4);
  const ez = e.body.z;
  for (let k = 0; k < 60; k++) {
    // Tú avanzas lo que te deja (pegado a él).
    me(f).z = Math.min(me(f).z, e.body.z + 0.62);
    f.sim.frame(1 / 60);
  }
  Object.assign(me(f), { wx: 0, wz: 0 });
  check(ez - e.body.z > 0.6, `le empujas y se aparta (${(ez - e.body.z).toFixed(2)} m en 1 s)`);
}

/* --- Muchos a la vez --- */
console.log("Todos juntos:");
for (const id of ["arcade", "taller", "pixel", "vertical"]) {
  const f = makeWorld(id);
  // Tú en medio de la ciudad: todos cerca, con física.
  Object.assign(f.env.me, { x: 31, y: 0, z: 31 });
  let minD = Infinity, nan = false, stayed = new Set<number>();
  const still = new Float32Array(f.sim.cast.length);
  const lx = new Float32Array(f.sim.cast.length), lz = new Float32Array(f.sim.cast.length);
  let worstStill = 0;
  const t0 = performance.now();
  run(f, 120, () => {
    const cast = f.sim.cast;
    for (let a = 0; a < cast.length; a++) {
      const c = cast[a]!;
      if (!Number.isFinite(c.body.x + c.body.y + c.body.z + c.yaw)) nan = true;
      if (c.doing === "stay") stayed.add(c.id);
      // Andando y sin moverse: ¿cuánto tiempo seguido?
      const moved = Math.hypot(c.body.x - lx[a]!, c.body.z - lz[a]!);
      lx[a] = c.body.x;
      lz[a] = c.body.z;
      still[a] = c.doing === "travel" && !c.arriving && c.pi < c.path.length && moved < 0.002 ? still[a]! + 1 / 60 : 0;
      worstStill = Math.max(worstStill, still[a]!);
      if (!c.near || c.knocked || c.doing === "stay" || c.arriving) continue;
      for (let b = a + 1; b < cast.length; b++) {
        const o = cast[b]!;
        if (!o.near || o.knocked || o.doing === "stay" || o.arriving || Math.abs(o.body.y - c.body.y) > 1) continue;
        minD = Math.min(minD, Math.hypot(o.body.x - c.body.x, o.body.z - c.body.z));
      }
    }
  });
  const ms = (performance.now() - t0) / (120 * 60);
  check(!nan, `${id}: nada se vuelve NaN en 2 min`);
  check(minD > 0.55, `${id}: no se pisan (lo más cerca, ${minD.toFixed(2)} m)`);
  check(worstStill < 6, `${id}: nadie atascado (lo más que alguien ha estado sin poder avanzar: ${worstStill.toFixed(1)} s)`);
  check(stayed.size >= f.sim.cast.length * 0.7, `${id}: van a sus sitios (${stayed.size}/${f.sim.cast.length} han estado en uno)`);
  check(ms < 1.5, `${id}: ${ms.toFixed(3)} ms por frame`);
}
{
  // Distrito Cero, lejos: siguen su día por el mapa (y por la pasarela) sin física.
  const f = makeWorld("cero");
  const stayed = new Set<number>();
  let high = false, nan = false;
  run(f, 240, () => {
    for (const c of f.sim.cast) {
      if (c.doing === "stay") stayed.add(c.id);
      if (c.body.y > 7) high = true;
      if (!Number.isFinite(c.body.x + c.body.y + c.body.z)) nan = true;
    }
  });
  check(!nan && stayed.size >= 10, `cero: ${stayed.size}/14 han estado en un sitio en 4 min`);
  check(high, "cero: alguien ha subido a la pasarela");
  const kinds = new Set(f.sim.cast.filter((c) => c.poi).map((c) => c.poi!.kind));
  console.log(`    ahora: ${[...kinds].join(", ")}`);
}

console.log(fails ? `\n${fails} fallo(s)` : "\nTodo bien");
process.exit(fails ? 1 : 0);
