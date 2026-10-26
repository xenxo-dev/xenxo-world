/**
 * Controles táctiles de HexGL para xenxo (móvil, tablet y el puntero de unas gafas).
 * Botones que se ven: girar a la izquierda y a la derecha (pulgar izquierdo), acelerar y los frenos
 * de aire (pulgar derecho), «auto» para acelerar sin mantener (útil con un solo puntero, como en las
 * gafas) y reiniciar. Cada botón sigue a su propio dedo (eventos de puntero): se puede girar y
 * acelerar a la vez. Por debajo escriben en las mismas teclas que el teclado.
 *
 * Licencia MIT (este archivo). El juego es HexGL, de Thibaut Despoulain: ver LICENSE.
 */
const lang = window.hexglLang === "es" ? "es" : "en";
const T = {
  es: { left: "Girar a la izquierda", right: "Girar a la derecha", gas: "Acelerar", brakeL: "Freno de aire izquierdo", brakeR: "Freno de aire derecho", auto: "Acelerar solo", restart: "Reiniciar",
        help: ["◀ ▶ para girar", "Mantén GAS (o pulsa AUTO)", "Frenos de aire para las curvas cerradas", "Toca para empezar"] },
  en: { left: "Steer left", right: "Steer right", gas: "Accelerate", brakeL: "Left air brake", brakeR: "Right air brake", auto: "Auto accelerate", restart: "Restart",
        help: ["◀ ▶ to steer", "Hold GAS (or tap AUTO)", "Air brakes for tight corners", "Tap to start"] },
}[lang];

const keys = () => window.hexGL?.components?.shipControls?.key ?? null;
let auto = false;

function button(cls, label, text, key) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `xt-btn ${cls}`;
  b.setAttribute("aria-label", label);
  b.textContent = text;
  if (!key) return b;
  const set = (on) => {
    const k = keys();
    if (k) k[key] = on || (key === "forward" && auto);
    b.classList.toggle("xt-on", on);
  };
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    b.setPointerCapture?.(e.pointerId);
    set(true);
  });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(ev, () => set(false));
  b.addEventListener("contextmenu", (e) => e.preventDefault());
  return b;
}

const pad = document.createElement("div");
pad.id = "xenxo-touch";
pad.hidden = true;

const leftPad = document.createElement("div");
leftPad.className = "xt-left";
leftPad.append(button("xt-steer", T.left, "◀", "left"), button("xt-steer", T.right, "▶", "right"));

const rightPad = document.createElement("div");
rightPad.className = "xt-right";
const brakes = document.createElement("div");
brakes.className = "xt-row";
brakes.append(button("xt-small", T.brakeL, "◣", "ltrigger"), button("xt-small", T.brakeR, "◢", "rtrigger"));
const autoBtn = button("xt-small xt-auto", T.auto, "AUTO");
autoBtn.setAttribute("aria-pressed", "false");
autoBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  e.stopPropagation();
  auto = !auto;
  autoBtn.classList.toggle("xt-on", auto);
  autoBtn.setAttribute("aria-pressed", String(auto));
  const k = keys();
  if (k) k.forward = auto;
});
const gasRow = document.createElement("div");
gasRow.className = "xt-row";
gasRow.append(autoBtn, button("xt-gas", T.gas, lang === "es" ? "GAS" : "GAS", "forward"));
rightPad.append(brakes, gasRow);

const restart = button("xt-small xt-restart", T.restart, "↺");
restart.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  e.stopPropagation();
  try {
    window.hexGL?.reset();
  } catch {
    /* aún cargando */
  }
});

pad.append(leftPad, rightPad, restart);
document.body.append(pad);

// Ayuda en la pantalla previa (step-2), en vez de la imagen de los controles antiguos.
const help = document.createElement("div");
help.className = "xt-help";
for (const line of T.help) {
  const p = document.createElement("p");
  p.textContent = line;
  help.append(p);
}
document.getElementById("step-2")?.append(help);

// Solo en carrera y en modo táctil.
const race = document.getElementById("step-4");
setInterval(() => {
  const show = !!window.hexglTouch && race?.style.display === "block";
  if (pad.hidden === show) pad.hidden = !show;
  if (show && auto) {
    const k = keys();
    if (k && !k.forward) k.forward = true;
  }
}, 250);

// Sin zoom ni desplazamiento al tocar durante la carrera.
document.addEventListener(
  "touchmove",
  (e) => {
    if (!pad.hidden) e.preventDefault();
  },
  { passive: false },
);
