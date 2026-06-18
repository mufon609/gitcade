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
 * Platform at cols 22–25 row 7 → top y=224 (a lander rests at y=200). ONE-WAY platform
 * at cols 4–7 row 6 → top y=192 (a lander rests at y=168), clear column down to the floor.
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

/** Key-aware stub (drop-through needs `down` vs `jump` keys distinguished). */
function driveKeys(game: Game, opts: { axis?: number; held?: string[] }): void {
  const held = new Set(opts.held ?? []);
  const input = game.world.input as unknown as { axis: () => number; anyDown: (keys: string[]) => boolean };
  input.axis = () => opts.axis ?? 0;
  input.anyDown = (keys: string[]) => keys.some((k) => held.has(k));
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

  it("lands on a ONE-WAY platform from above (tilemap-collide oneWay tile, 0.7.0)", () => {
    const game = boot();
    game.stepFrames(1);
    const player = game.world.byId("player")!;
    player.x = 160; // over the cols 4–7 one-way platform (x 128–256)
    player.y = 64;
    player.vy = 0;
    driveKeys(game, {}); // no input → fall straight onto it
    game.stepFrames(120);
    expect(player.y).toBe(168); // resting on the one-way platform top (192), not the floor
    expect(player.state.__onGround).toBe(true);
    expect(player.state.__onOneWay).toBe(true);
  });

  it("drops through the one-way platform on down+jump, landing on the floor below", () => {
    const game = boot();
    game.stepFrames(1);
    const player = game.world.byId("player")!;
    player.x = 160;
    player.y = 64;
    player.vy = 0;
    driveKeys(game, {});
    game.stepFrames(120);
    expect(player.y).toBe(168); // settled on the one-way platform
    driveKeys(game, { held: ["ArrowDown", "Space"] }); // down + jump → open the drop-through window
    game.stepFrames(2);
    driveKeys(game, {}); // release; the window carries the body clear of the platform
    game.stepFrames(180);
    expect(player.y).toBe(424); // fell THROUGH the one-way platform and landed on the floor (448 − 24)
  });

  it("animates idle↔run and flips scaleX to face movement (sprite-state-machine + face-velocity, 0.7.0)", () => {
    const game = boot();
    game.stepFrames(120); // settle on the floor, no input
    const player = game.world.byId("player")!;
    expect(player.anim.current).toBe("idle"); // grounded + still

    drive(game, { axis: 1 }); // run right
    game.stepFrames(20);
    expect(player.anim.current).toBe("run");
    expect(player.scaleX).toBe(1); // facing right

    drive(game, { axis: -1 }); // run left
    game.stepFrames(20);
    expect(player.scaleX).toBe(-1); // flipped to face left
  });

  it("animates jump while rising and fall while descending (0.7.0)", () => {
    const game = boot();
    game.stepFrames(1);
    const player = game.world.byId("player")!;
    drive(game, { axis: 0 });
    // Park mid-air over empty space; the mover only nudges vy by gravity, so the sign holds
    // for this tick → the state machine reads airborne + rising/descending.
    player.x = 400;
    player.y = 200;
    player.vy = -120; // rising
    game.stepFrames(1);
    expect(player.state.__onGround).toBe(false);
    expect(player.anim.current).toBe("jump");

    player.vy = 120; // now descending
    game.stepFrames(1);
    expect(player.anim.current).toBe("fall");
  });

  it("shakes the camera on a 'shake' event, then settles (camera-shake, 0.7.0)", () => {
    const game = boot();
    game.stepFrames(2); // let the system subscribe and the camera settle
    const cam = game.world.camera;
    expect(cam.shakeX ?? 0).toBe(0);

    game.world.events.emit("shake", { magnitude: 14, duration: 0.3 });
    let shook = false;
    for (let i = 0; i < 4; i++) {
      game.stepFrames(1);
      if ((cam.shakeX ?? 0) !== 0 || (cam.shakeY ?? 0) !== 0) shook = true;
    }
    expect(shook).toBe(true); // the camera is offset during the shake

    game.stepFrames(40); // past the 0.3s duration → settled back to the base
    expect(cam.shakeX).toBe(0);
    expect(cam.shakeY).toBe(0);
  });

  it("pulses the goal flag via a scale tween (visual only — physics untouched, 0.7.0)", () => {
    const game = boot();
    const goal = game.world.byId("goal")!;
    const x0 = goal.x;
    const w0 = goal.w;
    game.stepFrames(20); // partway into the pingpong pulse (duration 0.6s)
    expect(goal.scaleX).toBeGreaterThan(1); // scaled up
    expect(goal.scaleX).toBeLessThanOrEqual(1.2); // never past the target
    expect(goal.scaleX).toBe(goal.scaleY); // uniform
    expect(goal.x).toBe(x0); // position untouched by the scale tween
    expect(goal.w).toBe(w0); // base size (collision) untouched
  });
});
