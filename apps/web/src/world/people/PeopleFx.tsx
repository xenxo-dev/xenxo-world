/**
 * Lo que se ve de la gente en el mundo (§9 octies): reacciones que flotan sobre la cabeza, destellos
 * de las acciones en pareja, el golpe de cada estilo de pelea (de dibujos, de 8 bits, eléctrico en
 * los duelos o una nube de polvo en los empujones), estrellas al quedar fuera de combate y la marca
 * del modo pelea. Todo con sprites de un grupo fijo (sin crear objetos por frame) y texturas
 * pintadas una vez en un lienzo con los mismos trazos que los iconos del HUD.
 *
 * También rellena `others` (collision.ts) con dónde está cada persona: así nadie se atraviesa.
 */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { FightStyle } from "@xenxo/protocol";
import { HIT_MS, people, REACTION_MS, usePeople } from "../../net/people-store";
import { world } from "../../net/world-store";
import { PEOPLE_PATHS } from "../../hud/people-icons";
import { remoteFeet } from "../Avatars";
import { others } from "../collision";
import { self } from "../self";
import { prepareFights } from "./selfPeople";

/** Color de cada icono que flota. */
const TINT: Record<string, string> = {
  heart: "#ff4f8b",
  laugh: "#ffd54f",
  wow: "#36d9ff",
  clap: "#ffd54f",
  fire: "#ff7a45",
  thumbs_up: "#6dff8a",
  fight: "#ff4f8b",
  star: "#ffe14f",
  high_five: "#36d9ff",
  hug: "#ff4fd8",
  handshake: "#6dff8a",
};

const SIZE = 128;
const textures = new Map<string, THREE.CanvasTexture>();

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  return [c, c.getContext("2d")!];
}
function finish(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Icono redondo: fondo oscuro, aro y trazo del color del icono, con un leve resplandor. */
function iconTexture(name: string): THREE.CanvasTexture {
  let t = textures.get(name);
  if (t) return t;
  const [c, g] = canvas();
  const color = TINT[name] ?? "#f6f1e7";
  g.fillStyle = "rgba(8, 13, 25, 0.78)";
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = color;
  g.stroke();
  g.save();
  g.translate(64 - 36, 64 - 36);
  g.scale(3, 3);
  g.lineWidth = 1.9;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.shadowColor = color;
  g.shadowBlur = 6;
  g.strokeStyle = color;
  for (const d of PEOPLE_PATHS[name] ?? []) g.stroke(new Path2D(d));
  g.restore();
  t = finish(c);
  textures.set(name, t);
  return t;
}

/** El golpe de cada estilo. */
function hitTexture(style: FightStyle): THREE.CanvasTexture {
  const key = `hit-${style}`;
  let t = textures.get(key);
  if (t) return t;
  const [c, g] = canvas();
  if (style === "comic") {
    // Estallido de cómic: estrella de muchas puntas amarilla con el centro blanco.
    g.beginPath();
    for (let i = 0; i < 24; i++) {
      const r = i % 2 ? 30 : 60;
      const a = (i / 24) * Math.PI * 2;
      g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = "#ffd54f";
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = "#ff4f8b";
    g.stroke();
    g.fillStyle = "#fffbe8";
    g.beginPath();
    g.arc(64, 64, 18, 0, Math.PI * 2);
    g.fill();
  } else if (style === "pixel") {
    // Píxeles que saltan: cuadrados magenta y cian en anillo.
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const r = 26 + (i % 3) * 12;
      g.fillStyle = i % 2 ? "#ff4fd8" : "#36d9ff";
      g.fillRect(64 + Math.cos(a) * r - 6, 64 + Math.sin(a) * r - 6, 12, 12);
    }
    g.fillStyle = "#ffffff";
    g.fillRect(52, 52, 24, 24);
  } else if (style === "duel") {
    // Descarga eléctrica: aro cian con rayos.
    g.strokeStyle = "#36d9ff";
    g.shadowColor = "#36d9ff";
    g.shadowBlur = 12;
    g.lineWidth = 5;
    g.beginPath();
    g.arc(64, 64, 40, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.moveTo(64 + Math.cos(a) * 18, 64 + Math.sin(a) * 18);
      g.lineTo(64 + Math.cos(a + 0.25) * 34, 64 + Math.sin(a + 0.25) * 34);
      g.lineTo(64 + Math.cos(a - 0.1) * 46, 64 + Math.sin(a - 0.1) * 46);
      g.lineTo(64 + Math.cos(a + 0.15) * 60, 64 + Math.sin(a + 0.15) * 60);
      g.stroke();
    }
  } else {
    // Empujón: nube de polvo.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.fillStyle = `rgba(203, 213, 225, ${0.35 + (i % 3) * 0.15})`;
      g.beginPath();
      g.arc(64 + Math.cos(a) * 28, 64 + Math.sin(a) * 22, 18 + (i % 3) * 5, 0, Math.PI * 2);
      g.fill();
    }
  }
  t = finish(c);
  textures.set(key, t);
  return t;
}

function makeSprite(): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
  s.visible = false;
  s.renderOrder = 4;
  return s;
}

const POOL = 40;
const _f = new THREE.Vector3();

/** Pies de alguien: los tuyos o los de la persona tal como se dibuja ahora. */
function feetOf(id: string, out: THREE.Vector3): boolean {
  if (id === world.sessionId) {
    out.set(self.x, self.y, self.z);
    return true;
  }
  const p = remoteFeet.get(id);
  if (!p) return false;
  out.copy(p);
  return true;
}

export function PeopleFx() {
  const p = usePeople();
  const group = useMemo(() => {
    const g = new THREE.Group();
    for (let i = 0; i < POOL; i++) g.add(makeSprite());
    return g;
  }, []);
  // Al activar el modo pelea se carga la física de las caídas (la primera ya la tiene lista).
  useEffect(() => {
    if (p.fightOn && p.style) prepareFights();
  }, [p.fightOn, p.style]);
  useEffect(
    () => () => {
      for (const s of group.children as THREE.Sprite[]) s.material.dispose();
      others.count = 0;
    },
    [group],
  );

  // Antes que el jugador (prioridad −1): dónde está cada persona, para no atravesarla.
  useFrame(() => {
    let n = 0;
    const now = world.serverNow();
    if (!world.solo) {
      for (const [id, buf] of world.poseBuffers) {
        if (n >= others.max) break;
        const s = buf[buf.length - 1];
        if (!s || s.vehicle || now - s.t > 3000 || id === world.sessionId) continue;
        others.pos[n * 3] = s.head.p[0]!;
        others.pos[n * 3 + 1] = s.head.p[1]! - 1.6;
        others.pos[n * 3 + 2] = s.head.p[2]!;
        n++;
      }
    }
    others.count = n;
  }, -1);

  useFrame((state) => {
    const sprites = group.children as THREE.Sprite[];
    let i = 0;
    const now = performance.now();
    const t = state.clock.elapsedTime;
    const put = (tex: THREE.Texture, x: number, y: number, z: number, scale: number, opacity: number) => {
      if (i >= sprites.length) return;
      const s = sprites[i++]!;
      if (s.material.map !== tex) {
        s.material.map = tex;
        s.material.needsUpdate = true;
      }
      s.material.opacity = opacity;
      s.position.set(x, y, z);
      s.scale.setScalar(scale);
      s.visible = true;
    };

    // Reacciones: suben despacio y se apagan al final.
    for (const r of people.reactions) {
      const age = now - r.at;
      if (age > REACTION_MS || !feetOf(r.session_id, _f)) continue;
      const k = age / REACTION_MS;
      const pop = Math.min(1, age / 140);
      put(iconTexture(r.kind), _f.x, _f.y + 2.15 + k * 0.6, _f.z, 0.42 * (0.6 + 0.4 * pop), k > 0.7 ? (1 - k) / 0.3 : 1);
    }
    // Parejas: un destello entre las dos personas al principio.
    for (const e of people.pairs) {
      const age = now - e.at;
      if (age > 1800 || !feetOf(e.a, _f)) continue;
      const ax = _f.x, ay = _f.y, az = _f.z;
      if (!feetOf(e.b, _f)) continue;
      const k = age / 1800;
      put(iconTexture(e.kind === "hug" ? "heart" : e.kind), (ax + _f.x) / 2, (ay + _f.y) / 2 + 2.1 + k * 0.4, (az + _f.z) / 2, 0.5, k > 0.6 ? (1 - k) / 0.4 : 1);
    }
    // Golpes: el destello de su estilo, que crece y se apaga.
    for (const h of people.hits) {
      const age = now - h.at;
      if (age > HIT_MS || !feetOf(h.to, _f)) continue;
      const k = Math.min(1, age / (HIT_MS * 0.45));
      put(hitTexture(h.style), _f.x - h.dir[0] * 0.15, _f.y + 1.3, _f.z - h.dir[1] * 0.15, 0.45 + k * 0.75, age > HIT_MS * 0.45 ? 1 - (age - HIT_MS * 0.45) / (HIT_MS * 0.55) : 1);
    }
    // Fuera de combate: tres estrellas que dan vueltas sobre quien está en el suelo.
    for (const [id, h] of people.lastHit) {
      if (!h.ko || now - h.at > 3600 || !feetOf(id, _f)) continue;
      for (let s = 0; s < 3; s++) {
        const a = t * 3 + (s / 3) * Math.PI * 2;
        put(iconTexture("star"), _f.x + Math.cos(a) * 0.35 + h.dir[0] * 1.1, _f.y + 0.55, _f.z + Math.sin(a) * 0.35 + h.dir[1] * 1.1, 0.2, 1);
      }
    }
    // Quién está en modo pelea (y tú, si lo tienes): un puño pequeño sobre la cabeza.
    if (people.style) {
      if (people.fightOn && world.sessionId && feetOf(world.sessionId, _f)) put(iconTexture("fight"), _f.x, _f.y + 2.05, _f.z, 0.2, 0.9);
      for (const id of people.fighters) if (feetOf(id, _f)) put(iconTexture("fight"), _f.x, _f.y + 2.05, _f.z, 0.2, 0.9);
    }
    for (; i < sprites.length; i++) sprites[i]!.visible = false;
  });

  return <primitive object={group} />;
}
