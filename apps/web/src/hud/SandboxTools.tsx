/**
 * Zona de pruebas (Taller): el panel para construir con piezas básicas, solo dentro de la zona y
 * con cuenta. Coloca delante de ti (apoyado en lo que haya), deshace y borra lo tuyo. El servidor
 * decide lo que vale; aquí solo se arma la pieza y se enseña su aviso.
 */
import { useEffect, useState } from "react";
import type { Components } from "@xenxo/protocol";
import { t } from "../i18n";
import { useAccount } from "../net/account";
import { insideSandbox, placePiece, removePiece, sandboxHere, useSandbox } from "../net/sandbox";
import { useWorldVersion, world } from "../net/world-store";
import { groundHeight } from "../world/collision";
import { playerLook, playerPos } from "../world/Player";

const box = "rounded-2xl border border-cal/15 bg-noche/85 backdrop-blur";
type Shape = "box" | "cylinder" | "sphere" | "sign" | "light";
const SHAPES: Shape[] = ["box", "cylinder", "sphere", "sign", "light"];
/** Colores de las piezas (son contenido del mundo, no de la interfaz). */
const PIECE_COLORS = ["#f4f7ff", "#ff4fd8", "#4fa3ff", "#ffd54f", "#6dff8a", "#ff7a45", "#1b1f2e"];
const SIZES = { s: 0.5, m: 1, l: 2 } as const;

export function SandboxTools() {
  useWorldVersion();
  const user = useAccount();
  const sb = useSandbox();
  const [inside, setInside] = useState(false);
  const [shape, setShape] = useState<Shape>("box");
  const [color, setColor] = useState(PIECE_COLORS[1]!);
  const [size, setSize] = useState<keyof typeof SIZES>("m");
  const [solid, setSolid] = useState(true);
  const [text, setText] = useState("");
  const zone = sandboxHere();

  // Dentro o fuera de la zona: se mira 3 veces por segundo (sin estado por frame).
  useEffect(() => {
    if (!zone) return setInside(false);
    const id = setInterval(() => setInside(insideSandbox(zone, playerPos.x, playerPos.z, 1.5)), 330);
    return () => clearInterval(id);
  }, [zone]);
  if (!zone || !inside) return null;
  if (!user) return <div className={`${box} pointer-events-auto absolute bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 text-sm text-cal`}>{t("sandbox.signIn")}</div>;

  const me = `usr_${user.id}`;
  const mine = [...world.entities.values()].filter((e) => {
    if (e.owner !== me) return false;
    const p = (e.components["transform@1"] as { p?: number[] } | undefined)?.p;
    return !!p && insideSandbox(zone, p[0]!, p[2]!);
  });
  const notice = sb.notice && performance.now() - sb.notice.at < 5000 ? sb.notice : null;

  const place = () => {
    const s = SIZES[size];
    const ax = -Math.sin(playerLook.yaw), az = -Math.cos(playerLook.yaw);
    const snap = (v: number) => Math.round(v * 2) / 2;
    const x = snap(playerPos.x + ax * (1.6 + s)), z = snap(playerPos.z + az * (1.6 + s));
    // Se apoya en lo que haya debajo (suelo u otra pieza): así se apilan.
    const floor = Math.max(0, groundHeight(x, z, 0.05, 50));
    const transform = { p: [x, floor + (shape === "sign" ? 1.4 : shape === "light" ? 0.6 : s / 2), z] as [number, number, number], r: [0, 0, 0, 1] as [number, number, number, number], s: [1, 1, 1] as [number, number, number], parent: null };
    let c: Components;
    if (shape === "sign") {
      const clean = text.trim().slice(0, 80);
      if (!clean) return;
      // El cartel mira hacia quien lo pone (+Z local girado hacia atrás de su mirada).
      const yawQ = [0, Math.sin(playerLook.yaw / 2), 0, Math.cos(playerLook.yaw / 2)] as [number, number, number, number];
      c = { "transform@1": { ...transform, r: yawQ }, "label@1": { text: clean, billboard: false, size: 0.35, style: "sign", color, width: 4 } } as Components;
    } else if (shape === "light") {
      c = {
        "transform@1": transform,
        "primitive@1": { shape: "sphere", size: [0.3, 0.3, 0.3], color, emissive: true, finish: "matte" },
        "light@1": { type: "point", color, intensity: 2, range: 8, when: "always" },
      } as Components;
    } else {
      const dims: [number, number, number] = [s, s, s];
      c = { "transform@1": transform, "primitive@1": { shape, size: dims, color, emissive: false, finish: "matte" } } as Components;
      if (solid) c["collider@1"] = { shape: "box", half_extents: [s / 2, s / 2, s / 2], trigger: false };
    }
    placePiece(c);
  };
  const undo = () => {
    const id = sb.placed.at(-1);
    const e = id ? world.entities.get(id) : undefined;
    if (e) removePiece(e.entity_id, e.rev);
  };
  const clearMine = () => {
    for (const e of mine) removePiece(e.entity_id, e.rev);
  };

  const chip = (on: boolean) => `rounded-lg px-2.5 py-1 text-xs transition ${on ? "bg-neon/20 text-neon" : "text-cal/75 hover:bg-cal/10"}`;
  return (
    <div className={`${box} pointer-events-auto absolute bottom-24 left-1/2 w-[min(92vw,520px)] -translate-x-1/2 p-3 text-sm text-cal`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="display text-neon">{t("sandbox.title")}</span>
        <span className="meta text-xs text-cal/60">{t("sandbox.count", { n: mine.length, max: zone.per_person })}</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {SHAPES.map((s) => (
          <button key={s} className={chip(shape === s)} onClick={() => setShape(s)}>
            {t(`sandbox.shape.${s}`)}
          </button>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {PIECE_COLORS.map((c) => (
          <button
            key={c}
            aria-label={c}
            onClick={() => setColor(c)}
            className={`h-6 w-6 rounded-full border ${color === c ? "border-neon" : "border-cal/20"}`}
            style={{ background: c }}
          />
        ))}
        {shape !== "sign" && shape !== "light" && (
          <>
            <span className="ml-2 text-xs text-cal/55">{t("sandbox.size")}</span>
            {(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((k) => (
              <button key={k} className={chip(size === k)} onClick={() => setSize(k)}>
                {k.toUpperCase()}
              </button>
            ))}
            <button className={chip(solid)} onClick={() => setSolid(!solid)}>
              {t("sandbox.solid")}
            </button>
          </>
        )}
      </div>
      {shape === "sign" && (
        <input
          value={text}
          maxLength={80}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={t("sandbox.signPlaceholder")}
          className="mb-2 w-full rounded-lg border border-cal/15 bg-noche/60 px-3 py-1.5 text-sm"
        />
      )}
      <div className="flex flex-wrap gap-2">
        <button className="neon-tube rounded-lg px-3 py-1.5 text-sm" onClick={place}>
          {t("sandbox.place")}
        </button>
        <button className="btn-ghost rounded-lg px-3 py-1.5 text-sm" disabled={!sb.placed.length} onClick={undo}>
          {t("sandbox.undo")}
        </button>
        <button className="btn-ghost rounded-lg px-3 py-1.5 text-sm" disabled={!mine.length} onClick={clearMine}>
          {t("sandbox.clearMine")}
        </button>
      </div>
      {notice && <p className="mt-2 text-xs text-red-200">{notice.message}</p>}
      <p className="mt-2 text-xs text-cal/50">{t("sandbox.rules")}</p>
    </div>
  );
}
