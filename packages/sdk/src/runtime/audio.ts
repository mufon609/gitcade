/**
 * Audio player. Synthesizes simple tones via Web Audio when available, and
 * NO-OPS cleanly when it is not (jsdom/headless smoke tests, SSR). This is a hard
 * requirement: the 60-frame smoke test runs with no `AudioContext`, and triggering
 * a sound must never throw.
 *
 * Phase 2B replaces these primitive beeps with full synthesized SFX/music; the
 * `play(key)` surface stays stable.
 */
export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private available: boolean;
  private muted = false;

  constructor() {
    this.available = AudioPlayer.isSupported();
  }

  static isSupported(): boolean {
    if (typeof globalThis === "undefined") return false;
    const g = globalThis as unknown as {
      AudioContext?: unknown;
      webkitAudioContext?: unknown;
    };
    return typeof g.AudioContext === "function" || typeof g.webkitAudioContext === "function";
  }

  /** Lazily create the context on first real use (after a user gesture in browsers). */
  private context(): AudioContext | null {
    if (!this.available || this.muted) return null;
    if (this.ctx) return this.ctx;
    try {
      const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctor = g.AudioContext ?? g.webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      this.available = false;
      return null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /**
   * Play a named sound. v1 maps a small set of keys to tones; unknown keys play a
   * neutral blip. Always safe to call — returns immediately and never throws.
   */
  play(key: string, opts: { volume?: number } = {}): void {
    const ctx = this.context();
    if (!ctx) return; // headless / unsupported → no-op
    try {
      const preset = TONES[key] ?? TONES.__default;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = preset.wave;
      osc.frequency.setValueAtTime(preset.freq, now);
      if (preset.sweepTo) osc.frequency.exponentialRampToValueAtTime(preset.sweepTo, now + preset.dur);
      const vol = (opts.volume ?? 0.2) * preset.gain;
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + preset.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + preset.dur);
    } catch {
      /* never let audio break a frame */
    }
  }

  /** Resume a suspended context (call from a user-gesture handler in browsers). */
  resume(): void {
    const ctx = this.context();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }
}

interface Tone {
  wave: OscillatorType;
  freq: number;
  sweepTo?: number;
  dur: number;
  gain: number;
}

const TONES: Record<string, Tone> = {
  __default: { wave: "square", freq: 440, dur: 0.08, gain: 1 },
  hit: { wave: "square", freq: 220, dur: 0.06, gain: 1 },
  bounce: { wave: "triangle", freq: 520, dur: 0.05, gain: 0.9 },
  score: { wave: "sawtooth", freq: 330, sweepTo: 660, dur: 0.18, gain: 1 },
  win: { wave: "triangle", freq: 523, sweepTo: 1046, dur: 0.3, gain: 1 },
  lose: { wave: "sawtooth", freq: 330, sweepTo: 110, dur: 0.3, gain: 1 },
  jump: { wave: "square", freq: 330, sweepTo: 660, dur: 0.1, gain: 0.9 },
  shoot: { wave: "square", freq: 880, sweepTo: 220, dur: 0.08, gain: 0.8 },
  collect: { wave: "triangle", freq: 660, sweepTo: 990, dur: 0.12, gain: 0.9 },
};
