/**
 * Prueba de la física del coche sin navegador (Rapier en Node): que se apoye en sus ruedas, que
 * acelere, frene y gire como un coche, que no atraviese una pared y que se enderece si vuelca.
 *
 *   npm run test:vehicle -w @xenxo/web
 */
import * as THREE from "three";
import { CarSim, loadRapier, type OtherCar, type OtherCars, type SolidBox, type StaticSource } from "../src/world/vehicle/physics.ts";
import { CAR, driverRoot, leanFor } from "../src/world/vehicle/car.ts";
import { driverFx, releaseDriver } from "../src/world/vehicle/driver.ts";
import { createFx } from "../src/world/people/rig.ts";

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

// 9) Fluidez: la física va a pasos fijos de 1/60 s y la pantalla, a lo que dé (72, 90 y 120 Hz en
//    las gafas y los móviles, 144 o 240 Hz en el escritorio). Lo que se dibuja se interpola entre
//    los dos últimos pasos: a velocidad constante, el coche avanza lo mismo en cada frame. Sin
//    eso, a 144 Hz más de la mitad de los frames lo dejaban clavado y el resto lo hacían saltar.
for (const hz of [50, 90, 144, 240]) {
  sim.spawn(0, 0, -300, 0);
  run(12, 0.5);
  let prev = s.z, sum = 0, sum2 = 0, n = 0, stuck = 0;
  // El reloj de un navegador nunca es exacto: cada frame dura un poco más o un poco menos.
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < hz * 4; i++) {
    const dt = (1 / hz) * (0.94 + 0.12 * rnd());
    sim.update(dt, { throttle: 0.5, steer: 0, handbrake: false });
    const ratio = (s.z - prev) / (s.speed * dt);
    prev = s.z;
    sum += ratio;
    sum2 += ratio * ratio;
    n++;
    if (ratio < 0.05) stuck++;
  }
  const mean = sum / n;
  const uneven = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  console.log(`fluidez a ${hz} Hz: avanza ×${mean.toFixed(3)} de lo que toca, irregularidad ${(uneven * 100).toFixed(2)} %, ${stuck} frame(s) sin moverse`);
  check(stuck === 0 && uneven < 0.02 && Math.abs(mean - 1) < 0.01, `a ${hz} Hz avanza lo mismo en cada frame`);
}

// Quien conduce: sentado en su asiento de verdad (medidas del modelo: el cojín a 12 cm en lo más
// bajo, z = 0,65; el respaldo en z = 0,49 a la altura de la cadera; el aro del volante a los lados
// en (±0,17; 0,64; 0,93); el suelo de los pies a 9 cm; la base de la columna, 13 cm a cada lado; el
// salpicadero desde z = 1,55 y el forro del techo a 1,05). Antes iba 50 cm más atrás: el tronco por
// detrás del respaldo, las piernas a través de él y los pies bajo el suelo.
{
  const SEAT = { low: 0.12, lowZ: 0.65, backZ: 0.49, floor: 0.09, column: 0.126, dash: 1.55, roof: 1.05, rim: { x: 0.17, y: 0.64, z: 0.93 } };
  const h = CAR.driverHips;
  check(h.x === 0 && h.y > SEAT.low + 0.07 && h.y < SEAT.low + 0.13 && h.z > SEAT.backZ + 0.09 && h.z < SEAT.lowZ + 0.08, "la cadera, sobre el cojín y por delante del respaldo");
  const w = CAR.wrist;
  const toRim = Math.hypot(w.x - SEAT.rim.x, w.y - SEAT.rim.y, w.z - SEAT.rim.z);
  check(toRim > 0.04 && toRim < 0.12 && w.z < SEAT.rim.z && w.x >= SEAT.rim.x, "las muñecas, a una mano del aro, por fuera y por detrás");
  for (const a of [CAR.ankleL, CAR.ankleR]) {
    check(a.y > SEAT.floor + 0.06 && a.y < SEAT.floor + 0.14 && Math.abs(a.x) > SEAT.column + 0.04 && a.z > 1.2 && a.z < SEAT.dash - 0.15, `el tobillo ${a.x > 0 ? "izquierdo" : "derecho"}, sobre el suelo, a un lado de la columna y antes del salpicadero`);
  }
  // Recostado lo que pida su estatura: de 1,49 m (0,72 de la cadera a la coronilla) a 2,02 m (0,94).
  const leans = [0.72, 0.78, 0.82, 0.88, 0.94].map((sit) => ({ sit, lean: leanFor(sit) }));
  console.log(`recostado: ${leans.map((l) => `${l.sit} m → ${Math.round((l.lean * 180) / Math.PI)}°`).join(", ")}`);
  check(leans.every((l) => l.lean >= CAR.lean - 1e-9 && l.lean <= CAR.leanMax + 1e-9 && h.y + l.sit * Math.cos(l.lean) <= SEAT.roof + 0.005), "quepa quien quepa, la cabeza queda bajo el techo");
  check(leanFor(0.82) === CAR.lean && leanFor(0.94) > CAR.lean + 0.08, "a quien cabe, lo del asiento; al más alto, más");
  // En el mundo: con el coche girado e inclinado (en mitad del looping), todo va con él.
  const p = new THREE.Vector3(12, 3, -7), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.9, 2.1, 0.3, "YXZ"));
  const fx = createFx();
  driverFx(fx, p, q, 1, 0.5);
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q).add(p);
  const off = (t: { x: number; y: number; z: number }, v: THREE.Vector3) => Math.hypot(t.x - v.x, t.y - v.y, t.z - v.z);
  const worst = Math.max(off(fx.seat, at(h.x, h.y, h.z)), off(fx.reachL, at(w.x, w.y, w.z)), off(fx.reachR, at(-w.x, w.y, w.z)), off(fx.footL, at(CAR.ankleL.x, CAR.ankleL.y, CAR.ankleL.z)), off(fx.footR, at(CAR.ankleR.x, CAR.ankleR.y, CAR.ankleR.z)));
  check(worst < 1e-6 && fx.seat.w === 1 && fx.footL.w === 1 && fx.reachL.w === 0.5 && fx.reachR.w === 0.5, "la cadera, los pies y las manos van con el coche, gire como gire");
  // Los codos, hacia abajo del coche; las rodillas, hacia arriba y cada una a su lado.
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q), left = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const dot = (t: { px: number; py: number; pz: number }, v: THREE.Vector3) => t.px * v.x + t.py * v.y + t.pz * v.z;
  check(dot(fx.reachL, up) < 0 && dot(fx.reachR, up) < 0 && dot(fx.reachL, left) > 0 && dot(fx.reachR, left) < 0, "los codos, abajo y cada uno a su lado");
  check(dot(fx.footL, up) > 0 && dot(fx.footR, up) > 0 && dot(fx.footL, left) > 0 && dot(fx.footR, left) < 0, "las rodillas, arriba y abiertas");
  releaseDriver(fx);
  check([fx.seat, fx.footL, fx.footR, fx.reachL, fx.reachR].every((t) => t.w === 0 && t.px === 0 && t.py === 0 && t.pz === 0), "al bajar se suelta todo");
  // Al sentarse (la pose de la silla, antes de la de conducir), la raíz va donde deja la cadera en el
  // asiento: en esa pose la cadera queda `sitHips` por encima y por detrás de los pies (el personaje
  // mira a −Z; va girado media vuelta y echado atrás).
  for (const sit of [0.82, 0.94]) {
    const lean = leanFor(sit), root = driverRoot(lean);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -lean).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    const hips = new THREE.Vector3(0, CAR.sitHips.up, CAR.sitHips.back).applyQuaternion(turn).add(new THREE.Vector3(root.x, root.y, root.z));
    check(hips.distanceTo(new THREE.Vector3(h.x, h.y, h.z)) < 1e-6, `al sentarse (recostado ${Math.round((lean * 180) / Math.PI)}°), la cadera llega a su asiento`);
  }
}

// Choques entre coches. Cada cliente lleva solo su coche y ve a los demás donde se dibujan (con su
// retraso): choca con lo que ve. Los de los demás son sólidos con su masa que van a donde se les
// dibuja; un choque reparte la velocidad (no es darse contra un muro) y lo que mi golpe desplace al
// otro se ve y se deshace. Parados no cuentan (ni el suyo ni el mío), ni apareciendo de golpe, ni si
// al empezar a contar ya están encima.
{
  const list = new Map<string, OtherCar>();
  const others: OtherCars = { each: (cb) => list.forEach((c, k) => cb(k, c)) };
  const put = (id: string, x: number, y: number, z: number, yaw = 0) => {
    let c = list.get(id);
    if (!c) list.set(id, (c = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, ox: 0, oy: 0, oz: 0 }));
    c.x = x;
    c.y = y;
    c.z = z;
    c.qy = Math.sin(yaw / 2);
    c.qw = Math.cos(yaw / 2);
    return c;
  };
  const me = new CarSim(R, source, undefined, others);
  const m = me.state;
  /** La altura del coche en reposo (la del primer apartado). */
  me.spawn(0, 0, 0, 0);
  for (let i = 0; i < 120; i++) me.update(1 / 60, { throttle: 0, steer: 0, handbrake: true });
  const restY = m.y;
  const upOf = () => 1 - 2 * (m.qx * m.qx + m.qz * m.qz);
  const yaw = () => Math.atan2(2 * (m.qw * m.qy + m.qx * m.qz), 1 - 2 * (m.qy * m.qy + m.qx * m.qx));
  const hold = (v: number) => Math.max(-1, Math.min(1, (v - m.speed) * 0.6));
  /** Avanza `secs` a `hz` frames por segundo; `frame(t)` coloca a los demás y dice qué pide quien conduce. */
  const go = (secs: number, hz: number, frame: (t: number) => { throttle: number; steer?: number }, after?: (t: number) => void) => {
    const n = Math.round(secs * hz);
    for (let i = 0; i < n; i++) {
      const t = i / hz;
      const d = frame(t);
      me.update(1 / hz, { throttle: d.throttle, steer: d.steer ?? 0, handbrake: false });
      after?.(t);
    }
  };

  // a) Alcanzar a uno más lento (él a 36 km/h, yo a fondo): le doy por detrás, pierdo buena parte de
  //    lo que llevaba de más (no todo de golpe), no lo atravieso y me quedo detrás, a su paso. A él
  //    se le ve dar el tirón hacia delante y volver a su sitio.
  for (const hz of [60, 30, 144]) {
    list.clear();
    me.spawn(0, 0, -300, 0);
    let rz = 0, hitAt = -1, v0 = 0, v1 = -1, gap = 99, push = 0, top = 0, upMin = 1, prev = 0, solid = 0;
    go(14, hz, (t) => {
      rz = -220 + 10 * t;
      put(`a${hz}`, 0, restY, rz);
      prev = m.speed;
      return { throttle: 1 };
    }, (t) => {
      const c = list.get(`a${hz}`)!;
      if (hitAt < 0 && (Math.abs(c.oz) > 0.02 || m.impact > 1.5)) {
        hitAt = t;
        v0 = prev;
      }
      if (hitAt >= 0 && v1 < 0 && t - hitAt >= 0.4) v1 = m.speed;
      if (hitAt >= 0) {
        gap = Math.min(gap, rz + c.oz - m.z);
        push = Math.max(push, c.oz);
        top = Math.max(top, m.y - restY);
        upMin = Math.min(upMin, upOf());
      }
      solid = Math.max(solid, me.rivalsSolid);
    });
    const c = list.get(`a${hz}`)!;
    console.log(`alcance a ${hz} Hz: choque a los ${r1(hitAt)} s yendo a ${r1(v0 * 3.6)} km/h (él a 36); 0,4 s después voy a ${r1(v1 * 3.6)}; al final a ${r1(m.speed * 3.6)} km/h y ${r1(rz - m.z)} m detrás; hueco mínimo ${gap.toFixed(2)} m; a él se le ve irse ${push.toFixed(2)} m y queda a ${c.oz.toFixed(2)}; salto ${top.toFixed(2)} m`);
    check(hitAt > 0 && solid === 1, `a ${hz} Hz: le alcanzo y choco con él`);
    check(v1 < v0 - (v0 - 10) * 0.3 && v1 > 10 - 2.5, `a ${hz} Hz: pierdo de golpe parte de lo que llevaba de más, no hasta pararme`);
    check(gap > CAR.length - 0.7, `a ${hz} Hz: no lo atravieso`);
    check(Math.abs(m.speed - 10) < 2.5 && rz - m.z > CAR.length - 0.5 && rz - m.z < CAR.length + 1.5, `a ${hz} Hz: me quedo detrás, a su paso`);
    check(push > 0.15 && push < 8 && Math.abs(c.oz) < 0.15, `a ${hz} Hz: se le ve el tirón y vuelve a su sitio`);
    check(top < 0.3 && upMin > 0.93 && Math.abs(m.x) < 0.5, `a ${hz} Hz: sin saltos ni trompos`);
  }

  // b) Uno más rápido que viene por detrás y, en su pantalla, no ha chocado conmigo (su pose sigue
  //    de largo por donde voy yo): me da un empujón —no me lanza— y, como no hay manera de que
  //    vuelva a su sitio sin llevarme por delante, deja de contar y pasa.
  {
    list.clear();
    me.spawn(0, 0, -300, 0);
    go(4, 60, () => ({ throttle: hold(8) }));
    const z0 = m.z;
    let vmax = 0, top = 0, upMin = 1, was = 0, gone = false, xmax = 0, rz = 0;
    go(8, 60, (t) => {
      rz = z0 - 70 + 28 * t;
      put("b", 0, restY, rz);
      return { throttle: hold(8) };
    }, () => {
      vmax = Math.max(vmax, m.speed);
      top = Math.max(top, m.y - restY);
      upMin = Math.min(upMin, upOf());
      xmax = Math.max(xmax, Math.abs(m.x));
      if (me.rivalsSolid) was = 1;
      else if (was && rz > m.z - 2 && rz < m.z + 6) gone = true;
    });
    console.log(`embestida: de 28,8 a ${r1(vmax * 3.6)} km/h como mucho (él venía a 100,8); salto ${top.toFixed(2)} m, desvío ${xmax.toFixed(2)} m; al final a ${r1(m.speed * 3.6)} km/h, él ${r1(rz - m.z)} m por delante`);
    check(was === 1 && vmax > 8 + 3 && vmax < 8 + 20 * 0.75, "me empuja, pero no me lanza");
    check(gone && rz - m.z > 20, "y deja de contar: pasa de largo");
    check(top < 0.3 && upMin > 0.93 && xmax < 0.6 && m.contacts === 4 && Math.abs(m.speed - 8) < 3, "sigo a lo mío, sobre mis ruedas");
  }

  // c) Parado no cuenta: paso a través de un coche parado en medio (nadie corta la pista con el suyo).
  {
    list.clear();
    me.spawn(0, 0, -300, 0);
    let solid = 0, bang = 0;
    go(9, 60, () => {
      put("c", 0, restY, -200, 1.2);
      return { throttle: 1 };
    }, () => {
      solid = Math.max(solid, me.rivalsSolid);
      bang = Math.max(bang, m.impact);
    });
    console.log(`parado en medio: paso hasta z=${r1(m.z)} a ${r1(m.speed * 3.6)} km/h, golpe ${bang.toFixed(2)}`);
    check(solid === 0 && m.z > -170 && bang < 1 && Math.abs(m.x) < 0.2, "un coche parado se atraviesa");
  }

  // d) Y al revés: parado yo, el que viene lanzado me atraviesa (en su pantalla soy yo el parado).
  {
    list.clear();
    me.spawn(0, 0, -300, 0);
    go(2, 60, () => ({ throttle: 0 }));
    const at = { x: m.x, z: m.z };
    let solid = 0;
    go(6, 60, (t) => {
      put("d", 0, restY, -380 + 30 * t);
      return { throttle: 0 };
    }, () => (solid = Math.max(solid, me.rivalsSolid)));
    console.log(`parado yo: me muevo ${Math.hypot(m.x - at.x, m.z - at.z).toFixed(3)} m`);
    check(solid === 0 && Math.hypot(m.x - at.x, m.z - at.z) < 0.05, "parado, no me embisten");
  }

  // e) Ya encima al empezar a contar (dos que arrancan pisándose): no cuenta hasta que se separa.
  {
    list.clear();
    me.spawn(0, 0, -300, 0);
    let solidNear = 0, solidFar = 0, xmax = 0;
    go(8, 60, (t) => {
      // A mi lado, pisándome medio coche, a mi paso; desde los 5 s, a tres metros y medio.
      put("e", t < 5 ? 1.1 : 1.1 + Math.min(2.4, (t - 5) * 1.6), restY, m.z + 0.4);
      return { throttle: hold(15) };
    }, (t) => {
      if (t < 5) {
        solidNear = Math.max(solidNear, me.rivalsSolid);
        xmax = Math.max(xmax, Math.abs(m.x));
      } else solidFar = Math.max(solidFar, me.rivalsSolid);
    });
    console.log(`encima al arrancar: desvío ${xmax.toFixed(3)} m; cuenta al separarse: ${solidFar}`);
    check(solidNear === 0 && xmax < 0.1, "si ya está encima, no cuenta (nadie sale despedido)");
    check(solidFar === 1, "y cuenta en cuanto se separa");
  }

  // f) Aparece de golpe (ha vuelto a la pista, llega de un salto): no cuenta hasta pasado un momento.
  {
    list.clear();
    me.spawn(0, 0, -300, 0);
    let bang = 0, xmax = 0, v = 0, dip = 0;
    go(10, 60, (t) => {
      // Por delante, a mi paso; a los 6 s salta a un metro de mi morro, cruzado, y sigue a mi paso.
      if (t < 6) put("f", 3.5, restY, m.z + 30);
      else put("f", 0, restY, m.z + 5.2, 1.57);
      v = m.speed;
      return { throttle: hold(15) };
    }, (t) => {
      if (t > 5.9 && t < 6.7) {
        bang = Math.max(bang, m.impact);
        xmax = Math.max(xmax, Math.abs(m.x));
        dip = Math.max(dip, v - m.speed);
      }
    });
    console.log(`aparece de golpe: golpe ${bang.toFixed(2)}, desvío ${xmax.toFixed(3)} m`);
    check(bang < 0.8 && xmax < 0.1 && dip < 0.5, "quien aparece de golpe no me da");
  }

  // g) De lado: uno que va a mi paso se me echa encima y vuelve a su carril. Me aparta sin trompo.
  {
    list.clear();
    me.spawn(0, 0, -300, 0);
    go(5, 60, () => ({ throttle: hold(20) }));
    let xmax = 0, turn = 0, vmin = 99, deep = 0, solid = 0;
    const y0 = yaw();
    go(8, 60, (t) => {
      // De 3,4 m a 1,2 m de mi línea (los coches miden 2,24 de ancho) y vuelta.
      const x = 3.4 - 2.2 * Math.max(0, Math.min(1, (t - 1) / 1.5)) + 2.2 * Math.max(0, Math.min(1, (t - 4) / 1.5));
      put("g", x, restY, m.z + 0.3);
      return { throttle: hold(20) };
    }, () => {
      const c = list.get("g")!;
      xmax = Math.max(xmax, -m.x);
      turn = Math.max(turn, Math.abs(yaw() - y0));
      vmin = Math.min(vmin, m.speed);
      solid = Math.max(solid, me.rivalsSolid);
      if (me.rivalsSolid) deep = Math.max(deep, CAR.width - 0.16 - (c.x + c.ox - m.x));
    });
    console.log(`de lado: me aparta ${xmax.toFixed(2)} m, giro ${r1((turn * 180) / Math.PI)}°, mínima ${r1(vmin * 3.6)} km/h, se meten ${deep.toFixed(2)} m`);
    check(solid === 1 && xmax > 0.25 && xmax < 3, "me aparta");
    check(turn < 0.35 && vmin > 14 && upOf() > 0.95 && m.contacts === 4, "sin trompo ni frenazo");
    check(deep < 0.5, "sin meterse uno dentro del otro");
  }

  // h) De frente, a 72 km/h cada uno: un golpe serio, pero ni salgo volando ni acabo del revés.
  {
    list.clear();
    me.spawn(0, 0, -300, 0);
    go(5, 60, () => ({ throttle: hold(20) }));
    const z0 = m.z;
    let top = 0, vmax = 0, vmin = 99, ok = true;
    go(7, 60, (t) => {
      put("h", 0, restY, z0 + 120 - 20 * t, Math.PI);
      return { throttle: t < 3.2 ? hold(20) : 0 };
    }, (t) => {
      top = Math.max(top, m.y - restY);
      vmax = Math.max(vmax, Math.abs(m.speed));
      if (t > 2.5 && t < 3.6) vmin = Math.min(vmin, m.speed);
      ok &&= Number.isFinite(m.x + m.y + m.z + m.qw);
    });
    console.log(`de frente: de 72 a ${r1(vmin * 3.6)} km/h, salto ${top.toFixed(2)} m, velocidad máxima ${r1(vmax * 3.6)} km/h, acabo en z=${r1(m.z - z0)} con ${m.contacts} ruedas`);
    check(ok && vmin < 8 && vmin > -16 && top < 0.6 && vmax < 26, "de frente: me para en seco (o me echa atrás), sin salir volando");
    check(upOf() > 0.9 && m.contacts >= 3, "y acabo sobre mis ruedas");
  }

  // j) Lo sólido del lugar cambia a ratos (llega un modelo, alguien aparca): la física da un paso de
  //    más para ponerse al día, y ese paso no es de nadie. Un coche que va por delante, lejos, no se
  //    mueve de donde se dibuja. Y los que ya no cuentan no vuelven a contar por eso: el del choque
  //    de frente de antes se quedó justo en mi camino, y paso por donde estaba sin tocar nada.
  {
    list.clear();
    me.spawn(0, 0, -300, 0);
    let worst = 0, n = 0, bang = 0;
    go(8, 60, (t) => {
      put("j", 3.6, restY, -270 + 12 * t);
      if (++n % 20 === 0) version++;
      return { throttle: hold(12) };
    }, () => {
      const c = list.get("j")!;
      worst = Math.max(worst, Math.hypot(c.ox, c.oy, c.oz));
      bang = Math.max(bang, m.impact);
    });
    console.log(`cambia lo sólido del lugar: el de delante se desplaza ${worst.toFixed(3)} m; llego a z=${r1(m.z)} a ${r1(m.speed * 3.6)} km/h, golpe ${bang.toFixed(2)}`);
    check(worst < 0.01 && me.rivalsSolid === 1, "un paso de más de la física no mueve los coches de los demás");
    check(bang < 1 && m.z > -222 && Math.abs(m.speed - 12) < 1, "ni devuelve a la pista a los que ya no cuentan");
  }

  // k) A uno lo devuelven a la pista (se había caído): sube a plomo, cruza por encima y se posa justo
  //    delante de mí. No cuenta en todo el viaje: ni me levanta al pasar ni me para al posarse.
  {
    list.clear();
    me.spawn(0, 0, -300, 0);
    go(4, 60, () => ({ throttle: hold(15) }));
    let solid = 0, bang = 0, t0 = -1, z0 = 0;
    go(6, 60, (t) => {
      if (t0 < 0) {
        t0 = t;
        z0 = m.z;
      }
      // Sube 12 m a 26 m/s, cruza 40 m a 30 m/s hacia mi carril y baja a 5 m/s hasta quedarse quieto delante.
      const u = t - t0, land = z0 + 32;
      const up = Math.min(u, 12 / 26), across = Math.max(0, Math.min(u - 12 / 26, 40 / 30)), down = Math.max(0, Math.min(u - 12 / 26 - 40 / 30, 2.2 / 5));
      put("k", 40 - across * 30, restY - 9.8 + up * 26 - down * 5, land);
      return { throttle: hold(15) };
    }, () => {
      solid = Math.max(solid, me.rivalsSolid);
      bang = Math.max(bang, m.impact);
    });
    console.log(`lo devuelven a la pista delante de mí: cuenta ${solid}, golpe ${bang.toFixed(2)}, paso hasta z=${r1(m.z - z0)}`);
    check(solid === 0 && bang < 1 && m.z - z0 > 75 && Math.abs(m.x) < 0.2, "a quien llevan de vuelta a la pista no se le choca (ni al posarse)");
  }

  // i) Las ruedas no pisan los coches de los demás, y deja de contar quien deja de verse.
  {
    list.clear();
    me.spawn(0, 0, -300, 0);
    go(4, 60, () => ({ throttle: hold(12) }));
    let solid = 0;
    go(2, 60, () => {
      put("i", 4, restY, m.z + 1);
      return { throttle: hold(12) };
    }, () => (solid = Math.max(solid, me.rivalsSolid)));
    const c = list.get("i")!;
    c.ox = 0.4;
    list.clear();
    go(0.1, 60, () => ({ throttle: hold(12) }));
    check(solid === 1 && me.rivalsSolid === 0 && c.ox === 0, "quien deja de conducir deja de contar (y lo desplazado se borra)");
  }
  me.dispose();
}

version++;
sim.dispose();
console.log(fails ? `\n${fails} fallos` : "\nTodo bien.");
process.exit(fails ? 1 : 0);
