/**
 * Modelos de los mandos y de las manos para la VR, servidos desde xenxo (el navegador del visitante
 * no descarga nada de terceros). Salen del paquete @webxr-input-profiles/assets (MIT, del grupo
 * Immersive Web del W3C): solo los perfiles de las gafas habituales, más uno genérico de reserva.
 * Los copia tal cual a apps/web/public/xr/profiles/ con su `profilesList.json` recortado, de modo que
 * un mando que no esté en la lista usa el genérico (`defaultControllerProfileId` en World.tsx).
 *
 *   node tools/xr/fetch-profiles.mjs
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1.0.20";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEST = join(ROOT, "apps", "web", "public", "xr", "profiles");
/** Quest 3/3S, Quest 3 (mandos nuevos), Quest Pro, Quest 2, Quest 1/Rift S, Pico 4/4 Ultra, manos y reserva. */
export const PROFILES = [
  "meta-quest-touch-plus",
  "meta-quest-touch-plus-v2",
  "meta-quest-touch-pro",
  "oculus-touch-v3",
  "oculus-touch-v2",
  "pico-4",
  "pico-4u",
  "generic-hand",
  "generic-trigger-squeeze-thumbstick",
];
/** Archivos de cada perfil que hacen falta (el `none.glb` del genérico, no: ningún mando de estos lo usa). */
const FILES = ["profile.json", "left.glb", "right.glb"];

const tmp = mkdtempSync(join(tmpdir(), "xr-profiles-"));
try {
  execFileSync("npm", ["pack", `@webxr-input-profiles/assets@${VERSION}`, "--silent"], { cwd: tmp, stdio: ["ignore", "pipe", "inherit"] });
  execFileSync("tar", ["xzf", `webxr-input-profiles-assets-${VERSION}.tgz`], { cwd: tmp });
  const src = join(tmp, "package", "dist", "profiles");
  const list = JSON.parse(readFileSync(join(src, "profilesList.json"), "utf8"));
  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(DEST, { recursive: true });
  const kept = {};
  for (const id of PROFILES) {
    if (!list[id]) throw new Error(`no está el perfil ${id}`);
    kept[id] = list[id];
    mkdirSync(join(DEST, id), { recursive: true });
    for (const f of FILES) if (existsSync(join(src, id, f))) cpSync(join(src, id, f), join(DEST, id, f));
  }
  writeFileSync(join(DEST, "profilesList.json"), JSON.stringify(kept, null, 1) + "\n");
  cpSync(join(tmp, "package", "LICENSE.md"), join(DEST, "LICENSE.md"));
  console.log(`${PROFILES.length} perfiles en ${DEST}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
