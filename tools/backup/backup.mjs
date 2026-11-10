#!/usr/bin/env node
// Copia propia de xenxo: las cuentas, los proyectos y lo demás del Directory, lo que la gente ha
// construido en cada lugar y los archivos que ha subido (modelos y portadas). Pensado para un
// equipo tuyo (el NAS, el servidor de distritos) con un temporizador diario.
//
//   XENXO_BACKUP_KEY=…  XENXO_BACKUP_PASSPHRASE=…  XENXO_BACKUP_DIR=/mnt/nas/xenxo  node tools/backup/backup.mjs
//
// Qué guarda y cómo, en tools/backup/README.md. Las claves privadas de xenxo (la de «Entrar con
// xenxo» y la de los nodos) NO se copian: el servidor no las entrega (apps/realtime/src/ops.ts).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { api, apiJson, fail, PLAIN, requireConfig, URL_BASE, writeSealed } from "./lib.mjs";

requireConfig();
const DIR = process.env.XENXO_BACKUP_DIR || fail("falta XENXO_BACKUP_DIR (la carpeta de las copias)");
const KEEP = Math.max(1, Number(process.env.XENXO_BACKUP_KEEP || 30));
const ext = PLAIN ? "" : ".enc";

const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
const snaps = join(DIR, "snapshots");
const tmp = join(snaps, `.${stamp}.tmp`);
const assets = join(DIR, "assets");
mkdirSync(join(tmp, "directory"), { recursive: true });
mkdirSync(join(tmp, "chunks"), { recursive: true });
mkdirSync(assets, { recursive: true });

const man = await apiJson("/admin/backup");
console.log(`xenxo-backup: ${URL_BASE} → ${DIR} (${man.directory.length} tablas, ${man.chunks.length} lugares)`);

// 1. El Directory, tabla a tabla y por páginas (una línea JSON por fila).
const hashes = new Set();
let rowsTotal = 0;
for (const t of man.directory) {
  const lines = [];
  let after = 0;
  for (;;) {
    const page = await apiJson(`/admin/backup/directory/${t.table}?after=${after}&limit=400`);
    for (const row of page.rows) {
      lines.push(JSON.stringify(row));
      // Todo lo que parezca el hash de un archivo subido se apunta para copiarlo después.
      for (const v of Object.values(row)) if (typeof v === "string") for (const m of v.matchAll(/\b(?:sha256:)?([0-9a-f]{64})\b/g)) hashes.add(m[1]);
    }
    if (page.next == null) break;
    after = page.next;
  }
  writeSealed(join(tmp, "directory", `${t.table}.jsonl${ext}`), lines.join("\n") + (lines.length ? "\n" : ""));
  rowsTotal += lines.length;
}

// 2. Cada lugar: lo que ha puesto la gente (portales, lo construido, actividades y chat).
let chunksOk = 0;
const chunkErrors = [];
for (const id of man.chunks) {
  try {
    const dump = await apiJson(`/admin/backup/chunk/${encodeURIComponent(id)}`);
    const text = JSON.stringify(dump);
    for (const m of text.matchAll(/\b(?:sha256:)?([0-9a-f]{64})\b/g)) hashes.add(m[1]);
    writeSealed(join(tmp, "chunks", `${id}.json${ext}`), text);
    chunksOk++;
  } catch (e) {
    chunkErrors.push(`${id}: ${e.message}`);
  }
}

// 3. Los archivos subidos, por su hash (lo que ya está copiado no se vuelve a bajar). Son públicos
//    (cualquiera los puede pedir por su hash), así que van sin cifrar.
//    En las tablas hay otros hashes que no son archivos (los de las claves de agente, por ejemplo):
//    se recuerdan una semana en assets/.no-son-archivos.json para no preguntar por ellos cada día.
const notFile = join(assets, ".no-son-archivos.json");
const skip = existsSync(notFile) ? JSON.parse(readFileSync(notFile, "utf8")) : {};
const week = 7 * 86_400_000;
let fetched = 0, kept = 0, missing = 0, bytes = 0;
for (const h of hashes) {
  const file = join(assets, h);
  if (existsSync(file) && existsSync(`${file}.json`)) {
    kept++;
    continue;
  }
  if (skip[h] && Date.now() - skip[h] < week) {
    missing++;
    continue;
  }
  const meta = await api(`/assets/${h}/meta`);
  const r = meta.ok ? await api(`/assets/${h}`) : null;
  if (!r?.ok) {
    skip[h] = Date.now(); // un hash que no es de un archivo (o que ya se borró)
    missing++;
    continue;
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (createHash("sha256").update(buf).digest("hex") !== h) fail(`el archivo ${h} no coincide con su hash: copia interrumpida`);
  writeFileSync(`${file}.part`, buf);
  renameSync(`${file}.part`, file);
  writeFileSync(`${file}.json`, JSON.stringify({ contentType: r.headers.get("content-type"), ...(await meta.json()) }));
  fetched++;
  bytes += buf.length;
}

for (const h of Object.keys(skip)) if (Date.now() - skip[h] >= week) delete skip[h];
writeFileSync(notFile, JSON.stringify(skip));

writeFileSync(
  join(tmp, "manifest.json"),
  JSON.stringify({ version: 1, at: new Date().toISOString(), from: URL_BASE, encrypted: !PLAIN, tables: man.directory, rows: rowsTotal, chunks: man.chunks, chunkErrors, assets: [...hashes].length - missing }, null, 1),
);
renameSync(tmp, join(snaps, stamp));

// 4. Solo se guardan las últimas copias (los archivos subidos se quedan todos: van por hash).
const all = readdirSync(snaps).filter((n) => !n.startsWith(".") && statSync(join(snaps, n)).isDirectory()).sort();
for (const old of all.slice(0, Math.max(0, all.length - KEEP))) rmSync(join(snaps, old), { recursive: true, force: true });

console.log(
  `xenxo-backup: hecha ${stamp} — ${rowsTotal} filas, ${chunksOk}/${man.chunks.length} lugares, archivos: ${fetched} nuevos (${(bytes / 1e6).toFixed(1)} MB), ${kept} ya copiados` +
    (PLAIN ? " — SIN CIFRAR" : " — cifrada"),
);
if (chunkErrors.length) {
  console.error(`xenxo-backup: lugares que no se pudieron copiar:\n  ${chunkErrors.join("\n  ")}`);
  process.exit(2);
}
