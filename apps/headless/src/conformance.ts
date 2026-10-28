/**
 * Banco de conformidad del protocolo v0.
 *
 *   XENXO_URL=http://localhost:8787 XENXO_AGENT_KEY=... npm run conformance
 *
 * Sale con código 1 si algún escenario falla. Es la red de seguridad para que
 * cualquier cambio (tuyo o de una IA) no rompa el contrato.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { AVATAR_PRESETS } from "../../realtime/src/avatar-presets";
import { GameManifest, msg, PLACES } from "@xenxo/protocol";
import { XenxoClient } from "./client";
import { makeBoxGlb, makeCoverPng, makeVrmMannequin, withExternalImage } from "./fixtures";
import { Api } from "./http";
import { SoftwarePasskey } from "./webauthn";

const baseUrl = process.env.XENXO_URL ?? "http://localhost:8787";
const agentKey = process.env.XENXO_AGENT_KEY;
const adminKey = process.env.XENXO_ADMIN_KEY;

/** Primera parcela libre de un distrito (para publicar en las pruebas). */
async function freeParcel(district = "taller"): Promise<string> {
  const r = await fetch(new URL("/districts", baseUrl));
  const { districts } = (await r.json()) as { districts: { id: string; parcels: { id: string; project_id: string | null }[] }[] };
  const q = districts.find((d) => d.id === district)?.parcels.find((p) => !p.project_id);
  if (!q) throw new Error(`no quedan parcelas libres en ${district}`);
  return q.id;
}

/** Parcela libre en el primer distrito que la tenga (las pruebas repetidas llenan los distritos). */
async function freeSpot(order = ["arcade", "pixel", "cero", "taller"]): Promise<{ district: string; parcel: string }> {
  for (const district of order) {
    const parcel = await freeParcel(district).catch(() => null);
    if (parcel) return { district, parcel };
  }
  throw new Error("no quedan parcelas libres en ningún distrito");
}

let failed = 0;
async function scenario(name: string, fn: () => Promise<void>, timeoutMs = 15_000) {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout de ${timeoutMs / 1000} s`)), timeoutMs)),
    ]);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}
function assert(cond: unknown, why: string): asserts cond {
  if (!cond) throw new Error(why);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ir andando (o corriendo) de `from` a `to` mandando poses cada `stepMs`: el servidor no admite
 * saltos para las actividades (más de unos 15 m de golpe o más de 40 m/s seguidos), así que las
 * pruebas se mueven como un cliente de verdad. `speed` en m/s (a pie, en una carrera: 16 como mucho).
 */
async function walk(c: XenxoClient, from: [number, number, number], to: [number, number, number], speed = 30, stepMs = 200) {
  const d = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const n = Math.max(1, Math.ceil(d / ((speed * stepMs) / 1000)));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    c.pose([from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k]);
    await sleep(stepMs);
  }
}

console.log(`Conformidad xenxo protocolo v0 contra ${baseUrl}\n`);

await scenario("un invitado entra y recibe WELCOME + SNAPSHOT con la plaza", async () => {
  const c = await XenxoClient.connect({ baseUrl, displayName: "conf-guest" });
  assert(c.welcome.principal.kind === "guest", "debería ser invitado");
  assert(c.snapshot.entities.some((e) => e.entity_id === "tower_body"), "falta el campanario de la plaza");
  assert(c.snapshot.entities.some((e) => e.entity_id === "fountain"), "falta la fuente de la plaza");
  c.close();
});

await scenario("versión de protocolo desconocida → unsupported_version", async () => {
  const c = await XenxoClient.connect({ baseUrl });
  const err = c.next("ERROR");
  c.sendRaw({ v: 99, type: "PING", payload: { t: 0 } });
  assert((await err).payload.code === "unsupported_version", "código incorrecto");
  c.close();
});

await scenario("un invitado no puede construir → forbidden", async () => {
  const c = await XenxoClient.connect({ baseUrl });
  const r = await c.mutate({ op: "SPAWN", components: { "transform@1": { p: [10, 0, 10] } } });
  assert(r.type === "ERROR" && r.payload.code === "forbidden", `esperaba forbidden, llegó ${r.type}`);
  c.close();
});

await scenario("dos clientes se ven: las poses de A llegan a B", async () => {
  const a = await XenxoClient.connect({ baseUrl, displayName: "conf-a" });
  const b = await XenxoClient.connect({ baseUrl, displayName: "conf-b" });
  const got = b.next("POSES", (m) => m.payload.poses.some((p) => p.session_id === a.welcome.session_id), 3000);
  a.pose([30, 1.6, 40]);
  await got;
  a.close();
  b.close();
});

await scenario("gestos: el emote de A llega a B con su pose; uno mal formado se descarta", async () => {
  const a = await XenxoClient.connect({ baseUrl, displayName: "conf-emote-a" });
  const b = await XenxoClient.connect({ baseUrl, displayName: "conf-emote-b" });
  const got = b.next("POSES", (m) => m.payload.poses.some((p) => p.session_id === a.welcome.session_id && p.emote === "dance"), 3000);
  a.pose([31, 1.6, 41], 0, "dance");
  await got;
  // Un emote con mayúsculas o espacios no pasa el esquema: el servidor lo rechaza como bad_message.
  const bad = a.next("ERROR", (m) => m.payload.code === "bad_message", 3000);
  a.sendRaw(JSON.stringify({ ...msg("POSE", { t: Date.now(), head: { p: [31, 1.6, 41], r: [0, 0, 0, 1] } }), payload: { t: Date.now(), head: { p: [31, 1.6, 41], r: [0, 0, 0, 1] }, emote: "Bailar mucho" } }));
  await bad;
  a.close();
  b.close();
});

await scenario("coche: en un distrito los demás ven el coche de A (y si va dentro); en la plaza se va a pie; un vehículo desconocido no pasa", async () => {
  const chunkId = "c_-1_-1";
  const a = await XenxoClient.connect({ baseUrl, chunkId, displayName: "conf-coche-a" });
  const b = await XenxoClient.connect({ baseUrl, chunkId, displayName: "conf-coche-b" });
  b.pose([32, 1.6, 128]);
  await new Promise((r) => setTimeout(r, 300));
  const got = b.next("POSES", (m) => m.payload.poses.some((p) => p.session_id === a.welcome.session_id && p.vehicle === "car" && p.car?.p[0] === 34), 3000);
  for (let i = 0; i < 3; i++) {
    a.pose([34, 1.2, 126], 0.3, undefined, { p: [34, 0, 126], inside: true });
    await new Promise((r) => setTimeout(r, 220));
  }
  await got;
  // Aparcado: el coche sigue ahí, la persona va a pie.
  const parked = b.next("POSES", (m) => m.payload.poses.some((p) => p.session_id === a.welcome.session_id && !p.vehicle && p.car?.p[2] === 126), 3000);
  for (let i = 0; i < 3; i++) {
    a.pose([36, 1.6, 126], 0.3, undefined, { p: [34, 0, 126], inside: false });
    await new Promise((r) => setTimeout(r, 220));
  }
  await parked;
  const bad = a.next("ERROR", (m) => m.payload.code === "bad_message", 3000);
  a.sendRaw(JSON.stringify({ ...msg("POSE", { t: Date.now(), head: { p: [34, 1.6, 126], r: [0, 0, 0, 1] } }), payload: { t: Date.now(), head: { p: [34, 1.6, 126], r: [0, 0, 0, 1] }, vehicle: "tanque" } }));
  await bad;
  a.close();
  b.close();
  // En la plaza no hay coches: la pose llega, pero a pie y sin coche.
  const pa = await XenxoClient.connect({ baseUrl, displayName: "conf-coche-pa" });
  const pb = await XenxoClient.connect({ baseUrl, displayName: "conf-coche-pb" });
  const seen = pb.next("POSES", (m) => m.payload.poses.some((p) => p.session_id === pa.welcome.session_id), 3000);
  pa.pose([30, 1.6, 40], 0, undefined, { p: [30, 0, 42], inside: true });
  const m = await seen;
  const pp = m.payload.poses.find((p) => p.session_id === pa.welcome.session_id);
  assert(!pp?.vehicle && !pp?.car, "en la plaza se va a pie");
  pa.close();
  pb.close();
});

await scenario("avatar de serie: un invitado puede llevarlo; un hash cualquiera se ignora", async () => {
  const preset = AVATAR_PRESETS[0]!;
  const watcher = await XenxoClient.connect({ baseUrl });
  const joinOk = watcher.next("PEER_JOIN", (m) => m.payload.display_name === "conf-preset" && m.payload.avatar?.hash === preset.hash, 3000);
  const g1 = await XenxoClient.connect({ baseUrl, displayName: "conf-preset", avatar: { hash: preset.hash, format: "vrm" } });
  await joinOk;
  const fake = "sha256:" + "ab".repeat(32);
  const joinFake = watcher.next("PEER_JOIN", (m) => m.payload.display_name === "conf-fake", 3000);
  const g2 = await XenxoClient.connect({ baseUrl, displayName: "conf-fake", avatar: { hash: fake, format: "vrm" } });
  const j = await joinFake;
  if (j.payload.avatar) throw new Error("un invitado no puede vestir un archivo que no es de serie");
  // El archivo del avatar de serie se sirve como cualquier otro asset.
  const r = await fetch(new URL(`/assets/${preset.hash.slice(7)}`, baseUrl));
  if (!r.ok) throw new Error(`el avatar de serie no se sirve: ${r.status}`);
  g1.close();
  g2.close();
  watcher.close();
});

if (!agentKey) {
  console.log("\n  (sin XENXO_AGENT_KEY: se omiten los escenarios de construcción)");
} else {
  await scenario("agente: SPAWN → PATCH → conflicto de versión → DESPAWN", async () => {
    const c = await XenxoClient.connect({ baseUrl, agentKey });
    assert(c.welcome.principal.kind === "agent", "debería ser agente");
    const watcher = await XenxoClient.connect({ baseUrl });

    const delta = watcher.next("DELTA", undefined, 3000);
    const s = await c.mutate({
      op: "SPAWN",
      components: {
        "transform@1": { p: [20, 0.5, 20] },
        "primitive@1": { shape: "box", size: [1, 1, 1], color: "#34d399" },
      },
    });
    assert(s.type === "ACK" && s.payload.rev === 1, `SPAWN falló: ${JSON.stringify(s.payload)}`);
    await delta; // los demás clientes lo ven en directo
    const id = s.payload.entity_id;

    const p = await c.mutate({ op: "PATCH", entity_id: id, base_rev: 1, components: { "label@1": { text: "hola" } } });
    assert(p.type === "ACK" && p.payload.rev === 2, "PATCH falló");

    const stale = await c.mutate({ op: "PATCH", entity_id: id, base_rev: 1, components: { "label@1": { text: "viejo" } } });
    assert(stale.type === "ERROR" && stale.payload.code === "version_conflict", "esperaba version_conflict");

    const d = await c.mutate({ op: "DESPAWN", entity_id: id, base_rev: 2 });
    assert(d.type === "ACK", "DESPAWN falló");
    c.close();
    watcher.close();
  });

  await scenario("agente: reintentar con la misma idempotency_key no duplica", async () => {
    const c = await XenxoClient.connect({ baseUrl, agentKey });
    const key = randomUUID();
    const op = { op: "SPAWN" as const, components: { "transform@1": { p: [22, 0.5, 22] }, "primitive@1": { shape: "sphere" as const, size: [1, 1, 1] as [number, number, number], color: "#fbbf24" } } };
    const r1 = await c.mutate(op, key);
    const r2 = await c.mutate(op, key);
    assert(r1.type === "ACK" && r2.type === "ACK", "esperaba dos ACK");
    assert(r2.payload.replayed && r1.payload.entity_id === r2.payload.entity_id, "el reintento creó otra entidad");
    await c.mutate({ op: "DESPAWN", entity_id: r1.payload.entity_id, base_rev: 1 });
    c.close();
  });

  await scenario("agente: label@1 con traducciones se acepta; un código de idioma inválido no", async () => {
    const c = await XenxoClient.connect({ baseUrl, agentKey });
    const ok = await c.mutate({
      op: "SPAWN",
      components: {
        "transform@1": { p: [24, 2, 24] },
        "label@1": { text: "Hello", i18n: { es: "Hola", en: "Hello" }, size: 0.5 },
      },
    });
    assert(ok.type === "ACK", `esperaba ACK: ${JSON.stringify(ok.payload)}`);
    const delta = await c.mutate({ op: "PATCH", entity_id: ok.payload.entity_id, base_rev: 1, components: { "label@1": { text: "x", i18n: { espanol: "y" } } } });
    assert(delta.type === "ERROR" && delta.payload.code === "bad_message", "esperaba bad_message por idioma inválido");
    await c.mutate({ op: "DESPAWN", entity_id: ok.payload.entity_id, base_rev: 1 });
    c.close();
  });

  await scenario("agente: label@1 con estilo neón y color se acepta; un color mal formado no", async () => {
    const c = await XenxoClient.connect({ baseUrl, agentKey });
    const ok = await c.mutate({
      op: "SPAWN",
      components: {
        "transform@1": { p: [24, 2, 26] },
        "label@1": { text: "xenxo.io", billboard: false, size: 0.6, style: "neon", color: "#ff4fd8" },
      },
    });
    assert(ok.type === "ACK", `esperaba ACK: ${JSON.stringify(ok.payload)}`);
    const plain = await c.mutate({ op: "PATCH", entity_id: ok.payload.entity_id, base_rev: 1, components: { "label@1": { text: "sin estilo" } } });
    assert(plain.type === "ACK", "un label@1 sin style ni color sigue siendo válido (style por defecto: plain)");
    const bad = await c.mutate({ op: "PATCH", entity_id: ok.payload.entity_id, base_rev: 2, components: { "label@1": { text: "x", style: "neon", color: "rosa" } } });
    assert(bad.type === "ERROR" && bad.payload.code === "bad_message", "esperaba bad_message por color inválido");
    await c.mutate({ op: "DESPAWN", entity_id: ok.payload.entity_id, base_rev: 2 });
    c.close();
  });

  await scenario("agente: primitive@1.finish y light@1 se aceptan; las luces tienen presupuesto por chunk", async () => {
    // Llenar el presupuesto de luces gasta muchas mutaciones: se hace con otro actor
    // (moderación) para no agotar el límite por minuto del agente principal.
    const c = await XenxoClient.connect({ baseUrl, agentKey: adminKey ?? agentKey });
    const bad = await c.mutate({
      op: "SPAWN",
      components: { "transform@1": { p: [26, 0.5, 26] }, "primitive@1": { shape: "box", size: [1, 1, 1], color: "#ffffff", finish: "chrome" } },
    });
    assert(bad.type === "ERROR" && bad.payload.code === "bad_message", "un acabado inventado debería rechazarse");
    const created: string[] = [];
    let limited = false;
    for (let i = 0; i < (adminKey ? 20 : 1) && !limited; i++) {
      const r = await c.mutate({
        op: "SPAWN",
        components: {
          "transform@1": { p: [26 + (i % 5), 3, 26 + Math.floor(i / 5)] },
          "primitive@1": { shape: "sphere", size: [0.3, 0.3, 0.3], color: "#ffd98a", emissive: true, finish: "glossy" },
          "light@1": { type: "point", color: "#ffd98a", intensity: 2, range: 8 },
        },
      });
      if (r.type === "ACK") created.push(r.payload.entity_id);
      else if (r.payload.code === "budget_exceeded") limited = true;
      else throw new Error(`error inesperado: ${r.payload.code}`);
    }
    assert(created.length > 0, "una luz debería aceptarse");
    if (adminKey) assert(limited, "debería aplicarse el máximo de luces por chunk");
    for (const id of created) await c.mutate({ op: "DESPAWN", entity_id: id, base_rev: 1 });
    c.close();
  });

  await scenario("agente: portal@1 se acepta como cualquier componente; un destino mal formado no", async () => {
    const c = await XenxoClient.connect({ baseUrl, agentKey });
    const ok = await c.mutate({
      op: "SPAWN",
      components: { "transform@1": { p: [40, 1.5, 50] }, "portal@1": { to: { kind: "chunk", chunk_id: PLACES.nexo }, size: [2, 3], title: "Al nexo" } },
    });
    assert(ok.type === "ACK", `portal@1 debería aceptarse: ${JSON.stringify(ok.payload)}`);
    const bad = await c.mutate({
      op: "SPAWN",
      components: { "transform@1": { p: [40, 1.5, 50] }, "portal@1": { to: { kind: "url", href: "https://example.org" } } },
    });
    assert(bad.type === "ERROR" && bad.payload.code === "bad_message", "un portal a una URL cualquiera no existe en el protocolo");
    if (ok.type === "ACK") await c.mutate({ op: "DESPAWN", entity_id: ok.payload.entity_id, base_rev: 1 });
    c.close();
  });

  await scenario("agente: hologram@1 se acepta con su color y opacidad (y collider@1.from_mesh); una opacidad fuera de rango no", async () => {
    const c = await XenxoClient.connect({ baseUrl, agentKey });
    const ok = await c.mutate({
      op: "SPAWN",
      components: {
        "transform@1": { p: [41, 1.5, 50] },
        "primitive@1": { shape: "box", size: [1, 1, 1], color: "#4fa3ff" },
        "hologram@1": { color: "#4fa3ff", opacity: 0.7 },
        "collider@1": { shape: "box", half_extents: [0.5, 0.5, 0.5], from_mesh: true },
      },
    });
    assert(ok.type === "ACK", `hologram@1 debería aceptarse: ${JSON.stringify(ok.payload)}`);
    const bad = await c.mutate({
      op: "SPAWN",
      components: { "transform@1": { p: [41, 1.5, 50] }, "primitive@1": { shape: "box", size: [1, 1, 1], color: "#4fa3ff" }, "hologram@1": { opacity: 3 } },
    });
    assert(bad.type === "ERROR" && bad.payload.code === "bad_message", "opacidad entre 0,05 y 1");
    if (ok.type === "ACK") await c.mutate({ op: "DESPAWN", entity_id: ok.payload.entity_id, base_rev: 1 });
    c.close();
  });

  await scenario("agente: componente desconocido → unknown_component", async () => {
    const c = await XenxoClient.connect({ baseUrl, agentKey });
    const r = await c.mutate({ op: "SPAWN", components: { "transform@1": { p: [5, 0, 5] }, "laser@1": { power: 9000 } } });
    assert(r.type === "ERROR" && r.payload.code === "unknown_component", "esperaba unknown_component");
    c.close();
  });

  await scenario("agente: fuera del chunk → budget_exceeded", async () => {
    const c = await XenxoClient.connect({ baseUrl, agentKey });
    const r = await c.mutate({ op: "SPAWN", components: { "transform@1": { p: [500, 0, 5] }, "primitive@1": { shape: "box", size: [1, 1, 1], color: "#ffffff" } } });
    assert(r.type === "ERROR" && r.payload.code === "budget_exceeded", "esperaba budget_exceeded");
    c.close();
  });

  await scenario("agente: no puede tocar la plaza del sistema → forbidden", async () => {
    const c = await XenxoClient.connect({ baseUrl, agentKey });
    const r = await c.mutate({ op: "DESPAWN", entity_id: "tower_body", base_rev: 1 });
    assert(r.type === "ERROR" && r.payload.code === "forbidden", "esperaba forbidden");
    c.close();
  });
}


/* ------------------------------------------------------------------ */
/* Cuentas, assets y proyectos                                          */
/* ------------------------------------------------------------------ */

await scenario("alta con passkey y acceso de nuevo con la misma passkey", async () => {
  const api = new Api(baseUrl);
  const { passkey, user } = await api.register(`conf ${randomUUID().slice(0, 6)}`);
  assert(user.id, "el alta no devolvió usuario");
  const again = new Api(baseUrl);
  await again.login(passkey);
  const me = await again.call<{ id: string }>("GET", "/me");
  assert(me.ok && me.data.id === user.id, "el acceso no recuperó la misma cuenta");
});

await scenario("el alta exige 14 años, aceptar las condiciones vigentes y un nombre no reservado", async () => {
  const api = new Api(baseUrl);
  const noAge = await api.call("POST", "/auth/passkey/register/options", { display_name: "Menor", age_confirmed: false, accept_terms: "2026-10" });
  assert(!noAge.ok && noAge.error === "age_required", "debería exigir la edad");
  const noTerms = await api.call("POST", "/auth/passkey/register/options", { display_name: "Alguien", age_confirmed: true });
  assert(!noTerms.ok && noTerms.error === "terms_required", "debería exigir las condiciones");
  const reserved = await api.call("POST", "/auth/passkey/register/options", { display_name: "Xenxo", age_confirmed: true, accept_terms: "2026-10" });
  assert(!reserved.ok && reserved.error === "name_reserved", "un nombre reservado debería decir name_reserved, no bad_name");
});

await scenario("assets: un invitado no puede subir; un GLB con referencias externas se rechaza", async () => {
  const guest = new Api(baseUrl, ((await (await fetch(new URL("/auth/guest", baseUrl), { method: "POST" })).json()) as { token: string }).token);
  const g = await guest.upload(await makeBoxGlb(), "model");
  assert(!g.ok && g.status === 403, `esperaba 403, llegó ${g.ok ? 200 : g.status}`);
  const user = new Api(baseUrl);
  await user.register(`conf ${randomUUID().slice(0, 6)}`);
  const bad = await user.upload(withExternalImage(await makeBoxGlb()), "model");
  assert(!bad.ok && bad.error === "external_reference", `esperaba external_reference, llegó ${bad.ok ? "ok" : bad.error}`);
  const big = await user.upload(await makeBoxGlb({ segments: 75 }), "avatar");
  assert(!big.ok && big.error === "budget_exceeded", "un avatar de 67k triángulos debería superar el presupuesto");
  const okUp = await user.upload(await makeBoxGlb(), "model");
  assert(okUp.ok && okUp.data.hash.startsWith("sha256:"), "un GLB válido debería aceptarse");
  const get = await fetch(new URL(`/assets/${okUp.data.hash.slice(7)}`, baseUrl));
  assert(get.ok && get.headers.get("cache-control")?.includes("immutable"), "el asset debería servirse como inmutable");
  await get.arrayBuffer();
  const again = await fetch(new URL(`/assets/${okUp.data.hash.slice(7)}`, baseUrl));
  assert(again.ok && (await again.arrayBuffer()).byteLength === okUp.data.bytes, "la segunda lectura (desde caché) debe devolver el mismo modelo");
});

await scenario("avatar propio: los demás lo ven en el peer de la persona registrada", async () => {
  const api = new Api(baseUrl);
  await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const up = await api.upload(await makeBoxGlb({ height: 1.8 }), "avatar");
  assert(up.ok, "subida del avatar");
  const set = await api.call<{ token: string }>("POST", "/me/avatar", { hash: up.data.hash });
  assert(set.ok, "fijar el avatar");
  const watcher = await XenxoClient.connect({ baseUrl });
  const join = watcher.next("PEER_JOIN", (m) => m.payload.avatar?.hash === up.data.hash, 4000);
  const me = await XenxoClient.connect({ baseUrl, token: set.data.token });
  assert(me.welcome.principal.kind === "user", "debería entrar como persona registrada");
  await join;
  me.close();
  watcher.close();
});

await scenario("número de jugador: cada alta recibe el siguiente y los demás lo ven en el peer", async () => {
  const a = new Api(baseUrl);
  await a.register(`conf ${randomUUID().slice(0, 6)}`);
  const b = new Api(baseUrl);
  await b.register(`conf ${randomUUID().slice(0, 6)}`);
  const ma = await a.call<{ player_no: number }>("GET", "/me");
  const mb = await b.call<{ player_no: number }>("GET", "/me");
  assert(ma.ok && mb.ok, "GET /me");
  const na = ma.data.player_no, nb = mb.data.player_no;
  assert(Number.isInteger(na) && na >= 1 && nb === na + 1, `esperaba números seguidos desde el 1, llegó ${na} y ${nb}`);
  const renewed = await a.call<{ token: string; user: { player_no: number } }>("POST", "/me/session");
  assert(renewed.ok && renewed.data.token && renewed.data.user.player_no === na, "POST /me/session debería dar un token nuevo con el número de ahora");
  const anon = await new Api(baseUrl).call("POST", "/me/session");
  assert(!anon.ok && anon.status === 401, "sin sesión, /me/session es 401");
  const tok = await b.call<{ token: string }>("PATCH", "/me", { display_name: `conf ${randomUUID().slice(0, 6)}` });
  assert(tok.ok, "token nuevo");
  const watcher = await XenxoClient.connect({ baseUrl });
  const join = watcher.next("PEER_JOIN", (m) => m.payload.player_no === nb, 4000);
  const me = await XenxoClient.connect({ baseUrl, token: tok.data.token });
  await join;
  me.close();
  watcher.close();
});

await scenario("número de jugador: no se reutiliza aunque se borre la cuenta del último", async () => {
  const no = async (api: Api) => {
    const me = await api.call<{ player_no: number }>("GET", "/me");
    if (!me.ok) throw new Error("GET /me");
    return me.data.player_no;
  };
  const a = new Api(baseUrl);
  await a.register(`conf ${randomUUID().slice(0, 6)}`);
  const b = new Api(baseUrl);
  await b.register(`conf ${randomUUID().slice(0, 6)}`);
  const nb = await no(b);
  assert((await b.call("DELETE", "/me")).ok, "borrar la cuenta del último");
  const c = new Api(baseUrl);
  await c.register(`conf ${randomUUID().slice(0, 6)}`);
  assert((await no(c)) === nb + 1, `el siguiente debería ser ${nb + 1}, no reutilizar el ${nb}`);
  await a.call("DELETE", "/me");
  await c.call("DELETE", "/me");
});

await scenario("carné: privado por defecto; al hacerlo público se ve sin el id interno; al quitarlo o borrar la cuenta, no", async () => {
  const api = new Api(baseUrl);
  const name = `conf ${randomUUID().slice(0, 6)}`;
  await api.register(name);
  const mine = await api.call<{ public: boolean; player_no: number }>("GET", "/me/card");
  assert(mine.ok && mine.data.public === false && Number.isInteger(mine.data.player_no), "GET /me/card: privado por defecto");
  const no = mine.data.player_no;
  const card = () => fetch(new URL(`/players/${no}`, baseUrl));
  assert((await card()).status === 404, "un carné privado no se ve (404)");
  assert((await fetch(new URL(`/players/0${no}`, baseUrl))).status === 404, "con ceros a la izquierda tampoco");
  const bad = await api.call("PUT", "/me/card", { public: "sí" });
  assert(!bad.ok && bad.status === 400, "public tiene que ser true o false");
  const on = await api.call<{ public: boolean }>("PUT", "/me/card", { public: true });
  assert(on.ok && on.data.public, "hacerlo público");
  const res = await card();
  const body = (await res.json()) as Record<string, unknown> & { player_no: number; name: string; joined: number; projects: unknown[] };
  assert(res.status === 200 && body.player_no === no && body.name === name && typeof body.joined === "number" && Array.isArray(body.projects), "el carné público lleva número, nombre, alta y proyectos");
  assert(!("id" in body) && !JSON.stringify(body).includes("usr_"), "el carné nunca lleva el id interno");
  const anon = await new Api(baseUrl).call("PUT", "/me/card", { public: true });
  assert(!anon.ok && anon.status === 401, "sin sesión no se toca ningún carné");
  assert((await api.call("PUT", "/me/card", { public: false })).ok, "hacerlo privado");
  assert((await card()).status === 404, "al hacerlo privado deja de verse al momento");
  assert((await api.call("PUT", "/me/card", { public: true })).ok && (await card()).status === 200, "público otra vez");
  assert((await api.call("DELETE", "/me")).ok, "borrar la cuenta");
  assert((await card()).status === 404, "al borrar la cuenta deja de verse al momento");
});

await scenario("formas de entrar: una segunda passkey en la misma cuenta sirve para entrar", async () => {
  const api = new Api(baseUrl);
  const { user } = await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const opts = await api.call<{ flow_id: string; options: never }>("POST", "/me/passkeys/options");
  assert(opts.ok, "opciones para otra passkey");
  const second = new SoftwarePasskey(api.origin);
  const added = await api.call<{ passkeys: number }>("POST", "/me/passkeys/verify", { flow_id: opts.data.flow_id, response: await second.create(opts.data.options) });
  assert(added.ok && added.data.passkeys === 2, `debería tener 2 passkeys: ${JSON.stringify(added)}`);
  const again = new Api(baseUrl);
  await again.login(second);
  const who = await again.call<{ id: string }>("GET", "/me");
  assert(who.ok && who.data.id === user.id, "la segunda passkey entra en la misma cuenta");
  const logins = await again.call<{ passkeys: unknown[]; google: unknown }>("GET", "/me/logins");
  assert(logins.ok && logins.data.passkeys.length === 2 && logins.data.google === null, "GET /me/logins");
  const unlink = await again.call("DELETE", "/me/logins/google");
  assert(unlink.ok, "quitar Google sin tenerlo no rompe nada");
  await again.call("DELETE", "/me");
});

await scenario("entrar con Google: sin configurar no se ofrece; un estado falso vuelve con error", async () => {
  const m = (await (await fetch(new URL("/auth/methods", baseUrl))).json()) as { google: boolean };
  const start = await fetch(new URL("/auth/google/start?mode=login&origin=http://localhost:5173", baseUrl), { redirect: "manual" });
  const to = new URL(start.headers.get("Location") ?? "http://x/");
  if (m.google) {
    assert(to.host === "accounts.google.com" && to.searchParams.get("scope") === "openid", "debería ir a Google pidiendo solo openid");
    assert(to.searchParams.get("code_challenge_method") === "S256" && !!to.searchParams.get("state"), "con PKCE y estado");
  } else {
    assert(start.status === 302 && to.searchParams.get("auth_error") === "google_disabled", "sin configurar → vuelve con google_disabled");
  }
  const evil = await fetch(new URL("/auth/google/start?mode=login&origin=https://malo.example", baseUrl), { redirect: "manual" });
  assert(!(evil.headers.get("Location") ?? "").startsWith("https://malo.example"), "nunca redirige a un origen no permitido");
  const cb = await fetch(new URL("/auth/google/callback?state=g_falso&code=x", baseUrl), { redirect: "manual" });
  assert(new URL(cb.headers.get("Location") ?? "http://x/").searchParams.get("auth_error") === "flow_expired", "estado desconocido → flow_expired");
  const fin = await new Api(baseUrl).call("POST", "/auth/google/finish", { code: "c_falso" });
  assert(!fin.ok && fin.error === "flow_expired", "un código falso no da sesión");
});

await scenario("avatar VRM: se acepta tal cual, como VRM, y no como modelo de proyecto", async () => {
  const api = new Api(baseUrl);
  await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const vrm = await makeVrmMannequin();
  const asModel = await api.upload(vrm, "model");
  assert(!asModel.ok && asModel.error === "bad_kind", "un VRM no debería aceptarse como modelo de proyecto");
  const up = await api.upload(vrm, "avatar");
  assert(up.ok && up.data.format === "vrm", `el VRM debería aceptarse como avatar: ${JSON.stringify(up)}`);
  const set = await api.call<{ user: { avatar_format: string } }>("POST", "/me/avatar", { hash: up.data.hash });
  assert(set.ok && set.data.user.avatar_format === "vrm", "el perfil debería guardar el formato VRM");
});

await scenario("armario: hasta 3 personajes propios, los de serie no cuentan y quitar uno lo borra", async () => {
  const api = new Api(baseUrl);
  await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const preset = (await api.call<{ user: { avatar_hash: string } }>("POST", "/me/avatar", { hash: AVATAR_PRESETS[0]!.hash }));
  assert(preset.ok && preset.data.user.avatar_hash === AVATAR_PRESETS[0]!.hash, `una cuenta debería poder ponerse uno de serie: ${JSON.stringify(preset)}`);
  const hashes: string[] = [];
  for (let i = 0; i < 4; i++) {
    const up = await api.upload(await makeBoxGlb({ segments: 2 + i, color: [Math.random(), Math.random(), Math.random(), 1] }), "avatar");
    assert(up.ok, `subida ${i + 1}`);
    hashes.push(up.data.hash);
  }
  for (let i = 0; i < 3; i++) {
    const r = await api.call("POST", "/me/avatar", { hash: hashes[i], label: `traje ${i + 1}` });
    assert(r.ok, `el personaje ${i + 1} debería entrar en el armario`);
  }
  const fourth = await api.call("POST", "/me/avatar", { hash: hashes[3] });
  assert(!fourth.ok && fourth.error === "skins_full", `el cuarto debería dar skins_full, llegó ${fourth.ok ? "ok" : fourth.error}`);
  const list = await api.call<{ skins: { hash: string; label: string | null }[]; max: number }>("GET", "/me/skins");
  assert(list.ok && list.data.max === 3 && list.data.skins.length === 3 && list.data.skins[0]!.label === "traje 1", "GET /me/skins");
  // Lleva puesto el tercero: al quitarlo vuelve al de serie y el archivo (solo suyo) se borra.
  const del = await api.call<{ user: { avatar_hash: string | null }; skins: unknown[] }>("DELETE", `/me/skins/${hashes[2]!.slice(7)}`);
  assert(del.ok && del.data.user.avatar_hash === null && del.data.skins.length === 2, "quitar el que lleva puesto");
  const gone = await fetch(new URL(`/assets/${hashes[2]!.slice(7)}`, baseUrl));
  await gone.arrayBuffer();
  assert(gone.status === 404, `el archivo quitado debería borrarse, llegó ${gone.status}`);
  const again = await api.call("POST", "/me/avatar", { hash: hashes[2] });
  assert(!again.ok, "uno quitado no se puede volver a poner sin subirlo otra vez");
  const now = await api.call("POST", "/me/avatar", { hash: hashes[3] });
  assert(now.ok, "con hueco libre, el cuarto ya entra");
  const exp = await api.call<{ skins: unknown[] }>("GET", "/me/export");
  assert(exp.ok && exp.data.skins.length === 3, "la exportación debería incluir el armario");
});

await scenario("nexo y distritos: el nexo lleva a la plaza y a los distritos, y sus puertas devuelven al nexo", async () => {
  const c = await XenxoClient.connect({ baseUrl, chunkId: PLACES.nexo });
  assert(c.welcome.chunk_id === PLACES.nexo, "el WELCOME debería decir el chunk del nexo");
  const toPlaza = c.snapshot.entities.find((e) => e.entity_id === "nexo_portal_plaza")?.components["portal@1"] as
    | { to: { kind: string; chunk_id?: string }; size: number[] }
    | undefined;
  assert(toPlaza?.to.kind === "chunk" && toPlaza.to.chunk_id === PLACES.plaza, "falta el portal del nexo a la plaza");
  assert(c.snapshot.entities.some((e) => e.entity_id === "nexo_letters"), "faltan las letras del suelo del nexo");
  const toArcade = c.snapshot.entities.find((e) => e.entity_id === "nexo_portal_arcade")?.components["portal@1"] as { to: { chunk_id?: string } } | undefined;
  assert(toArcade?.to.chunk_id === "c_1_0", "falta el portal del nexo al distrito Arcade");
  const arcadePortal = c.snapshot.entities.find((e) => e.entity_id === "nexo_portal_arcade")?.components["portal@1"] as { color?: string; cover?: string } | undefined;
  assert(!!arcadePortal?.color && !arcadePortal.cover, "la puerta del distrito es abierta (sin portada) y del color del distrito");
  // Todos los distritos (también los nuevos) tienen su puerta en el nexo, y la vuelta deja dentro de lo caminable.
  const all = (await (await fetch(`${baseUrl}/districts`)).json()) as { districts: { id: string; chunk_id: string; parcels: { id: string; x: number; z: number }[] }[] };
  for (const d of all.districts) {
    // Disposición v3: 64 parcelas de 15 m alrededor de la ciudad del centro (-18..82), sin pisarla.
    assert(d.parcels.length === 64 && d.parcels.every((q) => q.x + 7.5 <= -18 || q.x - 7.5 >= 82 || q.z + 7.5 <= -18 || q.z - 7.5 >= 82), `las parcelas de ${d.id} rodean la ciudad, no la pisan`);
  }
  const nexoWalk = c.welcome.walk ?? [0, 64];
  for (const d of all.districts) {
    const to = c.snapshot.entities.find((e) => e.entity_id === `nexo_portal_${d.id}`)?.components["portal@1"] as { to: { chunk_id?: string } } | undefined;
    assert(to?.to.chunk_id === d.chunk_id, `falta la puerta del nexo al distrito ${d.id}`);
    // Los «próximamente» solo admiten a moderación (se comprueban dentro con la clave de administración).
    if ((d as { soon?: boolean }).soon && !adminKey) continue;
    const dc = await XenxoClient.connect({ baseUrl, chunkId: d.chunk_id, agentKey: (d as { soon?: boolean }).soon ? adminKey : undefined });
    const back = dc.snapshot.entities.find((e) => (e.components["portal@1"] as { to?: { chunk_id?: string } } | undefined)?.to?.chunk_id === PLACES.nexo)?.components["portal@1"] as
      | { to: { spawn: number[] } }
      | undefined;
    // Disposición v2: la ciudad en el centro, con sus colisiones, y ninguna parcela dentro de ella.
    assert(dc.snapshot.entities.some((e) => e.entity_id === `${d.id}_city`) && dc.snapshot.entities.some((e) => e.entity_id === `${d.id}_city_0` && !!e.components["collider@1"]), `falta la ciudad del centro de ${d.id}`);
    dc.close();
    const [bx, , bz] = back?.to.spawn ?? [NaN, 0, NaN];
    assert(bx! >= nexoWalk[0] && bx! <= nexoWalk[1] && bz! >= nexoWalk[0] && bz! <= nexoWalk[1], `la puerta de ${d.id} devuelve fuera de lo caminable del nexo`);
  }
  for (const id of ["nexo_gate_arcade", "nexo_monument_arcade", "nexo_island_arcade", "nexo_spires_arcade", "nexo_island_plaza"]) {
    assert(c.snapshot.entities.some((e) => e.entity_id === id), `falta ${id} (puerta, emblema e isla del distrito)`);
  }
  assert(c.snapshot.entities.some((e) => e.entity_id.startsWith("nexo_holo_plaza_") && !!e.components["hologram@1"]), "la isla de la plaza proyecta la plaza en holograma");
  assert(!c.snapshot.entities.some((e) => e.entity_id.startsWith("show_") || e.entity_id.startsWith("nexo_frame_")), "en el nexo solo hay distritos");
  for (const id of ["nexo_post_label_arcade", "nexo_bridge_arcade", "nexo_holo_arcade_ground", "nexo_panel_arcade", "nexo_sign_desc_arcade", "nexo_decor_arcade"]) {
    assert(c.snapshot.entities.some((e) => e.entity_id === id), `falta ${id} (poste, pasarela, holograma, panel y decorado del distrito)`);
  }
  // El texto secundario de la isla se apaga con la distancia; el nombre es un rótulo nítido.
  const labelOf = (id: string) => c.snapshot.entities.find((e) => e.entity_id === id)?.components["label@1"] as { style?: string; max_distance?: number } | undefined;
  assert(labelOf("nexo_sign_arcade")?.style === "sign", "el nombre del panel es un rótulo (style: sign)");
  assert((labelOf("nexo_sign_desc_arcade")?.max_distance ?? 0) > 0, "la descripción del panel se apaga de lejos (label@1.max_distance)");
  const pos = (id: string) => (c.snapshot.entities.find((e) => e.entity_id === id)?.components["transform@1"] as { p: number[] }).p;
  const fromCenter = (p: number[]) => Math.hypot(p[0]! - 32, p[2]! - 32);
  const portalP = pos("nexo_portal_arcade");
  assert(fromCenter(portalP) > fromCenter(pos("nexo_post_label_arcade")) + 20, "la puerta del distrito está en su isla, al otro lado de la pasarela");
  assert(fromCenter(portalP) < fromCenter(pos("nexo_holo_arcade_ground")), "la puerta va delante del holograma (lo primero al llegar)");
  const walk = c.welcome.walk;
  assert(c.welcome.solo === true && !!walk && walk[0] < 0 && walk[1] > 64, "el nexo se recorre en solitario y más allá del chunk");
  c.close();
  const d = await XenxoClient.connect({ baseUrl, chunkId: "c_1_0" });
  const gate = d.snapshot.entities.find((e) => e.entity_id === "arcade_gate_portal")?.components["portal@1"] as { to: { chunk_id?: string } } | undefined;
  assert(gate?.to.chunk_id === PLACES.nexo, "la puerta del distrito debería llevar al nexo");
  assert(d.snapshot.entities.some((e) => e.entity_id === "arcade_parcel_N1"), "faltan los números de parcela del distrito");
  d.close();
  const p = await XenxoClient.connect({ baseUrl });
  const back = p.snapshot.entities.find((e) => e.entity_id === "gate_portal")?.components["portal@1"] as { to: { chunk_id?: string } } | undefined;
  assert(back?.to.chunk_id === PLACES.nexo, "el arco de la plaza debería llevar al nexo");
  p.close();
});

await scenario("próximamente: un distrito cerrado sale en /districts, su puerta del nexo está cerrada, no se publica en él y solo entra moderación", async () => {
  const r = (await (await fetch(new URL("/districts", baseUrl))).json()) as { districts: { id: string; chunk_id: string; soon: boolean }[] };
  const soon = r.districts.find((d) => d.soon);
  assert(!!soon && r.districts.some((d) => !d.soon), "hay distritos abiertos y alguno «próximamente»");
  const nexo = await XenxoClient.connect({ baseUrl, chunkId: PLACES.nexo });
  const nexoSnap = nexo.snapshot.entities;
  const doors = nexo.snapshot.entities
    .map((e) => e.components["portal@1"] as { to: { chunk_id?: string }; closed?: boolean } | undefined)
    .filter((p) => p?.to.chunk_id);
  nexo.close();
  assert(doors.some((p) => p!.to.chunk_id === soon!.chunk_id && p!.closed), "su puerta del nexo está cerrada");
  assert(doors.some((p) => !p!.closed), "las de los abiertos, no");
  const slab = nexoSnap.find((e) => e.entity_id === `nexo_door_${soon!.id}`);
  assert(!!slab?.components["collider@1"], "la puerta cerrada es maciza (no se cruza)");
  let refused = "";
  await XenxoClient.connect({ baseUrl, chunkId: soon!.chunk_id }).then((c) => c.close(), (e: Error) => (refused = e.message));
  assert(/403/.test(refused), `un invitado no entra (${refused || "entró"})`);
  const api = new Api(baseUrl);
  await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const pub = await api.call("POST", "/projects", { title: "En un cerrado", url: "https://example.org", district: soon!.id, parcel: "N1" });
  assert(!pub.ok && pub.error === "district_soon", `publicar en él → district_soon (${!pub.ok && pub.error})`);
  if (adminKey) {
    const mod = await XenxoClient.connect({ baseUrl, chunkId: soon!.chunk_id, agentKey: adminKey });
    assert(!!mod.welcome.session_id, "la administración sí entra");
    mod.close();
  }
});

await scenario("distrito de la comunidad: la ficha se comprueba, queda en borrador solo para su autor, se revisa con motivo y se puede borrar", async () => {
  const api = new Api(baseUrl);
  await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const tall = await api.upload(await makeBoxGlb({ segments: 2, height: 8, color: [Math.random(), 0.3, 0.9, 1] }), "model");
  const emblem = await api.upload(await makeBoxGlb({ segments: 1, color: [0.9, Math.random(), 0.2, 1] }), "monument");
  const cover = await api.upload(makeCoverPng(320, 180, [Math.floor(Math.random() * 255), 60, 160]), "cover");
  assert(tall.ok && emblem.ok && cover.ok, "subidas del distrito");
  const slug = `conf-${randomUUID().slice(0, 8)}`;
  const base = {
    schema: "xenxo.district/0",
    slug,
    name: { es: "Distrito de prueba", en: "Test district" },
    description: { es: "Hecho por el banco de conformidad", en: "Made by the conformance suite" },
    color: "#33ddff",
    theme: "cero",
    cover: cover.data.hash,
    emblem: emblem.data.hash,
    models: { torre: { file: tall.data.hash } },
    pieces: [{ model: "torre", p: [32, 0, 32] }],
    colliders: [{ p: [32, 4, 32], half: [0.5, 4, 0.5] }],
    labels: [{ p: [32, 9, 32], text: { es: "Hola", en: "Hello" } }],
    author: "Banco de conformidad",
    contact: "contact@xenxo.io",
  };
  // Fuera del distrito y en la puerta: se rechaza con los problemas explicados.
  const bad = await api.call<unknown>("PUT", "/me/district", { ...base, pieces: [{ model: "torre", p: [200, 0, 32] }, { model: "torre", p: [32, 0, 150] }] });
  const codes = !bad.ok ? ((bad.detail as { code: string }[] | undefined) ?? []).map((p) => p.code) : [];
  assert(!bad.ok && bad.error === "district_problems" && codes.includes("out_of_area") && codes.includes("gate_zone"), `piezas fuera y en la puerta → out_of_area y gate_zone (${codes.join(", ")})`);
  const noPortal = await api.call("PUT", "/me/district", { ...base, portals: [{ p: [10, 1.2, 10], game: "no-existe-nunca" }] });
  assert(!noPortal.ok && noPortal.error === "bad_portal", "un portal a un juego que no es tuyo → bad_portal");
  const stranger = new Api(baseUrl);
  await stranger.register(`conf ${randomUUID().slice(0, 6)}`);
  const stolen = await stranger.call("PUT", "/me/district", { ...base, slug: `${slug}-x` });
  assert(!stolen.ok && stolen.error === "not_your_file", "usar archivos que subió otra persona → not_your_file");

  const saved = await api.call<{ district: { id: string; chunk_id: string; status: string } }>("PUT", "/me/district", base);
  assert(saved.ok && saved.data.district.status === "draft" && /^c_1000_\d+$/.test(saved.data.district.chunk_id), "la ficha válida queda en borrador en su chunk c_1000_<n>");
  const { id, chunk_id } = saved.data.district;
  // Su autor entra (y ve lo suyo y la puerta al nexo); nadie más.
  const mine = await XenxoClient.connect({ baseUrl, chunkId: chunk_id, token: api.token });
  assert(mine.snapshot.entities.some((e) => e.entity_id === `cd_${id}_piece_0` && !!e.components["mesh@1"]), "el autor ve su pieza");
  const back = mine.snapshot.entities.find((e) => e.entity_id === `cd_${id}_gate_portal`)?.components["portal@1"] as { to: { chunk_id?: string } } | undefined;
  assert(back?.to.chunk_id === PLACES.nexo, "el servidor pone la puerta de vuelta al nexo");
  assert(!!mine.welcome.walk && mine.welcome.walk[1] - mine.welcome.walk[0] >= 256, "mide 256 m (WELCOME.walk)");
  assert(mine.welcome.theme?.id === "cero" && mine.welcome.theme.color === "#33ddff", "WELCOME dice su ciudad de fondo (theme)");
  mine.close();
  let refused = "";
  await XenxoClient.connect({ baseUrl, chunkId: chunk_id, token: stranger.token }).then((c) => c.close(), (e: Error) => (refused = e.message));
  assert(/403/.test(refused), `otra persona no entra en un borrador (${refused || "entró"})`);
  const sent = await api.call<{ district: { status: string } }>("POST", "/me/district/submit");
  assert(sent.ok && sent.data.district.status === "pending", "enviar a revisión → pending");
  const exp = await api.call<{ community_district: { slug: string } | null }>("GET", "/me/export");
  assert(exp.ok && exp.data.community_district?.slug === slug, "la exportación incluye el distrito");
  if (adminKey) {
    const admin = new Api(baseUrl);
    await admin.agentToken(adminKey);
    const q = await admin.call<{ districts: { id: string; status: string }[] }>("GET", "/mod/districts");
    assert(q.ok && q.data.districts.some((d) => d.id === id && d.status === "pending"), "moderación ve el distrito pendiente");
    const noNote = await admin.call("POST", `/mod/districts/${id}/review`, { decision: "rejected" });
    assert(!noNote.ok && noNote.error === "note_required", "rechazar exige motivo");
    const okd = await admin.call("POST", `/mod/districts/${id}/review`, { decision: "approved" });
    assert(okd.ok, "aprobar");
    const list = (await (await fetch(new URL("/districts", baseUrl))).json()) as { districts: { id: string; community?: boolean; contact?: string }[] };
    const pub = list.districts.find((d) => d.id === slug);
    assert(!!pub?.community && !JSON.stringify(pub).includes("contact@"), "aprobado: sale en /districts, sin el contacto de su autor");
    const guest = await XenxoClient.connect({ baseUrl, chunkId: chunk_id });
    assert(guest.snapshot.entities.some((e) => e.entity_id === `cd_${id}_piece_0`), "aprobado: entra cualquiera");
    guest.close();
    // Fase 3: su puerta en el nexo, con su portada, que lleva a su chunk.
    const nexo = await XenxoClient.connect({ baseUrl, chunkId: PLACES.nexo });
    const door = nexo.snapshot.entities
      .map((e) => e.components["portal@1"] as { to: { chunk_id?: string }; cover?: string; closed?: boolean } | undefined)
      .find((p) => p?.to.chunk_id === chunk_id);
    nexo.close();
    assert(!!door && door.cover === cover.data.hash && !door.closed, "aprobado: tiene su puerta en el nexo, con su portada");
  }
  const gone = await api.call("DELETE", "/me/district");
  assert(gone.ok, "borrar el distrito");
  const after = (await (await fetch(new URL("/districts", baseUrl))).json()) as { districts: { id: string }[] };
  assert(!after.districts.some((d) => d.id === slug), "borrado: ya no sale");
  if (adminKey) {
    // La puerta del nexo se quita al momento (en segundo plano): se espera un poco.
    let still = true;
    for (let i = 0; i < 10 && still; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const n = await XenxoClient.connect({ baseUrl, chunkId: PLACES.nexo });
      still = n.snapshot.entities.some((e) => (e.components["portal@1"] as { to?: { chunk_id?: string } } | undefined)?.to?.chunk_id === chunk_id);
      n.close();
    }
    assert(!still, "borrado: su puerta sale del nexo");
  }
});

await scenario("distrito de la comunidad: un portal admite el enlace entero del juego (xenxo.io/j/<nombre>) y se queda con el nombre", async () => {
  const api = new Api(baseUrl);
  await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const model = await api.upload(await makeBoxGlb({ segments: 1, color: [0.2, Math.random(), 0.8, 1] }), "model");
  const emblem = await api.upload(await makeBoxGlb({ segments: 1, color: [Math.random(), 0.7, 0.2, 1] }), "monument");
  const cover = await api.upload(makeCoverPng(320, 180, [40, Math.floor(Math.random() * 255), 120]), "cover");
  assert(model.ok && emblem.ok && cover.ok, "subidas del distrito");
  const base = {
    schema: "xenxo.district/0",
    slug: `conf-${randomUUID().slice(0, 8)}`,
    name: { es: "Portales", en: "Portals" },
    description: { es: "Enlaces de juegos", en: "Game links" },
    color: "#33ddff",
    cover: cover.data.hash,
    emblem: emblem.data.hash,
    models: { caja: { file: model.data.hash } },
    author: "Banco de conformidad",
    contact: "contact@xenxo.io",
  };
  // Con el enlace entero, el servidor lo entiende como el nombre del juego (y lo busca: no es suyo → bad_portal).
  const full = await api.call("PUT", "/me/district", { ...base, portals: [{ p: [10, 1.2, 10], game: "https://xenxo.io/j/no-existe-nunca" }] });
  assert(!full.ok && full.error === "bad_portal", `enlace entero → se comprueba el juego: bad_portal (${!full.ok && full.error})`);
  assert(!full.ok && /no-existe-nunca/.test(full.message ?? "") && !/https:/.test(full.message ?? ""), `se queda con el nombre (${!full.ok && full.message})`);
  // Un enlace de otra web no es un juego de xenxo: la ficha no vale.
  const other = await api.call("PUT", "/me/district", { ...base, portals: [{ p: [10, 1.2, 10], game: "https://example.org/j/no-existe-nunca" }] });
  assert(!other.ok && other.status === 400 && other.error !== "bad_portal", `enlace de otra web → ficha no válida (${!other.ok && other.error})`);
});

await scenario("actividades: el servidor comprueba la cercanía, el orden y el reloj; guarda lo recogido, los tiempos y los marcadores", async () => {
  if (!adminKey) return console.log("    (sin XENXO_ADMIN_KEY: se omite: las actividades de prueba las pone la administración)");
  const chunkId = "c_-1_-1";
  const tag = randomUUID().slice(0, 6);
  const admin = await XenxoClient.connect({ baseUrl, chunkId, agentKey: adminKey });
  const put = async (p: number[], extra: Record<string, unknown>) => {
    const r = await admin.mutate({ op: "SPAWN", components: { "transform@1": { p, r: [0, 0, 0, 1], s: [1, 1, 1], parent: null }, ...extra } });
    assert(r.type === "ACK", `spawn de actividad: ${JSON.stringify(r.payload)}`);
    return (r.payload as { entity_id: string }).entity_id;
  };
  const prim = { "primitive@1": { shape: "sphere", size: [0.6, 0.6, 0.6], color: "#ffd54f", emissive: true } };
  const a = await put([10, 1, 10], { ...prim, "collectible@1": { set: `h${tag}` } });
  const b = await put([20, 1, 10], { ...prim, "collectible@1": { set: `h${tag}` } });
  const start = await put([0, 0, 100], { "checkpoint@1": { race: `r${tag}`, role: "start" } });
  const cp = await put([0, 0, 110], { "checkpoint@1": { race: `r${tag}`, role: "cp", order: 1 } });
  const fin = await put([0, 0, 120], { "checkpoint@1": { race: `r${tag}`, role: "finish" } });
  const boardRace = await put([5, 2, 100], { "scoreboard@1": { kind: "race", id: `r${tag}` } });
  const boardHunt = await put([5, 2, 110], { "scoreboard@1": { kind: "hunt", id: `h${tag}` } });
  // Placa de impulso: se acepta como cualquier componente; más de 12 m/s, no (anularía las carreras).
  await put([0, 0, 105], { "boost@1": { speed: 9, seconds: 2, radius: 1.8 } });
  const tooFast = await admin.mutate({ op: "SPAWN", components: { "transform@1": { p: [0, 0, 106], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null }, "boost@1": { speed: 20 } } });
  assert(tooFast.type === "ERROR", "una placa de más de 12 m/s se rechaza");
  admin.close();

  const guest = await XenxoClient.connect({ baseUrl, chunkId });
  const g = await guest.activity("COLLECT", a);
  assert(g.type === "ERROR" && g.payload.code === "forbidden", "un invitado no guarda lo que recoge");
  guest.close();

  const api = new Api(baseUrl);
  const name = `conf ${randomUUID().slice(0, 6)}`;
  await api.register(name);
  const u = await XenxoClient.connect({ baseUrl, chunkId, token: api.token });
  // La primera pose es la llegada; después se va andando (a `speed` m/s), como un cliente de verdad.
  let here: [number, number, number] | null = null;
  const at = async (p: [number, number, number], speed = 30) => {
    if (here) await walk(u, here, p, speed);
    else {
      u.pose(p);
      await sleep(260);
    }
    here = p;
  };
  await at([10, 1.6, 10]);
  const c1 = await u.activity("COLLECT", a);
  assert(c1.type === "COLLECTED" && c1.payload.count === 1 && c1.payload.total === 2 && !c1.payload.complete, `recoger el primero → 1 de 2 (${JSON.stringify(c1.payload)})`);
  const far = await u.activity("COLLECT", b);
  assert(far.type === "ERROR" && far.payload.code === "forbidden", "de lejos no se recoge");
  await at([20, 1.6, 10]);
  const c2 = await u.activity("COLLECT", b);
  assert(c2.type === "COLLECTED" && c2.payload.count === 2 && c2.payload.complete, "el segundo completa la búsqueda");

  // Carrera: más rápida que a pie (lo ve el servidor en las poses) → se anula; a un ritmo posible →
  // tiempo, mejor marca y puesto.
  await at([0, 1.6, 100]);
  const s1 = await u.activity("CHECKPOINT", start);
  assert(s1.type === "RACE" && s1.payload.state === "start" && s1.payload.total === 1, "la salida empieza la carrera");
  await at([0, 1.6, 110], 12);
  const k1 = await u.activity("CHECKPOINT", cp);
  assert(k1.type === "RACE" && k1.payload.state === "cp" && k1.payload.next === 2, "el punto que toca avanza");
  const reset = u.next("RACE", (m) => m.payload.state === "reset", 3000);
  u.pose([0, 1.6, 120]); // 10 m de golpe: no es un salto, pero nadie corre tanto a pie
  here = [0, 1.6, 120];
  await reset;
  // Sin carrera en marcha, la meta no responde (o responde sin tiempo).
  const after = await u.activity("CHECKPOINT", fin, 1000).catch(() => null);
  assert(!after || after.type !== "RACE" || after.payload.state !== "finish", "la carrera anulada no llega a la meta");
  await at([0, 1.6, 100]);
  await u.activity("CHECKPOINT", start);
  await at([0, 1.6, 110], 12);
  await u.activity("CHECKPOINT", cp);
  await sleep(1400);
  await at([0, 1.6, 120], 12);
  const done = await u.activity("CHECKPOINT", fin);
  assert(done.type === "RACE" && done.payload.state === "finish" && (done.payload.ms ?? 0) >= 1400 && done.payload.rank === 1, `meta: tiempo y puesto (${JSON.stringify(done.payload)})`);
  // En coche no se corre: la salida no cuenta.
  await at([0, 1.6, 100]);
  u.pose([0, 1.2, 100], 0, undefined, { p: [0, 0, 100], inside: true });
  await new Promise((r) => setTimeout(r, 260));
  const inCar = await u.activity("CHECKPOINT", start);
  assert(inCar.type === "ERROR" && inCar.payload.code === "forbidden", "en coche, la carrera no cuenta");
  await at([0, 1.6, 100]);
  const sr = await u.activity("SCORES_GET", boardRace);
  assert(sr.type === "SCORES" && sr.payload.rows[0]?.name === name && sr.payload.rows[0]?.value === done.payload.best, "el marcador de la carrera");
  const sh = await u.activity("SCORES_GET", boardHunt);
  assert(sh.type === "SCORES" && sh.payload.rows.some((r) => r.name === name), "el marcador de la búsqueda");
  u.close();

  const again = await XenxoClient.connect({ baseUrl, chunkId, token: api.token });
  const prog = await again.next("PROGRESS");
  assert(prog.payload.collected.includes(a) && prog.payload.collected.includes(b) && prog.payload.best[start] === done.payload.best, "al volver, PROGRESS dice lo que ya tiene");
  again.close();
  const exp = await api.call<{ activities: { chunk: string; collected: unknown[] }[] }>("GET", "/me/export");
  assert(exp.ok && exp.data.activities.some((x) => x.chunk === chunkId && x.collected.length === 2), "la exportación incluye las actividades");
}, 40_000);

await scenario("Rastro de datos (Distrito Cero): 12 fragmentos del sistema con su historia; los de la pasarela solo desde arriba", async () => {
  const chunkId = "c_-1_-1";
  const api = new Api(baseUrl);
  await api.register(`conf rastro ${randomUUID().slice(0, 6)}`);
  const u = await XenxoClient.connect({ baseUrl, chunkId, token: api.token });
  const frags = u.snapshot.entities.filter((e) => (e.components["collectible@1"] as { set?: string } | undefined)?.set === "rastro");
  assert(frags.length === 12 && frags.every((e) => e.owner === "system"), `12 fragmentos del sistema (${frags.length})`);
  const note = (e: (typeof frags)[number]) => (e.components["collectible@1"] as { note?: Record<string, string> }).note;
  assert(frags.every((e) => note(e)?.es && note(e)?.en), "cada fragmento cuenta algo en ES y EN");
  assert(u.snapshot.entities.some((e) => (e.components["scoreboard@1"] as { kind?: string; id?: string } | undefined)?.id === "rastro"), "con su marcador en la plaza");
  const pos = (e: (typeof frags)[number]) => (e.components["transform@1"] as { p: [number, number, number] }).p;
  // La primera pose es la llegada; después, andando (sin saltos: con un salto no se recoge nada).
  let here: [number, number, number] | null = null;
  const at = async (p: [number, number, number]) => {
    if (here) await walk(u, here, p, 35);
    else {
      u.pose(p);
      await sleep(260);
    }
    here = p;
  };
  const first = frags.find((e) => pos(e)[1] < 2)!;
  const fp = pos(first);
  await at([fp[0], 1.6, fp[2]]);
  const c = await u.activity("COLLECT", first.entity_id);
  assert(c.type === "COLLECTED" && c.payload.total === 12 && c.payload.count === 1 && !!c.payload.note?.es, `recogido, 1 de 12, con su historia (${JSON.stringify(c.payload)})`);
  const high = frags.find((e) => pos(e)[1] > 8)!;
  const hp = pos(high);
  await at([hp[0], 1.6, hp[2]]);
  const below = await u.activity("COLLECT", high.entity_id);
  assert(below.type === "ERROR" && below.payload.code === "forbidden", "desde la calle, el de la pasarela no se recoge");
  await at([hp[0], 9.6, hp[2]]);
  const above = await u.activity("COLLECT", high.entity_id);
  assert(above.type === "COLLECTED" && above.payload.count === 2, "desde la pasarela, sí");
  // Insignia: con los 12 (la comprueba el servidor con lo que guarda el distrito, no el cliente).
  const early = await api.call<{ badges: { id: string }[] }>("GET", "/me/badges");
  assert(early.ok && early.data.badges.length === 0, "a medias, sin insignia");
  let last: unknown = above.payload;
  for (const f of frags.filter((e) => e !== first && e !== high)) {
    const p = pos(f);
    await at([p[0], Math.max(1.6, p[1]), p[2]]);
    let r = await u.activity("COLLECT", f.entity_id);
    // La cercanía se mide con la última pose que le llegó al servidor: en una máquina lenta (CI)
    // puede no haber llegado aún. Se vuelve a dar una vez, con más margen.
    if (r.type !== "COLLECTED") {
      u.pose([p[0], Math.max(1.6, p[1]), p[2]]);
      await new Promise((ok) => setTimeout(ok, 800));
      r = await u.activity("COLLECT", f.entity_id);
    }
    last = r.type === "COLLECTED" ? r.payload : r;
  }
  assert((last as { complete?: boolean }).complete === true, `los 12 recogidos (${JSON.stringify(last)})`);
  u.close();
  const got = await api.call<{ new: { id: string }[]; badges: { id: string }[] }>("POST", "/me/badges/check");
  assert(got.ok && got.data.new.some((b) => b.id === "cero_rastro"), `insignia «Rastro de datos» (${JSON.stringify(got)})`);
  const again = await api.call<{ badges: { id: string }[] }>("GET", "/me/badges");
  assert(again.ok && again.data.badges.filter((b) => b.id === "cero_rastro").length === 1, "una sola vez");
  const soon = await api.call<{ throttled?: boolean }>("POST", "/me/badges/check");
  assert(soon.ok && soon.data.throttled === true, "y no se puede comprobar a cada momento");
  const exp = await api.call<{ badges?: { id: string }[] }>("GET", "/me/export");
  assert(exp.ok && (exp.data.badges ?? []).some((b) => b.id === "cero_rastro"), "la exportación incluye las insignias");
  const mine = await api.call<{ player_no: number }>("PUT", "/me/card", { public: true });
  assert(mine.ok, "carné público");
  const cardMine = await api.call<{ player_no: number }>("GET", "/me/card");
  assert(cardMine.ok, "GET /me/card");
  const no = cardMine.data.player_no;
  const card = (await (await fetch(new URL(`/players/${no}`, baseUrl))).json()) as { badges?: { id: string }[] };
  assert((card.badges ?? []).some((b) => b.id === "cero_rastro"), "y se ve en el carné");
}, 60_000);

await scenario("marcadores en el panel: /scores reúne los de los distritos (del día, de la semana y lo que construyen los agentes)", async () => {
  const r = await fetch(new URL("/scores", baseUrl));
  assert(r.ok, `GET /scores (${r.status})`);
  const d = (await r.json()) as { districts: { id: string; boards: { kind: string; period: string; rows: unknown[] }[] }[] };
  const of = (id: string) => d.districts.find((x) => x.id === id)?.boards ?? [];
  assert(of("pixel").some((b) => b.kind === "points" && b.period === "week"), "Píxel: puntos de la semana");
  assert(of("arcade").some((b) => b.kind === "race" && b.period === "week"), "Arcade: carrera de la semana");
  assert(of("taller").some((b) => b.kind === "builds"), "Taller: lo que construyen los agentes");
});

await scenario("Circuito Neón (Arcade): carrera del sistema con salida, 11 puntos y meta, placas de impulso, 50 monedas y sus marcadores", async () => {
  const c = await XenxoClient.connect({ baseUrl, chunkId: "c_1_0" });
  const sys = c.snapshot.entities.filter((e) => e.owner === "system");
  const cps = sys.filter((e) => (e.components["checkpoint@1"] as { race?: string } | undefined)?.race === "circuito");
  const roles = (r: string) => cps.filter((e) => (e.components["checkpoint@1"] as { role: string }).role === r).length;
  assert(roles("start") === 1 && roles("finish") === 1 && roles("cp") === 11, `salida, 11 puntos y meta (${roles("start")}/${roles("cp")}/${roles("finish")})`);
  assert(sys.filter((e) => e.components["boost@1"]).length === 6, "seis placas de impulso");
  assert(sys.filter((e) => (e.components["collectible@1"] as { set?: string } | undefined)?.set === "monedas").length === 50, "cincuenta monedas");
  const boards = sys.filter((e) => e.components["scoreboard@1"]).map((e) => (e.components["scoreboard@1"] as { id: string }).id);
  assert(boards.includes("circuito") && boards.includes("monedas"), "marcador de la carrera y de las monedas");
  c.close();
});

await scenario("Plaza tablero (Píxel): el servidor enciende una figura, cuenta lo que se pisa con las poses y da un punto del día", async () => {
  const chunkId = "c_-1_0";
  const api = new Api(baseUrl);
  const name = `conf tablero ${randomUUID().slice(0, 6)}`;
  await api.register(name);
  const u = await XenxoClient.connect({ baseUrl, chunkId, token: api.token });
  const board = u.snapshot.entities.find((e) => e.components["tiles@1"]);
  assert(!!board, "la plaza tiene su tablero (tiles@1)");
  const tb = board!.components["tiles@1"] as { cols: number; rows: number; size: number };
  const [bx, , bz] = (board!.components["transform@1"] as { p: [number, number, number] }).p;
  const center = (i: number): [number, number, number] => {
    const c = i % tb.cols, r = Math.floor(i / tb.cols);
    return [bx - (tb.cols * tb.size) / 2 + (c + 0.5) * tb.size, 1.6, bz - (tb.rows * tb.size) / 2 + (r + 0.5) * tb.size];
  };
  const show = u.next("TILES", (m) => m.payload.state === "show", 8000);
  u.pose([bx + 0.1, 1.6, bz + 0.1]);
  const round = await show;
  assert(round.payload.lit.length > 0 && round.payload.done.length <= round.payload.lit.length, `ronda con su figura (${round.payload.lit.length} baldosas)`);
  const won = u.next("TILES", (m) => m.payload.state === "won", 60_000);
  // De baldosa en baldosa, por la más cercana y andando (una pose que llega de un salto no pisa).
  let here: [number, number, number] = [bx + 0.1, 1.6, bz + 0.1];
  const left = [...round.payload.lit];
  while (left.length) {
    left.sort((a, b) => Math.hypot(center(a)[0] - here[0], center(a)[2] - here[2]) - Math.hypot(center(b)[0] - here[0], center(b)[2] - here[2]));
    const next = center(left.shift()!);
    await walk(u, here, next, 30, 150);
    here = next;
  }
  await won;
  const sb = u.snapshot.entities.find((e) => (e.components["scoreboard@1"] as { kind?: string } | undefined)?.kind === "points");
  assert(!!sb, "marcador de puntos del día");
  const scores = await u.activity("SCORES_GET", sb!.entity_id);
  assert(scores.type === "SCORES" && scores.payload.kind === "points" && (scores.payload.rows.some((r) => r.name === name && r.value >= 1) || scores.payload.rows.length === 10), "la cuenta suma su punto de hoy (o el marcador ya está lleno de hoy)");
  u.close();
  const exp = await api.call<{ activities: { daily_points?: unknown[] }[] }>("GET", "/me/export");
  assert(exp.ok && exp.data.activities.some((x) => (x.daily_points ?? []).length > 0), "la exportación incluye los puntos");
}, 30_000);

await scenario("zona de pruebas (Taller): cualquier cuenta construye piezas básicas dentro, con tope; fuera o con modelos, no", async () => {
  const chunkId = "c_0_-1";
  const api = new Api(baseUrl);
  await api.register(`conf sandbox ${randomUUID().slice(0, 6)}`);
  const u = await XenxoClient.connect({ baseUrl, chunkId, token: api.token });
  const T = (p: [number, number, number]) => ({ p, r: [0, 0, 0, 1], s: [1, 1, 1], parent: null });
  const piece = (p: [number, number, number]) => ({ "transform@1": T(p), "primitive@1": { shape: "box", size: [1, 1, 1], color: "#ff4fd8" }, "collider@1": { shape: "box", half_extents: [0.5, 0.5, 0.5], trigger: false } });
  const ok = await u.mutate({ op: "SPAWN", components: piece([30, 0.5, 68]) });
  assert(ok.type === "ACK", `una caja dentro de la zona (${JSON.stringify(ok.payload)})`);
  const out = await u.mutate({ op: "SPAWN", components: piece([30, 0.5, 40]) });
  assert(out.type === "ERROR" && out.payload.code === "forbidden", "fuera de la zona, no");
  const model = await u.mutate({ op: "SPAWN", components: { "transform@1": T([32, 0, 70]), "portal@1": { to: { kind: "chunk", chunk_id: "c_0_0" } } } });
  assert(model.type === "ERROR", "un portal en la zona, no");
  const guest = await XenxoClient.connect({ baseUrl, chunkId });
  const g = await guest.mutate({ op: "SPAWN", components: piece([31, 0.5, 70]) });
  assert(g.type === "ERROR" && g.payload.code === "forbidden", "un invitado no construye");
  const steal = await guest.mutate({ op: "DESPAWN", entity_id: (ok as { payload: { entity_id: string } }).payload.entity_id, base_rev: 1 });
  assert(steal.type === "ERROR", "nadie borra lo de otro");
  guest.close();
  const del = await u.mutate({ op: "DESPAWN", entity_id: (ok as { payload: { entity_id: string } }).payload.entity_id, base_rev: 1 });
  assert(del.type === "ACK", "lo suyo sí lo borra");
  u.close();
});

await scenario("zona de pruebas: lo que se sale (escala negativa o enorme, colisionador más grande que la pieza, cartel larguísimo) se rechaza", async () => {
  const chunkId = "c_0_-1";
  const api = new Api(baseUrl);
  await api.register(`conf sandbox ${randomUUID().slice(0, 6)}`);
  const u = await XenxoClient.connect({ baseUrl, chunkId, token: api.token });
  const box = { shape: "box", size: [1, 1, 1], color: "#ff4fd8" };
  const tries: [string, Record<string, unknown>][] = [
    ["escala negativa", { "transform@1": { p: [32, 0.5, 69], s: [-2000, 1, -2000] }, "primitive@1": box }],
    ["escala enorme", { "transform@1": { p: [32, 0.5, 69], s: [50, 1, 1] }, "primitive@1": box }],
    ["colisionador gigante", { "transform@1": { p: [32, 0.5, 69] }, "primitive@1": box, "collider@1": { shape: "box", half_extents: [500, 50, 500] } }],
    ["cartel que se sale", { "transform@1": { p: [32, 2, 69] }, "label@1": { text: "x".repeat(120), size: 4 } }],
    ["giro que escala", { "transform@1": { p: [32, 0.5, 69], r: [0, 0, 0, 0] }, "primitive@1": box }],
  ];
  for (const [why, components] of tries) {
    const r = await u.mutate({ op: "SPAWN", components });
    assert(r.type === "ERROR", `${why}: debería rechazarse (${JSON.stringify(r.payload)})`);
  }
  // Lo normal sigue entrando (y un giro sin normalizar se guarda normalizado).
  const ok = await u.mutate({ op: "SPAWN", components: { "transform@1": { p: [32, 0.5, 69], r: [0, 2, 0, 2] }, "primitive@1": box } });
  assert(ok.type === "ACK", `una caja normal dentro (${JSON.stringify(ok.payload)})`);
  await u.mutate({ op: "DESPAWN", entity_id: ok.payload.entity_id, base_rev: 1 });
  u.close();
});

await scenario("ids reservados: un cliente no puede elegir los del sistema (máquinas, portales, semilla del lugar)", async () => {
  const api = new Api(baseUrl);
  await api.register(`conf ids ${randomUUID().slice(0, 6)}`);
  const u = await XenxoClient.connect({ baseUrl, chunkId: "c_0_-1", token: api.token });
  const piece = { "transform@1": { p: [30, 0.5, 68] }, "primitive@1": { shape: "box", size: [1, 1, 1], color: "#ff4fd8" } };
  for (const id of ["cabinet_4", "billboard_9", "standm_abcdef", "Stand_abcdef", "taller_mio_1", "nexo_puerta"]) {
    const r = await u.mutate({ op: "SPAWN", entity_id: id, components: piece });
    assert(r.type === "ERROR" && r.payload.code === "forbidden", `«${id}» está reservado (${JSON.stringify(r.payload)})`);
  }
  const mine = await u.mutate({ op: "SPAWN", entity_id: `mio_${randomUUID().slice(0, 8)}`, components: piece });
  assert(mine.type === "ACK", "un id cualquiera sí");
  await u.mutate({ op: "DESPAWN", entity_id: mine.payload.entity_id, base_rev: 1 });
  u.close();
});

await scenario("HELLO una sola vez: el segundo da bad_message y no vuelve a mandar el SNAPSHOT", async () => {
  const c = await XenxoClient.connect({ baseUrl, displayName: "conf-hello" });
  const err = c.next("ERROR", (m) => m.payload.code === "bad_message", 3000);
  c.sendRaw(msg("HELLO", { client_type: "headless", capabilities: { xr: false, hand_tracking: false, haptics: false, lod: "low" } }));
  await err;
  await sleep(400);
  assert(!c.received.some((m) => m.type === "SNAPSHOT" || m.type === "WELCOME"), "un segundo HELLO no repite WELCOME ni SNAPSHOT");
  c.close();
});

await scenario("inundación: quien manda mensajes sin parar se queda sin conexión (4008)", async () => {
  const c = await XenxoClient.connect({ baseUrl, displayName: "conf-flood" });
  for (let i = 0; i < 400; i++) c.sendRaw(msg("PING", { t: i }));
  for (let i = 0; i < 20 && !c.closed; i++) await sleep(100);
  assert(c.closed, "la conexión debería cerrarse");
  // Otra conexión normal sigue entrando.
  const ok = await XenxoClient.connect({ baseUrl });
  ok.close();
});

await scenario("saltos: quien aparece de golpe junto a un objeto no lo recoge; andando, sí", async () => {
  const chunkId = "c_-1_-1";
  const api = new Api(baseUrl);
  await api.register(`conf salto ${randomUUID().slice(0, 6)}`);
  const u = await XenxoClient.connect({ baseUrl, chunkId, token: api.token });
  const frag = u.snapshot.entities.find((e) => (e.components["collectible@1"] as { set?: string } | undefined)?.set === "rastro" && (e.components["transform@1"] as { p: number[] }).p[1]! < 2)!;
  const fp = (frag.components["transform@1"] as { p: [number, number, number] }).p;
  const start: [number, number, number] = [fp[0], 1.6, fp[2] - 60];
  u.pose(start); // la llegada
  await sleep(260);
  u.pose([fp[0], 1.6, fp[2]]); // 60 m de golpe
  await sleep(260);
  const r = await u.activity("COLLECT", frag.entity_id);
  assert(r.type === "ERROR" && r.payload.code === "forbidden" && (r.payload.detail as { reason?: string } | undefined)?.reason === "jump", `tras un salto no se recoge (${JSON.stringify(r.payload)})`);
  u.close();
  // Otra conexión (otra llegada) que se acerca andando, sí.
  const v = await XenxoClient.connect({ baseUrl, chunkId, token: api.token });
  v.pose(start);
  await sleep(260);
  await walk(v, start, [fp[0], 1.6, fp[2]], 25);
  const ok = await v.activity("COLLECT", frag.entity_id);
  assert(ok.type === "COLLECTED", `andando, sí (${JSON.stringify(ok.payload)})`);
  v.close();
});

if (process.env.XENXO_SLOW && agentKey) {
  await scenario("hibernación: tras un rato sin mensajes el chunk sigue sabiendo quién es (SNAPSHOT válido, nexo en solitario)", async () => {
    const api = new Api(baseUrl);
    await api.register(`conf hib ${randomUUID().slice(0, 6)}`);
    const agent = await XenxoClient.connect({ baseUrl, agentKey });
    const solo = await XenxoClient.connect({ baseUrl, chunkId: PLACES.nexo, token: api.token });
    await sleep(75_000); // en local, workerd saca de memoria el objeto que no recibe nada
    const r = await agent.mutate({ op: "SPAWN", components: { "transform@1": { p: [12, 0.5, 12] }, "primitive@1": { shape: "box", size: [1, 1, 1], color: "#ffffff" } } });
    assert(r.type === "ACK", `SPAWN tras hibernar (${JSON.stringify(r.payload)})`);
    const said = await solo.chat("hola tras hibernar");
    assert(said.type === "ERROR" && said.payload.code === "forbidden", "el nexo sigue en solitario tras hibernar");
    // Si la entidad nueva saliera sin chunk_id, el SNAPSHOT no pasaría el esquema y connect() fallaría.
    const g = await XenxoClient.connect({ baseUrl });
    assert(g.snapshot.entities.some((e) => e.entity_id === r.payload.entity_id && e.chunk_id === "c_0_0"), "la entidad nueva va con su chunk_id");
    g.close();
    await agent.mutate({ op: "DESPAWN", entity_id: r.payload.entity_id, base_rev: 1 });
    agent.close();
    solo.close();
  }, 120_000);
}

await scenario("distrito grande: WELCOME.walk de 256 m y cada uno recibe solo las poses de quien tiene cerca", async () => {
  const chunkId = "c_0_-1";
  const a = await XenxoClient.connect({ baseUrl, chunkId, displayName: "conf-lejos-a" });
  const b = await XenxoClient.connect({ baseUrl, chunkId, displayName: "conf-lejos-b" });
  const c = await XenxoClient.connect({ baseUrl, chunkId, displayName: "conf-cerca-c" });
  const walk = a.welcome.walk;
  assert(!!walk && walk[1] - walk[0] >= 256 && !a.welcome.solo, "un distrito dice hasta dónde se camina (más que su chunk) y no es en solitario");
  // b y c mandan su pose primero (el servidor sabe dónde están); luego a, junto a c y lejos de b.
  b.pose([140, 1.6, 140], 0);
  c.pose([-70, 1.6, -70], 0);
  await new Promise((r) => setTimeout(r, 400));
  const seenByC = c.next("POSES", (m) => m.payload.poses.some((p) => p.session_id === a.welcome.session_id), 3000);
  for (let i = 0; i < 4; i++) {
    a.pose([-75, 1.6, -75], 0);
    await new Promise((r) => setTimeout(r, 220));
  }
  await seenByC;
  assert(!b.received.some((m) => m.type === "POSES" && m.payload.poses.some((p) => p.session_id === a.welcome.session_id)), "quien está a 300 m no recibe la pose");
  a.close();
  b.close();
  c.close();
});

await scenario("pase: /chunk/<id>/ticket dice dónde conectar (aquí con el mismo token, o fuera con un pase firmado)", async () => {
  const g = await fetch(new URL("/auth/guest", baseUrl), { method: "POST" });
  const token = ((await g.json()) as { token: string }).token;
  assert((await fetch(new URL("/chunk/c_0_-1/ticket", baseUrl), { method: "POST" })).status === 401, "sin token no hay pase");
  const ds = ((await (await fetch(new URL("/districts", baseUrl))).json()) as { districts: { chunk_id: string; remote?: boolean; soon?: boolean }[] }).districts;
  for (const d of ds) {
    const r = await fetch(new URL(`/chunk/${d.chunk_id}/ticket`, baseUrl), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (d.soon) {
      assert(r.status === 403, `a un distrito «próximamente» no se da pase (${d.chunk_id})`);
      continue;
    }
    assert(r.ok, `pase para ${d.chunk_id}`);
    const t = (await r.json()) as { url: string; remote: boolean };
    assert(t.remote === !!d.remote, `remote coincide con /districts en ${d.chunk_id}`);
    assert(t.remote ? t.url.includes("ticket=") && !t.url.includes(token) : t.url.includes(`token=`), `la URL lleva pase si es de fuera y nunca el token fuera (${d.chunk_id})`);
    const c = await XenxoClient.connect({ baseUrl, chunkId: d.chunk_id, token });
    assert(c.welcome.chunk_id === d.chunk_id, `se entra en ${d.chunk_id} por su pase`);
    c.close();
  }
});

await scenario("nodos: el registro lo gestiona solo el fundador; un nodo que no responde no recibe distritos (y con XENXO_NODE_URL, un traslado de ida y vuelta)", async () => {
  const key0 = await fetch(new URL("/nodes/key", baseUrl));
  assert(key0.status === 200 || key0.status === 404, "/nodes/key: la clave pública, o 404 si aún no hay ningún nodo");
  const someone = new Api(baseUrl);
  await someone.register(`conf ${randomUUID().slice(0, 6)}`);
  const nope = await someone.call("POST", "/mod/nodes", { id: "intruso", name: "Intruso", url: "https://example.com" });
  assert(!nope.ok && nope.status === 403, "una cuenta cualquiera no da de alta nodos");
  if (!adminKey) return console.log("    (sin XENXO_ADMIN_KEY: se omite el resto)");
  const admin = new Api(baseUrl);
  await admin.agentToken(adminKey);
  const bad = await admin.call("POST", "/mod/nodes", { id: "mal-url", name: "Mal", url: "ftp://example.com" });
  assert(!bad.ok && bad.status === 400, "una dirección que no es https se rechaza");
  const ghostId = `fantasma-${randomUUID().slice(0, 6)}`;
  const ghost = await admin.call<{ alive: boolean }>("POST", "/mod/nodes", { id: ghostId, name: "Fantasma", url: "http://127.0.0.1:9" });
  assert(ghost.ok && ghost.data.alive === false, "se puede dar de alta, pero consta que no responde");
  const key = await fetch(new URL("/nodes/key", baseUrl));
  assert(key.ok, "con un nodo dado de alta ya hay clave de firma");
  const pub = (await key.json()) as { kty: string; x: string; d?: string };
  assert(pub.kty === "OKP" && !!pub.x && pub.d === undefined, "la clave que se reparte es solo la pública");
  const mv = await admin.call("POST", "/mod/chunks/c_-1_0/move", { to: ghostId });
  assert(!mv.ok && mv.status === 502, "a un nodo que no responde no se lleva ningún distrito");
  const plaza = await admin.call("POST", "/mod/chunks/c_0_0/move", { to: ghostId });
  assert(!plaza.ok && plaza.status === 400, "la plaza no va a ningún nodo");
  assert((await admin.call("DELETE", `/mod/nodes/${ghostId}`)).ok, "un nodo sin distritos se quita");

  const nodeUrl = process.env.XENXO_NODE_URL;
  const nodeId = process.env.XENXO_NODE_ID;
  if (!nodeUrl || !nodeId) return console.log("    (sin XENXO_NODE_URL y XENXO_NODE_ID: se omite el traslado)");
  await admin.call("DELETE", `/mod/nodes/${nodeId}`);
  const add = await admin.call<{ alive: boolean }>("POST", "/mod/nodes", { id: nodeId, name: "Nodo de prueba", url: nodeUrl });
  assert(add.ok && add.data.alive, "el nodo de prueba responde con su id");
  const go = await admin.call("POST", "/mod/chunks/c_-1_0/move", { to: nodeId });
  assert(go.ok, `traslado al nodo: ${!go.ok ? go.message : ""}`);
  const ds = ((await (await fetch(new URL("/districts", baseUrl))).json()) as { districts: { chunk_id: string; remote?: boolean; host?: string }[] }).districts;
  const v = ds.find((d) => d.chunk_id === "c_-1_0");
  assert(v?.remote && v.host === "Nodo de prueba", "/districts dice que vive en el nodo y quién lo aloja");
  const guest = ((await (await fetch(new URL("/auth/guest", baseUrl), { method: "POST" })).json()) as { token: string }).token;
  const t = (await (await fetch(new URL("/chunk/c_-1_0/ticket", baseUrl), { method: "POST", headers: { Authorization: `Bearer ${guest}` } })).json()) as { url: string; remote: boolean };
  assert(t.remote && t.url.startsWith(nodeUrl.replace(/^http/, "ws")) && !t.url.includes(guest), "el pase lleva al nodo y nunca el token de sesión");
  const c = await XenxoClient.connect({ baseUrl, chunkId: "c_-1_0", token: guest });
  assert(c.welcome.chunk_id === "c_-1_0", "se entra en el distrito del nodo");
  c.close();
  const check = await admin.call<{ checked: number }>("POST", "/mod/nodes/check", {});
  assert(check.ok && check.data.checked >= 1, "la ronda de comprobación ve el nodo");
  const list = await admin.call<{ hosts: { chunk_id: string; snapshot_at: number | null }[] }>("GET", "/mod/nodes");
  assert(list.ok && list.data.hosts.find((x) => x.chunk_id === "c_-1_0")?.snapshot_at, "hay copia del distrito en Cloudflare");
  const busy = await admin.call("DELETE", `/mod/nodes/${nodeId}`);
  assert(!busy.ok && busy.status === 409, "un nodo con distritos no se puede quitar");
  const back = await admin.call("POST", "/mod/chunks/c_-1_0/move", { to: "cloudflare" });
  assert(back.ok, "vuelta a Cloudflare");
  assert((await admin.call("DELETE", `/mod/nodes/${nodeId}`)).ok, "y ya se puede quitar");
}, 40_000);

await scenario("nexo en solitario: nadie ve a nadie, no hay poses ni chat; en la plaza, sí", async () => {
  const api = new Api(baseUrl);
  await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const a = await XenxoClient.connect({ baseUrl, chunkId: PLACES.nexo, token: api.token });
  const b = await XenxoClient.connect({ baseUrl, chunkId: PLACES.nexo, displayName: "conf-solo-b" });
  assert(b.snapshot.peers.length === 0 && b.snapshot.poses.length === 0 && (b.snapshot.chat ?? []).length === 0, "en el nexo el SNAPSHOT no trae gente, poses ni chat");
  let leaked = false;
  b.onMessage((m) => {
    if (m.type === "PEER_JOIN" || m.type === "POSES" || m.type === "PEER_LEAVE" || m.type === "CHAT_MSG") leaked = true;
  });
  a.pose([32, 1.6, 40]);
  const said = await a.chat("hola nexo");
  assert(said.type === "ERROR" && said.payload.code === "forbidden", "en el nexo no hay chat");
  const late = await XenxoClient.connect({ baseUrl, chunkId: PLACES.nexo, displayName: "conf-solo-c" });
  late.close();
  await new Promise((r) => setTimeout(r, 400));
  assert(!leaked, "en el nexo no llega nada de los demás");
  a.close();
  b.close();
  const p = await XenxoClient.connect({ baseUrl });
  assert(!p.welcome.solo && !p.welcome.walk, "la plaza es compartida");
  p.close();
});

await scenario("portada: solo imágenes de verdad y con medidas razonables", async () => {
  const api = new Api(baseUrl);
  await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const ok = await api.upload(makeCoverPng(), "cover");
  assert(ok.ok && ok.data.format === "image", `la portada PNG debería aceptarse: ${JSON.stringify(ok)}`);
  const served = await fetch(new URL(`/assets/${ok.data.hash.slice(7)}`, baseUrl));
  assert(served.ok && served.headers.get("Content-Type") === "image/png", `se sirve con su tipo real, no ${served.headers.get("Content-Type")}`);
  const glb = await api.upload(await makeBoxGlb(), "cover");
  assert(!glb.ok && glb.error === "bad_image", "un GLB no es una portada");
  const tiny = await api.upload(makeCoverPng(40, 20), "cover");
  assert(!tiny.ok && tiny.error === "bad_image", "una portada diminuta se rechaza");
});

await scenario("proyecto: exige portada, monumento, distrito y parcela libre; su portal va a la parcela y al escaparate del nexo", async () => {
  const api = new Api(baseUrl);
  await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const parcel = await freeParcel("taller");
  const base = { title: "Proyecto de prueba", summary: "Creado por el banco de conformidad", url: "https://github.com/xenxo-dev/xenxo-world", district: "taller", parcel };
  const noCover = await api.call("POST", "/projects", base);
  assert(!noCover.ok && noCover.error === "cover_required", `sin portada → cover_required (${!noCover.ok && noCover.error})`);
  const cover = await api.upload(makeCoverPng(), "cover");
  const model = await api.upload(await makeBoxGlb({ segments: 3 }), "monument");
  assert(cover.ok && model.ok, "subidas de portada y monumento");
  const full = { ...base, cover_hash: cover.data.hash, mesh_hash: model.data.hash };
  const noUrl = await api.call("POST", "/projects", { ...full, url: "" });
  assert(!noUrl.ok && noUrl.error === "bad_url", "sin enlace → bad_url");
  const badDistrict = await api.call("POST", "/projects", { ...full, district: "casino" });
  assert(!badDistrict.ok && badDistrict.error === "bad_district", "distrito desconocido → bad_district");
  const badParcel = await api.call("POST", "/projects", { ...full, parcel: "Z9" });
  assert(!badParcel.ok && badParcel.error === "bad_parcel", "parcela inexistente → bad_parcel");

  const district = await XenxoClient.connect({ baseUrl, chunkId: "c_0_-1" });
  const nexo = await XenxoClient.connect({ baseUrl, chunkId: PLACES.nexo });
  const delta = district.next("DELTA", (m) => m.payload.changes.some((c) => c.kind === "upsert" && c.entity.entity_id.startsWith("standm_")), 4000);
  const created = await api.call<{ project: { id: string; in_world: boolean; category: string; district: string; parcel: string; review: string } }>("POST", "/projects", full);
  assert(created.ok && created.data.project.in_world, `el proyecto debería tener portal: ${JSON.stringify(created)}`);
  assert(created.data.project.category === "tool" && created.data.project.parcel === parcel, "categoría del distrito y parcela elegida");
  const d = await delta;
  const id = created.data.project.id;
  const up = (eid: string) => d.payload.changes.find((c) => c.kind === "upsert" && c.entity.entity_id === eid);
  const portal = up(`stand_${id}`);
  const pc = portal && portal.kind === "upsert" ? (portal.entity.components["portal@1"] as { to: { kind: string; project_id: string }; cover: string }) : null;
  assert(pc?.to.kind === "project" && pc.to.project_id === id && pc.cover === cover.data.hash, "el portal de la parcela lleva a la ficha con su portada");
  assert(!!up(`standf_${id}`), "la parcela recibe su marco");
  const meshEntity = up(`standm_${id}`);
  const lods = meshEntity && meshEntity.kind === "upsert" ? (meshEntity.entity.components["mesh@1"] as { lods: { tris: number }[] }).lods : [];
  const monCol = meshEntity && meshEntity.kind === "upsert" ? (meshEntity.entity.components["collider@1"] as { from_mesh?: boolean } | undefined) : undefined;
  assert(monCol?.from_mesh === true, "el monumento choca con su forma (collider@1.from_mesh)");
  assert(lods[0]?.tris === 108, `los triángulos deberían venir medidos por el servidor (108), llegaron ${lods[0]?.tris}`);
  // Los proyectos viven en su distrito: el nexo no tiene escaparate.
  assert(created.data.project.review === "pending", "publicar es inmediato; el catálogo espera la revisión");
  assert(!nexo.snapshot.entities.some((e) => e.entity_id.startsWith("show_")), "en el nexo no hay portales de proyectos");

  const other = new Api(baseUrl);
  await other.register(`conf ${randomUUID().slice(0, 6)}`);
  const c2 = await other.upload(makeCoverPng(321, 181), "cover");
  const m2 = await other.upload(await makeBoxGlb({ segments: 2 }), "monument");
  const twice = await other.call("POST", "/projects", { ...full, cover_hash: c2.ok ? c2.data.hash : "", mesh_hash: m2.ok ? m2.data.hash : "" });
  assert(!twice.ok && twice.error === "parcel_taken", `una parcela ocupada → parcel_taken (${!twice.ok && twice.error})`);

  const removed = district.next("DELTA", (m) => m.payload.changes.some((c) => c.kind === "remove" && c.entity_id === `stand_${id}`), 4000);
  const del = await api.call("DELETE", `/projects/${id}`);
  assert(del.ok, "borrar el proyecto");
  await removed;
  district.close();
  nexo.close();
});

await scenario("RGPD: exportar mis datos y borrar la cuenta retira su contenido", async () => {
  const api = new Api(baseUrl);
  const { passkey } = await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const model = await api.upload(await makeBoxGlb({ segments: 2, color: [Math.random(), 0.6, 0.3, 1] }), "model"); // único: nadie más lo ha subido
  const cover = await api.upload(makeCoverPng(330, 186, [Math.floor(Math.random() * 255), 80, 200]), "cover");
  assert(model.ok && cover.ok, "subidas");
  const created = await api.call<{ project: { id: string } }>("POST", "/projects", {
    title: "Para borrar",
    summary: "",
    url: "https://example.org",
    district: "taller",
    parcel: await freeParcel("taller"),
    cover_hash: cover.data.hash,
    mesh_hash: model.data.hash,
  });
  assert(created.ok, "proyecto");
  const exp = await api.call<{ user: { id: string }; projects: unknown[] }>("GET", "/me/export");
  assert(exp.ok && exp.data.projects.length === 1, "la exportación debería incluir el proyecto");
  const gone = await api.call("DELETE", "/me");
  assert(gone.ok, "borrar la cuenta");
  const asset = await fetch(new URL(`/assets/${model.data.hash.slice(7)}`, baseUrl));
  assert(asset.status === 404, "el modelo que solo subió esa persona debería borrarse");
  const coverGone = await fetch(new URL(`/assets/${cover.data.hash.slice(7)}`, baseUrl));
  assert(coverGone.status === 404, "su portada también");
  let loginFailed = false;
  try {
    await new Api(baseUrl).login(passkey);
  } catch {
    loginFailed = true;
  }
  assert(loginFailed, "la passkey de una cuenta borrada no debería servir");
  const c = await XenxoClient.connect({ baseUrl, chunkId: "c_0_-1" });
  assert(!c.snapshot.entities.some((e) => e.entity_id === `stand_${created.data.project.id}`), "el portal debería haber desaparecido");
  c.close();
});

await scenario("ficha xenxo.json: la de la plantilla create-xenxo es válida; una con campos inventados o sin inglés, no", async () => {
  const raw = readFileSync(new URL("../../../packages/create-xenxo/templates/common/public/xenxo.json", import.meta.url), "utf8")
    .replaceAll("{{title}}", "Mi juego")
    .replaceAll("{{category}}", "game3d")
    .replaceAll("{{avatar}}", "character");
  const ficha = JSON.parse(raw) as Record<string, unknown>;
  const ok = GameManifest.safeParse(ficha);
  assert(ok.success, `la ficha de la plantilla debería ser válida: ${ok.success ? "" : JSON.stringify(ok.error.issues)}`);
  assert(!GameManifest.safeParse({ ...ficha, inventado: true }).success, "un campo que xenxo no conoce se rechaza");
  assert(!GameManifest.safeParse({ ...ficha, name: { es: "Solo español" } }).success, "el nombre necesita español e inglés");
  assert(!GameManifest.safeParse({ ...ficha, ageRating: "+18" }).success, "solo all o +14");
  assert(!GameManifest.safeParse({ ...ficha, privacy: "http://inseguro.example" }).success, "la privacidad va por https");
  assert(GameManifest.safeParse({ ...ficha, xenxo: { clientId: "xg_abcdef123", project: "pdB6auRPggN0" } }).success, "con client_id y proyecto");
  assert(!GameManifest.safeParse({ ...ficha, avatar: "skin" }).success, "avatar: character, badge o none");
  assert(GameManifest.safeParse({ ...ficha, avatar: undefined }).success, "sin avatar también vale (se deduce)");
});

await scenario("DSA: cualquiera puede denunciar un contenido", async () => {
  const guest = new Api(baseUrl, ((await (await fetch(new URL("/auth/guest", baseUrl), { method: "POST" })).json()) as { token: string }).token);
  const r = await guest.call<{ id: number }>("POST", "/reports", { target_type: "project", target_id: "p_prueba", reason: "spam", details: "prueba" });
  assert(r.ok && r.data.id > 0, "la denuncia debería registrarse");
  const bad = await guest.call("POST", "/reports", { target_type: "project", target_id: "p_prueba", reason: "no-existe" });
  assert(!bad.ok && bad.status === 400, "un motivo inválido debería rechazarse");
  if (adminKey) {
    const admin = new Api(baseUrl);
    await admin.agentToken(adminKey);
    const list = await admin.call<{ reports: { id: number }[] }>("GET", "/admin/reports");
    assert(list.ok && list.data.reports.some((x) => x.id === r.data.id), "moderación debería ver la denuncia");
  }
});

await scenario("sesiones: «cerrar sesión en todos los dispositivos» impide renovar los tokens anteriores", async () => {
  const api = new Api(baseUrl);
  const { passkey } = await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const renewed = await api.call<{ token: string }>("POST", "/me/session");
  assert(renewed.ok && !!renewed.data.token, "una sesión vigente se renueva");
  const out = await api.call("POST", "/me/logout-all");
  assert(out.ok, "cerrar todas las sesiones debería responder bien");
  const stale = await api.call("POST", "/me/session");
  assert(!stale.ok && stale.status === 401 && stale.error === "session_expired", "un token de antes ya no se renueva");
  const old = new Api(baseUrl, renewed.data.token);
  const stale2 = await old.call("PATCH", "/me", { display_name: "otro nombre" });
  assert(!stale2.ok && stale2.status === 401, "ni sirve para pedir un token nuevo con otro nombre");
  const again = new Api(baseUrl);
  await again.login(passkey);
  assert((await again.call("POST", "/me/session")).ok, "al volver a entrar, la sesión nueva vale");
});

await scenario("puertas cerradas: un chunk inventado da 404; una denuncia con un id raro o un cuerpo enorme se rechaza", async () => {
  for (const id of ["c_9_9", "c_1000_987654", "x"]) {
    const r = await fetch(new URL(`/chunk/${id}/state`, baseUrl));
    assert(r.status === 404 || r.status === 400, `/chunk/${id}/state debería dar 404 (dio ${r.status})`);
  }
  assert((await fetch(new URL(`/chunk/${PLACES.plaza}/state`, baseUrl))).ok, "la plaza sí existe");
  const guest = new Api(baseUrl, ((await (await fetch(new URL("/auth/guest", baseUrl), { method: "POST" })).json()) as { token: string }).token);
  const weird = await guest.call("POST", "/reports", { target_type: "project", target_id: "p_<script>", reason: "spam" });
  assert(!weird.ok && weird.status === 400, "un target_id con caracteres raros se rechaza");
  const big = await fetch(new URL("/reports", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${guest.token}` },
    body: JSON.stringify({ target_type: "project", target_id: "p_prueba", reason: "spam", details: "x".repeat(200_000) }),
  });
  assert(big.status === 413, `un cuerpo de 200 KB se corta (dio ${big.status})`);
});

await scenario("avisos de moderación: /mod/summary solo para moderación; con webhook, la denuncia llega firmada", async () => {
  const guest = new Api(baseUrl, ((await (await fetch(new URL("/auth/guest", baseUrl), { method: "POST" })).json()) as { token: string }).token);
  const denied = await guest.call("GET", "/mod/summary");
  assert(!denied.ok && (denied.status === 401 || denied.status === 403), "sin moderación, nada");
  if (!adminKey) return console.log("    (sin XENXO_ADMIN_KEY: se omite)");
  const admin = new Api(baseUrl);
  await admin.agentToken(adminKey);
  const sum = await admin.call<{ pending_projects: number; open_reports: number; pending_districts: number; webhook: boolean }>("GET", "/mod/summary");
  assert(sum.ok && [sum.data.pending_projects, sum.data.open_reports, sum.data.pending_districts].every((n) => Number.isInteger(n) && n >= 0), "cuentas de lo pendiente");
  const secret = process.env.XENXO_N8N_SECRET;
  if (!sum.data.webhook || !secret) return console.log("    (sin webhook de prueba: XENXO_N8N_SECRET y el servidor con N8N_WEBHOOK_URL → http://localhost:8799/hook)");
  // Un receptor de prueba: comprueba la firma como lo haría n8n.
  const { createServer } = await import("node:http");
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const got = new Promise<{ body: Record<string, unknown>; ok: boolean }>((resolve) => {
    const srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(req.headers["x-xenxo-signature"] ?? ""));
        const want = m ? createHmac("sha256", secret).update(`${m[1]}.${raw}`).digest("hex") : "";
        const ok = !!m && timingSafeEqual(Buffer.from(want), Buffer.from(m[2]!)) && Math.abs(Date.now() - Number(m[1])) < 300_000;
        res.end("ok");
        srv.close();
        resolve({ body: JSON.parse(raw) as Record<string, unknown>, ok });
      });
    }).listen(8799);
  });
  const r = await guest.call<{ id: number }>("POST", "/reports", { target_type: "project", target_id: "p_aviso", reason: "spam", details: "texto que no debe salir" });
  assert(r.ok, "denuncia");
  const hook = await Promise.race([got, new Promise<null>((res) => setTimeout(() => res(null), 6000))]);
  assert(hook && hook.ok, "llega el aviso con firma válida");
  assert(hook.body.event === "report.open" && hook.body.id === r.data.id && hook.body.reason === "spam", `qué y cuál (${JSON.stringify(hook.body)})`);
  assert(!JSON.stringify(hook.body).includes("texto que no debe salir") && !("reporter" in hook.body), "sin el texto de la denuncia ni quién denuncia");
});

if (agentKey) {
  await scenario("agente: mesh@1 con un hash inexistente → not_found; con uno subido, los triángulos los pone el servidor", async () => {
    const api = new Api(baseUrl);
    await api.agentToken(agentKey);
    const c = await XenxoClient.connect({ baseUrl, agentKey });
    const fake = await c.mutate({
      op: "SPAWN",
      components: { "transform@1": { p: [30, 0, 50] }, "mesh@1": { lods: [{ hash: "sha256:" + "0".repeat(64), media: "model/gltf-binary", tris: 1 }] } },
    });
    assert(fake.type === "ERROR" && fake.payload.code === "not_found", "esperaba not_found");
    const up = await api.upload(await makeBoxGlb({ segments: 2 }), "model");
    assert(up.ok, "el agente debería poder subir");
    const real = await c.mutate({
      op: "SPAWN",
      components: { "transform@1": { p: [30, 0, 50] }, "mesh@1": { lods: [{ hash: up.data.hash, media: "model/gltf-binary", tris: 1 }] } },
    });
    assert(real.type === "ACK", "SPAWN con un asset real");
    await c.mutate({ op: "DESPAWN", entity_id: real.payload.entity_id, base_rev: 1 });
    c.close();
  });
}

/* ------------------------------------------------------------------ */
/* Chat                                                                 */
/* ------------------------------------------------------------------ */

await scenario("chat: un invitado lee pero no escribe", async () => {
  const c = await XenxoClient.connect({ baseUrl });
  const r = await c.chat("hola");
  assert(r.type === "ERROR" && r.payload.code === "forbidden", "un invitado no debería poder escribir");
  c.close();
});

await scenario("chat: lo que escribe una persona registrada llega a todos y queda en el SNAPSHOT", async () => {
  const api = new Api(baseUrl);
  const { user } = await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const listener = await XenxoClient.connect({ baseUrl });
  const me = await XenxoClient.connect({ baseUrl, token: api.token });
  const text = `hola plaza ${randomUUID().slice(0, 6)}`;
  const heard = listener.next("CHAT_MSG", (m) => m.payload.text === text, 4000);
  const sent = await me.chat(`  hola\u0007   plaza ${text.slice(-6)}  `);
  assert(sent.type === "CHAT_MSG" && sent.payload.text === text, `el servidor debería limpiar el texto: ${JSON.stringify(sent.payload)}`);
  const h = await heard;
  assert(h.payload.sender.display_name === user.display_name && h.payload.sender.kind === "user", "remitente incorrecto");
  const late = await XenxoClient.connect({ baseUrl });
  assert(late.snapshot.chat?.some((m) => m.text === text), "quien llega después debería ver el mensaje reciente");
  late.close();
  me.close();
  listener.close();
});

await scenario("chat: límite de 5 mensajes cada 10 s y de 280 caracteres", async () => {
  const api = new Api(baseUrl);
  await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const me = await XenxoClient.connect({ baseUrl, token: api.token });
  const long = await me.chat("a".repeat(281));
  assert(long.type === "ERROR" && long.payload.code === "bad_message", "más de 280 caracteres debería rechazarse");
  let limited = false;
  for (let i = 0; i < 7 && !limited; i++) {
    const r = await me.chat(`mensaje ${i}`);
    if (r.type === "ERROR" && r.payload.code === "rate_limited") limited = true;
  }
  assert(limited, "debería aplicarse el límite de frecuencia");
  me.close();
});

await scenario("chat: denunciar un mensaje guarda una copia y moderación puede retirarlo", async () => {
  const api = new Api(baseUrl);
  await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const me = await XenxoClient.connect({ baseUrl, token: api.token });
  const sent = await me.chat("mensaje para denunciar");
  assert(sent.type === "CHAT_MSG", "envío");
  const guest = new Api(baseUrl, ((await (await fetch(new URL("/auth/guest", baseUrl), { method: "POST" })).json()) as { token: string }).token);
  const rep = await guest.call<{ id: number }>("POST", "/reports", { target_type: "chat", target_id: sent.payload.id, reason: "harassment" });
  assert(rep.ok, "la denuncia de un mensaje debería registrarse");
  if (adminKey) {
    const admin = new Api(baseUrl);
    await admin.agentToken(adminKey);
    const list = await admin.call<{ reports: { id: number; details: string }[] }>("GET", "/admin/reports");
    const mine = list.ok ? list.data.reports.find((r) => r.id === rep.data.id) : undefined;
    assert(mine?.details.includes("mensaje para denunciar"), "la denuncia debería conservar el texto del mensaje");
    const removed = me.next("CHAT_REMOVED", (m) => m.payload.id === sent.payload.id, 4000);
    const hide = await admin.call<{ hidden: boolean }>("POST", `/admin/chat/${sent.payload.id}/hide`);
    assert(hide.ok && hide.data.hidden, "moderación debería poder retirarlo");
    await removed;
  }
  me.close();
});

await scenario("parcela: la clave de agente de un proyecto construye solo dentro de su parcela", async () => {
  const api = new Api(baseUrl);
  await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const parcel = await freeParcel("pixel");
  const cover = await api.upload(makeCoverPng(), "cover");
  const mon = await api.upload(await makeBoxGlb({ segments: 2, color: [Math.random(), Math.random(), Math.random(), 1] }), "monument");
  assert(cover.ok && mon.ok, "subidas");
  const created = await api.call<{ project: { id: string } }>("POST", "/projects", {
    title: "Parcela de prueba", url: "https://github.com/xenxo-dev/xenxo-world", district: "pixel", parcel,
    cover_hash: cover.data.hash, mesh_hash: mon.data.hash,
  });
  assert(created.ok, `publicar: ${JSON.stringify(created)}`);
  const pid = created.data.project.id;

  const stranger = new Api(baseUrl);
  await stranger.register(`conf ${randomUUID().slice(0, 6)}`);
  const notMine = await stranger.call("POST", "/me/agent-keys", { project_id: pid });
  assert(!notMine.ok && notMine.error === "not_found", "nadie más puede crear claves para tu parcela");
  const k = await api.call<{ key: string; info: { id: string } }>("POST", "/me/agent-keys", { project_id: pid, label: "mi agente" });
  assert(k.ok && k.data.key.startsWith("xk_"), `crear clave: ${JSON.stringify(k)}`);

  const auth = await (await fetch(new URL("/auth/agent", baseUrl), { method: "POST", headers: { Authorization: `Bearer ${k.data.key}` } })).json() as {
    principal: { zone: { chunk_id: string; owner: string; x0: number; z0: number; x1: number; z1: number } };
    budgets: { maxEntities: number; maxHeight: number };
  };
  const z = auth.principal.zone;
  assert(z?.chunk_id === "c_-1_0" && z.owner === `prj_${pid}` && z.x1 - z.x0 === 15, `zona: ${JSON.stringify(z)}`);
  // A 1,5 m del lado de la parcela: fuera de lo reservado para el portal (el centro del fondo).
  const cx = z.x0 + 1.5, cz = (z.z0 + z.z1) / 2;
  const box = (p: number[], size = [1, 1, 1]) => ({
    "transform@1": { p, r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
    "primitive@1": { shape: "box", size, color: "#44ccff" },
  });

  const agent = await XenxoClient.connect({ baseUrl, chunkId: "c_-1_0", agentKey: k.data.key });
  const ok1 = await agent.mutate({ op: "SPAWN", components: box([cx, 0.5, cz]) });
  assert(ok1.type === "ACK", `dentro de la parcela: ${JSON.stringify(ok1.payload)}`);
  const eid = (ok1.payload as { entity_id: string }).entity_id;
  const edge = await agent.mutate({ op: "SPAWN", components: box([z.x1 - 0.2, 0.5, cz]) });
  assert(edge.type === "ERROR" && (edge.payload.detail as { reason?: string })?.reason === "out_of_zone", "medio fuera → out_of_zone");
  const tall = await agent.mutate({ op: "SPAWN", components: box([cx, auth.budgets.maxHeight, cz]) });
  assert(tall.type === "ERROR", "por encima de la altura máxima → error");
  const moveOut = await agent.mutate({ op: "PATCH", entity_id: eid, base_rev: 1, components: { "transform@1": { p: [z.x1 + 3, 0.5, cz], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null } } });
  assert(moveOut.type === "ERROR", "moverlo fuera de la parcela → error");
  const moveIn = await agent.mutate({ op: "PATCH", entity_id: eid, base_rev: 1, components: { "transform@1": { p: [cx, 0.5, cz + 2], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null } } });
  assert(moveIn.type === "ACK", "moverlo dentro → ACK");
  const portal = await agent.mutate({ op: "SPAWN", components: box([(z.x0 + z.x1) / 2, 0.5, (z.z0 + z.z1) / 2]) });
  assert(portal.type === "ERROR" && (portal.payload.detail as { reason?: string })?.reason === "portal_area", "delante del portal → portal_area");
  const stand = await agent.mutate({ op: "DESPAWN", entity_id: `stand_${pid}`, base_rev: 1 });
  assert(stand.type === "ERROR" && stand.payload.code === "forbidden", "no puede tocar el portal de su parcela");
  const light = (dx: number) => ({ ...box([cx + dx, 4, cz], [0.2, 0.2, 0.2]), "light@1": { type: "point", color: "#ffffff", intensity: 1, range: 4, when: "always" } });
  assert((await agent.mutate({ op: "SPAWN", components: light(-1) })).type === "ACK", "una luz cabe");
  const light2 = await agent.mutate({ op: "SPAWN", components: light(1) });
  assert(light2.type === "ERROR" && light2.payload.code === "budget_exceeded", "la segunda luz supera el presupuesto de la parcela");

  const watcher = await XenxoClient.connect({ baseUrl, chunkId: "c_-1_0" });
  const mine = watcher.snapshot.entities.find((e) => e.entity_id === eid);
  assert(mine?.owner === `prj_${pid}`, `lo construido es del proyecto, no de la clave (${mine?.owner})`);

  const plaza = await XenxoClient.connect({ baseUrl, chunkId: PLACES.plaza, agentKey: k.data.key });
  const away = await plaza.mutate({ op: "SPAWN", components: box([32, 0.5, 32]) });
  assert(away.type === "ERROR" && away.payload.code === "forbidden", "en otro chunk → forbidden");
  plaza.close();

  const list = await api.call<{ keys: { id: string }[] }>("GET", "/me/agent-keys");
  assert(list.ok && list.data.keys.length === 1, "GET /me/agent-keys");
  const exp = await api.call<{ agent_keys: unknown[] }>("GET", "/me/export");
  assert(exp.ok && exp.data.agent_keys.length === 1 && !JSON.stringify(exp.data).includes(k.data.key), "la exportación lista la clave sin enseñarla");
  const oldToken = ((await (await fetch(new URL("/auth/agent", baseUrl), { method: "POST", headers: { Authorization: `Bearer ${k.data.key}` } })).json()) as { token: string }).token;
  const revoked = await api.call("DELETE", `/me/agent-keys/${k.data.info.id}`);
  assert(revoked.ok, "revocar");
  const back = await XenxoClient.connect({ baseUrl, chunkId: "c_-1_0", token: oldToken }).then(() => true, () => false);
  assert(!back, "con el token de antes de revocar ya no se vuelve a entrar");
  const after = await fetch(new URL("/auth/agent", baseUrl), { method: "POST", headers: { Authorization: `Bearer ${k.data.key}` } });
  await after.arrayBuffer();
  assert(after.status === 401, "una clave revocada ya no entra");
  agent.close();

  // Borrar el proyecto vacía la parcela.
  const removed = watcher.next("DELTA", (m) => m.payload.changes.some((c) => c.kind === "remove" && c.entity_id === eid), 5000);
  assert((await api.call("DELETE", `/projects/${pid}`)).ok, "borrar el proyecto");
  await removed;
  watcher.close();
});

await scenario("Entrar con xenxo: OpenID Connect con PKCE, consentimiento, sub por juego y revocación", async () => {
  const { createHash, randomBytes, webcrypto } = await import("node:crypto");
  const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
  const dev = new Api(baseUrl);
  await dev.register(`conf ${randomUUID().slice(0, 6)}`);
  const badReg = await dev.call("POST", "/me/games", { name: "Malo", redirect_uris: ["http://evil.example/cb"] });
  assert(!badReg.ok && badReg.error === "bad_redirect", "http fuera de localhost → bad_redirect");
  const frag = await dev.call("POST", "/me/games", { name: "Malo", redirect_uris: ["https://juego.example/cb#x"] });
  assert(!frag.ok && frag.error === "bad_redirect", "con fragmento → bad_redirect");
  const cb = "https://juego.example/cb";
  const g = await dev.call<{ client_id: string }>("POST", "/me/games", { name: "Juego de prueba", redirect_uris: [cb] });
  assert(g.ok && g.data.client_id.startsWith("xg_"), `registrar juego: ${JSON.stringify(g)}`);
  const g2 = await dev.call<{ client_id: string }>("POST", "/me/games", { name: "Otro juego", redirect_uris: [cb] });
  assert(g2.ok, "segundo juego");

  const player = new Api(baseUrl);
  await player.register(`conf ${randomUUID().slice(0, 6)}`);
  const me = await player.call<{ display_name: string; player_no: number }>("GET", "/me");
  assert(me.ok, "GET /me");

  const pkce = () => {
    const verifier = b64u(randomBytes(48));
    return { verifier, challenge: b64u(createHash("sha256").update(verifier).digest()) };
  };
  const authorize = async (params: Record<string, string>) => {
    const u = new URL("/oidc/authorize", baseUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await fetch(u, { redirect: "manual" });
    return new URL(r.headers.get("location") ?? "about:blank");
  };
  const flow = async (clientId: string, scope = "openid profile player avatar", approve = true) => {
    const p = pkce();
    const nonce = b64u(randomBytes(12)), state = b64u(randomBytes(12));
    const loc = await authorize({ response_type: "code", client_id: clientId, redirect_uri: cb, scope, state, nonce, code_challenge: p.challenge, code_challenge_method: "S256" });
    const req = loc.searchParams.get("autorizar");
    assert(!!req, `authorize debería llevar a la pantalla de permiso (${loc})`);
    const info = await player.call<{ client: { name: string; host: string }; scopes: string[] }>("GET", `/oidc/request/${req}`);
    assert(info.ok && info.data.client.host === "juego.example", "la pantalla enseña el juego y su dominio");
    const d = await player.call<{ redirect: string }>("POST", `/oidc/request/${req}`, { approve });
    assert(d.ok, `decidir: ${JSON.stringify(d)}`);
    const back = new URL(d.data.redirect);
    assert(back.origin + back.pathname === cb && back.searchParams.get("state") === state && back.searchParams.get("iss") === new URL(baseUrl).origin, "vuelve al juego con su state e iss");
    return { code: back.searchParams.get("code"), error: back.searchParams.get("error"), verifier: p.verifier, nonce };
  };
  const token = (body: Record<string, string>) =>
    fetch(new URL("/oidc/token", baseUrl), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });

  // Lo que no debe pasar: dirección de vuelta ajena, sin PKCE, sin sesión.
  const evil = await authorize({ response_type: "code", client_id: g.data.client_id, redirect_uri: "https://evil.example/cb", scope: "openid", code_challenge: pkce().challenge, code_challenge_method: "S256" });
  assert(evil.searchParams.get("autorizar_error") === "invalid_redirect_uri" && evil.hostname !== "evil.example", "una dirección no registrada nunca recibe la redirección");
  // Un error del juego no redirige solo (xenxo no es trampolín): se enseña en xenxo y se vuelve con un clic.
  const noPkce = await authorize({ response_type: "code", client_id: g.data.client_id, redirect_uri: cb, scope: "openid", state: "s1" });
  const errReq = noPkce.searchParams.get("autorizar");
  assert(noPkce.hostname !== "juego.example" && !!errReq, "sin PKCE → pantalla de xenxo, no redirección directa");
  const errInfo = await new Api(baseUrl).call<{ error: string }>("GET", `/oidc/request/${errReq}`);
  assert(errInfo.ok && errInfo.data.error === "invalid_request", "la pantalla dice invalid_request");
  const errBack = await new Api(baseUrl).call<{ redirect: string }>("POST", `/oidc/request/${errReq}`, { approve: false });
  const eb = errBack.ok ? new URL(errBack.data.redirect) : null;
  assert(eb?.searchParams.get("error") === "invalid_request" && eb.searchParams.get("state") === "s1" && eb.searchParams.get("iss") === new URL(baseUrl).origin, "al pulsar, vuelve al juego con el error, su state e iss");
  const plain = await authorize({ response_type: "code", client_id: g.data.client_id, redirect_uri: cb, scope: "openid", code_challenge: "a".repeat(43), code_challenge_method: "plain" });
  const plainInfo = await new Api(baseUrl).call<{ error: string }>("GET", `/oidc/request/${plain.searchParams.get("autorizar")}`);
  assert(plainInfo.ok && plainInfo.data.error === "invalid_request", "PKCE plain → rechazado");
  const relog = await authorize({ response_type: "code", client_id: g.data.client_id, redirect_uri: cb, scope: "openid", code_challenge: pkce().challenge, code_challenge_method: "S256", prompt: "login" });
  const relogInfo = await new Api(baseUrl).call<{ error: string }>("GET", `/oidc/request/${relog.searchParams.get("autorizar")}`);
  assert(relogInfo.ok && relogInfo.data.error === "invalid_request", "prompt=login no se admite (no se promete lo que no se cumple)");
  const fake = await dev.call("POST", "/me/games", { name: "XENXO oficial", redirect_uris: [cb] });
  assert(!fake.ok && fake.error === "game_name_reserved", "un juego no puede llamarse xenxo");
  const p0 = pkce();
  const loc0 = await authorize({ response_type: "code", client_id: g.data.client_id, redirect_uri: cb, scope: "openid", code_challenge: p0.challenge, code_challenge_method: "S256" });
  const anon = await new Api(baseUrl).call("POST", `/oidc/request/${loc0.searchParams.get("autorizar")}`, { approve: true });
  assert(!anon.ok && anon.status === 401, "sin sesión no se puede dar permiso");

  // Verificador equivocado: falla, y el código queda gastado.
  const f1 = await flow(g.data.client_id);
  const wrong = await token({ grant_type: "authorization_code", code: f1.code!, redirect_uri: cb, client_id: g.data.client_id, code_verifier: pkce().verifier });
  assert(wrong.status === 400 && ((await wrong.json()) as { error: string }).error === "invalid_grant", "PKCE equivocado → invalid_grant");
  const late = await token({ grant_type: "authorization_code", code: f1.code!, redirect_uri: cb, client_id: g.data.client_id, code_verifier: f1.verifier });
  assert(late.status === 400, "un código ya probado no vale ni con el verificador bueno");

  // El bueno.
  const f2 = await flow(g.data.client_id);
  const okRes = await token({ grant_type: "authorization_code", code: f2.code!, redirect_uri: cb, client_id: g.data.client_id, code_verifier: f2.verifier });
  const tok = (await okRes.json()) as { access_token: string; id_token: string; token_type: string };
  assert(okRes.status === 200 && tok.token_type === "Bearer" && okRes.headers.get("cache-control") === "no-store", `token: ${JSON.stringify(tok)}`);
  const again = await token({ grant_type: "authorization_code", code: f2.code!, redirect_uri: cb, client_id: g.data.client_id, code_verifier: f2.verifier });
  assert(again.status === 400, "el código es de un solo uso");

  // La firma: Ed25519 con la clave pública de /.well-known/jwks.json.
  const [h64, b64, s64] = tok.id_token.split(".");
  const header = JSON.parse(Buffer.from(h64!, "base64url").toString()) as { alg: string; kid: string };
  const jwks = (await (await fetch(new URL("/.well-known/jwks.json", baseUrl))).json()) as { keys: (JsonWebKey & { kid: string })[] };
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  assert(header.alg === "EdDSA" && !!jwk, "id_token EdDSA con kid publicado");
  const key = await webcrypto.subtle.importKey("jwk", { kty: jwk!.kty, crv: jwk!.crv, x: jwk!.x }, { name: "Ed25519" }, false, ["verify"]);
  const valid = await webcrypto.subtle.verify({ name: "Ed25519" }, key, Buffer.from(s64!, "base64url"), Buffer.from(`${h64}.${b64}`));
  assert(valid, "la firma del id_token se comprueba con la clave pública");
  const tampered = await webcrypto.subtle.verify({ name: "Ed25519" }, key, Buffer.from(s64!, "base64url"), Buffer.from(`${h64}.${b64}x`));
  assert(!tampered, "un id_token tocado no pasa");
  const claims = JSON.parse(Buffer.from(b64!, "base64url").toString()) as Record<string, unknown> & { avatar: { url: string; format: string } };
  assert(claims.aud === g.data.client_id && claims.iss === new URL(baseUrl).origin && claims.nonce === f2.nonce, "aud, iss y nonce");
  assert(claims.name === me.data.display_name && claims.player_no === me.data.player_no, "nombre y número de jugador");
  assert(typeof claims.avatar?.url === "string" && claims.avatar.format === "vrm", "skin (VRM) con su enlace");
  assert(typeof claims.sub === "string" && !String(claims.sub).includes(String(me.data.player_no)) && !JSON.stringify(claims).includes("usr_"), "sub propio del juego, sin el id interno");
  const vrm = await fetch(claims.avatar.url);
  await vrm.arrayBuffer();
  assert(vrm.ok && vrm.headers.get("access-control-allow-origin") === "*", "la skin se descarga desde cualquier juego");

  assert(claims.picture === undefined, "sin retrato todavía, no hay «picture»");

  const ui = await fetch(new URL("/oidc/userinfo", baseUrl), { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const uiClaims = (await ui.json()) as { sub: string };
  assert(ui.ok && uiClaims.sub === claims.sub, "userinfo con el mismo sub");

  // El retrato (lo hace la web en el navegador): cuadrado, del personaje que lleva, y llega como «picture».
  const st = await player.call<{ avatar_effective: { hash: string }; portrait: unknown }>("GET", "/me");
  assert(st.ok && st.data.portrait === null && st.data.avatar_effective.hash.startsWith("sha256:"), "GET /me dice su personaje y que no tiene retrato");
  assert(!(await player.upload(makeCoverPng(320, 180, [10, 20, 30]), "portrait")).ok, "un retrato tiene que ser cuadrado");
  const pic = await player.upload(makeCoverPng(256, 256, [Math.floor(Math.random() * 255), 140, 220]), "portrait");
  assert(pic.ok, "subir el retrato");
  const stale = await player.call("PUT", "/me/portrait", { hash: pic.data.hash, of: "sha256:" + "0".repeat(64) });
  assert(!stale.ok && (stale as unknown as { error: string }).error === "portrait_stale", "el retrato tiene que ser del personaje que lleva");
  assert((await player.call("PUT", "/me/portrait", { hash: pic.data.hash, of: st.data.avatar_effective.hash })).ok, "guardar el retrato");
  const fp = await flow(g.data.client_id, "openid avatar");
  const tp = (await (await token({ grant_type: "authorization_code", code: fp.code!, redirect_uri: cb, client_id: g.data.client_id, code_verifier: fp.verifier })).json()) as { id_token: string };
  const cp = JSON.parse(Buffer.from(tp.id_token.split(".")[1]!, "base64url").toString()) as { picture?: string };
  assert(typeof cp.picture === "string" && cp.picture.endsWith(pic.data.hash.slice(7)), `«picture» con el retrato: ${JSON.stringify(cp)}`);
  const pr = await fetch(cp.picture!);
  await pr.arrayBuffer();
  assert(pr.ok && pr.headers.get("access-control-allow-origin") === "*", "el retrato se descarga desde cualquier juego");

  // Otro juego ve a la misma persona con otro sub.
  const f3 = await flow(g2.data.client_id, "openid");
  const t3 = (await (await token({ grant_type: "authorization_code", code: f3.code!, redirect_uri: cb, client_id: g2.data.client_id, code_verifier: f3.verifier })).json()) as { id_token: string };
  const c3 = JSON.parse(Buffer.from(t3.id_token.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
  assert(c3.sub !== claims.sub && c3.name === undefined && c3.player_no === undefined, "con solo openid: otro sub y nada más");

  // Decir que no.
  const no = await flow(g.data.client_id, "openid", false);
  assert(no.error === "access_denied" && !no.code, "si dice que no, el juego recibe access_denied");

  // Juegos conectados y retirar el permiso: el token de acceso deja de valer al momento.
  const conn = await player.call<{ connected: { client_id: string }[] }>("GET", "/me/connected");
  assert(conn.ok && conn.data.connected.some((c) => c.client_id === g.data.client_id), "lista de juegos conectados");
  const exp = await player.call<{ connected_games: unknown[] }>("GET", "/me/export");
  assert(exp.ok && exp.data.connected_games.length === 2, "la exportación incluye los juegos conectados");
  assert((await player.call("DELETE", `/me/connected/${g.data.client_id}`)).ok, "retirar permiso");
  const after = await fetch(new URL("/oidc/userinfo", baseUrl), { headers: { Authorization: `Bearer ${tok.access_token}` } });
  await after.arrayBuffer();
  assert(after.status === 401, "tras retirar el permiso, userinfo → 401");
  const otherDev = await player.call("DELETE", `/me/games/${g.data.client_id}`);
  assert(!otherDev.ok, "nadie más puede borrar el juego de otro");
  assert((await dev.call("DELETE", `/me/games/${g.data.client_id}`)).ok && (await dev.call("DELETE", `/me/games/${g2.data.client_id}`)).ok, "su autor sí");
});

await scenario("juegos de fuera: ficha xenxo.json leída por el servidor, enlace /j/, revisión y moderación con motivos", async () => {
  const { createServer } = await import("node:http");
  const errOf = (r: { ok: boolean }) => (r.ok ? null : (r as unknown as { error: string }).error);
  const statusOf = (r: { ok: boolean }) => (r.ok ? 200 : (r as unknown as { status: number }).status);
  // Un «juego de fuera» de pruebas: sirve su xenxo.json (en local el servidor puede leer de localhost).
  let manifest: Record<string, unknown> = {};
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(manifest));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const manifestUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/xenxo.json`;
  try {
    const dev = new Api(baseUrl);
    await dev.register(`conf ${randomUUID().slice(0, 6)}`);
    const model = await dev.upload(await makeBoxGlb({ segments: 2, color: [Math.random(), 0.3, 0.8, 1] }), "model");
    const cover = await dev.upload(makeCoverPng(320, 180, [Math.floor(Math.random() * 255), 30, 160]), "cover");
    assert(model.ok && cover.ok, "subidas");
    const created = await dev.call<{ project: { id: string; review: string } }>("POST", "/projects", {
      title: "Juego de fuera", summary: "", url: "https://juego-de-fuera.example.org/", ...(await freeSpot()), cover_hash: cover.data.hash, mesh_hash: model.data.hash,
    });
    assert(created.ok && created.data.project.review === "pending", "un proyecto nuevo espera revisión");
    const id = created.data.project.id;
    const catalog = async () => ((await (await fetch(new URL("/projects", baseUrl))).json()) as { projects: { id: string }[] }).projects.some((p) => p.id === id);
    assert(!(await catalog()), "sin revisar no sale en el catálogo");

    const base = {
      schema: "xenxo.game/0", name: { es: "Juego de fuera", en: "Outside game" }, description: { es: "Prueba", en: "Test" },
      category: "game3d", devices: ["pc"], multiplayer: false, ageRating: "all", monetization: { hasAds: true, hasPurchases: false },
      author: "Alguien", contact: "https://example.org", privacy: "https://juego-de-fuera.example.org/privacidad",
    };
    const slug = `fuera-${randomUUID().slice(0, 6)}`;
    const register = (body: Record<string, unknown> = {}) => dev.call<{ project: { slug: string; review: string; game: { host: string; embed: boolean; ageRating: string } } }>("POST", `/projects/${id}/game`, { manifest_url: manifestUrl, slug, ...body });

    manifest = { ...base, inventado: 1 };
    const invalid = await register();
    assert(!invalid.ok && invalid.error === "manifest_invalid", "una ficha con campos inventados se rechaza (con sus problemas)");
    manifest = { ...base, privacy: undefined };
    assert(errOf(await register()) === "privacy_required", "sin página de privacidad no se registra");
    manifest = { ...base, xenxo: { project: "otroproyecto" } };
    assert(errOf(await register()) === "manifest_mismatch", "una ficha que dice ser de otro proyecto se rechaza");
    manifest = { ...base, avatar: "none", xenxo: { clientId: "xg_noexiste123" } };
    assert(errOf(await register()) === "avatar_required", "con «Entrar con xenxo», el juego tiene que enseñar quién juega");
    manifest = base;
    assert(errOf(await register({ slug: "admin" })) === "bad_slug", "un enlace reservado no vale");
    manifest = { ...base, avatar: "character" };
    const okReg = await register();
    assert(okReg.ok && (okReg.data.project.game as unknown as { avatar: string }).avatar === "character", "la ficha guarda cómo se ve quien juega");
    assert(okReg.ok && okReg.data.project.slug === slug && okReg.data.project.game.host === "juego-de-fuera.example.org" && okReg.data.project.game.embed, `registrar la ficha: ${JSON.stringify(okReg)}`);
    const other = new Api(baseUrl);
    await other.register(`conf ${randomUUID().slice(0, 6)}`);
    assert(statusOf(await other.call("POST", `/projects/${id}/game`, { manifest_url: manifestUrl })) === 404, "nadie más registra la ficha de tu proyecto");

    const pub = await fetch(new URL(`/games/${slug}`, baseUrl));
    const g = (await pub.json()) as { project: { id: string; review: string; game: { monetization: { hasAds: boolean } } } };
    assert(pub.status === 200 && g.project.id === id && g.project.review === "pending" && g.project.game.monetization.hasAds, "xenxo.io/j/<slug> funciona al momento (como «no revisado»)");
    assert(!("review_note" in g.project), "la nota de revisión no es pública");

    // Moderación: solo moderadores (o la clave de administración).
    assert(statusOf(await dev.call("GET", "/mod/queue")) === 403, "una persona cualquiera no modera");
    const roles = await dev.call<{ moderator: boolean }>("GET", "/me/roles");
    assert(roles.ok && roles.data.moderator === false, "GET /me/roles");
    if (!adminKey) return console.log("    (sin XENXO_ADMIN_KEY: se omite la parte de moderación)");
    const mod = new Api(baseUrl);
    await mod.agentToken(adminKey);
    const queue = await mod.call<{ pending: { id: string }[] }>("GET", "/mod/queue");
    assert(queue.ok && queue.data.pending.some((p) => p.id === id), "el juego está en la cola de revisión");
    assert(errOf(await mod.call("POST", `/mod/projects/${id}/review`, { decision: "rejected" })) === "note_required", "rechazar exige motivo");
    assert((await mod.call("POST", `/mod/projects/${id}/review`, { decision: "rejected", note: "No carga en el móvil" })).ok, "rechazar con motivo");
    assert((await fetch(new URL(`/games/${slug}`, baseUrl))).status === 404, "rechazado, pierde su enlace propio");
    // Aprobado, su portada sale en los anuncios de fachada de Distrito Cero (el más nuevo, el primero).
    const cero = await XenxoClient.connect({ baseUrl, chunkId: "c_-1_-1" });
    const bbTo = (e: { components: Record<string, unknown> }) => (e.components["portal@1"] as { to?: { project_id?: string } } | undefined)?.to?.project_id;
    const shown = cero.next("DELTA", (m) => m.payload.changes.some((c) => c.kind === "upsert" && c.entity.entity_id === "billboard_1" && bbTo(c.entity) === id), 6000);
    assert((await mod.call("POST", `/mod/projects/${id}/review`, { decision: "approved" })).ok, "aprobar");
    assert(await catalog(), "aprobado, sale en el catálogo");
    const bbDelta = await shown;
    const bb = bbDelta.payload.changes.find((c) => c.kind === "upsert" && c.entity.entity_id === "billboard_1");
    cero.close();
    assert(bb?.kind === "upsert" && ((bb.entity.components["transform@1"] as { p: number[] }).p[1] ?? 0) > 12, "su portada sale en un anuncio de fachada de Distrito Cero (alto: no se cruza andando)");
    manifest = { ...base, ageRating: "+14" };
    const changed = await register();
    assert(changed.ok && changed.data.project.review === "pending", "cambiar la ficha la devuelve a revisión");
    assert(!(await catalog()), "y sale del catálogo hasta que se revise");
    const hide = await mod.call("POST", `/mod/projects/${id}/hide`, { note: "Prueba de ocultar: contenido no permitido" });
    assert(hide.ok, "ocultar con motivo");
    assert((await fetch(new URL(`/games/${slug}`, baseUrl))).status === 404, "oculto, su enlace deja de funcionar");
    const mine = await dev.call<{ projects: { id: string; status: string; review_note: string | null }[] }>("GET", "/me");
    const p = mine.ok ? mine.data.projects.find((x) => x.id === id) : undefined;
    assert(p?.status === "hidden" && p.review_note === "Prueba de ocultar: contenido no permitido", "su autor ve que está oculto y por qué");
    const log = await mod.call<{ log: { action: string; target_id: string }[] }>("GET", "/mod/log");
    assert(log.ok && ["review_approved", "hide"].every((a) => log.data.log.some((l) => l.action === a && l.target_id === id)), "cada decisión queda registrada");

    // Equipo de moderación: lo nombra el fundador (o la clave de administración), por número de jugador.
    const card = await dev.call<{ player_no: number | null }>("GET", "/me/card");
    const no = card.ok ? card.data.player_no : null;
    assert(no !== null, "la persona de prueba tiene número de jugador");
    assert(statusOf(await dev.call("PUT", `/mod/moderators/${no}`)) === 403, "nadie se nombra a sí mismo");
    assert((await mod.call("PUT", `/mod/moderators/${no}`)).ok, "nombrar moderación por número");
    const now = await dev.call<{ moderator: boolean; founder: boolean }>("GET", "/me/roles");
    assert(now.ok && now.data.moderator && !now.data.founder, "ya modera (y no es el fundador)");
    assert(statusOf(await dev.call("DELETE", `/mod/moderators/${no}`)) === 403, "moderar no da permiso para nombrar ni retirar");
    const team = await dev.call<{ moderators: { player_no: number | null }[] }>("GET", "/mod/moderators");
    assert(team.ok && team.data.moderators.some((m) => m.player_no === no), "sale en el equipo");
    assert((await mod.call("DELETE", `/mod/moderators/${no}`)).ok, "retirar de moderación");
    assert(statusOf(await dev.call("GET", "/mod/queue")) === 403, "retirada, ya no modera");
    const log2 = await mod.call<{ log: { action: string; target_id: string }[] }>("GET", "/mod/log");
    assert(log2.ok && ["moderator_add", "moderator_remove"].every((a) => log2.data.log.some((l) => l.action === a && l.target_id === `#${no}`)), "nombrar y retirar quedan en el registro");
  } finally {
    server.close();
  }
});

await scenario("jam: convocatoria con fechas, un juego por persona, votos con cuenta (nunca lo propio) y resultados al final", async () => {
  if (!adminKey) return console.log("    (sin XENXO_ADMIN_KEY: se omite: las jams las crea moderación)");
  const { createServer } = await import("node:http");
  const errOf = (r: { ok: boolean }) => (r.ok ? null : (r as unknown as { error: string }).error);
  const server = createServer((req, res) => {
    // Cada juego de prueba sirve su ficha en /<proyecto>/xenxo.json.
    const pid = (req.url ?? "").split("/")[1] ?? "";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      schema: "xenxo.game/0", name: { es: "Juego de jam", en: "Jam game" }, description: { es: "Prueba", en: "Test" },
      category: "game2d", devices: ["pc", "mobile", "vr"], multiplayer: false, ageRating: "all", monetization: { hasAds: false, hasPurchases: false },
      author: "Alguien", contact: "https://example.org", privacy: "https://jam.example.org/privacidad", xenxo: { project: pid },
    }));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  const mod = new Api(baseUrl);
  await mod.agentToken(adminKey);
  const made: { api: Api; id: string }[] = [];
  const project = async (api: Api, game: boolean) => {
    const model = await api.upload(await makeBoxGlb({ segments: 2, color: [Math.random(), 0.6, 0.2, 1] }), "model");
    const cover = await api.upload(makeCoverPng(320, 180, [Math.floor(Math.random() * 255), 90, 40]), "cover");
    assert(model.ok && cover.ok, "subidas");
    const c = await api.call<{ project: { id: string } }>("POST", "/projects", {
      title: "Juego de jam", summary: "", url: "https://jam.example.org/", ...(await freeSpot()), cover_hash: cover.data.hash, mesh_hash: model.data.hash,
    });
    assert(c.ok, `crear proyecto: ${JSON.stringify(c)}`);
    const id = c.data.project.id;
    made.push({ api, id });
    if (game) {
      const reg = await api.call("POST", `/projects/${id}/game`, { manifest_url: `http://127.0.0.1:${port}/${id}/xenxo.json`, slug: `jam-${randomUUID().slice(0, 8)}` });
      assert(reg.ok, `registrar la ficha: ${JSON.stringify(reg)}`);
    }
    assert((await mod.call("POST", `/mod/projects/${id}/review`, { decision: "approved" })).ok, "aprobar");
    return id;
  };
  const slug = `jam-${randomUUID().slice(0, 6)}`;
  try {
    const a = new Api(baseUrl);
    const b = new Api(baseUrl);
    await a.register(`conf ${randomUUID().slice(0, 6)}`);
    const voterB = (await b.register(`conf ${randomUUID().slice(0, 6)}`)).user.id;
    const gameA = await project(a, true);
    const gameA2 = await project(a, true);
    const plainB = await project(b, false);
    const gameB = await project(b, true);

    const now = Date.now();
    assert(errOf(await a.call("POST", "/mod/jams", { slug })) !== null, "una persona cualquiera no crea jams");
    const bad = await mod.call("POST", "/mod/jams", { slug, title: "Jam de prueba", theme: "Bucles", starts_at: now, ends_at: now - 1, voting_ends_at: now + 1 });
    assert(errOf(bad) === "bad_dates", "las fechas tienen que ir en orden");
    const created = await mod.call<{ jam: { phase: string } }>("POST", "/mod/jams", {
      slug, title: { es: "Jam de prueba", en: "Test jam" }, theme: { es: "Bucles", en: "Loops" },
      starts_at: new Date(now - 60_000).toISOString(), ends_at: now + 3_600_000, voting_ends_at: now + 7_200_000,
    });
    assert(created.ok && created.data.jam.phase === "submissions", `crear la jam: ${JSON.stringify(created)}`);
    const list = (await (await fetch(new URL("/jams", baseUrl))).json()) as { jams: { slug: string }[] };
    assert(list.jams.some((j) => j.slug === slug), "GET /jams la lista");

    const enter = (api: Api, id: string) => api.call("POST", `/jams/${slug}/entries`, { project_id: id });
    assert((await enter(a, gameA)).ok, "apuntar un juego propio");
    assert(errOf(await enter(a, gameA2)) === "jam_one_entry", "un juego por persona y jam");
    assert(errOf(await enter(a, gameB)) === "not_found", "no se apunta lo de otro");
    assert(errOf(await enter(b, plainB)) === "jam_needs_game", "sin ficha de juego no se apunta");
    assert((await enter(b, gameB)).ok, "B apunta el suyo");
    assert(errOf(await b.call("PUT", `/jams/${slug}/votes/${gameA}`, { stars: 5 })) === "jam_not_voting", "aún no se vota");

    // Cierra la inscripción: empieza la votación.
    assert((await mod.call("PATCH", `/mod/jams/${slug}`, { ends_at: Date.now() - 1 })).ok, "cerrar la inscripción");
    assert(errOf(await enter(a, gameA2)) === "jam_closed", "cerrada, no se apunta nada");
    assert(errOf(await a.call("PUT", `/jams/${slug}/votes/${gameA}`, { stars: 5 })) === "jam_own_vote", "nunca lo propio");
    assert(errOf(await b.call("PUT", `/jams/${slug}/votes/${gameA}`, { stars: 9 })) === "bad_message", "de 1 a 5 estrellas");
    assert((await b.call("PUT", `/jams/${slug}/votes/${gameA}`, { stars: 3 })).ok, "votar");
    assert((await b.call("PUT", `/jams/${slug}/votes/${gameA}`, { stars: 5 })).ok, "cambiar el voto");
    assert((await a.call("PUT", `/jams/${slug}/votes/${gameB}`, { stars: 2 })).ok, "A vota a B");
    const late = new Api(baseUrl);
    await late.register(`conf ${randomUUID().slice(0, 6)}`);
    assert(errOf(await late.call("PUT", `/jams/${slug}/votes/${gameA}`, { stars: 1 })) === "jam_account_too_new", "una cuenta recién hecha no vota");
    const during = (await (await fetch(new URL(`/jams/${slug}`, baseUrl))).json()) as { jam: { phase: string }; entries: { id: string }[]; results: unknown };
    assert(during.jam.phase === "voting" && during.entries.length === 2 && during.results === null, "mientras se vota no hay resultados");
    const mine = await b.call<{ votes: Record<string, number>; entries: { project_id: string }[]; can_vote: boolean }>("GET", `/jams/${slug}/mine`);
    assert(mine.ok && mine.data.votes[gameA] === 5 && mine.data.entries[0]?.project_id === gameB && mine.data.can_vote, "cada uno ve sus votos y lo suyo");

    // Acaba la votación: resultados.
    assert((await mod.call("PATCH", `/mod/jams/${slug}`, { ends_at: Date.now() - 2, voting_ends_at: Date.now() - 1 })).ok, "cerrar la votación");
    assert(errOf(await b.call("PUT", `/jams/${slug}/votes/${gameA}`, { stars: 1 })) === "jam_not_voting", "acabada, no se vota");
    const end = (await (await fetch(new URL(`/jams/${slug}`, baseUrl))).json()) as { jam: { phase: string }; results: { project_id: string; votes: number; average: number; rank: number }[] };
    const first = end.results[0];
    assert(end.jam.phase === "results" && first?.project_id === gameA && first.votes === 1 && first.average === 5 && first.rank === 1, `resultados: ${JSON.stringify(end)}`);
    assert(!JSON.stringify(end).includes(voterB), "nunca se publica quién votó");

    // Moderación saca un juego: con motivo, que ve su autor, y en el registro.
    assert(errOf(await mod.call("POST", `/mod/jams/${slug}/entries/${gameB}/remove`, {})) === "note_required", "sacar exige motivo");
    assert((await mod.call("POST", `/mod/jams/${slug}/entries/${gameB}/remove`, { note: "No es del tema" })).ok, "sacar con motivo");
    const minB = await b.call<{ entries: { removed_note: string | null }[] }>("GET", `/jams/${slug}/mine`);
    assert(minB.ok && minB.data.entries[0]?.removed_note === "No es del tema", "su autor ve el motivo");
    const exp = await b.call<{ jam_votes: { jam: string; stars: number }[] }>("GET", "/me/export");
    assert(exp.ok && exp.data.jam_votes.some((v) => v.jam === slug && v.stars === 5), "exportar incluye mis votos");
    assert((await mod.call("PATCH", `/mod/jams/${slug}`, { cancelled: true, note: "Prueba" })).ok, "cancelar");
    assert((await fetch(new URL(`/jams/${slug}`, baseUrl))).status === 404, "cancelada, no se ve");
  } finally {
    server.close();
    // Si algo falló a medias, que la jam de prueba no se quede abierta.
    await mod.call("PATCH", `/mod/jams/${slug}`, { cancelled: true });
    // Deja libres las parcelas del Arcade.
    for (const m of made) await m.api.call("DELETE", `/projects/${m.id}`);
  }
});

await scenario("Entrar con xenxo dentro de xenxo: el permiso viaja por postMessage al origen exacto del juego", async () => {
  const { createHash, randomBytes } = await import("node:crypto");
  const { createServer } = await import("node:http");
  const b64u = (b: Buffer) => b.toString("base64url");
  const dev = new Api(baseUrl);
  await dev.register(`conf ${randomUUID().slice(0, 6)}`);
  const cb = "https://juego.example/";
  const g = await dev.call<{ client_id: string }>("POST", "/me/games", { name: "Incrustado", redirect_uris: [cb] });
  const other = await dev.call<{ client_id: string }>("POST", "/me/games", { name: "Otro del mismo dominio", redirect_uris: [cb] });
  assert(g.ok && other.ok, "registrar juegos");
  // Su proyecto con ficha: xenxo.clientId dice cuál es su juego de «Entrar con xenxo».
  const model = await dev.upload(await makeBoxGlb({ segments: 2, color: [0.1, Math.random(), 0.9, 1] }), "model");
  const cover = await dev.upload(makeCoverPng(320, 180, [12, Math.floor(Math.random() * 255), 200]), "cover");
  assert(model.ok && cover.ok, "subidas");
  const pr = await dev.call<{ project: { id: string } }>("POST", "/projects", {
    title: "Incrustado", summary: "", url: cb, district: "pixel", parcel: await freeParcel("pixel"), cover_hash: cover.data.hash, mesh_hash: model.data.hash,
  });
  assert(pr.ok, "proyecto");
  const projectId = pr.data.project.id;
  const manifest = {
    schema: "xenxo.game/0", name: { es: "Incrustado", en: "Embedded" }, description: { es: "x", en: "x" }, category: "game2d", devices: ["pc"],
    multiplayer: false, ageRating: "all", monetization: { hasAds: false, hasPurchases: false }, author: "A", contact: "https://example.org",
    privacy: "https://juego.example/privacidad", xenxo: { clientId: g.data.client_id, project: projectId },
  };
  const server = createServer((_q, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(manifest)));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  try {
    const reg = await dev.call("POST", `/projects/${projectId}/game`, { manifest_url: `http://127.0.0.1:${(server.address() as { port: number }).port}/xenxo.json`, slug: `inc-${randomUUID().slice(0, 6)}` });
    assert(reg.ok, `ficha: ${JSON.stringify(reg)}`);
  } finally {
    server.close();
  }
  const verifier = b64u(randomBytes(48));
  const params = (clientId: string) => ({
    response_type: "code", client_id: clientId, redirect_uri: cb, scope: "openid profile", state: "st1", nonce: "n1",
    code_challenge: b64u(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", project_id: projectId,
  });
  const embedded = (origin: string | null, body: Record<string, string>) =>
    fetch(new URL("/oidc/embedded", baseUrl), { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  assert((await embedded("https://evil.example", params(g.data.client_id))).status === 403, "solo la web de xenxo pide permisos para juegos incrustados");
  assert((await embedded("http://localhost:5173", params(other.data.client_id))).status === 400, "otro juego del mismo dominio no se cuela: solo el de la ficha");
  const r = await embedded("http://localhost:5173", params(g.data.client_id));
  const { request } = (await r.json()) as { request: string };
  assert(r.status === 200 && request?.startsWith("ar_"), "la web de xenxo recibe la petición");
  const player = new Api(baseUrl);
  await player.register(`conf ${randomUUID().slice(0, 6)}`);
  const info = await player.call<{ embedded: boolean; client: { host: string } }>("GET", `/oidc/request/${request}`);
  assert(info.ok && info.data.embedded && info.data.client.host === "juego.example", "la pantalla sabe que es un juego incrustado");
  const d = await player.call<{ redirect?: string; web_message?: { origin: string; params: Record<string, string> } }>("POST", `/oidc/request/${request}`, { approve: true });
  assert(d.ok && !d.data.redirect && d.data.web_message?.origin === "https://juego.example" && !!d.data.web_message.params.code && d.data.web_message.params.state === "st1", `respuesta por postMessage: ${JSON.stringify(d)}`);
  const tok = await fetch(new URL("/oidc/token", baseUrl), {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: d.data.web_message!.params.code!, redirect_uri: cb, client_id: g.data.client_id, code_verifier: verifier }),
  });
  assert(tok.status === 200, "el juego cambia el código por sus tokens");
  // Por la puerta normal (navegación), web_message no se admite.
  const u = new URL("/oidc/authorize", baseUrl);
  const { project_id: _p, ...plain } = params(g.data.client_id);
  for (const [k, v] of Object.entries({ ...plain, response_mode: "web_message" })) u.searchParams.set(k, v);
  const loc = new URL((await fetch(u, { redirect: "manual" })).headers.get("location") ?? "about:blank");
  const bad = await new Api(baseUrl).call<{ error: string }>("GET", `/oidc/request/${loc.searchParams.get("autorizar")}`);
  assert(bad.ok && bad.data.error === "invalid_request", "web_message fuera de xenxo → invalid_request");
  await dev.call("DELETE", `/projects/${projectId}`);
});

await scenario("limpieza: lo subido que nada usa se borra pasados 7 días; lo que se usa, no", async () => {
  if (!adminKey) return console.log("    (sin XENXO_ADMIN_KEY: se omite)");
  const user = new Api(baseUrl);
  await user.register(`conf ${randomUUID().slice(0, 6)}`);
  const color = (): [number, number, number, number] => [Math.random(), Math.random(), Math.random(), 1];
  const worn = await user.upload(await makeBoxGlb({ color: color() }), "avatar");
  const loose = await user.upload(await makeBoxGlb({ segments: 3, color: color() }), "avatar");
  // Portada única: una igual podría ser la de un proyecto que sí existe (y entonces no se toca).
  const cover = await user.upload(makeCoverPng(320, 180, [Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), 77]), "cover");
  assert(worn.ok && loose.ok && cover.ok, "subidas");
  assert((await user.call("POST", "/me/avatar", { hash: worn.data.hash })).ok, "ponerse el primero");
  const admin = new Api(baseUrl);
  await admin.agentToken(adminKey);
  const now = await admin.call<{ marked: number }>("POST", "/admin/cleanup", {});
  assert(now.ok, "POST /admin/cleanup");
  const status = async (hash: string) => {
    const r = await fetch(new URL(`/assets/${hash.slice(7)}`, baseUrl));
    await r.arrayBuffer();
    return r.status;
  };
  assert((await status(loose.data.hash)) === 200, "recién subido, aún no se borra");
  const later = await admin.call<{ marked: number; deleted: number }>("POST", "/admin/cleanup", { now: Date.now() + 8 * 86_400_000 });
  assert(later.ok && later.data.marked >= 2, `debería marcar al menos 2, llegó ${JSON.stringify(later)}`);
  assert((await status(loose.data.hash)) === 404, "el personaje que no usa nadie debería borrarse");
  assert((await status(cover.data.hash)) === 404, "la portada sin proyecto debería borrarse");
  assert((await status(worn.data.hash)) === 200, "el personaje puesto no se toca");
  const guest = new Api(baseUrl);
  const denied = await guest.call("POST", "/admin/cleanup", {});
  assert(!denied.ok && denied.status === 403, "solo moderación puede lanzar la limpieza");
});

console.log(failed ? `\n${failed} escenario(s) fallaron.` : "\nTodo conforme.");
process.exit(failed ? 1 : 0);
