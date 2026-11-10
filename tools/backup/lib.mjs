// Lo común de la copia y la restauración: hablar con la API de xenxo y cifrar los archivos.
// Sin dependencias: Node 22 o más nuevo.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export const URL_BASE = (process.env.XENXO_URL || "https://api.xenxo.io").replace(/\/+$/, "");
const KEY = process.env.XENXO_BACKUP_KEY || "";
const PASS = process.env.XENXO_BACKUP_PASSPHRASE || "";
export const PLAIN = process.env.XENXO_BACKUP_PLAINTEXT === "1";

export function requireConfig() {
  if (!KEY) fail("falta XENXO_BACKUP_KEY (la clave de copias: una entrada de AGENT_KEYS con el permiso «backup»)");
  if (!/^https:\/\//.test(URL_BASE) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(URL_BASE)) fail("XENXO_URL tiene que ser https:// (solo localhost puede ir por http://)");
  if (!PASS && !PLAIN) fail("falta XENXO_BACKUP_PASSPHRASE: la copia lleva datos de las cuentas y se guarda cifrada. (XENXO_BACKUP_PLAINTEXT=1 para guardarla sin cifrar, bajo tu responsabilidad.)");
  if (PASS && PASS.length < 16) fail("XENXO_BACKUP_PASSPHRASE: pon al menos 16 caracteres");
}

export function fail(msg) {
  console.error(`xenxo-backup: ${msg}`);
  process.exit(1);
}

/* --- API ---------------------------------------------------------------------------------- */

let token = null;
let tokenAt = 0;
/** La clave se cambia por un token de 15 minutos (como cualquier agente): se renueva a los 10. */
async function auth() {
  if (token && Date.now() - tokenAt < 600_000) return token;
  const r = await fetch(`${URL_BASE}/auth/agent`, { method: "POST", headers: { Authorization: `Bearer ${KEY}` } });
  if (!r.ok) fail(`la clave de copias no vale (HTTP ${r.status})`);
  token = (await r.json()).token;
  tokenAt = Date.now();
  return token;
}

/** Una llamada a la API con el token; reintenta lo que suele ser pasajero. */
export async function api(path, init = {}) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`${URL_BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await auth()}` } });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      last = e;
      await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
  }
  throw new Error(`${path}: ${last?.message ?? last}`);
}

export async function apiJson(path, init) {
  const r = await api(path, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${body.error ?? ""} ${body.message ?? ""}`.trim());
  return body;
}

/* --- Cifrado ------------------------------------------------------------------------------ */
// Cada archivo: "XB1" + sal (16) + vector (12) + datos cifrados (AES-256-GCM) + sello (16).
// La clave sale de la frase con scrypt; sin la frase, la copia no se puede leer.

const MAGIC = Buffer.from("XB1");

export function seal(data) {
  if (PLAIN) return data;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", scryptSync(PASS, salt, 32), iv);
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, c.getAuthTag()]);
}

export function unseal(buf) {
  if (!buf.subarray(0, 3).equals(MAGIC)) return buf; // sin cifrar
  if (!PASS) fail("esta copia está cifrada: hace falta XENXO_BACKUP_PASSPHRASE");
  const salt = buf.subarray(3, 19);
  const iv = buf.subarray(19, 31);
  const tag = buf.subarray(buf.length - 16);
  const d = createDecipheriv("aes-256-gcm", scryptSync(PASS, salt, 32), iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(buf.subarray(31, buf.length - 16)), d.final()]);
  } catch {
    fail("no se puede descifrar: la frase no es la de esta copia (o el archivo está dañado)");
  }
}

export const writeSealed = (file, text) => writeFileSync(file, seal(Buffer.from(text, "utf8")), { mode: 0o600 });
export const readSealed = (file) => unseal(readFileSync(file)).toString("utf8");
