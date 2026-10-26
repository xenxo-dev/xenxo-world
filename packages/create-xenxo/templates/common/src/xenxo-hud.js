/**
 * La parte de xenxo del juego: quién juega (o un jugador de prueba en tu equipo), su nombre y su
 * número en pantalla, «Entrar con xenxo» y «Volver a xenxo». Los datos del juego salen de
 * public/xenxo.json (ahí pones el client_id y el proyecto que te da xenxo al registrarlo).
 *
 * Sin xenxo alrededor el juego sigue funcionando: si algo falla, se juega como «Jugador».
 */
import { xenxo } from "@xenxo/sdk";

const TEXTOS = {
  es: { entrar: "Entrar con xenxo", volver: "Volver a xenxo", salir: "Salir", invitado: "Invitado", jugador: "Jugador", noEntro: "No has entrado con xenxo" },
  en: { entrar: "Sign in with xenxo", volver: "Back to xenxo", salir: "Sign out", invitado: "Guest", jugador: "Player", noEntro: "You didn't sign in with xenxo" },
};

export const idioma = xenxo.lang === "en" ? "en" : "es";
export const textos = TEXTOS[idioma];

/** Lee la ficha del juego (public/xenxo.json). */
async function ficha() {
  try {
    return await (await fetch(`${import.meta.env.BASE_URL}xenxo.json`)).json();
  } catch {
    return {};
  }
}

/**
 * Conecta con xenxo y pinta la barra de arriba. Devuelve el jugador (o null si no ha entrado):
 * { id, name, playerNo, avatar: { url, format }, guest, simulated }.
 */
export async function conectar() {
  const f = await ficha();
  const clientId = f.xenxo?.clientId;
  let jugador = null;
  let puedeEntrar = false;
  try {
    jugador = await xenxo.connect({ clientId, project: f.xenxo?.project, scopes: ["profile", "player", "avatar"] });
    puedeEntrar = xenxo.simulated || !!clientId;
  } catch (e) {
    // Fuera de tu equipo y sin client_id: el juego funciona igual, sin cuentas.
    console.info("[xenxo]", e.message);
  }
  pintarBarra(jugador, puedeEntrar);
  return jugador;
}

function pintarBarra(jugador, puedeEntrar) {
  const barra = document.createElement("div");
  barra.className = "hud";
  const quien = document.createElement("span");
  quien.className = "chip";
  quien.textContent = jugador?.name ?? textos.jugador;
  if (jugador?.playerNo !== undefined && jugador?.playerNo !== null) {
    const n = document.createElement("span");
    n.className = "numero";
    n.textContent = `#${jugador.playerNo}`;
    quien.append(n);
  } else if (jugador?.guest) {
    quien.title = textos.invitado;
  }
  barra.append(quien);

  if (!jugador && puedeEntrar) barra.append(boton(textos.entrar, () => xenxo.login(), "principal"));
  if (jugador && !jugador.guest) barra.append(boton(textos.salir, () => (xenxo.logout(), location.reload())));
  if (!jugador && xenxo.error) console.info("[xenxo]", textos.noEntro, xenxo.error);

  const volver = boton(textos.volver, () => xenxo.back());
  volver.classList.add("derecha");
  barra.append(volver);
  document.body.append(barra);
}

function boton(texto, onClick, clase = "") {
  const b = document.createElement("button");
  b.textContent = texto;
  if (clase) b.className = clase;
  b.addEventListener("click", onClick);
  return b;
}

/** Marcador sencillo (abajo a la derecha de la barra). */
export function marcador() {
  const el = document.createElement("span");
  el.className = "chip";
  document.querySelector(".hud")?.insertBefore(el, document.querySelector(".hud .derecha"));
  return (texto) => (el.textContent = texto);
}
