import { describe, it, expect } from "vitest";
import { createGame, type Game } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * Reuse proof — the 0.7.0 entity-solid enablers end-to-end (INDIE-ROADMAP Tier-0):
 *  - solid-collide (0.3): the player LANDS ON a solid crate entity, is BLOCKED by its
 *    side, BONKS a solid overhead ledge, JUMPS OFF the crate (move-platformer reads
 *    solid-collide's __onGround), and RIDES a vertical lift — all with no host code, a
 *    crate exactly as solid as a tile.
 *  - resolveSolids swept sub-stepping (0.4): a fast faller lands ON a thin platform
 *    instead of tunnelling through it.
 *
 * Scene facts: viewport 800x480, 32px tiles, floor top y=448 (player h=24 → rests at
 * y=424). Crate x300..348, top y=400. Ledge x520..616, underside y=356. Lift x640..736
 * oscillates its top between y=180 and y=360. Thin platform top y=300 (8px thick).
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

describe("platformer-solids reuse proof", () => {
  it("boots and runs 120 frames headless without throwing", () => {
    const game = boot();
    expect(() => game.stepFrames(120)).not.toThrow();
    expect(game.world.frame).toBe(120);
  });

  it("falls and lands on the solid tile floor (tilemap-collide baseline still holds)", () => {
    const game = boot();
    game.stepFrames(120);
    const player = game.world.byId("player")!;
    expect(player.y).toBe(424);
    expect(player.state.__onGround).toBe(true);
  });

  it("lands on a solid CRATE entity, not the floor (solid-collide, 0.3)", () => {
    const game = boot();
    game.stepFrames(1);
    const player = game.world.byId("player")!;
    player.x = 312; // over the crate (x 300..348)
    player.y = 200;
    player.vy = 0;
    drive(game, { axis: 0 });
    game.stepFrames(120);
    expect(player.y).toBe(376); // resting on the crate top (400), NOT the floor (424)
    expect(player.state.__onGround).toBe(true);
  });

  it("is blocked by the crate's side when running into it (__onWallR)", () => {
    const game = boot();
    game.stepFrames(120); // settle on the floor first
    const player = game.world.byId("player")!;
    player.x = 200; // on the floor, left of the crate
    player.y = 424;
    player.vy = 0;
    drive(game, { axis: 1 }); // run right into the crate
    game.stepFrames(120);
    expect(player.x).toBe(276); // pressed against the crate's left face (300 - 24)
    expect(player.state.__onWallR).toBe(true);
  });

  it("jumps off the crate top (move-platformer reads solid-collide's __onGround)", () => {
    const game = boot();
    game.stepFrames(1);
    const player = game.world.byId("player")!;
    player.x = 312;
    player.y = 200;
    player.vy = 0;
    drive(game, { axis: 0 });
    game.stepFrames(120); // land on the crate
    expect(player.state.__onGround).toBe(true);
    drive(game, { axis: 0, jump: true }); // fresh jump press
    game.stepFrames(1);
    expect(player.vy).toBeLessThan(0); // launched upward off the crate
  });

  it("bonks its head on a solid overhead ledge when jumping (__onCeiling)", () => {
    const game = boot();
    game.stepFrames(120); // settle on the floor
    const player = game.world.byId("player")!;
    player.x = 552; // under the ledge (x 520..616)
    player.y = 424;
    player.vy = 0;
    drive(game, { axis: 0, jump: true });
    game.stepFrames(1); // jump press
    drive(game, { axis: 0, jump: false });
    let bonked = false;
    for (let i = 0; i < 40; i++) {
      game.stepFrames(1);
      if (player.state.__onCeiling) {
        bonked = true;
        break;
      }
    }
    expect(bonked).toBe(true);
    expect(player.y).toBe(356); // top pushed to the ledge underside (340 + 16)
  });

  it("rides a vertical lift up (solid-collide grounding tracks the moving platform)", () => {
    const game = boot();
    game.stepFrames(30); // let the lift get moving (it heads up from y=352 toward y=172)
    const player = game.world.byId("player")!;
    const lift = game.world.byId("elevator")!;
    const startLiftY = lift.y;
    player.x = lift.x + (lift.w - player.w) / 2; // centered on the lift
    player.y = lift.y - player.h;
    player.vy = 0;
    drive(game, { axis: 0 });
    game.stepFrames(40);
    expect(player.state.__onGround).toBe(true); // still standing on the lift
    expect(player.y).toBe(lift.y - player.h); // tracks the lift top exactly
    expect(lift.y).toBeLessThan(startLiftY); // the lift rose and carried the player up
  });

  it("rides the lift while WALKING, without being ejected sideways (0.3 lift-resolution fix)", () => {
    const game = boot();
    game.stepFrames(30); // lift rising
    const player = game.world.byId("player")!;
    const lift = game.world.byId("elevator")!;
    player.x = lift.x + (lift.w - player.w) / 2; // centered on the lift
    player.y = lift.y - player.h;
    player.vy = 0;
    const startX = player.x;
    // The lift rises INTO the player each tick; pressing right must not make the resolver
    // misread the lift top as a wall and fling the player off the side (the bug the
    // axis:0 ride test missed).
    for (let i = 0; i < 6; i++) {
      drive(game, { axis: 1 }); // walk right
      game.stepFrames(1);
      expect(player.state.__onGround).toBe(true); // never ejected off the lift
      expect(player.x).toBeGreaterThanOrEqual(lift.x); // not flung to the lift's left (or x<0)
      expect(player.y).toBe(lift.y - player.h); // still riding the lift top
    }
    expect(player.x).toBeGreaterThan(startX); // walking right actually worked
    expect(player.x + player.w).toBeLessThanOrEqual(lift.x + lift.w); // and stayed on the lift
  });

  it("a fast faller lands on a thin platform without tunnelling (swept collision, 0.4)", () => {
    const game = boot();
    game.stepFrames(10);
    const faller = game.world.byId("faller")!;
    // 3000 px/s ⇒ 50 px/tick, far thicker than the 8 px platform: a non-swept resolver
    // would pass straight through. Swept sub-stepping catches it on the platform top.
    expect(faller.y).toBe(284); // flush on the platform top (300 - 16), never below it
  });
});
