import { CHUNK_SIZE, type Components } from "@xenxo/protocol";

/**
 * La plaza inicial también es DATOS, no código del cliente: cualquier cliente
 * (web, VR, nativo, headless) la recibe igual en el SNAPSHOT.
 *
 * Plaza mayor mediterránea hecha solo con primitive@1: cal, terracota, azulejo,
 * fuente, campanario, naranjos, farolas y barrios con toldos.
 * Presupuesto aproximado: ~140 entidades, ~25k triángulos.
 *
 * Sube SEED_VERSION cuando cambies algo aquí: el servidor sustituye las entidades
 * del sistema por las nuevas y conserva las de personas y agentes.
 *
 * Tamaños de primitive@1:
 *   box = [ancho, alto, fondo] · sphere = [diámetro, -, -] · cylinder = [diámetro, alto, -] · plane = [ancho, -, fondo]
 */
export const SEED_VERSION = 2;

type V3 = [number, number, number];
type Q = [number, number, number, number];
type Shape = "box" | "sphere" | "cylinder" | "plane";

const C = {
  cal: "#f4efe6",
  calSombra: "#e6dccb",
  piedra: "#e3d2b3",
  albero: "#cfb48a",
  terracota: "#b9583a",
  teja: "#a8492c",
  azulejo: "#2f6fb0",
  madera: "#7a4a2a",
  persiana: "#3f6b4f",
  hoja: "#4f8a3c",
  naranja: "#f08a24",
  hierro: "#2d2a26",
  luz: "#ffd98a",
  agua: "#5fb6c9",
  esfera: "#f6e7b0",
  hueco: "#3a2f28",
} as const;

/** Rotación: primero cabeceo (eje X), después giro (eje Y). */
function quat(yaw = 0, pitch = 0): Q {
  const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2);
  const sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
  return [cy * sx, sy * cx, -sy * sx, cy * cx];
}

export function plazaSeed(): { id: string; components: Components }[] {
  const out: { id: string; components: Components }[] = [];
  const c = CHUNK_SIZE / 2;

  const prim = (
    id: string,
    shape: Shape,
    p: V3,
    size: V3,
    color: string,
    o: { r?: Q; emissive?: boolean; collider?: V3 } = {},
  ) => {
    const components: Components = {
      "transform@1": { p, r: o.r ?? [0, 0, 0, 1], s: [1, 1, 1], parent: null },
      "primitive@1": { shape, size, color, emissive: o.emissive ?? false },
    };
    if (o.collider) components["collider@1"] = { shape: "box", half_extents: o.collider, trigger: false };
    out.push({ id, components });
  };

  const label = (id: string, p: V3, text: string, i18n: Record<string, string>, size: number, r?: Q) => {
    out.push({
      id,
      components: {
        "transform@1": { p, r: r ?? [0, 0, 0, 1], s: [1, 1, 1], parent: null },
        "label@1": { text, i18n, billboard: !r, size },
      },
    });
  };

  /* --- Suelo --------------------------------------------------------- */
  prim("ground", "box", [c, -0.2, c], [CHUNK_SIZE, 0.4, CHUNK_SIZE], C.albero);
  prim("plaza_paving", "box", [c, 0.05, c], [40, 0.1, 40], C.piedra);
  prim("plaza_stripe_ew", "box", [c, 0.12, 30], [40, 0.04, 1.2], C.terracota);
  prim("plaza_stripe_ns", "box", [c, 0.12, c], [1.2, 0.04, 40], C.terracota);
  prim("plaza_ring", "cylinder", [c, 0.13, 30], [12, 0.06, 0], C.azulejo);

  /* --- Punto de aparición: la X de xenxo en azulejo ------------------- */
  prim("spawn_disc", "cylinder", [c, 0.13, c + 11], [3.2, 0.06, 0], C.cal);
  prim("spawn_x1", "box", [c, 0.17, c + 11], [2.6, 0.03, 0.35], C.azulejo, { r: quat(Math.PI / 4), emissive: true });
  prim("spawn_x2", "box", [c, 0.17, c + 11], [2.6, 0.03, 0.35], C.azulejo, { r: quat(-Math.PI / 4), emissive: true });

  /* --- Fuente central ------------------------------------------------- */
  const fz = 30;
  prim("fountain_basin", "cylinder", [c, 0.55, fz], [7, 0.9, 0], C.calSombra, { collider: [3.5, 0.45, 3.5] });
  prim("fountain_water", "cylinder", [c, 0.99, fz], [6.4, 0.04, 0], C.agua);
  prim("fountain_pillar", "cylinder", [c, 2.0, fz], [0.7, 2.2, 0], C.cal);
  prim("fountain_bowl", "cylinder", [c, 3.2, fz], [2.4, 0.35, 0], C.calSombra);
  prim("fountain_bowl_water", "cylinder", [c, 3.39, fz], [2.0, 0.04, 0], C.agua);
  prim("fountain_jet", "sphere", [c, 3.75, fz], [0.5, 0, 0], "#9fd8e6");

  /* --- Campanario (la torre de xenxo.io) ------------------------------ */
  const tz = 9;
  const front = tz + 2.5;
  prim("tower_body", "box", [c, 7, tz], [5, 14, 5], C.cal, { collider: [2.5, 7, 2.5] });
  prim("tower_band", "box", [c, 10.6, tz], [5.2, 0.7, 5.2], C.azulejo);
  prim("tower_belfry", "box", [c, 15.5, tz], [4.2, 3, 4.2], C.cal);
  prim("tower_arch_s", "box", [c, 15.3, tz + 2.12], [1.6, 2, 0.1], C.hueco);
  prim("tower_arch_e", "box", [c + 2.12, 15.3, tz], [0.1, 2, 1.6], C.hueco);
  prim("tower_arch_w", "box", [c - 2.12, 15.3, tz], [0.1, 2, 1.6], C.hueco);
  prim("tower_cornice", "box", [c, 17.2, tz], [4.8, 0.4, 4.8], C.terracota);
  prim("tower_cap", "box", [c, 18, tz], [2.2, 1.2, 2.2], C.teja);
  prim("tower_spire", "box", [c, 19.3, tz], [0.25, 1.5, 0.25], C.hierro);
  prim("tower_clock", "cylinder", [c, 12.6, front + 0.06], [2.4, 0.12, 0], C.esfera, { r: quat(0, Math.PI / 2), emissive: true });
  prim("tower_clock_h", "box", [c, 12.9, front + 0.14], [0.12, 0.7, 0.04], C.hierro);
  prim("tower_clock_m", "box", [c + 0.35, 12.6, front + 0.14], [0.8, 0.1, 0.04], C.hierro);
  prim("tower_plaque", "box", [c, 8.4, front + 0.06], [4.6, 1.5, 0.12], C.azulejo);
  label("tower_logo", [c, 8.4, front + 0.16], "xenxo.io", {}, 1.0, quat(0));

  /* --- Barrios ---------------------------------------------------------- */
  const building = (
    id: string,
    cx: number,
    cz: number,
    accent: string,
    name?: { es: string; en: string },
  ) => {
    const w = 9, h = 6, d = 7;
    // De cara al centro de la plaza: el +z local apunta a la fuente.
    const yaw = Math.atan2(c - cx, fz - cz);
    const r = quat(yaw);
    const at = (lx: number, y: number, lz: number): V3 => [
      cx + lx * Math.cos(yaw) + lz * Math.sin(yaw),
      y,
      cz - lx * Math.sin(yaw) + lz * Math.cos(yaw),
    ];
    const f = d / 2;
    prim(`${id}_body`, "box", at(0, h / 2, 0), [w, h, d], C.cal, { r, collider: [w / 2, h / 2, d / 2] });
    prim(`${id}_roof`, "box", at(0, h + 0.25, 0), [w + 0.6, 0.5, d + 0.6], C.teja, { r });
    prim(`${id}_base`, "box", at(0, 0.45, 0), [w + 0.06, 0.9, d + 0.06], accent, { r });
    prim(`${id}_door`, "box", at(0, 1.6, f + 0.04), [2.2, 3.2, 0.1], C.madera, { r });
    prim(`${id}_win_l`, "box", at(-w * 0.32, 3.9, f + 0.04), [1.3, 1.5, 0.1], C.persiana, { r });
    prim(`${id}_win_r`, "box", at(w * 0.32, 3.9, f + 0.04), [1.3, 1.5, 0.1], C.persiana, { r });
    prim(`${id}_awning`, "box", at(0, 3.55, f + 0.9), [w * 0.8, 0.08, 1.8], accent, { r: quat(yaw, 0.3) });
    prim(`${id}_pot_l`, "cylinder", at(-1.8, 0.35, f + 0.5), [0.6, 0.7, 0], C.terracota, { r });
    prim(`${id}_pot_r`, "cylinder", at(1.8, 0.35, f + 0.5), [0.6, 0.7, 0], C.terracota, { r });
    prim(`${id}_plant_l`, "sphere", at(-1.8, 1.0, f + 0.5), [0.8, 0, 0], C.hoja);
    prim(`${id}_plant_r`, "sphere", at(1.8, 1.0, f + 0.5), [0.8, 0, 0], C.hoja);
    if (name) {
      prim(`${id}_sign`, "box", at(0, 5.1, f + 0.06), [5.4, 1.0, 0.12], C.madera, { r });
      label(`${id}_label`, at(0, 5.1, f + 0.16), name.en, { es: name.es, en: name.en }, 0.62, r);
    }
  };

  building("arcade", 8.5, 22, "#e0663a", { es: "Recreativos", en: "Arcade" });
  building("projects", 8.5, 40, C.azulejo, { es: "Proyectos", en: "Projects" });
  building("agents", 55.5, 22, "#d9a441", { es: "Agentes", en: "Agents" });
  building("sandbox", 55.5, 40, "#5b8f3a", { es: "Taller", en: "Sandbox" });
  building("social", 19, 8.5, "#b2456e", { es: "La Terraza", en: "Social" });
  building("townhall", 45, 8.5, C.terracota, { es: "Ayuntamiento", en: "Town hall" });

  /* --- Naranjos ---------------------------------------------------------- */
  const trees: [number, number][] = [
    [15.5, 31], [48.5, 31], [20, 49], [44, 49], [16, 15.5], [48, 15.5],
  ];
  trees.forEach(([x, z], i) => {
    prim(`tree_${i}_trunk`, "cylinder", [x, 0.9, z], [0.35, 1.6, 0], C.madera, { collider: [0.2, 0.8, 0.2] });
    prim(`tree_${i}_crown`, "sphere", [x, 2.5, z], [2.4, 0, 0], C.hoja);
    prim(`tree_${i}_fruit_a`, "sphere", [x + 0.7, 2.3, z + 0.6], [0.28, 0, 0], C.naranja);
    prim(`tree_${i}_fruit_b`, "sphere", [x - 0.6, 2.8, z + 0.5], [0.28, 0, 0], C.naranja);
  });

  /* --- Farolas ----------------------------------------------------------- */
  const lamps: [number, number][] = [
    [24, 22], [40, 22], [24, 38], [40, 38], [14, 44], [50, 44],
  ];
  lamps.forEach(([x, z], i) => {
    prim(`lamp_${i}_post`, "cylinder", [x, 1.75, z], [0.15, 3.5, 0], C.hierro);
    prim(`lamp_${i}_light`, "sphere", [x, 3.65, z], [0.5, 0, 0], C.luz, { emissive: true });
  });

  /* --- Bancos alrededor de la fuente ------------------------------------- */
  const benches: [number, number, number][] = [
    [c - 6.8, fz, Math.PI / 2], [c + 6.8, fz, Math.PI / 2], [c, fz - 6.8, 0], [17.5, 36, Math.PI / 2], [46.5, 36, Math.PI / 2],
  ];
  benches.forEach(([x, z, yaw], i) => {
    prim(`bench_${i}`, "box", [x, 0.32, z], [2.2, 0.45, 0.6], C.madera, { r: quat(yaw) });
  });

  return out;
}
