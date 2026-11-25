/**
 * Del chat al cuerpo (people/talk.ts): con cada mensaje nuevo de una sesión, su actuación encima de su
 * avatar, empezando a la hora a la que se mandó (así los que lo ven a la vez lo ven igual). Lo usan
 * quien dibuja a los demás (Avatars.tsx) y el propio jugador (Player.tsx). Nada viaja por la red:
 * todos tienen ya el mensaje.
 */
import { chat, world } from "../../net/world-store";
import type { Motion } from "../motion";
import { planSay, sayDone, seedOf } from "./talk";

/** Lo último del chat que se ha mirado para una sesión. */
export interface ChatSay {
  v: number;
  id: string | null;
}
export const chatSay = (): ChatSay => ({ v: -1, id: null });

/** Gestos sobre los que se puede hablar (la parte de arriba está libre): sentado o en cuclillas. */
export const SAY_OVER = new Set(["sit", "crouch"]);
/** Un mensaje más viejo que esto (s) cuando se ve por primera vez (de antes de llegar) no se dice. */
const FRESH_S = 2.5;

/**
 * Avanza lo que esté diciendo (aunque no se dibuje) y, si ha escrito algo nuevo, empieza a decirlo.
 * `allowed`: si ahora puede (no en coche, colgado, con el arma, en el modo pelea ni con otro gesto).
 */
export function sayFromChat(sessionId: string | null, m: Motion, st: ChatSay, dt: number, allowed: boolean) {
  const run = m.say;
  if (run) {
    run.t += dt;
    if (!allowed || sayDone(run)) m.say = null;
  }
  if (!sessionId) return;
  const v = chat.getVersion();
  if (v === st.v) return;
  st.v = v;
  const msg = chat.bubbleFor(sessionId);
  if (!msg || msg.id === st.id) return;
  st.id = msg.id;
  const age = (world.serverNow() - msg.t) / 1000;
  if (!allowed || age > FRESH_S) return;
  m.say = { plan: planSay(msg.text, seedOf(msg.id)), t: Math.max(0, age) };
}
