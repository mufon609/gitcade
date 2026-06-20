import { describe, it, expect } from "vitest";
import { advanceAnim, type AnimationState, type SheetSprite } from "../src/index.js";

/**
 * Defense-in-depth guards inside `advanceAnim`. The sprite schema enforces `fps > 0` and
 * `to >= from` for a loaded game, but `advanceAnim` is an EXPORTED primitive — a hand-built sheet
 * or a direct/custom-part caller can bypass the schema. Without guards: an inverted range makes
 * `span <= 0` and the `% span` wrap yields a NaN playhead, and a NEGATIVE fps makes `frameDur < 0`,
 * spinning the advance loop forever (a hang). These pin the guards AND that a valid clip is byte-
 * identical (the guards are no-ops for in-spec input, so determinism is untouched).
 */

function sheet(animations: Record<string, { from: number; to: number; fps?: number; loop: boolean }>): SheetSprite {
  return { kind: "sheet", src: "p.png", frameWidth: 16, frameHeight: 16, frameCount: 10, fps: 10, animations } as SheetSprite;
}
function fresh(): AnimationState {
  return { current: null, frame: 0, elapsed: 0 };
}

describe("advanceAnim runtime guards", () => {
  it("collapses an inverted range (to < from) to a single frame instead of a NaN playhead", () => {
    const anim = fresh();
    const s = sheet({ bad: { from: 5, to: 4, loop: true } }); // span 0 → used to `% 0` → NaN
    for (let i = 0; i < 6; i++) advanceAnim(anim, s, "bad", 1 / 10);
    expect(Number.isNaN(anim.frame)).toBe(false);
    expect(anim.frame).toBe(5); // held at `from`
  });

  it("handles a deeply inverted range (to << from) the same way", () => {
    const anim = fresh();
    const s = sheet({ bad: { from: 7, to: 2, loop: true } });
    for (let i = 0; i < 6; i++) advanceAnim(anim, s, "bad", 1 / 10);
    expect(Number.isNaN(anim.frame)).toBe(false);
    expect(anim.frame).toBe(7);
  });

  it("treats fps = 0 as a held frame (no advance, no division blow-up)", () => {
    const anim = fresh();
    const s = sheet({ frozen: { from: 0, to: 5, fps: 0, loop: true } });
    for (let i = 0; i < 6; i++) advanceAnim(anim, s, "frozen", 1 / 10);
    expect(anim.frame).toBe(0);
  });

  it(
    "does not hang on a negative fps (the unguarded advance loop spun forever)",
    () => {
      const anim = fresh();
      const s = sheet({ neg: { from: 0, to: 5, fps: -5, loop: true } });
      expect(() => advanceAnim(anim, s, "neg", 1 / 10)).not.toThrow();
      expect(Number.isFinite(anim.frame)).toBe(true);
      expect(anim.frame).toBe(0); // held, never advanced
    },
    2000, // fail fast rather than hang if the guard ever regresses
  );

  it("leaves a valid clip's advancement byte-identical (guards are no-ops in spec)", () => {
    // Mirrors the advanceAnim wrap contract: run 2→5 @ 12fps, pump 6 frames → 2 + ((8-2) % 4) = 4.
    const anim = fresh();
    const s = sheet({ run: { from: 2, to: 5, fps: 12, loop: true } });
    for (let i = 0; i < 6; i++) advanceAnim(anim, s, "run", 1 / 12);
    expect(anim.frame).toBe(4);
  });
});
