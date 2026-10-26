/**
 * Juego de ejemplo de «Entrar con xenxo»: entra con tu cuenta y aparece tu personaje de xenxo
 * (el mismo VRM que llevas en el mundo), animado. Es lo que haría un juego de fuera con el SDK.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, type VRMAnimation } from "@pixiv/three-vrm-animation";
import { xenxo, type XenxoPlayer } from "./index";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const saved = (() => {
  try {
    return localStorage.getItem("xenxo:ejemplo:client") ?? "";
  } catch {
    return "";
  }
})();
const clientInput = $<HTMLInputElement>("client");
clientInput.value = params.get("client_id") ?? saved;
const issuer = params.get("issuer") ?? (location.hostname === "localhost" ? "http://localhost:8787" : "https://api.xenxo.io");

async function start() {
  const clientId = clientInput.value.trim();
  if (!clientId) return;
  try {
    localStorage.setItem("xenxo:ejemplo:client", clientId);
  } catch {
    /* sin almacenamiento */
  }
  const player = await xenxo.connect({ clientId, redirectUri: location.origin + location.pathname, issuer, scopes: ["profile", "player", "avatar"] });
  if (xenxo.error) $("status").textContent = `Sin entrar: ${xenxo.error}`;
  if (player) await show(player);
  else $("login").removeAttribute("hidden");
}

$("login").onclick = () => void xenxo.login();
$("logout").onclick = () => {
  xenxo.logout();
  location.reload();
};
clientInput.onchange = () => void start();

async function show(p: XenxoPlayer) {
  $("login").setAttribute("hidden", "");
  $("logout").removeAttribute("hidden");
  $("status").textContent = "";
  $("name").textContent = p.name ?? "(sin nombre)";
  $("number").textContent = p.playerNo != null ? `Jugador #${p.playerNo}` : "";
  $("sub").textContent = `id en este juego: ${p.id}`;
  $("sig").textContent = p.signatureChecked ? "Firma Ed25519 comprobada en tu navegador ✓" : "Firma no comprobada (tu navegador no tiene Ed25519)";
  if (p.avatar) await avatar(p.avatar.url);
}

async function avatar(url: string) {
  const canvas = $<HTMLCanvasElement>("view");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 1.0, -4.4);
  camera.lookAt(0, 0.9, 0);
  scene.add(new THREE.HemisphereLight("#cfe8ff", "#1a1030", 1.2));
  const key = new THREE.DirectionalLight("#ffffff", 1.6);
  key.position.set(-2, 3, -2.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight("#ff3d9a", 1.4);
  rim.position.set(2.5, 1.5, 2);
  scene.add(rim);
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener("resize", resize);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM | undefined;
  const root = vrm ? vrm.scene : gltf.scene;
  if (vrm) {
    VRMUtils.rotateVRM0(vrm);
    root.rotation.y = Math.PI; // los VRM miran a +Z; la cámara está en −Z
  }
  scene.add(root);
  let mixer: THREE.AnimationMixer | null = null;
  if (vrm) {
    // La animación de reposo de xenxo (CC0), la misma que en el mundo.
    const anim = await loader.loadAsync(new URL("/anims/idle.vrma", issuer.includes("localhost") ? location.origin : "https://xenxo.io").toString()).catch(() => null);
    const va = (anim?.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0];
    if (va) {
      mixer = new THREE.AnimationMixer(vrm.scene);
      mixer.clipAction(createVRMAnimationClip(va, vrm)).play();
    }
  }
  const clock = new THREE.Timer();
  renderer.setAnimationLoop((t) => {
    clock.update(t);
    const dt = Math.min(clock.getDelta(), 0.1);
    mixer?.update(dt);
    vrm?.update(dt);
    renderer.render(scene, camera);
  });
}

void start();
