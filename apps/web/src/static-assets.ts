/**
 * Modelos y portadas del sistema (forja, avatares de serie, portadas): el servidor los publica como
 * recursos estáticos en /s/<hash>.<ext>, que Cloudflare sirve sin ejecutar el Worker. Así no gastan
 * peticiones del plan gratuito (100.000 al día). Lo subido por la gente sigue en /assets/<hash>.
 *
 * La lista sale de los mismos índices generados que usa el servidor. Si la web va por delante del
 * servidor y algún archivo aún no está, el Worker lo atiende igual en esa ruta.
 */
import { AVATAR_PRESETS } from "../../realtime/src/avatar-presets";
import { SEED_ASSETS } from "../../realtime/src/seed-assets";
import { SEED_COVERS } from "../../realtime/src/seed-covers";
import PRESETS from "./world/avatar-presets.json";

const EXT = new Map<string, string>();
for (const a of Object.values(SEED_ASSETS)) for (const l of a.lods) EXT.set(l.hash.slice(7), "glb");
for (const a of AVATAR_PRESETS) EXT.set(a.hash.slice(7), "glb");
// Las versiones ligeras de los avatares de serie (gente de decorado: tools/avatars/lite_avatars.mjs).
for (const a of PRESETS as { lite?: string }[]) if (a.lite) EXT.set(a.lite.slice(7), "glb");
for (const h of Object.values(SEED_COVERS)) EXT.set(h.slice(7), "webp");

/** Ruta estática de un asset del sistema, o null si es de la gente. */
export function staticAssetPath(hash: string): string | null {
  const hex = hash.replace(/^sha256:/, "");
  const ext = EXT.get(hex);
  return ext ? `/s/${hex}.${ext}` : null;
}
