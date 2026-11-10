#!/usr/bin/env node
// Restaura una copia hecha con backup.mjs en un xenxo (el mismo u otro recién desplegado).
// SUSTITUYE lo que haya: las cuentas, los proyectos y lo construido quedan como en la copia.
//
//   XENXO_URL=https://api.tudominio  XENXO_BACKUP_KEY=<clave con el permiso «restore»>  \
//   XENXO_BACKUP_PASSPHRASE=…  node tools/backup/restore.mjs <carpeta de la copia> --confirm api.tudominio
//
// Las claves privadas no van en la copia: la de «Entrar con xenxo» se crea sola (los juegos la leen
// solos y reconocen a la gente igual) y, si hay nodos, hay que darles la clave pública nueva
// (docs/guia → Operar).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { api, apiJson, fail, readSealed, requireConfig, URL_BASE } from "./lib.mjs";

requireConfig();
const [dir, flag, host] = process.argv.slice(2);
if (!dir || !existsSync(join(dir, "manifest.json"))) fail("uso: restore.mjs <carpeta de la copia> --confirm <dominio de la API>");
if (flag !== "--confirm" || host !== new URL(URL_BASE).host) fail(`para restaurar en ${new URL(URL_BASE).host} añade: --confirm ${new URL(URL_BASE).host}`);

const man = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const ext = man.encrypted ? ".enc" : "";
const assets = join(dirname(dirname(dir)), "assets");
console.log(`xenxo-restore: copia del ${man.at} (${man.rows} filas, ${man.chunks.length} lugares) → ${URL_BASE}`);

// 1. Los archivos primero: lo demás los nombra por su hash.
let up = 0, had = 0;
if (existsSync(assets)) {
  for (const f of readdirSync(assets).filter((n) => /^[0-9a-f]{64}$/.test(n))) {
    const head = await api(`/assets/${f}/meta`);
    if (head.ok) {
      had++;
      continue;
    }
    const meta = JSON.parse(readFileSync(join(assets, `${f}.json`), "utf8"));
    const r = await api(`/admin/restore/asset/${f}`, {
      method: "PUT",
      headers: { "Content-Type": meta.contentType || "application/octet-stream", "X-Asset-Meta": encodeURIComponent(JSON.stringify(meta.customMetadata ?? {})) },
      body: readFileSync(join(assets, f)),
    });
    if (!r.ok) fail(`no se pudo subir el archivo ${f}: HTTP ${r.status} ${await r.text()}`);
    up++;
  }
}
console.log(`xenxo-restore: archivos: ${up} subidos, ${had} ya estaban`);

// 2. El Directory, tabla a tabla (la primera página vacía la tabla).
for (const t of man.tables) {
  const file = join(dir, "directory", `${t.table}.jsonl${ext}`);
  if (!existsSync(file)) continue;
  const rows = readSealed(file).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let first = true, i = 0;
  do {
    const page = [];
    let size = 0;
    while (i < rows.length && page.length < 300 && size < 600_000) {
      size += JSON.stringify(rows[i]).length;
      page.push(rows[i++]);
    }
    await apiJson(`/admin/restore/directory/${t.table}${first ? "?truncate=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: page }) });
    first = false;
  } while (i < rows.length);
  console.log(`  ${t.table}: ${rows.length} filas`);
}

// 3. Cada lugar.
for (const id of man.chunks) {
  const file = join(dir, "chunks", `${id}.json${ext}`);
  if (!existsSync(file)) continue;
  await apiJson(`/admin/restore/chunk/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: readSealed(file) });
  console.log(`  ${id}: restaurado`);
}
// 4. Lo que el mundo saca de las cuentas (escaparate del nexo, máquinas, anuncios, puertas de la
//    comunidad) y lo que moderación tenía cerrado.
const end = await apiJson("/admin/restore/finish", { method: "POST" });
console.log(`xenxo-restore: hecho.${end.failed?.length ? ` Lugares que no contestaron: ${end.failed.join(", ")}.` : ""} Si tenías nodos, dales la clave pública nueva (GET /nodes/key).`);
