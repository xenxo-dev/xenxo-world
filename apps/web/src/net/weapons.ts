/**
 * Armas (§9 octies ter), del lado de la red: con cuáles se puede disparar aquí (WELCOME.weapons), la
 * que llevas, los disparos que llegan (SHOT: el rayo que hay que dibujar y, si le dio a alguien, su
 * golpe, que va a la gente como los demás) y el botín de los cofres de Vertical (RACE.loot: la tarjeta
 * y pasar el arma a la cuenta). Sin Three.js: lo dibujan world/people/ShotFx.tsx y HeldWeapon.tsx.
 */
import { useSyncExternalStore } from "react";
import { msg, usableWeapons, WEAPON_DEFAULT, WEAPON_IDS, type ClientMessage, type WeaponId } from "@xenxo/protocol";
import { loadPref, savePref } from "../config";
import { accountToken, adoptQuietly, authedApi, currentUser, type User } from "./account";
import { people, PEOPLE_REF } from "./people-store";
import { net } from "./session";
import { world } from "./world-store";

/** Un disparo que hay que dibujar: de quién, con qué, hasta dónde, si le dio a alguien y cuándo llegó (performance.now). */
export interface ShotEvent {
  from: string;
  weapon: WeaponId;
  at: [number, number, number];
  /** De dónde sale el rayo, si se sabe ya (los tuyos: tu cañón). Si no, del arma de quien dispara (arms.ts). */
  p?: [number, number, number];
  hit: boolean;
  t: number;
}

/** Lo que ha salido en un cofre (RACE.loot). */
export interface LootEvent {
  weapon: WeaponId;
  fresh: boolean;
  race: string;
  at: number;
}

/** Cuántos disparos esperan a dibujarse como mucho (los más viejos se pierden). */
const MAX_PENDING = 48;

class WeaponsStore {
  /** Con cuáles se puede disparar aquí (null: aquí no hay armas). */
  here: WeaponId[] | null = null;
  /** La que eliges (se recuerda en este navegador; si aquí no la tienes, la pipa). */
  chosen: WeaponId = (() => {
    const w = loadPref<string>("weapon", WEAPON_DEFAULT);
    return (WEAPON_IDS as readonly string[]).includes(w) ? (w as WeaponId) : WEAPON_DEFAULT;
  })();
  /** Disparos por dibujar (los coge ShotFx). */
  pending: ShotEvent[] = [];
  /** El último cofre (la tarjeta del HUD y el cofre de la meta). */
  loot: LootEvent | null = null;

  private version = 0;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  bump() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** El arma que llevas aquí. */
  get current(): WeaponId {
    return this.here?.includes(this.chosen) ? this.chosen : WEAPON_DEFAULT;
  }

  choose(id: WeaponId) {
    if (this.chosen === id) return;
    this.chosen = id;
    savePref("weapon", id);
    this.bump();
  }

  /** La siguiente de las que puedes usar aquí. */
  next() {
    const list = this.here;
    if (!list?.length) return;
    const i = list.indexOf(this.current);
    this.choose(list[(i + 1) % list.length]!);
  }

  /** Un disparo para dibujar (los tuyos, al disparar; los de los demás, al llegar). */
  push(ev: ShotEvent) {
    this.pending.push(ev);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
  }
}

export const weapons = new WeaponsStore();

/** Re-renderiza al cambiar el lugar, el arma o el botín (nunca por cada disparo). */
export function useWeapons() {
  useSyncExternalStore(weapons.subscribe, weapons.getVersion);
  return weapons;
}

/** Las armas de tu cuenta (sin la pipa), según la sesión guardada. */
export function ownedWeapons(u: User | null = currentUser()): WeaponId[] {
  return usableWeapons(u?.weapons?.split(",")).filter((w) => w !== WEAPON_DEFAULT);
}

let seq = 0;
/** Disparar (el servidor comprueba el arma, el modo pelea, el ritmo y el alcance). */
export function sendShoot(weapon: WeaponId, at: [number, number, number], to?: string) {
  if (world.status !== "open" || world.solo) return;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  net.send(msg("SHOOT", { weapon, at: [r(at[0]), r(at[1]), r(at[2])], ...(to ? { to } : {}) }, { id: `${PEOPLE_REF}shoot-${++seq}` }) as unknown as ClientMessage);
}

let checkTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Pasa a la cuenta lo que ha salido en los cofres (lo guarda el distrito; el servidor lo comprueba
 * todo lo que haya, también lo de otras veces). Con armas nuevas llega una sesión nueva que las lleva:
 * se guarda sin reconectar (cuenta al entrar en Distrito Cero). Si falla la red, lo vuelve a intentar.
 */
export function checkWeaponsSoon(delay = 900, tries = 3) {
  if (!accountToken()) return;
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    checkTimer = null;
    authedApi<{ new: string[]; throttled?: boolean; token?: string; user?: User; principal?: { exp: number } }>("POST", "/me/weapons/check")
      .then((r) => {
        if (r.token && r.user && r.principal) {
          adoptQuietly({ token: r.token, user: r.user, principal: r.principal });
          weapons.bump();
        } else if (r.throttled && tries > 1) checkWeaponsSoon(4500, tries - 1);
      })
      .catch(() => tries > 1 && checkWeaponsSoon(5000, tries - 1));
  }, delay);
}

net.onMessage((m) => {
  switch (m.type) {
    case "WELCOME":
      weapons.here = m.payload.weapons ?? null;
      weapons.pending.length = 0;
      weapons.bump();
      break;
    case "SHOT": {
      const p = m.payload;
      const now = performance.now();
      // Los tuyos ya se dibujaron al disparar.
      if (p.from !== world.sessionId) weapons.push({ from: p.from, weapon: p.weapon, at: p.at, hit: !!p.to, t: now });
      // A quien le dio: como un golpe (con su caída, si tumba), desde quien disparó.
      if (p.to && p.dir) people.hit({ from: p.from, to: p.to, move: "shot", style: "comic", dir: p.dir, power: p.power ?? 0.3, fall: !!p.fall, ko: !!p.ko, at: now });
      break;
    }
    case "RACE":
      if (m.payload.state === "finish" && m.payload.loot) {
        weapons.loot = { ...m.payload.loot, race: m.payload.race, at: performance.now() };
        weapons.bump();
        checkWeaponsSoon();
      }
      break;
  }
});
net.onStatus((s) => {
  if (s !== "open") weapons.pending.length = 0;
});
