import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * Reuse proof #3 — survival-arena mobs. The four reuse parts again: scaling waves
 * (waveSizeGrowth) of mobs ai-chase the player and trade contact-damage; mobs die
 * via health-and-death. Layers on the storage-backed `score` system to prove
 * high-score persistence flows through the SDK storage bridge (never raw browser
 * storage).
 */
function boot() {
  return createGame({ manifest, config, scenes: [main] }, { canvas: null, registry: createLibraryRegistry() });
}
const flush = () => Promise.resolve().then(() => Promise.resolve());

describe("arena-mobs reuse proof", () => {
  it("boots and runs 120 frames headless without throwing", () => {
    const game = boot();
    expect(() => game.stepFrames(120)).not.toThrow();
    expect(game.world.frame).toBe(120);
  });

  it("escalates through multiple waves of chasing mobs", () => {
    const game = boot();
    game.stepFrames(240);
    expect((game.world.state.wave as number) ?? 0).toBeGreaterThanOrEqual(2);
    expect(game.world.query("enemy").length).toBeGreaterThan(0);
  });

  it("clears the swarm via thorns and persists the high score through storage (win)", async () => {
    const game = boot();
    let i = 0;
    while (!game.world.state.gameOver && i < 12000) {
      game.stepFrames(1);
      i++;
    }
    expect(game.world.state.gameOver).toBe(true);
    expect(game.world.state.outcome).toBe("win");
    expect(game.world.state.kills as number).toBeGreaterThanOrEqual(18);
    // The score system mirrored kills into the high score and persisted it.
    expect(game.world.state.best as number).toBeGreaterThanOrEqual(18);
    await flush();
    expect(await game.world.storage.get<number>("arena.best")).toBeGreaterThanOrEqual(18);
  });
});
