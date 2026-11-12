/**
 * Códigos de recuperación de cuenta: para entrar si se pierde la passkey (o el móvil) sin email ni
 * contraseña. Ocho códigos de un solo uso, de 12 caracteres (60 bits) en el alfabeto de Crockford
 * (sin I, L, O ni U: no se confunden al copiarlos a mano), en grupos de cuatro. Se enseñan una sola
 * vez; el servidor guarda solo su huella. Generar otros borra los de antes.
 */
export const RECOVERY_CODES = 8;
/** Generar códigos nuevos pide haber entrado hace poco (una sesión robada no se queda la cuenta). */
export const RECOVERY_FRESH_MS = 15 * 60_000;

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Un código nuevo: «7K2M-QX9D-4HRT». */
export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHABET[bytes[i]! & 31];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/**
 * Lo que alguien escribe, en la forma con que se guardó: sin espacios ni guiones, en mayúsculas, y
 * lo que se confunde, a lo suyo (O → 0, I y L → 1). null si no es un código.
 */
export function normalizeRecoveryCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 40) return null;
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (s.length !== 12) return null;
  for (const c of s) if (!ALPHABET.includes(c)) return null;
  return s;
}
