import { msg, PLACES, type ClientMessage } from "@xenxo/protocol";
import { REALTIME_URL } from "../config";
import { accountToken } from "./account";
import { WebSocketAdapter, type NetworkAdapter } from "./NetworkAdapter";
import { world } from "./world-store";
import { guestPreset } from "../world/presets";

export const net: NetworkAdapter = new WebSocketAdapter(REALTIME_URL);

net.onMessage((m) => world.apply(m));
net.onStatus((s) => world.setStatus(s));

let started = false;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let chunk: string = PLACES.nexo;
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

/** El distrito vive en un nodo que ahora no responde (503 district_unavailable). */
class Unavailable extends Error {}

/**
 * Los distritos pueden vivir en un nodo de la comunidad (servidores de distritos, docs/guia): se pide
 * un pase al Worker y se conecta donde diga. Se pide siempre, porque el sitio de un distrito cambia
 * (traslados y relevos). La plaza y el nexo siempre están aquí.
 */
async function remoteSocket(chunkId: string, token: string): Promise<string | undefined> {
  if (chunkId === PLACES.nexo || chunkId === PLACES.plaza) return undefined;
  const r = await fetch(new URL(`/chunk/${chunkId}/ticket`, REALTIME_URL), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 503) throw new Unavailable();
  if (!r.ok) throw new Error(`ticket ${r.status}`);
  const t = (await r.json()) as { url: string; remote?: boolean };
  remoteNow = !!t.remote;
  return t.remote ? t.url : undefined;
}

/** ¿La conexión actual va a un nodo? Y cuántas veces seguidas ha fallado sin llegar a abrirse. */
let remoteNow = false;
let remoteFails = 0;
let opened = false;
/** Tras estos fallos seguidos con un nodo, se avisa de que el distrito no está disponible. */
const REMOTE_FAILS_TO_WARN = 2;

async function connect() {
  try {
    const token = await tokenForSession();
    remoteNow = false;
    opened = false;
    net.connect(chunk, token, await remoteSocket(chunk, token));
  } catch (e) {
    if (e instanceof Unavailable) world.setUnavailable(true);
    else console.warn("[xenxo] sin conexión con el servidor de tiempo real", e);
    world.setStatus("closed");
    scheduleRetry();
  }
}

function scheduleRetry() {
  if (retryTimer) return;
  retry = Math.min(retry + 1, 6);
  // Con el distrito «no disponible», cada 15 s como mucho: si pasa a Cloudflare, se entra enseguida.
  const wait = 1000 * 2 ** retry;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect();
  }, world.unavailable ? Math.min(wait, 15_000) : wait);
}

export async function startSession(displayName: string | undefined, chunkId: string = PLACES.nexo) {
  if (started) return;
  started = true;
  chunk = chunkId;
  guestName = displayName;

  net.onStatus((s) => {
    if (s === "open") {
      retry = 0;
      remoteFails = 0;
      opened = true;
      world.setUnavailable(false);
      net.send(
        msg("HELLO", {
          client_type: detectClientType(),
          capabilities: { xr: false, hand_tracking: false, haptics: false, lod: "medium" },
          display_name: guestName,
          // El de un invitado (elegido o el que le tocó en este navegador): así lo ven igual los demás.
          ...(!accountToken() ? { avatar: { hash: guestPreset().hash, format: "vrm" as const } } : {}),
        }) as ClientMessage,
      );
    }
    if (s === "closed" && started && !reconnecting) {
      // Un nodo que no acepta la conexión: tras dos intentos se avisa (y se sigue probando: si el
      // distrito vuelve a Cloudflare, el pase siguiente ya lleva aquí).
      if (remoteNow && !opened && ++remoteFails >= REMOTE_FAILS_TO_WARN) world.setUnavailable(true);
      scheduleRetry();
    }
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

/* ------------------------------------------------------------------ */
/* Viajes entre lugares (portales)                                      */
/* ------------------------------------------------------------------ */

export interface SpawnRequest {
  seq: number;
  p: [number, number, number];
  /** Radianes, como la cámara del jugador (0 = mirando al norte, −Z). */
  yaw: number;
}

/** Último sitio donde hay que aparecer; el jugador lo lee en su useFrame. */
export const spawn: SpawnRequest = { seq: 0, p: [32, 0, 40], yaw: 0 };

/** Pide aparecer en un punto del lugar actual (p. ej. delante de un portal del nexo). */
export function teleport(p: [number, number, number], yawDeg = 0) {
  spawn.seq++;
  spawn.p = p;
  spawn.yaw = (yawDeg * Math.PI) / 180;
}

/** Viaja a otro chunk: se reconecta allí y aparece en `p` (o donde diga el lugar). */
export function travel(chunkId: string, p?: [number, number, number], yawDeg = 0) {
  if (p) teleport(p, yawDeg);
  if (chunkId === chunk) return;
  chunk = chunkId;
  remoteFails = 0;
  world.beginTravel(chunkId);
  if (started) reconnect();
}

export function currentChunk() {
  return chunk;
}

export function sendChat(text: string) {
  const clean = text.trim();
  if (!clean) return;
  net.send(msg("CHAT", { text: clean.slice(0, 280) }) as ClientMessage);
}

export function setGuestName(name: string) {
  guestName = name;
}

// Solo en desarrollo: para revisar lugares sin caminar hasta ellos (desde la consola o las pruebas).
if (import.meta.env.DEV) (globalThis as { __xenxoTeleport?: typeof teleport }).__xenxoTeleport = teleport;
