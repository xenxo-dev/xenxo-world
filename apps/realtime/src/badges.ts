/**
 * Insignias de las actividades del sistema. Se ganan en los distritos (búsquedas, carreras y el
 * tablero) y se guardan en el Directory. Nunca las dice el cliente: el Worker las comprueba con lo
 * que guarda cada distrito (activityOf) antes de darlas.
 */

export interface Badge {
  id: string;
  /** Distrito donde se gana (su chunk sale de districts.ts). */
  district: string;
  rule: { kind: "hunt"; key: string } | { kind: "race"; key: string; under_ms?: number } | { kind: "points"; key: string; total: number };
  name: { es: string; en: string };
  desc: { es: string; en: string };
  color: string;
}

export const BADGES: Badge[] = [
  {
    id: "cero_rastro",
    district: "cero",
    rule: { kind: "hunt", key: "system:rastro" },
    name: { es: "Rastro de datos", en: "Data Trail" },
    desc: { es: "Encontró los 12 registros de Xen en Distrito Cero.", en: "Found Xen's 12 logs in District Zero." },
    color: "#ff4fd8",
  },
  {
    id: "arcade_monedas",
    district: "arcade",
    rule: { kind: "hunt", key: "system:monedas" },
    name: { es: "Cazamonedas", en: "Coin Hunter" },
    desc: { es: "Recogió las 50 monedas de Arcade.", en: "Collected all 50 coins in Arcade." },
    color: "#ffd54f",
  },
  {
    id: "arcade_circuito",
    district: "arcade",
    rule: { kind: "race", key: "system:circuito" },
    name: { es: "Circuito Neón", en: "Neon Circuit" },
    desc: { es: "Terminó el Circuito Neón.", en: "Finished the Neon Circuit." },
    color: "#4fa3ff",
  },
  {
    id: "arcade_piloto",
    district: "arcade",
    rule: { kind: "race", key: "system:circuito", under_ms: 80_000 },
    name: { es: "Piloto de neón", en: "Neon Racer" },
    desc: { es: "Hizo el Circuito Neón en menos de 1:20.", en: "Ran the Neon Circuit in under 1:20." },
    color: "#36d9ff",
  },
  {
    id: "arcade_gp",
    district: "arcade",
    rule: { kind: "race", key: "system:gp" },
    name: { es: "Gran Premio Neón", en: "Neon Grand Prix" },
    desc: { es: "Terminó una carrera del Gran Premio Neón, con su looping y su salto.", en: "Finished a Neon Grand Prix race, loop and jump included." },
    color: "#ff4fd8",
  },
  {
    id: "arcade_as",
    district: "arcade",
    rule: { kind: "race", key: "system:gp", under_ms: 80_000 },
    name: { es: "As del volante", en: "Ace Driver" },
    desc: { es: "Hizo las dos vueltas del Gran Premio Neón en menos de 1:20.", en: "Drove both laps of the Neon Grand Prix in under 1:20." },
    color: "#ffd54f",
  },
  {
    id: "pixel_sprites",
    district: "pixel",
    rule: { kind: "hunt", key: "system:sprites" },
    name: { es: "Buscasprites", en: "Sprite Seeker" },
    desc: { es: "Encontró los 16 sprites de Píxel.", en: "Found all 16 sprites in Pixel." },
    color: "#6dff8a",
  },
  {
    id: "pixel_tablero",
    district: "pixel",
    rule: { kind: "points", key: "system:tablero", total: 10 },
    name: { es: "Pies rápidos", en: "Quick Feet" },
    desc: { es: "Sumó 10 puntos en la plaza tablero.", en: "Scored 10 points on the tile plaza." },
    color: "#a26bff",
  },
  {
    id: "vertical_azoteas",
    district: "vertical",
    rule: { kind: "race", key: "system:azoteas" },
    name: { es: "Por los tejados", en: "Rooftop Runner" },
    desc: { es: "Terminó la Ruta de las Azoteas de Vertical.", en: "Finished the Rooftop Run in Vertical." },
    color: "#ff7a45",
  },
  {
    id: "vertical_banderines",
    district: "vertical",
    rule: { kind: "hunt", key: "system:banderines" },
    name: { es: "Cazabanderines", en: "Pennant Hunter" },
    desc: { es: "Encontró los 8 banderines de Vertical.", en: "Found all 8 pennants in Vertical." },
    color: "#ffb347",
  },
  {
    id: "vertical_aguja",
    district: "vertical",
    rule: { kind: "race", key: "system:nivel5" },
    name: { es: "La Aguja", en: "The Needle" },
    desc: { es: "Subió la Aguja, el nivel 5 de Vertical.", en: "Climbed the Needle, level 5 in Vertical." },
    color: "#ff5a7a",
  },
  {
    id: "vertical_salto",
    district: "vertical",
    rule: { kind: "race", key: "system:nivel6" },
    name: { es: "Salto de fe", en: "Leap of Faith" },
    desc: { es: "Terminó Salto de fe, el nivel 6 de Vertical.", en: "Finished Leap of Faith, level 6 in Vertical." },
    color: "#c45aff",
  },
  {
    id: "vertical_retos",
    district: "vertical",
    rule: { kind: "hunt", key: "system:retos" },
    name: { es: "Tryhard", en: "Tryhard" },
    desc: { es: "Encontró los 6 retos escondidos de Vertical.", en: "Found the 6 hidden challenges in Vertical." },
    color: "#ff9f1a",
  },
];

/** Lo que un distrito guarda de una cuenta (ChunkRoom.activityOf), lo justo para las reglas. */
export interface ActivityOf {
  hunts_completed: { set_key: string }[];
  best_times: { race_key: string; ms: number }[];
  daily_points: { board_key: string; points: number }[];
}

/** Insignias que cumple una cuenta en un distrito, según lo que guarda ese distrito. */
export function earnedIn(district: string, a: ActivityOf): string[] {
  const out: string[] = [];
  for (const b of BADGES) {
    if (b.district !== district) continue;
    const r = b.rule;
    if (r.kind === "hunt" && a.hunts_completed.some((h) => h.set_key === r.key)) out.push(b.id);
    if (r.kind === "race" && a.best_times.some((t) => t.race_key === r.key && (r.under_ms === undefined || t.ms < r.under_ms))) out.push(b.id);
    if (r.kind === "points" && a.daily_points.filter((p) => p.board_key === r.key).reduce((s, p) => s + p.points, 0) >= r.total) out.push(b.id);
  }
  return out;
}

/** Ficha pública de una insignia (para el carné y el panel). */
export function badgeInfo(id: string, earned_at: number) {
  const b = BADGES.find((x) => x.id === id);
  return b ? { id, name: b.name, desc: b.desc, color: b.color, district: b.district, earned_at } : null;
}
