/**
 * Los juegos de pillar en el mundo (tag@1, docs/PROTOCOL.md §9 decies): el corro de cada uno en el
 * suelo, con lo que pasa encima (esperando, la cuenta atrás, en juego), el borde de la zona mientras
 * juegas y el toque: si la llevas y ya puedes, al tocar a alguien que corre se avisa al servidor (que lo
 * comprueba con las poses). Al empezar, si la llevas, te quedas quieto en el corro mientras los demás
 * se dispersan (`tagHold`, que lee el jugador). El servidor lleva la ronda; aquí solo se enseña.
 *
 * Rendimiento: geometrías y materiales compartidos o hechos una vez por corro, nada nuevo por frame, y
 * los textos cambian como mucho una vez por segundo. Todo está montado desde que llega el lugar (el
 * borde de la zona, escondido): así se compila con el repaso de la llegada (warm.ts).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import { t, useLang } from "../i18n";
import { canTag, heldAtStart, playing, tagClock, touchTarget, type TagState } from "../net/tag";
import { tag, tagHold, useTag } from "../net/tag-store";
import { useWorldVersion, world } from "../net/world-store";
import { SIGN_FONT_URL } from "./font";
import { remoteFeet } from "./people/where";
import { self } from "./self";
import { tagBeep } from "./tag-audio";
import { lobbiesOf, TAG_COLORS, type TagLobby } from "./tag-lobbies";

const ringGeo = new THREE.RingGeometry(0.93, 1, 72);
ringGeo.rotateX(-Math.PI / 2);
const innerGeo = new THREE.RingGeometry(0.7, 0.74, 72);
innerGeo.rotateX(-Math.PI / 2);
const discGeo = new THREE.CircleGeometry(1, 72);
discGeo.rotateX(-Math.PI / 2);
/** El borde de la zona: una pared de luz que se apaga hacia arriba (blanco abajo, negro arriba: con suma, nada). */
const wallGeo = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true);
  g.translate(0, 0.5, 0);
  const pos = g.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) col.fill(pos.getY(i) > 0.5 ? 0 : 1, i * 3, i * 3 + 3);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
})();
const WALL_H = 7;

function glow(color: string, opacity: number, vertexColors = false) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, vertexColors });
}

/** Dónde se dibuja ahora a otra persona (sus pies): para el toque, sin crear nada por frame. */
const feetOf = (id: string) => remoteFeet.get(id) ?? null;

/** Lo que se lee encima de un corro. */
function ringLine(g: TagState | undefined, serverNow: number): string {
  if (!g || g.state === "idle") return t("tag.ring.join");
  if (g.state === "open") return t("tag.ring.waiting", { n: g.players.length, min: g.min });
  if (g.state === "countdown") return t("tag.ring.countdown", { s: Math.max(0, Math.ceil(((g.go_at ?? 0) - serverNow) / 1000)) });
  if (g.state === "running") return t("tag.ring.running", { time: tagClock((g.end_at ?? 0) - serverNow) });
  return t("tag.ring.done");
}

/** Un corro: el aro, un aro que late mientras se forma la ronda y lo que pasa, escrito encima. */
function Lobby({ lobby }: { lobby: TagLobby }) {
  useLang();
  useTag();
  const color = TAG_COLORS[lobby.mode];
  const mats = useMemo(() => ({ ring: glow(color, 0.95), inner: glow(color, 0.45), disc: glow(color, 0.07), pulse: glow(color, 0.6) }), [color]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const pulse = useRef<THREE.Mesh>(null);
  const label = useRef<THREE.Group>(null);
  const g = tag.games.get(lobby.id);
  // El texto cambia cada segundo mientras cuenta (y solo entonces).
  const [, tick] = useState(0);
  const timed = g?.state === "countdown" || g?.state === "running";
  useEffect(() => {
    if (!timed) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [timed]);
  useFrame((state) => {
    const p = pulse.current;
    if (p) {
      // Late mientras se puede entrar; en juego, quieto y apagado.
      const st = tag.games.get(lobby.id)?.state;
      const open = st !== "running" && st !== "done";
      const k = (state.clock.elapsedTime * (st === "countdown" ? 1.1 : 0.55)) % 1;
      p.visible = open;
      p.scale.setScalar(lobby.radius * (0.25 + 0.75 * k));
      mats.pulse.opacity = 0.55 * (1 - k);
      mats.ring.opacity = open ? 0.95 : 0.5;
    }
    // El texto solo de cerca.
    if (label.current) label.current.visible = (self.x - lobby.x) ** 2 + (self.z - lobby.z) ** 2 < 45 * 45;
  });
  // Por encima del suelo forjado (cuantizado, queda a unos 5 cm sobre 0): más abajo, el suelo lo tapa.
  const y = lobby.y + 0.08;
  return (
    <group position={[lobby.x, y, lobby.z]}>
      <mesh geometry={discGeo} material={mats.disc} scale={lobby.radius} renderOrder={2} />
      <mesh geometry={ringGeo} material={mats.ring} scale={lobby.radius} renderOrder={2} />
      <mesh geometry={innerGeo} material={mats.inner} scale={lobby.radius} renderOrder={2} />
      <mesh ref={pulse} geometry={ringGeo} material={mats.pulse} renderOrder={2} />
      <Billboard ref={label} position={[0, 2.7, 0]}>
        <Text font={SIGN_FONT_URL} fontSize={0.34} color={color} anchorX="center" anchorY="bottom" outlineWidth={0.012} outlineColor="#05070d">
          {t(lobby.mode === "tag" ? "tag.mode.tag" : "tag.mode.infection").toUpperCase()}
        </Text>
        <Text font={SIGN_FONT_URL} fontSize={0.22} color="#f6f1e7" anchorX="center" anchorY="top" position={[0, -0.04, 0]} outlineWidth={0.01} outlineColor="#05070d">
          {ringLine(g, world.serverNow())}
        </Text>
      </Billboard>
    </group>
  );
}

/**
 * Lo de cada frame: el borde de la zona de la ronda en que juegas, si te toca quedarte quieto, los
 * pitidos de la cuenta atrás y el toque a quien tengas al lado (si la llevas y ya puedes).
 */
function TagSensor({ lobbies }: { lobbies: TagLobby[] }) {
  const wall = useRef<THREE.Mesh>(null);
  const wallMats = useMemo(() => ({ tag: glow(TAG_COLORS.tag, 0.35, true), infection: glow(TAG_COLORS.infection, 0.35, true) }), []);
  useEffect(() => () => Object.values(wallMats).forEach((m) => m.dispose()), [wallMats]);
  const sent = useRef(new Map<string, number>());
  const beep = useRef(0);
  useEffect(
    () => () => {
      tagHold.on = false;
    },
    [],
  );
  useFrame(() => {
    const g = tag.shown;
    const me = world.sessionId;
    const st = world.serverNow();
    tagHold.on = heldAtStart(g, me, st);
    // El borde de la zona, mientras juegas una ronda en marcha.
    const w = wall.current;
    const lobby = g ? lobbies.find((l) => l.id === g.entity_id) : undefined;
    const on = !!g && !!lobby && g.state === "running" && playing(g, me);
    if (w) {
      w.visible = on;
      if (on) {
        w.position.set(lobby.area.x, lobby.y - 1, lobby.area.z);
        w.scale.set(lobby.area.r, WALL_H, lobby.area.r);
        w.material = wallMats[lobby.mode];
        // Más viva cuanto más cerca del borde.
        const d = lobby.area.r - Math.hypot(self.x - lobby.area.x, self.z - lobby.area.z);
        wallMats[lobby.mode].opacity = d < 0 ? 0.6 : 0.08 + 0.32 * Math.max(0, 1 - d / 12);
      }
    }
    // Los tres últimos segundos de la cuenta atrás, con un pitido cada uno.
    if (g && g.state === "countdown" && playing(g, me) && g.go_at) {
      const left = Math.ceil((g.go_at - st) / 1000);
      if (left >= 1 && left <= 3 && left !== beep.current) tagBeep(false);
      beep.current = left;
    } else beep.current = 0;
    // El toque: a quien corra a tu lado (lo comprueba el servidor; se insiste poco).
    if (!canTag(g, me, st)) return;
    const who = touchTarget(g, me, st, self, feetOf);
    if (!who) return;
    const now = performance.now();
    if (now - (sent.current.get(who) ?? -Infinity) < 450) return;
    sent.current.set(who, now);
    tag.send(who);
  });
  return <mesh ref={wall} geometry={wallGeo} material={wallMats.tag} visible={false} renderOrder={3} />;
}

export function TagGames() {
  useWorldVersion();
  const key = world.getEntitiesVersion();
  const lobbies = useMemo(() => lobbiesOf(world.entities.values()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lobbies.length || world.solo) return null;
  return (
    <>
      {lobbies.map((l) => (
        <Lobby key={l.id} lobby={l} />
      ))}
      <TagSensor lobbies={lobbies} />
    </>
  );
}
