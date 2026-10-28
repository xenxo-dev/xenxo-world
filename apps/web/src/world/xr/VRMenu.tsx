/**
 * El panel dentro de la VR: un botón sobre la muñeca izquierda (mando o mano) y el botón Y lo abren
 * delante de la persona. Se pulsa con el rayo del mando derecho o tocándolo con el índice.
 *
 * Lo que hay: ir al nexo, a la plaza o a un distrito abierto; gestos (los ven los demás); día o noche;
 * el chat del lugar (leer y, con cuenta, frases rápidas: escribir sin teclado no se puede); la ayuda
 * de los controles y salir de la VR. Va dentro del origen XR (la habitación): se mueve con ella.
 *
 * Textos de la interfaz en i18n.ts; los del chat y los nombres de distrito son DATO (texto plano).
 * Solo se monta en VR, y el panel solo mientras está abierto.
 */
import { Suspense, memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { XRSpace, useXR, useXRInputSourceState, useXRStore } from "@react-three/xr";
import * as THREE from "three";
import { PLACES } from "@xenxo/protocol";
import { t, useLang, type Key } from "../../i18n";
import { useAccount } from "../../net/account";
import { DISTRICT_SPAWN, refreshDistricts, useDistricts } from "../../net/districts";
import { currentChunk, sendChat, travel } from "../../net/session";
import { chat, useChatVersion, world } from "../../net/world-store";
import { FONT_URL } from "../font";
import { graphics, useGraphics } from "../graphics";
import { input } from "../input";
import { XR_THEME } from "./theme";

/** Medidas del panel (m): a 0,6 m de los ojos se lee como una tablet a la distancia del brazo. */
const W = 0.62;
const PAD = 0.03;
const DIST = 0.6;
const DROP = 0.14;
const QUICK: Key[] = ["vr.quick.hi", "vr.quick.thanks", "vr.quick.go", "vr.quick.bye"];
const GESTURES = ["wave", "dance", "cheer"] as const;

const _fwd = new THREE.Vector3();
const _head = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _parent = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);

/** Estado compartido: abierto o no (el botón de la muñeca y la Y lo cambian). */
const menu = {
  open: false,
  listeners: new Set<() => void>(),
  set(v: boolean) {
    if (menu.open === v) return;
    menu.open = v;
    for (const fn of menu.listeners) fn();
  },
};

function useMenuOpen() {
  const [open, setOpen] = useState(menu.open);
  useEffect(() => {
    const fn = () => setOpen(menu.open);
    menu.listeners.add(fn);
    return () => void menu.listeners.delete(fn);
  }, []);
  return open;
}

/**
 * El panel se dibuja siempre encima (sin prueba de profundidad y al final): en una escalera o junto
 * a una pared, el escalón o el muro de delante lo taparían. Fondo, después botones, después textos.
 */
const ui = (color: string, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false });
const panelMat = ui(XR_THEME.noche, 0.92);
const btnMat = ui(XR_THEME.boton);
const btnHover = ui(XR_THEME.neon);
const btnActive = ui(XR_THEME.botonActivo);
const edgeMat = ui(XR_THEME.neon);
/** Base de los textos (troika le pone el color de cada uno). */
const textMat = ui(XR_THEME.cal);
const R_BG = 1000, R_BTN = 1001, R_TEXT = 1002;
const plane = new THREE.PlaneGeometry(1, 1);

/**
 * Pulsar: apretar y soltar el gatillo (o el dedo) sobre el mismo botón, tarde lo que tarde. El
 * «click» normal no vale aquí: si entre apretar y soltar pasan más de 300 ms (lo normal en VR, o
 * con un frame lento), no llega.
 */
function usePress(onPress: () => void, setHover: (v: boolean) => void) {
  const down = useRef(new Set<number>());
  return {
    onPointerOver: () => setHover(true),
    onPointerOut: (e: ThreeEvent<PointerEvent>) => {
      setHover(false);
      down.current.delete(e.pointerId);
    },
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      down.current.add(e.pointerId);
    },
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (down.current.delete(e.pointerId)) onPress();
    },
  };
}

const Button = memo(function Button({ x, y, w, h = 0.05, label, active = false, onPress }: { x: number; y: number; w: number; h?: number; label: string; active?: boolean; onPress: () => void }) {
  const [hover, setHover] = useState(false);
  const press = usePress(onPress, setHover);
  return (
    // Los eventos van al grupo: el rayo puede dar antes en el texto que en el botón.
    <group
      position={[x, y, 0.002]}
      {...press}
    >
      <mesh geometry={plane} material={hover ? btnHover : active ? btnActive : btnMat} scale={[w, h, 1]} renderOrder={R_BTN} />
      <Text material={textMat} renderOrder={R_TEXT} font={FONT_URL} fontSize={0.019} color={hover ? XR_THEME.noche : XR_THEME.cal} anchorX="center" anchorY="middle" position={[0, 0, 0.002]} maxWidth={w - 0.01}>
        {label}
      </Text>
    </group>
  );
});

function Heading({ y, text }: { y: number; text: string }) {
  return (
    <Text material={textMat} renderOrder={R_TEXT} font={FONT_URL} fontSize={0.016} color={XR_THEME.neonSuave} anchorX="left" anchorY="middle" position={[-W / 2 + PAD, y, 0.002]}>
      {text.toUpperCase()}
    </Text>
  );
}

function Panel() {
  const lang = useLang();
  useGraphics();
  useChatVersion();
  const user = useAccount();
  const districts = useDistricts();
  const session = useXR((s) => s.session);
  useEffect(() => {
    void refreshDistricts();
  }, []);
  const here = currentChunk();
  const solo = world.solo;

  const places = useMemo(() => {
    const list: { id: string; label: string; go: () => void }[] = [
      { id: PLACES.nexo, label: t("vr.place.nexo"), go: () => travel(PLACES.nexo) },
      { id: PLACES.plaza, label: t("vr.place.plaza"), go: () => travel(PLACES.plaza, [32, 0, 43], 0) },
    ];
    for (const d of districts ?? []) {
      if (d.soon || d.community) continue;
      list.push({ id: d.chunk_id, label: d.name[lang] ?? d.name.en ?? d.id, go: () => travel(d.chunk_id, DISTRICT_SPAWN, 0) });
    }
    return list;
  }, [districts, lang]);

  // Filas de arriba abajo; `y` va bajando.
  let y = 0;
  const rows: ReactNode[] = [];
  const row = (h: number) => {
    const at = y - h / 2;
    y -= h;
    return at;
  };
  const inner = W - PAD * 2;

  row(PAD);
  rows.push(
    <Text material={textMat} renderOrder={R_TEXT} key="title" font={FONT_URL} fontSize={0.026} color={XR_THEME.cal} anchorX="left" anchorY="middle" position={[-W / 2 + PAD, row(0.04), 0.002]}>
      {t("vr.menu")}
    </Text>,
  );
  rows.push(<Button key="close" x={W / 2 - PAD - 0.06} y={y + 0.02} w={0.12} h={0.036} label={t("vr.close")} onPress={() => menu.set(false)} />);

  row(0.012);
  rows.push(<Heading key="h-go" y={row(0.03)} text={t("vr.goTo")} />);
  const cols = 3;
  const bw = (inner - (cols - 1) * 0.012) / cols;
  for (let i = 0; i < places.length; i += cols) {
    const at = row(0.058);
    for (let k = 0; k < cols && i + k < places.length; k++) {
      const p = places[i + k]!;
      rows.push(<Button key={`go-${p.id}`} x={-W / 2 + PAD + bw / 2 + k * (bw + 0.012)} y={at} w={bw} label={p.label} active={p.id === here} onPress={() => (p.id === here ? menu.set(false) : (p.go(), menu.set(false)))} />);
    }
  }

  row(0.01);
  rows.push(<Heading key="h-em" y={row(0.03)} text={t("emote.bar")} />);
  {
    const at = row(0.058);
    GESTURES.forEach((g, k) => rows.push(<Button key={`em-${g}`} x={-W / 2 + PAD + bw / 2 + k * (bw + 0.012)} y={at} w={bw} label={t(`emote.${g}` as Key)} onPress={() => (input.emote = g)} />));
  }

  row(0.01);
  rows.push(<Heading key="h-amb" y={row(0.03)} text={t("gfx.ambience")} />);
  {
    const at = row(0.058);
    const amb = graphics.ambience;
    rows.push(<Button key="day" x={-W / 2 + PAD + bw / 2} y={at} w={bw} label={t("gfx.ambience.day")} active={amb === "day"} onPress={() => graphics.setAmbience("day")} />);
    rows.push(<Button key="night" x={-W / 2 + PAD + bw / 2 + (bw + 0.012)} y={at} w={bw} label={t("gfx.ambience.night")} active={amb === "night"} onPress={() => graphics.setAmbience("night")} />);
    rows.push(<Button key="auto" x={-W / 2 + PAD + bw / 2 + 2 * (bw + 0.012)} y={at} w={bw} label={t("gfx.ambience.auto")} active={graphics.ambiencePref === "auto"} onPress={() => graphics.setAmbience("auto")} />);
  }

  if (!solo) {
    row(0.01);
    rows.push(<Heading key="h-chat" y={row(0.03)} text={t("chat.open")} />);
    const last = chat.messages.slice(-3);
    if (!last.length) {
      rows.push(
        <Text material={textMat} renderOrder={R_TEXT} key="empty" font={FONT_URL} fontSize={0.016} color={XR_THEME.muted} anchorX="left" anchorY="middle" position={[-W / 2 + PAD, row(0.03), 0.002]}>
          {t("chat.empty")}
        </Text>,
      );
    }
    for (const m of last) {
      // Texto de otras personas: dato, en texto plano y recortado.
      const line = `${m.sender.display_name}: ${m.text}`;
      rows.push(
        <Text material={textMat} renderOrder={R_TEXT} key={m.id} font={FONT_URL} fontSize={0.016} color={XR_THEME.soft} anchorX="left" anchorY="middle" maxWidth={inner} position={[-W / 2 + PAD, row(0.03), 0.002]}>
          {line.length > 90 ? `${line.slice(0, 89)}…` : line}
        </Text>,
      );
    }
    if (user) {
      const qw = (inner - 3 * 0.012) / 4;
      const at = row(0.058);
      QUICK.forEach((k, i) => rows.push(<Button key={k} x={-W / 2 + PAD + qw / 2 + i * (qw + 0.012)} y={at} w={qw} label={t(k)} onPress={() => sendChat(t(k))} />));
    } else {
      rows.push(
        <Text material={textMat} renderOrder={R_TEXT} key="signin" font={FONT_URL} fontSize={0.015} color={XR_THEME.muted} anchorX="left" anchorY="middle" maxWidth={inner} position={[-W / 2 + PAD, row(0.03), 0.002]}>
          {t("vr.chatSignIn")}
        </Text>,
      );
    }
  }

  row(0.012);
  rows.push(
    <Text material={textMat} renderOrder={R_TEXT} key="help" font={FONT_URL} fontSize={0.013} color={XR_THEME.muted} anchorX="left" anchorY="middle" maxWidth={inner} position={[-W / 2 + PAD, row(0.045), 0.002]}>
      {t("vr.help")}
    </Text>,
  );
  rows.push(<Button key="exit" x={0} y={row(0.058)} w={inner} label={t("vr.exit")} onPress={() => void session?.end()} />);
  row(PAD);

  const height = -y;
  return (
    <group position={[0, height / 2, 0]}>
      <mesh geometry={plane} material={panelMat} position={[0, -height / 2, 0]} scale={[W, height, 1]} renderOrder={R_BG} onClick={(e) => e.stopPropagation()} />
      <mesh geometry={plane} material={edgeMat} position={[0, 0.002, 0.001]} scale={[W, 0.004, 1]} renderOrder={R_BTN} />
      {rows}
    </group>
  );
}

/** El panel, delante de la cabeza al abrirse (en el espacio de la habitación). */
function FloatingPanel() {
  const group = useRef<THREE.Group>(null);
  const placed = useRef(false);
  useFrame((state) => {
    const g = group.current;
    if (!g || placed.current) return;
    // Delante de la cabeza, en el mundo; después, al espacio de la habitación (el padre).
    const cam = state.camera;
    cam.getWorldPosition(_head);
    cam.getWorldQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _head.set(_head.x + _fwd.x * DIST, _head.y - DROP, _head.z + _fwd.z * DIST);
    _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(-_fwd.x, -_fwd.z));
    _m.compose(_head, _q, _s);
    if (g.parent) {
      g.parent.updateWorldMatrix(true, false);
      _m.premultiply(_parent.copy(g.parent.matrixWorld).invert());
    }
    _m.decompose(g.position, g.quaternion, g.scale);
    g.visible = true;
    placed.current = true;
  });
  return (
    <group ref={group} visible={false}>
      <group rotation-x={-0.18}>
        <Suspense fallback={null}>
          <Panel />
        </Suspense>
      </group>
    </group>
  );
}

/** La pastilla «Menú» (con mando, sobre él; con la mano, flotando sobre la muñeca). */
function MenuPill({ hover, open }: { hover: boolean; open: boolean }) {
  return (
    <>
      <mesh geometry={plane} material={hover || open ? btnHover : btnMat} scale={[0.07, 0.03, 1]} renderOrder={R_BTN} />
      <Suspense fallback={null}>
        <Text material={textMat} renderOrder={R_TEXT} font={FONT_URL} fontSize={0.013} color={hover || open ? XR_THEME.noche : XR_THEME.cal} anchorX="center" anchorY="middle" position={[0, 0, 0.002]}>
          {t("vr.menu")}
        </Text>
      </Suspense>
    </>
  );
}

/**
 * El botón de la muñeca izquierda. Con mando, va pegado a él. Con la mano, flota 7 cm por encima
 * de la muñeca y mira a la cabeza (los ejes de la muñeca giran con la mano y lo esconderían).
 */
function WristButton() {
  const controller = useXRInputSourceState("controller", "left");
  const hand = useXRInputSourceState("hand", "left");
  const open = useMenuOpen();
  const [hover, setHover] = useState(false);
  const press = usePress(() => menu.set(!menu.open), setHover);
  const anchor = useRef<THREE.Object3D>(null);
  const pill = useRef<THREE.Group>(null);
  useFrame((state) => {
    const a = anchor.current, g = pill.current;
    if (!a || !g || !g.parent) return;
    a.getWorldPosition(_head);
    _head.y += 0.07;
    const y = _head.y;
    state.camera.getWorldPosition(_fwd);
    g.position.copy(g.parent.worldToLocal(_head));
    // lookAt mira a un punto del mundo (no de la habitación): de frente a la cabeza, sin inclinarse.
    g.lookAt(_fwd.x, y, _fwd.z);
  });
  if (controller?.inputSource.gripSpace) {
    return (
      <XRSpace space={controller.inputSource.gripSpace}>
        <group position={[0, 0.04, 0.07]} rotation-x={-1.1} {...press}>
          <MenuPill hover={hover} open={open} />
        </group>
      </XRSpace>
    );
  }
  const wrist = hand?.inputSource.hand?.get("wrist");
  if (!wrist) return null;
  return (
    <>
      <XRSpace space={wrist}>
        <object3D ref={anchor} />
      </XRSpace>
      <group ref={pill} {...press}>
        <MenuPill hover={hover} open={open} />
      </group>
    </>
  );
}

/** El botón Y del mando izquierdo abre y cierra el panel. */
function YButton() {
  const store = useXRStore();
  const was = useRef(false);
  const place = useRef(currentChunk());
  useFrame(() => {
    // Al cambiar de lugar, el panel se cierra.
    if (currentChunk() !== place.current) {
      place.current = currentChunk();
      menu.set(false);
    }
    const left = store.getState().inputSourceStates.find((s) => s.type === "controller" && s.inputSource.handedness === "left");
    const pressed = left?.type === "controller" && left.gamepad["y-button"]?.state === "pressed";
    if (pressed && !was.current) menu.set(!menu.open);
    was.current = !!pressed;
  });
  return null;
}

/** Todo lo del panel; va dentro de <XROrigin> (Player.tsx). */
export function VRMenu() {
  const open = useMenuOpen();
  // Al cambiar de lugar, el panel se cierra (y al salir de la VR).
  useEffect(() => () => menu.set(false), []);
  return (
    <>
      <YButton />
      <WristButton />
      {open && <FloatingPanel />}
    </>
  );
}
