/**
 * Prueba de los juegos de pillar (tag@1, docs/PROTOCOL.md §9 decies), sin navegador:
 *
 *  1. La cuenta del servidor (apps/realtime/src/tag.ts): el corro y la cuenta atrás, quién la lleva
 *     al empezar, los toques (sin devolución), quién se queda fuera, el final, quién gana y sus puntos;
 *     lo que se reparte valida contra el protocolo.
 *  2. Lo que hace el cliente (src/net/tag.ts): qué ronda se enseña, quién se queda quieto al empezar,
 *     cuándo se puede pillar y a quién se está tocando.
 *  3. Los corros del sistema (district-activities.json): su sitio está libre, tiene suelo y no lo
 *     cruza el camino de nadie, y su zona cabe en el distrito.
 *
 *   npm run test:tag -w @xenxo/web
 */
import { readFileSync } from "node:fs";
import { msg, ServerMessage, TAG_PLAYERS_MAX, TagV1 } from "@xenxo/protocol";
import {
  dropTag, dwellIn, finishTag, itMsAt, joinTag, leaveLobby, newTagGame, seeTag, startTag, tagHit, tagOver, tagPayload, tagPoints, tagStandings,
  TAG_BACK_MS, TAG_COUNTDOWN_MS, TAG_DWELL_MS, TAG_HEADSTART_MS, TAG_JOIN_MS, TAG_OPEN_MAX_MS, TAG_OUTSIDE_MS, TAG_PAUSE_MS, TAG_READY_MS, TAG_TWO_INFECTED,
  type TagGame,
} from "../../realtime/src/tag.ts";
import { canTag, heldAtStart, insideArea, itMsNow, myRole, nextTag, playing, tagClock, tagFresh, touchTarget, TAG_PODIUM_MS, TOUCH_R, type TagState } from "../src/net/tag.ts";

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};
const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const who = (n: number, ranked = true) => ({ session_id: `s${n}`, sub: `u${n}`, ranked, name: `P${n}` });
/** Azar de prueba: siempre el primero (o el que diga `k`). */
const first = () => 0;
const valid = (g: TagGame, now: number) => ServerMessage.safeParse(msg("TAG_ROUND", tagPayload(g, now))).success;

/* ------------------------------------------------------------------ */
/* 1) La cuenta del servidor                                           */
/* ------------------------------------------------------------------ */
console.log("Pilla-pilla (servidor):");
const t0 = 1_000_000;
{
  const g = newTagGame({ entity_id: "vertical_tag_pilla", game: "pilla", owner: "system", mode: "tag", seconds: 120 });
  check(joinTag(g, who(1), t0) && g.state === "open" && g.round === 1, "el primero abre la ronda y espera (hacen falta dos)");
  check(!joinTag(g, who(1), t0 + 300), "volver a entrar no cambia nada");
  check(valid(g, t0), "lo que se reparte esperando valida contra el protocolo");
  joinTag(g, who(2), t0 + 1000);
  check(g.state === "countdown" && g.goAt === t0 + 1000 + TAG_COUNTDOWN_MS, "con el segundo empieza la cuenta atrás");
  joinTag(g, who(3), t0 + 1000 + TAG_COUNTDOWN_MS - 1000);
  check(g.goAt === t0 + 1000 + TAG_COUNTDOWN_MS - 1000 + TAG_JOIN_MS, "quien llega justo la alarga lo que necesita para verla");
  for (let k = 0; k < 6; k++) joinTag(g, who(10 + k), g.goAt - 500);
  check(g.goAt <= g.countFrom + TAG_OPEN_MAX_MS, "pero nunca más allá del tope desde que empezó la cuenta");
  check(leaveLobby(g, "s3") && g.players.size === 8 && g.state === "countdown", "salir del corro antes de empezar es irse");
  for (const id of ["s10", "s11", "s12", "s13", "s14", "s15", "s2"]) leaveLobby(g, id);
  check(g.state === "open" && g.players.size === 1, "sin los mínimos, vuelve a esperar");
  leaveLobby(g, "s1");
  check(g.state === "idle" && valid(g, t0 + 20_000), "sin nadie, vacío (y también se reparte)");

  // Lleno.
  const full = newTagGame({ entity_id: "e_full_0", game: "pilla", owner: "system", mode: "tag", seconds: 60 });
  for (let n = 1; n <= TAG_PLAYERS_MAX + 2; n++) joinTag(full, who(n), t0 + n);
  check(full.players.size === TAG_PLAYERS_MAX, `caben ${TAG_PLAYERS_MAX}`);
}
{
  // Una ronda entera a tres.
  const g = newTagGame({ entity_id: "vertical_tag_pilla", game: "pilla", owner: "system", mode: "tag", seconds: 120 });
  joinTag(g, who(1), t0);
  joinTag(g, who(2, false), t0 + 500);
  joinTag(g, who(3), t0 + 900);
  const go = g.goAt;
  check(startTag(g, go, first) && g.state === "running" && g.endAt === go + 120_000, "a su hora empieza, para lo que dure");
  const it = [...g.players.values()].filter((p) => p.role === "it");
  check(it.length === 1 && it[0]!.session_id === "s1" && it[0]!.readyAt === go + TAG_HEADSTART_MS, "la lleva uno al azar, que espera la ventaja");
  check(valid(g, go), "lo que se reparte jugando valida contra el protocolo");
  check(tagHit(g, "s1", "s2", go + 1000) === "ready", "durante la ventaja no se pilla");
  check(tagHit(g, "s2", "s3", go + 6000) === "role", "quien no la lleva no pilla");
  check(tagHit(g, "s1", "s2", go + 6000) === "ok", "pasada la ventaja, se pilla");
  const [a, b] = [g.players.get("s1")!, g.players.get("s2")!];
  check(a.role === "runner" && b.role === "it" && a.tags === 1 && g.last?.from === "s1" && g.last?.to === "s2", "la lleva el pillado");
  check(a.itMs === 6000 && b.itSince === go + 6000, "y se cuenta lo que la llevó cada cual");
  check(b.readyAt === go + 6000 + TAG_READY_MS && tagHit(g, "s2", "s3", go + 7000) === "ready", "quien pasa a llevarla espera un momento");
  check(tagHit(g, "s2", "s1", go + 6000 + TAG_READY_MS + 100) === "immune", "sin devolución");
  check(tagHit(g, "s2", "s1", go + 6000 + TAG_BACK_MS + 10) === "ok", "pasado ese rato, sí");
  check(Math.round(itMsAt(g.players.get("s2")!, go + 20_000)) === TAG_BACK_MS + 10, "lo que la llevó el segundo");
  // El tercero sale de la zona: un rato no pasa nada; más, fuera.
  check(!seeTag(g, "s3", false, go + 30_000, first) && !seeTag(g, "s3", false, go + 30_000 + TAG_OUTSIDE_MS - 1, first), "un momento fuera de la zona no es nada");
  check(!seeTag(g, "s3", true, go + 31_000, first) && g.players.get("s3")!.outsideSince === undefined, "y al volver se olvida");
  seeTag(g, "s3", false, go + 32_000, first);
  check(seeTag(g, "s3", false, go + 32_000 + TAG_OUTSIDE_MS, first) && g.players.get("s3")!.role === "out", "mucho rato fuera: fuera de la ronda");
  check(tagOver(g, go + 33_000) === null, "a dos sigue el juego");
  check(tagOver(g, go + 120_000) === "time", "hasta que se acaba el tiempo");
  finishTag(g, go + 120_500, "time");
  // s1 la llevó 6 s + desde go+11 010 hasta el final (120 s): 115 s; s2, 5,01 s. Gana s2.
  check(g.players.get("s1")!.itMs === 6000 + 120_000 - (6000 + TAG_BACK_MS + 10), "al acabar se cuenta hasta la hora de acabar, no después");
  check(g.winners.length === 1 && g.winners[0] === "s2", "gana quien menos la ha llevado (de los que siguen)");
  check(tagPoints(g).length === 0, "sin cuenta no se apunta nada");
  check(valid(g, go + 120_500) && tagPayload(g, go + 120_500).end === "time", "el final se reparte con por qué y quién gana");
  check(!joinTag(g, who(1), go + 120_500 + TAG_PAUSE_MS - 1) && joinTag(g, who(1), go + 120_500 + TAG_PAUSE_MS), "el corro espera un momento antes de la siguiente");
  check(g.round === 2 && g.state === "open" && g.players.size === 1 && !g.last && !g.end, "y la siguiente empieza de cero");
}
{
  // Quien la lleva se va: la lleva otro.
  const g = newTagGame({ entity_id: "e_drop_00", game: "pilla", owner: "system", mode: "tag", seconds: 60 });
  for (let n = 1; n <= 3; n++) joinTag(g, who(n), t0);
  startTag(g, g.goAt, first);
  const go = g.goAt;
  check(dropTag(g, "s1", go + 8000, first) && g.players.get("s1")!.role === "out", "quien la lleva se va (o salta)");
  const next = [...g.players.values()].find((p) => p.role === "it");
  check(!!next && next.readyAt === go + 8000 + TAG_READY_MS, "y la lleva otro, que espera un momento");
  check(g.players.get("s1")!.itMs === 8000, "a quien se fue se le cuenta hasta que se fue");
  dropTag(g, next!.session_id, go + 9000, first);
  check(tagOver(g, go + 9000) === "few", "con uno solo, se acaba");
  finishTag(g, go + 9000, "few");
  check(g.winners.length === 0 && tagPoints(g).length === 0, "y no gana nadie");
}
{
  // Empates y puntos.
  const g = newTagGame({ entity_id: "e_tie_000", game: "pilla", owner: "system", mode: "tag", seconds: 30 });
  for (let n = 1; n <= 4; n++) joinTag(g, who(n, n !== 4), t0);
  startTag(g, g.goAt, first);
  finishTag(g, g.endAt + 50, "time");
  check(g.winners.length === 3 && !g.winners.includes("s1"), "quienes no la han llevado nunca empatan");
  check(tagPoints(g).map((p) => p.sub).sort().join() === "u2,u3", "y se apunta la victoria a las cuentas (no al invitado)");
}

console.log("Infección (servidor):");
{
  const g = newTagGame({ entity_id: "cero_tag_infeccion", game: "infeccion", owner: "system", mode: "infection", seconds: 150 });
  joinTag(g, who(1), t0);
  joinTag(g, who(2), t0);
  check(g.state === "open", "a dos aún no (hacen falta tres)");
  joinTag(g, who(3), t0);
  joinTag(g, who(4), t0);
  check(g.state === "countdown", "con el tercero, la cuenta atrás");
  startTag(g, g.goAt, first);
  const go = g.goAt;
  check([...g.players.values()].filter((p) => p.role === "it").length === 1, "empieza uno infectado");
  check(tagHit(g, "s1", "s2", go + TAG_HEADSTART_MS) === "ok" && g.players.get("s1")!.role === "it" && g.players.get("s2")!.role === "it", "quien es pillado se pasa a los que pillan");
  check(tagHit(g, "s2", "s3", go + TAG_HEADSTART_MS + 100) === "ready", "y pilla al momento siguiente");
  check(tagHit(g, "s1", "s3", go + TAG_HEADSTART_MS + 200) === "ok", "el primero sigue pillando");
  check(tagStandings(g, go + 6000).map((p) => p.session_id).join() === "s4,s1,s2,s3", "primero quienes corren; luego, quien más ha pillado");
  check(tagOver(g, go + 6000) === null, "con alguien corriendo, sigue");
  check(tagHit(g, "s3", "s4", go + 9000) === "ok" && tagOver(g, go + 9000) === "caught", "los han pillado a todos");
  finishTag(g, go + 9000, "caught");
  check(g.winners.join() === "s1", "gana quien más ha pillado");
  check(tagPoints(g).length === 1 && tagPoints(g)[0]!.sub === "u1", "y se le apunta");
  check(valid(g, go + 9000), "lo que se reparte valida contra el protocolo");
}
{
  const g = newTagGame({ entity_id: "cero_tag_infeccion", game: "infeccion", owner: "system", mode: "infection", seconds: 60 });
  for (let n = 1; n <= TAG_TWO_INFECTED; n++) joinTag(g, who(n), t0);
  startTag(g, g.goAt, () => 0.5);
  check([...g.players.values()].filter((p) => p.role === "it").length === 2, `con ${TAG_TWO_INFECTED} o más, empiezan dos infectados`);
  const go = g.goAt;
  finishTag(g, go + 60_000, tagOver(g, go + 60_000)!);
  check(g.end === "time" && g.winners.length === TAG_TWO_INFECTED - 2, "si se acaba el tiempo, ganan quienes siguen corriendo");
  // Los infectados se van: la lleva otro de los que corren.
  const h = newTagGame({ entity_id: "e_inf_0000", game: "infeccion", owner: "system", mode: "infection", seconds: 60 });
  for (let n = 1; n <= 4; n++) joinTag(h, who(n), t0);
  startTag(h, h.goAt, first);
  dropTag(h, "s1", h.goAt + 1000, first);
  check([...h.players.values()].filter((p) => p.role === "it").length === 1 && tagOver(h, h.goAt + 1000) === null, "si se va el infectado, se infecta otro y sigue");
}
{
  // Quien se queda: unos segundos en el corro.
  const d = new Map<string, { lobby: string; since: number }>();
  check(!dwellIn(d, "s1", "L1", t0) && !dwellIn(d, "s1", "L1", t0 + TAG_DWELL_MS - 1), "pasar por el corro no apunta");
  check(dwellIn(d, "s1", "L1", t0 + TAG_DWELL_MS), "quedarse, sí");
  check(!dwellIn(d, "s1", "L2", t0 + TAG_DWELL_MS + 10) && !dwellIn(d, "s1", null, t0 + 5000) && !d.has("s1"), "cambiar de corro o salir vuelve a empezar");
}
{
  // El componente.
  const ok = TagV1.safeParse({ id: "pilla" });
  check(ok.success && ok.data.mode === "tag" && ok.data.radius === 3 && ok.data.area.r === 40 && ok.data.seconds === 120, "tag@1 con lo mínimo: pilla-pilla, corro de 3 m, zona de 40 m y 2 minutos");
  check(!TagV1.safeParse({ id: "x", seconds: 10 }).success && !TagV1.safeParse({ id: "x", radius: 9 }).success && !TagV1.safeParse({ id: "x", area: { r: 500 } }).success, "y con topes");
}

/* ------------------------------------------------------------------ */
/* 2) El cliente                                                       */
/* ------------------------------------------------------------------ */
console.log("Cliente:");
{
  const g = newTagGame({ entity_id: "vertical_tag_pilla", game: "pilla", owner: "system", mode: "tag", seconds: 120 });
  for (let n = 1; n <= 3; n++) joinTag(g, who(n), t0);
  const st = (now: number): TagState => ({ ...tagPayload(g, now), at: now });
  const count = st(t0);
  check(playing(count, "s2") && myRole(count, "s2") === "runner" && !playing(count, "s9"), "esperando en el corro ya se juega");
  startTag(g, g.goAt, first);
  const go = g.goAt;
  const run = st(go + 100);
  check(heldAtStart(run, "s1", go + 100) && !heldAtStart(run, "s2", go + 100), "al empezar, quien la lleva se queda quieto");
  check(!heldAtStart(run, "s1", go + TAG_HEADSTART_MS + 10) && canTag(run, "s1", go + TAG_HEADSTART_MS + 10), "pasada la ventaja, ya puede pillar");
  const me = { x: 0, y: 0, z: 0 };
  const feet: Record<string, { x: number; y: number; z: number }> = { s2: { x: TOUCH_R - 0.1, y: 0, z: 0 }, s3: { x: 0.5, y: 0, z: 0 } };
  const at = (id: string) => feet[id] ?? null;
  check(touchTarget(run, "s1", go + 1000, me, at) === null, "durante la ventaja no toca a nadie");
  check(touchTarget(run, "s1", go + 6000, me, at) === "s3", "toca al más cercano");
  check(touchTarget(run, "s2", go + 6000, me, at) === null, "quien no la lleva no toca");
  feet.s3 = { x: 0.5, y: 2.5, z: 0 };
  check(touchTarget(run, "s1", go + 6000, me, at) === "s2", "a otra altura (una azotea encima) no se toca");
  tagHit(g, "s1", "s2", go + 6000);
  const after = st(go + 6050);
  feet.s1 = { x: 0.3, y: 0, z: 0 };
  check(touchTarget(after, "s2", go + 6000 + TAG_READY_MS + 100, me, at) === null, "sin devolución tampoco en el cliente");
  check(!heldAtStart(after, "s2", go + 6100), "a quien se la pasan no se le deja quieto");
  check(Math.round(itMsNow(after, after.players.find((p) => p.session_id === "s2")!, go + 9050)) === 3050, "lo que la lleva cada uno sigue sumando entre aviso y aviso");
  // Qué ronda se enseña.
  const other = newTagGame({ entity_id: "cero_tag_infeccion", game: "infeccion", owner: "system", mode: "infection", seconds: 60 });
  for (let n = 5; n <= 7; n++) joinTag(other, who(n), t0);
  const o = tagPayload(other, go + 7000);
  check(nextTag(after, o, "s2", go + 7000)?.entity_id === "vertical_tag_pilla", "manda la ronda en la que juego");
  check(nextTag(after, o, "s9", go + 7000)?.entity_id === "cero_tag_infeccion", "si no juego, la última que llega");
  finishTag(g, go + 20_000, "few");
  const done = st(go + 20_000);
  check(nextTag(done, o, "s2", go + 21_000)?.entity_id === "vertical_tag_pilla", "al acabar, mi podio se queda un rato");
  check(!tagFresh(done, go + 20_000 + TAG_PODIUM_MS + 1), "y luego se va");
  check(nextTag(after, { ...tagPayload(g, go + 25_000), state: "idle", players: [] }, "s2", go + 25_000) === null, "un corro vacío no se enseña");
  check(tagClock(65_000) === "1:05" && tagClock(41_200) === "42 s" && tagClock(-5) === "0 s", "el reloj: «1:05» y «42 s», redondeado hacia arriba");
  check(insideArea({ x: 32, z: 32, r: 50 }, { x: 70, y: 9, z: 60 }) && !insideArea({ x: 32, z: 32, r: 50 }, { x: 90, y: 0, z: 32 }), "la zona es un círculo en horizontal, a cualquier altura");
}

/* ------------------------------------------------------------------ */
/* 3) Los corros del sistema                                           */
/* ------------------------------------------------------------------ */
console.log("Corros del sistema:");
{
  type Box = [number, number, number, number, number, number];
  const acts = json("../../realtime/src/district-activities.json") as Record<string, { games?: { id: string; mode: string; p: number[]; radius: number; area: { c?: number[]; r: number }; seconds: number }[]; props?: { p: number[]; half: number[] }[]; solids?: { p: number[]; half: number[] }[]; boards?: { kind: string; id: string; p: number[] }[]; hunts?: { items: { p: number[] }[] }[] }>;
  const cities = (json("../../realtime/src/district-cities.json") as { cities: Record<string, number[][]> }).cities;
  const layout = json("../../realtime/src/districts.json") as { districts: { id: string; soon?: boolean }[]; bounds?: number[] };
  let n = 0;
  for (const [d, a] of Object.entries(acts)) {
    for (const gm of a?.games ?? []) {
      n++;
      const parsed = TagV1.safeParse({ id: gm.id, mode: gm.mode, radius: gm.radius, area: gm.area, seconds: gm.seconds });
      check(parsed.success, `${d}/${gm.id}: su tag@1 valida`);
      const boxes: Box[] = [
        ...(cities[d] ?? []).map((b) => b.slice(0, 6) as Box),
        ...(a?.props ?? []).filter((p) => p.half[1] > 0).map((p) => [p.p[0]!, p.p[1]! + p.half[1]!, p.p[2]!, p.half[0]!, p.half[1]!, p.half[2]!] as Box),
        ...(a?.solids ?? []).map((b) => [...b.p, ...b.half] as Box),
      ];
      const [x, y, z] = gm.p as [number, number, number];
      const r = gm.radius + 0.6;
      const blocked = boxes.some(([cx, cy, cz, hx, hy, hz]) => cy - hy < y + 2 && cy + hy > y + 0.05 && Math.max(0, Math.abs(x - cx) - hx) ** 2 + Math.max(0, Math.abs(z - cz) - hz) ** 2 < r * r);
      check(!blocked, `${d}/${gm.id}: el corro está libre (nada sólido en ${r.toFixed(1)} m)`);
      check(y === 0, `${d}/${gm.id}: a ras de suelo`);
      const items = (a?.hunts ?? []).flatMap((h) => h.items);
      check(items.every((it) => Math.hypot(it.p[0]! - x, it.p[2]! - z) > gm.radius + 1.5), `${d}/${gm.id}: no tapa nada que se busca`);
      const c = gm.area.c ?? gm.p;
      check(Math.hypot(c[0]! - x, c[2]! - z) + gm.radius <= gm.area.r, `${d}/${gm.id}: el corro cae dentro de su zona`);
      check(Math.abs(c[0]! - 32) + gm.area.r <= 128 && Math.abs(c[2]! - 32) + gm.area.r <= 128, `${d}/${gm.id}: la zona cabe en el distrito`);
      check((a?.boards ?? []).some((b) => b.kind === "points" && b.id === gm.id), `${d}/${gm.id}: tiene su marcador`);
      check(!layout.districts.find((x) => x.id === d)?.soon, `${d}/${gm.id}: en un distrito abierto`);
    }
  }
  check(n >= 2, `hay corros del sistema (${n})`);
}

if (fails) {
  console.log(`\n${fails} fallo(s)`);
  process.exit(1);
}
console.log("\nTodo bien.");
