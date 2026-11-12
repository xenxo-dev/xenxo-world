/**
 * El rival de la casa: en una carrera de salida conjunta que corres solo, un coche fantasma corre a
 * la vez que tú la carrera grabada con el coche de verdad (src/world/vehicle/ghosts/<carrera>.json,
 * que escriben test/race.mts y test/vertigo.mts desde el segundo cajón). Va con la hora de salida
 * del servidor y no choca con nada (world/vehicle/Ghost.tsx); en cada puerta, el HUD dice cuánto le
 * sacas o te saca. No cuenta para nada: ni sale en la clasificación ni va al servidor.
 *
 * Sin red, sin React y sin Three.js: se prueba en Node (test/race.mts).
 */
import type { RoundState } from "./round";

export interface GhostLap {
  race: string;
  /** Posiciones por segundo. */
  hz: number;
  /** Lo que tardó en llegar (ms desde la salida). */
  ms: number;
  /** Cuándo pasó por cada puerta, de todas las vueltas (ms desde la salida). */
  gates: number[];
  /** x, y, z, qx, qy, qz, qw y velocidad, una tras otra. */
  frames: number[];
}

export interface GhostPose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  speed: number;
}

const laps = new Map<string, GhostLap>();

/** Las carreras con rival de la casa. */
export const RIVAL_RACES = ["gp", "vertigo"] as const;

/** La vuelta grabada de una carrera (si ya ha llegado: `loadRivals`). */
export const rivalLap = (race: string): GhostLap | undefined => laps.get(race);

let loading: Promise<void> | null = null;
/** Se piden al llegar a un lugar con coches (van aparte: unos 35 KB cada una). */
export function loadRivals(): Promise<void> {
  loading ??= Promise.all([import("../world/vehicle/ghosts/gp.json"), import("../world/vehicle/ghosts/vertigo.json")])
    .then((mods) => {
      for (const m of mods) {
        const lap = (m as { default: GhostLap }).default;
        laps.set(lap.race, lap);
      }
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

/** Para las pruebas: una vuelta cualquiera. */
export function setRivalLap(lap: GhostLap) {
  laps.set(lap.race, lap);
}

/** ¿Corre conmigo el rival de la casa? Solo si estoy en la ronda (esperando o corriendo) y nadie más. */
export function soloRival(r: RoundState | null): GhostLap | null {
  if (!r || !r.mine || !r.live || r.state === "done" || r.entrants.length !== 1) return null;
  return laps.get(r.race) ?? null;
}

/**
 * Dónde va el fantasma `ms` después de la salida (antes de ella, en su cajón; después de su último
 * fotograma, se queda en él). Entre dos fotogramas, en línea recta y girando por el camino corto.
 */
export function ghostPose(lap: GhostLap, ms: number, out: GhostPose): GhostPose {
  const n = lap.frames.length / 8;
  const f = Math.max(0, Math.min(n - 1, (ms / 1000) * lap.hz));
  const i = Math.min(n - 2, Math.floor(f)), k = f - i;
  const a = i * 8, b = a + 8, F = lap.frames;
  out.x = F[a]! + (F[b]! - F[a]!) * k;
  out.y = F[a + 1]! + (F[b + 1]! - F[a + 1]!) * k;
  out.z = F[a + 2]! + (F[b + 2]! - F[a + 2]!) * k;
  const sign = F[a + 3]! * F[b + 3]! + F[a + 4]! * F[b + 4]! + F[a + 5]! * F[b + 5]! + F[a + 6]! * F[b + 6]! < 0 ? -1 : 1;
  const qx = F[a + 3]! + (F[b + 3]! * sign - F[a + 3]!) * k;
  const qy = F[a + 4]! + (F[b + 4]! * sign - F[a + 4]!) * k;
  const qz = F[a + 5]! + (F[b + 5]! * sign - F[a + 5]!) * k;
  const qw = F[a + 6]! + (F[b + 6]! * sign - F[a + 6]!) * k;
  const l = Math.hypot(qx, qy, qz, qw) || 1;
  out.qx = qx / l;
  out.qy = qy / l;
  out.qz = qz / l;
  out.qw = qw / l;
  out.speed = F[a + 7]! + (F[b + 7]! - F[a + 7]!) * k;
  return out;
}

/**
 * Lo que le saco (negativo) o me saca (positivo) al pasar mi puerta número `gates` (1 = la
 * primera) cuando llevo `ms` desde la salida. null si no hay con qué comparar.
 */
export function rivalGap(lap: GhostLap, gates: number, ms: number): number | null {
  const his = gates > 0 ? lap.gates[gates - 1] : undefined;
  return his === undefined ? null : ms - his;
}
