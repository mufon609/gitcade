import { describe, it, expect } from "vitest";
import { advanceAnim, type AnimationState, type SheetSprite } from "../src/index.js";

/**
 * 0.13.0 — `advanceAnim`, the single source of truth for sprite-sheet frame advancement
 * extracted from the built-in `sprite-animate` and the library `sprite-state-machine` (which
 * carried a byte-identical copy). These tests pin the primitive's contract: clip-change reset,
 * loop wrap within the clip span, the non-loop one-shot "finished" signal, fps override, and
 * the whole-sheet (`null` clip) default. The two consumers' own suites cover that they still
 * advance identically through it.
 */

const DT = 1 / 60;

function sheet(): SheetSprite {
  return {
    kind: "sheet",
    src: "p.png",
    frameWidth: 16,
    frameHeight: 16,
    frameCount: 10,
    fps: 10,
    animations: {
      run: { from: 2, to: 5, fps: 12, loop: true },
      land: { from: 8, to: 9, fps: 20, loop: false },
    },
  };
}

function freshAnim(): AnimationState {
  return { current: null, frame: 0, elapsed: 0 };
}

describe("advanceAnim — shared sheet-frame primitive", () => {
  it("resets to the clip's first frame when the clip changes", () => {
    const anim = freshAnim();
    const s = sheet();
    advanceAnim(anim, s, "run", DT); // first sight of "run"
    expect(anim.current).toBe("run");
    expect(anim.frame).toBe(2); // run.from, not 0
  });

  it("a null clip plays the whole sheet from frame 0", () => {
    const anim = freshAnim();
    anim.current = "run"; // was on a clip
    advanceAnim(anim, sheet(), null, DT);
    expect(anim.current).toBeNull();
    expect(anim.frame).toBe(0);
  });

  it("advances by elapsed/frameDur and wraps a looping clip within its span", () => {
    const anim = freshAnim();
    const s = sheet();
    // run: from 2 to 5 (span 4) @ 12fps → frameDur 1/12. Pump 6 frames' worth of time.
    for (let i = 0; i < 6; i++) advanceAnim(anim, s, "run", 1 / 12);
    // started at frame 2, +6 = 8, wraps into [2,5]: 2 + ((8-2) % 4) = 2 + 2 = 4
    expect(anim.frame).toBe(4);
    expect(anim.frame).toBeGreaterThanOrEqual(2);
    expect(anim.frame).toBeLessThanOrEqual(5);
  });

  it("clamps a non-looping clip at its last frame; false while playing, true once finished and held", () => {
    const anim = freshAnim();
    const s = sheet();
    // land: from 8 to 9 (2 frames) @ 20fps → frameDur 1/20.
    const finishes: boolean[] = [];
    for (let i = 0; i < 5; i++) finishes.push(advanceAnim(anim, s, "land", 1 / 20));
    expect(anim.frame).toBe(9); // clamped to land.to
    // not finished on the first tick (still advancing through the clip), then finishes...
    expect(finishes[0]).toBe(false);
    const firstDone = finishes.indexOf(true);
    expect(firstDone).toBeGreaterThan(0);
    // ...and STAYS finished while clamped at the last frame (the consumer switches clip on
    // the first `true`, so the repeated signal is harmless).
    expect(finishes.slice(firstDone).every(Boolean)).toBe(true);
    expect(advanceAnim(anim, s, "land", 1 / 20)).toBe(true);
  });

  it("fpsOverride > 0 replaces the clip fps; 0 honors it", () => {
    const fast = freshAnim();
    const slow = freshAnim();
    const s = sheet();
    // run @ 12fps. With override 60fps a single DT (1/60) advances one frame; without, none.
    advanceAnim(fast, s, "run", DT, 60);
    advanceAnim(slow, s, "run", DT, 0);
    expect(fast.frame).toBe(3); // 2 + 1
    expect(slow.frame).toBe(2); // 2 + 0 (1/60 < 1/12 frameDur)
  });
});
