import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * Reuse proof #4 — space-invaders descent. The four reuse parts again: invaders
 * spawn in waves, ai-chase the player (LOCKED to the Y axis, so they descend
 * straight down their column), contact-damage on contact, and die via
 * health-and-death to the ship's auto-fired bullets. The Y-axis lock is the
 * generalization that let ai-chase produce a fourth distinct genre with no new part.
 */
function boot() {
  return createGame({ manifest, config, scenes: [main] }, { canvas: null, registry: createLibraryRegistry() });
}

describe("invaders-descent reuse proof", () => {
  it("boots and runs 120 frames headless without throwing", () => {
    const game = boot();
    expect(() => game.stepFrames(120)).not.toThrow();
    expect(game.world.frame).toBe(120);
  });

  it("invaders descend straight down (ai-chase lockAxis:y) while the ship auto-fires", () => {
    const game = boot();
    game.stepFrames(30);
    const invaders = game.world.query("enemy");
    expect(invaders.length).toBeGreaterThan(0);
    const inv = invaders[0]!;
    expect(inv.vx).toBe(0); // Y-locked: no horizontal pursuit
    expect(inv.vy).toBeGreaterThan(0); // descending toward the ship below
    expect(game.world.query("bullet").length).toBeGreaterThan(0); // auto-fire is shooting
  });

  it("the ship shoots the descending wave down before it lands (win)", () => {
    const game = boot();
    let i = 0;
    while (!game.world.state.gameOver && i < 12000) {
      game.stepFrames(1);
      i++;
    }
    expect(game.world.state.gameOver).toBe(true);
    expect(game.world.state.outcome).toBe("win");
    expect(game.world.state.kills as number).toBeGreaterThanOrEqual(9);
  });
});
