/**
 * Sonidos de los juegos de pillar, sintetizados como los demás (Web Audio, sin archivos): los pitidos
 * de la cuenta atrás, el silbato de salida, el toque (más cerca, más fuerte), la alarma de «la llevas»
 * y lo de ganar o perder. Van por la misma salida que el ambiente: con el sonido apagado no suenan.
 */
import { ambient } from "./ambient-audio";
import { self } from "./self";

function tone(ctx: AudioContext, out: AudioNode, t: number, type: OscillatorType, hz: number, gain: number, dur: number, toHz?: number) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  if (toHz) o.frequency.exponentialRampToValueAtTime(toHz, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.03);
}

/** Un pitido de la cuenta atrás (el último, más agudo y largo). */
export function tagBeep(last = false) {
  const o = ambient.output();
  if (!o) return;
  tone(o.ctx, o.out, o.ctx.currentTime, "sine", last ? 1320 : 880, 0.16, last ? 0.42 : 0.12);
}

/** El silbato de salida: dos golpes de silbido. */
export function tagWhistle() {
  const o = ambient.output();
  if (!o) return;
  const t = o.ctx.currentTime;
  for (const [k, d] of [[0, 0.16], [0.22, 0.38]] as const) {
    tone(o.ctx, o.out, t + k, "triangle", 2400, 0.12, d, 2250);
    tone(o.ctx, o.out, t + k, "sine", 2700, 0.06, d, 2600);
  }
}

/** Un toque, donde ha sido: un «plop» con chasquido (más fuerte si lo das o te lo dan). */
export function tagTouch(x: number, z: number, mine: boolean) {
  const o = ambient.output();
  if (!o) return;
  const d2 = (x - self.x) ** 2 + (z - self.z) ** 2;
  const v = mine ? 1 : d2 > 900 ? 0 : 0.6 / (1 + d2 / 25);
  if (v < 0.02) return;
  const t = o.ctx.currentTime;
  tone(o.ctx, o.out, t, "sine", 620, 0.3 * v, 0.16, 1240);
  tone(o.ctx, o.out, t + 0.05, "square", 1560, 0.05 * v, 0.08);
}

/** Te la han pasado (o te han infectado): alarma corta, dos notas que bajan. */
export function tagAlarm() {
  const o = ambient.output();
  if (!o) return;
  const t = o.ctx.currentTime;
  tone(o.ctx, o.out, t, "sawtooth", 740, 0.09, 0.18, 700);
  tone(o.ctx, o.out, t + 0.2, "sawtooth", 554, 0.09, 0.3, 500);
}

/** Final: arpegio hacia arriba si has ganado; dos notas graves si no. */
export function tagEnd(won: boolean) {
  const o = ambient.output();
  if (!o) return;
  const t = o.ctx.currentTime;
  const notes = won ? [523, 659, 784, 1047] : [392, 294];
  notes.forEach((hz, i) => tone(o.ctx, o.out, t + i * (won ? 0.11 : 0.22), won ? "triangle" : "sine", hz, 0.14, won ? 0.32 : 0.4));
}
