/**
 * Lo que se ve de la gente en otra persona (Avatars.tsx), sin esperar a su pose: los golpes que le
 * llegan se dibujan aquí, a la vez que se ve llegar el puño (con el retraso de su pose, si el golpe
 * no es tuyo), y no medio segundo después cuando llegaría su propia reacción por la red.
 *
 *   - Golpe flojo: el gesto según de dónde viene, el tronco y la cabeza que ceden y el traspié, que se
 *     adelanta a su pose y se deshace al llegar ella (así no da saltos).
 *   - Golpe fuerte: cae con física aquí mismo (cada cliente simula a quien ve caer), se queda en el
 *     suelo y se levanta; al levantarse se va juntando con donde dice su pose.
 *   - En pareja: mira a la otra persona y lleva las manos a donde se encuentran (IK).
 *   - En modo pelea mira a quien tenga cerca en modo pelea.
 *
 * Sin objetos nuevos por frame.
 */
import * as THREE from "three";
import type { PairAction } from "@xenxo/protocol";
import { people, type HitEvent } from "../../net/people-store";
import { world } from "../../net/world-store";
import { floorAt } from "../collision";
import { self } from "../self";
import { fallFor, FALL_MAX, HIT_DELAY_MS, LIE, LIE_KO, lightReaction, myStrike, RISE, STRIKES, strikeOf } from "./fight";
import { impact, thud } from "./fight-audio";
import { loadRagdolls, ragdolls } from "./ragdoll";
import { createFx, type Lying, type PersonFx } from "./rig";
import { PAIR, pairTargets } from "./pair";
import { remoteFeet } from "./where";

type Phase = "none" | "react" | "fall" | "ground" | "roll" | "rise" | "clipfall" | "cliprise";
const REACTIONS = new Set(["hit_head", "hit_body", "hit_back", "hit_stagger", "hit_down", "get_up"]);

/** Cómo dibujar a la persona este frame. */
export interface RemoteDraw {
  x: number;
  y: number;
  z: number;
  yaw: number;
  emote: string | null;
  /** El cuerpo que cae ya la ha colocado (cadera): no tocar su grupo. */
  placed: boolean;
}

const _l: Lying = { x: 0, y: 0, z: 0, hx: 0, hz: 1, face: 0 };
const _o = new THREE.Vector3();
const _align = { x: 0, z: 0, yaw: 0 };

export class RemotePeople {
  readonly fx: PersonFx = createFx();
  private phase: Phase = "none";
  private t = 0;
  private dur = 0;
  private ko = false;
  private rolled = false;
  private emote: string | null = null;
  private queue: { h: HitEvent; due: number }[] = [];
  /** Traspié que se adelanta a su pose: velocidad, cuánto lleva y dónde estaba según la red al empezar. */
  private vx = 0;
  private vz = 0;
  private ax = 0;
  private az = 0;
  private corr = -1;
  /** Al levantarse: desde dónde y con qué giro (se junta con su pose). */
  private from = { x: 0, z: 0, yaw: 0 };
  private quiet = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private velX = 0;
  private velZ = 0;
  private lastY = 0;
  private lastVy = 0;
  private pair: { kind: PairAction; partner: string; t: number; on: boolean } | null = null;
  private offs: (() => void)[] = [];

  constructor(private id: string) {
    this.offs.push(
      people.onHit((h) => {
        if (h.to === id) this.queue.push({ h, due: performance.now() + (h.from === world.sessionId ? 0 : HIT_DELAY_MS) });
      }),
      people.onPair((p) => {
        if (p.a === id || p.b === id) this.pair = { kind: p.kind, partner: p.a === id ? p.b : p.a, t: 0, on: false };
      }),
    );
  }

  dispose() {
    for (const off of this.offs) off();
    this.fx.rig?.cancelFall();
  }

  /**
   * Un frame: `x, y, z` (pies) y `yaw` según su pose, y el gesto que trae. Rellena `out` con dónde y
   * cómo dibujarla; `group` es su grupo (lo coloca el cuerpo que cae).
   */
  frame(dt: number, group: THREE.Object3D, x: number, y: number, z: number, yaw: number, netEmote: string | null, out: RemoteDraw): RemoteDraw {
    dt = Math.min(dt, 0.1);
    // Su velocidad (para que la caída salga con la que llevaba).
    if (!Number.isNaN(this.lastX) && dt > 0) {
      this.velX += ((x - this.lastX) / dt - this.velX) * Math.min(1, dt * 8);
      this.velZ += ((z - this.lastZ) / dt - this.velZ) * Math.min(1, dt * 8);
    }
    this.lastX = x;
    this.lastZ = z;
    const now = performance.now();
    while (this.queue.length && this.queue[0]!.due <= now) this.receive(this.queue.shift()!.h, x, z, yaw);
    this.quiet = Math.max(0, this.quiet - dt);

    out.x = x;
    out.y = y;
    out.z = z;
    out.yaw = yaw;
    out.placed = false;
    // Tras una reacción dibujada aquí, la suya (que llega después por la red) no se repite.
    out.emote = netEmote && this.quiet > 0 && REACTIONS.has(netEmote) ? null : netEmote;
    this.look(x, y, z);
    this.pairFrame(dt, x, y, z, netEmote);

    // El traspié adelantado: lo que se predijo menos lo que ya ha llegado por la red.
    if (this.corr >= 0) {
      this.corr += dt;
      const k = Math.min(1, this.corr / this.dur);
      const s = (this.dur / 3) * (1 - (1 - k) ** 3);
      const fade = 1 - THREE.MathUtils.smoothstep(this.corr, 1.1, 1.9);
      out.x += (this.vx * s - (x - this.ax)) * fade;
      out.z += (this.vz * s - (z - this.az)) * fade;
      if (fade <= 0) this.corr = -1;
    }

    if (this.phase === "none") return out;
    this.t += dt;
    const rig = this.fx.rig;
    switch (this.phase) {
      case "react":
        out.emote = this.emote;
        if (this.t >= this.dur) this.end();
        break;
      case "fall":
      case "ground":
      case "roll": {
        if (!rig?.falling) {
          this.phase = "cliprise";
          this.t = 0;
          break;
        }
        rig.lying(_l);
        const floor = floorAt(_l.x, _l.z, _l.y + 0.5);
        group.position.set(_l.x, Number.isFinite(floor) ? floor : y, _l.z);
        out.placed = true;
        out.emote = "hit_down";
        if (this.phase === "fall") {
          const vy = (_l.y - this.lastY) / Math.max(dt, 1e-3);
          if (this.lastVy < -1.6 && vy > -0.4) thud(_l.x, _l.z, -this.lastVy);
          this.lastY = _l.y;
          this.lastVy = vy;
          if ((rig.fallStill > 0.3 && rig.fallAge > 0.7) || rig.fallAge > FALL_MAX) {
            this.phase = "ground";
            this.t = 0;
          }
        } else if (this.phase === "ground") {
          if (this.t >= (this.ko ? LIE_KO : LIE)) {
            if (_l.face < -0.3 && !this.rolled) {
              this.phase = "roll";
              this.t = 0;
              this.rolled = true;
              rig.rollOver(1);
            } else if (rig.endFall(_align)) {
              this.phase = "rise";
              this.t = 0;
              this.from.x = _align.x;
              this.from.z = _align.z;
              this.from.yaw = _align.yaw;
              this.rise(out, x, y, z, yaw);
            } else this.end();
          }
        } else if (_l.face > 0.35 || this.t > 1.3) {
          rig.rollOver(0);
          this.phase = "ground";
          this.t = Math.max(0, (this.ko ? LIE_KO : LIE) - 0.35);
        }
        break;
      }
      case "rise":
        this.rise(out, x, y, z, yaw);
        if (this.t >= RISE) this.end();
        break;
      case "clipfall":
        out.emote = "hit_down";
        if (this.t >= 2.2 + (this.ko ? LIE_KO : LIE)) {
          this.phase = "cliprise";
          this.t = 0;
        }
        break;
      case "cliprise":
        out.emote = "get_up";
        if (this.t >= RISE) this.end();
        break;
    }
    return out;
  }

  /** Levantándose: empieza donde quedó y se junta poco a poco con donde dice su pose. */
  private rise(out: RemoteDraw, x: number, y: number, z: number, yaw: number) {
    const k = THREE.MathUtils.smoothstep(this.t / RISE, 0.15, 1);
    out.x = this.from.x + (x - this.from.x) * k;
    out.z = this.from.z + (z - this.from.z) * k;
    const floor = floorAt(out.x, out.z, y + 0.8);
    out.y = Number.isFinite(floor) ? floor : y;
    let d = yaw - this.from.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    out.yaw = this.from.yaw + d * k * k;
    out.emote = "get_up";
  }

  private receive(h: HitEvent, x: number, z: number, yaw: number) {
    if (this.phase !== "none" && this.phase !== "react") return;
    this.ko = h.ko;
    this.rolled = false;
    this.t = 0;
    this.pair = null;
    this.fx.reachL.w = this.fx.reachR.w = 0;
    // Qué golpe era (su gesto): en la cara o en el cuerpo.
    const buf = world.poseBuffers.get(h.from);
    const attacker = h.from === world.sessionId ? STRIKES[myStrike.name] : strikeOf(buf?.[buf.length - 1]?.emote);
    const s = attacker ?? STRIKES[h.move === "punch" ? "punch" : h.move]!;
    const head = h.move === "punch" ? s.head : false;
    impact(x, z, h.power, head);
    this.quiet = 1.6;
    const rig = this.fx.rig;
    if (h.fall) {
      const sim = ragdolls();
      if (rig && sim && rig.startFall(sim, fallFor(h, head, this.velX, this.velZ))) {
        this.phase = "fall";
        rig.lying(_l);
        this.lastY = _l.y;
        this.lastVy = 0;
        this.corr = -1;
        return;
      }
      if (!sim) void loadRagdolls();
      this.phase = "clipfall";
      this.startCorr(h.dir[0] * 1.6, h.dir[1] * 1.6, 0.5, x, z);
      this.quiet = 2.2 + (h.ko ? LIE_KO : LIE) + RISE;
      return;
    }
    const r = lightReaction(h, yaw, head);
    this.phase = "react";
    this.dur = r.dur;
    this.emote = r.emote;
    this.startCorr(h.dir[0] * r.push, h.dir[1] * r.push, r.dur, x, z);
    rig?.flinch(h.dir[0], h.dir[1], h.power, head, s.twist ?? 0);
  }

  private startCorr(vx: number, vz: number, dur: number, x: number, z: number) {
    this.vx = vx;
    this.vz = vz;
    this.dur = dur;
    this.ax = x;
    this.az = z;
    this.corr = 0;
  }

  private end() {
    this.phase = "none";
    this.t = 0;
    this.quiet = Math.max(this.quiet, 1.2);
  }

  /** En modo pelea mira a quien tenga cerca en modo pelea (tú incluido). */
  private look(x: number, y: number, z: number) {
    const fx = this.fx;
    if (this.pair?.on) return;
    fx.look.w = 0;
    if (!people.fighters.has(this.id) || this.phase !== "none") return;
    let best = 25;
    const consider = (ox: number, oy: number, oz: number) => {
      const d2 = (ox - x) ** 2 + (oz - z) ** 2;
      if (d2 < best && d2 > 0.01) {
        best = d2;
        fx.look.x = ox;
        fx.look.y = oy + 1.5;
        fx.look.z = oz;
        fx.look.w = 0.75;
      }
    };
    if (people.fightOn && world.sessionId) consider(self.x, self.y, self.z);
    for (const other of people.fighters) {
      if (other === this.id) continue;
      const p = remotePos(other);
      if (p) consider(p.x, p.y, p.z);
    }
  }

  /** Su parte de una acción en pareja: empieza cuando su pose la empieza. */
  private pairFrame(dt: number, x: number, y: number, z: number, netEmote: string | null) {
    const p = this.pair;
    if (!p) return;
    if (!p.on) {
      if (netEmote === p.kind) p.on = true;
      else {
        p.t += dt;
        if (p.t > 3) this.pair = null;
        return;
      }
      p.t = 0;
    }
    p.t += dt;
    const where = p.partner === world.sessionId ? _o.set(self.x, self.y, self.z) : remotePos(p.partner);
    if (!where || p.t > PAIR[p.kind].s + 0.3) {
      this.pair = null;
      this.fx.look.w = this.fx.reachL.w = this.fx.reachR.w = 0;
      return;
    }
    pairTargets(p.kind, p.t, x, y, z, where, this.fx);
  }
}

/** Dónde se dibuja ahora a otra persona. */
const remotePos = (id: string) => remoteFeet.get(id) ?? null;

