/**
 * Insignias de la cuenta: las que tiene y la comprobación tras completar algo (las da el servidor
 * mirando lo que guardan los distritos; el cliente solo pregunta).
 */
import { accountToken, authedApi } from "./account";

export interface BadgeInfo {
  id: string;
  name: Record<string, string>;
  desc: Record<string, string>;
  color: string;
  district: string;
  earned_at: number;
}

export async function myBadges(): Promise<BadgeInfo[]> {
  return (await authedApi<{ badges: BadgeInfo[] }>("GET", "/me/badges")).badges;
}

let pending: ReturnType<typeof setTimeout> | null = null;
/**
 * Pide comprobar las insignias (con un poco de retraso: lo recién completado ya está guardado en
 * el distrito). Llama a `onNew` con las nuevas.
 */
export function checkBadgesSoon(onNew: (b: BadgeInfo[]) => void) {
  if (!accountToken()) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    authedApi<{ new: BadgeInfo[] }>("POST", "/me/badges/check")
      .then((r) => r.new.length && onNew(r.new))
      .catch(() => {});
  }, 800);
}
