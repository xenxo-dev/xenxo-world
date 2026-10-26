/**
 * Multijugador con la sala de `sala/` (un Durable Object en tu cuenta gratuita de Cloudflare).
 *
 *   const sala = iniciarMultijugador({ jugador });
 *   sala.enviar({ x, z });              // tu estado: como mucho 10 veces por segundo, solo si cambia
 *   sala.otros                          // Map id → { jugador, estado }
 *   sala.on("entra", (j) => …)          // también "sale" (id), "evento" ({ id, d }), "conexion" (bool)
 *   sala.evento({ tipo: "saludo" })     // algo que pasa una vez
 *
 * En tu equipo se conecta a `npm run sala` (ws://localhost:8788). Publicada, a VITE_SALA_URL
 * (pon la dirección de `npm run deploy:sala` en `.env.production`, con wss://).
 * La sala elige con `?sala=nombre` en la dirección (por defecto, "principal").
 */
const ENVIO_MS = 100;

function urlSala() {
  const base = import.meta.env.VITE_SALA_URL || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "ws://localhost:8788" : "");
  if (!base) return null;
  const nombre = new URLSearchParams(location.search).get("sala") || "principal";
  return `${base.replace(/\/$/, "")}/sala/${encodeURIComponent(nombre.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "principal")}`;
}

export function iniciarMultijugador({ jugador } = {}) {
  const otros = new Map();
  const oyentes = new Map();
  const avisar = (tipo, dato) => oyentes.get(tipo)?.forEach((fn) => fn(dato));
  const url = urlSala();
  let ws = null;
  let pendiente = null;
  let ultimo = "";
  let espera = 1000;
  const sala = {
    otros,
    conectado: false,
    yo: null,
    enviar(estado) {
      pendiente = estado;
    },
    evento(d) {
      if (ws?.readyState === 1 && sala.yo) ws.send(JSON.stringify({ t: "evento", d }));
    },
    on(tipo, fn) {
      if (!oyentes.has(tipo)) oyentes.set(tipo, new Set());
      oyentes.get(tipo).add(fn);
      return () => oyentes.get(tipo).delete(fn);
    },
  };
  if (!url) {
    console.info("[sala] sin VITE_SALA_URL: el juego va en solitario");
    return sala;
  }

  const abrir = () => {
    ws = new WebSocket(url);
    ws.onopen = () => {
      espera = 1000;
      // Con «Entrar con xenxo», el id_token demuestra quién eres; si no, entras como invitado.
      ws.send(JSON.stringify({ t: "hola", token: jugador?.idToken || undefined, nombre: jugador?.name }));
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === "bienvenida") {
        sala.yo = m.yo;
        sala.conectado = true;
        otros.clear();
        for (const j of m.jugadores) otros.set(j.id, { jugador: j, estado: j.estado });
        ultimo = ""; // que los demás reciban nuestro estado otra vez
        avisar("conexion", true);
        for (const j of m.jugadores) avisar("entra", j);
      } else if (m.t === "entra") {
        otros.set(m.jugador.id, { jugador: m.jugador, estado: null });
        avisar("entra", m.jugador);
      } else if (m.t === "sale") {
        otros.delete(m.id);
        avisar("sale", m.id);
      } else if (m.t === "estado") {
        const o = otros.get(m.id);
        if (o) o.estado = m.d;
      } else if (m.t === "evento") {
        avisar("evento", { id: m.id, d: m.d });
      }
    };
    ws.onclose = (e) => {
      const habia = sala.conectado;
      sala.conectado = false;
      sala.yo = null;
      for (const id of otros.keys()) avisar("sale", id);
      otros.clear();
      if (habia) avisar("conexion", false);
      if (e.code === 4001 || e.code === 4002) return console.info("[sala]", e.reason); // llena u otra pestaña
      setTimeout(abrir, espera);
      espera = Math.min(espera * 2, 15000);
    };
  };
  abrir();

  // Tu estado sale como mucho 10 veces por segundo y solo si ha cambiado.
  setInterval(() => {
    if (!pendiente || ws?.readyState !== 1 || !sala.yo) return;
    const s = JSON.stringify(pendiente);
    if (s === ultimo) return;
    ultimo = s;
    ws.send(`{"t":"estado","d":${s}}`);
  }, ENVIO_MS);

  return sala;
}
