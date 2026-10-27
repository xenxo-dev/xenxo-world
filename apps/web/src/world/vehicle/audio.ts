/**
 * Sonido del coche, sintetizado como el ambiente (Web Audio, sin archivos): el motor (dos ondas de
 * sierra filtradas que suben con las revoluciones y cambian de marcha), la rodadura (ruido grave
 * según la velocidad), el chirrido de las ruedas al derrapar y el golpe al chocar. Sale por la
 * misma salida que el ambiente: si el sonido está apagado, no suena.
 */
import { ambient } from "../ambient-audio";

interface Voice {
  ctx: AudioContext;
  out: GainNode;
  a: OscillatorNode;
  b: OscillatorNode;
  engine: GainNode;
  filter: BiquadFilterNode;
  road: GainNode;
  skid: GainNode;
  noise: AudioBuffer;
  srcs: AudioBufferSourceNode[];
}

let v: Voice | null = null;
let lastBang = 0;
/** Marcha (0-4) y su velocidad de cambio (m/s por marcha). */
const GEAR = 6.5;

function start(): Voice | null {
  const o = ambient.output();
  if (!o) return null;
  const { ctx, noise } = o;
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(o.out);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 700;
  filter.Q.value = 2;
  const engine = ctx.createGain();
  engine.gain.value = 0.25;
  const a = ctx.createOscillator();
  const b = ctx.createOscillator();
  a.type = "sawtooth";
  b.type = "square";
  a.connect(filter);
  b.connect(filter);
  filter.connect(engine).connect(out);
  const loop = (type: BiquadFilterType, hz: number, q: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(out);
    src.start();
    return { src, g };
  };
  const road = loop("lowpass", 260, 0.7);
  const skid = loop("bandpass", 1900, 3);
  a.start();
  b.start();
  out.gain.setTargetAtTime(0.9, ctx.currentTime, 0.3);
  return { ctx, out, a, b, engine, filter, road: road.g, skid: skid.g, noise, srcs: [road.src, skid.src] };
}

/** Cada frame mientras se conduce. `speed` en m/s, `throttle` de -1 a 1, `slip` y `impact` de la física. */
export function carSound(speed: number, throttle: number, slip: number, impact: number) {
  v ??= start();
  if (!v) return;
  const t = v.ctx.currentTime;
  const s = Math.abs(speed);
  const gear = Math.min(4, Math.floor(s / GEAR));
  const frac = Math.min(1, (s - gear * GEAR) / GEAR);
  // Ralentí a ~38 Hz; cada marcha sube y al cambiar baja (como un motor de verdad).
  const hz = 38 + frac * 62 + gear * 6 + Math.abs(throttle) * 9;
  v.a.frequency.setTargetAtTime(hz, t, 0.05);
  v.b.frequency.setTargetAtTime(hz * 0.5 * 1.01, t, 0.05);
  v.filter.frequency.setTargetAtTime(420 + Math.abs(throttle) * 900 + frac * 500, t, 0.08);
  v.engine.gain.setTargetAtTime(0.16 + Math.abs(throttle) * 0.14, t, 0.1);
  v.road.gain.setTargetAtTime(Math.min(0.5, s / 40), t, 0.2);
  v.skid.gain.setTargetAtTime(slip > 1.6 && s > 4 ? Math.min(0.35, (slip - 1.6) / 6) : 0, t, 0.06);
  // Golpe: un trozo de ruido grave que se apaga en medio segundo.
  if (impact > 2.5 && t - lastBang > 0.4) {
    lastBang = t;
    const src = v.ctx.createBufferSource();
    src.buffer = v.noise;
    const f = v.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 380;
    const g = v.ctx.createGain();
    g.gain.setValueAtTime(Math.min(1.4, impact / 8), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(f).connect(g).connect(v.out);
    src.start(t, Math.random() * 3, 0.6);
  }
}

/** Al bajarse: se apaga el motor. */
export function carSoundStop() {
  if (!v) return;
  const voice = v;
  v = null;
  const t = voice.ctx.currentTime;
  voice.out.gain.setTargetAtTime(0, t, 0.15);
  setTimeout(() => {
    for (const n of [voice.a, voice.b, ...voice.srcs]) n.stop();
    voice.out.disconnect();
  }, 900);
}
