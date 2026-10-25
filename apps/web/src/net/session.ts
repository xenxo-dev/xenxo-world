import { msg, type ClientMessage } from "@xenxo/protocol";
import { REALTIME_URL } from "../config";
import { accountToken } from "./account";
import { WebSocketAdapter, type NetworkAdapter } from "./NetworkAdapter";
import { world } from "./world-store";
import { chosenPreset } from "../world/presets";

export const net: NetworkAdapter = new WebSocketAdapter(REALTIME_URL);

net.onMessage((m) => world.apply(m));
net.onStatus((s) => world.setStatus(s));

let started = false;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let chunk = "c_0_0";
let guestName: string | undefined;
let reconnecting = false;

export function detectClientType(): "browser_desktop" | "browser_mobile" {
  return matchMedia("(pointer: coarse)").matches ? "browser_mobile" : "browser_desktop";
}

/** Persona registrada → su token (nombre y avatar los pone el servidor). Si no, invitado. */
async function tokenForSession(): Promise<string> {
  const own = accountToken();
  if (own) return own;
  const r = await fetch(new URL("/auth/guest", REALTIME_URL), { method: "POST" });
  if (!r.ok) throw new Error(`auth ${r.status}`);
  return ((await r.json()) as { token: string }).token;
}

async function connect() {
  try {
    net.connect(chunk, await tokenForSession());
  } catch (e) {
    console.warn("[xenxo] sin conexión con el servidor de tiempo real", e);
    world.setStatus("closed");
    scheduleRetry();
  }
}

function scheduleRetry() {
  if (retryTimer) return;
  retry = Math.min(retry + 1, 6);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect();
  }, 1000 * 2 ** retry);
}

export async function startSession(displayName: string | undefined, chunkId = "c_0_0") {
  if (started) return;
  started = true;
  chunk = chunkId;
  guestName = displayName;

  net.onStatus((s) => {
    if (s === "open") {
      retry = 0;
      net.send(
        msg("HELLO", {
          client_type: detectClientType(),
          capabilities: { xr: false, hand_tracking: false, haptics: false, lod: "medium" },
          display_name: guestName,
          ...(chosenPreset() && !accountToken() ? { avatar: { hash: chosenPreset()!.hash, format: "vrm" as const } } : {}),
        }) as ClientMessage,
      );
    }
    if (s === "closed" && started && !reconnecting) scheduleRetry();
  });

  await connect();
}

/** Vuelve a entrar con la identidad actual (tras iniciar o cerrar sesión, o cambiar de avatar). */
export function reconnect() {
  if (!started) return;
  reconnecting = true;
  net.close();
  reconnecting = false;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  void connect();
}

export function sendChat(text: string) {
  const clean = text.trim();
  if (!clean) return;
  net.send(msg("CHAT", { text: clean.slice(0, 280) }) as ClientMessage);
}

export function setGuestName(name: string) {
  guestName = name;
}
