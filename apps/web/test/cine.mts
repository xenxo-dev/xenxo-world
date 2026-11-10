/**
 * Prueba de las cámaras del modo cine (src/world/cine), sin navegador: cada plano hace lo que dice
 * la guía (tools/cine/README.md) y ninguno deja la cámara en un sitio imposible.
 *
 *   npm run test:cine -w @xenxo/web
 *
 * La grabación en sí (MediaRecorder) solo existe en el navegador: se prueba a mano o con
 * tools/cine/render.mjs.
 */
import * as THREE from "three";
import { cineCamera } from "../src/world/cine/camera";
import { cine, CINE_CAMS, FRAME_PX, nextCineCam, setCine } from "../src/world/cine/state";

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};
const finite = (v: THREE.Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

const cam = new THREE.PerspectiveCamera(70, 9 / 16, 0.1, 400);
const fwd = new THREE.Vector3();
/** El personaje, de pie en campo abierto (sin paredes: la cámara llega adonde quiere). */
const P = { x: 400, y: 0, z: 400 };
const target = new THREE.Vector3(P.x, P.y + 1.35, P.z);
/** La cámara de siempre, detrás del personaje, antes de elegir plano. */
const behind = () => {
  cam.position.set(P.x, 2.2, P.z + 4);
  cam.lookAt(target);
};
const flat = () => Math.hypot(cam.position.x - P.x, cam.position.z - P.z);
const looksAtTarget = () => cam.getWorldDirection(fwd).angleTo(target.clone().sub(cam.position).normalize()) < 0.02;

console.log("Apagado y cámara de siempre");
behind();
const before = cam.position.clone();
check(!cineCamera(cam, P.x, P.y, P.z, 0, 0) && cam.position.equals(before), "fuera del modo cine no se toca la cámara");
setCine({ on: true });
check(cine.cam === "follow" && !cineCamera(cam, P.x, P.y, P.z, 0, 1) && cam.position.equals(before), "con «la de siempre», manda la cámara normal");

console.log("Órbita");
behind();
setCine({ cam: "orbit" });
check(cineCamera(cam, P.x, P.y, P.z, 0, 10), "toma la cámara");
const a0 = Math.atan2(cam.position.x - P.x, cam.position.z - P.z);
check(Math.abs(flat() - 5.5) < 0.05 && looksAtTarget(), `a 5,5 m del personaje, mirándolo (${flat().toFixed(2)} m)`);
cineCamera(cam, P.x, P.y, P.z, 0, 15);
const a1 = Math.atan2(cam.position.x - P.x, cam.position.z - P.z);
check(Math.abs(a1 - a0 - 5 * 0.22) < 0.01 && Math.abs(flat() - 5.5) < 0.05, "gira despacio a su alrededor, sin acercarse ni alejarse");
cineCamera(cam, P.x + 20, P.y, P.z, 0, 16);
check(Math.abs(Math.hypot(cam.position.x - (P.x + 20), cam.position.z - P.z) - 5.5) < 0.05, "y va con el personaje si se mueve");

console.log("Grúa");
behind();
setCine({ cam: "crane" });
cineCamera(cam, P.x, P.y, P.z, 0, 100);
const low = cam.position.clone();
check(low.y < 2 && flat() < 4, `sale de cerca y a ras de suelo (${low.y.toFixed(1)} m de alto)`);
cineCamera(cam, P.x, P.y, P.z, 0, 109);
const high = cam.position.clone();
check(high.y > 11 && flat() > 14 && looksAtTarget(), `a los nueve segundos está arriba y lejos, mirándolo (${high.y.toFixed(1)} m de alto, a ${flat().toFixed(1)} m)`);
cineCamera(cam, P.x, P.y, P.z, 0, 140);
check(cam.position.distanceTo(high) < 1e-6, "y se queda ahí");

console.log("Trípode");
behind();
const tripod = cam.position.clone();
setCine({ cam: "tripod" });
cineCamera(cam, P.x, P.y, P.z, 0, 200);
cineCamera(cam, P.x + 6, P.y, P.z - 3, 1, 205);
target.set(P.x + 6, P.y + 1.35, P.z - 3);
check(cam.position.equals(tripod) && looksAtTarget(), "no se mueve de donde estaba y sigue al personaje con la mirada");
target.set(P.x, P.y + 1.35, P.z);

console.log("Travelling");
behind();
const start = cam.position.clone();
const q = cam.quaternion.clone();
setCine({ cam: "travel" });
cineCamera(cam, P.x, P.y, P.z, 0, 300);
cineCamera(cam, P.x, P.y, P.z, 0, 304);
const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
check(cam.position.distanceTo(start.clone().addScaledVector(right, 4 * 1.1)) < 1e-6 && cam.quaternion.equals(q), "se desliza de lado a 1,1 m/s sin girar");

console.log("Planos");
cam.position.set(P.x - 9, 3, P.z + 2);
cam.lookAt(target);
const again = cam.position.clone();
setCine({ cam: "tripod" });
cineCamera(cam, P.x, P.y, P.z, 0, 400);
check(cam.position.equals(again), "elegir una cámara empieza el plano desde donde esté la cámara en ese momento");
const seen = new Set<string>();
for (let i = 0; i < CINE_CAMS.length; i++) {
  nextCineCam();
  seen.add(cine.cam);
  check(cineCamera(cam, P.x, P.y, P.z, 0, 500 + i) === (cine.cam !== "follow") && finite(cam.position), `«${cine.cam}»: una posición de verdad`);
}
check(seen.size === CINE_CAMS.length, "la tecla de cambiar de cámara pasa por todas");
check(Object.values(FRAME_PX).every(([w, h]) => w % 2 === 0 && h % 2 === 0 && Math.max(w, h) === 1920 || (w === 1080 && h === 1080)), "los encuadres son tamaños de vídeo (lados pares, 1080p)");
setCine({ on: false });
check(!cineCamera(cam, P.x, P.y, P.z, 0, 600) && cine.bar, "al salir, vuelve la cámara normal (y la barra, para la próxima)");

console.log(fails ? `\n${fails} fallo(s)` : "\nmodo cine: todo bien");
process.exit(fails ? 1 : 0);
