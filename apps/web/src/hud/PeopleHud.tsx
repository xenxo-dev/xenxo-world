/**
 * Lo que se hace con la gente desde el HUD (§9 octies): la rueda de acciones (gestos, reacciones,
 * acciones en pareja y el modo pelea; también con la tecla G), las propuestas que te llegan, los
 * botones de golpe mientras el modo pelea está activo y los avisos cortos. Todo pide; el servidor
 * decide (cercanía, ritmo y consentimiento).
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FIGHT_HP, REACTIONS, PAIR_ACTIONS, type PairAction, type Reaction } from "@xenxo/protocol";
import { t, type Key } from "../i18n";
import { OFFER_MS, people, usePeople } from "../net/people-store";
import { answerPair, displayName, offerPair, react, setFight } from "../net/people";
import { world } from "../net/world-store";
import { firstSteps } from "../net/first-steps";
import { input, onWheelKey } from "../world/input";
import { CheerIcon, DanceIcon, hudIconButton, SitIcon, WaveIcon } from "./icons";
import { PeopleIcon } from "./people-icons";
import { WeaponButtons, WeaponInventory } from "./WeaponHud";

const box = "rounded-xl border border-cal/10 bg-noche/80 backdrop-blur";

type Tab = "gestures" | "reactions" | "pair" | "fight";
interface Item {
  id: string;
  icon: ReactNode;
  label: Key;
  run: () => void;
}

const icon = (name: string) => <PeopleIcon name={name} className="h-6 w-6" />;
const emote = (id: string) => () => void (input.emote = id);

const GESTURES: Item[] = [
  { id: "wave", icon: <WaveIcon />, label: "emote.wave", run: emote("wave") },
  { id: "dance", icon: <DanceIcon />, label: "emote.dance", run: emote("dance") },
  { id: "sit", icon: <SitIcon />, label: "emote.sit", run: emote("sit") },
  { id: "cheer", icon: <CheerIcon />, label: "emote.cheer", run: emote("cheer") },
  { id: "clap", icon: icon("clap"), label: "emote.clap", run: emote("clap") },
  { id: "point", icon: icon("point"), label: "emote.point", run: emote("point") },
  { id: "beckon", icon: icon("beckon"), label: "emote.beckon", run: emote("beckon") },
  { id: "laugh", icon: icon("laugh"), label: "emote.laugh", run: emote("laugh") },
  { id: "shrug", icon: icon("shrug"), label: "emote.shrug", run: emote("shrug") },
  { id: "fold_arms", icon: icon("fold_arms"), label: "emote.fold_arms", run: emote("fold_arms") },
  { id: "nod", icon: icon("nod"), label: "emote.nod", run: emote("nod") },
  { id: "shake_head", icon: icon("shake_head"), label: "emote.shake_head", run: emote("shake_head") },
  { id: "phone", icon: icon("phone"), label: "emote.phone", run: emote("phone") },
  { id: "bow", icon: icon("bow"), label: "emote.bow", run: emote("bow") },
];
const REACTION_ITEMS: Item[] = REACTIONS.map((r: Reaction) => ({ id: r, icon: icon(r), label: `react.${r}` as Key, run: () => react(r) }));
const PAIR_ITEMS: Item[] = PAIR_ACTIONS.map((a: PairAction) => ({ id: a, icon: icon(a), label: `pair.${a}` as Key, run: () => void offerPair(a) }));

const RADIUS = 104;

/** Los botones de una pestaña, en anillo; en el centro, el nombre del que señalas. */
function Ring({ items, onPick }: { items: Item[]; onPick: () => void }) {
  const [hover, setHover] = useState<Item | null>(null);
  // Con muchos botones, el anillo crece lo justo para que no se pisen (54 px por botón).
  const radius = Math.max(RADIUS, Math.round((items.length * 54) / (Math.PI * 2)));
  const big = radius > RADIUS;
  return (
    <div className={`relative mx-auto ${big ? "h-[18.5rem] w-[18.5rem]" : "h-[17rem] w-[17rem]"}`}>
      <div className={`absolute ${big ? "inset-[3.75rem]" : "inset-[3.25rem]"} grid place-items-center rounded-full border border-cal/10 bg-noche-2/70 px-3 text-center text-xs text-cal/80`}>
        {hover ? t(hover.label) : null}
      </div>
      {items.map((it, i) => {
        const a = (i / items.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <button
            key={it.id}
            aria-label={t(it.label)}
            title={t(it.label)}
            onPointerEnter={() => setHover(it)}
            onPointerLeave={() => setHover((h) => (h === it ? null : h))}
            onFocus={() => setHover(it)}
            onClick={() => {
              it.run();
              firstSteps.mark("wheel");
              onPick();
            }}
            className={`${hudIconButton} absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full`}
            style={{ left: `calc(50% + ${Math.cos(a) * radius}px)`, top: `calc(50% + ${Math.sin(a) * radius}px)` }}
          >
            {it.icon}
          </button>
        );
      })}
    </div>
  );
}

function FightTab({ touch }: { touch: boolean }) {
  const p = usePeople();
  if (!p.style) return <p className="px-2 py-10 text-center text-sm text-cal/75">{t("people.fight.none")}</p>;
  return (
    <div className="flex flex-col gap-3 px-1 py-2 text-sm">
      <label className="flex items-center justify-between gap-3 rounded-xl border border-cal/10 bg-noche-2/70 px-3 py-2.5">
        <span className="flex items-center gap-2 font-medium text-cal">
          <PeopleIcon name="fight" />
          {t("people.fight.toggle")}
        </span>
        <input type="checkbox" className="h-5 w-5 accent-[var(--color-neon)]" checked={p.fightOn} onChange={(e) => setFight(e.target.checked)} />
      </label>
      <p className="text-cal/80">{t(`people.style.${p.style}` as Key)}</p>
      <p className="text-xs text-cal/60">{t("people.fight.consent")}</p>
      {!touch && <p className="meta text-xs text-cal/50">{t("people.fight.keys")}</p>}
      <WeaponInventory touch={touch} />
    </div>
  );
}

/** El botón de la rueda (en la fila de abajo) y la rueda, en el centro de la pantalla. */
export function ActionWheel({ solo, touch = false }: { solo: boolean; touch?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("gestures");
  useEffect(() => onWheelKey(() => setOpen((o) => !o)), []);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);
  // En el nexo se va en solitario: solo gestos.
  const tabs: Tab[] = solo ? ["gestures"] : ["gestures", "reactions", "pair", "fight"];
  const current = tabs.includes(tab) ? tab : "gestures";
  const close = () => setOpen(false);
  return (
    <>
      <button aria-label={t("people.wheelLabel")} title={t("people.wheelLabel")} aria-pressed={open} onClick={() => setOpen((o) => !o)} className={hudIconButton}>
        <PeopleIcon name="actions" />
      </button>
      {open &&
        createPortal(
          <div className="pointer-events-auto fixed inset-0 z-40 grid place-items-center bg-noche/35" onPointerDown={(e) => e.target === e.currentTarget && close()}>
            <div role="dialog" aria-label={t("people.wheel")} className={`max-h-[calc(100dvh-2rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto p-3 ${box}`}>
              {tabs.length > 1 && (
                <div role="tablist" className="mb-1 grid grid-cols-4 gap-1">
                  {tabs.map((id) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={current === id}
                      onClick={() => setTab(id)}
                      className={`rounded-lg px-1 py-1.5 text-xs transition ${current === id ? "bg-neon/15 text-neon" : "text-cal/70 hover:text-cal"}`}
                    >
                      {t(`people.tab.${id}` as Key)}
                    </button>
                  ))}
                </div>
              )}
              {current === "gestures" && <Ring items={GESTURES} onPick={close} />}
              {current === "reactions" && (
                <>
                  <Ring items={REACTION_ITEMS} onPick={close} />
                  <p className="px-2 text-center text-xs text-cal/60">{t("react.hint")}</p>
                </>
              )}
              {current === "pair" && (
                <>
                  <Ring items={PAIR_ITEMS} onPick={close} />
                  <p className="px-2 text-center text-xs text-cal/60">{t("pair.hint")}</p>
                </>
              )}
              {current === "fight" && <FightTab touch={touch} />}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

type FightButton = "punch" | "kick" | "shove" | "slide";
const FIGHT_KEYS: Record<FightButton, string> = { punch: "Q", kick: "E", shove: "R", slide: "X" };

/**
 * Botones de golpe mientras el modo pelea está activo (en los de empujones, solo empujar) y, en
 * táctil, deslizarse (corriendo; con teclado, la X). Encima, la vida.
 */
export function FightButtons({ className = "", touch = false }: { className?: string; touch?: boolean }) {
  const p = usePeople();
  if (!p.fightOn || !p.style) return null;
  const attacks: FightButton[] = p.style === "shove" ? ["shove"] : ["punch", "kick", "shove"];
  const moves: readonly FightButton[] = touch ? [...attacks, "slide"] : attacks;
  return (
    <div role="toolbar" aria-label={t("people.fight.toggle")} className={`relative flex gap-1.5 ${className}`}>
      <HealthBar />
      <WeaponButtons touch={touch} />
      {moves.map((m) => (
        <button
          key={m}
          aria-label={t(`fight.${m}` as Key)}
          title={`${t(`fight.${m}` as Key)} (${FIGHT_KEYS[m]})`}
          onPointerDown={(e) => {
            e.preventDefault();
            if (m === "slide") input.crouchPressed = true;
            else input.attack = m;
          }}
          className={`${hudIconButton} border-rosa/40 text-rosa`}
        >
          <PeopleIcon name={m} />
        </button>
      ))}
    </div>
  );
}

/** Vuelve a pintar cada `ms` mientras `on` (la vida se recupera sola; la cuenta atrás corre). */
function useTicker(on: boolean, ms: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => tick((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [on, ms]);
}

/** Tu vida en el modo pelea: una barra encima de los botones de golpe (se recupera sola). */
function HealthBar() {
  const me = world.sessionId;
  const hp = me ? people.hpOf(me, world.serverNow()) : FIGHT_HP;
  useTicker(hp < FIGHT_HP, 250);
  const k = Math.max(0, Math.min(1, hp / FIGHT_HP));
  const color = k > 0.5 ? "bg-neon" : k > 0.25 ? "bg-ocre" : "bg-rosa";
  return (
    <div className="pointer-events-none absolute bottom-full right-0 mb-1.5 w-full min-w-[8.5rem]" role="meter" aria-label={t("people.hp")} aria-valuemin={0} aria-valuemax={FIGHT_HP} aria-valuenow={Math.round(hp)}>
      <div className="meta mb-0.5 flex justify-between text-[0.65rem] text-cal/70">
        <span>{t("people.hp")}</span>
        <span>{Math.round(hp)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full border border-cal/15 bg-noche/80">
        <div className={`h-full rounded-full ${color} transition-[width] duration-200`} style={{ width: `${k * 100}%` }} />
      </div>
    </div>
  );
}

/** Fuera de combate: en el centro, cuánto falta para volver a la entrada del distrito. */
export function KnockoutNotice() {
  const p = usePeople();
  const me = world.sessionId;
  const until = me ? p.downUntil(me) : 0;
  useTicker(!!until, 250);
  if (!until) return null;
  const left = Math.max(0, Math.ceil((until - world.serverNow()) / 1000));
  return (
    <div role="status" className={`pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 px-5 py-3 text-center ${box}`}>
      <p className="display text-lg text-rosa">{t("people.ko")}</p>
      <p className="mt-0.5 text-sm text-cal/80">{left > 0 ? t("people.respawnIn", { s: String(left) }) : t("people.respawning")}</p>
    </div>
  );
}

/** Propuestas que te llegan («X te propone: chocar los cinco»). */
export function PairPrompts() {
  const p = usePeople();
  const [, tick] = useState(0);
  const live = p.offers.filter((o) => Date.now() - o.at < OFFER_MS);
  useEffect(() => {
    if (!p.offers.length) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [p.offers.length]);
  if (!live.length) return null;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-[calc(max(1rem,env(safe-area-inset-top))+6.5rem)] flex w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
      {live.slice(-3).map((o) => (
        <div key={o.from} role="alertdialog" className={`flex items-center gap-3 px-3 py-2.5 text-sm text-cal ${box}`}>
          <span className="text-neon">
            <PeopleIcon name={o.kind} />
          </span>
          <span className="min-w-0 flex-1">{t("people.offer", { name: displayName(o.from), action: t(`pair.${o.kind}` as Key) })}</span>
          <button onClick={() => answerPair(o.from, o.kind, true)} className="btn-play px-3 py-1 text-xs">
            {t("people.accept")}
          </button>
          <button onClick={() => answerPair(o.from, o.kind, false)} className="btn-ghost px-2 py-1 text-xs">
            {t("people.decline")}
          </button>
        </div>
      ))}
    </div>
  );
}

/** Aviso corto (propuesta enviada, modo pelea, «acércate más»…). */
export function PeopleNotice() {
  const p = usePeople();
  const [, tick] = useState(0);
  const at = p.notice?.at ?? 0;
  useEffect(() => {
    if (!at) return;
    const id = window.setTimeout(() => tick((n) => n + 1), 2600);
    return () => window.clearTimeout(id);
  }, [at]);
  if (!p.notice || Date.now() - p.notice.at > 2500) return null;
  return (
    <p role="status" className={`absolute left-1/2 top-[calc(max(1rem,env(safe-area-inset-top))+3.5rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 px-3 py-1.5 text-center text-sm text-cal ${box}`}>
      {t(p.notice.key as Key)}
    </p>
  );
}
