/**
 * {{title}} — juego 3D de la plantilla de xenxo.
 *
 * Tu personaje de xenxo (su VRM) en una explanada de neón: muévete con WASD o las flechas (en el
 * móvil, arrastra el dedo) y recoge los orbes. Cámbialo todo: es tu juego.
 *
 *   src/xenxo-hud.js  → la parte de xenxo (quién juega, entrar, volver)
 *   src/avatar.js     → carga el VRM del jugador y lo anima sin archivos de animación
 *   public/xenxo.json → la ficha del juego para xenxo
 */
import * as THREE from "three";
import { cargarAvatar } from "./avatar.js";
import { conectar, idioma, marcador } from "./xenxo-hud.js";
import "./estilo.css";

const jugador = await conectar();

/* --- Escena --- */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); // en gafas y móviles, no más de 2
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#12142b");
scene.fog = new THREE.Fog("#12142b", 18, 60);
scene.add(new THREE.HemisphereLight("#cfe8ff", "#1a1030", 1.2));
const sol = new THREE.DirectionalLight("#ffffff", 1.6);
sol.position.set(-4, 8, -6);
scene.add(sol);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);

// Suelo con cuadrícula de neón (una sola malla y una sola rejilla: pocas llamadas de dibujo).
const suelo = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: "#161a3a", roughness: 0.9 }));
suelo.rotation.x = -Math.PI / 2;
scene.add(suelo);
const rejilla = new THREE.GridHelper(80, 40, "#4fa3ff", "#2a2f66");
rejilla.position.y = 0.01;
scene.add(rejilla);

/* --- El jugador --- */
const yo = await cargarAvatar(jugador?.avatar?.url);
scene.add(yo.object);

/* --- Orbes para recoger (una geometría y un material compartidos) --- */
const ORBES = 12;
const geoOrbe = new THREE.IcosahedronGeometry(0.35, 1);
const matOrbe = new THREE.MeshBasicMaterial({ color: "#ff4fd8" });
const orbes = [];
for (let i = 0; i < ORBES; i++) {
  const o = new THREE.Mesh(geoOrbe, matOrbe);
  const a = (i / ORBES) * Math.PI * 2;
  const r = 6 + (i % 3) * 5;
  o.position.set(Math.cos(a) * r, 1, Math.sin(a) * r);
  scene.add(o);
  orbes.push(o);
}
let recogidos = 0;
const pintarMarcador = marcador();
const textoMarcador = () => (idioma === "en" ? `Orbs ${recogidos}/${ORBES}` : `Orbes ${recogidos}/${ORBES}`);
pintarMarcador(textoMarcador());

const ayuda = document.createElement("p");
ayuda.className = "ayuda";
ayuda.textContent = idioma === "en" ? "WASD or arrows to move · on mobile, drag" : "WASD o flechas para moverte · en el móvil, arrastra";
document.body.append(ayuda);

/* --- Controles: teclado y un joystick táctil sencillo --- */
const teclas = new Set();
addEventListener("keydown", (e) => teclas.add(e.code));
addEventListener("keyup", (e) => teclas.delete(e.code));
const toque = { activo: false, x0: 0, y0: 0, dx: 0, dy: 0 };
renderer.domElement.addEventListener("pointerdown", (e) => Object.assign(toque, { activo: true, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 }));
addEventListener("pointermove", (e) => {
  if (!toque.activo) return;
  toque.dx = THREE.MathUtils.clamp((e.clientX - toque.x0) / 60, -1, 1);
  toque.dy = THREE.MathUtils.clamp((e.clientY - toque.y0) / 60, -1, 1);
});
addEventListener("pointerup", () => (toque.activo = false));

// Objetos reutilizados en cada fotograma (crear objetos en el bucle tira los FPS en las gafas).
const dir = new THREE.Vector3();
const objetivoCamara = new THREE.Vector3();
const VELOCIDAD = 4.5;

const reloj = new THREE.Timer();
renderer.setAnimationLoop((ahora) => {
  reloj.update(ahora);
  const dt = Math.min(reloj.getDelta(), 0.1);
  const t = reloj.getElapsed();

  dir.set(0, 0, 0);
  if (teclas.has("KeyW") || teclas.has("ArrowUp")) dir.z -= 1;
  if (teclas.has("KeyS") || teclas.has("ArrowDown")) dir.z += 1;
  if (teclas.has("KeyA") || teclas.has("ArrowLeft")) dir.x -= 1;
  if (teclas.has("KeyD") || teclas.has("ArrowRight")) dir.x += 1;
  if (toque.activo) dir.set(toque.dx, 0, toque.dy);
  const velocidad = Math.min(dir.length(), 1) * VELOCIDAD;
  if (velocidad > 0.01) {
    dir.normalize();
    yo.object.position.addScaledVector(dir, velocidad * dt);
    yo.object.position.clampLength(0, 38);
    // El personaje mira hacia donde anda (giro suave).
    const rumbo = Math.atan2(dir.x, dir.z);
    let giro = rumbo - yo.object.rotation.y;
    giro = Math.atan2(Math.sin(giro), Math.cos(giro));
    yo.object.rotation.y += giro * Math.min(1, dt * 10);
  }
  yo.update(dt, velocidad / VELOCIDAD);

  for (const o of orbes) {
    if (!o.visible) continue;
    o.rotation.y += dt * 1.5;
    o.position.y = 1 + Math.sin(t * 2 + o.position.x) * 0.15;
    if (o.position.distanceToSquared(yo.object.position) < 1.2) {
      o.visible = false;
      recogidos++;
      pintarMarcador(recogidos === ORBES ? (idioma === "en" ? "All of them! 🎉" : "¡Todos! 🎉") : textoMarcador());
    }
  }

  // Cámara en tercera persona, detrás y por encima.
  objetivoCamara.set(yo.object.position.x, yo.object.position.y + 3.2, yo.object.position.z + 6.5);
  camera.position.lerp(objetivoCamara, Math.min(1, dt * 4));
  camera.lookAt(yo.object.position.x, yo.object.position.y + 1.2, yo.object.position.z);

  renderer.render(scene, camera);
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
