#!/usr/bin/env node
/**
 * Añade a xenxo un gesto grabado desde un vídeo (el estudio de gestos de la web: Crear → «Gestos desde
 * un vídeo», que descarga un .vrma con su ficha dentro). Por código, como todo lo del juego:
 *
 *   npm run gesture:add -- ~/Descargas/saludo_militar.vrma            (añadirlo)
 *   npm run gesture:add -- ~/Descargas/saludo_militar.vrma --replace  (cambiar uno que ya está)
 *   npm run gesture:add -- ~/Descargas/saludo_militar.vrma --check    (solo comprobarlo)
 *
 * Comprueba el archivo (un VRM Animation con su humanoide, un clip, su ficha de gesto, lo que dura y lo
 * que pesa) y que el nombre no lo use ya otro gesto o clip; después lo copia a apps/web/public/anims/,
 * lo apunta en apps/web/src/world/people/captured-gestures.json (de ahí lo toman la rueda de acciones y
 * el animador) y pone su nombre en los dos idiomas en apps/web/src/i18n.ts. Luego: `npm run typecheck`,
 * probarlo en el mundo y subirlo como cualquier cambio.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ANIMS = join(ROOT, "apps/web/public/anims");
const LIST = join(ROOT, "apps/web/src/world/people/captured-gestures.json");
const I18N = join(ROOT, "apps/web/src/i18n.ts");
const ANIMATION = join(ROOT, "apps/web/src/world/animation.ts");
const PROTOCOL = join(ROOT, "packages/protocol/src/index.ts");
const MARK = "// Gestos grabados desde un vídeo";

/** El mismo nombre que acepta el estudio (capture/files.ts → GESTURE_ID) y que cabe en `emote` (`^[a-z_]{1,24}$`). */
const ID = /^[a-z][a-z_]{0,23}$/;
/** Lo que el juego trata aparte por su nombre (el parkour). */
const RESERVED = /^pk_/;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SECONDS = 20;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const replace = args.includes("--replace");
const check = args.includes("--check");
if (!file) {
  console.error("Uso: npm run gesture:add -- <gesto.vrma> [--replace] [--check]");
  process.exit(2);
}
const fail = (why) => {
  console.error(`✗ ${why}`);
  process.exit(1);
};

/* El archivo ---------------------------------------------------------- */
const bytes = readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), file));
if (bytes.length > MAX_BYTES) fail(`pesa ${(bytes.length / 1048576).toFixed(1)} MB (como mucho ${MAX_BYTES / 1048576} MB)`);
if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(16) !== 0x4e4f534a) fail("no es un glTF binario (.vrma)");
const jsonLen = bytes.readUInt32LE(12);
let json;
try {
  json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString("utf8"));
} catch {
  fail("su JSON no se lee");
}
const ext = json.extensions?.VRMC_vrm_animation;
if (!ext?.humanoid?.humanBones?.hips) fail("no es un VRM Animation (sin VRMC_vrm_animation o sin cadera)");
if ((json.extensionsRequired ?? []).length) fail(`pide extensiones (${json.extensionsRequired.join(", ")})`);
if (json.images?.length || json.buffers?.some((b) => b.uri)) fail("trae imágenes o datos de fuera");
if (json.animations?.length !== 1) fail("tiene que traer un solo clip");
const meta = json.asset?.extras?.["xenxo:gesto"];
if (!meta) fail("no trae su ficha de gesto (se descarga del estudio de gestos de xenxo)");
const id = String(meta.id ?? "");
if (!ID.test(id) || RESERVED.test(id)) fail(`el nombre «${id}» no vale (a-z y _, empezando por una letra, hasta 24, y sin «pk_» delante)`);
const text = (s) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "");
const es = text(meta.es), en = text(meta.en);
if (!es || !en || es.length > 40 || en.length > 40) fail("le faltan sus nombres en español y en inglés (hasta 40 letras cada uno)");
// Lo que dura: lo más que llegue el tiempo de sus fotogramas.
let seconds = 0;
for (const s of json.animations[0].samplers ?? []) {
  const acc = json.accessors?.[s.input];
  if (acc?.max?.[0] > seconds) seconds = acc.max[0];
}
if (!(seconds > 0.2) || seconds > MAX_SECONDS) fail(`dura ${seconds.toFixed(2)} s (de 0,2 a ${MAX_SECONDS} s)`);

/* El nombre, libre ---------------------------------------------------- */
const list = JSON.parse(readFileSync(LIST, "utf8"));
const mine = list.find((g) => g.id === id);
if (mine && !replace) fail(`ya hay un gesto «${id}» (con --replace, se cambia)`);
if (!mine) {
  if (existsSync(join(ANIMS, `${id}.vrma`))) fail(`ya hay un clip con ese nombre (apps/web/public/anims/${id}.vrma)`);
  const clips = [...readFileSync(ANIMATION, "utf8").matchAll(/^\s{2}(\w+): \{ clip:/gm)].map((m) => m[1]);
  if (clips.includes(id)) fail(`ya hay un gesto del juego con ese nombre (world/animation.ts)`);
  const protocol = readFileSync(PROTOCOL, "utf8");
  const emotes = protocol.slice(protocol.indexOf("export const EMOTES"), protocol.indexOf("] as const", protocol.indexOf("export const EMOTES")));
  if (new RegExp(`"${id}"`).test(emotes)) fail(`ya lo usa el protocolo (EMOTES en packages/protocol)`);
}

const entry = { id, once: !!meta.once, upper: !!meta.upper, overlay: !!meta.overlay, fingers: !!meta.fingers, seconds: Math.round(seconds * 100) / 100 };
console.log(`✓ ${id}: «${es}» / «${en}», ${entry.seconds} s, ${entry.once ? "una vez" : "en bucle"}${entry.overlay ? ", de cintura para arriba" : entry.upper ? ", sigue al andar" : ""}${entry.fingers ? ", con sus dedos" : ""}`);
if (check) process.exit(0);

/* Añadirlo ------------------------------------------------------------ */
copyFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), file), join(ANIMS, `${id}.vrma`));
const next = mine ? list.map((g) => (g.id === id ? entry : g)) : [...list, entry];
writeFileSync(LIST, JSON.stringify(next, null, 2) + "\n");

// Sus nombres: en cada idioma, al final de los de la marca (o en su sitio, si ya estaba).
let src = readFileSync(I18N, "utf8");
const quote = (s) => JSON.stringify(s);
const put = (from, value) => {
  const key = `  "emote.${id}": `;
  const at = src.indexOf(MARK, from);
  if (at < 0) fail("no encuentro dónde van los nombres en i18n.ts");
  const lineEnd = src.indexOf("\n", at) + 1;
  // Si ya está (con --replace), se cambia ahí.
  const blockEnd = (() => {
    let i = lineEnd;
    while (src.startsWith('  "emote.', i)) i = src.indexOf("\n", i) + 1;
    return i;
  })();
  const block = src.slice(lineEnd, blockEnd);
  const line = `${key}${quote(value)},\n`;
  const old = block.split("\n").find((l) => l.startsWith(key));
  const newBlock = old ? block.replace(`${old}\n`, line) : block + line;
  src = src.slice(0, lineEnd) + newBlock + src.slice(blockEnd);
  return lineEnd + newBlock.length;
};
const afterEs = put(0, es);
put(afterEs, en);
writeFileSync(I18N, src);

console.log(`  → apps/web/public/anims/${id}.vrma`);
console.log("  → apps/web/src/world/people/captured-gestures.json");
console.log("  → apps/web/src/i18n.ts (emote." + id + ")");
console.log("Después: npm run typecheck, probarlo en el mundo (rueda de acciones → Gestos) y subirlo.");
