/**
 * Runtime audio SYNTHESIS — zero binary audio assets (locked art/audio direction).
 *
 * Every SFX and both music loops are generated from data recipes via Web Audio at
 * play time. Nothing here touches an `AudioContext` until a context is handed in,
 * so the whole module is import-safe and call-safe headless (jsdom / Node / SSR):
 * the {@link LibraryAudioPlayer} simply never calls these when no context exists.
 */

/** A single synth layer of an SFX: an oscillator (or noise) with an AD envelope. */
export interface SfxLayer {
  /** Oscillator wave, or `"noise"` for a white-noise burst (explosions/hits). */
  wave: OscillatorType | "noise";
  /** Start frequency in Hz (ignored for noise). */
  freq?: number;
  /** Optional exponential frequency ramp target. */
  sweepTo?: number;
  /** Layer duration in seconds. */
  dur: number;
  /** Peak gain (relative; multiplied by the call volume). */
  gain: number;
  /** Start offset within the SFX, seconds (for arpeggios). */
  at?: number;
  /** Optional low-pass cutoff for noise layers, Hz. */
  lowpass?: number;
}

export interface SfxRecipe {
  layers: SfxLayer[];
}

/**
 * The Phase 2B SFX set (jump, shoot, hit, collect, explode, click, win, lose) plus
 * aliases for the SDK's built-in sound keys so existing parts (e.g. health-and-death's
 * default `deathSound: "explode"`, score's "score") all resolve to a real recipe.
 */
export const SFX_RECIPES: Record<string, SfxRecipe> = {
  jump: { layers: [{ wave: "square", freq: 330, sweepTo: 680, dur: 0.12, gain: 0.5 }] },
  shoot: {
    layers: [
      { wave: "square", freq: 880, sweepTo: 160, dur: 0.09, gain: 0.4 },
      { wave: "noise", dur: 0.05, gain: 0.15, lowpass: 3000 },
    ],
  },
  hit: {
    layers: [
      { wave: "square", freq: 200, sweepTo: 90, dur: 0.08, gain: 0.5 },
      { wave: "noise", dur: 0.06, gain: 0.2, lowpass: 1800 },
    ],
  },
  collect: {
    layers: [
      { wave: "triangle", freq: 660, dur: 0.07, gain: 0.4 },
      { wave: "triangle", freq: 990, dur: 0.09, gain: 0.4, at: 0.06 },
    ],
  },
  explode: {
    layers: [
      { wave: "noise", dur: 0.4, gain: 0.5, lowpass: 1200 },
      { wave: "square", freq: 120, sweepTo: 40, dur: 0.35, gain: 0.35 },
    ],
  },
  click: { layers: [{ wave: "square", freq: 1200, dur: 0.03, gain: 0.3 }] },
  win: {
    layers: [
      { wave: "triangle", freq: 523, dur: 0.12, gain: 0.4 },
      { wave: "triangle", freq: 659, dur: 0.12, gain: 0.4, at: 0.1 },
      { wave: "triangle", freq: 784, dur: 0.12, gain: 0.4, at: 0.2 },
      { wave: "triangle", freq: 1046, dur: 0.25, gain: 0.45, at: 0.3 },
    ],
  },
  lose: {
    layers: [
      { wave: "sawtooth", freq: 440, sweepTo: 110, dur: 0.4, gain: 0.4 },
      { wave: "square", freq: 220, sweepTo: 70, dur: 0.4, gain: 0.25, at: 0.05 },
    ],
  },
  // Aliases so SDK/2A sound keys keep working with richer synthesis:
  score: { layers: [{ wave: "triangle", freq: 660, sweepTo: 1100, dur: 0.16, gain: 0.4 }] },
  bounce: { layers: [{ wave: "triangle", freq: 520, dur: 0.05, gain: 0.4 }] },
};

/** The canonical Phase 2B SFX keys (the catalog audio parts), in stable order. */
export const SFX_KEYS = ["jump", "shoot", "hit", "collect", "explode", "click", "win", "lose"] as const;
export type SfxKey = (typeof SFX_KEYS)[number];

/** A shared, lazily-built white-noise buffer (1s mono) for noise layers. */
let noiseBuffer: AudioBuffer | null = null;
function getNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  // A fixed LCG so the noise content is stable run-to-run (not byte-checked, but tidy).
  let s = 0x2545f491;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    ch[i] = (s / 0x3fffffff) - 1;
  }
  noiseBuffer = buf;
  return buf;
}

/**
 * Render one SFX recipe through `ctx`, summing into `destination`. Pure scheduling:
 * creates short-lived nodes that free themselves when they stop. Never throws.
 */
export function playSfx(ctx: AudioContext, destination: AudioNode, key: string, volume: number): void {
  const recipe = SFX_RECIPES[key] ?? SFX_RECIPES.click;
  const t0 = ctx.currentTime;
  for (const layer of recipe.layers) {
    const start = t0 + (layer.at ?? 0);
    const stop = start + layer.dur;
    const gain = ctx.createGain();
    const peak = Math.max(0.0001, layer.gain * volume);
    gain.gain.setValueAtTime(peak, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, stop);

    if (layer.wave === "noise") {
      const src = ctx.createBufferSource();
      src.buffer = getNoise(ctx);
      let node: AudioNode = src;
      if (layer.lowpass) {
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(layer.lowpass, start);
        src.connect(lp);
        node = lp;
      }
      node.connect(gain).connect(destination);
      src.start(start);
      src.stop(stop);
    } else {
      const osc = ctx.createOscillator();
      osc.type = layer.wave;
      osc.frequency.setValueAtTime(layer.freq ?? 440, start);
      if (layer.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, layer.sweepTo), stop);
      osc.connect(gain).connect(destination);
      osc.start(start);
      osc.stop(stop);
    }
  }
}

// ─── Music: two generative chiptune loops, scheduled with a lookahead timer ────

/** One note in a track voice: a beat offset, a MIDI pitch, a length, and a wave. */
export interface Note {
  beat: number;
  midi: number;
  beats: number;
  wave?: OscillatorType;
  gain?: number;
}
export interface MusicTrack {
  bpm: number;
  /** Loop length in beats. */
  loopBeats: number;
  voices: Note[][];
}

const A4 = 69;
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - A4) / 12);
}

// MIDI helpers (C major-ish, chiptune feel). 60 = middle C.
const C3 = 48,
  C4 = 60,
  C5 = 72;
/** ACTION loop — driving bass + bright lead arpeggio. */
const ACTION: MusicTrack = {
  bpm: 132,
  loopBeats: 8,
  voices: [
    // bass (square), root walking
    [
      { beat: 0, midi: C3, beats: 1, wave: "square", gain: 0.18 },
      { beat: 1, midi: C3 + 7, beats: 1, wave: "square", gain: 0.18 },
      { beat: 2, midi: C3 + 5, beats: 1, wave: "square", gain: 0.18 },
      { beat: 3, midi: C3 + 7, beats: 1, wave: "square", gain: 0.18 },
      { beat: 4, midi: C3 - 2, beats: 1, wave: "square", gain: 0.18 },
      { beat: 5, midi: C3 + 5, beats: 1, wave: "square", gain: 0.18 },
      { beat: 6, midi: C3 + 3, beats: 1, wave: "square", gain: 0.18 },
      { beat: 7, midi: C3 + 7, beats: 1, wave: "square", gain: 0.18 },
    ],
    // lead arpeggio (triangle), eighth notes
    [C4, C4 + 4, C4 + 7, C5, C4 + 7, C4 + 4, C4 + 7, C4 + 4].flatMap((m, i) => [
      { beat: i, midi: m, beats: 0.5, wave: "triangle" as OscillatorType, gain: 0.12 },
      { beat: i + 0.5, midi: m + 12, beats: 0.5, wave: "triangle" as OscillatorType, gain: 0.1 },
    ]),
  ],
};
/** MENU loop — calm, sparse pad + gentle melody. */
const MENU: MusicTrack = {
  bpm: 96,
  loopBeats: 8,
  voices: [
    [
      { beat: 0, midi: C3, beats: 2, wave: "triangle", gain: 0.14 },
      { beat: 2, midi: C3 + 5, beats: 2, wave: "triangle", gain: 0.14 },
      { beat: 4, midi: C3 + 3, beats: 2, wave: "triangle", gain: 0.14 },
      { beat: 6, midi: C3 + 7, beats: 2, wave: "triangle", gain: 0.14 },
    ],
    [
      { beat: 0, midi: C5, beats: 1, wave: "sine", gain: 0.1 },
      { beat: 1.5, midi: C5 + 2, beats: 1, wave: "sine", gain: 0.1 },
      { beat: 3, midi: C5 + 4, beats: 1.5, wave: "sine", gain: 0.1 },
      { beat: 5, midi: C5 + 2, beats: 1, wave: "sine", gain: 0.1 },
      { beat: 6.5, midi: C5, beats: 1.5, wave: "sine", gain: 0.1 },
    ],
  ],
};

export const MUSIC_TRACKS: Record<string, MusicTrack> = { action: ACTION, menu: MENU };
export const MUSIC_LOOPS = ["action", "menu"] as const;
export type MusicLoop = (typeof MUSIC_LOOPS)[number];

/**
 * A looping music voice scheduler. Uses a lookahead window so timing is solid even
 * when the page tab throttles timers. Headless-safe: only constructed once a real
 * `AudioContext` exists (the player gates this).
 */
export class MusicPlayer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeatTime = 0;
  private beat = 0;
  private readonly secPerBeat: number;
  private readonly track: MusicTrack;

  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode,
    trackName: string,
  ) {
    this.track = MUSIC_TRACKS[trackName] ?? MUSIC_TRACKS.menu;
    this.secPerBeat = 60 / this.track.bpm;
  }

  start(): void {
    if (this.timer) return;
    this.nextBeatTime = this.ctx.currentTime + 0.05;
    this.beat = 0;
    // Schedule ~150ms ahead, every 25ms.
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    const horizon = this.ctx.currentTime + 0.15;
    while (this.nextBeatTime < horizon) {
      const localBeat = this.beat % this.track.loopBeats;
      for (const voice of this.track.voices) {
        for (const n of voice) {
          if (n.beat === localBeat) this.note(n, this.nextBeatTime);
        }
      }
      this.beat += 1;
      this.nextBeatTime += this.secPerBeat;
    }
  }

  private note(n: Note, when: number): void {
    const dur = n.beats * this.secPerBeat;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = n.wave ?? "triangle";
    osc.frequency.setValueAtTime(midiToFreq(n.midi), when);
    const peak = Math.max(0.0001, n.gain ?? 0.12);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur * 0.9);
    osc.connect(gain).connect(this.destination);
    osc.start(when);
    osc.stop(when + dur);
  }
}
