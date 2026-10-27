/**
 * Núcleo: piratea la puerta del núcleo de Distrito Cero.
 *
 * Una matriz de códigos y tres cerraduras, cada una con su secuencia. Se elige un código de la
 * fila marcada; después, uno de su columna; después, de su fila… Lo elegido va a la memoria y, si
 * en ella aparece la secuencia de una cerradura, esa cerradura se abre. Con las tres abiertas, la
 * puerta se abre y se pasa al siguiente nivel. Siempre hay solución: la matriz sale de un camino
 * válido.
 *
 * Con «Entrar con xenxo» se ve tu nombre y tu número y el récord es tuyo (en tu navegador).
 * Licencia MIT (ver LICENSE). Hecho para xenxo.io como juego de ejemplo del SDK.
 */
import { xenxo } from "./xenxo/xenxo-sdk.mjs";

/* ------------------------------------------------------------------ */
/* Textos                                                               */
/* ------------------------------------------------------------------ */

const lang = (xenxo.lang || navigator.language || "en").slice(0, 2) === "es" ? "es" : "en";
const TEXT = {
  es: {
    sub: "Distrito Cero · acceso restringido",
    level: "Nivel",
    time: "Tiempo",
    score: "Puntos",
    best: "Récord",
    matrix: "Matriz de códigos",
    locks: "Cerraduras",
    buffer: "Memoria",
    hintStart: "Empieza por cualquier código de la fila marcada.",
    hintRow: "Ahora, un código de la fila marcada.",
    hintCol: "Ahora, un código de la columna marcada.",
    credits: "Un juego de ejemplo de xenxo.io (MIT).",
    privacy: "Privacidad",
    soundOn: "Sonido: sí",
    soundOff: "Sonido: no",
    lockN: (n) => `C${n}`,
    open: "abierta",
    closed: "cerrada",
    lost: "perdida",
    introTitle: "NÚCLEO",
    intro: `<p>La puerta del núcleo de Distrito Cero tiene <b>tres cerraduras</b>. Ábrelas todas.</p>
      <ol>
        <li>Elige un código de la <b>fila marcada</b>. Después, uno de <b>su columna</b>; después, de <b>su fila</b>… siempre alternando.</li>
        <li>Cada código va a la <b>memoria</b>. Si en ella aparece la secuencia de una cerradura, <b>se abre</b>.</li>
        <li>Ábrelas antes de que se llene la memoria o se acabe el tiempo (cuenta desde el primer código).</li>
      </ol>
      <p class="dim">Teclado: flechas y Intro. También con el dedo o el puntero de unas gafas.</p>`,
    start: "Empezar",
    winTitle: "ACCESO CONCEDIDO",
    win: (lvl, pts) => `<p>Nivel ${lvl} superado.</p><p class="big">+${pts}</p>`,
    next: "Siguiente nivel",
    failTitle: "ACCESO DENEGADO",
    failTime: "Se acabó el tiempo.",
    failBuffer: "La memoria está llena.",
    failStuck: "No quedan códigos en esa línea.",
    failDead: "Una de las secuencias ya no cabe en la memoria.",
    fail: (why, pts, best) => `<p>${why}</p><p>Puntos: <span class="big">${pts}</span></p>${best ? "<p>¡Nuevo récord!</p>" : ""}`,
    again: "Otra vez",
    enter: "Entrar con xenxo",
    out: "Salir",
    back: "Volver a xenxo",
    player: "Jugador",
    guest: "invitado",
  },
  en: {
    sub: "District Zero · restricted access",
    level: "Level",
    time: "Time",
    score: "Score",
    best: "Best",
    matrix: "Code matrix",
    locks: "Locks",
    buffer: "Buffer",
    hintStart: "Start with any code in the highlighted row.",
    hintRow: "Now pick a code in the highlighted row.",
    hintCol: "Now pick a code in the highlighted column.",
    credits: "A sample game by xenxo.io (MIT).",
    privacy: "Privacy",
    soundOn: "Sound: on",
    soundOff: "Sound: off",
    lockN: (n) => `L${n}`,
    open: "open",
    closed: "locked",
    lost: "lost",
    introTitle: "CORE",
    intro: `<p>The core door of District Zero has <b>three locks</b>. Open them all.</p>
      <ol>
        <li>Pick a code in the <b>highlighted row</b>. Then one in <b>its column</b>; then in <b>its row</b>… always alternating.</li>
        <li>Every code goes into the <b>buffer</b>. When a lock's sequence shows up in it, that lock <b>opens</b>.</li>
        <li>Open them before the buffer fills up or time runs out (the clock starts with your first code).</li>
      </ol>
      <p class="dim">Keyboard: arrows and Enter. Touch and headset pointers work too.</p>`,
    start: "Start",
    winTitle: "ACCESS GRANTED",
    win: (lvl, pts) => `<p>Level ${lvl} cleared.</p><p class="big">+${pts}</p>`,
    next: "Next level",
    failTitle: "ACCESS DENIED",
    failTime: "Time's up.",
    failBuffer: "The buffer is full.",
    failStuck: "No codes left on that line.",
    failDead: "One of the sequences no longer fits in the buffer.",
    fail: (why, pts, best) => `<p>${why}</p><p>Score: <span class="big">${pts}</span></p>${best ? "<p>New best!</p>" : ""}`,
    again: "Play again",
    enter: "Sign in with xenxo",
    out: "Sign out",
    back: "Back to xenxo",
    player: "Player",
    guest: "guest",
  },
}[lang];

document.documentElement.lang = lang;
if (lang === "en") document.querySelector(".title").textContent = "CORE";
for (const el of document.querySelectorAll("[data-t]")) {
  const v = TEXT[el.dataset.t];
  if (typeof v === "string") el.textContent = v;
}

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/* ------------------------------------------------------------------ */
/* xenxo: quién juega                                                   */
/* ------------------------------------------------------------------ */

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
const BEST_KEY = `nucleo-best${player && !player.guest ? `-${player.id}` : ""}`;

const bar = $("#xenxo-bar");
const chip = el("span", "chip", player?.name ?? TEXT.player);
if (player?.playerNo != null) chip.append(el("span", "no", `#${player.playerNo}`));
else if (player?.guest) chip.append(el("span", "dim", ` · ${TEXT.guest}`));
bar.append(chip);
if ((clientId || xenxo.simulated) && (!player || player.guest)) {
  const b = el("button", "btn primary", TEXT.enter);
  b.type = "button";
  b.onclick = () => xenxo.login();
  bar.append(b);
} else if (player && !player.guest && !player.simulated) {
  const b = el("button", "btn", TEXT.out);
  b.type = "button";
  b.onclick = () => {
    xenxo.logout();
    location.reload();
  };
  bar.append(b);
}
const back = el("button", "btn ghost", TEXT.back);
back.type = "button";
back.onclick = () => xenxo.back();
bar.append(back);

/* ------------------------------------------------------------------ */
/* Sonido (sintetizado: sin archivos)                                   */
/* ------------------------------------------------------------------ */

let soundOn = true;
try {
  soundOn = localStorage.getItem("nucleo-sound") !== "0";
} catch {
  /* sin almacenamiento */
}
let ac = null;
function tone(freq, dur = 0.08, type = "square", vol = 0.05, when = 0) {
  if (!soundOn) return;
  try {
    ac ??= new AudioContext();
    const t = ac.currentTime + when;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch {
    /* sin audio */
  }
}
const sfx = {
  pick: () => tone(660, 0.05, "square", 0.04),
  lock: () => [523, 659, 784].forEach((f, i) => tone(f, 0.12, "triangle", 0.06, i * 0.07)),
  open: () => [262, 392, 523, 784, 1046].forEach((f, i) => tone(f, 0.22, "sawtooth", 0.035, i * 0.09)),
  fail: () => [220, 165, 110].forEach((f, i) => tone(f, 0.2, "sawtooth", 0.05, i * 0.12)),
  tick: () => tone(1200, 0.02, "square", 0.02),
};
const soundBtn = $("#sound");
const paintSound = () => (soundBtn.textContent = soundOn ? TEXT.soundOn : TEXT.soundOff);
paintSound();
soundBtn.onclick = () => {
  soundOn = !soundOn;
  try {
    localStorage.setItem("nucleo-sound", soundOn ? "1" : "0");
  } catch {
    /* sin almacenamiento */
  }
  paintSound();
};

/* ------------------------------------------------------------------ */
/* Nivel                                                                */
/* ------------------------------------------------------------------ */

const CODES = ["1C", "55", "BD", "E9", "7A", "FF"];
const rnd = (n) => Math.floor(Math.random() * n);

/** Dificultad de cada nivel: lado de la matriz, memoria, largo de las secuencias y segundos. */
function config(level) {
  const size = level <= 2 ? 5 : level <= 5 ? 6 : 7;
  const lens = level <= 2 ? [2, 3, 3] : level <= 4 ? [2, 3, 4] : [3, 3, 4];
  const cap = level <= 2 ? 6 : level <= 4 ? 7 : 8;
  const seconds = Math.max(22, 50 - (level - 1) * 4);
  return { size, lens, cap, seconds, help: level <= 2 };
}

/** Un camino válido (fila 0, su columna, su fila…) de `len` celdas distintas. */
function randomPath(size, len) {
  for (let tries = 0; tries < 200; tries++) {
    const path = [];
    const used = new Set();
    let r = 0, c = rnd(size);
    path.push([r, c]);
    used.add(r * size + c);
    let ok = true;
    for (let k = 1; k < len && ok; k++) {
      const byRow = k % 2 === 0;
      const options = [];
      for (let i = 0; i < size; i++) {
        const [rr, cc] = byRow ? [r, i] : [i, c];
        if (!used.has(rr * size + cc)) options.push([rr, cc]);
      }
      if (!options.length) ok = false;
      else {
        [r, c] = options[rnd(options.length)];
        path.push([r, c]);
        used.add(r * size + c);
      }
    }
    if (ok) return path;
  }
  throw new Error("sin camino");
}

function makeLevel(level) {
  const cfg = config(level);
  for (;;) {
    const grid = Array.from({ length: cfg.size }, () => Array.from({ length: cfg.size }, () => CODES[rnd(CODES.length)]));
    const path = randomPath(cfg.size, cfg.cap);
    const codes = path.map(([r, c]) => grid[r][c]);
    // Las secuencias son trozos del camino: siempre hay una solución que las abre todas.
    const seqs = cfg.lens.map((len) => {
      const at = rnd(cfg.cap - len + 1);
      return codes.slice(at, at + len);
    });
    const keys = seqs.map((s) => s.join(" "));
    if (new Set(keys).size !== keys.length) continue;
    // Que ninguna esté ya dentro de otra (sería regalada).
    if (keys.some((a, i) => keys.some((b, j) => i !== j && b.includes(a)))) continue;
    seqs.sort(() => Math.random() - 0.5);
    return { cfg, grid, seqs: seqs.map((codes) => ({ codes, done: false, dead: false })) };
  }
}

/* ------------------------------------------------------------------ */
/* Partida                                                              */
/* ------------------------------------------------------------------ */

const S = {
  level: 1,
  score: 0,
  best: 0,
  lv: null,
  picks: [],
  used: new Set(),
  axis: "row", // dónde se elige ahora: en una fila o en una columna
  line: 0,
  cursor: 0,
  deadline: 0,
  running: false,
  timer: 0,
};
try {
  S.best = Number(localStorage.getItem(BEST_KEY) || 0);
} catch {
  /* sin almacenamiento */
}

const matrixEl = $("#matrix");
const seqsEl = $("#seqs");
const bufferEl = $("#buffer");
const hintEl = $("#hint");
const doorEl = $("#door");

function startLevel() {
  S.lv = makeLevel(S.level);
  S.picks = [];
  S.used = new Set();
  S.axis = "row";
  S.line = 0;
  S.cursor = 0;
  S.deadline = 0;
  S.running = true;
  doorEl.classList.remove("open");
  render();
}

function buffer() {
  return S.picks.map(([r, c]) => S.lv.grid[r][c]);
}

/** ¿Está `seq` dentro de `buf` (seguida)? */
function contains(buf, seq) {
  for (let i = 0; i + seq.length <= buf.length; i++) if (seq.every((x, k) => buf[i + k] === x)) return true;
  return false;
}

/** Cuánto del principio de `seq` ya está al final de la memoria. */
function progress(buf, seq) {
  for (let k = Math.min(seq.length - 1, buf.length); k > 0; k--) {
    if (seq.slice(0, k).every((x, i) => buf[buf.length - k + i] === x)) return k;
  }
  return 0;
}

function lineCells() {
  const n = S.lv.cfg.size;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [r, c] = S.axis === "row" ? [S.line, i] : [i, S.line];
    if (!S.used.has(r * n + c)) out.push([r, c]);
  }
  return out;
}

function pick(r, c) {
  if (!S.running) return;
  const n = S.lv.cfg.size;
  const inLine = S.axis === "row" ? r === S.line : c === S.line;
  if (!inLine || S.used.has(r * n + c)) return;
  if (!S.deadline) S.deadline = performance.now() + S.lv.cfg.seconds * 1000;
  S.picks.push([r, c]);
  S.used.add(r * n + c);
  S.axis = S.axis === "row" ? "col" : "row";
  S.line = S.axis === "row" ? r : c;
  S.cursor = 0;
  sfx.pick();
  const buf = buffer();
  const left = S.lv.cfg.cap - buf.length;
  for (const [i, s] of S.lv.seqs.entries()) {
    if (s.done || s.dead) continue;
    if (contains(buf, s.codes)) {
      s.done = true;
      S.score += 100 * S.level;
      sfx.lock();
      flashLock(i);
    } else if (s.codes.length - progress(buf, s.codes) > left) s.dead = true;
  }
  render();
  if (S.lv.seqs.every((s) => s.done)) return win();
  if (S.lv.seqs.some((s) => s.dead)) return fail(TEXT.failDead);
  if (left <= 0) return fail(TEXT.failBuffer);
  if (!lineCells().length) return fail(TEXT.failStuck);
}

function flashLock(i) {
  const lock = doorEl.querySelector(`.lock[data-i="${i}"]`);
  lock?.classList.add("on");
}

function secondsLeft() {
  return S.deadline ? Math.max(0, (S.deadline - performance.now()) / 1000) : S.lv.cfg.seconds;
}

function win() {
  S.running = false;
  const bonus = 250 * S.level + Math.round(secondsLeft()) * 10;
  S.score += bonus;
  doorEl.classList.add("open");
  sfx.open();
  render();
  setTimeout(() => {
    overlay(TEXT.winTitle, "good", TEXT.win(S.level, bonus + 300 * S.level), TEXT.next, () => {
      S.level++;
      startLevel();
    });
  }, 1200);
}

function fail(why) {
  if (!S.running) return;
  S.running = false;
  sfx.fail();
  document.querySelector(".board").classList.add("flash-bad");
  setTimeout(() => document.querySelector(".board").classList.remove("flash-bad"), 400);
  const isBest = S.score > S.best;
  if (isBest) {
    S.best = S.score;
    try {
      localStorage.setItem(BEST_KEY, String(S.best));
    } catch {
      /* sin almacenamiento */
    }
  }
  render();
  setTimeout(() => {
    overlay(TEXT.failTitle, "bad", TEXT.fail(why, S.score, isBest && S.score > 0), TEXT.again, () => {
      S.level = 1;
      S.score = 0;
      startLevel();
    });
  }, 700);
}

/* ------------------------------------------------------------------ */
/* Pintar                                                               */
/* ------------------------------------------------------------------ */

function render() {
  const { cfg, grid, seqs } = S.lv;
  const n = cfg.size;
  $("#level").textContent = String(S.level);
  $("#score").textContent = String(S.score);
  $("#best").textContent = String(Math.max(S.best, S.score));

  // Matriz
  matrixEl.style.setProperty("--n", String(n));
  matrixEl.replaceChildren();
  const buf = buffer();
  const line = S.running ? lineCells() : [];
  const lineSet = new Set(line.map(([r, c]) => r * n + c));
  // Ayuda en los primeros niveles: qué códigos harían avanzar alguna cerradura.
  const wanted = new Set();
  if (cfg.help) for (const s of seqs) if (!s.done && !s.dead) wanted.add(s.codes[progress(buf, s.codes)]);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const k = r * n + c;
      const b = el("button", "cell", S.used.has(k) ? "" : grid[r][c]);
      b.type = "button";
      b.setAttribute("role", "gridcell");
      if (S.used.has(k)) b.classList.add("used");
      else if (lineSet.has(k)) {
        b.classList.add("line");
        if (wanted.has(grid[r][c])) b.classList.add("match");
        if (line[S.cursor % line.length]?.[0] === r && line[S.cursor % line.length]?.[1] === c) b.classList.add("cursor");
      } else b.disabled = true;
      b.addEventListener("click", () => pick(r, c));
      matrixEl.append(b);
    }
  }
  hintEl.textContent = !S.picks.length ? TEXT.hintStart : S.axis === "row" ? TEXT.hintRow : TEXT.hintCol;

  // Cerraduras
  seqsEl.replaceChildren();
  for (const [i, s] of seqs.entries()) {
    const li = el("li", `seq${s.done ? " done" : ""}${s.dead ? " dead" : ""}`);
    li.append(el("span", "n", TEXT.lockN(i + 1)));
    const p = s.done ? s.codes.length : progress(buf, s.codes);
    for (const [k, code] of s.codes.entries()) li.append(el("span", `code${!s.done && k < p ? " hit" : ""}`, code));
    li.append(el("span", "tag", s.done ? TEXT.open : s.dead ? TEXT.lost : TEXT.closed));
    seqsEl.append(li);
    doorEl.querySelector(`.lock[data-i="${i}"]`)?.classList.toggle("on", s.done);
    doorEl.querySelector(`.lock[data-i="${i}"]`)?.classList.toggle("dead", s.dead);
  }

  // Memoria
  bufferEl.replaceChildren();
  for (let k = 0; k < cfg.cap; k++) bufferEl.append(el("span", `slot${k < buf.length ? " full" : ""}`, buf[k] ?? ""));
  paintTime();
}

let lastWhole = -1;
function paintTime() {
  const left = secondsLeft();
  $("#time").textContent = left.toFixed(1);
  $("#timebar").style.transform = `scaleX(${left / S.lv.cfg.seconds})`;
  document.querySelector(".timer").classList.toggle("low", !!S.deadline && left < 8);
  const whole = Math.ceil(left);
  if (S.deadline && S.running && left < 6 && whole !== lastWhole) sfx.tick();
  lastWhole = whole;
}

function loop() {
  if (S.lv && S.running && S.deadline) {
    paintTime();
    if (secondsLeft() <= 0) fail(TEXT.failTime);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ------------------------------------------------------------------ */
/* Teclado                                                              */
/* ------------------------------------------------------------------ */

addEventListener("keydown", (e) => {
  if (!$("#overlay").hidden) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      $("#ov-go").click();
    }
    return;
  }
  if (!S.running) return;
  const line = lineCells();
  if (!line.length) return;
  const prev = ["ArrowLeft", "ArrowUp"].includes(e.key);
  const next = ["ArrowRight", "ArrowDown"].includes(e.key);
  if (prev || next) {
    e.preventDefault();
    S.cursor = (S.cursor + (next ? 1 : line.length - 1)) % line.length;
    render();
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    const [r, c] = line[S.cursor % line.length];
    pick(r, c);
  }
});

/* ------------------------------------------------------------------ */
/* Pantallas                                                            */
/* ------------------------------------------------------------------ */

function overlay(title, tone, html, action, onGo) {
  const t = $("#ov-title");
  t.textContent = title;
  t.className = `ov-title${tone ? ` ${tone}` : ""}`;
  $("#ov-body").innerHTML = html;
  const go = $("#ov-go");
  go.textContent = action;
  go.onclick = () => {
    $("#overlay").hidden = true;
    onGo();
  };
  $("#overlay").hidden = false;
  go.focus();
}

startLevel();
S.running = false;
overlay(TEXT.introTitle, "", TEXT.intro, TEXT.start, () => {
  S.running = true;
  render();
});
