/**
 * Prueba del personaje a pie sin navegador (world/locomotion.ts sobre las colisiones de verdad,
 * world/collision.ts): que se mueva igual a cualquier tasa de frames, que en diagonal no corra más,
 * que no atraviese paredes finas ni a pocos frames ni muy deprisa, que suba escalones y bordes hasta
 * donde toca, que otra persona no pueda sacarle por el otro lado de una pared, y que lo sólido del
 * lugar no se rehaga cada vez que entra o sale alguien.
 *
 *   npm run test:locomotion -w @xenxo/web
 */
import type { Entity } from "@xenxo/protocol";
import { world } from "../src/net/world-store";
import { others, solidsVersion } from "../src/world/collision";
import { BODY_RADIUS, createBody, moveScale, requestJump, stepBody, STEP_UP } from "../src/world/locomotion";

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Cajas del mundo: [x, y, z, hx, hy, hz, giro] (centro, medias medidas y giro en Y), sobre una losa. */
type B = [number, number, number, number, number, number, number?];
let seq = 0;
const entity = ([x, y, z, hx, hy, hz, yaw = 0]: B): Entity =>
  ({
    entity_id: `prueba_${String(++seq).padStart(6, "0")}`,
    chunk_id: world.chunkId,
    owner: "system",
    rev: 1,
    components: { "transform@1": { p: [x, y, z], r: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], s: [1, 1, 1] }, "collider@1": { shape: "box", half_extents: [hx, hy, hz] } },
  }) as unknown as Entity;
function scene(list: B[]) {
  const entities = [[0, -0.05, 0, 400, 0.05, 400] as B, ...list].map(entity);
  world.apply({ type: "SNAPSHOT", payload: { entities, peers: [], poses: [] } } as never);
}
const RUN = 5.4;
const WALK = 2.1;
const LIM = 390;
const spread = (v: number[]) => (Math.max(...v) - Math.min(...v)) / Math.max(...v);

console.log("A cualquier tasa de frames");
{
  scene([]);
  const dist: number[] = [], apex: number[] = [], long: number[] = [];
  for (const hz of [20, 30, 45, 60, 72, 90, 120, 144, 240]) {
    const dt = 1 / hz;
    const b = createBody(0, 0, 0);
    for (let t = 0; t < 3 - 1e-9; t += dt) stepBody(b, 0, -RUN, dt, -LIM, LIM);
    dist.push(-b.z);
    requestJump(b);
    const z0 = b.z;
    let top = 0, air = false, done = false;
    for (let i = 0; i < hz * 3 && !done; i++) {
      stepBody(b, 0, -RUN, dt, -LIM, LIM);
      top = Math.max(top, b.y);
      if (!b.grounded) air = true;
      else if (air) done = true;
    }
    apex.push(top);
    long.push(z0 - b.z);
  }
  console.log(`  de 20 a 240 Hz: 3 s corriendo ${r2(Math.min(...dist))}–${r2(Math.max(...dist))} m; salto ${r2(Math.min(...apex))}–${r2(Math.max(...apex))} m de alto y ${r2(Math.min(...long))}–${r2(Math.max(...long))} m de largo`);
  check(spread(dist) < 0.01, "se corre lo mismo (menos de un 1 % de diferencia)");
  check(spread(apex) < 0.03 && spread(long) < 0.04, "y se salta lo mismo (menos de un 3 % de alto y un 4 % de largo)");
  const b = createBody(0, 0, 0);
  stepBody(b, 0, -RUN, 0, -LIM, LIM);
  stepBody(b, 0, -RUN, -1, -LIM, LIM);
  stepBody(b, 0, -RUN, NaN, -LIM, LIM);
  stepBody(b, 0, -RUN, 30, -LIM, LIM);
  check(Number.isFinite(b.x + b.y + b.z + b.vx + b.vz) && -b.z < 1, "un reloj parado, hacia atrás, roto o con un salto enorme no rompe nada");
}

console.log("En diagonal");
{
  scene([]);
  // Como en Player.tsx: lo que se pide con las teclas, por la velocidad.
  const run = (mx: number, my: number) => {
    const k = moveScale(mx, my);
    const b = createBody(0, 0, 0);
    for (let i = 0; i < 180; i++) stepBody(b, mx * k * RUN, -my * k * RUN, 1 / 60, -LIM, LIM);
    return Math.hypot(b.vx, b.vz);
  };
  const straight = run(0, 1), diagonal = run(1, 1), half = run(0.3, 0.4);
  console.log(`  recto ${r2(straight)} m/s, en diagonal ${r2(diagonal)} m/s, joystick a medias ${r2(half)} m/s`);
  check(Math.abs(diagonal - straight) < 0.01, "con W+D se corre igual que con W (antes, un 41 % más)");
  check(Math.abs(half - RUN * 0.5) < 0.01, "el joystick a medias sigue andando a medias");
}

console.log("Paredes finas");
{
  let through = "";
  for (const thick of [0.02, 0.05, 0.1])
    for (const speed of [RUN, 12, 20])
      for (const hz of [10, 30, 60]) {
        scene([[0, 1.5, -6, 5, 1.5, thick / 2]]);
        const b = createBody(0, 0, 0);
        for (let i = 0; i < hz * 3; i++) stepBody(b, 0, -speed, 1 / hz, -LIM, LIM);
        if (b.z < -6) through += ` ${thick * 100} cm a ${speed} m/s y ${hz} Hz;`;
      }
  check(!through, `ninguna se atraviesa (2, 5 y 10 cm; a 5,4, 12 y 20 m/s; a 10, 30 y 60 Hz)${through}`);
  // Un rincón en ángulo agudo: empujando contra el vértice, ni tiembla ni se cuela.
  scene([[-2.2, 1.5, -6, 3, 1.5, 0.1, 0.35], [2.2, 1.5, -6, 3, 1.5, 0.1, -0.35]]);
  const b = createBody(0, 0, 0);
  let jitter = 0, px = 0, pz = 0;
  for (let i = 0; i < 300; i++) {
    stepBody(b, 0, -RUN, 1 / 60, -LIM, LIM);
    if (i > 180) jitter = Math.max(jitter, Math.hypot(b.x - px, b.z - pz));
    px = b.x;
    pz = b.z;
  }
  check(jitter < 0.002 && b.z > -7, `contra un rincón agudo se queda quieto (tiembla ${r2(jitter * 1000)} mm)`);
}

console.log("Escalones, bordes y escaleras");
{
  let step = 0, ledge = 0;
  for (let h = 0.3; h <= 1.6; h += 0.01) {
    scene([[0, h / 2, -8, 3, h / 2, 3]]);
    let b = createBody(0, 0, 0);
    for (let i = 0; i < 180; i++) stepBody(b, 0, -WALK, 1 / 60, -LIM, LIM);
    if (Math.abs(b.y - h) < 0.01) step = h;
    // Pegado al borde, saltar empujando contra él.
    b = createBody(0, 0, -4.6);
    for (let i = 0; i < 30; i++) stepBody(b, 0, -RUN, 1 / 60, -LIM, LIM);
    requestJump(b);
    for (let i = 0; i < 90; i++) stepBody(b, 0, -RUN, 1 / 60, -LIM, LIM);
    if (Math.abs(b.y - h) < 0.01) ledge = h;
  }
  console.log(`  andando se sube hasta ${r2(step)} m; saltando contra un borde, hasta ${r2(ledge)} m`);
  check(step > STEP_UP - 0.03 && step <= STEP_UP, "andando se suben escalones hasta STEP_UP y ni un centímetro más");
  check(ledge > 1.2 && ledge < 1.4, "con el salto se llega a un borde de 1,3 m (lo que se salta más un paso)");
  // Una escalera de 12 peldaños (20 cm de alto, 30 de fondo) con rellano: arriba y abajo corriendo, sin despegarse.
  const stairs: B[] = [];
  for (let i = 0; i < 12; i++) stairs.push([0, (i + 1) * 0.1, -3 - i * 0.3 - 10, 2, (i + 1) * 0.1, 10]);
  scene(stairs);
  const b = createBody(0, 0, 0);
  let air = 0;
  for (let i = 0; i < 150; i++) {
    stepBody(b, 0, -RUN, 1 / 60, -LIM, LIM);
    if (!b.grounded) air++;
  }
  const top = b.y;
  for (let i = 0; i < 200; i++) {
    stepBody(b, 0, RUN, 1 / 60, -LIM, LIM);
    if (!b.grounded) air++;
  }
  check(Math.abs(top - 2.4) < 0.01 && Math.abs(b.y) < 0.01 && air === 0, `una escalera se sube y se baja corriendo sin despegar los pies (arriba ${r2(top)} m, ${air} frames en el aire)`);
}

console.log("Otra persona te empuja contra una pared");
{
  let through = "";
  for (const thick of [0.1, 0.2, 0.4, 0.6]) {
    scene([[0, 1.5, -2, 5, 1.5, thick / 2]]);
    const b = createBody(0, 0, -2 + thick / 2 + BODY_RADIUS + 0.001);
    for (let i = 0; i < 240; i++) {
      // Viene andando hacia la pared y se queda «dentro» de ti (su posición llega por la red).
      others.count = 1;
      others.pos[0] = 0;
      others.pos[1] = 0;
      others.pos[2] = Math.max(-2 + thick / 2 + 0.05, 1.5 - i * 0.02);
      stepBody(b, 0, 0, 1 / 60, -LIM, LIM);
      if (b.z < -2 - thick / 2) through += ` ${thick * 100} cm;`;
    }
    others.count = 0;
  }
  check(!through, `no te saca por el otro lado (paredes de 10 a 60 cm)${through && " — atravesadas:" + [...new Set(through.split(";"))].join(";")}`);
  // Y en campo abierto sí te aparta.
  scene([]);
  const b = createBody(0, 0, 0);
  others.count = 1;
  others.pos[0] = 0.2;
  others.pos[1] = 0;
  others.pos[2] = 0;
  for (let i = 0; i < 60; i++) stepBody(b, 0, 0, 1 / 60, -LIM, LIM);
  others.count = 0;
  check(Math.hypot(b.x - 0.2, b.z) > 0.6, `sin pared, dos personas no se quedan una dentro de otra (acaban a ${r2(Math.hypot(b.x - 0.2, b.z))} m)`);
}

console.log("Lo sólido del lugar");
{
  scene([[0, 1, -5, 1, 1, 1]]);
  const v0 = solidsVersion();
  world.apply({ type: "PEER_JOIN", payload: { session_id: "otra", display_name: "x", kind: "user" } } as never);
  world.apply({ type: "PEER_LEAVE", payload: { session_id: "otra" } } as never);
  check(solidsVersion() === v0, "no se rehace cuando entra o sale alguien (ni la física del coche y de las caídas, que lo sigue)");
  world.apply({ type: "DELTA", payload: { changes: [{ kind: "upsert", entity: entity([8, 1, -5, 1, 1, 1]) }] } } as never);
  const b = createBody(8, 0, 0);
  for (let i = 0; i < 180; i++) stepBody(b, 0, -WALK, 1 / 60, -LIM, LIM);
  check(solidsVersion() !== v0 && b.z > -4, "sí cuando cambia una entidad: la caja nueva ya para");
}

console.log(fails ? `\n${fails} fallo(s)` : "\na pie: todo bien");
process.exit(fails ? 1 : 0);
