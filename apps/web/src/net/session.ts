import { msg, PLACES, type ClientMessage } from "@xenxo/protocol";
import { REALTIME_URL } from "../config";
import { accountToken } from "./account";
import { campaign, withCampaign } from "./campaign";
import { checkOutage, clearOutage, noteFull } from "./outage";
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

/**
 * El token de invitado se guarda mientras valga (dura una hora; aquí, 50 minutos): viajar de un
 * lugar a otro no pide uno nuevo cada vez (una petición menos por viaje) y el invitado es el mismo
 * en todos los lugares de la visita. Si una conexión no llega a abrirse, se pide otro.
 */
const GUEST_REUSE_MS = 50 * 60_000;
let guest: { token: string; at: number } | null = null;

/** Un token de invitado (el de esta visita, si aún vale). También lo usan las denuncias sin cuenta. */
export async function guestToken(): Promise<string> {
  if (guest && Date.now() - guest.at < GUEST_REUSE_MS) return guest.token;
  const r = await fetch(new URL("/auth/guest", REALTIME_URL), { method: "POST" });
  if (r.status === 503 && (await overCapacity(r))) throw new Full();
  if (!r.ok) throw new Error(`auth ${r.status}`);
  guest = { token: ((await r.json()) as { token: string }).token, at: Date.now() };
  return guest.token;
}

/** Persona registrada → su token (nombre y avatar los pone el servidor). Si no, invitado. */
async function tokenForSession(): Promise<string> {
  return accountToken() ?? guestToken();
}

/** El distrito vive en un nodo que ahora no responde (503 district_unavailable). */
class Unavailable extends Error {}
/** El servidor ha agotado el cupo de hoy del plan gratuito (503 over_capacity). */
class Full extends Error {}

async function overCapacity(r: Response): Promise<boolean> {
  const body = (await r.clone().json().catch(() => null)) as { error?: string } | null;
  return body?.error === "over_capacity";
}

/**
 * Los distritos pueden vivir en un nodo de la comunidad (servidores de distritos, docs/guia): se pide
 * un pase al Worker y se conecta donde diga. Se pide siempre, porque el sitio de un distrito cambia
 * (traslados y relevos). La plaza y el nexo siempre están aquí.
 */
async function remoteSocket(chunkId: string, token: string): Promise<string | undefined> {
  if (chunkId === PLACES.nexo || chunkId === PLACES.plaza) return undefined;
  const r = await fetch(withCampaign(new URL(`/chunk/${chunkId}/ticket`, REALTIME_URL)), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 503) throw (await overCapacity(r)) ? new Full() : new Unavailable();
  // Un token que ya no vale (el de invitado guardado): el siguiente intento pide otro.
  if (r.status === 401) guest = null;
  if (!r.ok) throw new Error(`ticket ${r.status}`);
  const t = (await r.json()) as { url: string; remote?: boolean; host?: string };
  remoteNow = !!t.remote;
  world.setHost(t.remote && t.host ? t.host : null);
  return t.remote ? t.url : undefined;
}

/** ¿La conexión actual va a un nodo? Y cuántas veces seguidas ha fallado sin llegar a abrirse. */
let remoteNow = false;
let remoteFails = 0;
let localFails = 0;
let opened = false;
/** Tras estos fallos seguidos con un nodo, se avisa de que el distrito no está disponible. */
const REMOTE_FAILS_TO_WARN = 2;

async function connect() {
  try {
    const token = await tokenForSession();
    remoteNow = false;
    opened = false;
    net.connect(chunk, token, await remoteSocket(chunk, token), campaign());
  } catch (e) {
    if (e instanceof Unavailable) world.setUnavailable(true);
    else if (e instanceof Full) noteFull();
    else {
      console.warn("[xenxo] sin conexión con el servidor de tiempo real", e);
      // ¿Corte del plan gratuito, o este dispositivo sin red? (net/outage.ts)
      void checkOutage();
    }
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
      localFails = 0;
      opened = true;
      world.setUnavailable(false);
      clearOutage();
      net.send(
        msg("HELLO", {
          client_type: detectClientType(),
          // npc_host: este cliente puede llevar a los ciudadanos del distrito para todos (§9 nonies).
          capabilities: { xr: false, hand_tracking: false, haptics: false, lod: "medium", npc_host: true },
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
      // Sin llegar a abrirse: por si era el token de invitado guardado, el siguiente intento pide otro.
      if (!opened) guest = null;
      // Aquí mismo (Cloudflare) y sin llegar a abrirse dos veces: se mira si es el corte del día.
      if (!remoteNow && !opened && ++localFails >= 2) void checkOutage();
      scheduleRetry();
    }
  });

  await connect();
}

/** Reintenta ya (el botón de «Reintentar ahora» cuando el mundo no contesta). */
export function retryNow() {
  if (!started) return;
  retry = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  void connect();
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
