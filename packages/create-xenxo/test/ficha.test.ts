/**
 * La comprobación de la plantilla (templates/common/scripts/comprobar.mjs, sin dependencias) tiene que
 * decir lo mismo que `GameManifest` del protocolo, más las dos reglas del registro de la ficha
 * (`avatar_required` y, como aviso, `privacy`). Si cambias el esquema y esto falla, cambia también el
 * script de la plantilla.
 *
 *   npm test -w create-xenxo
 *
 * (Solo en el repositorio: no se publica en npm. Importa el protocolo, que también es MIT.)
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GameManifest } from "../../protocol/src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "templates", "common", "scripts", "comprobar.mjs");
const work = mkdtempSync(join(tmpdir(), "xenxo-ficha-"));
mkdirSync(join(work, "scripts"));
mkdirSync(join(work, "public"));
cpSync(script, join(work, "scripts", "comprobar.mjs"));
writeFileSync(join(work, "public", "privacidad.html"), "<!doctype html>");

/** La ficha tal como la deja create-xenxo (3D, en español). */
const base = JSON.parse(
  readFileSync(join(here, "..", "templates", "common", "public", "xenxo.json"), "utf8")
    .replaceAll("{{title}}", "Mi juego")
    .replaceAll("{{name}}", "mi-juego")
    .replaceAll("{{category}}", "game3d")
    .replaceAll("{{avatar}}", "character")
    .replaceAll("{{author}}", "Tu nombre")
    .replaceAll("{{contact}}", "https://github.com/tu-usuario"),
) as Record<string, unknown>;

type Case = [label: string, manifest: unknown, extraRuleFails?: boolean];
const cid = { clientId: "xg_abcdef123", project: "prj_abcd" };
const cases: Case[] = [
  ["plantilla", base],
  ["con clientId y project", { ...base, xenxo: cid }],
  ["2D badge", { ...base, category: "game2d", avatar: "badge" }],
  ["sin avatar", (({ avatar: _a, ...m }) => m)(base)],
  ["otro idioma", { ...base, name: { es: "Hola", en: "Hello", ca: "Hola" } }],
  ["idioma de 3 letras", { ...base, name: { es: "Hola", en: "Hello", cat: "Hola" } }],
  ["sin en", { ...base, name: { es: "Hola" } }],
  ["nombre largo", { ...base, name: { es: "x".repeat(61), en: "y" } }],
  ["nombre en blanco", { ...base, name: { es: "   ", en: "y" } }],
  ["campo inventado", { ...base, pegi: 7 }],
  ["schema", { ...base, schema: "xenxo.game/1" }],
  ["categoría", { ...base, category: "juego" }],
  ["sin equipos", { ...base, devices: [] }],
  ["equipo raro", { ...base, devices: ["pc", "tv"] }],
  ["cuatro equipos", { ...base, devices: ["pc", "mobile", "vr", "pc"] }],
  ["multiplayer texto", { ...base, multiplayer: "no" }],
  ["edad", { ...base, ageRating: "13+" }],
  ["monetización extra", { ...base, monetization: { hasAds: false, hasPurchases: false, crypto: true } }],
  ["sin autor", (({ author: _a, ...m }) => m)(base)],
  ["contacto corto", { ...base, contact: "ab" }],
  ["privacy ruta", { ...base, privacy: "/privacidad.html" }],
  ["privacy http", { ...base, privacy: "http://mi-juego.pages.dev/privacidad.html" }],
  ["sin privacy", (({ privacy: _p, ...m }) => m)(base)],
  ["thumbnail https", { ...base, thumbnail: "https://example.org/p.webp" }],
  ["thumbnail relativa", { ...base, thumbnail: "portada.webp" }],
  ["embed texto", { ...base, embed: "sí" }],
  ["clientId con guion", { ...base, xenxo: { clientId: "xg_abc-def123" } }],
  ["project con puntos", { ...base, xenxo: { project: "…" } }],
  ["xenxo con extra", { ...base, xenxo: { ...cid, secret: "x" } }],
  ["avatar none sin clientId", { ...base, avatar: "none" }],
  ["avatar none con clientId", { ...base, avatar: "none", xenxo: cid }, true],
  ["array", []],
];

let failed = 0;
for (const [label, manifest, extraRuleFails] of cases) {
  writeFileSync(join(work, "public", "xenxo.json"), JSON.stringify(manifest, null, 2));
  let ours: boolean;
  try {
    execFileSync(process.execPath, [join(work, "scripts", "comprobar.mjs"), "--json"], { stdio: "pipe" });
    ours = true;
  } catch {
    ours = false;
  }
  const expected = GameManifest.safeParse(manifest).success && !extraRuleFails;
  const ok = ours === expected;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}: plantilla ${ours ? "vale" : "no vale"}, protocolo ${expected ? "vale" : "no vale"}`);
}

// JSON mal escrito: dice línea y columna.
writeFileSync(join(work, "public", "xenxo.json"), '{\n  "schema": "xenxo.game/0",\n}\n');
try {
  execFileSync(process.execPath, [join(work, "scripts", "comprobar.mjs"), "--lang", "es"], { stdio: "pipe" });
  failed++;
  console.log("✗ JSON roto: debería fallar");
} catch (e) {
  const out = String((e as { stdout?: Buffer }).stdout ?? "");
  const ok = /línea 3, columna 1/.test(out);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} JSON roto: ${out.split("\n").find((l) => l.includes("✗")) ?? out}`);
}

rmSync(work, { recursive: true, force: true });
if (failed) {
  console.error(`\n${failed} diferencia(s) entre comprobar.mjs y GameManifest`);
  process.exit(1);
}
console.log("\ncomprobar.mjs y GameManifest dicen lo mismo");
