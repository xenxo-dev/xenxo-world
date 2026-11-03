/**
 * Cómo se ve una pelea (lo comparten el propio jugador, selfPeople.ts, y quien mira, remotePeople.ts):
 * qué golpe sale en cada combinación, cuándo llega el puño, a qué distancia se pega, cómo encaja el
 * golpe quien lo recibe según de dónde le viene y cómo cae en cada estilo. Las reglas (alcance,
 * fuerza, quién cae) son del servidor (realtime/src/people.ts); esto es solo lo que se dibuja.
 */
import type { FightMove, FightStyle } from "@xenxo/protocol";
import type { HitEvent } from "../../net/people-store";
import { PART, type FallSpec } from "./rig";

/**
 * Cada golpe: de qué tipo es para el servidor, cuándo llega (s), cuánto dura, a qué distancia entre
 * cabezas conecta (m), dónde da y si mientras tanto no se anda (patadas y el gancho, que se tira con
 * todo el cuerpo).
 */
export interface Strike {
  move: FightMove;
  impact: number;
  dur: number;
  ideal: number;
  head: boolean;
  plant?: boolean;
  /** Giro que imprime al que lo recibe (rad/s; los ganchos y la patada circular). */
  twist?: number;
}
export const STRIKES: Record<string, Strike> = {
  punch: { move: "punch", impact: 0.17, dur: 0.62, ideal: 0.78, head: true },
  cross: { move: "punch", impact: 0.24, dur: 0.78, ideal: 0.8, head: true, twist: -2 },
  hook: { move: "punch", impact: 0.25, dur: 0.72, ideal: 0.66, head: true, plant: true, twist: 4 },
  kick: { move: "kick", impact: 0.25, dur: 0.66, ideal: 1.02, head: false, plant: true },
  roundhouse: { move: "kick", impact: 0.32, dur: 0.78, ideal: 0.98, head: false, plant: true, twist: 6 },
  shove: { move: "shove", impact: 0.27, dur: 0.62, ideal: 0.72, head: false },
  push: { move: "shove", impact: 0.26, dur: 0.58, ideal: 0.7, head: false },
  // La barrida (people/slide.ts): no es un golpe de brazos; esto es para quien la recibe.
  slide: { move: "slide", impact: 0, dur: 0.8, ideal: 0.6, head: false },
};
/** Los golpes que se dan con los botones (la barrida sale de deslizarse: people/slide.ts). */
export type StrikeMove = Exclude<FightMove, "slide">;
/** Combinaciones: cada golpe del mismo tipo seguido saca el siguiente. */
export const COMBO: Record<StrikeMove, string[]> = {
  punch: ["punch", "cross", "hook"],
  kick: ["kick", "roundhouse"],
  shove: ["shove", "push"],
};
/** Sin golpear durante este tiempo (s), la combinación vuelve a empezar. */
export const COMBO_RESET = 1.1;

/**
 * Cuánto se retrasa lo que ve cada uno de un golpe ajeno (ms): lo mismo que se retrasan las poses
 * de los demás al dibujarlas (Avatars.tsx) y un poco más (la pose del golpe sale antes que el HIT).
 * Así el puño se ve llegar antes de que el otro lo encaje.
 */
export const HIT_DELAY_MS = 380;

/** De qué lado le viene el golpe a quien mira hacia `yaw` (adelante = (−sin, −cos)). */
export function hitSide(dir: [number, number], yaw: number): { back: number; right: number } {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  // A su derecha (mirando a −Z en el giro 0, la derecha es +X).
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  return { back: -(dir[0] * fx + dir[1] * fz), right: dir[0] * rx + dir[1] * rz };
}

/** La reacción de un golpe que no tira al suelo: el gesto (en la parte de arriba) y el traspié. */
export function lightReaction(h: HitEvent, yaw: number, head: boolean): { emote: string; push: number; dur: number } {
  const side = hitSide(h.dir, yaw);
  const emote = side.back < -0.45 ? "hit_back" : head ? "hit_head" : "hit_body";
  // Traspié (m/s al empezar, se apaga en `dur`): poco, como en la vida; algo más en los empujones.
  const base: Record<FightStyle, number> = { comic: 2.2, pixel: 2.5, duel: 1.3, shove: 2.4 };
  const push = base[h.style] * (0.5 + h.power) * (h.move === "shove" ? 1.15 : 1);
  return { emote, push, dur: 0.5 };
}

/**
 * Cómo cae quien recibe `h` (con física): todo el cuerpo sale con la velocidad del golpe (así no se
 * estira en el primer instante) y un impulso más donde da (la cabeza o el pecho van por delante y el
 * cuerpo gira); el tono según el estilo (de dibujos sale despedido; en 8 bits, rebota; en un duelo,
 * fuera de combate, cae redondo). `vx, vz`: la velocidad que llevaba.
 */
export function fallFor(h: HitEvent, head: boolean, vx: number, vz: number): FallSpec {
  const p = h.power;
  if (h.move === "slide") {
    // La barrida: las piernas salen hacia donde iba quien se desliza y el cuerpo cae hacia atrás, encima.
    const legs = 4.5 * (2.4 + 1.6 * p);
    return {
      vel: [vx * 0.3, 0.3, vz * 0.3],
      impulses: [
        { part: PART.lLowerLeg, vec: [h.dir[0] * legs, legs * 0.45, h.dir[1] * legs] },
        { part: PART.rLowerLeg, vec: [h.dir[0] * legs, legs * 0.45, h.dir[1] * legs] },
        { part: PART.thorax, vec: [-h.dir[0] * 7, 0, -h.dir[1] * 7] },
      ],
      tone: h.ko ? 0.2 : 0.45,
      toneMin: 0.03,
      toneTau: 0.3,
      bounce: 0.05,
    };
  }
  let horiz: number, up: number, tone: number, toneMin: number, toneTau: number, bounce = 0.04;
  switch (h.style) {
    case "pixel":
      horiz = 2.6 + 2.4 * p;
      up = 2.2;
      tone = 0.6;
      toneMin = 0.04;
      toneTau = 0.4;
      bounce = 0.32;
      break;
    case "duel":
      // Fuera de combate: las piernas no aguantan; casi sin empuje.
      horiz = 0.5;
      up = 0;
      tone = 0.12;
      toneMin = 0.02;
      toneTau = 0.25;
      break;
    case "shove":
      horiz = 1.6 + 1.8 * p;
      up = 0.2;
      tone = 0.85;
      toneMin = 0.05;
      toneTau = 0.45;
      break;
    default:
      horiz = 1.6 + 2 * p;
      up = 0.6;
      tone = 0.75;
      toneMin = 0.04;
      toneTau = 0.35;
  }
  if (h.ko && h.style !== "duel") {
    tone *= 0.4;
    toneMin = 0.02;
  }
  if (h.style === "duel") {
    // Fuera de combate: se le doblan las rodillas (hacia delante) y el tronco se va atrás.
    return {
      vel: [vx * 0.3, 0, vz * 0.3],
      impulses: [
        { part: PART.thorax, vec: [h.dir[0] * 14, 0, h.dir[1] * 14] },
        { part: PART.lLowerLeg, vec: [-h.dir[0] * 5, 0, -h.dir[1] * 5] },
        { part: PART.rLowerLeg, vec: [-h.dir[0] * 5, 0, -h.dir[1] * 5] },
      ],
      tone,
      toneMin,
      toneTau,
      bounce,
    };
  }
  // Tres cuartos para todo el cuerpo; el resto, un impulso donde da (70 kg).
  const kick = 70 * 0.25 * horiz;
  const where: [number, number][] = head
    ? [
        [PART.head, 0.3],
        [PART.thorax, 0.7],
      ]
    : [
        [PART.thorax, 0.55],
        [PART.abdomen, 0.45],
      ];
  return {
    vel: [vx * 0.5 + h.dir[0] * horiz * 0.75, up * 0.75, vz * 0.5 + h.dir[1] * horiz * 0.75],
    impulses: where.map(([part, k]) => ({ part, vec: [h.dir[0] * kick * k, up * 70 * 0.25 * k, h.dir[1] * kick * k] as [number, number, number], top: part === PART.head })),
    tone,
    toneMin,
    toneTau,
    bounce,
  };
}

/**
 * Caídas del parkour (world/parkour): aterrizar de muy alto sin rodar ("land": los pies se paran en
 * seco, las piernas no aguantan y el tronco sigue hacia donde iba) o estrellarse corriendo contra una
 * pared ("crash": rebota y cae de espaldas). `dx, dz`: hacia dónde cae (unitario: la carrera, hacia
 * atrás si iba despacio, o la normal de la pared); `speed`, la del golpe (m/s); `vx, vz`, la que
 * llevaba. Los mismos cuerpos y la misma física que los golpes.
 */
export function parkourFallFor(kind: "land" | "crash", dx: number, dz: number, speed: number, vx: number, vz: number): FallSpec {
  if (kind === "crash") {
    const horiz = 1.1 + Math.min(2.2, speed * 0.3);
    const kick = 70 * 0.25 * horiz;
    return {
      vel: [dx * horiz * 0.45, 0.2, dz * horiz * 0.45],
      impulses: [
        { part: PART.head, vec: [dx * kick * 0.35, 70 * 0.25 * 0.15, dz * kick * 0.35], top: true },
        { part: PART.thorax, vec: [dx * kick * 0.65, 0, dz * kick * 0.65] },
      ],
      tone: 0.5,
      toneMin: 0.03,
      toneTau: 0.3,
      bounce: 0.05,
    };
  }
  const run = Math.min(1, Math.hypot(vx, vz) / 4);
  const kick = 70 * 0.25 * (0.7 + Math.min(1.2, speed * 0.05));
  return {
    vel: [vx * 0.6, 0, vz * 0.6],
    impulses: [
      { part: PART.thorax, vec: [dx * kick * (0.35 + 0.45 * run), -kick * 0.3, dz * kick * (0.35 + 0.45 * run)] },
      { part: PART.lLowerLeg, vec: [-dx * kick * 0.22 * run, 0, -dz * kick * 0.22 * run] },
      { part: PART.rLowerLeg, vec: [-dx * kick * 0.22 * run, 0, -dz * kick * 0.22 * run] },
    ],
    tone: 0.3,
    toneMin: 0.02,
    toneTau: 0.22,
    bounce: 0.03,
  };
}

/** A partir de esta velocidad (m/s), a la gente de decorado se la ha llevado un coche (no un golpe). */
export const RUN_OVER = 4.5;

/**
 * Cómo cae la gente de decorado (knock.ts) cuando le dan fuerte. Con un golpe, como en el estilo de
 * dibujos pero con menos empuje y menos tono (no está en guardia: se le doblan antes las piernas).
 * Atropellada, el parachoques le barre las piernas (van por delante y algo hacia arriba), el cuerpo
 * sale detrás y gira: cae de espaldas o de lado según por dónde le llegue. Con la velocidad del
 * coche, pero con tope (más deprisa, sin choques continuos, podría atravesar una pared). `vx, vz`:
 * la velocidad que llevaba andando.
 */
export function npcFallFor(nx: number, nz: number, speed: number, head: boolean, vx: number, vz: number): FallSpec {
  if (speed < RUN_OVER) {
    const p = Math.min(1, Math.max(0, (speed - 2.5) / 2));
    const horiz = 1.3 + 1.7 * p, up = 0.45;
    const kick = 70 * 0.25 * horiz, lift = 70 * 0.25 * up;
    const a = head ? PART.head : PART.thorax, b = head ? PART.thorax : PART.abdomen;
    const ka = head ? 0.3 : 0.55, kb = 1 - ka;
    return {
      vel: [vx * 0.5 + nx * horiz * 0.75, up * 0.75, vz * 0.5 + nz * horiz * 0.75],
      impulses: [
        { part: a, vec: [nx * kick * ka, lift * ka, nz * kick * ka], top: head },
        { part: b, vec: [nx * kick * kb, lift * kb, nz * kick * kb] },
      ],
      tone: 0.65,
      toneMin: 0.04,
      toneTau: 0.35,
      bounce: 0.04,
    };
  }
  const v = Math.min(8, speed * 0.7);
  const up = Math.min(2.4, 0.5 + speed * 0.13);
  // Lo que se llevan de más las espinillas (m/s, unos 4,5 kg cada una).
  const legs = 4.5 * Math.min(4.5, speed * 0.32);
  return {
    vel: [vx * 0.3 + nx * v, up, vz * 0.3 + nz * v],
    impulses: [
      { part: PART.lLowerLeg, vec: [nx * legs, legs * 0.4, nz * legs] },
      { part: PART.rLowerLeg, vec: [nx * legs, legs * 0.4, nz * legs] },
    ],
    tone: 0.35,
    toneMin: 0.03,
    toneTau: 0.3,
    bounce: 0.06,
  };
}

/** Cuánto se queda en el suelo antes de levantarse (s, desde que se para). */
export const LIE = 0.6;
export const LIE_KO = 2.4;
/** Lo más que dura la caída antes de levantarse aunque se siga moviendo (s). */
export const FALL_MAX = 3.2;
/** Lo que tarda «levantarse» (stand_up, 1,53 s). */
export const RISE = 1.5;

/** Gestos de la pose que dicen que está golpeando (para elegir la reacción de quien lo ve). */
export function strikeOf(emote: string | null | undefined): Strike | null {
  return emote ? (STRIKES[emote] ?? null) : null;
}

/** El último golpe que has dado tú (para dibujar bien a quien lo recibe). */
export const myStrike = { name: "punch" };
