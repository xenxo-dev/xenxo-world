/**
 * Operar xenxo sin desplegar: lo que comparten el Worker, el Directory y los chunks.
 *
 *  - Interruptores de emergencia (/mod/flags): moderación cierra al momento las altas, el chat o la
 *    zona de pruebas, y lo vuelve a abrir. Las altas las corta el Directory; el chat y la zona de
 *    pruebas, cada lugar (ChunkRoom.setFlags), que se lo dice a quien entra (WELCOME.closed).
 *  - Contadores de visitas (/mod/stats): sumas por día de visitas, entradas al mundo, lugares,
 *    cuentas nuevas y proyectos. Con `?v=<etiqueta>` en el enlace, también por etiqueta (de qué
 *    vídeo o publicación viene la gente). Son sumas: nunca quién, ni su dirección de red.
 *  - Copia propia (/admin/backup, /admin/restore; tools/backup): qué tablas del Directory salen.
 */

/* --- Interruptores de emergencia ------------------------------------------------------------- */

export const FLAG_NAMES = ["signups", "chat", "sandbox"] as const;
export type FlagName = (typeof FLAG_NAMES)[number];
/** true = abierto (lo normal); false = cerrado por moderación. */
export type Flags = Record<FlagName, boolean>;

/** Lo que cierra un lugar (los demás interruptores no son cosa suya). */
export type PlaceFlags = Pick<Flags, "chat" | "sandbox">;

/* --- Contadores de visitas --------------------------------------------------------------------- */

/**
 * visit: alguien abre la web (una vez por pestaña) · enter: entra al mundo · place: entra en un
 * lugar (la etiqueta es el lugar) · signup: cuenta nueva · project: proyecto publicado.
 */
export const STAT_EVENTS = ["visit", "enter", "place", "signup", "project"] as const;
export type StatEvent = (typeof STAT_EVENTS)[number];
export type StatItem = { event: StatEvent; tag: string; n: number };

/** La etiqueta de un enlace (?v=tiktok-12): corta y sin nada raro. La misma regla que en la web (net/campaign.ts). */
const STAT_TAG = /^[a-z0-9][a-z0-9_-]{0,23}$/;
/** Sin etiqueta (o con una que no vale). */
export const NO_TAG = "-";
/** Cuando un día ya tiene demasiadas etiquetas distintas, las demás se suman aquí. */
export const OTHER_TAG = "otros";
export const statTag = (raw: unknown): string => (typeof raw === "string" && STAT_TAG.test(raw) ? raw : NO_TAG);

export const STATS_KEEP_DAYS = 180;
/** Etiquetas distintas por día y contador: nadie llena la tabla inventándose etiquetas. */
export const STATS_TAGS_PER_DAY = 60;
export const statsDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/* --- Copia propia -------------------------------------------------------------------------------- */

/**
 * Las tablas del Directory que van en la copia. No van las claves privadas (`oidc_keys`, la de
 * «Entrar con xenxo», y `node_key`, la de los nodos: se crean de nuevo) ni lo que caduca solo
 * (`flows`, `oidc_pending`, `badge_checks`). Sí va `oidc_secrets`: es la sal con la que sale el
 * identificador de cada persona en cada juego; sin ella, tras restaurar, los juegos no reconocerían
 * a nadie. Una tabla nueva con datos de la gente se añade aquí.
 */
export const BACKUP_TABLES = [
  "users", "credentials", "logins", "recovery_codes", "skins", "badges", "counters",
  "projects", "uploads", "agent_keys",
  "oidc_secrets", "oidc_clients", "oidc_grants",
  "reports", "moderators", "moderation_log", "flags",
  "community_districts", "community_files",
  "jams", "jam_entries", "jam_votes", "meetups",
  "nodes", "chunk_hosts",
  "stats",
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];
export const isBackupTable = (t: string): t is BackupTable => (BACKUP_TABLES as readonly string[]).includes(t);

/** Filas por página y tope de tamaño (una ficha de distrito puede pesar 512 KB). */
export const BACKUP_PAGE_ROWS = 400;
export const BACKUP_PAGE_BYTES = 1_500_000;
