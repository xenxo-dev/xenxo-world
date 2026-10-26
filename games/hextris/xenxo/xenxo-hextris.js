/**
 * Hextris en xenxo: «Entrar con xenxo», tu nombre y número, tus récords (uno por jugador, en tu
 * navegador), textos en español e inglés y «Volver a xenxo». Se gira con las flechas, tocando a
 * los lados de la pantalla o, en unas gafas, con el puntero de los mandos (el juego ya lo admite).
 *
 * Este archivo es MIT (compatible con la GPL-3.0 de Hextris, ver LICENSE.md).
 */
import { xenxo } from "./xenxo-sdk.mjs";

const lang = (xenxo.lang || navigator.language || "en").slice(0, 2) === "es" ? "es" : "en";
const T = {
  es: {
    high: "RÉCORD",
    highs: "RÉCORDS",
    over: "FIN DE LA PARTIDA",
    paused: "Pausa",
    start: "Pulsa Intro para empezar",
    tap1: "Toca a la izquierda o a la derecha",
    tap2: "para girar el hexágono",
    keys1: "Flechas izquierda y derecha",
    keys2: "para girar el hexágono",
    match: "¡Junta 3 del mismo color!",
    play: "¡A jugar!",
    enter: "Entrar con xenxo",
    out: "Salir",
    back: "Volver a xenxo",
    player: "Jugador",
    guest: "invitado",
    privacy: "Privacidad",
    help: (mobile) =>
      "<div id='instructions_head'>CÓMO SE JUEGA</div>" +
      "<p>Que ningún bloque salga del hexágono gris de fuera.</p>" +
      `<p>${mobile ? "Toca a la izquierda o a la derecha de la pantalla" : "Usa las flechas izquierda y derecha (o haz clic a cada lado)"} para girar el hexágono.${mobile ? "" : " La flecha abajo acelera la caída."}</p>` +
      "<p>Junta 3 o más bloques del mismo color para que desaparezcan y sumar puntos.</p>" +
      "<p>Las <span style='color:#f1c40f'>líneas</span> <span style='color:#e74c3c'>de</span> <span style='color:#3498db'>colores</span> del hexágono de fuera marcan el tiempo que le queda a tu combo.</p>" +
      "<hr><p id='afterhr'></p>Hextris es de <a href='https://github.com/Hextris/hextris' target='_blank' rel='noopener'>Logan Engstrom y Garrett Finucane</a> (GPL-3.0), adaptado para xenxo.io · <a href='privacidad.html' target='_blank' rel='noopener'>Privacidad</a>",
  },
  en: {
    high: "HIGH SCORE",
    highs: "HIGH SCORES",
    over: "GAME OVER",
    paused: "Game Paused",
    start: "Press enter to start",
    tap1: "Tap the screen's left and right",
    tap2: "sides to rotate the hexagon",
    keys1: "Use the right and left arrow keys",
    keys2: "to rotate the hexagon",
    match: "Match 3+ blocks to score!",
    play: "Play!",
    enter: "Sign in with xenxo",
    out: "Sign out",
    back: "Back to xenxo",
    player: "Player",
    guest: "guest",
    privacy: "Privacy",
    help: (mobile) =>
      "<div id='instructions_head'>HOW TO PLAY</div>" +
      "<p>The goal of Hextris is to stop blocks from leaving the inside of the outer gray hexagon.</p>" +
      `<p>${mobile ? "Tap the left and right sides of the screen" : "Press the right and left arrow keys (or click either side)"} to rotate the hexagon.${mobile ? "" : " Press the down arrow to speed up the falling blocks."}</p>` +
      "<p>Clear blocks and get points by making 3 or more blocks of the same color touch.</p>" +
      "<p>Time left before your combo streak disappears is shown by <span style='color:#f1c40f'>the</span> <span style='color:#e74c3c'>colored</span> <span style='color:#3498db'>lines</span> on the outer hexagon.</p>" +
      "<hr><p id='afterhr'></p>Hextris by <a href='https://github.com/Hextris/hextris' target='_blank' rel='noopener'>Logan Engstrom & Garrett Finucane</a> (GPL-3.0), adapted for xenxo.io · <a href='privacidad.html' target='_blank' rel='noopener'>Privacy</a>",
  },
}[lang];

document.documentElement.lang = lang;
window.xenxoText = { paused: T.paused, start: T.start, tap1: T.tap1, tap2: T.tap2, keys1: T.keys1, keys2: T.keys2, match: T.match, play: T.play };
window.xenxoHelp = (platform) => T.help(platform === "mobile");
for (const el of document.querySelectorAll("[data-x]")) el.textContent = T[el.dataset.x] ?? el.textContent;

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
if (player && !player.guest) window.xenxoKeySuffix = `-${player.id}`;
window.xenxoResolve?.();

/* --- Barra de xenxo, abajo y centrada (arriba están los botones del juego) --- */
const bar = $("div", "xenxo-bar");
// Los clics en la barra no deben girar el hexágono (el juego escucha en todo el documento).
for (const ev of ["mousedown", "touchstart", "pointerdown"]) bar.addEventListener(ev, (e) => e.stopPropagation());
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
document.body.append(bar);
