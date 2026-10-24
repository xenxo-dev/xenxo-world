import { CHUNK_SIZE, type Components } from "@xenxo/protocol";

/**
 * La plaza inicial también es DATOS, no código del cliente.
 * Cualquier cliente (web, VR, nativo, headless) la ve igual porque la recibe en el SNAPSHOT.
 *
 * Tamaños de primitive@1:
 *   box = [ancho, alto, fondo] · sphere = [diámetro, -, -] · cylinder = [diámetro, alto, -] · plane = [ancho, -, fondo]
 */
export function plazaSeed(): { id: string; components: Components }[] {
  const c = CHUNK_SIZE / 2;
  const out: { id: string; components: Components }[] = [];
  const put = (id: string, components: Components) => out.push({ id, components });

  put("plaza_floor", {
    "transform@1": { p: [c, -0.05, c], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
    "primitive@1": { shape: "cylinder", size: [52, 0.1, 0], color: "#2a2f63", emissive: false },
  });
  put("plaza_spawn", {
    "transform@1": { p: [c, 0.02, c + 7], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
    "primitive@1": { shape: "cylinder", size: [3.5, 0.04, 0], color: "#22d3ee", emissive: true },
  });
  put("plaza_tower", {
    "transform@1": { p: [c, 9, c], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
    "primitive@1": { shape: "cylinder", size: [2.4, 18, 0], color: "#6d5dfc", emissive: true },
    "collider@1": { shape: "box", half_extents: [1.2, 9, 1.2], trigger: false },
  });
  put("plaza_logo", {
    "transform@1": { p: [c, 20, c], r: [0, 0, 0, 1], s: [1, 1, 1], parent: null },
    "label@1": { text: "xenxo.io", billboard: true, size: 2.4 },
  });

  const districts: [string, string, string][] = [
    ["arcade", "Arcade", "#f472b6"],
    ["projects", "Projects", "#60a5fa"],
    ["agents", "Agents", "#fbbf24"],
    ["sandbox", "Sandbox", "#34d399"],
    ["social", "Social", "#a78bfa"],
  ];
  const radius = 19;
  districts.forEach(([id, name, color], i) => {
    // Abanico detrás de la torre, mirando al punto de aparición.
    const a = Math.PI + (i - 2) * 0.62;
    const x = c + Math.sin(a) * radius;
    const z = c + Math.cos(a) * radius;
    const yaw = a + Math.PI; // de cara al centro
    const r: [number, number, number, number] = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    put(`district_${id}`, {
      "transform@1": { p: [x, 2.5, z], r, s: [1, 1, 1], parent: null },
      "primitive@1": { shape: "box", size: [8, 5, 6], color: "#4a4f96", emissive: false },
      "collider@1": { shape: "box", half_extents: [4, 2.5, 3], trigger: false },
    });
    put(`district_${id}_sign`, {
      "transform@1": { p: [x, 6.2, z], r, s: [1, 1, 1], parent: null },
      "primitive@1": { shape: "box", size: [6, 1.1, 0.2], color, emissive: true },
    });
    put(`district_${id}_label`, {
      "transform@1": { p: [x, 7.6, z], r, s: [1, 1, 1], parent: null },
      "label@1": { text: name, billboard: true, size: 1.1 },
    });
  });

  return out;
}
