/**
 * Distritos de la comunidad (fase 2): los hace cualquiera con el kit (packages/protocol →
 * district-kit.ts, MIT) y viven aquí como los del sistema, cada uno en su chunk `c_1000_<n>`.
 *
 * - El servidor pone el suelo base, la puerta de vuelta al nexo y el nombre (owner `system`).
 * - Lo de la ficha es de `dst_<id>`: solo se cambia volviendo a enviar la ficha (installDistrict).
 * - Hasta que moderación lo aprueba solo entran su autor y moderación (closedFor en index.ts).
 */
import { DISTRICT_AREA, PLACES, type Components, type DistrictSubmission } from "@xenxo/protocol";
import { yaw, type Seeded } from "./places";
import { SEED_ASSETS } from "./seed-assets";

/** Los distritos de la comunidad van en la columna X = 1000 del mapa de chunks. */
export const COMMUNITY_X = 1000;
export const communityChunk = (n: number) => `c_${COMMUNITY_X}_${n}`;
export const isCommunityChunk = (id: string) => id.startsWith(`c_${COMMUNITY_X}_`);

export type CommunityStatus = "draft" | "pending" | "approved" | "rejected" | "hidden";

/** Tabla del Directory. Un distrito por persona; el chunk y el nombre corto no se reutilizan. */
export const COMMUNITY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS community_districts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE, chunk_id TEXT NOT NULL UNIQUE,
    manifest TEXT NOT NULL, portals TEXT NOT NULL, rev INTEGER NOT NULL, status TEXT NOT NULL,
    review_note TEXT, reviewed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    saves_day TEXT, saves INTEGER NOT NULL DEFAULT 0);
  -- Archivos que usa cada distrito (para que la limpieza de subidas sin usar no los borre).
  CREATE TABLE IF NOT EXISTS community_files (district_id TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (district_id, hash));
  CREATE INDEX IF NOT EXISTS community_files_hash ON community_files(hash);
`;
/** Envíos de ficha al día por persona (cada uno vuelve a montar el distrito). */
export const MAX_DISTRICT_SAVES_PER_DAY = 40;

/** Un portal de la ficha, ya resuelto por el Directory (el juego es de su autor y está publicado). */
export type ResolvedPortal = { game: string; project_id: string; title: string; cover: string | null; category: string };

/** Lo que el Worker sabe de cada modelo (de los metadatos de R2). */
export type ModelInfo = { triangles: number; bytes: number; bounds: { min: number[]; max: number[] } | null };

/** Lo que guarda el chunk para saber que es un distrito de la comunidad (y volver a sembrarse). */
export type CommunityMeta = { id: string; name: { es: string; en: string }; color: string; theme: string; system: Seeded[] };

const FLAT: [number, number, number, number] = [-0.707107, 0, 0, 0.707107];
const GATE = { w: 5, h: 6, bottom: 0.05, z: 156 };

/** Lo del sistema: suelo base, puerta al nexo con su nombre y luz en la llegada. */
export function communitySystem(id: string, m: DistrictSubmission): Seeded[] {
  const out: Seeded[] = [];
  const [x0, x1] = [DISTRICT_AREA.min, DISTRICT_AREA.max];
  const side = x1 - x0, mid = (x0 + x1) / 2;
  out.push({
    id: `cd_${id}_floor`,
    components: {
      "transform@1": { p: [mid, -0.1, mid], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
      "primitive@1": { shape: "box", size: [side, 0.2, side], color: m.floor, emissive: false, finish: "matte" },
    },
  });
  const gate = SEED_ASSETS["nexo_gate"];
  if (gate) {
    out.push({
      id: `cd_${id}_gate`,
      components: {
        "transform@1": { p: [32, 0, GATE.z], r: yaw(180), s: [1, 1, 1], parent: null },
        "mesh@1": { lods: gate.lods.map((l) => ({ hash: l.hash, media: "model/gltf-binary" as const, tris: l.tris })) },
      },
    });
  }
  for (const sx of [-1, 1]) {
    out.push({
      id: `cd_${id}_gate_${sx < 0 ? "w" : "e"}`,
      components: {
        "transform@1": { p: [32 + sx * (GATE.w / 2 + 0.275), GATE.bottom + GATE.h / 2, GATE.z], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
        "collider@1": { shape: "box", half_extents: [0.3, GATE.h / 2, 0.38], trigger: false },
      },
    });
  }
  out.push({
    id: `cd_${id}_gate_portal`,
    components: {
      "transform@1": { p: [32, GATE.bottom + GATE.h / 2, GATE.z], r: yaw(180), s: [1, 1, 1], parent: null },
      "portal@1": { to: { kind: "chunk", chunk_id: PLACES.nexo }, size: [GATE.w, GATE.h], title: "Nexus", i18n: { es: "Nexo", en: "Nexus" }, category: "district" },
    } as Components,
  });
  out.push({
    id: `cd_${id}_gate_label`,
    components: {
      "transform@1": { p: [32, GATE.bottom + GATE.h + 0.9, GATE.z - 0.4], r: yaw(180), s: [1, 1, 1], parent: null },
      "label@1": { text: m.name.en.toUpperCase(), i18n: { es: m.name.es.toUpperCase(), en: m.name.en.toUpperCase() }, billboard: false, size: 0.7, style: "neon", color: m.color },
    },
  });
  out.push({
    id: `cd_${id}_floor_name`,
    components: {
      "transform@1": { p: [32, 0.03, 140], r: FLAT, s: [1, 1, 1], parent: null },
      "label@1": { text: m.name.en.toLowerCase(), i18n: { es: m.name.es.toLowerCase(), en: m.name.en.toLowerCase() }, billboard: false, size: 1.5, style: "neon", color: m.color },
    },
  });
  out.push({
    id: `cd_${id}_light_spawn`,
    components: {
      "transform@1": { p: [32, 3, 146], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
      "light@1": { type: "point", color: m.color, intensity: 2, range: 12, when: "always" },
    },
  });
  return out;
}

/** Lo de la ficha, como entidades de `dst_<id>`. `models` tiene lo medido de cada hash. */
export function communityContent(id: string, m: DistrictSubmission, models: Record<string, ModelInfo>, portals: ResolvedPortal[]): Seeded[] {
  const out: Seeded[] = [];
  const t = (p: number[], deg: number, s = 1) => ({ p: p as [number, number, number], r: yaw(deg), s: [s, s, s] as [number, number, number], parent: null });
  m.pieces.forEach((pc, i) => {
    const mod = m.models[pc.model];
    if (!mod) return;
    const lods = [mod.file, ...(mod.lod1 ? [mod.lod1] : [])].map((h) => ({ hash: h, media: "model/gltf-binary" as const, tris: models[h]?.triangles ?? 0 }));
    out.push({ id: `cd_${id}_piece_${i}`, components: { "transform@1": t(pc.p, pc.yaw, pc.scale), "mesh@1": { lods } } });
  });
  m.primitives.forEach((q, i) =>
    out.push({
      id: `cd_${id}_prim_${i}`,
      components: { "transform@1": t(q.p, q.yaw), "primitive@1": { shape: q.shape, size: q.size, color: q.color, emissive: q.emissive, finish: q.finish } },
    }),
  );
  m.colliders.forEach((c, i) =>
    out.push({ id: `cd_${id}_solid_${i}`, components: { "transform@1": t(c.p, c.yaw), "collider@1": { shape: "box", half_extents: c.half, trigger: false } } }),
  );
  m.lights.forEach((l, i) =>
    out.push({
      id: `cd_${id}_light_${i}`,
      components: { "transform@1": t(l.p, 0), "light@1": { type: "point", color: l.color, intensity: l.intensity, range: l.range, when: l.when } },
    }),
  );
  m.labels.forEach((l, i) =>
    out.push({
      id: `cd_${id}_label_${i}`,
      components: {
        "transform@1": t(l.p, l.yaw),
        "label@1": { text: l.text.en, i18n: l.text, billboard: l.billboard, size: l.size, style: l.style, ...(l.color ? { color: l.color } : {}) },
      },
    }),
  );
  m.portals.forEach((q, i) => {
    const r = portals.find((x) => x.game === q.game);
    if (!r) return;
    out.push({
      id: `cd_${id}_portal_${i}`,
      components: {
        "transform@1": t(q.p, q.yaw),
        "portal@1": {
          to: { kind: "project", project_id: r.project_id },
          size: q.size,
          ...(r.cover ? { cover: r.cover } : {}),
          title: r.title.slice(0, 140),
          category: r.category,
        },
      } as Components,
    });
  });
  return out;
}

/** Hashes que usa una ficha, con el tipo de subida que tiene que tener cada uno. */
export function submissionFiles(m: DistrictSubmission): { hash: string; kind: "model" | "monument" | "cover" }[] {
  const out: { hash: string; kind: "model" | "monument" | "cover" }[] = [
    { hash: m.cover, kind: "cover" },
    { hash: m.emblem, kind: "monument" },
  ];
  for (const mod of Object.values(m.models)) {
    out.push({ hash: mod.file, kind: "model" });
    if (mod.lod1) out.push({ hash: mod.lod1, kind: "model" });
  }
  return out;
}
