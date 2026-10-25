import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CHUNK_SIZE } from "@xenxo/protocol";
import type { Ambience } from "./graphics";

/**
 * Ciudad lejana alrededor de la plaza: torres instanciadas (un solo draw call)
 * con ventanas que se encienden de noche. Decorado del cliente, no datos del mundo:
 * no se puede visitar ni construir en ella. Su número depende del nivel gráfico.
 */

/** Generador pseudoaleatorio con semilla: la misma ciudad para todos. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** De día: fachadas claras con todas las ventanas oscuras (y alguna persiana). */
function dayTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 64, 128);
  const r = rng(11);
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      g.fillStyle = r() < 0.25 ? "#5d7a5a" : "#3b3f46";
      g.fillRect(x, y, 4, 5);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

const DAY_COLORS = ["#efe6d6", "#ead2ad", "#f1d6c4", "#dcd8cc", "#e9c690", "#f4efe6", "#d9c6a8"];

/** Textura de ventanas dibujada en un canvas: nada se descarga. */
function windowsTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 64, 128);
  const r = rng(7);
  const palette = ["#ffd27a", "#ffe9b0", "#7fd3ff", "#ff7ad9"];
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      if (r() < 0.3) {
        g.fillStyle = palette[r() < 0.8 ? (r() < 0.7 ? 0 : 1) : r() < 0.5 ? 2 : 3]!;
        g.fillRect(x, y, 5, 5);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

const MAX = 220;

export function Skyline({ count, ambience, pbr }: { count: number; ambience: Ambience; pbr: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const texture = useMemo(windowsTexture, []);
  const dayTex = useMemo(dayTexture, []);
  const night = ambience === "night";

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const r = rng(2026);
    const o = new THREE.Object3D();
    const c = CHUNK_SIZE / 2;
    for (let i = 0; i < MAX; i++) {
      const a = r() * Math.PI * 2;
      const dist = 120 + r() * 100;
      const h = 18 + Math.pow(r(), 1.6) * 85;
      const w = 8 + r() * 12;
      o.position.set(c + Math.cos(a) * dist, h / 2 - 0.5, c + Math.sin(a) * dist);
      o.rotation.set(0, r() * Math.PI, 0);
      o.scale.set(w, h, w * (0.7 + r() * 0.6));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    const col = new THREE.Color();
    for (let i = 0; i < MAX; i++) m.setColorAt(i, col.set(DAY_COLORS[Math.floor(r() * DAY_COLORS.length)]!));
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, []);

  useLayoutEffect(() => {
    if (mesh.current) mesh.current.count = Math.min(count, MAX);
  }, [count]);

  // De noche, fachadas casi negras (el color de cada torre apenas tiñe); de día, el color de cada torre.
  const color = night ? "#171c30" : "#ffffff";
  const map = night ? null : dayTex;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX]} frustumCulled={false}>
      <boxGeometry />
      {pbr ? (
        <meshStandardMaterial
          key={night ? "n" : "d"}
          color={color}
          map={map}
          roughness={0.85}
          emissive="#ffffff"
          emissiveMap={texture}
          emissiveIntensity={night ? 1.6 : 0}
        />
      ) : (
        <meshLambertMaterial key={night ? "n" : "d"} color={color} map={map} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={night ? 1.2 : 0} />
      )}
    </instancedMesh>
  );
}
