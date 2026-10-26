import { PLACES, type Components } from "@xenxo/protocol";
import { DISTRICTS, DISTRICT_SPAWN } from "./districts";
import nexoLayout from "./nexo-layout.json";
import { at, r3, r6, spawnInFront, yaw, type Q, type Seeded, type Slot, type V3 } from "./places";
import { plazaSeed } from "./seed";
import plazaLayout from "./plaza-layout.json";
import { SEED_ASSETS } from "./seed-assets";

/**
 * El nexo: la entrada al mundo. Una plataforma flotante con una puerta abierta por distrito (la
 * plaza y los temáticos), mirando al centro. Junto a cada puerta, a su izquierda, el emblema del
 * distrito; detrás, su isla flotante con el distrito en pequeño, que se ve a través de la puerta.
 * En el nexo no hay proyectos: viven en su parcela, dentro de su distrito. Los huecos libres del
 * anillo son para distritos futuros.
 *
 * La disposición sale de nexo-layout.json (la misma que usa la forja). Sube NEXO_SEED_VERSION
 * si cambias el significado de algo; los cambios de contenido se detectan solos por la huella.
 */
export const NEXO_SEED_VERSION = 3;

export type { Seeded } from "./places";

const L = nexoLayout;
const G = L.gates;
const E = L.emblem;
const I = L.islands;
const [CX, CZ] = L.center as [number, number];
const DISTRICT_SLOTS = L.district_slots as Record<string, number>;

/** Huecos de puerta, en anillo; el 0 está al norte y siguen en el sentido de las agujas del reloj. */
export const NEXO_SLOTS: Slot[] = Array.from({ length: G.count }, (_, i) => {
  const phi = (360 * i) / G.count;
  const a = (phi * Math.PI) / 180;
  return { index: i, x: r3(CX + G.ring * Math.sin(a)), z: r3(CZ - G.ring * Math.cos(a)), facing: phi === 0 ? 0 : -phi };
});

/** El nexo ya no tiene escaparate de proyectos (los proyectos están en sus distritos). */
export const SHOWCASE_SLOTS: Slot[] = [];

export const NEXO_SPAWN: V3 = [L.spawn[0]!, 0, L.spawn[1]!];

/** Dónde aparece quien vuelve al nexo desde un distrito: delante de su puerta, mirando al centro. */
export function nexoArrival(districtId: string) {
  const slot = NEXO_SLOTS[DISTRICT_SLOTS[districtId] ?? 0]!;
  return spawnInFront(slot, false);
}

/** Producto de cuaterniones (a ∘ b). */
function qmul(a: Q, b: Q): Q {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    r6(aw * bx + ax * bw + ay * bz - az * by),
    r6(aw * by - ax * bz + ay * bw + az * bx),
    r6(aw * bz + ax * by - ay * bx + az * bw),
    r6(aw * bw - ax * bx - ay * by - az * bz),
  ];
}

const lodsOf = (name: string) => {
  const a = SEED_ASSETS[name];
  if (!a) throw new Error(`falta el modelo de la forja: ${name}`);
  return a.lods.map((l) => ({ hash: l.hash, media: "model/gltf-binary" as const, tris: l.tris }));
};

/** Escala para que un modelo quepa en un cubo de `size` m, centrado y apoyado en el suelo. */
function fitInto(name: string, size: number) {
  const b = SEED_ASSETS[name]?.lods[0]?.bounds;
  const dims = b ? [b.max[0]! - b.min[0]!, b.max[1]! - b.min[1]!, b.max[2]! - b.min[2]!] : [1, 1, 1];
  const scale = r6(size / Math.max(0.01, ...dims));
  return {
    scale,
    cx: b ? -((b.max[0]! + b.min[0]!) / 2) * scale : 0,
    cz: b ? -((b.max[2]! + b.min[2]!) / 2) * scale : 0,
    lift: b ? -b.min[1]! * scale : 0,
  };
}

export function nexoSeed(): Seeded[] {
  const out: Seeded[] = [];
  const mesh = (id: string, name: string, p: V3, r: Q, s = 1, collider?: V3) => {
    const components: Components = {
      "transform@1": { p, r, s: [s, s, s], parent: null },
      "mesh@1": { lods: lodsOf(name) },
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
  mesh("nexo_floor", "nexo_floor", [CX, 0, CZ], yaw(0));
  mesh("nexo_beacon", "nexo_beacon", [CX, 0, CZ], yaw(0), 1, [0.9, 1, 0.9]);
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

  /* --- Un distrito: puerta, emblema a la izquierda e isla detrás --- */
  const district = (spec: {
    id: string;
    slot: number;
    color: string;
    name: Record<string, string>;
    to: NonNullable<Components["portal@1"]>["to"];
    emblem: string;
    island: (ix: number, iz: number, facing: number) => void;
  }) => {
    const sl = NEXO_SLOTS[spec.slot]!;
    const { x, z, facing } = sl;
    const k = spec.id;
    // Puerta abierta (los pilares son sólidos; por el hueco se pasa y se viaja).
    mesh(`nexo_gate_${k}`, "nexo_gate", [x, 0, z], yaw(facing));
    for (const sx of [-1, 1]) solid(`nexo_gate_${k}_${sx < 0 ? "l" : "r"}`, at(x, z, facing, sx * (G.w / 2 + 0.275), G.bottom + G.h / 2, 0), facing, [0.3, G.h / 2, 0.38]);
    out.push({
      id: `nexo_portal_${k}`,
      components: {
        "transform@1": { p: at(x, z, facing, 0, G.bottom + G.h / 2, 0), r: yaw(facing), s: [1, 1, 1], parent: null },
        "portal@1": { to: spec.to, size: [G.w, G.h], title: spec.name.en!, i18n: spec.name, category: "district", color: spec.color },
      },
    });
    // Franjas del color del distrito en el dintel y el escalón.
    out.push({
      id: `nexo_band_${k}`,
      components: {
        "transform@1": { p: at(x, z, facing, 0, G.bottom + G.h + 0.6, 0.38), r: yaw(facing), s: [1, 1, 1], parent: null },
        "primitive@1": { shape: "box", size: [G.w + 1.2, 0.08, 0.04], color: spec.color, emissive: true, finish: "matte" },
      },
    });
    out.push({
      id: `nexo_step_${k}`,
      components: {
        "transform@1": { p: at(x, z, facing, 0, G.bottom + 0.005, 0.5), r: yaw(facing), s: [1, 1, 1], parent: null },
        "primitive@1": { shape: "box", size: [G.w + 1.4, 0.01, 0.06], color: spec.color, emissive: true, finish: "matte" },
      },
    });
    out.push({
      id: `nexo_label_${k}`,
      components: {
        "transform@1": { p: at(x, z, facing, 0, G.bottom + G.h + 1.35, 0.4), r: yaw(facing), s: [1, 1, 1], parent: null },
        "label@1": { text: spec.name.en!, i18n: spec.name, billboard: false, size: 0.6, style: "neon", color: spec.color },
      },
    });
    // El emblema, a la izquierda de la puerta (mirándola desde el centro), sobre su peana.
    out.push({
      id: `nexo_plinth_${k}`,
      components: {
        "transform@1": { p: at(x, z, facing, E.x, E.plinth_h / 2, E.z), r: yaw(facing), s: [1, 1, 1], parent: null },
        "primitive@1": { shape: "cylinder", size: [1.3, E.plinth_h, 1.3], color: "#1a2030", emissive: false, finish: "metal" },
        "collider@1": { shape: "box", half_extents: [0.65, E.plinth_h / 2, 0.65], trigger: false },
      },
    });
    out.push({
      id: `nexo_plinth_glow_${k}`,
      components: {
        "transform@1": { p: at(x, z, facing, E.x, E.plinth_h + 0.01, E.z), r: yaw(facing), s: [1, 1, 1], parent: null },
        "primitive@1": { shape: "cylinder", size: [1.34, 0.02, 1.34], color: spec.color, emissive: true, finish: "matte" },
      },
    });
    const fit = fitInto(spec.emblem, E.size);
    mesh(`nexo_monument_${k}`, spec.emblem, at(x, z, facing, E.x + fit.cx, E.plinth_h + fit.lift, E.z + fit.cz), yaw(facing), fit.scale);
    // La isla, detrás de la puerta: lo que se ve a través de ella.
    const a = ((360 * spec.slot) / G.count) * (Math.PI / 180);
    // Las islas de los huecos impares, más lejos: así caben las de los distritos futuros.
    const ring = spec.slot % 2 ? I.ring_alt : I.ring;
    const ix = r3(CX + ring * Math.sin(a)), iz = r3(CZ - ring * Math.cos(a));
    mesh(`nexo_island_${k}`, "nexo_island", [ix, I.y, iz], yaw(facing));
    spec.island(ix, iz, facing);
  };

  /* --- La plaza: su isla lleva la plaza entera en pequeño --- */
  const plazaMeshes = plazaSeed().filter((e) => e.components["mesh@1"] && e.components["transform@1"]);
  district({
    id: "plaza",
    slot: DISTRICT_SLOTS.plaza!,
    color: L.colors.district,
    name: { es: "La Plaza", en: "The Plaza" },
    to: { kind: "chunk", chunk_id: PLACES.plaza, spawn: [plazaLayout.spawn[0]!, 0, plazaLayout.spawn[1]!], yaw: 0 },
    emblem: "gate",
    island: (ix, iz, facing) => {
      const s = I.scale;
      for (const e of plazaMeshes) {
        const t = e.components["transform@1"]!;
        const p = at(ix, iz, facing, (t.p[0] - 32) * s, 0, (t.p[2] - 32) * s);
        p[1] = r3(I.y + t.p[1] * s);
        out.push({
          id: `nexo_mini_plaza_${e.id}`,
          components: {
            "transform@1": { p, r: qmul(yaw(facing), t.r as Q), s: [r6(t.s[0] * s), r6(t.s[1] * s), r6(t.s[2] * s)], parent: null },
            "mesh@1": e.components["mesh@1"]!,
          },
        });
      }
    },
  });

  /* --- Los distritos temáticos: su suelo en pequeño, agujas de neón y su emblema en grande --- */
  for (const d of DISTRICTS) {
    const slot = DISTRICT_SLOTS[d.id];
    if (slot === undefined) continue;
    district({
      id: d.id,
      slot,
      color: d.color,
      name: { es: d.name.es, en: d.name.en },
      to: { kind: "chunk", chunk_id: d.chunk, spawn: DISTRICT_SPAWN, yaw: 0 },
      emblem: `emblem_${d.id}`,
      island: (ix, iz, facing) => {
        mesh(`nexo_mini_${d.id}_ground`, `district_${d.id}`, [ix, r3(I.y + 0.62 * I.scale), iz], yaw(facing), I.scale);
        mesh(`nexo_mini_${d.id}_spires`, `nexo_spires_${d.id}`, [ix, I.y, iz], yaw(facing));
        const fit = fitInto(`emblem_${d.id}`, 6.5);
        mesh(`nexo_mini_${d.id}_emblem`, `emblem_${d.id}`, [r3(ix + fit.cx), r3(I.y + 0.3 + fit.lift), r3(iz + fit.cz)], yaw(facing), fit.scale);
      },
    });
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
