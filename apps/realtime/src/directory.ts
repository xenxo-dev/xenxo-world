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
import { type ProjectCategory } from "@xenxo/protocol";
import { DISTRICTS, districtById, PARCELS, parcelIndex } from "./districts";

export const TERMS_VERSION = "2026-10";
const FLOW_TTL_MS = 5 * 60 * 1000;
const MAX_PROJECTS_PER_USER = 3;
/** Personajes propios guardados por cuenta (el armario). Los de serie no cuentan. */
export const MAX_SKINS = 3;
const MAX_UPLOADS_PER_DAY = 30;
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
const RESERVED_NAMES = new Set(["system", "admin", "xenxo", "moderador", "moderator", "anthropic", "claude"]);

export type Fail = { ok: false; status: number; error: string; message: string; detail?: unknown };
export type Ok<T> = { ok: true; data: T };
export type Result<T> = Ok<T> | Fail;

const ok = <T>(data: T): Ok<T> => ({ ok: true, data });
const fail = (status: number, error: string, message: string, detail?: unknown): Fail => ({ ok: false, status, error, message, detail });

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
};

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
      -- El armario: hasta MAX_SKINS personajes propios por cuenta (archivos que subió esa persona).
      CREATE TABLE IF NOT EXISTS skins (
        user_id TEXT NOT NULL, hash TEXT NOT NULL, format TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, hash));
    `);
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
    this.sql.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS projects_parcel ON projects(district, parcel) WHERE status = 'published' AND district IS NOT NULL",
    );
    // Migración: número de jugador. Las cuentas que ya existían se numeran por orden de alta.
    const ucols = this.sql.exec<{ name: string }>("PRAGMA table_info(users)").toArray().map((c) => c.name);
    if (!ucols.includes("player_no")) {
      this.sql.exec("ALTER TABLE users ADD COLUMN player_no INTEGER");
      const ids = this.sql.exec<{ id: string }>("SELECT id FROM users ORDER BY created_at, id").toArray();
      ids.forEach((r, i) => this.sql.exec("UPDATE users SET player_no = ? WHERE id = ?", i + 1, r.id));
    }
    this.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_player_no ON users(player_no)");
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

  async loginOptions() {
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

  me(id: string): Result<UserRow & { projects: PublicProject[] }> {
    const u = this.user(id);
    if (!u) return fail(404, "not_found", "la cuenta no existe");
    return ok({ ...u, projects: this.projectsOf(id) });
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
    const orphan = this.sql.exec("SELECT 1 FROM uploads WHERE hash = ? AND kind != 'removed'", hash).toArray().length === 0;
    return ok({ user: this.user(id)!, skins: this.skins(id), orphan });
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
      reports_sent: this.sql.exec("SELECT ts, target_type, target_id, reason, details FROM reports WHERE reporter = ?", `usr_${id}`).toArray(),
    });
  }

  /**
   * Derecho de supresión (RGPD art. 17). Devuelve los assets que solo subió
   * esta persona, para que el Worker los borre de R2, y sus proyectos, para retirar los stands.
   */
  deleteAccount(id: string): Result<{ orphanHashes: string[]; projects: { id: string; district: string | null }[] }> {
    const sub = `usr_${id}`;
    if (!this.user(id)) return fail(404, "not_found", "la cuenta no existe");
    const projects = this.sql.exec<{ id: string; district: string | null }>("SELECT id, district FROM projects WHERE user_id = ?", id).toArray();
    const mine = this.sql.exec<{ hash: string }>("SELECT hash FROM uploads WHERE uploader = ?", sub).toArray().map((r) => r.hash);
    const orphanHashes = mine.filter(
      (h) => this.sql.exec("SELECT 1 FROM uploads WHERE hash = ? AND uploader != ? AND kind != 'removed'", h, sub).toArray().length === 0,
    );
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM credentials WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM logins WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM skins WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM projects WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM uploads WHERE uploader = ?", sub);
      this.sql.exec("UPDATE reports SET reporter = 'deleted' WHERE reporter = ?", sub);
      this.sql.exec("DELETE FROM users WHERE id = ?", id);
    });
    return ok({ orphanHashes, projects });
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
    const url = validHttpsUrl(body.url);
    if (!url) return fail(400, "bad_url", "el proyecto necesita un enlace que empiece por https://");
    const district = districtById(body.district);
    if (!district) return fail(400, "bad_district", `el distrito debe ser uno de: ${DISTRICTS.map((d) => d.id).join(", ")}`);
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

  project(id: string): PublicProject | null {
    return (
      this.sql
        .exec<Omit<PublicProject, "in_world"> & { in_world: number }>(
          `SELECT p.id, p.title, p.summary, p.url, p.mesh_hash, p.cover_hash, p.category, p.district, p.parcel, u.display_name AS author, p.created_at, p.in_world
           FROM projects p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
          id,
        )
        .toArray()
        .map((r) => ({ ...r, in_world: !!r.in_world }))[0] ?? null
    );
  }

  projectOwner(id: string): string | null {
    return this.sql.exec<{ user_id: string }>("SELECT user_id FROM projects WHERE id = ?", id).toArray()[0]?.user_id ?? null;
  }

  listProjects(): PublicProject[] {
    return this.sql
      .exec<Omit<PublicProject, "in_world"> & { in_world: number }>(
        `SELECT p.id, p.title, p.summary, p.url, p.mesh_hash, p.cover_hash, p.category, p.district, p.parcel, u.display_name AS author, p.created_at, p.in_world
         FROM projects p JOIN users u ON u.id = p.user_id WHERE p.status = 'published'
         ORDER BY p.created_at DESC LIMIT 100`,
      )
      .toArray()
      .map((r) => ({ ...r, in_world: !!r.in_world }));
  }

  private projectsOf(userId: string): PublicProject[] {
    return this.listProjects().filter((p) => this.projectOwner(p.id) === userId);
  }

  deleteProject(id: string): void {
    this.sql.exec("DELETE FROM projects WHERE id = ?", id);
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
        parcels: PARCELS.map((q) => {
          const r = mine.get(q.id);
          return { id: q.id, x: q.x, z: q.z, facing: q.facing, project_id: r?.id ?? null, title: r?.title ?? null };
        }),
      };
    });
  }

  /** Los proyectos más nuevos con portal, para el escaparate del nexo. */
  showcase(limit: number) {
    return this.sql
      .exec<{ id: string; title: string; category: string; cover_hash: string; mesh_hash: string; district: string; parcel: string }>(
        `SELECT id, title, category, cover_hash, mesh_hash, district, parcel FROM projects
         WHERE status = 'published' AND district IS NOT NULL AND cover_hash IS NOT NULL AND in_world = 1
         ORDER BY created_at DESC LIMIT ?`,
        limit,
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
