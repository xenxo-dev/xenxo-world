/**
 * Por dónde anda la gente de las ciudades (city/citizens.ts) y adónde va.
 *
 * - **Aceras**: un grafo sacado de la misma disposición que la forja (districts.json `city`: el
 *   anillo de cada manzana, a 1 m del bordillo) y, en Distrito Cero, sus pasajes, la pasarela a 8 m
 *   y sus dos escaleras (como en tools/forge/cero.py). Dos puntos se unen si uno se ve desde el otro:
 *   sin cajas de la ciudad en medio a la altura del cuerpo (así se cruza la calle por donde se puede
 *   y no se atraviesan esquinas). Los caminos, con A*.
 * - **Sitios**: bancos (los asientos de la forja), máquinas recreativas, expendedoras, la puerta de
 *   las salas (escaparates), anuncios de fachada y paneles, los rincones de la calle de Cero (donde
 *   antes había gente quieta: charlas, un bailarín y su público) y esquinas para esperar. Cada sitio
 *   dice dónde ponerse, hacia dónde mirar, qué hacer y cuánto tiempo; lo ocupa un ciudadano a la vez.
 *
 * Solo datos y aritmética (sin Three.js): también corre en Node (test/citizens.mts).
 */
import districts from "../../../../realtime/src/districts.json";
import cities from "../../../../realtime/src/district-cities.json";
import lives from "../../../../realtime/src/district-interiors.json";
import activities from "../../../../realtime/src/district-activities.json";

/** Una caja de la ciudad, en planta (giro c, s como en collision.ts) y de qué altura a qué altura. */
export interface Box2 {
  x: number;
  z: number;
  hx: number;
  hz: number;
  c: number;
  s: number;
  y0: number;
  y1: number;
  /** Radio de la circunferencia que la contiene (para descartar rápido). */
  r: number;
}

export interface NavNode {
  x: number;
  y: number;
  z: number;
  links: number[];
  /** Escalera: el tramo no se comprueba con cajas (los escalones están debajo del camino). */
  stairs?: boolean;
}

export type PoiKind = "sit" | "play" | "vend" | "window" | "look" | "hang" | "dance" | "watch" | "corner";

export interface Poi {
  kind: PoiKind;
  x: number;
  y: number;
  z: number;
  /** Giro del cuerpo al llegar (adelante = (−sin, −cos)). */
  yaw: number;
  /** Adónde se mira mientras tanto (un anuncio, una puerta, quien baila). */
  look: [number, number, number] | null;
  /** Gesto mientras se está (o null: de pie, mirando el móvil a ratos). */
  emote: string | null;
  /** Cuánto se queda (s). */
  stay: [number, number];
  /** Por dónde se llega (el punto del mapa): delante del sitio (en un banco, un paso por delante). */
  ax: number;
  az: number;
  node: number;
  /** Quién lo ocupa (id del ciudadano) o −1. */
  taken: number;
  /** Los sitios de una misma charla (gente de la calle de Cero) comparten grupo. */
  group: number;
}

export interface CityNav {
  id: string;
  nodes: NavNode[];
  pois: Poi[];
  boxes: Box2[];
  /** Por dónde se anda (x0, z0, x1, z1), con margen. */
  area: [number, number, number, number];
}

interface City {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  block: number;
  street: number;
}
interface Prop {
  piece: string;
  p: [number, number, number];
  yaw: number;
  half: [number, number, number];
}
interface Acts {
  props?: Prop[];
  billboards?: { p: [number, number, number]; yaw: number; size: [number, number] }[];
  labels?: { p: [number, number, number]; yaw: number; flat?: boolean }[];
}
interface Life {
  rooms: { rect: [number, number, number, number]; y1: number; door: { x: number; z: number; axis: "x" | "z"; w: number; y: number } }[];
  npcs: { x: number; y: number; z: number; yaw: number; pose: string; room: number }[];
}

const CITY = (districts as unknown as { city: City }).city;
const BY_CHUNK = new Map((districts.districts as { id: string; chunk: string }[]).map((d) => [d.chunk, d.id]));
const BOXES = (cities as unknown as { cities: Record<string, number[][]> }).cities;
const LIFE = (lives as unknown as { districts: Record<string, Life> }).districts;
const ACTS = activities as unknown as Record<string, Acts | undefined>;

/** Lo más largo que se une a la vista (m): cruza una calle (9 m entre aceras), no una manzana. */
const LINK = 10.5;
/** Separación de los puntos de cada anillo (m). */
const SPACING = 7.5;
/** Holgura de un cuerpo contra las cajas al comprobar si se ve (m). */
const BODY_R = 0.32;
/** Cuánto por delante del centro de un asiento van los pies (collision.ts → SIT_FORWARD). */
const SIT_FORWARD = 0.3;
const DEG = Math.PI / 180;

/** Distrito de un chunk (o null). */
export const districtOfChunk = (chunk: string) => BY_CHUNK.get(chunk) ?? null;

/** Aleatorio con semilla (mulberry32): los mismos ciudadanos y sitios cada vez. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const seedOf = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Giro del cuerpo para mirar hacia (dx, dz) (adelante = (−sin, −cos)). */
export const faceYaw = (dx: number, dz: number) => Math.atan2(-dx, -dz);

function box(x: number, y0: number, z: number, hx: number, hz: number, y1: number, deg = 0): Box2 {
  const a = deg * DEG;
  return { x, z, hx, hz, c: Math.cos(a), s: Math.sin(a), y0, y1, r: Math.hypot(hx, hz) };
}

/**
 * ¿Se va en línea recta de (ax, az) a (bx, bz) a la altura `y` sin chocar con ninguna caja (con la
 * holgura de un cuerpo)? Las cajas que no llegan a la rodilla o empiezan por encima de la cabeza no
 * cuentan.
 */
export function clearLine(boxes: readonly Box2[], ax: number, az: number, bx: number, bz: number, y: number, r = BODY_R): boolean {
  const lo = y + 0.4, hi = y + 1.6;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2, half = Math.hypot(bx - ax, bz - az) / 2;
  for (const b of boxes) {
    if (b.y1 < lo || b.y0 > hi) continue;
    if (Math.hypot(b.x - mx, b.z - mz) > half + b.r + r) continue;
    // Al espacio de la caja (como resolveCircle) y prueba del segmento contra el rectángulo crecido.
    const ex = b.hx + r, ez = b.hz + r;
    const dax = ax - b.x, daz = az - b.z, dbx = bx - b.x, dbz = bz - b.z;
    const p0x = dax * b.c - daz * b.s, p0z = dax * b.s + daz * b.c;
    const p1x = dbx * b.c - dbz * b.s, p1z = dbx * b.s + dbz * b.c;
    if (segmentHitsRect(p0x, p0z, p1x, p1z, ex, ez)) return false;
  }
  return true;
}

function segmentHitsRect(x0: number, z0: number, x1: number, z1: number, ex: number, ez: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, x0 + ex) && clip(dx, ex - x0) && clip(-dz, z0 + ez) && clip(dz, ez - z0) && t0 <= t1;
}

/** ¿Está el punto dentro de alguna caja (en planta, con holgura) a la altura `y`? */
export function blocked(boxes: readonly Box2[], x: number, z: number, y: number, r = BODY_R): boolean {
  for (const b of boxes) {
    if (b.y1 < y + 0.4 || b.y0 > y + 1.6) continue;
    const dx = x - b.x, dz = z - b.z;
    if (dx * dx + dz * dz > (b.r + r) ** 2) continue;
    const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
    if (Math.abs(lx) < b.hx + r && Math.abs(lz) < b.hz + r) return true;
  }
  return false;
}

/** Puntos de un rectángulo (x0, z0)–(x1, z1), en orden, separados como mucho SPACING. */
function ring(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const corners: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const out: [number, number][] = [];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k]!, [bx, bz] = corners[(k + 1) % 4]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / SPACING));
    for (let i = 0; i < n; i++) out.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
  }
  return out;
}

/* --- Distrito Cero: pasajes, pasarela y escaleras (tools/forge/cero.py) --- */
const CERO = {
  passages: [
    [29, -19.5, 35, 19],
    [29, 45, 35, 83.5],
    [-19.5, 29, 19, 35],
    [45, 29, 83.5, 35],
  ] as [number, number, number, number][],
  walk: { rect: [13.5, 13.5, 50.5, 50.5] as [number, number, number, number], y: 8 },
  /** Escaleras: arriba (en el vestíbulo) y abajo (en la calle). */
  stairs: [
    { top: [13.5, 8, 56], foot: [13.5, 0, 66.6] },
    { top: [50.5, 8, 8], foot: [50.5, 0, -2.6] },
  ] as { top: [number, number, number]; foot: [number, number, number] }[],
};

/** El mapa de un distrito (null si no tiene ciudad). */
export function buildNav(id: string): CityNav | null {
  const raw = BOXES[id];
  if (!raw) return null;
  const life = LIFE[id];
  const acts = ACTS[id];
  const boxes: Box2[] = raw.map(([x, y, z, hx, hy, hz, deg]) => box(x!, y! - hy!, z!, hx!, hz!, y! + hy!, deg ?? 0));
  for (const p of acts?.props ?? []) boxes.push(box(p.p[0], p.p[1], p.p[2], p.half[0], p.half[2], p.p[1] + p.half[1] * 2, p.yaw));

  const nodes: NavNode[] = [];
  const add = (x: number, y: number, z: number, stairs = false): number => {
    nodes.push({ x, y, z, links: [], ...(stairs ? { stairs } : {}) });
    return nodes.length - 1;
  };
  const link = (a: number, b: number) => {
    if (a === b || nodes[a]!.links.includes(b)) return;
    nodes[a]!.links.push(b);
    nodes[b]!.links.push(a);
  };

  // Anillos de las manzanas (a 1 m del bordillo, ya en la calzada, como los recorridos de antes).
  const { x0, z0, block, street } = CITY;
  const rings: [number, number, number, number][] = [];
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) {
      const bx = x0 + i * (block + street), bz = z0 + j * (block + street);
      rings.push([bx - 1, bz - 1, bx + block + 1, bz + block + 1]);
    }
  if (id === "cero") rings.push(...CERO.passages);
  for (const [a, b, c, d] of rings) for (const [x, z] of ring(a, b, c, d)) if (!blocked(boxes, x, z, 0)) add(x, 0, z);
  if (id === "cero") {
    const [a, b, c, d] = CERO.walk.rect;
    for (const [x, z] of ring(a, b, c, d)) add(x, CERO.walk.y, z);
  }
  // Uniones a la vista, a la misma altura y no muy lejos.
  const visible = (a: NavNode, b: NavNode) => Math.abs(a.y - b.y) < 0.5 && Math.hypot(a.x - b.x, a.z - b.z) <= LINK && clearLine(boxes, a.x, a.z, b.x, b.z, Math.min(a.y, b.y));
  const base = nodes.length;
  for (let i = 0; i < base; i++) for (let j = i + 1; j < base; j++) if (visible(nodes[i]!, nodes[j]!)) link(i, j);
  // Escaleras de Cero: el pie y lo alto, unidos sin comprobar cajas; cada uno, a lo que vea.
  if (id === "cero") {
    for (const s of CERO.stairs) {
      const top = add(s.top[0], s.top[1], s.top[2], true);
      const foot = add(s.foot[0], s.foot[1], s.foot[2], true);
      link(top, foot);
      for (let i = 0; i < base; i++) {
        if (visible(nodes[top]!, nodes[i]!)) link(top, i);
        if (visible(nodes[foot]!, nodes[i]!)) link(foot, i);
      }
    }
  }

  const nav: CityNav = { id, nodes, pois: [], boxes, area: [x0 - 4, z0 - 4, CITY.x1 + 4, CITY.z1 + 4] };
  if (id === "cero") nav.area = [-22, -22, 86, 86];

  /* --- Sitios --- */
  const rooms = life?.rooms ?? [];
  const inRoom = (x: number, z: number) => rooms.some((r) => x > r.rect[0] - 0.2 && x < r.rect[2] + 0.2 && z > r.rect[1] - 0.2 && z < r.rect[3] + 0.2);
  let groups = 0;
  /** Un sitio; `ahead`: a cuánto por delante de él (hacia donde mira quien está) se llega. */
  const poi = (kind: PoiKind, x: number, y: number, z: number, yaw: number, stay: [number, number], emote: string | null, look: Poi["look"] = null, group = -1, ahead = 0) => {
    const ax = x - Math.sin(yaw) * ahead, az = z - Math.cos(yaw) * ahead;
    if (inRoom(x, z) || blocked(boxes, ax, az, y, 0.22)) return;
    nav.pois.push({ kind, x, y, z, yaw, look, emote, stay, ax, az, node: -1, taken: -1, group });
  };
  // Bancos (cajas con giro, séptimo valor): uno o dos sitios, con los pies por delante del asiento.
  for (const [x, y, z, hx, hy, , deg] of raw) {
    if (deg === undefined || hy! > 0.55 || hx! < 0.6) continue;
    const a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
    const fx = x! + SIT_FORWARD * s, fz = z! + SIT_FORWARD * c;
    const spots = hx! >= 0.85 ? [-0.45, 0.45] : [0];
    // Los pies, al nivel del suelo de alrededor del banco.
    const ground = y! - hy!;
    for (const off of spots) poi("sit", fx + off * c, ground, fz - off * s, a + Math.PI, [18, 45], "sit", null, -1, 0.55);
  }
  // Máquinas recreativas y expendedoras: delante de su frente (su +Z), mirándolas.
  for (const p of acts?.props ?? []) {
    const a = p.yaw * DEG, fx = Math.sin(a), fz = Math.cos(a);
    const d = p.half[2] + 0.5;
    const look: [number, number, number] = [p.p[0] + fx * p.half[2], p.p[1] + 1.25, p.p[2] + fz * p.half[2]];
    if (p.piece === "arcade_cabinet") poi("play", p.p[0] + fx * d, p.p[1], p.p[2] + fz * d, faceYaw(-fx, -fz), [14, 40], "arcade", look);
    else if (p.piece === "prop_vending") poi("vend", p.p[0] + fx * d, p.p[1], p.p[2] + fz * d, faceYaw(-fx, -fz), [5, 9], "interact", look);
  }
  // La puerta de cada sala: un par de sitios fuera, mirando hacia dentro (como quien mira el escaparate).
  for (const r of rooms) {
    const d = r.door;
    const cx = (r.rect[0] + r.rect[2]) / 2, cz = (r.rect[1] + r.rect[3]) / 2;
    // Hacia fuera: perpendicular al muro de la puerta, lejos del centro de la sala.
    const nx = d.axis === "x" ? 0 : Math.sign(d.x - cx) || 1;
    const nz = d.axis === "x" ? Math.sign(d.z - cz) || 1 : 0;
    const ux = d.axis === "x" ? 1 : 0, uz = d.axis === "x" ? 0 : 1;
    const look: [number, number, number] = [d.x, d.y + 1.6, d.z];
    for (const off of [-(d.w / 2 + 0.9), d.w / 2 + 0.9]) poi("window", d.x + nx * 1.4 + ux * off, d.y, d.z + nz * 1.4 + uz * off, faceYaw(-nx, -nz), [6, 14], null, look);
  }
  // Anuncios de fachada (Cero): desde la calle, a unos metros, mirando arriba.
  for (const b of acts?.billboards ?? []) {
    const a = b.yaw * DEG, fx = Math.sin(a), fz = Math.cos(a);
    for (const dist of [7, 5, 9]) {
      const x = b.p[0] + fx * dist, z = b.p[2] + fz * dist;
      if (blocked(boxes, x, z, 0)) continue;
      poi("look", x, 0, z, faceYaw(-fx, -fz), [5, 10], null, [b.p[0], b.p[1], b.p[2]]);
      break;
    }
  }
  // La pasarela de Cero (a 8 m): asomarse a la barandilla, hacia la ciudad o hacia la Torre Cero.
  if (id === "cero") {
    const [A, , B] = CERO.walk.rect, y = CERO.walk.y, mid = (A + B) / 2;
    for (const line of [A, B])
      for (const across of [true, false]) {
        // Cada tramo: uno mirando afuera y otro adentro, a 1,35 m de la línea (la barandilla, a 2 m).
        const ox = across ? 0 : Math.sign(line - mid), oz = across ? Math.sign(line - mid) : 0;
        for (const [t, out] of [[0.4, 1], [0.6, -1]] as const) {
          const along = A + (B - A) * t;
          const x = (across ? along : line) + ox * out * 1.35, z = (across ? line : along) + oz * out * 1.35;
          const look: [number, number, number] = out > 0 ? [x + ox * 30, y + 2, z + oz * 30] : [mid, 20, mid];
          poi("look", x, y, z, faceYaw(ox * out, oz * out), [8, 22], null, look);
        }
      }
  }
  // Paneles de pie (Taller): delante, leyéndolos.
  for (const l of acts?.labels ?? []) {
    if (l.flat || l.p[1] > 4) continue;
    const a = l.yaw * DEG, fx = Math.sin(a), fz = Math.cos(a);
    poi("look", l.p[0] + fx * 1.6, 0, l.p[2] + fz * 1.6, faceYaw(-fx, -fz), [6, 12], null, [l.p[0], l.p[1], l.p[2]]);
  }
  // La gente de la calle de Cero (la forja: cero.py → street_life): sus sitios, ahora para cualquiera.
  // Los que charlan juntos (a menos de 2,2 m) son un grupo; los de pie junto a quien baila, su público.
  const people = (life?.npcs ?? []).filter((n) => n.room < 0 && n.pose !== "sit");
  const groupOf = new Map<number, number>();
  people.forEach((n, i) => {
    if (groupOf.has(i)) return;
    const g = groups++;
    const stack = [i];
    groupOf.set(i, g);
    while (stack.length) {
      const k = stack.pop()!;
      people.forEach((m, j) => {
        if (!groupOf.has(j) && Math.hypot(m.x - people[k]!.x, m.z - people[k]!.z) < 2.2) {
          groupOf.set(j, g);
          stack.push(j);
        }
      });
    }
  });
  people.forEach((n, i) => {
    const a = n.yaw * DEG;
    const yaw = a + Math.PI;
    const g = groupOf.get(i)!;
    const dancer = people.find((m, j) => m.pose === "dance" && groupOf.get(j) === g);
    if (n.pose === "dance") poi("dance", n.x, n.y, n.z, yaw, [20, 45], "dance", null, g);
    else if (dancer && n.pose === "idle") poi("watch", n.x, n.y, n.z, faceYaw(dancer.x - n.x, dancer.z - n.z), [12, 30], null, [dancer.x, 1.4, dancer.z], g);
    else poi("hang", n.x, n.y, n.z, yaw, [15, 40], n.pose === "talk" ? "talk" : null, null, g);
  });
  // Esquinas para esperar o mirar el móvil: algunas de los anillos, un paso hacia el lado de la manzana.
  const r = rng(seedOf(`corners-${id}`));
  for (const [a, b, c, d] of rings.slice(0, 9)) {
    const cx = (a + c) / 2, cz = (b + d) / 2;
    for (const [x, z] of ring(a, b, c, d)) {
      if (r() > 0.22) continue;
      const dx = cx - x, dz = cz - z, l = Math.hypot(dx, dz) || 1;
      const px = x + (dx / l) * 1.2, pz = z + (dz / l) * 1.2;
      poi("corner", px, 0, pz, faceYaw(-dx / l, -dz / l), [6, 18], r() < 0.6 ? "phone" : null);
    }
  }

  // Cada sitio, a los puntos que ve (el más cercano primero); si no ve ninguno, se queda fuera.
  for (const p of nav.pois) {
    const near = nodes
      .map((n, i) => ({ i, d: Math.hypot(n.x - p.ax, n.z - p.az) + Math.abs(n.y - p.y) * 4 }))
      .filter((o) => o.d < 16)
      .sort((u, v) => u.d - v.d);
    const at = add(p.ax, p.y, p.az);
    let linked = 0;
    for (const o of near) {
      const n = nodes[o.i]!;
      if (o.i >= at || Math.abs(n.y - p.y) > 0.5) continue;
      if (!clearLine(boxes, p.ax, p.az, n.x, n.z, p.y, 0.24)) continue;
      link(at, o.i);
      if (++linked >= 3) break;
    }
    p.node = linked ? at : -1;
  }
  // Solo lo que está unido a la parte más grande (la calle, con la pasarela por sus escaleras).
  const comp = components(nodes);
  const sizes = new Map<number, number>();
  for (const c of comp) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  let main = -1, best = -1;
  for (const [c, n] of sizes) if (n > best) (best = n), (main = c);
  nav.pois = nav.pois.filter((p) => p.node >= 0 && comp[p.node] === main);
  for (let i = 0; i < nodes.length; i++) if (comp[i] !== main) nodes[i]!.links = [];
  return nav;
}

function components(nodes: NavNode[]): number[] {
  const comp = new Array<number>(nodes.length).fill(-1);
  let c = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i]! >= 0) continue;
    const stack = [i];
    comp[i] = c;
    while (stack.length) {
      const k = stack.pop()!;
      for (const j of nodes[k]!.links)
        if (comp[j]! < 0) {
          comp[j] = c;
          stack.push(j);
        }
    }
    c++;
  }
  return comp;
}

/** El punto del mapa más cercano a (x, y, z) que se ve desde ahí (si no se ve ninguno, el más cercano). */
export function nearestNode(nav: CityNav, x: number, y: number, z: number): number {
  let best = -1, bestD = Infinity, seen = -1, seenD = Infinity;
  for (let i = 0; i < nav.nodes.length; i++) {
    const n = nav.nodes[i]!;
    if (!n.links.length) continue;
    const d = Math.hypot(n.x - x, n.z - z) + Math.abs(n.y - y) * 4;
    if (d < bestD) (bestD = d), (best = i);
    if (d < seenD && d < 14 && Math.abs(n.y - y) < 1 && clearLine(nav.boxes, x, z, n.x, n.z, Math.min(y, n.y), 0.24)) (seenD = d), (seen = i);
  }
  return seen >= 0 ? seen : best;
}

/**
 * Camino (A*) de `from` a `to`: los puntos del mapa en orden (sin `from`), o null si no se llega.
 * Las escaleras cuestan algo más (se va más despacio).
 */
export function findPath(nav: CityNav, from: number, to: number): number[] | null {
  if (from < 0 || to < 0) return null;
  if (from === to) return [to];
  const N = nav.nodes;
  const g = new Map<number, number>([[from, 0]]);
  const came = new Map<number, number>();
  const h = (i: number) => Math.hypot(N[i]!.x - N[to]!.x, N[i]!.z - N[to]!.z) + Math.abs(N[i]!.y - N[to]!.y);
  const open: [number, number][] = [[h(from), from]];
  const closed = new Set<number>();
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k]![0] < open[bi]![0]) bi = k;
    const [, cur] = open.splice(bi, 1)[0]!;
    if (cur === to) {
      const out = [to];
      let c = to;
      while (came.has(c)) {
        c = came.get(c)!;
        if (c !== from) out.push(c);
      }
      return out.reverse();
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    const a = N[cur]!;
    for (const j of a.links) {
      if (closed.has(j)) continue;
      const b = N[j]!;
      const step = Math.hypot(b.x - a.x, b.z - a.z) + Math.abs(b.y - a.y) * (a.stairs && b.stairs ? 1.5 : 3);
      const ng = g.get(cur)! + step;
      if (ng < (g.get(j) ?? Infinity)) {
        g.set(j, ng);
        came.set(j, cur);
        open.push([ng + h(j), j]);
      }
    }
  }
  return null;
}
