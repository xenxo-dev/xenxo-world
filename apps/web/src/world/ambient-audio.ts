/**
 * Sonido ambiente de cada lugar, sintetizado en el navegador (Web Audio): sin archivos, sin
 * descargas y sin terceros. Un fondo continuo (rumor de ciudad, zumbido de neón, viento) y
 * sucesos sueltos cada pocos segundos (coches que pasan, drones, pitidos, golpes de taller,
 * pájaros de día…), distinto por lugar y por día o noche.
 *
 * Empieza con un gesto de la persona (entrar al mundo) y se apaga con el botón del HUD; la
 * preferencia se guarda en este navegador. Nada por frame: los sucesos van con temporizadores.
 */
import { useSyncExternalStore } from "react";
import { loadPref, savePref } from "../config";
import type { Ambience } from "./graphics";

type Theme = "plaza" | "nexo" | "cero" | "arcade" | "pixel" | "taller" | "agora" | "frontera" | "vertical" | "community";

interface Layer {
  /** Rumor grave (ruido filtrado) y su corte. */
  rumble: number;
  rumbleHz: number;
  /** Zumbido de neón (dos ondas desafinadas). */
  hum: number;
  /** Viento alto (ruido filtrado con vaivén). */
  wind: number;
  /** Sucesos por minuto y cuáles. */
  rate: number;
  events: Event[];
}

type Event = "flyby" | "drone" | "blip" | "chime" | "clank" | "bird" | "pad" | "steam" | "chatter";

const NIGHT: Record<Theme, Layer> = {
  plaza: { rumble: 0.18, rumbleHz: 260, hum: 0, wind: 0.05, rate: 8, events: ["chime", "chatter"] },
  nexo: { rumble: 0.12, rumbleHz: 180, hum: 0.03, wind: 0.16, rate: 6, events: ["pad", "flyby"] },
  cero: { rumble: 0.32, rumbleHz: 220, hum: 0.07, wind: 0.06, rate: 14, events: ["flyby", "drone", "pad", "steam", "blip"] },
  arcade: { rumble: 0.26, rumbleHz: 240, hum: 0.05, wind: 0.04, rate: 16, events: ["blip", "flyby", "blip", "chime"] },
  pixel: { rumble: 0.16, rumbleHz: 300, hum: 0.02, wind: 0.05, rate: 12, events: ["chime", "blip", "pad"] },
  taller: { rumble: 0.3, rumbleHz: 160, hum: 0.05, wind: 0.05, rate: 12, events: ["clank", "steam", "drone"] },
  agora: { rumble: 0.2, rumbleHz: 280, hum: 0, wind: 0.04, rate: 9, events: ["chatter", "chime"] },
  frontera: { rumble: 0.1, rumbleHz: 140, hum: 0.02, wind: 0.2, rate: 5, events: ["pad", "drone"] },
  vertical: { rumble: 0.28, rumbleHz: 200, hum: 0.04, wind: 0.08, rate: 12, events: ["clank", "chatter", "steam"] },
  community: { rumble: 0.22, rumbleHz: 240, hum: 0.04, wind: 0.06, rate: 10, events: ["flyby", "blip", "pad"] },
};

/** De día: más ciudad, menos neón, y pájaros donde hay árboles. */
function dayOf(l: Layer, theme: Theme): Layer {
  const birds = theme === "plaza" || theme === "pixel" || theme === "agora" || theme === "frontera";
  return {
    ...l,
    rumble: l.rumble * 1.15,
    rumbleHz: l.rumbleHz + 60,
    hum: l.hum * 0.35,
    rate: l.rate + (birds ? 6 : 0),
    events: birds ? [...l.events.filter((e) => e !== "pad"), "bird", "bird"] : l.events.filter((e) => e !== "pad"),
  };
}

/* --- Preferencia (se guarda en este navegador) --- */

let enabled = loadPref<boolean>("ambientSound", true);
let version = 0;
const listeners = new Set<() => void>();
function emit() {
  version++;
  for (const fn of listeners) fn();
}
export function useAmbientSound(): boolean {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return enabled;
}
export function setAmbientSound(on: boolean) {
  enabled = on;
  savePref("ambientSound", on);
  emit();
  void ambient.apply();
}

/* --- Motor --- */

class AmbientAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private bed: { rumble: GainNode; rumbleF: BiquadFilterNode; hum: GainNode; wind: GainNode; rain: GainNode } | null = null;
  private rainLevel = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private theme: Theme = "plaza";
  private ambience: Ambience = "night";
  private active = false;

  /** Crear el contexto solo tras un gesto (los navegadores lo exigen). */
  unlock() {
    if (this.ctx || typeof AudioContext === "undefined") return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // Ruido rosa de 4 s en bucle: la base de casi todo.
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0527;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
    this.noise = buf;
    this.buildBed();
    document.addEventListener("visibilitychange", () => void this.apply());
    void this.apply();
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random() * 3;
    return src;
  }

  private buildBed() {
    const ctx = this.ctx!, out = this.master!;
    const rumble = ctx.createGain();
    const rumbleF = ctx.createBiquadFilter();
    rumbleF.type = "lowpass";
    rumbleF.frequency.value = 220;
    const n1 = this.loopNoise();
    n1.connect(rumbleF).connect(rumble).connect(out);
    n1.start();

    const hum = ctx.createGain();
    const humF = ctx.createBiquadFilter();
    humF.type = "lowpass";
    humF.frequency.value = 400;
    for (const f of [55, 110.4, 165.2]) {
      const o = ctx.createOscillator();
      o.type = f === 55 ? "sine" : "sawtooth";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f === 55 ? 0.6 : 0.08;
      o.connect(g).connect(humF);
      o.start();
    }
    humF.connect(hum).connect(out);

    const wind = ctx.createGain();
    const windF = ctx.createBiquadFilter();
    windF.type = "bandpass";
    windF.frequency.value = 700;
    windF.Q.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 350;
    lfo.connect(lfoG).connect(windF.frequency);
    lfo.start();
    const n2 = this.loopNoise();
    n2.connect(windF).connect(wind).connect(out);
    n2.start();

    // Lluvia: ruido agudo y un poco de grave (gotas en charcos); su nivel lo dice la escena.
    const rain = ctx.createGain();
    rain.gain.value = 0;
    const rainHi = ctx.createBiquadFilter();
    rainHi.type = "highpass";
    rainHi.frequency.value = 1800;
    const rainLo = ctx.createBiquadFilter();
    rainLo.type = "lowpass";
    rainLo.frequency.value = 9000;
    const n3 = this.loopNoise();
    n3.connect(rainHi).connect(rainLo).connect(rain).connect(out);
    n3.start();

    this.bed = { rumble, rumbleF, hum, wind, rain };
  }

  /** Lugar y ambiente actuales (los dice la escena al cambiar). */
  setPlace(theme: string, ambience: Ambience) {
    const t = (theme in NIGHT ? theme : "community") as Theme;
    if (t === this.theme && ambience === this.ambience) return;
    this.theme = t;
    this.ambience = ambience;
    void this.apply();
  }

  /** Cuánto llueve donde estás (0–1; lo dice la escena unas veces por segundo, no por frame). */
  setRain(level: number) {
    const v = Math.round(level * 20) / 20;
    if (v === this.rainLevel) return;
    this.rainLevel = v;
    if (this.ctx && this.bed) this.bed.rain.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 2);
  }

  /** En el mundo (no en el panel ni dentro de un juego). */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    void this.apply();
  }

  private layer(): Layer {
    const l = NIGHT[this.theme];
    return this.ambience === "day" ? dayOf(l, this.theme) : l;
  }

  async apply() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.bed) return;
    const on = enabled && this.active && document.visibilityState === "visible";
    const now = ctx.currentTime;
    if (on && ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(on ? 0.55 : 0, now, 0.6);
    const l = this.layer();
    this.bed.rumble.gain.setTargetAtTime(l.rumble, now, 1.5);
    this.bed.rumbleF.frequency.setTargetAtTime(l.rumbleHz, now, 1.5);
    this.bed.hum.gain.setTargetAtTime(l.hum, now, 1.5);
    this.bed.wind.gain.setTargetAtTime(l.wind, now, 1.5);
    this.bed.rain.gain.setTargetAtTime(this.rainLevel * 0.5, now, 1.5);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (on) this.schedule();
    else if (ctx.state === "running") setTimeout(() => !this.active || !enabled ? void ctx.suspend().catch(() => undefined) : undefined, 1500);
  }

  private schedule() {
    const l = this.layer();
    const wait = (60_000 / Math.max(1, l.rate)) * (0.4 + Math.random() * 1.2);
    this.timer = setTimeout(() => {
      const ev = l.events[Math.floor(Math.random() * l.events.length)];
      if (ev) this.play(ev);
      this.schedule();
    }, wait);
  }

  /* --- Sucesos --- */

  private pan(): StereoPannerNode {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    return p;
  }

  private play(ev: Event) {
    const ctx = this.ctx!, out = this.master!, t = ctx.currentTime;
    const env = (g: GainNode, peak: number, a: number, d: number) => {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    };
    const tone = (type: OscillatorType, f: number, at: number, dur: number, peak: number, to?: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t + at);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + at + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(peak, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g).connect(pan);
      o.start(t + at);
      o.stop(t + at + dur + 0.05);
    };
    const pan = this.pan();
    pan.connect(out);
    switch (ev) {
      case "flyby": {
        // Coche volador: ruido con filtro que sube y baja y cruza de lado a lado.
        const n = this.loopNoise();
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.Q.value = 1.2;
        f.frequency.setValueAtTime(300, t);
        f.frequency.exponentialRampToValueAtTime(1400, t + 1.1);
        f.frequency.exponentialRampToValueAtTime(260, t + 2.6);
        const g = ctx.createGain();
        env(g, 0.35, 1.1, 1.6);
        const side = Math.random() < 0.5 ? -1 : 1;
        pan.pan.setValueAtTime(-0.9 * side, t);
        pan.pan.linearRampToValueAtTime(0.9 * side, t + 2.6);
        n.connect(f).connect(g).connect(pan);
        n.start(t);
        n.stop(t + 2.8);
        return;
      }
      case "drone": {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(180 + Math.random() * 60, t);
        const vib = ctx.createOscillator();
        vib.frequency.value = 23;
        const vg = ctx.createGain();
        vg.gain.value = 6;
        vib.connect(vg).connect(o.frequency);
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 900;
        const g = ctx.createGain();
        env(g, 0.05, 1.2, 2.4);
        o.connect(f).connect(g).connect(pan);
        o.start(t);
        vib.start(t);
        o.stop(t + 3.8);
        vib.stop(t + 3.8);
        return;
      }
      case "blip": {
        // Máquinas recreativas: un arpegio corto de onda cuadrada, lejos.
        const base = [523.25, 659.25, 783.99, 1046.5];
        const k = Math.floor(Math.random() * 3);
        for (let i = 0; i < 3 + k; i++) tone("square", base[(i + k) % 4]! * (Math.random() < 0.3 ? 0.5 : 1), i * 0.09, 0.09, 0.025);
        return;
      }
      case "chime": {
        const notes = [659.25, 783.99, 987.77, 1174.66];
        for (let i = 0; i < 2; i++) tone("sine", notes[Math.floor(Math.random() * 4)]!, i * 0.35, 1.6, 0.03);
        return;
      }
      case "clank": {
        // Golpe metálico: ruido muy corto en una banda estrecha, con eco de nave.
        const n = this.loopNoise();
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 900 + Math.random() * 1800;
        f.Q.value = 18;
        const g = ctx.createGain();
        env(g, 0.5, 0.003, 0.5);
        const dl = ctx.createDelay();
        dl.delayTime.value = 0.23;
        const fb = ctx.createGain();
        fb.gain.value = 0.35;
        n.connect(f).connect(g);
        g.connect(pan);
        g.connect(dl).connect(fb).connect(dl);
        fb.connect(pan);
        n.start(t);
        n.stop(t + 0.6);
        return;
      }
      case "steam": {
        const n = this.loopNoise();
        const f = ctx.createBiquadFilter();
        f.type = "highpass";
        f.frequency.value = 2500;
        const g = ctx.createGain();
        env(g, 0.12, 0.05, 1.4);
        n.connect(f).connect(g).connect(pan);
        n.start(t);
        n.stop(t + 1.6);
        return;
      }
      case "bird": {
        const f0 = 2600 + Math.random() * 1400;
        for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) tone("sine", f0, i * 0.13, 0.08, 0.02, f0 * 1.4);
        return;
      }
      case "pad": {
        // Acorde lento de sintetizador, muy bajo.
        const chord = [[110, 164.81, 220], [98, 146.83, 196], [87.31, 130.81, 174.61]][Math.floor(Math.random() * 3)]!;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 700;
        const g = ctx.createGain();
        env(g, 0.06, 2.5, 4);
        f.connect(g).connect(pan);
        for (const hz of chord) {
          const o = ctx.createOscillator();
          o.type = "sawtooth";
          o.frequency.value = hz;
          o.detune.value = Math.random() * 14 - 7;
          o.connect(f);
          o.start(t);
          o.stop(t + 6.6);
        }
        return;
      }
      case "chatter": {
        // Murmullo de gente lejos: ruido en la banda de la voz con vaivén rápido.
        const n = this.loopNoise();
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 520;
        f.Q.value = 1.8;
        const am = ctx.createOscillator();
        am.frequency.value = 4 + Math.random() * 3;
        const amG = ctx.createGain();
        amG.gain.value = 0.03;
        const g = ctx.createGain();
        env(g, 0.05, 0.8, 2.2);
        am.connect(amG).connect(g.gain);
        n.connect(f).connect(g).connect(pan);
        n.start(t);
        am.start(t);
        n.stop(t + 3.1);
        am.stop(t + 3.1);
        return;
      }
    }
  }
}

export const ambient = new AmbientAudio();
