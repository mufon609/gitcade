import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import title from "../src/scenes/title.json";
import play from "../src/scenes/play.json";
import over from "../src/scenes/over.json";
import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";

/**
 * The headless smoke boot `gitcade validate` defers to. Survival Arena's build is the
 * three-scene data flow (title → play → over wired by `flow.on`) composing library
 * parts only — the level-driven enemy toughness/speed ramp is data now (two
 * `scale-by-state` instances; no custom behavior). Boots on the full library
 * registry (the custom hook is a no-op), no canvas, and
 * exercises the data-driven transitions: the wave-spawner scatters chasers, the
 * player auto-fires + takes contact damage, score accrues, the difficulty level
 * ramps (and makes enemies tougher/faster), a death routes to game-over, and a retry
 * returns to play resetting the run — all without throwing.
 */
function boot() {
  const registry = createLibraryRegistry();
  registerCustomBehaviors(registry);
  return createGame({ manifest, config, scenes: [title, play, over] }, { canvas: null, registry });
}

const park = (game: ReturnType<typeof boot>) => {
  const p = game.world.query("player")[0];
  if (p) {
    p.x = 400;
    p.y = 300;
    p.vx = 0;
    p.vy = 0;
    p.state.hp = 9999; // immortal for observation runs
  }
};

describe("survival-arena smoke (0.2.0 data flow)", () => {
  it("boots the entry (title) scene and runs frames without throwing", () => {
    const game = boot();
    expect(game.scene.id).toBe("title");
    expect(() => game.stepFrames(30)).not.toThrow();
  });

  it("title → play on start-pressed; chasers spawn, auto-fire runs, score accrues", () => {
    const game = boot();
    game.world.events.emit("start-pressed"); // what the title's tap-emit button emits
    game.stepFrames(2);
    expect(game.scene.id).toBe("play");
    let sawBullet = false;
    for (let i = 0; i < 200; i++) {
      park(game);
      game.stepFrames(1);
      if (game.world.query("bullet").length > 0) sawBullet = true;
    }
    expect(game.scene.id).toBe("play");
    expect(game.world.query("player").length).toBe(1);
    expect(game.world.query("enemy").length).toBeGreaterThan(0);
    expect(sawBullet).toBe(true);
    expect((game.world.state.wave as number) >= 1).toBe(true);
  });

  it("the swarm cap holds — no runaway entity growth past maxAlive", () => {
    const game = boot();
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    let peak = 0;
    for (let i = 0; i < 1200; i++) {
      park(game);
      for (const b of game.world.query("bullet")) game.world.destroy(b); // let the swarm pile up
      game.stepFrames(1);
      peak = Math.max(peak, game.world.query("enemy").length);
    }
    expect(peak).toBeLessThanOrEqual(config.maxAlive);
  });

  it("the difficulty ramps: a high score advances the level and toughens the swarm", () => {
    const game = boot();
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    for (let i = 0; i < 80; i++) {
      park(game);
      game.stepFrames(1);
    }
    const lvl1 = game.world.state.level as number;
    game.world.state.score = 100000; // force level-progression scoreGte to ramp to maxLevel
    for (let i = 0; i < 300; i++) {
      park(game);
      game.stepFrames(1);
    }
    const lvlHigh = game.world.state.level as number;
    expect(lvlHigh).toBeGreaterThan(lvl1);
    // swarm-scale toughens enemies: at the higher level a fresh enemy's hp/speed
    // exceeds the base config values (the prototype's nominal enemyHp/enemySpeed).
    let maxHp = 0;
    let maxSpeed = 0;
    for (const e of game.world.query("enemy")) {
      if (typeof e.state.hp === "number") maxHp = Math.max(maxHp, e.state.hp as number);
      maxSpeed = Math.max(maxSpeed, Math.hypot(e.vx, e.vy));
    }
    expect(maxHp).toBeGreaterThan(config.enemyHp);
    expect(maxSpeed).toBeGreaterThan(config.enemySpeed);
  });

  it("player death routes play → over and hands off the score", () => {
    const game = boot();
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    expect(game.scene.id).toBe("play");
    game.world.state.score = 120;
    for (let i = 0; i < 60 && game.scene.id === "play"; i++) {
      const p = game.world.query("player")[0];
      if (p) p.state.hp = 0; // a fatal hit
      game.stepFrames(1);
    }
    expect(game.scene.id).toBe("over");
    expect(game.world.state.outcome).toBe("lose");
    expect((game.world.state.score as number) >= 120).toBe(true);
  });

  it("retry routes over → play and resets the run (score back to 0)", () => {
    const game = boot();
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    game.world.state.score = 120;
    for (let i = 0; i < 60 && game.scene.id === "play"; i++) {
      const p = game.world.query("player")[0];
      if (p) p.state.hp = 0;
      game.stepFrames(1);
    }
    expect(game.scene.id).toBe("over");
    game.world.events.emit("retry"); // what the over scene's tap-emit button emits
    game.stepFrames(2);
    expect(game.scene.id).toBe("play");
    // over.flow.persist carries only best/bestDisplay — score is NOT carried, so the
    // fresh play scene's score system restarts it at 0.
    expect((game.world.state.score as number) ?? 0).toBeLessThan(120);
    expect(game.world.query("player").length).toBe(1);
  });
});
