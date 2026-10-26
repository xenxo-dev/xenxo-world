/**
 * Sala multijugador de la plantilla de xenxo (licencia MIT, como el resto de la plantilla).
 *
 * Un Durable Object por sala (`/sala/<nombre>`): reenvía el estado de cada jugador a los demás por
 * WebSocket. Con hibernación: mientras nadie escribe, no gasta. Así funciona también el mundo de
 * xenxo, pero esta sala es tuya y va en tu cuenta gratuita de Cloudflare.
 *
 * Mensajes (JSON):
 *   → { t: "hola", token?, nombre? }   primero de todo. `token` = el id_token de «Entrar con xenxo»
 *   ← { t: "bienvenida", yo, jugadores }
 *   ← { t: "entra", jugador }  ·  ← { t: "sale", id }
 *   → { t: "estado", d }  ← { t: "estado", id, d }   lo último de cada uno (posición, etc.)
 *   → { t: "evento", d }  ← { t: "evento", id, d }   algo que pasa una vez (un disparo, un emoji)
 *
 * Un jugador es { id, nombre, numero, avatar, verificado }. Solo con un id_token firmado por xenxo
 * (y para tu client_id) es `verificado`: entonces nombre, número y avatar son de verdad suyos.
 */
import { DurableObject } from "cloudflare:workers";

const MAX_JUGADORES = 16;
const MAX_BYTES = 1500; // por mensaje
const MAX_POR_SEGUNDO = 30; // los que pasen de aquí se descartan

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = /^\/sala\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (!m) return new Response("Sala de xenxo · conecta por WebSocket a /sala/<nombre>\n", { status: url.pathname === "/" ? 200 : 404 });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("Hace falta WebSocket\n", { status: 426 });
    if (!origenPermitido(req.headers.get("Origin"), env)) return new Response("Origen no permitido\n", { status: 403 });
    return env.SALAS.get(env.SALAS.idFromName(m[1])).fetch(req);
  },
};

function origenPermitido(origen, env) {
  if (!origen) return false;
  let u;
  try {
    u = new URL(origen);
  } catch {
    return false;
  }
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
  return String(env.ORIGENES ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean)
    .includes(u.origin);
}

export class Sala extends DurableObject {
  /** Último estado de cada jugador (en memoria: si la sala hiberna, llega el siguiente enseguida). */
  estados = new Map();

  async fetch() {
    const [cliente, servidor] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(servidor);
    if (this.ctx.getWebSockets().length > MAX_JUGADORES) servidor.close(4001, "sala llena");
    else servidor.serializeAttachment({ jugador: null, seg: 0, n: 0 });
    return new Response(null, { status: 101, webSocket: cliente });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== "string" || data.length > MAX_BYTES) return ws.close(1009, "mensaje demasiado grande");
    const a = ws.deserializeAttachment();
    if (!a) return;
    const seg = Math.floor(Date.now() / 1000);
    if (a.seg !== seg) {
      a.seg = seg;
      a.n = 0;
    }
    a.n++;
    ws.serializeAttachment(a);
    if (a.n > MAX_POR_SEGUNDO) return;

    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (!m || typeof m !== "object") return;

    if (!a.jugador) {
      if (m.t !== "hola") return;
      const jugador = await identificar(m, this.env);
      // Misma persona otra vez (otra pestaña o reconexión): fuera la conexión vieja.
      for (const otro of this.ctx.getWebSockets()) {
        if (otro !== ws && otro.deserializeAttachment()?.jugador?.id === jugador.id) otro.close(4002, "conectado en otro sitio");
      }
      a.jugador = jugador;
      ws.serializeAttachment(a);
      const jugadores = [];
      for (const otro of this.ctx.getWebSockets()) {
        const j = otro !== ws && otro.deserializeAttachment()?.jugador;
        if (j && j.id !== jugador.id) jugadores.push({ ...j, estado: this.estados.get(j.id) ?? null });
      }
      ws.send(JSON.stringify({ t: "bienvenida", yo: jugador, jugadores }));
      this.difundir({ t: "entra", jugador }, ws);
      return;
    }

    const id = a.jugador.id;
    if (m.t === "estado") {
      this.estados.set(id, m.d ?? null);
      this.difundir({ t: "estado", id, d: m.d ?? null }, ws);
    } else if (m.t === "evento") {
      this.difundir({ t: "evento", id, d: m.d ?? null }, ws);
    }
  }

  webSocketClose(ws) {
    this.adios(ws);
  }

  webSocketError(ws) {
    this.adios(ws);
  }

  adios(ws) {
    const j = ws.deserializeAttachment()?.jugador;
    if (!j) return;
    ws.serializeAttachment({ jugador: null, seg: 0, n: 0 });
    // Si la misma persona sigue en otra conexión (se acaba de reconectar), no se va.
    const sigue = this.ctx.getWebSockets().some((o) => o !== ws && o.deserializeAttachment()?.jugador?.id === j.id);
    if (sigue) return;
    this.estados.delete(j.id);
    this.difundir({ t: "sale", id: j.id }, ws);
  }

  difundir(msg, menos) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === menos || !ws.deserializeAttachment()?.jugador) continue;
      try {
        ws.send(s);
      } catch {
        /* se está cerrando */
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Identidad                                                            */
/* ------------------------------------------------------------------ */

function nombreLimpio(v) {
  if (typeof v !== "string") return null;
  const n = v.trim().replace(/\s+/g, " ");
  return n.length >= 1 && n.length <= 40 && !/[\u0000-\u001f<>]/.test(n) ? n : null;
}

async function identificar(m, env) {
  if (typeof m.token === "string" && env.XENXO_CLIENT_ID) {
    const c = await comprobarToken(m.token, env).catch(() => null);
    if (c) {
      const avatar = c.avatar && typeof c.avatar.url === "string" && c.avatar.url.startsWith(`${env.XENXO_EMISOR}/`) ? c.avatar.url : null;
      return { id: `x_${c.sub}`, nombre: nombreLimpio(c.name) ?? "Jugador", numero: typeof c.player_no === "number" ? c.player_no : null, avatar, verificado: true };
    }
  }
  // Invitado: el nombre que diga, sin número ni avatar (no se puede comprobar).
  const id = `i_${crypto.randomUUID().slice(0, 8)}`;
  return { id, nombre: nombreLimpio(m.nombre) ?? `Invitado ${id.slice(2, 6)}`, numero: null, avatar: null, verificado: false };
}

let jwks = null; // { at, keys }

async function clave(kid, env) {
  if (!jwks || Date.now() - jwks.at > 3600_000) {
    const r = await fetch(`${env.XENXO_EMISOR}/.well-known/jwks.json`);
    if (!r.ok) throw new Error("jwks");
    jwks = { at: Date.now(), keys: (await r.json()).keys ?? [] };
  }
  const jwk = jwks.keys.find((k) => k.kid === kid) ?? (jwks.keys.length === 1 ? jwks.keys[0] : null);
  if (!jwk) throw new Error("kid");
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["verify"]);
}

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Comprueba firma (Ed25519), emisor, destinatario (tu juego) y caducidad. Devuelve los datos o null. */
async function comprobarToken(token, env) {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const cabecera = JSON.parse(new TextDecoder().decode(b64url(h)));
  if (cabecera.alg !== "EdDSA") return null;
  const ok = await crypto.subtle.verify({ name: "Ed25519" }, await clave(cabecera.kid, env), b64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const c = JSON.parse(new TextDecoder().decode(b64url(p)));
  if (c.iss !== env.XENXO_EMISOR || c.aud !== env.XENXO_CLIENT_ID || typeof c.exp !== "number" || c.exp * 1000 < Date.now() || !c.sub) return null;
  return c;
}
