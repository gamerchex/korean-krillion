// Original procedural audio: nothing is sampled or downloaded. Everything is synthesized in
// WebAudio at run time:
//   - an underwater ambience (filtered noise swell + a slow two-oscillator drone) that darkens
//     with depth,
//   - sparse generative plucks on a Korean pentatonic scale, voiced with a Karplus-Strong
//     string model (a gayageum-like timbre),
//   - effects: submit, accept (arpeggio that grows with rarity), reject, clock ticks, bubbles,
//     sonar ping, and a temple bell (beomjong) built from inharmonic partials with the slow
//     beating Korean bells are known for.
// Audio starts only after a user gesture, and music and effects have separate volumes.

type Tier = 'none' | 'common' | 'uncommon' | 'rare' | 'very-rare' | 'extremely-rare' | 'legendary';

// Hwang-tae-jung-im-nam style pentatonic around E-flat.
const SCALE = [155.56, 174.61, 207.65, 233.08, 261.63, 311.13, 349.23, 415.3, 466.16, 523.25];
const TIER_STEPS: Record<Tier, number> = { none: 0, common: 1, uncommon: 2, rare: 3, 'very-rare': 4, 'extremely-rare': 5, legendary: 7 };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneOsc: OscillatorNode[] = [];
  private noiseFilter: BiquadFilterNode | null = null;
  private pluckTimer: number | null = null;
  private pluckCache = new Map<number, AudioBuffer>();
  private vol = { music: 0.5, sfx: 0.7, muted: false };
  private depth = 0;
  private ambienceOn = false;

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Call from a user gesture (click / key press). Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor() as AudioContext;
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.music = this.ctx.createGain();
        this.sfx = this.ctx.createGain();
        this.music.connect(this.master);
        this.sfx.connect(this.master);
        this.applyVolumes();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (!this.ambienceOn) this.startAmbience();
    } catch {
      this.ctx = null;
    }
  }

  setVolumes(music: number, sfx: number, muted: boolean): void {
    this.vol = { music, sfx, muted };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.music || !this.sfx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.muted ? 0 : 1, t, 0.05);
    this.music.gain.setTargetAtTime(this.vol.music * 0.6, t, 0.1);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  /** Deeper water: darker filter, lower drone. */
  setDepth(m: number): void {
    this.depth = m;
    if (!this.ctx) return;
    const f = Math.max(0, Math.min(1, m / 7000));
    const t = this.ctx.currentTime;
    this.droneFilter?.frequency.setTargetAtTime(900 - 700 * f, t, 1.5);
    this.noiseFilter?.frequency.setTargetAtTime(520 - 380 * f, t, 1.5);
    const base = 55 - 14 * f;
    this.droneOsc[0]?.frequency.setTargetAtTime(base, t, 2);
    this.droneOsc[1]?.frequency.setTargetAtTime(base * 1.5 * 1.003, t, 2);
  }

  private noiseBuffer(seconds: number, brown = false): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  private startAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || !this.music) return;
    this.ambienceOn = true;
    // Underwater rumble: looping brown noise through a swelling low-pass.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(6, true);
    noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'lowpass';
    this.noiseFilter.frequency.value = 520;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.22;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.07;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.1;
    swell.connect(swellDepth).connect(noiseGain.gain);
    noise.connect(this.noiseFilter).connect(noiseGain).connect(this.music);
    noise.start();
    swell.start();
    // Drone: a fifth, slightly detuned, very soft.
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 900;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;
    for (const [freq, type] of [[55, 'sine'], [82.6, 'triangle']] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(this.droneFilter);
      o.start();
      this.droneOsc.push(o);
    }
    this.droneFilter.connect(droneGain).connect(this.music);
    this.setDepth(this.depth);
    this.schedulePluck();
  }

  private schedulePluck(): void {
    const wait = 2600 + Math.random() * 4200;
    this.pluckTimer = (setTimeout as any)(() => {
      if (this.ctx && this.music && !this.vol.muted && this.vol.music > 0) {
        const deep = this.depth / 7000;
        const idx = Math.floor(Math.random() * (SCALE.length - 3 * deep));
        this.pluck(SCALE[Math.max(0, idx)] / (deep > 0.6 ? 2 : 1), this.music, 0.18, 0.4);
        if (Math.random() < 0.35) {
          setTimeout(() => this.pluck(SCALE[Math.min(SCALE.length - 1, idx + 2)] / (deep > 0.6 ? 2 : 1), this.music!, 0.12, 0.4), 220 + Math.random() * 260);
        }
      }
      this.schedulePluck();
    }, wait);
  }

  /** Karplus-Strong plucked string, rendered once per pitch and cached. */
  private pluckBuffer(freq: number): AudioBuffer {
    const key = Math.round(freq * 10);
    const hit = this.pluckCache.get(key);
    if (hit) return hit;
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 2.2);
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const period = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0;
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const cur = ring[idx];
      const next = ring[(idx + 1) % period];
      const v = 0.4985 * (cur + next);
      ring[idx] = v;
      // gentle body resonance + slow fade
      prev = prev * 0.6 + cur * 0.4;
      out[i] = prev * Math.min(1, (len - i) / (sr * 0.3));
      idx = (idx + 1) % period;
    }
    this.pluckCache.set(key, buf);
    return buf;
  }

  private pluck(freq: number, dest: AudioNode, gain = 0.35, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.pluckBuffer(freq);
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) {
      p.pan.value = (Math.random() * 2 - 1) * pan;
      src.connect(g).connect(p).connect(dest);
    } else src.connect(g).connect(dest);
    // Nonghyeon-style bend: a slight pitch lift right after the attack.
    src.playbackRate.setValueAtTime(1, ctx.currentTime);
    src.playbackRate.linearRampToValueAtTime(1.012, ctx.currentTime + 0.18);
    src.playbackRate.linearRampToValueAtTime(1, ctx.currentTime + 0.5);
    src.start();
  }

  private env(node: AudioParam, t: number, peak: number, attack: number, decay: number): void {
    node.cancelScheduledValues(t);
    node.setValueAtTime(0.0001, t);
    node.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    node.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(freq: number, type: OscillatorType, peak: number, attack: number, decay: number, delay = 0, endFreq?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + attack + decay);
    const g = ctx.createGain();
    this.env(g.gain, t, peak, attack, decay);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  tick(urgent = false): void {
    this.tone(urgent ? 1760 : 1320, 'square', urgent ? 0.05 : 0.025, 0.002, 0.04);
  }

  submit(): void {
    this.tone(420, 'sine', 0.12, 0.005, 0.12, 0, 260);
    this.bubbles(3);
  }

  accept(tier: Tier): void {
    if (!this.ctx || !this.sfx) return;
    const steps = TIER_STEPS[tier] || 1;
    for (let i = 0; i < Math.min(steps, 6); i++) {
      setTimeout(() => this.pluck(SCALE[Math.min(SCALE.length - 1, 3 + i)], this.sfx!, 0.38, 0.3), i * 95);
    }
    if (steps >= 5) setTimeout(() => this.bell(0.5), steps * 95);
    this.bubbles(2 + steps);
  }

  reject(): void {
    this.tone(150, 'sine', 0.3, 0.005, 0.35, 0, 70);
    this.tone(95, 'triangle', 0.12, 0.005, 0.3, 0.05, 60);
  }

  timeout(): void {
    this.tone(330, 'triangle', 0.14, 0.01, 0.25);
    this.tone(247, 'triangle', 0.14, 0.01, 0.4, 0.18);
  }

  bubbles(n = 4): void {
    for (let i = 0; i < n; i++) {
      const f = 300 + Math.random() * 500;
      this.tone(f, 'sine', 0.05 + Math.random() * 0.04, 0.004, 0.07 + Math.random() * 0.06, i * (0.04 + Math.random() * 0.08), f * 2.2);
    }
  }

  sonar(): void {
    this.tone(1046, 'sine', 0.12, 0.004, 1.2);
    this.tone(1046, 'sine', 0.04, 0.004, 1.0, 0.45);
  }

  /** Temple bell: inharmonic partials, long decay, slow "maeari" beating from a detuned pair. */
  bell(scale = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const base = 98;
    const partials: Array<[number, number, number]> = [
      [0.5, 0.35, 9], [1, 0.5, 7], [1.004, 0.4, 7], [1.183, 0.25, 5], [1.506, 0.2, 4], [2.0, 0.18, 3.5], [2.74, 0.1, 2.5], [3.76, 0.06, 1.8],
    ];
    for (const [ratio, amp, dec] of partials) this.tone(base * ratio, 'sine', amp * 0.22 * scale, 0.006, dec * scale);
    // the strike
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.08);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    this.env(g.gain, ctx.currentTime, 0.15 * scale, 0.002, 0.08);
    src.connect(f).connect(g).connect(this.sfx);
    src.start();
  }

  unlockChime(): void {
    [0, 2, 4, 7].forEach((s, i) => setTimeout(() => this.pluck(SCALE[Math.min(SCALE.length - 1, s)] * 2, this.sfx!, 0.25, 0.5), i * 120));
  }

  dispose(): void {
    if (this.pluckTimer !== null) clearTimeout(this.pluckTimer);
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.ambienceOn = false;
  }
}

export const audio = new AudioEngine();
