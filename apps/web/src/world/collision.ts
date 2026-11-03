/**
 * Colisiones del personaje con el mundo:
 *
 * - **Cajas** (collider@1): orientadas, las de siempre (edificios, muros, escalones, bancos).
 * - **Mallas** (collider@1 con `from_mesh`): la forma real del modelo de la entidad (monumentos,
 *   esculturas, atrezo), con three-mesh-bvh. Mientras el modelo no ha llegado, vale su caja.
 *   Rampas y pendientes: el suelo sale de la malla (hasta ~55°); más empinado es pared.
 * - **Gente** (los ciudadanos de las ciudades, city/citizens.ts, y los residentes de las salas): cilindros
 *   que se mueven; no se atraviesan.
 *
 * El jugador es un cilindro (círculo en XZ con pies y cabeza; contra mallas, una cápsula). Las
 * cajas bajas se suben; sobre las demás se camina si se llega saltando. La cámara se acerca si
 * una pared se interpone. Sin objetos nuevos por frame: todo usa objetos de módulo.
 */
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { ColliderV1, TransformV1 } from "@xenxo/protocol";
import { world } from "../net/world-store";

interface Box {
  x: number;
  y: number;
  z: number;
  /** Medio tamaño en el espacio de la caja. */
  hx: number;
  hy: number;
  hz: number;
  /** Giro alrededor de Y (coseno y seno). */
  c: number;
  s: number;
  /** No es del mundo (el coche aparcado propio): no entra en la física del coche. */
  dyn?: boolean;
}

let boxes: Box[] = [];
/** El coche propio cuando está quieto (aparcado, o al subir y bajar): el personaje lo rodea. */
let vehicleBox: Box | null = null;
let vehicleVersion = 0;
let seenVehicleVersion = -1;
export function setVehicleBox(b: Omit<Box, "dyn"> | null) {
  vehicleBox = b ? { ...b, dyn: true } : null;
  vehicleVersion++;
}
let version = -1;
let seenMeshVersion = -1;

/* --- Mallas --- */

interface MeshCol {
  bvh: MeshBVH;
  box: THREE.Box3;
}
const meshCols = new Map<string, MeshCol>();
let meshVersion = 0;

/**
 * Registra (o quita, con null) la malla de colisión de una entidad: geometría ya en coordenadas
 * del lugar. Mientras está, su caja de reserva no cuenta.
 */
export function setMeshCollider(id: string, geometry: THREE.BufferGeometry | null) {
  const old = meshCols.get(id);
  if (old) {
    old.bvh.geometry.dispose();
    meshCols.delete(id);
  }
  if (geometry) {
    geometry.computeBoundingBox();
    meshCols.set(id, { bvh: new MeshBVH(geometry, { maxLeafSize: 8 }), box: geometry.boundingBox!.clone() });
  }
  meshVersion++;
}

/**
 * Lo sólido del lugar para la física del coche (world/vehicle): una versión que cambia cuando
 * cambian las cajas o las mallas, y las cajas y mallas mismas (ya en coordenadas del lugar).
 */
export function solidsVersion(): number {
  refresh();
  return version * 4096 + seenMeshVersion;
}
export function forEachSolidBox(cb: (b: Readonly<Box>) => void) {
  refresh();
  for (const b of boxes) if (!b.dyn) cb(b);
}
export function forEachSolidMesh(cb: (id: string, positions: Float32Array, index: Uint32Array | null) => void) {
  for (const [id, m] of meshCols) {
    const g = m.bvh.geometry;
    const pos = g.getAttribute("position").array as Float32Array;
    const idx = g.getIndex();
    cb(id, pos, idx ? (idx.array instanceof Uint32Array ? idx.array : Uint32Array.from(idx.array)) : null);
  }
}

/** Cuántas mallas de colisión hay (pruebas y depuración). */
export const meshColliderCount = () => meshCols.size;

/* --- Gente: la escriben CityLife (ciudadanos) e Interiors (residentes) cada frame --- */

export const NPC_RADIUS = 0.3;
/** Huecos de los ciudadanos: [0, NPC_CITY). Los residentes van detrás: [NPC_CITY, NPC_CITY + extra). */
export const NPC_CITY = 32;
const MAX_NPC = 64;
export const npcs = {
  count: 0,
  extra: 0,
  pos: new Float32Array(MAX_NPC * 3),
  /**
   * Atropellos (vehicle/physics.ts) y golpes (people/selfPeople.ts): por hueco, cuándo
   * (performance.now, ms), hacia dónde (x, z) y a qué velocidad, y si fue en la cabeza. Es un aviso:
   * lo recogen (y lo borran) CityLife e Interiors al colocar a la persona (knock.ts).
   */
  knock: new Float32Array(MAX_NPC * 4),
  knockHead: new Uint8Array(MAX_NPC),
  /** Por hueco: el aviso es de un disparo (1: armas, §9 octies ter), no de un golpe ni del coche. */
  knockShot: new Uint8Array(MAX_NPC),
  /** Por hueco: en el suelo (knock.ts). A quien está en el suelo no se le vuelve a dar. */
  down: new Uint8Array(MAX_NPC),
};
/**
 * Las demás personas (multijugador), según su última pose: pies x, y, z. Las escribe
 * people/PeopleFx.tsx cada frame. Son sólidas para el jugador (cada uno se aparta él solo: así no
 * hay que ponerse de acuerdo por la red) y la gente de decorado les cede el paso como al jugador.
 */
export const OTHER_RADIUS = 0.3;
const MAX_OTHERS = 48;
export const others = { count: 0, pos: new Float32Array(MAX_OTHERS * 3), max: MAX_OTHERS };

/** Índice del hueco k de la lista de gente (ciudadanos primero, luego residentes). */
const npcAt = (k: number) => (k < npcs.count ? k : NPC_CITY + k - npcs.count);
/** La gente de ahora, en orden (para la física del coche). */
export const crowd = {
  get count() {
    return npcs.count + npcs.extra;
  },
  at(k: number, out: { x: number; y: number; z: number }) {
    const i = npcAt(k);
    out.x = npcs.pos[i * 3]!;
    out.y = npcs.pos[i * 3 + 1]!;
    out.z = npcs.pos[i * 3 + 2]!;
  },
  /** Le dan a la persona k (`shot`: con un disparo). Devuelve false si ya está en el suelo (no se le da). */
  hit(k: number, nx: number, nz: number, speed: number, head = false, shot = false): boolean {
    const i = npcAt(k);
    if (npcs.down[i]) return false;
    npcs.knock[i * 4] = performance.now();
    npcs.knock[i * 4 + 1] = nx;
    npcs.knock[i * 4 + 2] = nz;
    npcs.knock[i * 4 + 3] = speed;
    npcs.knockHead[i] = head ? 1 : 0;
    npcs.knockShot[i] = shot ? 1 : 0;
    return true;
  },
};

/** Origen de un chunk respecto al lugar actual (que se dibuja en 0..CHUNK_SIZE). */
const chunkOrigin = (chunkId: string) => world.offsetOf(chunkId);

function refresh() {
  const v = world.getVersion();
  if (v === version && meshVersion === seenMeshVersion && vehicleVersion === seenVehicleVersion) return;
  version = v;
  seenMeshVersion = meshVersion;
  seenVehicleVersion = vehicleVersion;
  const out: Box[] = [];
  for (const e of world.entities.values()) {
    const col = ColliderV1.safeParse(e.components["collider@1"]);
    if (!col.success || col.data.trigger) continue;
    // Con su malla ya cargada, la caja de reserva no cuenta.
    if (col.data.from_mesh && meshCols.has(e.entity_id)) continue;
    const t = TransformV1.safeParse(e.components["transform@1"]);
    if (!t.success) continue;
    const [ox, oz] = chunkOrigin(e.chunk_id);
    const [qx, qy, qz, qw] = t.data.r;
    // Solo el giro horizontal (los colisionadores del mundo están derechos).
    const yaw = Math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qy * qy + qx * qx));
    const [sx, sy, sz] = t.data.s;
    const [hx, hy, hz] = col.data.half_extents;
    out.push({
      x: t.data.p[0] + ox,
      y: t.data.p[1],
      z: t.data.p[2] + oz,
      hx: hx * Math.abs(sx),
      hy: hy * Math.abs(sy),
      hz: hz * Math.abs(sz),
      c: Math.cos(yaw),
      s: Math.sin(yaw),
    });
  }
  if (vehicleBox) out.push(vehicleBox);
  boxes = out;
}

/**
 * Empuja un círculo (centro px, pz; radio r; altura de pies y cabeza) fuera de las cajas.
 * Modifica `p` en su sitio. Dos pasadas bastan para esquinas. Con `people` en false no cuenta la
 * gente (la usan los ciudadanos: entre ellos y con el jugador se empujan con su masa, citizens.ts).
 */
export function resolveCircle(p: { x: number; z: number }, r: number, feet: number, head: number, people = true) {
  refresh();
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxes) {
      if (feet > b.y + b.hy || head < b.y - b.hy) continue;
      // Al espacio local de la caja (giro inverso).
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const lx = dx * b.c - dz * b.s;
      const lz = dx * b.s + dz * b.c;
      const cx = Math.max(-b.hx, Math.min(b.hx, lx));
      const cz = Math.max(-b.hz, Math.min(b.hz, lz));
      let nx = lx - cx;
      let nz = lz - cz;
      const d2 = nx * nx + nz * nz;
      if (d2 >= r * r) continue;
      let push: number;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        nx /= d;
        nz /= d;
        push = r - d;
      } else {
        // Centro dentro de la caja: salir por el lado más cercano.
        const ex = b.hx - Math.abs(lx);
        const ez = b.hz - Math.abs(lz);
        if (ex < ez) {
          nx = Math.sign(lx) || 1;
          nz = 0;
          push = ex + r;
        } else {
          nx = 0;
          nz = Math.sign(lz) || 1;
          push = ez + r;
        }
      }
      // De vuelta al mundo.
      const wx = nx * b.c + nz * b.s;
      const wz = -nx * b.s + nz * b.c;
      p.x += wx * push;
      p.z += wz * push;
    }
    if (!people) {
      if (meshCols.size) resolveMeshes(p, r, feet, head);
      continue;
    }
    // La gente: cilindros que no se atraviesan (el que se aparta es el jugador).
    const rr = r + NPC_RADIUS;
    const total = npcs.count + npcs.extra;
    for (let k = 0; k < total; k++) {
      const i = npcAt(k);
      const ny = npcs.pos[i * 3 + 1]!;
      if (ny > head || ny + 1.75 < feet - 0.6) continue;
      const dx = p.x - npcs.pos[i * 3]!;
      const dz = p.z - npcs.pos[i * 3 + 2]!;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-5) {
        p.x += rr;
        continue;
      }
      p.x += (dx / d) * (rr - d);
      p.z += (dz / d) * (rr - d);
    }
    // Las demás personas: igual, cilindros de su altura.
    const ro = r + OTHER_RADIUS;
    for (let k = 0; k < others.count; k++) {
      const oy = others.pos[k * 3 + 1]!;
      if (oy > head || oy + 1.75 < feet - 0.6) continue;
      const dx = p.x - others.pos[k * 3]!;
      const dz = p.z - others.pos[k * 3 + 2]!;
      const d2 = dx * dx + dz * dz;
      if (d2 >= ro * ro || d2 < 1e-10) continue;
      const d = Math.sqrt(d2);
      p.x += (dx / d) * (ro - d);
      p.z += (dz / d) * (ro - d);
    }
    if (meshCols.size) resolveMeshes(p, r, feet, head);
  }
}

/* --- Cápsula contra mallas (objetos de módulo: nada nuevo por llamada) --- */

const _seg = new THREE.Line3();
const _capBox = new THREE.Box3();
const _triP = new THREE.Vector3();
const _capP = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();
let _r = 0;

const capsuleCast = {
  intersectsBounds: (box: THREE.Box3) => box.intersectsBox(_capBox),
  intersectsTriangle: (tri: { closestPointToSegment: (s: THREE.Line3, a: THREE.Vector3, b: THREE.Vector3) => number; getNormal: (t: THREE.Vector3) => THREE.Vector3 }) => {
    const d = tri.closestPointToSegment(_seg, _triP, _capP);
    if (d >= _r) return;
    // Solo se empuja en horizontal: el suelo y los techos son cosa de groundHeight y ceilingHeight.
    _dir.subVectors(_capP, _triP);
    _dir.y = 0;
    let len = _dir.length();
    if (len < 1e-5) {
      tri.getNormal(_n);
      _dir.set(_n.x, 0, _n.z);
      len = _dir.length();
      if (len < 1e-5) return;
    }
    _dir.multiplyScalar((_r - d) / len);
    _seg.start.add(_dir);
    _seg.end.add(_dir);
  },
};

function resolveMeshes(p: { x: number; z: number }, r: number, feet: number, head: number) {
  _r = r;
  const top = Math.max(feet + r, head - r);
  for (const mc of meshCols.values()) {
    if (p.x + r < mc.box.min.x || p.x - r > mc.box.max.x || p.z + r < mc.box.min.z || p.z - r > mc.box.max.z) continue;
    if (feet > mc.box.max.y || head < mc.box.min.y) continue;
    _seg.start.set(p.x, feet + r, p.z);
    _seg.end.set(p.x, top, p.z);
    _capBox.makeEmpty();
    _capBox.expandByPoint(_seg.start);
    _capBox.expandByPoint(_seg.end);
    _capBox.expandByScalar(r);
    mc.bvh.shapecast(capsuleCast as unknown as Parameters<MeshBVH["shapecast"]>[0]);
    p.x = _seg.start.x;
    p.z = _seg.start.z;
  }
}

/* --- Rayos contra mallas (suelo, techo y cámara) --- */

const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();
const _ta = new THREE.Vector3();
let _best = Infinity;
let _far = Infinity;
/** Normal de la cara del mejor corte (la usan las sondas de pared del parkour). */
const _hitN = new THREE.Vector3();
/** Solo caras que miran hacia arriba (suelo caminable: hasta ~55°). */
let _upOnly = false;
const WALKABLE = 0.57;

const rayCast = {
  intersectsBounds: (box: THREE.Box3) => (_ray.intersectBox(box, _ta) !== null && _ta.distanceTo(_ray.origin) <= _far) || box.containsPoint(_ray.origin),
  intersectsTriangle: (tri: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; getNormal: (t: THREE.Vector3) => THREE.Vector3 }) => {
    if (!_ray.intersectTriangle(tri.a, tri.b, tri.c, false, _hit)) return;
    const d = _hit.distanceTo(_ray.origin);
    if (d > _far || d >= _best) return;
    tri.getNormal(_n);
    if (_upOnly && Math.abs(_n.y) < WALKABLE) return;
    _best = d;
    _hitN.copy(_n);
  },
};

/** Distancia al primer corte de las mallas en esa dirección (Infinity si nada antes de `far`). */
function castMeshes(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number, upOnly: boolean): number {
  _ray.origin.set(ox, oy, oz);
  _ray.direction.set(dx, dy, dz).normalize();
  _best = Infinity;
  _far = far;
  _upOnly = upOnly;
  const minX = Math.min(ox, ox + dx * far), maxX = Math.max(ox, ox + dx * far);
  const minY = Math.min(oy, oy + dy * far), maxY = Math.max(oy, oy + dy * far);
  const minZ = Math.min(oz, oz + dz * far), maxZ = Math.max(oz, oz + dz * far);
  for (const mc of meshCols.values()) {
    const b = mc.box;
    if (maxX < b.min.x || minX > b.max.x || maxY < b.min.y || minY > b.max.y || maxZ < b.min.z || minZ > b.max.z) continue;
    mc.bvh.shapecast(rayCast as unknown as Parameters<MeshBVH["shapecast"]>[0]);
  }
  return _best;
}

/** Suelo de las mallas bajo (x, z): la cara caminable más alta por debajo de `maxTop` (o -Infinity). */
function meshGround(x: number, z: number, r: number, maxTop: number, floor: number): number {
  let g = -Infinity;
  const k = r * 0.7;
  for (let i = 0; i < 5; i++) {
    const px = i === 1 ? x + k : i === 2 ? x - k : x;
    const pz = i === 3 ? z + k : i === 4 ? z - k : z;
    const d = castMeshes(px, maxTop + 0.01, pz, 0, -1, 0, maxTop + 0.01 - floor, true);
    if (d !== Infinity) g = Math.max(g, maxTop + 0.01 - d);
  }
  return g;
}

/** Distancia al cuadrado del punto (x, z) al rectángulo de la caja en planta (0 si está dentro). */
function planDist2(b: Box, x: number, z: number) {
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = dx * b.c - dz * b.s;
  const lz = dx * b.s + dz * b.c;
  const ox = Math.max(0, Math.abs(lx) - b.hx);
  const oz = Math.max(0, Math.abs(lz) - b.hz);
  return ox * ox + oz * oz;
}

/**
 * Altura del suelo bajo un círculo: la cara de arriba más alta que no pase de `maxTop`
 * (los pies más lo que se puede subir de un paso). Sin cajas debajo, el suelo del lugar (0).
 */
export function groundHeight(x: number, z: number, r: number, maxTop: number): number {
  refresh();
  let g = 0;
  const r2 = r * r;
  for (const b of boxes) {
    const top = b.y + b.hy;
    if (top <= g || top > maxTop) continue;
    if (planDist2(b, x, z) < r2) g = top;
  }
  if (meshCols.size) g = Math.max(g, meshGround(x, z, r, maxTop, g));
  return g;
}

/** Suelo bajo un punto (un solo rayo en las mallas): para la gente de las ciudades, cada frame. */
export function floorAt(x: number, z: number, maxTop: number): number {
  refresh();
  let g = 0;
  for (const b of boxes) {
    const top = b.y + b.hy;
    if (top <= g || top > maxTop) continue;
    if (planDist2(b, x, z) < 1e-6) g = top;
  }
  if (meshCols.size) {
    const d = castMeshes(x, maxTop + 0.01, z, 0, -1, 0, maxTop + 0.01 - g, true);
    if (d !== Infinity) g = Math.max(g, maxTop + 0.01 - d);
  }
  return g;
}

/** Techo sobre un círculo: la cara de abajo más baja por encima de `minBottom` (Infinity si no hay). */
export function ceilingHeight(x: number, z: number, r: number, minBottom: number): number {
  refresh();
  let c = Infinity;
  const r2 = r * r;
  for (const b of boxes) {
    const bottom = b.y - b.hy;
    if (bottom >= c || bottom < minBottom) continue;
    if (planDist2(b, x, z) < r2) c = bottom;
  }
  if (meshCols.size) {
    const d = castMeshes(x, minBottom, z, 0, 1, 0, Math.min(c, minBottom + 50) - minBottom, false);
    if (d !== Infinity) c = Math.min(c, minBottom + d);
  }
  return c;
}

/** ¿Está el punto dentro de alguna caja (con margen)? */
function inside(x: number, y: number, z: number, margin: number) {
  for (const b of boxes) {
    if (Math.abs(y - b.y) > b.hy + margin) continue;
    const dx = x - b.x;
    const dz = z - b.z;
    const lx = dx * b.c - dz * b.s;
    const lz = dx * b.s + dz * b.c;
    if (Math.abs(lx) < b.hx + margin && Math.abs(lz) < b.hz + margin) return true;
  }
  return false;
}

/**
 * Fracción (0..1) del segmento objetivo→cámara que se puede recorrer sin meterse en una pared.
 * La cámara en tercera persona usa esto para no atravesar los edificios.
 */
export function cameraReach(tx: number, ty: number, tz: number, cx: number, cy: number, cz: number): number {
  refresh();
  let limit = 1;
  if (meshCols.size) {
    const len = Math.hypot(cx - tx, cy - ty, cz - tz);
    if (len > 1e-3) {
      const d = castMeshes(tx, ty, tz, cx - tx, cy - ty, cz - tz, len, false);
      if (d !== Infinity) limit = Math.max(0.15, (d - 0.3) / len);
    }
  }
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    if (k > limit) break;
    if (inside(tx + (cx - tx) * k, ty + (cy - ty) * k, tz + (cz - tz) * k, 0.25)) return Math.max(0.15, Math.min(limit, (i - 1) / steps));
  }
  return limit;
}

/**
 * Hasta dónde llega un rayo de (ax, ay, az) a (bx, by, bz) sin chocar con nada sólido (las armas,
 * §9 octies ter: ver a quién se apunta y dónde acaba el disparo): fracción 0..1 del segmento. Las
 * cajas, con su intersección exacta (las que contienen el origen no cuentan: no son una pared que
 * se tenga delante); las mallas, con su árbol. Sin objetos nuevos.
 */
export function rayReach(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  refresh();
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-3) return 1;
  let best = 1;
  for (const b of boxes) {
    // Al marco de la caja (el mismo giro que `inside`).
    const ox = ax - b.x, oz = az - b.z, oy = ay - b.y;
    const lox = ox * b.c - oz * b.s, loz = ox * b.s + oz * b.c;
    const ldx = dx * b.c - dz * b.s, ldz = dx * b.s + dz * b.c;
    let t0 = 0, t1 = best;
    let inBox = true;
    for (let k = 0; k < 3; k++) {
      const o = k === 0 ? lox : k === 1 ? oy : loz;
      const d = k === 0 ? ldx : k === 1 ? dy : ldz;
      const h = k === 0 ? b.hx : k === 1 ? b.hy : b.hz;
      if (Math.abs(o) > h) inBox = false;
      if (Math.abs(d) < 1e-9) {
        if (Math.abs(o) > h) {
          t0 = 2;
          break;
        }
        continue;
      }
      let ta = (-h - o) / d, tb = (h - o) / d;
      if (ta > tb) {
        const sw = ta;
        ta = tb;
        tb = sw;
      }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) break;
    }
    if (!inBox && t0 <= t1 && t0 < best) best = t0;
  }
  if (meshCols.size) {
    const d = castMeshes(ax, ay, az, dx, dy, dz, len * best, false);
    if (d !== Infinity) best = Math.min(best, d / len);
  }
  return Math.max(0, best);
}

/* --- Sondas del parkour (world/parkour): paredes, bordes y huecos --- */

/** Resultado de `probeWall` (objeto reutilizado): distancia y normal horizontal de la cara. */
export const wallHit = { d: 0, nx: 0, nz: 0 };

/**
 * Primera pared que corta un rayo horizontal desde (ox, oy, oz) hacia (dx, dz) (normalizado), hasta
 * `far` metros: las cajas cuya altura incluye `oy` y las caras casi verticales de las mallas. Deja en
 * `wallHit` la distancia y la normal de la cara (hacia quien mira). Las cajas en las que ya está el
 * origen (en planta) no cuentan: no son una pared que se tenga delante.
 */
export function probeWall(ox: number, oy: number, oz: number, dx: number, dz: number, far: number): boolean {
  refresh();
  let best = far;
  let bnx = 0;
  let bnz = 0;
  for (const b of boxes) {
    if (oy < b.y - b.hy || oy > b.y + b.hy) continue;
    // Al espacio de la caja (como en resolveCircle): el origen y la dirección.
    const px = ox - b.x;
    const pz = oz - b.z;
    const lx = px * b.c - pz * b.s;
    const lz = px * b.s + pz * b.c;
    const ldx = dx * b.c - dz * b.s;
    const ldz = dx * b.s + dz * b.c;
    if (Math.abs(lx) < b.hx && Math.abs(lz) < b.hz) continue;
    let tmin = -Infinity;
    let tmax = Infinity;
    let axis = 0;
    if (Math.abs(ldx) < 1e-9) {
      if (Math.abs(lx) > b.hx) continue;
    } else {
      const t1 = (-b.hx - lx) / ldx;
      const t2 = (b.hx - lx) / ldx;
      const lo = Math.min(t1, t2);
      if (lo > tmin) {
        tmin = lo;
        axis = 1;
      }
      tmax = Math.min(tmax, Math.max(t1, t2));
    }
    if (Math.abs(ldz) < 1e-9) {
      if (Math.abs(lz) > b.hz) continue;
    } else {
      const t1 = (-b.hz - lz) / ldz;
      const t2 = (b.hz - lz) / ldz;
      const lo = Math.min(t1, t2);
      if (lo > tmin) {
        tmin = lo;
        axis = 2;
      }
      tmax = Math.min(tmax, Math.max(t1, t2));
    }
    if (tmin > tmax || tmin < 0 || tmin >= best) continue;
    best = tmin;
    // La cara por la que entra (contra el rayo), de vuelta al mundo.
    const nlx = axis === 1 ? -Math.sign(ldx) : 0;
    const nlz = axis === 2 ? -Math.sign(ldz) : 0;
    bnx = nlx * b.c + nlz * b.s;
    bnz = -nlx * b.s + nlz * b.c;
  }
  if (meshCols.size) {
    const d = castMeshes(ox, oy, oz, dx, 0, dz, best, false);
    if (d < best && Math.abs(_hitN.y) < 0.6) {
      let nx = _hitN.x;
      let nz = _hitN.z;
      const len = Math.hypot(nx, nz) || 1;
      nx /= len;
      nz /= len;
      if (nx * dx + nz * dz > 0) {
        nx = -nx;
        nz = -nz;
      }
      best = d;
      bnx = nx;
      bnz = nz;
    }
  }
  if (best >= far) return false;
  wallHit.d = best;
  wallHit.nx = bnx;
  wallHit.nz = bnz;
  return true;
}

/**
 * ¿Hay algo sólido en la columna vertical de (x, z), entre y0 e y1 (con radio `r` en planta)? Cajas
 * que la cortan y mallas (un rayo hacia arriba). Para saber si cabe el cuerpo encima de un borde o al
 * otro lado de una valla.
 */
export function solidColumn(x: number, z: number, y0: number, y1: number, r = 0): boolean {
  refresh();
  const r2 = r * r;
  for (const b of boxes) {
    if (b.y + b.hy <= y0 || b.y - b.hy >= y1) continue;
    if (planDist2(b, x, z) <= r2) return true;
  }
  return meshCols.size > 0 && castMeshes(x, y0, z, 0, 1, 0, y1 - y0, false) !== Infinity;
}

/** Cuánto por delante del centro de un asiento van los pies de quien se sienta (tools/forge/interiors.py). */
export const SIT_FORWARD = 0.3;

/** ¿Hay alguien sentado ya en ese asiento (un residente a menos de medio banco)? */
function seatTaken(x: number, y: number, z: number, half: number) {
  const total = npcs.count + npcs.extra;
  for (let k = 0; k < total; k++) {
    const i = npcAt(k);
    if (Math.abs(npcs.pos[i * 3 + 1]! - y) > 1) continue;
    if (Math.hypot(npcs.pos[i * 3]! - x, npcs.pos[i * 3 + 2]! - z) < Math.min(0.6, half)) return true;
  }
  return false;
}

/**
 * Asiento cercano (un colisionador bajo y alargado, como un banco) para el gesto de sentarse.
 * Devuelve dónde colocarse y hacia dónde mirar (el frente del asiento es su +Z local).
 */
export function findSeat(x: number, z: number, maxDist = 1.8): { x: number; z: number; yaw: number } | null {
  refresh();
  let best: { x: number; z: number; yaw: number } | null = null;
  let bestD = maxDist;
  for (const b of boxes) {
    if (b.hy > 0.55 || b.hx < 0.6 || b.hz > 0.45) continue;
    // Los pies, por delante del asiento (en local: +Z), de vuelta al mundo: así la cadera de la
    // animación de sentarse (33 cm detrás de los pies) cae sobre el asiento.
    const lz = SIT_FORWARD;
    const sx = b.x + lz * b.s;
    const sz = b.z + lz * b.c;
    const d = Math.hypot(sx - x, sz - z);
    if (d < bestD && !seatTaken(sx, b.y, sz, b.hx)) {
      bestD = d;
      best = { x: sx, z: sz, yaw: Math.atan2(b.s, b.c) };
    }
  }
  return best;
}
