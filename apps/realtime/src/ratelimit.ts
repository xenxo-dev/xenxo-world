/**
 * Límites por dirección de red para lo que cualquiera puede pedir sin cuenta (altas, accesos,
 * invitados, denuncias, permisos de juegos) y para las subidas.
 *
 * Primero, el limitador de Cloudflare (binding `ratelimits` en wrangler.toml): cuenta en el borde y
 * no guarda nada nuestro. Si no está (en local o si el plan no lo ofrece), un respaldo en la memoria
 * de este Worker: más flojo (cada instancia cuenta lo suyo), pero algo es algo.
 *
 * La IP NO se guarda en ningún sitio (CLAUDE.md: «sin IP guardada»): solo se usa como clave del
 * contador, que vive unos segundos.
 */

export interface RateLimiter {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

export type LimitKind = "auth" | "guest" | "report" | "oidc" | "upload";

/** Peticiones por minuto y dirección de red (el respaldo en memoria; el binding lleva las suyas). */
const PER_MINUTE: Record<LimitKind, number> = { auth: 30, guest: 20, report: 10, oidc: 60, upload: 30 };

const memory = new Map<string, { n: number; until: number }>();

function local(kind: LimitKind, key: string): boolean {
  const now = Date.now();
  if (memory.size > 20_000) for (const [k, v] of memory) if (v.until < now) memory.delete(k);
  const k = `${kind}:${key}`;
  const e = memory.get(k);
  if (!e || e.until < now) {
    memory.set(k, { n: 1, until: now + 60_000 });
    return true;
  }
  e.n++;
  return e.n <= PER_MINUTE[kind];
}

/** ¿Puede pasar esta petición? (true = sí). Nunca falla por culpa del limitador: si da error, deja pasar. */
export async function allowed(
  limiters: Partial<Record<LimitKind, RateLimiter | undefined>>,
  kind: LimitKind,
  req: Request,
): Promise<boolean> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "local";
  const rl = limiters[kind];
  if (rl) {
    try {
      return (await rl.limit({ key: `${kind}:${ip}` })).success;
    } catch {
      return local(kind, ip);
    }
  }
  return local(kind, ip);
}
