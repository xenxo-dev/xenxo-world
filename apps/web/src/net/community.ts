/**
 * Distritos de la comunidad desde la web: subir la carpeta del kit, ver el estado y, en moderación,
 * revisarlos. La carpeta se comprueba aquí con el mismo kit (@xenxo/district-kit) antes de subir
 * nada; el servidor lo vuelve a comprobar todo.
 */
import { checkDistrictFolder, manifestFiles, resolveManifest, type KitProblem, type Lang } from "@xenxo/district-kit";
import { sha256Hash } from "@xenxo/assets";
import type { DistrictSubmission } from "@xenxo/protocol";
import { authedApi } from "./account";

export type DistrictStatus = "draft" | "pending" | "approved" | "rejected" | "hidden";

export interface CommunityDistrict {
  id: string;
  slug: string;
  chunk_id: string;
  status: DistrictStatus;
  review_note: string | null;
  rev: number;
  manifest: DistrictSubmission;
  created_at: number;
  updated_at: number;
  author: { display_name: string; player_no: number | null };
}

export async function myDistrict(): Promise<CommunityDistrict | null> {
  return (await authedApi<{ district: CommunityDistrict | null }>("GET", "/me/district")).district;
}

export async function submitDistrict(): Promise<CommunityDistrict> {
  return (await authedApi<{ district: CommunityDistrict }>("POST", "/me/district/submit")).district;
}

export async function deleteDistrict(): Promise<void> {
  await authedApi("DELETE", "/me/district");
}

export async function modDistricts(): Promise<CommunityDistrict[]> {
  return (await authedApi<{ districts: CommunityDistrict[] }>("GET", "/mod/districts")).districts;
}

export async function reviewDistrict(id: string, decision: "approved" | "rejected" | "hidden", note: string): Promise<CommunityDistrict> {
  return (await authedApi<{ district: CommunityDistrict }>("POST", `/mod/districts/${encodeURIComponent(id)}/review`, { decision, note })).district;
}

export type UploadStep = { phase: "check" } | { phase: "upload"; done: number; total: number } | { phase: "save" };

/**
 * Sube una carpeta elegida con <input webkitdirectory>: la comprueba con el kit, sube los archivos
 * que aún no estén (por su hash) y envía la ficha con los hashes. Devuelve los problemas si los hay.
 */
export async function uploadDistrictFolder(
  list: FileList | File[],
  lang: Lang,
  onStep: (s: UploadStep) => void,
  previous: CommunityDistrict | null,
): Promise<{ ok: true; district: CommunityDistrict; warnings: KitProblem[] } | { ok: false; problems: KitProblem[]; warnings: KitProblem[] }> {
  const files = [...list];
  // «carpeta/models/torre.glb» → «models/torre.glb» (la ruta dentro de la carpeta elegida).
  const byPath = new Map<string, File>();
  for (const f of files) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split("/");
    byPath.set(parts.length > 1 ? parts.slice(1).join("/") : rel, f);
  }
  onStep({ phase: "check" });
  const read = async (p: string) => {
    const f = byPath.get(p);
    return f ? new Uint8Array(await f.arrayBuffer()) : null;
  };
  const r = await checkDistrictFolder(read, lang);
  if (!r.ok || !r.manifest) return { ok: false, problems: r.problems, warnings: r.warnings };

  // Lo que ya estaba subido en la versión anterior no se vuelve a subir (cuenta para el tope diario).
  const already = new Set<string>();
  if (previous) {
    const m = previous.manifest;
    already.add(m.cover).add(m.emblem);
    for (const mod of Object.values(m.models)) {
      already.add(mod.file);
      if (mod.lod1) already.add(mod.lod1);
    }
  }
  const todo = manifestFiles(r.manifest);
  const hashes: Record<string, string> = {};
  let done = 0;
  for (const f of todo) {
    onStep({ phase: "upload", done, total: todo.length });
    const bytes = (await read(f.path))!;
    const local = await sha256Hash(bytes);
    if (already.has(local)) hashes[f.path] = local;
    else {
      const type = f.kind === "cover" ? (byPath.get(f.path)!.type || "image/png") : "model/gltf-binary";
      const up = await authedApi<{ hash: string }>("POST", `/assets?kind=${f.kind}`, undefined, new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
      hashes[f.path] = up.hash;
    }
    done++;
  }
  onStep({ phase: "save" });
  const district = (await authedApi<{ district: CommunityDistrict }>("PUT", "/me/district", resolveManifest(r.manifest, hashes))).district;
  return { ok: true, district, warnings: r.warnings };
}
