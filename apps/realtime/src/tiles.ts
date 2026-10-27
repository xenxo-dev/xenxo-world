/**
 * El tablero de baldosas (tiles@1, la plaza de Píxel): figuras, rondas y cuentas. El servidor
 * enciende una figura, mira las poses de cada sesión para saber qué baldosas se pisan (el
 * cliente no dice nada) y, si se pisan todas antes de que acabe el tiempo, cada cuenta que
 * pisó alguna suma un punto del día.
 *
 * Las rondas solo corren mientras hay alguien encima: un temporizador corto en memoria, nunca
 * una alarma (el objeto puede hibernar en cuanto se va la gente).
 */

export const TILES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS act_points (
    board_key TEXT NOT NULL, day TEXT NOT NULL, sub TEXT NOT NULL, name TEXT NOT NULL, player_no INTEGER,
    points INTEGER NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (board_key, day, sub));
  CREATE INDEX IF NOT EXISTS act_points_top ON act_points (board_key, day, points);
`;

/** Pausa entre que llega alguien y la primera ronda, y entre ronda y ronda. */
export const TILES_START_MS = 1500;
export const TILES_PAUSE_MS = 4000;
/** Sin nadie encima durante esto, el tablero se apaga. */
export const TILES_IDLE_MS = 8000;
/** Tiempo de una ronda: base más un poco por baldosa encendida. */
export const tilesRoundMs = (lit: number) => 4000 + lit * 700;

/** Figuras de 8 × 8 («#» encendida). Sin personajes ni nada con dueño: formas sencillas. */
const FIGURES = [
  // corazón
  ["........", ".##..##.", "########", "########", ".######.", "..####..", "...##...", "........"],
  // rombo
  ["...##...", "..#..#..", ".#....#.", "#......#", "#......#", ".#....#.", "..#..#..", "...##..."],
  // cruz
  ["...##...", "...##...", "...##...", "########", "########", "...##...", "...##...", "...##..."],
  // flecha hacia el norte
  ["...##...", "..####..", ".######.", "#..##..#", "...##...", "...##...", "...##...", "...##..."],
  // anillo
  ["..####..", ".#....#.", "#......#", "#......#", "#......#", "#......#", ".#....#.", "..####.."],
  // aspa
  ["#......#", ".#....#.", "..#..#..", "...##...", "...##...", "..#..#..", ".#....#.", "#......#"],
  // escalera
  ["#.......", "##......", ".##.....", "..##....", "...##...", "....##..", ".....##.", "......##"],
  // cara sonriente
  ["..####..", ".#....#.", "#.#..#.#", "#......#", "#.#..#.#", "#..##..#", ".#....#.", "..####.."],
  // tablero de damas (medio)
  ["#.#.#.#.", "........", ".#.#.#.#", "........", "#.#.#.#.", "........", ".#.#.#.#", "........"],
] as const;

/** Baldosas encendidas de la ronda `round` en un tablero de cols × rows (la figura se escala). */
export function figureFor(round: number, cols: number, rows: number, seed: number): number[] {
  const f = FIGURES[(round * 7 + seed) % FIGURES.length]!;
  const out: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const fr = Math.min(7, Math.floor((r * 8) / rows)), fc = Math.min(7, Math.floor((c * 8) / cols));
      if (f[fr]![fc] === "#") out.push(r * cols + c);
    }
  }
  return out;
}

export interface TileBoard {
  entity_id: string;
  owner: string;
  id: string;
  x: number;
  y: number;
  z: number;
  cols: number;
  rows: number;
  size: number;
}

/** Índice de la baldosa bajo (x, z), o −1 fuera del tablero. Fila 0 = el borde norte (−Z). */
export function tileAt(b: TileBoard, x: number, z: number): number {
  const c = Math.floor((x - (b.x - (b.cols * b.size) / 2)) / b.size);
  const r = Math.floor((z - (b.z - (b.rows * b.size) / 2)) / b.size);
  if (c < 0 || r < 0 || c >= b.cols || r >= b.rows) return -1;
  return r * b.cols + c;
}

/** Día (UTC) de los puntos: el marcador de puntos es «de hoy». */
export const pointsDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

/** Una partida en marcha (en memoria). */
export interface TileGame {
  board: TileBoard;
  round: number;
  state: "show" | "won" | "lost" | "idle";
  lit: number[];
  done: Set<number>;
  /** Cuentas que han pisado alguna baldosa en esta ronda (para el punto si se gana). */
  players: Map<string, { name: string; no: number | null }>;
  endsAt: number;
  lastPresence: number;
  timer: ReturnType<typeof setTimeout> | null;
}
