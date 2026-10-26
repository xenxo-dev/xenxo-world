/**
 * El retrato del personaje: cabeza y hombros en una imagen cuadrada, hecha en el navegador con el
 * mismo cargador que el mundo. Lo reciben los juegos sin 3D como «picture» al entrar con xenxo.
 * Un renderizador propio y pequeño que se tira al acabar (se hace una vez por personaje).
 */
import * as THREE from "three";
import { loadAvatar } from "./avatar-model";
import { createMotion } from "./motion";

const SIZE = 256;

export async function renderPortrait(url: string): Promise<Blob> {
  const avatar = await loadAvatar(url);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a1530, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-1.2, 2.4, -2.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4fa3ff, 1.4);
    rim.position.set(1.5, 1.8, 1.6);
    scene.add(rim);
    scene.add(avatar.object);

    // Postura de reposo (brazos abajo) antes de medir.
    const m = createMotion();
    for (let i = 0; i < 3; i++) avatar.update(1 / 30, m);
    avatar.object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(avatar.object);
    const top = box.max.y;
    const height = Math.max(0.5, top - box.min.y);
    // Cabeza y hombros: el 22 % de arriba del cuerpo, más un poco de aire.
    const span = height * 0.22;
    const centerY = top - span * 0.52;
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
    const dist = (span * 0.62) / Math.tan(THREE.MathUtils.degToRad(14));
    // Los personajes miran a −Z: la cámara va delante, un poco por encima.
    camera.position.set(0, centerY + span * 0.06, -dist);
    camera.lookAt(0, centerY, 0);
    renderer.render(scene, camera);

    // Fondo de xenxo: noche con un halo de neón, y el personaje encima.
    const out = document.createElement("canvas");
    out.width = SIZE;
    out.height = SIZE;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#12142b";
    ctx.fillRect(0, 0, SIZE, SIZE);
    const g = ctx.createRadialGradient(SIZE / 2, SIZE * 0.62, 0, SIZE / 2, SIZE * 0.62, SIZE * 0.62);
    g.addColorStop(0, "rgba(79,163,255,0.45)");
    g.addColorStop(1, "rgba(18,20,43,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(renderer.domElement, 0, 0);

    const webp = await new Promise<Blob | null>((r) => out.toBlob(r, "image/webp", 0.86));
    if (webp && webp.type === "image/webp") return webp;
    const png = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
    if (!png) throw new Error("toBlob");
    return png;
  } finally {
    avatar.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
