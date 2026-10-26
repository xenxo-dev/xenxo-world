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
async function freeParcel(district = "frontera"): Promise<string> {
  const r = await fetch(new URL("/districts", baseUrl));
  const { districts } = (await r.json()) as { districts: { id: string; parcels: { id: string; project_id: string | null }[] }[] };
  const q = districts.find((d) => d.id === district)?.parcels.find((p) => !p.project_id);
  if (!q) throw new Error(`no quedan parcelas libres en ${district}`);
  return q.id;
}

let failed = 0;
async function scenario(name: string, fn: () => Promise<void>) {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout de 15 s")), 15_000)),
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
  for (const id of ["nexo_gate_arcade", "nexo_monument_arcade", "nexo_island_arcade", "nexo_mini_arcade_spires", "nexo_island_plaza"]) {
    assert(c.snapshot.entities.some((e) => e.entity_id === id), `falta ${id} (puerta, emblema e isla del distrito)`);
  }
  assert(c.snapshot.entities.some((e) => e.entity_id.startsWith("nexo_mini_plaza_")), "la isla de la plaza lleva la plaza en pequeño");
  assert(!c.snapshot.entities.some((e) => e.entity_id.startsWith("show_") || e.entity_id.startsWith("nexo_frame_")), "en el nexo solo hay distritos");
  for (const id of ["nexo_arch_arcade", "nexo_bridge_arcade", "nexo_table_arcade", "nexo_sign_desc_arcade"]) {
    assert(c.snapshot.entities.some((e) => e.entity_id === id), `falta ${id} (arco, pasarela, maqueta y rótulo del distrito)`);
  }
  const archP = (c.snapshot.entities.find((e) => e.entity_id === "nexo_arch_arcade")?.components["transform@1"] as { p: number[] }).p;
  const portalP = (c.snapshot.entities.find((e) => e.entity_id === "nexo_portal_arcade")?.components["transform@1"] as { p: number[] }).p;
  assert(Math.hypot(portalP[0]! - 32, portalP[2]! - 32) > Math.hypot(archP[0]! - 32, archP[2]! - 32) + 20, "la puerta del distrito está en su isla, al otro lado de la pasarela");
  const walk = c.welcome.walk;
  assert(c.welcome.solo === true && !!walk && walk[0] < 0 && walk[1] > 64, "el nexo se recorre en solitario y más allá del chunk");
  c.close();
  const d = await XenxoClient.connect({ baseUrl, chunkId: "c_1_0" });
  const gate = d.snapshot.entities.find((e) => e.entity_id === "arcade_gate_portal")?.components["portal@1"] as { to: { chunk_id?: string } } | undefined;
  assert(gate?.to.chunk_id === PLACES.nexo, "la puerta del distrito debería llevar al nexo");
  assert(d.snapshot.entities.some((e) => e.entity_id === "arcade_parcel_A1"), "faltan los números de parcela del distrito");
  d.close();
  const p = await XenxoClient.connect({ baseUrl });
  const back = p.snapshot.entities.find((e) => e.entity_id === "gate_portal")?.components["portal@1"] as { to: { chunk_id?: string } } | undefined;
  assert(back?.to.chunk_id === PLACES.nexo, "el arco de la plaza debería llevar al nexo");
  p.close();
});

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
  const parcel = await freeParcel("frontera");
  const base = { title: "Proyecto de prueba", summary: "Creado por el banco de conformidad", url: "https://github.com/xenxo-dev/xenxo-world", district: "frontera", parcel };
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

  const district = await XenxoClient.connect({ baseUrl, chunkId: "c_1_-1" });
  const nexo = await XenxoClient.connect({ baseUrl, chunkId: PLACES.nexo });
  const delta = district.next("DELTA", (m) => m.payload.changes.some((c) => c.kind === "upsert" && c.entity.entity_id.startsWith("standm_")), 4000);
  const created = await api.call<{ project: { id: string; in_world: boolean; category: string; district: string; parcel: string; review: string } }>("POST", "/projects", full);
  assert(created.ok && created.data.project.in_world, `el proyecto debería tener portal: ${JSON.stringify(created)}`);
  assert(created.data.project.category === "other" && created.data.project.parcel === parcel, "categoría del distrito y parcela elegida");
  const d = await delta;
  const id = created.data.project.id;
  const up = (eid: string) => d.payload.changes.find((c) => c.kind === "upsert" && c.entity.entity_id === eid);
  const portal = up(`stand_${id}`);
  const pc = portal && portal.kind === "upsert" ? (portal.entity.components["portal@1"] as { to: { kind: string; project_id: string }; cover: string }) : null;
  assert(pc?.to.kind === "project" && pc.to.project_id === id && pc.cover === cover.data.hash, "el portal de la parcela lleva a la ficha con su portada");
  assert(!!up(`standf_${id}`), "la parcela recibe su marco");
  const meshEntity = up(`standm_${id}`);
  const lods = meshEntity && meshEntity.kind === "upsert" ? (meshEntity.entity.components["mesh@1"] as { lods: { tris: number }[] }).lods : [];
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
    district: "frontera",
    parcel: await freeParcel("frontera"),
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
  const c = await XenxoClient.connect({ baseUrl, chunkId: "c_1_-1" });
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
  assert(z?.chunk_id === "c_-1_0" && z.owner === `prj_${pid}` && z.x1 - z.x0 === 10, `zona: ${JSON.stringify(z)}`);
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
      title: "Juego de fuera", summary: "", url: "https://juego-de-fuera.example.org/", district: "arcade",
      parcel: await freeParcel("arcade"), cover_hash: cover.data.hash, mesh_hash: model.data.hash,
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
    assert((await mod.call("POST", `/mod/projects/${id}/review`, { decision: "approved" })).ok, "aprobar");
    assert(await catalog(), "aprobado, sale en el catálogo");
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
      title: "Juego de jam", summary: "", url: "https://jam.example.org/", district: "arcade",
      parcel: await freeParcel("arcade"), cover_hash: cover.data.hash, mesh_hash: model.data.hash,
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
