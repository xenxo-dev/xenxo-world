import { AVATAR_PRESETS } from "./avatar-presets";

const PRESETS = new Set(AVATAR_PRESETS.map((a) => a.hash));

/** ¿Es uno de los avatares de serie que publica el servidor? */
export function isAvatarPreset(hash: string): boolean {
  return PRESETS.has(hash);
}
