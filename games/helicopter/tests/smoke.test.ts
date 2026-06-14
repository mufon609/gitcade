import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";
import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";

/**
 * The headless smoke boot `gitcade validate` defers to (Helicopter uses the custom
 * `thrust-lift` behavior). With no input the craft falls under gravity while the
 * scroller spawns pillars and the survival score accrues — no throwing.
 */
describe("helicopter smoke", () => {
  it("boots and runs 180 frames headless, scrolling obstacles in", () => {
    const registry = createLibraryRegistry();
    registerCustomBehaviors(registry);
    const game = createGame({ manifest, config, scenes: [main] }, { canvas: null, registry });
    expect(() => game.stepFrames(180)).not.toThrow();
    expect(game.world.frame).toBe(180);
    expect(game.world.query("obstacle").length).toBeGreaterThan(0);
    expect(typeof game.world.state.score).toBe("number");
  });
});
