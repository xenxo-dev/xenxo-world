/**
 * Banco de conformidad del protocolo v0.
 *
 *   XENXO_URL=http://localhost:8787 XENXO_AGENT_KEY=... npm run conformance
 *
 * Sale con código 1 si algún escenario falla. Es la red de seguridad para que
 * cualquier cambio (tuyo o de una IA) no rompa el contrato.
 */
import { randomUUID } from "node:crypto";
import { XenxoClient } from "./client";
import { makeBoxGlb, makeVrmMannequin, withExternalImage } from "./fixtures";
import { Api } from "./http";

const baseUrl = process.env.XENXO_URL ?? "http://localhost:8787";
const agentKey = process.env.XENXO_AGENT_KEY;
const adminKey = process.env.XENXO_ADMIN_KEY;

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
  assert(c.snapshot.entities.some((e) => e.entity_id === "fountain_basin"), "falta la fuente de la plaza");
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

await scenario("el alta exige 14 años y aceptar las condiciones vigentes", async () => {
  const api = new Api(baseUrl);
  const noAge = await api.call("POST", "/auth/passkey/register/options", { display_name: "Menor", age_confirmed: false, accept_terms: "2026-10" });
  assert(!noAge.ok && noAge.error === "age_required", "debería exigir la edad");
  const noTerms = await api.call("POST", "/auth/passkey/register/options", { display_name: "Alguien", age_confirmed: true });
  assert(!noTerms.ok && noTerms.error === "terms_required", "debería exigir las condiciones");
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

await scenario("proyecto: crea su stand en la plaza y al borrarlo desaparece", async () => {
  const api = new Api(baseUrl);
  await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const model = await api.upload(await makeBoxGlb({ segments: 3 }), "model");
  assert(model.ok, "subida del modelo");
  const watcher = await XenxoClient.connect({ baseUrl });
  const delta = watcher.next("DELTA", (m) => m.payload.changes.some((c) => c.kind === "upsert" && c.entity.entity_id.startsWith("standm_")), 4000);
  const created = await api.call<{ project: { id: string; in_world: boolean } }>("POST", "/projects", {
    title: "Proyecto de prueba",
    summary: "Creado por el banco de conformidad",
    url: "https://github.com/xenxo-dev/xenxo-world",
    mesh_hash: model.data.hash,
  });
  assert(created.ok && created.data.project.in_world, `el proyecto debería tener stand: ${JSON.stringify(created)}`);
  const d = await delta;
  const meshEntity = d.payload.changes.find((c) => c.kind === "upsert" && c.entity.entity_id.startsWith("standm_"));
  const lods = meshEntity && meshEntity.kind === "upsert" ? (meshEntity.entity.components["mesh@1"] as { lods: { tris: number }[] }).lods : [];
  assert(lods[0]?.tris === 108, `los triángulos deberían venir medidos por el servidor (108), llegaron ${lods[0]?.tris}`);
  const id = created.data.project.id;
  const removed = watcher.next("DELTA", (m) => m.payload.changes.some((c) => c.kind === "remove" && c.entity_id === `stand_${id}`), 4000);
  const del = await api.call("DELETE", `/projects/${id}`);
  assert(del.ok, "borrar el proyecto");
  await removed;
  watcher.close();
});

await scenario("RGPD: exportar mis datos y borrar la cuenta retira su contenido", async () => {
  const api = new Api(baseUrl);
  const { passkey } = await api.register(`conf ${randomUUID().slice(0, 6)}`);
  const model = await api.upload(await makeBoxGlb({ segments: 2, color: [0.1, 0.6, 0.3, 1] }), "model");
  assert(model.ok, "subida");
  const created = await api.call<{ project: { id: string } }>("POST", "/projects", { title: "Para borrar", summary: "", mesh_hash: model.data.hash });
  assert(created.ok, "proyecto");
  const exp = await api.call<{ user: { id: string }; projects: unknown[] }>("GET", "/me/export");
  assert(exp.ok && exp.data.projects.length === 1, "la exportación debería incluir el proyecto");
  const gone = await api.call("DELETE", "/me");
  assert(gone.ok, "borrar la cuenta");
  const asset = await fetch(new URL(`/assets/${model.data.hash.slice(7)}`, baseUrl));
  assert(asset.status === 404, "el modelo que solo subió esa persona debería borrarse");
  let loginFailed = false;
  try {
    await new Api(baseUrl).login(passkey);
  } catch {
    loginFailed = true;
  }
  assert(loginFailed, "la passkey de una cuenta borrada no debería servir");
  const c = await XenxoClient.connect({ baseUrl });
  assert(!c.snapshot.entities.some((e) => e.entity_id === `stand_${created.data.project.id}`), "el stand debería haber desaparecido");
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
