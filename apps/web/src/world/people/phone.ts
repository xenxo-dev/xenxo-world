/**
 * El teléfono en la mano (el gesto «teléfono», `phone`): un móvil cualquiera, sin marca, hecho en
 * código (su silueta de esquinas redondeadas con el canto biselado, y la pantalla por delante),
 * colgado de la mano derecha normalizada del VRM: va con ella sin nada por frame. Con el dorso contra
 * la palma y la pantalla hacia fuera (con la mano al oído, hacia la cara), a lo largo de los dedos y
 * algo inclinado hacia el pulgar. Lo de la palma sale de los huesos de cada mano (rig.ts → `palm`),
 * así que vale para cualquier avatar (también los VRM 0.x). Se crea con el avatar y escondido: así
 * se compila con él (world/warm.ts) y sacarlo no congela la página. La geometría y los materiales
 * los comparten todos (no se tiran con el avatar: `detachPhone`).
 *
 * Se buscó antes uno libre (docs/RECURSOS.md): el único CC0 que valía (Poly Pizza) no se puede bajar
 * sin pasar su control antibots, y para una pieza así de simple, hecha en código queda igual.
 */
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { Rig } from "./rig";

/** Lo que mide (m): ancho, alto y grueso; el radio de las esquinas y el bisel del canto. */
const W = 0.071;
const H = 0.148;
const D = 0.0085;
const CORNER = 0.009;
const BEVEL = 0.0018;
/** El marco alrededor de la pantalla (m). */
const FRAME = 0.0032;
/** De la línea de los huesos de la mano a la piel de la palma (m), cuánto se adelanta hacia los dedos e inclinado hacia el pulgar (rad). */
const PALM_SKIN = 0.013;
const TOWARD_FINGERS = 0.014;
const TILT = 0.1;
/** Del centro de la palma a lo que toca la pantalla (m): con el teléfono a la oreja, rig.ts → applyPhone. */
export const PHONE_HOLD = PALM_SKIN + D;

/** Un rectángulo de esquinas redondeadas, centrado. */
function rounded(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

let parts: { body: THREE.BufferGeometry; screen: THREE.BufferGeometry; bodyMat: THREE.Material; screenMat: THREE.Material } | null = null;
/** La geometría y los materiales (los mismos para todos): el cuerpo con el canto biselado, y la pantalla, delante (+Z). */
function shared() {
  if (parts) return parts;
  const body = new THREE.ExtrudeGeometry(rounded(W - 2 * BEVEL, H - 2 * BEVEL, CORNER - BEVEL), {
    depth: D - 2 * BEVEL,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 2,
    curveSegments: 4,
  });
  body.translate(0, 0, -(D - 2 * BEVEL) / 2);
  const screen = new THREE.ShapeGeometry(rounded(W - 2 * FRAME, H - 2 * FRAME, CORNER - FRAME), 4);
  screen.translate(0, 0, D / 2 + 0.0002);
  parts = {
    body,
    screen,
    bodyMat: new THREE.MeshLambertMaterial({ color: 0x2c3038 }),
    screenMat: new THREE.MeshLambertMaterial({ color: 0x0b0f16, emissive: 0x0d1c2c, emissiveIntensity: 0.5 }),
  };
  return parts;
}

/**
 * Le pone el teléfono (escondido) en la mano derecha. `scale`: la del avatar (los VRM de tamaño raro
 * se escalan al cargarlos, avatar-model.ts): el teléfono mide lo mismo en todos.
 */
export function attachPhone(vrm: VRM, rig: Rig, scale: number): THREE.Object3D | null {
  const hand = vrm.humanoid.getNormalizedBoneNode("rightHand");
  const palm = rig.palm(1);
  if (!hand || !palm || !(scale > 0)) return null;
  const p = shared();
  // En la mano (en reposo, en su marco): la palma mira hacia `n`, los dedos hacia `f` y el pulgar
  // hacia `t` (en la derecha, dedos × palma).
  const n = palm.normal.clone().normalize();
  const f = palm.center.clone().addScaledVector(n, -palm.center.dot(n)).normalize();
  const t = new THREE.Vector3().crossVectors(f, n);
  // Su largo (Y), a lo largo de los dedos y algo hacia el pulgar; su pantalla (+Z), hacia fuera de la
  // palma; su ancho (X), lo que queda.
  const up = f.clone().multiplyScalar(Math.cos(TILT)).addScaledVector(t, Math.sin(TILT)).normalize();
  const x = new THREE.Vector3().crossVectors(up, n);
  const g = new THREE.Group();
  g.name = "xenxo:phone";
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, n));
  g.position.copy(palm.center).addScaledVector(n, (PALM_SKIN + D / 2) / scale).addScaledVector(f, TOWARD_FINGERS / scale);
  g.scale.setScalar(1 / scale);
  g.add(new THREE.Mesh(p.body, p.bodyMat), new THREE.Mesh(p.screen, p.screenMat));
  g.visible = false;
  hand.add(g);
  return g;
}

/** Lo quita de la mano antes de tirar el avatar (sus piezas son de todos). */
export function detachPhone(phone: THREE.Object3D | null) {
  phone?.removeFromParent();
}

/** ¿Con el teléfono en la mano? (el gesto, puesto o encima de lo que haga). */
export const onPhone = (emote: string | null | undefined, gesture: string | null | undefined) => emote === "phone" || gesture === "phone";
