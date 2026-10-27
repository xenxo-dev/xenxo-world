#!/usr/bin/env node
/**
 * create-xenxo — crea un juego web listo para xenxo.io.
 *
 *   npm create xenxo@latest                 (pregunta carpeta y tipo)
 *   npm create xenxo@latest mi-juego -- --3d
 *   npm create xenxo@latest mi-juego -- --2d --lang en
 *   npm create xenxo@latest mi-juego -- --3d --multi   (con sala multijugador en tu Cloudflare)
 *   npm create xenxo@latest mi-distrito -- --district  (un distrito de la comunidad, con el kit)
 *
 * Sin dependencias: copia la plantilla, pone el nombre y explica los siguientes pasos.
 * Licencia MIT: lo que crees con ella es tuyo.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SDK_VERSION = "^0.3.0";
const KIT_VERSION = "^0.1.0";
const WRANGLER_VERSION = "^4.150.0";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const value = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.match(/^--(lang|plantilla|template)$/));

const T = {
  es: {
    hello: "\n  xenxo · crea tu juego\n",
    folder: "  Carpeta del juego",
    kind: "  ¿2D o 3D? (2d/3d)",
    multi: "  ¿Multijugador, con sala propia en tu Cloudflare gratuito? (s/n)",
    yes: /^(s|si|sí|y|yes)$/i,
    exists: (d) => `\n  La carpeta «${d}» ya existe y no está vacía. Elige otra.\n`,
    badName: "\n  Nombre no válido: usa letras minúsculas, números y guiones (p. ej. mi-juego).\n",
    done: (d, k, m) => `\n  Listo: juego ${k.toUpperCase()}${m ? " multijugador" : ""} en ./${d}\n`,
    nextMulti: "  Multijugador: en otra terminal, npm run sala (la sala en tu equipo). README.md → Multijugador.\n",
    district: (d) =>
      `\n  Listo: distrito en ./${d}\n\n  Siguientes pasos:\n\n    cd ${d}\n    npm install\n    npm run validate\n\n` +
      "  Cambia xenxo-district.json y los modelos (o pídeselo a tu IA: lee AGENTS.md).\n" +
      "  Cuando pase la comprobación, súbelo desde xenxo.io → Cuenta → Tu distrito.\n",
    next: (d) =>
      `  Siguientes pasos:\n\n    cd ${d}\n    npm install\n    npm run dev\n\n` +
      "  Se abre con un jugador de prueba (el simulador de xenxo, abajo a la izquierda).\n" +
      "  Pídele cambios a tu IA: lee AGENTS.md y sabe integrarse con xenxo.\n" +
      "  Para publicarlo y que la gente entre con su cuenta de xenxo: README.md.\n",
  },
  en: {
    hello: "\n  xenxo · create your game\n",
    folder: "  Game folder",
    kind: "  2D or 3D? (2d/3d)",
    multi: "  Multiplayer, with its own room on your free Cloudflare? (y/n)",
    yes: /^(y|yes|s|si|sí)$/i,
    exists: (d) => `\n  Folder "${d}" already exists and isn't empty. Pick another one.\n`,
    badName: "\n  Invalid name: use lowercase letters, numbers and dashes (e.g. my-game).\n",
    done: (d, k, m) => `\n  Done: ${k.toUpperCase()}${m ? " multiplayer" : ""} game in ./${d}\n`,
    nextMulti: "  Multiplayer: in another terminal, npm run sala (the room on your machine). README.md → Multiplayer.\n",
    district: (d) =>
      `\n  Done: district in ./${d}\n\n  Next steps:\n\n    cd ${d}\n    npm install\n    npm run validate\n\n` +
      "  Edit xenxo-district.json and the models (or ask your AI: it reads AGENTS.md).\n" +
      "  Once it passes, upload it from xenxo.io → Account → Your district.\n",
    next: (d) =>
      `  Next steps:\n\n    cd ${d}\n    npm install\n    npm run dev\n\n` +
      "  It opens with a test player (the xenxo simulator, bottom left).\n" +
      "  Ask your AI for changes: it reads AGENTS.md and knows how to work with xenxo.\n" +
      "  To publish it so people sign in with their xenxo account: README.md.\n",
  },
};

const lang = value("--lang") === "en" || (!value("--lang") && /^en/i.test(process.env.LANG ?? "")) ? "en" : "es";
const t = T[lang];

async function ask(rl, question, fallback) {
  if (!rl) return fallback;
  const a = (await rl.question(`${question} (${fallback}): `)).trim();
  return a || fallback;
}

async function main() {
  console.log(t.hello);
  const interactive = process.stdin.isTTY && !flag("--yes") && !flag("--sí");
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    if (flag("--district") || flag("--distrito")) return await district(rl);
    let dir = positional[0] ?? (await ask(rl, t.folder, lang === "en" ? "my-xenxo-game" : "mi-juego-xenxo"));
    let kind = flag("--2d") ? "2d" : flag("--3d") ? "3d" : value("--plantilla") ?? value("--template");
    if (kind !== "2d" && kind !== "3d") kind = (await ask(rl, t.kind, "3d")).toLowerCase() === "2d" ? "2d" : "3d";
    const multi = flag("--multi") || flag("--multijugador") || (!flag("--solo") && rl ? t.yes.test(await ask(rl, t.multi, "n")) : false);

    const target = resolve(process.cwd(), dir);
    const name = basename(target).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) {
      console.error(t.badName);
      process.exit(1);
    }
    if (existsSync(target) && readdirSync(target).length > 0) {
      console.error(t.exists(dir));
      process.exit(1);
    }

    mkdirSync(target, { recursive: true });
    cpSync(join(here, "templates", "common"), target, { recursive: true });
    cpSync(join(here, "templates", kind), target, { recursive: true });
    if (multi) {
      // La sala: servidor en sala/, cliente real en src/multijugador.js y su parte de README y AGENTS.
      cpSync(join(here, "templates", "sala"), target, { recursive: true });
      for (const doc of ["README", "AGENTS"]) {
        const extra = join(target, `${doc}.append.md`);
        const base = readFileSync(join(target, `${doc}.md`), "utf8");
        const add = readFileSync(extra, "utf8");
        // Antes de la licencia, si la hay; si no, al final.
        const at = base.lastIndexOf("\n## Licencia");
        writeFileSync(join(target, `${doc}.md`), at >= 0 ? `${base.slice(0, at)}${add}${base.slice(at)}` : base + add);
        rmSync(extra);
      }
      const pkgPath = join(target, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      pkg.scripts.sala = "wrangler dev --config sala/wrangler.toml --port 8788";
      pkg.scripts["deploy:sala"] = "wrangler deploy --config sala/wrangler.toml";
      pkg.devDependencies = { ...pkg.devDependencies, wrangler: WRANGLER_VERSION };
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      const fichaPath = join(target, "public", "xenxo.json");
      writeFileSync(fichaPath, readFileSync(fichaPath, "utf8").replace('"multiplayer": false', '"multiplayer": true'));
    }
    // npm quita los .gitignore al publicar: la plantilla lo lleva como _gitignore.
    if (existsSync(join(target, "_gitignore"))) renameSync(join(target, "_gitignore"), join(target, ".gitignore"));

    const title = name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
    const vars = {
      "{{name}}": name,
      "{{title}}": title,
      "{{kind}}": kind.toUpperCase(),
      "{{category}}": kind === "2d" ? "game2d" : "game3d",
      // 3D: se juega con el personaje de xenxo; 2D: se ven su retrato, su nombre y su número.
      "{{avatar}}": kind === "2d" ? "badge" : "character",
      "{{sdkVersion}}": SDK_VERSION,
      "{{year}}": String(new Date().getFullYear()),
    };
    const walk = (d) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(json|md|html|js|ts|css|txt|toml)$/.test(f) || f === ".gitignore") {
          let s = readFileSync(p, "utf8");
          for (const [k, v] of Object.entries(vars)) s = s.split(k).join(v);
          writeFileSync(p, s);
        }
      }
    };
    walk(target);

    const shown = relative(process.cwd(), target) || ".";
    console.log(t.done(shown, kind, multi));
    console.log(t.next(shown));
    if (multi) console.log(t.nextMulti);
  } finally {
    rl?.close();
  }
}

/** Un distrito de la comunidad: la ficha, modelos de ejemplo, AGENTS.md y el kit para comprobarlo. */
async function district(rl) {
  const dir = positional[0] ?? (await ask(rl, t.folder, lang === "en" ? "my-district" : "mi-distrito"));
  const target = resolve(process.cwd(), dir);
  const name = basename(target).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) {
    console.error(t.badName);
    process.exit(1);
  }
  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(t.exists(dir));
    process.exit(1);
  }
  mkdirSync(target, { recursive: true });
  cpSync(join(here, "templates", "district"), target, { recursive: true });
  if (existsSync(join(target, "_gitignore"))) renameSync(join(target, "_gitignore"), join(target, ".gitignore"));
  // El nombre corto del distrito: 3–24 caracteres, empieza por letra y sin «xenxo».
  let slug = name.replace(/xenxo/g, "").replace(/^[^a-z]+/, "").replace(/-+/g, "-").slice(0, 24).replace(/-$/, "");
  if (slug.length < 3) slug = "mi-distrito";
  const title = (name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())).slice(0, 40);
  const vars = {
    "{{name}}": name,
    "{{slug}}": slug,
    "{{title}}": title,
    "{{author}}": lang === "en" ? "Your name" : "Tu nombre",
    "{{contact}}": lang === "en" ? "you@example.com" : "tu@ejemplo.com",
    "{{kitVersion}}": KIT_VERSION,
  };
  for (const f of ["xenxo-district.json", "AGENTS.md", "README.md", "package.json"]) {
    const p = join(target, f);
    let s = readFileSync(p, "utf8");
    for (const [k, v] of Object.entries(vars)) s = s.split(k).join(v);
    writeFileSync(p, s);
  }
  console.log(t.district(relative(process.cwd(), target) || "."));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
