/**
 * Prueba del parkour de Vertical sin navegador (world/parkour/moves.ts sobre las colisiones de
 * verdad, world/collision.ts): saltar una valla, subir a una plataforma corriendo y andando,
 * colgarse de un borde alto y trepar, moverse colgado, correr por una pared y rebotar, subir entre
 * dos paredes, deslizarse por debajo de una barra, agacharse en un túnel, rodar al caer de alto (y
 * el golpe sin rodar), que nada de esto salte solo cuando no toca ni deje el cuerpo dentro de algo, y
 * subir a lo más alto de la Gran Pila de Vertical con sus cajas de verdad.
 *
 *   npm run test:parkour -w @xenxo/web
 */
import type { Entity } from "@xenxo/protocol";
import activities from "../../realtime/src/district-activities.json";
import cities from "../../realtime/src/district-cities.json";
import { world } from "../src/net/world-store";
import { createBody, placeBody, type Body } from "../src/world/locomotion";
import { createParkour, parkourStep, resetParkour, type Parkour, type ParkourInput } from "../src/world/parkour/moves";

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Cajas del mundo: [x, y, z, hx, hy, hz] (centro y medias medidas), sobre una losa de suelo. */
type B = [number, number, number, number, number, number];
let boxes: B[] = [];
let seq = 0;
function scene(list: B[]) {
  boxes = [[0, -0.05, 0, 200, 0.05, 200], ...list];
  const entities: Entity[] = boxes.map(([x, y, z, hx, hy, hz]) => ({
    entity_id: `prueba_${String(++seq).padStart(6, "0")}`,
    chunk_id: world.chunkId,
    owner: "system",
    rev: 1,
    components: { "transform@1": { p: [x, y, z], r: [0, 0, 0, 1], s: [1, 1, 1] }, "collider@1": { shape: "box", half_extents: [hx, hy, hz] } },
  })) as unknown as Entity[];
  world.apply({ type: "SNAPSHOT", payload: { entities, peers: [], poses: [] } } as never);
}

/** ¿Está el cuerpo (cilindro) metido en alguna caja? */
function insideAny(b: Body): boolean {
  for (const [x, y, z, hx, hy, hz] of boxes.slice(1)) {
    if (b.y + 0.3 > y + hy || b.y + b.h - 0.1 < y - hy) continue;
    const dx = Math.max(0, Math.abs(b.x - x) - hx);
    const dz = Math.max(0, Math.abs(b.z - z) - hz);
    if (dx * dx + dz * dz < 0.2 * 0.2) return true;
  }
  return false;
}

interface Run {
  b: Body;
  pk: Parkour;
  moves: Set<string>;
  maxY: number;
  stuck: boolean;
}

/** Simula `secs` segundos a 60 Hz; `ctl(t, run)` dice qué se pide en cada momento. */
function simulate(at: [number, number, number], yaw: number, secs: number, ctl: (t: number, r: Run, i: ParkourInput) => void, warm = 0): Run {
  const b = createBody(...at);
  placeBody(b, ...at);
  const pk = createParkour();
  resetParkour(pk, b);
  const run: Run = { b, pk, moves: new Set(), maxY: b.y, stuck: false };
  const inp: ParkourInput = { wantX: 0, wantZ: 0, jump: false, crouch: false, crouchPressed: false, yaw };
  const dt = 1 / 60;
  for (let t = -warm; t < secs; t += dt) {
    inp.jump = false;
    inp.crouchPressed = false;
    ctl(t, run, inp);
    parkourStep(pk, b, inp, dt, -150, 150);
    if (!Number.isNaN(pk.yaw)) inp.yaw = pk.yaw;
    run.moves.add(pk.move);
    run.maxY = Math.max(run.maxY, b.y);
    if (insideAny(b) && pk.move !== "hang" && pk.move !== "climb" && pk.move !== "mantle" && pk.move !== "vault") run.stuck = true;
  }
  return run;
}

/** Pedir ir hacia (dx, dz) a `speed` m/s. */
const go = (i: ParkourInput, dx: number, dz: number, speed: number) => {
  const l = Math.hypot(dx, dz) || 1;
  i.wantX = (dx / l) * speed;
  i.wantZ = (dz / l) * speed;
};
const RUN = 6.0;
const WALK = 2.1;
const moves = (r: Run) => [...r.moves].join(",");

// 1) Saltar una valla de 1 m (30 cm de fondo) corriendo: se pasa sin pararse y se sigue corriendo.
scene([[0, 0.5, -6, 3, 0.5, 0.15]]);
{
  const r = simulate([0, 0, 0], 0, 2.4, (_t, _r, i) => go(i, 0, -1, RUN));
  console.log(`valla: z=${r2(r.b.z)} y=${r2(r.b.y)} v=${r2(Math.hypot(r.b.vx, r.b.vz))} [${moves(r)}]`);
  check(r.moves.has("vault"), "corriendo contra una valla de 1 m, la salta");
  check(r.b.z < -9 && r.b.grounded && Math.abs(r.b.y) < 0.05, "aterriza al otro lado y sigue");
  check(Math.hypot(r.b.vx, r.b.vz) > 4, "sin perder la carrera");
  check(!r.stuck, "nunca dentro de la valla");
}

// 1 bis) Una barra fina en el aire (de 0,86 a 1 m, sin nada debajo, como la viga del Patio): también
//        se salta corriendo (no se queda parado contra ella).
scene([[0, 0.93, -6, 3, 0.07, 0.1]]);
{
  const r = simulate([0, 0, 0], 0, 2.4, (_t, _r, i) => go(i, 0, -1, RUN));
  console.log(`barra: z=${r2(r.b.z)} y=${r2(r.b.y)} [${moves(r)}]`);
  check(r.moves.has("vault") && r.b.z < -9, "corriendo contra una barra fina, la salta");
  check(!r.stuck, "nunca dentro de la barra");
}

// 2) Una plataforma de 1,2 m: corriendo, sube encima sin pulsar nada.
scene([[0, 0.6, -9, 4, 0.6, 3]]);
{
  const r = simulate([0, 0, 0], 0, 2.4, (_t, _r, i) => go(i, 0, -1, RUN));
  console.log(`plataforma corriendo: z=${r2(r.b.z)} y=${r2(r.b.y)} [${moves(r)}]`);
  check(r.moves.has("mantle") && !r.moves.has("vault"), "con fondo no salta la valla: sube");
  check(Math.abs(r.b.y - 1.2) < 0.05 && r.b.z < -6.2, "acaba de pie encima");
  check(!r.stuck, "nunca dentro de la plataforma");
}

// 3) Andando: contra un borde de 1,3 m no sube solo de inmediato; con el salto, sí.
scene([[0, 0.65, -4, 4, 0.65, 2]]);
{
  const r = simulate([0, 0, 0], 0, 2.6, (_t, _r, i) => go(i, 0, -1, WALK));
  console.log(`andando contra el borde: y=${r2(r.b.y)} [${moves(r)}]`);
  check(r.moves.has("mantle") && Math.abs(r.b.y - 1.3) < 0.05, "andando, sube empujando contra el borde un momento");
  const r2b = simulate([0, 0, -1.5], 0, 1.6, (t, _r, i) => {
    i.wantX = i.wantZ = 0;
    if (t > 0.1 && t < 0.13) i.jump = true;
  });
  console.log(`borde 1,3 m con salto: y=${r2(r2b.b.y)} z=${r2(r2b.b.z)} [${moves(r2b)}]`);
  check(r2b.moves.has("mantle") && Math.abs(r2b.b.y - 1.3) < 0.05, "parado delante, con el salto, sube");
}

// 4) Muro de 3 m: con el salto desde parado se cuelga; colgado, de lado; con el salto, arriba.
scene([[0, 1.5, -4, 6, 1.5, 2]]);
{
  let hung = -1;
  let hx = 0;
  const r = simulate([0, 0, -1.6], 0, 4.6, (t, run, i) => {
    i.wantX = i.wantZ = 0;
    if (t > 0.1 && t < 0.13) i.jump = true;
    if (run.pk.move === "hang" && hung < 0) {
      hung = t;
      hx = run.b.x;
    }
    // Colgado: un segundo a la derecha (de quien mira la pared: +X) y luego arriba.
    if (hung > 0 && t > hung + 0.3 && t < hung + 1.3) go(i, 1, 0, 2);
    if (hung > 0 && t > hung + 1.6 && t < hung + 1.63) i.jump = true;
  });
  console.log(`muro de 3 m: colgado a los ${r2(hung)} s, se movió ${r2(r.b.x - hx)} m de lado, acaba y=${r2(r.b.y)} z=${r2(r.b.z)} [${moves(r)}]`);
  check(hung > 0, "salta, llega con las manos y se cuelga");
  check(r.b.x - hx > 0.6, "colgado, se mueve de lado por el borde");
  check(r.moves.has("climb") && Math.abs(r.b.y - 3) < 0.05 && r.b.z < -2.2, "con el salto, trepa y queda de pie arriba");
}

// 5) Muro de 3,8 m: corriendo contra él y saltando, sube por la pared, se cuelga y trepa.
scene([[0, 1.9, -8, 6, 1.9, 2]]);
{
  let hung = -1;
  const r = simulate([0, 0, 0], 0, 4.5, (t, run, i) => {
    if (run.pk.move === "none" && hung < 0) go(i, 0, -1, RUN);
    else i.wantX = i.wantZ = 0;
    if (run.b.z < -5.1 && run.b.z > -5.4 && run.b.grounded) i.jump = true;
    if (run.pk.move === "hang" && hung < 0) hung = t;
    if (hung > 0 && t > hung + 0.4 && t < hung + 0.43) i.jump = true;
  });
  console.log(`muro de 3,8 m: [${moves(r)}] y=${r2(r.b.y)} max=${r2(r.maxY)}`);
  check(r.moves.has("wallup"), "corriendo y saltando de frente, sube por la pared");
  check(hung > 0 && Math.abs(r.b.y - 3.8) < 0.05, "llega al borde, se cuelga y trepa");
}

// 6) Correr por una pared a la derecha y rebotar hacia la izquierda.
scene([[1.25, 3, -10, 0.25, 3, 12]]);
{
  let ranZ = 0;
  let startZ = 0;
  let kicked = false;
  const r = simulate([0.35, 0, 0], 0, 2.2, (t, run, i) => {
    go(i, 0, -1, RUN);
    if (t > 0.5 && t < 0.53) i.jump = true;
    if (run.pk.move === "wallrun" && !startZ) startZ = run.b.z;
    if (run.pk.move === "wallrun") ranZ = run.b.z;
    if (run.pk.move === "wallrun" && run.pk.t > 0.6 && !kicked) {
      i.jump = true;
      kicked = true;
    }
  });
  console.log(`pared: corrió ${r2(startZ - ranZ)} m por ella; tras el rebote x=${r2(r.b.x)} [${moves(r)}] max=${r2(r.maxY)}`);
  check(r.moves.has("wallrun") && startZ - ranZ > 2.5, "saltando junto a la pared, corre por ella");
  check(r.maxY > 1.0, "por la pared se eleva");
  check(r.b.x < -0.8, "el salto le despega hacia el otro lado");
  check(!r.stuck, "nunca dentro de la pared");
}

// 7) Entre dos paredes (1,6 m): de una a otra rebotando, se sube.
scene([
  [1.05, 4, -2, 0.25, 4, 3],
  [-1.05, 4, -2, 0.25, 4, 3],
]);
{
  let jumps = 0;
  let last = -1;
  const r = simulate([0.3, 0, -2], 0, 2.6, (t, run, i) => {
    // Hacia la pared a la que se va; salto al tocarla.
    const toRight = run.b.vx >= 0 ? 1 : -1;
    go(i, t < 0.1 ? 1 : toRight, 0, 3);
    if (t > 0.05 && t < 0.08) i.jump = true;
    const near = Math.abs(run.b.x) > 0.4;
    if (!run.b.grounded && near && t - last > 0.25 && run.b.vy < 1.5) {
      i.jump = true;
      last = t;
      jumps++;
    }
  });
  console.log(`chimenea: saltos=${jumps} altura máx=${r2(r.maxY)} [${moves(r)}]`);
  check(r.maxY > 1.6, "rebotando de pared a pared sube más que un salto");
  check(r.maxY < 4, "pero no sin fin (como mucho tres rebotes seguidos)");
  check(!r.stuck, "nunca dentro de las paredes");
}

// 8) Deslizarse por debajo de una barra a 1,05 m; de pie choca.
scene([[0, 1.3, -6, 3, 0.25, 0.2]]);
{
  const r = simulate([0, 0, 0], 0, 2.2, (t, _r, i) => {
    go(i, 0, -1, RUN);
    i.crouch = t > 0.62 && t < 1.4;
    i.crouchPressed = t > 0.62 && t < 0.64;
  });
  console.log(`barra: z=${r2(r.b.z)} h=${r2(r.b.h)} [${moves(r)}]`);
  check(r.moves.has("slide") && r.b.z < -7, "deslizándose pasa por debajo");
  check(r.b.h > 1.7, "al acabar, de pie");
  const w = simulate([0, 0, 0], 0, 2.2, (_t, _r, i) => go(i, 0, -1, RUN));
  check(w.b.z > -6, "de pie, la barra le para");
}

// 9) Agachado por un túnel de 1,25 m.
scene([
  [0, 1.5, -6, 2, 0.25, 2],
  [1.3, 0.62, -6, 0.3, 0.62, 2],
  [-1.3, 0.62, -6, 0.3, 0.62, 2],
]);
{
  const r = simulate([0, 0, -2.5], 0, 6, (_t, _r, i) => {
    go(i, 0, -1, WALK);
    i.crouch = true;
  });
  console.log(`túnel: z=${r2(r.b.z)} h=${r2(r.b.h)} [${moves(r)}]`);
  check(r.moves.has("crouch") && r.b.z < -8.2, "agachado pasa por el túnel");
}

// 10) Caer de 4 m corriendo: rueda y sigue; parado: el golpe.
scene([[0, 2, 0, 3, 2, 3]]);
{
  const r = simulate([0, 4, -1], 0, 2.0, (_t, _r, i) => go(i, 0, -1, RUN));
  console.log(`caída corriendo: [${moves(r)}] stun=${r2(r.b.stun)} z=${r2(r.b.z)}`);
  check(r.moves.has("roll") && r.b.stun === 0, "corriendo, rueda al caer (sin golpe)");
  let stunned = 0;
  simulate([0, 4, -2.9], 0, 1.8, (t, run, i) => {
    if (t < 0.4) go(i, 0, -1, 1.2);
    else i.wantX = i.wantZ = 0;
    stunned = Math.max(stunned, run.b.stun);
  });
  check(stunned > 0.3, "dejándose caer despacio, el golpe");
  let rolled = false;
  simulate([0, 4, -2.9], 0, 1.8, (t, run, i) => {
    if (t < 0.4) go(i, 0, -1, 1.2);
    else i.wantX = i.wantZ = 0;
    if (!run.b.grounded && run.b.y < 1.2 && run.b.y > 0.6) i.crouchPressed = i.crouch = true;
    if (run.pk.move === "roll") rolled = true;
  });
  check(rolled, "agachándose justo antes de tocar el suelo, rueda");
}

// 10 bis) Caídas de verdad (las hace people/selfPeople con física; aquí, que se pidan cuando toca):
//         sin rodar desde 6 m, sí; corriendo desde 6 m, rueda; desde 12 m, ni corriendo.
scene([
  [0, 3, 0, 3, 3, 3],
  [30, 6, 0, 3, 6, 3],
]);
{
  let fell = "";
  simulate([0, 6, -2.9], 0, 2.2, (t, run, i) => {
    if (t < 0.4) go(i, 0, -1, 1.2);
    else i.wantX = i.wantZ = 0;
    if (run.pk.fall) fell = run.pk.fall;
  });
  check(fell === "land", "dejándose caer de 6 m sin rodar: al suelo de verdad");
  let rolled6 = false, fell6 = "";
  simulate([0, 6, -1], 0, 2.2, (_t, run, i) => {
    go(i, 0, -1, RUN);
    if (run.pk.move === "roll") rolled6 = true;
    if (run.pk.fall) fell6 = run.pk.fall;
  });
  check(rolled6 && !fell6, "de 6 m corriendo: rueda (sin caerse)");
  let fell12 = "";
  simulate([30, 12, -1], 0, 2.6, (_t, run, i) => {
    go(i, 0, -1, RUN);
    if (run.pk.fall) fell12 = run.pk.fall;
  });
  check(fell12 === "land", "de 12 m, ni corriendo: al suelo de verdad");
}

// 11) Lo que no debe pasar: corriendo junto a un murete paralelo no lo salta; andando al lado de
//     un banco, no sube; contra una pared lisa sin saltar, se la come (corriendo) o se para (andando).
scene([
  [1.6, 0.5, -10, 0.2, 0.5, 10],
  [-2, 0.45, -3, 0.8, 0.45, 0.3],
  [0, 5, -14, 6, 5, 0.5],
]);
{
  let crash = "";
  let nz = 0;
  const r = simulate([0, 0, 0], 0, 2.4, (_t, run, i) => {
    go(i, 0, -1, RUN);
    if (run.pk.fall && !crash) {
      crash = run.pk.fall;
      nz = run.pk.fallZ;
    }
  });
  console.log(`sin querer: [${moves(r)}] x=${r2(r.b.x)} z=${r2(r.b.z)} choque=${crash || "no"}`);
  check(!r.moves.has("vault") && !r.moves.has("mantle") && !r.moves.has("wallup") && !r.moves.has("wallrun"), "nada salta solo sin tocarlo");
  check(r.b.z > -13.5 && !r.stuck, "la pared del fondo le para");
  check(crash === "crash" && nz > 0.9, "corriendo de frente contra la pared sin saltar: se la come (rebota hacia atrás)");
  let walkCrash = "";
  simulate([0, 0, -10], 0, 2.4, (_t, run, i) => {
    go(i, 0, -1, WALK);
    if (run.pk.fall) walkCrash = run.pk.fall;
  });
  check(!walkCrash, "andando contra la pared: solo se para");
}

// 12) Viga estrecha (20 cm): equilibrio.
scene([[0, 1, -5, 0.1, 1, 6]]);
{
  let balanced = false;
  simulate([0, 2, 0], 0, 1.5, (_t, run, i) => {
    go(i, 0, -1, WALK);
    if (run.pk.balance) balanced = true;
  });
  check(balanced, "sobre una viga estrecha, en equilibrio");
}

// 13) Las Pilas de Vertical, con sus cajas de verdad (district-cities.json): de la calle a lo más alto
//     de cada una (en la Gran Pila, por el hueco de su mirador), de tejado en tejado. Cada caravana de
//     la espiral está 2,7 m más arriba y girada un cuarto: junto a la pared de la de encima siempre hay
//     tejado donde ponerse y, por encima de esa pared, sitio para subir colgándose.
{
  type R = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number };
  const list = (cities.cities as Record<string, number[][]>).vertical!;
  const rects: R[] = list.map(([x, y, z, hx, hy, hz]) => ({ x0: x! - hx!, x1: x! + hx!, z0: z! - hz!, z1: z! + hz!, y0: y! - hy!, y1: y! + hy! }));
  const isTrailer = (r: R) => {
    const a = Math.max(r.x1 - r.x0, r.z1 - r.z0), b = Math.min(r.x1 - r.x0, r.z1 - r.z0);
    return Math.abs(r.y1 - r.y0 - 2.7) < 0.02 && Math.abs(a - 6.8) < 0.02 && Math.abs(b - 2.45) < 0.02;
  };
  const trailers = rects.filter(isTrailer);
  const overlap = (a: R, b: R) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
  // Cada pila: de una caravana en el suelo, la única de encima que la pisa por una esquina, y así.
  const pilas: R[][] = [];
  for (const t of trailers.filter((r) => r.y0 < 0.02)) {
    const chain = [t];
    for (;;) {
      const cur = chain[chain.length - 1]!;
      const next = trailers.filter((r) => Math.abs(r.y0 - cur.y1) < 0.02 && Math.abs(overlap(r, cur) - 2.45 * 2.45) < 0.2);
      if (next.length !== 1) break;
      chain.push(next[0]!);
    }
    if (chain.length >= 8) pilas.push(chain);
  }
  scene(list.map(([x, y, z, hx, hy, hz]) => [x!, y!, z!, hx!, hy!, hz!] as B));
  type Step = { at: [number, number]; dir: [number, number]; top: number };
  const mid = (a: number, b: number) => (a + b) / 2;
  /** Por dónde se sube: de la calle a la primera (por su lado largo de fuera) y de cada una a la de encima. */
  const route = (best: R[]): Step[] => {
    const steps: Step[] = [];
    const [a, b] = [best[0]!, best[1]!];
    const cx = best.reduce((s, r) => s + mid(r.x0, r.x1), 0) / best.length;
    const cz = best.reduce((s, r) => s + mid(r.z0, r.z1), 0) / best.length;
    if (a.x1 - a.x0 > a.z1 - a.z0) {
      const free = b.x0 > a.x0 + 0.1 ? [a.x0, b.x0] : [b.x1, a.x1];
      const out = Math.abs(a.z0 - cz) > Math.abs(a.z1 - cz) ? -1 : 1;
      steps.push({ at: [mid(free[0]!, free[1]!), (out < 0 ? a.z0 : a.z1) + out * 0.5], dir: [0, -out], top: a.y1 });
    } else {
      const free = b.z0 > a.z0 + 0.1 ? [a.z0, b.z0] : [b.z1, a.z1];
      const out = Math.abs(a.x0 - cx) > Math.abs(a.x1 - cx) ? -1 : 1;
      steps.push({ at: [(out < 0 ? a.x0 : a.x1) + out * 0.5, mid(free[0]!, free[1]!)], dir: [-out, 0], top: a.y1 });
    }
    for (let k = 0; k + 1 < best.length; k++) {
      // La pared de la de encima que corta el tejado de esta: delante de ella, a medio metro.
      const [a, b] = [best[k]!, best[k + 1]!];
      const oz = mid(Math.max(a.z0, b.z0), Math.min(a.z1, b.z1));
      const ox = mid(Math.max(a.x0, b.x0), Math.min(a.x1, b.x1));
      if (b.x0 > a.x0 + 0.1 && b.x0 < a.x1 - 0.1) steps.push({ at: [b.x0 - 0.5, oz], dir: [1, 0], top: b.y1 });
      else if (b.x1 > a.x0 + 0.1 && b.x1 < a.x1 - 0.1) steps.push({ at: [b.x1 + 0.5, oz], dir: [-1, 0], top: b.y1 });
      else if (b.z0 > a.z0 + 0.1 && b.z0 < a.z1 - 0.1) steps.push({ at: [ox, b.z0 - 0.5], dir: [0, 1], top: b.y1 });
      else steps.push({ at: [ox, b.z1 + 0.5], dir: [0, -1], top: b.y1 });
    }
    return steps;
  };
  const climb = (best: R[]) => {
    const steps = route(best);
    let i = 0;
    let stage = "walk";
    let t0 = 0;
    let failed = "";
    const r = simulate([steps[0]!.at[0], 0, steps[0]!.at[1]], 0, steps.length * 7, (t, run, inp) => {
      inp.wantX = inp.wantZ = 0;
      if (i >= steps.length || failed) return;
      const st = steps[i]!;
      const dx = st.at[0] - run.b.x, dz = st.at[1] - run.b.z;
      if (stage === "walk") {
        const d = Math.hypot(dx, dz);
        if (d > 0.08) go(inp, dx, dz, Math.min(WALK, d * 3 + 0.3));
        else (stage = "settle"), (t0 = t);
      } else if (stage === "settle") {
        if (t - t0 > 0.35) (stage = "jump"), (t0 = t);
      } else if (stage === "jump") {
        go(inp, st.dir[0], st.dir[1], 0.5);
        if (t - t0 < 0.03) inp.jump = true;
        if (run.pk.move === "hang") (stage = "hang"), (t0 = t);
        else if (t - t0 > 1.5) failed = `piso ${i}: no se cuelga (y=${r2(run.b.y)})`;
      } else if (stage === "hang") {
        if (t - t0 > 0.4 && t - t0 < 0.43) inp.jump = true;
        if (run.b.grounded && Math.abs(run.b.y - st.top) < 0.06 && run.pk.move !== "climb") (i++, (stage = "walk"));
        else if (t - t0 > 3) failed = `piso ${i}: colgado, no sube (y=${r2(run.b.y)})`;
      }
    });
    const ok = i === steps.length && Math.abs(r.b.y - best[best.length - 1]!.y1) < 0.06 && !r.stuck;
    if (!ok) console.log(`  pila en (${r2(mid(best[0]!.x0, best[0]!.x1))}, ${r2(mid(best[0]!.z0, best[0]!.z1))}): subió ${i} de ${steps.length}, y=${r2(r.b.y)} ${failed}${r.stuck ? " (dentro de algo)" : ""}`);
    return ok;
  };
  const tallest = Math.max(...pilas.map((p) => p.length));
  const done = pilas.filter(climb).length;
  console.log(`pilas: ${pilas.length} (la más alta, de ${tallest} pisos); subidas hasta arriba: ${done}`);
  check(pilas.length >= 15 && tallest >= 16, "las Pilas, y la más alta de 16 pisos (la Gran Pila)");
  check(done === pilas.length, "en todas, de la calle a lo más alto, colgándose de cada tejado");
}

// 14) Los niveles y los retos de Vertical (district-activities.json), jugados por un bot con las cajas
//     de verdad: en cada uno, por orden, la salida, cada punto, la meta (como el cliente: dentro del
//     círculo, y a menos de 4 m + radio de alto). Escalar en espiral, subir corriendo por paredes de
//     3,6 m (la Aguja), dejarse caer de tejado en tejado, saltos entre pilas cayendo rodando (Salto de
//     fe), la viga, el montacargas y el pináculo.
{
  type V3 = [number, number, number];
  type R = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number };
  const V = (activities as unknown as Record<string, { races: { id: string; start: { p: V3; radius: number }; cps: V3[]; finish: { p: V3; radius: number } }[]; hunts: { id: string; radius: number; items: { p: V3 }[] }[] }>).vertical!;
  const list = (cities.cities as Record<string, number[][]>).vertical!;
  scene(list.map(([x, y, z, hx, hy, hz]) => [x!, y!, z!, hx!, hy!, hz!] as B));
  const rects: R[] = list.map(([x, y, z, hx, hy, hz]) => ({ x0: x! - hx!, x1: x! + hx!, z0: z! - hz!, z1: z! + hz!, y0: y! - hy!, y1: y! + hy! }));
  const isTrailer = (r: R) => {
    const a = Math.max(r.x1 - r.x0, r.z1 - r.z0), b = Math.min(r.x1 - r.x0, r.z1 - r.z0);
    return Math.abs(r.y1 - r.y0 - 2.7) < 0.02 && Math.abs(a - 6.8) < 0.02 && Math.abs(b - 2.45) < 0.02;
  };
  const mid = (a: number, b: number) => (a + b) / 2;
  /** Las caravanas de la pila con centro (cx, cz), por pisos (de abajo arriba). */
  const pila = (cx: number, cz: number) =>
    rects.filter((r) => isTrailer(r) && Math.abs(mid(r.x0, r.x1) - cx) < 2.5 && Math.abs(mid(r.z0, r.z1) - cz) < 2.5).sort((a, b) => a.y0 - b.y0);
  const races = new Map(V.races.map((r) => [r.id, r]));

  type Step =
    | { go: [number, number]; speed?: number; until?: (b: Body) => boolean }
    | { hang: [number, number] }
    | { wallup: [number, number]; wall: number }
    | { leap: [number, number]; edge: number; lead?: number }
    | { drop: [number, number] }
    | { visit: V3; r: number };
  /** Delante de la pared de `b` que corta el tejado de `a` (a medio metro), y hacia dónde. */
  const wallOf = (a: R, b: R, back = 0.5): { at: [number, number]; dir: [number, number]; wall: number } => {
    const oz = mid(Math.max(a.z0, b.z0), Math.min(a.z1, b.z1)), ox = mid(Math.max(a.x0, b.x0), Math.min(a.x1, b.x1));
    if (b.x0 > a.x0 + 0.1 && b.x0 < a.x1 - 0.1) return { at: [b.x0 - back, oz], dir: [1, 0], wall: b.x0 };
    if (b.x1 > a.x0 + 0.1 && b.x1 < a.x1 - 0.1) return { at: [b.x1 + back, oz], dir: [-1, 0], wall: b.x1 };
    if (b.z0 > a.z0 + 0.1 && b.z0 < a.z1 - 0.1) return { at: [ox, b.z0 - back], dir: [0, 1], wall: b.z0 };
    return { at: [ox, b.z1 + back], dir: [0, -1], wall: b.z1 };
  };
  /** Desde la calle hasta el piso `to` de una pila (colgándose de cada tejado), pasando por `visits`. */
  const climb = (fl: R[], from: number, to: number, visits: Map<number, V3> = new Map(), wall = false): Step[] => {
    const out: Step[] = [];
    const cx = fl.reduce((s, r) => s + mid(r.x0, r.x1), 0) / fl.length, cz = fl.reduce((s, r) => s + mid(r.z0, r.z1), 0) / fl.length;
    for (let k = from; k < to; k++) {
      if (k < 0) {
        // De la calle a la primera, por su lado largo de fuera.
        const [a, b] = [fl[0]!, fl[1]!];
        const back = wall ? 4.5 : 0.5;
        let at: [number, number], dir: [number, number], w: number;
        if (a.x1 - a.x0 > a.z1 - a.z0) {
          const free = b.x0 > a.x0 + 0.1 ? [a.x0, b.x0] : [b.x1, a.x1];
          const o = Math.abs(a.z0 - cz) > Math.abs(a.z1 - cz) ? -1 : 1;
          w = o < 0 ? a.z0 : a.z1;
          at = [mid(free[0]!, free[1]!), w + o * back];
          dir = [0, -o];
        } else {
          const free = b.z0 > a.z0 + 0.1 ? [a.z0, b.z0] : [b.z1, a.z1];
          const o = Math.abs(a.x0 - cx) > Math.abs(a.x1 - cx) ? -1 : 1;
          w = o < 0 ? a.x0 : a.x1;
          at = [w + o * back, mid(free[0]!, free[1]!)];
          dir = [-o, 0];
        }
        out.push({ go: at }, wall ? { wallup: dir, wall: w } : { hang: dir });
      } else {
        const t = wallOf(fl[k]!, fl[k + 1]!, wall ? 3.0 : 0.5);
        out.push({ go: t.at }, wall ? { wallup: t.dir, wall: t.wall } : { hang: t.dir });
      }
      const v = visits.get(k + 1);
      if (v) out.push({ visit: v, r: 1.0 }, { go: [v[0], v[2]] });
    }
    return out;
  };
  const visitAll = (pts: V3[]) => new Map(pts.map((p) => [Math.round(p[1] / 2.7) - 1, p] as const));
  const RUNV = 6.0, WALKV = 2.1;

  /** Juega una lista de pasos; dice hasta dónde llegó y qué puntos pisó (por orden). */
  const play = (at: V3, steps: Step[], targets: { p: V3; r: number }[], secs = 400) => {
    const b = createBody(...at);
    placeBody(b, ...at);
    const pk = createParkour();
    resetParkour(pk, b);
    const inp: ParkourInput = { wantX: 0, wantZ: 0, jump: false, crouch: false, crouchPressed: false, yaw: 0 };
    let i = 0, t = 0, t0 = 0, stage = "", got = 0, fail = "", falls = 0;
    const dt = 1 / 60;
    while (t < secs && i < steps.length && !fail) {
      inp.jump = false;
      inp.crouchPressed = false;
      inp.wantX = inp.wantZ = 0;
      const st = steps[i]!;
      if ("go" in st) {
        const dx = st.go[0] - b.x, dz = st.go[1] - b.z, d = Math.hypot(dx, dz);
        if (d < 0.12 && b.grounded && b.stun <= 0) i++;
        else if (b.stun <= 0) go(inp, dx, dz, Math.min(st.speed ?? WALKV, d * 3 + 0.3));
      } else if ("visit" in st) {
        const [x, y, z] = st.visit;
        if (Math.hypot(b.x - x, b.z - z) <= st.r && Math.abs(b.y - y) <= 4 + st.r) i++;
        else go(inp, x - b.x, z - b.z, Math.min(WALKV, Math.hypot(x - b.x, z - b.z) * 3 + 0.3));
      } else if ("hang" in st) {
        if (stage === "") (stage = "settle"), (t0 = t);
        if (stage === "settle" && t - t0 > 0.3) (stage = "jump"), (t0 = t);
        if (stage === "jump") {
          go(inp, st.hang[0], st.hang[1], 0.5);
          if (t - t0 < 0.03) inp.jump = true;
          if (pk.move === "hang") (stage = "hanging"), (t0 = t);
          else if (t - t0 > 1.5) fail = `paso ${i}: no se cuelga (y=${r2(b.y)})`;
        } else if (stage === "hanging") {
          if (t - t0 > 0.35 && t - t0 < 0.38) inp.jump = true;
          if (b.grounded && pk.move !== "climb" && pk.move !== "hang" && t - t0 > 0.5) (i++, (stage = ""));
          else if (t - t0 > 3) fail = `paso ${i}: colgado, no sube (y=${r2(b.y)})`;
        }
      } else if ("wallup" in st) {
        // Corriendo hacia la pared y, a un paso de ella, el salto: sube por la pared, se cuelga y trepa.
        const [dx, dz] = st.wallup;
        const toWall = dx !== 0 ? (st.wall - b.x) * dx : (st.wall - b.z) * dz;
        if (stage === "") (stage = "run"), (t0 = t);
        if (stage === "run") {
          go(inp, dx, dz, RUNV);
          if (toWall < 1.0) (inp.jump = true), (stage = "up"), (t0 = t);
          else if (t - t0 > 4) fail = `paso ${i}: no llega corriendo a la pared`;
        } else if (stage === "up") {
          if (t - t0 < 0.25) go(inp, dx, dz, RUNV);
          if (pk.move === "hang") (stage = "hanging"), (t0 = t);
          else if (b.grounded && t - t0 > 0.6 && pk.move !== "wallup" && pk.move !== "climb") fail = `paso ${i}: no sube por la pared (y=${r2(b.y)} ${pk.move})`;
          else if (t - t0 > 3) fail = `paso ${i}: por la pared, no se cuelga`;
        } else if (stage === "hanging") {
          if (t - t0 > 0.35 && t - t0 < 0.38) inp.jump = true;
          if (b.grounded && pk.move !== "climb" && pk.move !== "hang" && t - t0 > 0.5) (i++, (stage = ""));
          else if (t - t0 > 3) fail = `paso ${i}: colgado, no sube (y=${r2(b.y)})`;
        }
      } else if ("drop" in st) {
        // Dejarse caer: un paso despacio hacia el borde y, ya en el aire, nada (cae recto, sin agarrarse).
        if (stage === "") (stage = "edge"), (t0 = t);
        if (stage === "edge") {
          go(inp, st.drop[0], st.drop[1], 0.8);
          if (!b.grounded) (stage = "air"), (t0 = t);
          else if (t - t0 > 3) fail = `paso ${i}: no llega al borde`;
        } else if (stage === "air" && b.grounded && b.stun <= 0 && t - t0 > 0.2) (i++, (stage = ""));
        else if (t - t0 > 4) fail = `paso ${i}: la caída no acaba`;
      } else if ("leap" in st) {
        // Corriendo hacia el borde y, al llegar, el salto; sin soltar la carrera hasta caer.
        const [dx, dz] = st.leap;
        const toEdge = dx !== 0 ? (st.edge - b.x) * dx : (st.edge - b.z) * dz;
        if (stage === "") (stage = "run"), (t0 = t);
        go(inp, dx, dz, RUNV);
        if (stage === "run" && toEdge < (st.lead ?? 0.35)) (inp.jump = true), (stage = "air"), (t0 = t);
        else if (stage === "air" && t - t0 > 0.2 && b.grounded && pk.move !== "roll") (i++, (stage = ""));
        else if (t - t0 > 5) fail = `paso ${i}: el salto no acaba`;
      }
      parkourStep(pk, b, inp, dt, -150, 150);
      if (process.env.TRACE && Math.round(t * 60) % 30 === 0) console.log(`    t=${r2(t)} paso ${i} ${stage} (${r2(b.x)}, ${r2(b.y)}, ${r2(b.z)}) ${pk.move} suelo=${b.grounded} golpe=${r2(b.stun)}`);
      if (pk.fall) falls++;
      if (pk.fall && !fail) fail = `paso ${i}: se cae de verdad (${pk.fall}, y=${r2(b.y)})`;
      // Los puntos, como el cliente: por orden, dentro del círculo.
      const tg = targets[got];
      if (tg && Math.hypot(b.x - tg.p[0], b.z - tg.p[2]) <= tg.r && Math.abs(b.y - tg.p[1]) <= 4 + tg.r) got++;
      t += dt;
    }
    return { got, total: targets.length, fail: fail || (i < steps.length ? `se acabó el tiempo en el paso ${i}` : ""), y: b.y, t, falls };
  };
  const targetsOf = (id: string) => {
    const rc = races.get(id)!;
    return [{ p: rc.start.p, r: rc.start.radius }, ...rc.cps.map((p) => ({ p, r: 1.0 })), { p: rc.finish.p, r: rc.finish.radius }];
  };
  const report = (what: string, r: ReturnType<typeof play>) => {
    console.log(`  ${what}: ${r.got}/${r.total} en ${r2(r.t)} s ${r.fail}`);
    return r.got === r.total && !r.fail;
  };
  let ok = 0;
  // Nivel 1: los cuatro primeros pisos de la pila 5.
  {
    const rc = races.get("nivel1")!;
    const fl = pila(24.5, -1.2);
    const st: Step[] = [{ go: [rc.start.p[0], rc.start.p[2]] }, ...climb(fl, -1, 3, visitAll([...rc.cps, rc.finish.p]))];
    if (report("nivel 1 (primeros pisos)", play(rc.start.p, st, targetsOf("nivel1")))) ok++;
  }
  // Nivel 2: seis pisos de la pila 1, la pasarela y el tejado de la pila 2.
  {
    const rc = races.get("nivel2")!;
    const fl = pila(-12.5, -12.5);
    const cw = rc.cps[2]!;
    const st: Step[] = [
      { go: [rc.start.p[0], rc.start.p[2]] },
      ...climb(fl, -1, 5, visitAll(rc.cps.slice(0, 2))),
      { go: [cw[0], fl[5]!.z1 - 0.6] },
      { visit: cw, r: 1.0 },
      { go: [cw[0], cw[2]] },
      { go: [cw[0], rc.finish.p[2]] },
      { visit: rc.finish.p, r: 1.0 },
    ];
    if (report("nivel 2 (la pasarela)", play(rc.start.p, st, targetsOf("nivel2")))) ok++;
  }
  // Nivel 3: la pila 4 entera.
  {
    const rc = races.get("nivel3")!;
    const fl = pila(37.0, -12.5);
    const st: Step[] = [{ go: [rc.start.p[0], rc.start.p[2]] }, ...climb(fl, -1, fl.length - 1, visitAll([...rc.cps, rc.finish.p]))];
    if (report("nivel 3 (el caracol)", play(rc.start.p, st, targetsOf("nivel3")))) ok++;
  }
  // Nivel 4: la fila del sur (pilas 14, 16, 17 y 19), por sus pasarelas: subiendo y dejándose caer.
  {
    const rc = races.get("nivel4")!;
    const f14 = pila(-1.0, 76.5), f16 = pila(26.1, 76.5), f17 = pila(37.9, 76.5);
    const [c1, c2, c3] = rc.cps as [V3, V3, V3];
    const e17 = f17[6]!, s17 = f17[7]!;
    const st: Step[] = [
      { go: [rc.start.p[0], rc.start.p[2]] },
      ...climb(f14, -1, 6),
      { visit: c1, r: 1.0 },
      { go: [c1[0], 76.5] },
      // Por la pasarela hasta el tejado de la pila 16 (su piso 6) y dos pisos más.
      { go: [f16[6]!.x0 + 0.8, 76.5] },
      ...climb(f16, 6, 8),
      { visit: c2, r: 1.0 },
      { go: [c2[0], 76.5] },
      { go: [f17[8]!.x0 + 1.2, 76.5] },
      // Abajo, de dos en dos metros y pico: a la del sur (7) y a la del este (6).
      { go: [s17.x0 + 3.6, 78.2] },
      { go: [e17.x0 + 1.2, 74.6] },
      { visit: c3, r: 1.0 },
      { go: [c3[0], 76.5] },
      { go: [rc.finish.p[0], 76.5] },
      { visit: rc.finish.p, r: 1.0 },
    ];
    if (report("nivel 4 (la fila del sur)", play(rc.start.p, st, targetsOf("nivel4")))) ok++;
  }
  // Nivel 5: la Aguja (pisos de 3,6 m: subir corriendo por la pared).
  const ag = rects.filter((r) => isTrailer(r) && Math.abs(mid(r.x0, r.x1) - 32) < 2.5 && Math.abs(mid(r.z0, r.z1) - 61.4) < 2.5).sort((a, b) => a.y0 - b.y0);
  {
    const rc = races.get("nivel5")!;
    const vis = new Map(rc.cps.map((p) => [Math.round(p[1] / 3.6) - 1, p] as const));
    vis.set(Math.round(rc.finish.p[1] / 3.6) - 1, rc.finish.p);
    const st: Step[] = [{ go: [rc.start.p[0], rc.start.p[2]] }, ...climb(ag, -1, ag.length - 1, vis, true)];
    if (report("nivel 5 (la Aguja)", play(rc.start.p, st, targetsOf("nivel5")))) ok++;
  }
  // Nivel 6: Salto de fe. Del mirador, al hueco y, de tejado en tejado, Gran Pila abajo hasta la
  // caravana del este del piso 9; de un salto a la pila 3 (un piso más abajo); por la pasarela a la
  // pila 1; arriba del todo; y de otro salto (dos pisos más abajo, rodando) a lo alto de la pila 2.
  {
    const rc = races.get("nivel6")!;
    const g = pila(-1.9, -2.5), p1 = pila(-12.5, -12.5);
    const [c1, c2, c3] = rc.cps as [V3, V3, V3];
    const [w15, s14, e13, n12, w11, s10, e9] = [g[15]!, g[14]!, g[13]!, g[12]!, g[11]!, g[10]!, g[9]!];
    const st: Step[] = [
      { go: [mid(w15.x0, w15.x1), rc.start.p[2]] },
      { go: [mid(w15.x0, w15.x1), mid(s14.z0, s14.z1)] },
      { go: [w15.x1 - 0.45, mid(s14.z0, s14.z1)] },
      { drop: [1, 0] },                                             // al hueco: a la del sur (14)
      { go: [e13.x0 + 1.2, s14.z0 + 0.45] },
      { drop: [0, -1] },                                            // a la del este (13)
      { go: [e13.x0 + 0.45, n12.z0 + 1.2] },
      { drop: [-1, 0] },                                            // a la del norte (12)
      { go: [w11.x0 + 1.2, n12.z1 - 0.45] },
      { drop: [0, 1] },                                             // a la del oeste (11)
      { go: [w11.x1 - 0.45, s10.z0 + 1.2] },
      { drop: [1, 0] },                                             // a la del sur (10)
      { go: [e9.x0 + 0.55, s10.z0 + 0.45] },
      { drop: [0, -1] },                                            // a la del este (9)
      { go: [e9.x0 + 0.55, s10.z0 - 0.45] },                        // al fondo, para coger carrerilla
      { leap: [0, -1], edge: e9.z0 },                               // salto a la pila 3 (piso 8)
      { visit: c1, r: 1.0 },
      { go: [c1[0], -12.5] },
      { visit: c2, r: 1.0 },
      { go: [p1[8]!.x1 - 1.0, -12.5] },                             // por la pasarela, a la pila 1
      ...climb(p1, 8, 12),
      { visit: c3, r: 1.0 },
      { go: [c3[0], p1[12]!.z0 + 0.6] },
      { leap: [0, 1], edge: p1[12]!.z1, lead: 2.2 },                // y el último salto (antes del borde: si no, se pasa)
      { visit: rc.finish.p, r: 1.0 },
    ];
    if (report("nivel 6 (salto de fe)", play(rc.start.p, st, targetsOf("nivel6")))) ok++;
  }
  check(ok === 6, "los seis niveles, de la salida a la meta pasando por cada punto");

  // Los retos.
  const retos = V.hunts.find((h) => h.id === "retos")!.items.map((it) => it.p);
  let found = 0;
  const reto = (n: number, at: V3, st: Step[]) => {
    const r = play(at, [...st, { visit: retos[n]!, r: 1.0 }], [{ p: retos[n]!, r: 1.0 }]);
    if (report(`reto ${n + 1}`, r)) found++;
  };
  // 1) Bajo la escalera de la Gran Pila (la escalera choca con su malla: aquí, el hueco de debajo).
  reto(0, [retos[0]![0], 0, retos[0]![2] - 3], []);
  // 2) Sobre la calle: la pila 4 hasta su piso 9 y la pasarela.
  {
    const fl = pila(37.0, -12.5);
    reto(1, [35.78, 0, -17.2], [...climb(fl, -1, 9), { go: [fl[9]!.x1 - 0.8, -12.5] }]);
  }
  // 3) Lo más alto de la pila 13.
  {
    const fl = pila(-12.5, 62.7);
    const s = fl[0]!;
    reto(2, [s.x0 - 0.6, 0, mid(s.z0, s.z1)], climb(fl, -1, fl.length - 1));
  }
  // 4) El montacargas: del mirador, por el hueco de la barandilla.
  {
    const g = pila(-1.9, -2.5);
    reto(3, [-1.0, 43.25, -2.5], [{ go: [g[15]!.x0 + 0.1, -2.5] }, { hang: [-1, 0] }]);
  }
  // 5) La viga: de lo alto de la pila 2, por la viga.
  reto(4, [-10.32, 29.75, -1.2], [{ go: [-10.0, 0.0] }]);
  // 6) La cima de la Aguja: subirla y, arriba, el pináculo (otra pared, corriendo).
  {
    const rc = races.get("nivel5")!;
    const top = ag[ag.length - 1]!;
    const along = top.x1 - top.x0 > top.z1 - top.z0;
    const towardX = retos[5]![0] < mid(top.x0, top.x1) ? -1 : 1;
    const spireFace = towardX < 0 ? retos[5]![0] + 0.6 : retos[5]![0] - 0.6;
    const st: Step[] = [{ go: [rc.start.p[0], rc.start.p[2]] }, ...climb(ag, -1, ag.length - 1, new Map(), true)];
    if (along) st.push({ go: [spireFace - towardX * 4.2, retos[5]![2]] }, { wallup: [towardX, 0], wall: spireFace });
    reto(5, rc.start.p, st);
  }
  check(found === 6, "los seis retos se alcanzan");
}

if (fails) {
  console.log(`\n${fails} fallo(s)`);
  process.exit(1);
}
console.log("\nparkour: todo bien");
