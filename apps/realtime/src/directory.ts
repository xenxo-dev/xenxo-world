/**
 * Directory — cuentas, passkeys, proyectos, subidas y denuncias.
 *
 * Un único Durable Object (con la misma jurisdicción UE que los chunks).
 * Datos mínimos por diseño (RGPD): nombre visible, avatar, credenciales públicas
 * de passkey y lo que la persona publica. Sin email, sin contraseña, sin IP.
 *
 * El mundo NO se escribe aquí: los stands de proyectos los coloca el chunk
 * (ChunkRoom.placeStand) con la misma validación que cualquier mutación.
 */
import { DurableObject } from "cloudflare:workers";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { Env } from "./index";
import { randomId } from "./auth";
import { isAvatarPreset } from "./avatar-presets-check";
import { assetKey } from "./assets";
import { AVATAR_PRESETS } from "./avatar-presets";
import {
  b64url, CODE_TTL_MS, ACCESS_TOKEN_TTL_MS, ID_TOKEN_TTL_S, MAX_CLIENTS_PER_USER, MAX_REDIRECTS, parseScopes, REQUEST_TTL_MS,
  sha256b64url, signJwt, validChallenge, validClientName, validNonce, validRedirectUri, validState, validVerifier, withParams,
} from "./oidc";
import { type ProjectCategory } from "@xenxo/protocol";
import { DISTRICTS, districtById, PARCELS, parcelIndex, parcelRect, RENAMED_PARCELS } from "./districts";
import { gameInfo, manifestAvatar, slugFrom, validSlug, type GameInfo } from "./games";
import { COMMUNITY_SCHEMA, communityChunk, MAX_DISTRICT_SAVES_PER_DAY, submissionFiles, type CommunityStatus, type ResolvedPortal } from "./community";
import { isSystemAsset } from "./assets";
import type { DistrictSubmission } from "@xenxo/protocol";
import { BADGES, badgeInfo } from "./badges";
import { badJamDates, JAM_SCHEMA, jamPhase, jamRanking, jamText, jamTime, MAX_ENTRIES_PER_USER, validJamSlug, type Jam, type JamResult } from "./jam";
import type { GameManifest } from "@xenxo/protocol";

export const TERMS_VERSION = "2026-10";
const FLOW_TTL_MS = 5 * 60 * 1000;
/** Flujos de alta y acceso vivos a la vez (todos los visitantes juntos). */
const MAX_LIVE_FLOWS = 3000;
/** Peticiones de «Entrar con xenxo» vivas: por juego y en total. */
const MAX_PENDING_PER_CLIENT = 300;
const MAX_PENDING_TOTAL = 5000;
/** Un permiso usado hace más de esto vuelve a pedir un clic (no se entra solo). */
const SILENT_GRANT_MS = 30 * 86_400_000;
const MAX_PROJECTS_PER_USER = 5;
/** Personajes propios guardados por cuenta (el armario). Los de serie no cuentan. */
export const MAX_SKINS = 3;
/** Claves de agente por proyecto (para construir en su parcela). */
export const MAX_AGENT_KEYS_PER_PROJECT = 3;
/** Un archivo subido por una persona que nada usa se borra pasados estos días. */
export const ORPHAN_GRACE_MS = 7 * 86_400_000;
const CLEANUP_EVERY_MS = 86_400_000;
const MAX_UPLOADS_PER_DAY = 80;
/**
 * Topes de almacenamiento para no salir nunca del plan gratuito de R2 (10 GB-mes).
 * Al llegar al tope global se rechazan subidas nuevas; nada se cobra.
 */
export const STORAGE_CAP_BYTES = 8 * 1024 ** 3;
export const USER_QUOTA_BYTES = 100 * 1024 ** 2;
/** Margen: el mayor modelo permitido (6 MB), porque el tamaño real se sabe después de leerlo. */
const UPLOAD_HEADROOM = 6 * 1024 ** 2;
/** Subidas al día entre todo el mundo: unas 30.000 escrituras al mes como mucho (R2 regala 1 millón). */
export const MAX_UPLOADS_PER_DAY_GLOBAL = 1000;
const MAX_REPORTS_PER_DAY = 20;
const MAX_MANIFEST_READS_PER_DAY = 30;
const RESERVED_NAMES = new Set(["system", "admin", "xenxo", "moderador", "moderator", "anthropic", "claude"]);

export type Fail = { ok: false; status: number; error: string; message: string; detail?: unknown };
export type Ok<T> = { ok: true; data: T };
export type Result<T> = Ok<T> | Fail;

const ok = <T>(data: T): Ok<T> => ({ ok: true, data });
const fail = (status: number, error: string, message: string, detail?: unknown): Fail => ({ ok: false, status, error, message, detail });

export type OidcClientRow = { client_id: string; name: string; redirect_uris: string[]; project_id: string | null; created_at: number };

export type AgentKeyRow = { id: string; project_id: string; project_title: string; label: string | null; created_at: number; last_used: number | null };
export type AgentZone = { chunk_id: string; district: string; parcel: string; owner: string; x0: number; z0: number; x1: number; z1: number; facing: number };
export type AgentZoneGrant = { key_id: string; user_id: string; name: string; zone: AgentZone };

type CommunityRow = {
  id: string; user_id: string; slug: string; chunk_id: string; manifest: string; portals: string; rev: number; status: string;
  review_note: string | null; reviewed_at: number | null; created_at: number; updated_at: number; saves_day: string | null; saves: number;
};
/** Un distrito de la comunidad tal como lo ven su autor y moderación (el contacto, solo ellos). */
export type CommunityDistrict = {
  id: string; slug: string; chunk_id: string; status: CommunityStatus; review_note: string | null; rev: number;
  manifest: DistrictSubmission; portals: ResolvedPortal[]; created_at: number; updated_at: number;
  author: { display_name: string; player_no: number | null };
};

export type SkinRow = { hash: string; format: string; label: string | null; created_at: number };

export type UserRow = {
  id: string;
  display_name: string;
  avatar_hash: string | null;
  avatar_format: "glb" | "vrm" | null;
  created_at: number;
  /** Número de jugador: por orden de alta desde el 1; el 0 es el fundador. */
  player_no: number | null;
};

export type PublicProject = {
  id: string;
  title: string;
  summary: string;
  url: string | null;
  mesh_hash: string | null;
  /** Portada 16:9 (obligatoria desde el nexo; los antiguos pueden no tenerla). */
  cover_hash: string | null;
  category: ProjectCategory;
  /** Distrito y parcela donde está su portal (los antiguos pueden no tenerlos). */
  district: string | null;
  parcel: string | null;
  author: string;
  created_at: number;
  in_world: boolean;
  /** xenxo.io/j/<slug>, si tiene ficha de juego. */
  slug: string | null;
  /** Revisión humana: solo los aprobados salen en el catálogo y en el escaparate del nexo. */
  review: "pending" | "approved" | "rejected";
  /** La ficha del juego (xenxo.json) tal como la guardó xenxo, si la tiene. */
  game: GameInfo | null;
  /** Solo para su autor: por qué se rechazó u ocultó (DSA, «exposición de motivos»). */
  review_note?: string | null;
  /** "published" u "hidden" (oculto por moderación: solo lo ve su autor). */
  status?: string;
};

export type ReviewDecision = "approved" | "rejected";

/** Respuesta a una petición de «Entrar con xenxo»: redirección o mensaje al juego incrustado. */
export type OidcResponse = { redirect: string; web_message?: undefined } | { web_message: { origin: string; params: Record<string, string> }; redirect?: undefined };

export function validDisplayName(raw: unknown, allowReserved = false): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N} _.\-]{2,32}$/u.test(name)) return null;
  if (!allowReserved && RESERVED_NAMES.has(name.toLowerCase())) return null;
  return name;
}

/** Por qué no vale un nombre: reservado (de xenxo o del sistema) o mal formado. */
function badName(raw: unknown): Fail {
  const reserved = typeof raw === "string" && RESERVED_NAMES.has(raw.trim().replace(/\s+/g, " ").toLowerCase());
  return reserved
    ? fail(400, "name_reserved", "ese nombre está reservado; elige otro")
    : fail(400, "bad_name", "nombre no válido: 2–32 letras, números, espacios, «.», «_» o «-»");
}

function validHttpsUrl(raw: unknown): string | null | false {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 300) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : false;
  } catch {
    return false;
  }
}

export class Directory extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // Limpieza diaria de archivos huérfanos (alarma del propio objeto: sin servicios extra).
    void ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 3_600_000);
    });
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, display_name TEXT NOT NULL, avatar_hash TEXT, avatar_format TEXT,
        created_at INTEGER NOT NULL, terms_version TEXT NOT NULL, age_confirmed INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL,
        transports TEXT, created_at INTEGER NOT NULL, last_used INTEGER);
      CREATE TABLE IF NOT EXISTS flows (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, challenge TEXT NOT NULL, user_id TEXT, display_name TEXT, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, url TEXT,
        mesh_hash TEXT, status TEXT NOT NULL, in_world INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS uploads (
        hash TEXT NOT NULL, uploader TEXT NOT NULL, kind TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (hash, uploader));
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, reporter TEXT NOT NULL, target_type TEXT NOT NULL,
        target_id TEXT NOT NULL, reason TEXT NOT NULL, details TEXT, status TEXT NOT NULL DEFAULT 'open');
      -- Otras formas de entrar (Google). De Google solo se guarda el hash de su identificador.
      CREATE TABLE IF NOT EXISTS logins (
        provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_used INTEGER,
        PRIMARY KEY (provider, subject));
      CREATE TABLE IF NOT EXISTS counters (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
      -- «Entrar con xenxo» (OpenID Connect). Claves de firma Ed25519: la privada no sale de aquí.
      CREATE TABLE IF NOT EXISTS oidc_keys (
        kid TEXT PRIMARY KEY, private_jwk TEXT NOT NULL, public_jwk TEXT NOT NULL, created_at INTEGER NOT NULL, active INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oidc_secrets (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      -- Juegos que usan «Entrar con xenxo» (clientes públicos: sin secreto, con PKCE).
      CREATE TABLE IF NOT EXISTS oidc_clients (
        client_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, redirect_uris TEXT NOT NULL,
        project_id TEXT, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active');
      -- Lo que cada persona ha permitido a cada juego.
      CREATE TABLE IF NOT EXISTS oidc_grants (
        user_id TEXT NOT NULL, client_id TEXT NOT NULL, scopes TEXT NOT NULL, created_at INTEGER NOT NULL, last_used INTEGER,
        PRIMARY KEY (user_id, client_id));
      -- Peticiones en curso, códigos de un uso y tokens de acceso (de estos, solo su huella).
      CREATE TABLE IF NOT EXISTS oidc_pending (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS oidc_pending_expires ON oidc_pending(expires);
      CREATE INDEX IF NOT EXISTS flows_ts ON flows(ts);
      -- Claves de agente de una parcela: solo se guarda la huella (sha256) de la clave.
      CREATE TABLE IF NOT EXISTS agent_keys (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
        label TEXT, created_at INTEGER NOT NULL, last_used INTEGER);
      -- El armario: hasta MAX_SKINS personajes propios por cuenta (archivos que subió esa persona).
      -- Moderación: quién modera (el fundador siempre) y el registro de cada decisión (DSA).
      CREATE TABLE IF NOT EXISTS moderators (user_id TEXT PRIMARY KEY, added_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS moderation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, moderator TEXT NOT NULL, action TEXT NOT NULL,
        target_type TEXT NOT NULL, target_id TEXT NOT NULL, note TEXT);
      CREATE TABLE IF NOT EXISTS skins (
        user_id TEXT NOT NULL, hash TEXT NOT NULL, format TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, hash));
    `);
    // Jams: convocatorias, juegos apuntados y votos (ver jam.ts).
    this.sql.exec(JAM_SCHEMA);
    // Insignias de las actividades (badges.ts): las comprueba el Worker con los distritos.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS badges (user_id TEXT NOT NULL, badge_id TEXT NOT NULL, earned_at INTEGER NOT NULL, PRIMARY KEY (user_id, badge_id));
      CREATE TABLE IF NOT EXISTS badge_checks (user_id TEXT PRIMARY KEY, ts INTEGER NOT NULL);
    `);
    // Distritos de la comunidad (ver community.ts).
    this.sql.exec(COMMUNITY_SCHEMA);
    // Migración: tamaño de cada subida (para los topes de almacenamiento).
    const cols = this.sql.exec<{ name: string }>("PRAGMA table_info(uploads)").toArray().map((c) => c.name);
    if (!cols.includes("bytes")) this.sql.exec("ALTER TABLE uploads ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0");
    // Migración: portada y categoría de los proyectos (para el nexo).
    const pcols = this.sql.exec<{ name: string }>("PRAGMA table_info(projects)").toArray().map((c) => c.name);
    if (!pcols.includes("cover_hash")) this.sql.exec("ALTER TABLE projects ADD COLUMN cover_hash TEXT");
    if (!pcols.includes("category")) this.sql.exec("ALTER TABLE projects ADD COLUMN category TEXT NOT NULL DEFAULT 'other'");
    // Migración: distrito y parcela (una parcela publicada solo puede tener un proyecto).
    if (!pcols.includes("district")) this.sql.exec("ALTER TABLE projects ADD COLUMN district TEXT");
    if (!pcols.includes("parcel")) this.sql.exec("ALTER TABLE projects ADD COLUMN parcel TEXT");
    // Disposiciones v2 y v3 de los distritos: las parcelas cambian de nombre (B4 → A5 → N5, D2 → S3…);
    // el chunk mueve lo que hubiera en ellas (migrateParcelLayout en chunk-room.ts).
    for (const [from, to] of RENAMED_PARCELS) this.sql.exec("UPDATE projects SET parcel = ? WHERE parcel = ?", to, from);
    this.sql.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS projects_parcel ON projects(district, parcel) WHERE status = 'published' AND district IS NOT NULL",
    );
    // Migración: ficha de juego (xenxo.json), su enlace xenxo.io/j/<slug> y la revisión humana.
    if (!pcols.includes("slug")) this.sql.exec("ALTER TABLE projects ADD COLUMN slug TEXT");
    if (!pcols.includes("game")) this.sql.exec("ALTER TABLE projects ADD COLUMN game TEXT");
    if (!pcols.includes("game_at")) this.sql.exec("ALTER TABLE projects ADD COLUMN game_at INTEGER");
    if (!pcols.includes("review")) {
      this.sql.exec("ALTER TABLE projects ADD COLUMN review TEXT NOT NULL DEFAULT 'pending'");
      // Lo publicado antes de que existiera la revisión lo publicó el equipo de xenxo: aprobado.
      this.sql.exec("UPDATE projects SET review = 'approved'");
    }
    if (!pcols.includes("review_note")) this.sql.exec("ALTER TABLE projects ADD COLUMN review_note TEXT");
    if (!pcols.includes("reviewed_at")) this.sql.exec("ALTER TABLE projects ADD COLUMN reviewed_at INTEGER");
    this.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS projects_slug ON projects(slug) WHERE slug IS NOT NULL");
    // Migración: número de jugador. Las cuentas que ya existían se numeran por orden de alta.
    const ucols = this.sql.exec<{ name: string }>("PRAGMA table_info(users)").toArray().map((c) => c.name);
    if (!ucols.includes("player_no")) {
      this.sql.exec("ALTER TABLE users ADD COLUMN player_no INTEGER");
      const ids = this.sql.exec<{ id: string }>("SELECT id FROM users ORDER BY created_at, id").toArray();
      ids.forEach((r, i) => this.sql.exec("UPDATE users SET player_no = ? WHERE id = ?", i + 1, r.id));
    }
    this.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_player_no ON users(player_no)");
    // Migración: carné público (apagado por defecto; lo enciende cada persona).
    if (!ucols.includes("card_public")) this.sql.exec("ALTER TABLE users ADD COLUMN card_public INTEGER NOT NULL DEFAULT 0");
    // Migración: retrato del personaje (lo hace la web en el navegador) y de qué personaje es.
    if (!ucols.includes("portrait_hash")) this.sql.exec("ALTER TABLE users ADD COLUMN portrait_hash TEXT");
    if (!ucols.includes("portrait_of")) this.sql.exec("ALTER TABLE users ADD COLUMN portrait_of TEXT");
    // Contador de números de jugador: nunca baja, así un número no se reutiliza aunque se borre la cuenta.
    this.sql.exec("INSERT OR IGNORE INTO counters (k, v) VALUES ('next_player', (SELECT COALESCE(MAX(player_no), 0) + 1 FROM users))");
    // Migración: el personaje propio que ya llevaba cada cuenta entra en su armario (una sola vez).
    if (!this.sql.exec("SELECT 1 FROM counters WHERE k = 'skins_migrated'").toArray().length) {
      this.sql.exec(
        `INSERT OR IGNORE INTO skins (user_id, hash, format, label, created_at)
         SELECT u.id, u.avatar_hash, COALESCE(u.avatar_format, 'glb'), NULL, u.created_at FROM users u
         WHERE u.avatar_hash IS NOT NULL
           AND EXISTS (SELECT 1 FROM uploads p WHERE p.hash = u.avatar_hash AND p.uploader = 'usr_' || u.id AND p.kind = 'avatar')`,
      );
      this.sql.exec("INSERT INTO counters (k, v) VALUES ('skins_migrated', 1)");
    }
    // El fundador es el jugador 0 (su cuenta se indica en FOUNDER_USER_ID).
    const founder = (env.FOUNDER_USER_ID ?? "").replace(/^usr_/, "").trim();
    if (founder) {
      this.sql.exec("UPDATE users SET player_no = NULL WHERE player_no = 0 AND id != ?", founder);
      this.sql.exec("UPDATE users SET player_no = 0 WHERE id = ?", founder);
    }
  }

  private get rpID() {
    return this.env.RP_ID || "localhost";
  }

  private get origins() {
    return (this.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  }

  /** Siguiente número de jugador (el «DNI»): consecutivo y sin reutilizar. Llamar dentro de la transacción del alta. */
  private takePlayerNo(): number {
    const cur = this.sql.exec<{ v: number }>("SELECT v FROM counters WHERE k = 'next_player'").one().v;
    const max = this.sql.exec<{ m: number | null }>("SELECT MAX(player_no) AS m FROM users").one().m ?? 0;
    const n = Math.max(cur, max + 1);
    this.sql.exec("UPDATE counters SET v = ? WHERE k = 'next_player'", n + 1);
    return n;
  }

  private createUser(id: string, name: string, now: number) {
    this.sql.exec(
      "INSERT INTO users (id, display_name, created_at, terms_version, age_confirmed, player_no) VALUES (?, ?, ?, ?, 1, ?)",
      id,
      name,
      now,
      TERMS_VERSION,
      this.takePlayerNo(),
    );
  }

  /**
   * Los flujos de alta y acceso los puede empezar cualquiera sin cuenta: se limpian por índice y
   * hay un tope de vivos para que nadie llene el Directory (y la cuota del día) a base de peticiones.
   */
  private flowsBusy(): Fail | null {
    this.sql.exec("DELETE FROM flows WHERE ts < ?", Date.now() - FLOW_TTL_MS);
    const n = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM flows").one().n;
    return n >= MAX_LIVE_FLOWS ? fail(503, "busy", "hay demasiadas entradas en curso; prueba en un minuto") : null;
  }

  private takeFlow(id: unknown, kind: "register" | "login" | "addkey" | "google" | "gcode") {
    this.sql.exec("DELETE FROM flows WHERE ts < ?", Date.now() - FLOW_TTL_MS);
    if (typeof id !== "string") return null;
    const row = this.sql
      .exec<{ challenge: string; user_id: string | null; display_name: string | null; ts: number }>(
        "SELECT challenge, user_id, display_name, ts FROM flows WHERE id = ? AND kind = ?",
        id,
        kind,
      )
      .toArray()[0];
    this.sql.exec("DELETE FROM flows WHERE id = ?", id); // un solo uso
    return row ?? null;
  }

  /* ---------------------------------------------------------------- */
  /* Alta y acceso con passkey                                          */
  /* ---------------------------------------------------------------- */

  async registerOptions(body: { display_name?: unknown; age_confirmed?: unknown; accept_terms?: unknown }) {
    const name = validDisplayName(body.display_name);
    if (!name) return badName(body.display_name);
    if (body.age_confirmed !== true) return fail(400, "age_required", "hace falta tener 14 años o más para crear una cuenta");
    if (body.accept_terms !== TERMS_VERSION) return fail(400, "terms_required", "acepta las condiciones y la política de privacidad vigentes", { terms_version: TERMS_VERSION });
    const busy = this.flowsBusy();
    if (busy) return busy;

    const userId = randomId("", 12);
    const options = await generateRegistrationOptions({
      rpName: "xenxo.io",
      rpID: this.rpID,
      userName: name,
      userDisplayName: name,
      userID: new TextEncoder().encode(userId) as Uint8Array<ArrayBuffer>,
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    const flow = randomId("f_");
    this.sql.exec(
      "INSERT INTO flows (id, kind, challenge, user_id, display_name, ts) VALUES (?, 'register', ?, ?, ?, ?)",
      flow,
      options.challenge,
      userId,
      name,
      Date.now(),
    );
    return ok({ flow_id: flow, options });
  }

  async registerVerify(body: { flow_id?: unknown; response?: unknown }): Promise<Result<UserRow>> {
    const flow = this.takeFlow(body.flow_id, "register");
    if (!flow || !flow.user_id || !flow.display_name) return fail(400, "flow_expired", "el alta caducó; vuelve a empezar");
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response as RegistrationResponseJSON,
        expectedChallenge: flow.challenge,
        expectedOrigin: this.origins,
        expectedRPID: this.rpID,
        requireUserVerification: false,
      });
    } catch (e) {
      return fail(400, "passkey_invalid", "no se pudo verificar la passkey", String(e));
    }
    if (!verification.verified || !verification.registrationInfo) return fail(400, "passkey_invalid", "no se pudo verificar la passkey");
    const { credential } = verification.registrationInfo;
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.createUser(flow.user_id!, flow.display_name!, now);
      this.sql.exec(
        "INSERT INTO credentials (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        credential.id,
        flow.user_id,
        isoBase64URL.fromBuffer(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports ?? []),
        now,
      );
    });
    return ok(this.user(flow.user_id!)!);
  }

  async loginOptions(): Promise<Result<{ flow_id: string; options: Awaited<ReturnType<typeof generateAuthenticationOptions>> }>> {
    const busy = this.flowsBusy();
    if (busy) return busy;
    const options = await generateAuthenticationOptions({ rpID: this.rpID, userVerification: "preferred" });
    const flow = randomId("f_");
    this.sql.exec("INSERT INTO flows (id, kind, challenge, ts) VALUES (?, 'login', ?, ?)", flow, options.challenge, Date.now());
    return ok({ flow_id: flow, options });
  }

  async loginVerify(body: { flow_id?: unknown; response?: unknown }): Promise<Result<UserRow>> {
    const flow = this.takeFlow(body.flow_id, "login");
    if (!flow) return fail(400, "flow_expired", "el acceso caducó; vuelve a intentarlo");
    const response = body.response as AuthenticationResponseJSON;
    const cred = this.sql
      .exec<{ id: string; user_id: string; public_key: string; counter: number; transports: string | null }>(
        "SELECT id, user_id, public_key, counter, transports FROM credentials WHERE id = ?",
        typeof response?.id === "string" ? response.id : "",
      )
      .toArray()[0];
    if (!cred) return fail(401, "unknown_passkey", "esta passkey no pertenece a ninguna cuenta");
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: flow.challenge,
        expectedOrigin: this.origins,
        expectedRPID: this.rpID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: isoBase64URL.toBuffer(cred.public_key),
          counter: cred.counter,
          transports: JSON.parse(cred.transports ?? "[]") as AuthenticatorTransport[],
        },
      });
    } catch (e) {
      return fail(401, "passkey_invalid", "no se pudo verificar la passkey", String(e));
    }
    if (!verification.verified) return fail(401, "passkey_invalid", "no se pudo verificar la passkey");
    this.sql.exec(
      "UPDATE credentials SET counter = ?, last_used = ? WHERE id = ?",
      verification.authenticationInfo.newCounter,
      Date.now(),
      cred.id,
    );
    const user = this.user(cred.user_id);
    return user ? ok(user) : fail(401, "unknown_user", "la cuenta ya no existe");
  }

  /* ---------------------------------------------------------------- */
  /* Más passkeys en la misma cuenta                                    */
  /* ---------------------------------------------------------------- */

  async addPasskeyOptions(userId: string) {
    const u = this.user(userId);
    if (!u) return fail(404, "not_found", "la cuenta no existe");
    const existing = this.sql.exec<{ id: string }>("SELECT id FROM credentials WHERE user_id = ?", userId).toArray();
    const options = await generateRegistrationOptions({
      rpName: "xenxo.io",
      rpID: this.rpID,
      userName: u.display_name,
      userDisplayName: u.display_name,
      userID: new TextEncoder().encode(userId) as Uint8Array<ArrayBuffer>,
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({ id: c.id })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    const flow = randomId("f_");
    this.sql.exec("INSERT INTO flows (id, kind, challenge, user_id, ts) VALUES (?, 'addkey', ?, ?, ?)", flow, options.challenge, userId, Date.now());
    return ok({ flow_id: flow, options });
  }

  async addPasskeyVerify(userId: string, body: { flow_id?: unknown; response?: unknown }): Promise<Result<{ passkeys: number }>> {
    const flow = this.takeFlow(body.flow_id, "addkey");
    if (!flow || flow.user_id !== userId) return fail(400, "flow_expired", "caducó; vuelve a empezar");
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response as RegistrationResponseJSON,
        expectedChallenge: flow.challenge,
        expectedOrigin: this.origins,
        expectedRPID: this.rpID,
        requireUserVerification: false,
      });
    } catch (e) {
      return fail(400, "passkey_invalid", "no se pudo verificar la passkey", String(e));
    }
    if (!verification.verified || !verification.registrationInfo) return fail(400, "passkey_invalid", "no se pudo verificar la passkey");
    const { credential } = verification.registrationInfo;
    this.sql.exec(
      "INSERT INTO credentials (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      credential.id,
      userId,
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      Date.now(),
    );
    return ok({ passkeys: this.countPasskeys(userId) });
  }

  private countPasskeys(userId: string): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?", userId).one().n;
  }

  /* ---------------------------------------------------------------- */
  /* Entrar con Google (OpenID Connect, solo el alcance "openid")       */
  /* ---------------------------------------------------------------- */

  /**
   * Prepara un viaje a Google: estado de un solo uso, nonce y PKCE. Para darse de alta se validan
   * aquí el nombre, la edad y las condiciones (igual que con passkey); para vincular, la cuenta.
   */
  async googleStart(input: {
    mode: unknown;
    userId?: string;
    display_name?: unknown;
    age_confirmed?: unknown;
    accept_terms?: unknown;
    origin: string;
  }): Promise<Result<{ state: string; nonce: string; code_challenge: string }>> {
    const mode = input.mode;
    if (mode !== "login" && mode !== "register" && mode !== "link") return fail(400, "bad_message", "mode: login, register o link");
    const busy = this.flowsBusy();
    if (busy) return busy;
    let name: string | null = null;
    if (mode === "register") {
      name = validDisplayName(input.display_name);
      if (!name) return badName(input.display_name);
      if (input.age_confirmed !== true) return fail(400, "age_required", "hace falta tener 14 años o más para crear una cuenta");
      if (input.accept_terms !== TERMS_VERSION) return fail(400, "terms_required", "acepta las condiciones y la política de privacidad vigentes");
    }
    if (mode === "link" && (!input.userId || !this.user(input.userId))) return fail(401, "unauthorized", "inicia sesión para vincular Google");
    const state = randomId("g_", 24);
    const nonce = randomId("n_", 16);
    const verifier = randomId("", 48);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const code_challenge = isoBase64URL.fromBuffer(digest);
    this.sql.exec(
      "INSERT INTO flows (id, kind, challenge, user_id, display_name, ts) VALUES (?, 'google', ?, ?, ?, ?)",
      state,
      JSON.stringify({ verifier, nonce, mode, origin: input.origin }),
      mode === "link" ? input.userId! : null,
      name,
      Date.now(),
    );
    return ok({ state, nonce, code_challenge });
  }

  /** Recupera (y consume) el viaje a Google por su estado. */
  /**
   * Para vincular Google desde la web (que pide el enlace con fetch): sin gastar el flujo, los datos
   * para mandar a Google desde una navegación normal, que es la que deja la cookie que lo ata.
   */
  async googleLinkPeek(state: unknown): Promise<{ state: string; nonce: string; code_challenge: string } | null> {
    if (typeof state !== "string") return null;
    const f = this.sql
      .exec<{ challenge: string; ts: number }>("SELECT challenge, ts FROM flows WHERE id = ? AND kind = 'google'", state)
      .toArray()[0];
    if (!f || f.ts < Date.now() - FLOW_TTL_MS) return null;
    const data = JSON.parse(f.challenge) as { verifier: string; nonce: string; mode: string };
    if (data.mode !== "link") return null;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data.verifier)));
    return { state, nonce: data.nonce, code_challenge: isoBase64URL.fromBuffer(digest) };
  }

  googleFlow(state: unknown) {
    const f = this.takeFlow(state, "google");
    if (!f) return null;
    const data = JSON.parse(f.challenge) as { verifier: string; nonce: string; mode: "login" | "register" | "link"; origin: string };
    return { ...data, user_id: f.user_id, display_name: f.display_name };
  }

  /**
   * Termina el viaje con el identificador de Google ya comprobado por el Worker. Devuelve un código
   * de un solo uso (60 s) que la web cambia por la sesión: así el token nunca viaja en una URL.
   */
  async googleComplete(
    flow: { mode: "login" | "register" | "link"; user_id: string | null; display_name: string | null },
    googleSub: string,
  ): Promise<Result<{ code: string | null; linked: boolean }>> {
    const subject = await sha256Hex(`xenxo-google:${googleSub}`);
    const owner = this.sql.exec<{ user_id: string }>("SELECT user_id FROM logins WHERE provider = 'google' AND subject = ?", subject).toArray()[0]?.user_id;
    const now = Date.now();
    let userId: string;
    if (flow.mode === "link") {
      if (owner && owner !== flow.user_id) return fail(409, "google_taken", "esa cuenta de Google ya entra en otro jugador");
      if (!owner) this.sql.exec("INSERT INTO logins (provider, subject, user_id, created_at) VALUES ('google', ?, ?, ?)", subject, flow.user_id, now);
      return ok({ code: null, linked: true });
    }
    if (owner) {
      userId = owner;
    } else if (flow.mode === "register" && flow.display_name) {
      userId = randomId("", 12);
      this.ctx.storage.transactionSync(() => {
        this.createUser(userId, flow.display_name!, now);
        this.sql.exec("INSERT INTO logins (provider, subject, user_id, created_at) VALUES ('google', ?, ?, ?)", subject, userId, now);
      });
    } else {
      return fail(404, "google_unknown", "no hay ninguna cuenta con ese Google; crea una o entra con tu passkey y vincúlalo");
    }
    this.sql.exec("UPDATE logins SET last_used = ? WHERE provider = 'google' AND subject = ?", now, subject);
    const code = randomId("c_", 24);
    this.sql.exec("INSERT INTO flows (id, kind, challenge, user_id, ts) VALUES (?, 'gcode', '-', ?, ?)", code, userId, now);
    return ok({ code, linked: false });
  }

  /** Cambia el código de un solo uso por la cuenta (la sesión la firma el Worker). */
  googleRedeem(code: unknown): Result<UserRow> {
    const f = this.takeFlow(code, "gcode");
    if (!f || !f.user_id || Date.now() - f.ts > 60_000) return fail(400, "flow_expired", "caducó; vuelve a entrar");
    const u = this.user(f.user_id);
    return u ? ok(u) : fail(401, "unknown_user", "la cuenta ya no existe");
  }

  /** Formas de entrar de una cuenta (para sus ajustes). */
  logins(userId: string) {
    const google = this.sql.exec<{ created_at: number; last_used: number | null }>(
      "SELECT created_at, last_used FROM logins WHERE provider = 'google' AND user_id = ?",
      userId,
    ).toArray()[0];
    return {
      passkeys: this.sql.exec("SELECT created_at, last_used FROM credentials WHERE user_id = ? ORDER BY created_at", userId).toArray(),
      google: google ?? null,
    };
  }

  /** Quita Google de la cuenta (solo si le queda al menos una passkey para entrar). */
  unlinkGoogle(userId: string): Result<{ unlinked: boolean }> {
    if (this.countPasskeys(userId) === 0) return fail(409, "last_login", "añade antes una passkey: es tu única forma de entrar");
    const n = this.sql.exec("DELETE FROM logins WHERE provider = 'google' AND user_id = ?", userId).rowsWritten;
    return ok({ unlinked: n > 0 });
  }

  /* ---------------------------------------------------------------- */
  /* Perfil                                                             */
  /* ---------------------------------------------------------------- */

  user(id: string): UserRow | null {
    return (
      this.sql
        .exec<UserRow>("SELECT id, display_name, avatar_hash, avatar_format, created_at, player_no FROM users WHERE id = ?", id)
        .toArray()[0] ?? null
    );
  }

  async me(id: string): Promise<Result<UserRow & { projects: PublicProject[]; avatar_effective: { hash: string; format: string }; portrait: { hash: string; current: boolean } | null }>> {
    const u = this.user(id);
    if (!u) return fail(404, "not_found", "la cuenta no existe");
    return ok({ ...u, projects: this.projectsOf(id, true), avatar_effective: await this.effectiveAvatar(u), portrait: await this.portrait(u) });
  }

  /**
   * El personaje que lleva una persona: el elegido o, si no eligió, uno de serie fijo para ella
   * (el mismo en todos los juegos).
   */
  async effectiveAvatar(u: UserRow): Promise<{ hash: string; format: string }> {
    if (u.avatar_hash) return { hash: u.avatar_hash, format: u.avatar_format ?? "vrm" };
    const i = parseInt((await sha256b64url(u.id)).replace(/[^0-9]/g, "").slice(0, 6) || "0", 10) % AVATAR_PRESETS.length;
    return { hash: AVATAR_PRESETS[i]!.hash, format: "vrm" };
  }

  /** Su retrato y si es del personaje que lleva ahora (si no, la web hace uno nuevo). */
  private async portrait(u: UserRow): Promise<{ hash: string; current: boolean } | null> {
    const r = this.sql
      .exec<{ portrait_hash: string | null; portrait_of: string | null }>("SELECT portrait_hash, portrait_of FROM users WHERE id = ?", u.id)
      .toArray()[0];
    if (!r?.portrait_hash) return null;
    return { hash: r.portrait_hash, current: r.portrait_of === (await this.effectiveAvatar(u)).hash };
  }

  /**
   * Guarda el retrato que hizo la web del personaje que lleva la persona (`of`). Tiene que ser una
   * imagen que subió ella (kind=portrait) y de su personaje de ahora.
   */
  async setPortrait(id: string, hash: unknown, of: unknown): Promise<Result<{ hash: string; current: boolean } | null>> {
    const u = this.user(id);
    if (!u) return fail(404, "not_found", "la cuenta no existe");
    if (hash === null) {
      this.sql.exec("UPDATE users SET portrait_hash = NULL, portrait_of = NULL WHERE id = ?", id);
      return ok(null);
    }
    if (typeof hash !== "string" || typeof of !== "string") return fail(400, "bad_message", "hash y of (el personaje del retrato)");
    const up = this.sql.exec("SELECT 1 FROM uploads WHERE hash = ? AND uploader = ? AND kind = 'portrait'", hash, `usr_${id}`).toArray()[0];
    if (!up) return fail(403, "forbidden", "sube primero el retrato (kind=portrait)");
    if (of !== (await this.effectiveAvatar(u)).hash) return fail(409, "portrait_stale", "ese retrato no es del personaje que llevas ahora");
    this.sql.exec("UPDATE users SET portrait_hash = ?, portrait_of = ? WHERE id = ?", hash, of, id);
    return ok(await this.portrait(u));
  }

  rename(id: string, raw: unknown): Result<UserRow> {
    // El fundador puede llevar un nombre reservado (p. ej. «xenxo»).
    const founder = (this.env.FOUNDER_USER_ID ?? "").replace(/^usr_/, "").trim();
    const name = validDisplayName(raw, founder !== "" && id === founder);
    if (!name) return badName(raw);
    this.sql.exec("UPDATE users SET display_name = ? WHERE id = ?", name, id);
    return ok(this.user(id)!);
  }

  /**
   * Viste un personaje: uno de serie, o uno propio del armario. Si es un archivo que esta persona
   * subió y aún no está en el armario, entra en él (si queda hueco).
   */
  setAvatar(id: string, hash: unknown, format: "glb" | "vrm", label?: unknown): Result<UserRow> {
    if (hash === null) {
      this.sql.exec("UPDATE users SET avatar_hash = NULL, avatar_format = NULL WHERE id = ?", id);
      return ok(this.user(id)!);
    }
    if (typeof hash !== "string") return fail(400, "bad_message", "falta el hash del avatar");
    if (!isAvatarPreset(hash)) {
      const added = this.addSkin(id, hash, format, label);
      if (!added.ok) return added;
    }
    this.sql.exec("UPDATE users SET avatar_hash = ?, avatar_format = ? WHERE id = ?", hash, isAvatarPreset(hash) ? "vrm" : format, id);
    return ok(this.user(id)!);
  }

  /* --- El armario (personajes propios guardados) --- */

  skins(id: string): SkinRow[] {
    return this.sql
      .exec<SkinRow>("SELECT hash, format, label, created_at FROM skins WHERE user_id = ? ORDER BY created_at, hash", id)
      .toArray();
  }

  /** Guarda en el armario un personaje que subió esta persona (máximo MAX_SKINS). */
  addSkin(id: string, hash: string, format: "glb" | "vrm", label?: unknown): Result<SkinRow[]> {
    if (this.sql.exec("SELECT 1 FROM skins WHERE user_id = ? AND hash = ?", id, hash).toArray().length) return ok(this.skins(id));
    const up = this.sql
      .exec("SELECT 1 FROM uploads WHERE hash = ? AND uploader = ? AND kind = 'avatar'", hash, `usr_${id}`)
      .toArray()[0];
    if (!up) return fail(403, "forbidden", "sube primero el personaje desde tu cuenta");
    const n = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM skins WHERE user_id = ?", id).one().n;
    if (n >= MAX_SKINS) return fail(409, "skins_full", `caben ${MAX_SKINS} personajes propios; quita uno para guardar otro`, { max: MAX_SKINS });
    const name = typeof label === "string" ? label.trim().replace(/\s+/g, " ").slice(0, 32) : "";
    this.sql.exec(
      "INSERT INTO skins (user_id, hash, format, label, created_at) VALUES (?, ?, ?, ?, ?)",
      id, hash, format, name || null, Date.now(),
    );
    return ok(this.skins(id));
  }

  /**
   * Quita un personaje del armario. Si lo llevaba puesto, vuelve al de serie. El archivo deja de
   * contar en su cuota (la subida queda anotada para el límite diario) y, si nadie más lo subió,
   * el Worker lo borra de R2 (`orphan`).
   */
  removeSkin(id: string, hash: string): Result<{ user: UserRow; skins: SkinRow[]; orphan: boolean }> {
    if (!this.sql.exec("SELECT 1 FROM skins WHERE user_id = ? AND hash = ?", id, hash).toArray().length) {
      return fail(404, "not_found", "ese personaje no está en tu armario");
    }
    const sub = `usr_${id}`;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM skins WHERE user_id = ? AND hash = ?", id, hash);
      this.sql.exec("UPDATE users SET avatar_hash = NULL, avatar_format = NULL WHERE id = ? AND avatar_hash = ?", id, hash);
      this.sql.exec("UPDATE uploads SET kind = 'removed', bytes = 0 WHERE hash = ? AND uploader = ? AND kind = 'avatar'", hash, sub);
    });
    const orphan = this.sql.exec("SELECT 1 FROM uploads WHERE hash = ? AND kind != 'removed'", hash).toArray().length === 0 && !this.hashInUse(hash);
    return ok({ user: this.user(id)!, skins: this.skins(id), orphan });
  }

  /* --- El carné de jugador (xenxo.io/p/<número>) --- */

  /** Si el carné de esta persona se ve en público, y su número. */
  card(id: string): Result<{ public: boolean; player_no: number | null }> {
    const r = this.sql
      .exec<{ card_public: number; player_no: number | null }>("SELECT card_public, player_no FROM users WHERE id = ?", id)
      .toArray()[0];
    if (!r) return fail(404, "not_found", "la cuenta no existe");
    return ok({ public: r.card_public === 1, player_no: r.player_no });
  }

  setCardPublic(id: string, on: unknown): Result<{ public: boolean; player_no: number | null }> {
    if (typeof on !== "boolean") return fail(400, "bad_message", "falta «public» (true o false)");
    this.sql.exec("UPDATE users SET card_public = ? WHERE id = ?", on ? 1 : 0, id);
    return this.card(id);
  }

  /**
   * Carné público de un número: solo si su dueño lo ha hecho público. Lleva lo que ya se ve en el
   * mundo (número, nombre, personaje y proyectos publicados) y la fecha de alta; nunca el id interno.
   */
  playerCard(no: number) {
    const u = this.sql
      .exec<{ id: string; display_name: string; avatar_hash: string | null; avatar_format: string | null; created_at: number; player_no: number }>(
        "SELECT id, display_name, avatar_hash, avatar_format, created_at, player_no FROM users WHERE player_no = ? AND card_public = 1",
        no,
      )
      .toArray()[0];
    if (!u) return null;
    return {
      player_no: u.player_no,
      name: u.display_name,
      avatar: u.avatar_hash ? { hash: u.avatar_hash, format: u.avatar_format ?? "glb" } : null,
      joined: u.created_at,
      badges: this.badgesOf(u.id),
      projects: this.projectsOf(u.id).map((p) => ({
        id: p.id,
        title: p.title,
        summary: p.summary,
        url: p.url,
        cover_hash: p.cover_hash,
        category: p.category,
        district: p.district,
        parcel: p.parcel,
      })),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Insignias                                                           */
  /* ---------------------------------------------------------------- */

  badgesOf(id: string) {
    return this.sql
      .exec<{ badge_id: string; earned_at: number }>("SELECT badge_id, earned_at FROM badges WHERE user_id = ? ORDER BY earned_at", id)
      .toArray()
      .map((r) => badgeInfo(r.badge_id, r.earned_at))
      .filter((b) => b !== null);
  }

  /** ¿Puede comprobar ya sus insignias? (una vez cada 15 s por cuenta: cada comprobación pregunta a los distritos). */
  badgeCheckAllowed(id: string): boolean {
    const now = Date.now();
    const last = this.sql.exec<{ ts: number }>("SELECT ts FROM badge_checks WHERE user_id = ?", id).toArray()[0]?.ts ?? 0;
    if (now - last < 15_000) return false;
    this.sql.exec("INSERT OR REPLACE INTO badge_checks (user_id, ts) VALUES (?, ?)", id, now);
    return true;
  }

  /** Da las insignias que aún no tenía (ya comprobadas por el Worker). Devuelve las nuevas. */
  grantBadges(id: string, ids: string[]) {
    const now = Date.now();
    const fresh: string[] = [];
    for (const b of ids) {
      if (!BADGES.some((x) => x.id === b)) continue;
      if (this.sql.exec("INSERT OR IGNORE INTO badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)", id, b, now).rowsWritten > 0) fresh.push(b);
    }
    return fresh.map((b) => badgeInfo(b, now)).filter((x) => x !== null);
  }

  /** Derecho de acceso y portabilidad (RGPD arts. 15 y 20). */
  exportData(id: string) {
    const u = this.sql.exec("SELECT * FROM users WHERE id = ?", id).toArray()[0];
    if (!u) return fail(404, "not_found", "la cuenta no existe");
    return ok({
      exported_at: new Date().toISOString(),
      user: u,
      passkeys: this.sql.exec("SELECT id, created_at, last_used, transports FROM credentials WHERE user_id = ?", id).toArray(),
      // De Google solo guardamos el hash de su identificador, no el identificador ni ningún dato de la cuenta.
      other_logins: this.sql.exec("SELECT provider, subject AS subject_hash, created_at, last_used FROM logins WHERE user_id = ?", id).toArray(),
      projects: this.sql.exec("SELECT * FROM projects WHERE user_id = ?", id).toArray(),
      uploads: this.sql.exec("SELECT hash, kind, ts FROM uploads WHERE uploader = ?", `usr_${id}`).toArray(),
      skins: this.skins(id),
      badges: this.badgesOf(id),
      // De cada clave de agente solo guardamos su huella; aquí van sus datos, nunca la huella.
      agent_keys: this.agentKeys(id),
      // «Entrar con xenxo»: juegos a los que diste permiso y juegos que registraste.
      connected_games: this.grantsOf(id),
      registered_games: this.clientsOf(id),
      reports_sent: this.sql.exec("SELECT ts, target_type, target_id, reason, details FROM reports WHERE reporter = ?", `usr_${id}`).toArray(),
      // Jams: juegos que apuntaste y tus votos (solo tú los ves).
      jam_entries: this.sql.exec("SELECT j.slug AS jam, e.project_id, e.joined_at, e.removed_note FROM jam_entries e JOIN jams j ON j.id = e.jam_id WHERE e.user_id = ?", id).toArray(),
      jam_votes: this.sql.exec("SELECT j.slug AS jam, v.project_id, v.stars, v.created_at FROM jam_votes v JOIN jams j ON j.id = v.jam_id WHERE v.user_id = ?", id).toArray(),
      // Si moderas: tus decisiones (el registro que pide la DSA).
      moderation_decisions: this.sql.exec("SELECT ts, action, target_type, target_id, note FROM moderation_log WHERE moderator = ?", `usr_${id}`).toArray(),
      moderator_since: this.sql.exec<{ added_at: number }>("SELECT added_at FROM moderators WHERE user_id = ?", id).toArray()[0]?.added_at ?? null,
      // Tu distrito de la comunidad (su ficha, con el contacto que pusiste, y su estado).
      community_district: this.myDistrict(id),
    });
  }

  /**
   * Derecho de supresión (RGPD art. 17). Devuelve los assets que solo subió
   * esta persona, para que el Worker los borre de R2, y sus proyectos, para retirar los stands.
   */
  deleteAccount(id: string): Result<{ orphanHashes: string[]; projects: { id: string; district: string | null }[]; agents: string[]; community: { id: string; chunk_id: string } | null }> {
    const sub = `usr_${id}`;
    if (!this.user(id)) return fail(404, "not_found", "la cuenta no existe");
    const projects = this.sql.exec<{ id: string; district: string | null }>("SELECT id, district FROM projects WHERE user_id = ?", id).toArray();
    const agents = this.sql.exec<{ id: string }>("SELECT id FROM agent_keys WHERE user_id = ?", id).toArray().map((r) => `agt_${r.id}`);
    const community = this.sql.exec<{ id: string; chunk_id: string }>("SELECT id, chunk_id FROM community_districts WHERE user_id = ?", id).toArray()[0] ?? null;
    if (community) {
      this.sql.exec("DELETE FROM community_files WHERE district_id = ?", community.id);
      this.sql.exec("DELETE FROM community_districts WHERE id = ?", community.id);
    }
    // Lo subido por la persona y por los agentes de sus parcelas (prj_<id>).
    const uploaders = [sub, ...projects.map((p) => `prj_${p.id}`)];
    const marks = uploaders.map(() => "?").join(",");
    const mine = this.sql.exec<{ hash: string }>(`SELECT DISTINCT hash FROM uploads WHERE uploader IN (${marks})`, ...uploaders).toArray().map((r) => r.hash);
    const orphanHashes = mine.filter(
      (h) => this.sql.exec(`SELECT 1 FROM uploads WHERE hash = ? AND uploader NOT IN (${marks}) AND kind != 'removed'`, h, ...uploaders).toArray().length === 0,
    );
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM uploads WHERE uploader IN (${marks})`, ...uploaders);
      this.sql.exec("DELETE FROM credentials WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM logins WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM skins WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM agent_keys WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM oidc_grants WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM oidc_grants WHERE client_id IN (SELECT client_id FROM oidc_clients WHERE user_id = ?)", id);
      this.sql.exec("DELETE FROM oidc_clients WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM oidc_pending WHERE json_extract(data, '$.user_id') = ?", id);
      this.sql.exec("DELETE FROM jam_votes WHERE user_id = ? OR project_id IN (SELECT id FROM projects WHERE user_id = ?)", id, id);
      this.sql.exec("DELETE FROM jam_entries WHERE user_id = ?", id);
      this.sql.exec("UPDATE jams SET created_by = 'deleted' WHERE created_by = ?", sub);
      this.sql.exec("DELETE FROM projects WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM uploads WHERE uploader = ?", sub);
      this.sql.exec("UPDATE reports SET reporter = 'deleted' WHERE reporter = ?", sub);
      // El registro de moderación se conserva (DSA), sin decir quién moderó.
      this.sql.exec("UPDATE moderation_log SET moderator = 'deleted' WHERE moderator = ?", sub);
      this.sql.exec("DELETE FROM moderators WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM badges WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM badge_checks WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM users WHERE id = ?", id);
    });
    return ok({ orphanHashes, projects, agents, community });
  }

  async alarm() {
    try {
      const r = this.findOrphans(Date.now());
      for (const hash of r.deleteFromR2) await this.env.ASSETS.delete(assetKey(hash));
      if (r.marked) console.log(`[xenxo] limpieza: ${r.marked} subidas sin usar, ${r.deleteFromR2.length} archivos borrados`);
      // Plazos de la página de privacidad: denuncias resueltas, 12 meses; registro de moderación, 5 años.
      const now = Date.now();
      this.sql.exec("DELETE FROM reports WHERE status != 'open' AND ts < ?", now - 365 * 86_400_000);
      this.sql.exec("DELETE FROM moderation_log WHERE ts < ?", now - 5 * 365 * 86_400_000);
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + CLEANUP_EVERY_MS);
    }
  }

  /** ¿Usa algo este archivo? (un proyecto, un personaje puesto o guardado). Si sí, no se borra de R2. */
  hashInUse(hash: string): boolean {
    return (
      this.sql.exec("SELECT 1 FROM projects WHERE mesh_hash = ? OR cover_hash = ? LIMIT 1", hash, hash).toArray().length > 0 ||
      this.sql.exec("SELECT 1 FROM users WHERE avatar_hash = ? OR portrait_hash = ? LIMIT 1", hash, hash).toArray().length > 0 ||
      this.sql.exec("SELECT 1 FROM skins WHERE hash = ? LIMIT 1", hash).toArray().length > 0 ||
      this.sql.exec("SELECT 1 FROM community_files WHERE hash = ? LIMIT 1", hash).toArray().length > 0
    );
  }

  /**
   * Archivos que subió una persona y que nada usa pasados ORPHAN_GRACE_MS: un personaje que no está
   * en su armario ni puesto, una portada o un monumento que no es de ningún proyecto. Se marcan como
   * quitados (dejan de contar en la cuota; la subida sigue contando para el límite diario) y se
   * devuelven los que ya nadie tiene, para borrarlos de R2. Los modelos de agentes no se tocan:
   * pueden estar en el mundo, y eso solo lo sabe cada chunk.
   */
  findOrphans(now: number, limit = 200): { marked: number; deleteFromR2: string[] } {
    const rows = this.sql
      .exec<{ hash: string; uploader: string; kind: string }>(
        `SELECT hash, uploader, kind FROM uploads
         WHERE uploader LIKE 'usr_%' AND kind IN ('avatar', 'cover', 'monument', 'model', 'portrait') AND ts < ? LIMIT ?`,
        now - ORPHAN_GRACE_MS, limit * 5,
      )
      .toArray();
    const used = (r: { hash: string; uploader: string; kind: string }) => {
      const uid = r.uploader.slice(4);
      if (r.kind === "avatar") {
        return (
          this.sql.exec("SELECT 1 FROM skins WHERE user_id = ? AND hash = ?", uid, r.hash).toArray().length > 0 ||
          this.sql.exec("SELECT 1 FROM users WHERE id = ? AND avatar_hash = ?", uid, r.hash).toArray().length > 0
        );
      }
      if (r.kind === "portrait") return this.sql.exec("SELECT 1 FROM users WHERE id = ? AND portrait_hash = ?", uid, r.hash).toArray().length > 0;
      const col = r.kind === "cover" ? "cover_hash" : "mesh_hash";
      if (this.sql.exec("SELECT 1 FROM community_files WHERE hash = ? LIMIT 1", r.hash).toArray().length > 0) return true;
      return this.sql.exec(`SELECT 1 FROM projects WHERE ${col} = ?`, r.hash).toArray().length > 0;
    };
    const orphans = rows.filter((r) => !used(r)).slice(0, limit);
    const deleteFromR2: string[] = [];
    for (const r of orphans) {
      this.sql.exec("UPDATE uploads SET kind = 'removed', bytes = 0 WHERE hash = ? AND uploader = ?", r.hash, r.uploader);
      const alive = this.sql.exec("SELECT 1 FROM uploads WHERE hash = ? AND kind != 'removed'", r.hash).toArray().length > 0 || this.hashInUse(r.hash);
      if (!alive && !deleteFromR2.includes(r.hash)) deleteFromR2.push(r.hash);
    }
    return { marked: orphans.length, deleteFromR2 };
  }

  /** Limpieza a demanda (moderación); en local, con fecha simulada para el banco de conformidad. */
  cleanupNow(now: number): { marked: number; deleteFromR2: string[] } {
    return this.findOrphans(now);
  }

  /* ---------------------------------------------------------------- */
  /* Subidas                                                            */
  /* ---------------------------------------------------------------- */

  canUpload(uploader: string): Result<true> {
    const n = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM uploads WHERE uploader = ? AND ts > ?", uploader, Date.now() - 86_400_000)
      .one().n;
    if (n >= MAX_UPLOADS_PER_DAY) return fail(429, "rate_limited", "has llegado al máximo de subidas por hoy");
    const all = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM uploads WHERE ts > ?", Date.now() - 86_400_000)
      .one().n;
    if (all >= MAX_UPLOADS_PER_DAY_GLOBAL) return fail(429, "storage_busy", "hoy ya se han subido muchos modelos a xenxo; prueba mañana");
    const mine = this.sql
      .exec<{ b: number | null }>("SELECT SUM(bytes) AS b FROM uploads WHERE uploader = ?", uploader)
      .one().b ?? 0;
    if (mine + UPLOAD_HEADROOM > USER_QUOTA_BYTES) {
      return fail(413, "quota_exceeded", `has llegado a tu espacio (${USER_QUOTA_BYTES / 1024 ** 2} MB): borra algún modelo para subir otro`);
    }
    if (this.storedBytes() + UPLOAD_HEADROOM > STORAGE_CAP_BYTES) {
      return fail(507, "storage_full", "el almacén de xenxo está lleno por ahora; vuelve a intentarlo más adelante");
    }
    return ok(true);
  }

  /** Bytes guardados en R2 por subidas de la gente (cada hash cuenta una vez). */
  storedBytes(): number {
    return (
      this.sql
        .exec<{ b: number | null }>("SELECT SUM(b) AS b FROM (SELECT MAX(bytes) AS b FROM uploads GROUP BY hash)")
        .one().b ?? 0
    );
  }

  recordUpload(uploader: string, hash: string, kind: string, bytes: number) {
    this.sql.exec(
      "INSERT OR REPLACE INTO uploads (hash, uploader, kind, ts, bytes) VALUES (?, ?, ?, ?, ?)",
      hash, uploader, kind, Date.now(), bytes,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Proyectos                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Publica un proyecto. Requisitos (los mismos para la web, los agentes y el futuro MCP):
   * nombre, enlace https, distrito y parcela libre, portada subida (kind=cover) y monumento
   * subido (kind=monument o model). La categoría es la del distrito. Las medidas del monumento
   * las comprueba quien lo coloca, con las del servidor.
   */
  createProject(
    userId: string,
    body: { title?: unknown; summary?: unknown; url?: unknown; mesh_hash?: unknown; cover_hash?: unknown; district?: unknown; parcel?: unknown },
  ): Result<PublicProject> {
    const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
    const summary = typeof body.summary === "string" ? body.summary.trim() : "";
    if (title.length < 3 || title.length > 60) return fail(400, "bad_title", "el título debe tener entre 3 y 60 caracteres");
    if (summary.length > 280) return fail(400, "bad_summary", "la descripción admite hasta 280 caracteres");
    // En local (RP_ID=localhost) vale también un juego en http://localhost, para probar de punta a punta.
    const local = this.rpID === "localhost" && typeof body.url === "string" && /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}\/[^\s]*$/.test(body.url);
    const url = local ? (body.url as string) : validHttpsUrl(body.url);
    if (!url) return fail(400, "bad_url", "el proyecto necesita un enlace que empiece por https://");
    const district = districtById(body.district);
    if (!district) return fail(400, "bad_district", `el distrito debe ser uno de: ${DISTRICTS.map((d) => d.id).join(", ")}`);
    if (district.soon) return fail(400, "district_soon", `${district.name.es} abrirá pronto: elige uno de ${DISTRICTS.filter((d) => !d.soon).map((d) => d.id).join(", ")}`);
    if (parcelIndex(body.parcel) < 0) return fail(400, "bad_parcel", `la parcela debe ser una de: ${PARCELS.map((q) => q.id).join(", ")}`);
    const parcel = body.parcel as string;
    const taken = this.sql
      .exec("SELECT 1 FROM projects WHERE district = ? AND parcel = ? AND status = 'published'", district.id, parcel)
      .toArray().length > 0;
    if (taken) return fail(409, "parcel_taken", "esa parcela ya está ocupada; elige otra");
    const category = district.category as ProjectCategory;
    const uploaded = (hash: unknown, kinds: string[]) =>
      typeof hash === "string" &&
      this.sql
        .exec(`SELECT 1 FROM uploads WHERE hash = ? AND uploader = ? AND kind IN (${kinds.map(() => "?").join(",")})`, hash, `usr_${userId}`, ...kinds)
        .toArray().length > 0;
    if (!uploaded(body.cover_hash, ["cover"])) return fail(400, "cover_required", "sube primero la portada del proyecto (imagen 16:9)");
    if (!uploaded(body.mesh_hash, ["monument", "model"])) return fail(400, "monument_required", "sube primero el monumento del proyecto (modelo .glb)");
    const count = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM projects WHERE user_id = ? AND status = 'published'", userId)
      .one().n;
    if (count >= MAX_PROJECTS_PER_USER) return fail(409, "too_many_projects", `máximo ${MAX_PROJECTS_PER_USER} proyectos por persona`);
    const id = randomId("p", 8).replace(/[^a-zA-Z0-9]/g, "x");
    this.sql.exec(
      "INSERT INTO projects (id, user_id, title, summary, url, mesh_hash, cover_hash, category, district, parcel, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)",
      id,
      userId,
      title,
      summary,
      url,
      body.mesh_hash as string,
      body.cover_hash as string,
      category,
      district.id,
      parcel,
      Date.now(),
    );
    return ok(this.project(id)!);
  }

  setInWorld(projectId: string, inWorld: boolean) {
    this.sql.exec("UPDATE projects SET in_world = ? WHERE id = ?", inWorld ? 1 : 0, projectId);
  }

  /** Proyectos con sus datos públicos (y la nota de revisión si `withNote`). */
  private projectRows(where: string, args: unknown[], withNote = false, tail = ""): PublicProject[] {
    return this.sql
      .exec<Omit<PublicProject, "in_world" | "game"> & { in_world: number; game: string | null }>(
        `SELECT p.id, p.title, p.summary, p.url, p.mesh_hash, p.cover_hash, p.category, p.district, p.parcel,
                u.display_name AS author, p.created_at, p.in_world, p.slug, p.review, p.game${withNote ? ", p.review_note, p.status" : ""}
         FROM projects p JOIN users u ON u.id = p.user_id WHERE ${where} ${tail}`,
        ...args,
      )
      .toArray()
      .map((r) => ({ ...r, in_world: !!r.in_world, game: r.game ? (JSON.parse(r.game) as GameInfo) : null }));
  }

  project(id: string): PublicProject | null {
    return this.projectRows("p.id = ?", [id])[0] ?? null;
  }

  projectStatus(id: string): string | null {
    return this.sql.exec<{ status: string }>("SELECT status FROM projects WHERE id = ?", id).toArray()[0]?.status ?? null;
  }

  projectOwner(id: string): string | null {
    return this.sql.exec<{ user_id: string }>("SELECT user_id FROM projects WHERE id = ?", id).toArray()[0]?.user_id ?? null;
  }

  /** El catálogo: lo publicado y aprobado en la revisión. */
  listProjects(): PublicProject[] {
    return this.projectRows("p.status = 'published' AND p.review = 'approved'", [], false, "ORDER BY p.created_at DESC LIMIT 100");
  }

  /** Los proyectos publicados de una persona (todos, revisados o no; con la nota de revisión). */
  private projectsOf(userId: string, withNote = false): PublicProject[] {
    // Su autor ve también lo que moderación ocultó, con el motivo.
    const statuses = withNote ? "('published', 'hidden')" : "('published')";
    return this.projectRows(`p.user_id = ? AND p.status IN ${statuses}`, [userId], withNote, "ORDER BY p.created_at DESC");
  }

  /** Un juego por su enlace (xenxo.io/j/<slug>): publicado, revisado o no. */
  gameBySlug(slug: string): PublicProject | null {
    // Lo rechazado en la revisión no tiene enlace propio (sigue en su parcela, sin abrirse dentro de xenxo).
    return this.projectRows("p.slug = ? AND p.status = 'published' AND p.game IS NOT NULL AND p.review != 'rejected'", [slug])[0] ?? null;
  }

  /**
   * Guarda la ficha de un juego (ya leída y comprobada por el Worker) y su enlace. Cambiar la ficha
   * lo devuelve a revisión: lo que se aprobó era la ficha anterior.
   */
  setGame(userId: string, projectId: string, manifest: GameManifest, rawSlug: unknown): Result<PublicProject> {
    const p = this.sql
      .exec<{ user_id: string; url: string | null; slug: string | null; game: string | null; title: string; status: string }>(
        "SELECT user_id, url, slug, game, title, status FROM projects WHERE id = ?",
        projectId,
      )
      .toArray()[0];
    if (!p || p.status !== "published") return fail(404, "not_found", "ese proyecto no existe");
    if (p.user_id !== userId) return fail(403, "forbidden", "solo su autor puede registrar su juego");
    if (!p.url) return fail(400, "bad_url", "el proyecto necesita el enlace del juego");
    if (!manifest.privacy) return fail(400, "privacy_required", "la ficha necesita «privacy»: la página de privacidad del juego (https)");
    if (manifest.xenxo?.project && manifest.xenxo.project !== projectId) {
      return fail(400, "manifest_mismatch", "el xenxo.json dice que es de otro proyecto (xenxo.project)");
    }
    // Con «Entrar con xenxo», el juego tiene que enseñar quién juega: su personaje o su nombre y número.
    if (manifest.xenxo?.clientId && manifestAvatar(manifest) === "none") {
      return fail(400, "avatar_required", "con «Entrar con xenxo», «avatar» tiene que ser \"character\" (su personaje) o \"badge\" (su nombre y número)");
    }
    if (manifest.xenxo?.clientId) {
      const c = this.sql.exec<{ user_id: string }>("SELECT user_id FROM oidc_clients WHERE client_id = ?", manifest.xenxo.clientId).toArray()[0];
      if (!c || c.user_id !== userId) return fail(400, "manifest_mismatch", "el clientId del xenxo.json no es de un juego tuyo");
    }
    const founder = (this.env.FOUNDER_USER_ID ?? "").replace(/^usr_/, "").trim() === userId;
    const wanted = rawSlug === undefined || rawSlug === null || rawSlug === "" ? (p.slug ?? slugFrom(manifest.name.es || p.title)) : rawSlug;
    const slug = validSlug(wanted, founder);
    if (!slug) return fail(400, "bad_slug", "nombre del enlace: 3–40 letras minúsculas, números o guiones (y no reservado)");
    const taken = this.sql.exec("SELECT 1 FROM projects WHERE slug = ? AND id != ?", slug, projectId).toArray().length > 0;
    if (taken) return fail(409, "slug_taken", "ese enlace ya lo usa otro juego; elige otro");
    const info = JSON.stringify(gameInfo(manifest, p.url));
    const changed = info !== p.game;
    // Sin cambios no se escribe nada (cada escritura cuenta en la cuota diaria del plan gratuito).
    if (changed || slug !== p.slug) {
      this.sql.exec(
        `UPDATE projects SET slug = ?, game = ?, game_at = ?${changed ? ", review = 'pending', review_note = NULL, reviewed_at = NULL" : ""} WHERE id = ?`,
        slug, info, Date.now(), projectId,
      );
    }
    return ok(this.projectsOf(userId, true).find((x) => x.id === projectId)!);
  }

  /**
   * Tope de lecturas de fichas por persona y día (cada una es una petición a otra web y puede
   * escribir en el Directory). Cuenta y responde si puede leer otra.
   */
  takeManifestRead(userId: string): Result<true> {
    const day = Math.floor(Date.now() / 86_400_000);
    const k = `manifest:${userId}:${day}`;
    const n = this.sql.exec<{ v: number }>("SELECT v FROM counters WHERE k = ?", k).toArray()[0]?.v ?? 0;
    if (n >= MAX_MANIFEST_READS_PER_DAY) return fail(429, "rate_limited", `puedes leer la ficha ${MAX_MANIFEST_READS_PER_DAY} veces al día; prueba mañana`);
    this.sql.exec("INSERT INTO counters (k, v) VALUES (?, 1) ON CONFLICT (k) DO UPDATE SET v = v + 1", k);
    // Los contadores de días pasados sobran.
    if (n === 0) this.sql.exec("DELETE FROM counters WHERE k LIKE 'manifest:%' AND k NOT LIKE ?", `%:${day}`);
    return ok(true);
  }

  /** ¿Es este juego de «Entrar con xenxo» el de este proyecto? (para el juego abierto dentro de xenxo) */
  embeddedClientOk(projectId: unknown, clientId: unknown): boolean {
    if (typeof projectId !== "string" || typeof clientId !== "string") return false;
    const p = this.projectRows("p.id = ? AND p.status = 'published' AND p.review != 'rejected'", [projectId])[0];
    return !!p?.game?.clientId && p.game.clientId === clientId;
  }

  /** Quita la ficha de juego (vuelve a ser un proyecto sin juego; su enlace /j/ deja de existir). */
  clearGame(userId: string, projectId: string): Result<{ cleared: true }> {
    const owner = this.projectOwner(projectId);
    if (!owner) return fail(404, "not_found", "ese proyecto no existe");
    if (owner !== userId) return fail(403, "forbidden", "solo su autor puede quitar su juego");
    this.sql.exec("UPDATE projects SET slug = NULL, game = NULL, game_at = NULL WHERE id = ?", projectId);
    return ok({ cleared: true });
  }

  /* --- Moderación (DSA): revisión de proyectos, denuncias y registro de decisiones --- */

  isModerator(userId: string | null): boolean {
    if (!userId) return false;
    const founder = (this.env.FOUNDER_USER_ID ?? "").replace(/^usr_/, "").trim();
    if (founder && userId === founder) return true;
    return this.sql.exec("SELECT 1 FROM moderators WHERE user_id = ?", userId).toArray().length > 0;
  }

  /** ¿Es el fundador? Solo él (o la clave de administración) nombra y retira moderación. */
  isFounder(userId: string | null): boolean {
    const founder = (this.env.FOUNDER_USER_ID ?? "").replace(/^usr_/, "").trim();
    return !!userId && !!founder && userId === founder;
  }

  /** Quién modera (por su número y nombre públicos; el fundador, siempre). */
  listModerators(): { player_no: number | null; display_name: string; added_at: number | null; founder: boolean }[] {
    const founder = (this.env.FOUNDER_USER_ID ?? "").replace(/^usr_/, "").trim();
    const rows = this.sql
      .exec<{ id: string; player_no: number | null; display_name: string; added_at: number | null }>(
        `SELECT u.id, u.player_no, u.display_name, m.added_at FROM users u LEFT JOIN moderators m ON m.user_id = u.id
         WHERE m.user_id IS NOT NULL OR u.id = ? ORDER BY u.player_no`,
        founder,
      )
      .toArray();
    return rows.map((r) => ({ player_no: r.player_no, display_name: r.display_name, added_at: r.added_at, founder: r.id === founder }));
  }

  /** Nombra o retira a alguien de moderación por su número de jugador. Queda en el registro. */
  setModerator(actor: string, rawNo: unknown, on: boolean): Result<{ player_no: number; moderator: boolean }> {
    const no = Number(rawNo);
    if (!Number.isInteger(no) || no < 0) return fail(400, "bad_player", "di el número de jugador");
    const u = this.sql.exec<{ id: string }>("SELECT id FROM users WHERE player_no = ?", no).toArray()[0];
    if (!u) return fail(404, "not_found", "no hay nadie con ese número");
    if (this.isFounder(u.id)) return fail(400, "founder", "el fundador modera siempre");
    if (on) this.sql.exec("INSERT OR IGNORE INTO moderators (user_id, added_at) VALUES (?, ?)", u.id, Date.now());
    else this.sql.exec("DELETE FROM moderators WHERE user_id = ?", u.id);
    this.logDecision(actor, on ? "moderator_add" : "moderator_remove", "user", `#${no}`, null);
    return ok({ player_no: no, moderator: on });
  }

  /** Registro (DSA) de una decisión tomada fuera del Directory (vaciar la zona de pruebas). */
  logModeration(moderator: string, action: string, targetId: string, note: string | null) {
    this.logDecision(moderator, action, "district", targetId, note);
  }

  private logDecision(moderator: string, action: string, targetType: string, targetId: string, note: string | null) {
    this.sql.exec(
      "INSERT INTO moderation_log (ts, moderator, action, target_type, target_id, note) VALUES (?, ?, ?, ?, ?, ?)",
      Date.now(), moderator, action, targetType, targetId, note,
    );
  }

  /** Lo pendiente: proyectos por revisar (con su autor) y denuncias abiertas. */
  /** Cuánto hay por revisar (para avisos y resúmenes): solo cuentas y fechas, sin datos de nadie. */
  moderationSummary() {
    const one = (q: string) => this.sql.exec<{ n: number; oldest: number | null }>(q).one();
    const projects = one("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM projects WHERE status = 'published' AND review = 'pending'");
    const reports = one("SELECT COUNT(*) AS n, MIN(ts) AS oldest FROM reports WHERE status = 'open'");
    const districts = one("SELECT COUNT(*) AS n, MIN(updated_at) AS oldest FROM community_districts WHERE status = 'pending'");
    return {
      pending_projects: projects.n,
      open_reports: reports.n,
      pending_districts: districts.n,
      oldest: { project: projects.oldest, report: reports.oldest, district: districts.oldest },
      at: Date.now(),
    };
  }

  moderationQueue() {
    const pending = this.projectRows("p.status = 'published' AND p.review = 'pending'", [], true, "ORDER BY p.created_at ASC LIMIT 100");
    return { pending, reports: this.listReports("open") };
  }

  review(moderator: string, projectId: string, decision: unknown, rawNote: unknown): Result<PublicProject> {
    if (decision !== "approved" && decision !== "rejected") return fail(400, "bad_message", "decision: approved o rejected");
    // Nadie revisa lo suyo (salvo el fundador, que es quien opera xenxo).
    const owner = this.projectOwner(projectId);
    const founder = (this.env.FOUNDER_USER_ID ?? "").replace(/^usr_/, "").trim();
    if (owner && moderator === `usr_${owner}` && owner !== founder) return fail(403, "own_project", "no puedes revisar tu propio proyecto");
    const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 500) : "";
    if (decision === "rejected" && note.length < 3) return fail(400, "note_required", "explica el motivo: lo verá su autor");
    const n = this.sql
      .exec("UPDATE projects SET review = ?, review_note = ?, reviewed_at = ? WHERE id = ? AND status = 'published'", decision, note || null, Date.now(), projectId)
      .rowsWritten;
    if (!n) return fail(404, "not_found", "ese proyecto no existe");
    this.logDecision(moderator, `review_${decision}`, "project", projectId, note || null);
    return ok(this.project(projectId)!);
  }

  /** Ocultar en toda la plataforma (el interruptor), con su motivo para el autor y el registro. */
  moderateHide(moderator: string, projectId: string, rawNote: unknown): Result<{ hidden: boolean }> {
    const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 500) : "";
    if (note.length < 3) return fail(400, "note_required", "explica el motivo: lo verá su autor");
    const hidden = this.hideProject(projectId);
    if (!hidden) return fail(404, "not_found", "ese proyecto no existe");
    this.sql.exec("UPDATE projects SET review_note = ?, reviewed_at = ? WHERE id = ?", note, Date.now(), projectId);
    this.logDecision(moderator, "hide", "project", projectId, note);
    return ok({ hidden });
  }

  moderateReport(moderator: string, id: number, status: unknown, rawNote: unknown): Result<{ ok: true }> {
    if (status !== "actioned" && status !== "dismissed") return fail(400, "bad_message", "status: actioned o dismissed");
    const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 500) : null;
    if (!this.sql.exec("UPDATE reports SET status = ? WHERE id = ? AND status = 'open'", status, id).rowsWritten) {
      return fail(404, "not_found", "esa denuncia no existe o ya se resolvió");
    }
    this.logDecision(moderator, `report_${status}`, "report", String(id), note || null);
    return ok({ ok: true });
  }

  /* --- Distritos de la comunidad (community.ts; fase 2) --- */

  private districtView(r: CommunityRow): CommunityDistrict {
    const u = this.user(r.user_id);
    return {
      id: r.id,
      slug: r.slug,
      chunk_id: r.chunk_id,
      status: r.status as CommunityStatus,
      review_note: r.review_note,
      rev: r.rev,
      manifest: JSON.parse(r.manifest) as DistrictSubmission,
      portals: JSON.parse(r.portals) as ResolvedPortal[],
      created_at: r.created_at,
      updated_at: r.updated_at,
      author: { display_name: u?.display_name ?? "", player_no: u?.player_no ?? null },
    };
  }

  private districtRows(where: string, ...args: (string | number)[]): CommunityRow[] {
    return this.sql.exec<CommunityRow>(`SELECT * FROM community_districts WHERE ${where}`, ...args).toArray();
  }

  /** El distrito de esta persona (como mucho uno). */
  myDistrict(userId: string): CommunityDistrict | null {
    const r = this.districtRows("user_id = ?", userId)[0];
    return r ? this.districtView(r) : null;
  }

  /**
   * Guarda la ficha (ya comprobada por el Worker: esquema, presupuestos y posiciones) y la deja en
   * borrador. Aquí se mira lo que solo sabe el Directory: que cada archivo lo subió esta persona con
   * su tipo, que los portales van a juegos suyos publicados y que el nombre corto está libre.
   */
  saveDistrict(userId: string, m: DistrictSubmission): Result<CommunityDistrict> {
    if (!this.user(userId)) return fail(404, "not_found", "la cuenta no existe");
    const prev = this.districtRows("user_id = ?", userId)[0];
    const today = new Date().toISOString().slice(0, 10);
    if (prev && prev.saves_day === today && prev.saves >= MAX_DISTRICT_SAVES_PER_DAY) {
      return fail(429, "rate_limited", `hoy ya has enviado tu distrito ${MAX_DISTRICT_SAVES_PER_DAY} veces; vuelve mañana`);
    }
    if (this.districtRows("slug = ? AND user_id != ?", m.slug, userId).length) return fail(409, "district_slug_taken", "ese nombre corto ya es de otro distrito");
    const uploader = `usr_${userId}`;
    for (const f of submissionFiles(m)) {
      const kind = this.sql.exec<{ kind: string }>("SELECT kind FROM uploads WHERE hash = ? AND uploader = ?", f.hash, uploader).toArray()[0]?.kind;
      const system = f.kind === "model" && isSystemAsset(f.hash.slice(7));
      if (!system && kind !== f.kind) {
        return fail(400, "not_your_file", `${f.hash.slice(0, 19)}…: súbelo tú como «${f.kind}» antes de usarlo`, { hash: f.hash, kind: f.kind });
      }
    }
    const portals: ResolvedPortal[] = [];
    for (const q of m.portals) {
      const g = this.sql
        .exec<{ id: string; user_id: string; title: string; cover_hash: string | null; category: string; status: string; review: string }>(
          "SELECT id, user_id, title, cover_hash, category, status, review FROM projects WHERE slug = ? AND game IS NOT NULL",
          q.game,
        )
        .toArray()[0];
      if (!g || g.user_id !== userId || g.status !== "published" || g.review === "rejected") {
        return fail(400, "bad_portal", `«${q.game}» no es un juego tuyo publicado en xenxo (xenxo.io/j/${q.game})`, { game: q.game });
      }
      portals.push({ game: q.game, project_id: g.id, title: g.title, cover: g.cover_hash, category: g.category });
    }
    const now = Date.now();
    let id = prev?.id;
    this.ctx.storage.transactionSync(() => {
      if (!prev) {
        id = randomId("d", 8);
        this.sql.exec("INSERT OR IGNORE INTO counters (k, v) VALUES ('next_community', 0)");
        const n = this.sql.exec<{ v: number }>("SELECT v FROM counters WHERE k = 'next_community'").one().v;
        this.sql.exec("UPDATE counters SET v = ? WHERE k = 'next_community'", n + 1);
        this.sql.exec(
          "INSERT INTO community_districts (id, user_id, slug, chunk_id, manifest, portals, rev, status, created_at, updated_at, saves_day, saves) VALUES (?, ?, ?, ?, ?, ?, 1, 'draft', ?, ?, ?, 1)",
          id, userId, m.slug, communityChunk(n), JSON.stringify(m), JSON.stringify(portals), now, now, today,
        );
      } else {
        // Cambiar un distrito lo devuelve a borrador: lo que se aprobó era la ficha anterior.
        this.sql.exec(
          "UPDATE community_districts SET slug = ?, manifest = ?, portals = ?, rev = rev + 1, status = 'draft', updated_at = ?, saves = ?, saves_day = ? WHERE id = ?",
          m.slug, JSON.stringify(m), JSON.stringify(portals), now, prev.saves_day === today ? prev.saves + 1 : 1, today, id!,
        );
      }
      this.sql.exec("DELETE FROM community_files WHERE district_id = ?", id!);
      for (const f of submissionFiles(m)) this.sql.exec("INSERT OR IGNORE INTO community_files (district_id, hash) VALUES (?, ?)", id!, f.hash);
    });
    return ok(this.districtView(this.districtRows("id = ?", id!)[0]!));
  }

  /** Pedir la revisión (desde borrador o tras un rechazo). */
  submitDistrict(userId: string): Result<CommunityDistrict> {
    const r = this.districtRows("user_id = ?", userId)[0];
    if (!r) return fail(404, "not_found", "aún no tienes distrito");
    if (r.status !== "draft" && r.status !== "rejected") return fail(409, "bad_state", "tu distrito no está en borrador");
    this.sql.exec("UPDATE community_districts SET status = 'pending', updated_at = ? WHERE id = ?", Date.now(), r.id);
    return ok(this.districtView(this.districtRows("id = ?", r.id)[0]!));
  }

  /** Borrar el distrito propio (su chunk no se reutiliza). */
  deleteDistrict(userId: string): Result<{ id: string; chunk_id: string }> {
    const r = this.districtRows("user_id = ?", userId)[0];
    if (!r) return fail(404, "not_found", "aún no tienes distrito");
    this.sql.exec("DELETE FROM community_files WHERE district_id = ?", r.id);
    this.sql.exec("DELETE FROM community_districts WHERE id = ?", r.id);
    return ok({ id: r.id, chunk_id: r.chunk_id });
  }

  /**
   * ¿Puede entrar esta persona en este chunk de la comunidad? Aprobado: cualquiera. Si no: su autor
   * y moderación. Un chunk sin distrito (borrado o que nunca existió): nadie salvo administración.
   */
  districtAccess(chunkId: string, userId: string | null): boolean {
    const r = this.districtRows("chunk_id = ?", chunkId)[0];
    if (!r) return false;
    if (r.status === "approved") return true;
    return !!userId && (r.user_id === userId || this.isModerator(userId));
  }

  /** Los aprobados (para /districts y, en la fase 3, el anillo exterior del nexo). */
  communityDistricts(): CommunityDistrict[] {
    return this.districtRows("status = 'approved' ORDER BY reviewed_at ASC").map((r) => this.districtView(r));
  }

  /** Para moderación: lo pendiente primero y luego lo demás (sin los borradores). */
  modDistricts(): CommunityDistrict[] {
    return this.districtRows("status != 'draft' ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, updated_at DESC LIMIT 100").map((r) => this.districtView(r));
  }

  reviewDistrict(moderator: string, id: string, decision: unknown, rawNote: unknown): Result<CommunityDistrict> {
    if (decision !== "approved" && decision !== "rejected" && decision !== "hidden") return fail(400, "bad_message", "decision: approved, rejected o hidden");
    const r = this.districtRows("id = ?", id)[0];
    if (!r) return fail(404, "not_found", "ese distrito no existe");
    const founder = (this.env.FOUNDER_USER_ID ?? "").replace(/^usr_/, "").trim();
    if (moderator === `usr_${r.user_id}` && r.user_id !== founder) return fail(403, "own_project", "no puedes revisar tu propio distrito");
    const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 500) : "";
    if (decision !== "approved" && note.length < 3) return fail(400, "note_required", "explica el motivo: lo verá su autor");
    if (decision === "approved" && r.status !== "pending") return fail(409, "bad_state", "solo se aprueba lo que está pendiente de revisión");
    this.sql.exec("UPDATE community_districts SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?", decision, note || null, Date.now(), id);
    this.logDecision(moderator, `district_${decision}`, "district", id, note || null);
    return ok(this.districtView(this.districtRows("id = ?", id)[0]!));
  }

  /* --- Jams: convocatorias con tema y fechas (ver jam.ts) --- */

  private jamRow(slug: string) {
    return this.sql
      .exec<{ id: number; slug: string; title: string; theme: string; about: string; starts_at: number; ends_at: number; voting_ends_at: number; cancelled: number }>(
        "SELECT id, slug, title, theme, about, starts_at, ends_at, voting_ends_at, cancelled FROM jams WHERE slug = ?",
        slug,
      )
      .toArray()[0];
  }

  private toJam(r: NonNullable<ReturnType<Directory["jamRow"]>>): Jam {
    const entries = this.sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM jam_entries e JOIN projects p ON p.id = e.project_id WHERE e.jam_id = ? AND e.removed_note IS NULL AND p.status = 'published' AND p.review = 'approved'",
        r.id,
      )
      .one().n;
    return {
      slug: r.slug,
      title: JSON.parse(r.title),
      theme: JSON.parse(r.theme),
      about: JSON.parse(r.about),
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      voting_ends_at: r.voting_ends_at,
      phase: jamPhase(r),
      entries,
      cancelled: !!r.cancelled,
    };
  }

  /** Las jams que no se cancelaron, las más recientes primero. */
  listJams(): Jam[] {
    return this.sql
      .exec<{ slug: string }>("SELECT slug FROM jams WHERE cancelled = 0 ORDER BY starts_at DESC LIMIT 20")
      .toArray()
      .map((r) => this.toJam(this.jamRow(r.slug)!));
  }

  /**
   * Una jam con sus juegos (publicados y aprobados). Los resultados, solo cuando acaba la votación:
   * mientras se vota no se enseña cómo va nadie.
   */
  jam(slug: string): Result<{ jam: Jam; entries: PublicProject[]; results: JamResult[] | null }> {
    const r = validJamSlug(slug) ? this.jamRow(slug) : undefined;
    if (!r || r.cancelled) return fail(404, "not_found", "esa jam no existe");
    const jam = this.toJam(r);
    const entries = this.projectRows(
      "p.id IN (SELECT project_id FROM jam_entries WHERE jam_id = ? AND removed_note IS NULL) AND p.status = 'published' AND p.review = 'approved'",
      [r.id],
      false,
      "ORDER BY p.created_at ASC",
    );
    let results: JamResult[] | null = null;
    if (jam.phase === "results") {
      const sums = new Map(
        this.sql
          .exec<{ project_id: string; votes: number; sum: number }>(
            "SELECT project_id, COUNT(*) AS votes, SUM(stars) AS sum FROM jam_votes WHERE jam_id = ? GROUP BY project_id",
            r.id,
          )
          .toArray()
          .map((x) => [x.project_id, x]),
      );
      results = jamRanking(entries.map((p) => sums.get(p.id) ?? { project_id: p.id, votes: 0, sum: 0 }));
    }
    return ok({ jam, entries, results });
  }

  /** Lo de una persona en una jam: sus votos y sus juegos apuntados (aunque estén sin revisar). */
  jamMine(
    userId: string,
    slug: string,
  ): Result<{ votes: Record<string, number>; entries: { project_id: string; removed_note: string | null }[]; can_vote: boolean }> {
    const r = validJamSlug(slug) ? this.jamRow(slug) : undefined;
    if (!r || r.cancelled) return fail(404, "not_found", "esa jam no existe");
    const votes: Record<string, number> = {};
    for (const v of this.sql.exec<{ project_id: string; stars: number }>("SELECT project_id, stars FROM jam_votes WHERE jam_id = ? AND user_id = ?", r.id, userId)) {
      votes[v.project_id] = v.stars;
    }
    // Si moderación sacó un juego, su autor ve el motivo (DSA, «exposición de motivos»).
    const entries = this.sql
      .exec<{ project_id: string; removed_note: string | null }>("SELECT project_id, removed_note FROM jam_entries WHERE jam_id = ? AND user_id = ?", r.id, userId)
      .toArray();
    return ok({ votes, entries, can_vote: this.canVoteIn(userId, r) === null });
  }

  /** Para que no se voten con cuentas hechas para la ocasión: cuenta anterior a la votación o de más de un día. */
  private canVoteIn(userId: string, j: { ends_at: number }): string | null {
    const u = this.sql.exec<{ created_at: number }>("SELECT created_at FROM users WHERE id = ?", userId).toArray()[0];
    if (!u) return "la cuenta no existe";
    if (u.created_at >= Math.max(j.ends_at, Date.now() - 86_400_000)) return "para votar, la cuenta tiene que ser anterior a la votación o tener más de un día";
    return null;
  }

  /** Crear una jam (moderación). */
  createJam(moderator: string, b: Record<string, unknown>): Result<Jam> {
    if (!validJamSlug(b.slug)) return fail(400, "bad_slug", "slug: de 3 a 40 letras minúsculas, números o guiones");
    const title = jamText(b.title, 3, 80);
    const theme = jamText(b.theme, 2, 80);
    const about = b.about === undefined ? { es: "", en: "" } : jamText(b.about, 0, 1000);
    if (!title || !theme || !about) return fail(400, "bad_message", "título (3-80), tema (2-80) y descripción (hasta 1000), en ES y EN");
    const starts = jamTime(b.starts_at);
    const ends = jamTime(b.ends_at);
    const votingEnds = jamTime(b.voting_ends_at);
    if (starts === null || ends === null || votingEnds === null) return fail(400, "bad_dates", "starts_at, ends_at y voting_ends_at (ISO 8601 o milisegundos)");
    const bad = badJamDates(starts, ends, votingEnds);
    if (bad) return fail(400, "bad_dates", bad);
    if (this.jamRow(b.slug)) return fail(409, "slug_taken", "ya hay una jam con ese slug");
    this.sql.exec(
      "INSERT INTO jams (slug, title, theme, about, starts_at, ends_at, voting_ends_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      b.slug, JSON.stringify(title), JSON.stringify(theme), JSON.stringify(about), starts, ends, votingEnds, moderator, Date.now(),
    );
    this.logDecision(moderator, "jam_create", "jam", b.slug, null);
    return ok(this.toJam(this.jamRow(b.slug)!));
  }

  /** Cambiar textos, fechas o cancelar una jam (moderación). Cada cambio queda en el registro. */
  updateJam(moderator: string, slug: string, b: Record<string, unknown>): Result<Jam> {
    const r = validJamSlug(slug) ? this.jamRow(slug) : undefined;
    if (!r) return fail(404, "not_found", "esa jam no existe");
    const title = b.title === undefined ? JSON.parse(r.title) : jamText(b.title, 3, 80);
    const theme = b.theme === undefined ? JSON.parse(r.theme) : jamText(b.theme, 2, 80);
    const about = b.about === undefined ? JSON.parse(r.about) : jamText(b.about, 0, 1000);
    if (!title || !theme || !about) return fail(400, "bad_message", "título (3-80), tema (2-80) y descripción (hasta 1000), en ES y EN");
    const starts = b.starts_at === undefined ? r.starts_at : jamTime(b.starts_at);
    const ends = b.ends_at === undefined ? r.ends_at : jamTime(b.ends_at);
    const votingEnds = b.voting_ends_at === undefined ? r.voting_ends_at : jamTime(b.voting_ends_at);
    if (starts === null || ends === null || votingEnds === null) return fail(400, "bad_dates", "fechas en ISO 8601 o milisegundos");
    const bad = badJamDates(starts, ends, votingEnds);
    if (bad) return fail(400, "bad_dates", bad);
    const cancelled = b.cancelled === undefined ? r.cancelled : b.cancelled ? 1 : 0;
    this.sql.exec(
      "UPDATE jams SET title = ?, theme = ?, about = ?, starts_at = ?, ends_at = ?, voting_ends_at = ?, cancelled = ? WHERE id = ?",
      JSON.stringify(title), JSON.stringify(theme), JSON.stringify(about), starts, ends, votingEnds, cancelled, r.id,
    );
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) || null : null;
    this.logDecision(moderator, cancelled && !r.cancelled ? "jam_cancel" : "jam_update", "jam", slug, note);
    return ok(this.toJam(this.jamRow(slug)!));
  }

  /** Apuntar un juego propio (con ficha y publicado) mientras la convocatoria está abierta. */
  enterJam(userId: string, slug: string, projectId: unknown): Result<{ entered: true }> {
    const r = validJamSlug(slug) ? this.jamRow(slug) : undefined;
    if (!r || r.cancelled) return fail(404, "not_found", "esa jam no existe");
    if (jamPhase(r) !== "submissions") return fail(409, "jam_closed", "la inscripción de esta jam no está abierta");
    if (typeof projectId !== "string") return fail(400, "bad_message", "project_id");
    const p = this.sql
      .exec<{ user_id: string; status: string; game: string | null; review: string }>("SELECT user_id, status, game, review FROM projects WHERE id = ?", projectId)
      .toArray()[0];
    if (!p || p.user_id !== userId || p.status !== "published") return fail(404, "not_found", "ese proyecto no es tuyo o no existe");
    if (!p.game) return fail(400, "jam_needs_game", "solo se apuntan juegos con su ficha (xenxo.json)");
    if (p.review === "rejected") return fail(409, "jam_rejected", "ese juego no pasó la revisión");
    const had = this.sql.exec<{ removed_note: string | null }>("SELECT removed_note FROM jam_entries WHERE jam_id = ? AND project_id = ?", r.id, projectId).toArray()[0];
    if (had) return had.removed_note === null ? ok({ entered: true }) : fail(409, "jam_removed", "moderación sacó este juego de la jam");
    const mine = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM jam_entries WHERE jam_id = ? AND user_id = ? AND removed_note IS NULL", r.id, userId).one().n;
    if (mine >= MAX_ENTRIES_PER_USER) return fail(409, "jam_one_entry", "ya tienes un juego en esta jam: quítalo antes de apuntar otro");
    this.sql.exec("INSERT INTO jam_entries (jam_id, project_id, user_id, joined_at) VALUES (?, ?, ?, ?)", r.id, projectId, userId, Date.now());
    return ok({ entered: true });
  }

  /** Quitar un juego propio (solo mientras la inscripción está abierta: después ya se vota). */
  leaveJam(userId: string, slug: string, projectId: string): Result<{ left: true }> {
    const r = validJamSlug(slug) ? this.jamRow(slug) : undefined;
    if (!r || r.cancelled) return fail(404, "not_found", "esa jam no existe");
    if (jamPhase(r) !== "submissions") return fail(409, "jam_closed", "solo se puede quitar mientras la inscripción está abierta");
    if (!this.sql.exec("DELETE FROM jam_entries WHERE jam_id = ? AND project_id = ? AND user_id = ? AND removed_note IS NULL", r.id, projectId, userId).rowsWritten) {
      return fail(404, "not_found", "ese juego no está en esta jam");
    }
    return ok({ left: true });
  }

  /** Votar de 1 a 5 (o 0 para retirar el voto) mientras dura la votación. Nunca lo propio. */
  voteJam(userId: string, slug: string, projectId: string, rawStars: unknown): Result<{ stars: number }> {
    const r = validJamSlug(slug) ? this.jamRow(slug) : undefined;
    if (!r || r.cancelled) return fail(404, "not_found", "esa jam no existe");
    if (jamPhase(r) !== "voting") return fail(409, "jam_not_voting", "ahora no se vota en esta jam");
    const stars = typeof rawStars === "number" ? rawStars : NaN;
    if (!Number.isInteger(stars) || stars < 0 || stars > 5) return fail(400, "bad_message", "stars: de 1 a 5 (0 retira el voto)");
    const p = this.sql
      .exec<{ user_id: string }>(
        "SELECT p.user_id FROM jam_entries e JOIN projects p ON p.id = e.project_id WHERE e.jam_id = ? AND e.project_id = ? AND e.removed_note IS NULL AND p.status = 'published' AND p.review = 'approved'",
        r.id, projectId,
      )
      .toArray()[0];
    if (!p) return fail(404, "not_found", "ese juego no está en esta jam");
    if (p.user_id === userId) return fail(403, "jam_own_vote", "no puedes votar tu propio juego");
    const why = this.canVoteIn(userId, r);
    if (why) return fail(403, "jam_account_too_new", why);
    if (stars === 0) {
      this.sql.exec("DELETE FROM jam_votes WHERE jam_id = ? AND project_id = ? AND user_id = ?", r.id, projectId, userId);
    } else {
      this.sql.exec(
        "INSERT INTO jam_votes (jam_id, project_id, user_id, stars, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (jam_id, project_id, user_id) DO UPDATE SET stars = excluded.stars, created_at = excluded.created_at",
        r.id, projectId, userId, stars, Date.now(),
      );
    }
    return ok({ stars });
  }

  /** Sacar un juego de una jam (moderación), con su motivo y en el registro. Sus votos se borran. */
  modRemoveJamEntry(moderator: string, slug: string, projectId: string, rawNote: unknown): Result<{ removed: true }> {
    const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 500) : "";
    if (note.length < 3) return fail(400, "note_required", "explica el motivo: lo verá su autor");
    const r = validJamSlug(slug) ? this.jamRow(slug) : undefined;
    if (!r) return fail(404, "not_found", "esa jam no existe");
    const n = this.sql.exec("UPDATE jam_entries SET removed_note = ? WHERE jam_id = ? AND project_id = ? AND removed_note IS NULL", note, r.id, projectId).rowsWritten;
    if (!n) return fail(404, "not_found", "ese juego no está en esta jam");
    this.sql.exec("DELETE FROM jam_votes WHERE jam_id = ? AND project_id = ?", r.id, projectId);
    this.logDecision(moderator, "jam_remove_entry", "project", projectId, `${slug}: ${note}`);
    return ok({ removed: true });
  }

  moderationLog(limit = 200) {
    return this.sql.exec("SELECT * FROM moderation_log ORDER BY id DESC LIMIT ?", limit).toArray();
  }

  /**
   * Borra un proyecto, sus claves de agente y lo que subieron esos agentes. Devuelve los agentes
   * a expulsar (`agt_<id>`) y los archivos que ya nadie tiene, para borrarlos de R2.
   */
  deleteProject(id: string): { agents: string[]; orphanHashes: string[] } {
    const agents = this.projectAgents(id);
    const up = `prj_${id}`;
    const hashes = this.sql.exec<{ hash: string }>("SELECT hash FROM uploads WHERE uploader = ?", up).toArray().map((r) => r.hash);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM agent_keys WHERE project_id = ?", id);
      this.sql.exec("DELETE FROM jam_entries WHERE project_id = ?", id);
      this.sql.exec("DELETE FROM jam_votes WHERE project_id = ?", id);
      this.sql.exec("DELETE FROM uploads WHERE uploader = ?", up);
      this.sql.exec("DELETE FROM projects WHERE id = ?", id);
    });
    const orphanHashes = hashes.filter((h) => this.sql.exec("SELECT 1 FROM uploads WHERE hash = ? AND kind != 'removed'", h).toArray().length === 0 && !this.hashInUse(h));
    return { agents, orphanHashes };
  }

  /* ================================================================ */
  /* «Entrar con xenxo»: proveedor OpenID Connect                       */
  /* ================================================================ */

  /** La clave de firma activa (se crea la primera vez; la privada nunca sale del Directory). */
  private async signingKey(): Promise<{ kid: string; key: CryptoKey }> {
    let row = this.sql.exec<{ kid: string; private_jwk: string }>("SELECT kid, private_jwk FROM oidc_keys WHERE active = 1 ORDER BY created_at DESC LIMIT 1").toArray()[0];
    if (!row) {
      const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
      const priv = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
      const pub = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
      // kid = huella RFC 7638 de la clave pública.
      const kid = await sha256b64url(JSON.stringify({ crv: pub.crv, kty: pub.kty, x: pub.x }));
      this.sql.exec(
        "INSERT INTO oidc_keys (kid, private_jwk, public_jwk, created_at, active) VALUES (?, ?, ?, ?, 1)",
        kid, JSON.stringify(priv), JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x }), Date.now(),
      );
      row = { kid, private_jwk: JSON.stringify(priv) };
    }
    const key = await crypto.subtle.importKey("jwk", JSON.parse(row.private_jwk) as JsonWebKey, { name: "Ed25519" }, false, ["sign"]);
    return { kid: row.kid, key };
  }

  /** Claves públicas (las activas y las retiradas hace menos de un día, para tokens aún vivos). */
  async jwks() {
    await this.signingKey();
    const rows = this.sql.exec<{ kid: string; public_jwk: string }>("SELECT kid, public_jwk FROM oidc_keys ORDER BY created_at DESC LIMIT 3").toArray();
    return { keys: rows.map((r) => ({ ...(JSON.parse(r.public_jwk) as object), kid: r.kid, use: "sig", alg: "EdDSA" })) };
  }

  /** Moderación: nueva clave de firma (la anterior se sigue publicando un tiempo para los tokens vivos). */
  async rotateSigningKey(): Promise<{ kid: string }> {
    this.sql.exec("UPDATE oidc_keys SET active = 0");
    return { kid: (await this.signingKey()).kid };
  }

  private oidcSecret(name: string): string {
    const row = this.sql.exec<{ v: string }>("SELECT v FROM oidc_secrets WHERE k = ?", name).toArray()[0];
    if (row) return row.v;
    const v = randomId("", 32);
    this.sql.exec("INSERT INTO oidc_secrets (k, v) VALUES (?, ?)", name, v);
    return v;
  }

  /** Identificador de una persona para un juego: estable, distinto en cada juego y sin dar la cuenta. */
  private async pairwiseSub(userId: string, clientId: string): Promise<string> {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(this.oidcSecret("pairwise")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${userId}:${clientId}`)));
    return "x" + b64url(mac).slice(0, 31);
  }

  private lastPrune = 0;
  private pruneOidc() {
    const now = Date.now();
    if (now - this.lastPrune < 30_000) return;
    this.lastPrune = now;
    this.sql.exec("DELETE FROM oidc_pending WHERE expires < ?", now);
  }

  /* --- Juegos (clientes) --- */

  async registerClient(userId: string, body: { name?: unknown; redirect_uris?: unknown; project_id?: unknown }): Promise<Result<OidcClientRow>> {
    const name = validClientName(body.name);
    if (!name) return fail(400, "bad_game_name", "el nombre del juego debe tener entre 2 y 40 caracteres");
    // Nadie puede llamar a su juego «xenxo…» (en la pantalla de permiso parecería de xenxo), salvo el fundador.
    const founder = (this.env.FOUNDER_USER_ID ?? "").replace(/^usr_/, "").trim();
    if (/xenxo|xenx0|xemxo/i.test(name.replace(/[\s._-]/g, "")) && userId !== founder) {
      return fail(400, "game_name_reserved", "el nombre de un juego no puede llevar «xenxo»");
    }
    const list = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    const uris = list.map(validRedirectUri);
    if (!uris.length || uris.length > MAX_REDIRECTS || uris.some((u) => !u)) {
      return fail(400, "bad_redirect", `entre 1 y ${MAX_REDIRECTS} direcciones de vuelta, https (o http://localhost para probar), sin # ni usuario`);
    }
    const n = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM oidc_clients WHERE user_id = ? AND status = 'active'", userId).one().n;
    if (n >= MAX_CLIENTS_PER_USER) return fail(409, "too_many_clients", `máximo ${MAX_CLIENTS_PER_USER} juegos por persona`);
    let projectId: string | null = null;
    if (body.project_id !== undefined && body.project_id !== null && body.project_id !== "") {
      if (typeof body.project_id !== "string" || this.projectOwner(body.project_id) !== userId) return fail(404, "not_found", "ese proyecto no es tuyo");
      projectId = body.project_id;
    }
    const clientId = randomId("xg_", 12).replace(/[^a-zA-Z0-9_]/g, "x");
    this.sql.exec(
      "INSERT INTO oidc_clients (client_id, user_id, name, redirect_uris, project_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      clientId, userId, name, JSON.stringify([...new Set(uris)]), projectId, Date.now(),
    );
    return ok(this.clientsOf(userId).find((c) => c.client_id === clientId)!);
  }

  clientsOf(userId: string): OidcClientRow[] {
    return this.sql
      .exec<{ client_id: string; name: string; redirect_uris: string; project_id: string | null; created_at: number }>(
        "SELECT client_id, name, redirect_uris, project_id, created_at FROM oidc_clients WHERE user_id = ? AND status = 'active' ORDER BY created_at",
        userId,
      )
      .toArray()
      .map((r) => ({ ...r, redirect_uris: JSON.parse(r.redirect_uris) as string[] }));
  }

  /** Quita un juego: deja de poder pedir identidades y se borran sus permisos y tokens. */
  deleteClient(userId: string, clientId: string): Result<{ deleted: true }> {
    const n = this.sql.exec("DELETE FROM oidc_clients WHERE client_id = ? AND user_id = ?", clientId, userId).rowsWritten;
    if (!n) return fail(404, "not_found", "ese juego no es tuyo");
    this.sql.exec("DELETE FROM oidc_grants WHERE client_id = ?", clientId);
    this.sql.exec("DELETE FROM oidc_pending WHERE json_extract(data, '$.client_id') = ?", clientId);
    return ok({ deleted: true });
  }

  private client(clientId: unknown) {
    if (typeof clientId !== "string") return null;
    const r = this.sql
      .exec<{ client_id: string; user_id: string; name: string; redirect_uris: string }>(
        "SELECT client_id, user_id, name, redirect_uris FROM oidc_clients WHERE client_id = ? AND status = 'active'",
        clientId,
      )
      .toArray()[0];
    return r ? { ...r, redirect_uris: JSON.parse(r.redirect_uris) as string[] } : null;
  }

  /* --- Autorización --- */

  /**
   * Valida una petición de /oidc/authorize. Si el juego o la dirección de vuelta no valen, NO se
   * redirige (`redirect: null`): xenxo enseña el error. Si valen, los demás errores vuelven al juego.
   */
  async authorizeRequest(q: Record<string, string | null>, embedded = false): Promise<{ ok: true; request: string } | { ok: false; error: string; message: string; redirect: string | null }> {
    this.pruneOidc();
    const c = this.client(q.client_id);
    if (!c) return { ok: false, error: "invalid_client", message: "ese juego no está registrado en xenxo", redirect: null };
    const redirect = q.redirect_uri ?? "";
    if (!c.redirect_uris.includes(redirect)) {
      return { ok: false, error: "invalid_redirect_uri", message: "esa dirección de vuelta no está registrada para este juego", redirect: null };
    }
    if (!validState(q.state)) return { ok: false, error: "invalid_request", message: "state no válido", redirect: null };
    // Tope de peticiones vivas: nadie llena el Directory a base de abrir pantallas de permiso.
    const live = this.sql.exec<{ n: number; mine: number | null }>(
      "SELECT COUNT(*) AS n, SUM(CASE WHEN json_extract(data, '$.client_id') = ? THEN 1 ELSE 0 END) AS mine FROM oidc_pending WHERE kind = 'request' AND expires > ?",
      c.client_id, Date.now(),
    ).one();
    if (live.n >= MAX_PENDING_TOTAL || (live.mine ?? 0) >= MAX_PENDING_PER_CLIENT) {
      return { ok: false, error: "temporarily_unavailable", message: "hay demasiadas peticiones en curso; prueba en un minuto", redirect: null };
    }
    const id = randomId("ar_", 18);
    const save = (data: Record<string, unknown>) =>
      this.sql.exec("INSERT INTO oidc_pending (id, kind, data, expires) VALUES (?, 'request', ?, ?)", id, JSON.stringify({ client_id: c.client_id, redirect_uri: redirect, state: q.state || null, ...data }), Date.now() + REQUEST_TTL_MS);
    // Un error del juego tampoco redirige solo: la persona lo ve en xenxo y vuelve con un clic.
    // Así nadie usa xenxo como trampolín hacia su web (RFC 9700 §4.11).
    const problem = (error: string, message: string) => {
      save({ error, message });
      return { ok: true as const, request: id };
    };
    if (q.response_type !== "code") return problem("unsupported_response_type", "solo response_type=code");
    const scopes = parseScopes(q.scope);
    if (!scopes) return problem("invalid_scope", "scope: openid y, si quieres, profile, player y avatar");
    if (q.code_challenge_method !== "S256" || !validChallenge(q.code_challenge)) return problem("invalid_request", "hace falta PKCE con code_challenge_method=S256");
    if (!validNonce(q.nonce)) return problem("invalid_request", "nonce no válido");
    // Solo se admite prompt=consent (preguntar siempre). none, login y max_age no: xenxo no sabe
    // cuándo entró la persona por última vez, y no prometemos lo que no podemos cumplir.
    if ((q.prompt && q.prompt !== "consent") || q.max_age != null) return problem("invalid_request", "prompt solo admite consent; max_age no se admite");
    // web_message: el juego está dentro de xenxo (iframe); la respuesta va por postMessage al origen
    // exacto de la dirección registrada, no por redirección.
    if (q.response_mode && q.response_mode !== "query" && q.response_mode !== "web_message") {
      return problem("invalid_request", "response_mode: query o web_message");
    }
    // web_message solo lo pide la web de xenxo para el juego que tiene abierto dentro; y desde ahí, siempre.
    if (q.response_mode === "web_message" && !embedded) return problem("invalid_request", "web_message solo vale con el juego abierto dentro de xenxo");
    if (embedded) q = { ...q, response_mode: "web_message" };
    save({ scopes, nonce: q.nonce || null, code_challenge: q.code_challenge, prompt: q.prompt || null, response_mode: q.response_mode === "web_message" ? "web_message" : "query" });
    return { ok: true, request: id };
  }

  private pending<T>(id: unknown, kind: "request" | "code" | "access"): T | null {
    this.pruneOidc();
    if (typeof id !== "string" || id.length > 200) return null;
    const r = this.sql.exec<{ data: string }>("SELECT data FROM oidc_pending WHERE id = ? AND kind = ? AND expires > ?", id, kind, Date.now()).toArray()[0];
    return r ? (JSON.parse(r.data) as T) : null;
  }

  /** Lo que enseña la pantalla de permiso: qué juego, de quién, a dónde vuelve y qué pide (o qué falló). */
  requestInfo(
    id: unknown,
    userId: string | null,
  ): Result<{ client: { name: string; owner: string; host: string }; scopes: string[]; granted: boolean; prompt: string | null; embedded: boolean; error?: string; message?: string }> {
    const r = this.pending<{ client_id: string; redirect_uri: string; scopes?: string[]; prompt?: string | null; response_mode?: string; error?: string; message?: string }>(id, "request");
    if (!r) return fail(404, "request_expired", "la petición caducó; vuelve a pulsar «Entrar con xenxo» en el juego");
    const c = this.client(r.client_id);
    if (!c) return fail(404, "invalid_client", "ese juego ya no está registrado");
    const owner = this.user(c.user_id);
    const client = { name: c.name, owner: owner ? `${owner.display_name}${owner.player_no != null ? ` #${owner.player_no}` : ""}` : "?", host: new URL(r.redirect_uri).host };
    const embedded = r.response_mode === "web_message";
    if (r.error) return ok({ client, scopes: [], granted: false, prompt: null, embedded, error: r.error, message: r.message });
    const scopes = r.scopes ?? [];
    // Entrar sin preguntar solo si ya lo permitió y lo usó hace poco; si no, un clic otra vez.
    const granted = userId ? this.grantCovers(userId, r.client_id, scopes, Date.now() - SILENT_GRANT_MS) : false;
    return ok({ client, scopes, granted, prompt: r.prompt ?? null, embedded });
  }

  private grantCovers(userId: string, clientId: string, scopes: string[], usedSince = 0): boolean {
    const g = this.sql
      .exec<{ scopes: string; last_used: number | null; created_at: number }>("SELECT scopes, last_used, created_at FROM oidc_grants WHERE user_id = ? AND client_id = ?", userId, clientId)
      .toArray()[0];
    if (!g || (g.last_used ?? g.created_at) < usedSince) return false;
    const have = g.scopes.split(" ");
    return scopes.every((s) => have.includes(s));
  }

  /**
   * La persona responde en la pantalla de permiso. Devuelve a dónde ir: al juego con un código
   * de un uso (o con error=access_denied si dijo que no).
   */
  async decide(id: unknown, userId: string | null, approve: boolean, authTime: number, issuer: string): Promise<Result<OidcResponse>> {
    const r = this.pending<{ client_id: string; redirect_uri: string; scopes: string[]; state: string | null; nonce: string | null; code_challenge: string; response_mode?: string; error?: string; message?: string }>(id, "request");
    if (!r) return fail(404, "request_expired", "la petición caducó; vuelve a pulsar «Entrar con xenxo» en el juego");
    // Redirección (lo normal) o postMessage al origen exacto registrado (juego dentro de xenxo).
    const respond = (params: Record<string, string | undefined>): OidcResponse => {
      if (r.response_mode !== "web_message") return { redirect: withParams(r.redirect_uri, params) };
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") clean[k] = v;
      return { web_message: { origin: new URL(r.redirect_uri).origin, params: clean } };
    };
    // Volver al juego con su error: no hace falta sesión (no se comparte nada de nadie).
    if (r.error) {
      this.sql.exec("DELETE FROM oidc_pending WHERE id = ?", id as string);
      return ok(respond({ error: r.error, error_description: r.message, state: r.state ?? undefined, iss: issuer }));
    }
    if (!userId) return fail(401, "unauthorized", "entra en tu cuenta de xenxo para dar permiso");
    this.sql.exec("DELETE FROM oidc_pending WHERE id = ?", id as string); // un solo uso
    if (!this.client(r.client_id) || !this.user(userId)) return fail(404, "invalid_client", "ese juego ya no está registrado");
    if (!approve) {
      return ok(respond({ error: "access_denied", error_description: "la persona no dio permiso", state: r.state ?? undefined, iss: issuer }));
    }
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO oidc_grants (user_id, client_id, scopes, created_at, last_used) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, client_id) DO UPDATE SET scopes = excluded.scopes, last_used = excluded.last_used`,
      userId, r.client_id, r.scopes.join(" "), now, now,
    );
    const code = randomId("ac_", 24);
    this.sql.exec(
      "INSERT INTO oidc_pending (id, kind, data, expires) VALUES (?, 'code', ?, ?)",
      await sha256b64url(code),
      JSON.stringify({ user_id: userId, client_id: r.client_id, redirect_uri: r.redirect_uri, scopes: r.scopes, nonce: r.nonce, code_challenge: r.code_challenge, auth_time: Math.floor(authTime / 1000) }),
      now + CODE_TTL_MS,
    );
    return ok(respond({ code, state: r.state ?? undefined, iss: issuer }));
  }

  /** Lo que un juego sabe de una persona, según lo permitido. */
  private async claims(userId: string, clientId: string, scopes: string[], publicBase: string) {
    const u = this.user(userId);
    if (!u) return null;
    const out: Record<string, unknown> = { sub: await this.pairwiseSub(userId, clientId) };
    if (scopes.includes("profile")) out.name = u.display_name;
    if (scopes.includes("player")) out.player_no = u.player_no;
    if (scopes.includes("avatar")) {
      // Sin personaje elegido, uno de serie fijo para esa persona (el mismo en todos los juegos).
      const { hash, format } = await this.effectiveAvatar(u);
      out.avatar = { url: `${publicBase}/assets/${hash.replace(/^sha256:/, "")}`, format, hash };
      // Su retrato (imagen cuadrada), si la web ya lo hizo de este personaje: para juegos sin 3D.
      const p = await this.portrait(u);
      if (p?.current) out.picture = `${publicBase}/assets/${p.hash.replace(/^sha256:/, "")}`;
    }
    return out;
  }

  /** /oidc/token: cambia un código por los tokens (con su verificador PKCE). */
  async exchangeCode(
    body: { grant_type?: unknown; code?: unknown; redirect_uri?: unknown; client_id?: unknown; code_verifier?: unknown },
    issuer: string,
  ): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string; message: string }> {
    const bad = (error: string, message: string, status = 400) => ({ ok: false as const, status, error, message });
    if (body.grant_type !== "authorization_code") return bad("unsupported_grant_type", "solo authorization_code");
    if (typeof body.code !== "string" || body.code.length > 100) return bad("invalid_grant", "código no válido");
    const id = await sha256b64url(body.code);
    const c = this.pending<{ user_id: string; client_id: string; redirect_uri: string; scopes: string[]; nonce: string | null; code_challenge: string; auth_time: number }>(id, "code");
    // El código se gasta aunque lo demás falle: nunca se puede probar dos veces.
    this.sql.exec("DELETE FROM oidc_pending WHERE id = ?", id);
    if (!c) return bad("invalid_grant", "el código no existe, caducó o ya se usó");
    if (body.client_id !== c.client_id || body.redirect_uri !== c.redirect_uri) return bad("invalid_grant", "el código no es de este juego o de esta dirección");
    if (!validVerifier(body.code_verifier) || (await sha256b64url(body.code_verifier)) !== c.code_challenge) return bad("invalid_grant", "el code_verifier no coincide (PKCE)");
    if (!this.client(c.client_id) || !this.grantCovers(c.user_id, c.client_id, c.scopes)) return bad("invalid_grant", "el permiso ya no existe");
    const claims = await this.claims(c.user_id, c.client_id, c.scopes, issuer);
    if (!claims) return bad("invalid_grant", "la cuenta ya no existe");
    const now = Math.floor(Date.now() / 1000);
    const { kid, key } = await this.signingKey();
    const idToken = await signJwt(key, kid, {
      iss: issuer, aud: c.client_id, iat: now, exp: now + ID_TOKEN_TTL_S, auth_time: c.auth_time,
      ...(c.nonce ? { nonce: c.nonce } : {}), ...claims,
    });
    const access = randomId("xa_", 24);
    this.sql.exec(
      "INSERT INTO oidc_pending (id, kind, data, expires) VALUES (?, 'access', ?, ?)",
      await sha256b64url(access), JSON.stringify({ user_id: c.user_id, client_id: c.client_id, scopes: c.scopes }), Date.now() + ACCESS_TOKEN_TTL_MS,
    );
    this.sql.exec("UPDATE oidc_grants SET last_used = ? WHERE user_id = ? AND client_id = ?", Date.now(), c.user_id, c.client_id);
    return { ok: true, data: { access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_MS / 1000, id_token: idToken, scope: c.scopes.join(" ") } };
  }

  /** /oidc/userinfo: lo mismo que el id_token, con un token de acceso vivo y el permiso aún dado. */
  async userinfo(accessToken: string, issuer: string): Promise<Record<string, unknown> | null> {
    if (!accessToken.startsWith("xa_")) return null;
    const a = this.pending<{ user_id: string; client_id: string; scopes: string[] }>(await sha256b64url(accessToken), "access");
    if (!a || !this.client(a.client_id) || !this.grantCovers(a.user_id, a.client_id, a.scopes)) return null;
    return this.claims(a.user_id, a.client_id, a.scopes, issuer);
  }

  /* --- Juegos conectados (lo que ve cada persona en Cuenta) --- */

  grantsOf(userId: string) {
    return this.sql
      .exec<{ client_id: string; name: string; scopes: string; created_at: number; last_used: number | null; redirect_uris: string }>(
        `SELECT g.client_id, c.name, g.scopes, g.created_at, g.last_used, c.redirect_uris FROM oidc_grants g
         JOIN oidc_clients c ON c.client_id = g.client_id WHERE g.user_id = ? ORDER BY g.last_used DESC`,
        userId,
      )
      .toArray()
      .map((g) => ({ client_id: g.client_id, name: g.name, scopes: g.scopes.split(" "), created_at: g.created_at, last_used: g.last_used, host: new URL((JSON.parse(g.redirect_uris) as string[])[0]!).host }));
  }

  /** Retira el permiso a un juego: sus tokens de acceso dejan de valer al momento. */
  revokeGrant(userId: string, clientId: string): Result<{ revoked: true }> {
    const n = this.sql.exec("DELETE FROM oidc_grants WHERE user_id = ? AND client_id = ?", userId, clientId).rowsWritten;
    if (!n) return fail(404, "not_found", "ese juego no tiene permiso");
    this.sql.exec(
      "DELETE FROM oidc_pending WHERE kind IN ('access', 'code') AND json_extract(data, '$.user_id') = ? AND json_extract(data, '$.client_id') = ?",
      userId, clientId,
    );
    return ok({ revoked: true });
  }

  /* --- Claves de agente: construir en la parcela de un proyecto --- */

  /**
   * Crea una clave para que el agente de alguien construya en la parcela de su proyecto.
   * Devuelve la clave en claro una sola vez; aquí solo queda su huella.
   */
  async createAgentKey(userId: string, projectId: unknown, label: unknown): Promise<Result<{ key: string; info: AgentKeyRow }>> {
    if (typeof projectId !== "string") return fail(400, "bad_message", "falta el proyecto");
    const p = this.sql
      .exec<{ id: string; user_id: string; status: string; district: string | null }>("SELECT id, user_id, status, district FROM projects WHERE id = ?", projectId)
      .toArray()[0];
    if (!p || p.user_id !== userId) return fail(404, "not_found", "ese proyecto no es tuyo");
    if (p.status !== "published" || !p.district) return fail(409, "not_published", "el proyecto necesita estar publicado en una parcela");
    const n = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM agent_keys WHERE project_id = ?", projectId).one().n;
    if (n >= MAX_AGENT_KEYS_PER_PROJECT) {
      return fail(409, "too_many_keys", `máximo ${MAX_AGENT_KEYS_PER_PROJECT} claves por proyecto; revoca una`, { max: MAX_AGENT_KEYS_PER_PROJECT });
    }
    const id = randomId("k", 6).replace(/[^a-zA-Z0-9]/g, "x");
    const key = randomId("xk_", 24);
    const name = typeof label === "string" ? label.trim().replace(/\s+/g, " ").slice(0, 40) : "";
    this.sql.exec(
      "INSERT INTO agent_keys (id, user_id, project_id, hash, label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id, userId, projectId, await sha256Hex(key), name || null, Date.now(),
    );
    return ok({ key, info: this.agentKeys(userId).find((k) => k.id === id)! });
  }

  agentKeys(userId: string): AgentKeyRow[] {
    return this.sql
      .exec<AgentKeyRow>(
        `SELECT k.id, k.project_id, p.title AS project_title, k.label, k.created_at, k.last_used
         FROM agent_keys k JOIN projects p ON p.id = k.project_id WHERE k.user_id = ? ORDER BY k.created_at`,
        userId,
      )
      .toArray();
  }

  /** ¿Sigue valiendo la clave de este agente de parcela? (se mira al conectar y al subir). */
  agentKeyAlive(keyId: string): boolean {
    return (
      this.sql
        .exec("SELECT 1 FROM agent_keys k JOIN projects p ON p.id = k.project_id WHERE k.id = ? AND p.status = 'published'", keyId)
        .toArray().length > 0
    );
  }

  /** Agentes con clave de un proyecto (para expulsarlos si se oculta). */
  projectAgents(projectId: string): string[] {
    return this.sql.exec<{ id: string }>("SELECT id FROM agent_keys WHERE project_id = ?", projectId).toArray().map((r) => `agt_${r.id}`);
  }

  /** Revoca una clave; devuelve el agente a expulsar. */
  revokeAgentKey(userId: string, id: string): Result<{ sub: string }> {
    const n = this.sql.exec("DELETE FROM agent_keys WHERE id = ? AND user_id = ?", id, userId).rowsWritten;
    return n ? ok({ sub: `agt_${id}` }) : fail(404, "not_found", "esa clave no existe");
  }

  /**
   * Para /auth/agent: de una clave `xk_…` a su zona (chunk del distrito, rectángulo de la parcela
   * y dueño de lo que construya, `prj_<id>`). Solo vale si el proyecto sigue publicado.
   */
  async resolveAgentKey(key: string): Promise<AgentZoneGrant | null> {
    if (!key.startsWith("xk_")) return null;
    const row = this.sql
      .exec<{ id: string; user_id: string; project_id: string; label: string | null; district: string | null; parcel: string | null; status: string; title: string }>(
        `SELECT k.id, k.user_id, k.project_id, k.label, p.district, p.parcel, p.status, p.title
         FROM agent_keys k JOIN projects p ON p.id = k.project_id WHERE k.hash = ?`,
        await sha256Hex(key),
      )
      .toArray()[0];
    if (!row || row.status !== "published") return null;
    const d = districtById(row.district);
    const i = parcelIndex(row.parcel);
    if (!d || i < 0) return null;
    this.sql.exec("UPDATE agent_keys SET last_used = ? WHERE id = ?", Date.now(), row.id);
    return {
      key_id: row.id,
      user_id: row.user_id,
      name: row.label || row.title,
      zone: { chunk_id: d.chunk, district: d.id, parcel: row.parcel!, owner: `prj_${row.project_id}`, ...parcelRect(i), facing: PARCELS[i]!.facing },
    };
  }

  /** Distrito y parcela de un proyecto (para retirar su portal). */
  projectPlace(id: string): { district: string | null; parcel: string | null } | null {
    return this.sql.exec<{ district: string | null; parcel: string | null }>("SELECT district, parcel FROM projects WHERE id = ?", id).toArray()[0] ?? null;
  }

  /** Distritos con sus parcelas y quién ocupa cada una (para elegir dónde publicar). */
  districts() {
    const rows = this.sql
      .exec<{ id: string; title: string; district: string; parcel: string }>(
        "SELECT id, title, district, parcel FROM projects WHERE status = 'published' AND district IS NOT NULL",
      )
      .toArray();
    return DISTRICTS.map((d) => {
      const mine = new Map(rows.filter((r) => r.district === d.id).map((r) => [r.parcel, r]));
      return {
        id: d.id,
        chunk_id: d.chunk,
        category: d.category,
        color: d.color,
        name: d.name,
        desc: d.desc,
        soon: !!d.soon,
        parcels: PARCELS.map((q) => {
          const r = mine.get(q.id);
          return { id: q.id, x: q.x, z: q.z, facing: q.facing, project_id: r?.id ?? null, title: r?.title ?? null };
        }),
      };
    });
  }

  /** Los proyectos más nuevos con portal, para el escaparate del nexo (o los de un distrito, para sus máquinas). */
  showcase(limit: number, district?: string) {
    return this.sql
      .exec<{ id: string; title: string; category: string; cover_hash: string; mesh_hash: string; district: string; parcel: string }>(
        `SELECT id, title, category, cover_hash, mesh_hash, district, parcel FROM projects
         WHERE status = 'published' AND review = 'approved' AND district IS NOT NULL AND cover_hash IS NOT NULL AND in_world = 1
         ${district ? "AND district = ?" : ""}
         ORDER BY created_at DESC LIMIT ?`,
        ...(district ? [district, limit] : [limit]),
      )
      .toArray();
  }

  hideProject(id: string): boolean {
    return this.sql.exec("UPDATE projects SET status = 'hidden', in_world = 0 WHERE id = ?", id).rowsWritten > 0;
  }

  /* ---------------------------------------------------------------- */
  /* Denuncias (DSA, art. 16: mecanismo de notificación y acción)        */
  /* ---------------------------------------------------------------- */

  report(
    reporter: string,
    body: { target_type?: unknown; target_id?: unknown; reason?: unknown; details?: unknown },
    evidence?: unknown,
  ): Result<{ id: number }> {
    const types = ["project", "avatar", "entity", "user", "chat"];
    const reasons = ["illegal", "hate", "harassment", "sexual", "minors", "violence", "spam", "ip", "other"];
    if (typeof body.target_type !== "string" || !types.includes(body.target_type)) return fail(400, "bad_message", "tipo de contenido no válido");
    if (typeof body.target_id !== "string" || body.target_id.length > 80) return fail(400, "bad_message", "identificador no válido");
    if (typeof body.reason !== "string" || !reasons.includes(body.reason)) return fail(400, "bad_message", "motivo no válido", { reasons });
    const written = typeof body.details === "string" ? body.details.slice(0, 1000) : "";
    // Copia del contenido denunciado (p. ej. un mensaje de chat, que caduca a los 7 días).
    const details = evidence ? JSON.stringify({ details: written, evidence }) : written || null;
    const n = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND ts > ?", reporter, Date.now() - 86_400_000)
      .one().n;
    if (n >= MAX_REPORTS_PER_DAY) return fail(429, "rate_limited", "has enviado muchas denuncias hoy");
    this.sql.exec(
      "INSERT INTO reports (ts, reporter, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?, ?)",
      Date.now(),
      reporter,
      body.target_type,
      body.target_id,
      body.reason,
      details,
    );
    const id = this.sql.exec<{ id: number }>("SELECT last_insert_rowid() AS id").one().id;
    return ok({ id });
  }

  listReports(status = "open") {
    return this.sql.exec("SELECT * FROM reports WHERE status = ? ORDER BY ts DESC LIMIT 100", status).toArray();
  }

  resolveReport(id: number, status: "actioned" | "dismissed") {
    this.sql.exec("UPDATE reports SET status = ? WHERE id = ?", status, id);
  }
}

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
