import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AudioPlayer } from "@gitcade/sdk";
import { LibraryAudioPlayer, SFX_RECIPES, SFX_KEYS, MUSIC_TRACKS, MUSIC_LOOPS, notesDueInWindow } from "../src/audio/index.js";
import { LIBRARY_PALETTE } from "../src/palette.js";

describe("audio synthesis data", () => {
  it("defines a recipe for every SFX key (+ SDK aliases)", () => {
    expect([...SFX_KEYS]).toEqual(["jump", "shoot", "hit", "collect", "explode", "click", "win", "lose"]);
    for (const key of SFX_KEYS) {
      expect(SFX_RECIPES[key], `recipe for ${key}`).toBeDefined();
      expect(SFX_RECIPES[key]!.layers.length).toBeGreaterThan(0);
    }
    // Aliases keep SDK sound keys working.
    expect(SFX_RECIPES.explode).toBeDefined();
    expect(SFX_RECIPES.score).toBeDefined();
  });

  it("defines exactly two chiptune music loops with voices", () => {
    expect([...MUSIC_LOOPS]).toEqual(["action", "menu"]);
    for (const name of MUSIC_LOOPS) {
      const track = MUSIC_TRACKS[name]!;
      expect(track.bpm).toBeGreaterThan(0);
      expect(track.loopBeats).toBeGreaterThan(0);
      expect(track.voices.length).toBeGreaterThan(0);
      expect(track.voices.flat().length).toBeGreaterThan(0);
    }
  });

  it("schedules off-beat (fractional) notes", () => {
    // Walk every integer loop-beat window of each track; every authored note must
    // be scheduled exactly once across the loop, INCLUDING fractional beats.
    for (const name of MUSIC_LOOPS) {
      const track = MUSIC_TRACKS[name]!;
      const allNotes = track.voices.flat();
      const offbeat = allNotes.filter((n) => !Number.isInteger(n.beat));
      expect(offbeat.length, `${name} should exercise off-beat notes`).toBeGreaterThan(0);

      const scheduled: typeof allNotes = [];
      for (let beat = 0; beat < track.loopBeats; beat++) {
        for (const { note, offset } of notesDueInWindow(track, beat)) {
          expect(offset, "offset is the within-beat fraction").toBeGreaterThanOrEqual(0);
          expect(offset).toBeLessThan(1);
          scheduled.push(note);
        }
      }
      // Every note fires exactly once per loop, and every off-beat note is included.
      expect(scheduled.length, `${name}: all notes scheduled`).toBe(allNotes.length);
      for (const n of offbeat) expect(scheduled).toContain(n);
    }
  });
});

describe("LibraryAudioPlayer (headless no-op)", () => {
  it("is an AudioPlayer and never throws without an AudioContext", () => {
    const audio = new LibraryAudioPlayer();
    expect(audio).toBeInstanceOf(AudioPlayer);
    // No AudioContext in node → every call is a safe no-op.
    expect(() => audio.play("explode")).not.toThrow();
    expect(() => audio.play("nonexistent-key")).not.toThrow();
    expect(() => audio.startMusic("action")).not.toThrow();
    expect(() => audio.stopMusic()).not.toThrow();
    expect(() => audio.setMuted(true)).not.toThrow();
    expect(() => audio.resume()).not.toThrow();
    // Music never actually starts with no audio backend.
    expect(audio.nowPlaying).toBeNull();
  });
});

// A minimal mock AudioContext to drive the real play()/startMusic() paths (node/jsdom has none,
// so the no-op tests above never reach them). Exercised with non-noise SFX keys so only
// oscillator + gain nodes are created.
class MockParam {
  sets: Array<{ value: number; time: number }> = [];
  value = 0;
  setValueAtTime(value: number, time: number): this {
    this.sets.push({ value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number): this {
    if (value <= 0) throw new RangeError("exponential ramp target must be > 0");
    return this;
  }
}
class MockNode {
  type = "";
  frequency = new MockParam();
  gain = new MockParam();
  buffer: unknown = null;
  connect(n: unknown): unknown {
    return n;
  }
  start(): void {}
  stop(): void {}
}
class MockAudioContext {
  static instances: MockAudioContext[] = [];
  state: "suspended" | "running" = "suspended";
  currentTime = 0;
  sampleRate = 8;
  destination = new MockNode();
  resumeCalls = 0;
  gains: MockNode[] = [];
  constructor() {
    MockAudioContext.instances.push(this);
  }
  createOscillator(): MockNode {
    return new MockNode();
  }
  createGain(): MockNode {
    const n = new MockNode();
    this.gains.push(n);
    return n;
  }
  createBufferSource(): MockNode {
    return new MockNode();
  }
  createBiquadFilter(): MockNode {
    return new MockNode();
  }
  createBuffer(): { sampleRate: number; getChannelData: () => Float32Array } {
    return { sampleRate: this.sampleRate, getChannelData: () => new Float32Array(this.sampleRate) };
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = "running";
    return Promise.resolve();
  }
}

describe("LibraryAudioPlayer — autoplay self-resume (mock context)", () => {
  let savedAC: unknown;
  beforeEach(() => {
    savedAC = (globalThis as Record<string, unknown>).AudioContext;
    MockAudioContext.instances = [];
    (globalThis as Record<string, unknown>).AudioContext = MockAudioContext;
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>).AudioContext = savedAC;
  });

  it("play() self-resumes a suspended context, then stops once running", () => {
    const audio = new LibraryAudioPlayer();
    audio.play("jump");
    const ctx = MockAudioContext.instances[0];
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe("running");
    audio.play("jump");
    expect(ctx.resumeCalls).toBe(1); // already running
  });

  it("startMusic() self-resumes a suspended context", () => {
    const audio = new LibraryAudioPlayer();
    audio.startMusic("action");
    expect(MockAudioContext.instances[0].resumeCalls).toBe(1);
    audio.stopMusic(); // clear the lookahead setInterval
  });

  it("a volume:0 SFX never throws and clamps the layer gain to a positive value", () => {
    const audio = new LibraryAudioPlayer();
    expect(() => audio.play("jump", { volume: 0 })).not.toThrow();
    const sfxGain = MockAudioContext.instances[0].gains.find((g) => g.gain.sets.length > 0);
    expect(sfxGain).toBeDefined();
    expect(sfxGain!.gain.sets[0].value).toBeGreaterThanOrEqual(0.0001);
  });
});

describe("palette sync", () => {
  it("src palette matches the gen-assets.ts output (manifest.json)", () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("../assets/manifest.json", import.meta.url)), "utf8"),
    ) as { palette: string[] };
    expect([...LIBRARY_PALETTE]).toEqual(manifest.palette);
  });
});
