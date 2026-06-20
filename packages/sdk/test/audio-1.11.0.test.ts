import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AudioPlayer } from "../src/index.js";

/**
 * AudioPlayer hardening — two Web Audio footguns the headless smoke path can't see (it has no
 * AudioContext, so play() is a pure no-op there). A minimal mock context drives the real play():
 *  - a `volume: 0` sound used to set the gain to 0 and then exponentially ramp it down — an
 *    exponential ramp is undefined from a zero endpoint (spec-invalid; stricter engines throw,
 *    swallowed by play()'s catch). The start gain is now clamped to a tiny positive.
 *  - the context starts SUSPENDED under the autoplay policy; play() now self-resumes it so a
 *    gesture-triggered sound isn't dropped, and stops resuming once it is running.
 */

class MockParam {
  sets: Array<{ value: number; time: number }> = [];
  ramps: Array<{ value: number; time: number }> = [];
  value = 0;
  setValueAtTime(value: number, time: number): this {
    this.sets.push({ value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    // Mirror the browser: an exponential ramp to a non-positive target throws.
    if (value <= 0) throw new RangeError("exponential ramp target must be > 0");
    this.ramps.push({ value, time });
    return this;
  }
}
class MockNode {
  type = "";
  frequency = new MockParam();
  gain = new MockParam();
  connect(n: unknown): unknown {
    return n;
  }
  start(): void {}
  stop(): void {}
}
class MockAudioContext {
  static instances: MockAudioContext[] = [];
  static initialState: "suspended" | "running" = "suspended";
  state: "suspended" | "running";
  currentTime = 0;
  destination = new MockNode();
  resumeCalls = 0;
  gains: MockNode[] = [];
  constructor() {
    this.state = MockAudioContext.initialState;
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
  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = "running";
    return Promise.resolve();
  }
}

describe("AudioPlayer — volume clamp + autoplay self-resume", () => {
  let savedAC: unknown;
  beforeEach(() => {
    savedAC = (globalThis as Record<string, unknown>).AudioContext;
    MockAudioContext.instances = [];
    MockAudioContext.initialState = "suspended";
    (globalThis as Record<string, unknown>).AudioContext = MockAudioContext;
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>).AudioContext = savedAC;
  });

  it("clamps a volume:0 sound to a positive start gain (no exponential ramp from 0)", () => {
    const audio = new AudioPlayer();
    audio.play("hit", { volume: 0 });
    const ctx = MockAudioContext.instances[0];
    expect(ctx.gains).toHaveLength(1);
    expect(ctx.gains[0].gain.sets[0].value).toBeGreaterThanOrEqual(0.0001); // clamped, was 0
    expect(ctx.gains[0].gain.ramps[0].value).toBeGreaterThan(0); // decay target stays positive
  });

  it("passes a normal volume through unclamped", () => {
    const audio = new AudioPlayer();
    audio.play("hit", { volume: 1 }); // TONES.hit.gain === 1 → vol 1
    expect(MockAudioContext.instances[0].gains[0].gain.sets[0].value).toBeCloseTo(1);
  });

  it("self-resumes a suspended context, then does not re-resume once running", () => {
    const audio = new AudioPlayer();
    audio.play("hit"); // context created suspended → resume()
    const ctx = MockAudioContext.instances[0];
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe("running");
    audio.play("hit"); // already running → no further resume
    expect(ctx.resumeCalls).toBe(1);
  });

  it("never throws, including the volume:0 and unknown-key paths", () => {
    const audio = new AudioPlayer();
    expect(() => audio.play("hit", { volume: 0 })).not.toThrow();
    expect(() => audio.play("totally-unknown-key")).not.toThrow();
  });
});
