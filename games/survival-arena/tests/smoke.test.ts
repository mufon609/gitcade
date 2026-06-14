import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * The headless smoke boot `gitcade validate` defers to. Boots Survival Arena on
 * the full library registry: the wave-spawner begins spawning chasers, the player
 * auto-fires, and contact damage accrues — all without throwing.
 */
describe("survival-arena smoke", () => {
  it("boots and runs 200 frames headless, spawning enemies", () => {
    const registry = createLibraryRegistry();
    const game = createGame({ manifest, config, scenes: [main] }, { canvas: null, registry });
    expect(() => game.stepFrames(200)).not.toThrow();
    expect(game.world.frame).toBe(200);
    // After the start delay the wave-spawner has produced chasers.
    expect(game.world.query("enemy").length).toBeGreaterThan(0);
  });
});
