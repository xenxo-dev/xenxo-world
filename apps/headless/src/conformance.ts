/**
 * Banco de conformidad del protocolo v0.
 *
 *   XENXO_URL=http://localhost:8787 XENXO_AGENT_KEY=... npm run conformance
 *
 * Sale con código 1 si algún escenario falla. Es la red de seguridad para que
 * cualquier cambio (tuyo o de una IA) no rompa el contrato.
 */
import { randomUUID } from "node:crypto";
import { AVATAR_PRESETS } from "../../realtime/src/avatar-presets";
import { msg, PLACES } from "@xenxo/protocol";
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
  const shown = nexo.next("DELTA", (m) => m.payload.changes.some((c) => c.kind === "upsert" && c.entity.entity_id.startsWith("show_")), 6000);
  const created = await api.call<{ project: { id: string; in_world: boolean; category: string; district: string; parcel: string } }>("POST", "/projects", full);
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
  const s = await shown;
  const show = s.payload.changes.find((c) => c.kind === "upsert" && c.entity.entity_id === `show_${id}`);
  const sc = show && show.kind === "upsert" ? (show.entity.components["portal@1"] as { to: { chunk_id?: string } }) : null;
  assert(sc?.to.chunk_id === "c_1_-1", "el escaparate del nexo lleva al distrito del proyecto");

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

console.log(failed ? `\n${failed} escenario(s) fallaron.` : "\nTodo conforme.");
process.exit(failed ? 1 : 0);
