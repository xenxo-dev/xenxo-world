/**
 * HexGL en xenxo: «Entrar con xenxo», tu nombre y número de jugador, tu mejor tiempo y «Volver a
 * xenxo». Lo único que este juego sabe de ti es lo que apruebas en xenxo (nombre y número) y un
 * identificador solo para este juego; todo se queda en tu navegador.
 *
 * Licencia MIT (este archivo). El juego es HexGL, de Thibaut Despoulain: ver LICENSE.
 */
import { xenxo } from "./xenxo-sdk.mjs";

const lang = window.hexglLang === "es" ? "es" : "en";
const T = {
  es: {
    enter: "Entrar con xenxo",
    out: "Salir",
    back: "Volver a xenxo",
    player: "Piloto",
    guest: "invitado",
    best: (n) => `Mejor tiempo de ${n}`,
    record: "¡Nuevo récord!",
    destroyed: "Nave destruida",
    noBest: "Aún sin tiempo: termina las 3 vueltas",
    denied: "No has entrado con xenxo",
    privacy: "Privacidad",
  },
  en: {
    enter: "Sign in with xenxo",
    out: "Sign out",
    back: "Back to xenxo",
    player: "Pilot",
    guest: "guest",
    best: (n) => `${n}'s best time`,
    record: "New record!",
    destroyed: "Ship destroyed",
    noBest: "No time yet: finish all 3 laps",
    denied: "You didn't sign in with xenxo",
    privacy: "Privacy",
  },
}[lang];

const $ = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

async function ficha() {
  try {
    return await (await fetch("xenxo.json", { cache: "no-cache" })).json();
  } catch {
    return {};
  }
}

const f = await ficha();
const clientId = f.xenxo?.clientId || undefined;
let player = null;
try {
  player = await xenxo.connect({ clientId, project: f.xenxo?.project, scopes: ["profile", "player"] });
} catch (e) {
  console.info("[xenxo]", e.message);
}
const canLogin = !!clientId || xenxo.simulated;
const name = player?.name ?? T.player;
const label = player?.playerNo != null ? `${name} #${player.playerNo}` : player?.guest ? `${name} · ${T.guest}` : name;

/* --- Barra de arriba --- */
const bar = $("div", "xenxo-bar");
bar.id = "xenxo-bar";
const chip = $("span", "xenxo-chip");
chip.append($("span", "xenxo-name", name));
if (player?.playerNo != null) chip.append($("span", "xenxo-no", `#${player.playerNo}`));
bar.append(chip);
if (canLogin && (!player || player.guest)) {
  const b = $("button", "xenxo-btn xenxo-primary", T.enter);
  b.onclick = (e) => {
    e.stopPropagation();
    xenxo.login();
  };
  bar.append(b);
} else if (player && !player.guest && !player.simulated) {
  const b = $("button", "xenxo-btn", T.out);
  b.onclick = (e) => {
    e.stopPropagation();
    xenxo.logout();
    location.reload();
  };
  bar.append(b);
}
const back = $("button", "xenxo-btn", T.back);
back.onclick = (e) => {
  e.stopPropagation();
  xenxo.back();
};
bar.append(back);
document.body.append(bar);
if (xenxo.error === "access_denied") {
  const note = $("p", "xenxo-note", T.denied);
  document.body.append(note);
  setTimeout(() => note.remove(), 4000);
}

// Pie con la privacidad, en el menú.
const foot = $("a", "xenxo-foot", T.privacy);
foot.href = "privacidad.html";
foot.target = "_blank";
foot.rel = "noopener";
document.getElementById("step-1")?.append(foot);

// En carrera, la barra se esconde (el HUD del juego va arriba).
const race = document.getElementById("step-4");
setInterval(() => bar.classList.toggle("xenxo-hidden", race?.style.display === "block"), 400);

/* --- Mejor tiempo de cada jugador (en este navegador) --- */
const who = player && !player.guest ? player.id : "local";
const key = (difficulty) => `hexgl-xenxo-best-${who}-${difficulty}`;
const fmt = (ms) => {
  const t = Math.max(0, Math.round(ms));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${m}'${String(s).padStart(2, "0")}''${String(t % 1000).padStart(3, "0")}`;
};
const read = (k) => {
  try {
    const v = Number(localStorage.getItem(k));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};

window.hexglXenxo = {
  finish(ms, finished, difficulty) {
    const k = key(difficulty ?? 0);
    const prev = read(k);
    const better = finished && (prev === null || ms < prev);
    if (better) {
      try {
        localStorage.setItem(k, String(Math.round(ms)));
      } catch {
        /* sin almacenamiento */
      }
    }
    const best = better ? ms : prev;
    const box = $("div", "xenxo-result");
    if (!finished) box.append($("p", "xenxo-sub", T.destroyed));
    if (better) box.append($("p", "xenxo-record", T.record));
    box.append($("p", "xenxo-sub", best !== null ? `${T.best(label)}: ${fmt(best)}` : T.noBest));
    const over = document.getElementById("step-5");
    over?.querySelector(".xenxo-result")?.remove();
    over?.insertBefore(box, over.querySelector("#ctrl-help"));
  },
};
