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

export const TERMS_VERSION = "2026-10";
const FLOW_TTL_MS = 5 * 60 * 1000;
const MAX_PROJECTS_PER_USER = 3;
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
  author: string;
  created_at: number;
  in_world: boolean;
};

export function validDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N} _.\-]{2,32}$/u.test(name)) return null;
  if (RESERVED_NAMES.has(name.toLowerCase())) return null;
  return name;
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
    `);
    // Migración: tamaño de cada subida (para los topes de almacenamiento).
    const cols = this.sql.exec<{ name: string }>("PRAGMA table_info(uploads)").toArray().map((c) => c.name);
    if (!cols.includes("bytes")) this.sql.exec("ALTER TABLE uploads ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0");
    // Migración: número de jugador. Las cuentas que ya existían se numeran por orden de alta.
    const ucols = this.sql.exec<{ name: string }>("PRAGMA table_info(users)").toArray().map((c) => c.name);
    if (!ucols.includes("player_no")) {
      this.sql.exec("ALTER TABLE users ADD COLUMN player_no INTEGER");
      const ids = this.sql.exec<{ id: string }>("SELECT id FROM users ORDER BY created_at, id").toArray();
      ids.forEach((r, i) => this.sql.exec("UPDATE users SET player_no = ? WHERE id = ?", i + 1, r.id));
    }
    this.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_player_no ON users(player_no)");
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

  private takeFlow(id: unknown, kind: "register" | "login") {
    this.sql.exec("DELETE FROM flows WHERE ts < ?", Date.now() - FLOW_TTL_MS);
    if (typeof id !== "string") return null;
    const row = this.sql
      .exec<{ challenge: string; user_id: string | null; display_name: string | null }>(
        "SELECT challenge, user_id, display_name FROM flows WHERE id = ? AND kind = ?",
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
    if (!name) return fail(400, "bad_name", "nombre no válido: 2–32 letras, números, espacios, «.», «_» o «-»");
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
      this.sql.exec(
        "INSERT INTO users (id, display_name, created_at, terms_version, age_confirmed, player_no) VALUES (?, ?, ?, ?, 1, (SELECT COALESCE(MAX(player_no), 0) + 1 FROM users))",
        flow.user_id,
        flow.display_name,
        now,
        TERMS_VERSION,
      );
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
    const name = validDisplayName(raw);
    if (!name) return fail(400, "bad_name", "nombre no válido");
    this.sql.exec("UPDATE users SET display_name = ? WHERE id = ?", name, id);
    return ok(this.user(id)!);
  }

  setAvatar(id: string, hash: unknown, format: "glb" | "vrm"): Result<UserRow> {
    if (hash === null) {
      this.sql.exec("UPDATE users SET avatar_hash = NULL, avatar_format = NULL WHERE id = ?", id);
      return ok(this.user(id)!);
    }
    if (typeof hash !== "string") return fail(400, "bad_message", "falta el hash del avatar");
    const up = this.sql
      .exec("SELECT 1 FROM uploads WHERE hash = ? AND uploader = ? AND kind = 'avatar'", hash, `usr_${id}`)
      .toArray()[0];
    if (!up) return fail(403, "forbidden", "sube primero el avatar desde tu cuenta");
    this.sql.exec("UPDATE users SET avatar_hash = ?, avatar_format = ? WHERE id = ?", hash, format, id);
    return ok(this.user(id)!);
  }

  /** Derecho de acceso y portabilidad (RGPD arts. 15 y 20). */
  exportData(id: string) {
    const u = this.sql.exec("SELECT * FROM users WHERE id = ?", id).toArray()[0];
    if (!u) return fail(404, "not_found", "la cuenta no existe");
    return ok({
      exported_at: new Date().toISOString(),
      user: u,
      passkeys: this.sql.exec("SELECT id, created_at, last_used, transports FROM credentials WHERE user_id = ?", id).toArray(),
      projects: this.sql.exec("SELECT * FROM projects WHERE user_id = ?", id).toArray(),
      uploads: this.sql.exec("SELECT hash, kind, ts FROM uploads WHERE uploader = ?", `usr_${id}`).toArray(),
      reports_sent: this.sql.exec("SELECT ts, target_type, target_id, reason, details FROM reports WHERE reporter = ?", `usr_${id}`).toArray(),
    });
  }

  /**
   * Derecho de supresión (RGPD art. 17). Devuelve los assets que solo subió
   * esta persona, para que el Worker los borre de R2, y sus proyectos, para retirar los stands.
   */
  deleteAccount(id: string): Result<{ orphanHashes: string[]; projectIds: string[] }> {
    const sub = `usr_${id}`;
    if (!this.user(id)) return fail(404, "not_found", "la cuenta no existe");
    const projectIds = this.sql.exec<{ id: string }>("SELECT id FROM projects WHERE user_id = ?", id).toArray().map((r) => r.id);
    const mine = this.sql.exec<{ hash: string }>("SELECT hash FROM uploads WHERE uploader = ?", sub).toArray().map((r) => r.hash);
    const orphanHashes = mine.filter(
      (h) => this.sql.exec("SELECT 1 FROM uploads WHERE hash = ? AND uploader != ?", h, sub).toArray().length === 0,
    );
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM credentials WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM projects WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM uploads WHERE uploader = ?", sub);
      this.sql.exec("UPDATE reports SET reporter = 'deleted' WHERE reporter = ?", sub);
      this.sql.exec("DELETE FROM users WHERE id = ?", id);
    });
    return ok({ orphanHashes, projectIds });
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

  createProject(userId: string, body: { title?: unknown; summary?: unknown; url?: unknown; mesh_hash?: unknown }): Result<PublicProject> {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const summary = typeof body.summary === "string" ? body.summary.trim() : "";
    if (title.length < 3 || title.length > 60) return fail(400, "bad_title", "el título debe tener entre 3 y 60 caracteres");
    if (summary.length > 280) return fail(400, "bad_summary", "la descripción admite hasta 280 caracteres");
    const url = validHttpsUrl(body.url);
    if (url === false) return fail(400, "bad_url", "el enlace debe empezar por https://");
    let mesh: string | null = null;
    if (body.mesh_hash !== undefined && body.mesh_hash !== null && body.mesh_hash !== "") {
      if (typeof body.mesh_hash !== "string") return fail(400, "bad_message", "hash de modelo no válido");
      const up = this.sql
        .exec("SELECT 1 FROM uploads WHERE hash = ? AND uploader = ? AND kind = 'model'", body.mesh_hash, `usr_${userId}`)
        .toArray()[0];
      if (!up) return fail(403, "forbidden", "sube primero el modelo del proyecto");
      mesh = body.mesh_hash;
    }
    const count = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM projects WHERE user_id = ? AND status = 'published'", userId)
      .one().n;
    if (count >= MAX_PROJECTS_PER_USER) return fail(409, "too_many_projects", `máximo ${MAX_PROJECTS_PER_USER} proyectos por persona`);
    const id = randomId("p", 8).replace(/[^a-zA-Z0-9]/g, "x");
    this.sql.exec(
      "INSERT INTO projects (id, user_id, title, summary, url, mesh_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'published', ?)",
      id,
      userId,
      title,
      summary,
      url,
      mesh,
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
          `SELECT p.id, p.title, p.summary, p.url, p.mesh_hash, u.display_name AS author, p.created_at, p.in_world
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
        `SELECT p.id, p.title, p.summary, p.url, p.mesh_hash, u.display_name AS author, p.created_at, p.in_world
         FROM projects p JOIN users u ON u.id = p.user_id WHERE p.status = 'published'
         ORDER BY p.created_at DESC LIMIT 50`,
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
