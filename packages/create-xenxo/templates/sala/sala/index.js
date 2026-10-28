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
 * (y para tu client_id) es `verificado`: entonces nombre, número y avatar son de verdad suyos. Un
 * invitado nunca lleva número y su nombre no puede llevar «#» (no se hace pasar por «nombre #número»).
 *
 * Cierres: 4001 sala llena · 4002 conectado en otro sitio · 4003 no saludó a tiempo ·
 * 4004 demasiadas conexiones desde la misma red.
 */
import { DurableObject } from "cloudflare:workers";

const MAX_JUGADORES = 16; // solo cuentan los que ya saludaron (los que esperan no ocupan sitio)
const MAX_CONEXIONES = 48; // en total, contando las que aún no han saludado
const MAX_POR_IP = 8; // conexiones a la vez desde la misma red (CF-Connecting-IP)
const ESPERA_HOLA_MS = 10_000; // quien no saluda en este tiempo se cierra (al llegar otra conexión)
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

  async fetch(req) {
    const ahora = Date.now();
    const ip = req.headers.get("CF-Connecting-IP") ?? "";
    // Sin temporizadores (la sala hiberna): cada conexión nueva barre las que no saludaron a tiempo.
    let total = 0;
    let deEstaIp = 0;
    for (const otro of this.vivas()) {
      const a = otro.deserializeAttachment();
      // (Quien está saludando tiene más margen: se está comprobando su token.)
      if (!a.jugador && ahora - (a.desde ?? 0) > ESPERA_HOLA_MS * (a.saludando ? 3 : 1)) {
        cerrar(otro, 4003, "no saludó a tiempo");
        continue;
      }
      total++;
      if (ip && a.ip === ip) deEstaIp++;
    }
    const [cliente, servidor] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(servidor);
    servidor.serializeAttachment({ jugador: null, seg: 0, n: 0, desde: ahora, ip });
    if (total >= MAX_CONEXIONES) cerrar(servidor, 4001, "sala llena");
    else if (deEstaIp >= MAX_POR_IP) cerrar(servidor, 4004, "demasiadas conexiones desde tu red");
    return new Response(null, { status: 101, webSocket: cliente });
  }

  /** Las conexiones abiertas (sin las que ya se están cerrando). */
  vivas() {
    return this.ctx.getWebSockets().filter((ws) => {
      const a = ws.deserializeAttachment();
      return a && !a.cerrando;
    });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== "string" || data.length > MAX_BYTES) return ws.close(1009, "mensaje demasiado grande");
    const a = ws.deserializeAttachment();
    if (!a || a.cerrando) return;
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
      if (m.t !== "hola" || a.saludando) return;
      a.saludando = true; // un solo «hola» a la vez (comprobar el token espera a la red)
      ws.serializeAttachment(a);
      const jugador = await identificar(m, this.env);
      // Mientras se comprobaba el token pudo cerrarse o llegar más mensajes: se relee.
      const b = ws.deserializeAttachment();
      if (!b || b.cerrando) return;
      b.saludando = false;
      // Solo ocupan sitio los que ya saludaron; la misma persona en otra conexión no cuenta (la sustituye).
      const dentro = this.vivas().filter((o) => {
        const j = o !== ws && o.deserializeAttachment().jugador;
        return j && j.id !== jugador.id;
      }).length;
      if (dentro >= MAX_JUGADORES) return cerrar(ws, 4001, "sala llena");
      // Misma persona otra vez (otra pestaña o reconexión): fuera la conexión vieja.
      for (const otro of this.vivas()) {
        if (otro !== ws && otro.deserializeAttachment().jugador?.id === jugador.id) cerrar(otro, 4002, "conectado en otro sitio", false);
      }
      b.jugador = jugador;
      ws.serializeAttachment(b);
      const jugadores = [];
      for (const otro of this.vivas()) {
        const j = otro !== ws && otro.deserializeAttachment().jugador;
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
    try {
      ws.serializeAttachment({ jugador: null, seg: 0, n: 0, cerrando: true });
    } catch {
      /* ya cerrada */
    }
    if (!j) return;
    // Si la misma persona sigue en otra conexión (se acaba de reconectar), no se va.
    const sigue = this.vivas().some((o) => o !== ws && o.deserializeAttachment().jugador?.id === j.id);
    if (sigue) return;
    this.estados.delete(j.id);
    this.difundir({ t: "sale", id: j.id }, ws);
  }

  difundir(msg, menos) {
    const s = JSON.stringify(msg);
    for (const ws of this.vivas()) {
      if (ws === menos || !ws.deserializeAttachment().jugador) continue;
      try {
        ws.send(s);
      } catch {
        /* se está cerrando */
      }
    }
  }
}

/**
 * Cierra una conexión y la marca para que no cuente ni reciba nada más. Si era de alguien, avisa a
 * los demás de que se fue (salvo `avisar = false`: la misma persona sigue en otra conexión).
 */
function cerrar(ws, codigo, motivo, avisar = true) {
  const a = ws.deserializeAttachment() ?? {};
  try {
    ws.serializeAttachment({ ...a, jugador: avisar ? a.jugador : null, cerrando: true });
    ws.close(codigo, motivo);
  } catch {
    /* ya cerrada */
  }
}

/* ------------------------------------------------------------------ */
/* Identidad                                                            */
/* ------------------------------------------------------------------ */

// Controles, separadores invisibles y de dirección del texto (con ellos un nombre se ve como otro).
const INVISIBLES = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;
// «#» y sus parecidos: un invitado no puede escribir algo que parezca «nombre #número».
const ALMOHADILLAS = /[#\uff03\ufe5f\u266f]/g;

function nombreLimpio(v, invitado = false) {
  if (typeof v !== "string") return null;
  let n = v.replace(INVISIBLES, "");
  if (invitado) n = n.replace(ALMOHADILLAS, "");
  n = n.trim().replace(/\s+/g, " ");
  return n.length >= 1 && n.length <= 40 && !/[<>]/.test(n) ? n : null;
}

async function identificar(m, env) {
  if (typeof m.token === "string" && env.XENXO_CLIENT_ID) {
    const c = await comprobarToken(m.token, env).catch(() => null);
    if (c) {
      const avatar = c.avatar && typeof c.avatar.url === "string" && c.avatar.url.startsWith(`${env.XENXO_EMISOR}/`) ? c.avatar.url : null;
      return { id: `x_${c.sub}`, nombre: nombreLimpio(c.name) ?? "Jugador", numero: typeof c.player_no === "number" ? c.player_no : null, avatar, verificado: true };
    }
  }
  // Invitado: el nombre que diga (sin «#»), sin número ni avatar (no se puede comprobar). Los
  // clientes lo enseñan siempre marcado como invitado; sin nombre, un código corto.
  const id = `i_${crypto.randomUUID().slice(0, 8)}`;
  return { id, nombre: nombreLimpio(m.nombre, true) ?? id.slice(2, 6), numero: null, avatar: null, verificado: false };
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
