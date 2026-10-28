/**
 * Avisos de moderación hacia una automatización propia (n8n): cuando hay algo que revisar, el
 * Worker hace un POST firmado al webhook. Es opcional: sin `N8N_WEBHOOK_URL` y
 * `N8N_WEBHOOK_SECRET` (secretos de wrangler) no sale nada.
 *
 * - Solo lo necesario para avisar: qué pasó, el id y un título público. Nunca quién denuncia, ni
 *   ids de cuentas, ni textos de las denuncias.
 * - Firma: `X-Xenxo-Signature: t=<ms>,v1=<hex>` con HMAC-SHA256 del secreto sobre `<t>.<cuerpo>`
 *   (ver tools/n8n/README.md para comprobarla). Sin firma válida, el flujo debe descartarlo.
 * - Nunca bloquea la respuesta (va en ctx.waitUntil), corta a los 5 s y tiene un tope por minuto.
 */

export type ModEvent =
  | { event: "project.pending"; id: string; title: string; district: string | null }
  | { event: "game.pending"; id: string; title: string }
  | { event: "report.open"; id: number; target_type: string; reason: string }
  | { event: "district.pending"; id: string; slug: string }
  | { event: "node.down"; id: string; chunks: number };

export interface NotifyEnv {
  N8N_WEBHOOK_URL?: string;
  N8N_WEBHOOK_SECRET?: string;
}

/** Tope por isolate: 30 avisos por minuto (una ráfaga de denuncias no inunda el canal). */
const sent: number[] = [];
const PER_MINUTE = 30;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function sign(secret: string, t: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
}

/** ¿Hay webhook configurado (y válido)? */
export function notifyConfigured(env: NotifyEnv): boolean {
  const url = env.N8N_WEBHOOK_URL;
  if (!url || !env.N8N_WEBHOOK_SECRET || env.N8N_WEBHOOK_SECRET.length < 16) return false;
  return /^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
}

export async function notify(env: NotifyEnv, e: ModEvent): Promise<void> {
  if (!notifyConfigured(env)) return;
  const now = Date.now();
  while (sent.length && now - sent[0]! > 60_000) sent.shift();
  if (sent.length >= PER_MINUTE) return;
  sent.push(now);
  const body = JSON.stringify({ source: "xenxo", ...e, at: now });
  try {
    const v1 = await sign(env.N8N_WEBHOOK_SECRET!, now, body);
    const r = await fetch(env.N8N_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Xenxo-Signature": `t=${now},v1=${v1}` },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) console.warn("aviso n8n:", e.event, r.status);
  } catch (err) {
    console.warn("aviso n8n:", e.event, (err as Error).message);
  }
}
