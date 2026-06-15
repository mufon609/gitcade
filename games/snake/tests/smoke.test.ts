import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import title from "../src/scenes/title.json";
import play from "../src/scenes/play.json";
import over from "../src/scenes/over.json";
import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";

/**
 * The headless smoke boot `gitcade validate` defers to (Snake uses custom parts +
 * library parts the default registry can't supply). Boots the 0.2.0 three-scene
 * flow on the full library + custom registry and exercises the data-driven
 * transitions with no canvas — title → play → over → play — asserting the snake
 * food appears, a death routes to the game-over scene, score hands off, and a
 * retry returns to play, all without throwing.
 */
function boot() {
  const registry = createLibraryRegistry();
  registerCustomBehaviors(registry);
  return createGame({ manifest, config, scenes: [title, play, over] }, { canvas: null, registry });
}

describe("snake smoke (0.2.0 data flow)", () => {
  it("boots the entry (title) scene and runs frames without throwing", () => {
    const game = boot();
    expect(game.scene.id).toBe("title");
    expect(() => game.stepFrames(30)).not.toThrow();
  });

  it("title → play transitions on the start-pressed flow edge and spawns food", () => {
    const game = boot();
    game.world.events.emit("start-pressed"); // what the title's tap-emit button emits
    game.stepFrames(2); // queued scene change drains after the tick, then play inits
    expect(game.scene.id).toBe("play");
    expect(game.world.query("food").length).toBe(1);
    expect(game.world.query("head").length).toBe(1);
  });

  it("a wall death routes play → over and hands off the score", () => {
    const game = boot();
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    expect(game.scene.id).toBe("play");
    game.world.state.score = 30; // stand in for three coins eaten
    // Drive straight right into the wall until the snake dies and flow routes over.
    const head = game.world.query("head")[0]!;
    (head.state.__gridDir as { x: number; y: number }) = { x: 1, y: 0 };
    game.stepFrames(300);
    expect(game.scene.id).toBe("over");
    expect(game.world.state.score).toBe(30); // carried by play.flow.persist
  });

  it("retry routes over → play and resets the run", () => {
    const game = boot();
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    game.world.state.score = 30;
    const head = game.world.query("head")[0]!;
    (head.state.__gridDir as { x: number; y: number }) = { x: 1, y: 0 };
    game.stepFrames(300);
    expect(game.scene.id).toBe("over");
    game.world.events.emit("retry");
    game.stepFrames(2);
    expect(game.scene.id).toBe("play");
    expect(game.world.query("food").length).toBe(1);
  });
});
