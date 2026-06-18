import { describe, it, expect } from "vitest";
import { Game, resolveSceneInheritance, type Scene } from "../src/index.js";

// ---------------------------------------------------------------------------
// E11 — scene inheritance (`extends`)
// ---------------------------------------------------------------------------
describe("E11 — scene inheritance", () => {
  const base: Scene = {
    id: "play-base",
    size: { width: 640, height: 480 },
    background: "#111",
    music: "action",
    entities: [
      { id: "paddle", sprite: { kind: "none" }, size: { w: 80, h: 10 }, position: { x: 0, y: 0 }, behaviors: [], tags: ["paddle"], layer: 0 },
      { id: "ball", sprite: { kind: "none" }, size: { w: 10, h: 10 }, position: { x: 0, y: 0 }, behaviors: [], tags: ["ball"], layer: 0 },
    ],
    systems: [{ type: "aabb-collision", params: {} }],
    flow: { on: { "level-cleared": "@next", gameover: "over" }, persist: ["score", "lives"] },
  } as unknown as Scene;

  const level1: Scene = {
    id: "level-1",
    extends: "play-base",
    entities: [
      { id: "brick-1", sprite: { kind: "none" }, size: { w: 40, h: 16 }, position: { x: 10, y: 10 }, behaviors: [], tags: ["breakable"], layer: 0 },
    ],
  } as unknown as Scene;

  it("merges the base shell with the child's own content", () => {
    const [resolvedBase, resolved1] = resolveSceneInheritance([base, level1]);
    // Base is untouched.
    expect(resolvedBase.entities.map((e) => e.id)).toEqual(["paddle", "ball"]);
    // Child inherits base entities (in order) then appends its own.
    expect(resolved1.entities.map((e) => e.id)).toEqual(["paddle", "ball", "brick-1"]);
    // Inherits systems, size, background, music, flow.
    expect(resolved1.systems.map((s) => s.type)).toEqual(["aabb-collision"]);
    expect(resolved1.size).toEqual({ width: 640, height: 480 });
    expect(resolved1.background).toBe("#111");
    expect(resolved1.music).toBe("action");
    expect(resolved1.flow?.on["level-cleared"]).toBe("@next");
    // `extends` is resolved away.
    expect(resolved1.extends).toBeUndefined();
  });

  it("a child entity with a matching id overrides the base entity in place", () => {
    const childOverride: Scene = {
      id: "level-x",
      extends: "play-base",
      entities: [
        { id: "ball", sprite: { kind: "none" }, size: { w: 20, h: 20 }, position: { x: 5, y: 5 }, behaviors: [], tags: ["ball", "fast"], layer: 0 },
        { id: "brick-1", sprite: { kind: "none" }, size: { w: 40, h: 16 }, position: { x: 10, y: 10 }, behaviors: [], tags: ["breakable"], layer: 0 },
      ],
    } as unknown as Scene;
    const [, resolved] = resolveSceneInheritance([base, childOverride]);
    // Order is preserved (ball stays at index 1), but it's the child's bigger ball.
    expect(resolved.entities.map((e) => e.id)).toEqual(["paddle", "ball", "brick-1"]);
    const ball = resolved.entities.find((e) => e.id === "ball")!;
    expect(ball.size).toEqual({ w: 20, h: 20 });
    expect(ball.tags).toContain("fast");
  });

  it("resolves multi-level chains and detects cycles", () => {
    const mid: Scene = { id: "mid", extends: "play-base", systems: [{ type: "score", params: {} }] } as unknown as Scene;
    const leaf: Scene = { id: "leaf", extends: "mid", entities: [{ id: "x", sprite: { kind: "none" }, size: { w: 1, h: 1 }, position: { x: 0, y: 0 }, behaviors: [], tags: [], layer: 0 }] } as unknown as Scene;
    const [, , resolvedLeaf] = resolveSceneInheritance([base, mid, leaf]);
    expect(resolvedLeaf.entities.map((e) => e.id)).toEqual(["paddle", "ball", "x"]);
    expect(resolvedLeaf.systems.map((s) => s.type)).toEqual(["aabb-collision", "score"]);

    const cycleA: Scene = { id: "a", extends: "b", entities: [], systems: [] } as unknown as Scene;
    const cycleB: Scene = { id: "b", extends: "a", entities: [], systems: [] } as unknown as Scene;
    expect(() => resolveSceneInheritance([cycleA, cycleB])).toThrow(/cycle/);
  });

  it("throws on an unknown extends target", () => {
    const orphan: Scene = { id: "orphan", extends: "nope", entities: [], systems: [] } as unknown as Scene;
    expect(() => resolveSceneInheritance([orphan])).toThrow(/unknown scene "nope"/);
  });

  it("the Game boots a resolved child scene (paddle + ball present)", () => {
    const game = new Game({ scenes: [base, level1], config: {}, entrySceneId: "level-1", canvas: null });
    expect(game.world.query("paddle")).toHaveLength(1);
    expect(game.world.query("ball")).toHaveLength(1);
    expect(game.world.query("breakable")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// E11 — manifest level sequence + reserved flow targets
// ---------------------------------------------------------------------------
describe("E11 — level sequence + @next/@first", () => {
  const scenes: Scene[] = [
    { id: "title", size: { width: 100, height: 100 }, entities: [], systems: [], flow: { on: { start: "@next" }, persist: [] } },
    { id: "level-1", size: { width: 100, height: 100 }, entities: [], systems: [], flow: { on: { cleared: "@next", lose: "over" }, persist: ["score"] } },
    { id: "level-2", size: { width: 100, height: 100 }, entities: [], systems: [], flow: { on: { cleared: "@next", lose: "over" }, persist: ["score"] } },
    { id: "win", size: { width: 100, height: 100 }, entities: [], systems: [] },
    { id: "over", size: { width: 100, height: 100 }, entities: [], systems: [], flow: { on: { retry: "@first" }, persist: [] } },
  ] as unknown as Scene[];
  const levels = ["level-1", "level-2"];

  function boot(): Game {
    return new Game({ scenes, config: {}, entrySceneId: "title", levels, levelsComplete: "win", canvas: null });
  }

  it("@next from a non-level scene starts the first level", () => {
    const game = boot();
    game.world.events.emit("start");
    game.update(1 / 60);
    expect(game.scene.id).toBe("level-1");
  });

  it("@next walks the sequence and routes to levelsComplete past the last level", () => {
    const game = boot();
    game.loadScene("level-1");
    game.world.events.emit("cleared");
    game.update(1 / 60);
    expect(game.scene.id).toBe("level-2");
    game.world.events.emit("cleared");
    game.update(1 / 60);
    expect(game.scene.id).toBe("win"); // past the last level → levelsComplete
  });

  it("sets world.state.level to the 1-based stage index on each level load", () => {
    const game = boot();
    game.loadScene("level-1");
    expect(game.world.state.level).toBe(1);
    game.world.events.emit("cleared");
    game.update(1 / 60);
    expect(game.scene.id).toBe("level-2");
    expect(game.world.state.level).toBe(2);
    // The counter is recomputed from the stage index on every level load, so it
    // never needs to be persisted across level→level hops — re-entering level-1
    // resets it to 1 even though level-2's persist set only carries "score".
    game.loadScene("level-1");
    expect(game.world.state.level).toBe(1);
  });

  it("@first restarts the campaign at level 1", () => {
    const game = boot();
    game.loadScene("over");
    game.world.events.emit("retry");
    game.update(1 / 60);
    expect(game.scene.id).toBe("level-1");
  });

  it("requestNextLevel() is the programmatic companion to @next", () => {
    const game = boot();
    game.loadScene("level-1");
    game.requestNextLevel();
    game.update(1 / 60);
    expect(game.scene.id).toBe("level-2");
  });

  it("emits levels-complete when @next runs past the end with no levelsComplete", () => {
    const game = new Game({ scenes, config: {}, entrySceneId: "level-2", levels, canvas: null });
    let completed = 0;
    game.world.events.on("levels-complete", () => (completed += 1));
    game.loadScene("level-2");
    game.world.events.emit("cleared");
    game.update(1 / 60);
    expect(completed).toBe(1);
    expect(game.scene.id).toBe("level-2"); // no destination → stays put (no-op transition)
  });
});
