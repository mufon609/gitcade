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
/**
 * Enter play and let the persistence load resolve. 0.2.1 collapse: `persistence`
 * runs FIRST on the PLAY scene and claims the economy keys synchronously, so the
 * seed-once systems (`currency`, `click-to-earn`, `auto-income`) DEFER their seed
 * until the async `storage.get` resolves. We therefore await a microtask, then step
 * once so the released claim lets the seeds (or the restored values) land — the same
 * "kick the async, await, step" shape the G6 reload test uses.
 */
const microtask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
async function enterPlay(g: Game): Promise<void> {
  g.world.events.emit("start-pressed");
  g.stepFrames(1); // title tick; the scene-change drains at tick end → now on play
  g.stepFrames(1); // play tick 1: persistence claims + fires the async load; seeds defer
  await microtask(); // the async storage.get resolves: restore written / claim released
  g.stepFrames(1); // claim gone → seeds (or restored values) are now present
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
  it("flows title→play and earns on a real coin tap (G2 click edge)", async () => {
    const g = boot();
    expect(g.scene.id).toBe("title");
    await enterPlay(g);
    expect(g.scene.id).toBe("play");

    const power = g.world.state.clickPower as number;
    expect(power).toBe(cfg.baseClickPower);

    g.world.state.coins = 0;
    tap(g, 400, 300, 4); // 4 taps on the full-field coin target
    expect(g.world.state.coins).toBe(4 * power);
  });

  it("buys an upgrade through upgrade-tree (G5): deduct + raise power", async () => {
    const g = boot();
    await enterPlay(g);
    const power = g.world.state.clickPower as number;
    g.world.state.coins = 1000;
    g.world.state.upgradeRequest = "click";
    g.stepFrames(1);
    expect(g.world.state.clickPower as number).toBeGreaterThan(power);
    expect(g.world.state.coins as number).toBeLessThan(1000);
    expect(() => g.stepFrames(120)).not.toThrow();
  });

  it("prestige system banks, bumps the multiplier, and resets the run", async () => {
    const g = boot();
    await enterPlay(g);
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
  it("prestige multiplier scales click AND auto income (IC-1)", async () => {
    async function runRound(mult: number): Promise<{ fromClicks: number; fromAuto: number }> {
      const g = boot();
      await enterPlay(g);
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
    const base = await runRound(1);
    const prestiged = await runRound(3);
    expect(prestiged.fromClicks).toBeCloseTo(base.fromClicks * 3, 5);
    expect(prestiged.fromAuto).toBeCloseTo(base.fromAuto * 3, 5);
    expect(base.fromAuto).toBeGreaterThan(0);
  });

  // G6 (0.2.1 collapse): values survive a reload with persistence running on the
  // PLAY scene. The 0.2.1 hydration claim makes the seed-once systems defer until
  // the async restore lands, so a saved coins/clickPower/autoRate is restored
  // authoritatively even on the scene that seeds them — no title-scene workaround.
  it("persists coins/upgrades/prestige across a reload (G6)", async () => {
    const storage = new MemoryStorage();
    const g1 = boot(storage);
    await enterPlay(g1);
    g1.world.state.coins = 9999;
    g1.world.state.clickPower = 7;
    g1.world.state.autoRate = 3;
    g1.world.state.upgrades = { click: 4, cursor: 2 };
    g1.world.state.prestigeMult = 1.5;
    g1.stepFrames(5); // change-based save writes the snapshot
    await microtask();

    // Reload: persistence on the play scene claims the keys, the async restore lands,
    // and the deferred seeds never clobber the saved values.
    const g2 = boot(storage);
    expect(g2.scene.id).toBe("title");
    await enterPlay(g2);
    expect(g2.scene.id).toBe("play");
    // coins restored authoritatively; auto-income (autoRate 3) may accrue a few tenths
    // on the post-restore steps, so allow a small positive drift from the saved 9999.
    expect(g2.world.state.coins as number).toBeGreaterThanOrEqual(9999);
    expect(g2.world.state.coins as number).toBeLessThan(10000);
    expect(g2.world.state.clickPower).toBe(7);
    expect(g2.world.state.autoRate).toBe(3);
    expect(g2.world.state.prestigeMult).toBe(1.5);
    expect((g2.world.state.upgrades as Record<string, number>).click).toBe(4);
  });
});

/**
 * E2 (0.4.0) — the per-frame host `fmt()`/mirror that compacted the HUD is gone; the
 * `format-binding` system in play.json compacts/templates the numeric readouts as DATA
 * (the duplicated `formatCompact` bandaid is retired).
 */
describe("idle-clicker HUD (E2 format-binding)", () => {
  it("compacts coins and templates the prestige-scaled rate as data", async () => {
    const game = boot();
    await enterPlay(game);
    game.world.state.coins = 1234;
    game.world.state.autoRate = 2;
    game.world.state.prestigeMult = 5;
    game.stepFrames(1);
    expect(game.world.state.coinsDisplay).toBe("1.23K"); // formatCompact(1234) as data
    expect(game.world.state.rateDisplay).toBe("10/sec"); // autoRate(2) * prestigeMult(5), templated
  });
});
