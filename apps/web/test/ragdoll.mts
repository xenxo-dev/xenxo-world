/**
 * Prueba de las caídas con física sin navegador (Rapier en Node): un cuerpo de pie que recibe un
 * golpe cae, se para en el suelo sin atravesarlo ni deshacerse (articulaciones juntas y dentro de
 * su recorrido), cae boca arriba si le dan de frente, no atraviesa una pared, se
 * da la vuelta si cae boca abajo y, fuera de combate, se desploma casi donde estaba; y la gente de
 * decorado (golpes y atropellos, también contra una pared).
 *
 *   npm run test:ragdoll -w @xenxo/web
 */
import { loadRapier, type SolidBox, type StaticSource } from "../src/world/vehicle/physics.ts";
import { RagdollWorld } from "../src/world/people/ragdoll-sim.ts";
import type { Q4, RagdollHandle, RagdollJoint, RagdollPart, RagdollSpec, V3 } from "../src/world/people/ragdoll.ts";
import { JOINT_LIMITS, type FallSpec } from "../src/world/people/rig.ts";
import { npcFallFor } from "../src/world/people/fight.ts";

const boxes: SolidBox[] = [];
const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => boxes.push({ x, y, z, hx, hy, hz, c: 1, s: 0 });
box(0, -0.05, 0, 100, 0.05, 100);
// Una pared a 1,2 m por delante (en −Z) del sitio de la prueba de la pared.
box(20, 1.5, -1.2, 3, 1.5, 0.1);
// Y otra a 3 m (en +Z) de la del atropello contra una pared.
box(-80, 1.5, 3, 3, 1.5, 0.1);
const source: StaticSource = { version: () => 1, boxes: (cb) => boxes.forEach(cb), meshes: () => {}, bounds: () => [-90, 90] };

const R = await loadRapier();
const sim = new RagdollWorld(R, source, () => 8);
let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};

/* --- Un cuerpo de referencia de pie (huesos normalizados: en T todos sin giro; brazos abajo) --- */
const DEG = Math.PI / 180;
const qz = (deg: number): Q4 => [0, 0, Math.sin((deg * DEG) / 2), Math.cos((deg * DEG) / 2)];
const ID: Q4 = [0, 0, 0, 1];
const qmul = (a: Q4, b: Q4): Q4 => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const conj = (a: Q4): Q4 => [-a[0], -a[1], -a[2], a[3]];
const rot = (a: Q4, v: V3): V3 => {
  const p = qmul(qmul(a, [v[0], v[1], v[2], 0]), conj(a));
  return [p[0], p[1], p[2]];
};
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const PARENT = [-1, 0, 1, 2, 2, 4, 2, 6, 0, 8, 0, 10];
function body(x: number, z: number, yaw = 0) {
  const qy: Q4 = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const P = (v: V3): V3 => add(rot(qy, v), [x, 0, z]);
  // Posiciones de los huesos (mirando a +Z, la izquierda en +X) y su giro en el mundo.
  const at: V3[] = [
    [0, 0.95, 0], [0, 1.05, -0.01], [0, 1.2, 0], [0, 1.55, 0.01],
    [0.18, 1.42, 0], [0.19, 1.16, 0], [-0.18, 1.42, 0], [-0.19, 1.16, 0],
    [0.1, 0.92, 0], [0.1, 0.5, 0.01], [-0.1, 0.92, 0], [-0.1, 0.5, 0.01],
  ];
  const ends: V3[] = [
    [-0.1, 0.92, 0], [0, 1.2, 0], [0, 1.47, 0], [0, 1.77, 0.02],
    [0.19, 1.16, 0], [0.2, 0.86, 0.02], [-0.19, 1.16, 0], [-0.2, 0.86, 0.02],
    [0.1, 0.5, 0.01], [0.1, 0.08, 0], [-0.1, 0.5, 0.01], [-0.1, 0.08, 0],
  ];
  const starts: V3[] = [[0.1, 0.92, 0], ...at.slice(1)];
  const quat: Q4[] = at.map((_, i) => qmul(qy, i === 4 || i === 5 ? qz(-90) : i === 6 || i === 7 ? qz(90) : ID));
  const radius = [0.105, 0.11, 0.125, 0.1, 0.048, 0.04, 0.048, 0.04, 0.072, 0.052, 0.072, 0.052];
  const parts: RagdollPart[] = at.map((p, i) => {
    const inv = conj(quat[i]!);
    const pos = P(p);
    return {
      pos,
      quat: quat[i]!,
      a: rot(inv, sub(P(starts[i]!), pos)),
      b: rot(inv, sub(P(ends[i]!), pos)),
      r: radius[i]!,
      density: i === 3 ? 1000 : 900,
      ...(i === 9 || i === 11 ? { extra: { at: rot(inv, sub(P([i === 9 ? 0.1 : -0.1, 0.03, 0.12]), pos)), r: 0.045 } } : {}),
    };
  });
  const local = (i: number) => qmul(conj(quat[PARENT[i]!]!), quat[i]!);
  const j = (child: number, extra: Partial<RagdollJoint>): RagdollJoint => ({
    child,
    parent: PARENT[child]!,
    anchor: parts[child]!.pos,
    frame: ID,
    target: local(child),
    ...extra,
  });
  const joints = JOINT_LIMITS.map(([child, l]) => j(child, l));
  return { parts, joints };
}

/** Golpe hacia `dir` (horizontal) como en fight.ts: tres cuartos a todo el cuerpo y el resto a la cabeza y el pecho. */
function spec(x: number, z: number, dir: [number, number], horiz: number, up: number, tone: number, toneMin: number, yaw = 0): RagdollSpec {
  const { parts, joints } = body(x, z, yaw);
  const share: [number, number][] = [[3, 0.3], [2, 0.7]];
  const kick = 70 * 0.25;
  return {
    parts,
    joints,
    vel: [dir[0] * horiz * 0.75, up * 0.75, dir[1] * horiz * 0.75],
    impulses: share.map(([part, k]) => ({ part, point: parts[part]!.pos, vec: [dir[0] * horiz * kick * k, up * kick * k, dir[1] * horiz * kick * k] as V3 })),
    tone,
    toneMin,
    toneTau: 0.35,
    bounce: 0.04,
    friction: 1,
  };
}

const run = (secs: number, each?: () => void) => {
  for (let t = 0; t < secs; t += 1 / 60) {
    sim.step(1 / 60);
    each?.();
  }
};
const at = (d: RagdollHandle, i: number): V3 => [d.pos[i * 3]!, d.pos[i * 3 + 1]!, d.pos[i * 3 + 2]!];
const q = (d: RagdollHandle, i: number): Q4 => [d.quat[i * 4]!, d.quat[i * 4 + 1]!, d.quat[i * 4 + 2]!, d.quat[i * 4 + 3]!];
/** Hacia dónde mira el pecho (su +Z) en vertical: > 0 boca arriba. */
const face = (d: RagdollHandle) => rot(q(d, 2), [0, 0, 1])[1];
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Separación de cada articulación (m): el ancla vista desde el padre y desde el hijo. */
function maxGap(d: RagdollHandle, s: RagdollSpec) {
  let worst = 0;
  for (const j of s.joints) {
    const pa = s.parts[j.parent]!, ch = s.parts[j.child]!;
    const la = rot(conj(pa.quat), sub(j.anchor, pa.pos));
    const lb = rot(conj(ch.quat), sub(j.anchor, ch.pos));
    const wa = add(rot(q(d, j.parent), la), at(d, j.parent));
    const wb = add(rot(q(d, j.child), lb), at(d, j.child));
    worst = Math.max(worst, Math.hypot(...sub(wa, wb)));
  }
  return worst;
}
/** Cada articulación dentro de su recorrido (con 15° de margen): bisagras y rótulas, eje por eje. */
function jointsOk(d: RagdollHandle, s: RagdollSpec) {
  const m = 15 * DEG;
  for (const j of s.joints) {
    const local = qmul(conj(q(d, j.parent)), q(d, j.child));
    if (local[3] < 0) for (let i = 0; i < 4; i++) local[i] = -local[i]!;
    if (j.hinge) {
      const sn = local[0] * j.hinge[0] + local[1] * j.hinge[1] + local[2] * j.hinge[2];
      const ang = 2 * Math.atan2(sn, local[3]);
      const [lo, hi] = j.range!;
      if (ang < lo - m || ang > hi + m) return `bisagra ${j.child}: ${Math.round(ang / DEG)}°`;
    } else {
      // Como lo mide Rapier: el seno del medio ángulo en cada eje.
      for (let a = 0; a < 3; a++) {
        const ang = 2 * Math.asin(Math.max(-1, Math.min(1, local[a]!)));
        if (ang < j.min![a]! - m || ang > j.max![a]! + m) return `rótula ${j.child} eje ${"xyz"[a]}: ${Math.round(ang / DEG)}°`;
      }
    }
  }
  return "";
}
const lowest = (d: RagdollHandle) => Math.min(...Array.from({ length: 12 }, (_, i) => d.pos[i * 3 + 1]!));

// 1) Golpe de frente (le empuja hacia atrás, −Z → +Z... mira a +Z: atrás es −Z).
{
  const s = spec(0, 0, [0, -1], 3.4, 0.6, 0.75, 0.04);
  const d = sim.spawn(s)!;
  let low = 9, gap = 0;
  run(3.5, () => {
    low = Math.min(low, lowest(d));
    gap = Math.max(gap, maxGap(d, s));
  });
  const hips = at(d, 0);
  console.log(`de frente: cadera (${r2(hips[0])}, ${r2(hips[1])}, ${r2(hips[2])}), pecho hacia arriba ${r2(face(d))}, quieto ${r2(d.still)} s, lo más bajo ${r2(low)} m, separación máx. ${r2(gap * 100)} cm`);
  check(hips[1] < 0.35, "acaba en el suelo");
  check(hips[2] < -0.4, "sale hacia donde le empujan");
  check(low > -0.06, "no atraviesa el suelo");
  check(gap < 0.04, "las articulaciones no se separan");
  check(face(d) > 0.3, "cae boca arriba");
  check(d.still > 0.3, "se queda quieto");
  const bad = jointsOk(d, s);
  check(!bad, `articulaciones dentro de su recorrido${bad ? ` (${bad})` : ""}`);
  d.remove();
}

// 2) Contra una pared: no la atraviesa.
{
  const s = spec(20, 0, [0, -1], 7, 0.6, 0.5, 0.04);
  const d = sim.spawn(s)!;
  let minZ = 9;
  run(3, () => {
    for (let i = 0; i < 12; i++) minZ = Math.min(minZ, d.pos[i * 3 + 2]!);
  });
  console.log(`pared: lo más lejos z=${r2(minZ)} (pared en −1,1)`);
  check(minZ > -1.15, "no atraviesa la pared");
  d.remove();
}

// 3) Por la espalda: boca abajo; y se da la vuelta.
{
  const s = spec(40, 0, [0, 1], 4, 0.6, 0.7, 0.04);
  const d = sim.spawn(s)!;
  run(3);
  const before = face(d);
  d.roll(1);
  let turned = 0;
  run(1.4, () => {
    if (!turned && face(d) > 0.35) turned = d.age;
  });
  d.roll(0);
  run(0.6);
  console.log(`por la espalda: pecho ${r2(before)} → ${r2(face(d))}; se da la vuelta a los ${r2(turned)} s`);
  check(before < -0.3, "cae boca abajo");
  check(face(d) > 0.3, "se da la vuelta (boca arriba)");
  d.remove();
}

// 4) Fuera de combate: se le doblan las rodillas y se desploma casi donde estaba (como en fight.ts).
{
  const s = spec(60, 0, [0, -1], 0, 0, 0.12, 0.02);
  s.vel = [0, 0, 0];
  s.impulses = [
    { part: 2, point: s.parts[2]!.pos, vec: [0, 0, -14] },
    { part: 9, point: s.parts[9]!.pos, vec: [0, 0, 5] },
    { part: 11, point: s.parts[11]!.pos, vec: [0, 0, 5] },
  ];
  const d = sim.spawn(s)!;
  run(3);
  const hips = at(d, 0);
  const moved = Math.hypot(hips[0] - 60, hips[2]);
  console.log(`fuera de combate: cadera a ${r2(moved)} m, altura ${r2(hips[1])} m`);
  check(hips[1] < 0.4, "se desploma");
  check(moved < 1.1, "casi donde estaba (no sale despedido)");
  d.remove();
}

// 5) La gente de decorado (knock.ts): un golpe que la tira y atropellos, también contra una pared.
//    En un atropello las articulaciones pueden abrirse un instante al rodar (el personaje no lo nota:
//    de la física solo toma los giros); lo que cuenta es que no salga lanzado y acabe entero y quieto.
{
  /** Como rig.ts: cada impulso en el centro de su cápsula. */
  const fromFall = (x: number, z: number, f: FallSpec, yaw = 0): RagdollSpec => {
    const { parts, joints } = body(x, z, yaw);
    const center = (i: number) => add(parts[i]!.pos, rot(parts[i]!.quat, [(parts[i]!.a[0] + parts[i]!.b[0]) / 2, (parts[i]!.a[1] + parts[i]!.b[1]) / 2, (parts[i]!.a[2] + parts[i]!.b[2]) / 2]));
    return { parts, joints, vel: f.vel, impulses: f.impulses.map((im) => ({ part: im.part, point: center(im.part), vec: im.vec })), tone: f.tone, toneMin: f.toneMin, toneTau: f.toneTau, bounce: f.bounce, friction: 1 };
  };
  const cases: [string, number, [number, number], number, [number, number]][] = [
    ["gancho a un peatón", -20, [0, -1], 3.2, [0.3, 3]],
    ["atropello de lado a 8 m/s", -40, [1, 0], 8, [1.5, 8]],
    ["atropello de frente a 20 m/s", -60, [0, -1], 20, [3, 12]],
  ];
  for (const [name, x, dir, speed, [lo, hi]] of cases) {
    const s = fromFall(x, 0, npcFallFor(dir[0], dir[1], speed, false, 0, 0));
    const d = sim.spawn(s)!;
    let low = 9, gap = 0, end = 0, launch = 0, n = 0;
    run(5, () => {
      n++;
      low = Math.min(low, lowest(d));
      const g = maxGap(d, s);
      gap = Math.max(gap, g);
      if (n > 4 * 60) end = Math.max(end, g);
      if (n > 2.5 * 60) launch = Math.max(launch, d.pos[1]!);
    });
    const hips = at(d, 0);
    const moved = (hips[0] - x) * dir[0] + hips[2] * dir[1];
    console.log(`${name}: cadera a ${r2(moved)} m (altura ${r2(hips[1])}), quieto ${r2(d.still)} s, lo más bajo ${r2(low)} m, separación máx. ${r2(gap * 100)} cm (al final ${r2(end * 100)})`);
    check(hips[1] < 0.35, `${name}: acaba en el suelo`);
    check(moved > lo && moved < hi, `${name}: sale hacia donde le dan, sin pasarse (${lo}–${hi} m)`);
    check(low > -0.06, `${name}: no atraviesa el suelo`);
    check(launch < 0.6, `${name}: ya en el suelo, no sale lanzado`);
    check(end < 0.02, `${name}: acaba entero (articulaciones juntas)`);
    check(d.still > 0.3, `${name}: se queda quieto`);
    const bad = jointsOk(d, s);
    check(!bad, `${name}: articulaciones dentro de su recorrido${bad ? ` (${bad})` : ""}`);
    d.remove();
  }
  // Contra una pared (a 3 m): el atropello más fuerte no la atraviesa.
  {
    const s = fromFall(-80, 0, npcFallFor(0, 1, 25, false, 0, 0));
    const d = sim.spawn(s)!;
    let maxZ = -9;
    run(3, () => {
      for (let i = 0; i < 12; i++) maxZ = Math.max(maxZ, d.pos[i * 3 + 2]!);
    });
    console.log(`atropello contra una pared: lo más lejos z=${r2(maxZ)} (pared en 2,9)`);
    check(maxZ < 2.95, "atropellado, no atraviesa la pared");
    d.remove();
  }
  // Muchos atropellos (de cualquier lado, a cualquier velocidad): ninguno sale lanzado ni acaba roto.
  {
    let launched = 0, broken = 0, far = 0, total = 0;
    for (const yaw of [0, 1.3, 2.6, 3.9, 5.2])
      for (const [dx, dz] of [[0, -1], [0, 1], [1, 0], [-1, 0], [0.707, 0.707], [-0.707, 0.707]])
        for (const speed of [6, 12, 20]) {
          const s = fromFall(-30, -40, npcFallFor(dx!, dz!, speed, false, 0, 0), yaw);
          const d = sim.spawn(s)!;
          let up = 0, n = 0;
          run(4.5, () => {
            if (++n > 2.5 * 60) up = Math.max(up, d.pos[1]!);
          });
          total++;
          if (up > 0.6) launched++;
          if (jointsOk(d, s)) broken++;
          if (Math.hypot(d.pos[0]! + 30, d.pos[2]! + 40) > 13) far++;
          d.remove();
        }
    console.log(`${total} atropellos: ${launched} lanzados, ${broken} con una articulación fuera de su recorrido, ${far} a más de 13 m`);
    check(launched === 0, "atropellos: ninguno sale lanzado del suelo");
    check(broken <= 1, "atropellos: acaban con las articulaciones en su recorrido");
    check(far === 0, "atropellos: ninguno sale disparado a más de 13 m");
  }
}

// 6) Coste: cuatro a la vez.
{
  const dolls = [0, 1, 2, 3].map((k) => sim.spawn(spec(80 + k * 3, 0, [0, -1], 4, 1, 0.75, 0.04))!);
  const t0 = performance.now();
  run(2);
  const ms = (performance.now() - t0) / 120;
  console.log(`coste: ${ms.toFixed(3)} ms por frame con 4 cayendo`);
  check(ms < 3, "menos de 3 ms por frame (en Node)");
  dolls.forEach((d) => d.remove());
  check(sim.active === 0, "se quitan del mundo");
}

console.log(fails ? `\n${fails} comprobación(es) fallida(s)` : "\ntodo bien");
process.exit(fails ? 1 : 0);
