/**
 * Kit de distritos de la comunidad (MIT): la ficha `xenxo-district.json` que escribe quien crea un
 * distrito y las comprobaciones que hacen igual el kit (en su equipo), la web (antes de subir) y el
 * servidor (que nunca se fía de los otros dos).
 *
 * Un distrito de la comunidad mide lo mismo que los del sistema (256 × 256 m, coordenadas del chunk:
 * X este, Z sur, Y arriba). Lo pone el servidor: el suelo base, la puerta de vuelta al nexo (al sur)
 * y el punto de llegada. Lo demás lo trae la ficha: modelos colocados, primitivas, colisiones, luces,
 * rótulos y portales a sus juegos de xenxo (con «Entrar con xenxo»: la identidad siempre es la de xenxo).
 *
 * Este archivo no importa nada del resto del protocolo a propósito (lo usa el kit tal cual).
 */
import { z } from "zod";

export const DISTRICT_KIT_SCHEMA = "xenxo.district/0" as const;

/** Medidas fijas de un distrito (las mismas que los del sistema: districts.json). */
export const DISTRICT_AREA = {
  /** Mínimo y máximo de X y de Z (m). */
  min: -96,
  max: 160,
  /** Altura máxima de lo construido (m). */
  maxHeight: 120,
  /** Donde aparece quien llega del nexo, mirando al norte. */
  spawn: [32, 0, 150] as [number, number, number],
  /** Zona de la puerta y la llegada: aquí solo vale lo plano (suelo). */
  gate: { x0: 22, x1: 42, z0: 138, z1: 160 },
} as const;

/**
 * Presupuestos (pensados para la Quest 3: el distrito entero puede estar a la vista).
 * Cada modelo, además, cumple el presupuesto de subida `model` de @xenxo/assets (6 MB, 50.000
 * triángulos, texturas de 2048 px) y el emblema el de `monument`.
 */
export const DISTRICT_KIT_BUDGETS = {
  maxModels: 32,
  maxPieces: 160,
  /** Suma de triángulos (LOD0) de todas las piezas colocadas. */
  maxSceneTris: 300_000,
  maxModelTris: 50_000,
  /** Por encima de esto, el modelo necesita su LOD1 (versión ligera para lejos)… */
  lodRequiredOver: 8_000,
  /** …de como mucho esta fracción de los triángulos del LOD0. */
  maxLod1Ratio: 0.5,
  /** Suma de los archivos de todos los modelos (bytes). */
  maxModelsBytes: 40 * 1024 * 1024,
  maxPrimitives: 200,
  maxColliders: 300,
  maxLights: 12,
  maxLabels: 48,
  maxPortals: 12,
  /** Lo que no sube más de esto cuenta como suelo (puede pisar la zona de la puerta). */
  flatHeight: 0.25,
} as const;

/** Temas de ciudad de fondo (los mismos que los distritos del sistema). */
export const DISTRICT_THEMES = ["arcade", "pixel", "agora", "taller", "frontera", "cero", "vertical"] as const;

/** Nombres que no puede llevar un distrito de la comunidad. */
export const DISTRICT_RESERVED_SLUGS = [
  ...DISTRICT_THEMES,
  "nexo", "nexus", "plaza", "xenxo", "admin", "system", "sistema", "moderacion", "moderation", "official", "oficial",
] as const;

const n = z.number().finite();
const P = z.tuple([n, n, n]);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "#rrggbb");
const Yaw = z.number().min(-360).max(360).default(0);
const Text = (max: number) =>
  z
    .object({ es: z.string().trim().min(1).max(max), en: z.string().trim().min(1).max(max) })
    .catchall(z.string().trim().min(1).max(max))
    .refine((o) => Object.keys(o).length <= 12 && Object.keys(o).every((k) => /^[a-z]{2}$/.test(k)), "idiomas: códigos de 2 letras (es, en, ca…), hasta 12");
const ModelName = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, "nombre de modelo: minúsculas, números, - y _");

/** En la carpeta del creador: ruta relativa a un archivo. */
export const DistrictFile = z
  .string()
  .max(160)
  .regex(/^(?!\/)(?!.*\.\.)[A-Za-z0-9._\/-]+\.(glb|webp|png|jpe?g)$/i, "ruta relativa a un .glb o a una imagen, sin ..");
/** Ya subido: el hash del archivo. */
const DistrictHash = z.string().regex(/^sha256:[0-9a-f]{64}$/, "hash sha256:<64 hex>");

function districtManifest<R extends z.ZodTypeAny>(ref: R) {
  return z
    .object({
      schema: z.literal(DISTRICT_KIT_SCHEMA),
      /** Su nombre corto (también en el enlace): minúsculas, números y guiones. */
      slug: z
        .string()
        .regex(/^[a-z][a-z0-9-]{2,23}$/, "3–24 caracteres: minúsculas, números y guiones")
        .refine((s) => !(DISTRICT_RESERVED_SLUGS as readonly string[]).includes(s) && !s.includes("xenxo"), "ese nombre está reservado"),
      name: Text(40),
      description: Text(200),
      /** Color del distrito (su puerta, su emblema y su luz). */
      color: Color,
      /** Ciudad de fondo, alrededor del distrito. */
      theme: z.enum(DISTRICT_THEMES).default("frontera"),
      /** Color del suelo base que pone el servidor (256 × 256 m). */
      floor: Color.default("#1a1f2a"),
      /** Portada 16:9 (como la de un proyecto). */
      cover: ref,
      /** Monumento del distrito en el nexo (presupuesto `monument`). */
      emblem: ref,
      models: z
        .record(ModelName, z.object({ file: ref, lod1: ref.optional() }).strict())
        .refine((o) => Object.keys(o).length <= DISTRICT_KIT_BUDGETS.maxModels, `hasta ${DISTRICT_KIT_BUDGETS.maxModels} modelos`),
      pieces: z
        .array(z.object({ model: ModelName, p: P, yaw: Yaw, scale: z.number().min(0.1).max(10).default(1) }).strict())
        .max(DISTRICT_KIT_BUDGETS.maxPieces)
        .default([]),
      primitives: z
        .array(
          z
            .object({
              shape: z.enum(["box", "sphere", "cylinder", "plane"]),
              size: z.tuple([z.number().min(0.01).max(256), z.number().min(0.01).max(256), z.number().min(0.01).max(256)]),
              p: P,
              yaw: Yaw,
              color: Color,
              emissive: z.boolean().default(false),
              finish: z.enum(["matte", "glossy", "metal", "glass"]).default("matte"),
            })
            .strict(),
        )
        .max(DISTRICT_KIT_BUDGETS.maxPrimitives)
        .default([]),
      /** Cajas sólidas (no se pueden atravesar; su techo se puede pisar). */
      colliders: z
        .array(z.object({ p: P, half: z.tuple([z.number().min(0.05).max(64), z.number().min(0.05).max(64), z.number().min(0.05).max(64)]), yaw: Yaw }).strict())
        .max(DISTRICT_KIT_BUDGETS.maxColliders)
        .default([]),
      lights: z
        .array(
          z
            .object({
              p: P,
              color: Color,
              intensity: z.number().min(0).max(10).default(2),
              range: z.number().min(0.5).max(30).default(10),
              when: z.enum(["night", "always"]).default("night"),
            })
            .strict(),
        )
        .max(DISTRICT_KIT_BUDGETS.maxLights)
        .default([]),
      labels: z
        .array(
          z
            .object({
              p: P,
              yaw: Yaw,
              text: Text(60),
              size: z.number().min(0.2).max(4).default(0.8),
              style: z.enum(["plain", "sign", "neon"]).default("sign"),
              color: Color.optional(),
              billboard: z.boolean().default(false),
            })
            .strict(),
        )
        .max(DISTRICT_KIT_BUDGETS.maxLabels)
        .default([]),
      /**
       * Portales a juegos de xenxo de quien crea el distrito (su enlace xenxo.io/j/<game>). Cada juego
       * se publica y se revisa como cualquier otro, con su xenxo.json y «Entrar con xenxo».
       */
      portals: z
        .array(
          z
            .object({
              p: P,
              yaw: Yaw,
              size: z.tuple([z.number().min(1).max(8), z.number().min(1).max(6)]).default([4, 2.25]),
              game: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "el enlace de un juego de xenxo (xenxo.io/j/<nombre>)"),
            })
            .strict(),
        )
        .max(DISTRICT_KIT_BUDGETS.maxPortals)
        .default([]),
      author: z.string().trim().min(1).max(60),
      /** Un email o una web de contacto. */
      contact: z.string().trim().min(3).max(200),
    })
    .strict();
}

/** La ficha en la carpeta del creador (rutas a sus archivos). */
export const DistrictManifest = districtManifest(DistrictFile);
export type DistrictManifest = z.infer<typeof DistrictManifest>;

/** La misma ficha, con los archivos ya subidos (hashes). Es lo que se envía al servidor. */
export const DistrictSubmission = districtManifest(DistrictHash);
export type DistrictSubmission = z.infer<typeof DistrictSubmission>;

/** Lo que se sabe de un modelo (lo mide @xenxo/assets: inspectGlb). */
export interface DistrictModelStats {
  triangles: number;
  bytes: number;
  /** Caja del modelo (m), sin transformaciones de nodo. */
  bounds: { min: number[]; max: number[] } | null;
}

export type DistrictProblemCode =
  | "stats_missing"
  | "model_missing"
  | "model_tris"
  | "lod_required"
  | "lod_ratio"
  | "models_bytes"
  | "scene_tris"
  | "out_of_area"
  | "too_high"
  | "gate_zone"
  | "duplicate_portal";

export interface DistrictProblem {
  code: DistrictProblemCode;
  /** Dónde (ruta en la ficha: "pieces[3]", "models.tower"…). */
  at: string;
  value?: number;
  max?: number;
}

/** Caja (en el suelo, XZ) de una caja local girada `yaw` grados y movida a `p`. */
function placedBox(min: number[], max: number[], p: number[], yawDeg: number, scale = 1) {
  const t = (yawDeg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const x of [min[0]! * scale, max[0]! * scale]) {
    for (const z of [min[2]! * scale, max[2]! * scale]) {
      // Giro alrededor de +Y (como un cuaternión [0, sin(t/2), 0, cos(t/2)]).
      const wx = x * c + z * s + p[0]!;
      const wz = -x * s + z * c + p[2]!;
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx);
      z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
    }
  }
  return { x0, x1, z0, z1, y0: min[1]! * scale + p[1]!, y1: max[1]! * scale + p[1]! };
}

/**
 * Comprueba presupuestos y posiciones de una ficha ya válida según su esquema. `stats` tiene lo
 * medido de cada archivo, por su referencia (ruta en el kit, hash en el servidor). Lista vacía = vale.
 */
export function checkDistrict(m: DistrictManifest | DistrictSubmission, stats: Record<string, DistrictModelStats>): DistrictProblem[] {
  const B = DISTRICT_KIT_BUDGETS, A = DISTRICT_AREA;
  const out: DistrictProblem[] = [];
  const lod0 = new Map<string, DistrictModelStats>();
  let bytes = 0;
  for (const [name, mod] of Object.entries(m.models)) {
    const s0 = stats[mod.file];
    if (!s0) { out.push({ code: "stats_missing", at: `models.${name}.file` }); continue; }
    lod0.set(name, s0);
    bytes += s0.bytes;
    if (s0.triangles > B.maxModelTris) out.push({ code: "model_tris", at: `models.${name}`, value: s0.triangles, max: B.maxModelTris });
    if (mod.lod1) {
      const s1 = stats[mod.lod1];
      if (!s1) out.push({ code: "stats_missing", at: `models.${name}.lod1` });
      else {
        bytes += s1.bytes;
        const max = Math.floor(s0.triangles * B.maxLod1Ratio);
        if (s1.triangles > max) out.push({ code: "lod_ratio", at: `models.${name}.lod1`, value: s1.triangles, max });
      }
    } else if (s0.triangles > B.lodRequiredOver) {
      out.push({ code: "lod_required", at: `models.${name}`, value: s0.triangles, max: B.lodRequiredOver });
    }
  }
  if (bytes > B.maxModelsBytes) out.push({ code: "models_bytes", at: "models", value: bytes, max: B.maxModelsBytes });

  const inArea = (b: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }, at: string) => {
    if (b.x0 < A.min || b.x1 > A.max || b.z0 < A.min || b.z1 > A.max) out.push({ code: "out_of_area", at });
    if (b.y1 > A.maxHeight) out.push({ code: "too_high", at, value: Math.round(b.y1 * 10) / 10, max: A.maxHeight });
    const g = A.gate;
    const overlaps = b.x1 > g.x0 && b.x0 < g.x1 && b.z1 > g.z0 && b.z0 < g.z1;
    if (overlaps && b.y1 > B.flatHeight) out.push({ code: "gate_zone", at });
  };

  let tris = 0;
  m.pieces.forEach((pc, i) => {
    const s = lod0.get(pc.model);
    if (!m.models[pc.model]) { out.push({ code: "model_missing", at: `pieces[${i}]` }); return; }
    if (!s) return;
    tris += s.triangles;
    if (s.bounds) inArea(placedBox(s.bounds.min, s.bounds.max, pc.p, pc.yaw, pc.scale), `pieces[${i}]`);
  });
  if (tris > B.maxSceneTris) out.push({ code: "scene_tris", at: "pieces", value: tris, max: B.maxSceneTris });

  m.primitives.forEach((q, i) => {
    const [sx, sy, sz] = q.size;
    inArea(placedBox([-sx / 2, -sy / 2, -sz / 2], [sx / 2, sy / 2, sz / 2], q.p, q.yaw), `primitives[${i}]`);
  });
  m.colliders.forEach((c, i) => {
    const [hx, hy, hz] = c.half;
    inArea(placedBox([-hx, -hy, -hz], [hx, hy, hz], c.p, c.yaw), `colliders[${i}]`);
  });
  m.lights.forEach((l, i) => inArea(placedBox([0, 0, 0], [0, 0, 0], l.p, 0), `lights[${i}]`));
  m.labels.forEach((l, i) => inArea(placedBox([-0.1, 0, -0.1], [0.1, l.size, 0.1], l.p, 0), `labels[${i}]`));
  const games = new Set<string>();
  m.portals.forEach((q, i) => {
    const [w, h] = q.size;
    inArea(placedBox([-w / 2, -h / 2, -0.2], [w / 2, h / 2, 3.4], q.p, q.yaw), `portals[${i}]`);
    if (games.has(q.game)) out.push({ code: "duplicate_portal", at: `portals[${i}]` });
    games.add(q.game);
  });
  return out;
}

/** Explicación de un problema, en español o en inglés (para el kit, la web y el servidor). */
export function describeDistrictProblem(p: DistrictProblem, lang: "es" | "en" = "en"): string {
  const v = p.value ?? 0, mx = p.max ?? 0;
  const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
  const es: Record<DistrictProblemCode, string> = {
    stats_missing: "no se pudo medir este archivo (¿existe y es un GLB válido?)",
    model_missing: "usa un modelo que no está en `models`",
    model_tris: `el modelo tiene ${v} triángulos (máximo ${mx})`,
    lod_required: `el modelo tiene ${v} triángulos: con más de ${mx} necesita su \`lod1\` (versión ligera para lejos)`,
    lod_ratio: `el lod1 tiene ${v} triángulos: como mucho la mitad del modelo (${mx})`,
    models_bytes: `los modelos ocupan ${mb(v)} (máximo ${mb(mx)})`,
    scene_tris: `las piezas colocadas suman ${v} triángulos (máximo ${mx})`,
    out_of_area: `se sale del distrito (de ${DISTRICT_AREA.min} a ${DISTRICT_AREA.max} m en X y en Z)`,
    too_high: `llega a ${v} m de alto (máximo ${mx})`,
    gate_zone: "pisa la zona de la puerta y la llegada (X 22–42, Z 138–160): ahí solo vale suelo plano",
    duplicate_portal: "ya hay un portal a ese juego",
  };
  const en: Record<DistrictProblemCode, string> = {
    stats_missing: "this file could not be measured (does it exist and is it a valid GLB?)",
    model_missing: "uses a model that is not in `models`",
    model_tris: `the model has ${v} triangles (max ${mx})`,
    lod_required: `the model has ${v} triangles: above ${mx} it needs its \`lod1\` (a lighter version for distance)`,
    lod_ratio: `the lod1 has ${v} triangles: at most half of the model (${mx})`,
    models_bytes: `models take ${mb(v)} (max ${mb(mx)})`,
    scene_tris: `placed pieces add up to ${v} triangles (max ${mx})`,
    out_of_area: `goes outside the district (${DISTRICT_AREA.min} to ${DISTRICT_AREA.max} m in X and Z)`,
    too_high: `reaches ${v} m high (max ${mx})`,
    gate_zone: "overlaps the gate and arrival area (X 22–42, Z 138–160): only flat ground is allowed there",
    duplicate_portal: "there is already a portal to that game",
  };
  return `${p.at}: ${(lang === "es" ? es : en)[p.code]}`;
}
