/**
 * Qué hacer en cada distrito: los sitios de `guide.json` con su punto de llegada ya resuelto. Lo usan
 * la tarjeta «Qué hacer aquí» (hud/GuideCard.tsx: el botón «Ir» de cada sitio) y los enlaces
 * directos /d/<distrito>/<sitio> (routes.ts). Los puntos salen de los mismos datos que usa el mundo
 * (district-activities.json: salidas de las carreras, máquinas, marcadores y carteles), así que si
 * la forja mueve algo, el sitio se mueve con ello. Sin Three.js ni nada del navegador.
 */
import activities from "../../../realtime/src/district-activities.json";
import layout from "../../../realtime/src/districts.json";
import guide from "./guide.json";

export type Vec3 = [number, number, number];

/** Un sitio al que se puede ir: dónde se aparece y hacia dónde se mira (grados). */
export interface GuideSpot {
  id: string;
  p: Vec3;
  yaw: number;
}

/** Una fila de la tarjeta: un sitio, o varias carreras juntas (los niveles de Vertical). */
export interface GuideEntry {
  id: string;
  spot: GuideSpot | null;
  levels: GuideSpot[];
}

interface RawEntry {
  id: string;
  at?: number[];
  yaw?: number;
  race?: string;
  cabinet?: number;
  board?: number;
  label?: number;
  levels?: string[];
}

interface Placed {
  p: number[];
  yaw?: number;
}
interface DistrictActivities {
  races?: { id: string; start: { p: number[] }; cps: number[][]; finish: { p: number[] } }[];
  cabinets?: Placed[];
  boards?: Placed[];
  labels?: Placed[];
}

const ACTS = activities as unknown as Record<string, DistrictActivities | undefined>;
const RAW = guide as unknown as Record<string, RawEntry[] | string | undefined>;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** A `d` metros por delante de algo que mira hacia su giro (como las parcelas: se le mira con su mismo giro). */
function inFront(o: Placed, d: number): GuideSpot["p"] {
  const a = ((o.yaw ?? 0) * Math.PI) / 180;
  return [r2(o.p[0]! + Math.sin(a) * d), 0, r2(o.p[2]! + Math.cos(a) * d)];
}

/** La salida de una carrera, mirando a su primer punto (o a la meta). */
function raceSpot(district: string, id: string): GuideSpot | null {
  const r = ACTS[district]?.races?.find((x) => x.id === id);
  if (!r) return null;
  const s = r.start.p;
  const to = r.cps[0] ?? r.finish.p;
  const yaw = Math.round((Math.atan2(-(to[0]! - s[0]!), -(to[2]! - s[2]!)) * 180) / Math.PI);
  return { id, p: [s[0]!, s[1]!, s[2]!], yaw };
}

function resolve(district: string, e: RawEntry): GuideEntry {
  const a = ACTS[district];
  let spot: GuideSpot | null = null;
  if (e.at) spot = { id: e.id, p: [e.at[0]!, e.at[1]!, e.at[2]!], yaw: e.yaw ?? 0 };
  else if (e.race) {
    const r = raceSpot(district, e.race);
    spot = r && { ...r, id: e.id };
  } else {
    const o = e.cabinet !== undefined ? a?.cabinets?.[e.cabinet] : e.board !== undefined ? a?.boards?.[e.board] : e.label !== undefined ? a?.labels?.[e.label] : undefined;
    if (o) spot = { id: e.id, p: inFront(o, e.cabinet !== undefined ? 4 : e.board !== undefined ? 4 : 3), yaw: o.yaw ?? 0 };
  }
  const levels = (e.levels ?? []).flatMap((id) => raceSpot(district, id) ?? []);
  return { id: e.id, spot, levels };
}

const cache = new Map<string, GuideEntry[]>();

/** Las filas de la tarjeta de un distrito (por su id: "vertical"…); vacío si no tiene. */
export function guideOf(district: string | null | undefined): GuideEntry[] {
  if (!district) return [];
  let list = cache.get(district);
  if (!list) {
    const raw = RAW[district];
    list = Array.isArray(raw) ? raw.map((e) => resolve(district, e)) : [];
    cache.set(district, list);
  }
  return list;
}

/** Un sitio por su id (también cada nivel de una fila de carreras). */
export function spotOf(district: string, spot: string | null | undefined): GuideSpot | null {
  if (!spot) return null;
  for (const e of guideOf(district)) {
    if (e.id === spot && e.spot) return e.spot;
    const lv = e.levels.find((l) => l.id === spot);
    if (lv) return lv;
  }
  return null;
}

/** Los ids de todos los sitios de un distrito (para generar sus páginas y para las pruebas). */
export function spotIds(district: string): string[] {
  return guideOf(district).flatMap((e) => [...(e.spot ? [e.id] : []), ...e.levels.map((l) => l.id)]);
}

/** Dónde se aparece en la plaza (delante de la fuente, mirando al norte). */
const PLAZA: { chunk: string; p: Vec3; yaw: number } = { chunk: "c_0_0", p: [32, 0, 43], yaw: 0 };

/**
 * Adónde lleva un enlace /d/<distrito>[/<sitio>] sin preguntar al servidor: la plaza y los distritos
 * del sistema. "soon": existe pero aún no abre. null: no es del sistema (puede ser de la comunidad).
 */
export function directPlace(district: string, spot: string | null): { chunk: string; p: Vec3; yaw: number } | "soon" | null {
  if (district === "plaza") return PLAZA;
  const d = (layout.districts as { id: string; chunk: string; soon?: boolean }[]).find((x) => x.id === district);
  if (!d) return null;
  if (d.soon) return "soon";
  const s = spotOf(district, spot);
  return { chunk: d.chunk, p: s?.p ?? (layout.spawn as unknown as Vec3), yaw: s?.yaw ?? 0 };
}

/** Los distritos del sistema que tienen guía (ids de districts.json). */
export const GUIDED = (layout.districts as { id: string; chunk: string; soon?: boolean }[]).filter((d) => Array.isArray(RAW[d.id]));

/** El distrito del sistema que vive en un chunk (null: la plaza, el nexo o uno de la comunidad). */
export function districtIdOfChunk(chunkId: string): string | null {
  return (layout.districts as { id: string; chunk: string }[]).find((d) => d.chunk === chunkId)?.id ?? null;
}
