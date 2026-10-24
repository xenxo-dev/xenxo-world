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

const baseUrl = process.env.XENXO_URL ?? "http://localhost:8787";
const agentKey = process.env.XENXO_AGENT_KEY;

let failed = 0;
async function scenario(name: string, fn: () => Promise<void>) {
  try {
    await fn();
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
  assert(c.snapshot.entities.some((e) => e.entity_id === "plaza_tower"), "falta la torre de la plaza");
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
    const r = await c.mutate({ op: "DESPAWN", entity_id: "plaza_tower", base_rev: 1 });
    assert(r.type === "ERROR" && r.payload.code === "forbidden", "esperaba forbidden");
    c.close();
  });
}

console.log(failed ? `\n${failed} escenario(s) fallaron.` : "\nTodo conforme.");
process.exit(failed ? 1 : 0);
