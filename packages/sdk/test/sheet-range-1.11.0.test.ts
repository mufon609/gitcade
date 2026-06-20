import { describe, it, expect } from "vitest";
import { SpriteSchema, SceneSchema } from "../src/index.js";

/**
 * A sheet animation is an INCLUSIVE frame range. `from`/`to` are each bounded in isolation
 * (nonnegative ints), but their relationship — `to >= from` and `to < frameCount` — was not
 * checked, so `to < from` (span 0 → `% 0` → a NaN playhead) and `to >= frameCount` (the playhead
 * runs off the sheet) passed validation and broke at tick time. These pin the cross-field rule on
 * `SpriteSchema`, including that legitimate clip shapes (multi-frame, single-frame, none) still pass.
 */

const sheet = (animations: Record<string, unknown>, frameCount = 10) => ({
  kind: "sheet" as const,
  src: "p.png",
  frameWidth: 16,
  frameHeight: 16,
  frameCount,
  fps: 10,
  animations,
});

describe("sheet-clip range validation", () => {
  it("rejects to < from (the span-0 → NaN playhead)", () => {
    const r = SpriteSchema.safeParse(sheet({ broken: { from: 2, to: 1 } }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.errors[0].message).toMatch(/"broken".*to=1 < from=2/);
      expect(r.error.errors[0].path).toEqual(["animations", "broken", "to"]);
    }
  });

  it("rejects to >= frameCount (playhead runs off the sheet)", () => {
    const r = SpriteSchema.safeParse(sheet({ over: { from: 0, to: 9 } }, 4));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.errors[0].message).toMatch(/"over".*out of range.*4-frame.*0\.\.3/);
      expect(r.error.errors[0].path).toEqual(["animations", "over", "to"]);
    }
  });

  it("accepts a valid multi-frame clip", () => {
    expect(SpriteSchema.safeParse(sheet({ run: { from: 2, to: 5 } })).success).toBe(true);
  });

  it("accepts a single-frame clip (to === from)", () => {
    // The arena-reskin `accent: {from:3, to:3}` shape — span 1, no wrap, must stay legal.
    expect(SpriteSchema.safeParse(sheet({ accent: { from: 3, to: 3, loop: false } }, 5)).success).toBe(true);
  });

  it("accepts the last valid frame (to === frameCount - 1)", () => {
    expect(SpriteSchema.safeParse(sheet({ spin: { from: 0, to: 3 } }, 4)).success).toBe(true);
  });

  it("accepts a sheet with no animations", () => {
    const r = SpriteSchema.safeParse({
      kind: "sheet",
      src: "p.png",
      frameWidth: 16,
      frameHeight: 16,
      frameCount: 4,
      fps: 8,
    });
    expect(r.success).toBe(true);
  });

  it("leaves the other sprite kinds unaffected", () => {
    expect(SpriteSchema.safeParse({ kind: "shape", shape: "rect", color: "#fff" }).success).toBe(true);
    expect(SpriteSchema.safeParse({ kind: "text", text: "hi" }).success).toBe(true);
    expect(SpriteSchema.safeParse({ kind: "none" }).success).toBe(true);
    expect(SpriteSchema.safeParse({ kind: "image", src: "p.png" }).success).toBe(true);
  });

  it("surfaces a located error through SceneSchema (the validator's parse path)", () => {
    const r = SceneSchema.safeParse({
      id: "main",
      entities: [
        {
          id: "e",
          sprite: sheet({ bad: { from: 5, to: 2 } }),
          size: { w: 16, h: 16 },
          position: { x: 0, y: 0 },
          behaviors: [],
        },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      // The validator joins this path with "." → entities.0.sprite.animations.bad.to
      expect(r.error.errors.some((e) => e.path.join(".") === "entities.0.sprite.animations.bad.to")).toBe(true);
    }
  });
});
