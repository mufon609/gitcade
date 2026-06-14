import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * The headless smoke boot `gitcade validate` defers to. Boots Breakout on the
 * full library registry and simulates frames with no canvas: the ball launches,
 * bounces off the walls and paddle, and breaks bricks via contact-damage — all
 * deterministic and without throwing.
 */
describe("breakout smoke", () => {
  it("boots and runs 240 frames headless, breaking at least one brick", () => {
    const registry = createLibraryRegistry();
    const game = createGame({ manifest, config, scenes: [main] }, { canvas: null, registry });
    const startBricks = game.world.query("breakable").length;
    expect(startBricks).toBe(50);
    expect(() => game.stepFrames(240)).not.toThrow();
    expect(game.world.frame).toBe(240);
    // The deterministic ball trajectory clears at least one brick in 4 seconds.
    expect(game.world.query("breakable").length).toBeLessThan(startBricks);
  });
});
