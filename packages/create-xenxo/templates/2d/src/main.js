/**
 * {{title}} — juego 2D de la plantilla de xenxo.
 *
 * Tu nombre y tu número de xenxo en una ficha que recoge estrellas: muévete con WASD o las flechas
 * (en el móvil, arrastra el dedo). Un canvas y nada más: cámbialo todo, es tu juego.
 *
 *   src/xenxo-hud.js  → la parte de xenxo (quién juega, entrar, volver)
 *   src/multijugador.js → los demás jugadores (si el juego tiene sala; si no, no aparece nadie)
 *   public/xenxo.json → la ficha del juego para xenxo
 */
import { iniciarMultijugador } from "./multijugador.js";
import { conectar, idioma, marcador, textos } from "./xenxo-hud.js";
import "./estilo.css";

const jugador = await conectar();
const nombre = jugador?.name ?? (idioma === "en" ? "Player" : "Jugador");
const inicial = nombre.trim().charAt(0).toUpperCase() || "?";

const lienzo = document.createElement("canvas");
document.body.append(lienzo);
const ctx = lienzo.getContext("2d");
let W = 0, H = 0;
function medir() {
  const dpr = Math.min(devicePixelRatio, 2);
  W = innerWidth;
  H = innerHeight;
  lienzo.width = W * dpr;
  lienzo.height = H * dpr;
  lienzo.style.width = `${W}px`;
  lienzo.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
medir();
addEventListener("resize", medir);

const yo = { x: innerWidth / 2, y: innerHeight / 2, r: 22 };

// Los demás jugadores (con sala multijugador; sin ella, `otros` siempre está vacío). Las posiciones
// viajan de 0 a 1 para que cuadren aunque cada uno tenga una pantalla distinta.
const sala = iniciarMultijugador({ jugador });
const miEstado = { x: 0.5, y: 0.5 };
const suaves = new Map(); // id → { x, y } en píxeles, suavizado
/**
 * Lo que se lee encima de otro jugador. El número, solo si xenxo lo comprobó (`verificado`); un
 * invitado va siempre marcado como tal (la sala ya le quita los «#»): nadie se hace pasar por otro.
 */
const etiquetaDe = (j) => (j.verificado ? (j.numero !== null && j.numero !== undefined ? `${j.nombre} #${j.numero}` : j.nombre) : `${j.nombre} · ${textos.invitado}`);
const num01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5);
sala.on("sale", (id) => suaves.delete(id));
const ESTRELLAS = 10;
const estrellas = Array.from({ length: ESTRELLAS }, () => ({ x: 40 + Math.random() * (W - 80), y: 90 + Math.random() * (H - 140), viva: true }));
let recogidas = 0;
const pintarMarcador = marcador();
const textoMarcador = () => (idioma === "en" ? `Stars ${recogidas}/${ESTRELLAS}` : `Estrellas ${recogidas}/${ESTRELLAS}`);
pintarMarcador(textoMarcador());

const ayuda = document.createElement("p");
ayuda.className = "ayuda";
ayuda.textContent = idioma === "en" ? "WASD or arrows to move · on mobile, drag" : "WASD o flechas para moverte · en el móvil, arrastra";
document.body.append(ayuda);

const teclas = new Set();
addEventListener("keydown", (e) => teclas.add(e.code));
addEventListener("keyup", (e) => teclas.delete(e.code));
const toque = { activo: false, x0: 0, y0: 0, dx: 0, dy: 0 };
lienzo.addEventListener("pointerdown", (e) => Object.assign(toque, { activo: true, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 }));
addEventListener("pointermove", (e) => {
  if (!toque.activo) return;
  toque.dx = Math.max(-1, Math.min(1, (e.clientX - toque.x0) / 60));
  toque.dy = Math.max(-1, Math.min(1, (e.clientY - toque.y0) / 60));
});
addEventListener("pointerup", () => (toque.activo = false));

function estrella(x, y, r, t) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = t + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

let antes = performance.now();
function bucle(ahora) {
  const dt = Math.min((ahora - antes) / 1000, 0.1);
  antes = ahora;
  let dx = 0, dy = 0;
  if (teclas.has("KeyW") || teclas.has("ArrowUp")) dy -= 1;
  if (teclas.has("KeyS") || teclas.has("ArrowDown")) dy += 1;
  if (teclas.has("KeyA") || teclas.has("ArrowLeft")) dx -= 1;
  if (teclas.has("KeyD") || teclas.has("ArrowRight")) dx += 1;
  if (toque.activo) ((dx = toque.dx), (dy = toque.dy));
  const l = Math.hypot(dx, dy);
  if (l > 0.01) {
    const v = (260 * Math.min(l, 1)) / l;
    yo.x = Math.max(yo.r, Math.min(W - yo.r, yo.x + dx * v * dt));
    yo.y = Math.max(yo.r, Math.min(H - yo.r, yo.y + dy * v * dt));
  }

  // Fondo: noche con cuadrícula de neón.
  ctx.fillStyle = "#12142b";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(79,163,255,0.18)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) (ctx.beginPath(), ctx.moveTo(x, 0), ctx.lineTo(x, H), ctx.stroke());
  for (let y = 0; y < H; y += 40) (ctx.beginPath(), ctx.moveTo(0, y), ctx.lineTo(W, y), ctx.stroke());

  miEstado.x = Math.round((yo.x / W) * 1000) / 1000;
  miEstado.y = Math.round((yo.y / H) * 1000) / 1000;
  sala.enviar(miEstado);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [id, o] of sala.otros) {
    if (!o.estado) continue;
    const tx = num01(o.estado.x) * W, ty = num01(o.estado.y) * H;
    const p = suaves.get(id) ?? { x: tx, y: ty };
    p.x += (tx - p.x) * Math.min(1, dt * 10);
    p.y += (ty - p.y) * Math.min(1, dt * 10);
    suaves.set(id, p);
    const j = o.jugador;
    ctx.fillStyle = j.verificado ? "#b98cff" : "#8a86a6";
    ctx.beginPath();
    ctx.arc(p.x, p.y, yo.r * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#12142b";
    ctx.font = "700 18px system-ui, sans-serif";
    ctx.fillText((j.nombre.trim().charAt(0) || "?").toUpperCase(), p.x, p.y + 1);
    ctx.fillStyle = "#f6f1e7";
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillText(etiquetaDe(j), p.x, p.y - yo.r - 10);
  }

  const t = ahora / 1000;
  ctx.fillStyle = "#ff4fd8";
  for (const e of estrellas) {
    if (!e.viva) continue;
    estrella(e.x, e.y, 12, t);
    if (Math.hypot(e.x - yo.x, e.y - yo.y) < yo.r + 10) {
      e.viva = false;
      recogidas++;
      pintarMarcador(recogidas === ESTRELLAS ? (idioma === "en" ? "All of them! 🎉" : "¡Todas! 🎉") : textoMarcador());
    }
  }

  // La ficha del jugador: su inicial, su nombre y su número de xenxo.
  ctx.shadowColor = "#4fa3ff";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#4fa3ff";
  ctx.beginPath();
  ctx.arc(yo.x, yo.y, yo.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#12142b";
  ctx.font = "700 20px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(inicial, yo.x, yo.y + 1);
  ctx.fillStyle = "#f6f1e7";
  ctx.font = "600 13px system-ui, sans-serif";
  const etiqueta = jugador?.playerNo !== undefined && jugador?.playerNo !== null ? `${nombre} #${jugador.playerNo}` : nombre;
  ctx.fillText(etiqueta, yo.x, yo.y - yo.r - 12);

  requestAnimationFrame(bucle);
}
requestAnimationFrame(bucle);
