/**
 * @xenxo/district-kit — comprobación de un distrito de la comunidad (MIT).
 *
 * Lo usan el CLI (`xenxo-district validate`, en tu equipo) y la web de xenxo (antes de subir la
 * carpeta). No toca el disco ni la red: recibe una función que lee cada archivo por su ruta. El
 * servidor vuelve a comprobarlo todo con sus propias medidas: esto es para avisar antes.
 */
import { ASSET_BUDGETS, checkBudget, COVER_BUDGET, GlbError, imageSize, inspectGlb, sniffImage, type GlbReport } from "@xenxo/assets";
import {
  checkDistrict,
  describeDistrictProblem,
  DISTRICT_KIT_BUDGETS,
  DistrictManifest,
  type DistrictModelStats,
} from "@xenxo/protocol";

export const MANIFEST_FILE = "xenxo-district.json";

export type Lang = "es" | "en";

export interface KitProblem {
  /** Dónde: un archivo, un campo de la ficha ("pieces[3]") o la ficha entera. */
  at: string;
  message: string;
}

export interface KitSummary {
  models: number;
  pieces: number;
  /** Suma de triángulos (LOD0) de las piezas colocadas. */
  sceneTris: number;
  /** Bytes de todos los modelos (LOD0 y LOD1). */
  modelBytes: number;
  primitives: number;
  colliders: number;
  lights: number;
  labels: number;
  portals: number;
}

export interface KitResult {
  ok: boolean;
  manifest: DistrictManifest | null;
  problems: KitProblem[];
  summary: KitSummary | null;
  /** Lo medido de cada modelo, por su ruta (para enseñarlo o subirlo). */
  files: Record<string, GlbReport>;
}

const L = {
  es: {
    noManifest: `falta ${MANIFEST_FILE} en la carpeta`,
    badJson: "no es JSON válido",
    missing: "no existe en la carpeta",
    glb: "no es un GLB válido",
    budget: (what: string, v: number, max: number) =>
      what === "bytes" ? `ocupa ${(v / 1048576).toFixed(1)} MB (máximo ${(max / 1048576).toFixed(0)} MB)` : what === "triangles" ? `tiene ${v} triángulos (máximo ${max})` : `tiene una textura de ${v} px (máximo ${max})`,
    vrm: "es un avatar VRM, no un modelo",
    cover: `la portada debe ser WebP, JPEG o PNG, de 160×90 a ${COVER_BUDGET.maxWidth}×${COVER_BUDGET.maxHeight} px y como mucho ${COVER_BUDGET.maxBytes / 1024} KB`,
    ratio: "la portada debería ser 16:9 (se recortará)",
  },
  en: {
    noManifest: `${MANIFEST_FILE} is missing from the folder`,
    badJson: "is not valid JSON",
    missing: "does not exist in the folder",
    glb: "is not a valid GLB",
    budget: (what: string, v: number, max: number) =>
      what === "bytes" ? `is ${(v / 1048576).toFixed(1)} MB (max ${(max / 1048576).toFixed(0)} MB)` : what === "triangles" ? `has ${v} triangles (max ${max})` : `has a ${v} px texture (max ${max})`,
    vrm: "is a VRM avatar, not a model",
    cover: `the cover must be WebP, JPEG or PNG, from 160×90 to ${COVER_BUDGET.maxWidth}×${COVER_BUDGET.maxHeight} px and at most ${COVER_BUDGET.maxBytes / 1024} KB`,
    ratio: "the cover should be 16:9 (it will be cropped)",
  },
} as const;

/**
 * Comprueba una carpeta de distrito. `read(ruta)` devuelve los bytes del archivo o null si no existe.
 * `ok` es true solo si no hay ningún problema (los avisos no cuentan).
 */
export async function checkDistrictFolder(read: (path: string) => Promise<Uint8Array | null>, lang: Lang = "en"): Promise<KitResult & { warnings: KitProblem[] }> {
  const t = L[lang];
  const problems: KitProblem[] = [];
  const warnings: KitProblem[] = [];
  const files: Record<string, GlbReport> = {};
  const fail = (manifest: DistrictManifest | null = null) => ({ ok: false, manifest, problems, warnings, summary: null, files });

  const raw = await read(MANIFEST_FILE);
  if (!raw) {
    problems.push({ at: MANIFEST_FILE, message: t.noManifest });
    return fail();
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    problems.push({ at: MANIFEST_FILE, message: t.badJson });
    return fail();
  }
  const parsed = DistrictManifest.safeParse(json);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 30)) problems.push({ at: i.path.join(".") || MANIFEST_FILE, message: i.message });
    return fail();
  }
  const m = parsed.data;

  // Cada modelo: que exista, que sea un GLB sin nada externo y que quepa en su presupuesto de subida.
  const stats: Record<string, DistrictModelStats> = {};
  const glb = async (path: string, kind: "model" | "monument") => {
    const bytes = await read(path);
    if (!bytes) return void problems.push({ at: path, message: t.missing });
    try {
      const r = inspectGlb(bytes);
      files[path] = r;
      if (r.isVrm) problems.push({ at: path, message: t.vrm });
      for (const b of checkBudget(r, kind)) problems.push({ at: path, message: t.budget(b.what, b.value, b.max) });
      if (kind === "model") stats[path] = { triangles: r.triangles, bytes: r.bytes, bounds: r.bounds };
    } catch (e) {
      problems.push({ at: path, message: e instanceof GlbError ? `${t.glb}: ${e.message}` : t.glb });
    }
  };
  for (const mod of Object.values(m.models)) {
    await glb(mod.file, "model");
    if (mod.lod1) await glb(mod.lod1, "model");
  }
  await glb(m.emblem, "monument");

  // La portada: formato real (por su firma), medidas y peso.
  const cover = await read(m.cover);
  if (!cover) problems.push({ at: m.cover, message: t.missing });
  else {
    const dims = sniffImage(cover) ? imageSize(cover) : null;
    const [w, h] = dims ?? [0, 0];
    if (!dims || cover.byteLength > COVER_BUDGET.maxBytes || w > COVER_BUDGET.maxWidth || h > COVER_BUDGET.maxHeight || w < 160 || h < 90) {
      problems.push({ at: m.cover, message: t.cover });
    } else if (Math.abs(w / h - 16 / 9) > 0.05) warnings.push({ at: m.cover, message: t.ratio });
  }

  // Presupuestos del distrito y posiciones (lo mismo que hará el servidor).
  for (const p of checkDistrict(m, stats)) {
    const [at, ...rest] = describeDistrictProblem(p, lang).split(": ");
    problems.push({ at: at!, message: rest.join(": ") });
  }

  const summary: KitSummary = {
    models: Object.keys(m.models).length,
    pieces: m.pieces.length,
    sceneTris: m.pieces.reduce((n, pc) => n + (stats[m.models[pc.model]?.file ?? ""]?.triangles ?? 0), 0),
    modelBytes: Object.values(m.models).reduce((n, mod) => n + (stats[mod.file]?.bytes ?? 0) + (mod.lod1 ? stats[mod.lod1]?.bytes ?? 0 : 0), 0),
    primitives: m.primitives.length,
    colliders: m.colliders.length,
    lights: m.lights.length,
    labels: m.labels.length,
    portals: m.portals.length,
  };
  return { ok: problems.length === 0, manifest: m, problems, warnings, summary, files };
}

/** Todas las rutas de archivo que usa una ficha, con el tipo con el que se suben a xenxo. */
export function manifestFiles(m: DistrictManifest): { path: string; kind: "model" | "monument" | "cover" }[] {
  const out: { path: string; kind: "model" | "monument" | "cover" }[] = [
    { path: m.cover, kind: "cover" },
    { path: m.emblem, kind: "monument" },
  ];
  for (const mod of Object.values(m.models)) {
    out.push({ path: mod.file, kind: "model" });
    if (mod.lod1) out.push({ path: mod.lod1, kind: "model" });
  }
  return out.filter((f, i) => out.findIndex((g) => g.path === f.path) === i);
}

/** La ficha con cada ruta cambiada por el hash del archivo ya subido (lo que se envía al servidor). */
export function resolveManifest(m: DistrictManifest, hashes: Record<string, string>) {
  const h = (p: string) => {
    const v = hashes[p];
    if (!v) throw new Error(`falta subir ${p}`);
    return v;
  };
  return {
    ...m,
    cover: h(m.cover),
    emblem: h(m.emblem),
    models: Object.fromEntries(Object.entries(m.models).map(([k, v]) => [k, { file: h(v.file), ...(v.lod1 ? { lod1: h(v.lod1) } : {}) }])),
  };
}

export { DISTRICT_KIT_BUDGETS, ASSET_BUDGETS };
