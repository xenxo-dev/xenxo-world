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
    console.log(JSON.stringify({ ok: r.ok, problems: r.problems, warnings: r.warnings, summary: r.summary }, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  if (r.manifest) console.log(T.title(r.manifest.slug));
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
    ] as const) console.log(T.row(k, v));
    console.log("");
  }
  for (const p of r.problems) console.log(`  ✗ ${p.at}: ${p.message}`);
  if (r.warnings.length) {
    console.log(T.warn);
    for (const w of r.warnings) console.log(`    ${w.at}: ${w.message}`);
  }
  console.log(r.ok ? T.ok : T.bad(r.problems.length));
  process.exit(r.ok ? 0 : 1);
}

if (cmd === "validate" || cmd === "check" || cmd === "comprobar") await validate(positional[1] ?? ".");
else console.log(T.help);
