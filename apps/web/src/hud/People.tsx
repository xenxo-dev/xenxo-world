/**
 * «Quién está aquí»: el contador del HUD abre la lista de quien comparte el lugar contigo, con su
 * número de jugador (enlace a su carnet) y un botón para ir a su lado. Solo usa lo que ya llega
 * por el protocolo (PEER_JOIN y las poses); no pide nada nuevo al servidor.
 */
import { useEffect, useRef, useState } from "react";
import type { Peer } from "@xenxo/protocol";
import { placeName, t } from "../i18n";
import { teleport } from "../net/session";
import { world } from "../net/world-store";
import { self } from "../world/self";

const EYE = 1.6;

/** Delante de la persona, a 1,4 m en la línea que nos une, mirándola. */
function goTo(peer: Peer) {
  const buf = world.poseBuffers.get(peer.session_id);
  const last = buf?.[buf.length - 1];
  if (!last) return;
  const [px, py, pz] = last.head.p;
  let dx = self.x - px;
  let dz = self.z - pz;
  const d = Math.hypot(dx, dz);
  if (d < 0.1) {
    dx = 0;
    dz = 1;
  } else {
    dx /= d;
    dz /= d;
  }
  const x = px + dx * 1.4;
  const z = pz + dz * 1.4;
  // El jugador mira hacia −Z con yaw 0; para mirar a (px, pz) desde (x, z):
  const yaw = Math.atan2(-(px - x), -(pz - z));
  teleport([x, Math.max(0, py - EYE), z], (yaw * 180) / Math.PI);
}

function tag(p: Peer) {
  const parts: string[] = [];
  if (p.kind === "agent") parts.push(t("people.agent"));
  else if (p.kind === "guest") parts.push(t("people.guest"));
  if (p.client_type === "browser_xr") parts.push(t("people.vr"));
  else if (p.client_type === "browser_mobile") parts.push(t("people.mobile"));
  return parts.join(" · ");
}

export function People({ selfName, selfNo }: { selfName: string; selfNo: number | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const peers = [...world.peers.values()].sort((a, b) => (a.player_no ?? 1e9) - (b.player_no ?? 1e9) || a.display_name.localeCompare(b.display_name));
  const live = world.status === "open";

  // Cerrar al pulsar fuera o con Escape.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => live && setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("people.open")}
        title={t("people.open")}
        className="flex items-center gap-1.5 text-cal/70 hover:text-cal"
      >
        <span className={`h-2 w-2 rounded-full ${live ? "bg-huerta" : "bg-ocre"}`} />
        {live ? t("hud.inPlace", { n: world.peers.size + 1, place: placeName(world.chunkId) }) : t("hud.connecting")}
        {live && <span aria-hidden className="text-cal/40">▾</span>}
      </button>
      {open && live && (
        <div role="dialog" aria-label={t("people.title")} className="absolute left-0 top-full z-30 mt-3 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-cal/10 bg-noche/90 p-2 shadow-xl backdrop-blur">
          <p className="px-2 pb-1 pt-0.5 text-xs uppercase tracking-wide text-cal/45">{t("people.title")}</p>
          <ul className="max-h-[50dvh] overflow-y-auto">
            <li className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
              <span className="truncate text-cal">{selfName}</span>
              {selfNo != null && <span className="text-xs text-neon-suave">#{selfNo}</span>}
              <span className="ml-auto text-xs text-cal/45">{t("people.you")}</span>
            </li>
            {peers.map((p) => (
              <li key={p.session_id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-cal/5">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-cal/90">{p.display_name}</span>
                    {p.player_no != null && (
                      <a
                        href={`/p/${p.player_no}`}
                        target="_blank"
                        rel="noopener"
                        className="shrink-0 text-xs text-neon-suave hover:underline"
                        aria-label={t("people.card", { name: p.display_name })}
                      >
                        #{p.player_no}
                      </a>
                    )}
                  </span>
                  {tag(p) && <span className="block text-xs text-cal/45">{tag(p)}</span>}
                </span>
                <button
                  onClick={() => {
                    goTo(p);
                    setOpen(false);
                  }}
                  aria-label={t("people.goLabel", { name: p.display_name })}
                  className="shrink-0 rounded-lg border border-cal/15 px-2 py-0.5 text-xs text-cal/80 hover:border-cal/30 hover:text-cal"
                >
                  {t("people.go")}
                </button>
              </li>
            ))}
          </ul>
          {peers.length === 0 && <p className="px-2 pb-1.5 pt-1 text-xs leading-relaxed text-cal/55">{t("people.empty")}</p>}
        </div>
      )}
    </div>
  );
}
