/**
 * Audio player. Synthesizes simple tones via Web Audio when available, and
 * NO-OPS cleanly when it is not (jsdom/headless smoke tests, SSR). This is a hard
 * requirement: the 60-frame smoke test runs with no `AudioContext`, and triggering
 * a sound must never throw.
 *
 * The library replaces these primitive beeps with full synthesized SFX/music; the
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
    // A browser AudioContext starts SUSPENDED under the autoplay policy. Self-resume on first
    // real use so a sound triggered by the gesture that started the game plays, instead of being
    // dropped on a still-suspended context (resume() is a no-op when already running or outside a
    // gesture, so this is safe to call every play).
    this.resume();
    try {
      const preset = TONES[key] ?? TONES.__default;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = preset.wave;
      osc.frequency.setValueAtTime(preset.freq, now);
      if (preset.sweepTo) osc.frequency.exponentialRampToValueAtTime(preset.sweepTo, now + preset.dur);
      // Clamp the start gain to a tiny positive: an exponential ramp is undefined from 0 (the spec
      // requires non-zero endpoints — stricter engines throw, which the catch below would swallow),
      // and volume 0 is inaudible at 0.0001 anyway. Mirrors the library synth's identical guard.
      const vol = Math.max(0.0001, (opts.volume ?? 0.2) * preset.gain);
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

/**
 * The OPTIONAL music capability a player may add on top of the frozen `play(key)` SFX surface. The
 * SDK's primitive {@link AudioPlayer} synthesizes no music; `@gitcade/library`'s richer player
 * implements this (generative chiptune loops). The runtime drives a scene's declarative
 * {@link Scene.music} through {@link supportsMusic} so it works with whichever player a game wired in,
 * without the base class advertising a capability it doesn't have.
 */
export interface MusicChannel {
  /** Start (or seamlessly switch to) a looping track by key; re-requesting the current track is a no-op. */
  startMusic(track: string): void;
  /** Stop any playing music loop. */
  stopMusic(): void;
}

/** True when `audio` also implements the optional {@link MusicChannel} (so the runtime can drive `scene.music`). */
export function supportsMusic(audio: AudioPlayer): audio is AudioPlayer & MusicChannel {
  const a = audio as Partial<MusicChannel>;
  return typeof a.startMusic === "function" && typeof a.stopMusic === "function";
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
