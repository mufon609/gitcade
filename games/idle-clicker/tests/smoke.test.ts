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

  // IC-1: the prestige multiplier must scale ALL income (clicks AND auto-income),
  // not only the base click value. Drive the same economy twice — once at mult 1,
  // once at mult 3 — and assert both income channels scale ~3x.
  it("prestige multiplier scales click AND auto income (IC-1)", () => {
    function runRound(mult: number): { fromClicks: number; fromAuto: number } {
      const registry = createLibraryRegistry();
      registerCustomBehaviors(registry);
      const game = createGame({ manifest, config, scenes: [main] }, { canvas: null, registry });
      const w = game.world;
      w.state.prestigeMult = mult; // host seeds this in onEnterPlay
      game.stepFrames(2); // seed currency + click power

      // Click income: 10 taps at base click power, scaled by the multiplier.
      w.state.coins = 0;
      w.state.clicks = 10;
      game.stepFrames(1);
      const fromClicks = w.state.coins as number;

      // Auto income: give a flat rate, run 1s (60 frames), measure the credit.
      w.state.coins = 0;
      w.state.autoRate = 10;
      game.stepFrames(60);
      const fromAuto = w.state.coins as number;
      return { fromClicks, fromAuto };
    }

    const base = runRound(1);
    const prestiged = runRound(3);

    // Click income tripled (10 taps * power 1 → 10 vs 30).
    expect(prestiged.fromClicks).toBeCloseTo(base.fromClicks * 3, 5);
    // Auto income tripled too — the dominant late-game channel the bug ignored.
    expect(prestiged.fromAuto).toBeCloseTo(base.fromAuto * 3, 5);
    expect(base.fromAuto).toBeGreaterThan(0);
  });
});
