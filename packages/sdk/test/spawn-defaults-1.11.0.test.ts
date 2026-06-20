import { describe, it, expect } from "vitest";
import { World, createDefaultRegistry, advanceAnim, type Sprite } from "../src/index.js";

/**
 * 1.11.0 — `world.spawn` parses through `EntityDefSchema`, so a runtime spawn takes the SAME
 * default-application + strict path as a scene-load entity. A spawner may pass a PARTIAL def (the
 * schema fills the rest); NESTED defaults apply too (the spinning-coin fix below); and an unknown key
 * is rejected, exactly as at load. Replaces the hand-rolled `sprite ??= {kind:"none"}`-style backfill
 * spawners used to carry.
 */
function makeWorld(): World {
  return new World({ bounds: { width: 800, height: 600 }, config: {}, registry: createDefaultRegistry() });
}

describe("world.spawn applies schema defaults (like scene load)", () => {
  it("accepts a PARTIAL def and backfills top-level defaults (a missing size/layer/sprite used to crash)", () => {
    const w = makeWorld();
    const e = w.spawn({ id: "x", tags: ["t"] }); // no size/position/layer/sprite/behaviors
    expect(e.w).toBe(16);
    expect(e.h).toBe(16); // SizeSchema default
    expect(e.x).toBe(0);
    expect(e.y).toBe(0); // Vec2 default
    expect(e.layer).toBe(0);
    expect(e.sprite).toEqual({ kind: "none" });
    expect(e.behaviors).toEqual([]);
    expect([...e.tags]).toEqual(["t"]);
  });

  it("applies NESTED defaults — a sheet clip's omitted `loop` defaults to true (the spinning-coin fix)", () => {
    const w = makeWorld();
    const e = w.spawn({
      id: "coin",
      sprite: { kind: "sheet", src: "coin.png", frameWidth: 16, frameHeight: 16, frameCount: 4, fps: 8, animations: { spin: { from: 0, to: 3 } } },
      behaviors: [],
    });
    const sprite = e.sprite as Extract<Sprite, { kind: "sheet" }>;
    expect(sprite.animations!.spin.loop).toBe(true); // parse applied it; the old spawn left it undefined

    // With `loop` true the playhead WRAPS; with it undefined (the old bypass) advanceAnim clamps at
    // the last frame and freezes. Step well past the clip end and confirm it keeps cycling.
    const anim = { current: null as string | null, frame: 0, elapsed: 0 };
    const seen = new Set<number>();
    for (let i = 0; i < 12; i++) {
      advanceAnim(anim, sprite, "spin", 1 / 8);
      seen.add(anim.frame);
    }
    expect(anim.frame).toBeLessThanOrEqual(3); // stays within [from,to]
    expect(seen.size).toBeGreaterThan(1); // still cycling → looping, not frozen on frame 3
  });

  it("rejects an unknown key in a spawned def (strict, like scene load)", () => {
    const w = makeWorld();
    expect(() => w.spawn({ id: "x", bogus: 1 } as never)).toThrow();
  });

  it("a complete def spawns unchanged", () => {
    const w = makeWorld();
    const e = w.spawn({
      id: "ball",
      sprite: { kind: "shape", shape: "circle", color: "#fff" },
      size: { w: 10, h: 10 },
      position: { x: 5, y: 6 },
      tags: ["ball"],
      layer: 2,
      behaviors: [],
    });
    expect(e.x).toBe(5);
    expect(e.y).toBe(6);
    expect(e.w).toBe(10);
    expect(e.layer).toBe(2);
  });
});
