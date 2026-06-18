import { describe, it, expect } from "vitest";
import { createGame, type Game } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * Reuse proof — the 0.7.0 platformer enablers end-to-end (INDIE-ROADMAP Tier-0):
 *  - tilemap-collide (0.2): the player lands on a SOLID tile floor and on a mid-air
 *    platform, and stops at a solid wall — no entity-per-tile, no host collision code.
 *  - move-platformer (1.1.0): jumps off the tile floor (reads tilemap-collide's
 *    __onGround flag).
 *  - camera-follow + scene.world (0.1): the viewport pans to track the player across a
 *    world wider than itself and clamps to the world's right edge.
 *
 * Scene facts: viewport 800x480, world 1600x480, 32px tiles. Floor top y=448 (player
 * h=24 → rests at y=424). Right wall stops the player at x=1544. Camera maxX=800.
 * Platform at cols 22–25 row 7 → top y=224 (a lander rests at y=200).
 */
function boot(): Game {
  return createGame({ manifest, config, scenes: [main] }, { canvas: null, registry: createLibraryRegistry() });
}

/** Stub the headless input so the player runs/jumps (no DOM keys in a smoke boot). */
function drive(game: Game, opts: { axis?: number; jump?: boolean }): void {
  const input = game.world.input as unknown as { axis: () => number; anyDown: () => boolean };
  input.axis = () => opts.axis ?? 0;
  input.anyDown = () => opts.jump ?? false;
}

describe("platformer-scroll reuse proof", () => {
  it("boots and runs 120 frames headless without throwing", () => {
    const game = boot();
    expect(() => game.stepFrames(120)).not.toThrow();
    expect(game.world.frame).toBe(120);
  });

  it("decouples the world (1600x480) from the viewport (800x480)", () => {
    const game = boot();
    expect(game.world.bounds).toEqual({ width: 1600, height: 480 });
    expect(game.world.camera.width).toBe(800);
    expect(game.world.camera.height).toBe(480);
  });

  it("falls and lands on the solid tile floor (tilemap-collide)", () => {
    const game = boot(); // no input → falls straight down
    game.stepFrames(120);
    const player = game.world.byId("player")!;
    expect(player.y).toBe(424); // bottom (448) flush with the floor top
    expect(player.vy).toBe(0);
    expect(player.state.__onGround).toBe(true);
    expect(game.world.camera.x).toBe(0); // player near the left → camera pinned at origin
  });

  it("lands on a MID-AIR platform, not the floor (the headline 0.2 fix)", () => {
    const game = boot();
    game.stepFrames(1); // build the world
    const player = game.world.byId("player")!;
    player.x = 736; // above the cols 22–25, row 7 platform (x 704–832)
    player.y = 64;
    player.vy = 0;
    drive(game, { axis: 0 });
    game.stepFrames(120);
    expect(player.y).toBe(200); // resting on the platform top (224), NOT the floor (424)
    expect(player.state.__onGround).toBe(true);
  });

  it("jumps off the tile floor when grounded (move-platformer 1.1.0 hook)", () => {
    const game = boot();
    game.stepFrames(120); // land first
    const player = game.world.byId("player")!;
    expect(player.state.__onGround).toBe(true);
    drive(game, { axis: 0, jump: true }); // fresh jump press
    game.stepFrames(1);
    expect(player.vy).toBeLessThan(0); // launched upward
    const yAfterJump = player.y;
    game.stepFrames(10);
    expect(player.y).toBeLessThan(yAfterJump); // rising
  });

  it("runs right; the camera follows then clamps at the world's right edge, and a wall stops the player", () => {
    const game = boot();
    drive(game, { axis: 1 }); // hold right
    game.stepFrames(700); // ~11.6s — enough to cross the world and reach the far wall
    const player = game.world.byId("player")!;
    expect(player.x).toBe(1544); // pressed against the right wall (col 49)
    expect(player.state.__onWallR).toBe(true);
    expect(game.world.camera.x).toBe(800); // viewport clamped to the world's right edge (maxX)
  });

  it("variable jump: holding jump climbs higher than tapping it (move-platformer 1.2.0)", () => {
    // The scene drives the full 1.2.0 mover (accel/friction, jumpCut, buffer, apex hang) via
    // $cfg — so a real boot exercises the new params end-to-end, validator included.
    function apexY(hold: boolean): number {
      const game = boot();
      game.stepFrames(120); // settle on the floor
      const player = game.world.byId("player")!;
      expect(player.state.__onGround).toBe(true);
      drive(game, { axis: 0, jump: true }); // press
      game.stepFrames(1);
      if (!hold) drive(game, { axis: 0, jump: false }); // tap: release after one tick → jumpCut trims it
      let minY = player.y;
      for (let i = 0; i < 60; i++) {
        game.stepFrames(1);
        minY = Math.min(minY, player.y);
      }
      return minY;
    }
    expect(apexY(true)).toBeLessThan(apexY(false)); // a held jump reaches a smaller y (higher)
  });
});
