/**
 * Prueba de la llegada a un lugar, sin navegador: quien llega por un enlace (/d/<distrito>/<sitio>), por
 * «Qué hacer aquí» o por una puerta se queda donde llega.
 *
 * - **El cuerpo espera a la foto del lugar** (`world.walkable`, net/world-store.ts). La conexión se abre
 *   un viaje de ida y vuelta antes de que llegue el SNAPSHOT y en ese rato no hay suelo: quien llegaba a
 *   la parrilla del Circuito Vértigo (a 26 m) con una red normal acababa en la calle de debajo.
 * - **Cada sitio tiene suelo con lo que manda el servidor** (la siembra del distrito, districts.ts) y
 *   antes de que cargue ninguna malla (las pistas de los circuitos lo son): el cuerpo y las colisiones de
 *   verdad (world/locomotion.ts sobre world/collision.ts).
 *
 *   npm run test:guide -w @xenxo/web   (corre detrás de test/guide.mts)
 */
import type { Entity } from "@xenxo/protocol";
import activities from "../../realtime/src/district-activities.json";
import { DISTRICT_BOUNDS, DISTRICTS, districtSeed } from "../../realtime/src/districts.ts";
import { world } from "../src/net/world-store";
import { directPlace, GUIDED, spotIds, spotOf } from "../src/world/guide";
import { createBody, stepBody, STEP_UP, type Body } from "../src/world/locomotion";

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};

const [B0, B1] = DISTRICT_BOUNDS;
const HZ = 60;

/** Lo que manda el servidor al llegar a un distrito: su siembra, tal cual (sin mallas: aquí no cargan). */
function snapshot(id: string) {
  const d = DISTRICTS.find((x) => x.id === id)!;
  const entities = districtSeed(d, { p: [32, 0, 32], yaw: 0 }).map((e) => ({ entity_id: e.id, chunk_id: d.chunk, owner: "system", rev: 1, components: e.components }) as unknown as Entity);
  return { v: 0, type: "SNAPSHOT", payload: { entities, peers: [], poses: [] } } as never;
}
const welcome = (chunk: string) => ({ v: 0, type: "WELCOME", payload: { session_id: "yo", principal: { sub: "g_1", kind: "guest", scopes: [] }, chunk_id: chunk, server_time: Date.now(), tick_hz: 8, budgets: {}, walk: [B0, B1] } }) as never;

/**
 * `secs` segundos de pie, sin tocar nada. Como en Player.tsx: el cuerpo solo da pasos donde ya se puede
 * andar (`rule`: la de ahora, `world.walkable`; la de antes, en cuanto se abría la conexión).
 */
function frames(b: Body, secs: number, rule: () => boolean = () => world.walkable) {
  for (let i = 0; i < Math.round(secs * HZ); i++) if (rule()) stepBody(b, 0, 0, 1 / HZ, B0, B1);
}

/**
 * Una llegada entera con la red tardando `lagMs` de ida y vuelta: empieza el viaje, se conecta, se abre
 * la conexión, y la foto del lugar llega `lagMs` después. Devuelve dónde acaba el cuerpo.
 */
function arrive(district: string, p: readonly number[], lagMs: number, rule?: () => boolean): Body {
  const d = DISTRICTS.find((x) => x.id === district)!;
  const b = createBody(p[0]!, p[1]!, p[2]!);
  world.beginTravel(d.chunk);
  world.setStatus("connecting");
  frames(b, 0.3, rule);
  world.setStatus("open");
  frames(b, lagMs / 1000, rule);
  world.apply(welcome(d.chunk));
  world.apply(snapshot(district));
  frames(b, 2, rule);
  return b;
}

console.log("El cuerpo espera a la foto del lugar");
{
  const v = directPlace("arcade", "vertigo");
  if (!v || v === "soon") check(false, "…/d/arcade/vertigo existe");
  else {
    check(v.p[1] > 20, `…/d/arcade/vertigo deja en la parrilla del cielo, a ${v.p[1]} m`);
    world.beginTravel(v.chunk);
    world.setStatus("connecting");
    check(!world.walkable, "viajando, no se anda");
    world.setStatus("open");
    check(!world.walkable, "con la conexión abierta pero sin la foto del lugar, tampoco");
    world.apply(welcome(v.chunk));
    check(!world.walkable, "ni con el WELCOME solo");
    world.apply(snapshot("arcade"));
    check(world.walkable, "al llegar la foto, sí");
    world.setStatus("closed");
    check(!world.walkable, "si se corta la conexión, se para");
    world.setStatus("open");
    check(world.walkable, "y al volver al mismo lugar se sigue con lo que había, sin esperar otra foto");
    world.beginTravel("c_0_0");
    world.setStatus("open");
    check(!world.walkable, "otro viaje: a esperar la foto del lugar nuevo");

    // La llegada entera, con redes de todo tipo (lo que tarda el servidor en contestar).
    const ends = [0, 40, 120, 300, 800, 2500].map((lag) => ({ lag, b: arrive("arcade", v.p, lag) }));
    console.log(`  con 0–2500 ms de red: acaba a ${ends.map((e) => e.b.y.toFixed(2)).join(", ")} m`);
    check(ends.every((e) => Math.abs(e.b.y - v.p[1]) < 0.05 && e.b.grounded && Math.hypot(e.b.x - v.p[0], e.b.z - v.p[2]) < 0.05), "tarde lo que tarde la red, se queda arriba, de pie en la parrilla");
    // Con la regla de antes (dar pasos en cuanto se abre la conexión), esto es lo que pasaba.
    const old = [40, 120, 300, 800].map((lag) => ({ lag, b: arrive("arcade", v.p, lag, () => world.status === "open") }));
    console.log(`  (dando pasos sin esperar a la foto: con 40, 120, 300 y 800 ms acababa a ${old.map((e) => e.b.y.toFixed(1)).join(", ")} m)`);
    check(old.filter((e) => e.b.y < 1).length >= 2, "sin esa espera, con una red normal ya no lo recoge nada: a la calle");
  }
}

console.log("Cada sitio tiene suelo con lo que manda el servidor (sin mallas)");
{
  /** ¿Se queda donde llega? En alto, ni un palmo; a menos de un escalón de la calle puede bajar a ella. */
  const stays = (b: Body, p: readonly number[]) => (p[1]! > STEP_UP ? Math.abs(b.y - p[1]!) < 0.1 : b.y > -0.01 && b.y < p[1]! + 0.1) && Math.hypot(b.x - p[0]!, b.z - p[2]!) < 0.3;
  const fmt = (b: Body) => `[${b.x.toFixed(1)}, ${b.y.toFixed(2)}, ${b.z.toFixed(1)}]`;
  for (const d of GUIDED) {
    const bad: string[] = [];
    let high = 0;
    for (const sid of spotIds(d.id)) {
      const s = spotOf(d.id, sid)!;
      if (s.p[1] > STEP_UP) high++;
      const b = arrive(d.id, s.p, 150);
      if (!stays(b, s.p)) bad.push(`${sid} [${s.p.join(", ")}] → ${fmt(b)}`);
    }
    check(bad.length === 0, `${d.id}: ${spotIds(d.id).length} sitios${high ? ` (${high} en alto)` : ""}, y en todos se queda donde llega${bad.length ? ` — ${bad.join("; ")}` : ""}`);
  }
  // Las puertas de dentro de un distrito (portal@1 al mismo lugar: del suelo a la pista del cielo y vuelta).
  const ACTS = activities as unknown as Record<string, { portals?: { to: { p: number[] } }[] } | undefined>;
  for (const [id, acts] of Object.entries(ACTS)) {
    const doors = acts?.portals ?? [];
    if (!doors.length || !DISTRICTS.some((x) => x.id === id)) continue;
    const bad = doors.map((pt) => ({ p: pt.to.p, b: arrive(id, pt.to.p, 0) })).filter((r) => !stays(r.b, r.p));
    check(bad.length === 0, `${id}: sus ${doors.length} puertas dejan en un sitio con suelo${bad.length ? ` — ${bad.map((r) => `[${r.p.join(", ")}] → ${fmt(r.b)}`).join("; ")}` : ""}`);
  }
}

console.log(fails ? `\n${fails} fallos` : "\nTodo bien");
process.exit(fails ? 1 : 0);
