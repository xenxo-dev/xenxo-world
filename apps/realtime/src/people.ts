/**
 * Gente (§9 octies del protocolo): reacciones, acciones en pareja y el modo pelea. Aquí solo las
 * reglas (distancias, ritmos y cuánto pega cada golpe en cada estilo); chunk-room.ts las aplica con
 * la última pose de cada sesión. Nada se guarda: todo vive mientras dura la conexión.
 *
 * El modo pelea es de consentimiento: solo se golpea a quien también lo tiene activado, nunca en el
 * nexo ni en la plaza, y sin vida ni sangre. Cómo se cae depende del distrito (`fight` en
 * districts.json): de dibujos, de 8 bits, en duelo (al tercer golpe, fuera de combate un momento)
 * o solo empujones.
 */
import { FIGHT_REACH, PAIR_RANGE, type FightMove, type FightStyle } from "@xenxo/protocol";

/** Cada cuánto puede reaccionar una sesión (ms). */
export const REACT_GAP_MS = 600;
/** Distancia (m, entre cabezas) para proponer y para empezar una acción en pareja. */
export const PAIR_OFFER_RANGE = PAIR_RANGE;
export const PAIR_START_RANGE = 3.5;
/** Cuánto vale una propuesta sin respuesta (ms). */
export const PAIR_TTL_MS = 20_000;
/** Entre golpes de la misma sesión (ms) y tras caer, cuánto no se puede volver a golpear a nadie. */
export const HIT_GAP_MS = 600;
export const DOWN_IMMUNE_MS = 2_500;
/** Diferencia de altura máxima entre los dos (m): no se pega a alguien de otro piso. */
export const HIT_MAX_DY = 1.2;
/** Golpes seguidos que dejan fuera de combate en un duelo, y en cuánto tiempo (ms). */
export const DUEL_KO_HITS = 3;
export const DUEL_WINDOW_MS = 8_000;

/** Alcance de cada golpe (m, entre cabezas): el del protocolo, con un poco de margen por la red. */
export const REACH: Record<FightMove, number> = { punch: FIGHT_REACH.punch + 0.3, kick: FIGHT_REACH.kick + 0.3, shove: FIGHT_REACH.shove + 0.3 };

/** Fuerza (0–1) de cada golpe en cada estilo y a partir de cuánta se cae. */
const POWER: Record<FightStyle, Record<FightMove, number>> = {
  comic: { punch: 0.7, kick: 0.9, shove: 0.45 },
  pixel: { punch: 0.6, kick: 0.8, shove: 0.5 },
  duel: { punch: 0.45, kick: 0.6, shove: 0.3 },
  shove: { punch: 0, kick: 0, shove: 0.55 },
};
const FALL_AT: Record<FightStyle, number> = { comic: 0.65, pixel: 0.75, duel: 1.1, shove: 1.1 };

/** ¿Vale este golpe en este estilo? (en los de empujones, solo empujones). */
export function moveAllowed(style: FightStyle, move: FightMove): boolean {
  return POWER[style][move] > 0;
}

/**
 * Resultado de un golpe: fuerza, si cae y si queda fuera de combate. `recent` son los golpes que
 * lleva quien lo recibe en la ventana del duelo (contando este).
 */
export function hitOutcome(style: FightStyle, move: FightMove, recent: number): { power: number; fall: boolean; ko: boolean } {
  const power = POWER[style][move];
  const ko = style === "duel" && recent >= DUEL_KO_HITS;
  return { power, fall: ko || power >= FALL_AT[style], ko };
}

/** El estilo guardado en districts.json, si es uno de los del protocolo; si no, «comic». */
export function styleOf(raw: string | undefined): FightStyle {
  return raw === "pixel" || raw === "duel" || raw === "shove" || raw === "comic" ? raw : "comic";
}
