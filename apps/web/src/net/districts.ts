/**
 * Distritos y parcelas (GET /districts): para elegir dónde publicar, para el nexo 2D y para
 * llevar a alguien delante del portal de un proyecto.
 */
import { useSyncExternalStore } from "react";
import layout from "../../../realtime/src/districts.json";
import { REALTIME_URL } from "../config";
import { registerPlaceName } from "../i18n";

export interface ParcelInfo {
  id: string;
  x: number;
  z: number;
  facing: number;
  project_id: string | null;
  title: string | null;
}

export interface DistrictInfo {
  id: string;
  chunk_id: string;
  category: string;
  color: string;
  name: Record<string, string>;
  desc: Record<string, string>;
  parcels: ParcelInfo[];
  /** Vive en el servidor de distritos: para entrar hay que pedir un pase (ver session.ts). */
  remote?: boolean;
  /** Próximamente: la puerta está cerrada (solo entra moderación) y no se publica en él. */
  soon?: boolean;
  /** Distrito de la comunidad (hecho con el kit): sin parcelas, con su portada y su autor. */
  community?: boolean;
  cover?: string;
  author?: { display_name: string; player_no: number | null };
}

/** Dónde se aparece al entrar en un distrito (junto a su puerta, mirando a la avenida). */
export const DISTRICT_SPAWN = layout.spawn as unknown as [number, number, number];
/** Distancia del marco del portal al centro de la parcela, hacia el fondo (districts.json). */
const PARCEL_D = layout.parcel.d;

let cache: DistrictInfo[] | null = null;
let loadedAt = 0;
let pending: Promise<DistrictInfo[]> | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function refreshDistricts(force = false): Promise<DistrictInfo[]> {
  if (!force && cache && Date.now() - loadedAt < 15_000) return Promise.resolve(cache);
  pending ??= fetch(new URL("/districts", REALTIME_URL))
    .then((r) => (r.ok ? (r.json() as Promise<{ districts: DistrictInfo[] }>) : Promise.reject(new Error(String(r.status)))))
    .then(({ districts }) => {
      cache = districts;
      loadedAt = Date.now();
      for (const d of districts) registerPlaceName(d.chunk_id, d.name);
      version++;
      for (const fn of listeners) fn();
      return districts;
    })
    .catch(() => cache ?? [])
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function useDistricts(): DistrictInfo[] | null {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return cache;
}

export function districtOf(id: string | null | undefined): DistrictInfo | null {
  return cache?.find((d) => d.id === id) ?? null;
}

/** Punto y giro (grados) para aparecer delante del portal de una parcela, mirándolo. */
export function parcelArrival(q: ParcelInfo): { p: [number, number, number]; yaw: number } {
  const a = (q.facing * Math.PI) / 180;
  const s = Math.sin(a), c = Math.cos(a);
  // En la calle, delante de la parcela (dentro puede haber cosas construidas), mirando al portal.
  const d = PARCEL_D / 2 + 1.6;
  return { p: [q.x + s * d, 0, q.z + c * d], yaw: q.facing };
}

// Los nombres de los distritos hacen falta pronto (HUD, chat): se piden al cargar.
void refreshDistricts();
