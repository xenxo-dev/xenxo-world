/**
 * Las armas en el HUD (§9 octies ter): en Distrito Cero, con el modo pelea, el botón de disparar
 * (mantenido, en las de ráfaga) y el arma que llevas (tocándola, la siguiente); en la rueda, tus
 * armas para elegir (las que aún no tienes, con su candado y de dónde salen); y la tarjeta del cofre
 * al acabar un nivel para tryhards de Vertical. Todo pide; el servidor decide.
 */
import { useEffect, useState } from "react";
import { WEAPON_DEFAULT, WEAPON_IDS, WEAPONS, type Rarity, type WeaponId } from "@xenxo/protocol";
import { t, type Key } from "../i18n";
import { useAccount } from "../net/account";
import { usePeople } from "../net/people-store";
import { ownedWeapons, useWeapons } from "../net/weapons";
import { input, setTouchFire } from "../world/input";
import { AimIcon, ChestIcon, hudIconButton, LockIcon, SwapIcon } from "./icons";

const box = "rounded-xl border border-cal/10 bg-noche/80 backdrop-blur";

/** Color de cada rareza (del tema). */
export const RARITY_CLASS: Record<Rarity, string> = {
  basica: "text-muted",
  comun: "text-azulejo-claro",
  rara: "text-neon",
  epica: "text-rosa",
  legendaria: "text-ocre",
};
const RARITY_BORDER: Record<Rarity, string> = {
  basica: "border-cal/15",
  comun: "border-azulejo-claro/40",
  rara: "border-neon/50",
  epica: "border-rosa/50",
  legendaria: "border-ocre/60",
};

/** La ficha de un arma (de perfil, apuntando a la derecha). */
export function WeaponThumb({ id, className = "h-9 w-16" }: { id: WeaponId; className?: string }) {
  return <img src={`/armas/${id}.webp`} alt="" aria-hidden className={`object-contain ${className}`} draggable={false} />;
}

/** Cuánto dispara: daño, disparos por segundo y alcance. */
function stats(id: WeaponId): string {
  const w = WEAPONS[id];
  return t("weapons.stats", { damage: String(w.damage), rate: (1000 / w.gapMs).toFixed(1), range: String(w.range) });
}

/**
 * El arma que llevas (tocándola, la siguiente) y, con teclado y ratón, disparar: una fila encima de
 * los botones de golpe y de la vida (así la fila de abajo no crece y no la tapa la ayuda del teclado).
 */
export function WeaponButtons({ touch = false }: { touch?: boolean }) {
  const w = useWeapons();
  const p = usePeople();
  if (!w.here || !p.fightOn || !p.style) return null;
  const id = w.current;
  const spec = WEAPONS[id];
  const many = w.here.length > 1;
  return (
    <div className="absolute bottom-full right-0 mb-10 flex gap-1.5">
      <button
        aria-label={many ? t("weapons.next") : t(`weapon.${id}` as Key)}
        title={`${t(`weapon.${id}` as Key)} · ${t(`rarity.${spec.rarity}` as Key)}${many ? ` · ${t("weapons.next")} (T)` : ""}`}
        onClick={() => void (input.nextWeapon = true)}
        className={`${hudIconButton} relative w-auto gap-0.5 px-1.5 ${RARITY_BORDER[spec.rarity]}`}
      >
        <WeaponThumb id={id} className="h-7 w-12" />
        {many && <SwapIcon className="absolute right-0.5 top-0.5 h-3 w-3 opacity-70" />}
      </button>
      {/* En táctil, disparar va junto al botón de saltar (world/TouchJoystick.tsx). */}
      {!touch && (
        <button
          aria-label={t("weapons.fire")}
          title={`${t("weapons.fire")} (Z)`}
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            setTouchFire(true);
          }}
          onPointerUp={() => setTouchFire(false)}
          onPointerCancel={() => setTouchFire(false)}
          onLostPointerCapture={() => setTouchFire(false)}
          className={`${hudIconButton} border-neon/50 text-neon`}
        >
          <AimIcon />
        </button>
      )}
    </div>
  );
}

/** En la rueda (modo pelea), donde hay armas: las tuyas para elegir y las que te faltan. */
export function WeaponInventory({ touch = false }: { touch?: boolean }) {
  const w = useWeapons();
  const user = useAccount();
  if (!w.here) return null;
  const owned = new Set<WeaponId>([WEAPON_DEFAULT, ...ownedWeapons(user)]);
  return (
    <div className="flex flex-col gap-2 border-t border-cal/10 pt-2">
      <p className="text-xs font-medium text-cal/80">{t("weapons.title")}</p>
      <div className="grid grid-cols-2 gap-1.5">
        {WEAPON_IDS.map((id) => {
          const spec = WEAPONS[id];
          // Las de tu inventario se pueden elegir aquí si esta sesión ya las lleva (si no, al volver a entrar).
          const usable = w.here!.includes(id);
          const mine = owned.has(id);
          return (
            <button
              key={id}
              disabled={!usable}
              aria-pressed={w.current === id}
              title={mine ? stats(id) : t(user ? "weapons.locked" : "weapons.guest")}
              onClick={() => w.choose(id)}
              className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 text-left transition aria-pressed:bg-neon/10 disabled:cursor-not-allowed ${usable ? RARITY_BORDER[spec.rarity] : "border-cal/10"} ${mine ? "" : "opacity-45"}`}
            >
              <WeaponThumb id={id} className="h-6 w-10 shrink-0" />
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-xs text-cal">{t(`weapon.${id}` as Key)}</span>
                <span className={`meta flex items-center gap-0.5 text-[0.6rem] ${RARITY_CLASS[spec.rarity]}`}>
                  {!mine && <LockIcon className="h-2.5 w-2.5" />}
                  {t(`rarity.${spec.rarity}` as Key)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-cal/60">{t(user ? "weapons.howTo" : "weapons.guest")}</p>
      {!touch && <p className="meta text-xs text-cal/50">{t("weapons.keys")}</p>}
    </div>
  );
}

/** Lo que ha salido en el cofre al acabar un nivel para tryhards de Vertical (unos segundos). */
export function LootCard() {
  const w = useWeapons();
  const loot = w.loot;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!loot) return;
    const id = window.setTimeout(() => tick((n) => n + 1), 9100);
    return () => window.clearTimeout(id);
  }, [loot]);
  if (!loot || performance.now() - loot.at > 9000) return null;
  const spec = WEAPONS[loot.weapon];
  const name = t(`weapon.${loot.weapon}` as Key);
  return (
    <div role="status" className={`pointer-events-none absolute left-1/2 top-[calc(max(1rem,env(safe-area-inset-top))+9.5rem)] flex w-[min(21rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 px-3 py-2.5 ${box} ${RARITY_BORDER[spec.rarity]}`}>
      <span className={RARITY_CLASS[spec.rarity]}>
        <ChestIcon className="h-7 w-7" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="display block text-sm text-cal">{t("loot.title")}</span>
        <span className="block text-sm text-cal">
          {name} · <span className={RARITY_CLASS[spec.rarity]}>{t(`rarity.${spec.rarity}` as Key)}</span>
        </span>
        <span className="block text-xs text-cal/70">{loot.fresh ? t("loot.fresh") : t("loot.dupe")}</span>
      </span>
      <WeaponThumb id={loot.weapon} className="h-10 w-20 shrink-0" />
    </div>
  );
}
