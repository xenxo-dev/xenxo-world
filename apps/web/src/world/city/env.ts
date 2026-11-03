/**
 * Lo que los ciudadanos (city/citizens.ts) necesitan del mundo, en el navegador: tú (self.ts), las
 * demás personas (sus poses, donde se las ve, y si están en modo pelea), tu coche y los de los demás,
 * el cuerpo y el suelo de verdad (locomotion.stepBody contra las mismas cajas y mallas que tu
 * personaje), las caídas (knock.ts), las acciones en pareja (selfPeople.ts) y la red, para que sean
 * los mismos para todos (net/npc-store.ts). Las pruebas (test/citizens.mts) ponen otro.
 */
import { people } from "../../net/people-store";
import { npcLink } from "../../net/npc-store";
import { world } from "../../net/world-store";
import { npcs } from "../collision";
import { stepBody, type Body } from "../locomotion";
import { knockApply, knockReset } from "../knock";
import { startLocalPair } from "../people/selfPeople";
import { remoteFeet } from "../people/where";
import { self } from "../self";
import { drive } from "../vehicle/drive-state";
import type { CarInfo, CityEnv, Me, Remote } from "./citizens";

/** Un subpaso de 1/30 s basta para andar (4 cm por paso; el jugador va a 1/120 s: corre y salta). */
const STEP_OPTS = { people: false, substep: 1 / 30 };
const STALE_MS = 3000;

const me: Me = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, wx: 0, wz: 0, emote: null, driving: false, fight: false };
const car: CarInfo = { x: 0, z: 0, fx: 0, fz: 1, speed: 0, who: "me" };

export const cityEnv: CityEnv = {
  me,
  sync() {
    me.x = self.x;
    me.y = self.y;
    me.z = self.z;
    me.yaw = self.yaw;
    me.vx = self.vx;
    me.vz = self.vz;
    me.wx = self.wx;
    me.wz = self.wz;
    me.emote = self.emote;
    me.driving = self.driving;
    me.fight = self.fight;
  },
  remotes(out: Remote[]) {
    if (world.solo) return 0;
    let n = 0;
    const now = world.serverNow();
    for (const [id, buf] of world.poseBuffers) {
      if (n >= out.length) break;
      const s = buf[buf.length - 1];
      if (!s || s.vehicle || now - s.t > STALE_MS || id === world.sessionId) continue;
      const o = out[n++]!;
      const [qx, qy, qz, qw] = s.head.r;
      // Donde se la dibuja (sus pies) o, si aún no, bajo su cabeza.
      const feet = remoteFeet.get(id);
      o.id = id;
      o.x = feet ? feet.x : s.head.p[0]!;
      o.y = feet ? feet.y : s.head.p[1]! - 1.6;
      o.z = feet ? feet.z : s.head.p[2]!;
      o.yaw = Math.atan2(2 * (qw! * qy! + qx! * qz!), 1 - 2 * (qy! * qy! + qx! * qx!));
      o.emote = s.emote ?? null;
      o.fight = people.fighters.has(id);
    }
    return n;
  },
  car() {
    const sim = drive.sim;
    if (!sim?.active || (drive.phase !== "drive" && drive.phase !== "stop")) return null;
    const s = sim.state;
    const fx = 2 * (s.qx * s.qz + s.qw * s.qy), fz = 1 - 2 * (s.qx * s.qx + s.qy * s.qy);
    const l = Math.hypot(fx, fz) || 1;
    // Hacia donde va (marcha atrás, al revés del morro).
    const dir = s.speed < 0 ? -1 : 1;
    car.x = s.x;
    car.z = s.z;
    car.fx = (fx / l) * dir;
    car.fz = (fz / l) * dir;
    car.speed = Math.abs(s.speed);
    car.who = "me";
    return car;
  },
  cars(out: CarInfo[]) {
    let n = 0;
    const mine = cityEnv.car();
    if (mine) Object.assign(out[n++]!, mine);
    // Los de los demás: por sus dos últimas poses (dónde, hacia dónde y a qué velocidad).
    const now = world.serverNow();
    for (const [id, buf] of world.poseBuffers) {
      if (n >= out.length) break;
      const s1 = buf[buf.length - 1], s0 = buf[buf.length - 2];
      if (!s1?.car || s1.vehicle !== "car" || !s0?.car || now - s1.t > 1500 || id === world.sessionId) continue;
      const dt = (s1.t - s0.t) / 1000;
      if (!(dt > 0.02)) continue;
      const [qx, qy, qz, qw] = s1.car.r;
      const fx = 2 * (qx! * qz! + qw! * qy!), fz = 1 - 2 * (qx! * qx! + qy! * qy!);
      const l = Math.hypot(fx, fz) || 1;
      const mx = s1.car.p[0]! - s0.car.p[0]!, mz = s1.car.p[2]! - s0.car.p[2]!;
      const dir = mx * fx + mz * fz < 0 ? -1 : 1;
      const o = out[n++]!;
      o.x = s1.car.p[0]!;
      o.z = s1.car.p[2]!;
      o.fx = (fx / l) * dir;
      o.fz = (fz / l) * dir;
      o.speed = Math.hypot(mx, mz) / dt;
      o.who = id;
    }
    return n;
  },
  step(b: Body, wantX: number, wantZ: number, dt: number) {
    stepBody(b, wantX, wantZ, dt, world.walk[0], world.walk[1], STEP_OPTS);
  },
  knock: (i, g, x, y, z, yaw, m) => knockApply(i, g, x, y, z, yaw, m, true),
  knockReset,
  pair: (kind, key) => startLocalPair(kind, key),
  npcs,
  link: npcLink,
};
