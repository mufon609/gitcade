import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * Reuse proof #2 — tower-defense creep wave. The four reuse parts again: creeps
 * ai-chase the core, contact-damage it, spawn in waves, and die (health-and-death)
 * to tower contact-damage. Here a tower is just a static entity carrying
 * contact-damage — no bespoke "tower" part was needed.
 */
function boot() {
  return createGame({ manifest, config, scenes: [main] }, { canvas: null, registry: createLibraryRegistry() });
}

describe("creep-wave reuse proof", () => {
  it("boots and runs 120 frames headless without throwing", () => {
    const game = boot();
    expect(() => game.stepFrames(120)).not.toThrow();
    expect(game.world.frame).toBe(120);
  });

  it("spawns creeps that advance toward the core", () => {
    const game = boot();
    game.stepFrames(30);
    const creeps = game.world.query("enemy");
    expect(creeps.length).toBeGreaterThan(0);
    expect(creeps[0]!.vx).toBeGreaterThan(0); // advancing rightward toward the core
  });

  it("towers cut the creeps down across the waves and the core holds (win)", () => {
    const game = boot();
    let i = 0;
    while (!game.world.state.gameOver && i < 8000) {
      game.stepFrames(1);
      i++;
    }
    expect(game.world.state.gameOver).toBe(true);
    expect(game.world.state.outcome).toBe("win");
    expect(game.world.state.kills as number).toBeGreaterThanOrEqual(9);
  });
});
