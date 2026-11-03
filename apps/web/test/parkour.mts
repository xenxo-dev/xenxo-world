/**
 * Prueba del parkour de Vertical sin navegador (world/parkour/moves.ts sobre las colisiones de
 * verdad, world/collision.ts): saltar una valla, subir a una plataforma corriendo y andando,
 * colgarse de un borde alto y trepar, moverse colgado, correr por una pared y rebotar, subir entre
 * dos paredes, deslizarse por debajo de una barra, agacharse en un túnel, rodar al caer de alto (y
 * el golpe sin rodar), y que nada de esto salte solo cuando no toca ni deje el cuerpo dentro de algo.
 *
 *   npm run test:parkour -w @xenxo/web
 */
import type { Entity } from "@xenxo/protocol";
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

if (fails) {
  console.log(`\n${fails} fallo(s)`);
  process.exit(1);
}
console.log("\nparkour: todo bien");
