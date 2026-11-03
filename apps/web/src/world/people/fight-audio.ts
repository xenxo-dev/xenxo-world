/**
 * Sonidos de la gente al pelear, sintetizados como el ambiente y el coche (Web Audio, sin archivos):
 * el silbido del golpe que corta el aire, el golpe que llega (seco en la cara, más sordo en el cuerpo)
 * y el cuerpo contra el suelo. Suenan más flojos cuanto más lejos y por la misma salida que el
 * ambiente: si el sonido está apagado, no suenan.
 */
import { ambient } from "../ambient-audio";
import { self } from "../self";

let last = 0;

/** Volumen según la distancia al jugador (y nada a más de 25 m). */
function gainAt(x: number, z: number): number {
  const d2 = (x - self.x) ** 2 + (z - self.z) ** 2;
  return d2 > 625 ? 0 : 1 / (1 + d2 / 16);
}

function burst(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, t: number, type: BiquadFilterType, hz: number, q: number, gain: number, dur: number, sweepTo?: number) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(hz, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.25));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 3, dur + 0.05);
}

function thump(ctx: AudioContext, out: AudioNode, t: number, hz: number, gain: number, dur: number) {
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(hz, t);
  o.frequency.exponentialRampToValueAtTime(hz * 0.45, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** El golpe corta el aire (más largo y grave en las patadas). */
export function whoosh(x: number, z: number, heavy = false) {
  const o = ambient.output();
  const v = gainAt(x, z);
  if (!o || v < 0.02) return;
  const t = o.ctx.currentTime;
  burst(o.ctx, o.out, o.noise, t, "bandpass", heavy ? 500 : 900, 1.4, 0.32 * v, heavy ? 0.24 : 0.16, heavy ? 1400 : 2600);
}

/** Llega el golpe: en la cara, seco; en el cuerpo, sordo; cuanto más fuerte, más grave y largo. */
export function impact(x: number, z: number, power: number, head: boolean) {
  const o = ambient.output();
  const v = gainAt(x, z);
  if (!o || v < 0.02) return;
  const t = o.ctx.currentTime;
  if (t - last < 0.05) return;
  last = t;
  const k = 0.5 + power * 0.5;
  thump(o.ctx, o.out, t, head ? 140 : 95, 0.9 * v * k, head ? 0.12 : 0.2);
  burst(o.ctx, o.out, o.noise, t, head ? "highpass" : "lowpass", head ? 1800 : 700, 0.8, (head ? 0.7 : 0.5) * v * k, head ? 0.06 : 0.1);
}

/** El cuerpo contra el suelo. */
export function thud(x: number, z: number, strength: number) {
  const o = ambient.output();
  const v = gainAt(x, z);
  if (!o || v < 0.02) return;
  const t = o.ctx.currentTime;
  const k = Math.min(1, strength / 4);
  thump(o.ctx, o.out, t, 70, 0.8 * v * k, 0.28);
  burst(o.ctx, o.out, o.noise, t, "lowpass", 420, 0.7, 0.55 * v * k, 0.3);
}

/* --- Armas (§9 octies ter): blásteres de juguete --- */

let lastZap = 0;

/**
 * El disparo: un «piu» de juguete (un tono que cae deprisa, con un poco de soplo). `heavy` (0–1):
 * las grandes, más grave, más largo y con golpe de fondo.
 */
export function zap(x: number, z: number, heavy: number) {
  const o = ambient.output();
  const v = gainAt(x, z);
  if (!o || v < 0.02) return;
  const t = o.ctx.currentTime;
  // Las de ráfaga disparan muy seguido: como mucho uno cada 50 ms.
  if (t - lastZap < 0.05) return;
  lastZap = t;
  const dur = 0.13 + heavy * 0.16;
  const osc = o.ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(1900 - heavy * 950, t);
  osc.frequency.exponentialRampToValueAtTime(240 - heavy * 120, t + dur);
  const f = o.ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(3600, t);
  f.frequency.exponentialRampToValueAtTime(900, t + dur);
  const g = o.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.2 * v, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(f).connect(g).connect(o.out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  burst(o.ctx, o.out, o.noise, t, "bandpass", 2400 - heavy * 1200, 1.1, 0.12 * v, 0.05 + heavy * 0.05);
  if (heavy > 0.45) thump(o.ctx, o.out, t, 110, 0.55 * v * heavy, 0.16);
}

/** El rayo llega a alguien: un chasquido eléctrico corto. */
export function zapHit(x: number, z: number, power: number) {
  const o = ambient.output();
  const v = gainAt(x, z);
  if (!o || v < 0.02) return;
  const t = o.ctx.currentTime;
  burst(o.ctx, o.out, o.noise, t, "highpass", 2600, 0.9, (0.35 + power * 0.3) * v, 0.07);
  thump(o.ctx, o.out, t, 180, 0.35 * v * (0.5 + power), 0.08);
}
