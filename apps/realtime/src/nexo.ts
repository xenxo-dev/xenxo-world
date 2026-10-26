import { PLACES, type Components } from "@xenxo/protocol";
import { DISTRICTS, DISTRICT_SPAWN } from "./districts";
import nexoLayout from "./nexo-layout.json";
import { at, portalEntities, r3, seedMonument, spawnInFront, yaw, type Seeded, type Slot, type V3 } from "./places";
import plazaLayout from "./plaza-layout.json";
import { SEED_ASSETS } from "./seed-assets";
import { SEED_COVERS } from "./seed-covers";

/**
 * El nexo: la entrada al mundo. Un anillo de 24 portales mirando al centro: seis llevan a los
 * distritos (la plaza y los cinco temáticos) y el resto son el escaparate de los proyectos más
 * nuevos, que llevan a su parcela.
 *
 * La disposición sale de nexo-layout.json (la misma que usa la forja). Sube NEXO_SEED_VERSION
 * si cambias el significado de algo; los cambios de contenido se detectan solos por la huella.
 */
export const NEXO_SEED_VERSION = 2;

export type { Seeded } from "./places";

const L = nexoLayout;
const P = L.portals;
const [CX, CZ] = L.center as [number, number];
const DISTRICT_SLOTS = L.district_slots as Record<string, number>;

/** Huecos de portal, en anillo; el 0 está al norte y siguen en el sentido de las agujas del reloj. */
export const NEXO_SLOTS: Slot[] = Array.from({ length: P.count }, (_, i) => {
  const phi = (360 * i) / P.count;
  const a = (phi * Math.PI) / 180;
  return { index: i, x: r3(CX + P.ring * Math.sin(a)), z: r3(CZ - P.ring * Math.cos(a)), facing: phi === 0 ? 0 : -phi };
});

/** Huecos del escaparate (todos menos los de los distritos). */
export const SHOWCASE_SLOTS = NEXO_SLOTS.filter((s) => !Object.values(DISTRICT_SLOTS).includes(s.index));

export const NEXO_SPAWN: V3 = [L.spawn[0]!, 0, L.spawn[1]!];

/** Dónde aparece quien vuelve al nexo desde un distrito: delante de su portal, mirando al centro. */
export function nexoArrival(districtId: string) {
  const slot = NEXO_SLOTS[DISTRICT_SLOTS[districtId] ?? 0]!;
  return spawnInFront(slot, false);
}

export function nexoSeed(): Seeded[] {
  const out: Seeded[] = [];
  const asset = (name: string) => {
    const a = SEED_ASSETS[name];
    if (!a) throw new Error(`falta el modelo de la forja: ${name}`);
    return a;
  };
  const mesh = (id: string, name: string, p: V3, deg = 0, collider?: V3) => {
    const components: Components = {
      "transform@1": { p, r: yaw(deg), s: [1, 1, 1], parent: null },
      "mesh@1": { lods: asset(name).lods.map((l) => ({ hash: l.hash, media: "model/gltf-binary" as const, tris: l.tris })) },
    };
    if (collider) components["collider@1"] = { shape: "box", half_extents: collider, trigger: false };
    out.push({ id, components });
  };
  const solid = (id: string, p: V3, deg: number, half: V3) =>
    out.push({
      id,
      components: {
        "transform@1": { p, r: yaw(deg), s: [1, 1, 1], parent: null },
        "collider@1": { shape: "box", half_extents: half, trigger: false },
      },
    });

  /* --- Suelo, faro y borde --- */
  mesh("nexo_floor", "nexo_floor", [CX, 0, CZ]);
  mesh("nexo_beacon", "nexo_beacon", [CX, 0, CZ], 0, [0.9, 1, 0.9]);
  out.push({
    id: "nexo_beacon_light",
    components: {
      "transform@1": { p: [CX, 1.2, CZ], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
      "light@1": { type: "point", color: L.colors.line, intensity: 2.5, range: 12, when: "always" },
    },
  });
  // Barandilla invisible en el borde: la plataforma flota en el vacío.
  const EDGE = 32;
  const rEdge = L.platform + 0.35;
  for (let i = 0; i < EDGE; i++) {
    const phi = (360 * i) / EDGE;
    const a = (phi * Math.PI) / 180;
    const half = (Math.PI * rEdge) / EDGE + 0.05;
    solid(`nexo_edge_${i}`, [r3(CX + rEdge * Math.sin(a)), 1, r3(CZ - rEdge * Math.cos(a))], -phi, [r3(half), 1, 0.2]);
  }

  /* --- «xenxo» en luz, embutido en el suelo del círculo central --- */
  out.push({
    id: "nexo_letters",
    components: {
      "transform@1": { p: [L.letters.p[0]!, 0.03, L.letters.p[1]!], r: [-0.707107, 0, 0, 0.707107], s: [1, 1, 1], parent: null },
      "label@1": { text: "xenxo", billboard: false, size: L.letters.size, style: "neon", color: L.colors.line },
    },
  });

  /* --- Marcos de portal (todos) con su peana --- */
  for (const s of NEXO_SLOTS) {
    mesh(`nexo_frame_${s.index}`, "nexo_frame", [s.x, 0, s.z], s.facing, [P.w / 2 + 0.15, 1.8, 0.14]);
    solid(`nexo_pedestal_${s.index}`, at(s.x, s.z, s.facing, 0, 0.5, P.pedestal), s.facing, [0.42, 0.5, 0.42]);
  }

  /* --- Distritos: la plaza y los temáticos --- */
  const ids = (k: string) => ({ portal: `nexo_portal_${k}`, band: `nexo_band_${k}`, monument: `nexo_monument_${k}`, label: `nexo_label_${k}` });
  out.push(
    ...portalEntities(NEXO_SLOTS[DISTRICT_SLOTS.plaza!]!, ids("plaza"), {
      portal: {
        to: { kind: "chunk", chunk_id: PLACES.plaza, spawn: [plazaLayout.spawn[0]!, 0, plazaLayout.spawn[1]!], yaw: 0 },
        size: [P.w, P.h],
        ...(SEED_COVERS.plaza ? { cover: SEED_COVERS.plaza } : {}),
        title: "The Plaza",
        i18n: { es: "La Plaza", en: "The Plaza" },
        category: "district",
      },
      title: "The Plaza",
      i18n: { es: "La Plaza", en: "The Plaza" },
      monument: seedMonument("gate"),
    }),
  );
  for (const d of DISTRICTS) {
    const slot = DISTRICT_SLOTS[d.id];
    if (slot === undefined) continue;
    out.push(
      ...portalEntities(NEXO_SLOTS[slot]!, ids(d.id), {
        portal: {
          to: { kind: "chunk", chunk_id: d.chunk, spawn: DISTRICT_SPAWN, yaw: 0 },
          size: [P.w, P.h],
          ...(SEED_COVERS[d.id] ? { cover: SEED_COVERS[d.id] } : {}),
          title: d.name.en,
          i18n: { es: d.name.es, en: d.name.en },
          category: "district",
        },
        title: d.name.en,
        i18n: { es: d.name.es, en: d.name.en },
        color: d.color,
        monument: seedMonument(`emblem_${d.id}`),
      }),
    );
  }

  return out;
}

/** Portal de vuelta al nexo bajo el arco de la puerta de la plaza. */
export function plazaGatePortal(): Seeded {
  const g = plazaLayout.gate;
  const height = 4.2 + g.span / 2;
  const back = nexoArrival("plaza");
  return {
    id: "gate_portal",
    components: {
      "transform@1": { p: [g.p[0]!, r3(height / 2), g.p[1]!], r: yaw(g.facing), s: [1, 1, 1], parent: null },
      "portal@1": {
        to: { kind: "chunk", chunk_id: PLACES.nexo, spawn: back.p, yaw: back.yaw },
        size: [g.span, r3(height)],
        title: "Nexus",
        i18n: { es: "Nexo", en: "Nexus" },
        category: "district",
      },
    },
  };
}
