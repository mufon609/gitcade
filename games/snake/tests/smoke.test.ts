import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";
import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";

/**
 * The headless smoke boot `gitcade validate` defers to (Snake uses a custom
 * system the default registry can't supply). Boots from the JSON definitions on
 * the full library + custom registry and simulates frames with no canvas — the
 * snake auto-advances right, grows a body, and keeps a food on the board, all
 * without throwing.
 */
describe("snake smoke", () => {
  it("boots and runs 150 frames headless without throwing", () => {
    const registry = createLibraryRegistry();
    registerCustomBehaviors(registry);
    const game = createGame({ manifest, config, scenes: [main] }, { canvas: null, registry });
    expect(() => game.stepFrames(150)).not.toThrow();
    expect(game.world.frame).toBe(150);
    // A food pickup exists on the board after the snake-body system initialises.
    expect(game.world.query("food").length).toBe(1);
  });
});
