#!/usr/bin/env node
/**
 * create-xenxo — crea un juego web listo para xenxo.io.
 *
 *   npm create xenxo@latest                 (pregunta carpeta y tipo)
 *   npm create xenxo@latest mi-juego -- --3d
 *   npm create xenxo@latest mi-juego -- --2d --lang en
 *
 * Sin dependencias: copia la plantilla, pone el nombre y explica los siguientes pasos.
 * Licencia MIT: lo que crees con ella es tuyo.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SDK_VERSION = "^0.2.0";

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
    exists: (d) => `\n  La carpeta «${d}» ya existe y no está vacía. Elige otra.\n`,
    badName: "\n  Nombre no válido: usa letras minúsculas, números y guiones (p. ej. mi-juego).\n",
    done: (d, k) => `\n  Listo: juego ${k.toUpperCase()} en ./${d}\n`,
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
    exists: (d) => `\n  Folder "${d}" already exists and isn't empty. Pick another one.\n`,
    badName: "\n  Invalid name: use lowercase letters, numbers and dashes (e.g. my-game).\n",
    done: (d, k) => `\n  Done: ${k.toUpperCase()} game in ./${d}\n`,
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
    let dir = positional[0] ?? (await ask(rl, t.folder, lang === "en" ? "my-xenxo-game" : "mi-juego-xenxo"));
    let kind = flag("--2d") ? "2d" : flag("--3d") ? "3d" : value("--plantilla") ?? value("--template");
    if (kind !== "2d" && kind !== "3d") kind = (await ask(rl, t.kind, "3d")).toLowerCase() === "2d" ? "2d" : "3d";

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
    // npm quita los .gitignore al publicar: la plantilla lo lleva como _gitignore.
    if (existsSync(join(target, "_gitignore"))) renameSync(join(target, "_gitignore"), join(target, ".gitignore"));

    const title = name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
    const vars = {
      "{{name}}": name,
      "{{title}}": title,
      "{{kind}}": kind.toUpperCase(),
      "{{category}}": kind === "2d" ? "game2d" : "game3d",
      "{{sdkVersion}}": SDK_VERSION,
      "{{year}}": String(new Date().getFullYear()),
    };
    const walk = (d) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(json|md|html|js|ts|css|txt)$/.test(f) || f === ".gitignore") {
          let s = readFileSync(p, "utf8");
          for (const [k, v] of Object.entries(vars)) s = s.split(k).join(v);
          writeFileSync(p, s);
        }
      }
    };
    walk(target);

    const shown = relative(process.cwd(), target) || ".";
    console.log(t.done(shown, kind));
    console.log(t.next(shown));
  } finally {
    rl?.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
