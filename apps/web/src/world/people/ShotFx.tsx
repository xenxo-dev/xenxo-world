/**
 * Los disparos (§9 octies ter): el rayo de neón de cada uno (núcleo y halo, aditivos: brillan sin
 * post-proceso, también en las gafas y el móvil), el fogonazo en la boca del cañón y el chispazo
 * donde acaba (más grande si le da a alguien), con su sonido. Los tuyos salen al disparar; los de los
 * demás, con el retraso con que se les dibuja (como sus golpes: `world.drawLag`), desde su arma. Cuántos
 * a la vez, `FEATURES.shots`. Todo hecho de antemano: sin objetos nuevos por frame.
 */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { WEAPONS } from "@xenxo/protocol";
import { weapons } from "../../net/weapons";
import { world } from "../../net/world-store";
import { useGraphics } from "../graphics";
import { HIT_AFTER_MS } from "./fight";
import { zap, zapHit } from "./fight-audio";
import { muzzles } from "./arms";
import { SELF_GUN } from "./guns";

/** Cuánto dura cada cosa (s). */
const BEAM_S = 0.16;
const FLASH_S = 0.07;
const SPARK_S = 0.22;

interface Slot {
  core: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  halo: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  flash: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  spark: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  /** Cuándo empezó (s del reloj de la escena; −1: libre) y cuánto mide el rayo. */
  t0: number;
  len: number;
  hit: boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _white = new THREE.Color(1, 1, 1);

function additive(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
}

export function ShotFx() {
  const max = useGraphics().features.shots;
  const { group, slots, geo } = useMemo(() => {
    // El rayo: una caja de 1 m a lo largo de +Z que empieza en el origen (se estira con la escala).
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    const ball = new THREE.SphereGeometry(1, 10, 8);
    const group = new THREE.Group();
    const slots: Slot[] = [];
    for (let i = 0; i < max; i++) {
      const s: Slot = {
        core: new THREE.Mesh(box, additive()),
        halo: new THREE.Mesh(box, additive()),
        flash: new THREE.Mesh(ball, additive()),
        spark: new THREE.Mesh(ball, additive()),
        t0: -1,
        len: 0,
        hit: false,
      };
      for (const m of [s.core, s.halo, s.flash, s.spark]) {
        m.visible = false;
        m.frustumCulled = false;
        m.renderOrder = 3;
        group.add(m);
      }
      slots.push(s);
    }
    return { group, slots, geo: [box, ball] };
  }, [max]);
  useEffect(
    () => () => {
      for (const s of slots) for (const m of [s.core, s.halo, s.flash, s.spark]) m.material.dispose();
      for (const g of geo) g.dispose();
    },
    [slots, geo],
  );

  useFrame((state) => {
    const clock = state.clock.elapsedTime;
    const now = performance.now();
    // Los que tocan ya: al hueco más viejo (o a uno libre).
    const list = weapons.pending;
    for (let i = 0; i < list.length; ) {
      const ev = list[i]!;
      const mine = !!ev.p;
      if (!mine && now - ev.t < world.drawLag(ev.from) + HIT_AFTER_MS) {
        i++;
        continue;
      }
      list.splice(i, 1);
      // De su arma ahora (si se le ve), o de cerca de su cabeza.
      if (ev.p) _a.set(ev.p[0], ev.p[1], ev.p[2]);
      else {
        const m = muzzles.get(ev.from === world.sessionId ? SELF_GUN : ev.from);
        if (m && now - m.t < 300) _a.set(m.x, m.y, m.z);
        else {
          const buf = world.poseBuffers.get(ev.from);
          const h = buf?.[buf.length - 1]?.head.p;
          if (!h) continue;
          _a.set(h[0]!, h[1]! - 0.3, h[2]!);
        }
      }
      _b.set(ev.at[0], ev.at[1], ev.at[2]);
      let slot = slots[0]!;
      for (const s of slots) {
        if (s.t0 < 0) {
          slot = s;
          break;
        }
        if (s.t0 < slot.t0) slot = s;
      }
      const spec = WEAPONS[ev.weapon];
      const color = spec.color;
      const heavy = Math.min(1, spec.damage / 40);
      slot.t0 = clock;
      slot.hit = ev.hit;
      slot.len = _a.distanceTo(_b);
      slot.halo.material.color.set(color);
      slot.flash.material.color.set(color);
      slot.spark.material.color.set(color);
      slot.core.material.color.set(color).lerp(_white, 0.55);
      slot.core.position.copy(_a);
      slot.core.lookAt(_b);
      slot.halo.position.copy(_a);
      slot.halo.quaternion.copy(slot.core.quaternion);
      slot.flash.position.copy(_a);
      slot.spark.position.copy(_b);
      // Los de los demás suenan al verse (los tuyos sonaron al disparar).
      if (!mine) zap(_a.x, _a.z, heavy);
      if (ev.hit) zapHit(_b.x, _b.z, spec.power);
    }
    // Cada uno, apagándose.
    for (const s of slots) {
      if (s.t0 < 0) continue;
      const age = clock - s.t0;
      if (age > Math.max(BEAM_S, SPARK_S)) {
        s.t0 = -1;
        s.core.visible = s.halo.visible = s.flash.visible = s.spark.visible = false;
        continue;
      }
      const kb = 1 - age / BEAM_S;
      s.core.visible = s.halo.visible = kb > 0;
      if (kb > 0) {
        s.core.scale.set(0.022, 0.022, s.len);
        s.halo.scale.set(0.09 * (0.6 + 0.4 * kb), 0.09 * (0.6 + 0.4 * kb), s.len);
        s.core.material.opacity = kb;
        s.halo.material.opacity = 0.32 * kb;
      }
      const kf = 1 - age / FLASH_S;
      s.flash.visible = kf > 0;
      if (kf > 0) {
        s.flash.scale.setScalar(0.06 + 0.09 * (1 - kf));
        s.flash.material.opacity = kf;
      }
      const ks = 1 - age / SPARK_S;
      s.spark.visible = ks > 0;
      if (ks > 0) {
        s.spark.scale.setScalar((s.hit ? 0.09 : 0.06) + (s.hit ? 0.16 : 0.08) * (1 - ks));
        s.spark.material.opacity = ks * ks * (s.hit ? 0.85 : 0.55);
      }
    }
  });

  return <primitive object={group} />;
}
