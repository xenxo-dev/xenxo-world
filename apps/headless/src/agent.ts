/**
 * Agente constructor de ejemplo. Lo despierta GitHub Actions (ver .github/workflows/agent-builder.yml).
 *
 *   XENXO_URL=... XENXO_AGENT_KEY=... npm run agent:build
 *
 * v0 es determinista: coloca un bloque en la zona Sandbox con un cartel de fecha.
 * Para darle "cerebro", sustituye `decide()` por una llamada a tu LLM que devuelva
 * una MutationOp; el servidor la validará igual que cualquier otra.
 */
import { CHUNK_SIZE, type MutationOp } from "@xenxo/protocol";
import { XenxoClient } from "./client";

const baseUrl = process.env.XENXO_URL ?? "http://localhost:8787";
const agentKey = process.env.XENXO_AGENT_KEY;
if (!agentKey) {
  console.error("Falta XENXO_AGENT_KEY");
  process.exit(1);
}

const PALETTE = ["#34d399", "#22d3ee", "#a78bfa", "#f472b6", "#fbbf24"];

function decide(existingAgentBlocks: number): MutationOp {
  // Zona Sandbox: banda junto al distrito (lado derecho de la plaza vista desde el spawn).
  const i = existingAgentBlocks;
  const x = CHUNK_SIZE / 2 + 12 + (i % 6) * 1.6;
  const z = CHUNK_SIZE / 2 + 2 + Math.floor(i / 6) * 1.6;
  const h = 0.6 + Math.random() * 1.4;
  return {
    op: "SPAWN",
    components: {
      "transform@1": { p: [x, h / 2, z] },
      "primitive@1": { shape: "box", size: [1.2, h, 1.2], color: PALETTE[i % PALETTE.length]!, emissive: i % 3 === 0 },
      "label@1": { text: new Date().toISOString().slice(0, 16).replace("T", " "), billboard: true, size: 0.3 },
    },
  };
}

const c = await XenxoClient.connect({ baseUrl, agentKey });
const mine = c.snapshot.entities.filter((e) => e.owner === c.welcome.principal.sub).length;
const r = await c.mutate(decide(mine));
if (r.type === "ERROR") {
  console.error(`El servidor rechazó la mutación: ${r.payload.code} — ${r.payload.message}`);
  c.close();
  process.exit(1);
}
console.log(`Construido ${r.payload.entity_id} (rev ${r.payload.rev}). Bloques de este agente: ${mine + 1}`);
c.close();
process.exit(0);
