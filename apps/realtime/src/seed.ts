import { type Components } from "@xenxo/protocol";
import plazaLayout from "./plaza-layout.json";
import { SEED_ASSETS } from "./seed-assets";

/**
 * La plaza inicial también es DATOS, no código del cliente: cualquier cliente
 * (web, VR, nativo, headless) la recibe igual en el SNAPSHOT.
 *
 * Desde la v4 la arquitectura son modelos glTF generados por la forja (tools/forge):
 * soportales, balcones de forja, campanario con cúpula de azulejo, fuente, farolas,
 * naranjos y suelo, cada uno con su oclusión horneada y dos niveles de detalle.
 * Los materiales "xenxo:<biblioteca>" los viste el cliente con texturas reales; los neones,
 * ventanas y faroles se encienden de noche. Este archivo coloca las piezas, sus
 * colisionadores, los carteles (label@1, traducibles) y las luces (light@1).
 *
 * Sube SEED_VERSION cuando cambies algo aquí o en plaza-layout.json: el servidor
 * sustituye las entidades del sistema y conserva las de personas y agentes.
 */
export const SEED_VERSION = 4;

type P2 = [number, number];
interface Layout {
  fountain: P2;
  spawn: P2;
  tower: { p: P2; facing: number };
  buildings: { id: string; p: P2; facing: number; w: number; d: number; floors: number[]; arcade: boolean; neon: string; name?: { es: string; en: string } }[];
  gate: { p: P2; facing: number; span: number };
  lamps: P2[];
  trees: P2[];
  benches: [number, number, number][];
  terrace: P2[];
}
const layout = plazaLayout as unknown as Layout;

type V3 = [number, number, number];
type Q = [number, number, number, number];

/** Giro alrededor del eje Y (grados): el +Z local apunta hacia (sin, cos) en el mundo. */
function yaw(deg: number): Q {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
}

/** Punto local (x, y, z) de una pieza girada `deg` y situada en (px, pz) → mundo. */
function at(px: number, pz: number, deg: number, x: number, y: number, z: number): V3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [px + x * c + z * s, y, pz - x * s + z * c];
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const r3 = (v: V3): V3 => [round(v[0]), round(v[1]), round(v[2])];

export function plazaSeed(): { id: string; components: Components }[] {
  const out: { id: string; components: Components }[] = [];

  const mesh = (id: string, asset: string, p: V3, deg = 0, collider?: V3) => {
    const a = SEED_ASSETS[asset];
    if (!a) throw new Error(`falta el modelo de la forja: ${asset}`);
    const components: Components = {
      "transform@1": { p: r3(p), r: yaw(deg), s: [1, 1, 1], parent: null },
      "mesh@1": { lods: a.lods.map((l) => ({ hash: l.hash, media: "model/gltf-binary" as const, tris: l.tris })) },
    };
    if (collider) components["collider@1"] = { shape: "box", half_extents: collider, trigger: false };
    out.push({ id, components });
  };

  /** Colisionador suelto (sin geometría): para paredes, columnas y obstáculos. */
  const solid = (id: string, p: V3, deg: number, half: V3) => {
    out.push({
      id,
      components: {
        "transform@1": { p: r3(p), r: yaw(deg), s: [1, 1, 1], parent: null },
        "collider@1": { shape: "box", half_extents: half, trigger: false },
      },
    });
  };

  const light = (id: string, p: V3, color: string, intensity: number, range: number) => {
    out.push({
      id,
      components: {
        "transform@1": { p: r3(p), r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
        "light@1": { type: "point", color, intensity, range, when: "night" },
      },
    });
  };

  const label = (id: string, p: V3, deg: number, text: string, i18n: Record<string, string>, size: number) => {
    out.push({
      id,
      components: {
        "transform@1": { p: r3(p), r: yaw(deg), s: [1, 1, 1], parent: null },
        "label@1": { text, i18n, billboard: false, size },
      },
    });
  };

  /* --- Suelo ----------------------------------------------------------------- */
  // La plaza queda a y = 0 (donde se camina); las calles y las casas, 12 cm por debajo.
  const STREET = -0.12;
  mesh("ground", "ground", [32, STREET, 32]);

  /* --- Casas de la plaza ------------------------------------------------------ */
  for (const b of layout.buildings) {
    const [px, pz] = b.p;
    const f = b.facing;
    const W = b.w, D = b.d;
    const H0 = b.floors[0]!;
    mesh(b.id, b.id, [px, STREET, pz], f);
    // Colisión: el bloque detrás de los soportales (que se pueden recorrer), sus laterales y columnas.
    const A = b.arcade ? 3.2 : 0;
    const back = (D - A) / 2;
    solid(`${b.id}_solid`, at(px, pz, f, 0, 5, -D / 2 + back), f, [W / 2, 5, back]);
    if (b.arcade) {
      for (const sx of [-1, 1]) solid(`${b.id}_end_${sx < 0 ? "l" : "r"}`, at(px, pz, f, sx * (W / 2 - 0.3), 2, D / 2 - A / 2), f, [0.33, 2, A / 2]);
      let n = Math.max(3, Math.round(W / 3));
      if (n % 2 === 0) n -= 1;
      const bay = W / n;
      for (let k = 1; k < n; k++) solid(`${b.id}_col_${k}`, at(px, pz, f, -W / 2 + bay * k, 1.5, D / 2 - 0.3), f, [0.3, 1.5, 0.3]);
    }
    // Cartel del barrio sobre el panel de azulejo, y su luz de neón para la noche.
    if (b.name) {
      const signY = STREET + H0 + 1.775;
      label(`${b.id}_label`, at(px, pz, f, 0, signY, D / 2 + 0.2), f, b.name.en, { es: b.name.es, en: b.name.en }, 0.58);
      light(`${b.id}_glow`, at(px, pz, f, 0, signY - 0.6, D / 2 + 1.6), b.neon, 2.2, 9);
    }
  }

  /* --- Puerta de la plaza ------------------------------------------------------ */
  {
    const { p: [px, pz], facing: f, span } = layout.gate;
    mesh("gate_arch", "gate", [px, STREET, pz], f);
    for (const sx of [-1, 1]) solid(`gate_pillar_${sx < 0 ? "l" : "r"}`, at(px, pz, f, sx * (span / 2 + 0.65), 4, 0), f, [0.8, 4, 0.75]);
    const top = 4.2 + span / 2 + 1.4;
    label("gate_label", at(px, pz, f, 0, STREET + top - 0.62, 0.74), f, "xenxo.io", {}, 0.78);
    light("gate_glow", at(px, pz, f, 0, 3.2, 1.6), "#4fa3ff", 2, 8);
  }

  /* --- Campanario ------------------------------------------------------------- */
  {
    const [px, pz] = layout.tower.p;
    const f = layout.tower.facing;
    mesh("tower_body", "tower", [px, STREET, pz], f, [3, 7, 3]);
    label("tower_logo", at(px, pz, f, 0, STREET + 8.4, 2.85), f, "xenxo.io", {}, 0.95);
    light("tower_beacon", [px, STREET + 26.2, pz], "#ff6a3d", 4, 18);
  }

  /* --- Fuente ------------------------------------------------------------------ */
  {
    const [fx, fz] = layout.fountain;
    mesh("fountain", "fountain", [fx, 0, fz], 0, [3.6, 0.6, 3.6]);
  }

  /* --- Punto de aparición: luz del emblema --------------------------------- */
  light("spawn_glow", [layout.spawn[0], 0.35, layout.spawn[1]], "#4fa3ff", 0.8, 4);

  /* --- Mobiliario ------------------------------------------------------------- */
  layout.lamps.forEach(([x, z], i) => {
    mesh(`lamp_${i}`, "lamp", [x, 0, z], 0, [0.2, 1.8, 0.2]);
    light(`lamp_${i}_light`, [x, 3.6, z], "#ffcf7a", 3, 12);
  });
  layout.trees.forEach(([x, z], i) => mesh(`tree_${i}`, "orange_tree", [x, 0, z], (i * 67) % 360, [0.25, 1, 0.25]));
  layout.benches.forEach(([x, z, f], i) => mesh(`bench_${i}`, "bench", [x, 0, z], f, [0.95, 0.45, 0.3]));
  layout.terrace.forEach(([x, z], i) => mesh(`terrace_${i}`, "terrace", [x, 0, z], i * 40, [0.6, 0.4, 0.6]));

  return out;
}
