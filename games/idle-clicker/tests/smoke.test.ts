import { describe, it, expect } from "vitest";
import { createGame, MemoryStorage } from "@gitcade/sdk";
import type { Game } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import title from "../src/scenes/title.json";
import play from "../src/scenes/play.json";
import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";

const cfg = config as Record<string, number>;

function boot(storage?: MemoryStorage): Game {
  const registry = createLibraryRegistry();
  registerCustomBehaviors(registry);
  return createGame({ manifest, config, scenes: [title, play] }, { canvas: null, registry, storage });
}
function enterPlay(g: Game): void {
  g.world.events.emit("start-pressed");
  g.stepFrames(2);
}
/** Drive the real G2 click edge: push a released tap, then step one frame. */
function tap(g: Game, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    (g.world.input.justReleased() as { id: number; x: number; y: number }[]).push({ id: 1, x, y });
    g.stepFrames(1);
  }
}

/**
 * The headless smoke boot `gitcade validate` defers to. Exercises the 0.2.0
 * data-driven economy: the title→play flow, click-to-earn via the click EDGE, a
 * purchase through upgrade-tree, the prestige system, and value persistence.
 */
describe("idle-clicker smoke", () => {
  it("flows title→play and earns on a real coin tap (G2 click edge)", () => {
    const g = boot();
    expect(g.scene.id).toBe("title");
    enterPlay(g);
    expect(g.scene.id).toBe("play");

    const power = g.world.state.clickPower as number;
    expect(power).toBe(cfg.baseClickPower);

    g.world.state.coins = 0;
    tap(g, 400, 300, 4); // 4 taps on the full-field coin target
    expect(g.world.state.coins).toBe(4 * power);
  });

  it("buys an upgrade through upgrade-tree (G5): deduct + raise power", () => {
    const g = boot();
    enterPlay(g);
    const power = g.world.state.clickPower as number;
    g.world.state.coins = 1000;
    g.world.state.upgradeRequest = "click";
    g.stepFrames(1);
    expect(g.world.state.clickPower as number).toBeGreaterThan(power);
    expect(g.world.state.coins as number).toBeLessThan(1000);
    expect(() => g.stepFrames(120)).not.toThrow();
  });

  it("prestige system banks, bumps the multiplier, and resets the run", () => {
    const g = boot();
    enterPlay(g);
    g.world.state.coins = 5000;
    g.world.state.upgrades = { click: 3 };
    g.world.state.prestigeRequest = true;
    g.stepFrames(1);
    expect(g.world.state.prestigeMult as number).toBeCloseTo(1 + cfg.prestigeBonus, 5);
    expect(g.world.state.coins).toBe(0);
    expect(g.world.state.lastBank).toBe(5000);
    expect(Object.keys(g.world.state.upgrades as object).length).toBe(0);
  });

  // IC-1: the prestige multiplier scales ALL income (clicks AND auto-income).
  it("prestige multiplier scales click AND auto income (IC-1)", () => {
    function runRound(mult: number): { fromClicks: number; fromAuto: number } {
      const g = boot();
      enterPlay(g);
      g.world.state.prestigeMult = mult;
      g.world.state.coins = 0;
      tap(g, 400, 300, 10);
      const fromClicks = g.world.state.coins as number;
      g.world.state.coins = 0;
      g.world.state.autoRate = 10;
      g.stepFrames(60);
      const fromAuto = g.world.state.coins as number;
      return { fromClicks, fromAuto };
    }
    const base = runRound(1);
    const prestiged = runRound(3);
    expect(prestiged.fromClicks).toBeCloseTo(base.fromClicks * 3, 5);
    expect(prestiged.fromAuto).toBeCloseTo(base.fromAuto * 3, 5);
    expect(base.fromAuto).toBeGreaterThan(0);
  });

  // G6: values survive a reload through the persistence system + shared storage.
  it("persists coins/upgrades/prestige across a reload (G6)", async () => {
    const storage = new MemoryStorage();
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const g1 = boot(storage);
    enterPlay(g1);
    g1.world.state.coins = 9999;
    g1.world.state.upgrades = { click: 4, cursor: 2 };
    g1.world.state.prestigeMult = 1.5;
    g1.stepFrames(5);
    await tick();

    // Reload: the persistence system loads on the TITLE scene (no system seeds the
    // economy keys there), so the async restore lands before we transition; the
    // title's flow.persist then carries the restored values into play.
    const g2 = boot(storage);
    expect(g2.scene.id).toBe("title");
    g2.stepFrames(2); // kick off the async load
    await tick(); // load resolves + restores into title's world.state
    g2.stepFrames(1);
    g2.world.events.emit("start-pressed");
    g2.stepFrames(3); // flow carries the keys into play; currency sees them present
    expect(g2.world.state.coins).toBe(9999);
    expect(g2.world.state.prestigeMult).toBe(1.5);
    expect((g2.world.state.upgrades as Record<string, number>).click).toBe(4);
  });
});
