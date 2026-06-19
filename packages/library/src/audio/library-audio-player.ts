import { AudioPlayer } from "@gitcade/sdk";
import { playSfx, MusicPlayer, type MusicLoop } from "./synth.js";

/**
 * The library's richer audio player. It IS-A {@link AudioPlayer} (so a game wires
 * it in via `createGame({ ... }, { audio: new LibraryAudioPlayer() })` and every
 * `world.audio.play(key)` call from any behavior/system flows through it), but it
 * replaces the SDK's single-oscillator beeps with the full synthesized SFX set and
 * adds two generative chiptune music loops.
 *
 * This is the SANCTIONED way to extend audio without touching the FROZEN SDK: the
 * SDK's `audio.ts` explicitly reserves a stable `play(key)` surface for the library
 * to enrich. Headless-safe by construction — it shares the SDK's support check and
 * never creates an `AudioContext` until first real use, so jsdom/Node smoke tests
 * (no `AudioContext`) run silently and `play`/`startMusic` are no-ops.
 *
 * Field names are deliberately distinct from the base class's private members
 * (`ctx`/`muted`/`available`) to avoid TypeScript private-collision and to keep this
 * subclass fully self-contained.
 */
export class LibraryAudioPlayer extends AudioPlayer {
  private audioCtx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: MusicPlayer | null = null;
  private currentTrack: string | null = null;
  private libMuted = false;
  private readonly libAvailable: boolean;
  private masterVolume = 0.6;

  constructor() {
    super();
    this.libAvailable = AudioPlayer.isSupported();
  }

  /** Lazily create the context + master bus on first real use (after a gesture). */
  private bus(): { ctx: AudioContext; master: GainNode } | null {
    if (!this.libAvailable || this.libMuted) return null;
    if (this.audioCtx && this.master) return { ctx: this.audioCtx, master: this.master };
    try {
      const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctor = g.AudioContext ?? g.webkitAudioContext;
      if (!Ctor) return null;
      this.audioCtx = new Ctor();
      this.master = this.audioCtx.createGain();
      this.master.gain.value = this.masterVolume;
      this.master.connect(this.audioCtx.destination);
      return { ctx: this.audioCtx, master: this.master };
    } catch {
      return null;
    }
  }

  /** Play a synthesized SFX by key. Always safe; no-op when unsupported/muted. */
  override play(key: string, opts: { volume?: number } = {}): void {
    const bus = this.bus();
    if (!bus) return;
    try {
      playSfx(bus.ctx, bus.master, key, opts.volume ?? 1);
    } catch {
      /* never let audio break a frame */
    }
  }

  /** Start (or switch to) a looping music track: `"action"` or `"menu"`. */
  startMusic(track: MusicLoop | string): void {
    const bus = this.bus();
    if (!bus) return;
    if (this.currentTrack === track && this.music) return;
    this.stopMusic();
    try {
      this.music = new MusicPlayer(bus.ctx, bus.master, track);
      this.music.start();
      this.currentTrack = track;
    } catch {
      this.music = null;
    }
  }

  /** Stop any playing music loop. */
  stopMusic(): void {
    if (this.music) {
      this.music.stop();
      this.music = null;
    }
    this.currentTrack = null;
  }

  /** The currently playing music track name, or null. */
  get nowPlaying(): string | null {
    return this.currentTrack;
  }

  override setMuted(muted: boolean): void {
    this.libMuted = muted;
    if (muted) this.stopMusic();
    if (this.master && this.audioCtx) this.master.gain.value = muted ? 0 : this.masterVolume;
  }

  /** Set master volume (0..1). */
  setVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.libMuted ? 0 : this.masterVolume;
  }

  override resume(): void {
    const bus = this.bus();
    if (bus && bus.ctx.state === "suspended") void bus.ctx.resume();
  }
}
