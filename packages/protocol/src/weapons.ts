/**
 * Armas del modo pelea (§9 octies ter): blásteres de neón de juguete. Sin balas ni sangre: un rayo de
 * luz que quita vida y empuja (o tumba). Solo donde el distrito lo dice (`weapons` en districts.json:
 * Distrito Cero; WELCOME dice con cuáles puede disparar cada sesión) y solo entre quienes tienen el
 * modo pelea.
 *
 * Todo el mundo lleva la pipa. Las demás son el inventario de las cuentas registradas: salen de los
 * cofres de los niveles para tryhards de Vertical (uno al azar en cada meta, `LOOT_TABLES`). Los
 * invitados y los agentes, solo la pipa.
 *
 * Este archivo no importa nada del resto del protocolo.
 */

export const WEAPON_IDS = ["pipa", "chispa", "canon", "rafaga", "trueno", "tormenta", "halcon"] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];
/** La de todo el mundo. */
export const WEAPON_DEFAULT: WeaponId = "pipa";

export const RARITIES = ["basica", "comun", "rara", "epica", "legendaria"] as const;
export type Rarity = (typeof RARITIES)[number];

export interface WeaponSpec {
  rarity: Rarity;
  /** Vida que quita cada disparo que llega (de FIGHT_HP). */
  damage: number;
  /** Lo menos entre dos disparos (ms). El servidor admite hasta un 25 % menos (la red no es exacta). */
  gapMs: number;
  /** Alcance (m, entre cabezas). */
  range: number;
  /** Ráfaga: dispara mientras se mantiene el gatillo. */
  auto: boolean;
  /** A dos manos (la izquierda va al guardamanos). */
  twoHanded: boolean;
  /** Cuánto empuja (0–1, como `power` en HIT_EVENT) y si tumba a quien le da. */
  power: number;
  knock: boolean;
  /** Color del rayo. */
  color: string;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pipa: { rarity: "basica", damage: 12, gapMs: 450, range: 18, auto: false, twoHanded: false, power: 0.25, knock: false, color: "#36d9ff" },
  chispa: { rarity: "comun", damage: 8, gapMs: 240, range: 15, auto: false, twoHanded: false, power: 0.2, knock: false, color: "#ffe14d" },
  canon: { rarity: "comun", damage: 26, gapMs: 850, range: 20, auto: false, twoHanded: false, power: 0.7, knock: true, color: "#ff8a3d" },
  rafaga: { rarity: "rara", damage: 6, gapMs: 120, range: 16, auto: true, twoHanded: false, power: 0.15, knock: false, color: "#b06bff" },
  trueno: { rarity: "rara", damage: 34, gapMs: 950, range: 11, auto: false, twoHanded: true, power: 0.9, knock: true, color: "#ff4fd8" },
  tormenta: { rarity: "epica", damage: 6, gapMs: 100, range: 24, auto: true, twoHanded: true, power: 0.15, knock: false, color: "#ff3d6e" },
  halcon: { rarity: "legendaria", damage: 50, gapMs: 1300, range: 45, auto: false, twoHanded: true, power: 0.8, knock: true, color: "#6dff8a" },
};

/** El alcance mayor (m): lo más lejos que puede llegar un disparo. */
export const SHOT_MAX_RANGE = Math.max(...WEAPON_IDS.map((id) => WEAPONS[id].range));
/** Diferencia de altura máxima entre quien dispara y a quien le da (m): de la pasarela de Cero a la calle. */
export const SHOT_MAX_DY = 12;

/**
 * Botín: lo que puede salir en cada cofre (en %, por rareza). `duro`, el nivel 5 de Vertical; `extremo`,
 * el 6 (el más difícil). Qué tabla tiene cada carrera lo dice el distrito (`loot` en districts.json).
 */
export const LOOT_TABLES = {
  duro: { comun: 55, rara: 30, epica: 12, legendaria: 3 },
  extremo: { comun: 30, rara: 38, epica: 22, legendaria: 10 },
} as const satisfies Record<string, Partial<Record<Rarity, number>>>;
export type LootTable = keyof typeof LOOT_TABLES;

export const isWeaponId = (v: unknown): v is WeaponId => typeof v === "string" && (WEAPON_IDS as readonly string[]).includes(v);
export const isLootTable = (v: unknown): v is LootTable => typeof v === "string" && Object.prototype.hasOwnProperty.call(LOOT_TABLES, v);

/** El arma de un cofre de `table` con dos números al azar en [0, 1): la rareza y cuál de ellas. */
export function rollLoot(table: LootTable, a: number, b: number): WeaponId {
  const weights = Object.entries(LOOT_TABLES[table]) as [Rarity, number][];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let x = Math.min(0.999999, Math.max(0, a)) * total;
  let rarity = weights[weights.length - 1]![0];
  for (const [r, w] of weights) {
    if (x < w) {
      rarity = r;
      break;
    }
    x -= w;
  }
  const pool = WEAPON_IDS.filter((id) => WEAPONS[id].rarity === rarity);
  return pool[Math.min(pool.length - 1, Math.floor(Math.max(0, b) * pool.length))]!;
}

/** Las que puede usar alguien: la pipa y las de su inventario, en el orden del catálogo. */
export function usableWeapons(owned: readonly string[] | null | undefined): WeaponId[] {
  return WEAPON_IDS.filter((id) => id === WEAPON_DEFAULT || !!owned?.includes(id));
}
