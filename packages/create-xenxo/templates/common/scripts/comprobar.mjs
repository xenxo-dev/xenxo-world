#!/usr/bin/env node
/**
 * npm run check — comprueba public/xenxo.json (la ficha del juego, esquema xenxo.game/0) en tu equipo,
 * con las mismas reglas que aplicará xenxo al leerla. Sin dependencias.
 *
 *   node scripts/comprobar.mjs [--lang es|en] [--json]
 *
 * Problemas (✗): xenxo rechazaría la ficha; sale con código 1. Avisos (!): vale, pero revísalo.
 * Las reglas son las de `GameManifest` (packages/protocol de xenxo-world) y las del registro de la
 * ficha (`privacy` obligatoria, `avatar` con «Entrar con xenxo»). Licencia MIT.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const langArg = args[args.indexOf("--lang") + 1];
const lang = args.includes("--lang") ? (langArg === "en" ? "en" : "es") : /^en/i.test(process.env.LANG ?? "") ? "en" : "es";
const asJson = args.includes("--json");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "public/xenxo.json";

const T = {
  es: {
    title: "\n  Ficha del juego (public/xenxo.json)\n",
    missing: "no existe: la plantilla la trae en public/xenxo.json",
    badJson: (l, c) => (l ? `no es JSON válido: falla en la línea ${l}, columna ${c} (¿una coma de más o una comilla sin cerrar?)` : "no es JSON válido"),
    notObject: "tiene que ser un objeto { … }",
    unknown: (k) => `campo desconocido «${k}»: xenxo rechaza la ficha entera (no inventes campos)`,
    required: "falta (es obligatorio)",
    schema: 'tiene que ser "xenxo.game/0"',
    text: (max) => `{ "es": "…", "en": "…" } (los dos obligatorios, como mucho ${max} caracteres; otros idiomas con código de 2 letras)`,
    oneOf: (v) => `tiene que ser uno de: ${v.join(", ")}`,
    devices: 'lista de 1 a 3 de "pc", "mobile", "vr"',
    bool: "true o false",
    str: (min, max) => `texto de ${min} a ${max} caracteres`,
    https: "una dirección https://… (como mucho 300 caracteres)",
    thumb: 'una ruta de tu web ("/portada.webp") o https://…',
    clientId: "el client_id que da xenxo: xg_ y de 6 a 30 letras, números o _",
    project: "el id del proyecto en xenxo: de 4 a 40 letras, números, _ o -",
    avatarNone: 'con «Entrar con xenxo» (xenxo.clientId), "avatar" tiene que ser "character" o "badge" (xenxo lo rechaza: avatar_required)',
    noPrivacy: "falta: xenxo la exige al registrar la ficha del juego (privacy_required). La plantilla trae public/privacidad.html",
    placeholder: (v) => `«${v}» es el de la plantilla: pon el tuyo`,
    defaultDesc: "es la descripción de la plantilla: cuenta de qué va tu juego",
    privacyFile: "apunta a privacidad.html pero public/privacidad.html no existe",
    privacyHost: (u) => `apunta a ${u}: comprueba que es la dirección que te dio wrangler al publicar (puede no ser <nombre>.pages.dev)`,
    thumbFile: (p) => `no existe public${p}`,
    ok: "  ✓ La ficha vale.\n",
    bad: (n) => `  ✗ ${n} problema(s): corrígelos y vuelve a pasar npm run check.\n`,
    warn: "  ! Avisos:",
  },
  en: {
    title: "\n  Game card (public/xenxo.json)\n",
    missing: "does not exist: the template ships it as public/xenxo.json",
    badJson: (l, c) => (l ? `is not valid JSON: it breaks at line ${l}, column ${c} (an extra comma or an unclosed quote?)` : "is not valid JSON"),
    notObject: "must be an object { … }",
    unknown: (k) => `unknown field "${k}": xenxo rejects the whole card (don't invent fields)`,
    required: "is missing (it is required)",
    schema: 'must be "xenxo.game/0"',
    text: (max) => `{ "es": "…", "en": "…" } (both required, at most ${max} characters; other languages with a 2-letter code)`,
    oneOf: (v) => `must be one of: ${v.join(", ")}`,
    devices: 'a list of 1 to 3 of "pc", "mobile", "vr"',
    bool: "true or false",
    str: (min, max) => `text of ${min} to ${max} characters`,
    https: "an https://… address (at most 300 characters)",
    thumb: 'a path on your site ("/cover.webp") or https://…',
    clientId: "the client_id xenxo gives you: xg_ and 6 to 30 letters, digits or _",
    project: "your xenxo project id: 4 to 40 letters, digits, _ or -",
    avatarNone: 'with "Sign in with xenxo" (xenxo.clientId), "avatar" must be "character" or "badge" (xenxo rejects it: avatar_required)',
    noPrivacy: "is missing: xenxo requires it to register the game card (privacy_required). The template ships public/privacidad.html",
    placeholder: (v) => `"${v}" comes from the template: put yours`,
    defaultDesc: "is the template's description: say what your game is about",
    privacyFile: "points to privacidad.html but public/privacidad.html does not exist",
    privacyHost: (u) => `points to ${u}: check it is the address wrangler printed when you deployed (it may not be <name>.pages.dev)`,
    thumbFile: (p) => `public${p} does not exist`,
    ok: "  ✓ The card is valid.\n",
    bad: (n) => `  ✗ ${n} problem(s): fix them and run npm run check again.\n`,
    warn: "  ! Warnings:",
  },
}[lang];

const problems = [];
const warnings = [];
const bad = (at, message) => problems.push({ at, message });
const warn = (at, message) => warnings.push({ at, message });

const KEYS = ["schema", "name", "description", "category", "devices", "multiplayer", "avatar", "ageRating", "monetization", "author", "contact", "privacy", "thumbnail", "embed", "xenxo"];
const CATEGORIES = ["game3d", "game2d", "social", "tool", "other"];
const PLACEHOLDERS = ["Tu nombre", "Your name", "https://github.com/tu-usuario", "https://github.com/your-user"];
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v, min, max) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;

function text(at, v, max) {
  const okKeys = isObj(v) && Object.keys(v).every((k) => /^[a-z]{2}$/.test(k));
  if (!okKeys || !isStr(v.es, 1, max) || !isStr(v.en, 1, max) || !Object.values(v).every((s) => isStr(s, 1, max))) bad(at, T.text(max));
}

function check(m) {
  if (!isObj(m)) return bad(FILE, T.notObject);
  for (const k of Object.keys(m)) if (!KEYS.includes(k)) bad(k, T.unknown(k));
  const need = (k) => (m[k] === undefined ? (bad(k, T.required), false) : true);

  if (need("schema") && m.schema !== "xenxo.game/0") bad("schema", T.schema);
  if (need("name")) text("name", m.name, 60);
  if (need("description")) text("description", m.description, 280);
  if (need("category") && !CATEGORIES.includes(m.category)) bad("category", T.oneOf(CATEGORIES));
  if (need("devices") && (!Array.isArray(m.devices) || m.devices.length < 1 || m.devices.length > 3 || !m.devices.every((d) => ["pc", "mobile", "vr"].includes(d)))) bad("devices", T.devices);
  if (need("multiplayer") && typeof m.multiplayer !== "boolean") bad("multiplayer", T.bool);
  if (m.avatar !== undefined && !["character", "badge", "none"].includes(m.avatar)) bad("avatar", T.oneOf(["character", "badge", "none"]));
  if (need("ageRating") && !["all", "+14"].includes(m.ageRating)) bad("ageRating", T.oneOf(["all", "+14"]));
  if (need("monetization")) {
    const mo = m.monetization;
    if (!isObj(mo) || typeof mo.hasAds !== "boolean" || typeof mo.hasPurchases !== "boolean" || Object.keys(mo).some((k) => k !== "hasAds" && k !== "hasPurchases")) {
      bad("monetization", '{ "hasAds": true|false, "hasPurchases": true|false }');
    }
  }
  if (need("author") && !isStr(m.author, 1, 60)) bad("author", T.str(1, 60));
  if (need("contact") && !isStr(m.contact, 3, 200)) bad("contact", T.str(3, 200));
  if (m.privacy !== undefined && !(typeof m.privacy === "string" && m.privacy.length <= 300 && /^https:\/\/[^\s]+$/.test(m.privacy))) bad("privacy", T.https);
  if (m.thumbnail !== undefined && !(typeof m.thumbnail === "string" && m.thumbnail.length <= 300 && /^(\/[^\s]*|https:\/\/[^\s]+)$/.test(m.thumbnail))) bad("thumbnail", T.thumb);
  if (m.embed !== undefined && typeof m.embed !== "boolean") bad("embed", T.bool);
  if (m.xenxo !== undefined) {
    const x = m.xenxo;
    if (!isObj(x)) bad("xenxo", T.notObject);
    else {
      for (const k of Object.keys(x)) if (k !== "clientId" && k !== "project") bad(`xenxo.${k}`, T.unknown(k));
      if (x.clientId !== undefined && !(typeof x.clientId === "string" && /^xg_[A-Za-z0-9_]{6,30}$/.test(x.clientId))) bad("xenxo.clientId", T.clientId);
      if (x.project !== undefined && !(typeof x.project === "string" && /^[A-Za-z0-9_-]{4,40}$/.test(x.project))) bad("xenxo.project", T.project);
    }
  }

  // Lo que comprueba xenxo al registrar la ficha (no el esquema): «avatar» con «Entrar con xenxo» y «privacy».
  if (isObj(m.xenxo) && m.xenxo.clientId && m.avatar === "none") bad("avatar", T.avatarNone);
  if (m.privacy === undefined) warn("privacy", T.noPrivacy);

  // Lo que se queda como en la plantilla.
  for (const k of ["author", "contact"]) if (PLACEHOLDERS.includes(m[k])) warn(k, T.placeholder(m[k]));
  if (isObj(m.description) && /plantilla de xenxo|xenxo template/.test(`${m.description.es} ${m.description.en}`)) warn("description", T.defaultDesc);
  if (typeof m.privacy === "string" && /^https:\/\/[^\s]+$/.test(m.privacy) && URL.canParse(m.privacy)) {
    if (/\/privacidad\.html$/.test(m.privacy) && !existsSync(join(root, "public", "privacidad.html"))) bad("privacy", T.privacyFile);
    else if (/\.pages\.dev\//.test(m.privacy)) warn("privacy", T.privacyHost(new URL(m.privacy).origin));
  }
  if (typeof m.thumbnail === "string" && m.thumbnail.startsWith("/") && !existsSync(join(root, "public", m.thumbnail))) bad("thumbnail", T.thumbFile(m.thumbnail));
}

/** Línea y columna (desde 1) de un error de JSON.parse, si el motor lo dice. */
function where(src, e) {
  const lc = /line (\d+) column (\d+)/i.exec(e.message);
  if (lc) return [Number(lc[1]), Number(lc[2])];
  const pos = /position (\d+)/i.exec(e.message);
  if (!pos) return [0, 0];
  const before = src.slice(0, Number(pos[1])).split("\n");
  return [before.length, before[before.length - 1].length + 1];
}

const path = join(root, FILE);
if (!existsSync(path)) bad(FILE, T.missing);
else {
  const src = readFileSync(path, "utf8");
  let m;
  try {
    m = JSON.parse(src);
  } catch (e) {
    bad(FILE, T.badJson(...where(src, e)));
  }
  if (m !== undefined) check(m);
}

if (asJson) {
  console.log(JSON.stringify({ ok: problems.length === 0, problems, warnings }, null, 2));
} else {
  console.log(T.title);
  for (const p of problems) console.log(`  ✗ ${p.at}: ${p.message}`);
  if (warnings.length) {
    console.log(T.warn);
    for (const w of warnings) console.log(`    ${w.at}: ${w.message}`);
  }
  console.log(problems.length ? `\n${T.bad(problems.length)}` : `\n${T.ok}`);
}
process.exit(problems.length ? 1 : 0);
