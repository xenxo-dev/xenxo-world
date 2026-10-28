/**
 * Prueba de la física del coche sin navegador (Rapier en Node): que se apoye en sus ruedas, que
 * acelere, frene y gire como un coche, que no atraviese una pared y que se enderece si vuelca.
 *
 *   npm run test:vehicle -w @xenxo/web
 */
import { CarSim, loadRapier, type SolidBox, type StaticSource } from "../src/world/vehicle/physics.ts";
import { CAR } from "../src/world/vehicle/car.ts";

const boxes: SolidBox[] = [];
const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0) =>
  boxes.push({ x, y, z, hx, hy, hz, c: Math.cos(yaw), s: Math.sin(yaw) });
// Suelo (una losa como las capas de la calle) y una pared al fondo.
box(0, -0.05, 0, 400, 0.05, 400);
box(200, 2, 300, 20, 2, 0.15);
// Un bordillo de 12 cm: se sube.
box(-60, 0.06, 40, 4, 0.06, 20);
let version = 1;
const source: StaticSource = {
  version: () => version,
  boxes: (cb) => boxes.forEach(cb),
  meshes: () => {},
  bounds: () => [-390, 390],
};

const R = await loadRapier();
const sim = new CarSim(R, source);
const s = sim.state;
let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};
const run = (secs: number, throttle: number, steer = 0, handbrake = false, each?: (t: number) => void) => {
  for (let t = 0; t < secs; t += 1 / 60) {
    sim.update(1 / 60, { throttle, steer, handbrake });
    each?.(t);
  }
};
const yawOf = () => Math.atan2(2 * (s.qw * s.qy + s.qx * s.qz), 1 - 2 * (s.qy * s.qy + s.qx * s.qx));
const r1 = (v: number) => Math.round(v * 10) / 10;

// 1) En reposo: sobre sus cuatro ruedas, a la altura del modelo.
sim.spawn(0, 0, 0, 0);
run(3, 0);
console.log(`reposo: y=${s.y.toFixed(3)} ruedas en el suelo=${s.contacts} ruedaY=${[...s.wheelY].map((v) => v.toFixed(2))}`);
check(s.contacts === 4, "las cuatro ruedas pisan");
check(Math.abs(s.y - (CAR.wheelRadius - CAR.wheels[0]!.y)) < 0.08, "la carrocería queda a su altura (las ruedas tocan el suelo)");

// 2) Acelerar: 0-100 km/h en unos segundos, y velocidad punta.
let t100 = -1;
run(14, 1, 0, false, (t) => {
  if (t100 < 0 && s.speed > 27.8 * 0.9) t100 = t;
});
console.log(`acelera: ${r1(s.speed * 3.6)} km/h a los 14 s; 0-90 km/h en ${r1(t100)} s; z=${r1(s.z)}`);
check(s.speed > 24 && s.speed < 32, "velocidad punta entre 86 y 115 km/h");
check(t100 > 3 && t100 < 12, "acelera como un coche (0-90 km/h entre 3 y 12 s)");
check(Math.abs(s.x) < 1 && s.z > 50, "va recto hacia delante (+Z)");

// 3) Frenar desde la punta: unos 40-70 m.
const z0 = s.z;
let stopAt = -1;
run(8, -1, 0, false, () => {
  if (stopAt < 0 && s.speed < 0.5) stopAt = s.z;
});
console.log(`frena: ${r1(stopAt - z0)} m hasta pararse`);
check(stopAt - z0 > 25 && stopAt - z0 < 90, "frena en una distancia razonable");

// 4) Girar a la derecha (steer +1): con el frente en +Z, la derecha es −X.
sim.spawn(0, 0, -100, 0);
run(1, 0);
run(3, 0.6, 0);
const y0 = yawOf();
run(2.5, 0.6, 1);
const dyaw = yawOf() - y0;
console.log(`gira: Δyaw=${r1((dyaw * 180) / Math.PI)}°, x=${r1(s.x)}`);
check(s.x < -1, "steer +1 gira a la derecha");

// 5) Contra la pared a 80 km/h: no la atraviesa y se nota el golpe.
sim.spawn(200, 0, 200, 0);
run(1, 0);
let hit = 0;
run(10, 1, 0, false, () => (hit = Math.max(hit, s.impact)));
console.log(`pared: z=${r1(s.z)} (pared en 300), golpe=${r1(hit)} m/s`);
check(s.z < 300, "no atraviesa la pared");
check(hit > 3, "se nota el golpe");

// 6) Bordillo de 12 cm: lo sube.
sim.spawn(-60, 0, 10, 0);
run(1, 0);
run(5, 0.5);
console.log(`bordillo: y=${s.y.toFixed(2)} z=${r1(s.z)}`);
check(s.z > 25 && s.y > 0.06, "sube el bordillo");

// 7) Volcado: se endereza solo.
sim.spawn(100, 2, 0, 0);
// Ponerlo boca abajo a mano.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const body = (sim as any).chassis;
body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
run(5, 0);
const upY = 1 - 2 * (s.qx * s.qx + s.qz * s.qz);
console.log(`volcado: arriba=${upY.toFixed(2)} ruedas=${s.contacts}`);
check(upY > 0.9 && s.contacts >= 3, "se endereza solo");

// 8) Atropello: la persona sale despedida hacia delante y el coche pierde algo de velocidad, sin
//    clavarse (antes la gente era un poste y el coche se paraba en seco).
const hits: { nx: number; nz: number; speed: number }[] = [];
const crowd = {
  count: 1,
  at(_i: number, o: { x: number; y: number; z: number }) {
    o.x = 0.3;
    o.y = 0;
    o.z = -40;
  },
  hit(_i: number, nx: number, nz: number, speed: number) {
    hits.push({ nx, nz, speed });
  },
};
const sim2 = new CarSim(R, source, crowd);
sim2.spawn(0, 0, -80, 0);
const s2 = sim2.state;
let before = 0;
for (let t = 0; t < 8 && !hits.length; t += 1 / 60) {
  before = s2.speed;
  sim2.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
}
const after = s2.speed;
for (let t = 0; t < 1; t += 1 / 60) sim2.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
console.log(`atropello: ${hits.length} golpe(s) a ${r1((hits[0]?.speed ?? 0) * 3.6)} km/h hacia (${r1(hits[0]?.nx ?? 0)}, ${r1(hits[0]?.nz ?? 0)}); coche ${r1(before * 3.6)} → ${r1(after * 3.6)} km/h, sigue a ${r1(s2.speed * 3.6)} km/h`);
check(hits.length === 1, "le da una vez (no la vuelve a golpear enseguida)");
check((hits[0]?.nz ?? 0) > 0.6, "sale despedida hacia donde va el coche");
check(after > before * 0.85 && s2.speed > 10, "el coche pierde algo de velocidad pero no se clava");
sim2.dispose();

version++;
sim.dispose();
console.log(fails ? `\n${fails} fallos` : "\nTodo bien.");
process.exit(fails ? 1 : 0);
