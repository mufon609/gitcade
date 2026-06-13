import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * Reuse proof #1 — snake-tail threat. The same four parts that drive the other
 * three genres here become a growing swarm of chasers that hunt the player.
 */
function boot() {
  return createGame({ manifest, config, scenes: [main] }, { canvas: null, registry: createLibraryRegistry() });
}

describe("snake-threat reuse proof", () => {
  it("boots and runs 120 frames headless without throwing", () => {
    const game = boot();
    expect(() => game.stepFrames(120)).not.toThrow();
    expect(game.world.frame).toBe(120);
  });

  it("wave-spawner produces ai-chase threats that pursue the player", () => {
    const game = boot();
    game.stepFrames(60);
    const enemies = game.world.query("enemy");
    expect(enemies.length).toBeGreaterThan(0);
    const player = game.world.byId("player")!;
    const e = enemies[0]!;
    // ai-chase set a velocity pointing toward the player (same-sign components).
    expect(Math.sign(e.vx)).toBe(Math.sign(player.cx - e.cx));
  });

  it("the swarm contact-damages the idle player to death (all four parts integrate)", () => {
    const game = boot();
    let i = 0;
    while (!game.world.state.gameOver && i < 6000) {
      game.stepFrames(1);
      i++;
    }
    expect(game.world.state.gameOver).toBe(true);
    expect(game.world.state.outcome).toBe("lose");
    expect(game.world.state.playerDeaths as number).toBeGreaterThanOrEqual(1);
  });
});
