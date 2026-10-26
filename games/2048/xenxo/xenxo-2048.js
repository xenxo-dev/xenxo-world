/**
 * 2048 en xenxo: «Entrar con xenxo», tu nombre y número, tu récord (uno por jugador, en tu
 * navegador), textos en español e inglés, «Volver a xenxo» y flechas en pantalla para móvil y para
 * el puntero de unas gafas (además del deslizar de siempre).
 *
 * Licencia MIT (este archivo). El juego es 2048, de Gabriele Cirulli (MIT): ver LICENSE.txt.
 */
import { xenxo } from "./xenxo-sdk.mjs";

const lang = (xenxo.lang || navigator.language || "en").slice(0, 2) === "es" ? "es" : "en";
const T = {
  es: {
    intro: "Junta los números y llega a la ficha <strong>2048</strong>.",
    newGame: "Nueva partida",
    keep: "Seguir",
    retry: "Otra vez",
    how: "<strong class=\"important\">Cómo se juega:</strong> mueve las fichas con las <strong>flechas</strong> (o deslizando el dedo). Cuando dos fichas con el mismo número se tocan, <strong>se juntan en una</strong>.",
    credits: "2048 es de <a href=\"https://github.com/gabrielecirulli/2048\" target=\"_blank\" rel=\"noopener\">Gabriele Cirulli</a> (MIT), basado en 1024 de Veewo Studio y parecido a Threes de Asher Vollmer. Adaptado para xenxo.io · <a href=\"privacidad.html\" target=\"_blank\" rel=\"noopener\">Privacidad</a>",
    win: "¡Has ganado!",
    over: "¡Fin de la partida!",
    score: "Puntos",
    best: "Récord",
    enter: "Entrar con xenxo",
    out: "Salir",
    back: "Volver a xenxo",
    player: "Jugador",
    guest: "invitado",
    up: "Arriba",
    down: "Abajo",
    left: "Izquierda",
    right: "Derecha",
  },
  en: {
    intro: "Join the numbers and get to the <strong>2048 tile!</strong>",
    newGame: "New Game",
    keep: "Keep going",
    retry: "Try again",
    how: "<strong class=\"important\">How to play:</strong> use your <strong>arrow keys</strong> (or swipe) to move the tiles. When two tiles with the same number touch, they <strong>merge into one!</strong>",
    credits: "2048 by <a href=\"https://github.com/gabrielecirulli/2048\" target=\"_blank\" rel=\"noopener\">Gabriele Cirulli</a> (MIT), based on 1024 by Veewo Studio and conceptually similar to Threes by Asher Vollmer. Adapted for xenxo.io · <a href=\"privacidad.html\" target=\"_blank\" rel=\"noopener\">Privacy</a>",
    win: "You win!",
    over: "Game over!",
    score: "Score",
    best: "Best",
    enter: "Sign in with xenxo",
    out: "Sign out",
    back: "Back to xenxo",
    player: "Player",
    guest: "guest",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
  },
}[lang];

document.documentElement.lang = lang;
window.xenxoText = { win: T.win, over: T.over };
for (const el of document.querySelectorAll("[data-x]")) el.innerHTML = T[el.dataset.x] ?? el.innerHTML;
document.documentElement.style.setProperty("--x-score", JSON.stringify(T.score));
document.documentElement.style.setProperty("--x-best", JSON.stringify(T.best));

const $ = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

let ficha = {};
try {
  ficha = await (await fetch("xenxo.json", { cache: "no-cache" })).json();
} catch {
  /* sin ficha: se juega igual */
}
const clientId = ficha.xenxo?.clientId || undefined;
let player = null;
try {
  player = await xenxo.connect({ clientId, project: ficha.xenxo?.project, scopes: ["profile", "player"] });
} catch (e) {
  console.info("[xenxo]", e.message);
}

// Récord y partida guardada de cada jugador (los invitados y sin cuenta comparten los de siempre).
if (player && !player.guest) window.xenxoKeySuffix = `-${player.id}`;
window.xenxoResolve?.();

/* --- Barra de xenxo --- */
const bar = $("div", "xenxo-bar");
const chip = $("span", "xenxo-chip", player?.name ?? T.player);
if (player?.playerNo != null) chip.append($("span", "xenxo-no", `#${player.playerNo}`));
else if (player?.guest) chip.append($("span", "xenxo-dim", ` · ${T.guest}`));
bar.append(chip);
if ((clientId || xenxo.simulated) && (!player || player.guest)) {
  const b = $("button", "xenxo-btn xenxo-primary", T.enter);
  b.onclick = () => xenxo.login();
  bar.append(b);
} else if (player && !player.guest && !player.simulated) {
  const b = $("button", "xenxo-btn", T.out);
  b.onclick = () => {
    xenxo.logout();
    location.reload();
  };
  bar.append(b);
}
const back = $("button", "xenxo-btn", T.back);
back.onclick = () => xenxo.back();
bar.append(back);
document.querySelector(".container")?.prepend(bar);

/* --- Flechas en pantalla y deslizar con cualquier puntero (ratón o mandos de unas gafas) --- */
const DIRS = [
  ["up", 0, "▲"],
  ["left", 3, "◀"],
  ["down", 2, "▼"],
  ["right", 1, "▶"],
];
const move = (d) => window.gameManager?.inputManager.emit("move", d);
const pad = document.getElementById("xenxo-pad");
if (pad) {
  for (const [name, d, glyph] of DIRS) {
    const b = $("button", `xenxo-arrow xenxo-${name}`, glyph);
    b.type = "button";
    b.setAttribute("aria-label", T[name]);
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      move(d);
    });
    pad.append(b);
  }
  const portable = matchMedia("(pointer: coarse)").matches || /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);
  pad.hidden = !portable;
}

// El juego ya desliza con el dedo (touch). Esto añade lo mismo con ratón o con el puntero de unas
// gafas, que no generan eventos táctiles.
const board = document.querySelector(".game-container");
let start = null;
board?.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") return;
  start = { x: e.clientX, y: e.clientY };
});
addEventListener("pointerup", (e) => {
  if (!start || e.pointerType === "touch") return;
  const dx = e.clientX - start.x;
  const dy = e.clientY - start.y;
  start = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
  move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
});
