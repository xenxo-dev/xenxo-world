/**
 * xenxo-district — el kit de distritos en tu terminal (MIT).
 *
 *   npx @xenxo/district-kit validate [carpeta] [--lang es|en] [--json]
 *
 * Lee xenxo-district.json y sus archivos, y dice si el distrito cumple los requisitos de xenxo.
 * Sale con código 1 si hay problemas (sirve en CI).
 */
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { checkDistrictFolder, DISTRICT_KIT_BUDGETS as B, type Lang } from "./check";

const args = process.argv.slice(2);
const flagValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const lang: Lang = flagValue("--lang") === "es" || (!flagValue("--lang") && /^es/i.test(process.env.LANG ?? "")) ? "es" : "en";
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--lang");
const cmd = positional[0] ?? "help";

/**
 * Lo que sale de la ficha (rutas, claves, mensajes) es dato de quien hizo el distrito: puede llevar
 * secuencias de escape que cambian la terminal (enlaces falsos, borrar la pantalla…). Se quitan los
 * controles C0 y C1 (y DEL) de todo lo que se imprime.
 */
const CONTROLES = /[\u0000-\u001f\u007f-\u009f]/g;
const limpio = (v: unknown) => String(v).replace(CONTROLES, "");
/** Imprime línea a línea, cada una sin controles (los saltos de línea propios se respetan). */
const say = (text: string) => console.log(text.split("\n").map(limpio).join("\n"));
/** JSON.stringify ya escapa C0, pero no C1 ni DEL: se escapan también. */
const json = (v: unknown) => JSON.stringify(v, null, 2).replace(/[\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

const T = {
  es: {
    help:
      "\n  xenxo-district — kit de distritos de xenxo\n\n" +
      "    xenxo-district validate [carpeta]   comprueba el distrito (por defecto, la carpeta actual)\n\n" +
      "  Opciones: --lang es|en · --json\n" +
      "  Crear uno nuevo: npm create xenxo@latest mi-distrito -- --district\n",
    ok: "  ✓ El distrito cumple los requisitos. Súbelo desde xenxo.io → Cuenta → Tu distrito.\n",
    bad: (n: number) => `  ✗ ${n} problema(s). Corrígelos y vuelve a comprobar.\n`,
    warn: "  ! Avisos:",
    title: (s: string) => `\n  Distrito «${s}»\n`,
    row: (k: string, v: string) => `    ${k.padEnd(22)} ${v}`,
    labels: { models: "Modelos", pieces: "Piezas", tris: "Triángulos (LOD0)", bytes: "Peso de los modelos", prims: "Primitivas", cols: "Colisiones", lights: "Luces", labels: "Rótulos", portals: "Portales" },
  },
  en: {
    help:
      "\n  xenxo-district — xenxo district kit\n\n" +
      "    xenxo-district validate [folder]   checks the district (the current folder by default)\n\n" +
      "  Options: --lang es|en · --json\n" +
      "  Create a new one: npm create xenxo@latest my-district -- --district --lang en\n",
    ok: "  ✓ The district meets the requirements. Upload it from xenxo.io → Account → Your district.\n",
    bad: (n: number) => `  ✗ ${n} problem(s). Fix them and check again.\n`,
    warn: "  ! Warnings:",
    title: (s: string) => `\n  District "${s}"\n`,
    row: (k: string, v: string) => `    ${k.padEnd(22)} ${v}`,
    labels: { models: "Models", pieces: "Pieces", tris: "Triangles (LOD0)", bytes: "Model size", prims: "Primitives", cols: "Colliders", lights: "Lights", labels: "Labels", portals: "Portals" },
  },
}[lang];

async function validate(dir: string) {
  const root = resolve(process.cwd(), dir);
  const read = async (p: string) => {
    const full = resolve(root, p);
    if (full !== root && !full.startsWith(root + sep)) return null;
    try {
      return new Uint8Array(await readFile(full));
    } catch {
      return null;
    }
  };
  const r = await checkDistrictFolder(read, lang);
  if (args.includes("--json")) {
    console.log(json({ ok: r.ok, problems: r.problems, warnings: r.warnings, summary: r.summary }));
    process.exit(r.ok ? 0 : 1);
  }
  if (r.manifest) say(T.title(limpio(r.manifest.slug)));
  if (r.summary) {
    const s = r.summary, L = T.labels;
    const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
    for (const [k, v] of [
      [L.models, `${s.models} / ${B.maxModels}`],
      [L.pieces, `${s.pieces} / ${B.maxPieces}`],
      [L.tris, `${s.sceneTris} / ${B.maxSceneTris}`],
      [L.bytes, `${mb(s.modelBytes)} / ${mb(B.maxModelsBytes)}`],
      [L.prims, `${s.primitives} / ${B.maxPrimitives}`],
      [L.cols, `${s.colliders} / ${B.maxColliders}`],
      [L.lights, `${s.lights} / ${B.maxLights}`],
      [L.labels, `${s.labels} / ${B.maxLabels}`],
      [L.portals, `${s.portals} / ${B.maxPortals}`],
    ] as const) say(T.row(k, v));
    say("");
  }
  for (const p of r.problems) say(`  ✗ ${limpio(p.at)}: ${limpio(p.message)}`);
  if (r.warnings.length) {
    say(T.warn);
    for (const w of r.warnings) say(`    ${limpio(w.at)}: ${limpio(w.message)}`);
  }
  say(r.ok ? T.ok : T.bad(r.problems.length));
  process.exit(r.ok ? 0 : 1);
}

if (cmd === "validate" || cmd === "check" || cmd === "comprobar") await validate(positional[1] ?? ".");
else say(T.help);
