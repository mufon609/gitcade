import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";
import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";

/**
 * The headless smoke boot `gitcade validate` defers to (Idle Clicker uses the
 * custom click/auto/bonus systems). Exercises the economy: clicks earn coins, a
 * purchased upgrade spends coins and raises click power — no throwing.
 */
describe("idle-clicker smoke", () => {
  it("earns on clicks and applies an upgrade", () => {
    const registry = createLibraryRegistry();
    registerCustomBehaviors(registry);
    const game = createGame({ manifest, config, scenes: [main] }, { canvas: null, registry });
    const w = game.world;

    game.stepFrames(2); // seed currency + click power
    const power = w.state.clickPower as number; // base 1
    expect(power).toBe((config as Record<string, number>).baseClickPower);

    // Four taps earn 4 * power coins.
    w.state.clicks = 4;
    game.stepFrames(1);
    expect(w.state.coins).toBe(4 * power);

    // Buy the click upgrade: spends coins, raises click power.
    w.state.coins = 1000;
    w.state.upgradeRequest = "click";
    game.stepFrames(1);
    expect(w.state.clickPower as number).toBeGreaterThan(power);
    expect(w.state.coins as number).toBeLessThan(1000);

    expect(() => game.stepFrames(120)).not.toThrow();
    expect(w.frame).toBe(124);
  });
});
