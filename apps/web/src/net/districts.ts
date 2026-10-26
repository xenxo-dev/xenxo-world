/**
 * Distritos y parcelas (GET /districts): para elegir dónde publicar, para el nexo 2D y para
 * llevar a alguien delante del portal de un proyecto.
 */
import { useSyncExternalStore } from "react";
import { PORTAL_ZONE_DEPTH } from "@xenxo/protocol";
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
}

/** Dónde se aparece al entrar en un distrito (junto a su puerta, mirando a la avenida). */
export const DISTRICT_SPAWN: [number, number, number] = [32, 0, 57.5];
/** Distancia del marco del portal al centro de la parcela, hacia el fondo (districts.json). */
const FRAME_BACK = 3;

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
  const d = -FRAME_BACK + PORTAL_ZONE_DEPTH + 1.2;
  return { p: [q.x + s * d, 0, q.z + c * d], yaw: q.facing };
}

// Los nombres de los distritos hacen falta pronto (HUD, chat): se piden al cargar.
void refreshDistricts();
