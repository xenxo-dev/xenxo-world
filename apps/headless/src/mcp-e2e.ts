/**
 * Prueba de punta a punta del servidor MCP contra un servidor de xenxo (local por defecto):
 * crea una cuenta y un proyecto, saca una clave de parcela y usa cada herramienta como lo haría
 * un agente. `npm run mcp-e2e -w @xenxo/headless` (con el servidor MCP ya compilado).
 */
import { copyFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { makeBoxGlb, makeCoverPng } from "./fixtures";
import { Api } from "./http";

const baseUrl = process.env.XENXO_URL ?? "http://localhost:8787";
const api = new Api(baseUrl);
await api.register(`mcp ${randomUUID().slice(0, 6)}`);
const districts = (await (await fetch(new URL("/districts", baseUrl))).json()) as { districts: { id: string; parcels: { id: string; project_id: string | null }[] }[] };
const d = districts.districts.find((x) => x.id === "taller")!;
const parcel = d.parcels.find((p) => !p.project_id)!.id;
const cover = await api.upload(makeCoverPng(), "cover");
const mon = await api.upload(await makeBoxGlb({ segments: 2, color: [Math.random(), Math.random(), Math.random(), 1] }), "monument");
if (!cover.ok || !mon.ok) throw new Error("subidas");
const p = await api.call<{ project: { id: string } }>("POST", "/projects", {
  title: "Taller MCP", url: "https://github.com/xenxo-dev/xenxo-world", district: "taller", parcel, cover_hash: cover.data.hash, mesh_hash: mon.data.hash,
});
if (!p.ok) throw new Error(JSON.stringify(p));
const k = await api.call<{ key: string }>("POST", "/me/agent-keys", { project_id: p.data.project.id, label: "e2e" });
if (!k.ok) throw new Error(JSON.stringify(k));

const dir = await mkdtemp(join(tmpdir(), "xenxo-mcp-"));
const glb = join(dir, "caja.glb");
await writeFile(glb, await makeBoxGlb({ segments: 4, height: 2, color: [0.9, 0.4, 0.1, 1] }));

// El archivo único, copiado fuera del repo: así se prueba como lo descarga la gente (sin node_modules).
const bundle = join(dir, "xenxo-mcp.mjs");
await copyFile(resolve(import.meta.dirname, "../../../packages/mcp/dist/xenxo-mcp.mjs"), bundle);
const client = new Client({ name: "e2e", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: [bundle],
    cwd: dir,
    env: { ...process.env, XENXO_KEY: k.data.key, XENXO_URL: baseUrl } as Record<string, string>,
  }),
);
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("herramientas:", tools.join(", "));
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const text = r.content.map((c) => c.text).join("\n");
  console.log(`${r.isError ? "✗" : "✓"} ${name}: ${text.slice(0, 160).replace(/\s+/g, " ")}`);
  return { ok: !r.isError, data: r.isError ? null : JSON.parse(text) };
};
let failures = 0;
const expect = (cond: boolean, what: string) => {
  if (!cond) {
    failures++;
    console.log(`   ✗ ${what}`);
  }
};
expect((await call("get_parcel")).ok, "get_parcel");
const floor = await call("place_shape", { size: [6, 0.1, 4], position: [4, 0, 3], color: "#334455" });
expect(floor.ok, "suelo");
const label = await call("place_label", { text: "Taller de prueba", position: [5, 2.5, 3], style: "neon", color: "#ffd54f" });
expect(label.ok, "rótulo");
expect(!(await call("place_shape", { size: [2, 2, 2], position: [9.5, 0, 2], color: "#ff0000" })).ok, "fuera de la parcela → error explicado");
const up = await call("upload_model", { path: glb });
console.log("   size:", JSON.stringify(up.data?.size));
expect(up.ok, "subir modelo");
if (up.data) expect((await call("place_model", { model: up.data.model, lods: up.data.lods.slice(1).map((l: { hash: string }) => l.hash), position: [8, 0, 2], yaw: 45 })).ok, "colocar modelo");
expect((await call("update_piece", { id: floor.data?.placed, position: [4.5, 0, 3], color: "#556677" })).ok, "mover y pintar");
const state = await call("get_parcel");
expect(state.data?.pieces.length === 4, `4 piezas (suelo, rótulo, modelo y su colisionador) (hay ${state.data?.pieces.length})`);
expect((await call("remove_pieces", { all: true })).ok, "quitar todo");
expect((await call("get_parcel")).data?.pieces.length === 0, "parcela vacía");
await client.close();
await api.call("DELETE", `/projects/${p.data.project.id}`);
console.log(failures ? `\n${failures} fallo(s).` : "\nMCP conforme.");
process.exit(failures ? 1 : 0);
